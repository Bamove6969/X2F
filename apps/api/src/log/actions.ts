import type { TradeEvent } from '@x2f/trade';

/**
 * Activity-log actions (Plan 4 Task 3) and the detail each may carry. Details hold ids, enums,
 * trade codes, XMR amount strings and setting numbers only: never chat text, ruling reasons, staff
 * notes, addresses or IP addresses. Each action lists the keys it allows and what each value is;
 * `assertDetail` refuses any other key and any string over 64 characters.
 */
type Kind =
  /** An id or enum value: letters, digits and `_ . : -`, at most 64 characters. */
  | 'id'
  /** M6: an account or staff id, a lower-case uuid (never a username or a login name). */
  | 'uuid'
  /** A non-negative integer as a decimal string (atomic units, cents). */
  | 'amount'
  /** A finite number (a setting, a count, hours). */
  | 'number'
  | 'bool'
  /** An instant as an ISO string. */
  | 'iso'
  /** 64 lower-case hex characters (a hash or a tx id). */
  | 'hex64'
  /** A setting value as stored: a number, a decimal string or null. */
  | 'setting';

type Schema = Readonly<Record<string, Kind>>;

const TRADE: Record<`trade.${TradeEvent['type']}`, Schema> = {
  // The escrow address is never logged (Task 3: no addresses), not even its end.
  'trade.setup-done': {},
  'trade.chain': { receivedAtomic: 'amount', unlockedAtomic: 'amount', confirmations: 'number' },
  'trade.mark-paid': { fiatCents: 'amount' },
  'trade.extend': {},
  'trade.request-refund': {},
  'trade.buyer-cancel': {},
  'trade.propose-cancel': {},
  'trade.accept-cancel': {},
  'trade.withdraw-cancel': {},
  'trade.release-started': {},
  'trade.settled': { kind: 'id', txHash: 'hex64' },
  'trade.open-dispute': {},
  'trade.escalate': {},
  // Plan 3 Task 9 I/O: the watcher saw a party's release claim (no tx hash, no amount).
  'trade.release-claimed': {},
  'trade.pause': {},
  'trade.resume': {},
  'trade.system-cancel': {},
  'trade.tick': {},
  // Plan 3 Tasks 38-39 (cancel rules): counts only, no addresses.
  'trade.fund-started': {},
  'trade.walk-away': {},
  'trade.confirm-cancel': { returnConfirmations: 'number' },
  'trade.return-confirmed': { confirmations: 'number' },
};

/**
 * A ruling's account action is flattened (M6): `accountAction` is its kind (`none`, `trade-ban`,
 * `site-ban`; D-015: never `freeze`), and a ban's `until` (null = permanent) and `reasonCode` are their own keys.
 */
const RULING: Schema = {
  rulingId: 'id',
  round: 'number',
  outcome: 'id',
  accountAction: 'id',
  until: 'iso',
  reasonCode: 'id',
  amountAtomic: 'amount',
};
const LIEN: Schema = { lienId: 'id', accountId: 'uuid', amountAtomic: 'amount', cause: 'id' };
const BAN: Schema = { accountId: 'uuid', until: 'iso', reasonCode: 'id', permanent: 'bool', banId: 'id', ruleId: 'id' };

