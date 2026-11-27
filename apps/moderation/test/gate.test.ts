// Plan 4 Task 13: the ruling gate. The moderation process accepts a ruling only when its whole
// signature chain checks out, rooted in the owner's keys pinned outside the API's database, and
// co-signs only what the ruling says, to the addresses it recorded itself. Pure tests on software
// authenticators (real WebAuthn signatures and packed attestation), plus the API schema's reader.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTradeCode, normalizeTradeCode } from '@x2f/core';
import { canonicalJson, evidenceSha256, inviteRegistrationChallenge, staffLoginChallenge, keyCheckCode, tapChallenge, type AccountAction, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';
import { LIEN_RECOVERY_MIN_ATOMIC, escrowPlan, lienRecoveryCap } from '@x2f/trade';
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
import { ORIGIN, RP_ID, AAGUID, OTHER_AAGUID, NOW, b64url, sha256Hex, ctx, newKey, type Person, FakeApi, tapBy, world, BUYER, SELLER, FEE, PAYROLL, AMOUNT, recorded, BALANCE, EVIDENCE, ruling, authorize, registration, resetSecurity, tapOnNonce, type World } from './gateWorld.js';
import { apiSchemaDb, type ApiSchema } from './apiSchema.js';
import { LINK_MAX_LIFETIME_MS } from '../src/gate/store.js';
import { lienRateApproved, lienRateTaps, lienRulingVerifier } from '../src/lienRecovery.js';

/** A new gate the way an operator makes one: init-gate with "yes", then open it. */
async function freshGate(dir: string, key: Uint8Array) {
  expect(await initGate({ dir, keystoreKey: key, print: () => {}, confirm: async () => 'yes' })).toBe('created');
  return openGateStore(dir, key);
}

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
    // Gone from the API after joining: revoked for anything new.
    w.api.staffRows.delete(mod.id);
    await syncRegistry(w.api, w.gate, ctx());
    const c2 = ruling(mod);
    expect(await authorize(w, c2, [tapBy(mod, c2.intent('propose'))])).toEqual({ ok: false, reason: 'revoked' });
    // Review p4t22 F1: the ruling already authorised stays authorised.
    expect((await authorize(w, c, [t])).ok).toBe(true);
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
      settle: { winner: 'buyer', payouts: [{ address: BUYER, amountAtomic: AMOUNT, bearsNetworkFee: true }, { address: FEE, amountAtomic: plan.feeAtomic - plan.feeAtomic / 2n, bearsNetworkFee: true }, { address: PAYROLL, amountAtomic: plan.feeAtomic / 2n, bearsNetworkFee: true }] },
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
    f.ruling.accountAction = { kind: 'trade-ban' as const, until: null, reasonCode: 'terms' as const };
    expect(await authorize(w, f, [tapBy(mod, f.intent('propose', { accountAction: { kind: 'trade-ban' as const, until: null, reasonCode: 'terms' as const } }))], 1_000n)).toEqual({ ok: false, reason: 'needs-second' });
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
    // An independent reviewer: authorised; review p4t22 m1 (OQ2): an escrow round 2 has its payout,
    // which the executor pays only when round 1's payout never ran.
    const ok = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, ok, [tapBy(senior2, ok.intent('propose'))], 41_250n, { involved: [] })).toMatchObject({ ok: true, settle: { winner: 'buyer' } });
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
      const check = (r: GateRuling = c.ruling) => gateCheck(store, w.api, { ruling: r, recorded: recorded(1n), balanceAtomic: BALANCE, involved: [] }, ctx());
      expect((await check()).ok).toBe(true);
      const c2 = ruling(mod);
      w.api.taps.push(tapBy(mod, c2.intent('propose')));
      w.api.staffRows.get(mod.id)!.switchedOff = true;
      expect(await check(c2.ruling)).toEqual({ ok: false, reason: 'revoked' });
      // Review p4t22 F1: the ruling the gate authorised before the switch-off stays authorised.
      expect((await check()).ok).toBe(true);
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
    expect(await authorize(w, fine, [tapBy(senior, fine.intent('propose'))], 41_250n, { involved: [] })).toMatchObject({ ok: true, settle: { winner: 'buyer' } });
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
    const terms = { deal: { poster: 'seller' as const, takeAmountAtomic: AMOUNT.toString(), currency: 'USD', centsPerXmr: '16500', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }, payWindowMin: 90, buyerPayout: BUYER, sellerRefund: SELLER };
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
    const trade = { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' as const };
    expect(() => recordedTerms({ terms, trade: { ...trade, poster: 'buyer' }, feeWallet: FEE, payrollWallet: PAYROLL })).toThrow(RangeError);
    expect(() => recordedTerms({ terms, trade: { ...trade, amountAtomic: AMOUNT - 1n }, feeWallet: FEE, payrollWallet: PAYROLL })).toThrow(RangeError);
    // A trade funded above its amount grows (spec 11.1): more than the take amount is its own.
    const grown = escrowPlan({ amountAtomic: AMOUNT * 2n, poster: 'seller' });
    expect(recordedTerms({ terms, trade: { amountAtomic: AMOUNT * 2n, feeAtomic: grown.feeAtomic, sellerFundsAtomic: grown.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE, payrollWallet: PAYROLL }).usdCents).toBe(8_250n);
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
describe('user verification on every key (owner, 16 Nov 2026; lead call 18 Nov)', () => {
  it('a staff key registered without user verification is never accepted', async () => {
    const w = await world();
    const noUv = w.hire('mod', { noUv: true });
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    expect(Object.keys(w.gate.staff)).toEqual([mod.id]);
    const c = ruling(noUv);
    expect(await authorize(w, c, [tapBy(noUv, c.intent('propose'))])).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('a tap without user verification is refused, for staff and for the owner', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const c = ruling(mod);
    mod.key.flags.userVerified = false;
    const unverified = tapBy(mod, c.intent('propose'));
    mod.key.flags.userVerified = true;
    expect(await authorize(w, c, [unverified])).toEqual({ ok: false, reason: 'bad-signature' });
    expect((await authorize(w, c, [tapBy(mod, c.intent('propose'))])).ok).toBe(true);

    // An owner create-invite tap without user verification invites nobody.
    w.owner.key.flags.userVerified = false;
    const before = w.api.taps.length;
    const hired = w.hire('mod');
    w.owner.key.flags.userVerified = true;
    expect(w.api.taps.length).toBe(before + 1);
    await syncRegistry(w.api, w.gate, ctx());
    expect(Object.keys(w.gate.staff)).toEqual([mod.id]);
    expect(Object.keys(w.gate.staff)).not.toContain(hired.id);
  });
});

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
describe('Haveno review 2026-11-12, finding 2 (lead call): rulings only move forward, never replayed', () => {
  it('a ruling the gate authorised on one trade is refused on another, even with fresh taps that name the other trade', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const a = ruling(mod);
    expect((await authorize(w, a, [tapBy(mod, a.intent('propose'))])).ok).toBe(true);
    // The same ruling id moved to another trade's dispute (a replay through the database).
    const other = newTradeCode();
    const moved = { ...a, ruling: { ...a.ruling, code: other } };
    const tap = tapBy(mod, a.intent('propose', { code: other }));
    expect(await authorize(w, moved, [tap])).toEqual({ ok: false, reason: 'replayed' });
    // Or the same id as another round on the same trade.
    const asRound2 = { ...a, ruling: { ...a.ruling, round: 2 as const, round1Id: randomUUID() } };
    expect(await authorize(w, asRound2, [tapBy(mod, a.intent('propose', { round: 2, round1Id: asRound2.ruling.round1Id }))])).toEqual({ ok: false, reason: 'replayed' });
    // The ruling as authorised is still fine (the executor re-checks every pass).
    expect((await authorize(w, a, [tapBy(mod, a.intent('propose'))])).ok).toBe(true);
  });

  it('a stale round: once round 2 is authorised on a trade, a round-1 ruling the gate never saw is refused; round 1 as authorised still pays', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod);
    const r1Tap = tapBy(mod, r1.intent('propose'));
    expect((await authorize(w, r1, [r1Tap])).ok).toBe(true);
    const r2 = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, r2, [tapBy(senior, r2.intent('propose'))], 41_250n, { involved: [] })).toMatchObject({ ok: true, settle: { winner: 'buyer' } });
    // A new round-1 ruling on the same trade (another outcome), properly tapped: stale.
    const late = ruling(senior, { code: r1.ruling.code, outcome: 'refund-to-seller' });
    expect(await authorize(w, late, [tapBy(senior, late.intent('propose'))])).toEqual({ ok: false, reason: 'stale-round' });
    // Review p4t22 F1 m1 (hardening): the appeal decided the trade, so round 1 (authorised, never
    // recorded) is not authorised again; with its payout recorded before the appeal it still is.
    expect(await authorize(w, r1, [r1Tap])).toEqual({ ok: false, reason: 'stale-round' });
    w.gate.executions[normalizeTradeCode(r1.ruling.code)!] = { rulingId: r1.ruling.id, winner: 'buyer', payouts: [], recordedAt: NOW.toISOString(), settledAt: null, settledTx: null };
    expect((await authorize(w, r1, [r1Tap])).ok).toBe(true);
  });

  it('a second ruling for a round the gate already authorised on the trade is refused (round 1 pays once, from one ruling)', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod);
    expect((await authorize(w, r1, [tapBy(mod, r1.intent('propose'))])).ok).toBe(true);
    const again = ruling(senior, { code: r1.ruling.code, outcome: 'refund-to-seller' });
    expect(await authorize(w, again, [tapBy(senior, again.intent('propose'))])).toEqual({ ok: false, reason: 'stale-round' });
    const r2 = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect((await authorize(w, r2, [tapBy(senior, r2.intent('propose'))], 41_250n, { involved: [] })).ok).toBe(true);
    const senior2 = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r2again = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorize(w, r2again, [tapBy(senior2, r2again.intent('propose'))], 41_250n, { involved: [] })).toEqual({ ok: false, reason: 'stale-round' });
  });
});

