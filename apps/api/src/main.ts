import { LISTEN_OPTIONS, buildApi, type Deps } from './app.js';
import { fileAttestationPolicy } from './auth/attestation.js';
import { purgeExpired } from './auth/challenges.js';
import { openLeakedList } from './auth/leaked.js';
import { decoyPrivateKeys, loadPgpSigner } from './auth/pgp.js';
import { assertSigningKeyFile, loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { PRICE_FEED_DEFAULTS, createPriceFeed } from './price/feed.js';
import { priceSources } from './price/sources.js';
import { startRetention, type RetentionJob } from './retention.js';
import { serveWeb, webOptionsFromEnv } from './static/serve.js';
import { moneroAddressValidator } from './wallets/address.js';
import { purgeRemovedWalletAddresses } from './wallets/routes.js';

function port(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8080;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) throw new Error('config: X2F_PORT is malformed (1-65535)');
  return n;
}

const config = loadConfig(process.env);
// Serves apps/web/dist on this origin when X2F_WEB_ROOT is set (with X2F_RELAY_ORIGIN and X2F_NODE_PROXY_ORIGIN for the CSP;
// http/ws origins only on loopback unless X2F_ALLOW_INSECURE_ORIGINS=1).
const web = webOptionsFromEnv(process.env);
await assertSigningKeyFile(config.pgpSigningKeyPath);
// R7: refuses a public-only or passphrase-protected key and a fingerprint other than
// X2F_PGP_SIGNING_FINGERPRINT; the process exits before listening.
const pgpSigner = await loadPgpSigner(config.pgpSigningKeyPath, config.pgpSigningFingerprint);
// R18: the decoy key pool (includes an RSA-4096 key) is made before the first request.
await decoyPrivateKeys();

// Task 8: the FIDO metadata snapshot, loaded before listening (no network fetch).
const attestation = fileAttestationPolicy(config.attestationDir);
await attestation.init();

const db = createPool(config.databaseUrl);
// Plan 3 Task 3: median of the PRICE_SOURCES (spec 11.6), polled every minute.
const clock = () => new Date();
const prices = createPriceFeed(priceSources(config.priceSources), { ...PRICE_FEED_DEFAULTS, clock });
const deps: Deps = {
  config,
  db,
  clock,
  leaked: await openLeakedList(config.leakedListPath),
  // Task 12: loads monero-ts's WebAssembly keys module before listening.
  addresses: await moneroAddressValidator(config.moneroNetwork),
  attestation,
  pgpSigner,
  prices,
};

// Plan 2 registers purgeExpired (Task 4) and purgeRemovedWalletAddresses (Task 12); Plans 3 and 4 add theirs.
const jobs: RetentionJob[] = [purgeExpired, purgeRemovedWalletAddresses];
const stopRetention = startRetention(deps, jobs);

const app = await buildApi(deps);
prices.start();
if (web) await serveWeb(app, web);
await app.listen({ ...LISTEN_OPTIONS, host: process.env.X2F_HOST || '127.0.0.1', port: port(process.env.X2F_PORT) });

const shutdown = async () => {
  await stopRetention(); // lets a purge in flight finish before the pool closes
  await prices.stop();
  await app.close();
  await db.end();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
