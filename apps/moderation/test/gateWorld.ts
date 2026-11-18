// Shared fixtures for the ruling gate's tests (Plan 4 Tasks 13 and 14): software authenticators
// with real WebAuthn signatures and packed attestation, an in-memory API database as the gate reads
// it (everything a compromised API could write), and ruling cases with their taps. Not a test file.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { canonicalJson, evidenceSha256, inviteRegistrationChallenge, tapChallenge, type AccountAction, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';
import { escrowPlan } from '@x2f/trade';
import { expect } from 'vitest';
import { createSoftAuthenticator, createTestCa, type SoftAuthenticator, type TestCa } from '../../api/test/helpers/softAuthenticator.js';
import {
  authorizeRuling,
  emptyGate,
  initGate,
  pinOwner,
  type GateContext,
  type GateRuling,
  type GateSource,
  type GateState,
  type RecordedTerms,
  type StoredRulings,
  type StoredTap,
} from '../src/gate/index.js';

export const ORIGIN = 'https://staff.x2f.test';
export const RP_ID = 'staff.x2f.test';
export const AAGUID = '11111111-2222-4333-8444-555555555555';
export const OTHER_AAGUID = '99999999-2222-4333-8444-555555555555';
export const NOW = new Date('2026-11-12T12:00:00Z');
export const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
export const sha256Hex = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

let testCa: TestCa | undefined;
/** One test CA for every attested soft key (made on first use). */
export const ca = (): TestCa => (testCa ??= createTestCa());

export const ctx = (): GateContext => ({
  rp: { origins: [ORIGIN], rpId: RP_ID },
  attestation: { isAllowed: (aaguid, kind) => aaguid === AAGUID && (kind === 'staff' || kind === 'owner') },
  now: () => NOW,
  log: () => {},
});

export const newKey = (o: { attest?: 'x5c' | 'self' | 'none'; aaguid?: string } = {}): SoftAuthenticator =>
  createSoftAuthenticator({
    backedUp: false,
    userVerified: true,
    attestation:
      o.attest === 'none' ? 'none' : o.attest === 'self' ? { aaguid: o.aaguid ?? AAGUID, self: true } : { aaguid: o.aaguid ?? AAGUID, ca: ca() },
  });

export interface Person {
  id: string;
  key: SoftAuthenticator;
  role: 'owner' | 'senior' | 'mod' | 'helper';
}

