import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { checkLoginName, checkNames, lookAlikeKey, type AccountKind } from '@x2f/accounts';
import type { Deps } from './app.js';
import { subkey, type Config } from './config.js';
import type { Queryable } from './db/pool.js';
import { ApiError } from './errors.js';
import { bannedTagSql, displayNameBanned } from './bans.js';

/**
 * The two names of a new account: the display name as typed and as its case-insensitive key, and
 * the login name's key (the lower-cased name: only the key is ever used, and from FU-D on it is
 * stored only as its tag). Held in memory only; a sign-up waiting in a challenge keeps `sealNames`.
 */
export interface NewNames {
  displayName: string;
  displayKey: string;
  loginKey: string;
}

/**
 * Checks the two names of a new account (spec 6.1, owner 2026-10-23): their shapes, reserved
 * display names (with look-alikes), that they differ, and that the display name is not a look-alike
 * of a staff or owner display name (F4: 0/o, 1/l/i, rn/m). 400 `display-name-invalid`,
 * `display-name-reserved`, `login-name-invalid` or `names-same`. A taken display name is checked by
 * `assertDisplayNameFree`; a taken login name only by `createAccount`.
 */
export async function assertNewNames(db: Queryable, displayName: unknown, loginName: unknown): Promise<NewNames> {
  const r = checkNames(typeof displayName === 'string' ? displayName : '', typeof loginName === 'string' ? loginName : '');
  if (!r.ok) {
    if (r.field === 'displayName') throw new ApiError(400, r.reason === 'reserved' ? 'display-name-reserved' : 'display-name-invalid');
    throw new ApiError(400, r.reason === 'same' ? 'names-same' : 'login-name-invalid');
  }
  const folded = lookAlikeKey(r.display.key);
  const { rows } = await db.query<{ display_key: string }>("select display_key from accounts where kind in ('staff', 'owner')");
  if (rows.some((s) => lookAlikeKey(s.display_key) === folded)) throw new ApiError(400, 'display-name-reserved');
  return { displayName: r.display.name, displayKey: r.display.key, loginKey: r.login.key };
}

/**
 * `NewNames` as a sign-up challenge's payload keeps them (FU-D, FU-A review note 1): the display
 * name in clear (it is public), the login name sealed with AES-256-GCM under `subkey('login-seal')`,
 * so a stolen database holds no login name, not even one waiting in a sign-up.
 */
export interface SealedNames {
  displayName: string;
  displayKey: string;
  /** base64url of nonce (12) || ciphertext || GCM tag (16). */
  login: string;
}

const SEAL_AAD = Buffer.from('x2f/login-name-seal', 'utf8');

export function sealNames(config: Config, n: NewNames): SealedNames {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', subkey(config, 'login-seal'), nonce, { authTagLength: 16 });
  c.setAAD(SEAL_AAD);
  const body = Buffer.concat([c.update(n.loginKey, 'utf8'), c.final()]);
  return { displayName: n.displayName, displayKey: n.displayKey, login: Buffer.concat([nonce, body, c.getAuthTag()]).toString('base64url') };
}

/**
 * Opens `sealNames`. Anything that does not open (a server key changed between a sign-up's start
 * and finish, or a payload from before FU-D) → 400 `challenge-expired`: the person starts again.
 */
export function openNames(config: Config, sealed: unknown): NewNames {
  const s = sealed as Partial<SealedNames> | null;
  if (s === null || typeof s !== 'object' || typeof s.displayName !== 'string' || typeof s.displayKey !== 'string' || typeof s.login !== 'string') {
    throw new ApiError(400, 'challenge-expired');
  }
  const raw = Buffer.from(s.login, 'base64url');
  try {
    if (raw.length < 12 + 16) throw new Error('short');
    const d = createDecipheriv('aes-256-gcm', subkey(config, 'login-seal'), raw.subarray(0, 12), { authTagLength: 16 });
    d.setAAD(SEAL_AAD);
    d.setAuthTag(raw.subarray(raw.length - 16));
    const loginKey = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8');
    return { displayName: s.displayName, displayKey: s.displayKey, loginKey };
  } catch {
    throw new ApiError(400, 'challenge-expired');
  }
}

