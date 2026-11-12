// Plan 4 Task 13: the ruling gate. The moderation process accepts a ruling only when its whole
// signature chain checks out, rooted in the owner's keys pinned outside the API's database, and
// co-signs only what the ruling says, to the addresses it recorded itself. Pure tests on software
// authenticators (real WebAuthn signatures and packed attestation), plus the API schema's reader.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTradeCode } from '@x2f/core';
import { canonicalJson, evidenceSha256, inviteRegistrationChallenge, staffLoginChallenge, keyCheckCode, tapChallenge, type AccountAction, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';
import { escrowPlan } from '@x2f/trade';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createSoftAuthenticator, createTestCa, type SoftAuthenticator, type TestCa } from '../../api/test/helpers/softAuthenticator.js';
import {
  authorizeRuling,
  emptyGate,
  initGate,
  gateCheck,
  openGateStore,
  pgGateSource,
  pinOwner,
  recordedTerms,
  syncRegistry,
  type GateContext,
  type GateRuling,
  type GateSource,
  type GateState,
  type RecordedTerms,
  type StoredTap,
} from '../src/gate/index.js';

const ORIGIN = 'https://staff.x2f.test';
const RP_ID = 'staff.x2f.test';
const AAGUID = '11111111-2222-4333-8444-555555555555';
const OTHER_AAGUID = '99999999-2222-4333-8444-555555555555';
const NOW = new Date('2026-11-12T12:00:00Z');
const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const sha256Hex = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

let ca: TestCa;
beforeAll(() => {
  ca = createTestCa();
});

const ctx = (): GateContext => ({
  rp: { origins: [ORIGIN], rpId: RP_ID },
  attestation: { isAllowed: (aaguid, kind) => aaguid === AAGUID && (kind === 'staff' || kind === 'owner') },
  now: () => NOW,
  log: () => {},
});

const newKey = (o: { attest?: 'x5c' | 'self' | 'none'; aaguid?: string } = {}): SoftAuthenticator =>
  createSoftAuthenticator({
    backedUp: false,
    userVerified: true,
    attestation:
      o.attest === 'none' ? 'none' : o.attest === 'self' ? { aaguid: o.aaguid ?? AAGUID, self: true } : { aaguid: o.aaguid ?? AAGUID, ca },
  });

interface Person {
  id: string;
  key: SoftAuthenticator;
  role: 'owner' | 'senior' | 'mod' | 'helper';
}

/** The API's database as the gate reads it, in memory: everything here is what a compromised API could write. */
class FakeApi implements GateSource {
  owner: { accountId: string; keys: Array<{ credentialId: string; publicKey: Uint8Array; aaguid: string | null }> } | null = null;
  taps: StoredTap[] = [];
  creds = new Map<string, { accountId: string; publicKey: Uint8Array; aaguid: string | null }>();
  invites = new Map<string, { inviteId: string; tokenHash: string; accountId: string | null; registrations: Array<{ credentialId: string; response: unknown }> }>();
  staffRows = new Map<string, { accountId: string; role: string; switchedOff: boolean; removed: boolean }>();

  async ownerKeys() {
    return this.owner;
  }
  async usedTaps(kinds: readonly string[]) {
    return this.taps.filter((t) => kinds.includes((JSON.parse(t.intent) as { kind: string }).kind));
  }
  async credential(credentialId: string) {
    return this.creds.get(credentialId) ?? null;
  }
  async invite(inviteId: string) {
    return this.invites.get(inviteId) ?? null;
  }
  async staff() {
    return [...this.staffRows.values()];
  }
  async rulingTaps(rulingId: string) {
    return this.taps.filter((t) => {
      const i = JSON.parse(t.intent) as { kind: string; rulingId?: string };
      return i.kind === 'ruling' && i.rulingId === rulingId;
    });
  }
}

/** A tap as the API stores it: the person's key answered `tapChallenge(intent, nonce)` on the staff origin. */
/** The registry kinds the API stamps with its start time (lead P4 call); tests stamp them too, at NOW unless told. */
const STAMPED: readonly string[] = ['create-invite', 'set-role', 'switch-on', 'settings', 'add-owner-key', 'remove-staff', 'emergency-stop', 'resume-trading'];
function tapBy(p: Person, intent: KeyTapIntent, o: { key?: SoftAuthenticator; issuedAt?: Date | null } = {}): StoredTap {
  const key = o.key ?? p.key;
  const nonce = randomBytes(16);
  const norm = (STAMPED.includes(intent.kind) && o.issuedAt !== null && !('issuedAt' in intent) ? { ...intent, issuedAt: (o.issuedAt ?? NOW).toISOString() } : intent) as KeyTapIntent;
  // `issuedAt: null`: a tap as an older API stored it, signed over the same challenge formula
  // without the field (which `tapChallenge` itself now refuses to build).
  const challenge = o.issuedAt === null && STAMPED.includes(intent.kind)
    ? createHash('sha256').update(`x2f-keytap-v1\n${canonicalJson(norm)}\n${nonce.toString('hex')}`).digest()
    : tapChallenge(norm, nonce);
  const response = key.authenticate({ challenge: b64url(challenge), rpId: RP_ID, allowCredentials: [] }, ORIGIN);
  return { id: randomUUID(), accountId: p.id, credentialId: key.credentialId, intent: canonicalJson(norm), nonceHex: nonce.toString('hex'), response };
}

interface World {
  api: FakeApi;
  gate: GateState;
  owner: Person;
  ownerKey2: SoftAuthenticator;
  /** Invites a staff member the proper way: an owner `create-invite` tap and an attested registration. */
  hire(role: 'senior' | 'mod' | 'helper', o?: { attest?: 'x5c' | 'self' | 'none'; aaguid?: string; noTap?: boolean; wrongToken?: boolean }): Person;
}

