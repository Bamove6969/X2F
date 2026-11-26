// The dispute screens' API calls (Plan 3 Task 27). Each answer is parsed strictly, so a renamed or
// missing field fails loudly instead of showing something wrong. Shapes:
// - GET /v1/trades/:code: Task 22's getTrade/parseTradeView (api/trade.ts), mapped by tradeFromView;
// - GET|POST /v1/trades/:code/dispute, POST /v1/trades/:code/appeal: apps/api/src/disputes/routes.ts;
// The method is named from the bundled catalog by id (disputeMethodName), never from the API.
import { api, ApiCallError } from '../../api/client.js';
import { chatClient, openTradeChat } from '../../chat/client.js';
import { getTrade, methodOf, publicName, type TradeView } from '../../api/trade.js';
import { catalogMethodName } from '../../methods/catalogNames.js';

export type Party = 'buyer' | 'seller';
export type Reason = 'paid' | 'silent' | 'terms' | 'other';
/** A stored reason: a trader's, or 'escalated' when the system opened the dispute. */
export type DisputeReason = Reason | 'escalated';
export type Outcome = 'release-to-buyer' | 'refund-to-seller' | 'seller-sends-xmr' | 'seller-returns-fiat' | 'no-action';

/** The TradeView fields the dispute screens read. `counterparty` is a public display name. */
export interface DisputeTrade {
  code: string;
  role: Party;
  state: string;
  counterparty: string;
  methodId: string;
  /** Task 3's method profile sentence ("What is this?"), when the API has one. */
  whatItIs: string;
  amountAtomic: string;
  /** The trade's fiat total (minor units), for the "Finish marking as paid" gate (payModel disputeNeedsFinish). */
  fiatCents?: string;
  /** Who posted the offer: the poster pays the 1% fee, so it decides what a ruling pays out (lead review 7 Nov). */
  poster: Party;
  currency: string;
  paidAt: string | null;
  confirmBy: string | null;
  /** The trade's confirm window in minutes (owner 2026-11-07 F9: per payment type; p9-4: either side's wait before a dispute), for the wording. */
  confirmWindowMin: number;
  settleBy: string | null;
  closedAt: string | null;
  dispute: { by: 'buyer' | 'seller' | 'system'; at: string } | null;
  /** How the trade settled (a refund's kind): a cancel's refund can't be disputed (owner 2026-10-29). */
  settling?: TradeView['settling'];
  serverNow: string;
}

export interface RulingView {
  round: 1 | 2;
  outcome: Outcome;
  reason: string;
  evidence: string[];
  moderatorName: string;
  ruledAt: string;
  appealUntil: string | null;
  destination: { walletApp: string | null; addressEnd: string } | null;
  /** Owner 26 Nov: when the ruling's escrow payout ran, or null (not yet). Absent: not yet. */
  executedAt?: string | null;
}

