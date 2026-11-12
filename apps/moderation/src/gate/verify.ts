import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { normalizeTradeCode } from '@x2f/core';
import type { Payout } from '@x2f/escrow';
import { ESCROW_OUTCOMES, canonicalJson, tapChallenge, type AccountAction, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';
import { payoutsFor, type AttestedTerms } from '@x2f/trade';
import type { GateState, PinnedCred } from './store.js';

/**
 * Plan 4 Task 13: the ruling gate's checks. The moderator key co-signs a ruling's payout only when
 * `authorizeRuling` says so, and then only the payouts it computes itself, from the addresses and
 * amounts this process recorded at escrow setup (never a database row or the ruling).
 */

/** A finished, used security-key tap as the API stores it (`StoredTap`, apps/api `staff/keyTap.ts`). */
export interface StoredTap {
  id: string;
  accountId: string;
  /** base64url credential id of the key that answered. */
  credentialId: string;
  /** `canonicalJson` of the (normalised) intent, exactly as hashed into the challenge. */
  intent: string;
  /** The nonce, lower-case hex. Challenge = `tapChallenge(JSON.parse(intent), nonce)`. */
  nonceHex: string;
  response: AuthenticationResponseJSON;
}

/** The staff site's relying party, as the API's staff instance has it. */
export interface RelyingParty {
  origins: string[];
  rpId: string;
}

/** Which AAGUIDs the gate accepts, per account kind (the same allowlists as the API's). */
export interface GateAttestation {
  isAllowed(aaguid: string, kind: 'owner' | 'staff'): boolean;
}

export interface GateContext {
  rp: RelyingParty;
  attestation: GateAttestation;
  now: () => Date;
  /** Reasons only (`gate.refused` and the like), never keys, codes or account ids. */
  log: (e: { reason: string }) => void;
}

export type GateRefusal =
  | 'unpinned'
  | 'unknown-key'
  | 'bad-signature'
  | 'intent-mismatch'
  | 'nonce-reused'
  | 'same-person'
  | 'proposer-role'
  | 'approver-role'
  | 'needs-second'
  | 'revoked'
  | 'involved'
  | 'round1-unseen'
  | 'stopped'
  | 'bad-terms';

export type SignerRole = 'owner' | 'senior' | 'mod' | 'helper';

/** `counter`: the signature counter the key reported (`authenticatorData.signCount`), for review M1's ordering. */
export type TapCheck = { ok: true; intent: KeyTapIntent; accountId: string; role: SignerRole; credentialId: string; counter: number } | { ok: false; reason: GateRefusal };

const NONCE_HEX = /^(?:[0-9a-f]{2}){16,64}$/;

const credsOf = (g: GateState, accountId: string): { creds: PinnedCred[]; role: SignerRole } | { refused: GateRefusal } => {
  if (g.ownerAccountId !== null && accountId === g.ownerAccountId) return { creds: g.ownerCreds, role: 'owner' };
  const s = Object.hasOwn(g.staff, accountId) ? g.staff[accountId] : undefined;
  if (!s) return { refused: 'unknown-key' };
  if (s.removed || s.revoked || !s.joined) return { refused: 'revoked' };
  return { creds: s.creds, role: s.role };
};

/**
 * Verifies one tap against the gate's registry: the key must be one the gate trusts for that
 * account, the stored intent canonical, and the WebAuthn assertion valid for `tapChallenge(intent,
 * nonce)` on the staff relying party. Nothing about the tap's use is checked here.
 */
export async function verifyTap(g: GateState, tap: StoredTap, ctx: GateContext): Promise<TapCheck> {
  if (typeof tap?.accountId !== 'string' || typeof tap.credentialId !== 'string') return { ok: false, reason: 'unknown-key' };
  const who = credsOf(g, tap.accountId);
  if ('refused' in who) {
    // A revoked person with a key the gate never trusted is still an unknown key.
    if (who.refused === 'revoked') {
      const s = g.staff[tap.accountId]!;
      if (!s.creds.some((c) => c.credentialId === tap.credentialId)) return { ok: false, reason: 'unknown-key' };
    }
    return { ok: false, reason: who.refused };
  }
  const cred = who.creds.find((c) => c.credentialId === tap.credentialId);
  if (!cred) return { ok: false, reason: 'unknown-key' };
  if (tap.response?.id !== cred.credentialId || typeof tap.nonceHex !== 'string' || !NONCE_HEX.test(tap.nonceHex)) return { ok: false, reason: 'bad-signature' };
  let intent: KeyTapIntent;
  let challenge: Uint8Array;
  try {
    intent = JSON.parse(tap.intent) as KeyTapIntent;
    if (canonicalJson(intent) !== tap.intent) return { ok: false, reason: 'bad-signature' };
    challenge = tapChallenge(intent, new Uint8Array(Buffer.from(tap.nonceHex, 'hex')));
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  let counter: number;
  try {
    const v = await verifyAuthenticationResponse({
      response: tap.response,
      expectedChallenge: Buffer.from(challenge).toString('base64url'),
      expectedOrigin: ctx.rp.origins,
      expectedRPID: ctx.rp.rpId,
      expectedType: 'webauthn.get',
      credential: { id: cred.credentialId, publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')), counter: 0 },
      requireUserVerification: false,
    });
    if (!v.verified) return { ok: false, reason: 'bad-signature' };
    counter = v.authenticationInfo.newCounter;
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  return { ok: true, intent, accountId: tap.accountId, role: who.role, credentialId: cred.credentialId, counter };
}

/** The pinned credential a verified tap came from (owner or staff), or undefined. */
export function credOf(g: GateState, accountId: string, credentialId: string): PinnedCred | undefined {
  const creds = accountId === g.ownerAccountId ? g.ownerCreds : Object.hasOwn(g.staff, accountId) ? g.staff[accountId]!.creds : [];
  return creds.find((c) => c.credentialId === credentialId);
}

/**
 * Review M1: true when a tap by this key is older than one the gate has already accepted from it
 * (its counter at or below the key's high-water mark, once the key has reported any counter).
 */
export function olderThanSeen(g: GateState, accountId: string, credentialId: string, counter: number): boolean {
  const hw = credOf(g, accountId, credentialId)?.counter ?? 0;
  return hw > 0 && counter <= hw;
}

/** Raises the key's high-water mark to `counter` (never lowers it). */
export function noteCounter(g: GateState, accountId: string, credentialId: string, counter: number): void {
  const c = credOf(g, accountId, credentialId);
  if (c && counter > (c.counter ?? 0)) c.counter = counter;
}

/** What this process recorded for a trade at escrow setup (its attestation and its own trade), never the API's row. */
export interface RecordedTerms {
  amountAtomic: bigint;
  feeAtomic: bigint;
  sellerFundsAtomic: bigint;
  poster: 'buyer' | 'seller';
  buyerPayout: string;
  sellerRefund: string;
  feeWallet: string;
  /**
   * The trade's US-dollar value in cents, from the deal this process attested (a US-dollar deal
   * only: amount × locked rate, rounded up). Null when the deal is in another currency: the
   * attestation carries no US-dollar rate, so the gate has no value of its own and every ruling on
   * that trade needs a second person (fails toward the two-person rule; lead default, see the report).
   */
  usdCents: bigint | null;
}

const ATOMIC_PER_XMR = 1_000_000_000_000n;

/** The recorded terms from this process's attested terms and its own trade (the desk's shadow trade). */
export function recordedTerms(a: {
  terms: AttestedTerms;
  trade: { amountAtomic: bigint; feeAtomic: bigint; sellerFundsAtomic: bigint; poster: 'buyer' | 'seller' };
  feeWallet: string;
}): RecordedTerms {
  const { deal } = a.terms;
  // Review I3: the trade is the deal this process attested (it may only grow, spec 11.1).
  if (a.trade.poster !== deal.poster) throw new RangeError('recordedTerms: the poster is not the attested one');
  if (a.trade.amountAtomic < BigInt(deal.takeAmountAtomic)) throw new RangeError('recordedTerms: the amount is below the attested take amount');
  const usdCents = deal.currency === 'USD' ? (a.trade.amountAtomic * BigInt(deal.centsPerXmr) + ATOMIC_PER_XMR - 1n) / ATOMIC_PER_XMR : null;
  return {
    amountAtomic: a.trade.amountAtomic,
    feeAtomic: a.trade.feeAtomic,
    sellerFundsAtomic: a.trade.sellerFundsAtomic,
    poster: a.trade.poster,
    buyerPayout: a.terms.buyerPayout,
    sellerRefund: a.terms.sellerRefund,
    feeWallet: a.feeWallet,
    usdCents,
  };
}

/** The ruling as the API stored it (the dispute machine's draft, plus the published reason's SHA-256). */
export interface GateRuling {
  id: string;
  code: string;
  round: 1 | 2;
  outcome: RulingOutcome;
  accountAction: AccountAction;
  proposer: string;
  approver: string | null;
  reasonSha256: string;
  /** Round 2 only: the round-1 ruling it reviews (R37). */
  round1Id?: string;
}

export interface RulingInput {
  ruling: GateRuling;
  taps: StoredTap[];
  recorded: RecordedTerms;
  /** The escrow's whole balance, as this process's party reads it (balance == unlocked). */
  balanceAtomic: bigint;
  /** Round 2: the staff with an activity-log entry on round 1 (R37), from the log. The gate adds round 1's signers itself. */
  involved?: readonly string[];
}

export type Authorization =
  | { ok: true; settle: { payouts: Payout[]; winner: 'buyer' | 'seller' } | null }
  | { ok: false; reason: GateRefusal };

const PROPOSERS: ReadonlySet<SignerRole> = new Set(['owner', 'senior', 'mod']);
const APPROVERS: ReadonlySet<SignerRole> = new Set(['owner', 'senior']);
const refuse = (reason: GateRefusal): Authorization => ({ ok: false, reason });

/** True when the trade needs a second person: by the gate's own recorded value and limit, or for any account action. */
export function gateNeedsSecond(g: GateState, recorded: RecordedTerms, action: AccountAction): boolean {
  return recorded.usdCents === null || recorded.usdCents >= g.limitUsdCents || action.kind !== 'none';
}

/**
 * Decides whether the moderator key may act on a ruling, and what it may co-sign. In order:
 * - the owner is pinned (`unpinned`) and has not tapped the emergency stop (`stopped`);
 * - one proposal tap and at most one approval tap, each verified against the registry
 *   (`unknown-key`, `revoked`, `bad-signature`), each a `ruling` intent (`intent-mismatch`), whose
 *   nonce was never used for anything else (`nonce-reused`);
 * - both intents agree with the stored ruling (id, code, round, outcome, account action, the
 *   reason's SHA-256, round 2's `round1Id`, proposer and approver) and with the XMR amount recorded
 *   here (`intent-mismatch`);
 * - the proposer is a moderator, a senior moderator or the owner (`proposer-role`);
 * - at or above the gate's own limit, by its own recorded value, or with any account action: an
 *   approval by another person (`needs-second`, `same-person`), a senior moderator or the owner
 *   (`approver-role`);
 * - an appeal ruling reviews a round 1 this gate itself authorised on the same trade
 *   (`round1-unseen`), and its proposer and approver had no part in it (`involved`, R37): round 1's
 *   signers as this gate saw them, plus anyone on the log's list (which can only add);
 * - the payouts, for a round-1 escrow outcome only, from `payoutsFor` on the recorded terms
 *   (`bad-terms` when they do not make a payout). Round 2 and after-refund rulings are authorised
 *   with nothing to co-sign: round 1 pays once, and an overturn is a lien (Task 25).
 * On success the taps' nonces are bound to this ruling and the ruling is recorded in `rulingsSeen`
 * (the caller saves the gate). Checking the same ruling again with the same taps succeeds again.
 */
export async function authorizeRuling(g: GateState, r: RulingInput, ctx: GateContext): Promise<Authorization> {
  if (g.ownerAccountId === null || g.ownerCreds.length < 2) return refuse('unpinned');
  if (g.stopped) return refuse('stopped');
  if (!Array.isArray(r.taps) || r.taps.length < 1 || r.taps.length > 2) return refuse('intent-mismatch');
  const checked: Array<Extract<TapCheck, { ok: true }> & { nonceHex: string }> = [];
  // Review B2: the round-1 ruling a round-2 ruling reviews, as the taps must name it.
  const round1Id = r.ruling.round === 2 ? (r.ruling.round1Id ?? null) : null;
  for (const tap of r.taps) {
    const c = await verifyTap(g, tap, ctx);
    if (!c.ok) return refuse(c.reason);
    checked.push({ ...c, nonceHex: tap.nonceHex });
  }
  const rul = r.ruling;
  const steps: Array<{ step: 'propose' | 'approve'; accountId: string; role: SignerRole; nonceHex: string }> = [];
  for (const c of checked) {
    if (c.intent.kind !== 'ruling') return refuse('intent-mismatch');
    const bound = Object.hasOwn(g.usedNonces, c.nonceHex) ? g.usedNonces[c.nonceHex] : undefined;
    if (bound !== undefined && bound !== `ruling:${rul.id}:${c.intent.step}`) return refuse('nonce-reused');
    steps.push({ step: c.intent.step, accountId: c.accountId, role: c.role, nonceHex: c.nonceHex });
  }
  const code = typeof rul.code === 'string' ? normalizeTradeCode(rul.code) : null;
  if (code === null) return refuse('intent-mismatch');
  for (const c of checked) {
    const i = c.intent as Extract<KeyTapIntent, { kind: 'ruling' }>;
    const agrees =
      i.rulingId === rul.id &&
      i.code === code &&
      i.round === rul.round &&
      i.outcome === rul.outcome &&
      canonicalJson(i.accountAction) === canonicalJson(rul.accountAction) &&
      i.reasonSha256 === rul.reasonSha256 &&
      i.round1Id === round1Id &&
      i.amountAtomic === r.recorded.amountAtomic.toString();
    if (!agrees) return refuse('intent-mismatch');
  }
  const proposals = steps.filter((s) => s.step === 'propose');
  const approvals = steps.filter((s) => s.step === 'approve');
  if (proposals.length !== 1 || approvals.length > 1) return refuse('intent-mismatch');
  const proposer = proposals[0]!;
  const approver = approvals[0] ?? null;
  if (proposer.accountId !== rul.proposer) return refuse('intent-mismatch');
  if (approver !== null && approver.accountId !== rul.approver) return refuse('intent-mismatch');
  if (!PROPOSERS.has(proposer.role)) return refuse('proposer-role');
  const needs = gateNeedsSecond(g, r.recorded, rul.accountAction);
  if (needs && approver === null) return refuse('needs-second');
  if (approver !== null) {
    if (approver.accountId === proposer.accountId) return refuse('same-person');
    if (!APPROVERS.has(approver.role)) return refuse('approver-role');
  }
  if (rul.round === 2) {
    if (typeof rul.round1Id !== 'string' || rul.round1Id === rul.id) return refuse('intent-mismatch');
    // Review B2: R37 rests on round 1 as this gate authorised it (same trade, round 1), never on
    // the database alone; the log's list can only add people to it.
    const r1 = Object.hasOwn(g.rulingsSeen, rul.round1Id) ? g.rulingsSeen[rul.round1Id] : undefined;
    if (r1 === undefined || r1.code !== code || r1.round !== 1) return refuse('round1-unseen');
    const involved = new Set([...r1.signers, ...(r.involved ?? [])]);
    if (involved.has(proposer.accountId) || (approver !== null && involved.has(approver.accountId))) return refuse('involved');
  }
  let settle: { payouts: Payout[]; winner: 'buyer' | 'seller' } | null = null;
  if (rul.round === 1 && (ESCROW_OUTCOMES as readonly string[]).includes(rul.outcome)) {
    const winner = rul.outcome === 'release-to-buyer' ? 'buyer' : 'seller';
    try {
      const payouts = payoutsFor({
        kind: winner === 'buyer' ? 'dispute-buyer' : 'dispute-seller',
        amountAtomic: r.recorded.amountAtomic,
        feeAtomic: r.recorded.feeAtomic,
        sellerFundsAtomic: r.recorded.sellerFundsAtomic,
        poster: r.recorded.poster,
        balanceAtomic: r.balanceAtomic,
        buyerPayout: r.recorded.buyerPayout,
        sellerRefund: r.recorded.sellerRefund,
        feeWallet: r.recorded.feeWallet,
      });
      settle = { payouts, winner };
    } catch {
      return refuse('bad-terms');
    }
  }
  for (const s of steps) g.usedNonces[s.nonceHex] = `ruling:${rul.id}:${s.step}`;
  for (const c of checked) noteCounter(g, c.accountId, c.credentialId, c.counter);
  const seen = Object.hasOwn(g.rulingsSeen, rul.id) ? g.rulingsSeen[rul.id] : undefined;
  g.rulingsSeen[rul.id] = {
    code,
    round: rul.round,
    signers: [proposer.accountId, ...(approver !== null ? [approver.accountId] : [])],
    publishedSeenAt: seen?.publishedSeenAt ?? ctx.now().toISOString(),
    ...(seen?.firstSeenFinalAt !== undefined ? { firstSeenFinalAt: seen.firstSeenFinalAt } : {}),
  };
  return { ok: true, settle };
}