async function world(): Promise<World> {
  const api = new FakeApi();
  const owner: Person = { id: randomUUID(), key: newKey(), role: 'owner' };
  const ownerKey2 = newKey();
  api.owner = {
    accountId: owner.id,
    keys: [owner.key, ownerKey2].map((k) => ({ credentialId: k.credentialId, publicKey: new Uint8Array(k.cosePublicKey), aaguid: AAGUID })),
  };
  const gate = emptyGate();
  const pinned = await pinOwner({ source: api, gate, print: () => {}, confirm: async () => 'yes' });
  expect(pinned).toBe('pinned');
  const hire: World['hire'] = (role, o = {}) => {
    const p: Person = { id: randomUUID(), key: newKey(o), role };
    const inviteId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(token);
    const intent: KeyTapIntent = { kind: 'create-invite', inviteId, role, tokenHash, expiresAt: '2026-11-13T12:00:00.000Z' };
    if (!o.noTap) api.taps.push(tapBy(owner, intent));
    const challengeHash = o.wrongToken ? sha256Hex('another token') : tokenHash;
    const response = p.key.register(
      {
        challenge: b64url(inviteRegistrationChallenge(challengeHash)),
        rp: { id: RP_ID, name: 'X2F Staff' },
        user: { id: b64url(randomBytes(16)), name: 'x', displayName: 'x' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        attestation: 'direct',
      },
      ORIGIN,
    );
    api.invites.set(inviteId, { inviteId, tokenHash, accountId: p.id, registrations: [{ credentialId: p.key.credentialId, response }] });
    api.creds.set(p.key.credentialId, { accountId: p.id, publicKey: new Uint8Array(p.key.cosePublicKey), aaguid: o.aaguid ?? AAGUID });
    api.staffRows.set(p.id, { accountId: p.id, role, switchedOff: false, removed: false });
    return p;
  };
  return { api, gate, owner, ownerKey2, hire };
}

/** A new gate the way an operator makes one: init-gate with "yes", then open it. */
async function freshGate(dir: string, key: Uint8Array) {
  expect(await initGate({ dir, keystoreKey: key, print: () => {}, confirm: async () => 'yes' })).toBe('created');
  return openGateStore(dir, key);
}

const BUYER = '4'.padEnd(95, 'B');
const SELLER = '8'.padEnd(95, 'S');
const FEE = '5'.repeat(95);
const AMOUNT = 250_000_000_000n;

function recorded(usdCents: bigint | null): RecordedTerms {
  const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
  return { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller', buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, usdCents };
}
const BALANCE = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' }).sellerFundsAtomic;
const NONE: AccountAction = { kind: 'none' };
const REASON = 'The buyer showed a bank statement with the payment and the seller did not answer.';
const EVIDENCE = ['Bank statement, 11 Nov', 'No reply from the seller for 30 hours'];

interface Case {
  ruling: GateRuling;
  intent(step: 'propose' | 'approve', over?: Partial<Extract<KeyTapIntent, { kind: 'ruling' }>>): KeyTapIntent;
}

function ruling(proposer: Person, o: { approver?: Person | null; outcome?: RulingOutcome; round?: 1 | 2; round1Id?: string; code?: string } = {}): Case {
  const r: GateRuling = {
    id: randomUUID(),
    code: o.code ?? newTradeCode(),
    round: o.round ?? 1,
    outcome: o.outcome ?? 'release-to-buyer',
    accountAction: NONE,
    proposer: proposer.id,
    approver: o.approver?.id ?? null,
    reasonSha256: sha256Hex(REASON),
    evidenceSha256: evidenceSha256(EVIDENCE),
    ...(o.round1Id ? { round1Id: o.round1Id } : {}),
  };
  return {
    ruling: r,
    intent: (step, over = {}) => ({
      kind: 'ruling', step, rulingId: r.id, code: r.code, round: r.round, outcome: r.outcome, accountAction: r.accountAction,
      amountAtomic: AMOUNT.toString(), reasonSha256: r.reasonSha256, evidenceSha256: r.evidenceSha256, round1Id: r.round === 2 ? (r.round1Id ?? null) : null, ...over,
    }),
  };
}

const authorize = (w: World, c: Case, taps: StoredTap[], usdCents: bigint | null = 41_250n, extra: { involved?: string[] } = {}) =>
  authorizeRuling(w.gate, { ruling: c.ruling, taps, recorded: recorded(usdCents), balanceAtomic: BALANCE, ...extra }, ctx());

describe('the chain of trust (syncRegistry)', () => {
  it('accepts a staff key only through an owner create-invite tap and an attested registration for that token', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const noTap = w.hire('mod', { noTap: true });
    const selfAttested = w.hire('mod', { attest: 'self' });
    const unattested = w.hire('mod', { attest: 'none' });
    const offList = w.hire('mod', { aaguid: OTHER_AAGUID });
    const wrongToken = w.hire('mod', { wrongToken: true });
    // A key the API added to the credentials table on its own, under an existing mod's account.
    const planted = newKey();
    w.api.creds.set(planted.credentialId, { accountId: mod.id, publicKey: new Uint8Array(planted.cosePublicKey), aaguid: AAGUID });
    await syncRegistry(w.api, w.gate, ctx());

    expect(Object.keys(w.gate.staff)).toEqual([mod.id]);
    expect(w.gate.staff[mod.id]!.role).toBe('mod');
    for (const p of [noTap, selfAttested, unattested, offList, wrongToken]) {
      const c = ruling(p);
      expect(await authorize(w, c, [tapBy(p, c.intent('propose'))])).toEqual({ ok: false, reason: 'unknown-key' });
    }
    const c = ruling(mod);
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose'), { key: planted })])).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('a key registered before the invite is finished signs nothing until the staff row is there, and is not revoked by the wait', async () => {
    const w = await world();
    const mod = w.hire('mod');
    w.api.staffRows.delete(mod.id); // the invitee registered a key but has not pressed finish yet
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    const t = tapBy(mod, c.intent('propose'));
    expect(await authorize(w, c, [t])).toEqual({ ok: false, reason: 'revoked' });
    w.api.staffRows.set(mod.id, { accountId: mod.id, role: 'mod', switchedOff: false, removed: false });
    await syncRegistry(w.api, w.gate, ctx());
    expect((await authorize(w, c, [t])).ok).toBe(true);
    // Gone from the API after joining: revoked.
    w.api.staffRows.delete(mod.id);
    await syncRegistry(w.api, w.gate, ctx());
    expect(await authorize(w, c, [t])).toEqual({ ok: false, reason: 'revoked' });
  });

  it('a create-invite tap made by a staff member, not the owner, invites nobody', async () => {
    const w = await world();
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const p: Person = { id: randomUUID(), key: newKey(), role: 'mod' };
    const tokenHash = sha256Hex('t');
    const inviteId = randomUUID();
    w.api.taps.push(tapBy(senior, { kind: 'create-invite', inviteId, role: 'mod', tokenHash, expiresAt: '2026-11-13T12:00:00.000Z' }));
    const response = p.key.register(
      { challenge: b64url(inviteRegistrationChallenge(tokenHash)), rp: { id: RP_ID, name: 'X2F' }, user: { id: 'AAAA', name: 'x', displayName: 'x' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] },
      ORIGIN,
    );
    w.api.invites.set(inviteId, { inviteId, tokenHash, accountId: p.id, registrations: [{ credentialId: p.key.credentialId, response }] });
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[p.id]).toBeUndefined();
  });

  it('role changes need an owner tap; the role in the database alone changes nothing', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    w.api.staffRows.get(mod.id)!.role = 'senior';
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[mod.id]!.role).toBe('mod');
    // A senior's set-role tap is not the owner's.
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    w.api.taps.push(tapBy(senior, { kind: 'set-role', accountId: mod.id, role: 'senior' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[mod.id]!.role).toBe('mod');
    w.api.taps.push(tapBy(w.owner, { kind: 'set-role', accountId: mod.id, role: 'senior' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[mod.id]!.role).toBe('senior');
    // Demoted again: an old promotion tap the gate has already seen never promotes again.
    w.api.taps.push(tapBy(w.owner, { kind: 'set-role', accountId: mod.id, role: 'mod' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[mod.id]!.role).toBe('mod');
    w.api.taps.reverse(); // the API serves its taps in any order it likes
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[mod.id]!.role).toBe('mod');
  });

  it('a switch-off revokes without a signature; only a new owner switch-on tap restores', async () => {
    const w = await world();
    const mod = w.hire('mod');
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' })); // an earlier switch-on
    await syncRegistry(w.api, w.gate, ctx());
    w.api.staffRows.get(mod.id)!.switchedOff = true;
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    const t = tapBy(mod, c.intent('propose'));
    expect(await authorize(w, c, [t])).toEqual({ ok: false, reason: 'revoked' });
    // The API shows the mod switched on again, with no new tap: still revoked (the old tap is spent).
    w.api.staffRows.get(mod.id)!.switchedOff = false;
    await syncRegistry(w.api, w.gate, ctx());
    expect(await authorize(w, c, [t])).toEqual({ ok: false, reason: 'revoked' });
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect((await authorize(w, c, [t])).ok).toBe(true);
    // Removed for good: no switch-on tap brings them back.
    w.api.staffRows.get(mod.id)!.removed = true;
    w.api.staffRows.get(mod.id)!.switchedOff = true;
    await syncRegistry(w.api, w.gate, ctx());
    w.api.staffRows.get(mod.id)!.removed = false;
    w.api.staffRows.get(mod.id)!.switchedOff = false;
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }));
    await syncRegistry(w.api, w.gate, ctx());
    const c2 = ruling(mod);
    expect(await authorize(w, c2, [tapBy(mod, c2.intent('propose'))])).toEqual({ ok: false, reason: 'revoked' });
  });

  it('the large-trade limit comes only from an owner settings tap; the settings row is never read', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.limitUsdCents).toBe(100_000n);
    w.api.taps.push(tapBy(senior, { kind: 'settings', largeTradeLimitUsd: 5000, firstResponseH: 4, appealWindowH: 48 }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.limitUsdCents).toBe(100_000n);
    const c = ruling(mod);
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose'))], 200_000n)).toEqual({ ok: false, reason: 'needs-second' });
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 5000, firstResponseH: 4, appealWindowH: 72 }));
    await syncRegistry(w.api, w.gate, ctx());
    expect({ limit: w.gate.limitUsdCents, window: w.gate.appealWindowH }).toEqual({ limit: 500_000n, window: 72 });
    expect((await authorize(w, c, [tapBy(mod, c.intent('propose'))], 200_000n)).ok).toBe(true);
  });

  it('a new owner key needs taps by both pinned owner keys for it', async () => {
    const w = await world();
    const third = newKey();
    w.api.creds.set(third.credentialId, { accountId: w.owner.id, publicKey: new Uint8Array(third.cosePublicKey), aaguid: AAGUID });
    const intent: KeyTapIntent = { kind: 'add-owner-key', credentialId: third.credentialId, publicKeySha256: sha256Hex(third.cosePublicKey) };
    w.api.taps.push(tapBy(w.owner, intent));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.ownerCreds).toHaveLength(2);
    // A second tap by the same key does not count as the other key's.
    w.api.taps.push(tapBy(w.owner, intent));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.ownerCreds).toHaveLength(2);
    w.api.taps.push(tapBy(w.owner, intent, { key: w.ownerKey2 }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.ownerCreds.map((c) => c.credentialId)).toContain(third.credentialId);
    // A credential row whose public key is not the one tapped for is never pinned.
    const fourth = newKey();
    const decoy = newKey();
    w.api.creds.set(fourth.credentialId, { accountId: w.owner.id, publicKey: new Uint8Array(decoy.cosePublicKey), aaguid: AAGUID });
    const bad: KeyTapIntent = { kind: 'add-owner-key', credentialId: fourth.credentialId, publicKeySha256: sha256Hex(fourth.cosePublicKey) };
    w.api.taps.push(tapBy(w.owner, bad), tapBy(w.owner, bad, { key: w.ownerKey2 }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.ownerCreds.map((c) => c.credentialId)).not.toContain(fourth.credentialId);
  });
});