export interface DisputeView {
  /**
   * Plan 4 Task 11 (G37, owner 7 Nov): the dispute's incident ID, nine characters, shown to both
   * traders at the top of the trade (where and how is design's: DESIGNER-REVIEW). Absent from an older view.
   */
  incidentId?: string | null;
  /**
   * Plan 4 Task 11: the moderator asked THIS trader for the unblurred proof (who, when). `sentAt`
   * (Plan 5 Task 15): when this trader's copy answering it was stored, from the server's record; null
   * until then (and in an older view).
   */
  proofRequest?: { username: string; at: string; sentAt: string | null } | null;
  /** 'system' when the trade was escalated (late funds after it ended, a lapse nobody refunded). */
  openedBy: Party | 'system';
  reason: DisputeReason;
  openedAt: string;
  afterRefund: boolean;
  dueAt: string | null;
  /**
   * Plan 4 Task 10: when round 1 aims to be ruled (24 hours, owner 2026-11-03: a goal, never a
   * deadline), before the hard `dueAt`. The other Task 10 fields below are optional here too: a view
   * from before Task 10, or the room's stand-in before the record arrives, has none (read as null).
   */
  goalAt?: string | null;
  /** When the first reply is due, while nobody has replied. */
  replyDueAt?: string | null;
  /** While nobody has taken the case: this dispute's place in the queue. */
  queuePosition?: number | null;
  /** A `seller-sends-xmr` ruling: when the seller's payment is due. */
  complyBy?: string | null;
  /**
   * Revision 2026-10-29c "Fees on settled disputes": the 1% this side still owes for the trade,
   * atomic units, sent only to the side that owes it (Task 12's fees_owed; NEEDS_TASK_12_FEES_OWED).
   */
  feeOwedAtomic?: string | null;
  /**
   * Owner g63 (7 Nov), in the poster's view only: the 1% after the ruling. `poster-pays` (the trade
   * completes), `none` (a full reversal), `waits` (an appeal is pending), null before a ruling.
   * Not shown yet: the explanation's words are design's (TODO, owner g63).
   */
  fee?: 'poster-pays' | 'none' | 'waits' | null;
  status: 'open' | 'ruled' | 'appealed' | 'final' | 'closed';
  moderator: { name: string; joinedAt: string } | null;
  ruling: RulingView | null;
  appeal: { by: Party; at: string } | null;
  /**
   * D-011 (Plan 4 Task 24): the appeal waits for an independent reviewer (every senior moderator
   * and the owner was involved in round 1). Absent from an older API: false.
   */
  appealWaiting?: boolean;
  /** The appeal window's length in hours, from the owner's settings (absent from an older API: 48). */
  appealWindowH?: number | null;
  serverNow: string;
}

class ShapeError extends Error {
  constructor(what: string) {
    super(`unexpected API answer: ${what}`);
    this.name = 'ShapeError';
  }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown, what: string): Rec => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ShapeError(what);
  return v as Rec;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new ShapeError(what);
  return v;
};
const strOrNull = (v: unknown, what: string): string | null => (v === null ? null : str(v, what));
const iso = (v: unknown, what: string): string => {
  const s = str(v, what);
  if (!Number.isFinite(Date.parse(s))) throw new ShapeError(what);
  return s;
};
const isoOrNull = (v: unknown, what: string): string | null => (v === null ? null : iso(v, what));
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T => {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new ShapeError(what);
  return v as T;
};
const PARTIES = ['buyer', 'seller'] as const;
/** A Task 10 field: absent (an older view) reads as null; present, it must have the right shape. */
const later = <T>(v: unknown, read: (v: unknown) => T): T | null => (v === undefined || v === null ? null : read(v));
const ATOMIC = /^[0-9]{1,30}$/;
/** An incident ID as the API stores it (@x2f/staff `isIncidentId` checks its check character too). */
const INCIDENT = /^[0-9A-HJKMNP-TV-Z]{9}$/;

/**
 * The dispute screens' view of a trade, mapped from Task 22's TradeView (one parser of the trade
 * view: `getTrade`/`parseTradeView` in api/trade.ts). The counterparty is `publicName` (FU-A's
 * public display name), the method sentence `methodOf(view).whatItIs`.
 */
export function tradeFromView(v: TradeView): DisputeTrade {
  return {
    code: v.code,
    role: v.role,
    state: v.state,
    counterparty: publicName(v.counterparty),
    methodId: v.methodId,
    whatItIs: methodOf(v).whatItIs,
    amountAtomic: v.amountAtomic,
    fiatCents: v.fiatCents,
    poster: v.poster,
    currency: v.lockedRate.currency,
    paidAt: v.paidAt,
    confirmBy: v.confirmBy,
    confirmWindowMin: v.confirmWindowMin,
    settleBy: v.settleBy,
    closedAt: v.closedAt,
    dispute: v.dispute,
    settling: v.settling,
    serverNow: v.serverNow,
  };
}

const OUTCOMES = ['release-to-buyer', 'refund-to-seller', 'seller-sends-xmr', 'seller-returns-fiat', 'no-action'] as const;

