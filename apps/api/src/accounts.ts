import { createHmac, randomBytes } from 'node:crypto';
import { checkLoginName, checkNames, lookAlikeKey, type AccountKind } from '@x2f/accounts';
import type { Deps } from './app.js';
import { subkey, type Config } from './config.js';
import type { Queryable } from './db/pool.js';
import { ApiError } from './errors.js';

/** The two names of a new account, as typed and as case-insensitive keys. */
export interface NewNames {
  displayName: string;
  displayKey: string;
  loginName: string;
  loginKey: string;
}

/**
 * Checks the two names of a new account (spec 6.1, owner 2026-10-23): their shapes, reserved
 * display names (with look-alikes), that they differ, and that the display name is not a look-alike
 * of a staff or owner display name (F4: 0/o, 1/l/i, rn/m). 400 `display-name-invalid`,
 * `display-name-reserved`, `login-name-invalid` or `names-same`. Taken names are checked by
 * `assertNamesFree` (and, for races, by the unique indexes in `createAccount`).
 */
export async function assertNewNames(db: Queryable, displayName: unknown, loginName: unknown): Promise<NewNames> {
  const r = checkNames(typeof displayName === 'string' ? displayName : '', typeof loginName === 'string' ? loginName : '');
  if (!r.ok) {
    if (r.field === 'displayName') throw new ApiError(400, r.reason === 'reserved' ? 'display-name-reserved' : 'display-name-invalid');
    throw new ApiError(400, r.reason === 'same' ? 'names-same' : 'login-name-invalid');
  }
  const folded = lookAlikeKey(r.display.key);
  const { rows } = await db.query<{ display_key: string }>("select display_key from accounts where kind <> 'trader'");
  if (rows.some((s) => lookAlikeKey(s.display_key) === folded)) throw new ApiError(400, 'display-name-reserved');
  return { displayName: r.display.name, displayKey: r.display.key, loginName: r.login.name, loginKey: r.login.key };
}

/**
 * 409 `display-name-taken` or `login-name-taken`, before any expensive work. The two are separate
 * namespaces: a display name may equal someone else's login name, so registering a display name
 * never tells whether a login name exists.
 */
export async function assertNamesFree(db: Queryable, n: NewNames): Promise<void> {
  const { rows } = await db.query<{ display: boolean; login: boolean }>(
    `select exists (select 1 from accounts where display_key = $1) as display,
            exists (select 1 from accounts where login_key = $2) as login`,
    [n.displayKey, n.loginKey],
  );
  if (rows[0]!.display) throw new ApiError(409, 'display-name-taken');
  if (rows[0]!.login) throw new ApiError(409, 'login-name-taken');
}

/**
 * The login key a typed login name looks up (null when it cannot be one: it then matches no
 * account), and the tag it is throttled and decoyed under when it has no account: an HMAC under
 * `subkey('name')`, so a typed login name (often a near miss of a real, private one) is never
 * stored. Malformed input is tagged by its first 64 code units, lower-cased.
 */
export function loginNameLookup(config: Config, input: string): { key: string | null; tag: string } {
  const r = checkLoginName(input);
  const basis = r.ok ? r.key : `~${input.slice(0, 64).toLowerCase()}`;
  const tag = createHmac('sha256', subkey(config, 'name')).update(`login-name/${basis}`).digest('hex');
  return { key: r.ok ? r.key : null, tag };
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
 * Inserts an account (inside the caller's transaction). A taken display or login key → 409
 * `display-name-taken` / `login-name-taken`. `webauthn_user_id` is 32 random bytes. Terms version
 * and acceptance time are both null when `termsVersion` is null (staff and owner, Plan 4).
 */
export async function createAccount(
  db: Queryable,
  a: NewNames & { kind: AccountKind; termsVersion: string | null; now: Date },
): Promise<string> {
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into accounts (display_name, display_key, login_name, login_key, kind, webauthn_user_id, terms_version, terms_accepted_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        a.displayName, a.displayKey, a.loginName, a.loginKey, a.kind, randomBytes(32),
        a.termsVersion, a.termsVersion === null ? null : a.now, a.now,
      ],
    );
    return rows[0]!.id;
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint === 'accounts_display_key_key') throw new ApiError(409, 'display-name-taken');
    if (err.code === '23505' && err.constraint === 'accounts_login_key_key') throw new ApiError(409, 'login-name-taken');
    throw e;
  }
}
