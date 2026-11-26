/**
 * Plan 3 Task 31: the whole X2F stack on this machine for the end-to-end trade specs
 * (apps/web/e2e/*.e2e.spec.ts, run by apps/web/e2e/playwright.regtest.config.ts). It lives here,
 * not in apps/web, because it hands the moderation process its secrets, which no apps/web file may
 * name (tools/separation-check.ts); apps/web/e2e/stack.ts re-exports it.
 *
 *  - monerod on regtest (tools/regtest, Plan 1's harness), with a restricted RPC port for the node proxy;
 *  - PostgreSQL in Docker (127.0.0.1 only, data on tmpfs), with the API's and the moderation's databases;
 *  - the relay with its admin listener, the node proxy, the API with its internal listener (serving the
 *    production web build, so the real CSP applies), and the moderation process (its own CLI entry).
 *
 * Every secret is random per run and dies with it. The only test-side change to any process is
 * fixed-prices.mjs, loaded into the API so the price feed never reaches the public exchanges.
 * Only apps/web/e2e (the specs) imports it; no app or package source does.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sodium from 'libsodium-wrappers';
import { MoneroNetworkType, MoneroWalletKeys } from 'monero-ts';
import * as openpgp from 'openpgp';
import pg from 'pg';
import { migrate } from '../../../apps/api/src/db/migrate.js';
import { TERMS_TEXT_VERSION } from '../../../apps/web/src/screens/setup/termsText.js';
import { startRegtest, type Regtest } from '../regtest.js';
import { prepareStaff, type StaffInfo, type StaffPrep } from './staffStack.js';

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
  /** Owner 26 Nov: the payroll wallet, paid the other half of the 1%. */
  payrollWallet: { address: string; seed: string };
  apiDatabaseUrl: string;
  modDatabaseUrl: string;
  logDir: string;
  /**
   * The moderation process's keystore key (base64), random per run. Test-only: modState.ts reads the
   * moderator's sealed party state with it, so a spec can act at a protocol step (gap 4 review M1).
   */
  modKeystoreKey: string;
  /** Plan 4 Task 21: the staff API, staff-web, the owner and the ruling gate (startStack `staff`; staffStack.ts). */
  staff?: StaffInfo;
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

/**
 * A process's start time (/proc/<pid>/stat field 22, clock ticks since boot), or null when no such
 * process runs. A pid and its start time together name one process: a reused pid has another.
 */
function startTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}

/** True while the process `pid` that started at `start` still runs (any process at `pid` when `start` is unknown). */
function alive(pid: number, start: string | undefined): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  const now = startTime(pid);
  return now !== null && (start === undefined || start === '' || now === start);
}

interface Started {
  pid: number;
  start: string;
}

/**
 * What a run owns, written to `<work>/owner.json` as it starts things, so a later run can clean up
 * after one that died by SIGKILL (no exit handler ran): the owning process, its detached process
 * groups, monerod and monerod's data dir.
 */
interface Owner extends Started {
  groups: Started[];
  monerod: (Started & { dataDir: string }) | null;
}

const OWNER_FILE = 'owner.json';
const ME: Started = { pid: process.pid, start: startTime(process.pid) ?? '' };

/**
 * Removes what earlier runs left when they died without cleaning up: the `x2f-e2e` containers, the
 * process groups and monerod named in each `.regtest/e2e-*` work dir's owner.json, and those work
 * dirs. Only a run whose owning process is gone is touched (pid and start time), so a run still
 * going on this machine keeps everything; a process is killed only if its pid still has the start
 * time recorded for it.
 */
