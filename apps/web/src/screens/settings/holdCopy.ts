// Hold model v3 (owner 1-2 Nov, 6-7 Nov 2026; lead hold v3 review item 3): the words of the
// account-changes screens. COPY-UNSIGNED: the HoldChange and RecoveryCode boards' draft copy, fitted
// to what the API does (every change from a username-and-password login is a draft, submitted
// together, applied 24 h after the latest submission; owner G28 keeps which changes wait as built).
// Refusals (too-many-changes) are worded in ui/cantDoCodes.ts.
import type { HoldChangeSummary } from '@x2f/auth-client';
import { formatDateTime as utcDateTime } from '../../ui/dates.js';
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
    case 'wallets': {
      const n = c.wallets ?? c.addressEnds?.length ?? 0;
      const ends = (c.addressEnds ?? []).map((e) => `…${e}`).join(', ');
      return {
        title: 'Payout wallets',
        before: 'Your current wallets',
        after: `${n > 0 ? `${plural(n, 'new wallet', 'new wallets')} added` : 'New wallets added'}${ends !== '' ? `: ${ends}` : ''}`,
      };
    }
    // Owner p5-7: removals wait like every change (HoldChange board rows, COPY-UNSIGNED).
    case 'remove-wallet': {
      const end = c.addressEnds?.[0];
      const name = [c.label, end !== undefined ? `…${end}` : undefined].filter((x) => x !== undefined && x !== '').join(' · ');
      return { title: 'Wallet removed', before: name !== '' ? name : 'A payout wallet', after: 'Removed' };
    }
    case 'team-remove': {
      const who = c.memberId !== undefined ? names.get(c.memberId) : undefined;
      return { title: 'Team member removed', before: who ?? 'A team member', after: 'Removed' };
    }
    case 'team-roles': {
      const who = c.memberId !== undefined ? names.get(c.memberId) : undefined;
      const roles = rolesText((c.roles ?? []) as TeamRole[]);
      return { title: who !== undefined ? `${who}'s roles` : "A team member's roles", before: 'Their current roles', after: roles !== '' ? roles : 'New roles' };
    }
    // Job 1c: a member's boxes, named by the catalogue's labels (COPY-UNSIGNED).
    case 'team-abilities': {
      const who = c.memberId !== undefined ? names.get(c.memberId) : undefined;
      const boxes = (c.abilityLabels ?? []).join(', ');
      return { title: who !== undefined ? `${who}'s abilities` : "A team member's abilities", before: 'Their current abilities', after: boxes !== '' ? boxes : 'New abilities' };
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
  // HoldChange board (p5-7), COPY-UNSIGNED.
  waitBody: 'You logged in with just a username and password. Every change, removals included, applies after 24 h. Anyone logged in can cancel during the wait.',
  telling: 'We tell you straight away on every device you use, with a list of these changes.',
  // Owner G58 (7 Nov): a strong login no longer throws them away; it sees them and approves, cancels or changes them.
  throwAway: 'If you log in with a passkey, a security key or a PGP key before then, you can approve them at once, cancel them or change them.',
  // The encouragement to add a stronger login (owner G29).
  stronger: 'Add a passkey, a security key or a PGP key, and next time changes like these go through at once.',
  strongerLink: 'Add one',
  submit: (n: number) => (n === 1 ? 'Submit 1 change' : `Submit ${n} changes`),
  submitted: (iso: string) => `Submitted. Your changes take effect on ${utcDateTime(new Date(iso))}.`,
  changed: 'Your list of changes was updated somewhere else. Check it again, then submit.',
  submitFailed: 'Could not submit your changes. Try again.',
  // The waiting (submitted) changes (owner g65): one view of every change and its effect, a
  // countdown, each ticked; untick to cancel one, or cancel them all. A cancelled change never applies.
  waitingTitle: 'Waiting changes',
  // COPY-UNSIGNED (lead review 8 Nov I4): each waiting change keeps its own date, so the banner names the next one.
  banner: (n: number, iso: string) =>
    n === 1 ? `1 change takes effect on ${utcDateTime(new Date(iso))}` : `${n} changes waiting. The next takes effect on ${utcDateTime(new Date(iso))}`,
  countdownLead: 'Time left',
  applies: (iso: string) => `Applies ${utcDateTime(new Date(iso))}`,
  // Owner p5-7: a removal waits its 24 hours like the rest, nothing early.
  removes: (iso: string) => `Removed ${utcDateTime(new Date(iso))}`,
  from: (device: string) => `From ${device}`,
  fromHere: 'From this device',
  keepLabel: (title: string) => `Keep the change: ${title}`,
  untickHelp: 'Untick a change to cancel it. A cancelled change never applies.',
  cancelUnticked: (n: number) => (n === 1 ? 'Cancel 1 unticked change' : `Cancel ${n} unticked changes`),
  cancelAll: 'Cancel all changes',
  cancelAsk: (n: number) => (n === 1 ? 'Cancel this change?' : `Cancel all ${n} changes?`),
  cancelAskBody: 'A cancelled change never applies, so nothing on your account changes. We tell you on every device.',
  cancelYes: 'Cancel changes',
  cancelKeep: 'Keep them',
  cancelled: 'Cancelled. Nothing on your account changed.',
  cancelFailed: 'Could not cancel that. Try again.',
  // Owner G58: a strong login during the wait sees the same view and may approve them now.
  strongNote: 'You logged in with a passkey, a security key or a PGP key, so you can approve these changes now and they apply at once. Any change you untick is cancelled.',
  approve: (n: number) => (n === 1 ? 'Approve now' : `Approve ${n} changes now`),
  approved: 'Approved. Your changes have been applied.',
  approveFailed: 'Could not approve these changes. Try again.',
  makeChanges: 'Make changes',
  continue: 'Continue',
  loadFailed: 'Could not load your account changes.',
  none: 'No changes are waiting.',
  review: 'Review changes',
} as const;

