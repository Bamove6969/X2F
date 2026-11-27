import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { checkLoginName, checkNames, staffNameKey, type AccountKind } from '@x2f/accounts';
import type { Deps } from './app.js';
import { subkey, type Config } from './config.js';
import type { Queryable } from './db/pool.js';
import { ApiError } from './errors.js';
import { bannedTagSql, tradeTagBanned } from './bans.js';
import { checkTermsSignature, optionalTermsSignature, sealTermsSignature, type TermsSignature } from './termsSignature.js';

/**
 * The two names of a new account: the Trade Tag as typed and as its case-insensitive key, and
 * the login name's key (the lower-cased name: only the key is ever used, and from FU-D on it is
 * stored only as its tag). Held in memory only; a sign-up waiting in a challenge keeps `sealNames`.
 */
export interface NewNames {
  tradeTag: string;
  displayKey: string;
  loginKey: string;
}

/**
 * Checks the two names of a new account (spec 6.1, owner 2026-10-23): their shapes, reserved
 * Trade Tags (with look-alikes), that they differ, and that the Trade Tag is not a look-alike
 * of a staff or owner Trade Tag (F4: 0/o, 1/l/i, rn/m). 400 `trade-tag-invalid`,
 * `trade-tag-reserved`, `login-name-invalid` or `names-same`. A taken Trade Tag is checked by
 * `assertTradeTagFree`; a taken login name only by `createAccount`.
 */
export async function assertNewNames(db: Queryable, tradeTag: unknown, loginName: unknown): Promise<NewNames> {
  const r = checkNames(typeof tradeTag === 'string' ? tradeTag : '', typeof loginName === 'string' ? loginName : '');
  if (!r.ok) {
    if (r.field === 'tradeTag') throw new ApiError(400, r.reason === 'reserved' ? 'trade-tag-reserved' : 'trade-tag-invalid');
    throw new ApiError(400, r.reason === 'same' ? 'names-same' : 'login-name-invalid');
  }
  // F4, review of third-signup-r3 M2: punctuation and spaces are ignored too (staffNameKey).
  const folded = staffNameKey(r.display.key);
  const { rows } = await db.query<{ display_key: string }>("select display_key from accounts where kind in ('staff', 'owner')");
  if (rows.some((s) => staffNameKey(s.display_key) === folded)) throw new ApiError(400, 'trade-tag-reserved');
  return { tradeTag: r.display.name, displayKey: r.display.key, loginKey: r.login.key };
}

/**
 * The other direction of F4 (review of lead-signup-rules-main, M1): a new staff or owner Trade
 * Tag may not look like an existing trader's Trade Tag or a live team member's name (or open
 * member invite), compared by `staffNameKey` as `assertNewNames` compares the other way, so a
 * trader who signed up first can never read like staff. A member's own login account is skipped:
 * its Trade Tag is a random placeholder nobody sees. 400 `trade-tag-reserved`, as for a
 * reserved word. Read in full on each call: it runs only at staff invite accept and owner setup.
 */
export async function assertStaffNameUnlike(db: Queryable, displayKey: string): Promise<void> {
  const folded = staffNameKey(displayKey);
  const { rows } = await db.query<{ display_key: string }>(
    `select display_key from accounts where kind = 'trader'
     union all
     select display_key from team_members where removed_at is null`,
  );
  if (rows.some((r) => staffNameKey(r.display_key) === folded)) throw new ApiError(400, 'trade-tag-reserved');
}

/**
 * `NewNames` as a sign-up challenge's payload keeps them (FU-D, FU-A review note 1): the Trade
 * Tag in clear (it is public), the login name sealed with AES-256-GCM under `subkey('login-seal')`,
 * so a stolen database holds no login name, not even one waiting in a sign-up.
 */
export interface SealedNames {
  tradeTag: string;
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
  return { tradeTag: n.tradeTag, displayKey: n.displayKey, login: Buffer.concat([nonce, body, c.getAuthTag()]).toString('base64url') };
}

/**
 * Opens `sealNames`. Anything that does not open (a server key changed between a sign-up's start
 * and finish, or a payload from before FU-D) → 400 `challenge-expired`: the person starts again.
 */
export function openNames(config: Config, sealed: unknown): NewNames {
  const s = sealed as Partial<SealedNames> | null;
  if (s === null || typeof s !== 'object' || typeof s.tradeTag !== 'string' || typeof s.displayKey !== 'string' || typeof s.login !== 'string') {
    throw new ApiError(400, 'challenge-expired');
  }
  const raw = Buffer.from(s.login, 'base64url');
  try {
    if (raw.length < 12 + 16) throw new Error('short');
    const d = createDecipheriv('aes-256-gcm', subkey(config, 'login-seal'), raw.subarray(0, 12), { authTagLength: 16 });
    d.setAAD(SEAL_AAD);
    d.setAuthTag(raw.subarray(raw.length - 16));
    const loginKey = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8');
    return { tradeTag: s.tradeTag, displayKey: s.displayKey, loginKey };
  } catch {
    throw new ApiError(400, 'challenge-expired');
  }
}

