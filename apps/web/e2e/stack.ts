/**
 * Plan 3 Task 31: the whole X2F stack on this machine for the end-to-end trade specs
 * (trade.e2e.spec.ts, run by playwright.regtest.config.ts).
 *
 *  - monerod on regtest (tools/regtest, Plan 1's harness), with a restricted RPC port for the node proxy;
 *  - PostgreSQL in Docker (127.0.0.1 only, data on tmpfs), with the API's and the moderation's databases;
 *  - the relay with its admin listener, the node proxy, the API with its internal listener (serving the
 *    production web build, so the real CSP applies), and the moderation process (its own CLI entry).
 *
 * Every secret is random per run and dies with it. The only test-side change to any process is
 * fixed-prices.mjs, loaded into the API so the price feed never reaches the public exchanges.
 * Nothing here is imported by apps/* or packages/*.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sodium from 'libsodium-wrappers';
import { MoneroNetworkType, MoneroWalletKeys } from 'monero-ts';
import * as openpgp from 'openpgp';
import pg from 'pg';
import { migrate } from '../../api/src/db/migrate.js';
import { TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
import { startRegtest, type Regtest } from '../../../tools/regtest/regtest.js';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PG_IMAGE = 'postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const HOST = '127.0.0.1';

/** What the specs need to reach the stack (passed to the workers as JSON in X2F_E2E_STACK). */
export interface StackInfo {
  /** The web app's origin (the API serves the build): http://localhost:<port>. */
  origin: string;
  /** monerod's unrestricted RPC (mining, test wallets). */
  monerod: string;
  /** The fee wallet: its address is X2F's fee address; its keys let a spec read what it received. */
  feeWallet: { address: string; seed: string };
  apiDatabaseUrl: string;
  modDatabaseUrl: string;
  logDir: string;
  /**
   * Whether the production build itself serves monero-ts's wallet worker at /monero.worker.js.
   * KNOWN GAP (Task 12, found by the demo 8 Nov, fix f7a28d2a on wip/lead-demo-r4, never landed):
   * it does not, so every escrow wallet fails to start in a real browser. When it is missing the
   * stack copies monero-ts's own file there, so the trade specs can run past escrow set-up, and the
   * first spec stays red on this flag until the build serves it.
   */
  buildServesMoneroWorker: boolean;
}

export interface Stack extends StackInfo {
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const a = srv.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

async function waitFor(what: string, check: () => Promise<boolean>, procs: Proc[], timeoutMs = 180_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const p of procs) {
      if (p.child.exitCode !== null) throw new Error(`stack: ${p.name} exited (${p.child.exitCode}) while waiting for ${what}; see ${p.log}`);
    }
    try {
      if (await check()) return;
    } catch {
      // not yet
    }
    await sleep(500);
  }
  throw new Error(`stack: ${what} did not come up within ${timeoutMs / 1000} s`);
}

interface Proc {
  name: string;
  child: ChildProcess;
  log: string;
}

/** Every started process group, killed when this process ends however it ends (as tools/regtest does for monerod). */
const groups = new Set<number>();
let containerName: string | null = null;
function killAll(): void {
  for (const pid of groups) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
  if (containerName) {
    try {
      execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    } catch {
      // gone
    }
  }
}
process.on('exit', killAll);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    killAll();
    process.kill(process.pid, sig);
  });
}

function startTs(logDir: string, name: string, file: string, env: Record<string, string>, imports: string[] = []): Proc {
  const log = join(logDir, `${name}.log`);
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', ...imports.flatMap((i) => ['--import', i]), file], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    // A clean environment: PATH and HOME, plus what the process needs.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
  if (child.pid !== undefined) groups.add(child.pid);
  return { name, child, log };
}

async function stopProc(p: Proc): Promise<void> {
  if (p.child.exitCode !== null || p.child.signalCode !== null || p.child.pid === undefined) return;
  const gone = new Promise<void>((r) => p.child.once('exit', () => r()));
  try {
    process.kill(-p.child.pid, 'SIGTERM');
  } catch {
    return;
  }
  const t = setTimeout(() => {
    try {
      process.kill(-p.child.pid!, 'SIGKILL');
    } catch {
      // gone
    }
  }, 10_000);
  await gone;
  clearTimeout(t);
  groups.delete(p.child.pid);
}

