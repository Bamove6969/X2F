// Plan 2 Task 18: the team screens' words (spec 6.7; owner 2026-10-29c). // COPY-UNSIGNED: no
// Claude Design board yet (NEEDS_DESIGN_TEAM in test/team-tripwires.test.ts); the owner signs it
// off with the board. Refusals (owner-only, a role a member lacks, the member limit, escrow
// signing) are CantDoThat's, worded in ui/cantDoCodes.ts (teamCantDoText).
import { formatDateTime } from '../../ui/dates.js';
import type { TeamRole, TradeBand, WorkingHours } from '@x2f/auth-client';

export const TEAM_PATH = '/settings/team';
export const JOIN_PATH = '/team/join';

export const ROLE_WORDS: Record<TeamRole, string> = {
  offers: 'Offers',
  trades: 'Trades',
};

/** "Offers", "Trades" or "Offers and Trades". */
export function rolesText(roles: readonly TeamRole[]): string {
  return (['offers', 'trades'] as const)
    .filter((r) => roles.includes(r))
    .map((r) => ROLE_WORDS[r])
    .join(' and ');
}

/** "6 Nov 2026, 15:00 UTC" (ui/dates.ts, the one date format). */
const when = (iso: string): string => formatDateTime(iso);

/** What each audit action reads as (an unknown one is shown by its code). */
const AUDIT_WORDS: Record<string, string> = {
  'offer-posted': 'posted an offer',
  'offer-paused': 'turned an offer off',
  'offer-relisted': 'turned an offer on',
  'offer-removed': 'removed an offer',
  'trade-taken': 'started a trade',
  'trade-wallet-set': "set a trade's payout wallet",
  // Old log rows only: the final alert is retired (owner 8 Nov, p6-1).
  'final-alert-seen': 'saw the final alert',
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
};

const ATOMIC_PER_XMR = 1_000_000_000_000n;

/** Atomic units as XMR, exact, trailing zeros trimmed ("0.5", "2"). */
export function xmrOf(atomic: string): string {
  const v = BigInt(atomic);
  const frac = (v % ATOMIC_PER_XMR).toString().padStart(12, '0').replace(/0+$/, '');
  return frac === '' ? (v / ATOMIC_PER_XMR).toString() : `${v / ATOMIC_PER_XMR}.${frac}`;
}

/** An XMR amount as typed ("0.5", "2", up to 12 decimals) in atomic units, or null when it is not one. */
export function atomicOf(xmr: string): string | null {
  const m = /^(\d{1,18})(?:\.(\d{1,12}))?$/.exec(xmr.trim());
  if (!m) return null;
  return (BigInt(m[1]!) * ATOMIC_PER_XMR + BigInt((m[2] ?? '').padEnd(12, '0'))).toString();
}

// J-20 (owner p7-4, p7-11). COPY-UNSIGNED // DESIGN: wording (no board yet: NOT DRAWN).
function bandText(b: TradeBand | null | undefined): string {
  return b === null || b === undefined ? 'Any trade size' : `Trades of ${xmrOf(b.minAtomic)} to ${xmrOf(b.maxAtomic)} XMR`;
}
function hoursText(h: WorkingHours | null | undefined): string {
  if (h === undefined || h === 'any') return 'Any time';
  if (h === null) return 'Working hours unreadable: no logins until you set them again';
  return `${h.days.join(', ')} ${h.start} to ${h.end} (${h.tz})`;
}

