/**
 * Plan 4 Task 21: the staff half of the regtest stack (stack.ts, `startStack({ staff: true })`):
 *
 *  - the staff API (the API process's second listener, X2F_STAFF_*) serving the production staff
 *    build, behind a TLS front on https://localhost:<port> (the moderation gate takes an https staff
 *    origin only; Chromium accepts the self-signed certificate with ignoreHTTPSErrors);
 *  - FIDO metadata holding only the test CA's key (softKey.ts), for the API and the gate;
 *  - the owner, set up through the staff API's own setup routes with two soft security keys and a
 *    PGP key, reading the one-time setup code from the API's stderr as the operator would;
 *  - the moderation process's internal API (a Unix socket the API reaches) and its ruling gate:
 *    a new gate made with `init-gate` and the owner's keys pinned with `pin-owner` (both CLIs, fed
 *    "yes"), before the moderation process starts.
 *
 * Kept apart from stack.ts so the trade-only stack stays as it was; stack.ts calls these functions
 * when `staff` is set. Every secret is random per run and dies with the run's work dir.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { connect, createServer as createTcpServer } from 'node:net';
import { join } from 'node:path';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import pg from 'pg';
import { addKey, newPgp, pgpCode, StaffClient, type PgpPair } from './staffClient.js';
import { localhostTls, newCa, newKey, writeMds, type CaData, type KeyData } from './softKey.js';

const HOST = '127.0.0.1';

/** What the dispute specs need of the staff side (part of StackInfo, as JSON). */
export interface StaffInfo {
  /** The staff origin the browsers use: https://localhost:<tls port>. */
  origin: string;
  /** The staff API's own listener, for Node clients (they send `origin` as their Origin). */
  api: string;
  /** The test attestation CA: new staff keys are registered with it. */
  ca: CaData;
  owner: { accountId: string; displayName: string; loginName: string; keys: KeyData[]; pgp: PgpPair };
}

export interface StaffPrep {
  /** The API process's extra settings (the staff listener, the moderation socket, the test metadata). */
  apiEnv: Record<string, string>;
  /** Once the API is up: sets up the owner, makes the gate and pins the owner. Returns the moderation process's extra settings. */
  afterApi(o: { apiDatabaseUrl: string; modKeystoreKey: string }): Promise<{ modEnv: Record<string, string>; info: StaffInfo }>;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createTcpServer();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const a = srv.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

/** TLS on `port`, every connection piped to the plain listener on `target` (no HTTP parsing). */
async function tlsFront(port: number, target: number): Promise<{ server: TlsServer; close(): Promise<void> }> {
  const tls = localhostTls();
  const open = new Set<{ destroy(): void }>();
  const srv = createTlsServer({ cert: tls.cert, key: tls.key }, (sock) => {
    const up = connect(target, HOST);
    open.add(sock);
    open.add(up);
    const end = () => {
      sock.destroy();
      up.destroy();
      open.delete(sock);
      open.delete(up);
    };
    sock.on('close', end);
    up.on('close', end);
    sock.on('error', end);
    up.on('error', end);
    sock.pipe(up).pipe(sock);
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, HOST, () => resolve());
  });
  return {
    server: srv,
    close: async () => {
      for (const s of open) s.destroy();
      await new Promise<void>((r) => srv.close(() => r()));
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs one of the moderation CLIs (apps/moderation/src/cli) with `env`, answering its question "yes". */
async function runCli(root: string, logDir: string, name: string, env: Record<string, string>): Promise<string> {
  const log = join(logDir, `${name}.log`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', `apps/moderation/src/cli/${name}.ts`], {
      cwd: root,
      stdio: ['pipe', 'pipe', openSync(log, 'a')],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    });
    let out = '';
    let answered = false;
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      // Answered once the question is asked (readline closes on an input that ended before it).
      if (!answered && /Type yes/.test(out)) {
        answered = true;
        child.stdin!.end('yes\n');
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`stack: ${name} exited ${code}: ${out.trim()} (see ${log})`))));
  });
}