describe('authorizeRuling', () => {
  it('below the limit, one registered moderator tap authorises it; the payouts are its own, to the recorded addresses', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    const r = await authorize(w, c, [tapBy(mod, c.intent('propose'))]);
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
    expect(r).toEqual({
      ok: true,
      settle: { winner: 'buyer', payouts: [{ address: BUYER, amountAtomic: AMOUNT }, { address: FEE, amountAtomic: plan.feeAtomic }] },
    });
    const s = ruling(mod, { outcome: 'refund-to-seller' });
    expect(await authorize(w, s, [tapBy(mod, s.intent('propose'))])).toEqual({
      ok: true,
      settle: { winner: 'seller', payouts: [{ address: SELLER, amountAtomic: BALANCE }] },
    });
  });

  it('at the limit: one tap needs a second; the same person twice, or a moderator approving, is refused; the owner approves', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const mod2 = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const at = 100_000n;
    const one = ruling(mod);
    expect(await authorize(w, one, [tapBy(mod, one.intent('propose'))], at)).toEqual({ ok: false, reason: 'needs-second' });
    const same = ruling(senior, { approver: senior });
    expect(await authorize(w, same, [tapBy(senior, same.intent('propose')), tapBy(senior, same.intent('approve'))], at)).toEqual({ ok: false, reason: 'same-person' });
    const byMod = ruling(mod, { approver: mod2 });
    expect(await authorize(w, byMod, [tapBy(mod, byMod.intent('propose')), tapBy(mod2, byMod.intent('approve'))], at)).toEqual({ ok: false, reason: 'approver-role' });
    const byOwner = ruling(mod, { approver: w.owner });
    expect((await authorize(w, byOwner, [tapBy(mod, byOwner.intent('propose')), tapBy(w.owner, byOwner.intent('approve'))], at)).ok).toBe(true);
    const bySenior = ruling(mod, { approver: senior });
    expect((await authorize(w, bySenior, [tapBy(mod, bySenior.intent('propose')), tapBy(senior, bySenior.intent('approve'))], at)).ok).toBe(true);
  });

  it('decides "needs second" from its own recorded value: a database 99,999 for a trade recorded at 100,000 still needs it', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    // The ruling row the API stored says it needed no second approval (and the API's usd_cents
    // said 99,999): the gate reads neither.
    const c = ruling(mod);
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose'))], 100_000n)).toEqual({ ok: false, reason: 'needs-second' });
    expect((await authorize(w, c, [tapBy(mod, c.intent('propose'))], 99_999n)).ok).toBe(true);
    // A value it could not record itself (a trade not priced in US dollars) always needs a second person.
    const n = ruling(mod);
    expect(await authorize(w, n, [tapBy(mod, n.intent('propose'))], null)).toEqual({ ok: false, reason: 'needs-second' });
    // So does any account action, whatever the value.
    const f = ruling(mod);
    f.ruling.accountAction = { kind: 'trade-ban', until: null, reasonCode: 'terms' };
    expect(await authorize(w, f, [tapBy(mod, f.intent('propose', { accountAction: { kind: 'trade-ban', until: null, reasonCode: 'terms' } }))], 1_000n)).toEqual({ ok: false, reason: 'needs-second' });
  });

  it('a helper cannot propose', async () => {
    const w = await world();
    const helper = w.hire('helper');
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(helper);
    expect(await authorize(w, c, [tapBy(helper, c.intent('propose'))])).toEqual({ ok: false, reason: 'proposer-role' });
  });

  it('the taps must agree with the ruling the API stored and the amount recorded here', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const other = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    const t = tapBy(mod, c.intent('propose'));
    // The database row changed to refund-to-seller after the taps.
    expect(await authorize(w, { ...c, ruling: { ...c.ruling, outcome: 'refund-to-seller' } }, [t])).toEqual({ ok: false, reason: 'intent-mismatch' });
    expect(await authorize(w, { ...c, ruling: { ...c.ruling, code: newTradeCode() } }, [t])).toEqual({ ok: false, reason: 'intent-mismatch' });
    expect(await authorize(w, { ...c, ruling: { ...c.ruling, reasonSha256: sha256Hex('another reason') } }, [t])).toEqual({ ok: false, reason: 'intent-mismatch' });
    // The evidence lines as stored (rulings review mod-screens M1): another line, another order or another split.
    for (const lines of [[...EVIDENCE, 'more'], [...EVIDENCE].reverse(), [EVIDENCE.join(' ')]]) {
      expect(await authorize(w, { ...c, ruling: { ...c.ruling, evidenceSha256: evidenceSha256(lines) } }, [t])).toEqual({ ok: false, reason: 'intent-mismatch' });
    }
    expect(await authorize(w, { ...c, ruling: { ...c.ruling, proposer: other.id } }, [t])).toEqual({ ok: false, reason: 'intent-mismatch' });
    // The trade's amount as tapped is not the amount this process recorded.
    const d = ruling(mod);
    expect(await authorize(w, d, [tapBy(mod, d.intent('propose', { amountAtomic: (AMOUNT + 1n).toString() }))])).toEqual({ ok: false, reason: 'intent-mismatch' });
    // Two proposals, or an approval alone.
    const e = ruling(mod);
    expect(await authorize(w, e, [tapBy(mod, e.intent('propose')), tapBy(other, e.intent('propose'))])).toEqual({ ok: false, reason: 'intent-mismatch' });
    expect(await authorize(w, e, [])).toEqual({ ok: false, reason: 'intent-mismatch' });
    // A tap for something else.
    expect(await authorize(w, e, [tapBy(mod, { kind: 'emergency-stop' })])).toEqual({ ok: false, reason: 'intent-mismatch' });
    // The code may be written with or without its dashes (tapChallenge normalises it).
    const f = ruling(mod);
    expect((await authorize(w, { ...f, ruling: { ...f.ruling, code: f.ruling.code.replace(/-/g, '').toLowerCase() } }, [tapBy(mod, f.intent('propose'))])).ok).toBe(true);
  });

  it('re-verifies every signature itself', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    const good = tapBy(mod, c.intent('propose'));
    const sig = Buffer.from(good.response.response.signature, 'base64url');
    sig[sig.length - 1] = sig[sig.length - 1]! ^ 1;
    const flipped: StoredTap = { ...good, response: { ...good.response, response: { ...good.response.response, signature: b64url(sig) } } };
    expect(await authorize(w, c, [flipped])).toEqual({ ok: false, reason: 'bad-signature' });
    // The stored intent rewritten (here: the other outcome) no longer matches what the key signed.
    const swapped: StoredTap = { ...good, intent: canonicalJson(c.intent('propose', { outcome: 'refund-to-seller' })) };
    expect(await authorize(w, { ...c, ruling: { ...c.ruling, outcome: 'refund-to-seller' } }, [swapped])).toEqual({ ok: false, reason: 'bad-signature' });
    // Another nonce than the one signed over.
    expect(await authorize(w, c, [{ ...good, nonceHex: randomBytes(16).toString('hex') }])).toEqual({ ok: false, reason: 'bad-signature' });
    // Signed for another relying party.
    const elsewhere = mod.key.authenticate({ challenge: b64url(tapChallenge(c.intent('propose'), Buffer.from(good.nonceHex, 'hex'))), rpId: 'evil.test', allowCredentials: [] }, 'https://evil.test');
    expect(await authorize(w, c, [{ ...good, response: elsewhere }])).toEqual({ ok: false, reason: 'bad-signature' });
    expect((await authorize(w, c, [good])).ok).toBe(true);
  });

  it('a tap used for one ruling is never accepted for another', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const a = ruling(mod);
    const t = tapBy(mod, a.intent('propose'));
    expect((await authorize(w, a, [t])).ok).toBe(true);
    // The same ruling checked again (the executor re-checks every pass) is still fine.
    expect((await authorize(w, a, [t])).ok).toBe(true);
    const b = ruling(mod);
    expect(await authorize(w, b, [t])).toEqual({ ok: false, reason: 'nonce-reused' });
    // A registry tap's nonce is spent too.
    const s = tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48 });
    w.api.taps.push(s);
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.usedNonces[s.nonceHex]).toBeDefined();
  });

  it('an appeal ruling by anyone involved in round 1 is refused (R37)', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    const senior2 = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod);
    expect((await authorize(w, r1, [tapBy(mod, r1.intent('propose'))])).ok).toBe(true);
    // Round 1's proposer, as this process saw them sign, even with a log that leaves them out.
    const r2 = ruling(mod, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, r2, [tapBy(mod, r2.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: false, reason: 'involved' });
    // Anyone with a log entry on round 1.
    const r2b = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, r2b, [tapBy(senior, r2b.intent('propose'))], 41_250n, { involved: [senior.id] })).toEqual({ ok: false, reason: 'involved' });
    // An approver involved in round 1 too.
    const r2c = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code, approver: senior });
    expect(await authorize(w, r2c, [tapBy(senior2, r2c.intent('propose')), tapBy(senior, r2c.intent('approve'))], 100_000n, { involved: [senior.id] })).toEqual({ ok: false, reason: 'involved' });
    // An independent reviewer: authorised, and nothing to co-sign (round 2 never pays; an overturn is a lien).
    const ok = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, ok, [tapBy(senior2, ok.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: true, settle: null });
    // A round 2 with no round 1 named is not one the gate can check.
    const bare = ruling(senior2, { round: 2 });
    expect(await authorize(w, bare, [tapBy(senior2, bare.intent('propose', { round1Id: r1.ruling.id }))])).toEqual({ ok: false, reason: 'intent-mismatch' });
  });

  it('an after-refund ruling is authorised but never co-signed', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod, { outcome: 'seller-sends-xmr' });
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose'))])).toEqual({ ok: true, settle: null });
  });

  it('refuses everything until the owner is pinned', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const c = ruling(mod);
    const fresh = emptyGate();
    expect(await authorizeRuling(fresh, { ruling: c.ruling, taps: [tapBy(mod, c.intent('propose'))], recorded: recorded(1n), balanceAtomic: BALANCE }, ctx())).toEqual({ ok: false, reason: 'unpinned' });
  });

  it('gateCheck syncs the registry first, so a switch-off a moment ago already counts', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const c = ruling(mod);
    const t = tapBy(mod, c.intent('propose'));
    w.api.taps.push(t);
    const dir = await mkdtemp(join(tmpdir(), 'x2f-gate-'));
    try {
      const store = await freshGate(dir, new Uint8Array(32).fill(7));
      store.state = w.gate;
      await store.save();
      const check = () => gateCheck(store, w.api, { ruling: c.ruling, recorded: recorded(1n), balanceAtomic: BALANCE, involved: [] }, ctx());
      expect((await check()).ok).toBe(true);
      w.api.staffRows.get(mod.id)!.switchedOff = true;
      expect(await check()).toEqual({ ok: false, reason: 'revoked' });
      // What it learnt is saved.
      const again = await openGateStore(dir, new Uint8Array(32).fill(7));
      expect(again.state.staff[mod.id]!.revoked).toBe(true);
      expect(again.state.usedNonces[t.nonceHex]).toBe(`ruling:${c.ruling.id}:propose`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// The security review of 12 Nov (review-mod-gate-2026-11-12.md): each PoC there, flipped to the refusal.
describe('security review 2026-11-12', () => {
  /** An attacker's own genuine, allowlisted key registered for `tokenHash` (the challenge needs no secret). */
  const attackerReg = (key: SoftAuthenticator, tokenHash: string) =>
    key.register(
      { challenge: b64url(inviteRegistrationChallenge(tokenHash)), rp: { id: RP_ID, name: 'X2F Staff' }, user: { id: 'AAAA', name: 'x', displayName: 'x' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'direct' },
      ORIGIN,
    );

  it('B1/P1: an expired owner create-invite tap brings nobody in, whatever the database registers for it', async () => {
    const w = await world();
    const inviteId = randomUUID();
    const tokenHash = sha256Hex('a token only the invitee ever saw');
    w.api.taps.push(tapBy(w.owner, { kind: 'create-invite', inviteId, role: 'senior', tokenHash, expiresAt: '2026-01-01T00:00:00.000Z' }));
    const attacker: Person = { id: randomUUID(), key: newKey(), role: 'senior' };
    w.api.invites.set(inviteId, { inviteId, tokenHash, accountId: attacker.id, registrations: [{ credentialId: attacker.key.credentialId, response: attackerReg(attacker.key, tokenHash) }] });
    w.api.staffRows.set(attacker.id, { accountId: attacker.id, role: 'senior', switchedOff: false, removed: false });
    await syncRegistry(w.api, w.gate, ctx());
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[attacker.id]).toBeUndefined();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod, { approver: attacker });
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose')), tapBy(attacker, c.intent('approve'))], 10_000_000n)).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('B1: the invite stays bound to the account the gate first saw for it; re-pointing it adds nobody', async () => {
    const w = await world();
    const mod = w.hire('mod');
    w.api.staffRows.delete(mod.id); // registered, not finished yet
    await syncRegistry(w.api, w.gate, ctx());
    const inv = [...w.api.invites.values()][0]!;
    const attacker: Person = { id: randomUUID(), key: newKey(), role: 'mod' };
    inv.accountId = attacker.id;
    inv.registrations.push({ credentialId: attacker.key.credentialId, response: attackerReg(attacker.key, inv.tokenHash) });
    w.api.staffRows.set(attacker.id, { accountId: attacker.id, role: 'mod', switchedOff: false, removed: false });
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[attacker.id]).toBeUndefined();
    expect(w.gate.staff[mod.id]!.creds.map((c) => c.credentialId)).toEqual([mod.key.credentialId]);
  });

  it('B1/P2: once the person has joined, the invite is closed in the gate: no later registration adds a key', async () => {
    const w = await world();
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const inv = [...w.api.invites.values()][0]!;
    const evil = newKey();
    inv.registrations.push({ credentialId: evil.credentialId, response: attackerReg(evil, inv.tokenHash) });
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[senior.id]!.creds.map((c) => c.credentialId)).toEqual([senior.key.credentialId]);
    expect(w.gate.staff[senior.id]!.inviteClosed).toBe(true);
  });

  it('B1: a registration first seen after the invite expired is refused', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const late = (): GateContext => ({ ...ctx(), now: () => new Date('2026-11-13T12:00:00.000Z') });
    await syncRegistry(w.api, w.gate, late());
    expect(w.gate.staff[mod.id]).toBeUndefined();
  });

  it('B2/P3: a round-2 ruling needs round 1 as the gate itself authorised it, and its taps name it', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod);
    expect((await authorize(w, r1, [tapBy(mod, r1.intent('propose'))])).ok).toBe(true);
    // Unseen round 1 (with an empty log list, by round 1's own proposer).
    const unseen = ruling(mod, { round: 2, round1Id: randomUUID(), code: r1.ruling.code });
    expect(await authorize(w, unseen, [tapBy(mod, unseen.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: false, reason: 'round1-unseen' });
    // Even by an uninvolved senior.
    const unseen2 = ruling(senior, { round: 2, round1Id: randomUUID(), code: r1.ruling.code });
    expect(await authorize(w, unseen2, [tapBy(senior, unseen2.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: false, reason: 'round1-unseen' });
    // A round 1 the gate saw on another trade.
    const elsewhere = ruling(mod);
    expect((await authorize(w, elsewhere, [tapBy(mod, elsewhere.intent('propose'))])).ok).toBe(true);
    const wrong = ruling(senior, { round: 2, round1Id: elsewhere.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, wrong, [tapBy(senior, wrong.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: false, reason: 'round1-unseen' });
    // The database names round 1 but the taps named another: they never agreed to review this one.
    const swapped = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, swapped, [tapBy(senior, swapped.intent('propose', { round1Id: elsewhere.ruling.id }))], 41_250n, { involved: [] })).toEqual({ ok: false, reason: 'intent-mismatch' });
    // The log list only adds to the gate's own: an empty one never clears round 1's proposer.
    const self = ruling(mod, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, self, [tapBy(mod, self.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: false, reason: 'involved' });
    const fine = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, fine, [tapBy(senior, fine.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: true, settle: null });
  });

  it('M1/P5: a held-back older settings tap never undoes a newer one (the key\'s signature counter)', async () => {
    const w = await world();
    const high = tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 1_000_000, firstResponseH: 4, appealWindowH: 48 });
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 100, firstResponseH: 4, appealWindowH: 48 }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.limitUsdCents).toBe(10_000n);
    w.api.taps.push(high);
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.limitUsdCents).toBe(10_000n);
    // Both in one sync, older served first: the newer still wins.
    const v = await world();
    const older = tapBy(v.owner, { kind: 'settings', largeTradeLimitUsd: 1_000_000, firstResponseH: 4, appealWindowH: 48 });
    const newer = tapBy(v.owner, { kind: 'settings', largeTradeLimitUsd: 100, firstResponseH: 4, appealWindowH: 48 });
    v.api.taps.push(newer, older);
    await syncRegistry(v.api, v.gate, ctx());
    expect(v.gate.limitUsdCents).toBe(10_000n);
  });

  it('M1/P4: a held-back switch-on older than an owner tap the gate has since seen by that key restores nobody', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const old = tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }); // held back by the database
    // The owner uses the same key again afterwards (any tap the gate sees).
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48 }));
    await syncRegistry(w.api, w.gate, ctx());
    w.api.staffRows.get(mod.id)!.switchedOff = true;
    await syncRegistry(w.api, w.gate, ctx());
    w.api.staffRows.get(mod.id)!.switchedOff = false;
    w.api.taps.push(old);
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose'))])).toEqual({ ok: false, reason: 'revoked' });
    // And an older set-role never promotes after a newer demotion by the same key.
    const senior = w.hire('senior');
    const promote = tapBy(w.owner, { kind: 'set-role', accountId: senior.id, role: 'senior' });
    w.api.taps.push(tapBy(w.owner, { kind: 'set-role', accountId: senior.id, role: 'mod' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[senior.id]!.role).toBe('mod');
    w.api.taps.push(promote);
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[senior.id]!.role).toBe('mod');
    // The gate keeps each owner key's high-water mark.
    expect(w.gate.ownerCreds.find((k) => k.credentialId === w.owner.key.credentialId)!.counter).toBeGreaterThan(0);
  });

  it('I1: the owner\'s tapped remove-staff removes for good, whatever the database shows', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    w.api.taps.push(tapBy(w.owner, { kind: 'remove-staff', accountId: mod.id }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[mod.id]!.removed).toBe(true);
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }));
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose'))])).toEqual({ ok: false, reason: 'revoked' });
  });

  it('I1: the owner\'s tapped emergency stop refuses every ruling until a newer tapped resume', async () => {
    const w = await world();
    const mod = w.hire('mod');
    w.api.taps.push(tapBy(w.owner, { kind: 'emergency-stop' }));
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    const t = tapBy(mod, c.intent('propose'));
    expect(await authorize(w, c, [t])).toEqual({ ok: false, reason: 'stopped' });
    w.api.taps.push(tapBy(w.owner, { kind: 'resume-trading' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect((await authorize(w, c, [t])).ok).toBe(true);
  });

  it('I3: the recorded trade must agree with the attested deal', () => {
    const terms = { deal: { poster: 'seller' as const, takeAmountAtomic: AMOUNT.toString(), currency: 'USD', centsPerXmr: '16500', maxFiatCents: '100000' }, payWindowMin: 90, buyerPayout: BUYER, sellerRefund: SELLER };
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
    const trade = { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' as const };
    expect(() => recordedTerms({ terms, trade: { ...trade, poster: 'buyer' }, feeWallet: FEE })).toThrow(RangeError);
    expect(() => recordedTerms({ terms, trade: { ...trade, amountAtomic: AMOUNT - 1n }, feeWallet: FEE })).toThrow(RangeError);
    // A trade funded above its amount grows (spec 11.1): more than the take amount is its own.
    const grown = escrowPlan({ amountAtomic: AMOUNT * 2n, poster: 'seller' });
    expect(recordedTerms({ terms, trade: { amountAtomic: AMOUNT * 2n, feeAtomic: grown.feeAtomic, sellerFundsAtomic: grown.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE }).usdCents).toBe(8_250n);
  });

  it('M2: saves are serialised, each through its own temp file; the gate opens after concurrent saves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-gate-'));
    try {
      const key = new Uint8Array(randomBytes(32));
      const s = await freshGate(dir, key);
      await Promise.all(Array.from({ length: 8 }, (_, i) => {
        s.state.usedNonces[`n${i}`] = 'x';
        return s.save();
      }));
      const again = await openGateStore(dir, key);
      expect(Object.keys(again.state.usedNonces).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `n${i}`).sort());
      const { readdir } = await import('node:fs/promises');
      expect(await readdir(dir)).toEqual(['gate.bin']);
      // `exclusive` runs one critical section at a time.
      let inside = 0;
      let most = 0;
      await Promise.all(Array.from({ length: 4 }, () => s.exclusive(async () => {
        inside++;
        most = Math.max(most, inside);
        await new Promise((r) => setTimeout(r, 5));
        inside--;
      })));
      expect(most).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Lead call on review P4 (12 Nov): owner registry taps carry a signed issuedAt (the API's start
// time); the gate notes when it first saw each switch-off by its own clock, and a switch-on counts
// only when issued after that, less a 2-minute skew. Taps without issuedAt are refused.
describe('signed issuedAt (review P4, lead call)', () => {
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
  const ctxAt = (d: Date): GateContext => ({ ...ctx(), now: () => d });

  it('P4: a switch-on held back past a switch-off the gate saw restores nobody; a later one does', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const old = tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }, { issuedAt: at(0) }); // held back
    await syncRegistry(w.api, w.gate, ctxAt(at(1)));
    w.api.staffRows.get(mod.id)!.switchedOff = true;
    await syncRegistry(w.api, w.gate, ctxAt(at(10)));
    expect(w.gate.staff[mod.id]!.offSeenAt).toBe(at(10).toISOString());
    w.api.staffRows.get(mod.id)!.switchedOff = false;
    w.api.taps.push(old);
    await syncRegistry(w.api, w.gate, ctxAt(at(11)));
    const c = ruling(mod);
    const t = tapBy(mod, c.intent('propose'));
    expect(await authorizeRuling(w.gate, { ruling: c.ruling, taps: [t], recorded: recorded(1n), balanceAtomic: BALANCE }, ctxAt(at(11)))).toEqual({ ok: false, reason: 'revoked' });
    // Issued 3 minutes before the switch-off was seen: still too old (2 minutes of skew only).
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }, { issuedAt: at(7) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(12)));
    expect(await authorizeRuling(w.gate, { ruling: c.ruling, taps: [t], recorded: recorded(1n), balanceAtomic: BALANCE }, ctxAt(at(12)))).toEqual({ ok: false, reason: 'revoked' });
    // Within the skew, or after: restored.
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }, { issuedAt: at(9) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(13)));
    expect((await authorizeRuling(w.gate, { ruling: c.ruling, taps: [t], recorded: recorded(1n), balanceAtomic: BALANCE }, ctxAt(at(13)))).ok).toBe(true);
  });

  it('every owner registry tap without a signed issuedAt is refused', async () => {
    const w = await world();
    const inviteId = randomUUID();
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 5000, firstResponseH: 4, appealWindowH: 48 }, { issuedAt: null }));
    w.api.taps.push(tapBy(w.owner, { kind: 'emergency-stop' }, { issuedAt: null }));
    w.api.taps.push(tapBy(w.owner, { kind: 'create-invite', inviteId, role: 'mod', tokenHash: 'a'.repeat(64), expiresAt: '2026-11-13T12:00:00.000Z' }, { issuedAt: null }));
    await syncRegistry(w.api, w.gate, ctx());
    expect({ limit: w.gate.limitUsdCents, stopped: w.gate.stopped, invites: Object.keys(w.gate.invites) }).toEqual({ limit: 100_000n, stopped: false, invites: [] });
  });

  it('settings and roles: a tap issued before the last applied one for its subject is ignored, whichever owner key made it', async () => {
    const w = await world();
    const older = tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 1_000_000, firstResponseH: 4, appealWindowH: 48 }, { key: w.ownerKey2, issuedAt: at(0) });
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 100, firstResponseH: 4, appealWindowH: 48 }, { issuedAt: at(5) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(6)));
    w.api.taps.push(older);
    await syncRegistry(w.api, w.gate, ctxAt(at(7)));
    expect(w.gate.limitUsdCents).toBe(10_000n);
  });
});

