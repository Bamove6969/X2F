import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as openpgp from 'openpgp';
import { buildApi, type BuildOptions, type Deps } from '../../src/app.js';
import { pgpSignerFromArmored, type PgpSigner } from '../../src/auth/pgp.js';
import type { Config, Keyring } from '../../src/config.js';
import { testDb } from './db.js';
import { captureLogs } from './logs.js';

/** A one-key ring of fresh random bytes under `id`. */
export function testRing(id = 1): Keyring {
  return { current: id, keys: new Map([[id, new Uint8Array(randomBytes(32))]]) };
}

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    siteName: 'X2F',
    origins: ['https://x2f.test'],
    rpId: 'x2f.test',
    databaseUrl: 'postgres://unused',
    leakedListPath: '/nonexistent/leaked.bin',
    serverKey: new Uint8Array(randomBytes(32)),
    attestationDir: 'apps/api/data/fido-mds',
    moneroNetwork: 'stagenet',
    termsVersion: '2026-10-17',
    pgpSigningKeyPath: '/nonexistent/signing.asc',
    pgpSigningFingerprint: '0'.repeat(40),
    passwordPeppers: testRing(),
    recoveryCodeKeys: testRing(),
    totpKeys: testRing(),
    legacySecrets: true,
    ...over,
  };
}

let signer: Promise<{ signer: PgpSigner; privateArmored: string }> | undefined;

/** The stand-in for the official X2F signing key, generated once per test file run (R7). */
export function testSigner(): Promise<{ signer: PgpSigner; privateArmored: string }> {
  signer ??= (async () => {
    const k = await openpgp.generateKey({
      type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'X2F test signing key' }],
      date: new Date('2026-01-01T00:00:00Z'), format: 'armored',
    });
    const fingerprint = (await openpgp.readKey({ armoredKey: k.publicKey })).getFingerprint();
    return { signer: await pgpSignerFromArmored(k.privateKey, fingerprint), privateArmored: k.privateKey };
  })();
  return signer;
}

/** Stand-ins until the task that builds each dependency; any use fails loudly. */
function notYet<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      throw new Error(`test deps: ${what} is not built yet (${String(prop)})`);
    },
  });
}

export async function testApp(overrides: Partial<Deps> = {}, options: Omit<BuildOptions, 'logStream'> = {}): Promise<{
  app: FastifyInstance;
  deps: Deps;
  setNow(d: Date): void;
  logs: string[];
}> {
  let now = new Date('2026-10-17T12:00:00Z');
  const ownDb = overrides.db === undefined;
  const { signer: pgpSigner } = await testSigner();
  const deps: Deps = {
    config: testConfig({ pgpSigningFingerprint: pgpSigner.fingerprint }),
    db: overrides.db ?? (await testDb()),
    clock: () => now,
    leaked: notYet('leaked list (Task 6)'),
    addresses: notYet('address validator (Task 12)'),
    attestation: notYet('attestation policy (Task 8)'),
    pgpSigner,
    ...overrides,
  };
  const { stream, logs } = captureLogs();
  const app = await buildApi(deps, { ...options, logStream: stream });
  if (ownDb) app.addHook('onClose', async () => deps.db.end());
  return { app, deps, setNow: (d) => void (now = d), logs };
}
