/**
 * Owner, 26 Nov 2026 (no passwords): a trader account holds at least two kinds of login method
 * (`enoughMethods`, @x2f/accounts). An account owner's session whose account holds fewer is
 * setup-only once the creating session's sign-up window is over, whichever way the session began:
 * it reaches only SETUP_ONLY below (the routes that add a method, with their confirm, the recovery
 * code, reading the account, the Terms and the feedback form); everything else is 403
 * `two-methods-required`. Logging out needs no session. Checked in `requireSession` as the site
 * ban's gate is (banState.ts): one more column of its query, and the PGP keys only when the
 * account could fall short. A team member's session is never setup-only (members log in with two
 * factors). The moment the account holds two kinds, its sessions are normal ones.
 */
import { enoughMethods, type MethodType } from '@x2f/accounts';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { usablePgpIds } from './methods.js';

/** "METHOD /route" a setup-only session may reach. */
export const SETUP_ONLY: ReadonlySet<string> = new Set([
  // Reading itself and its methods, the Terms.
  'GET /v1/account/me',
  'GET /v1/terms',
  'POST /v1/account/terms',
  'GET /v1/account/methods',
  'GET /v1/wallets/rule',
  // A second method: the authenticator app, a passkey or security key, a PGP key, each behind a confirm.
  'POST /v1/confirm/pgp/start',
  'POST /v1/confirm/pgp/finish',
  'POST /v1/confirm/webauthn/start',
  'POST /v1/confirm/webauthn/finish',
  'POST /v1/account/totp/start',
  'POST /v1/account/totp/finish',
  'POST /v1/account/webauthn/start',
  'POST /v1/account/webauthn/finish',
  'POST /v1/account/pgp/start',
  'POST /v1/account/pgp/finish',
  // The recovery code.
  'POST /v1/account/recovery-codes',
  'POST /v1/account/recovery-code/reveal',
  // The sign-up's end (still 409 two-methods-required), this session's own length, and a new device's login approval.
  'POST /v1/account/onboarding/end',
  'PUT /v1/account/session/length',
  // Re-review N2: seeing its sessions and ending another one.
  'GET /v1/account/sessions',
  'DELETE /v1/account/sessions/:id',
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
 * account owner's session whose account might hold fewer than two kinds: fewer than two of the
 * authenticator app, passkeys and security keys (a stored PGP key may have expired, so it is left
 * to `shortOfMethodsNow`, which then counts exactly).
 */
export const FEW_METHODS_SQL = `(a.kind = 'trader' and s.member_id is null
   and ((exists (select 1 from totp t where t.account_id = s.account_id))::int
      + (exists (select 1 from webauthn_credentials w where w.account_id = s.account_id and w.kind = 'passkey'))::int
      + (exists (select 1 from webauthn_credentials w where w.account_id = s.account_id and w.kind = 'security-key'))::int) < 2)`;

/** The kinds of login method the account holds now (a PGP key only when usable now; recovery codes never). */
export async function methodKinds(db: Queryable, config: Deps['config'], accountId: string, now: Date): Promise<MethodType[]> {
  const out: MethodType[] = [];
  if ((await usablePgpIds(db, config, accountId, now)).size > 0) out.push('pgp');
  const { rows } = await db.query<{ kind: 'passkey' | 'security-key' }>('select distinct kind from webauthn_credentials where account_id = $1', [accountId]);
  for (const r of rows) out.push(r.kind);
  if ((await db.query('select 1 from totp where account_id = $1', [accountId])).rows.length > 0) out.push('totp');
  return out;
}

/** For an account FEW_METHODS_SQL picked out: true when it holds fewer than two kinds now. */
export async function shortOfMethodsNow(deps: Pick<Deps, 'db' | 'config'>, accountId: string, now: Date): Promise<boolean> {
  return !enoughMethods(await methodKinds(deps.db, deps.config, accountId, now));
}
