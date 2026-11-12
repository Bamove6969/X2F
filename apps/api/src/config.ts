import { createECDH, hkdfSync, timingSafeEqual } from 'node:crypto';
import { constants, readFileSync, statSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { parseFxSources, type FxSourceName } from './price/fx.js';
import { parsePriceSources, type PriceSourceName } from './price/sources.js';

export interface Config {
  siteName: string;
  origins: string[];
  rpId: string;
  databaseUrl: string;
  leakedListPath: string;
  serverKey: Uint8Array /* 32 bytes */;
  attestationDir: string;
  moneroNetwork: 'mainnet' | 'stagenet' | 'testnet';
  termsVersion: string;
  pgpSigningKeyPath: string;
  pgpSigningFingerprint: string;
  /** Task 19: VAPID key pair for Web Push, base64url (P-256 public point; private scalar). */
  vapidPublic: string;
  vapidPrivate: string;
  /** `PRICE_SOURCES` (spec 11.6): the price sources the feed asks, by name; default all of them. */
  priceSources: PriceSourceName[];
  /** `FX_SOURCES` (spec 11.6): the exchange-rate sources, in trust order; default Coinbase, BitPay, CoinGecko. */
  fxSources: FxSourceName[];
  /** Peppers mixed into password hashes (HMAC before Argon2id); `X2F_PASSWORD_PEPPERS`. */
  passwordPeppers: Keyring;
  /** Keys of the recovery-code HMAC; `X2F_RECOVERY_CODE_KEYS`. */
  recoveryCodeKeys: Keyring;
  /** Keys that seal TOTP secrets (the file/env key store, `totpBox`); `X2F_TOTP_KEYS`. */
  totpKeys: Keyring;
  /** Keys of the login-name tag (HMAC-SHA-256, FU-D): the only form a login name is stored in; `X2F_LOGIN_NAME_KEYS`. */
  loginNameKeys: Keyring;
  /**
   * `X2F_LEGACY_SECRETS` (`on` by default, or `off`): whether values stored before FU-C are still
   * accepted: unpeppered password hashes, SHA-256 recovery codes and format-0 TOTP blobs. Turned off
   * once their counts reach 0 (docs/dev-setup.md); with `off` each fails like a wrong credential.
   */
  legacySecrets: boolean;
  /**
   * S-085: `X2F_DEVICE_BOUND_SESSIONS` (`off` by default, or `on`): device-bound sessions
   * (auth/deviceBound.ts). Off, nothing is bound and nothing new is checked (the kill switch).
   * Optional so a config built without it reads as off.
   */
  deviceBoundSessions?: boolean;
  /**
   * Owner rule p5-7 (Jabber account-change notices): the key ring that seals each Jabber address at
   * rest (`X2F_JABBER_KEYS`, env or file, like the other rings). Optional: without it, or without
   * `xmpp`, the Jabber set-up answers 503 `jabber-unavailable`.
   */
  jabberKeys: Keyring | null;
  /** X2F's own sending account (`X2F_XMPP_*`). GAP: the production account and server are not set up yet. */
  xmpp: XmppConfig | null;
}

/**
 * X2F's Jabber sending account. The connection is through a SOCKS5 proxy (Tor) only, then direct
 * TLS only (XEP-0368, default port 5223), certificate checked against `domain`; there is no direct
 * connection and no plaintext or STARTTLS path at all.
 */
export interface XmppConfig {
  /** The bare address messages come from, e.g. `x2f-alerts@xmpp.example.org`. */
  jid: string;
  /** Its password (`X2F_XMPP_PASSWORD` or `X2F_XMPP_PASSWORD_FILE`). Never logged. */
  password: string;
  /** Where to connect (default: the address's domain; a `.onion` name is fine) and its direct-TLS port (default 5223). */
  host: string;
  port: number;
  /**
   * The SOCKS5 proxy every connection goes through (`X2F_XMPP_SOCKS`, required: owner ruling p11-31,
   * Tor is mandatory), normally the local Tor daemon. An IP address, never a name; `host` is handed
   * to it unresolved.
   */
  socks: { host: string; port: number };
}

/**
 * A versioned set of 32-byte secrets. New values always use `current`; the others are kept only so
 * older stored values still verify or open until they are rehashed, rewrapped or regenerated.
 */
export interface Keyring {
  current: number;
  keys: ReadonlyMap<number, Uint8Array>;
}

type Env = Record<string, string | undefined>;

const NETWORKS = ['mainnet', 'stagenet', 'testnet'] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// Errors name the variable only, never its value (DATABASE_URL, X2F_SERVER_KEY and the key rings are secrets).
function missing(name: string): Error {
  return new Error(`config: ${name} is missing`);
}
function malformed(name: string, why: string): Error {
  return new Error(`config: ${name} is malformed (${why})`);
}

function required(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v === '') throw missing(name);
  return v;
}

