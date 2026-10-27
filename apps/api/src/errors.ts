import type { KeyRefusal } from '@x2f/accounts';

/** Every error code the API answers with, for all plans. Plan 3 appends its codes here. */
export type ApiErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'unsupported-media-type'
  | 'internal'
  | 'busy'
  | 'display-name-invalid'
  | 'display-name-reserved'
  | 'display-name-taken'
  | 'login-name-invalid'
  | 'names-unavailable'
  | 'names-same'
  | 'password-weak'
  | 'password-leaked'
  | KeyRefusal
  | 'key-in-use'
  | 'challenge-expired'
  | 'code-invalid'
  | 'credentials-invalid'
  | 'slow-down'
  | 'locked'
  | 'not-authenticated'
  | 'account-disabled'
  | 'wrong-account-kind'
  | 'confirm-required'
  | 'confirm-invalid'
  | 'recovery-session'
  | 'recovery-hold'
  | 'method-not-allowed'
  | 'last-login-method'
  | 'webauthn-failed'
  | 'security-key-limit'
  | 'origin-refused'
  | 'address-invalid'
  | 'address-integrated'
  | 'wallet-exists'
  | 'terms-not-accepted'
  | 'terms-required'
  // Plan 3 (Task 3 onwards).
  | 'price-unavailable'
  // Plan 3, Task 6: the trade events route and the state machine's refusals.
  | 'event-not-allowed'
  | 'wrong-state'
  | 'wrong-party'
  | 'too-early'
  | 'too-late'
  | 'no-extensions-left'
  | 'not-releasable'
  | 'total-changed'
  // Plan 3, Task 26: the nudge sender's own limits.
  | 'too-soon'
  | 'no-shared-context';

/** An error the client may see: the handler replies `{ error: code, ...extra }` with `status`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly extra: Record<string, unknown> | undefined;

  constructor(status: number, code: ApiErrorCode, extra?: Record<string, unknown>) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
