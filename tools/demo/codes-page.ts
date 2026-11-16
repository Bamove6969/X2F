/**
 * DEMO ONLY: GET /__demo/codes on the gateway, the seeded demo accounts' current authenticator
 * codes as a page (what `npm run demo:code` prints), for trying the demo from a phone. Only the
 * seeded accounts' throwaway secrets (.demo/secrets/totp.json) are shown; accounts made in the
 * demo are not in that file. It never reaches the API.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { forwardedHttps } from './self-origin.js';
import { stepOf, totpCode } from './totp.js';

// The page's only style: a system sans-serif (owner, 16 Nov 2026: with no style at all, browsers drew
// it in their default serif). The CSP allows exactly this text by its hash.
const STYLE =
  'html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
  'body{margin:0 auto;max-width:640px;padding:16px;background:#0e1116;color:#eef1f5;' +
  'font:400 17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}' +
  'h1{font-size:24px;line-height:1.25}td{padding:6px 16px 6px 0}' +
  'b{font:600 22px ui-monospace,Menlo,Consolas,"Roboto Mono",monospace;letter-spacing:.06em}';
const CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(STYLE).digest('base64')}'`;

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
    `<title>X2F demo codes</title><style>${STYLE}</style></head><body>`,
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
        'content-security-policy': CSP,
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