export async function prepareStaff(o: { root: string; work: string; logDir: string; modSigningPublic: string }): Promise<StaffPrep> {
  // The API's log is appended to across runs: only what this run's API writes counts.
  const apiLog = join(o.logDir, 'api.log');
  const apiLogFrom = existsSync(apiLog) ? statSync(apiLog).size : 0;
  const ports = { staff: await freePort(), tls: await freePort() };
  const origin = `https://localhost:${ports.tls}`;
  const api = `http://${HOST}:${ports.staff}`;
  const ca = newCa();
  const mdsDir = join(o.work, 'fido-mds');
  await writeMds(mdsDir, ca);
  const socket = join(o.work, 'mod-internal.sock');
  const internalSecret = randomBytes(32).toString('base64');
  const stateDir = join(o.work, 'mod-state');
  mkdirSync(stateDir, { mode: 0o700 });

  // The production staff build, pinned to this run's moderation signing key.
  const staffDist = join(o.work, 'staff-web');
  const buildLog = join(o.logDir, 'staff-web-build.log');
  execFileSync(process.execPath, [join(o.root, 'apps/staff-web/node_modules/vite/bin/vite.js'), 'build', '--outDir', staffDist, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: join(o.root, 'apps/staff-web'),
    stdio: ['ignore', openSync(buildLog, 'a'), openSync(buildLog, 'a')],
    env: { ...process.env, VITE_MOD_SIGNING_PUBLIC: o.modSigningPublic },
  });

  const front = await tlsFront(ports.tls, ports.staff);

  const apiEnv = {
    X2F_STAFF_ORIGIN: origin,
    X2F_STAFF_RP_ID: 'localhost',
    X2F_STAFF_HOST: HOST,
    X2F_STAFF_PORT: String(ports.staff),
    X2F_STAFF_WEB_ROOT: staffDist,
    MOD_INTERNAL_SOCKET: socket,
    MOD_INTERNAL_SECRET: internalSecret,
    // Only the test CA's key is a known hardware key on this stack (staff and owner allowlists).
    X2F_ATTESTATION_DIR: mdsDir,
  };

  return {
    apiEnv,
    async afterApi(a) {
      const staff = new StaffClient(api, origin);
      // The one line the API writes with the setup code (stderr, never the structured log).
      let code: string | null = null;
      for (let i = 0; i < 120 && code === null; i++) {
        const m = existsSync(apiLog) ? /X2F owner setup code: (\S+)/.exec(readFileSync(apiLog).subarray(apiLogFrom).toString('utf8')) : null;
        if (m) code = m[1]!;
        else await sleep(500);
      }
      if (code === null) throw new Error(`stack: the API printed no owner setup code; see ${apiLog}`);
      await staff.ok('POST', '/staff/v1/setup/code', { code });
      const tag = randomBytes(3).toString('hex');
      const owner = { displayName: `Owner${tag}`, loginName: `owner-login-${tag}` };
      await staff.ok('POST', '/staff/v1/setup/account', owner);
      const keys = [newKey(), newKey()];
      for (const [i, k] of keys.entries()) {
        await addKey(staff, { path: '/staff/v1/setup/key/start', body: {} }, (s, response) => ({ path: '/staff/v1/setup/key/finish', body: { challengeId: s.challengeId, response, label: i === 0 ? 'Main key' : 'Spare key' } }), k, ca);
      }
      const pgp = await newPgp(owner.displayName);
      const ps = await staff.ok<{ challengeId: string; encryptedMessage: string }>('POST', '/staff/v1/setup/pgp/start', { publicKey: pgp.publicKey });
      await staff.ok('POST', '/staff/v1/setup/pgp/finish', { challengeId: ps.challengeId, code: await pgpCode(ps.encryptedMessage, pgp) });
      await staff.ok('POST', '/staff/v1/setup/finish', { deviceLabel: 'e2e' });

      // The moderation process's read-only login on the API's database (migration 208's role).
      const readerPassword = randomBytes(18).toString('base64url');
      const c = new pg.Client({ connectionString: a.apiDatabaseUrl });
      await c.connect();
      let accountId: string;
      try {
        await c.query(`create role x2f_e2e_mod_reader login password '${readerPassword}' in role x2f_mod_reader`);
        accountId = (await c.query<{ id: string }>("select id from accounts where kind = 'owner'")).rows[0]!.id;
      } finally {
        await c.end();
      }
      const u = new URL(a.apiDatabaseUrl);
      u.username = 'x2f_e2e_mod_reader';
      u.password = readerPassword;
      const readerUrl = u.toString();

      const gateEnv = { MOD_KEYSTORE_KEY: a.modKeystoreKey, MOD_STATE_DIR: stateDir, MOD_API_READER_DATABASE_URL: readerUrl };
      await runCli(o.root, o.logDir, 'init-gate', gateEnv);
      const pinned = await runCli(o.root, o.logDir, 'pin-owner', gateEnv);
      if (!/\bpinned\b/.test(pinned)) throw new Error(`stack: pin-owner did not pin the owner: ${pinned}`);

      return {
        modEnv: {
          MOD_INTERNAL_SOCKET: socket,
          // A dedicated group id, never 0; the test runs as the socket's owner, so any id will do.
          MOD_INTERNAL_SOCKET_GID: '4242',
          MOD_INTERNAL_SECRET: internalSecret,
          MOD_API_READER_DATABASE_URL: readerUrl,
          MOD_STATE_DIR: stateDir,
          MOD_STAFF_ORIGIN: origin,
          MOD_STAFF_RP_ID: 'localhost',
          MOD_FIDO_MDS_DIR: mdsDir,
        },
        info: { origin, api, ca, owner: { accountId, ...owner, keys, pgp } },
      };
    },
    async close() {
      await front.close();
    },
  };
}
