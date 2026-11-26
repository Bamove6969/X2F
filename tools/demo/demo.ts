/**
 * DEMO ONLY: `npm run demo`. Starts the whole X2F stack on this machine with fake money and leaves
 * it running in the background (`npm run demo:stop` ends it). See docs/demo.md.
 *
 * Regtest only: monerod runs with --regtest --offline and every demo process checks that its
 * daemon reports a regtest (fakechain) network before doing anything (guard.ts). Everything binds
 * to 127.0.0.1; only the gateway may also listen on this machine's Tailscale address (private to
 * the owner's tailnet). Secrets are generated fresh into .demo/secrets (gitignored) on every start.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { migrate } from '../../apps/api/src/db/migrate.js';
import { TERMS_TEXT_VERSION } from '../../apps/web/src/screens/setup/termsText.js';
import { DEMO_DIR, DEMO_MDS_DIR, ENV_FILE, HOST, LOG_DIR, MONEROD_RESTRICTED, MONEROD_RPC, PG_CONTAINER, PG_CONTAINER_FILE, PG_IMAGE, PORT_OFFSET, PORTS, ROOT, SECRETS_DIR, STAFF_WEB_DIST, STATE_DIR, WEB_DIST } from './config.js';
import { assertDemoFlag, assertRegtestDaemon } from './guard.js';
import { demoOrigins, quickTunnelUrl } from './origins.js';
import { pushEnabled } from './notes-push.js';
import { gatewayNotesEnv, loadSeed, notesFiles, notesStartupLine } from './notes-server.js';
import { phoneIp } from './phone.js';
import { readPids, startDetached, startTs, stopAll } from './procs.js';
import { SELF_HTTP, SELF_WS } from './self-origin.js';
import { makeSecrets } from './secrets.js';
import { makeDemoMds } from './staff-mds.js';
import { buildStaffWeb, buildWeb } from './web-build.js';

assertDemoFlag(process.env);
const step = (s: string): void => console.log(`demo: ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch {
      // not yet
    }
    await sleep(500);
  }
  throw new Error(`demo: ${what} did not come up (see .demo/logs)`);
}
const httpUp = (url: string) => async () => (await fetch(url)).status < 500;

async function main(): Promise<void> {
  if (Object.keys(readPids()).length > 0) {
    step('stopping the previous demo first');
    await stopAll(() => undefined);
  }
  rmSync(DEMO_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  if (PORT_OFFSET !== 0) step(`DEMO_PORT_OFFSET=${PORT_OFFSET}: ports ${PORTS.gateway}/${PORTS.gatewayNode} (and every other port +${PORT_OFFSET}), Postgres container ${PG_CONTAINER}`);

  // ── Tailscale (optional, private tailnet only) ──────────────────────────────
  let tsIp = '';
  const ts = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8' });
  if (ts.status === 0) tsIp = (ts.stdout.split('\n')[0] ?? '').trim();
  const TS_ORIGIN = tsIp ? `https://${tsIp}:${PORTS.gatewayTls}` : '';
  // ── The Android Terminal VM (X2F_DEMO_PHONE, phone.ts): the gateway's 4400 also on the VM's address ──
  const phone = phoneIp(process.env);
  if (phone) step(`phone mode: the gateway's port ${PORTS.gateway} also listens on ${phone} (the Android Terminal VM's address)`);

  // ── A public tunnel (optional, DEMO_TUNNEL=cloudflared): two Cloudflare quick tunnels ─────────
  // Anyone with the URL can open the demo (fake money only). The tunnels connect out to Cloudflare;
  // nothing here listens beyond 127.0.0.1.
  const originEnv: Record<string, string | undefined> = { ...process.env };
  if (process.env.DEMO_TUNNEL === 'cloudflared') {
    const bin = process.env.DEMO_CLOUDFLARED || 'cloudflared';
    for (const [name, port] of [['tunnel-web', PORTS.gateway], ['tunnel-node', PORTS.gatewayNode], ['tunnel-staff', PORTS.staffGateway]] as const) {
      startDetached(name, bin, ['tunnel', '--no-autoupdate', '--url', `http://${HOST}:${port}`], {});
    }
    const urlOf = (name: string) => quickTunnelUrl(existsSync(join(LOG_DIR, `${name}.log`)) ? readFileSync(join(LOG_DIR, `${name}.log`), 'utf8') : '');
    await waitFor('the cloudflared quick tunnels', async () => urlOf('tunnel-web') !== null && urlOf('tunnel-node') !== null && urlOf('tunnel-staff') !== null, 60_000);
    originEnv.DEMO_PUBLIC_STAFF_ORIGIN = urlOf('tunnel-staff')!;
    originEnv.DEMO_PUBLIC_ORIGIN = urlOf('tunnel-web')!;
    originEnv.DEMO_PUBLIC_NODE_ORIGIN = urlOf('tunnel-node')!;
    step(`public tunnels up: ${originEnv.DEMO_PUBLIC_ORIGIN} (node ${originEnv.DEMO_PUBLIC_NODE_ORIGIN})`);
  }
  const o = demoOrigins(originEnv, tsIp);
  const LOCAL_ORIGIN = o.local;
  // The web build talks to the relay (/relay) and the node proxy (its RPC paths) on the origin it
  // is opened from: it is built with placeholders that the gateway fills with the request's own
  // origin (self-origin.ts), so one build works on localhost, the tailnet, a tunnel or a preview pane.
  const PRIMARY = o.primary;
  const PUBLIC_ORIGIN = o.public;

  step('making throwaway secrets in .demo/secrets');
  const s = await makeSecrets();
  let tlsKey = '';
  let tlsCert = '';
  if (tsIp) {
    tlsKey = join(SECRETS_DIR, 'tls-key.pem');
    tlsCert = join(SECRETS_DIR, 'tls-cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '30',
      '-subj', '/CN=x2f-demo', '-addext', `subjectAltName=IP:${tsIp}`, '-keyout', tlsKey, '-out', tlsCert], { stdio: 'ignore' });
    chmodSync(tlsKey, 0o600);
  }

  // ── Postgres ────────────────────────────────────────────────────────────────
  step('starting Postgres (docker, 127.0.0.1 only, data on tmpfs)');
  execFileSync('docker', ['rm', '-f', PG_CONTAINER], { stdio: 'ignore' });
  execFileSync('docker', ['run', '-d', '--name', PG_CONTAINER, '--label', 'x2f-demo=1', '-p', `${HOST}:${PORTS.postgres}:5432`,
    '-e', `POSTGRES_PASSWORD=${s.pgPassword}`, '--tmpfs', '/var/lib/postgresql/data', PG_IMAGE], { stdio: 'ignore' });
  writeFileSync(PG_CONTAINER_FILE, `${PG_CONTAINER}\n`);
  const pgUrl = (db: string) => `postgres://postgres:${s.pgPassword}@${HOST}:${PORTS.postgres}/${db}`;
  await waitFor('Postgres', async () => {
    const c = new pg.Client({ connectionString: pgUrl('postgres') });
    await c.connect();
    await c.end();
    return true;
  });
  {
    const c = new pg.Client({ connectionString: pgUrl('postgres') });
    await c.connect();
    await c.query('create database x2f');
    await c.query('create database x2f_moderation');
    await c.end();
    const pool = new pg.Pool({ connectionString: pgUrl('x2f') });
    const applied = await migrate(pool);
    await pool.end();
    step(`migrated the API database (${applied.length} migrations)`);
  }

  // ── monerod (regtest) ───────────────────────────────────────────────────────
  step('checking monerod (tools/regtest/fetch-monerod.sh)');
  execFileSync('bash', [join(ROOT, 'tools/regtest/fetch-monerod.sh')], { stdio: 'inherit' });
  const monerod = join(ROOT, '.regtest/bin', process.arch === 'arm64' ? 'monero-aarch64-linux-gnu-v0.18.5.3' : 'monero-x86_64-linux-gnu-v0.18.5.3', 'monerod');
  const chainDir = join(DEMO_DIR, 'chain');
  mkdirSync(chainDir, { recursive: true });
  startDetached('monerod', monerod, [
    '--regtest', '--offline', '--fixed-difficulty', '1', '--no-zmq', '--non-interactive', '--disable-rpc-ban',
    '--data-dir', chainDir,
    '--rpc-bind-ip', HOST, '--rpc-bind-port', String(PORTS.monerodRpc),
    '--rpc-restricted-bind-ip', HOST, '--rpc-restricted-bind-port', String(PORTS.monerodRestricted),
    '--p2p-bind-ip', HOST, '--p2p-bind-port', String(PORTS.monerodP2p),
    '--rpc-max-connections-per-private-ip', '60', '--rpc-max-connections-per-public-ip', '60', '--rpc-max-connections', '200',
  ], {});
  await waitFor('monerod', async () => (await fetch(`${MONEROD_RPC}/get_info`)).ok);
  await assertRegtestDaemon(MONEROD_RPC);
  await assertRegtestDaemon(MONEROD_RESTRICTED);
  step('monerod is up and reports regtest');

  // ── the web build ───────────────────────────────────────────────────────────
  step('building apps/web for this demo (regtest, demo moderation key)');
  buildWeb(WEB_DIST, s);
  // The staff app, its production build as the e2e stack makes it (only the moderation key pinned).
  step('building apps/staff-web for the staff origin');
  buildStaffWeb(STAFF_WEB_DIST, s);
  // The repo's FIDO metadata plus the demo's own throwaway key (staff-mds.ts), so the seeded staff
  // hold software security keys; the CA's private key is the seed's alone (.demo/secrets, 0600).
  const staffCaFile = join(SECRETS_DIR, 'staff-ca.json');
  writeFileSync(staffCaFile, JSON.stringify(await makeDemoMds(DEMO_MDS_DIR)), { mode: 0o600 });

  // ── services ────────────────────────────────────────────────────────────────
  const origins = o.allowed;
  const demo: Record<string, string> = { X2F_DEMO: '1', ...(PORT_OFFSET !== 0 ? { DEMO_PORT_OFFSET: String(PORT_OFFSET) } : {}) };

  startTs('relay', 'apps/relay/src/main.ts', {
    RELAY_MOD_SIGNING_PUBLIC: s.modSigningPublic, RELAY_HOST: HOST, RELAY_PORT: String(PORTS.relay),
    RELAY_ADMIN_HOST: HOST, RELAY_ADMIN_PORT: String(PORTS.relayAdmin),
  });
  startTs('node-proxy', 'apps/node-proxy/src/main.ts', {
    NODE_PROXY_UPSTREAM: MONEROD_RESTRICTED, NODE_PROXY_WEB_ORIGIN: PRIMARY, NODE_PROXY_HOST: HOST, NODE_PROXY_PORT: String(PORTS.nodeProxy),
  });
  const apiEnv: Record<string, string> = {
    X2F_SITE_NAME: 'X2F demo',
    X2F_ORIGINS: origins.join(','),
    X2F_RP_ID: o.rpId,
    DATABASE_URL: pgUrl('x2f'),
    X2F_LEAKED_LIST_PATH: s.leakedListPath,
    X2F_SERVER_KEY: s.serverKey,
    // The repo's snapshot plus the demo's software key (staff-mds.ts); real keys register as before.
    X2F_ATTESTATION_DIR: DEMO_MDS_DIR,
    // Regtest uses the mainnet address format; the node itself is --regtest --offline.
    X2F_MONERO_NETWORK: 'mainnet',
    X2F_TERMS_VERSION: TERMS_TEXT_VERSION,
    X2F_PGP_SIGNING_KEY_PATH: s.pgpKeyPath,
    X2F_PGP_SIGNING_FINGERPRINT: s.pgpFingerprint,
    X2F_PASSWORD_PEPPERS: s.passwordPeppers,
    X2F_RECOVERY_CODE_KEYS: s.recoveryCodeKeys,
    X2F_TOTP_KEYS: s.totpKeys,
    X2F_LOGIN_NAME_KEYS: s.loginNameKeys,
    X2F_TRAINING_ID_KEY: s.trainingIdKey,
    X2F_VAPID_PUBLIC: s.vapidPublic,
    X2F_VAPID_PRIVATE: s.vapidPrivate,
    X2F_HOST: HOST,
    X2F_PORT: String(PORTS.api),
    X2F_WEB_ROOT: WEB_DIST,
    // The CSP's relay and node origins: the placeholders, which the gateway fills per request.
    X2F_RELAY_ORIGIN: SELF_WS,
    X2F_NODE_PROXY_ORIGIN: SELF_HTTP,
    X2F_MOD_SIGNING_PUBLIC: s.modSigningPublic,
    X2F_INTERNAL_HOST: HOST,
    X2F_INTERNAL_PORT: String(PORTS.apiInternal),
    X2F_MONEROD_URL: MONEROD_RESTRICTED,
    // The staff API on its own loopback listener (Plan 4 Task 4); its origin is the staff gateway's
    // (4402, or DEMO_PUBLIC_STAFF_ORIGIN), never the trader one, and it serves the staff-web build.
    X2F_STAFF_ORIGIN: o.staff,
    X2F_STAFF_RP_ID: o.staffRpId,
    X2F_STAFF_HOST: HOST,
    X2F_STAFF_PORT: String(PORTS.staff),
    X2F_STAFF_WEB_ROOT: STAFF_WEB_DIST,
    ...(process.env.PRICE_SOURCES ? { PRICE_SOURCES: process.env.PRICE_SOURCES } : {}),
    ...(process.env.FX_SOURCES ? { FX_SOURCES: process.env.FX_SOURCES } : {}),
  };
  // Kept (0600) for the gateway, which restarts the API with a preview pane's host as RP ID (rp-adopt.ts).
  writeFileSync(ENV_FILE, JSON.stringify(apiEnv), { mode: 0o600 });
  startTs('api', 'apps/api/src/main.ts', apiEnv);
  await waitFor('the API', httpUp(`http://${HOST}:${PORTS.api}/v1/site`));

  startTs('moderator', 'tools/demo/moderator.ts', {
    ...demo,
    MONERO_DAEMON_URI: MONEROD_RPC,
    DATABASE_URL: pgUrl('x2f'),
    MOD_DATABASE_URL: pgUrl('x2f_moderation'),
    X2F_API_INTERNAL_URL: `http://${HOST}:${PORTS.apiInternal}`,
    RELAY_ADMIN_URL: `http://${HOST}:${PORTS.relayAdmin}`,
    DEMO_RELAY_WS: `ws://${HOST}:${PORTS.relay}`,
    MOD_KEYSTORE_KEY: s.modKeystoreKey,
    MOD_SIGNING_SECRET: s.modSigningSecret,
    X2F_FEE_WALLET: s.feeWallet,
    DEMO_STATE_DIR: STATE_DIR,
  });
  startTs('gateway', 'tools/demo/gateway.ts', {
    ...demo,
    DEMO_API_PORT: String(PORTS.api), DEMO_RELAY_PORT: String(PORTS.relay), DEMO_NODE_PROXY_PORT: String(PORTS.nodeProxy),
    DEMO_GATEWAY_PORT: String(PORTS.gateway), DEMO_GATEWAY_TLS_PORT: String(PORTS.gatewayTls), DEMO_GATEWAY_NODE_PORT: String(PORTS.gatewayNode), DEMO_GATEWAY_NODE_TLS_PORT: String(PORTS.gatewayNodeTls), DEMO_PRIMARY_ORIGIN: PRIMARY, DEMO_ORIGINS: origins.join(','), DEMO_MONEROD_RPC: MONEROD_RPC,
    DATABASE_URL: pgUrl('x2f'),
    // No adopting under a public tunnel: its host is the RP ID already.
    DEMO_ADOPT_SELF: PUBLIC_ORIGIN || process.env.DEMO_ADOPT_SELF === '0' ? '0' : '1', ...(process.env.DEMO_ADOPT_HOST ? { DEMO_ADOPT_HOST: process.env.DEMO_ADOPT_HOST } : {}), DEMO_API_ENV: ENV_FILE, DEMO_STATE_DIR: STATE_DIR,
    ...(tsIp ? { DEMO_TAILSCALE_IP: tsIp, DEMO_TLS_KEY: tlsKey, DEMO_TLS_CERT: tlsCert } : {}),
    ...(phone ? { DEMO_PHONE_IP: phone } : {}),
    // DEMO_NOTES_FILE / DEMO_NOTES_SEED from the shell: the gateway's environment is otherwise clean.
    ...gatewayNotesEnv(process.env),
  });
  startTs('staff-gateway', 'tools/demo/staff-gateway.ts', {
    ...demo,
    DEMO_STAFF_API_PORT: String(PORTS.staff), DEMO_STAFF_GATEWAY_PORT: String(PORTS.staffGateway),
    DEMO_STAFF_ORIGIN: o.staff, DEMO_STAFF_RP_ID: o.staffRpId, DEMO_STAFF_ORIGINS: o.staffAllowed.join(','), DEMO_MONEROD_RPC: MONEROD_RPC,
  });
  await waitFor('the gateway', httpUp(`${LOCAL_ORIGIN}/`));
  await waitFor('the staff gateway', httpUp(`http://${HOST}:${PORTS.staffGateway}/healthz`));
  await waitFor('the node proxy', httpUp(`http://${HOST}:${PORTS.nodeProxy}/get_info`));
  await waitFor('the gateway node port', httpUp(`http://${HOST}:${PORTS.gatewayNode}/get_info`));

  step('seeding demo traders and offers');
  execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'tools/demo/seed.ts')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...demo, DEMO_ORIGIN: LOCAL_ORIGIN, DATABASE_URL: pgUrl('x2f'), MONERO_DAEMON_URI: MONEROD_RPC },
  });
  step('seeding the staff: the owner, a senior moderator, two moderators, news, a case taken');
  // A failed staff seed leaves the trader demo running (the staff app then has no accounts and the
  // guide says it is not seeded); it is never a reason to stop the whole demo.
  try {
    execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'tools/demo/staff-seed.ts')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env, ...demo, MONERO_DAEMON_URI: MONEROD_RPC,
        DEMO_STAFF_API: `http://${HOST}:${PORTS.staff}`, DEMO_STAFF_ORIGIN: o.staff, DEMO_STAFF_RP_ID: o.staffRpId,
        DEMO_API_LOG: join(LOG_DIR, 'api.log'), DEMO_STAFF_CA: staffCaFile,
      },
    });
  } catch {
    console.log('demo: the staff seed failed (see above); the trader demo runs on, the staff app has no seeded accounts');
  }

  const info = {
    web: LOCAL_ORIGIN,
    ...(PUBLIC_ORIGIN ? { public: PUBLIC_ORIGIN } : {}),
    ...(TS_ORIGIN ? { tailnet: TS_ORIGIN } : {}),
    staff: o.staff,
    logs: LOG_DIR,
  };
  writeFileSync(join(DEMO_DIR, 'urls.json'), JSON.stringify(info, null, 2));
  console.log('\nX2F demo is running (regtest, fake money). Stop it with: npm run demo:stop');
  console.log(`  Open:     ${LOCAL_ORIGIN}`);
  if (PUBLIC_ORIGIN) console.log(`  Public:   ${PUBLIC_ORIGIN}  (anyone with this URL can open it; fake money only)`);
  console.log(`  Staff:    ${o.staff}/__demo/staff (the staff app, its own origin; one-tap login as the owner or a moderator)${o.staff.startsWith('https:') ? `; locally http://localhost:${PORTS.staffGateway}` : ''}`);
  if (TS_ORIGIN) console.log(`  Tailnet:  ${TS_ORIGIN}  (self-signed certificate; your tailnet only)`);
  else console.log('  Tailnet:  not available (tailscale is not installed on this machine)');
  if (phone) {
    console.log(`  Phone:    open ${LOCAL_ORIGIN} in Chrome on this phone. First allow port ${PORTS.gateway} in the Terminal app:`);
    console.log(`            tap "Allow" on its port notification, or turn on ${PORTS.gateway} in the Terminal app's settings (Port control).`);
  }
  console.log('  Logins:   see docs/demo.md (or .demo/logins.txt)');
  // The same numbering the gateway uses (it reads the same files); a failure here is said, never fatal.
  const notesAt = notesFiles(process.env);
  console.log(`  ${await notesStartupLine(notesAt, loadSeed({ seedPath: notesAt.seed })).catch((e: unknown) => `Comments: could not read ${notesAt.notes} (${(e as Error).message})`)}`);
  // DESIGN: wording (the demo's terminal output)
  console.log(
    pushEnabled(process.env)
      ? '  GitHub:   comments go to the comms branch 30 s after each change, and at demo:stop (the Comment button says whether they are there yet; DEMO_NOTES_PUSH=0 turns this off)'
      : '  GitHub:   off (DEMO_NOTES_PUSH=0); comments stay on this computer',
  );
  console.log(`  Guide:    ${PUBLIC_ORIGIN || LOCAL_ORIGIN}/__demo/guide (every screen, with the account to use)`);
  console.log(`  Codes:    ${LOCAL_ORIGIN}/__demo/codes (the authenticator codes; or npm run demo:code <login name>)`);
  console.log(`  Logs:     ${LOG_DIR}`);
}

// Exits once everything is up: the started processes are detached and outlive this one (monero-ts
// keeps a worker alive otherwise).
main().then(() => process.exit(0), async (e: unknown) => {
  console.error(`demo: failed: ${(e as Error).message}`);
  console.error('demo: stopping what was started (logs stay in .demo/logs)');
  await stopAll(() => undefined);
  process.exit(1);
});
