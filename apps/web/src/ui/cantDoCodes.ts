/**
 * The API's refusal codes for something X2F does not let this user do (a rule, not a fault): each
 * one is shown with `CantDoThat` (Plan 5 Task 21). Network failures, typos and expired steps are
 * not here. A plain module (no React, no CSS) so `tools/copy-lint.ts` can read the list.
 *
 * `offer-cap`, `review-pending`, `lien` and `trade-ban` are the expected codes of refusals whose
 * API tasks are not on the main line yet (Plan 3 offer caps, Plan 5 Task 3, Plan 4 liens and bans);
 * check them when those land.
 */
export const CANT_DO_CODES = [
  'starter-limit',
  'not-enough-trades',
  'trading-hold',
  'trading-paused',
  'own-offer',
  'recovery-session',
  'recovery-hold',
  'security-key-limit',
  'login-name-set',
  'only-login',
  'offer-cap',
  'review-pending',
  'lien',
  'trade-ban',
] as const;
export type CantDoCode = (typeof CANT_DO_CODES)[number];

export function isCantDoCode(code: unknown): code is CantDoCode {
  return typeof code === 'string' && (CANT_DO_CODES as readonly string[]).includes(code);
}

/** The form's address for a refusal code (an unusable code is left off). */
export function feedbackHref(from: string | null | undefined): string {
  return typeof from === 'string' && /^[a-z0-9-]{1,40}$/.test(from) ? `/feedback?from=${from}` : '/feedback';
}
