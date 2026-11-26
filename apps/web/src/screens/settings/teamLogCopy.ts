// Team audit v2 (owner 26 Nov 2026): the Team log screen's words. COPY-UNSIGNED: no Claude Design
// board yet (NEEDS_DESIGN_TEAM in test/team-tripwires.test.ts); the owner signs them off with it.
import type { TeamLogCategory, TeamLogEntry } from '@x2f/auth-client';
import { formatDateTime } from '../../ui/dates.js';
import { xmrOf } from './teamCopy.js';

export const TEAM_LOG_PATH = '/settings/team/log';

/** What each action reads as, after the actor's name ("Circa member posted an offer"). An unknown one shows its code. */
export const LOG_WORDS: Record<string, string> = {
  // A member's work.
  'offer-posted': 'posted an offer',
  'offer-paused': 'turned an offer off',
  'offer-relisted': 'turned an offer on',
  'offer-removed': 'removed an offer',
  'trade-taken': 'started a trade',
  'trade-wallet-set': "set a trade's payout wallet",
  'dispute-opened': 'opened a dispute',
  'appeal-filed': 'filed an appeal',
  'mark-paid': 'marked the payment sent',
  extend: 'gave more time to pay',
  'request-refund': 'cancelled after the time to pay',
  'buyer-cancel': 'cancelled as the buyer',
  'propose-cancel': 'proposed cancelling',
  'accept-cancel': 'agreed to cancel',
  'withdraw-cancel': 'withdrew a cancel',
  'walk-away': 'walked away from the trade',
  'confirm-cancel': 'confirmed the cancel',
  'hold-changes-cancelled': 'cancelled waiting changes',
  'hold-changes-approved': 'applied waiting changes now',
  'note-added': 'added a note on a trader',
  'release-started': 'released XMR',
  // The team's own changes.
  'member-invited': 'invited',
  'member-joined': 'joined the team',
  'abilities-changed': 'changed the boxes of',
  'limits-changed': 'changed the limits of',
  'member-removed': 'removed',
  'invite-closed': 'closed the unused invite of',
  // Access.
  'member-login': 'logged in',
  'session-ended': 'ended a session of',
  'attempt-refused': 'was refused',
  'attempts-throttled': 'was refused many times; more refusals this hour are not listed',
};

/** Actions whose sentence names the member they are about after the verb ("You removed Ana"). */
const ABOUT = new Set(['member-invited', 'abilities-changed', 'limits-changed', 'member-removed', 'invite-closed', 'session-ended']);

/** The one-line sentence of a row. */
export function logSentence(e: TeamLogEntry): string {
  const who = e.actorKind === 'lead' ? 'You' : e.actorKind === 'system' ? 'X2F' : (e.memberName ?? 'A removed member');
  const verb = LOG_WORDS[e.action] ?? e.action;
  return ABOUT.has(e.action) ? `${who} ${verb} ${e.subjectName ?? 'a removed member'}` : `${who} ${verb}`;
}

/** Why a request was refused, in words. */
// prettier-ignore
export const REFUSAL_WORDS: Record<string, string> = { 'owner-only': 'only you can do that', forbidden: 'no box for it', 'outside-trade-band': 'outside their trade-size limit', 'outside-login-hours': 'outside their working hours', 'member-cannot-sign': 'members never sign escrow' }; // not-a-refusal: past refusals' reasons, shown in the log

const BOX_WORDS = (ids: unknown, label: (id: string) => string): string =>
  Array.isArray(ids) && ids.length > 0 ? ids.map((x) => label(String(x))).join(', ') : 'none';

const hoursText = (h: unknown): string => {
  if (h === 'any' || h === null || h === undefined) return 'Any time';
  if (typeof h === 'object') {
    const o = h as { days?: unknown; start?: unknown; end?: unknown; tz?: unknown };
    const days = Array.isArray(o.days) ? o.days.join(' ') : '';
    return `${days} ${String(o.start ?? '')}–${String(o.end ?? '')} ${String(o.tz ?? '')}`.trim();
  }
  return String(h);
};

const bandText = (b: unknown): string => {
  const o = (b ?? {}) as { bandMinAtomic?: unknown; bandMaxAtomic?: unknown };
  if (typeof o.bandMinAtomic !== 'string' || typeof o.bandMaxAtomic !== 'string') return 'No limit';
  return `${xmrOf(o.bandMinAtomic)} to ${xmrOf(o.bandMaxAtomic)} XMR`;
};

const money = (cents: string, currency: string): string => {
  const v = BigInt(cents);
  return `${(v / 100n).toString()}.${(v % 100n).toString().padStart(2, '0')} ${currency}`;
};