/**
 * Owner p4-8: a team member's view while the lead's changes wait (HoldMember board, its `rights`
 * tweak: none, see, cancel, end). COPY-UNSIGNED: every sentence is the board's draft copy.
 */
export const MEMBER_HOLD_COPY = {
  title: 'A hold is on',
  hero: (lead: string) => `${lead}'s team is on a 24-hour hold. Some changes are waiting; they apply when it ends.`,
  why: (lead: string) => `${lead} logs in with just a username and password, so team changes wait 24 h, even when a member with a stronger login makes them.`,
  endsIn: 'Ends in',
  trading: 'You can keep trading as usual.',
  none: (lead: string) => `What you can see: that a hold is on. Ask ${lead} if you need to know more.`,
  see: 'You can see these changes but not change them.',
  cancel: "You can untick a change so it won't apply, or cancel all of them.",
  submittedBy: (lead: string) => `Submitted by ${lead} · username and password`,
  endNote: 'Needs your passkey, security key or PGP key. Ending the hold applies every ticked change now.',
  end: 'End the hold',
  ended: 'Hold ended. Every ticked change applied just now. The team is back to normal.',
  cancelled: (n: number) => `Changes cancelled. None of the ${n === 1 ? '1 change' : `${n} changes`} will apply. Nothing is waiting any more.`,
  banner: 'A hold is on.',
  bannerLink: 'See the hold',
} as const;

/**
 * A used recovery code is burned (owner S-111, p11-36, 9 Nov 2026: "tell them that this recovery
 * code is now burned and in the security settings, they should go and generate a new recovery
 * code"), and the password change that takes the code (owner S-110, p11-35). COPY-UNSIGNED: design
 * words the notice; DESIGN: the password form's code field is not drawn yet.
 */
export const BURNED_CODE_COPY = {
  title: 'Your recovery code is now burned',
  body: 'The recovery code you just used will never work again. Go to Security settings for a new recovery code.',
  link: 'Go to Security',
  done: 'Done',
  passwordCodeLabel: 'Recovery code (optional)',
  passwordCodeHint: 'Add your recovery code and the new password takes effect at once, with no 24-hour wait. The code is then used up.',
  passwordCodeWrong: "That recovery code doesn't match.",
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