export const LOG_ACTIONS = {
  ...TRADE,
  // Hold model v3 (lead review 8 Nov I5): the partner's buyer-cancel on a held funded trade is
  // recorded; `trade.buyer-cancel` is logged when it is carried out at the hold's end.
  'trade.buyer-cancel-recorded': {},
  // Disputes and cases (Tasks 10–11).
  'dispute.opened': { reason: 'id', afterRefund: 'bool', seq: 'number' },
  // G37 (owner 7 Nov): taking a case is logged at once, who (the actor) and when (the entry's time).
  'dispute.assigned': { staffId: 'uuid', tradeOpenedAt: 'iso' },
  // A switched-off or removed member's open case goes back to the queue (Task 7 x Task 10).
  'dispute.unassigned': { staffId: 'uuid' },
  // Re-verify 43fbbb2f, R-I1: the seller's cancel refund landed on a dispute already past `open`
  // (an escrow ruling proposed or published); the case is raised for staff to re-rule.
  'dispute.refund-after-ruling': { seq: 'number', status: 'id' },
  'case.opened': {},
  'chat.read': {},
  // Review 8 Nov M-2: requested (before moderation seals it) and sent (in the transaction that stores it).
  'chat.message-requested': {},
  'chat.message-sent': { envelopeId: 'id' },
  'proof.unblurred-requested': { side: 'id' },
  'proof.unblurred-opened': {},
  // Rulings and appeals (Tasks 12, 24). `ruling.final` records "Decision overruled" or "stands".
  'ruling.proposed': RULING,
  'ruling.approved': RULING,
  'ruling.sent-back': { rulingId: 'id' },
  'ruling.published': RULING,
  'appeal.opened': { side: 'id' },
  // Task 24: no uninvolved reviewer exists; the appeal waits and the owner is alerted.
  'appeal.waiting': {},
  'ruling.final': { rulingId: 'id', round: 'number', overturned: 'bool' },
  'ruling.executed': { rulingId: 'id', txHash: 'hex64' },
  // Ruling-winner reasons (lead 22 Nov): why the moderation process's ruling payout waits on its
  // winner (`winner-committed`, `winner-offline`), or `none` once the winner took part (system).
  'ruling.payout-waiting': { reason: 'id' },
  // Review p4t22 M1 (d): the moderation ruling gate refused a ruling (its refusal code, `none` once
  // it no longer does), from the moderation process; and (e) a second approval added to a ruling
  // published on one tap that the gate refused `needs-second`.
  'ruling.gate-refused': { rulingId: 'id', reason: 'id' },
  'ruling.second-approved': RULING,
  // Review p4t22 N1: a senior's new round-1 ruling in place of one the gate refused as revoked.
  'ruling.re-proposed': { ...RULING, replaces: 'id' },
  'dispute.complied': { txHash: 'hex64' },
  // Plan 4 Task 12 (A6): the seller's payment proof waits for its confirmations, or was refused on a
  // later check; the seller let the comply time pass with no proof (the case goes to a senior).
  'dispute.proof-pending': { txHash: 'hex64' },
  'dispute.proof-refused': { txHash: 'hex64' },
  'dispute.comply-lapsed': { seq: 'number' },
  // Holds, freezes and the ban stages (Tasks 11, 12, 27; the single `account.banned` is replaced).
  'hold.placed': { accountId: 'uuid', side: 'id', kind: 'id' },
  'hold.lifted': { accountId: 'uuid', side: 'id', kind: 'id' },
  // Owner 2026-11-02: a moderator freezes a party who ignored the dispute or a ruling (Task 11),
  // or a ruling's account action does (Task 12, which writes only `accountId`).
  'account.frozen': { accountId: 'uuid', side: 'id', reason: 'id' },
  'account.freeze-lifted': { accountId: 'uuid', side: 'id' },
  // A recovery-code hold extended or ended by staff (lead hold v3 review; owner G35).
  'hold.extended': { accountId: 'uuid', holdUntil: 'iso' },
  // D-064: `via` 'secure-jabber' when staff reached the account holder on their proven Jabber address.
  'hold.ended': { accountId: 'uuid', via: 'id' },
  'account.trade-banned': BAN,
  'account.site-banned': BAN,
  // Review S6: the ban id; MF2: how many ban-list rows a lifetime site ban's lift removed.
  'account.ban-lifted': { accountId: 'uuid', banId: 'id', kind: 'id', identifiersRemoved: 'number' },
  // A timed ban ended (Task 27): by the settle job, or by a new ban's place route (review S5).
  'account.reinstated': { accountId: 'uuid', kind: 'id' },
  // The staff Accounts page's lookup (staff/accountLookup.ts): how it matched ('name' | 'code') and
  // the account found, or `found: 0`. Never the query text, never a trade code.
  'account.looked-up': { by: 'id', accountId: 'uuid', found: 'number' },
  // Liens (Task 25, rewritten 2026-10-29c) and owed fees (Revision 2026-10-29c).
  'lien.placed': LIEN,
  'lien.suspended': { lienId: 'id' },
  'lien.reactivated': { lienId: 'id' },
  'lien.voided': { lienId: 'id' },
  // Owner 26 Nov 2026: written off by the owner.
  'lien.uncollectible': { lienId: 'id' },
  'lien.repaid': { lienId: 'id', repaymentCode: 'id' },
  'fee.owed': { accountId: 'uuid', amountAtomic: 'amount' },
  // Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md). No reason text: it stays in
  // lien_rate_requests (Task 3: details never carry staff notes).
  'lien.recovery-reserved': { lienId: 'id', amountAtomic: 'amount' },
  'lien.recovered': { lienId: 'id', amountAtomic: 'amount', remainingAtomic: 'amount' },
  'lien.recovery-released': { lienId: 'id', amountAtomic: 'amount' },
  // Review M2: a late-paid recovery past what the lien still owed (the ledger records only what was owed).
  'lien.over-recovered': { lienId: 'id', amountAtomic: 'amount' },
  // Q6 (provisional, 17 Nov): a recovery paid after its lien was voided, overturned or suspended: for staff.
  'lien.recovered-after-end': { lienId: 'id', status: 'id', amountAtomic: 'amount' },
  // Q2: the creditor's device signed the address its recoveries go to (the address is never logged).
  'lien.recovery-address-set': { lienId: 'id' },
  // Review B1: the moderation service's signed statement of the lien was stored.
  'lien.statement': { lienId: 'id', rateBps: 'number' },
  'lien.rate-proposed': { lienId: 'id', requestId: 'id', rateBps: 'number' },
  'lien.rate-approved': { lienId: 'id', requestId: 'id', rateBps: 'number' },
  'lien.rate-rejected': { lienId: 'id', requestId: 'id' },
  // Recommended account limits (Task 26).
  'limits.recommended': { recId: 'id', accountId: 'uuid', capUsd: 'number', stage: 'id', fromCode: 'id' },
  'limits.decided': { recId: 'id', approved: 'bool', fromCode: 'id' },
  // Staff management (Task 7) and per-person grants (Task 30).
  'staff.invite-created': { inviteId: 'id', role: 'id' },
  'staff.invite-cancelled': { inviteId: 'id' },
  'staff.joined': { staffId: 'uuid', role: 'id' },
  'staff.switched-off': { staffId: 'uuid' },
  'staff.switched-on': { staffId: 'uuid', role: 'id' },
  // The training library's curation (Task 19, lead call 18 Nov): a case marked with its masks, or unmarked.
  'staff.training-marked': { trainingId: 'id', masks: 'number' },
  'staff.training-unmarked': { trainingId: 'id' },
  'staff.removed': { staffId: 'uuid' },
  // D-032 (owner G60): the owner reset a staff member's security; the link was used.
  'staff.security-reset': { staffId: 'uuid', inviteId: 'id' },
  'staff.security-reset-finished': { staffId: 'uuid' },
  'staff.role-set': { staffId: 'uuid', from: 'id', to: 'id' },
  'staff.hours-set': { staffId: 'uuid' },
  'staff.grants-set': { staffId: 'uuid', ticketsHandle: 'bool', feedbackRead: 'bool', ban: 'bool', liftBan: 'bool' },
  // Owner 26 Nov 2026: one person's share of the fee, basis points of the fee (null = the role's default).
  'staff.pay-set': { staffId: 'uuid', from: 'setting', to: 'setting' },
  'staff.session-ended-hours': { staffId: 'uuid' },
  // Lead re-review 6 Nov item 1: a staff member or the owner changes their own login methods or ends
  // one of their sessions on the staff site (the method kind only: never a fingerprint or a label).
  'staff.method-added': { method: 'id' },
  'staff.method-removed': { method: 'id' },
  // Chat membership design task 8: one's own staff device key certified or revoked (its id only).
  'staff.device-certified': { deviceKeyId: 'id' },
  'staff.device-revoked': { deviceKeyId: 'id' },
  'staff.session-ended': {},
  // Lead review 7 Nov M1: silencing actions on the staff site.
  // Owner-alerts review OA2: which kind of alert was hidden (one), or how many (all at once); never its detail.
  'staff.alert-seen': { kind: 'id', count: 'number' },
  'staff.push-removed': {},
  // Shifts and pay (Task 33).
  'staff.welcome-acknowledged': {},
  'shift.clocked-in': { shiftId: 'id' },
  'shift.clocked-out': { shiftId: 'id', minutes: 'number' },
  'shift.abandoned': { shiftId: 'id', ended: 'id' },
  'pay.paid': { staffId: 'uuid', kind: 'id', usdCents: 'amount', atomic: 'amount', ref: 'id' },
  'pay.clawback': { staffId: 'uuid', usdCents: 'amount', rulingId: 'id' },
  // Owner 26 Nov: the payroll wallet's send of a clock-out payout (its id, amount and tx id; never the address).
  'pay.sent': { ref: 'id', atomic: 'amount', txHash: 'hex64' },
  'pay.send-failed': { ref: 'id', reason: 'id' },
  // Owner 26 Nov 2026: a dispute's pay as earned, for the audit: the share of the fee used (basis
  // points), the XMR it came to, and whether the role's minimum paid instead.
  'pay.earned': { staffId: 'uuid', feeBp: 'setting', atomic: 'amount', usdCents: 'amount', minimum: 'bool', round: 'number' },
  // D-041: a staff member's own pre-approved payout addresses (the id only, never the address).
  'pay.address-added': { addressId: 'id' },
  'pay.address-removed': { addressId: 'id' },
  // Past reputation (Plan 5 Task 10, owner 2026-11-02): a senior moderator or the owner sets or
  // clears a claim's verified dollar figure. The figure itself is never logged.
  'pastrep.verified-usd-set': { claimId: 'uuid', cleared: 'bool' },
  // Review disputes (Plan 5 Task 19): the dispute id and the outcome only, never the trader's reason,
  // the moderator's reason, the review's text or its trade.
  'review.disputed': { disputeId: 'uuid' },
  'review.dispute-decided': { disputeId: 'uuid', outcome: 'id' },
  // Plan 5 Task 11: a moderator's decision on a claim. The claim, its trader and its site (spaces as
  // '-'), and on approval the trades the moderator saw; never the evidence link, the fingerprint or
  // the reason text.
  'pastrep.approved': { claimId: 'uuid', accountId: 'uuid', site: 'id', trades: 'number' },
  'pastrep.rejected': { claimId: 'uuid', accountId: 'uuid', site: 'id' },
  'pastrep.revoked': { claimId: 'uuid', accountId: 'uuid', site: 'id' },
  // The owner (Task 6).
  'owner.setup-completed': {},
  'owner.key-added': { credentialId: 'id' },
  'owner.key-removed': { credentialId: 'id' },
  'settings.changed': { field: 'id', from: 'setting', to: 'setting' },
  // The fee wallet's sweep to the owner's cold wallet (B-006): amounts and the tx id, never the address.
  'treasury.swept': { amountAtomic: 'amount', txHash: 'hex64' },
  'treasury.sweep-failed': { amountAtomic: 'amount', reason: 'id' },
  // Site controls (Tasks 8, 28).
  'site.stopped': {},
  'site.resumed': {},
  'site.banner-set': { kind: 'id' },
  'site.banner-removed': {},
  'site.maintenance-on': { kind: 'id' },
  'site.maintenance-off': {},
  // J-04 (owner G19): a planned maintenance announced (its start and end) or withdrawn; never the message.
  'site.maintenance-planned': { startsAt: 'iso', endsAt: 'iso' },
  'site.maintenance-plan-removed': {},
  // Security review 8 Nov M1: the owner turns the 60-day close back on after it switched itself off.
  'site.auto-close-resumed': {},
  'news.published': { newsId: 'id' },
  'news.edited': { newsId: 'id' },
  'news.deleted': { newsId: 'id' },
  // Support tickets (Task 30): the ticket id only, never the text, the trader or the trade.
  'ticket.taken': { ticketId: 'id' },
  'ticket.released': { ticketId: 'id' },
  'ticket.opened': { ticketId: 'id' },
  'ticket.replied': { ticketId: 'id' },
  'ticket.closed': { ticketId: 'id' },
  // D-059 (J-14, ported): a "My account has been compromised" report locked the account (by the
  // system, at the sender's word); a senior moderator or the owner read a report (with the locked
  // account's open trades and the sender's comment), lifted its lock, or closed it. Ids only.
  'account.locked': { accountId: 'uuid', ticketId: 'id' },
  'account.unlocked': { accountId: 'uuid', ticketId: 'id' },
  'account.report-viewed': { ticketId: 'id' },
  'account.report-closed': { ticketId: 'id' },
  'training.copy-saved': {},
  // D-058 (lead 12 Nov): a staff member opened a page of the feedback form list, which names the
  // sender of a named row; how many rows on that page were named (never who).
  'feedback.form-opened': { namedRows: 'number' },
  'log.checkpoint': { id: 'id', hash: 'hex64' },
} as const satisfies Record<string, Schema>;