/**
 * Before any expensive work: 409 `trade-tag-taken` for a taken Trade Tag, and 409
 * `names-unavailable` for a login name that is some account's public Trade Tag (review I1: the
 * two names share one namespace, or a private login name would be printed on the site). Trade
 * Tags are public, so neither answer tells anybody anything new. Login names are never read here:
 * a taken login name, or a Trade Tag that is someone's private login name, is only found by
 * `createAccount`, at the very end of a sign-up (after the password is hashed, or after the PGP
 * code or the authenticator has proved the key), and is answered with the generic
 * `names-unavailable`, so there is no cheap way to test whether a private login name exists.
 */
export async function assertTradeTagFree(db: Queryable, n: NewNames, config?: Config): Promise<void> {
  const { rows } = await db.query<{ display_key: string }>('select display_key from accounts where display_key in ($1, $2)', [
    n.displayKey, n.loginKey,
  ]);
  if (rows.some((r) => r.display_key === n.displayKey)) throw new ApiError(409, 'trade-tag-taken');
  if (rows.length > 0) throw new ApiError(409, 'names-unavailable');
  // The ban list (owner 2 Nov 2026, bans.ts): a banned Trade Tag reads as taken, early. Only
  // banned Trade Tags: a banned private login name is found by `createAccount`, generically.
  if (config !== undefined && (await tradeTagBanned(db, config, n.displayKey))) throw new ApiError(409, 'trade-tag-taken');
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
 * Trade Tag until it sets a private one. Idempotent; returns counts only, never a name.
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
 * Every write of a Trade Tag or a login tag serialises on this transaction-scoped advisory lock
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
 * `displayKey`, also that no account's login tag is that Trade Tag's (review I1 B: a Trade
 * Tag may never be someone's private login name). A name on the ban list (owner 2 Nov 2026, bans.ts: a banned
 * display or login name, in either namespace). One query; the tags are computed by the caller.
 */
/** Every banned name is out of both namespaces (owner 2 Nov 2026, the ban list; bans.ts). */
const BANNED_NAMES = ['trade-tag', 'login-name'] as const;

async function namesTaken(
  db: Queryable,
  q: { self: string | null; loginKey: string; login: LoginTags; display: LoginTags | null },
  o: { lock: boolean } = { lock: true },
): Promise<boolean> {
  if (o.lock) await lockNames(db);
  const { rows } = await db.query<{ taken: boolean }>(
    `select exists (select 1 from accounts where display_key = $1)
         or exists (select 1 from accounts a where ${loginTagMatch('a', 2)} and a.id is distinct from $4)
         or exists (select 1 from accounts a where ${loginTagMatch('a', 5)} and a.id is distinct from $4)
         or ${bannedTagSql(BANNED_NAMES, 2)} or ${bannedTagSql(BANNED_NAMES, 5)} as taken`,
    [q.loginKey, q.login.ids, q.login.tags, q.self, q.display?.ids ?? [], q.display?.tags ?? []],
  );
  return rows[0]!.taken;
}

/** True when `loginKey` is taken in either namespace (under `NAMES_LOCK`, in the caller's transaction). */
export async function loginNameTaken(db: Queryable, config: Config, accountId: string, loginKey: string): Promise<boolean> {
  return namesTaken(db, { self: accountId, loginKey, login: loginTags(config, loginKey), display: null });
}

/**
 * The sign-up's live "is available" tick (`POST /v1/register/name-check`): whether `loginKey` is
 * free as a new account's login name, in both namespaces, as `createAccount` will check it (a login
 * name waiting out a hold counts as taken). A read without `NAMES_LOCK`: the answer is advice only,
 * and `createAccount` checks again under the lock. This deliberately lets a visitor learn whether a
 * private login name exists (the design's tick), which FU-A review I1 had kept to the end of a
 * sign-up; the route's budgets (limits.ts `NAME_CHECK_*`) are what bound it.
 */
export async function loginNameAvailable(db: Queryable, config: Config, loginKey: string): Promise<boolean> {
  return !(await namesTaken(db, { self: null, loginKey, login: loginTags(config, loginKey), display: null }, { lock: false }));
}

/**
 * Sets a pre-009 account's private login name (`POST /v1/account/login-name`, inside the caller's
 * transaction): checked in both namespaces under `NAMES_LOCK`, then stored as its tag under the
 * current key (FU-D). 409 `names-unavailable` for a taken name, 409 `login-name-set` when the
 * account is no longer legacy. The caller has checked the name's shape and that it differs from
 * the account's own Trade Tag.
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
 * older, not a string) → 400 `terms-not-accepted` `{ version }`. Then the signature given with it
 * (owner, 8 Nov 2026; `checkTermsSignature`: 400 `signature-required`, `signature-invalid` or
 * `signature-too-large`). Every register finish and `POST /v1/account/terms` calls it before any
 * hashing, challenge use or write.
 */
export function assertTermsAccepted(
  deps: Pick<Deps, 'config'>,
  acceptedTerms: unknown,
  termsSignature: unknown,
): { version: string; signature: TermsSignature } {
  const version = assertTermsVersion(deps, acceptedTerms);
  return { version, signature: checkTermsSignature(termsSignature) };
}

/**
 * A trader's sign-up (owner demo note #187, 25 Nov 2026: a tick, no signature): R10's version check
 * exactly as `assertTermsAccepted` (400 `terms-not-accepted` `{ version }` unless it equals
 * `config.termsVersion`), first; then the signature only if one was sent (`optionalTermsSignature`:
 * absent → `null`; sent → `checkTermsSignature`'s 400s). Every trader register finish calls it
 * before any hashing, challenge use or write.
 */
export function assertTraderTermsAccepted(
  deps: Pick<Deps, 'config'>,
  acceptedTerms: unknown,
  termsSignature: unknown,
): { version: string; signature: TermsSignature | null } {
  const version = assertTermsVersion(deps, acceptedTerms);
  return { version, signature: optionalTermsSignature(termsSignature) };
}

/** R10's version check alone: the current version, or 400 `terms-not-accepted` `{ version }`. */
export function assertTermsVersion(deps: Pick<Deps, 'config'>, acceptedTerms: unknown): string {
  const version = deps.config.termsVersion;
  if (acceptedTerms !== version) throw new ApiError(400, 'terms-not-accepted', { version });
  return version;
}

/**
 * What a new account agreed to. A team member on their own login account (review 2026-11-08 F1)
 * and a staff member at their invite sign the Terms (owner, 9 Nov 2026, p11-14), each passing
 * `assertTermsAccepted` first. A trader agrees with the tick alone (owner demo note #187, 25 Nov
 * 2026), passing `assertTraderTermsAccepted`: the signature is `null` unless an older page sent one.
 * Only the owner's account, made by the owner's setup, has no Terms version.
 */
export type NewAccountTerms =
  | { kind: 'trader'; termsVersion: string; termsSignature: TermsSignature | null }
  | { kind: Exclude<AccountKind, 'owner' | 'trader'>; termsVersion: string; termsSignature: TermsSignature }
  | { kind: 'owner'; termsVersion: null; termsSignature?: never };

/** The unique constraints a new account's names can still hit after `namesTaken` (a racing writer without the lock). */
const NAME_CONSTRAINTS: ReadonlySet<string> = new Set(['accounts_display_key_key', 'accounts_login_tag_key', 'name_keys_pkey']);

/**
 * Inserts an account (inside the caller's transaction): the final, credential-bound step of every
 * sign-up. The login name is stored only as its tag under the current key (FU-D). Under
 * `NAMES_LOCK`, the names are checked in both namespaces and under every key of the ring
 * (`namesTaken`), so one name cannot be held twice under two keys, and a login name can never be
 * anybody's Trade Tag nor the other way round (FU-A review I1). A taken name → 409
 * `names-unavailable`, one answer for all, so it never says which one (or that a login name
 * exists). The names-differ check SQL can no longer make is here too (400 `names-same`;
 * `assertNewNames` already refused it). `webauthn_user_id` is 32 random bytes. Terms version,
 * acceptance time and signature are all null for the owner (`termsVersion` null); every other
 * account has the version and time, and the signature when one was given (always for a member or
 * staff; for a trader only if an older page sent one, owner demo note #187), sealed to the account
 * (so its id is chosen here, not by the database); nothing else about the signing is stored.
 */
export async function createAccount(
  db: Queryable,
  config: Config,
  a: NewNames & NewAccountTerms & { now: Date },
): Promise<string> {
  if (a.loginKey === a.displayKey) throw new ApiError(400, 'names-same');
  const login = loginTags(config, a.loginKey);
  const display = loginTags(config, a.displayKey);
  if (await namesTaken(db, { self: null, loginKey: a.loginKey, login, display })) throw new ApiError(409, 'names-unavailable');
  const id = randomUUID();
  try {
    await db.query(
      `insert into accounts (id, trade_tag, display_key, login_tag, login_tag_key_id, kind, webauthn_user_id, terms_version, terms_accepted_at, terms_signature, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id, a.tradeTag, a.displayKey, login.current, config.loginNameKeys.current, a.kind, randomBytes(32),
        a.termsVersion, a.termsVersion === null ? null : a.now,
        a.kind === 'owner' || a.termsSignature === null ? null : sealTermsSignature(config, a.termsSignature, id), a.now,
      ],
    );
    return id;
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint !== undefined && NAME_CONSTRAINTS.has(err.constraint)) {
      throw new ApiError(409, 'names-unavailable');
    }
    throw e;
  }
}
