// Plan 2 Task 18: the team screens' words (spec 6.7; owner 2026-10-29c). // COPY-UNSIGNED: no
// Claude Design board yet (NEEDS_DESIGN_TEAM in test/team-tripwires.test.ts); the owner signs it
// off with the board. Refusals (owner-only, a role a member lacks, the member limit, escrow
// signing) are CantDoThat's, worded in ui/cantDoCodes.ts (teamCantDoText).
import type { TeamRole } from '@x2f/auth-client';
import { utcDateTime } from '../../ui/dates.js';

export const TEAM_PATH = '/settings/team';
export const JOIN_PATH = '/team/join';

export const ROLE_WORDS: Record<TeamRole, string> = { offers: 'Offers', trades: 'Trades' };

/** "Offers", "Trades" or "Offers and Trades". */
export function rolesText(roles: readonly TeamRole[]): string {
  return (['offers', 'trades'] as const).filter((r) => roles.includes(r)).map((r) => ROLE_WORDS[r]).join(' and ');
}

const when = (iso: string): string => utcDateTime(new Date(iso));

/** What each audit action reads as (an unknown one is shown by its code). */
const AUDIT_WORDS: Record<string, string> = {
  'offer-posted': 'posted an offer',
  'offer-paused': 'turned an offer off',
  'offer-relisted': 'turned an offer on',
  'offer-removed': 'removed an offer',
  'trade-taken': 'started a trade',
  'trade-wallet-set': "set a trade's payout wallet",
  'final-alert-seen': 'saw the final alert',
  'dispute-opened': 'opened a dispute',
  'appeal-filed': 'filed an appeal',
  'mark-paid': 'marked the payment sent',
  extend: 'gave more time to pay',
  'request-refund': 'asked for a refund',
  'buyer-cancel': 'cancelled as the buyer',
  'propose-cancel': 'proposed cancelling',
  'accept-cancel': 'agreed to cancel',
  'withdraw-cancel': 'withdrew a cancel',
  'walk-away': 'walked away from the trade',
  'confirm-cancel': 'confirmed the cancel',
};

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
  twoFactors: 'Each member logs in with their own two factors: a PGP key plus a security key, a passkey or a second PGP key.',
  // Plan 3 Task 42 (R44): members cannot release yet.
  releaseNote: 'Releasing or securing coins still happens on your own device.',
  membersTitle: 'Members',
  none: 'No team members yet.',
  count: (n: number, max: number) => `${n} of ${max} members`,
  status: { invited: 'Invited', joining: 'Setting up their login', active: 'Active' } as const,
  inviteUntil: (iso: string) => `Invite works until ${when(iso)}`,
  roles: (roles: readonly TeamRole[]) => rolesText(roles),
  changeRoles: (name: string) => `Change roles for ${name}`,
  saveRoles: 'Save roles',
  remove: 'Remove',
  removeLabel: (name: string) => `Remove ${name}`,
  removed: (name: string) => `${name} was removed. Their sessions have ended.`,
  rolesSaved: (name: string) => `Roles saved for ${name}.`,
  pickRole: 'Pick at least one role.',
  inviteTitle: 'Invite a member',
  nameLabel: 'Their name in trade chats',
  nameHint: 'Chat shows it as "Team <your name> member: <their name>".',
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
  nameInvalid: 'Use 5 to 20 letters, digits, dots, dashes or underscores.',
  nameTaken: 'Someone on your team already has that name.',
  signedOut: 'Log in to manage your team.',
} as const;

export const JOIN_COPY = {
  title: 'Join a team',
  loading: 'Checking your invite…',
  gone: 'This invite link has been used, has run out or is not complete. Ask for a new one.',
  // Never the team's name before joining (review 2026-11-08 F3). COPY-UNSIGNED.
  invited: (name: string, roles: readonly TeamRole[]) => `You are invited to a team as ${name}, for ${rolesText(roles)}.`,
  // The member's Terms step before joining (review 2026-11-08 F1). COPY-UNSIGNED.
  termsIntro: 'Before you join, read the Terms of Service to the end and accept them. The key points first:',
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
  nameInvalid: 'Use 5 to 20 letters, digits, dots, dashes or underscores.',
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