// The re-verify of 12 Nov (re-verify-mod-gate-2026-11-12.md): its PoCs, each refused. N5 (the
// 2-minute skew) is accepted as designed and the B1 residual is the owner's question (lead calls).
describe('re-verify 2026-11-12', () => {
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
  const ctxAt = (d: Date): GateContext => ({ ...ctx(), now: () => d });
  const FAR = new Date('2030-01-01T00:00:00.000Z');

  it('P6: a missing gate.bin is an error; only the init command, with the operator\'s "yes", makes a new one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-gate-'));
    try {
      const key = new Uint8Array(32).fill(7);
      await expect(openGateStore(dir, key)).rejects.toThrow(/gate\.bin/);
      expect(await initGate({ dir, keystoreKey: key, print: () => {}, confirm: async () => 'no' })).toBe('declined');
      await expect(openGateStore(dir, key)).rejects.toThrow(/gate\.bin/);
      expect(await initGate({ dir, keystoreKey: key, print: () => {}, confirm: async () => 'yes' })).toBe('created');
      const s = await openGateStore(dir, key);
      s.state.ownerAccountId = 'x';
      await s.save();
      // Never over an existing gate.
      expect(await initGate({ dir, keystoreKey: key, print: () => {}, confirm: async () => 'yes' })).toBe('exists');
      expect((await openGateStore(dir, key)).state.ownerAccountId).toBe('x');
      await rm(join(dir, 'gate.bin'));
      await expect(openGateStore(dir, key)).rejects.toThrow(/gate\.bin/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('N1: a far-future settings tap is refused, so it cannot lock out the owner\'s later settings', async () => {
    const w = await world();
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 5000, firstResponseH: 4, appealWindowH: 48 }, { key: w.ownerKey2, issuedAt: FAR }));
    await syncRegistry(w.api, w.gate, ctxAt(at(0)));
    expect(w.gate.limitUsdCents).toBe(100_000n);
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 100, firstResponseH: 4, appealWindowH: 48 }, { issuedAt: at(60) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(61)));
    expect(w.gate.limitUsdCents).toBe(10_000n);
    // Within the skew ahead is fine.
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 200, firstResponseH: 4, appealWindowH: 48 }, { issuedAt: at(63) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(62)));
    expect(w.gate.limitUsdCents).toBe(20_000n);
  });

  it('N2: a far-future resume-trading cannot disable the owner\'s later emergency stop', async () => {
    const w = await world();
    w.api.taps.push(tapBy(w.owner, { kind: 'resume-trading' }, { issuedAt: FAR }));
    await syncRegistry(w.api, w.gate, ctxAt(at(0)));
    w.api.taps.push(tapBy(w.owner, { kind: 'emergency-stop' }, { key: w.ownerKey2, issuedAt: at(60) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(61)));
    expect(w.gate.stopped).toBe(true);
  });

  it('N3: a withheld far-future switch-on restores nobody switched off later', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const old = tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }, { issuedAt: FAR });
    await syncRegistry(w.api, w.gate, ctxAt(at(1)));
    w.api.staffRows.get(mod.id)!.switchedOff = true;
    await syncRegistry(w.api, w.gate, ctxAt(at(30)));
    w.api.staffRows.get(mod.id)!.switchedOff = false;
    w.api.taps.push(old);
    await syncRegistry(w.api, w.gate, ctxAt(at(31)));
    expect(w.gate.staff[mod.id]!.revoked).toBe(true);
  });

  it('N3b: a far-future set-role cannot make every later demotion ignored', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctxAt(at(0)));
    w.api.taps.push(tapBy(w.owner, { kind: 'set-role', accountId: mod.id, role: 'senior' }, { issuedAt: FAR }));
    await syncRegistry(w.api, w.gate, ctxAt(at(1)));
    w.api.taps.push(tapBy(w.owner, { kind: 'set-role', accountId: mod.id, role: 'helper' }, { key: w.ownerKey2, issuedAt: at(60) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(61)));
    expect(w.gate.staff[mod.id]!.role).toBe('helper');
  });

  it('N4: a registry tap first seen more than 24 hours after its issuedAt is refused', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctxAt(at(0)));
    w.api.taps.push(tapBy(w.owner, { kind: 'set-role', accountId: mod.id, role: 'senior' }, { issuedAt: at(1) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(30 * 24 * 60)));
    expect(w.gate.staff[mod.id]!.role).toBe('mod');
    // Within 24 hours it counts (the gate was down for a while).
    w.api.taps.push(tapBy(w.owner, { kind: 'set-role', accountId: mod.id, role: 'senior' }, { issuedAt: at(30 * 24 * 60) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(30 * 24 * 60 + 23 * 60)));
    expect(w.gate.staff[mod.id]!.role).toBe('senior');
  });

  it('N6: add-owner-key pairs only taps issued within 10 minutes of each other', async () => {
    const w = await world();
    const third = newKey();
    w.api.creds.set(third.credentialId, { accountId: w.owner.id, publicKey: new Uint8Array(third.cosePublicKey), aaguid: AAGUID });
    const intent: KeyTapIntent = { kind: 'add-owner-key', credentialId: third.credentialId, publicKeySha256: sha256Hex(third.cosePublicKey) };
    w.api.taps.push(tapBy(w.owner, intent, { issuedAt: at(0) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(1)));
    w.api.taps.push(tapBy(w.owner, intent, { key: w.ownerKey2, issuedAt: at(11) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(12)));
    expect(w.gate.ownerCreds.map((c) => c.credentialId)).not.toContain(third.credentialId);
    // Two taps 5 minutes apart pair.
    w.api.taps.push(tapBy(w.owner, intent, { issuedAt: at(20) }), tapBy(w.owner, intent, { key: w.ownerKey2, issuedAt: at(25) }));
    await syncRegistry(w.api, w.gate, ctxAt(at(26)));
    expect(w.gate.ownerCreds.map((c) => c.credentialId)).toContain(third.credentialId);
  });

  it('N7: in one sync, taps apply in each key\'s counter order whatever their step: a settings tap before a create-invite still applies', async () => {
    const w = await world();
    w.api.taps.push(tapBy(w.owner, { kind: 'settings', largeTradeLimitUsd: 100, firstResponseH: 4, appealWindowH: 48 }, { issuedAt: at(0) }));
    w.hire('mod'); // the owner's create-invite tap, same key, a later counter
    await syncRegistry(w.api, w.gate, ctxAt(at(1)));
    expect(w.gate.limitUsdCents).toBe(10_000n);
  });

  it('M-R1: the reason\'s SHA-256 is computed here from the stored text, never taken from the database', async () => {
    const reason = 'r'.repeat(40);
    const fake = {
      query: async (sql: string) => {
        if (/from disputes/.test(sql)) return { rows: [{ seq: 1, round: 1, ruling: { id: randomUUID(), outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: randomUUID(), approver: null }, round1: null }] };
        // A lying database: a hash column that is not the reason's (the gate must not ask for one).
        if (/from dispute_rulings/.test(sql)) return { rows: [{ round: 1, reason, evidence: ['a'], h: 'f'.repeat(64) }] };
        return { rows: [] };
      },
    };
    const got = await pgGateSource(fake as never).storedRulings('ABCD-EFGH-JKMN-PQRS');
    expect(got.current?.reasonSha256).toBe(sha256Hex(reason));
  });
});

