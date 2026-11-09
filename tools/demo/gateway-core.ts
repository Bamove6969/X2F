/**
 * DEMO ONLY: the gateway's request handling, apart from its listening sockets so tests can drive it.
 * The web origin carries the app, the API and /relay, plus the demo's own /__demo/ routes, which are
 * answered here and never reach the API. HTML from the API gets one script tag for the comment
 * layer; nothing in apps/ or the production build knows about it.
 */
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

export const NOTES_TAG = '<script src="/__demo/notes.js" defer></script>';
/** Larger HTML than this is passed on untouched rather than held in memory. */
const MAX_HTML_BYTES = 4 * 1024 * 1024;

/** The node proxy's paths (apps/node-proxy server.ts), so one host name with no port can carry both origins. */
const NODE_PATHS = new Set(['/json_rpc', '/getblocks.bin', '/getblocks_by_height.bin', '/gethashes.bin', '/get_o_indexes.bin', '/getouts.bin', '/get_outs.bin', '/get_transaction_pool_hashes.bin', '/get_output_distribution.bin', '/get_transactions', '/sendrawtransaction', '/get_height', '/get_info', '/is_key_image_spent', '/get_transaction_pool']);

export type Target = { port: number; path: string; node: boolean; api: boolean };
export type Route = (url: string) => Target;

export interface GatewayConfig {
  api: number;
  relay: number;
  node: number;
  /** The one origin the node proxy accepts (the web build's origin). */
  primary: string;
  /** Every origin the demo is opened from. */
  origins: Set<string>;
  /** Answers everything under /__demo/ on the web origin. */
  demo: (req: IncomingMessage, res: ServerResponse) => void;
}

export function isDemoUrl(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? url;
  return path === '/__demo' || path.startsWith('/__demo/');
}

/** The HTML with the tag before </head>, or null if it has no </head> or already has the tag. Works on bytes: the charset is left alone. */
export function injectNotesTag(html: Buffer): Buffer | null {
  const s = html.toString('latin1');
  if (s.includes('/__demo/notes.js')) return null;
  const at = s.search(/<\/head\s*>/i);
  if (at < 0) return null;
  return Buffer.concat([html.subarray(0, at), Buffer.from(NOTES_TAG, 'latin1'), html.subarray(at)]);
}

function decode(body: Buffer, encoding: string | undefined): Buffer | null {
  try {
    if (encoding === undefined || encoding === '' || encoding === 'identity') return body;
    if (encoding === 'gzip' || encoding === 'x-gzip') return gunzipSync(body);
    if (encoding === 'br') return brotliDecompressSync(body);
    if (encoding === 'deflate') return inflateSync(body);
    return null;
  } catch {
    return null;
  }
}

const isHtml = (h: IncomingHttpHeaders): boolean => /^text\/html\b/i.test(h['content-type'] ?? '');
/** The validators and ranges of the upstream's bytes no longer describe the injected page. */
function stripValidators(h: IncomingHttpHeaders): void {
  delete h.etag;
  delete h['last-modified'];
  delete h['accept-ranges'];
}

/** Holds the whole HTML response, adds the tag, and answers with the right length, unencoded. */
function injectInto(r: IncomingMessage, res: ServerResponse, out: IncomingHttpHeaders): void {
  const status = r.statusCode ?? 502;
  let chunks: Buffer[] = [];
  let size = 0;
  const onData = (c: Buffer): void => {
    size += c.length;
    chunks.push(c);
    if (size > MAX_HTML_BYTES) {
      r.off('data', onData);
      r.off('end', onEnd);
      res.writeHead(status, out);
      for (const b of chunks) res.write(b);
      chunks = [];
      r.pipe(res);
    }
  };
  const onEnd = (): void => {
    const raw = Buffer.concat(chunks);
    const plain = decode(raw, out['content-encoding']);
    const injected = plain === null ? null : injectNotesTag(plain);
    if (injected === null) {
      res.writeHead(status, out);
      res.end(raw);
      return;
    }
    stripValidators(out);
    delete out['content-encoding'];
    delete out['transfer-encoding'];
    out['content-length'] = String(injected.length);
    res.writeHead(status, out);
    res.end(injected);
  };
  r.on('data', onData);
  r.on('end', onEnd);
  r.on('error', () => res.destroy());
}

export function createGateway(cfg: GatewayConfig): {
  web: Route;
  node: Route;
  handle: (route: Route) => (req: IncomingMessage, res: ServerResponse) => void;
  upgrade: (route: Route) => (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
  /** The web origin: the node's RPC paths, the API, and the relay under /relay. */
  const web: Route = (url) => {
    if (NODE_PATHS.has(url.split('?')[0] ?? url)) return { port: cfg.node, path: url, node: true, api: false };
    if (url === '/relay' || url.startsWith('/relay/') || url.startsWith('/relay?')) return { port: cfg.relay, path: url.slice('/relay'.length) || '/', node: false, api: false };
    return { port: cfg.api, path: url, node: false, api: true };
  };
  /** The node origin: everything to the node proxy, path unchanged. */
  const node: Route = (url) => ({ port: cfg.node, path: url, node: true, api: false });

  const handle = (route: Route) => (req: IncomingMessage, res: ServerResponse): void => {
    if (isDemoUrl(req.url ?? '/')) {
      if (route === web) cfg.demo(req, res);
      else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"demo-notes-not-found"}');
      }
      return;
    }
    const t = route(req.url ?? '/');
    const headers = { ...req.headers };
    // The node proxy accepts one exact origin (the web build's): a request from another demo origin
    // is passed on as the primary one, and its CORS answer is given back to the origin that asked.
    const from = typeof headers.origin === 'string' ? headers.origin : null;
    const known = t.node && from !== null && cfg.origins.has(from);
    if (known) headers.origin = cfg.primary;
    const page = t.api && (req.method === 'GET' || req.method === 'HEAD') && (headers.accept ?? '').includes('text/html');
    if (page) {
      // A browser that cached the page before this tag existed must get the full page, not a 304.
      delete headers['if-none-match'];
      delete headers['if-modified-since'];
      delete headers.range;
      delete headers['if-range'];
      headers['accept-encoding'] = 'identity';
    }
    const up = http.request({ host: '127.0.0.1', port: t.port, path: t.path, method: req.method, headers }, (r) => {
      const out = { ...r.headers };
      if (known && out['access-control-allow-origin'] === cfg.primary) out['access-control-allow-origin'] = from;
      const status = r.statusCode ?? 502;
      if (t.api && isHtml(out) && status !== 204 && status !== 304) {
        if (req.method === 'GET') return injectInto(r, res, out);
        if (req.method === 'HEAD') {
          stripValidators(out);
          delete out['content-length'];
        }
      }
      res.writeHead(status, out);
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"error":"demo-gateway-upstream"}');
    });
    req.pipe(up);
  };

  const upgrade = (route: Route) => (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (isDemoUrl(req.url ?? '/')) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
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

  return { web, node, handle, upgrade };
}
