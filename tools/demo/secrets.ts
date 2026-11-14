/**
 * DEMO ONLY: makes a fresh set of throwaway secrets for one demo run into .demo/secrets (gitignored,
 * chmod 600). Nothing here is a real secret: every key is random per `npm run demo` and dies with it.
 */
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers';
import { MoneroNetworkType, MoneroWalletKeys } from 'monero-ts';
import * as openpgp from 'openpgp';
import { SECRETS_DIR } from './config.js';

export interface DemoSecrets {
  serverKey: string;
  passwordPeppers: string;
  recoveryCodeKeys: string;
  totpKeys: string;
  loginNameKeys: string;
  vapidPublic: string;
  vapidPrivate: string;
  pgpKeyPath: string;
  pgpFingerprint: string;
  leakedListPath: string;
  modSigningPublic: string;
  modSigningSecret: string;
  modKeystoreKey: string;
  feeWallet: string;
  pgPassword: string;
}

const key32 = (): string => randomBytes(32).toString('base64');
const ring = (): string => `1:${key32()}`;

function writeSecret(path: string, data: string | Uint8Array): void {
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** A mainnet-format address (regtest uses the mainnet format) whose keys are thrown away. */
export async function throwawayAddress(): Promise<string> {
  const w = await MoneroWalletKeys.createWallet({ networkType: MoneroNetworkType.MAINNET });
  const a = await w.getPrimaryAddress();
  await w.close();
  return a;
}

export async function makeSecrets(): Promise<DemoSecrets> {
  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  await sodium.ready;

  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const vapidPublic = ecdh.getPublicKey().toString('base64url');
  const vapidPrivate = ecdh.getPrivateKey().toString('base64url');

  const { privateKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'ed25519Legacy',
    userIDs: [{ name: 'X2F demo signing key (not real)' }],
    format: 'armored',
  });
  const pgpKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
  const pgpKeyPath = join(SECRETS_DIR, 'pgp-signing.asc');
  writeSecret(pgpKeyPath, privateKey);

  // The leaked-password list: sorted 20-byte SHA-1 records; one entry is enough for the demo.
  const leakedListPath = join(SECRETS_DIR, 'leaked.bin');
  writeSecret(leakedListPath, createHash('sha1').update('password').digest());

  const mod = sodium.crypto_sign_keypair();
  const s: DemoSecrets = {
    serverKey: key32(),
    passwordPeppers: ring(),
    recoveryCodeKeys: ring(),
    totpKeys: ring(),
    loginNameKeys: ring(),
    vapidPublic,
    vapidPrivate,
    pgpKeyPath,
    pgpFingerprint: pgpKey.getFingerprint().toLowerCase(),
    leakedListPath,
    modSigningPublic: sodium.to_hex(mod.publicKey),
    modSigningSecret: Buffer.from(mod.privateKey).toString('base64'),
    modKeystoreKey: key32(),
    feeWallet: await throwawayAddress(),
    pgPassword: randomBytes(18).toString('base64url'),
  };
  writeSecret(join(SECRETS_DIR, 'secrets.json'), JSON.stringify(s, null, 2));
  return s;
}