/** Throwaway secrets for one run, in `dir` (chmod 600). */
async function makeSecrets(dir: string) {
  await sodium.ready;
  const key32 = () => randomBytes(32).toString('base64');
  const ring = () => `1:${key32()}`;
  const write = (name: string, data: string | Uint8Array) => {
    const p = join(dir, name);
    writeFileSync(p, data, { mode: 0o600 });
    chmodSync(p, 0o600);
    return p;
  };
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const { privateKey } = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'X2F e2e signing key (not real)' }], subkeys: [], format: 'armored' });
  const pgpKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
  const mod = sodium.crypto_sign_keypair();
  const fee = await MoneroWalletKeys.createWallet({ networkType: MoneroNetworkType.MAINNET });
  const feeWallet = { address: await fee.getPrimaryAddress(), seed: await fee.getSeed() };
  await fee.close();
  return {
    serverKey: key32(),
    trainingIdKey: key32(),
    passwordPeppers: ring(),
    recoveryCodeKeys: ring(),
    totpKeys: ring(),
    loginNameKeys: ring(),
    vapidPublic: ecdh.getPublicKey().toString('base64url'),
    vapidPrivate: ecdh.getPrivateKey().toString('base64url'),
    pgpKeyPath: write('pgp-signing.asc', privateKey),
    pgpFingerprint: pgpKey.getFingerprint().toLowerCase(),
    // Sorted 20-byte SHA-1 records; one entry is enough.
    leakedListPath: write('leaked.bin', createHash('sha1').update('password').digest()),
    modSigningPublic: sodium.to_hex(mod.publicKey),
    modSigningSecret: Buffer.from(mod.privateKey).toString('base64'),
    modKeystoreKey: key32(),
    feeWallet,
    pgPassword: randomBytes(18).toString('base64url'),
  };
}

