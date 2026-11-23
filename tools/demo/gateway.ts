/**
 * DEMO ONLY: the demo's web entry point. One origin serves the app and the API (the API process)
 * and the relay under /relay; a second port is the node proxy at its root (monero-ts drops any
 * path in a daemon URI, so the node cannot live under /node). It listens on 127.0.0.1 and, only when DEMO_TAILSCALE_IP is set (a Tailscale 100.x
 * address found by `tailscale ip -4`), also over HTTPS on that private tailnet address. It never
 * binds 0.0.0.0; an optional public tunnel (DEMO_TUNNEL=cloudflared, docs/demo.md) connects out
 * and reaches it on 127.0.0.1 like any local client.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createCodesHandler } from './codes-page.js';
import { createGuideHandler } from './guide-page.js';
import { createDoor } from './door.js';
import { createGateway, type Route } from './gateway-core.js';
import { assertDemo } from './guard.js';
import { ROOT } from './config.js';
import { createNotesPusher, pushEnabled } from './notes-push.js';
import { createNotesHandler, loadSeed, mergeText, notesFileName, notesFiles, readRecord, renderRecord } from './notes-server.js';
import { isPrivateIpv4 } from './phone.js';
import { restartTs } from './procs.js';
import { adoptedApiEnv, createAdopter } from './rp-adopt.js';
import { readTotpSecrets } from './totp.js';

// X2F_DEMO=1 and a regtest daemon on 127.0.0.1, before anything listens.
await assertDemo(process.env, process.env.DEMO_MONEROD_RPC ?? '');
const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`gateway: ${k} is missing`);
  return v;
};
const API = Number(env('DEMO_API_PORT'));
const RELAY = Number(env('DEMO_RELAY_PORT'));
const NODE = Number(env('DEMO_NODE_PROXY_PORT'));
const PORT = Number(env('DEMO_GATEWAY_PORT'));
const TLS_PORT = Number(env('DEMO_GATEWAY_TLS_PORT'));
const NODE_PORT = Number(env('DEMO_GATEWAY_NODE_PORT'));
const NODE_TLS_PORT = Number(env('DEMO_GATEWAY_NODE_TLS_PORT'));
/** The one origin the node proxy accepts (the web build's origin). */
const PRIMARY = env('DEMO_PRIMARY_ORIGIN');
const TS_IP = process.env.DEMO_TAILSCALE_IP ?? '';
/** The Android Terminal VM's private address (phone.ts): only the web port also listens there. */
const PHONE_IP = process.env.DEMO_PHONE_IP ?? '';
/** Every origin the demo is opened from (localhost, 127.0.0.1, the tailnet one); the node proxy is told it is the primary one. */
const ORIGINS = new Set(env('DEMO_ORIGINS').split(','));

/** 100.64.0.0/10, Tailscale's CGNAT range: the only non-loopback address the gateway binds. */
function isTailscaleIp(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127 && Number(m[2]) <= 255 && Number(m[3]) <= 255;
}

// The comments: every earlier demo's notes from origin/comms (read only), and publishing them back
// to comms on GitHub (notes-push.ts) unless DEMO_NOTES_PUSH=0.
const notesAt = notesFiles(process.env);
const notesSeed = loadSeed({ seedPath: notesAt.seed });
console.log(JSON.stringify({ reason: 'notes-loaded', ok: notesSeed.ok, sources: notesSeed.sources, files: notesSeed.files, comments: notesSeed.notes.length, problems: notesSeed.problems }));
const pusher = pushEnabled(process.env)
  ? createNotesPusher({
      repo: ROOT,
      dir: join(dirname(notesAt.notes), '.comms-push'),
      fileName: notesFileName(Date.now()),
      render: async (current) => renderRecord(mergeText(await readRecord(notesAt, notesSeed), current ?? '')),
    })
  : null;