export function sweepStale(): string[] {
  const swept: string[] = [];
  let rows: string[] = [];
  try {
    rows = execFileSync('docker', ['ps', '-a', '--filter', 'label=x2f-e2e', '--format', '{{.Names}}\t{{.Label "x2f-e2e"}}\t{{.Label "x2f-e2e-start"}}'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    // no docker: startStack fails on its own below
  }
  for (const row of rows) {
    const [name, pid, start] = row.split('\t');
    if (!name || alive(Number(pid), start)) continue;
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      swept.push(`container ${name}`);
    } catch {
      // gone meanwhile
    }
  }
  const base = join(ROOT, '.regtest');
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('e2e-')) : [];
  for (const d of dirs) {
    const work = join(base, d);
    let owner: Owner;
    try {
      owner = JSON.parse(readFileSync(join(work, OWNER_FILE), 'utf8')) as Owner;
    } catch {
      continue; // not a work dir (e2e-logs, e2e-results), or one still being made
    }
    if (alive(owner.pid, owner.start)) continue;
    for (const g of owner.groups) {
      if (!alive(g.pid, g.start)) continue;
      try {
        process.kill(-g.pid, 'SIGKILL');
        swept.push(`process group ${g.pid}`);
      } catch {
        // gone
      }
    }
    if (owner.monerod) {
      if (alive(owner.monerod.pid, owner.monerod.start)) {
        try {
          process.kill(owner.monerod.pid, 'SIGKILL');
          swept.push(`monerod ${owner.monerod.pid}`);
        } catch {
          // gone
        }
      }
      rmSync(owner.monerod.dataDir, { recursive: true, force: true });
    }
    rmSync(work, { recursive: true, force: true });
    swept.push(`work dir ${d}`);
  }
  return swept;
}

/** Every started process group, killed when this process ends however it ends (as tools/regtest does for monerod). */
const groups = new Set<number>();
let containerName: string | null = null;
/** This run's work dir (secrets, the web build), removed when this process ends however it ends. */
let workDir: string | null = null;
let monerod: Owner['monerod'] = null;

function writeOwner(): void {
  if (!workDir) return;
  const owner: Owner = { ...ME, groups: [...groups].map((pid) => ({ pid, start: startTime(pid) ?? '' })), monerod };
  writeFileSync(join(workDir, OWNER_FILE), JSON.stringify(owner));
}

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
  if (workDir) rmSync(workDir, { recursive: true, force: true });
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
  if (child.pid !== undefined) {
    groups.add(child.pid);
    writeOwner();
  }
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
  writeOwner();
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
  const payroll = await MoneroWalletKeys.createWallet({ networkType: MoneroNetworkType.MAINNET });
  const payrollWallet = { address: await payroll.getPrimaryAddress(), seed: await payroll.getSeed() };
  await payroll.close();
  return {
    serverKey: key32(),
    trainingIdKey: key32(),
    passwordPeppers: ring(),
    recoveryCodeKeys: ring(),
    totpKeys: ring(),
    loginNameKeys: ring(),
    ticketKeys: ring(),
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
    payrollWallet,
    pgPassword: randomBytes(18).toString('base64url'),
  };
}