// Round 3 (re-verify-mod-gate-2026-11-12.md, X2 and the init race; lead calls).
describe('re-verify round 3', () => {
  it('X2: a staff login assertion is never accepted as a tap, whatever intent and nonce it is shown with', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const loginNonce = 'cd'.repeat(32);
    // What the owner's key signs at a login: the staff site's own derived challenge.
    const login = w.owner.key.authenticate({ challenge: b64url(staffLoginChallenge(loginNonce)), rpId: RP_ID, allowCredentials: [] }, ORIGIN);
    const settings = canonicalJson({ kind: 'settings', largeTradeLimitUsd: 1_000_000, firstResponseH: 4, appealWindowH: 48, issuedAt: NOW.toISOString() });
    for (const nonceHex of [loginNonce.slice(0, 32), loginNonce, randomBytes(16).toString('hex')]) {
      w.api.taps.push({ id: randomUUID(), accountId: w.owner.id, credentialId: w.owner.key.credentialId, intent: settings, nonceHex, response: login });
    }
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.limitUsdCents).toBe(100_000n);
    // As a ruling approval too.
    const c = ruling(mod, { approver: w.owner });
    const forged: StoredTap = { id: randomUUID(), accountId: w.owner.id, credentialId: w.owner.key.credentialId, intent: canonicalJson(c.intent('approve')), nonceHex: loginNonce, response: login };
    expect(await authorize(w, c, [tapBy(mod, c.intent('propose')), forged], 200_000n)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('init-gate creates gate.bin atomically: a gate.bin that appears while it asks is never replaced', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-gate-'));
    try {
      const key = new Uint8Array(32).fill(7);
      const result = await initGate({
        dir,
        keystoreKey: key,
        print: () => {},
        // Another init-gate (or a restore) wins the race while this one waits for "yes".
        confirm: async () => {
          const other = await freshGate(dir, key);
          other.state.ownerAccountId = 'pinned-elsewhere';
          await other.save();
          return 'yes';
        },
      });
      expect(result).toBe('exists');
      expect((await openGateStore(dir, key)).state.ownerAccountId).toBe('pinned-elsewhere');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the attestation allowlists, gate and API (review I2)', () => {
  it('both parsers read the same README fixtures the same way, CRLF included', async () => {
    const { parseAllowlist } = await import('../../api/src/auth/attestation.js');
    const { parseGateAllowlist } = await import('../src/gate/attestation.js');
    const A = '11111111-2222-4333-8444-555555555555';
    const B = '22222222-2222-4333-8444-555555555555';
    const good = `# M\n\n- \`00000000-0000-4000-8000-000000000000\` ignored\n\n## Owner allowlist\n\n- \`${A}\` one\n\n## Staff allowlist  \n\n- \`${A.toUpperCase()}\` one\n- \`${B}\` two\ntext\n### Sub\n- \`${B}\` still\n## Next\n- \`33333333-2222-4333-8444-555555555555\` not\n`;
    const fixtures = [good, good.replace(/\n/g, '\r\n'), '## Owner allowlist\n', '## Staff allowlist\n- `nope`\n', 'nothing here', `## Owner allowlist\t\n- \`${A}\`\n## Staff allowlist\n- \`${B}\``];
    for (const f of fixtures) {
      for (const kind of ['owner', 'staff'] as const) {
        const api = (() => { try { return parseAllowlist(f, kind); } catch { return 'throws'; } })();
        const gate = (() => { try { return parseGateAllowlist(f, kind); } catch { return 'throws'; } })();
        expect(gate, `${kind}: ${JSON.stringify(f).slice(0, 60)}`).toEqual(api);
      }
    }
    expect(parseGateAllowlist(good.replace(/\n/g, '\r\n'), 'staff')).toEqual([A, B, B]);
  });
});

describe('recordedTerms', () => {
  it('takes the addresses this process attested and its own trade, never the API row', () => {
    const terms = { deal: { poster: 'seller' as const, takeAmountAtomic: AMOUNT.toString(), currency: 'USD', centsPerXmr: '16500', maxFiatCents: '100000' }, payWindowMin: 90, buyerPayout: BUYER, sellerRefund: SELLER };
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
    const r = recordedTerms({ terms, trade: { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE });
    // 0.25 XMR at $165.00: $41.25, rounded up to the cent.
    expect(r).toEqual({ ...recorded(4_125n) });
    // Not US dollars: no value of its own, so every ruling on it needs a second person.
    expect(recordedTerms({ terms: { ...terms, deal: { ...terms.deal, currency: 'EUR' } }, trade: { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE }).usdCents).toBeNull();
    // A part cent rounds up (toward needing a second approval at the limit).
    expect(recordedTerms({ terms: { ...terms, deal: { ...terms.deal, centsPerXmr: '16501' } }, trade: { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE }).usdCents).toBe(4_126n);
  });
});

describe('GateStore', () => {
  it('is AES-256-GCM sealed in gate.bin and unreadable with another MOD_KEYSTORE_KEY', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-gate-'));
    try {
      const key = new Uint8Array(randomBytes(32));
      const s = await freshGate(dir, key);
      expect(s.state.ownerCreds).toEqual([]);
      s.state.limitUsdCents = 123_400n;
      s.state.usedNonces.abc = 'x';
      await s.save();
      const raw = await readFile(join(dir, 'gate.bin'));
      expect(raw.includes(Buffer.from('123400'))).toBe(false);
      expect((await openGateStore(dir, key)).state.limitUsdCents).toBe(123_400n);
      await expect(openGateStore(dir, new Uint8Array(randomBytes(32)))).rejects.toThrow();
      // A flipped byte is refused, never read as an empty gate.
      raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
      await writeFile(join(dir, 'gate.bin'), raw);
      await expect(openGateStore(dir, key)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('pin-owner', () => {
  it('prints each key check code, pins only on "yes", and never twice', async () => {
    const api = new FakeApi();
    const k1 = newKey();
    const k2 = newKey();
    const ownerId = randomUUID();
    api.owner = { accountId: ownerId, keys: [k1, k2].map((k) => ({ credentialId: k.credentialId, publicKey: new Uint8Array(k.cosePublicKey), aaguid: AAGUID })) };
    const printed: string[] = [];
    const gate = emptyGate();
    expect(await pinOwner({ source: api, gate, print: (l) => printed.push(l), confirm: async () => 'no' })).toBe('declined');
    expect(gate.ownerCreds).toEqual([]);
    expect(printed.join('\n')).toContain(keyCheckCode(new Uint8Array(k1.cosePublicKey)));
    expect(printed.join('\n')).toContain(keyCheckCode(new Uint8Array(k2.cosePublicKey)));
    expect(await pinOwner({ source: api, gate, print: () => {}, confirm: async () => 'yes' })).toBe('pinned');
    expect({ owner: gate.ownerAccountId, creds: gate.ownerCreds.map((c) => c.credentialId) }).toEqual({ owner: ownerId, creds: [k1.credentialId, k2.credentialId] });
    expect(await pinOwner({ source: api, gate, print: () => {}, confirm: async () => 'yes' })).toBe('already-pinned');
    // Fewer than two owner keys: nothing to pin.
    const one = new FakeApi();
    one.owner = { accountId: ownerId, keys: api.owner.keys.slice(0, 1) };
    expect(await pinOwner({ source: one, gate: emptyGate(), print: () => {}, confirm: async () => 'yes' })).toBe('no-owner-keys');
  });
});

describe('pgGateSource on the API schema (x2f_mod_reader only)', () => {
  let admin: string;
  let owner: pg.Pool;
  let reader: pg.Pool;
  let name: string;

  beforeAll(async () => {
    admin = inject('modPgUrl');
    name = `x2f_mod_g_${randomBytes(8).toString('hex')}`;
    const c = new pg.Client({ connectionString: `${admin}/postgres` });
    await c.connect();
    try {
      await c.query(`create database ${name}`);
    } finally {
      await c.end();
    }
    owner = new pg.Pool({ connectionString: `${admin}/${name}`, max: 1 });
    const dir = new URL('../../api/migrations/', import.meta.url);
    const { readdir } = await import('node:fs/promises');
    for (const f of (await readdir(dir)).filter((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
      await owner.query(await readFile(new URL(f, dir), 'utf8'));
    }
    const login = `modg_${randomBytes(4).toString('hex')}`;
    const pass = randomBytes(12).toString('hex');
    await owner.query(`create role ${login} login password '${pass}' in role x2f_mod_reader`);
    const u = new URL(admin);
    reader = new pg.Pool({ connectionString: `postgres://${login}:${pass}@${u.host}/${name}`, max: 1 });
  });
  afterAll(async () => {
    await reader?.end();
    await owner?.end();
  });

  beforeEach(() => {});

  it('reads the owner keys, staff, invites with registrations, used taps and a ruling, and writes nothing', async () => {
    const ownerId = randomUUID();
    const modId = randomUUID();
    const inviteId = randomUUID();
    const k1 = newKey();
    const k2 = newKey();
    const mk = newKey();
    const c = await owner.connect();
    const tapIds = { invite: randomUUID(), ruling: randomUUID(), open: randomUUID() };
    try {
      await c.query('set session_replication_role = replica');
      for (const [id, kind] of [[ownerId, 'owner'], [modId, 'staff']] as const) {
        const n = `G${randomBytes(4).toString('hex')}`;
        await c.query(
          `insert into accounts (id, display_name, display_key, login_tag, login_tag_key_id, legacy_login_name, kind, webauthn_user_id, terms_version, terms_accepted_at, created_at)
           values ($1, $2, lower($2), $3, 1, true, $4, $5, '2026-10-17', now(), now())`,
          [id, n, randomBytes(32), kind, randomBytes(32)],
        );
      }
      for (const [acct, k, kind] of [[ownerId, k1, 'security-key'], [ownerId, k2, 'security-key'], [modId, mk, 'security-key']] as const) {
        await c.query(
          `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, aaguid, label, created_at)
           values ($1, $2, $3, 0, $4, false, 'singleDevice', true, $5, 'k', now())`,
          [acct, Buffer.from(k.credentialId, 'base64url'), k.cosePublicKey, kind, AAGUID],
        );
      }
      // A passkey on the owner account is never offered as an owner key to pin.
      const pk = createSoftAuthenticator({ backedUp: true, userVerified: true });
      await c.query(
        `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
         values ($1, $2, $3, 0, 'passkey', true, 'multiDevice', false, 'p', now())`,
        [ownerId, Buffer.from(pk.credentialId, 'base64url'), pk.cosePublicKey],
      );
      await c.query(`insert into staff_members (account_id, role, hours, has_security_key, joined_at) values ($1, 'owner', '"any"', true, now()), ($2, 'mod', '"any"', true, now())`, [ownerId, modId]);
      await c.query(`update staff_members set switched_off_at = now() where account_id = $1`, [modId]);
      const nonce = randomBytes(16);
      const intent = canonicalJson({ kind: 'create-invite', inviteId, role: 'mod', tokenHash: 'a'.repeat(64), expiresAt: '2026-11-13T12:00:00.000Z' });
      await c.query(
        `insert into key_taps (id, account_id, credential_id, intent, nonce, response, started_at, finished_at, used_at) values ($1, $2, $3, $4, $5, $6, now(), now(), now())`,
        [tapIds.invite, ownerId, k1.credentialId, intent, nonce, JSON.stringify({ id: k1.credentialId })],
      );
      const rulingId = randomUUID();
      const ri = canonicalJson({ kind: 'ruling', step: 'propose', rulingId, code: 'ABCD-EFGH-JKMN-PQRS', round: 1, outcome: 'release-to-buyer', accountAction: { kind: 'none' }, amountAtomic: '1', reasonSha256: 'b'.repeat(64), evidenceSha256: 'c'.repeat(64), round1Id: null });
      await c.query(
        `insert into key_taps (id, account_id, credential_id, intent, nonce, response, started_at, finished_at, used_at) values ($1, $2, $3, $4, $5, $6, now(), now(), now())`,
        [tapIds.ruling, modId, mk.credentialId, ri, randomBytes(16), JSON.stringify({ id: mk.credentialId })],
      );
      // Finished but never used by its action: not a tap anything relied on.
      await c.query(
        `insert into key_taps (id, account_id, credential_id, intent, nonce, response, started_at, finished_at) values ($1, $2, $3, $4, $5, $6, now(), now())`,
        [tapIds.open, modId, mk.credentialId, ri.replace('"propose"', '"approve"'), randomBytes(16), JSON.stringify({ id: mk.credentialId })],
      );
      await c.query(
        `insert into staff_invites (id, token_hash, role, hours, created_by, created_at, expires_at, used_at, tap_id, account_id) values ($1, $2, 'mod', '"any"', $3, now(), now() + interval '1 day', now(), $4, $5)`,
        [inviteId, 'a'.repeat(64), ownerId, tapIds.invite, modId],
      );
      await c.query(`insert into staff_key_registrations (credential_id, invite_id, response, created_at) values ($1, $2, $3, now())`, [
        Buffer.from(mk.credentialId, 'base64url'), inviteId, JSON.stringify({ id: mk.credentialId, rawId: mk.credentialId }),
      ]);

      const src = pgGateSource(reader);
      const ok = await src.ownerKeys();
      expect(ok?.accountId).toBe(ownerId);
      expect(ok?.keys.map((k) => k.credentialId).sort()).toEqual([k1.credentialId, k2.credentialId].sort());
      expect(Buffer.from(ok!.keys.find((k) => k.credentialId === k1.credentialId)!.publicKey)).toEqual(k1.cosePublicKey);
      expect(await src.staff()).toEqual(expect.arrayContaining([{ accountId: modId, role: 'mod', switchedOff: true, removed: false }]));
      expect((await src.usedTaps(['create-invite'])).map((t) => t.id)).toEqual([tapIds.invite]);
      const taps = await src.rulingTaps(rulingId);
      expect(taps.map((t) => t.id)).toEqual([tapIds.ruling]);
      expect(taps[0]).toMatchObject({ accountId: modId, credentialId: mk.credentialId, intent: ri, response: { id: mk.credentialId } });
      expect(await src.invite(inviteId)).toEqual({
        inviteId, tokenHash: 'a'.repeat(64), accountId: modId, used: true,
        registrations: [{ credentialId: mk.credentialId, response: { id: mk.credentialId, rawId: mk.credentialId } }],
      });
      expect(await src.invite(randomUUID())).toBeNull();
      expect(await src.credential(mk.credentialId)).toEqual({ accountId: modId, publicKey: expect.any(Uint8Array), aaguid: AAGUID });
      // The stored ruling: round 1 kept whole in `round1` after an appeal, each with its published
      // reason's SHA-256, and R37's list from the log entries before the appeal.
      const code = 'ABCD-EFGH-JKMN-PQRS';
      const r1 = { id: randomUUID(), outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: modId, approver: null, needsSecond: false };
      const r2 = { id: randomUUID(), outcome: 'refund-to-seller', accountAction: { kind: 'none' }, proposer: ownerId, approver: null, needsSecond: false };
      await c.query(
        `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, round, ruling, round1)
         values ($1, 1, 'buyer', 'paid', '', now(), false, 'published', now(), now(), 0, 100000, 2, $2, $3)`,
        [code, JSON.stringify(r2), JSON.stringify({ ...r1, firstReplyAt: null, involved: [modId] })],
      );
      for (const [round, reason] of [[1, 'r'.repeat(40)], [2, 's'.repeat(40)]] as const) {
        await c.query(
          `insert into dispute_rulings (code, seq, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until) values ($1, 1, $2, 'release-to-buyer', $3, $4, 'Mod', now(), $5)`,
          [code, round, reason, JSON.stringify(round === 1 ? EVIDENCE : ['é line', 'two']), round === 1 ? new Date() : null],
        );
      }
      const helper = randomUUID();
      const late = randomUUID();
      for (const [id, actor, action] of [[1, modId, 'case.opened'], [2, helper, 'chat.read'], [3, null, 'appeal.opened'], [4, late, 'case.opened']] as const) {
        await c.query(
          `insert into activity_log (id, at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash) values ($1, now(), $2, $3, $4, $5, $6, '{}', $7, $8)`,
          [id, actor === null ? 'system' : 'staff', actor, actor === null ? null : 'mod', code, action, id === 1 ? null : Buffer.alloc(32, id - 1), Buffer.alloc(32, id)],
        );
      }
      const stored = await src.storedRulings(code);
      expect(stored).toEqual({
        current: { id: r2.id, code, round: 2, outcome: 'refund-to-seller', accountAction: { kind: 'none' }, proposer: ownerId, approver: null, reasonSha256: sha256Hex('s'.repeat(40)), evidenceSha256: evidenceSha256(['é line', 'two']), round1Id: r1.id },
        round1: { id: r1.id, code, round: 1, outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: modId, approver: null, reasonSha256: sha256Hex('r'.repeat(40)), evidenceSha256: evidenceSha256(EVIDENCE) },
        involved: expect.arrayContaining([modId, helper]),
      });
      expect(stored.involved).not.toContain(late);
      expect(await src.storedRulings('ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toEqual({ current: null, round1: null, involved: [] });
      // Read only, and only those columns.
      await expect(reader.query('select label from webauthn_credentials')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query('select session_id from key_taps')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query('select hours from staff_members')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query(`update staff_members set role = 'senior'`)).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query(`delete from key_taps`)).rejects.toMatchObject({ code: '42501' });
    } finally {
      c.release();
    }
  });
});

describe('gateFromEnv', () => {
  it('runs no gate without MOD_STATE_DIR; with it, needs the staff relying party, the metadata and the reader', async () => {
    const { gateFromEnv } = await import('../src/main.js');
    expect(gateFromEnv({})).toBeNull();
    const base = {
      MOD_STATE_DIR: '/var/lib/x2f-mod',
      MOD_STAFF_ORIGIN: 'https://staff.x2f.example',
      MOD_STAFF_RP_ID: 'staff.x2f.example',
      MOD_FIDO_MDS_DIR: '/srv/x2f/fido-mds',
      MOD_API_READER_DATABASE_URL: 'postgres://r@db/x2f',
    };
    expect(gateFromEnv(base)).toEqual({ stateDir: '/var/lib/x2f-mod', origin: 'https://staff.x2f.example', rpId: 'staff.x2f.example', mdsDir: '/srv/x2f/fido-mds', apiReaderUrl: 'postgres://r@db/x2f' });
    expect(gateFromEnv({ ...base, MOD_STAFF_RP_ID: 'x2f.example' })?.rpId).toBe('x2f.example');
    for (const [env, name] of [
      [{ ...base, MOD_STATE_DIR: 'state' }, 'MOD_STATE_DIR'],
      [{ ...base, MOD_STAFF_ORIGIN: 'http://staff.x2f.example' }, 'MOD_STAFF_ORIGIN'],
      [{ ...base, MOD_STAFF_RP_ID: 'evil.example' }, 'MOD_STAFF_RP_ID'],
      [{ ...base, MOD_FIDO_MDS_DIR: undefined }, 'MOD_FIDO_MDS_DIR'],
      [{ ...base, MOD_API_READER_DATABASE_URL: undefined }, 'MOD_API_READER_DATABASE_URL'],
    ] as const) {
      expect(() => gateFromEnv(env), name).toThrow(name);
    }
  });
});