function parseOrigins(raw: string): string[] {
  const list = raw.split(',').map((s) => s.trim());
  for (const o of list) {
    let url: URL;
    try {
      url = new URL(o);
    } catch {
      throw malformed('X2F_ORIGINS', 'each entry must be an exact origin such as https://example.org');
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== o) {
      throw malformed('X2F_ORIGINS', 'each entry must be an exact origin such as https://example.org');
    }
  }
  return list;
}

/** True when `publicKey` is the P-256 public point of `privateKey` (both base64url). */
function vapidPairMatches(publicKey: string, privateKey: string): boolean {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    return ecdh.getPublicKey().toString('base64url') === publicKey;
  } catch {
    return false;
  }
}

/** Key ids are stored in `smallint` columns and in the sealed-blob header: 1..32767. */
const KEY_ID = /^[1-9][0-9]{0,4}$/;
const KEY_ID_MAX = 32_767;

/**
 * A key ring's text: `<NAME>` from the environment, or the contents of the file `<NAME>_FILE`
 * (a regular file readable only by the API user, chmod 600), never both.
 */
function ringSource(env: Env, name: string): string {
  const direct = env[name];
  const path = env[`${name}_FILE`];
  const hasDirect = direct !== undefined && direct !== '';
  const hasPath = path !== undefined && path !== '';
  if (hasDirect && hasPath) throw malformed(name, `set ${name} or ${name}_FILE, not both`);
  if (!hasPath) {
    if (!hasDirect) throw missing(name);
    return direct;
  }
  const refuse = (why: string) => new Error(`config: ${name}_FILE ${why}`);
  let text: string;
  try {
    const info = statSync(path);
    if (!info.isFile()) throw refuse('is not a regular file');
    if ((info.mode & 0o077) !== 0) throw refuse('must be readable only by the API user (chmod 600)');
    // Skipped where the platform has no user ids (Windows).
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw refuse('must be owned by the API user');
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(`config: ${name}_FILE`)) throw e;
    throw refuse('is not a readable file');
  }
  return text;
}

/**
 * `<id>:<base64 of 32 random bytes>[,<id>:<base64>...]`; the first entry is the current key. Ids
 * are 1..32767 and unique. Errors name the variable only, never a key.
 */
function parseKeyring(name: string, raw: string): Keyring {
  const shape = 'comma list of <id>:<base64 of 32 random bytes>, id 1-32767, newest first';
  const keys = new Map<number, Uint8Array>();
  let current: number | undefined;
  for (const entry of raw.trim().split(',')) {
    const at = entry.indexOf(':');
    const idText = entry.slice(0, at).trim();
    const keyText = entry.slice(at + 1).trim();
    if (at < 0 || !KEY_ID.test(idText) || !BASE64.test(keyText)) throw malformed(name, shape);
    const id = Number(idText);
    const key = new Uint8Array(Buffer.from(keyText, 'base64'));
    if (id > KEY_ID_MAX || key.length !== 32) throw malformed(name, shape);
    if (keys.has(id)) throw malformed(name, 'each id once');
    for (const other of keys.values()) if (timingSafeEqual(other, key)) throw malformed(name, 'each key once');
    keys.set(id, key);
    current ??= id;
  }
  if (current === undefined) throw malformed(name, shape);
  return { current, keys };
}

/** The key rings and `serverKey` must not share a key: each secret protects one thing only. */
function assertSeparate(serverKey: Uint8Array, rings: Array<[string, Keyring]>): void {
  const seen: Uint8Array[] = [serverKey];
  for (const [name, ring] of rings) {
    for (const key of ring.keys.values()) {
      if (seen.some((k) => timingSafeEqual(k, key))) {
        throw malformed(name, 'its keys must be separate from X2F_SERVER_KEY and from the other key rings');
      }
    }
    seen.push(...ring.keys.values());
  }
}

