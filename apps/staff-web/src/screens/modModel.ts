/**
 * Plan 4 Task 18: the moderator pages' words and figures, kept apart from the React so they can be
 * read and tested on their own. Every sentence here is draft copy unless a board words it.
 * COPY-UNSIGNED
 */
import { evidenceSha256, normalizeIncidentId, normalizeTradeCode, sha256, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';

const ATOMIC_PER_XMR = 1_000_000_000_000n;
const H = 3_600_000;

/** "4.00" or "0.125": an XMR amount with at least 2 and at most 6 places, truncated (board ModQueue). */
export function xmrShort(atomic: string): string {
  const a = BigInt(atomic);
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const frac = (abs % ATOMIC_PER_XMR).toString().padStart(12, '0').slice(0, 6).replace(/0+$/, '').padEnd(2, '0');
  return `${neg ? '-' : ''}${abs / ATOMIC_PER_XMR}.${frac}`;
}

/** "4.000000": six places, truncated (board ModCase's escrow card). */
export function xmrSix(atomic: string): string {
  const a = BigInt(atomic);
  const abs = a < 0n ? -a : a;
  return `${a < 0n ? '-' : ''}${abs / ATOMIC_PER_XMR}.${(abs % ATOMIC_PER_XMR).toString().padStart(12, '0').slice(0, 6)}`;
}

const groups = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "$1,320.00" from the API's "1320.00" dollars (exact: string arithmetic only). */
export function usdText(usd: string): string {
  const neg = usd.startsWith('-');
  const [whole = '0', cents = '00'] = (neg ? usd.slice(1) : usd).split('.');
  return `${neg ? '-' : ''}$${groups(whole)}.${cents.padEnd(2, '0').slice(0, 2)}`;
}

/** Whole cents in a currency: "$1,320.00" for USD, "1,320.00 EUR" otherwise. */
export function fiatText(cents: string, currency: string): string {
  const c = BigInt(cents);
  const abs = c < 0n ? -c : c;
  const n = `${c < 0n ? '-' : ''}${groups((abs / 100n).toString())}.${(abs % 100n).toString().padStart(2, '0')}`;
  return currency === 'USD' ? (n.startsWith('-') ? `-$${n.slice(1)}` : `$${n}`) : `${n} ${currency}`;
}

/** A whole-dollar limit as the board says it: "1,000 USD". */
export const limitText = (usd: number) => `${groups(String(usd))} USD`;

/** "4 h 25 min", "1 d 2 h", "38 min" (board ModQueue's waiting and deadline cells). */
export function span(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** "11:40": a time of day on this device (board ModCase's "Opened by you at 11:40"). */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "7RWD-3MXE-KQ84-HN2T": a trade code in groups of four. */
export const codeText = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

/**
 * Review X3-1 (a): whether the case the API returned is the one in the page's address
 * (`/disputes/:code`), so a ruling tap signs the trade the moderator opened. A trade code in the
 * address must be the case's code, in any typed form; an incident ID (the API resolves those too)
 * must be the case's incident ID. Anything else matches nothing.
 */
export function caseMatchesAddress(param: string, c: { code: string; incidentId: string }): boolean {
  const code = normalizeTradeCode(param);
  if (code !== null) return normalizeTradeCode(c.code) === code;
  const incident = normalizeIncidentId(param);
  return incident !== null && normalizeIncidentId(c.incidentId) === incident;
}

export type DeadlineTone = 'due' | 'overdue' | 'replied';

/** A queue row's deadline cell and how much of the reply window it has used (0-100). */
export function deadline(r: { deadlineTone: DeadlineTone; replyDueAt: string; waitingMs: number }, firstResponseH: number, now: Date): { text: string; pct: number | null } {
  if (r.deadlineTone === 'replied') return { text: 'Replied', pct: null };
  const left = Date.parse(r.replyDueAt) - now.getTime();
  const pct = Math.min(100, Math.max(0, Math.round((r.waitingMs / (firstResponseH * H)) * 100)));
  if (r.deadlineTone === 'overdue' || left <= 0) return { text: `Overdue by ${span(-left)}`, pct: 100 };
  return { text: `Reply due in ${span(left)}`, pct };
}

export type QueueApproval = 'not-needed' | 'needs-second' | { waitingFor: 'second-approval'; proposedBy: string | null };

/**
 * The queue's approval chip. The board's "Ruling waiting for lumen.k" names the approver; the API
 * knows only that the proposal waits for a second person, so it says that. DESIGNER-REVIEW
 */
export function approvalText(a: QueueApproval): string {
  if (a === 'not-needed') return 'Not needed';
  if (a === 'needs-second') return 'Needs second approval';
  return 'Ruling waiting for a second approval';
}

/** The trader's reason for the dispute, as DisputeOpen words it (apps/web's dispute rules). */
export function reasonText(openedBy: string, reason: string): string {
  const buyer: Record<string, string> = {
    paid: "paid, but the seller hasn't released",
    silent: "the seller isn't replying",
    terms: 'the seller asked for more money or a different payment',
    other: 'something else',
  };
  const seller: Record<string, string> = {
    paid: "hasn't received the payment",
    silent: "the buyer isn't replying",
    terms: 'the buyer asked for something outside the terms',
    other: 'something else',
  };
  if (reason === 'escalated' || openedBy === 'system') return 'escalated by X2F';
  return (openedBy === 'seller' ? seller : buyer)[reason] ?? reason;
}

/** The ruling's outcomes, with what each does (board ModCase; the after-refund three have no board). */
export function outcomeChoices(afterRefund: boolean, a: { xmr: string; buyer: string; seller: string }): { value: RulingOutcome; label: string; note: string }[] {
  if (!afterRefund) {
    return [
      { value: 'release-to-buyer', label: 'Release to buyer', note: `${a.xmr} XMR goes to ${a.buyer}. ${a.seller} gets a lost dispute on their profile.` },
      { value: 'refund-to-seller', label: 'Refund to seller', note: `${a.xmr} XMR goes back to ${a.seller}. ${a.buyer} gets a lost dispute on their profile.` },
    ];
  }
  return [
    { value: 'seller-sends-xmr', label: 'Seller sends the XMR', note: `${a.seller} must send ${a.xmr} XMR to ${a.buyer}.` },
    { value: 'seller-returns-fiat', label: 'Seller returns the payment', note: `${a.seller} must return the payment to ${a.buyer}.` },
    { value: 'no-action', label: 'No action', note: 'The refund stands. Nobody has to do anything.' },
  ];
}

export const OUTCOME_LABELS: Readonly<Record<RulingOutcome, string>> = {
  'release-to-buyer': 'Release to buyer',
  'refund-to-seller': 'Refund to seller',
  'seller-sends-xmr': 'Seller sends the XMR',
  'seller-returns-fiat': 'Seller returns the payment',
  'no-action': 'No action',
};

/** Plan 4 Task 12: a ruling's reason is at least 40 characters (the API's REASON_MIN). */
export const REASON_MIN = 40;
/** The API's evidence limits: up to 10 lines, each at most 200 characters. */
export const EVIDENCE_MAX = 10;
export const EVIDENCE_LINE_MAX = 200;

/** Board ModCase: "At least 40 characters. N so far." until it is long enough. */
export function reasonHint(reason: string): string {
  const n = reason.trim().length;
  return n >= REASON_MIN ? `${n} characters` : `At least ${REASON_MIN} characters. ${n} so far.`;
}

/** The evidence lines the traders read: one per non-empty line. */
export const evidenceLines = (raw: string) => raw.split('\n').map((l) => l.trim()).filter((l) => l !== '');

/**
 * The SHA-256 of the reason's UTF-8 bytes, lower-case hex: what the ruling tap binds
 * (`reasonSha256`). Synchronous (@x2f/staff's own SHA-256), so the tap dialog opens at once.
 */
export function reasonSha256(reason: string): string {
  return [...sha256(new TextEncoder().encode(reason))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The ruling tap's intent, the same content the API rebuilds and checks (apps/api disputes/rulings.ts). */
export function rulingIntent(
  step: 'propose' | 'approve',
  a: { rulingId: string; code: string; round: 1 | 2; round1Id: string | null; outcome: RulingOutcome; amountAtomic: string; reason: string; evidence: readonly string[] },
): KeyTapIntent {
  return {
    kind: 'ruling',
    step,
    rulingId: a.rulingId,
    code: a.code,
    round: a.round,
    outcome: a.outcome,
    accountAction: { kind: 'none' },
    amountAtomic: a.amountAtomic,
    reasonSha256: reasonSha256(a.reason),
    // Review mod-screens M1: the evidence lines exactly as posted (propose) or as stored (approve).
    evidenceSha256: evidenceSha256(a.evidence),
    // mod-gate review B2: round 2's taps name the round-1 ruling they review; round 1 names none.
    round1Id: a.round === 2 ? a.round1Id : null,
  };
}
