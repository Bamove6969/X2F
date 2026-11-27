/**
 * DEMO ONLY: GET /__demo/login and POST /__demo/login on the trader gateway: the seeded traders'
 * one-tap login (door.ts does the real PGP login with the account's throwaway key). Apart from the
 * gateway's sockets so the tests can drive it. It never shows a key.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { demoPageCsp } from './page-csp.js';
import { forwardedHttps, isSelfOrigin } from './self-origin.js';
import { parseCookieHeader } from './staff-accounts.js';
import { STAFF_SESSION_COOKIE, withoutCookies } from './staff-gateway-core.js';

/** A seeded trader as the login page shows it (no secrets). */
export interface DoorPerson {
  tradeTag: string;
  loginName: string;
}

const STYLE =
  'html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
  'body{margin:0 auto;max-width:640px;padding:16px;background:#0e1116;color:#eef1f5;' +
  'font:400 17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;overflow-wrap:anywhere}' +
  'h1{font-size:24px;line-height:1.25}.who{color:#b7c0cc;font-size:15px;margin:2px 0 0}' +
  'form{background:#161b22;border-radius:8px;padding:10px 12px;margin:10px 0}' +
  'button{font:600 17px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#ff8a3d;color:#0e1116;border:0;border-radius:6px;padding:8px 14px}' +
  'code{font:500 15px ui-monospace,Menlo,Consolas,"Roboto Mono",monospace;background:#1b212a;padding:1px 4px;border-radius:4px}';
/** The demo pages' policy (page-csp.ts), and the login form posts only to this origin. */
export const DOOR_CSP = `${demoPageCsp(STYLE)}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function doorPage(people: readonly DoorPerson[], error = ''): string {
  const forms = people.map((p) =>
    `<form method="post" action="/__demo/login"><input type="hidden" name="as" value="${esc(p.loginName)}">` +
    `<button type="submit">Log in as ${esc(p.tradeTag)}</button> <code>${esc(p.loginName)}</code></form>`).join('');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>X2F demo login</title><style>${STYLE}</style></head>`,
    '<body data-screen="demo-login">',
    '<h1>Demo login</h1>',
    '<p>Regtest demo only (fake money). There are no passwords: a trader logs in with a passkey, a security key or a PGP key. Each seeded account has a throwaway PGP key and an authenticator app; the demo holds the key and does the real PGP login for you.</p>',
    error === '' ? '' : `<p><b>Could not log in:</b> ${esc(error)}</p>`,
    forms === '' ? '<p>No accounts: is the demo seeded?</p>' : forms,
    '<p class="who">One account per browser or device. Actions that ask for a key in the browser need a passkey or security key added in Settings first.</p>',
    '</body></html>',
  ].join('');
}

function readForm(req: IncomingMessage, limit = 4096): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export function createDoorHandler(cfg: {
  origins: Set<string>;
  people: () => readonly DoorPerson[];
  /** Logs `loginName` in for a browser holding `cookies`; resolves to the Set-Cookie headers for it. */
  login: (loginName: string, cookies: Map<string, string>) => Promise<string[]>;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const hosts = new Set([...cfg.origins].map((o) => new URL(o).host));
  const ours = (origin: string | undefined, req: IncomingMessage): boolean =>
    typeof origin === 'string' && (cfg.origins.has(origin) || isSelfOrigin(origin, req.headers));
  return (req, res) => {
    const send = (status: number, type: string, body: string, extra: Record<string, string | string[]> = {}): void => {
      res.writeHead(status, {
        'content-type': type,
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': DOOR_CSP,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!hosts.has(req.headers.host ?? '') && !forwardedHttps(req.headers)) return send(403, 'application/json', '{"error":"demo-login-host"}');
    if (req.method === 'GET' || req.method === 'HEAD') return send(200, 'text/html; charset=utf-8', doorPage(cfg.people()));
    if (req.method !== 'POST') return send(405, 'application/json', '{"error":"demo-login-method"}');
    // A form on this origin only (no login from another site's page).
    if (!ours(typeof req.headers.origin === 'string' ? req.headers.origin : undefined, req)) return send(403, 'application/json', '{"error":"demo-login-origin"}');
    readForm(req).then(async (form) => {
      const as = form.get('as') ?? '';
      if (!cfg.people().some((p) => p.loginName === as)) return send(400, 'text/html; charset=utf-8', doorPage(cfg.people(), 'not a seeded account'));
      const cookies = parseCookieHeader(withoutCookies(req.headers.cookie, [STAFF_SESSION_COOKIE]));
      const setCookie = await cfg.login(as, cookies);
      send(303, 'text/plain; charset=utf-8', 'Logged in\n', { location: '/', 'set-cookie': setCookie });
    }).catch((e: unknown) => {
      console.log(JSON.stringify({ reason: 'demo-login-failed', error: (e as Error).message }));
      if (!res.headersSent) send(502, 'text/html; charset=utf-8', doorPage(cfg.people(), (e as Error).message));
    });
  };
}
