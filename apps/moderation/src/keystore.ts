import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/**
 * The moderation keystore, in the moderation service's own database (`x2f_moderation`), which the
 * API's database role cannot read. Everything secret is sealed with AES-256-GCM:
 * - `mod_party_state` under MOD_KEYSTORE_KEY itself;
 * - `mod_wallet_secrets` under a SEPARATE subkey of it (HKDF-SHA-256, info `x2f/mod/wallet`), in
 *   its own table apart from the saved session (R27), so one leaked party-state row never yields
 *   the wallet password that protects the saved escrow keys.
 * The trade code is the associated data, so a sealed row moved to another trade fails to open.
 */
const KEY_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;
/** R27: each trade's escrow wallet password is this many random bytes from the OS CSPRNG. */
export const WALLET_PASSWORD_BYTES = 32;

export const MOD_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 0x7832_6d6f; // "x2mo"

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_LEN) throw new TypeError('keystore: MOD_KEYSTORE_KEY must be 32 bytes');
}

/** A purpose-bound subkey of MOD_KEYSTORE_KEY: HKDF-SHA-256, info `x2f/mod/<label>`, 32 bytes. */
export function modSubkey(keystoreKey: Uint8Array, label: 'wallet'): Uint8Array {
  assertKey(keystoreKey);
  return new Uint8Array(hkdfSync('sha256', keystoreKey, new Uint8Array(0), `x2f/mod/${label}`, KEY_LEN));
}

/** AES-256-GCM: nonce (12) || ciphertext || tag (16), with `aad` bound in. */
export function seal(key: Uint8Array, aad: string, plaintext: Uint8Array): Buffer {
  assertKey(key);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]);
}

export function open(key: Uint8Array, aad: string, sealed: Buffer): Uint8Array {
  assertKey(key);
  if (sealed.length < NONCE_LEN + TAG_LEN) throw new Error('keystore: sealed value too short');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE_LEN), { authTagLength: TAG_LEN });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LEN));
  return new Uint8Array(Buffer.concat([decipher.update(sealed.subarray(NONCE_LEN, sealed.length - TAG_LEN)), decipher.final()]));
}

/** Applies `migrations/NNN_*.sql` to the moderation database, each once, in name order. */
export async function migrateModeration(db: pg.Pool, dir = MOD_MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => MIGRATION_NAME.test(f)).sort();
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query('create table if not exists mod_schema_migrations (name text primary key, applied_at timestamptz not null default now())');
      await client.query('revoke all on mod_schema_migrations from public');
      const done = new Set((await client.query<{ name: string }>('select name from mod_schema_migrations')).rows.map((r) => r.name));
      for (const name of files) {
        if (done.has(name)) continue;
        const sql = await readFile(join(dir, name), 'utf8');
        await client.query('begin');
        try {
          await client.query(sql);
          await client.query('insert into mod_schema_migrations (name) values ($1)', [name]);
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        }
        applied.push(name);
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return applied;
}

/** Anything that runs a parameterised query: the pool or a client inside a transaction. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

/** Seal and store a trade's moderator party state (JSON) under MOD_KEYSTORE_KEY. */
export async function saveParty(db: Queryable, keystoreKey: Uint8Array, trade: string, state: unknown): Promise<void> {
  const sealed = seal(keystoreKey, `x2f/mod/party/${trade}`, new TextEncoder().encode(JSON.stringify(state)));
  await db.query(
    `insert into mod_party_state (trade, sealed, updated_at) values ($1, $2, now())
     on conflict (trade) do update set sealed = excluded.sealed, updated_at = now()`,
    [trade, sealed],
  );
}

export async function loadParty<T = unknown>(db: Queryable, keystoreKey: Uint8Array, trade: string): Promise<T | null> {
  const { rows } = await db.query<{ sealed: Buffer }>('select sealed from mod_party_state where trade = $1', [trade]);
  const row = rows[0];
  if (!row) return null;
  return JSON.parse(new TextDecoder().decode(open(keystoreKey, `x2f/mod/party/${trade}`, row.sealed))) as T;
}