export function parseDispute(v: unknown): DisputeView {
  const d = rec(v, 'dispute');
  let moderator: DisputeView['moderator'] = null;
  if (d.moderator !== null) {
    const m = rec(d.moderator, 'moderator');
    moderator = { name: str(m.name, 'moderator.name'), joinedAt: iso(m.joinedAt, 'moderator.joinedAt') };
  }
  let ruling: RulingView | null = null;
  if (d.ruling !== null) {
    const r = rec(d.ruling, 'ruling');
    if (r.round !== 1 && r.round !== 2) throw new ShapeError('ruling.round');
    if (!Array.isArray(r.evidence) || r.evidence.some((e) => typeof e !== 'string')) throw new ShapeError('ruling.evidence');
    let destination: RulingView['destination'] = null;
    if (r.destination !== null) {
      const x = rec(r.destination, 'ruling.destination');
      destination = { walletApp: strOrNull(x.walletApp, 'destination.walletApp'), addressEnd: str(x.addressEnd, 'destination.addressEnd') };
    }
    ruling = {
      round: r.round,
      outcome: oneOf(r.outcome, OUTCOMES, 'ruling.outcome'),
      reason: str(r.reason, 'ruling.reason'),
      evidence: r.evidence as string[],
      moderatorName: str(r.moderatorName, 'ruling.moderatorName'),
      ruledAt: iso(r.ruledAt, 'ruling.ruledAt'),
      appealUntil: isoOrNull(r.appealUntil, 'ruling.appealUntil'),
      destination,
      executedAt: r.executedAt === undefined ? null : isoOrNull(r.executedAt, 'ruling.executedAt'),
    };
  }
  let appeal: DisputeView['appeal'] = null;
  if (d.appeal !== null) {
    const a = rec(d.appeal, 'appeal');
    appeal = { by: oneOf(a.by, PARTIES, 'appeal.by'), at: iso(a.at, 'appeal.at') };
  }
  return {
    incidentId: later(d.incidentId, (v) => {
      if (typeof v !== 'string' || !INCIDENT.test(v)) throw new ShapeError('incidentId');
      return v;
    }),
    proofRequest: later(d.proofRequest, (v) => {
      const p = rec(v, 'proofRequest');
      return { username: str(p.username, 'proofRequest.username'), at: iso(p.at, 'proofRequest.at'), sentAt: later(p.sentAt, (v) => iso(v, 'proofRequest.sentAt')) };
    }),
    openedBy: oneOf(d.openedBy, ['buyer', 'seller', 'system'] as const, 'openedBy'),
    reason: oneOf(d.reason, ['paid', 'silent', 'terms', 'other', 'escalated'] as const, 'reason'),
    openedAt: iso(d.openedAt, 'openedAt'),
    afterRefund: d.afterRefund === true,
    dueAt: isoOrNull(d.dueAt, 'dueAt'),
    goalAt: later(d.goalAt, (v) => iso(v, 'goalAt')),
    replyDueAt: later(d.replyDueAt, (v) => iso(v, 'replyDueAt')),
    queuePosition: later(d.queuePosition, (v) => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new ShapeError('queuePosition');
      return v;
    }),
    complyBy: later(d.complyBy, (v) => iso(v, 'complyBy')),
    feeOwedAtomic: later(d.feeOwedAtomic, (v) => {
      if (typeof v !== 'string' || !ATOMIC.test(v)) throw new ShapeError('feeOwedAtomic');
      return v;
    }),
    fee: later(d.fee, (v) => oneOf(v, ['poster-pays', 'none', 'waits'] as const, 'fee')),
    status: oneOf(d.status, ['open', 'ruled', 'appealed', 'final', 'closed'] as const, 'status'),
    moderator,
    ruling,
    appeal,
    appealWaiting: d.appealWaiting === undefined ? false : (() => {
      if (typeof d.appealWaiting !== 'boolean') throw new ShapeError('appealWaiting');
      return d.appealWaiting;
    })(),
    appealWindowH: later(d.appealWindowH, (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new ShapeError('appealWindowH');
      return v;
    }),
    serverNow: iso(d.serverNow, 'serverNow'),
  };
}

const path = (code: string) => `/v1/trades/${encodeURIComponent(code)}`;

export async function fetchTrade(code: string, signal?: AbortSignal): Promise<DisputeTrade> {
  return tradeFromView(await getTrade(code, signal));
}

