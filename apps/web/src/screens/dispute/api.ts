// The dispute screens' API calls (Plan 3 Task 27). Each answer is parsed strictly, so a renamed or
// missing field fails loudly instead of showing something wrong. Shapes:
// - GET /v1/trades/:code: Task 6's TradeView (apps/api/src/trades/view.ts), the fields used here;
// - GET|POST /v1/trades/:code/dispute, POST /v1/trades/:code/appeal: apps/api/src/disputes/routes.ts;
// - GET /v1/methods?side&currency: Task 3 (wip/second-p3-t3), only to name the method.
import { api, ApiCallError } from '../../api/client.js';

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
  currency: string;
  paidAt: string | null;
  confirmBy: string | null;
  settleBy: string | null;
  closedAt: string | null;
  dispute: { by: 'buyer' | 'seller' | 'system'; at: string } | null;
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
}

export interface DisputeView {
  /** 'system' when the trade was escalated (late funds after it ended, a lapse nobody refunded). */
  openedBy: Party | 'system';
  reason: DisputeReason;
  openedAt: string;
  afterRefund: boolean;
  dueAt: string | null;
  status: 'open' | 'ruled' | 'appealed' | 'final' | 'closed';
  moderator: { name: string; joinedAt: string } | null;
  ruling: RulingView | null;
  appeal: { by: Party; at: string } | null;
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

export function parseTrade(v: unknown): DisputeTrade {
  const t = rec(v, 'trade');
  const cp = rec(t.counterparty, 'counterparty');
  const rate = rec(t.lockedRate, 'lockedRate');
  const profile = t.profile !== null && typeof t.profile === 'object' ? (t.profile as Rec) : null;
  const amount = str(t.amountAtomic, 'amountAtomic');
  if (!/^\d+$/.test(amount)) throw new ShapeError('amountAtomic');
  let dispute: DisputeTrade['dispute'] = null;
  if (t.dispute !== null) {
    const d = rec(t.dispute, 'dispute');
    dispute = { by: oneOf(d.by, ['buyer', 'seller', 'system'] as const, 'dispute.by'), at: iso(d.at, 'dispute.at') };
  }
  return {
    code: str(t.code, 'code'),
    role: oneOf(t.role, PARTIES, 'role'),
    state: str(t.state, 'state'),
    // TODO(FU-A): `username` is the public display name column today; it becomes `displayName`.
    counterparty: str(cp.username, 'counterparty.username'),
    methodId: str(t.methodId, 'methodId'),
    whatItIs: profile !== null && typeof profile.whatItIs === 'string' ? profile.whatItIs : '',
    amountAtomic: amount,
    currency: str(rate.currency, 'lockedRate.currency'),
    paidAt: isoOrNull(t.paidAt, 'paidAt'),
    confirmBy: isoOrNull(t.confirmBy, 'confirmBy'),
    settleBy: isoOrNull(t.settleBy, 'settleBy'),
    closedAt: isoOrNull(t.closedAt, 'closedAt'),
    dispute,
    serverNow: iso(t.serverNow, 'serverNow'),
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
    };
  }
  let appeal: DisputeView['appeal'] = null;
  if (d.appeal !== null) {
    const a = rec(d.appeal, 'appeal');
    appeal = { by: oneOf(a.by, PARTIES, 'appeal.by'), at: iso(a.at, 'appeal.at') };
  }
  return {
    openedBy: oneOf(d.openedBy, ['buyer', 'seller', 'system'] as const, 'openedBy'),
    reason: oneOf(d.reason, ['paid', 'silent', 'terms', 'other', 'escalated'] as const, 'reason'),
    openedAt: iso(d.openedAt, 'openedAt'),
    afterRefund: d.afterRefund === true,
    dueAt: isoOrNull(d.dueAt, 'dueAt'),
    status: oneOf(d.status, ['open', 'ruled', 'appealed', 'final', 'closed'] as const, 'status'),
    moderator,
    ruling,
    appeal,
    serverNow: iso(d.serverNow, 'serverNow'),
  };
}

const path = (code: string) => `/v1/trades/${encodeURIComponent(code)}`;

export async function fetchTrade(code: string, signal?: AbortSignal): Promise<DisputeTrade> {
  return parseTrade(await api(path(code), signal ? { signal } : {}));
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

export async function openDispute(code: string, reason: Reason, note: string): Promise<DisputeView> {
  return parseDispute(await api(`${path(code)}/dispute`, { method: 'POST', body: { reason, note } }));
}

export async function sendAppeal(code: string, why: string): Promise<DisputeView> {
  return parseDispute(await api(`${path(code)}/appeal`, { method: 'POST', body: { why } }));
}

/** The method's name from Task 3's list (falls back to its id when the list is unavailable). */
export async function fetchMethodName(methodId: string, currency: string, signal?: AbortSignal): Promise<string> {
  try {
    const q = new URLSearchParams({ side: 'sell', currency });
    const body = rec(await api(`/v1/methods?${q.toString()}`, signal ? { signal } : {}), 'methods');
    const all = Array.isArray(body.all) ? body.all : [];
    for (const row of all) {
      if (row !== null && typeof row === 'object' && (row as Rec).id === methodId && typeof (row as Rec).name === 'string') return (row as Rec).name as string;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
  }
  return methodId;
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
      return "This trade can't take that right now."; // COPY-UNSIGNED
    default:
      return "Something went wrong. Try again in a moment."; // COPY-UNSIGNED
  }
}
