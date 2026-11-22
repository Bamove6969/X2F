// Plan 4 Task 5: security-key taps bound to one intent (start, finish, consume in the caller's
// transaction), with the soft authenticator of Plan 2 Task 7 attested as an allowlisted AAGUID.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, tapChallenge, type KeyTapIntent } from '@x2f/staff';
import type { Deps } from '../../src/app.js';
import { fileAttestationPolicy } from '../../src/auth/attestation.js';
import { verifyWebAuthnRegistration, webauthnRegistrationOptions } from '../../src/auth/webauthn.js';
import { ApiError } from '../../src/errors.js';
import {
  KEY_TAP_TTL_MS,
  consumeKeyTap,
  finishKeyTap,
  keyTapRoutes,
  parseKeyTapIntent,
  startKeyTap,
  tapPermOf,
  TAP_STARTS_PER_WINDOW,
  purgeKeyTaps,
  MAX_OPEN_TAPS,
  KEY_TAP_PURGE_MS,
} from '../../src/staff/keyTap.js';
import { seedAccount } from '../helpers/accounts.js';
import { testApp } from '../helpers/app.js';
import { createSoftAuthenticator, createTestCa, writeTestMds, type SoftAuthenticator, type TestCa } from '../helpers/softAuthenticator.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const ALLOWED = '11111111-2222-4333-8444-555555555555';
/** On staff's allowlist only: an owner key with it is never attested for the owner. */
const STAFF_ONLY = '12121212-3434-4565-8787-909090909090';

let api: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let ca: TestCa;
let mdsDir: string;
let seq = 0;
const uniqueName = (p: string) => `${p}${++seq}tap`;

const STOP: KeyTapIntent = { kind: 'emergency-stop' };
const RESUME: KeyTapIntent = { kind: 'resume-trading' };
const RULING: KeyTapIntent = {
  kind: 'ruling',
  step: 'propose',
  rulingId: '7d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d',
  code: 'ABCD-EFGH-JKMN-PQRS',
  round: 1,
  outcome: 'release-to-buyer',
  accountAction: { kind: 'none' },
  amountAtomic: '1500000000000',
  reasonSha256: 'a'.repeat(64),
  evidenceSha256: 'c'.repeat(64),
  round1Id: null,
};

beforeAll(async () => {
  ca = createTestCa();
  mdsDir = await mkdtemp(join(tmpdir(), 'x2f-mds-tap-'));
  await writeTestMds(mdsDir, ca, { statements: [ALLOWED, STAFF_ONLY], allow: [ALLOWED, STAFF_ONLY], ownerAllow: [ALLOWED] });
  const attestation = fileAttestationPolicy(mdsDir);
  await attestation.init();
  ({ app: api, deps, setNow } = await testApp({ attestation }));
  setNow(T0);
});

afterAll(async () => {
  await api.close();
  await rm(mdsDir, { recursive: true, force: true });
});

/** A staff (or owner) account with one registered credential of the given make. */
async function staffWith(o: { aaguid?: string; passkey?: boolean; kind?: 'staff' | 'owner' } = {}): Promise<{ id: string; key: SoftAuthenticator }> {
  const id = await seedAccount(deps, { loginName: uniqueName('s'), kind: o.kind ?? 'staff' });
  const key = await addKey(id, o);
  return { id, key };
}

async function addKey(id: string, o: { aaguid?: string; passkey?: boolean } = {}): Promise<SoftAuthenticator> {
  const challenge = randomBytes(32);
  const key = o.passkey
    ? createSoftAuthenticator({ backedUp: true, userVerified: true })
    : createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: o.aaguid ?? ALLOWED, ca } });
  const options = await webauthnRegistrationOptions(deps, id, { kind: o.passkey ? 'passkey' : 'security-key', challenge });
  await verifyWebAuthnRegistration(deps, id, key.register(options, ORIGIN), challenge, o.passkey ? { kind: 'passkey' } : {});
  return key;
}