export async function startStack(o: { logDir: string; staff?: boolean }): Promise<Stack> {
  const logDir = o.logDir;
  mkdirSync(logDir, { recursive: true });
  for (const what of sweepStale()) console.log(`stack: removed ${what} left by an earlier run`);
  mkdirSync(join(ROOT, '.regtest'), { recursive: true });
  const work = mkdtempSync(join(ROOT, '.regtest', 'e2e-'));
  workDir = work;
  writeOwner();
  const secretsDir = join(work, 'secrets');
  mkdirSync(secretsDir, { mode: 0o700 });
  const webDist = join(work, 'web');
  const procs: Proc[] = [];
  let chain: Regtest | null = null;
  const container = `x2f-e2e-${process.pid}`;
  containerName = container;
  let staffPrep: StaffPrep | null = null;

  const stop = async () => {
    for (const p of [...procs].reverse()) await stopProc(p);
    await staffPrep?.close();
    await chain?.stop();
    monerod = null;
    try {
      execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    } catch {
      // not running
    }
    containerName = null;
    rmSync(work, { recursive: true, force: true });
    workDir = null;
  };

  try {
    const s = await makeSecrets(secretsDir);

    // ── PostgreSQL ──
    execFileSync('docker', ['run', '-d', '--name', container, '--label', `x2f-e2e=${process.pid}`, '--label', `x2f-e2e-start=${ME.start}`, '-p', `${HOST}::5432`,
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
    monerod = { pid: chain.pid, start: startTime(chain.pid) ?? '', dataDir: chain.dataDir };
    writeOwner();

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
        VITE_PAYROLL_WALLET: s.payrollWallet.address,
        VITE_RELAY_URL: relayUrl,
        VITE_NODE_PROXY_URL: proxyUrl,
        // The payment proof screens (Plan 5 Task 15), which Plan 5 Task 17's specs use. Off in a
        // default build until the lead turns them on; with them on, I've paid without a proof asks
        // "Mark paid without proof?" first (tradeFlow.markPaid answers it).
        VITE_X2F_PROOF_UPLOAD: '1',
      },
    });

    // ── the staff side (Plan 4 Task 21), when asked for: built and fronted before the API starts ──
    if (o.staff) staffPrep = await prepareStaff({ root: ROOT, work, logDir, modSigningPublic: s.modSigningPublic });

    // Plan 5 Task 17: the smart proof card reads the buyer's screenshot with the self-hosted OCR
    // under /ocr/ (Task 13). The build copies those files (vite.config.ts `ocrAssets`); the copy the
    // API serves must be exactly the pinned set (tools/ocr-assets.sha256), checked here once.
    // (Read here, not through tools/copy-ocr-assets.ts: its top-level await makes it ESM-only, which
    // Playwright's loader cannot require.)
    const pinned = readFileSync(join(ROOT, 'tools/ocr-assets.sha256'), 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#')).map((l) => l.trim().split(/\s+/));
    const served = readdirSync(join(webDist, 'ocr')).sort();
    if (served.join() !== pinned.map(([, name]) => name).sort().join()) throw new Error(`stack: the build's /ocr/ holds ${served.join(', ')}, not the pinned set`);
    for (const [hash, name] of pinned) {
      if (createHash('sha256').update(readFileSync(join(webDist, 'ocr', name!))).digest('hex') !== hash) throw new Error(`stack: the build's /ocr/${name} differs from tools/ocr-assets.sha256`);
    }

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
      X2F_TICKET_KEYS: s.ticketKeys,
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
      ...staffPrep?.apiEnv,
    }, [fileURLToPath(new URL('./fixed-prices.mjs', import.meta.url))]));
    await waitFor('the API', async () => (await fetch(`${origin}/v1/site`)).status < 500, procs);
    // ...and served with the OCR worker's own CSP (static/serve.ts `ocrWorkerCspFor`), or the card
    // could only ever say it could not read the screenshot.
    for (const file of ['worker.min.js', 'eng.traineddata.gz']) {
      const r = await fetch(`${origin}/ocr/${file}`);
      await r.arrayBuffer();
      if (!r.ok || !(r.headers.get('content-security-policy') ?? '').includes(`connect-src ${origin}/ocr/`)) {
        throw new Error(`stack: /ocr/${file} is not served with the OCR worker CSP (${r.status})`);
      }
    }
    await waitFor('the node proxy', async () => (await fetch(`${proxyUrl}/get_info`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).ok, procs);

    // The owner is set up and pinned into a new ruling gate before the moderation process starts.
    const staffUp = staffPrep ? await staffPrep.afterApi({ apiDatabaseUrl: pgUrl('x2f'), modKeystoreKey: s.modKeystoreKey }) : null;

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
      X2F_PAYROLL_WALLET: s.payrollWallet.address,
      ...staffUp?.modEnv,
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
      payrollWallet: s.payrollWallet,
      apiDatabaseUrl: pgUrl('x2f'),
      modDatabaseUrl: pgUrl('x2f_moderation'),
      logDir,
      modKeystoreKey: s.modKeystoreKey,
      ...(staffUp ? { staff: staffUp.info } : {}),
    };
    return { ...info, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