/** A row's details as key and value pairs, for its Details panel. Never raw JSON when a word fits. */
export function logFacts(e: TeamLogEntry, boxLabel: (id: string) => string): [string, string][] {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const out: [string, string][] = [['When', formatDateTime(e.at)]];
  if (e.tradeCode !== null) out.push(['Trade', e.tradeCode]);
  if (typeof d.amountAtomic === 'string') out.push(['Amount', `${xmrOf(d.amountAtomic)} XMR`]);
  if (typeof d.fiatCents === 'string' && typeof d.currency === 'string') out.push(['Fiat', money(d.fiatCents, d.currency)]);
  if (typeof d.side === 'string') out.push(['Offer', `${d.side === 'sell' ? 'Selling' : 'Buying'} XMR, priced ${String(d.priceMode ?? '')}`]);
  if (Array.isArray(d.currencies)) {
    out.push(['Currencies', d.currencies.map((c) => String((c as { currency?: unknown }).currency ?? '')).join(', ')]);
  }
  if (Array.isArray(d.methods)) out.push(['Methods', d.methods.map((m) => String((m as { methodId?: unknown }).methodId ?? '')).join(', ')]);
  if (e.action === 'member-invited') out.push(['Boxes', BOX_WORDS(d.abilities, boxLabel)]);
  if (e.action === 'abilities-changed') {
    out.push(['Added', BOX_WORDS(d.added, boxLabel)], ['Removed', BOX_WORDS(d.removed, boxLabel)]);
  }
  if (e.action === 'limits-changed') {
    const before = (d.before ?? {}) as Record<string, unknown>;
    const after = (d.after ?? {}) as Record<string, unknown>;
    out.push(['Trade size before', bandText(before)], ['Trade size now', bandText(after)]);
    out.push(['Hours before', hoursText(before.hours)], ['Hours now', hoursText(after.hours)]);
  }
  if (typeof d.device === 'string') out.push(['Device', d.device]);
  if (typeof d.session === 'string') out.push(['Session', d.session]);
  if (typeof d.reason === 'string') out.push(['Why refused', REFUSAL_WORDS[d.reason] ?? d.reason]);
  if (typeof d.route === 'string') out.push(['What they tried', `${String(d.method ?? '')} ${d.route}`]);
  if (typeof d.about === 'string') out.push(['About', d.about]);
  if (typeof d.count === 'number') out.push(['Changes', String(d.count)]);
  if (typeof d.walletId === 'string') out.push(['Wallet', `…${d.walletId.slice(-6)}`]);
  out.push(['Entry', `#${e.id}`], ['Fingerprint', e.hash.slice(0, 16)]);
  return out;
}

export const CATEGORY_WORDS: Record<TeamLogCategory, string> = {
  work: 'Work',
  team: 'Team changes',
  access: 'Logins and refusals',
};

export const TEAM_LOG_COPY = {
  title: 'Team log',
  back: 'Back to Team',
  intro:
    'Everything your members do, every change to your team, every member login and every request X2F refused them. Entries are never edited or deleted, and each one is sealed to the one before it.',
  memberIntro: 'What you did for this team, and the changes your team lead made to you.',
  loadFailed: 'The team log did not load. Try again in a moment.',
  loading: 'Loading…',
  empty: 'Nothing matches these filters.',
  more: 'Show older entries',
  details: 'Details',
  // Integrity.
  integrityTitle: 'Is the log intact?',
  intact: (n: number) => `Intact: all ${n.toLocaleString('en-US')} entries check out`,
  broken: (id: string) => `Damaged from entry #${id}. Entries from there on cannot be trusted. Contact X2F support.`, // not-a-refusal: the chain check's result
  fingerprintIntro:
    'Save this fingerprint somewhere outside X2F, such as a note or a printout. Later, paste it below: if the log was ever changed, the check fails.',
  fingerprint: (id: string, hash: string) => `#${id}:${hash}`,
  copyFingerprint: 'Copy fingerprint',
  copied: 'Copied',
  checkLabel: 'Check a saved fingerprint',
  checkHint: 'Paste it as you saved it, #id:fingerprint',
  checkButton: 'Check',
  checkBad: 'That is not a fingerprint. It looks like #123:9f2c… with 64 letters and digits after the colon.',
  matches: 'It matches. Nothing before that entry has changed.',
  noMatch: 'It does not match. The log has changed since you saved it, or the fingerprint was copied wrong.',
  // Summary.
  summaryTitle: 'Last 30 days',
  summaryEmpty: 'No members yet.',
  summaryLine: (s: { work: number; logins: number; refused: number; changes: number }) =>
    `${s.work} actions · ${s.logins} logins · ${s.refused} refused · ${s.changes} changes by you`,
  lastSeen: (action: string | null, login: string | null) =>
    `Last action ${action === null ? 'never' : formatDateTime(action)} · last login ${login === null ? 'never' : formatDateTime(login)}`,
  showOnly: (name: string) => `Show only ${name}`,
  status: { invited: 'Invited', active: 'Active', removed: 'Removed' } as const,
  // Filters.
  filtersTitle: 'Filter',
  who: 'Who',
  everyone: 'Everyone',
  kinds: 'What',
  action: 'Action',
  anyAction: 'Any action',
  trade: 'Trade code',
  tradeHint: 'Finds a trade’s entries even after the trade itself is deleted.',
  tradeBad: 'A trade code is four groups of four letters and digits, like ABCD-EFGH-JKMN-PQRS.',
  from: 'From',
  to: 'Until',
  apply: 'Apply filters',
  clear: 'Clear filters',
  // Export.
  exportTitle: 'Download',
  exportIntro:
    'Download the entries these filters match. The JSON file carries each entry’s seal, so anyone can re-check it without X2F.',
  exportCsv: 'Download CSV',
  exportJson: 'Download JSON',
  exporting: 'Preparing the file…',
  exportFailed: 'The download did not start. Try again in a moment.',
  // 429 slow-down on the chain check or the download: each one re-reads the whole log.
  slowDown: (at: string) => `Checking the whole log takes a while, so it runs a few times an hour. Try again after ${formatDateTime(at)}.`,
} as const;
