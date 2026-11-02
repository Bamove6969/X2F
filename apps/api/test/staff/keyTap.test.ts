// Plan 4 Task 5: security-key taps bound to one intent (start, finish, consume in the caller's
// transaction), with the soft authenticator of Plan 2 Task 7 attested as an allowlisted AAGUID.
import { randomBytes } from 'node:crypto';
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
    expect(rows[0]!.intent).toBe(canonicalJson(STOP));
    expect(options.challenge).toBe(Buffer.from(tapChallenge(STOP, rows[0]!.nonce)).toString('base64url'));
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
    expect(() => parseKeyTapIntent({ ...RULING, code: 'not a code' })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ ...RULING, accountAction: { kind: 'site-ban', until: null } })).toThrow(ApiError);
    expect(() => parseKeyTapIntent({ kind: 'set-role', accountId: RULING.rulingId, role: 'owner' })).toThrow(ApiError);
    expect(parseKeyTapIntent(RULING)).toEqual(RULING);
    expect(parseKeyTapIntent({ ...RULING, code: 'abcdefghjkmnpqrs' })).toEqual(RULING);
  });
});

describe('finishKeyTap and consumeKeyTap', () => {
  it('a tap for emergency-stop consumes once; the second consume gets tap-invalid', async () => {
    const { id, key } = await staffWith();
    const tapId = await tapped(id, key, STOP);
    const stored = await consume(tapId, id, STOP);
    expect(stored).toMatchObject({ id: tapId, accountId: id, credentialId: key.credentialId, intent: canonicalJson(STOP) });
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
    const reordered = { reasonSha256: RULING.reasonSha256, ...RULING, code: 'abcdefghjkmnpqrs' } as KeyTapIntent;
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
    await keyTapRoutes(app, deps, {
      // Stands in for Task 4's `requireStaff('self')`.
      guard: async (req) => {
        if (typeof req.headers['x-test-account'] !== 'string') throw new ApiError(401, 'not-authenticated');
      },
      accountOf: (req) => req.headers['x-test-account'] as string,
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