// Lead call on the D-032 reset gap (disputes-stack review): the API's reset-staff-security deletes
// a person's credentials and opens a `kind = 'reset'` link. The gate honours it only on a verified
// owner tap (the same tap rules as the other owner registry taps): it drops the person's old keys,
// binds the reset link, and takes the re-enrolled keys only through that link while it is open.
describe('D-032 the owner\'s tapped security reset (lead call)', () => {
  const canRule = async (w: Awaited<ReturnType<typeof world>>, p: Person) => {
    const c = ruling(p);
    return authorize(w, c, [tapBy(p, c.intent('propose'))]);
  };

  it('after a reset, the old keys are refused', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    expect((await canRule(w, mod)).ok).toBe(true);
    resetSecurity(w, mod);
    await syncRegistry(w.api, w.gate, ctx());
    // Review p4t22 F1 (twin): `revoked`, a key the gate retired (kept only to read past signatures).
    expect(await canRule(w, mod)).toEqual({ ok: false, reason: 'revoked' });
    // Even with the API putting the old key back.
    w.api.creds.set(mod.key.credentialId, { accountId: mod.id, publicKey: new Uint8Array(mod.key.cosePublicKey), aaguid: AAGUID });
    await syncRegistry(w.api, w.gate, ctx());
    expect(await canRule(w, mod)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('the keys re-enrolled through the reset link are accepted; a key the API adds any other way is not', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const r = resetSecurity(w, mod);
    await syncRegistry(w.api, w.gate, ctx());
    expect((await canRule(w, r.again)).ok).toBe(true);
    // A key registered through the person's old (closed) invite, or only in the API's credentials.
    const stray = newKey();
    w.api.creds.set(stray.credentialId, { accountId: mod.id, publicKey: new Uint8Array(stray.cosePublicKey), aaguid: AAGUID });
    await syncRegistry(w.api, w.gate, ctx());
    expect(await canRule(w, { ...mod, key: stray })).toEqual({ ok: false, reason: 'unknown-key' });
    // A key registered with another token than the link's.
    const wrong = newKey();
    w.api.invites.get(r.inviteId)!.registrations.push(registration(wrong, sha256Hex('another token')));
    await syncRegistry(w.api, w.gate, ctx());
    expect(await canRule(w, { ...mod, key: wrong })).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('a reset without an owner tap (the API assumed compromised) is refused: no new key, the gate keeps its own', async () => {
    for (const tap of [false, 'senior'] as const) {
      const w = await world();
      const mod = w.hire('mod');
      const senior = w.hire('senior');
      await syncRegistry(w.api, w.gate, ctx());
      const r = resetSecurity(w, mod, { tap: tap === false ? false : senior });
      await syncRegistry(w.api, w.gate, ctx());
      expect(await canRule(w, r.again), String(tap)).toEqual({ ok: false, reason: 'unknown-key' });
      // The gate never dropped what it verified itself (the API's deletion is only the API's word).
      expect((await canRule(w, mod)).ok, String(tap)).toBe(true);
    }
    // An owner tap for another person, or another link, resets nobody else.
    const w = await world();
    const mod = w.hire('mod');
    const other = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const r = resetSecurity(w, mod, { tap: false });
    w.api.taps.push(tapBy(w.owner, { kind: 'reset-staff-security', accountId: other.id, inviteId: r.inviteId, tokenHash: r.tokenHash, expiresAt: '2026-11-13T12:00:00.000Z' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect(await canRule(w, r.again)).toEqual({ ok: false, reason: 'unknown-key' });
    expect((await canRule(w, mod)).ok).toBe(true);
  });

  it('the reset link cannot be replayed: not after it finished or expired, not for another person, not as an invite', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const other = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const r = resetSecurity(w, mod);
    await syncRegistry(w.api, w.gate, ctx());
    expect((await canRule(w, r.again)).ok).toBe(true);
    // The link finished: a key registered on it afterwards is never taken.
    w.api.invites.get(r.inviteId)!.used = true;
    await syncRegistry(w.api, w.gate, ctx());
    const late = newKey();
    w.api.invites.get(r.inviteId)!.registrations.push(registration(late, r.tokenHash));
    w.api.invites.get(r.inviteId)!.used = false; // the API pretends it is open again
    await syncRegistry(w.api, w.gate, ctx());
    expect(await canRule(w, { ...mod, key: late })).toEqual({ ok: false, reason: 'unknown-key' });
    // The same link re-pointed to another person, with a fresh owner tap naming it for them.
    w.api.invites.get(r.inviteId)!.accountId = other.id;
    w.api.taps.push(tapBy(w.owner, { kind: 'reset-staff-security', accountId: other.id, inviteId: r.inviteId, tokenHash: r.tokenHash, expiresAt: '2026-11-13T12:00:00.000Z' }));
    await syncRegistry(w.api, w.gate, ctx());
    expect((await canRule(w, other)).ok).toBe(true);
    expect(await canRule(w, { ...other, key: late })).toEqual({ ok: false, reason: 'unknown-key' });
    // The link's id reused for an owner create-invite: nobody joins through it.
    const newcomer = { id: randomUUID(), key: newKey(), role: 'mod' as const };
    w.api.taps.push(tapBy(w.owner, { kind: 'create-invite', inviteId: r.inviteId, role: 'mod', tokenHash: r.tokenHash, expiresAt: '2026-11-13T12:00:00.000Z' }));
    w.api.invites.set(r.inviteId, { inviteId: r.inviteId, tokenHash: r.tokenHash, accountId: newcomer.id, registrations: [registration(newcomer.key, r.tokenHash)] });
    w.api.staffRows.set(newcomer.id, { accountId: newcomer.id, role: 'mod', switchedOff: false, removed: false });
    await syncRegistry(w.api, w.gate, ctx());
    expect(await canRule(w, newcomer)).toEqual({ ok: false, reason: 'unknown-key' });
    // An expired reset link takes no key; a newer reset closes the older link.
    const w2 = await world();
    const m2 = w2.hire('mod');
    await syncRegistry(w2.api, w2.gate, ctx());
    const expired = resetSecurity(w2, m2, { expiresAt: '2026-11-12T11:59:00.000Z' });
    await syncRegistry(w2.api, w2.gate, ctx());
    expect(await canRule(w2, expired.again)).toEqual({ ok: false, reason: 'unknown-key' });
    const first = resetSecurity(w2, m2, { register: false });
    await syncRegistry(w2.api, w2.gate, ctx());
    const second = resetSecurity(w2, m2);
    await syncRegistry(w2.api, w2.gate, ctx());
    const onFirst = newKey();
    w2.api.invites.get(first.inviteId)!.registrations.push(registration(onFirst, first.tokenHash));
    await syncRegistry(w2.api, w2.gate, ctx());
    expect(await canRule(w2, { ...m2, key: onFirst })).toEqual({ ok: false, reason: 'unknown-key' });
    expect((await canRule(w2, second.again)).ok).toBe(true);
  });

  // Disputes-stack review 2026-11-16, D-3 (the reviewer's PoC as a test): the API hides the staff
  // row, so the person never "joins" in the gate and their invite stays open; the owner's tapped
  // reset must still close it, or step 1 puts the invite's key back on every sync.
  it('D-3: a reset closes the person\'s own still-open invite: the invite\'s key never comes back', async () => {
    const w = await world();
    const mod = w.hire('mod');
    w.api.staffRows.delete(mod.id); // a compromised API: the person never joins, the invite stays open
    await syncRegistry(w.api, w.gate, ctx());
    const r = resetSecurity(w, mod);
    await syncRegistry(w.api, w.gate, ctx());
    await syncRegistry(w.api, w.gate, ctx());
    const s = w.gate.staff[mod.id]!;
    expect(s.creds.map((c) => c.credentialId)).not.toContain(mod.key.credentialId);
    expect(s.creds.map((c) => c.credentialId)).toContain(r.key.credentialId);
    expect(w.gate.invites[s.inviteId]!.closed).toBe(true);
    expect(s.inviteClosed).toBe(true);
    // A key the API registers on the old invite afterwards is not taken either.
    const old = w.api.invites.get(s.inviteId)!;
    const late = newKey();
    old.registrations.push(registration(late, old.tokenHash));
    w.api.staffRows.set(mod.id, { accountId: mod.id, role: 'mod', switchedOff: false, removed: false });
    await syncRegistry(w.api, w.gate, ctx());
    // Review p4t22 F1 (twin): the old key is retired (`revoked`), the late one never trusted.
    expect(await canRule(w, mod)).toEqual({ ok: false, reason: 'revoked' });
    expect(await canRule(w, { ...mod, key: late })).toEqual({ ok: false, reason: 'unknown-key' });
    expect((await canRule(w, r.again)).ok).toBe(true);
  });

  // D-2: the gate bounds a link's signed lifetime itself (spec 6.6: an invite link works for 24
  // hours), so a lying API cannot keep an invite or a reset link open by never reporting it used.
  it('D-2: an invite or reset link signed to stay open longer than LINK_MAX_LIFETIME_MS is refused', async () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    // An invite: 2099, and one millisecond over the bound, bring nobody in; exactly the bound does.
    for (const expiresAt of ['2099-01-01T00:00:00.000Z', at(LINK_MAX_LIFETIME_MS + 1)]) {
      const w = await world();
      const mod = w.hire('mod', { expiresAt });
      await syncRegistry(w.api, w.gate, ctx());
      expect(w.gate.staff[mod.id], expiresAt).toBeUndefined();
      expect(await canRule(w, mod), expiresAt).toEqual({ ok: false, reason: 'unknown-key' });
    }
    {
      const w = await world();
      const mod = w.hire('mod', { expiresAt: at(LINK_MAX_LIFETIME_MS) });
      await syncRegistry(w.api, w.gate, ctx());
      expect((await canRule(w, mod)).ok).toBe(true);
    }
    // A reset link: refused, so no key is ever taken through it (review PoC R6).
    for (const expiresAt of ['2099-01-01T00:00:00.000Z', at(LINK_MAX_LIFETIME_MS + 1)]) {
      const w = await world();
      const mod = w.hire('mod');
      await syncRegistry(w.api, w.gate, ctx());
      const r = resetSecurity(w, mod, { expiresAt });
      await syncRegistry(w.api, w.gate, ctx());
      expect(await canRule(w, r.again), expiresAt).toEqual({ ok: false, reason: 'unknown-key' });
      expect(Object.hasOwn(w.gate.resets, r.inviteId), expiresAt).toBe(false);
    }
    {
      const w = await world();
      const mod = w.hire('mod');
      await syncRegistry(w.api, w.gate, ctx());
      const r = resetSecurity(w, mod, { expiresAt: at(LINK_MAX_LIFETIME_MS) });
      await syncRegistry(w.api, w.gate, ctx());
      expect((await canRule(w, r.again)).ok).toBe(true);
    }
  });

  it('D-2: a link the gate bound earlier closes LINK_MAX_LIFETIME_MS after its issuedAt, whatever its signed expiry', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const r = resetSecurity(w, mod, { register: false });
    await syncRegistry(w.api, w.gate, ctx());
    // As a gate.bin from before the bound holds it: the link bound, its tap spent, a 2099 expiry signed.
    w.api.taps = w.api.taps.filter((t) => (JSON.parse(t.intent) as { inviteId?: string }).inviteId !== r.inviteId);
    const long = tapBy(w.owner, { kind: 'reset-staff-security', accountId: mod.id, inviteId: r.inviteId, tokenHash: r.tokenHash, expiresAt: '2099-01-01T00:00:00.000Z' });
    w.api.taps.push(long);
    w.gate.usedNonces[long.nonceHex] = `reset:${r.inviteId}`;
    const later: GateContext = { ...ctx(), now: () => new Date(NOW.getTime() + LINK_MAX_LIFETIME_MS) };
    const key = newKey();
    w.api.invites.get(r.inviteId)!.registrations.push(registration(key, r.tokenHash));
    await syncRegistry(w.api, w.gate, later);
    expect(w.gate.resets[r.inviteId]!.closed).toBe(true);
    expect(w.gate.staff[mod.id]!.creds.map((c) => c.credentialId)).not.toContain(key.credentialId);
  });
});

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
    const terms = { deal: { poster: 'seller' as const, takeAmountAtomic: AMOUNT.toString(), currency: 'USD', centsPerXmr: '16500', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }, payWindowMin: 90, buyerPayout: BUYER, sellerRefund: SELLER };
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
    const r = recordedTerms({ terms, trade: { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE, payrollWallet: PAYROLL });
    // 0.25 XMR at $165.00: $41.25, rounded up to the cent.
    expect(r).toEqual({ ...recorded(4_125n) });
    // Not US dollars: no value of its own, so every ruling on it needs a second person.
    expect(recordedTerms({ terms: { ...terms, deal: { ...terms.deal, currency: 'EUR' } }, trade: { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE, payrollWallet: PAYROLL }).usdCents).toBeNull();
    // A part cent rounds up (toward needing a second approval at the limit).
    expect(recordedTerms({ terms: { ...terms, deal: { ...terms.deal, centsPerXmr: '16501' } }, trade: { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller' }, feeWallet: FEE, payrollWallet: PAYROLL }).usdCents).toBe(4_126n);
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
  let owner: pg.Pool;
  let reader: pg.Pool;
  let schema: ApiSchema;

  beforeAll(async () => {
    schema = await apiSchemaDb('x2f_mod_g');
    ({ owner, reader } = schema);
  });
  afterAll(async () => {
    await schema?.end();
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

  it("R37's list runs to the trade's latest appeal by the log's numeric order, across a digit boundary (9 before 10)", async () => {
    const code = 'BCDE-FGHJ-KMNP-QRST';
    const [modId, helper, late] = [randomUUID(), randomUUID(), randomUUID()];
    const c = await owner.connect();
    try {
      await c.query('set session_replication_role = replica');
      const r1 = { id: randomUUID(), outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: modId, approver: null, needsSecond: false };
      const r2 = { id: randomUUID(), outcome: 'refund-to-seller', accountAction: { kind: 'none' }, proposer: randomUUID(), approver: null, needsSecond: false };
      await c.query(
        `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, round, ruling, round1)
         values ($1, 2, 'buyer', 'paid', '', now(), false, 'published', now(), now(), 0, 100000, 2, $2, $3)`,
        [code, JSON.stringify(r2), JSON.stringify({ ...r1, firstReplyAt: null, involved: [modId] })],
      );
      // An earlier dispute's appeal at 8, this one's at 10: as text, '10' sorts before '8', so the
      // latest appeal would be taken as 8 and the helper at 9 left out.
      for (const [id, actor, action] of [[7, modId, 'case.opened'], [8, null, 'appeal.opened'], [9, helper, 'chat.read'], [10, null, 'appeal.opened'], [11, late, 'case.opened']] as const) {
        await c.query(
          `insert into activity_log (id, at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash) values ($1, now(), $2, $3, $4, $5, $6, '{}', $7, $8)`,
          [id, actor === null ? 'system' : 'staff', actor, actor === null ? null : 'mod', code, action, Buffer.alloc(32, id - 1), Buffer.alloc(32, id)],
        );
      }
      const stored = await pgGateSource(reader).storedRulings(code);
      expect([...stored.involved].sort()).toEqual([modId, helper].sort());
      expect(stored.involved).not.toContain(late);
    } finally {
      c.release();
    }
  });

  it('review p4t22 residual (a): afterRefundCodes lists open after-refund disputes, and closed ones of the last 7 days whose ruling has no statement yet', async () => {
    const c = await owner.connect();
    const codes = { open: newTradeCode(), unsigned: newTradeCode(), signed: newTradeCode(), old: newTradeCode(), escrow: newTradeCode(), earlier: newTradeCode() };
    try {
      await c.query('set session_replication_role = replica');
      const add = async (code: string, o: { afterRefund?: boolean; status?: string; closedDaysAgo?: number; seq?: number }) => {
        const ruling = { id: randomUUID(), outcome: 'no-action', accountAction: { kind: 'none' }, proposer: randomUUID(), approver: null, needsSecond: false };
        const closed = o.status === 'closed';
        await c.query(
          `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, round, ruling, closed_at)
           values ($1, $2, 'buyer', 'paid', '', now(), $3, $4, now(), now(), 0, 100000, 1, $5, $6)`,
          [code, o.seq ?? 1, o.afterRefund ?? true, o.status ?? 'published', JSON.stringify(ruling), closed ? new Date(Date.now() - (o.closedDaysAgo ?? 0) * 86_400_000) : null],
        );
        return ruling.id;
      };
      await add(codes.open, {});
      await add(codes.unsigned, { status: 'closed', closedDaysAgo: 1 });
      const signedId = await add(codes.signed, { status: 'closed', closedDaysAgo: 1 });
      await c.query(`insert into after_refund_statements (ruling_id, code, seq, round, statement, sig) values ($1, $2, 1, 1, '{}'::jsonb, 'x')`, [signedId, codes.signed]);
      await add(codes.old, { status: 'closed', closedDaysAgo: 8 });
      await add(codes.escrow, { afterRefund: false });
      // A closed after-refund dispute that a later one on the same trade replaced: only the latest counts.
      await add(codes.earlier, { status: 'closed', closedDaysAgo: 1 });
      await add(codes.earlier, { afterRefund: false, seq: 2 });
      const listed = await pgGateSource(reader).afterRefundCodes(1000);
      expect(listed).toEqual(expect.arrayContaining([codes.open, codes.unsigned]));
      for (const not of [codes.signed, codes.old, codes.escrow, codes.earlier]) expect(listed).not.toContain(not);
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

describe('review p4t22 N1: round 1 by someone removed before its payout ran', () => {
  /** Round 1 by a moderator (approved by `approver` when given), never authorised here; then the moderator is removed. */
  async function removedRound1(o: { approver?: boolean; usdCents?: bigint } = {}) {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    const senior2 = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod, o.approver ? { approver: senior } : {});
    const r1Taps = [tapBy(mod, r1.intent('propose')), ...(o.approver ? [tapBy(senior, r1.intent('approve'))] : [])];
    w.api.staffRows.get(mod.id)!.removed = true;
    w.api.staffRows.get(mod.id)!.switchedOff = true;
    await syncRegistry(w.api, w.gate, ctx());
    return { w, mod, senior, senior2, r1, r1Taps };
  }
  const ask = (w: World, c: { ruling: GateRuling }, taps: StoredTap[], extra: Partial<Parameters<typeof authorizeRuling>[1]> = {}, usdCents: bigint | null = 41_250n) =>
    authorizeRuling(w.gate, { ruling: c.ruling, taps, recorded: recorded(usdCents), balanceAtomic: BALANCE, ...extra }, ctx());

  it("the removed moderator's own round 1 never pays: revoked, before and after an appeal used its taps", async () => {
    const { w, senior2, r1, r1Taps } = await removedRound1();
    expect(await ask(w, r1, r1Taps)).toEqual({ ok: false, reason: 'revoked' });
    const r2 = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code, outcome: 'refund-to-seller' });
    expect(await ask(w, r2, [tapBy(senior2, r2.intent('propose'))], { involved: [], round1: { ruling: r1.ruling, taps: r1Taps } })).toMatchObject({ ok: true, settle: { winner: 'seller' } });
    // Round 1 alone is still refused (now stale: the appeal decided the trade), also now that the gate knows its signers.
    expect(await ask(w, r1, r1Taps)).toEqual({ ok: false, reason: 'stale-round' });
    expect(w.gate.rulingsSeen[r1.ruling.id]).toMatchObject({ round: 1, signersOnly: true });
    // A fresh round 1 on the trade is stale: round 1 is decided by the appeal now.
    const late = ruling(senior2, { code: r1.ruling.code });
    expect(await ask(w, late, [tapBy(senior2, late.intent('propose'))])).toEqual({ ok: false, reason: 'stale-round' });
  });

  it('without round 1 given, or when it is not the round 1 the appeal names, the gate still has not seen it', async () => {
    const { w, senior2, r1, r1Taps } = await removedRound1();
    const r2 = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    const t2 = [tapBy(senior2, r2.intent('propose'))];
    expect(await ask(w, r2, t2, { involved: [] })).toEqual({ ok: false, reason: 'round1-unseen' });
    const other = ruling(senior2, { code: r1.ruling.code });
    expect(await ask(w, r2, t2, { involved: [], round1: { ruling: other.ruling, taps: [tapBy(senior2, other.intent('propose'))] } })).toEqual({ ok: false, reason: 'round1-unseen' });
    expect(w.gate.rulingsSeen[r1.ruling.id]).toBeUndefined();
    expect(w.gate.rulingsSeen[r2.ruling.id]).toBeUndefined();
  });

  it("round 1's taps are verified in full: a key the gate never trusted, a tap for something else, a missing second person", async () => {
    const { w, mod, senior, senior2, r1 } = await removedRound1();
    const r2 = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    const t2 = () => [tapBy(senior2, r2.intent('propose'))];
    // A key the removed moderator never registered.
    const forged = tapBy(mod, r1.intent('propose'), { key: newKey() });
    expect(await ask(w, r2, t2(), { involved: [], round1: { ruling: r1.ruling, taps: [forged] } })).toEqual({ ok: false, reason: 'round1-unseen' });
    // Their real key, for another outcome than the stored round 1.
    const wrong = tapBy(mod, r1.intent('propose', { outcome: 'refund-to-seller' }));
    expect(await ask(w, r2, t2(), { involved: [], round1: { ruling: r1.ruling, taps: [wrong] } })).toEqual({ ok: false, reason: 'round1-unseen' });
    // At the limit, round 1 on one tap was never a ruling the gate would act on.
    const big = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code, approver: w.owner });
    const bigTaps = [tapBy(senior2, big.intent('propose')), tapBy(w.owner, big.intent('approve'))];
    expect(await ask(w, big, bigTaps, { involved: [], round1: { ruling: r1.ruling, taps: [tapBy(mod, r1.intent('propose'))] } }, 100_000n)).toEqual({ ok: false, reason: 'round1-unseen' });
    // Someone else's tap passed off as round 1's.
    const swapped = tapBy(senior, r1.intent('propose'));
    expect(await ask(w, r2, t2(), { involved: [], round1: { ruling: r1.ruling, taps: [swapped] } })).toEqual({ ok: false, reason: 'round1-unseen' });
    expect(w.gate.rulingsSeen[r1.ruling.id]).toBeUndefined();
  });

  it("R37 still holds: round 1's approver, as verified from round 1's taps, is involved even when the log forgets them", async () => {
    const { w, senior, senior2, r1, r1Taps } = await removedRound1({ approver: true });
    const byApprover = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await ask(w, byApprover, [tapBy(senior, byApprover.intent('propose'))], { involved: [], round1: { ruling: r1.ruling, taps: r1Taps } })).toEqual({ ok: false, reason: 'involved' });
    const fine = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect((await ask(w, fine, [tapBy(senior2, fine.intent('propose'))], { involved: [], round1: { ruling: r1.ruling, taps: r1Taps } })).ok).toBe(true);
    expect(w.gate.rulingsSeen[r1.ruling.id]?.signers).toEqual(expect.arrayContaining([senior.id]));
  });

  it('a round 1 whose signer the security reset left without keys cannot be verified, and nothing widens', async () => {
    const { w, senior2, r1, r1Taps, mod } = await removedRound1();
    w.gate.staff[mod.id]!.creds = [];
    const r2 = ruling(senior2, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await ask(w, r2, [tapBy(senior2, r2.intent('propose'))], { involved: [], round1: { ruling: r1.ruling, taps: r1Taps } })).toEqual({ ok: false, reason: 'round1-unseen' });
  });
});

describe('review p4t22 F1: a ruling the gate authorised stays authorised when a signer later loses standing', () => {
  /** A round-1 ruling by a moderator (with a senior's approval above the limit), authorised by the gate. */
  async function authorisedRound1(o: { approver?: boolean } = {}) {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    const senior2 = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod, o.approver ? { approver: senior } : {});
    const taps = [tapBy(mod, r1.intent('propose')), ...(o.approver ? [tapBy(senior, r1.intent('approve'))] : [])];
    const usd = o.approver ? 500_000n : 41_250n;
    const first = await authorize(w, r1, taps, usd);
    expect(first.ok).toBe(true);
    return { w, mod, senior, senior2, r1, taps, usd, first };
  }

  it('removed, switched off or reset after it was authorised: the same taps still authorise the same payouts', async () => {
    for (const change of ['removed', 'switched-off', 'reset'] as const) {
      const x = await authorisedRound1();
      const row = x.w.api.staffRows.get(x.mod.id)!;
      if (change === 'removed') (row.removed = true), (row.switchedOff = true);
      if (change === 'switched-off') row.switchedOff = true;
      if (change === 'reset') resetSecurity(x.w, x.mod);
      await syncRegistry(x.w.api, x.w.gate, ctx());
      expect(await authorize(x.w, x.r1, x.taps, x.usd), change).toEqual(x.first);
      expect(x.w.gate.rulingsSeen[x.r1.ruling.id]?.signersOnly, change).toBeUndefined();
      if (change === 'reset') {
        // The old key is retired: kept to read past signatures, no longer among the person's keys.
        const s = x.w.gate.staff[x.mod.id]!;
        expect(s.creds.map((c) => c.credentialId)).not.toContain(x.mod.key.credentialId);
        expect(s.retiredCreds?.map((c) => c.credentialId)).toEqual([x.mod.key.credentialId]);
      }
    }
  });

  it('an approver given another role since: still authorised (roles were checked when it was)', async () => {
    const x = await authorisedRound1({ approver: true });
    x.w.api.taps.push(tapBy(x.w.owner, { kind: 'set-role', accountId: x.senior.id, role: 'mod' }));
    await syncRegistry(x.w.api, x.w.gate, ctx());
    expect(x.w.gate.staff[x.senior.id]?.role).toBe('mod');
    // A new ruling with them as approver is refused for the role, the authorised one is not.
    const fresh = ruling(x.senior2, { approver: x.senior });
    expect(await authorize(x.w, fresh, [tapBy(x.senior2, fresh.intent('propose')), tapBy(x.senior, fresh.intent('approve'))], x.usd)).toEqual({ ok: false, reason: 'approver-role' });
    expect(await authorize(x.w, x.r1, x.taps, x.usd)).toEqual(x.first);
  });

  it('the emergency stop still holds an authorised payout whose signer was removed', async () => {
    const x = await authorisedRound1();
    x.w.api.staffRows.get(x.mod.id)!.removed = true;
    x.w.api.taps.push(tapBy(x.w.owner, { kind: 'emergency-stop' }));
    await syncRegistry(x.w.api, x.w.gate, ctx());
    expect(x.w.gate.stopped).toBe(true);
    expect(await authorize(x.w, x.r1, x.taps, x.usd)).toEqual({ ok: false, reason: 'stopped' });
  });

  it('only the very taps it was authorised on: a fresh tap by a retired key, or one tap above the limit, is refused', async () => {
    const x = await authorisedRound1();
    resetSecurity(x.w, x.mod);
    await syncRegistry(x.w.api, x.w.gate, ctx());
    // The retired key tapped again for the same ruling (a new nonce the gate never bound).
    expect(await authorize(x.w, x.r1, [tapBy(x.mod, x.r1.intent('propose'))], x.usd)).toEqual({ ok: false, reason: 'revoked' });
    // Above the limit on one tap: the two-person rule (on the recorded terms) is still asked; the
    // re-check fails, so the refusal stands as the ordinary check gave it.
    expect(await authorize(x.w, x.r1, x.taps, 500_000n)).toEqual({ ok: false, reason: 'revoked' });
    expect(await authorize(x.w, x.r1, x.taps, x.usd)).toEqual(x.first);
  });

  it('finding A: the outcome re-signed on the bound nonce is refused, by a removed, switched-off, reset or active signer', async () => {
    for (const change of ['active', 'removed', 'switched-off', 'reset'] as const) {
      const x = await authorisedRound1();
      const row = x.w.api.staffRows.get(x.mod.id)!;
      if (change === 'removed') (row.removed = true), (row.switchedOff = true);
      if (change === 'switched-off') row.switchedOff = true;
      if (change === 'reset') resetSecurity(x.w, x.mod);
      await syncRegistry(x.w.api, x.w.gate, ctx());
      // Same ruling id, the other outcome, signed now by the same (kept or retired) key on the nonce the gate bound.
      const flipped = { ...x.r1, ruling: { ...x.r1.ruling, outcome: 'refund-to-seller' as const } };
      const t = tapOnNonce(x.mod, x.r1.intent('propose', { outcome: 'refund-to-seller' }), x.taps[0]!.nonceHex);
      expect(await authorize(x.w, flipped, [t], x.usd), change).toEqual({ ok: false, reason: change === 'active' ? 'replayed' : 'revoked' });
      // The record of what it was authorised on is unchanged, and the honest taps still authorise it.
      expect(await authorize(x.w, x.r1, x.taps, x.usd), change).toEqual(x.first);
    }
  });

  it('finding A: an after-refund ruling (never in a payout record) re-signed with another outcome by a retired key is refused', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod, { outcome: 'seller-sends-xmr' });
    const tap = tapBy(mod, r1.intent('propose'));
    expect(await authorize(w, r1, [tap])).toEqual({ ok: true, settle: null });
    resetSecurity(w, mod);
    await syncRegistry(w.api, w.gate, ctx());
    const flipped = { ...r1, ruling: { ...r1.ruling, outcome: 'seller-returns-fiat' as const } };
    expect(await authorize(w, flipped, [tapOnNonce(mod, r1.intent('propose', { outcome: 'seller-returns-fiat' }), tap.nonceHex)])).toEqual({ ok: false, reason: 'revoked' });
    expect(await authorize(w, r1, [tap])).toEqual({ ok: true, settle: null });
  });

  it('finding A: with two signers, the removed proposer re-signing alone on the bound nonce is refused', async () => {
    const x = await authorisedRound1({ approver: true });
    x.w.api.staffRows.get(x.mod.id)!.removed = true;
    await syncRegistry(x.w.api, x.w.gate, ctx());
    const flipped = { ...x.r1, ruling: { ...x.r1.ruling, outcome: 'refund-to-seller' as const } };
    const t = tapOnNonce(x.mod, x.r1.intent('propose', { outcome: 'refund-to-seller' }), x.taps[0]!.nonceHex);
    expect((await authorize(x.w, flipped, [t, x.taps[1]!], x.usd)).ok).toBe(false);
    expect(await authorize(x.w, x.r1, x.taps, x.usd)).toEqual(x.first);
  });

  it('m1: a round 1 read for its signers only, its signer switched back on, re-signed on its bound nonce: refused (stale, and held to its intents)', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const t1 = ruling(mod);
    const t1Tap = tapBy(mod, t1.intent('propose'));
    w.api.staffRows.get(mod.id)!.switchedOff = true;
    await syncRegistry(w.api, w.gate, ctx());
    const t2 = ruling(senior, { round: 2, round1Id: t1.ruling.id, code: t1.ruling.code });
    expect((await authorizeRuling(w.gate, { ruling: t2.ruling, taps: [tapBy(senior, t2.intent('propose'))], recorded: recorded(41_250n), balanceAtomic: BALANCE, involved: [], round1: { ruling: t1.ruling, taps: [t1Tap] } }, ctx())).ok).toBe(true);
    expect(w.gate.rulingsSeen[t1.ruling.id]).toMatchObject({ signersOnly: true, intentsSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }));
    w.api.staffRows.get(mod.id)!.switchedOff = false;
    await syncRegistry(w.api, w.gate, ctx());
    expect(w.gate.staff[mod.id]?.revoked).toBe(false);
    const flipped = { ...t1, ruling: { ...t1.ruling, outcome: 'refund-to-seller' as const } };
    const flip = tapOnNonce(mod, t1.intent('propose', { outcome: 'refund-to-seller' }), t1Tap.nonceHex);
    // The hardening: round 2 decided the trade, so round 1 is stale whatever it says.
    expect(await authorize(w, flipped, [flip])).toEqual({ ok: false, reason: 'stale-round' });
    expect(await authorize(w, t1, [t1Tap])).toEqual({ ok: false, reason: 'stale-round' });
    // And below it, the hash: even with a payout record naming round 1 (so the hardening lets it
    // through), the flipped intents are refused; the intents it was read on are not.
    w.gate.executions[normalizeTradeCode(t1.ruling.code)!] = { rulingId: t1.ruling.id, winner: 'buyer', payouts: [], recordedAt: NOW.toISOString(), settledAt: null, settledTx: null };
    expect(await authorize(w, flipped, [flip])).toEqual({ ok: false, reason: 'replayed' });
    expect((await authorize(w, t1, [t1Tap])).ok).toBe(true);
  });

  it('m2: a proposal and an approval sharing one nonce are refused up front, and nothing is bound', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod, { approver: senior });
    const tp = tapBy(mod, r1.intent('propose'));
    const ta = tapOnNonce(senior, r1.intent('approve'), tp.nonceHex);
    expect(await authorize(w, r1, [tp, ta], 500_000n)).toEqual({ ok: false, reason: 'nonce-reused' });
    expect(w.gate.usedNonces[tp.nonceHex]).toBeUndefined();
    expect(w.gate.rulingsSeen[r1.ruling.id]).toBeUndefined();
    // With its own nonce, the approval goes through, and checks the same again.
    const ta2 = tapBy(senior, r1.intent('approve'));
    const first = await authorize(w, r1, [tp, ta2], 500_000n);
    expect(first.ok).toBe(true);
    expect(await authorize(w, r1, [tp, ta2], 500_000n)).toEqual(first);
  });

  // Hash-less entries are pre-launch only (no production gate.bin exists); they fail closed.
  it('finding A: an authorised entry with no intents hash (written before it) fails closed for the re-check', async () => {
    const x = await authorisedRound1();
    expect(x.w.gate.rulingsSeen[x.r1.ruling.id]?.intentsSha256).toMatch(/^[0-9a-f]{64}$/);
    delete x.w.gate.rulingsSeen[x.r1.ruling.id]!.intentsSha256;
    x.w.api.staffRows.get(x.mod.id)!.removed = true;
    await syncRegistry(x.w.api, x.w.gate, ctx());
    expect(await authorize(x.w, x.r1, x.taps, x.usd)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('retired keys never authorise a new ruling or a new round', async () => {
    const x = await authorisedRound1();
    const oldSenior2 = { ...x.senior2 };
    resetSecurity(x.w, x.mod);
    resetSecurity(x.w, x.senior2);
    await syncRegistry(x.w.api, x.w.gate, ctx());
    // A new round 1 on another trade by the moderator's retired key.
    const fresh = ruling(x.mod);
    expect(await authorize(x.w, fresh, [tapBy(x.mod, fresh.intent('propose'))])).toEqual({ ok: false, reason: 'revoked' });
    expect(x.w.gate.rulingsSeen[fresh.ruling.id]).toBeUndefined();
    // An appeal of the authorised round 1 by the uninvolved senior's retired key.
    const r2 = ruling(oldSenior2, { round: 2, round1Id: x.r1.ruling.id, code: x.r1.ruling.code, outcome: 'refund-to-seller' });
    expect(await authorize(x.w, r2, [tapBy(oldSenior2, r2.intent('propose'))], x.usd, { involved: [] })).toEqual({ ok: false, reason: 'revoked' });
    expect(x.w.gate.rulingsSeen[r2.ruling.id]).toBeUndefined();
    // Nor as a round 1 the gate was never asked about, read for an appeal only: never authorised itself.
    const t1 = ruling(x.mod);
    const t1Taps = [tapBy(x.mod, t1.intent('propose'))];
    const t2 = ruling(x.senior, { round: 2, round1Id: t1.ruling.id, code: t1.ruling.code });
    expect((await authorizeRuling(x.w.gate, { ruling: t2.ruling, taps: [tapBy(x.senior, t2.intent('propose'))], recorded: recorded(41_250n), balanceAtomic: BALANCE, involved: [], round1: { ruling: t1.ruling, taps: t1Taps } }, ctx())).ok).toBe(true);
    expect(x.w.gate.rulingsSeen[t1.ruling.id]).toMatchObject({ signersOnly: true, signers: [x.mod.id] });
    expect(await authorize(x.w, t1, t1Taps)).toEqual({ ok: false, reason: 'stale-round' });
  });

  it("F1's twin: a round 1 never authorised whose signer was then reset is revoked (so it can be re-proposed), and its appeal reads its signer", async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const r1 = ruling(mod);
    const r1Taps = [tapBy(mod, r1.intent('propose'))];
    const r = resetSecurity(w, mod);
    await syncRegistry(w.api, w.gate, ctx());
    // Revoked, not unknown-key: the API's re-propose takes it (staffRoutes `canRePropose`).
    expect(await authorize(w, r1, r1Taps)).toEqual({ ok: false, reason: 'revoked' });
    const round1 = { ruling: r1.ruling, taps: r1Taps };
    // R37 still knows the moderator, under their new key too.
    const byMod = ruling(r.again, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code });
    expect(await authorizeRuling(w.gate, { ruling: byMod.ruling, taps: [tapBy(r.again, byMod.intent('propose'))], recorded: recorded(41_250n), balanceAtomic: BALANCE, involved: [], round1 }, ctx())).toEqual({ ok: false, reason: 'involved' });
    const r2 = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code, outcome: 'refund-to-seller' });
    expect(await authorizeRuling(w.gate, { ruling: r2.ruling, taps: [tapBy(senior, r2.intent('propose'))], recorded: recorded(41_250n), balanceAtomic: BALANCE, involved: [], round1 }, ctx())).toMatchObject({ ok: true, settle: { winner: 'seller' } });
    expect(w.gate.rulingsSeen[r1.ruling.id]).toMatchObject({ round: 1, signersOnly: true, signers: [mod.id] });
    // Round 1 itself still never pays.
    expect(await authorize(w, r1, r1Taps)).toEqual({ ok: false, reason: 'stale-round' });
  });
});

