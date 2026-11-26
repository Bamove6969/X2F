/**
 * Plan 4 Task 19: the Activity log page's words, kept apart from the React. `describeLog` is the
 * plan's single function with one sentence per action; where board StaffLog has an example, the
 * sentence mirrors it ("Tapped I've paid", "Opened the trade chat", "Requested the unblurred
 * payment proof", "Escrow secured after 10 confirmations", "Changed the large-trade limit from 500
 * to 1,000 USD", "Ended dmitri_k's session at the end of their login hours"). Every other sentence
 * is draft copy. COPY-UNSIGNED
 *
 * A sentence is built from the entry's action and its detail only (ids, enums, amounts and setting
 * numbers: never chat text, a ruling's reason, an address or an IP, Plan 4 Global Constraints); an
 * id in the detail is shown by the display name the API sent with the page, else not at all.
 */
import type { LogEntry, LogKind } from '../api.js';
import { OUTCOME_LABELS, codeText, xmrShort } from './modModel.js';

const ROLE_WORDS: Readonly<Record<string, string>> = { mod: 'moderator', senior: 'senior moderator', helper: 'helper', owner: 'owner' };
const ROLE_LABELS: Readonly<Record<string, string>> = { mod: 'Moderator', senior: 'Senior moderator', helper: 'Helper', owner: 'Owner', buyer: 'Buyer', seller: 'Seller' };

/** The "Who" column's role word: "Moderator", "Buyer"; nothing for the system (board StaffLog). */
export function whoRole(e: Pick<LogEntry, 'actor'>): string {
  return e.actor.kind === 'system' ? '' : (ROLE_LABELS[e.actor.role ?? ''] ?? '');
}

/** The "Who" column's name: the display name, "system", or the side when no name is known. */
export function whoName(e: Pick<LogEntry, 'actor'>): string {
  if (e.actor.kind === 'system') return 'system';
  return e.actor.name ?? (e.actor.kind === 'trader' ? (ROLE_LABELS[e.actor.role ?? ''] ?? 'a trader') : 'a staff member');
}

/** The board's setting names: "the large-trade limit". */
const SETTING_WORDS: Readonly<Record<string, { name: string; unit?: string }>> = {
  large_trade_limit_usd: { name: 'the large-trade limit', unit: 'USD' },
  first_response_h: { name: 'the first-reply time', unit: 'hours' },
  appeal_window_h: { name: 'the appeal window', unit: 'hours' },
  payModFeeBp: { name: "a moderator's share of the fee", unit: 'basis points (100 = 1% of the fee)' },
  paySeniorFeeBp: { name: "a senior moderator's share of the fee", unit: 'basis points (100 = 1% of the fee)' },
  payModDisputeUsdCents: { name: "a moderator's minimum per dispute", unit: 'US cents' },
  paySeniorDisputeUsdCents: { name: "a senior moderator's minimum per dispute", unit: 'US cents' },
  payModFlatUsdCents: { name: "a moderator's flat amount per dispute", unit: 'US cents' },
  paySeniorFlatUsdCents: { name: "a senior moderator's flat amount per dispute", unit: 'US cents' },
};

const groups = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const num = (v: unknown) => (typeof v === 'number' ? groups(String(v)) : typeof v === 'string' ? groups(v) : 'not set');
/** Basis points of the fee as a percent of the fee; null = the role's default. */
const pct = (v: unknown) => (typeof v === 'number' ? `${String(v / 100)}%` : "the role's default");
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const xmr = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? `${xmrShort(v)} XMR` : '');

const withWords = (head: string, words: string) => (words === '' ? head : `${head}: ${words}`);

function rulingWords(d: Record<string, unknown>): string {
  const amount = xmr(d.amountAtomic);
  switch (d.outcome) {
    case 'release-to-buyer':
      return amount ? `release ${amount} to the buyer` : 'release to the buyer';
    case 'refund-to-seller':
      return amount ? `refund ${amount} to the seller` : 'refund to the seller';
    default:
      return typeof d.outcome === 'string' && Object.hasOwn(OUTCOME_LABELS, d.outcome) ? OUTCOME_LABELS[d.outcome as keyof typeof OUTCOME_LABELS].toLowerCase() : '';
  }
}

