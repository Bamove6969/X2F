import { randomBytes } from 'node:crypto';
import { checkUsername, type AccountKind } from '@x2f/accounts';
import type { Deps } from './app.js';
import type { Queryable } from './db/pool.js';
import { ApiError } from './errors.js';

/** A username as typed and its case-insensitive key; 400 `username-invalid` / `username-reserved`. */
export function assertUsername(input: unknown): { username: string; key: string } {
  const r = checkUsername(typeof input === 'string' ? input : '');
  if (r.ok) return { username: r.username, key: r.key };
  throw new ApiError(400, r.reason === 'reserved' ? 'username-reserved' : 'username-invalid');
}

/**
 * R10: the version the person accepted when it equals `config.termsVersion`; anything else (missing,
 * older, not a string) → 400 `terms-not-accepted` `{ version }`. Every register finish calls it
 * before any hashing or account creation.
 */
export function assertTermsAccepted(deps: Pick<Deps, 'config'>, acceptedTerms: unknown): string {
  const version = deps.config.termsVersion;
  if (acceptedTerms !== version) throw new ApiError(400, 'terms-not-accepted', { version });
  return version;
}

/**
 * Inserts an account (inside the caller's transaction). A taken `username_key` → 409
 * `username-taken`. `webauthn_user_id` is 32 random bytes. Terms version and acceptance time are
 * both null when `termsVersion` is null (staff and owner, Plan 4).
 */
export async function createAccount(
  db: Queryable,
  a: { username: string; key: string; kind: AccountKind; termsVersion: string | null; now: Date },
): Promise<string> {
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into accounts (username, username_key, kind, webauthn_user_id, terms_version, terms_accepted_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [a.username, a.key, a.kind, randomBytes(32), a.termsVersion, a.termsVersion === null ? null : a.now, a.now],
    );
    return rows[0]!.id;
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint === 'accounts_username_key_key') throw new ApiError(409, 'username-taken');
    throw e;
  }
}