const notes = createNotesHandler({
  files: notesAt,
  origins: ORIGINS,
  clientJs: readFileSync(new URL('./notes.js', import.meta.url)),
  seed: notesSeed,
  ...(pusher ? { onChange: pusher.changed, pushState: pusher.state } : {}),
});
if (pusher) {
  void pusher.flush();
  // npm run demo:stop sends SIGTERM and waits 10 s: one last round, then go.
  process.once('SIGTERM', () => {
    const quit = setTimeout(() => process.exit(0), 9_000);
    void pusher.final().finally(() => {
      clearTimeout(quit);
      process.exit(0);
    });
  });
}
// The seeded accounts' authenticator codes as a page (codes-page.ts), for a phone.
const codes = createCodesHandler({ origins: ORIGINS, secrets: readTotpSecrets });
// The screen-by-screen demo guide (guide-page.ts), for a phone.
const guide = createGuideHandler({ origins: ORIGINS });
const demo = (req: http.IncomingMessage, res: http.ServerResponse): void => {
  const path = (req.url ?? '').split(/[?#]/, 1)[0];
  if (path === '/__demo/codes') codes(req, res);
  else if (path === '/__demo/guide' || path === '/__demo/guide/legal') guide(req, res);
  else notes(req, res);
};
// The seeded accounts' way in from a fresh browser (door.ts).
const passwordStep = createDoor(env('DATABASE_URL'));
// Security keys and passkeys under a preview pane's https host (rp-adopt.ts): the API is restarted
// once with that host as its RP ID. DEMO_API_ENV is the API's environment file (0600, .demo/secrets).
const API_ENV = process.env.DEMO_API_ENV ?? '';
const adopter = createAdopter({
  enabled: process.env.DEMO_ADOPT_SELF === '1' && API_ENV !== '',
  pin: process.env.DEMO_ADOPT_HOST,
  restart: async (origin) => {
    const apiEnv = adoptedApiEnv(JSON.parse(readFileSync(API_ENV, 'utf8')) as Record<string, string>, origin);
    writeFileSync(API_ENV, JSON.stringify(apiEnv), { mode: 0o600 });
    if (process.env.DEMO_STATE_DIR) writeFileSync(join(process.env.DEMO_STATE_DIR, 'rp-origin.json'), JSON.stringify({ origin, rpId: apiEnv.X2F_RP_ID }));
    await restartTs('api', 'apps/api/src/main.ts', apiEnv);
    for (let i = 0; i < 240; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${API}/v1/site`)).status < 500) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('the API did not come back');
  },
});
const { web, node, handle, upgrade } = createGateway({
  api: API, relay: RELAY, node: NODE, primary: PRIMARY, origins: ORIGINS, demo, passwordStep, beforeApi: adopter.beforeApi,
});

function serve(route: Route, port: number, host: string, tls: { key: Buffer; cert: Buffer } | null): void {
  const srv = tls ? https.createServer(tls, handle(route)) : http.createServer(handle(route));
  srv.on('upgrade', upgrade(route));
  srv.listen(port, host);
  console.log(JSON.stringify({ reason: 'listening', on: `${host}:${port}` }));
}

serve(web, PORT, '127.0.0.1', null);
serve(node, NODE_PORT, '127.0.0.1', null);
if (PHONE_IP !== '') {
  if (!isPrivateIpv4(PHONE_IP)) throw new Error('gateway: DEMO_PHONE_IP is not a private IPv4 address');
  // The browser still opens http://localhost:4400 (the Terminal app forwards it), so the origin is unchanged.
  serve(web, PORT, PHONE_IP, null);
}
if (TS_IP !== '') {
  if (!isTailscaleIp(TS_IP)) throw new Error('gateway: DEMO_TAILSCALE_IP is not a Tailscale 100.64.0.0/10 address');
  const tls = { key: readFileSync(env('DEMO_TLS_KEY')), cert: readFileSync(env('DEMO_TLS_CERT')) };
  serve(web, TLS_PORT, TS_IP, tls);
  serve(node, NODE_TLS_PORT, TS_IP, tls);
}