/**
 * The "What happened" sentence for one entry. `names` maps the ids an entry's detail names
 * (`staffId`, `accountId`) to display names.
 */
export function describeLog(e: Pick<LogEntry, 'action' | 'detail' | 'actor' | 'withheld'>, names: Readonly<Record<string, string>> = {}): string {
  const d = e.detail;
  const who = (k: string, fallback: string) => (typeof d[k] === 'string' && names[d[k] as string] ? names[d[k] as string]! : fallback);
  const side = (k = 'side') => (d[k] === 'buyer' || d[k] === 'seller' ? `the ${d[k]}` : 'a trader');
  const base = sentence(e, d, who, side);
  return e.withheld ? `${base} (this entry's details don't match what it may hold, so they are not shown)` : base;
}

function sentence(
  e: Pick<LogEntry, 'action' | 'actor'>,
  d: Record<string, unknown>,
  who: (k: string, fallback: string) => string,
  side: (k?: string) => string,
): string {
  switch (e.action) {
    // The trade's own steps.
    case 'trade.setup-done': return 'Escrow set up, waiting for the seller to fund it';
    case 'trade.fund-started': return 'Started funding the escrow';
    case 'trade.chain': {
      const n = typeof d.confirmations === 'number' ? d.confirmations : null;
      const unlocked = typeof d.unlockedAtomic === 'string' && d.unlockedAtomic !== '0';
      if (unlocked && n !== null) return `Escrow secured after ${n} confirmations`;
      const got = xmr(d.receivedAtomic);
      return got ? `Escrow funding seen: ${got}${n !== null ? `, ${n} confirmation${n === 1 ? '' : 's'}` : ''}` : 'Escrow funding seen';
    }
    case 'trade.mark-paid': return "Tapped I've paid";
    case 'trade.extend': return 'Gave the buyer more time to pay';
    case 'trade.request-refund': return 'Asked for a refund';
    case 'trade.buyer-cancel': return 'Cancelled the trade (buyer)';
    case 'trade.buyer-cancel-recorded': return "Cancelled the trade; it's carried out when the hold ends";
    case 'trade.propose-cancel': return 'Proposed cancelling the trade';
    case 'trade.accept-cancel': return 'Accepted cancelling the trade';
    case 'trade.withdraw-cancel': return 'Withdrew the cancel proposal';
    case 'trade.confirm-cancel': return 'Confirmed the cancel';
    case 'trade.return-confirmed': return 'The returned XMR is confirmed';
    case 'trade.walk-away': return 'Walked away from the trade';
    case 'trade.release-started': return 'Started releasing the XMR';
    case 'trade.release-claimed': return 'Said the XMR was released';
    case 'trade.settled': return d.kind === 'release' ? 'The XMR reached the buyer; trade complete' : 'The trade settled';
    case 'trade.open-dispute': return 'Opened a dispute';
    case 'trade.escalate': return 'Escalated to a moderator';
    case 'trade.pause': return 'Trade timers paused (maintenance)';
    case 'trade.resume': return 'Trade timers resumed';
    case 'trade.system-cancel': return 'X2F cancelled the trade';
    case 'trade.tick': return 'A trade deadline passed';
    // Disputes and the case.
    case 'dispute.opened': return `Dispute opened${d.afterRefund === true ? ' after the refund' : ''}`;
    case 'dispute.assigned': return e.actor.kind === 'staff' ? 'Took the case' : `Assigned the case to ${who('staffId', 'a moderator')}`;
    case 'dispute.unassigned': return `The case went back to the queue; ${who('staffId', 'its moderator')} left it`;
    case 'dispute.refund-after-ruling': return 'The seller was refunded after a ruling; the case needs a new ruling';
    case 'dispute.complied': return 'The seller sent the XMR the ruling asked for';
    case 'case.opened': return 'Opened the case';
    case 'chat.read': return 'Opened the trade chat';
    case 'chat.message-requested': return 'Wrote to both traders';
    case 'chat.message-sent': return 'The message to both traders was sent';
    case 'proof.unblurred-requested': return `Requested the unblurred payment proof from ${side()}`;
    case 'proof.unblurred-opened': return 'Opened the unblurred payment proof';
    // Rulings and appeals.
    case 'ruling.proposed': return withWords('Proposed a ruling', rulingWords(d));
    case 'ruling.approved': return withWords('Approved the ruling', rulingWords(d));
    case 'ruling.sent-back': return 'Sent the ruling back';
    case 'ruling.published': return withWords('Published the ruling', rulingWords(d));
    case 'appeal.opened': return 'Appealed the ruling';
    case 'appeal.waiting': return 'The appeal is waiting for a reviewer who was not involved';
    case 'ruling.final': return d.overturned === true ? 'Appeal decided: decision overruled' : 'Decision final';
    case 'ruling.executed': return 'The ruling was carried out';
    // Ruling-winner reasons (lead 22 Nov), from the moderation process. COPY-UNSIGNED
    case 'ruling.payout-waiting':
      return d.reason === 'winner-committed' ? "The ruling's payout waits: the winner's app reports it is committed to an earlier payout"
        : d.reason === 'winner-offline' ? "The ruling's payout waits: the winner's app has not taken part"
        : "The winner's app is taking part in the ruling's payout";
    // Review p4t22 M1 (d, e), from the moderation process and the rescue. COPY-UNSIGNED
    case 'ruling.gate-refused':
      return d.reason === 'none' ? 'The moderation service accepts the ruling again'
        : d.reason === 'needs-second' ? 'The moderation service will not carry out the ruling: it needs a second person\'s approval'
        : d.reason === 'revoked' ? 'The moderation service will not carry out the ruling: the moderator who signed it was switched off, removed or had their security keys reset'
        : d.reason === 'no-terms' ? "The moderation service will not carry out the ruling: it has no record of the trade's terms"
        : `The moderation service will not carry out the ruling (${String(d.reason)})`;
    case 'ruling.second-approved': return 'Added the second approval the moderation service asked for';
    // Review p4t22 N1. COPY-UNSIGNED
    case 'ruling.re-proposed': return withWords('Proposed a new ruling in place of one the moderation service refused', rulingWords(d));
    // Accounts.
    case 'hold.placed': return `Put a trading hold on ${side()}`;
    case 'hold.lifted': return `Lifted the trading hold on ${side()}`;
    case 'hold.extended': return 'Extended a trading hold';
    case 'hold.ended': return d.via === 'secure-jabber' ? 'Ended a trading hold after reaching the owner of the account on Jabber' : 'Ended a trading hold';
    case 'account.frozen': return `Froze ${side()}'s account`;
    case 'account.freeze-lifted': return `Lifted the freeze on ${side()}'s account`;
    case 'account.trade-banned': return d.permanent === true ? 'Banned an account from trading for good' : 'Banned an account from trading for a set time';
    case 'account.site-banned': return d.permanent === true ? 'Banned an account from X2F for good' : 'Banned an account from X2F for a set time';
    case 'account.ban-lifted': return 'Lifted a ban';
    case 'account.reinstated': return 'An account was reinstated at the end of its ban';
    // The Accounts page's lookup (spec 6.6). COPY-UNSIGNED
    case 'account.looked-up': {
      const via = d.by === 'code' ? 'trade code' : 'display name';
      return d.found === 0 ? `Looked up an account by ${via}; none matched` : `Looked up ${who('accountId', 'an account')} by ${via}`;
    }
    case 'lien.placed': return `Placed a lien of ${xmr(d.amountAtomic) || 'the trade amount'}`;
    case 'lien.suspended': return 'A lien was suspended while the appeal is open';
    case 'lien.reactivated': return 'A lien is in force again';
    case 'lien.voided': return 'A lien was cancelled';
    case 'lien.uncollectible': return 'Wrote a lien off as uncollectible';
    case 'lien.repaid': return 'A lien was repaid';
    case 'fee.owed': return `An account owes the 1% fee: ${xmr(d.amountAtomic) || 'the fee'}`;
    case 'limits.recommended': return `Recommended account limits${typeof d.capUsd === 'number' ? ` of ${num(d.capUsd)} USD` : ''}`;
    case 'limits.decided': return d.approved === true ? 'Approved the recommended limits' : 'Turned down the recommended limits';
    // COPY-UNSIGNED (Plan 5 Task 19).
    case 'review.disputed': return 'A trader disputed a review of them';
    case 'review.dispute-decided': return d.outcome === 'removed' ? 'Removed a disputed review' : d.outcome === 'comments-removed' ? 'Removed some comments of a disputed review' : 'Let a disputed review stand';
    case 'pastrep.verified-usd-set': return d.cleared === true ? 'Cleared a past-reputation dollar figure' : 'Set a past-reputation dollar figure';
    // Staff (owner only).
    case 'staff.invite-created': return `Created an invite link for a new ${ROLE_WORDS[str(d.role)] ?? 'staff member'}`;
    case 'staff.invite-cancelled': return 'Cancelled an invite link';
    case 'staff.training-marked': return `Marked a case for the training library${typeof d.masks === 'number' ? ` (${num(d.masks)} extra ${d.masks === 1 ? 'mask' : 'masks'})` : ''}`;
    case 'staff.training-unmarked': return 'Took a case out of the training library';
    case 'staff.joined': return `${who('staffId', 'A new staff member')} joined as ${ROLE_WORDS[str(d.role)] ?? 'staff'}`;
    case 'staff.switched-off': return `Switched off ${who('staffId', 'a staff member')}`;
    case 'staff.switched-on': return `Switched on ${who('staffId', 'a staff member')}`;
    case 'staff.removed': return `Removed ${who('staffId', 'a staff member')}`;
    case 'staff.security-reset': return `Reset ${who('staffId', 'a staff member')}'s security`;
    case 'staff.security-reset-finished': return `${who('staffId', 'A staff member')} set up new security`;
    case 'staff.role-set': return `Changed ${who('staffId', 'a staff member')}'s role from ${ROLE_WORDS[str(d.from)] ?? str(d.from)} to ${ROLE_WORDS[str(d.to)] ?? str(d.to)}`;
    case 'staff.hours-set': return `Changed ${who('staffId', 'a staff member')}'s login hours`;
    case 'staff.grants-set': return `Changed ${who('staffId', 'a staff member')}'s extra access`;
    case 'staff.pay-set': return `Changed ${who('staffId', 'a staff member')}'s share of the fee from ${pct(d.from)} to ${pct(d.to)}`;
    case 'staff.session-ended-hours': return `Ended ${who('staffId', 'a staff member')}'s session at the end of their login hours`;
    case 'staff.method-added': return 'Added a login method';
    case 'staff.method-removed': return 'Removed a login method';
    case 'staff.session-ended': return 'Ended one of their sessions';
    case 'staff.alert-seen': return 'Marked alerts as seen';
    case 'staff.push-removed': return 'Turned off notifications on a device';
    case 'staff.welcome-acknowledged': return 'Read the welcome page';
    case 'shift.clocked-in': return 'Clocked in';
    case 'shift.clocked-out': return typeof d.minutes === 'number' ? `Clocked out after ${d.minutes} minutes` : 'Clocked out';
    case 'shift.abandoned': return 'A shift ended without a clock-out';
    case 'pay.paid': return 'Pay recorded';
    case 'pay.clawback': return 'Pay taken back for an overruled decision';
    case 'pay.earned': return d.minimum === true ? `${who('staffId', 'A staff member')} earned the minimum for a dispute` : `${who('staffId', 'A staff member')} earned ${pct(d.feeBp)} of the fee${xmr(d.atomic) ? `, ${xmr(d.atomic)}` : ''}`;
    case 'pay.address-added': return 'Added a payout address';
    case 'pay.address-removed': return 'Removed a payout address';
    // The owner, settings, the site.
    case 'owner.setup-completed': return 'Finished setting up X2F';
    case 'owner.key-added': return 'Added an owner security key';
    case 'owner.key-removed': return 'Removed an owner security key';
    case 'settings.changed': {
      const s = SETTING_WORDS[str(d.field)];
      const unit = s?.unit ? ` ${s.unit}` : '';
      return `Changed ${s?.name ?? `the setting ${str(d.field) || ''}`.trim()} from ${num(d.from)} to ${num(d.to)}${unit}`;
    }
    case 'treasury.swept': return `Swept ${xmr(d.amountAtomic) || 'the fees'} to the cold wallet`;
    case 'treasury.sweep-failed': return 'The sweep to the cold wallet failed';
    case 'site.stopped': return 'Paused new trades (emergency stop)';
    case 'site.resumed': return 'Resumed trading';
    case 'site.banner-set': return 'Showed a banner to everyone';
    case 'site.banner-removed': return 'Removed the banner';
    case 'site.maintenance-on': return d.kind === 'planned' ? 'Started planned maintenance' : 'Started emergency maintenance';
    case 'site.maintenance-off': return 'Ended maintenance';
    case 'site.maintenance-planned': return 'Announced planned maintenance';
    case 'site.maintenance-plan-removed': return 'Withdrew the planned maintenance';
    case 'site.auto-close-resumed': return 'Turned the 60-day account close back on';
    case 'news.published': return 'Published a news post';
    case 'news.edited': return 'Edited a news post';
    case 'news.deleted': return 'Deleted a news post';
    case 'ticket.replied': return 'Replied to a support ticket';
    case 'ticket.closed': return 'Closed a support ticket';
    case 'training.copy-saved': return 'Saved a training case';
    case 'feedback.form-opened': return 'Opened the feedback messages';
    case 'log.checkpoint': return 'Activity log checkpoint';
    default:
      return e.action;
  }
}