// Review B1 (lien recovery, 2026-11-16): the creditor sides the moderation service accepts for a
// recovery come only from rulings its gate verified (staff key taps), never from the API's rows.
describe('lienRulingVerifier (review B1)', () => {
  async function withStore<T>(w: Awaited<ReturnType<typeof world>>, fn: (store: Awaited<ReturnType<typeof freshGate>>) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'x2f-gate-'));
    try {
      const store = await freshGate(dir, new Uint8Array(32).fill(9));
      store.state = w.gate;
      await store.save();
      return await fn(store);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('a round-1 seller-sends-xmr ruling the gate verifies makes the buyer the creditor', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const c = ruling(mod, { outcome: 'seller-sends-xmr' });
    w.api.taps.push(tapBy(mod, c.intent('propose')));
    w.api.rulings.set(c.ruling.code, { current: c.ruling, round1: null, involved: [] });
    await withStore(w, async (store) => {
      const v = lienRulingVerifier({ store, source: w.api, ctx: ctx() });
      expect(await v.creditors(c.ruling.code, recorded(41_250n))).toEqual(['buyer']);
    });
  });

  it('a ruling the API wrote with no staff tap, or taps that do not agree, verifies nothing', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const c = ruling(mod, { outcome: 'seller-sends-xmr' });
    w.api.rulings.set(c.ruling.code, { current: c.ruling, round1: null, involved: [] });
    await withStore(w, async (store) => {
      const v = lienRulingVerifier({ store, source: w.api, ctx: ctx() });
      expect(await v.creditors(c.ruling.code, recorded(41_250n))).toBeNull();
      // A tap for another outcome.
      w.api.taps.push(tapBy(mod, c.intent('propose', { outcome: 'no-action' })));
      expect(await v.creditors(c.ruling.code, recorded(41_250n))).toBeNull();
      // No ruling at all.
      expect(await v.creditors('AAAA-BBBB-CCCC-DDDD', recorded(41_250n))).toBeNull();
    });
  });

  it('an escrow ruling overturned on appeal makes the side that lost the coins the creditor; checking pays nothing', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    const r1 = ruling(mod, { outcome: 'release-to-buyer' });
    w.api.taps.push(tapBy(mod, r1.intent('propose')));
    const r2 = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code, outcome: 'refund-to-seller' });
    w.api.taps.push(tapBy(senior, r2.intent('propose')));
    w.api.rulings.set(r1.ruling.code, { current: r2.ruling, round1: r1.ruling, involved: [] });
    await withStore(w, async (store) => {
      const v = lienRulingVerifier({ store, source: w.api, ctx: ctx() });
      expect(await v.creditors(r1.ruling.code, recorded(41_250n))).toEqual(['seller']);
      expect(store.state.executions[r1.ruling.code]).toBeUndefined();
    });
  });

  it('re-review N2, compromised API: once the gate has seen a round-2 ruling for the trade, serving round 1 alone verifies nothing', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    const r1 = ruling(mod, { outcome: 'seller-sends-xmr' });
    w.api.taps.push(tapBy(mod, r1.intent('propose')));
    const r2 = ruling(senior, { round: 2, round1Id: r1.ruling.id, code: r1.ruling.code, outcome: 'no-action' });
    w.api.taps.push(tapBy(senior, r2.intent('propose')));
    w.api.rulings.set(r1.ruling.code, { current: r2.ruling, round1: r1.ruling, involved: [] });
    await withStore(w, async (store) => {
      const v = lienRulingVerifier({ store, source: w.api, ctx: ctx() });
      // The honest view: the appeal overruled the order to pay, so the buyer is no creditor (the gate now has round 2 in rulingsSeen).
      const honest = await v.creditors(r1.ruling.code, recorded(41_250n));
      expect(honest).not.toBeNull();
      expect(honest).not.toContain('buyer');
      // The API hides the appeal: round 1 alone would name the buyer.
      w.api.rulings.set(r1.ruling.code, { current: r1.ruling, round1: null, involved: [] });
      expect(await v.creditors(r1.ruling.code, recorded(41_250n))).toBeNull();
      w.api.rulings.set(r1.ruling.code, { current: null, round1: r1.ruling, involved: [] });
      expect(await v.creditors(r1.ruling.code, recorded(41_250n))).toBeNull();
    });
  });

  it('re-review N2: a round-2 ruling the gate saw for another trade does not stop this one', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const senior = w.hire('senior');
    const o1 = ruling(mod, { outcome: 'release-to-buyer' });
    w.api.taps.push(tapBy(mod, o1.intent('propose')));
    const o2 = ruling(senior, { round: 2, round1Id: o1.ruling.id, code: o1.ruling.code, outcome: 'refund-to-seller' });
    w.api.taps.push(tapBy(senior, o2.intent('propose')));
    w.api.rulings.set(o1.ruling.code, { current: o2.ruling, round1: o1.ruling, involved: [] });
    const c = ruling(mod, { outcome: 'seller-sends-xmr' });
    w.api.taps.push(tapBy(mod, c.intent('propose')));
    w.api.rulings.set(c.ruling.code, { current: c.ruling, round1: null, involved: [] });
    await withStore(w, async (store) => {
      const v = lienRulingVerifier({ store, source: w.api, ctx: ctx() });
      expect(await v.creditors(o1.ruling.code, recorded(41_250n))).toEqual(['seller']);
      expect(await v.creditors(c.ruling.code, recorded(41_250n))).toEqual(['buyer']);
    });
  });
});