/**
 * The trade's escrow wallet password (R27): created once as 32 random bytes from the OS CSPRNG,
 * sealed under the wallet subkey in `mod_wallet_secrets`, and returned as lower-case hex (the
 * string `runParty` takes). Never derived from anything, never stored with the party state.
 */
export async function walletPassword(db: Queryable, keystoreKey: Uint8Array, trade: string): Promise<string> {
  const key = modSubkey(keystoreKey, 'wallet');
  const aad = `x2f/mod/wallet/${trade}`;
  const fresh = randomBytes(WALLET_PASSWORD_BYTES);
  await db.query('insert into mod_wallet_secrets (trade, sealed) values ($1, $2) on conflict (trade) do nothing', [
    trade, seal(key, aad, fresh),
  ]);
  fresh.fill(0);
  const { rows } = await db.query<{ sealed: Buffer }>('select sealed from mod_wallet_secrets where trade = $1', [trade]);
  const bytes = open(key, aad, rows[0]!.sealed);
  if (bytes.length !== WALLET_PASSWORD_BYTES) throw new Error('keystore: wallet secret has the wrong length');
  const hex = Buffer.from(bytes).toString('hex');
  bytes.fill(0);
  return hex;
}

/** A chat's moderator identity as kept here (hex secrets), Task 20. */
export interface ChatModIdentity {
  signPublic: string;
  boxPublic: string;
  signSecret: Uint8Array;
  boxSecret: Uint8Array;
}

const chatAad = (chat: string): string => `x2f/mod/chat-identity/${chat}`;
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** Seal and store a chat's moderator identity once (a second call keeps the first). */
export async function saveChatIdentity(db: Queryable, keystoreKey: Uint8Array, chat: string, id: ChatModIdentity): Promise<void> {
  const json = JSON.stringify({ signPublic: id.signPublic, boxPublic: id.boxPublic, signSecret: toHex(id.signSecret), boxSecret: toHex(id.boxSecret) });
  await db.query('insert into mod_chat_identities (chat, sealed) values ($1, $2) on conflict (chat) do nothing', [
    chat, seal(keystoreKey, chatAad(chat), new TextEncoder().encode(json)),
  ]);
}

export async function loadChatIdentity(db: Queryable, keystoreKey: Uint8Array, chat: string): Promise<ChatModIdentity | null> {
  const { rows } = await db.query<{ sealed: Buffer }>('select sealed from mod_chat_identities where chat = $1', [chat]);
  const row = rows[0];
  if (!row) return null;
  const o = JSON.parse(new TextDecoder().decode(open(keystoreKey, chatAad(chat), row.sealed))) as Record<string, string>;
  return {
    signPublic: o.signPublic!,
    boxPublic: o.boxPublic!,
    signSecret: new Uint8Array(Buffer.from(o.signSecret!, 'hex')),
    boxSecret: new Uint8Array(Buffer.from(o.boxSecret!, 'hex')),
  };
}

/** Seal and store a trade's escrow PartyState (Task 9) under MOD_KEYSTORE_KEY, apart from its wallet password (R27). */
export async function saveEscrow(db: Queryable, keystoreKey: Uint8Array, trade: string, state: unknown): Promise<void> {
  const sealed = seal(keystoreKey, `x2f/mod/escrow/${trade}`, new TextEncoder().encode(JSON.stringify(state)));
  await db.query(
    `insert into mod_escrow_state (trade, sealed, updated_at) values ($1, $2, now())
     on conflict (trade) do update set sealed = excluded.sealed, updated_at = now()`,
    [trade, sealed],
  );
}

export async function loadEscrow<T = unknown>(db: Queryable, keystoreKey: Uint8Array, trade: string): Promise<T | null> {
  const { rows } = await db.query<{ sealed: Buffer }>('select sealed from mod_escrow_state where trade = $1', [trade]);
  const row = rows[0];
  if (!row) return null;
  return JSON.parse(new TextDecoder().decode(open(keystoreKey, `x2f/mod/escrow/${trade}`, row.sealed))) as T;
}
