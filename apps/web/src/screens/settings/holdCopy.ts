// Hold model v3 (owner 1-2 Nov, 6-7 Nov 2026; lead hold v3 review item 3): the words of the
// account-changes screens. COPY-UNSIGNED: the HoldChange and RecoveryCode boards' draft copy, fitted
// to what the API does (every change from a username-and-password login is a draft, submitted
// together, applied 24 h after the latest submission; owner G28 keeps which changes wait as built).
// Refusals (too-many-changes) are worded in ui/cantDoCodes.ts.
import type { HoldChangeSummary } from '@x2f/auth-client';
import { utcDateTime } from '../../ui/dates.js';
import { rolesText } from './teamCopy.js';
import type { TeamRole } from '@x2f/auth-client';

export const CHANGES_PATH = '/settings/changes';

/** A change as the review list shows it: what it is, before and after. Never a secret or a full address. */
export interface ChangeWords {
  title: string;
  before: string;
  after: string;
}

const METHOD_WORDS: Record<string, string> = {
  pgp: 'PGP key',
  passkey: 'Passkey',
  'security-key': 'Security key',
  password: 'Password',
  totp: 'Authenticator app',
  'recovery-codes': 'Recovery code',
};

const methodName = (m: string | undefined): string => (m !== undefined && Object.hasOwn(METHOD_WORDS, m) ? METHOD_WORDS[m]! : 'Login method');

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The before and after of one change (owner G29: "what it looks like before the change and what the
 * consequence is going to be"). `names` maps a team member's id to their name, when known.
 */
export function changeWords(c: HoldChangeSummary, names: ReadonlyMap<string, string> = new Map()): ChangeWords {
  switch (c.kind) {
    case 'password':
      return { title: 'Password', before: 'Your current password', after: 'A new password' };
    case 'totp':
      return { title: 'Authenticator app', before: 'Your current setting', after: 'A new authenticator app' };
    case 'pgp':
      return { title: 'PGP key', before: 'Not on your account', after: 'A new PGP key' };
    case 'webauthn':
      return { title: methodName(c.method), before: 'Not on your account', after: `A new ${methodName(c.method).toLowerCase()}` };
    case 'recovery-codes':
      return { title: 'Recovery code', before: 'Your current recovery code', after: 'A new recovery code' };
    case 'remove-method':
      return { title: methodName(c.method), before: 'On your account', after: 'Removed' };
    case 'login-name':
      return { title: 'Login name', before: 'Your current login name', after: 'A new login name' };
    case 'one-device':
      return { title: 'One device at a time', before: c.on === true ? 'Off' : 'On', after: c.on === true ? 'On' : 'Off' };
    case 'logout-timer':
      return {
        title: 'Stay logged in',
        before: 'Your current setting',
        after: c.idleHours !== undefined ? `Logged out after ${c.idleHours} hours with no activity` : 'A new setting',
      };
    case 'wallets': {
      const n = c.wallets ?? c.addressEnds?.length ?? 0;
      const ends = (c.addressEnds ?? []).map((e) => `…${e}`).join(', ');
      return {
        title: 'Payout wallets',
        before: 'Your current wallets',
        after: `${n > 0 ? `${plural(n, 'new wallet', 'new wallets')} added` : 'New wallets added'}${ends !== '' ? `: ${ends}` : ''}`,
      };
    }
    case 'team-roles': {
      const who = c.memberId !== undefined ? names.get(c.memberId) : undefined;
      const roles = rolesText((c.roles ?? []) as TeamRole[]);
      return { title: who !== undefined ? `${who}'s roles` : "A team member's roles", before: 'Their current roles', after: roles !== '' ? roles : 'New roles' };
    }
    default:
      return { title: 'Account setting', before: 'Your current setting', after: 'A new setting' };
  }
}

export const HOLD_COPY = {
  screenTitle: 'Account changes',
  // A change answered 202 staged, on the screen where it was made.
  staged: 'Saved as a draft. Nothing changes until you submit it.',
  stagedLink: 'Review and submit',
  // The drafts: the one review of everything before the final submit (owner G29).
  draftsTitle: 'Review your changes',
  draftsCount: (n: number, max: number) => `${plural(n, 'change', 'changes')} · up to ${max}`,
  nothingYet: 'Nothing changes until you submit.',
  before: 'Before',
  after: 'After',
  remove: 'Remove',
  removeLabel: (title: string) => `Remove the draft: ${title}`,
  // Told before submitting (owner G29: a username-and-password person is advised of the 24-hour hold).
  waitTitle: 'Applies after a 24-hour wait',
  waitBody:
    'You logged in with just your username and password, so these changes apply 24 hours after you submit them. Your account keeps working as normal in the meantime, and anyone logged in to your account can cancel them.',
  telling: 'We tell you straight away on every device you use, with a list of these changes.',
  throwAway: 'If you then log in with a passkey, a security key or a PGP key you had before submitting, these changes are thrown away.',
  // The encouragement to add a stronger login (owner G29).
  stronger: 'Add a passkey, a security key or a PGP key, and next time changes like these go through at once.',
  strongerLink: 'Add one',
  submit: (n: number) => (n === 1 ? 'Submit 1 change' : `Submit ${n} changes`),
  submitted: (iso: string) => `Submitted. Your changes take effect on ${utcDateTime(new Date(iso))}.`,
  changed: 'Your list of changes was updated somewhere else. Check it again, then submit.',
  submitFailed: 'Could not submit your changes. Try again.',
  // The waiting (submitted) changes, with their date and Cancel (lead review item 3).
  waitingTitle: 'Waiting changes',
  banner: (n: number, iso: string) => `${n === 1 ? '1 change takes' : `${n} changes take`} effect on ${utcDateTime(new Date(iso))}`,
  applies: (iso: string) => `Applies ${utcDateTime(new Date(iso))}`,
  from: (device: string) => `From ${device}`,
  fromHere: 'From this device',
  cancel: 'Cancel',
  cancelLabel: (title: string) => `Cancel the change: ${title}`,
  cancelAll: 'Cancel these changes',
  cancelAsk: (n: number) => (n === 1 ? 'Cancel this change?' : `Cancel these ${n} changes?`),
  cancelAskBody: 'Nothing on your account changes, and we tell you on every device.',
  cancelYes: 'Cancel changes',
  cancelKeep: 'Keep them',
  cancelled: 'Cancelled. Nothing on your account changed.',
  cancelFailed: 'Could not cancel that. Try again.',
  loadFailed: 'Could not load your account changes.',
  none: 'No changes are waiting.',
  review: 'Review changes',
} as const;

/** The new recovery code (RecoveryCode board, reminder and show steps; owner G32). COPY-UNSIGNED */
export const NEW_CODE_COPY = {
  title: 'Write down your new recovery code',
  why: 'You used your recovery code, so X2F made you a new one. It is shown only once, here.',
  emergency:
    "A recovery code is only an emergency way back in. It doesn't change your username or password, and it doesn't skip the 24-hour wait on changes made with just a username and password.",
  ready: 'Have paper ready before you show it.',
  show: 'Show my new code',
  codeLabel: 'Recovery code',
  save: 'Write it down now and keep it apart from your password, your phone and your PGP key. You will not see it again.',
  written: "I've written it down",
  done: 'Done',
  gone: 'There is no new code to show here. It was probably shown on another device first.',
  failed: 'Could not show your code. Try again.',
  bannerText: 'You have a new recovery code to write down.',
  bannerLink: 'Go to Security',
} as const;

/** Splits a code into groups of 4 for reading (the RecoveryCode board: "K7QM 4XD2 VT9B HP3A"). */
export function codeGroups(code: string): string[] {
  const clean = code.replace(/[\s-]/g, '');
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += 4) out.push(clean.slice(i, i + 4));
  return out;
}