// Review M6: the gate pays the attested recovery on a ruling for the buyer, never on one for the seller.
describe('authorizeRuling with a lien recovery (review M6)', () => {
  const CREDITOR = '4'.padEnd(95, 'C');
  const R = 100_000_000_000n;
  it('release-to-buyer pays proceeds − recovery to the buyer and the recovery to the creditor; refund-to-seller pays none', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const rec = { ...recorded(41_250n), lienRecovery: { address: CREDITOR, amountAtomic: R } };
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
    const b = ruling(mod);
    expect(await authorizeRuling(w.gate, { ruling: b.ruling, taps: [tapBy(mod, b.intent('propose'))], recorded: rec, balanceAtomic: BALANCE }, ctx())).toEqual({
      ok: true,
      settle: { winner: 'buyer', payouts: [{ address: BUYER, amountAtomic: AMOUNT - R, bearsNetworkFee: true }, { address: FEE, amountAtomic: plan.feeAtomic - plan.feeAtomic / 2n, bearsNetworkFee: true }, { address: PAYROLL, amountAtomic: plan.feeAtomic / 2n, bearsNetworkFee: true }, { address: CREDITOR, amountAtomic: R, bearsNetworkFee: true }] },
    });
    const s = ruling(mod, { outcome: 'refund-to-seller' });
    expect(await authorizeRuling(w.gate, { ruling: s.ruling, taps: [tapBy(mod, s.intent('propose'))], recorded: rec, balanceAtomic: BALANCE }, ctx())).toEqual({
      ok: true,
      settle: { winner: 'seller', payouts: [{ address: SELLER, amountAtomic: BALANCE }] },
    });
  });

  it('a recovery the terms could not pay (over the cap, all of the proceeds but the buyer\'s fee floor; under 0.01 XMR; or to a party) makes the buyer\'s ruling bad-terms', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    for (const lienRecovery of [
      { address: CREDITOR, amountAtomic: lienRecoveryCap(AMOUNT) + 1n },
      { address: CREDITOR, amountAtomic: AMOUNT },
      { address: CREDITOR, amountAtomic: LIEN_RECOVERY_MIN_ATOMIC - 1n },
      { address: SELLER, amountAtomic: R },
    ]) {
      const b = ruling(mod);
      expect(await authorizeRuling(w.gate, { ruling: b.ruling, taps: [tapBy(mod, b.intent('propose'))], recorded: { ...recorded(41_250n), lienRecovery }, balanceAtomic: BALANCE }, ctx()))
        .toEqual({ ok: false, reason: 'bad-terms' });
    }
  });
});