/** Reads the API's settings; throws naming the first missing or malformed variable. */
export function loadConfig(env: Env): Config {
  const siteName = env.X2F_SITE_NAME || 'X2F';
  const origins = parseOrigins(required(env, 'X2F_ORIGINS'));

  const rpId = required(env, 'X2F_RP_ID');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(rpId)) {
    throw malformed('X2F_RP_ID', 'a lower-case host name');
  }

  const databaseUrl = required(env, 'DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw malformed('DATABASE_URL', 'a postgres:// URL');

  const leakedListPath = required(env, 'X2F_LEAKED_LIST_PATH');

  const rawKey = required(env, 'X2F_SERVER_KEY');
  if (!BASE64.test(rawKey)) throw malformed('X2F_SERVER_KEY', 'base64 of 32 random bytes');
  const serverKey = new Uint8Array(Buffer.from(rawKey, 'base64'));
  if (serverKey.length !== 32) throw malformed('X2F_SERVER_KEY', 'base64 of 32 random bytes');

  const attestationDir = env.X2F_ATTESTATION_DIR || 'apps/api/data/fido-mds';

  const network = required(env, 'X2F_MONERO_NETWORK');
  const moneroNetwork = NETWORKS.find((n) => n === network);
  if (!moneroNetwork) throw malformed('X2F_MONERO_NETWORK', 'mainnet, stagenet or testnet');

  const termsVersion = required(env, 'X2F_TERMS_VERSION');
  if (termsVersion.length > 32) throw malformed('X2F_TERMS_VERSION', 'at most 32 characters');

  const pgpSigningKeyPath = required(env, 'X2F_PGP_SIGNING_KEY_PATH');

  const pgpSigningFingerprint = required(env, 'X2F_PGP_SIGNING_FINGERPRINT');
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(pgpSigningFingerprint)) {
    throw malformed('X2F_PGP_SIGNING_FINGERPRINT', 'lower-case hex, 40 or 64 characters');
  }

  const priceSources = parsePriceSources(env.PRICE_SOURCES);
  const fxSources = parseFxSources(env.FX_SOURCES);
  const passwordPeppers = parseKeyring('X2F_PASSWORD_PEPPERS', ringSource(env, 'X2F_PASSWORD_PEPPERS'));
  const recoveryCodeKeys = parseKeyring('X2F_RECOVERY_CODE_KEYS', ringSource(env, 'X2F_RECOVERY_CODE_KEYS'));
  const totpKeys = parseKeyring('X2F_TOTP_KEYS', ringSource(env, 'X2F_TOTP_KEYS'));
  const loginNameKeys = parseKeyring('X2F_LOGIN_NAME_KEYS', ringSource(env, 'X2F_LOGIN_NAME_KEYS'));
  const legacy = env.X2F_LEGACY_SECRETS || 'on';
  if (legacy !== 'on' && legacy !== 'off') throw malformed('X2F_LEGACY_SECRETS', 'on or off');
  const legacySecrets = legacy === 'on';
  const bound = env.X2F_DEVICE_BOUND_SESSIONS || 'off';
  if (bound !== 'on' && bound !== 'off') throw malformed('X2F_DEVICE_BOUND_SESSIONS', 'on or off');
  const deviceBoundSessions = bound === 'on';
  const hasRing = (name: string) => Boolean(env[name] || env[`${name}_FILE`]);
  const jabberKeys = hasRing('X2F_JABBER_KEYS') ? parseKeyring('X2F_JABBER_KEYS', ringSource(env, 'X2F_JABBER_KEYS')) : null;
  const xmpp = parseXmpp(env);
  if (xmpp !== null && jabberKeys === null) throw missing('X2F_JABBER_KEYS');
  assertSeparate(serverKey, [
    ['X2F_PASSWORD_PEPPERS', passwordPeppers], ['X2F_RECOVERY_CODE_KEYS', recoveryCodeKeys], ['X2F_TOTP_KEYS', totpKeys],
    ['X2F_LOGIN_NAME_KEYS', loginNameKeys], ...(jabberKeys ? [['X2F_JABBER_KEYS', jabberKeys] as [string, Keyring]] : []),
  ]);

  // Task 19: Web Push needs a VAPID key pair (docs/dev-setup.md says how to make one).
  const vapidPublic = required(env, 'X2F_VAPID_PUBLIC');
  const pub = /^[A-Za-z0-9_-]{87}$/.test(vapidPublic) ? Buffer.from(vapidPublic, 'base64url') : null;
  if (!pub || pub.length !== 65 || pub[0] !== 0x04) {
    throw malformed('X2F_VAPID_PUBLIC', 'base64url of an uncompressed P-256 public key (65 bytes)');
  }
  const vapidPrivate = required(env, 'X2F_VAPID_PRIVATE');
  if (!/^[A-Za-z0-9_-]{43}$/.test(vapidPrivate) || Buffer.from(vapidPrivate, 'base64url').length !== 32) {
    throw malformed('X2F_VAPID_PRIVATE', 'base64url of a P-256 private key (32 bytes)');
  }
  if (!vapidPairMatches(vapidPublic, vapidPrivate)) throw malformed('X2F_VAPID_PUBLIC', 'not the public half of X2F_VAPID_PRIVATE');

  return {
    siteName, origins, rpId, databaseUrl, leakedListPath, serverKey, attestationDir,
    moneroNetwork, termsVersion, pgpSigningKeyPath, pgpSigningFingerprint, passwordPeppers, recoveryCodeKeys, totpKeys,
    loginNameKeys, legacySecrets, deviceBoundSessions, vapidPublic, vapidPrivate, priceSources, fxSources, jabberKeys, xmpp,
  };
}

