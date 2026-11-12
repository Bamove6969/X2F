/**
 * DEMO ONLY: GET /__demo/codes on the gateway, the seeded demo accounts' current authenticator
 * codes as a page (what `npm run demo:code` prints), for trying the demo from a phone. Only the
 * seeded accounts' throwaway secrets (.demo/secrets/totp.json) are shown; accounts made in the
 * demo are not in that file. It never reaches the API.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { forwardedHttps } from './self-origin.js';
import { stepOf, totpCode } from './totp.js';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page for these secrets (login name → base32) at `nowMs`. */
export function codesPage(secrets: Record<string, string>, nowMs: number): string {
  const left = 30 - Math.floor((nowMs / 1000) % 30);
  const rows = Object.entries(secrets)
    .map(([name, secret]) => `<tr><td>${esc(name)}</td><td><b>${totpCode(secret, stepOf(nowMs))}</b></td></tr>`)
    .join('');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="refresh" content="${Math.min(left, 10)}">`,
    '<title>X2F demo codes</title></head><body>',
    '<h1>Demo authenticator codes</h1>',
    '<p>Regtest demo only (fake money). Password for every account: Demo-Monero-2026!</p>',
    rows === '' ? '<p>No codes: is the demo seeded?</p>' : `<table>${rows}</table>`,
    `<p>New codes in ${left} s (this page refreshes itself). Each code works once.</p>`,
    '</body></html>',
  ].join('');
}

export function createCodesHandler(cfg: { origins: Set<string>; secrets: () => Record<string, string>; now?: () => number }): (req: IncomingMessage, res: ServerResponse) => void {
  const hosts = new Set([...cfg.origins].map((o) => new URL(o).host));
  const now = cfg.now ?? Date.now;
  return (req, res) => {
    const send = (status: number, type: string, body: string): void => {
      res.writeHead(status, {
        'content-type': type,
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!hosts.has(req.headers.host ?? '') && !forwardedHttps(req.headers)) return send(403, 'application/json', '{"error":"demo-codes-host"}');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'application/json', '{"error":"demo-codes-method"}');
    send(200, 'text/html; charset=utf-8', codesPage(cfg.secrets(), now()));
  };
}