export const TEAM_COPY = {
  title: 'Team',
  whatTitle: 'What team members can do',
  what: [
    'Offers: post, change, turn on or off and remove your offers.',
    'Trades: start trades on offers, mark payments sent, cancel and open disputes.',
  ] as const,
  // The lead defaults the owner may change (spec 6.7).
  ownerKeeps: 'Payout wallets, your login methods, security settings and the team itself stay with you.',
  oneReputation: 'Your account has one reputation. Everything a member does shows in the log below.',
  // Owner p7-9 (8 Nov, replacing p4-8's "no stronger than the lead"): members may use ANY login
  // method. Not built yet (lead report 2026-11-08: the join, member logins and their strength need
  // rules first); this line says what the join enforces today, so it changes with the build.
  twoFactors: 'Each member logs in with their own two factors: a PGP key plus a security key, a passkey or a second PGP key.',
  // Plan 3 Task 42 (R44): members cannot release yet.
  releaseNote: 'Releasing or securing coins still happens on your own device.',
  membersTitle: 'Members',
  none: 'No team members yet.',
  count: (n: number, max: number) => `${n} of ${max} members`,
  status: { invited: 'Invited', joining: 'Setting up their login', active: 'Active' } as const,
  inviteUntil: (iso: string) => `Invite works until ${when(iso)}`,
  roles: (roles: readonly TeamRole[]) => rolesText(roles),
  // A member whose boxes are all off. COPY-UNSIGNED
  noBoxes: 'No roles yet',
  // Owner p11-25 (S-105): how chats show the member (the owner's words for the label itself). COPY-UNSIGNED
  chatLabel: (label: string) => `In chats: ${label}`,
  // Job 1c (review 2026-11-09 m3): a member whose boxes no role describes. COPY-UNSIGNED.
  custom: 'Custom',
  changeRoles: (name: string) => `Change roles for ${name}`,
  saveRoles: 'Save roles',
  remove: 'Remove',
  removeLabel: (name: string) => `Remove ${name}`,
  removed: (name: string) => `${name} was removed. Their sessions have ended.`,
  rolesSaved: (name: string) => `Roles saved for ${name}.`,
  pickRole: 'Pick at least one role.',
  inviteTitle: 'Invite a member',
  // Owner p11-25 (S-105, 9 Nov 2026, replacing R44's "Team <name> member: <member>"): chats show a
  // member as "<your display name> Assistant 1", "Assistant 2"; the member's name stays inside the
  // team (this list and the activity log). COPY-UNSIGNED
  nameLabel: 'Their name on your team',
  nameHint: 'Only you and your team see it. Chats show them as "<your name> Assistant 1", "Assistant 2" and so on.',
  inviteButton: 'Make an invite link',
  // Team board (wip/design-brief), the full state, with the 1 Nov limit as a number.
  full: (max: number) => `You have ${max} members, the most allowed. Remove one to add another.`,
  inviteMade: (name: string) => `Invite for ${name} made. Send them this link yourself. It works once, for 24 hours, and is shown only now.`,
  copyLink: 'Copy link',
  copied: 'Copied',
  logTitle: 'Activity log',
  logEmpty: 'No member activity yet.',
  logFilter: 'Show activity of',
  logEveryone: 'Every member',
  logRow: (name: string, action: string) => `${name} ${AUDIT_WORDS[action] ?? action}`,
  logWhen: (iso: string, trade: string | null) => (trade === null ? when(iso) : `${when(iso)}, trade ${trade}`),
  loadFailed: 'Could not load your team. Reload the page to try again.',
  saveFailed: 'Could not save that. Try again.',
  nameInvalid: 'Use 8 to 20 letters, digits, dots, dashes or underscores.', // owner demo notes #126, #127
  nameTaken: 'Someone on your team already has that name.',
  signedOut: 'Log in to manage your team.',
  // J-20 (owner p7-4, p7-11; p11-27). COPY-UNSIGNED // DESIGN: wording (no board yet: NOT DRAWN).
  limits: (band: TradeBand | null | undefined, hours: WorkingHours | null | undefined) => `${bandText(band)} · ${hoursText(hours)}`,
  limitsButton: 'Limits',
  changeLimits: (name: string) => `Change limits for ${name}`,
  bandTitle: 'Trade size',
  bandNone: 'Any trade size',
  bandMin: 'Smallest trade (XMR)',
  bandMax: 'Largest trade (XMR)',
  bandHint: 'Everything this member does on a trade, and every offer they post or turn on, must fall inside these sizes. They can always pause or remove an offer. Offers priced in fiat are outside any limit.', // J-20 review F2. DESIGN: wording
  hoursTitle: 'Working hours',
  hoursAny: 'Any time',
  hoursStart: 'From',
  hoursEnd: 'Until',
  hoursZone: 'Time zone',
  hoursHint: 'The member logs in and works only inside these hours. When they end, the member is logged out.',
  saveLimits: 'Save limits',
  limitsSaved: (name: string) => `Limits saved for ${name}.`,
  badBand: 'Enter the smallest and largest trade in XMR, the largest above zero and not below the smallest.',
  badHours: 'Pick at least one day, and a start and end that differ.',
  firstLoginNote: 'A new member needs no approval to log in. You are told when they log in for the first time.',
  // J-20 review F8 (owner question p11-136, lead default: a member sees their own limits). COPY-UNSIGNED // DESIGN: wording
  myLimitsTitle: 'Your limits',
  myLimitsNote: 'The account owner set these for you.',
} as const;