// Owner 27 Nov 2026 (docs/lien-recovery.md "Debtor is the seller"): the seller funded extra for its
// lien; a ruling for the buyer pays it to the creditor (the buyer's payout unchanged), one for the
// seller returns it with the whole balance.
describe('authorizeRuling with a seller lien recovery (owner 27 Nov 2026)', () => {
  const CREDITOR = '4'.padEnd(95, 'K');
  const X = 100_000_000_000n;
  const withExtra = (): RecordedTerms => {
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller', sellerLienRecoveryAtomic: X });
    return { ...recorded(41_250n), sellerFundsAtomic: plan.sellerFundsAtomic, sellerLienRecovery: { address: CREDITOR, amountAtomic: X } };
  };
  it('release-to-buyer: the buyer gets the full amount, the creditor the extra; refund-to-seller: the whole balance to the seller', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
    const balance = BALANCE + X;
    const b = ruling(mod);
    expect(await authorizeRuling(w.gate, { ruling: b.ruling, taps: [tapBy(mod, b.intent('propose'))], recorded: withExtra(), balanceAtomic: balance }, ctx())).toEqual({
      ok: true,
      settle: { winner: 'buyer', payouts: [{ address: BUYER, amountAtomic: AMOUNT, bearsNetworkFee: true }, { address: FEE, amountAtomic: plan.feeAtomic - plan.feeAtomic / 2n, bearsNetworkFee: true }, { address: PAYROLL, amountAtomic: plan.feeAtomic / 2n, bearsNetworkFee: true }, { address: CREDITOR, amountAtomic: X, bearsNetworkFee: true }] },
    });
    const s = ruling(mod, { outcome: 'refund-to-seller' });
    expect(await authorizeRuling(w.gate, { ruling: s.ruling, taps: [tapBy(mod, s.intent('propose'))], recorded: withExtra(), balanceAtomic: balance }, ctx())).toEqual({
      ok: true,
      settle: { winner: 'seller', payouts: [{ address: SELLER, amountAtomic: balance }] },
    });
  });

  it('an escrow short of the extra, or an extra the terms could not pay, makes the buyer\'s ruling bad-terms', async () => {
    const w = await world();
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const b = ruling(mod);
    expect(await authorizeRuling(w.gate, { ruling: b.ruling, taps: [tapBy(mod, b.intent('propose'))], recorded: withExtra(), balanceAtomic: BALANCE }, ctx())).toEqual({ ok: false, reason: 'bad-terms' });
    for (const sellerLienRecovery of [{ address: CREDITOR, amountAtomic: AMOUNT + 1n }, { address: SELLER, amountAtomic: X }]) {
      const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller', sellerLienRecoveryAtomic: sellerLienRecovery.amountAtomic });
      const c = ruling(mod);
      expect(await authorizeRuling(w.gate, { ruling: c.ruling, taps: [tapBy(mod, c.intent('propose'))], recorded: { ...recorded(41_250n), sellerFundsAtomic: plan.sellerFundsAtomic, sellerLienRecovery }, balanceAtomic: plan.sellerFundsAtomic }, ctx()))
        .toEqual({ ok: false, reason: 'bad-terms' });
    }
  });
});