/**
 * Before any expensive work: 409 `display-name-taken` for a taken display name, and 409
 * `names-unavailable` for a login name that is some account's public display name (review I1: the
 * two names share one namespace, or a private login name would be printed on the site). Display
 * names are public, so neither answer tells anybody anything new. Login names are never read here:
 * a taken login name, or a display name that is someone's private login name, is only found by
 * `createAccount`, at the very end of a sign-up (after the password is hashed, or after the PGP
 * code or the authenticator has proved the key), and is answered with the generic
 * `names-unavailable`, so there is no cheap way to test whether a private login name exists.
 */
export async function assertDisplayNameFree(db: Queryable, n: NewNames, config?: Config): Promise<void> {
  const { rows } = await db.query<{ display_key: string }>('select display_key from accounts where display_key in ($1, $2)', [
    n.displayKey, n.loginKey,
  ]);
  if (rows.some((r) => r.display_key === n.displayKey)) throw new ApiError(409, 'display-name-taken');
  if (rows.length > 0) throw new ApiError(409, 'names-unavailable');
  // The ban list (owner 2 Nov 2026, bans.ts): a banned display name reads as taken, early. Only
  // banned display names: a banned private login name is found by `createAccount`, generically.
  if (config !== undefined && (await displayNameBanned(db, config, n.displayKey))) throw new ApiError(409, 'display-name-taken');
}

/** Domain separation of the login-name tag (FU-D). */
const LOGIN_TAG_CONTEXT = 'x2f/login-name\0';

/**
 * The only form a login name is stored in (FU-D): HMAC-SHA-256 under one `X2F_LOGIN_NAME_KEYS` key of
 * "x2f/login-name\0" + the lower-cased NFC name. One HMAC.
 */
export function loginTag(key: Uint8Array, name: string): Buffer {
  return createHmac('sha256', key).update(LOGIN_TAG_CONTEXT + name.normalize('NFC').toLowerCase(), 'utf8').digest();
}

/** A name's tag under every key of the ring (`ids[i]` ↔ `tags[i]`), and the one under the current key. */
export interface LoginTags {
  ids: number[];
  tags: Buffer[];
  current: Buffer;
}

/** `loginTag` under every key of `X2F_LOGIN_NAME_KEYS`: exactly one HMAC per key, whatever the name. */
export function loginTags(config: Config, name: string): LoginTags {
  const ring = config.loginNameKeys;
  const ids: number[] = [];
  const tags: Buffer[] = [];
  let current: Buffer | undefined;
  for (const [id, key] of ring.keys) {
    const tag = loginTag(key, name);
    ids.push(id);
    tags.push(tag);
    if (id === ring.current) current = tag;
  }
  return { ids, tags, current: current! };
}

/**
 * SQL matching an account by any of a name's `LoginTags` (`$<ids>` smallint[], `$<ids + 1>` bytea[]):
 * a row matches only under its own key id.
 */
export const loginTagMatch = (alias: string, ids: number): string =>
  `(${alias}.login_tag_key_id, ${alias}.login_tag) in (select * from unnest($${ids}::smallint[], $${ids + 1}::bytea[]))`;

/**
 * What a typed login name is looked up and throttled under. `candidates`: its `LoginTags` (FU-D), the
 * same HMAC work for every input: a malformed one is tagged as `~` + its first 64 code units,
 * lower-cased (`~` is not a login-name character, so it matches no account). `tag`: the HMAC under
 * `subkey('name')` it is throttled and decoyed under when it has no account, so a typed login name
 * (often a near miss of a real, private one) is never stored. `valid`: whether it can be a login name.
 */
export function loginNameLookup(config: Config, input: string): { valid: boolean; tag: string; candidates: LoginTags } {
  const r = checkLoginName(input);
  const basis = r.ok ? r.key : `~${input.slice(0, 64).toLowerCase()}`;
  const tag = createHmac('sha256', subkey(config, 'name')).update(`login-name/${basis}`).digest('hex');
  return { valid: r.ok, tag, candidates: loginTags(config, basis) };
}

/** A row found by its login tag: its id and the key id its tag is under. */
export interface TaggedAccount {
  id: string;
  login_tag_key_id: number;
}

/**
 * After a successful login by name (FU-D rotation, like FU-C's pepper rehash): a row tagged under an
 * older key gets the name's tag under the current key, already computed by `loginNameLookup` (no
 * extra HMAC). Written only if the row is still under the key it was found under. Best-effort (FU-D
 * review M1): any failure (a clash with another row, which `createAccount` prevents, a dropped
 * connection, a statement timeout) leaves the row as it is and is swallowed, never logged (the
 * error could carry the tag); the login still succeeds, after a recovery code was already burned
 * or a session cookie already set, and the next login by name retries.
 */
