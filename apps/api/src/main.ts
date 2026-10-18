import { LISTEN_OPTIONS, buildApi, type Deps } from './app.js';
import { fileAttestationPolicy } from './auth/attestation.js';
import { purgeExpired } from './auth/challenges.js';
import { openLeakedList } from './auth/leaked.js';
import { assertSigningKeyFile, loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { startRetention, type RetentionJob } from './retention.js';

/** A dependency whose task has not landed yet: any use fails loudly instead of misbehaving. */
function notBuilt<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      throw new Error(`${what} is not built yet`);
    },
  });
}

function port(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8080;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) throw new Error('config: X2F_PORT is malformed (1-65535)');
  return n;
}

const config = loadConfig(process.env);
await assertSigningKeyFile(config.pgpSigningKeyPath);

// Task 8: the FIDO metadata snapshot, loaded before listening (no network fetch).
const attestation = fileAttestationPolicy(config.attestationDir);
await attestation.init();

const db = createPool(config.databaseUrl);
const deps: Deps = {
  config,
  db,
  clock: () => new Date(),
  // TODO(Tasks 12, 7): moneroAddressValidator, loadPgpSigner.
  leaked: await openLeakedList(config.leakedListPath),
  addresses: notBuilt('address validator (Task 12)'),
  attestation,
  pgpSigner: notBuilt('PGP signer (Task 7)'),
};

// Plan 2 registers purgeExpired (Task 4) and purgeRemovedWalletAddresses (Task 12); Plans 3 and 4 add theirs.
const jobs: RetentionJob[] = [purgeExpired];
const stopRetention = startRetention(deps, jobs);

const app = await buildApi(deps);
await app.listen({ ...LISTEN_OPTIONS, host: process.env.X2F_HOST || '127.0.0.1', port: port(process.env.X2F_PORT) });

const shutdown = async () => {
  await stopRetention(); // lets a purge in flight finish before the pool closes
  await app.close();
  await db.end();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
