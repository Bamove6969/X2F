/**
 * Security review of wip/lead-notes-all 656d259c, M2 (owner, 16 Nov 2026: a password does not
 * stand alone, so a password alone does not finish sign-up). A trader account whose only login is
 * a password (no authenticator app, passkey, security key or PGP key usable now; `passwordAlone`)
 * gets a setup-only session once the creating session's sign-up window is over, whichever way the
 * session began (that window lapsing, or any later login): it reaches only SETUP_ONLY below, the
 * routes that add a second method (with their confirm, their staged change and the recovery code),
 * read the account, the Terms and the feedback form; everything else is 403
 * `second-method-required`. Logging out needs no session. Checked in `requireSession` as the site
 * ban's gate is (banState.ts): one more column of its query, and the PGP keys only when the
 * account holds nothing else. A team member's session is never setup-only (members log in with two
 * factors). The moment a second method is on the account, its sessions are normal ones.
 */
import { passwordAlone, type MethodType } from '@x2f/accounts';
import type { Deps } from '../app.js';
import { usablePgpIds } from './methods.js';

/** "METHOD /route" a setup-only session may reach. */
export const SETUP_ONLY: ReadonlySet<string> = new Set([
  // Reading itself and its methods, the Terms.
  'GET /v1/account/me',
  'GET /v1/terms',
  'POST /v1/account/terms',
  'GET /v1/account/methods',
  'GET /v1/wallets/rule',
  // A second method: the authenticator app, a passkey or security key, a PGP key, each behind the password's confirm.
  'POST /v1/confirm/password',
  'POST /v1/account/totp/start',
  'POST /v1/account/totp/finish',
  'POST /v1/account/webauthn/start',
  'POST /v1/account/webauthn/finish',
  'POST /v1/account/pgp/start',
  'POST /v1/account/pgp/finish',
  // The recovery code.
  'POST /v1/account/recovery-codes',
  'POST /v1/account/recovery-code/reveal',
  // A password login's changes are staged (hold model v3): seeing, submitting and dropping them.
  'GET /v1/account/hold',
  'POST /v1/account/hold/changes/submit',
  'DELETE /v1/account/hold/changes',
  'DELETE /v1/account/hold/changes/:id',
  // The sign-up's end (still 409 password-alone), this session's own length, and a new device's login approval.
  'POST /v1/account/onboarding/end',
  'PUT /v1/account/session/length',
  'POST /v1/account/session/extend',
  'GET /v1/account/approvals',
  'GET /v1/account/approvals/:id',
  'POST /v1/account/approvals/:id',
  // The owner wants everyone refused to be able to say so (Plan 5 Task 21).
  'POST /v1/feedback/form',
]);

/** Whether a setup-only session may reach this route. */
export function setupOnlyAllows(method: string, url: string): boolean {
  return SETUP_ONLY.has(`${method === 'HEAD' ? 'GET' : method} ${url}`);
}

/**
 * The SQL column `requireSession` reads (aliases `s` sessions, `a` accounts): true for a trader
 * account owner's session whose account has a password and no authenticator app, passkey or
 * security key; its PGP keys are then checked by `passwordOnlyNow`.
 */
export const PASSWORD_ONLY_SQL = `(a.kind = 'trader' and s.member_id is null
   and exists (select 1 from passwords p where p.account_id = s.account_id)
   and not exists (select 1 from totp t where t.account_id = s.account_id)
   and not exists (select 1 from webauthn_credentials w where w.account_id = s.account_id))`;

/** For an account PASSWORD_ONLY_SQL picked out: true unless it holds a PGP key usable now. */
export async function passwordOnlyNow(deps: Pick<Deps, 'db' | 'config'>, accountId: string, now: Date): Promise<boolean> {
  const has: MethodType[] = ['password'];
  if ((await usablePgpIds(deps.db, deps.config, accountId, now)).size > 0) has.push('pgp');
  return passwordAlone(has);
}
