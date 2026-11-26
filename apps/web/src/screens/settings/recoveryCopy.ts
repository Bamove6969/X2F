// The recovery-code words outside sign-up: the notice after a recovery-code login, and the new code
// shown once after it (RecoveryCode board; owner G32, S-111). Owner, 26 Nov 2026: no passwords and
// no 24-hour holds; a recovery-code login may change every login method for an hour. COPY-UNSIGNED.

/**
 * A used recovery code is burned (owner S-111, p11-36, 9 Nov 2026: "tell them that this recovery
 * code is now burned and in the security settings, they should go and generate a new recovery
 * code").
 */
export const BURNED_CODE_COPY = {
  title: 'Your recovery code is now burned',
  body: 'The recovery code you just used will never work again. Go to Security settings for a new recovery code.',
  link: 'Go to Security',
  done: 'Done',
} as const;

/** The new recovery code (RecoveryCode board, reminder and show steps; owner G32). */
export const NEW_CODE_COPY = {
  title: 'Write down your new recovery code',
  why: 'You used your recovery code, so X2F made you a new one. It is shown only once, here.',
  emergency:
    'A recovery code is your emergency way back in. Anyone who has it can log in as you, log you out everywhere and replace every login method on your account, so keep it secret.',
  ready: 'Have paper ready before you show it.',
  show: 'Show my new code',
  codeLabel: 'Recovery code',
  save: 'Write it down now and keep it apart from your phone, your security keys and your PGP key. You will not see it again.',
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