/** A bare Jabber address: `local@domain`, lower-case ASCII, no resource. Also used for users' addresses (jabber/address.ts). */
export const BARE_JID = /^[a-z0-9._%+!#$*=?^`{|}~-]{1,64}@(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * `X2F_XMPP_SOCKS`: `[socks5h://]<IPv4>:<port>` or `[socks5h://][<IPv6>]:<port>`. Only an IP
 * address, so the proxy is reached with no DNS lookup; `socks5h` because the proxy resolves the
 * server's name (a plain `socks5://` would mean resolving it here, which is never done).
 */
function parseSocks(raw: string): { host: string; port: number } | null {
  const m = /^(?:socks5h:\/\/)?(?:([0-9.]+)|\[([0-9a-fA-F:.]+)\]):([1-9][0-9]{0,4})$/.exec(raw);
  if (!m) return null;
  const host = m[1] ?? m[2]!;
  const port = Number(m[3]);
  if (port > 65_535 || isIP(host) !== (m[1] !== undefined ? 4 : 6)) return null;
  return { host, port };
}

/**
 * `X2F_XMPP_JID` turns sending on; then `X2F_XMPP_PASSWORD` (or `_FILE`) and `X2F_XMPP_SOCKS` (the
 * Tor SOCKS5 proxy; owner ruling p11-31) are required and `X2F_XMPP_HOST` / `X2F_XMPP_PORT` are
 * optional. Without a proxy the API refuses to start. GAP (owner p5-7 build): X2F's production
 * Jabber account and server are not set up; nothing here has a default account or credential.
 */
function parseXmpp(env: Env): XmppConfig | null {
  const jid = env.X2F_XMPP_JID;
  if (jid === undefined || jid === '') {
    for (const n of ['X2F_XMPP_PASSWORD', 'X2F_XMPP_PASSWORD_FILE', 'X2F_XMPP_HOST', 'X2F_XMPP_PORT', 'X2F_XMPP_SOCKS']) {
      if (env[n]) throw malformed(n, 'set X2F_XMPP_JID too, or none of the X2F_XMPP_ settings');
    }
    return null;
  }
  if (!BARE_JID.test(jid)) throw malformed('X2F_XMPP_JID', 'a lower-case bare address such as x2f-alerts@xmpp.example.org');
  const password = ringSource(env, 'X2F_XMPP_PASSWORD').replace(/\r?\n$/, '');
  if (password === '' || password.length > 1024) throw malformed('X2F_XMPP_PASSWORD', '1 to 1024 characters');
  const host = env.X2F_XMPP_HOST || jid.slice(jid.indexOf('@') + 1);
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) throw malformed('X2F_XMPP_HOST', 'a lower-case host name');
  const rawPort = env.X2F_XMPP_PORT || '5223';
  const port = Number(rawPort);
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort) || port > 65_535) throw malformed('X2F_XMPP_PORT', '1-65535');
  if (!env.X2F_XMPP_SOCKS) throw missing('X2F_XMPP_SOCKS');
  const socks = parseSocks(env.X2F_XMPP_SOCKS);
  if (socks === null) throw malformed('X2F_XMPP_SOCKS', 'the Tor SOCKS5 proxy as an IP address and port, e.g. 127.0.0.1:9050');
  return { jid, password, host, port, socks };
}

/**
 * A purpose-bound key: HKDF-SHA-256 of `serverKey`, info `x2f/<label>`, 32 bytes. `totp` only
 * opens format-0 (pre-FU-C) sealed TOTP secrets until `rewrapTotpSecrets` has moved them.
 * `login-seal` seals the login name of a sign-up waiting in its challenge (FU-D, `sealNames`).
 * `terms-signature` seals the signature kept with an account (`sealTermsSignature`).
 */
export function subkey(
  config: Config,
  label: 'totp' | 'decoy' | 'device' | 'pgp-key' | 'pgp-start' | 'name' | 'login-seal' | 'owner-setup' | 'terms-signature',
): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', config.serverKey, new Uint8Array(0), `x2f/${label}`, 32));
}

/**
 * Startup check (R7): the official signing key must be a regular file this process can read and
 * no one else can (no group or other permission bits). Task 7's `loadPgpSigner` then checks the
 * key itself and its fingerprint.
 */
export async function assertSigningKeyFile(path: string): Promise<void> {
  const refuse = (why: string) => new Error(`config: X2F_PGP_SIGNING_KEY_PATH ${why}`);
  let info;
  try {
    info = await stat(path);
    await access(path, constants.R_OK);
  } catch {
    throw refuse('is not a readable file');
  }
  if (!info.isFile()) throw refuse('is not a regular file');
  if ((info.mode & 0o077) !== 0) throw refuse('must be readable only by the API user (chmod 600)');
}
