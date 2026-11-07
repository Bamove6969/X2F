/**
 * The ban list (owner, 2 Nov 2026; docs/design-hold-model-2026-11-02.md): when an account is
 * banned, its usernames (display name and login name), its PGP key fingerprints (the primary key
 * and every subkey) and its secure Jabber account are recorded, and none of them can be used again.
 * Not tracked: Monero addresses, payment details, IP addresses, device fingerprints.
 *
 * Storage (migration 017): only keyed tags under X2F_LOGIN_NAME_KEYS, matched under every key of
 * the ring, as login names are since FU-D. Names are tagged exactly as login names are
 * (`loginTag`), so they are checked inside `namesTaken` (accounts.ts) with every other name rule,
 * in one namespace: a banned display name can be neither a display nor a login name, and the same
 * for a banned login name. Fingerprints and Jabber addresses get their own `banTag`.
 *
 * Where each check runs:
 * - names: `createAccount`, `setLoginName` and a login name waiting out the hold (all through
 *   `namesTaken`: 409 `names-unavailable`, never saying why); a banned display name is also
 *   refused early by `assertDisplayNameFree` (409 `display-name-taken`; display names are public).
 * - PGP keys: `assertKeyNotBanned` (409 `key-unavailable`) only where a key is written, after its
 *   code proved it: `insertPgpKey` (sign-up, a team member's and a staff invitee's join) and
 *   `applyPgpKey` (an added key, at once or when the hold ends). Never at a start: a check there
 *   would tell anyone, with no login and no proof, whether a key is banned (lead review 2026-11-06
 *   item 1). A login's key refresh checks the merged key before writing it (`pgp.ts` login finish).
 * - Jabber: `jabberBanned` is the seam. There is no Jabber alert account in the code yet; its
 *   setup must refuse an address this answers true for (NEEDS_JABBER_SETUP).
 *
 * The ban action itself is staff-side (Plan 4) and calls `recordBan` in its own transaction; on
 * this branch nothing calls `recordBan` yet (the staff ban route is Plan 4 Task 27's).
 */
import { domainToASCII } from 'node:url';
import { createHmac } from 'node:crypto';
import * as openpgp from 'openpgp';
import { loginTag, loginTags } from './accounts.js';
import type { Deps } from './app.js';
import type { Config } from './config.js';
import type { Queryable } from './db/pool.js';
import { ApiError } from './errors.js';

export type BannedKind = 'display-name' | 'login-name' | 'pgp-fingerprint' | 'jabber';

/** Domain separation of the fingerprint and Jabber tags (names use `loginTag`'s own). */
const BAN_TAG_CONTEXT: Record<Exclude<BannedKind, 'display-name' | 'login-name'>, string> = {
  'pgp-fingerprint': 'x2f/ban/pgp-fingerprint\0',
  jabber: 'x2f/ban/jabber\0',
};

/** The tag of a fingerprint (lower-case hex) or a normalized Jabber address under one ring key. */
export function banTag(key: Uint8Array, kind: 'pgp-fingerprint' | 'jabber', value: string): Buffer {
  return createHmac('sha256', key).update(BAN_TAG_CONTEXT[kind] + value, 'utf8').digest();
}

/** A value's tags under every key of the ring (`ids[i]` ↔ `tags[i]`) and the one under the current key. */
function ringTags(config: Config, kind: BannedKind, value: string): { ids: number[]; tags: Buffer[]; current: Buffer } {
  if (kind === 'display-name' || kind === 'login-name') return loginTags(config, value);
  const ids: number[] = [];
  const tags: Buffer[] = [];
  let current: Buffer | undefined;
  for (const [id, key] of config.loginNameKeys.keys) {
    const t = banTag(key, kind, value);
    ids.push(id);
    tags.push(t);
    if (id === config.loginNameKeys.current) current = t;
  }
  return { ids, tags, current: current! };
}

/** Every fingerprint in an armored public key: the primary key's, then each subkey's (lower-case hex). */
export async function keyFingerprints(armored: string): Promise<string[]> {
  const key = await openpgp.readKey({ armoredKey: armored });
  return [key.getFingerprint(), ...key.getSubkeys().map((s) => s.getFingerprint())].map((f) => f.toLowerCase());
}

/**
 * A Jabber (XMPP) address as it is banned and checked: trimmed, without its `/resource`, NFKC
 * (full-width and other compatibility forms fold to plain ones), lower-cased; the domain without a
 * trailing dot and in its ASCII (punycode) form, so `ÉXAMPLE.org.` and `xn--xample-9ua.org` match
 * (lead vendor review, minor). Null when it is not `local@domain` or the domain is not valid.
 */
export function normalizeJabber(jid: string): string | null {
  const bare = jid.trim().split('/')[0]!.normalize('NFKC').toLowerCase();
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(bare);
  if (!m) return null;
  const domain = domainToASCII(m[2]!.replace(/\.$/, ''));
  return domain === '' ? null : `${m[1]}@${domain}`;
}

/** SQL: true when any of `$<ids>` (smallint[]) / `$<ids + 1>` (bytea[]) is a banned tag of a kind in `kinds`. */
export const bannedTagSql = (kinds: readonly BannedKind[], ids: number): string =>
  `exists (select 1 from banned_identifiers b where b.kind in (${kinds.map((k) => `'${k}'`).join(', ')})
             and (b.tag_key_id, b.tag) in (select * from unnest($${ids}::smallint[], $${ids + 1}::bytea[])))`;

