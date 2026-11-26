/**
 * DEMO ONLY: the staff gateway's request handling (staff-gateway.ts listens), apart from its
 * socket so the tests can drive it.
 *
 * The staff origin is its own origin (its own port, PORTS.staffGateway; publicly
 * DEMO_PUBLIC_STAFF_ORIGIN), never the trader one's: everything on it goes to the staff API's own
 * listener (X2F_STAFF_PORT), which serves the staff-web build itself (X2F_STAFF_WEB_ROOT) with
 * STAFF_CSP, `no-store` and the security headers on every answer. The gateway passes those answers
 * on byte for byte: no comment layer, no placeholder, no header is added or changed, so the staff
 * pages run exactly the build and policy they would in production. It never reaches the trader
 * API, the relay or the node proxy.
 *
 * What it does change, demo only:
 *  - Origin: the staff API accepts exactly one origin (X2F_STAFF_ORIGIN). A request from another of
 *    the staff origins (http://localhost:4402 while the public one is primary, or the request's own
 *    https origin behind a TLS front) is passed on as the primary one. Any other Origin is passed on
 *    unchanged, so the API refuses it as in production.
 *  - Cookies: the browser sends one host's cookies to every port, so the trader session cookie
 *    (`__Host-x2f_session`) never goes to the staff API (and gateway-core.ts keeps the staff one,
 *    `__Host-x2f_staff`, from the trader API).
 *  - /__demo/staff and /__demo/staff/login: the seeded staff accounts' one-tap login (no hardware
 *    key in the demo; staff-accounts.ts). Every other /__demo/ path is a 404 here.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { demoPageCsp } from './page-csp.js';
import { forwardedHttps, isSelfOrigin } from './self-origin.js';
import { parseCookieHeader, type StaffPerson } from './staff-accounts.js';

export const TRADER_SESSION_COOKIE = '__Host-x2f_session';
export const STAFF_SESSION_COOKIE = '__Host-x2f_staff';

/** The Cookie header without the named cookies; undefined when nothing is left. */
export function withoutCookies(header: string | string[] | undefined, drop: readonly string[]): string | undefined {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (raw === undefined) return undefined;
  const kept = raw.split(';').map((p) => p.trim()).filter((p) => {
    if (p === '') return false;
    const at = p.indexOf('=');
    const name = at < 0 ? p : p.slice(0, at);
    return !drop.includes(name);
  });
  return kept.length > 0 ? kept.join('; ') : undefined;
}

export interface StaffGatewayConfig {
  /** The staff API's own listener on 127.0.0.1. */
  staffApi: number;
  /** X2F_STAFF_ORIGIN: the one origin the staff API accepts. */
  primary: string;
  /** Every origin the staff app may be opened from (primary included). */
  origins: Set<string>;
  /** The seeded staff accounts the demo login offers (no secrets). */
  people: () => readonly StaffPerson[];
  /** Logs `loginName` in for a browser holding `cookies`; resolves to the Set-Cookie headers for it. */
  login: (loginName: string, cookies: Map<string, string>) => Promise<string[]>;
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
export const STAFF_DEMO_CSP = `${demoPageCsp(STYLE)}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function staffLoginPage(people: readonly StaffPerson[], error = ''): string {
  const forms = people.map((p) =>
    `<form method="post" action="/__demo/staff/login"><input type="hidden" name="as" value="${esc(p.loginName)}">` +
    `<button type="submit">Log in as ${esc(p.tradeTag)}</button> <code>${esc(p.loginName)}</code> (${esc(p.role === 'mod' ? 'moderator' : p.role === 'senior' ? 'senior moderator' : 'owner')})` +
    `<p class="who">Sees: ${esc(p.sees)}</p></form>`).join('');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>X2F demo staff login</title><style>${STYLE}</style></head>`,
    '<body data-screen="demo-staff-login">',
    '<h1>Demo staff login</h1>',
    '<p>Regtest demo only (fake money). Staff log in with a security key and a PGP key; the demo holds throwaway ones for these accounts and does both steps for you, through the real staff login.</p>',
    error === '' ? '' : `<p><b>Could not log in:</b> ${esc(error)}</p>`,
    forms === '' ? '<p>No staff accounts: is the demo seeded?</p>' : forms,
    '<p class="who">Actions that need a key tap (rulings, invites, settings, bans, news) ask the browser for the security key, which this browser does not hold; see the demo guide.</p>',
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

export function createStaffGateway(cfg: StaffGatewayConfig): (req: IncomingMessage, res: ServerResponse) => void {
  const hosts = new Set([...cfg.origins].map((o) => new URL(o).host));
  /** One of the staff origins, or the request's own https origin behind a TLS front. */
  const ours = (origin: string | undefined, req: IncomingMessage): boolean =>
    typeof origin === 'string' && (cfg.origins.has(origin) || isSelfOrigin(origin, req.headers));

  const demo = (req: IncomingMessage, res: ServerResponse): void => {
    const send = (status: number, type: string, body: string, extra: Record<string, string | string[]> = {}): void => {
      res.writeHead(status, {
        'content-type': type,
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': STAFF_DEMO_CSP,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!hosts.has(req.headers.host ?? '') && !forwardedHttps(req.headers)) return send(403, 'application/json', '{"error":"demo-staff-host"}');
    const path = (req.url ?? '').split(/[?#]/, 1)[0];
    if (path === '/__demo/staff') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'application/json', '{"error":"demo-staff-method"}');
      return send(200, 'text/html; charset=utf-8', staffLoginPage(cfg.people()));
    }
    if (path !== '/__demo/staff/login') return send(404, 'application/json', '{"error":"demo-staff-not-found"}');
    if (req.method !== 'POST') return send(405, 'application/json', '{"error":"demo-staff-method"}');
    // A form on this origin only (no login from another site's page).
    if (!ours(typeof req.headers.origin === 'string' ? req.headers.origin : undefined, req)) return send(403, 'application/json', '{"error":"demo-staff-origin"}');
    readForm(req).then(async (form) => {
      const as = form.get('as') ?? '';
      if (!cfg.people().some((p) => p.loginName === as)) return send(400, 'text/html; charset=utf-8', staffLoginPage(cfg.people(), 'not a seeded staff account'));
      const cookies = parseCookieHeader(withoutCookies(req.headers.cookie, [TRADER_SESSION_COOKIE]));
      const setCookie = await cfg.login(as, cookies);
      send(303, 'text/plain; charset=utf-8', 'Logged in\n', { location: '/', 'set-cookie': setCookie });
    }).catch((e: unknown) => {
      console.log(JSON.stringify({ reason: 'demo-staff-login-failed', error: (e as Error).message }));
      if (!res.headersSent) send(502, 'text/html; charset=utf-8', staffLoginPage(cfg.people(), (e as Error).message));
    });
  };

  return (req, res) => {
    const url = req.url ?? '/';
    const path = url.split(/[?#]/, 1)[0] ?? url;
    if (path === '/__demo' || path.startsWith('/__demo/')) return demo(req, res);
    const headers = { ...req.headers };
    const cookie = withoutCookies(headers.cookie, [TRADER_SESSION_COOKIE]);
    if (cookie === undefined) delete headers.cookie;
    else headers.cookie = cookie;
    const from = typeof headers.origin === 'string' ? headers.origin : undefined;
    if (from !== undefined && from !== cfg.primary && ours(from, req)) headers.origin = cfg.primary;
    const up = http.request({ host: '127.0.0.1', port: cfg.staffApi, path: url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"error":"demo-staff-gateway-upstream"}');
    });
    req.pipe(up);
  };
}