export const JOIN_COPY = {
  title: 'Join a team',
  loading: 'Checking your invite…',
  gone: 'This invite link has been used, has run out or is not complete. Ask for a new one.',
  // Never the team's name before joining (review 2026-11-08 F3). COPY-UNSIGNED.
  // S-104 (owner p11-21): an invite from a username-and-password login carries no boxes yet. COPY-UNSIGNED
  invited: (name: string, roles: readonly TeamRole[]) =>
    roles.length === 0 ? `You are invited to a team as ${name}. The team lead sets what you may do; it starts later.` : `You are invited to a team as ${name}, for ${rolesText(roles)}.`,
  // The member's Terms step before joining (review 2026-11-08 F1). COPY-UNSIGNED. "to the end" dropped with
  // the read-to-the-end gate (owner demo note #190, 25 Nov 2026).
  termsIntro: 'Before you join, read the Terms of Service and accept them. The key points first:',
  // What the join enforces today; owner p7-9 (any login method) is not built yet (see TEAM_COPY.twoFactors).
  twoFactors: 'You log in with two factors: first a PGP key, then a security key, a passkey or a second PGP key.',
  loginNameLabel: 'Your private login name',
  loginNameHint: 'Only you use it to log in. Nobody else sees it.',
  keyLabel: 'Your PGP public key',
  sendMessage: 'Send me a message',
  decryptLabel: 'Decrypt this message in your PGP app, then paste the code',
  codeLabel: 'Code',
  copyMessage: 'Copy message',
  copied: 'Copied',
  confirmKey: 'Confirm this key',
  secondTitle: 'Add your second factor',
  secondUntil: (iso: string) => `Finish before ${when(iso)}.`,
  useSecurityKey: 'Use a security key',
  usePasskey: 'Use a passkey',
  useSecondPgp: 'Use a second PGP key',
  secondKeyLabel: 'Your second PGP public key',
  finish: 'Finish',
  keyFailed: 'Could not use that key. Check that you pasted the whole public key.',
  codeFailed: 'That code did not work. It may have expired: send a new message and try again.',
  webauthnFailed: 'That did not work. Try again, or choose another second factor.',
  nameInvalid: 'Use 8 to 20 letters, digits, dots, dashes or underscores.', // owner demo notes #126, #127
  nameUnavailable: 'Pick another login name. That one is taken.',
} as const;

/**
 * What a team member's device shows on the trade side until Plan 3 Task 42 (review I1, I2): the
 * account owner's device takes, accepts, secures and releases every trade, so a member never gets
 * the accept sheet or an escrow on their device.
 */
export const MEMBER_TRADE_COPY = {
  acceptedTitle: 'Your offer was taken',
  accepted: (by: string) => `${by} took one of your team's offers. The account owner's device sets up the trade, so ask them to open X2F.`,
  ok: 'OK',
  roomWaiting: "Waiting for the account owner's device. It sets up, secures and releases this trade.",
} as const;

/** Settings → Security → Devices: a team member's session (review e2e area 7). */
export const TEAM_MEMBER_SESSION = (name: string) => `team member ${name}`;

/**
 * Job 1c (J-10; owner S-087, S-092, S-097): the permission box picker's own words. The boxes, their
 * groups, presets and the owner's rules are the catalogue's (`GET /v1/team/permissions`).
 * COPY-UNSIGNED // DESIGN: wording (no board yet: NOT DRAWN)
 */
