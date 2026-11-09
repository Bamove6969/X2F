/**
 * DEMO ONLY: the demo's web entry point. One origin serves the app and the API (the API process)
 * and the relay under /relay; a second port is the node proxy at its root (monero-ts drops any
 * path in a daemon URI, so the node cannot live under /node). It listens on 127.0.0.1 and, only when DEMO_TAILSCALE_IP is set (a Tailscale 100.x
 * address found by `tailscale ip -4`), also over HTTPS on that private tailnet address. It never
 * binds 0.0.0.0; an optional public tunnel (DEMO_TUNNEL=cloudflared, docs/demo.md) connects out
 * and reaches it on 127.0.0.1 like any local client.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createGateway, type Route } from './gateway-core.js';
import { assertDemo } from './guard.js';
import { createNotesHandler, notesFiles } from './notes-server.js';

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
/** Every origin the demo is opened from (localhost, 127.0.0.1, the tailnet one); the node proxy is told it is the primary one. */
const ORIGINS = new Set(env('DEMO_ORIGINS').split(','));

/** 100.64.0.0/10, Tailscale's CGNAT range: the only non-loopback address the gateway binds. */
function isTailscaleIp(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127 && Number(m[2]) <= 255 && Number(m[3]) <= 255;
}

const demo = createNotesHandler({
  files: notesFiles(process.env),
  origins: ORIGINS,
  clientJs: readFileSync(new URL('./notes.js', import.meta.url)),
});
const { web, node, handle, upgrade } = createGateway({ api: API, relay: RELAY, node: NODE, primary: PRIMARY, origins: ORIGINS, demo });

function serve(route: Route, port: number, host: string, tls: { key: Buffer; cert: Buffer } | null): void {
  const srv = tls ? https.createServer(tls, handle(route)) : http.createServer(handle(route));
  srv.on('upgrade', upgrade(route));
  srv.listen(port, host);
  console.log(JSON.stringify({ reason: 'listening', on: `${host}:${port}` }));
}

serve(web, PORT, '127.0.0.1', null);
serve(node, NODE_PORT, '127.0.0.1', null);
if (TS_IP !== '') {
  if (!isTailscaleIp(TS_IP)) throw new Error('gateway: DEMO_TAILSCALE_IP is not a Tailscale 100.64.0.0/10 address');
  const tls = { key: readFileSync(env('DEMO_TLS_KEY')), cert: readFileSync(env('DEMO_TLS_CERT')) };
  serve(web, TLS_PORT, TS_IP, tls);
  serve(node, NODE_TLS_PORT, TS_IP, tls);
}