export type LogAction = keyof typeof LOG_ACTIONS;

/** Action prefixes that the staff log scope never shows (Task 3; Task 33's pay and shifts too). */
export const OWNER_ONLY_PREFIXES = ['staff.', 'settings.', 'owner.', 'site.', 'shift.', 'pay.', 'news.', 'treasury.'] as const;

/**
 * Plan 4 Task 19: the Activity log page's "kind" filter. Each action belongs to exactly one kind,
 * by its prefix (log.test.ts pins that every action has one). Kinds made only of owner-only
 * prefixes are the owner's (`ownerOnly`), never offered or matched in the staff scope.
 */
export const LOG_KINDS = {
  trade: { prefixes: ['trade.'], ownerOnly: false },
  dispute: { prefixes: ['dispute.', 'case.'], ownerOnly: false },
  chat: { prefixes: ['chat.', 'proof.'], ownerOnly: false },
  ruling: { prefixes: ['ruling.', 'appeal.'], ownerOnly: false },
  account: { prefixes: ['hold.', 'account.', 'lien.', 'fee.', 'limits.', 'pastrep.', 'review.'], ownerOnly: false },
  staff: { prefixes: ['staff.', 'shift.', 'pay.'], ownerOnly: true },
  owner: { prefixes: ['owner.', 'settings.', 'treasury.'], ownerOnly: true },
  site: { prefixes: ['site.', 'news.'], ownerOnly: true },
  other: { prefixes: ['ticket.', 'training.', 'feedback.', 'log.'], ownerOnly: false },
} as const satisfies Record<string, { prefixes: readonly string[]; ownerOnly: boolean }>;
export type LogKind = keyof typeof LOG_KINDS;