/** The dispute, or null when none is open on this trade (404). */
export async function fetchDispute(code: string, signal?: AbortSignal): Promise<DisputeView | null> {
  try {
    return parseDispute(await api(`${path(code)}/dispute`, signal ? { signal } : {}));
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Opens the dispute. Design build task 6: once the trade's chat has a key, the API needs this
 * trader's signed grant of it to the moderator (400 grant-required); the escrow worker makes it and
 * the request is sent once more with it. A chat with no key needs none.
 */
export async function openDispute(code: string, reason: Reason, note: string, d: { chatOf?: (code: string) => Promise<string>; grant?: (chat: string, disputeAt: string) => Promise<unknown> } = {}): Promise<DisputeView> {
  try {
    return parseDispute(await api(`${path(code)}/dispute`, { method: 'POST', body: { reason, note } }));
  } catch (err) {
    if (!(err instanceof ApiCallError) || err.status !== 400 || err.code !== 'grant-required') throw err;
  }
  const chat = await (d.chatOf ?? openTradeChat)(code);
  const c = d.grant === undefined ? chatClient() : null;
  const make = d.grant ?? (c?.grant === undefined ? undefined : c.grant.bind(c));
  if (make === undefined) throw new ApiCallError(400, 'grant-required');
  const grant = await make(chat, new Date().toISOString());
  return parseDispute(await api(`${path(code)}/dispute`, { method: 'POST', body: { reason, note, grant } }));
}

export async function sendAppeal(code: string, why: string): Promise<DisputeView> {
  return parseDispute(await api(`${path(code)}/appeal`, { method: 'POST', body: { why } }));
}

/** Plan 4 Task 12 (A6): what POST /v1/trades/:code/payment-proof answers when it takes the proof. */
export type PaymentProofStatus = 'accepted' | 'pending-confirmations';

/** The seller's proof of a `seller-sends-xmr` payment (the tx hash and its key, lower-case hex). */
export async function sendPaymentProof(code: string, txHash: string, txKey: string): Promise<PaymentProofStatus> {
  const r = (await api(`${path(code)}/payment-proof`, { method: 'POST', body: { txHash, txKey } })) as { status?: unknown } | null;
  if (r?.status !== 'accepted' && r?.status !== 'pending-confirmations') throw new ShapeError('status');
  return r.status;
}

/** The user-facing line for a refused payment proof (codes from the API). COPY-UNSIGNED */
export function proofRefusalText(err: unknown): string {
  const code = err instanceof ApiCallError ? err.code : '';
  switch (code) {
    case 'proof-invalid':
      return 'That transaction ID and key do not show this amount paid to this address. Check both and send them again.';
    case 'proof-replayed':
      return 'That transaction was used before, or was sent before this dispute opened. Send the proof of the payment you made for this ruling.';
    case 'proof-pending':
      return 'Your earlier proof is still waiting for its confirmations.';
    case 'too-late':
      return 'The time to send the proof has passed. A senior moderator now reviews the case.';
    case 'node-unavailable':
      return 'The payment could not be checked right now. Try again in a moment.';
    default:
      return refusalText(err);
  }
}

/**
 * The method's name for the dispute screens: the bundled catalog's for the id (re-verify R3, as the
 * trade room's `methodOf`), never the API's method list; the id itself when the catalog has none.
 */
export function disputeMethodName(methodId: string): string {
  return catalogMethodName(methodId);
}

/** The user-facing line for a refused open or appeal (codes from the API). */
export function refusalText(err: unknown): string {
  const code = err instanceof ApiCallError ? err.code : '';
  switch (code) {
    case 'too-early':
      return "It's too early to open a dispute on this trade."; // COPY-UNSIGNED
    case 'too-late':
      return 'The time for this has passed.'; // COPY-UNSIGNED
    case 'dispute-exists':
      return 'A dispute is already open on this trade.'; // COPY-UNSIGNED
    case 'wrong-state':
    case 'wrong-party':
      return "This trade can't take that right now."; // COPY-UNSIGNED; not-a-refusal: the trade state machine (wrong-state, wrong-party)
    default:
      return "Something went wrong. Try again in a moment."; // COPY-UNSIGNED
  }
}