/** Start and finish a tap for `intent`; returns the tap id. */
async function tapped(id: string, key: SoftAuthenticator, intent: KeyTapIntent): Promise<string> {
  const { tapId, options } = await startKeyTap(deps, id, intent);
  await finishKeyTap(deps, id, tapId, key.authenticate(options, ORIGIN));
  return tapId;
}

/** `consumeKeyTap` inside a transaction the test commits (or rolls back). */
async function consume(tapId: string, accountId: string, expect: KeyTapIntent, o: { rollback?: boolean } = {}) {
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    const tap = await consumeKeyTap(client, tapId, accountId, expect, deps.clock());
    await client.query(o.rollback ? 'rollback' : 'commit');
    return tap;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

const tapInvalid = { status: 403, code: 'tap-invalid' };

describe('startKeyTap', () => {
  it('binds the challenge to the intent and a fresh 16-byte nonce, offering only attested security keys', async () => {
    const { id, key } = await staffWith();
    const passkey = await addKey(id, { passkey: true });
    const { tapId, options } = await startKeyTap(deps, id, STOP);
    expect(options.allowCredentials?.map((c) => c.id)).toEqual([key.credentialId]);
    expect(options.allowCredentials?.map((c) => c.id)).not.toContain(passkey.credentialId);
    const { rows } = await deps.db.query<{ nonce: Buffer; intent: string; account_id: string }>(
      'select nonce, intent, account_id from key_taps where id = $1',
      [tapId],
    );
    expect(rows[0]!.account_id).toBe(id);
    expect(rows[0]!.nonce.length).toBe(16);
    // Lead P4 call: an owner registry tap carries the server's start time, signed (issuedAt).
    const stamped = { ...STOP, issuedAt: T0.toISOString() } as KeyTapIntent;
    expect(rows[0]!.intent).toBe(canonicalJson(stamped));
    expect(options.challenge).toBe(Buffer.from(tapChallenge(stamped, rows[0]!.nonce)).toString('base64url'));
  });

  it('answers the nonce and issuedAt, so the staff site can check the challenge itself (re-verify X1)', async () => {
    const { id } = await staffWith();
    const s = await startKeyTap(deps, id, STOP);
    expect(s.issuedAt).toBe(T0.toISOString());
    expect(s.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(s.options.challenge).toBe(Buffer.from(tapChallenge({ ...STOP, issuedAt: s.issuedAt } as KeyTapIntent, Buffer.from(s.nonce, 'hex'))).toString('base64url'));
    const r = await startKeyTap(deps, id, RULING);
    expect(r.issuedAt).toBeNull();
    expect(r.options.challenge).toBe(Buffer.from(tapChallenge(RULING, Buffer.from(r.nonce, 'hex'))).toString('base64url'));
  });

  it('stamps issuedAt only on the registry kinds the moderation gate orders; a client cannot send one (lead P4 call)', async () => {
    // A fresh account per start: at most 5 open taps per account (RV5 m12).
    const read = async (i: KeyTapIntent) => {
      const { id } = await staffWith();
      const { tapId } = await startKeyTap(deps, id, i);
      return JSON.parse((await deps.db.query<{ intent: string }>('select intent from key_taps where id = $1', [tapId])).rows[0]!.intent) as Record<string, unknown>;
    };
    const acct = '7d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d';
    for (const i of [STOP, RESUME, { kind: 'switch-on', accountId: acct, role: 'mod' }, { kind: 'set-role', accountId: acct, role: 'senior' }, { kind: 'remove-staff', accountId: acct }, { kind: 'settings', largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48 },
      // Lead call (18 Nov, batch 10a merge): a ban and its lift are stamped like the other tapped actions.
      { kind: 'ban-account', accountId: acct, banId: '0b0e8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d', banKind: 'trade', ruleId: 'abuse', until: null },
      { kind: 'lift-ban', accountId: acct, banId: '0b0e8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d' }] as KeyTapIntent[]) {
      expect((await read(i)).issuedAt, i.kind).toBe(T0.toISOString());
    }
    expect((await read(RULING)).issuedAt).toBeUndefined();
    expect(() => parseKeyTapIntent({ ...STOP, issuedAt: T0.toISOString() })).toThrow(ApiError);
  });

  it('uses a new nonce for every tap, and the database refuses a repeated one', async () => {
    const { id } = await staffWith();
    const a = await startKeyTap(deps, id, STOP);
    const b = await startKeyTap(deps, id, STOP);
    expect(a.options.challenge).not.toBe(b.options.challenge);
    const { rows } = await deps.db.query<{ nonce: Buffer }>('select nonce from key_taps where id = $1', [a.tapId]);
    await expect(
      deps.db.query(
        `insert into key_taps (account_id, intent, nonce, started_at) values ($1, $2, $3, $4)`,
        [id, canonicalJson(STOP), rows[0]!.nonce, T0],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses an account with no attested security key', async () => {
    const id = await seedAccount(deps, { loginName: uniqueName('p'), kind: 'staff' });
    await addKey(id, { passkey: true });
    await expect(startKeyTap(deps, id, STOP)).rejects.toMatchObject({ status: 403, code: 'method-not-allowed' });
  });

  it("does not offer a key whose AAGUID is no longer on the account kind's list", async () => {
    // An owner key that is attested for staff but not for the owner (stored attested, then moved off the list).
    const id = await seedAccount(deps, { loginName: uniqueName('o'), kind: 'owner' });
    const key = await addKey(id, { aaguid: ALLOWED });
    await deps.db.query('update webauthn_credentials set aaguid = $2 where account_id = $1', [id, STAFF_ONLY]);
    await expect(startKeyTap(deps, id, STOP)).rejects.toMatchObject({ code: 'method-not-allowed' });
    await deps.db.query('update webauthn_credentials set aaguid = $2 where account_id = $1', [id, ALLOWED]);
    const tapId = await tapped(id, key, STOP);
    expect((await consume(tapId, id, STOP)).accountId).toBe(id);
  });

  it('refuses a malformed intent', () => {
    expect(() => parseKeyTapIntent({ kind: 'emergency-stop', extra: 1 })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ kind: 'nope' })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ ...RULING, outcome: 'pay-me' })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ ...RULING, round: 3 })).toThrow(ApiError);
    // mod-gate review B2: a round-2 ruling names the round-1 ruling it reviews; round 1 names none.
    const R1 = '0d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d';
    expect(() => parseKeyTapIntent({ ...RULING, round: 2 })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ ...RULING, round1Id: R1 })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ ...RULING, round: 2, round1Id: 'x' })).toThrow(ApiError);
    const { round1Id: _drop, ...noKey } = RULING as Extract<KeyTapIntent, { kind: 'ruling' }>;
    expect(() => parseKeyTapIntent(noKey)).toThrow(ApiError);
    expect(parseKeyTapIntent({ ...RULING, round: 2, round1Id: R1.toUpperCase() })).toMatchObject({ round: 2, round1Id: R1 });
    expect(() => parseKeyTapIntent({ ...RULING, code: 'not a code' })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ ...RULING, accountAction: { kind: 'site-ban', until: null } })).toThrow(ApiError);
    // D-015 (owner 2026-11-02 08:12): a freeze is a separate later act, never on the ruling card.
    expect(() => parseKeyTapIntent({ ...RULING, accountAction: { kind: 'freeze' } })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ kind: 'set-role', accountId: RULING.rulingId, role: 'owner' })).toThrow(ApiError);
    expect(parseKeyTapIntent(RULING)).toEqual(RULING);
    expect(parseKeyTapIntent({ ...RULING, code: 'abcdefghjkmnpqrs' })).toEqual(RULING);
  });

  it('Task 26: an account-limit decision names exactly one of a whole-dollar cap and a stage; only a decider may tap it', () => {
    const rec = '0d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d';
    const acct = '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';
    const ok = { kind: 'account-limit', recId: rec.toUpperCase(), accountId: acct, approve: true, capUsd: 300, stage: null };
    expect(parseKeyTapIntent(ok)).toEqual({ ...ok, recId: rec });
    expect(parseKeyTapIntent({ ...ok, capUsd: null, stage: 'building' })).toMatchObject({ capUsd: null, stage: 'building' });
    for (const bad of [
      { ...ok, capUsd: null },
      { ...ok, stage: 'starter' },
      { ...ok, capUsd: 1.5 },
      { ...ok, capUsd: null, stage: 'graduated' },
      { ...ok, approve: 'yes' },
      { ...ok, recId: 'x' },
      { ...ok, extra: 1 },
    ]) expect(() => parseKeyTapIntent(bad), JSON.stringify(bad)).toThrow(ApiError);
    expect(tapPermOf(parseKeyTapIntent(ok))).toBe('rulings.approve');
  });
});