export const PICKER_COPY = {
  title: 'What this member may do', // COPY-UNSIGNED
  presetsLabel: 'Start from a preset', // COPY-UNSIGNED
  // COPY-UNSIGNED
  summary: (n: number, preset: string | null) => (n === 0 ? 'No boxes ticked yet. Pick a preset or tick boxes below.' : `${n} ${n === 1 ? 'box' : 'boxes'} ticked${preset === null ? ', a custom set' : `, the ${preset} preset`}`),
  groupTicked: (on: number, of: number) => `${on} of ${of}`, // COPY-UNSIGNED
  reason: {
    later: 'Coming later', // COPY-UNSIGNED
    yours: 'Only you', // COPY-UNSIGNED
    always: 'Every member has this', // COPY-UNSIGNED
  } as const,
  loadFailed: 'The permission boxes did not load. Reload the page to try again.', // COPY-UNSIGNED
  pickBox: 'Tick at least one box.', // COPY-UNSIGNED
  // COPY-UNSIGNED: a member's row, by the preset their boxes match.
  presetLine: (label: string) => `${label} preset`,
  boxesSaved: (name: string) => `Boxes saved for ${name}.`, // COPY-UNSIGNED
  editBoxes: 'Boxes', // COPY-UNSIGNED
  changeBoxes: (name: string) => `Change what ${name} may do`, // COPY-UNSIGNED
  saveBoxes: 'Save boxes', // COPY-UNSIGNED
  cancelEdit: 'Keep as it was', // COPY-UNSIGNED
} as const;

/** The Team page's tidied sections (owner: finish Teams). COPY-UNSIGNED // DESIGN: wording */
export const TEAM_PAGE_COPY = {
  empty: (max: number) => `No team members yet — invite up to ${max}`, // COPY-UNSIGNED
  whatIntro: 'Each member gets their own login and the boxes you tick for them. Presets tick a set for you; untick any box.', // COPY-UNSIGNED
} as const;

/**
 * Job 1c (owner S-094, p7-8): the account's private notes on another trader. Only the account's
 * own team sees them: the owner, and members with "View notes on traders". Members with "Add notes
 * on traders" add; only the owner deletes; nobody edits (a note is signed with name and time).
 * COPY-UNSIGNED // DESIGN: wording (no board yet: NOT DRAWN)
 */
export const NOTES_COPY = {
  title: 'Notes', // COPY-UNSIGNED
  summary: (name: string) => `Private notes on ${name}`, // COPY-UNSIGNED
  privacy: 'Only you and your team see these notes. The trader never does.', // COPY-UNSIGNED
  loading: 'Loading notes…', // COPY-UNSIGNED
  none: 'No notes on this trader yet.', // COPY-UNSIGNED
  addLabel: 'Add a note', // COPY-UNSIGNED
  // COPY-UNSIGNED
  addHint: (max: number) => `Signed with your name and the time. Up to ${max} characters.`,
  save: 'Save note', // COPY-UNSIGNED
  saved: 'Note saved.', // COPY-UNSIGNED
  by: (who: string | null, byLead: boolean, iso: string) => `${byLead ? 'Account owner' : (who ?? 'A former member')} · ${when(iso)}`, // COPY-UNSIGNED
  delete: 'Delete', // COPY-UNSIGNED
  deleteLabel: (when_: string) => `Delete the note from ${when_}`, // COPY-UNSIGNED
  deleteAsk: 'Delete this note for good?', // COPY-UNSIGNED
  deleteYes: 'Yes, delete it', // COPY-UNSIGNED
  deleteNo: 'Keep it', // COPY-UNSIGNED
  deleted: 'Note deleted.', // COPY-UNSIGNED
  loadFailed: 'Could not load the notes. Try again.', // COPY-UNSIGNED
  saveFailed: 'Could not save that. Try again.', // COPY-UNSIGNED
  empty: 'Write something first.', // COPY-UNSIGNED
  tooLong: (max: number) => `Keep it to ${max} characters.`, // COPY-UNSIGNED
  retry: 'Try again', // COPY-UNSIGNED
} as const;
