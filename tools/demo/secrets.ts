/**
 * DEMO ONLY: makes a fresh set of throwaway secrets for one demo run into .demo/secrets (gitignored,
 * chmod 600). Nothing here is a real secret: every key is random per `npm run demo` and dies with it.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers';
import { MoneroNetworkType, MoneroWalletKeys } from 'monero-ts';
import * as openpgp from 'openpgp';
import { SECRETS_DIR } from './config.js';

export interface DemoSecrets {
  serverKey: string;
  recoveryCodeKeys: string;
  totpKeys: string;
  loginNameKeys: string;
  vapidPublic: string;
  vapidPrivate: string;
  pgpKeyPath: string;
  pgpFingerprint: string;
  modSigningPublic: string;
  modSigningSecret: string;
  modKeystoreKey: string;
  /** The API's training-id key (X2F_TRAINING_ID_KEY, base64 of 32 bytes). */
  trainingIdKey: string;
  feeWallet: string;
  /** X2F_PAYROLL_WALLET / VITE_PAYROLL_WALLET: the other half of the 1% (owner 26 Nov). */
  payrollWallet: string;
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
    // Signing only: the API refuses a signing key that can also encrypt (sign-up v2).
    subkeys: [],
    format: 'armored',
  });
  const pgpKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
  const pgpKeyPath = join(SECRETS_DIR, 'pgp-signing.asc');
  writeSecret(pgpKeyPath, privateKey);

  const mod = sodium.crypto_sign_keypair();
  const s: DemoSecrets = {
    serverKey: key32(),
    recoveryCodeKeys: ring(),
    totpKeys: ring(),
    loginNameKeys: ring(),
    vapidPublic,
    vapidPrivate,
    pgpKeyPath,
    pgpFingerprint: pgpKey.getFingerprint().toLowerCase(),
    modSigningPublic: sodium.to_hex(mod.publicKey),
    modSigningSecret: Buffer.from(mod.privateKey).toString('base64'),
    modKeystoreKey: key32(),
    trainingIdKey: key32(),
    feeWallet: await throwawayAddress(),
    payrollWallet: await throwawayAddress(),
    pgPassword: randomBytes(18).toString('base64url'),
  };
  writeSecret(join(SECRETS_DIR, 'secrets.json'), JSON.stringify(s, null, 2));
  return s;
}