/** True when any of `values` (already normalized) is banned as `kind`, under any key of the ring. */
async function anyBanned(db: Queryable, config: Config, kinds: readonly BannedKind[], tagKind: BannedKind, values: readonly string[]): Promise<boolean> {
  if (values.length === 0) return false;
  const ids: number[] = [];
  const tags: Buffer[] = [];
  for (const v of values) {
    const t = ringTags(config, tagKind, v);
    ids.push(...t.ids);
    tags.push(...t.tags);
  }
  const { rows } = await db.query<{ banned: boolean }>(`select ${bannedTagSql(kinds, 1)} as banned`, [ids, tags]);
  return rows[0]!.banned;
}

/** 409 `key-unavailable` when the key's primary fingerprint or any subkey's is on the ban list. */
export async function assertKeyNotBanned(db: Queryable, config: Config, armored: string): Promise<void> {
  if (await anyBanned(db, config, ['pgp-fingerprint'], 'pgp-fingerprint', await keyFingerprints(armored))) {
    throw new ApiError(409, 'key-unavailable');
  }
}

/** True when the display name (its case-insensitive key) is banned as a display name. */
export async function displayNameBanned(db: Queryable, config: Config, displayKey: string): Promise<boolean> {
  return anyBanned(db, config, ['display-name'], 'display-name', [displayKey]);
}

/**
 * The Jabber seam (no Jabber alert account in the code yet): true when the address is on the ban
 * list. A malformed address is not banned (its own setup check refuses it).
 */
export async function jabberBanned(db: Queryable, config: Config, jid: string): Promise<boolean> {
  const bare = normalizeJabber(jid);
  return bare === null ? false : anyBanned(db, config, ['jabber'], 'jabber', [bare]);
}

/**
 * Records values (already normalized: lower-case fingerprints, a bare Jabber address, a name key)
 * as banned, each as its tag under the current ring key. A value already banned is left as it is.
 * Returns how many rows were new.
 */
export async function recordBannedValues(
  db: Queryable,
  config: Config,
  a: { kind: BannedKind; values: readonly string[]; accountId: string | null; now: Date },
): Promise<number> {
  const ring = config.loginNameKeys;
  const key = ring.keys.get(ring.current)!;
  let added = 0;
  for (const v of new Set(a.values)) {
    if (await anyBanned(db, config, [a.kind], a.kind, [v])) continue;
    const tag = a.kind === 'display-name' || a.kind === 'login-name' ? loginTag(key, v) : banTag(key, a.kind, v);
    added += await insertTag(db, { kind: a.kind, keyId: ring.current, tag, accountId: a.accountId, now: a.now });
  }
  return added;
}

async function insertTag(db: Queryable, r: { kind: BannedKind; keyId: number; tag: Buffer; accountId: string | null; now: Date }): Promise<number> {
  const res = await db.query(
    `insert into banned_identifiers (kind, tag_key_id, tag, account_id, banned_at) values ($1, $2, $3, $4, $5)
     on conflict (kind, tag_key_id, tag) do nothing`,
    [r.kind, r.keyId, r.tag, r.accountId, r.now],
  );
  return res.rowCount ?? 0;
}

/**
 * Puts a banned account's identifiers on the ban list (the internal function Plan 4's ban action
 * calls, in its transaction when given one): its display name, its login name (its stored tag,
 * copied as it is: the plaintext is never kept), every fingerprint of every PGP key on it, and
 * `jabber` when given (the account's Jabber address; there is no column for it yet). Nothing else.
 * Idempotent. Returns how many rows were new.
 */
export async function recordBan(
  deps: Pick<Deps, 'db' | 'config' | 'clock'>,
  accountId: string,
  o: { jabber?: string | null } = {},
): Promise<{ recorded: number }> {
  const { db, config } = deps;
  const now = deps.clock();
  const { rows } = await db.query<{ display_key: string; login_tag: Buffer | null; login_tag_key_id: number | null }>(
    'select display_key, login_tag, login_tag_key_id from accounts where id = $1',
    [accountId],
  );
  const acc = rows[0];
  if (!acc) throw new ApiError(404, 'not-found');
  let recorded = await recordBannedValues(db, config, { kind: 'display-name', values: [acc.display_key], accountId, now });
  if (acc.login_tag !== null && acc.login_tag_key_id !== null) {
    recorded += await insertTag(db, { kind: 'login-name', keyId: acc.login_tag_key_id, tag: acc.login_tag, accountId, now });
  }
  const keys = await db.query<{ fingerprint: string; armored_enc: Buffer }>('select fingerprint, armored_enc from pgp_keys where account_id = $1', [accountId]);
  const fingerprints: string[] = [];
  // Imported here, not at the top: auth/pgp.ts imports this module (its key checks), and
  // accounts.ts does too (the name checks), so a static import would close a cycle.
  const { openKey } = await import('./auth/pgp.js');
  for (const k of keys.rows) {
    fingerprints.push(k.fingerprint);
    fingerprints.push(...(await keyFingerprints(openKey(config, k.armored_enc, k.fingerprint))));
  }
  recorded += await recordBannedValues(db, config, { kind: 'pgp-fingerprint', values: fingerprints, accountId, now });
  if (o.jabber !== undefined && o.jabber !== null) {
    const bare = normalizeJabber(o.jabber);
    if (bare === null) throw new ApiError(400, 'bad-request');
    recorded += await recordBannedValues(db, config, { kind: 'jabber', values: [bare], accountId, now });
  }
  return { recorded };
}