describe('finishKeyTap and consumeKeyTap', () => {
  it('a tap for emergency-stop consumes once; the second consume gets tap-invalid', async () => {
    const { id, key } = await staffWith();
    const tapId = await tapped(id, key, STOP);
    const stored = await consume(tapId, id, STOP);
    expect(stored).toMatchObject({ id: tapId, accountId: id, credentialId: key.credentialId, intent: canonicalJson({ ...STOP, issuedAt: T0.toISOString() } as KeyTapIntent) });
    expect(stored.nonceHex).toMatch(/^[0-9a-f]{32}$/);
    // Exactly what the moderation process re-verifies: the stored response answers the stored challenge.
    const challenge = Buffer.from(tapChallenge(JSON.parse(stored.intent) as KeyTapIntent, Buffer.from(stored.nonceHex, 'hex')));
    const clientData = JSON.parse(Buffer.from(stored.response.response.clientDataJSON, 'base64url').toString()) as { challenge: string };
    expect(clientData.challenge).toBe(challenge.toString('base64url'));
    await expect(consume(tapId, id, STOP)).rejects.toMatchObject(tapInvalid);
  });

  it('a rolled-back consume leaves the tap unused', async () => {
    const { id, key } = await staffWith();
    const tapId = await tapped(id, key, STOP);
    await consume(tapId, id, STOP, { rollback: true });
    expect((await consume(tapId, id, STOP)).id).toBe(tapId);
  });

  it('a tap for emergency-stop used with expect = resume-trading gets tap-invalid', async () => {
    const { id, key } = await staffWith();
    const tapId = await tapped(id, key, STOP);
    await expect(consume(tapId, id, RESUME)).rejects.toMatchObject(tapInvalid);
    // A refused consume does not use the tap up.
    expect((await consume(tapId, id, STOP)).id).toBe(tapId);
  });

  it('a tap whose ruling intent differs only in outcome gets tap-invalid', async () => {
    const { id, key } = await staffWith();
    const tapId = await tapped(id, key, RULING);
    await expect(consume(tapId, id, { ...RULING, outcome: 'refund-to-seller' })).rejects.toMatchObject(tapInvalid);
    // The same ruling with its keys in another order and the code typed without dashes matches.
    const { reasonSha256, kind, ...rest } = RULING as Extract<KeyTapIntent, { kind: 'ruling' }>;
    const reordered: KeyTapIntent = { reasonSha256, ...rest, kind, code: 'abcdefghjkmnpqrs' };
    expect(Object.keys(reordered)[0]).toBe('reasonSha256');
    expect((await consume(tapId, id, reordered)).id).toBe(tapId);
  });

  it("another account's tap gets tap-invalid, at finish and at consume", async () => {
    const a = await staffWith();
    const b = await staffWith();
    const tapId = await tapped(a.id, a.key, STOP);
    await expect(consume(tapId, b.id, STOP)).rejects.toMatchObject(tapInvalid);
    const started = await startKeyTap(deps, a.id, STOP);
    await expect(finishKeyTap(deps, b.id, started.tapId, b.key.authenticate(started.options, ORIGIN))).rejects.toMatchObject(tapInvalid);
    // B's own key answering A's challenge, sent as A: not A's credential.
    await expect(finishKeyTap(deps, a.id, started.tapId, b.key.authenticate(started.options, ORIGIN))).rejects.toMatchObject({
      code: 'webauthn-failed',
    });
  });

  it('a tap after 2 minutes gets tap-invalid', async () => {
    const { id, key } = await staffWith();
    // Finished in time, consumed at exactly 2:00 after the start.
    const late = await tapped(id, key, STOP);
    setNow(new Date(T0.getTime() + KEY_TAP_TTL_MS));
    await expect(consume(late, id, STOP)).rejects.toMatchObject(tapInvalid);
    setNow(T0);
    // Finished at exactly 2:00.
    const started = await startKeyTap(deps, id, STOP);
    setNow(new Date(T0.getTime() + KEY_TAP_TTL_MS));
    await expect(finishKeyTap(deps, id, started.tapId, key.authenticate(started.options, ORIGIN))).rejects.toMatchObject(tapInvalid);
    setNow(T0);
    // At 1:59.999 both still work.
    const ok = await startKeyTap(deps, id, STOP);
    setNow(new Date(T0.getTime() + KEY_TAP_TTL_MS - 1));
    await finishKeyTap(deps, id, ok.tapId, key.authenticate(ok.options, ORIGIN));
    expect((await consume(ok.tapId, id, STOP)).id).toBe(ok.tapId);
    setNow(T0);
  });

  it('a passkey (non-attested) credential is not offered and its assertion fails', async () => {
    const { id } = await staffWith();
    const passkey = await addKey(id, { passkey: true });
    const { tapId, options } = await startKeyTap(deps, id, STOP);
    // Answer with the passkey anyway, as if the browser had offered it.
    const forged = passkey.authenticate({ ...options, allowCredentials: [{ id: passkey.credentialId, type: 'public-key' }] }, ORIGIN);
    await expect(finishKeyTap(deps, id, tapId, forged)).rejects.toMatchObject({ status: 401, code: 'webauthn-failed' });
    await expect(consume(tapId, id, STOP)).rejects.toMatchObject(tapInvalid);
  });

  it('an unfinished tap cannot be consumed, a finished one cannot be finished again, and a bad id is tap-invalid', async () => {
    const { id, key } = await staffWith();
    const { tapId, options } = await startKeyTap(deps, id, STOP);
    await expect(consume(tapId, id, STOP)).rejects.toMatchObject(tapInvalid);
    await finishKeyTap(deps, id, tapId, key.authenticate(options, ORIGIN));
    await expect(finishKeyTap(deps, id, tapId, key.authenticate(options, ORIGIN))).rejects.toMatchObject(tapInvalid);
    await expect(consume('not-a-uuid', id, STOP)).rejects.toMatchObject(tapInvalid);
    await expect(consume('00000000-0000-4000-8000-000000000000', id, STOP)).rejects.toMatchObject(tapInvalid);
  });

  it('a wrong assertion (another challenge) fails and leaves the tap open', async () => {
    const { id, key } = await staffWith();
    const a = await startKeyTap(deps, id, STOP);
    const b = await startKeyTap(deps, id, RESUME);
    await expect(finishKeyTap(deps, id, a.tapId, key.authenticate(b.options, ORIGIN))).rejects.toMatchObject({ code: 'webauthn-failed' });
    await finishKeyTap(deps, id, a.tapId, key.authenticate(a.options, ORIGIN));
    expect((await consume(a.tapId, id, STOP)).id).toBe(a.tapId);
  });

  it('two parallel consumes of one tap: exactly one wins', async () => {
    const { id, key } = await staffWith();
    const tapId = await tapped(id, key, STOP);
    const results = await Promise.allSettled([consume(tapId, id, STOP), consume(tapId, id, STOP)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

// RV5 Task 5 minors (6 Nov): m8 purge, m9 the key must still be registered at consume, m10 a tap
// bound to its session, m11 a NUL in the response, m12 a cap on open taps.
describe('RV5 Task 5 minors', () => {
  it('m9: a key removed after the finish no longer authorises the action', async () => {
    const { id, key } = await staffWith();
    const tapId = await tapped(id, key, STOP);
    await deps.db.query('delete from webauthn_credentials where account_id = $1', [id]);
    await expect(consume(tapId, id, STOP)).rejects.toMatchObject(tapInvalid);
  });

  it('m10: a tap started in a session is consumed only with that session', async () => {
    const { id, key } = await staffWith();
    const session = randomUUID();
    const { tapId, options } = await startKeyTap(deps, id, STOP, { sessionId: session });
    await finishKeyTap(deps, id, tapId, key.authenticate(options, ORIGIN));
    const withSession = async (sessionId?: string) => {
      const client = await deps.db.connect();
      try {
        await client.query('begin');
        const tap = await consumeKeyTap(client, tapId, id, STOP, deps.clock(), sessionId !== undefined ? { sessionId } : {});
        await client.query('commit');
        return tap;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    };
    await expect(withSession()).rejects.toMatchObject(tapInvalid);
    await expect(withSession(randomUUID())).rejects.toMatchObject(tapInvalid);
    await expect(withSession('not-a-uuid')).rejects.toMatchObject(tapInvalid);
    expect((await withSession(session)).id).toBe(tapId);
    // A tap started with no session (a route without sessionOf) is bound to the account only.
    const plain = await tapped(id, key, STOP);
    expect((await consume(plain, id, STOP)).id).toBe(plain);
  });

  it('m11: a NUL anywhere in the response is a 400 before the assertion is checked', async () => {
    const { id, key } = await staffWith();
    const { tapId, options } = await startKeyTap(deps, id, STOP);
    const answer = key.authenticate(options, ORIGIN) as unknown as Record<string, unknown>;
    await expect(finishKeyTap(deps, id, tapId, { ...answer, extra: 'a\u0000b' })).rejects.toMatchObject({ status: 400, code: 'bad-request' });
    // The tap is still open, and the clean answer finishes it.
    await finishKeyTap(deps, id, tapId, answer);
    expect((await consume(tapId, id, STOP)).id).toBe(tapId);
  });

  it('m12: at most 5 open taps per account; a finished or expired tap frees a place', async () => {
    const { id, key } = await staffWith();
    const started = [];
    for (let i = 0; i < MAX_OPEN_TAPS; i++) started.push(await startKeyTap(deps, id, RULING));
    await expect(startKeyTap(deps, id, RULING)).rejects.toMatchObject({ status: 429, code: 'slow-down' });
    // Another account is not affected.
    const other = await staffWith();
    await startKeyTap(deps, other.id, RULING);
    await finishKeyTap(deps, id, started[0]!.tapId, key.authenticate(started[0]!.options, ORIGIN));
    await startKeyTap(deps, id, RULING);
    await expect(startKeyTap(deps, id, RULING)).rejects.toMatchObject({ status: 429 });
    setNow(new Date(deps.clock().getTime() + KEY_TAP_TTL_MS));
    try {
      await startKeyTap(deps, id, RULING);
    } finally {
      setNow(T0);
    }
  });

  it('m11 (lead re-review item 5): only the assertion fields verification read are stored', async () => {
    const { id, key } = await staffWith();
    const { tapId, options } = await startKeyTap(deps, id, STOP);
    const answer = key.authenticate(options, ORIGIN) as unknown as Record<string, unknown>;
    await finishKeyTap(deps, id, tapId, { ...answer, extra: 'x'.repeat(50), response: { ...(answer.response as object), more: 'y' } });
    const { rows } = await deps.db.query<{ response: Record<string, unknown> }>('select response from key_taps where id = $1', [tapId]);
    expect(Object.keys(rows[0]!.response).sort()).toEqual(['clientExtensionResults', 'id', 'rawId', 'response', 'type']);
    expect(Object.keys(rows[0]!.response.response as object).sort()).toEqual(
      expect.arrayContaining(['authenticatorData', 'clientDataJSON', 'signature']),
    );
    expect(JSON.stringify(rows[0]!.response)).not.toMatch(/extra|more/);
  });

  it('m12 (lead re-review item 5): a full cap never blocks the emergency stop or the resume', async () => {
    const { id } = await staffWith();
    for (let i = 0; i < MAX_OPEN_TAPS; i++) await startKeyTap(deps, id, RULING);
    await expect(startKeyTap(deps, id, RULING)).rejects.toMatchObject({ status: 429 });
    await startKeyTap(deps, id, STOP);
    await startKeyTap(deps, id, { kind: 'resume-trading' });
  });

  it('m8: unfinished and unused taps go a day after they start; used ones stay', async () => {
    const { id, key } = await staffWith();
    const unfinished = (await startKeyTap(deps, id, STOP)).tapId;
    const unused = await tapped(id, key, STOP);
    const used = await tapped(id, key, STOP);
    await consume(used, id, STOP);
    const left = async () => (await deps.db.query<{ id: string }>('select id from key_taps where id = any($1::uuid[])', [[unfinished, unused, used]])).rows.map((r) => r.id).sort();
    expect(await purgeKeyTaps(deps.db, new Date(T0.getTime() + KEY_TAP_PURGE_MS - 1))).toBe(0);
    expect(await left()).toEqual([unfinished, unused, used].sort());
    expect(await purgeKeyTaps(deps.db, new Date(T0.getTime() + KEY_TAP_PURGE_MS + 1))).toBeGreaterThanOrEqual(2);
    expect(await left()).toEqual([used]);
  });
});

describe('keyTapRoutes', () => {
  let app: FastifyInstance;
  const registered: Array<{ url: string; perm: unknown }> = [];

  beforeAll(async () => {
    app = Fastify();
    app.addHook('onRoute', (r) => void registered.push({ url: r.url, perm: (r.config as { perm?: unknown } | undefined)?.perm }));
    app.setErrorHandler((e, _req, reply) => {
      if (e instanceof ApiError) return reply.status(e.status).send({ error: e.code });
      return reply.status(500).send({ error: 'internal' });
    });
    app.decorate('deps', deps);
    keyTapRoutes(app, {
      // Stands in for Task 4's `requireStaff('self')`.
      guard: async (req) => {
        if (typeof req.headers['x-test-account'] !== 'string') throw new ApiError(401, 'not-authenticated');
      },
      accountOf: (req) => req.headers['x-test-account'] as string,
      // Stands in for Task 4's role check: the perms the test caller holds, comma-separated.
      allows: (req, need) => String(req.headers['x-test-perms'] ?? 'site.control').split(',').includes(need),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers start and finish with perm self', () => {
    expect(registered).toEqual([
      { url: '/staff/v1/taps/start', perm: 'self' },
      { url: '/staff/v1/taps/:id/finish', perm: 'self' },
    ]);
  });

  it('starts and finishes a tap for the session account; the action route then consumes it', async () => {
    const { id, key } = await staffWith();
    const start = await app.inject({ method: 'POST', url: '/staff/v1/taps/start', headers: { 'x-test-account': id }, payload: STOP });
    expect(start.statusCode).toBe(200);
    const { tapId, options } = start.json() as { tapId: string; options: Parameters<SoftAuthenticator['authenticate']>[0] };
    const finish = await app.inject({
      method: 'POST', url: `/staff/v1/taps/${tapId}/finish`, headers: { 'x-test-account': id },
      payload: { response: key.authenticate(options, ORIGIN) },
    });
    expect(finish.statusCode).toBe(200);
    expect(finish.json()).toEqual({ tapId });
    expect((await consume(tapId, id, STOP)).id).toBe(tapId);
  });

  it('RV5 m7: starting a tap needs the intent\'s own perm; nothing is stored when refused', async () => {
    const { id } = await staffWith();
    const count = async () => Number((await deps.db.query('select count(*) from key_taps where account_id = $1', [id])).rows[0].count);
    const refused = await app.inject({ method: 'POST', url: '/staff/v1/taps/start', headers: { 'x-test-account': id, 'x-test-perms': 'self,disputes.handle' }, payload: STOP });
    expect([refused.statusCode, refused.json()]).toEqual([403, { error: 'forbidden' }]);
    const approve = await app.inject({ method: 'POST', url: '/staff/v1/taps/start', headers: { 'x-test-account': id, 'x-test-perms': 'self,disputes.handle' }, payload: { ...RULING, step: 'approve' } });
    expect(approve.statusCode).toBe(403);
    expect(await count()).toBe(0);
    const propose = await app.inject({ method: 'POST', url: '/staff/v1/taps/start', headers: { 'x-test-account': id, 'x-test-perms': 'self,disputes.handle' }, payload: { ...RULING, step: 'propose' } });
    expect(propose.statusCode).toBe(200);
    expect(await count()).toBe(1);
    // Review mod-screens M1: a ruling intent without the evidence hash, or with a bad one, is refused.
    const { evidenceSha256: _e, ...noEvidence } = RULING as Extract<KeyTapIntent, { kind: 'ruling' }>;
    for (const payload of [noEvidence, { ...RULING, evidenceSha256: 'not-hex' }]) {
      const bad = await app.inject({ method: 'POST', url: '/staff/v1/taps/start', headers: { 'x-test-account': id, 'x-test-perms': 'self,disputes.handle' }, payload });
      expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'bad-request' }]);
    }
    expect(await count()).toBe(1);
  });

  it('RV5 m7: tapPermOf maps every intent kind to the perm its action needs', () => {
    expect(tapPermOf({ ...RULING, step: 'propose' })).toBe('disputes.handle');
    expect(tapPermOf({ ...RULING, step: 'approve' })).toBe('rulings.approve');
    expect(tapPermOf({ kind: 'emergency-stop' })).toBe('site.control');
    expect(tapPermOf({ kind: 'resume-trading' })).toBe('site.control');
    expect(tapPermOf({ kind: 'create-invite', inviteId: RULING.rulingId, role: 'mod', tokenHash: 'a'.repeat(43), expiresAt: '2026-11-03T00:00:00Z' })).toBe('staff.manage');
    expect(tapPermOf({ kind: 'switch-on', accountId: RULING.rulingId, role: 'mod' })).toBe('staff.manage');
    expect(tapPermOf({ kind: 'set-role', accountId: RULING.rulingId, role: 'senior' })).toBe('staff.manage');
    expect(tapPermOf({ kind: 'settings', largeTradeLimitUsd: 1, firstResponseH: 1, appealWindowH: 48 })).toBe('settings.write');
    expect(tapPermOf({ kind: 'add-owner-key', credentialId: 'a'.repeat(22), publicKeySha256: 'b'.repeat(64) })).toBe('owner');
  });

  it('lead review M4: 20 tap starts per account per 10 minutes, then 429; the stop is never held back', async () => {
    const { id } = await staffWith();
    const start = (payload: object) => app.inject({ method: 'POST', url: '/staff/v1/taps/start', headers: { 'x-test-account': id, 'x-test-perms': 'self,disputes.handle,site.control' }, payload });
    let refused = 0;
    for (let i = 0; i < TAP_STARTS_PER_WINDOW + 1; i++) {
      // Spread over the open-taps cap: finish nothing, so expire them by moving the clock 2 minutes.
      setNow(new Date(T0.getTime() + i * 25_000));
      const res = await start({ ...RULING, step: 'propose' });
      if (res.statusCode === 429) refused++;
    }
    expect(refused).toBeGreaterThan(0);
    expect((await start(STOP)).statusCode).toBe(200);
    setNow(T0);
  });

  it('refuses without a session, a malformed intent and an oversized response', async () => {
    expect((await app.inject({ method: 'POST', url: '/staff/v1/taps/start', payload: STOP })).statusCode).toBe(401);
    const { id } = await staffWith();
    const bad = await app.inject({
      method: 'POST', url: '/staff/v1/taps/start', headers: { 'x-test-account': id }, payload: { kind: 'emergency-stop', x: 1 },
    });
    expect(bad.statusCode).toBe(400);
    const big = await app.inject({
      method: 'POST', url: `/staff/v1/taps/${RULING.rulingId}/finish`, headers: { 'x-test-account': id },
      payload: { response: { id: 'x', pad: 'y'.repeat(20_000) } },
    });
    expect(big.statusCode).toBe(400);
  });
});