export async function startStack(o: { logDir: string }): Promise<Stack> {
  const logDir = o.logDir;
  mkdirSync(logDir, { recursive: true });
  const work = mkdtempSync(join(ROOT, '.regtest', 'e2e-'));
  const secretsDir = join(work, 'secrets');
  mkdirSync(secretsDir, { mode: 0o700 });
  const webDist = join(work, 'web');
  const procs: Proc[] = [];
  let chain: Regtest | null = null;
  const container = `x2f-e2e-${process.pid}`;
  containerName = container;

  const stop = async () => {
    for (const p of [...procs].reverse()) await stopProc(p);
    await chain?.stop();
    try {
      execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    } catch {
      // not running
    }
    containerName = null;
    rmSync(work, { recursive: true, force: true });
  };

  try {
    const s = await makeSecrets(secretsDir);

    // ── PostgreSQL ──
    execFileSync('docker', ['run', '-d', '--name', container, '--label', `x2f-e2e=${process.pid}`, '-p', `${HOST}::5432`,
      '-e', `POSTGRES_PASSWORD=${s.pgPassword}`, '--tmpfs', '/var/lib/postgresql/data', PG_IMAGE], { stdio: 'ignore' });
    const pgPort = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0]!.split(':').pop()!;
    const pgUrl = (db: string) => `postgres://postgres:${s.pgPassword}@${HOST}:${pgPort}/${db}`;
    await waitFor('PostgreSQL', async () => {
      const c = new pg.Client({ connectionString: pgUrl('postgres') });
      await c.connect();
      await c.end();
      return true;
    }, procs);
    {
      const c = new pg.Client({ connectionString: pgUrl('postgres') });
      await c.connect();
      await c.query('create database x2f');
      await c.query('create database x2f_moderation');
      await c.end();
      const pool = new pg.Pool({ connectionString: pgUrl('x2f') });
      await migrate(pool);
      await pool.end();
    }

    // ── monerod (regtest) ──
    chain = await startRegtest({ restrictedRpc: true });

    // ── ports, then the web build (it carries the relay and node proxy URLs) ──
    const ports = { api: await freePort(), internal: await freePort(), relay: await freePort(), relayAdmin: await freePort(), proxy: await freePort() };
    const origin = `http://localhost:${ports.api}`;
    const relayUrl = `ws://${HOST}:${ports.relay}`;
    const proxyUrl = `http://${HOST}:${ports.proxy}`;
    execFileSync(process.execPath, [join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'), 'build', '--outDir', webDist, '--emptyOutDir', '--logLevel', 'warn'], {
      cwd: join(ROOT, 'apps/web'),
      stdio: ['ignore', openSync(join(logDir, 'web-build.log'), 'a'), openSync(join(logDir, 'web-build.log'), 'a')],
      env: {
        ...process.env,
        VITE_MONERO_NETWORK: 'regtest',
        VITE_MOD_SIGNING_PUBLIC: s.modSigningPublic,
        VITE_FEE_WALLET: s.feeWallet.address,
        VITE_RELAY_URL: relayUrl,
        VITE_NODE_PROXY_URL: proxyUrl,
      },
    });

    // At the root (monero-ts's default path) or bundled as an asset (the demo's fix).
    const buildServesMoneroWorker = readdirSync(webDist, { recursive: true }).some((f) => String(f).includes('monero.worker'));
    if (!buildServesMoneroWorker) copyFileSync(join(ROOT, 'node_modules/monero-ts/dist/monero.worker.js'), join(webDist, 'monero.worker.js'));

    // ── services ──
    procs.push(startTs(logDir, 'relay', 'apps/relay/src/main.ts', {
      RELAY_MOD_SIGNING_PUBLIC: s.modSigningPublic, RELAY_HOST: HOST, RELAY_PORT: String(ports.relay), RELAY_ADMIN_HOST: HOST, RELAY_ADMIN_PORT: String(ports.relayAdmin),
    }));
    procs.push(startTs(logDir, 'node-proxy', 'apps/node-proxy/src/main.ts', {
      NODE_PROXY_UPSTREAM: chain.restrictedRpcUri!, NODE_PROXY_WEB_ORIGIN: origin, NODE_PROXY_HOST: HOST, NODE_PROXY_PORT: String(ports.proxy),
    }));
    procs.push(startTs(logDir, 'api', 'apps/api/src/main.ts', {
      X2F_SITE_NAME: 'X2F',
      X2F_ORIGINS: origin,
      X2F_RP_ID: 'localhost',
      DATABASE_URL: pgUrl('x2f'),
      X2F_LEAKED_LIST_PATH: s.leakedListPath,
      X2F_SERVER_KEY: s.serverKey,
      // Required with the mainnet address format (config.ts); its own random key.
      X2F_TRAINING_ID_KEY: s.trainingIdKey,
      X2F_ATTESTATION_DIR: join(ROOT, 'apps/api/data/fido-mds'),
      // Regtest uses the mainnet address format; the node itself is --regtest --offline.
      X2F_MONERO_NETWORK: 'mainnet',
      X2F_TERMS_VERSION: TERMS_TEXT_VERSION,
      X2F_PGP_SIGNING_KEY_PATH: s.pgpKeyPath,
      X2F_PGP_SIGNING_FINGERPRINT: s.pgpFingerprint,
      X2F_PASSWORD_PEPPERS: s.passwordPeppers,
      X2F_RECOVERY_CODE_KEYS: s.recoveryCodeKeys,
      X2F_TOTP_KEYS: s.totpKeys,
      X2F_LOGIN_NAME_KEYS: s.loginNameKeys,
      X2F_VAPID_PUBLIC: s.vapidPublic,
      X2F_VAPID_PRIVATE: s.vapidPrivate,
      X2F_HOST: HOST,
      X2F_PORT: String(ports.api),
      X2F_WEB_ROOT: webDist,
      X2F_RELAY_ORIGIN: relayUrl,
      X2F_NODE_PROXY_ORIGIN: proxyUrl,
      X2F_MOD_SIGNING_PUBLIC: s.modSigningPublic,
      X2F_INTERNAL_HOST: HOST,
      X2F_INTERNAL_PORT: String(ports.internal),
      X2F_MONEROD_URL: chain.restrictedRpcUri!,
      PRICE_SOURCES: 'kraken,bitfinex,coingecko',
      FX_SOURCES: 'coinbase',
    }, [fileURLToPath(new URL('./fixed-prices.mjs', import.meta.url))]));
    await waitFor('the API', async () => (await fetch(`${origin}/v1/site`)).status < 500, procs);
    await waitFor('the node proxy', async () => (await fetch(`${proxyUrl}/get_info`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).ok, procs);

    procs.push(startTs(logDir, 'moderation', 'apps/moderation/src/main.ts', {
      MOD_DATABASE_URL: pgUrl('x2f_moderation'),
      MOD_KEYSTORE_KEY: s.modKeystoreKey,
      MOD_SIGNING_SECRET: s.modSigningSecret,
      X2F_API_INTERNAL_URL: `http://${HOST}:${ports.internal}`,
      RELAY_ADMIN_URL: `http://${HOST}:${ports.relayAdmin}`,
      RELAY_URL: relayUrl,
      MONERO_DAEMON_URI: chain.rpcUri,
      MONERO_NETWORK: 'regtest',
      X2F_FEE_WALLET: s.feeWallet.address,
    }));
    // The moderation process migrates its database, takes its instance lock, then pulls
    // /internal/v1/work every 5 s. It logs only failures (work-unavailable when a pull fails), so
    // it is up once it has lived through two pulls with none.
    const mod = procs.at(-1)!;
    const modLog = () => (existsSync(mod.log) ? readFileSync(mod.log, 'utf8') : '');
    await sleep(12_000);
    if (mod.child.exitCode !== null || /work-unavailable|watch-pass-failed|level":50/.test(modLog())) {
      throw new Error(`stack: the moderation process did not start or cannot reach the API's internal listener; see ${mod.log}`);
    }

    const info: StackInfo = {
      origin,
      monerod: chain.rpcUri,
      feeWallet: s.feeWallet,
      apiDatabaseUrl: pgUrl('x2f'),
      modDatabaseUrl: pgUrl('x2f_moderation'),
      logDir,
      buildServesMoneroWorker,
    };
    return { ...info, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
