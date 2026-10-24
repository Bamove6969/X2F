import { createHash, randomBytes } from 'node:crypto';
import type { AccountKind } from '@x2f/accounts';
import type { Deps } from '../../src/app.js';

/**
 * Inserts an account directly (tests only). A trader gets the current Terms version unless
 * `termsVersion` says otherwise; staff and owner accounts carry none.
 */
export async function seedAccount(
  deps: Pick<Deps, 'db' | 'clock' | 'config'>,
  a: { username: string; kind?: AccountKind; disabled?: boolean; termsVersion?: string | null },
): Promise<string> {
  const kind = a.kind ?? 'trader';
  const terms = a.termsVersion !== undefined ? a.termsVersion : kind === 'trader' ? deps.config.termsVersion : null;
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into accounts (username, username_key, kind, webauthn_user_id, terms_version, terms_accepted_at, created_at, disabled_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [a.username, a.username.toLowerCase(), kind, randomBytes(32), terms, terms === null ? null : now, now, a.disabled ? now : null],
  );
  return rows[0]!.id;
}

/** The login method recorded on a confirm token when it was issued (tests only). */
export async function confirmTokenMethod(deps: Pick<Deps, 'db'>, token: string): Promise<string | undefined> {
  const { rows } = await deps.db.query<{ method: string }>('select method from confirm_tokens where token_hash = $1', [
    createHash('sha256').update(token).digest(),
  ]);
  return rows[0]?.method;
}
