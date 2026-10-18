import { hkdfSync } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';

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
}

type Env = Record<string, string | undefined>;

const NETWORKS = ['mainnet', 'stagenet', 'testnet'] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// Errors name the variable only, never its value (DATABASE_URL and X2F_SERVER_KEY are secrets).
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

  return {
    siteName, origins, rpId, databaseUrl, leakedListPath, serverKey, attestationDir,
    moneroNetwork, termsVersion, pgpSigningKeyPath, pgpSigningFingerprint,
  };
}

/** A purpose-bound key: HKDF-SHA-256 of `serverKey`, info `x2f/<label>`, 32 bytes. */
export function subkey(config: Config, label: 'totp' | 'decoy' | 'device' | 'pgp-key' | 'pgp-start'): Uint8Array {
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