// Q1 (owner answer, 26 Nov 2026): a lien's rate other than the 100% default is signed
// only once the gate verified a senior moderator's (or the owner's) `lien-rate` key tap for it.
describe('lienRateApproved: a rate change the gate verifies itself (Q1)', () => {
  const LIEN = '6f1c1f9e-0b1a-4a51-9a1b-0c2d3e4f5a6b';
  const REQ = '7a2d2a0f-1c2b-4b62-8b2c-1d3e4f5a6b7c';
  const intent = (rateBps: number, lienId = LIEN): KeyTapIntent => ({ kind: 'lien-rate', lienId, requestId: REQ, rateBps });

  it('a senior\'s or the owner\'s tap for exactly that lien and rate approves it; its nonce is then bound to it', async () => {
    const w = await world();
    const senior = w.hire('senior');
    await syncRegistry(w.api, w.gate, ctx());
    const t = tapBy(senior, intent(9000));
    expect(await lienRateApproved(w.gate, [t], { lienId: LIEN, rateBps: 9000 }, ctx())).toBe(true);
    expect(w.gate.usedNonces[t.nonceHex]).toBe(`lien-rate:${LIEN}:9000`);
    expect(await lienRateApproved(w.gate, [tapBy(w.owner, intent(7000))], { lienId: LIEN, rateBps: 7000 }, ctx())).toBe(true);
    // Back to the 100% default (owner 26 Nov 2026) is a change too, approved the same way.
    expect(await lienRateApproved(w.gate, [tapBy(senior, intent(10_000))], { lienId: LIEN, rateBps: 10_000 }, ctx())).toBe(true);
  });

  it('refused: a moderator\'s tap, another lien or rate, a forged tap, a rate above 100%, a nonce used for anything else, no tap at all', async () => {
    const w = await world();
    const senior = w.hire('senior');
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    expect(await lienRateApproved(w.gate, [tapBy(mod, intent(9000))], { lienId: LIEN, rateBps: 9000 }, ctx())).toBe(false);
    expect(await lienRateApproved(w.gate, [tapBy(senior, intent(8000))], { lienId: LIEN, rateBps: 9000 }, ctx())).toBe(false);
    expect(await lienRateApproved(w.gate, [tapBy(senior, intent(9000, REQ))], { lienId: LIEN, rateBps: 9000 }, ctx())).toBe(false);
    // A tap an API made up: the intent changed after the key signed it.
    const forged = { ...tapBy(senior, intent(5000)), intent: canonicalJson(intent(9000)) };
    expect(await lienRateApproved(w.gate, [forged], { lienId: LIEN, rateBps: 9000 }, ctx())).toBe(false);
    expect(await lienRateApproved(w.gate, [tapBy(senior, intent(10_001))], { lienId: LIEN, rateBps: 10_001 }, ctx())).toBe(false);
    const used = tapBy(senior, intent(9000));
    w.gate.usedNonces[used.nonceHex] = 'ruling:x:propose';
    expect(await lienRateApproved(w.gate, [used], { lienId: LIEN, rateBps: 9000 }, ctx())).toBe(false);
    expect(await lienRateApproved(w.gate, [], { lienId: LIEN, rateBps: 9000 }, ctx())).toBe(false);
  });

  it('lienRateTaps lists every verified approval for the lien with its nonce (the moderation service spends each one it applies)', async () => {
    const w = await world();
    const senior = w.hire('senior');
    const mod = w.hire('mod');
    await syncRegistry(w.api, w.gate, ctx());
    const a = tapBy(senior, intent(6000));
    const b = tapBy(w.owner, intent(2500));
    const other = tapBy(senior, intent(7000, REQ));
    expect(await lienRateTaps(w.gate, [a, tapBy(mod, intent(8000)), b, other], LIEN, ctx())).toEqual([
      { rateBps: 6000, nonce: a.nonceHex },
      { rateBps: 2500, nonce: b.nonceHex },
    ]);
  });
});