export async function retagLoginName(deps: Pick<Deps, 'db' | 'config'>, account: TaggedAccount, currentTag: Buffer): Promise<void> {
  const current = deps.config.loginNameKeys.current;
  if (account.login_tag_key_id === current) return;
  try {
    await deps.db.query('update accounts set login_tag = $2, login_tag_key_id = $3 where id = $1 and login_tag_key_id = $4', [
      account.id, currentTag, current, account.login_tag_key_id,
    ]);
  } catch {
    // Best-effort: the next login by name retries.
  }
}

/**
 * Startup check (FU-D): refuses to run while any account still holds its login name in plaintext,
 * i.e. migration 012 ran but `npm run tag-login-names -w @x2f/api` did not. The count only, never a name.
 */
export async function assertLoginNamesTagged(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from accounts where login_key is not null');
  if (rows[0]!.n > 0) throw new Error(`startup: ${rows[0]!.n} login names are not tagged yet; run npm run tag-login-names -w @x2f/api`);
}

/**
 * The one-time FU-D tool (`npm run tag-login-names -w @x2f/api`): every row still holding a plaintext
 * login name gets its tag under the current key, and `login_name` / `login_key` are nulled in the same
 * update (the `name_keys` trigger then drops the row's plaintext `login` entry). A pre-009 account
 * (`legacy_login_name`, login key = display key) is tagged the same way and keeps logging in by its
 * display name until it sets a private one. Idempotent; returns counts only, never a name.
 */
export async function tagLoginNames(deps: Pick<Deps, 'db' | 'config'>): Promise<{ tagged: number }> {
  const { rows } = await deps.db.query<{ id: string; login_key: string }>(
    'select id, login_key from accounts where login_key is not null and login_tag is null',
  );
  const ring = deps.config.loginNameKeys;
  const key = ring.keys.get(ring.current)!;
  let tagged = 0;
  for (const row of rows) {
    const r = await deps.db.query(
      'update accounts set login_tag = $3, login_tag_key_id = $4, login_name = null, login_key = null where id = $1 and login_key = $2',
      [row.id, row.login_key, loginTag(key, row.login_key), ring.current],
    );
    tagged += r.rowCount ?? 0;
  }
  return { tagged };
}

/**
 * Every write of a display name or a login tag serialises on this transaction-scoped advisory lock
 * between its name checks and its write (`createAccount`, `setLoginName`): with the login name only
 * a tag, SQL can no longer enforce FU-A review I1's one namespace, nor one name under two ring keys.
 */
const NAMES_LOCK = 0x7832_6644; // "x2fD"

/** Takes `NAMES_LOCK` for the rest of the caller's transaction (a held login name applied at the hold's end, review round 2 N-M1). */
export async function lockNames(db: Queryable): Promise<void> {
  await db.query('select pg_advisory_xact_lock($1)', [NAMES_LOCK]);
}

/**
 * Inside the caller's transaction, under `NAMES_LOCK` (taken here): whether `loginKey` is free as a
 * login name for `self` (null for a new account) in both namespaces: no account's display key
 * equals it (review I1 A), and no other account holds its tag under any key of the ring. With
 * `displayKey`, also that no account's login tag is that display name's (review I1 B: a display
 * name may never be someone's private login name). A login name waiting out an account's 24-hour
 * hold (`account_holds.pending_change`) or among the changes waiting their 24 h (`hold_changes`, hold
 * model v3), of kind `login-name`, its tag under its key id, counts as taken in both namespaces too
 * (review round 2 N-M1), and so does a name on the ban list (owner 2 Nov 2026, bans.ts: a banned
 * display or login name, in either namespace). One query; the tags are computed by the caller.
 */
/** Every banned name is out of both namespaces (owner 2 Nov 2026, the ban list; bans.ts). */
const BANNED_NAMES = ['display-name', 'login-name'] as const;

