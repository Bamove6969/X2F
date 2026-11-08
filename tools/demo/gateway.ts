/**
 * DEMO ONLY: the demo's web entry point. One origin serves the app and the API (the API process)
 * and the relay under /relay; a second port is the node proxy at its root (monero-ts drops any
 * path in a daemon URI, so the node cannot live under /node). It listens on 127.0.0.1 and, only when DEMO_TAILSCALE_IP is set (a Tailscale 100.x
 * address found by `tailscale ip -4`), also over HTTPS on that private tailnet address. It never
 * binds 0.0.0.0 and opens no public tunnel.
 */
import { readFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { assertDemoFlag } from './guard.js';

assertDemoFlag(process.env);
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

type Target = { port: number; path: string; node: boolean };
type Route = (url: string) => Target;

/** The web origin: the API, and the relay under /relay. */
const web: Route = (url) => {
  if (url === '/relay' || url.startsWith('/relay/') || url.startsWith('/relay?')) return { port: RELAY, path: url.slice('/relay'.length) || '/', node: false };
  return { port: API, path: url, node: false };
};
/** The node origin: everything to the node proxy, path unchanged. */
const node: Route = (url) => ({ port: NODE, path: url, node: true });

const handle = (route: Route) => (req: IncomingMessage, res: ServerResponse): void => {
  const t = route(req.url ?? '/');
  const headers = { ...req.headers };
  // The node proxy accepts one exact origin (the web build's): a request from another demo origin
  // is passed on as the primary one, and its CORS answer is given back to the origin that asked.
  const from = typeof headers.origin === 'string' ? headers.origin : null;
  const known = t.node && from !== null && ORIGINS.has(from);
  if (known) headers.origin = PRIMARY;
  const up = http.request({ host: '127.0.0.1', port: t.port, path: t.path, method: req.method, headers }, (r) => {
    const out = { ...r.headers };
    if (known && out['access-control-allow-origin'] === PRIMARY) out['access-control-allow-origin'] = from;
    res.writeHead(r.statusCode ?? 502, out);
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end('{"error":"demo-gateway-upstream"}');
  });
  req.pipe(up);
};

const upgrade = (route: Route) => (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
  const t = route(req.url ?? '/');
  const up = net.connect(t.port, '127.0.0.1', () => {
    const lines = [`${req.method} ${t.path} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const end = () => {
    up.destroy();
    socket.destroy();
  };
  up.on('error', end);
  socket.on('error', end);
};

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