/** The API's database as the gate reads it, in memory: everything here is what a compromised API could write. */
export class FakeApi implements GateSource {
  owner: { accountId: string; keys: Array<{ credentialId: string; publicKey: Uint8Array; aaguid: string | null }> } | null = null;
  taps: StoredTap[] = [];
  creds = new Map<string, { accountId: string; publicKey: Uint8Array; aaguid: string | null }>();
  invites = new Map<string, { inviteId: string; tokenHash: string; accountId: string | null; used?: boolean; registrations: Array<{ credentialId: string; response: unknown }> }>();
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
  /** Task 14: the rulings `pgGateSource.storedRulings` would read, per trade code. */
  rulings = new Map<string, StoredRulings>();
  async storedRulings(code: string): Promise<StoredRulings> {
    return this.rulings.get(code) ?? { current: null, round1: null, involved: [] };
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
export const STAMPED: readonly string[] = ['create-invite', 'set-role', 'switch-on', 'settings', 'add-owner-key', 'remove-staff', 'emergency-stop', 'resume-trading', 'reset-staff-security', 'certify-device', 'revoke-device'];
export function tapBy(p: Person, intent: KeyTapIntent, o: { key?: SoftAuthenticator; issuedAt?: Date | null } = {}): StoredTap {
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

/** A key registration as a staff invite page makes it: the challenge is `inviteRegistrationChallenge(tokenHash)`. */
export function registration(key: SoftAuthenticator, tokenHash: string): { credentialId: string; response: unknown } {
  const response = key.register(
    {
      challenge: b64url(inviteRegistrationChallenge(tokenHash)),
      rp: { id: RP_ID, name: 'X2F Staff' },
      user: { id: b64url(randomBytes(16)), name: 'x', displayName: 'x' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      attestation: 'direct',
    },
    ORIGIN,
  );
  return { credentialId: key.credentialId, response };
}

/**
 * D-032 as the API does it (apps/api staff/invites.ts reset-security): the person's credentials
 * deleted, a `kind = 'reset'` invite for their existing account, and (`register`) a new key
 * registered through it. `tap`: the owner's tapped `reset-staff-security` (by `tapBy` someone else
 * when given a person; none with false). Returns the new key and the link's id and token hash.
 */
export function resetSecurity(w: World, p: Person, o: { tap?: boolean | Person; register?: boolean; inviteId?: string; expiresAt?: string } = {}) {
  const key = newKey();
  const inviteId = o.inviteId ?? randomUUID();
  const tokenHash = sha256Hex(randomBytes(32).toString('base64url'));
  const intent: KeyTapIntent = { kind: 'reset-staff-security', accountId: p.id, inviteId, tokenHash, expiresAt: o.expiresAt ?? '2026-11-13T12:00:00.000Z' };
  if (o.tap !== false) w.api.taps.push(tapBy(o.tap === undefined || o.tap === true ? w.owner : o.tap, intent));
  for (const [id, c] of w.api.creds) if (c.accountId === p.id) w.api.creds.delete(id);
  w.api.invites.set(inviteId, { inviteId, tokenHash, accountId: p.id, registrations: o.register === false ? [] : [registration(key, tokenHash)] });
  if (o.register !== false) w.api.creds.set(key.credentialId, { accountId: p.id, publicKey: new Uint8Array(key.cosePublicKey), aaguid: AAGUID });
  return { key, inviteId, tokenHash, again: { ...p, key } as Person };
}

export interface World {
  api: FakeApi;
  gate: GateState;
  owner: Person;
  ownerKey2: SoftAuthenticator;
  /** Invites a staff member the proper way: an owner `create-invite` tap and an attested registration. */
  hire(role: 'senior' | 'mod' | 'helper', o?: { attest?: 'x5c' | 'self' | 'none'; aaguid?: string; noTap?: boolean; wrongToken?: boolean; expiresAt?: string }): Person;
}

export async function world(): Promise<World> {
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
    const intent: KeyTapIntent = { kind: 'create-invite', inviteId, role, tokenHash, expiresAt: o.expiresAt ?? '2026-11-13T12:00:00.000Z' };
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

export const BUYER = '4'.padEnd(95, 'B');
export const SELLER = '8'.padEnd(95, 'S');
export const FEE = '5'.repeat(95);
export const AMOUNT = 250_000_000_000n;

export function recorded(usdCents: bigint | null): RecordedTerms {
  const plan = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' });
  return { amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: 'seller', buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, usdCents };
}
export const BALANCE = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' }).sellerFundsAtomic;
export const NONE: AccountAction = { kind: 'none' };
export const REASON = 'The buyer showed a bank statement with the payment and the seller did not answer.';
export const EVIDENCE = ['Bank statement, 11 Nov', 'No reply from the seller for 30 hours'];

export interface Case {
  ruling: GateRuling;
  intent(step: 'propose' | 'approve', over?: Partial<Extract<KeyTapIntent, { kind: 'ruling' }>>): KeyTapIntent;
}

export function ruling(proposer: Person, o: { approver?: Person | null; outcome?: RulingOutcome; round?: 1 | 2; round1Id?: string; code?: string } = {}): Case {
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

export const authorize = (w: World, c: Case, taps: StoredTap[], usdCents: bigint | null = 41_250n, extra: { involved?: string[] } = {}) =>
  authorizeRuling(w.gate, { ruling: c.ruling, taps, recorded: recorded(usdCents), balanceAtomic: BALANCE, ...extra }, ctx());

/** A new gate.bin in `dir`, the way an operator makes one (init-gate, "yes"): a missing one never opens. */
export async function newGate(dir: string, key: Uint8Array): Promise<void> {
  expect(await initGate({ dir, keystoreKey: key, print: () => {}, confirm: async () => 'yes' })).toBe('created');
}