export function isLogKind(k: unknown): k is LogKind {
  return typeof k === 'string' && Object.hasOwn(LOG_KINDS, k);
}

/** The kind an action belongs to, or undefined (log.test.ts: never for a known action). */
export function kindOf(action: string): LogKind | undefined {
  for (const [k, v] of Object.entries(LOG_KINDS) as Array<[LogKind, (typeof LOG_KINDS)[LogKind]]>) {
    if (v.prefixes.some((p) => action.startsWith(p))) return k;
  }
  return undefined;
}

export class LogDetailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogDetailError';
  }
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AMOUNT = /^(0|[1-9]\d{0,39})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fits(kind: Kind, v: unknown): boolean {
  if (typeof v === 'string' && v.length > 64) return false;
  switch (kind) {
    case 'id':
      return typeof v === 'string' && ID.test(v);
    case 'uuid':
      return typeof v === 'string' && UUID.test(v);
    case 'amount':
      return typeof v === 'string' && AMOUNT.test(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'bool':
      return typeof v === 'boolean';
    case 'iso':
      return v === null || (typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v)));
    case 'hex64':
      return typeof v === 'string' && HEX64.test(v);
    case 'setting':
      return v === null || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?\d{1,30}(\.\d{1,12})?$/.test(v));
  }
}

export function isLogAction(a: unknown): a is LogAction {
  return typeof a === 'string' && Object.hasOwn(LOG_ACTIONS, a);
}

/**
 * Refuses an unknown action, a detail that is not a plain object, an unknown key, a value of the
 * wrong kind and any string over 64 characters. The keys an action lists are all optional.
 */
export function assertDetail(action: LogAction, detail: object): void {
  if (!isLogAction(action)) throw new LogDetailError('unknown log action');
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) throw new LogDetailError('detail is not an object');
  const proto = Object.getPrototypeOf(detail) as unknown;
  if (proto !== Object.prototype && proto !== null) throw new LogDetailError('detail is not a plain object');
  const schema: Schema = LOG_ACTIONS[action];
  for (const [k, v] of Object.entries(detail)) {
    const kind = Object.hasOwn(schema, k) ? schema[k] : undefined;
    // The key is named, never the value (it could be the very text that must not be logged).
    if (kind === undefined) throw new LogDetailError(`detail key not allowed for ${action}: ${k.slice(0, 32)}`);
    if (!fits(kind, v)) throw new LogDetailError(`detail value refused for ${action}.${k}`);
  }
}
