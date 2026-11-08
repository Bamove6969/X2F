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
 * A ruling's account action is flattened (M6): `accountAction` is its kind (`none`, `freeze`,
 * `trade-ban`, `site-ban`), and a ban's `until` (null = permanent) and `reasonCode` are their own keys.
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
const BAN: Schema = { accountId: 'uuid', until: 'iso', reasonCode: 'id', permanent: 'bool' };

export const LOG_ACTIONS = {
  ...TRADE,
  // Disputes and cases (Tasks 10–11).
  'dispute.opened': { reason: 'id', afterRefund: 'bool', seq: 'number' },
  'dispute.assigned': { staffId: 'uuid' },
  // A switched-off or removed member's open case goes back to the queue (Task 7 x Task 10).
  'dispute.unassigned': { staffId: 'uuid' },
  'case.opened': {},
  'chat.read': {},
  'chat.message-sent': {},
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
  'dispute.complied': { txHash: 'hex64' },
  // Holds, freezes and the ban stages (Tasks 11, 12, 27; the single `account.banned` is replaced).
  'hold.placed': { accountId: 'uuid', side: 'id', kind: 'id' },
  'hold.lifted': { accountId: 'uuid', side: 'id', kind: 'id' },
  'account.frozen': { accountId: 'uuid' },
  // A recovery-code hold extended or ended by staff (lead hold v3 review; owner G35).
  'hold.extended': { accountId: 'uuid', holdUntil: 'iso' },
  'hold.ended': { accountId: 'uuid' },
  'account.trade-banned': BAN,
  'account.site-banned': BAN,
  'account.ban-lifted': { accountId: 'uuid', kind: 'id' },
  // Written on the first request after a timed site ban's `until` (Task 27).
  'account.reinstated': { accountId: 'uuid', kind: 'id' },
  // Liens (Task 25, rewritten 2026-10-29c) and owed fees (Revision 2026-10-29c).
  'lien.placed': LIEN,
  'lien.suspended': { lienId: 'id' },
  'lien.reactivated': { lienId: 'id' },
  'lien.voided': { lienId: 'id' },
  'lien.repaid': { lienId: 'id', repaymentCode: 'id' },
  'fee.owed': { accountId: 'uuid', amountAtomic: 'amount' },
  // Recommended account limits (Task 26).
  'limits.recommended': { recId: 'id', accountId: 'uuid', capUsd: 'number', stage: 'id' },
  'limits.decided': { recId: 'id', approved: 'bool' },
  // Staff management (Task 7) and per-person grants (Task 30).
  'staff.invite-created': { inviteId: 'id', role: 'id' },
  'staff.invite-cancelled': { inviteId: 'id' },
  'staff.joined': { staffId: 'uuid', role: 'id' },
  'staff.switched-off': { staffId: 'uuid' },
  'staff.switched-on': { staffId: 'uuid', role: 'id' },
  'staff.removed': { staffId: 'uuid' },
  'staff.role-set': { staffId: 'uuid', from: 'id', to: 'id' },
  'staff.hours-set': { staffId: 'uuid' },
  'staff.grants-set': { staffId: 'uuid', ticketsHandle: 'bool', feedbackRead: 'bool' },
  'staff.session-ended-hours': { staffId: 'uuid' },
  // Lead re-review 6 Nov item 1: a staff member or the owner changes their own login methods or ends
  // one of their sessions on the staff site (the method kind only: never a fingerprint or a label).
  'staff.method-added': { method: 'id' },
  'staff.method-removed': { method: 'id' },
  'staff.session-ended': {},
  // Lead review 7 Nov M1: silencing actions on the staff site.
  'staff.alert-seen': {},
  'staff.push-removed': {},
  // Shifts and pay (Task 33).
  'staff.welcome-acknowledged': {},
  'shift.clocked-in': { shiftId: 'id' },
  'shift.clocked-out': { shiftId: 'id', minutes: 'number' },
  'shift.abandoned': { shiftId: 'id', ended: 'id' },
  'pay.paid': { staffId: 'uuid', kind: 'id', usdCents: 'amount', atomic: 'amount', ref: 'id' },
  'pay.clawback': { staffId: 'uuid', usdCents: 'amount', rulingId: 'id' },
  // Past reputation (Plan 5 Task 10, owner 2026-11-02): a senior moderator or the owner sets or
  // clears a claim's verified dollar figure. The figure itself is never logged.
  'pastrep.verified-usd-set': { claimId: 'uuid', cleared: 'bool' },
  // The owner (Task 6).
  'owner.setup-completed': {},
  'owner.key-added': { credentialId: 'id' },
  'owner.key-removed': { credentialId: 'id' },
  'settings.changed': { field: 'id', from: 'setting', to: 'setting' },
  // Site controls (Tasks 8, 28).
  'site.stopped': {},
  'site.resumed': {},
  'site.banner-set': { kind: 'id' },
  'site.banner-removed': {},
  'site.maintenance-on': { kind: 'id' },
  'site.maintenance-off': {},
  'news.published': { newsId: 'id' },
  'news.edited': { newsId: 'id' },
  'news.deleted': { newsId: 'id' },
  // Support tickets (Task 30): never the text.
  'ticket.replied': { ticketId: 'id' },
  'ticket.closed': { ticketId: 'id' },
  'training.copy-saved': {},
  'log.checkpoint': { id: 'id', hash: 'hex64' },
} as const satisfies Record<string, Schema>;

export type LogAction = keyof typeof LOG_ACTIONS;

/** Action prefixes that the staff log scope never shows (Task 3; Task 33's pay and shifts too). */
export const OWNER_ONLY_PREFIXES = ['staff.', 'settings.', 'owner.', 'site.', 'shift.', 'pay.', 'news.'] as const;

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