async function namesTaken(
  db: Queryable,
  q: { self: string | null; loginKey: string; login: LoginTags; display: LoginTags | null },
): Promise<boolean> {
  await lockNames(db);
  const pending = (ids: number) =>
    `exists (select 1 from (select account_id, pending_change as c from account_holds
                            union all select account_id, change from hold_changes) h
              where h.c->>'kind' = 'login-name' and h.account_id is distinct from $4
                and ((h.c->>'keyId')::smallint, decode(h.c->>'tag', 'base64'))
                    in (select * from unnest($${ids}::smallint[], $${ids + 1}::bytea[])))`;
  const { rows } = await db.query<{ taken: boolean }>(
    `select exists (select 1 from accounts where display_key = $1)
         or exists (select 1 from accounts a where ${loginTagMatch('a', 2)} and a.id is distinct from $4)
         or exists (select 1 from accounts a where ${loginTagMatch('a', 5)} and a.id is distinct from $4)
         or ${pending(2)} or ${pending(5)}
         or ${bannedTagSql(BANNED_NAMES, 2)} or ${bannedTagSql(BANNED_NAMES, 5)} as taken`,
    [q.loginKey, q.login.ids, q.login.tags, q.self, q.display?.ids ?? [], q.display?.tags ?? []],
  );
  return rows[0]!.taken;
}

/** True when `loginKey` is taken in either namespace (under `NAMES_LOCK`, in the caller's transaction); Task 17 checks it before a login name waits out the hold. */
export async function loginNameTaken(db: Queryable, config: Config, accountId: string, loginKey: string): Promise<boolean> {
  return namesTaken(db, { self: accountId, loginKey, login: loginTags(config, loginKey), display: null });
}

/**
 * Sets a pre-009 account's private login name (`POST /v1/account/login-name`, inside the caller's
 * transaction): checked in both namespaces under `NAMES_LOCK`, then stored as its tag under the
 * current key (FU-D). 409 `names-unavailable` for a taken name, 409 `login-name-set` when the
 * account is no longer legacy. The caller has checked the name's shape and that it differs from
 * the account's own display name.
 */
export async function setLoginName(db: Queryable, config: Config, accountId: string, loginKey: string): Promise<void> {
  const login = loginTags(config, loginKey);
  if (await namesTaken(db, { self: accountId, loginKey, login, display: null })) throw new ApiError(409, 'names-unavailable');
  const updated = await db.query(
    `update accounts set login_tag = $2, login_tag_key_id = $3, login_name = null, login_key = null, legacy_login_name = false
      where id = $1 and legacy_login_name`,
    [accountId, login.current, config.loginNameKeys.current],
  );
  if ((updated.rowCount ?? 0) === 0) throw new ApiError(409, 'login-name-set');
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

/** The unique constraints a new account's names can still hit after `namesTaken` (a racing writer without the lock). */
const NAME_CONSTRAINTS: ReadonlySet<string> = new Set(['accounts_display_key_key', 'accounts_login_tag_key', 'name_keys_pkey']);

/**
 * Inserts an account (inside the caller's transaction): the final, credential-bound step of every
 * sign-up. The login name is stored only as its tag under the current key (FU-D). Under
 * `NAMES_LOCK`, the names are checked in both namespaces and under every key of the ring
 * (`namesTaken`), so one name cannot be held twice under two keys, and a login name can never be
 * anybody's display name nor the other way round (FU-A review I1). A taken name → 409
 * `names-unavailable`, one answer for all, so it never says which one (or that a login name
 * exists). The names-differ check SQL can no longer make is here too (400 `names-same`;
 * `assertNewNames` already refused it). `webauthn_user_id` is 32 random bytes. Terms version and
 * acceptance time are both null when `termsVersion` is null (staff and owner, Plan 4).
 */
export async function createAccount(
  db: Queryable,
  config: Config,
  a: NewNames & { kind: AccountKind; termsVersion: string | null; now: Date },
): Promise<string> {
  if (a.loginKey === a.displayKey) throw new ApiError(400, 'names-same');
  const login = loginTags(config, a.loginKey);
  const display = loginTags(config, a.displayKey);
  if (await namesTaken(db, { self: null, loginKey: a.loginKey, login, display })) throw new ApiError(409, 'names-unavailable');
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into accounts (display_name, display_key, login_tag, login_tag_key_id, kind, webauthn_user_id, terms_version, terms_accepted_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        a.displayName, a.displayKey, login.current, config.loginNameKeys.current, a.kind, randomBytes(32),
        a.termsVersion, a.termsVersion === null ? null : a.now, a.now,
      ],
    );
    return rows[0]!.id;
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint !== undefined && NAME_CONSTRAINTS.has(err.constraint)) {
      throw new ApiError(409, 'names-unavailable');
    }
    throw e;
  }
}