/** The kind filter's words. */
export const KIND_LABELS: Readonly<Record<LogKind, string>> = {
  trade: 'Trade steps',
  dispute: 'Disputes',
  chat: 'Chat and proof',
  ruling: 'Rulings and appeals',
  account: 'Accounts',
  staff: 'Staff',
  owner: 'Owner and settings',
  site: 'Site and news',
  other: 'Other',
};

/** "Today 09:50", "Yesterday 22:10", else "12 Nov 09:50" (board StaffLog's When), on this device's clock. */
export function whenText(iso: string, now: Date): string {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${hm}`;
  if (diff === 1) return `Yesterday ${hm}`;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${d.getDate()} ${month}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`} ${hm}`;
}

/** The trade column: the code in groups of four, or nothing for an entry on no trade. */
export const tradeText = (code: string | null) => (code === null ? '' : codeText(code.replaceAll('-', '')));

/** The Active disputes option (board StaffLog): "<code> · <method> · <xmr> XMR · <status>". */
const STATUS_WORDS: Readonly<Record<string, string>> = {
  open: 'open',
  'awaiting-approval': 'waiting for approval',
  published: 'ruled, appeal window open',
  appealed: 'appealed',
  final: 'final',
  complying: 'waiting for the seller to comply',
};
export function activeLabel(a: { code: string; methodName: string; xmr: string; status: string }): string {
  return `${tradeText(a.code)} · ${a.methodName} · ${xmrShort(a.xmr)} XMR · ${STATUS_WORDS[a.status] ?? a.status}`;
}
