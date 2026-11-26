import { createHash } from 'node:crypto';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { normalizeTradeCode } from '@x2f/core';
import type { Payout } from '@x2f/escrow';
import { ESCROW_OUTCOMES, canonicalJson, gateUsdCents, tapChallenge, twoPersonRule, type AccountAction, type GateRefusal as StaffGateRefusal, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';
import { attestedRecovery, payoutsFor, type AttestedTerms } from '@x2f/trade';
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

/** Review p4t22 M1 (d): the list lives in @x2f/staff (`GATE_REFUSALS`), so the API can take the gate's reports. */
export type GateRefusal = StaffGateRefusal;

export type SignerRole = 'owner' | 'senior' | 'mod' | 'helper';

/** `counter`: the signature counter the key reported (`authenticatorData.signCount`), for review M1's ordering. */
export type TapCheck = { ok: true; intent: KeyTapIntent; accountId: string; role: SignerRole; credentialId: string; counter: number } | { ok: false; reason: GateRefusal };

const NONCE_HEX = /^(?:[0-9a-f]{2}){16,64}$/;

/**
 * `pastSigner` (review p4t22 N1): also the keys the gate keeps for someone it trusted and has since
 * switched off or removed (never someone who had not joined), and (review p4t22 F1, twin) the keys
 * a security reset retired (`retiredCreds`). Only for reading who signed a ruling: a round 1 an
 * appeal reviews (R37), or a ruling this gate already authorised (`authorizeRuling`), never for
 * authorising anything new.
 * Review p4t22 F1, finding B (known, accepted): a retired key may be lost or stolen, so R37 can read
 * a round 1 its holder forged after the reset (with a compromised API presenting it as the round 1
 * the appeal names). That only changes who counts as involved in round 1, and the log's list can
 * only add to it; the forged round 1 is `signersOnly`, never pays, and round 2 still needs real
 * taps by staff in good standing.
 */
const credsOf = (g: GateState, accountId: string, pastSigner = false): { creds: PinnedCred[]; role: SignerRole } | { refused: GateRefusal } => {
  if (g.ownerAccountId !== null && accountId === g.ownerAccountId) return { creds: g.ownerCreds, role: 'owner' };
  const s = Object.hasOwn(g.staff, accountId) ? g.staff[accountId] : undefined;
  if (!s) return { refused: 'unknown-key' };
  if (!s.joined) return { refused: 'revoked' };
  if ((s.removed || s.revoked) && !pastSigner) return { refused: 'revoked' };
  return { creds: pastSigner ? [...s.creds, ...(s.retiredCreds ?? [])] : s.creds, role: s.role };
};

/** Review p4t22 F1 (twin): a key this gate trusted for the person once, and retired at their security reset. */
const retired = (g: GateState, accountId: string, credentialId: string): boolean =>
  accountId !== g.ownerAccountId && Object.hasOwn(g.staff, accountId) && (g.staff[accountId]!.retiredCreds ?? []).some((c) => c.credentialId === credentialId);

/**
 * Verifies one tap against the gate's registry: the key must be one the gate trusts for that
 * account, the stored intent canonical, and the WebAuthn assertion valid for `tapChallenge(intent,
 * nonce)` on the staff relying party. Nothing about the tap's use is checked here.
 */
export async function verifyTap(g: GateState, tap: StoredTap, ctx: GateContext, o: { pastSigner?: boolean } = {}): Promise<TapCheck> {
  if (typeof tap?.accountId !== 'string' || typeof tap.credentialId !== 'string') return { ok: false, reason: 'unknown-key' };
  const who = credsOf(g, tap.accountId, o.pastSigner === true);
  if ('refused' in who) {
    // A revoked person with a key the gate never trusted is still an unknown key.
    if (who.refused === 'revoked') {
      const s = g.staff[tap.accountId]!;
      if (!s.creds.some((c) => c.credentialId === tap.credentialId) && !retired(g, tap.accountId, tap.credentialId)) return { ok: false, reason: 'unknown-key' };
    }
    return { ok: false, reason: who.refused };
  }
  const cred = who.creds.find((c) => c.credentialId === tap.credentialId);
  // Review p4t22 F1 (twin): a key retired at the person's security reset is `revoked`, as a
  // switched-off person's key is (so a round 1 it signed can be re-proposed or appealed), never
  // `unknown-key`, and it never verifies here. The gate cannot date a ruling tap, so it says this
  // of any tap by the retired key; that only ever names who signed, it authorises nothing.
  if (!cred) return { ok: false, reason: retired(g, tap.accountId, tap.credentialId) ? 'revoked' : 'unknown-key' };
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
      requireUserVerification: true,
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
  /** Lien recovery from this process's own attested terms (docs/lien-recovery.md); absent: none. */
  lienRecovery?: { address: string; amountAtomic: bigint };
}

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
  // Review p4t22 M1: the one rule the API uses too (@x2f/staff `gateUsdCents`).
  const usdCents = gateUsdCents({ currency: deal.currency, amountAtomic: a.trade.amountAtomic, centsPerXmr: BigInt(deal.centsPerXmr) });
  return {
    amountAtomic: a.trade.amountAtomic,
    feeAtomic: a.trade.feeAtomic,
    sellerFundsAtomic: a.trade.sellerFundsAtomic,
    poster: a.trade.poster,
    buyerPayout: a.terms.buyerPayout,
    sellerRefund: a.terms.sellerRefund,
    feeWallet: a.feeWallet,
    usdCents,
    ...(a.terms.lienRecovery !== undefined ? { lienRecovery: attestedRecovery(a.terms)! } : {}),
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
  /** `evidenceSha256(lines)` (@x2f/staff) of the evidence lines the ruling stores, as the API rebuilds it. */
  evidenceSha256: string;
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
  /**
   * Review p4t22 N1, round 2 only: the round-1 ruling it reviews and that ruling's stored taps. Read
   * only when the gate has not seen round 1 (`round1-unseen` otherwise), to learn round 1's signers
   * for R37: see `authorizeRuling`.
   */
  round1?: { ruling: GateRuling; taps: StoredTap[] };
  /**
   * Review B1 (lien recovery): only whether the ruling is authorised (its taps, its signers), as the
   * moderation service checks a recovery's source trade; no payout is worked out (`settle: null`),
   * so the balance is not read. Everything else, nonces and `rulingsSeen` included, is as for a settle.
   */
  verifyOnly?: boolean;
}

export type Authorization =
  | { ok: true; settle: { payouts: Payout[]; winner: 'buyer' | 'seller' } | null }
  | { ok: false; reason: GateRefusal };

const PROPOSERS: ReadonlySet<SignerRole> = new Set(['owner', 'senior', 'mod']);
const APPROVERS: ReadonlySet<SignerRole> = new Set(['owner', 'senior']);
const refuse = (reason: GateRefusal): Authorization => ({ ok: false, reason });

/** True when the trade needs a second person: by the gate's own recorded value and limit, or for any account action. */
export function gateNeedsSecond(g: GateState, recorded: RecordedTerms, action: AccountAction): boolean {
  // Review p4t22 M1: the same rule the API's dispute machine applies (`needsSecond` calls it too).
  return twoPersonRule({ usdCents: recorded.usdCents, limitUsdCents: g.limitUsdCents }, action);
}

/**
 * Decides whether the moderator key may act on a ruling, and what it may co-sign. In order:
 * - the owner is pinned (`unpinned`) and has not tapped the emergency stop (`stopped`);
 * - one proposal tap and at most one approval tap, each verified against the registry
 *   (`unknown-key`, `revoked`, `bad-signature`), each a `ruling` intent (`intent-mismatch`), whose
 *   nonce was never used for anything else (`nonce-reused`);
 * - both intents agree with the stored ruling (id, code, round, outcome, account action, the
 *   reason's SHA-256, the evidence lines' `evidenceSha256`, round 2's `round1Id`, proposer and approver) and with the XMR amount recorded
 *   here (`intent-mismatch`);
 * - the proposer is a moderator, a senior moderator or the owner (`proposer-role`);
 * - at or above the gate's own limit, by its own recorded value, or with any account action: an
 *   approval by another person (`needs-second`, `same-person`), a senior moderator or the owner
 *   (`approver-role`);
 * - Haveno review 2026-11-12, finding 2 (lead call): a ruling this gate authorised is only ever
 *   accepted again for its own trade and round (`replayed`), and rounds only move forward: a ruling
 *   the gate has not authorised, for a round below or equal to the highest it authorised on the
 *   trade, is refused (`stale-round`; round 1 as authorised still pays while an appeal is pending; review p4t22
 *   F1 m1: once a round 2 on the trade is authorised, round 1 only when its payout was recorded);
 * - an appeal ruling reviews a round 1 this gate itself authorised on the same trade
 *   (`round1-unseen`), and its proposer and approver had no part in it (`involved`, R37): round 1's
 *   signers as this gate saw them, plus anyone on the log's list (which can only add). Review p4t22
 *   N1: a round 1 the gate never authorised because its signer was switched off or removed before
 *   it paid is read from `r.round1` instead: its taps are checked exactly as for authorising it
 *   (every check above, against the stored round 1 the appeal names), except that the keys the gate
 *   keeps for switched-off and removed staff count. That only tells the gate who signed it: round 1
 *   is then recorded as seen for its signers (`signersOnly`), never as authorised, so it still never
 *   pays (asked about itself, it is `revoked` as before) and no other round 1 is accepted after it
 *   (`stale-round`). Anything that does not check out is `round1-unseen`;
 * - the payouts, for an escrow outcome (either round: review p4t22 m1, round 2's pays when an
 *   appeal overturned round 1 before its payout ran), from `payoutsFor` on the recorded terms
 *   (`bad-terms` when they do not make a payout). After-refund rulings are authorised with nothing
 *   to co-sign (their statement is the after-refund one, M2).
 * Review p4t22 F1 (lead call, owner question): a ruling this gate already authorised (in
 * `rulingsSeen` other than `signersOnly`, with the hash of the intents it was authorised on) stays
 * authorised: when a later check refuses it only for a signer's standing (`revoked`, `unknown-key`,
 * `proposer-role`, `approver-role`: switched off, removed, reset or given another role since), it is
 * checked again with the very taps it was authorised on (each nonce already bound to it, the very
 * intents by their hash, the same signers, past signers' keys counting, roles not asked again).
 * Finding A: an authorised ruling is never accepted on other intents (`replayed`), whoever signs. The emergency stop still holds it
 * (it is checked first), and so do the terms. A key retired at a security reset (`retiredCreds`) is
 * `revoked` for anything else and never authorises a new ruling or round.
 * On success the taps' nonces are bound to this ruling and the ruling is recorded in `rulingsSeen`
 * (the caller saves the gate). Checking the same ruling again with the same taps succeeds again.
 */
type Examined =
  | { ok: false; reason: GateRefusal }
  | {
      ok: true;
      code: string;
      steps: Array<{ step: 'propose' | 'approve'; accountId: string; role: SignerRole; nonceHex: string; at: number }>;
      checked: Array<Extract<TapCheck, { ok: true }> & { nonceHex: string }>;
      signers: string[];
      /** Review p4t22 F1, finding A: the intents' hash (`RulingSeen.intentsSha256`). */
      intentsSha256: string;
    };

/**
 * Every check of `authorizeRuling` on one ruling's taps, short of round 2's R37 and the payouts, and
 * changing nothing. `pastSigner`: review p4t22 N1's reading of a round 1's signers (see there).
 * `authorised` (review p4t22 F1): the re-check of a ruling this gate already authorised: past
 * signers' keys count, every tap must be one already bound to this very ruling (its nonce) and the
 * signers those it recorded, and the signers' roles are not asked again (they were, when it was
 * authorised). Everything else (the intents against the stored ruling and the recorded amount, the
 * two-person rule on the recorded terms) is checked as ever.
 */
const no = (reason: GateRefusal): Examined => ({ ok: false, reason });

async function examine(g: GateState, r: Pick<RulingInput, 'ruling' | 'taps' | 'recorded'>, ctx: GateContext, pastSigner: boolean, authorised = false): Promise<Examined> {
  if (!Array.isArray(r.taps) || r.taps.length < 1 || r.taps.length > 2) return no('intent-mismatch');
  const checked: Array<Extract<TapCheck, { ok: true }> & { nonceHex: string }> = [];
  // Review B2: the round-1 ruling a round-2 ruling reviews, as the taps must name it.
  const round1Id = r.ruling.round === 2 ? (r.ruling.round1Id ?? null) : null;
  // Review p4t22 F1 m2: one nonce per tap; two taps of one ruling never share one.
  if (r.taps.length === 2 && r.taps[0]?.nonceHex === r.taps[1]?.nonceHex) return no('nonce-reused');
  for (const tap of r.taps) {
    const c = await verifyTap(g, tap, ctx, { pastSigner: pastSigner || authorised });
    if (!c.ok) return no(c.reason);
    checked.push({ ...c, nonceHex: tap.nonceHex });
  }
  const rul = r.ruling;
  const steps: Array<{ step: 'propose' | 'approve'; accountId: string; role: SignerRole; nonceHex: string; at: number }> = [];
  for (const c of checked) {
    if (c.intent.kind !== 'ruling') return no('intent-mismatch');
    const bound = Object.hasOwn(g.usedNonces, c.nonceHex) ? g.usedNonces[c.nonceHex] : undefined;
    if (bound !== undefined && bound !== `ruling:${rul.id}:${c.intent.step}`) return no('nonce-reused');
    if (authorised && bound === undefined) return no('nonce-reused');
    steps.push({ step: c.intent.step, accountId: c.accountId, role: c.role, nonceHex: c.nonceHex, at: steps.length });
  }
  const code = typeof rul.code === 'string' ? normalizeTradeCode(rul.code) : null;
  if (code === null) return no('intent-mismatch');
  // Haveno finding 2 (b): no replay onto another trade or round; rounds only move forward.
  const before = Object.hasOwn(g.rulingsSeen, rul.id) ? g.rulingsSeen[rul.id] : undefined;
  if (before !== undefined && (before.code !== code || before.round !== rul.round)) return no('replayed');
  if (before === undefined) {
    let highest = 0;
    for (const seen of Object.values(g.rulingsSeen)) if (seen.code === code && seen.round > highest) highest = seen.round;
    if (rul.round <= highest) return no('stale-round');
  }
  for (const c of checked) {
    const i = c.intent as Extract<KeyTapIntent, { kind: 'ruling' }>;
    const agrees =
      i.rulingId === rul.id &&
      i.code === code &&
      i.round === rul.round &&
      i.outcome === rul.outcome &&
      canonicalJson(i.accountAction) === canonicalJson(rul.accountAction) &&
      i.reasonSha256 === rul.reasonSha256 &&
      i.evidenceSha256 === rul.evidenceSha256 &&
      i.round1Id === round1Id &&
      i.amountAtomic === r.recorded.amountAtomic.toString();
    if (!agrees) return no('intent-mismatch');
  }
  const proposals = steps.filter((s) => s.step === 'propose');
  const approvals = steps.filter((s) => s.step === 'approve');
  if (proposals.length !== 1 || approvals.length > 1) return no('intent-mismatch');
  const proposer = proposals[0]!;
  const approver = approvals[0] ?? null;
  if (proposer.accountId !== rul.proposer) return no('intent-mismatch');
  if (approver !== null && approver.accountId !== rul.approver) return no('intent-mismatch');
  const signers = [proposer.accountId, ...(approver !== null ? [approver.accountId] : [])];
  // Review p4t22 F1, finding A: a tap's challenge is tapChallenge(intent, nonce), so a key can sign
  // another intent on a nonce the gate already bound. A ruling this gate authorised is accepted again
  // only on the very intents it was authorised on (also for a signer in good standing), and F1's
  // re-check needs that record (an entry without it fails closed; such entries are pre-launch only).
  // Review p4t22 F1 m1: a round 1 read for its signers only (`signersOnly`) is held to its intents too.
  // m2: each intent by its tap's position, never looked up by nonce.
  const intentOf = (s: { at: number } | null): string | null => (s === null ? null : canonicalJson(checked[s.at]!.intent));
  const intentsSha256 = createHash('sha256').update(canonicalJson([intentOf(proposer), intentOf(approver)])).digest('hex');
  if (before !== undefined && before.intentsSha256 !== undefined && before.intentsSha256 !== intentsSha256) return no('replayed');
  if (authorised && (before === undefined || before.signersOnly === true || before.intentsSha256 === undefined)) return no('replayed');
  if (authorised && canonicalJson(before!.signers) !== canonicalJson(signers)) return no('intent-mismatch');
  if (!authorised && !PROPOSERS.has(proposer.role)) return no('proposer-role');
  const needs = gateNeedsSecond(g, r.recorded, rul.accountAction);
  if (needs && approver === null) return no('needs-second');
  if (approver !== null) {
    if (approver.accountId === proposer.accountId) return no('same-person');
    if (!authorised && !APPROVERS.has(approver.role)) return no('approver-role');
  }
  return { ok: true, code, steps, checked, signers, intentsSha256 };
}

/** The refusals that are about a signer's standing now, not about the ruling (review p4t22 F1). */
const STANDING: ReadonlySet<GateRefusal> = new Set(['revoked', 'unknown-key', 'proposer-role', 'approver-role']);

/**
 * Review p4t22 F1: this gate already authorised the ruling, on intents it recorded: it is in
 * `rulingsSeen` other than for its signers only (N1's `signersOnly`, never authorised), with
 * `intentsSha256` (finding A). A trade's payout record adds nothing: it is written only after the
 * gate authorised that very ruling (and so recorded it here), and `forgetTrade` drops both together,
 * never while the payout is pending. An entry written before the hash fails closed (pre-launch only).
 */
function wasAuthorised(g: GateState, rul: GateRuling): boolean {
  const seen = typeof rul?.id === 'string' && Object.hasOwn(g.rulingsSeen, rul.id) ? g.rulingsSeen[rul.id] : undefined;
  return seen !== undefined && seen.signersOnly !== true && seen.intentsSha256 !== undefined;
}

/**
 * Review p4t22 F1 m1 (hardening): this gate authorised a round 2 on the ruling's trade, and the
 * trade's payout record does not name this round 1. Round 1 is then never authorised again: the
 * appeal decided it (a round-1 payout already recorded before the appeal is carried on).
 */
function round2Authorised(g: GateState, rul: GateRuling): boolean {
  const code = typeof rul.code === 'string' ? normalizeTradeCode(rul.code) : null;
  if (code === null) return false;
  const ex = Object.hasOwn(g.executions, code) ? g.executions[code] : undefined;
  if (ex !== undefined && ex.rulingId === rul.id) return false;
  return Object.values(g.rulingsSeen).some((x) => x.code === code && x.round === 2 && x.signersOnly !== true);
}

export async function authorizeRuling(g: GateState, r: RulingInput, ctx: GateContext): Promise<Authorization> {
  if (g.ownerAccountId === null || g.ownerCreds.length < 2) return refuse('unpinned');
  if (g.stopped) return refuse('stopped');
  if (r.ruling?.round === 1 && round2Authorised(g, r.ruling)) return refuse('stale-round');
  let e = await examine(g, r, ctx, false);
  if (!e.ok && STANDING.has(e.reason) && wasAuthorised(g, r.ruling)) {
    // Review p4t22 F1: a ruling this gate already authorised stays authorised when a signer is
    // later switched off, removed, reset or given another role; only the stop (above), the terms
    // (the intents and payouts below) and the executor's pause check still hold it.
    const again = await examine(g, r, ctx, false, true);
    if (again.ok) e = again;
  }
  if (!e.ok) return e;
  const { code, steps, checked, signers, intentsSha256 } = e;
  const rul = r.ruling;
  /** Review p4t22 N1: round 1 as read for its signers only, recorded with this ruling on success. */
  let pastRound1: Extract<Examined, { ok: true }> | null = null;
  if (rul.round === 2) {
    if (typeof rul.round1Id !== 'string' || rul.round1Id === rul.id) return refuse('intent-mismatch');
    // Review B2: R37 rests on round 1 as this gate authorised it (same trade, round 1), never on
    // the database alone; the log's list can only add people to it.
    let r1 = Object.hasOwn(g.rulingsSeen, rul.round1Id) ? g.rulingsSeen[rul.round1Id] : undefined;
    if (r1 === undefined && r.round1 !== undefined) {
      // Review p4t22 N1: the round 1 the appeal names, by someone since switched off or removed.
      const given = r.round1.ruling;
      if (given?.id !== rul.round1Id || given.round !== 1 || given.round1Id !== undefined) return refuse('round1-unseen');
      const p = await examine(g, { ruling: given, taps: r.round1.taps, recorded: r.recorded }, ctx, true);
      if (!p.ok || p.code !== code) return refuse('round1-unseen');
      pastRound1 = p;
      r1 = { code: p.code, round: 1, signers: p.signers, publishedSeenAt: ctx.now().toISOString() };
    }
    if (r1 === undefined || r1.code !== code || r1.round !== 1) return refuse('round1-unseen');
    const involved = new Set([...r1.signers, ...(r.involved ?? [])]);
    if (signers.some((id) => involved.has(id))) return refuse('involved');
  }
  let settle: { payouts: Payout[]; winner: 'buyer' | 'seller' } | null = null;
  // Review p4t22 m1 (lead default, owner question OQ2): an escrow ruling of either round has a
  // payout; the executor pays round 2's only when round 1's payout never ran (one per trade).
  // Lien recovery review B1: a `verifyOnly` check works out no payout (`settle: null`).
  if (r.verifyOnly !== true && (ESCROW_OUTCOMES as readonly string[]).includes(rul.outcome)) {
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
        // A release to the buyer completes the trade: the signed lien recovery is paid (payoutsFor).
        ...(r.recorded.lienRecovery !== undefined ? { lienRecovery: r.recorded.lienRecovery } : {}),
      });
      settle = { payouts, winner };
    } catch {
      return refuse('bad-terms');
    }
  }
  if (pastRound1 !== null) {
    // Bound like any ruling's taps, and seen for its signers only: never authorised (N1).
    for (const s of pastRound1.steps) g.usedNonces[s.nonceHex] = `ruling:${rul.round1Id!}:${s.step}`;
    g.rulingsSeen[rul.round1Id!] = { code, round: 1, signers: pastRound1.signers, intentsSha256: pastRound1.intentsSha256, publishedSeenAt: ctx.now().toISOString(), signersOnly: true };
  }
  for (const s of steps) g.usedNonces[s.nonceHex] = `ruling:${rul.id}:${s.step}`;
  for (const c of checked) noteCounter(g, c.accountId, c.credentialId, c.counter);
  const seen = Object.hasOwn(g.rulingsSeen, rul.id) ? g.rulingsSeen[rul.id] : undefined;
  g.rulingsSeen[rul.id] = {
    code,
    round: rul.round,
    signers,
    // Finding A: the first intents it was authorised on stay its intents (never re-pointed).
    intentsSha256: seen?.intentsSha256 ?? intentsSha256,
    publishedSeenAt: seen?.publishedSeenAt ?? ctx.now().toISOString(),
    ...(seen?.firstSeenFinalAt !== undefined ? { firstSeenFinalAt: seen.firstSeenFinalAt } : {}),
  };
  return { ok: true, settle };
}
