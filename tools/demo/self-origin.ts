/**
 * DEMO ONLY: one demo build that works under whatever single https origin it is opened from (a
 * preview pane's or a tunnel's, not known in advance).
 *
 * The demo's web build is made with placeholder origins for the relay and the node proxy
 * (SELF_HTTP, SELF_WS). The gateway puts the request's own origin in their place, in the app's
 * JavaScript and in the CSP, and accepts that origin as the demo's own: the API and the node proxy
 * are then given the demo's primary origin instead. The node's RPC paths and /relay are routed by
 * path on the same origin (gateway-core.ts). Nothing in apps/* knows about any of this.
 *
 * A request's "own origin" is https://<Host or X-Forwarded-Host>. Only https is ever taken as one:
 * the gateway listens in clear text on 127.0.0.1, so an https Origin can only come through a TLS
 * front (the preview pane, a tunnel), never from a page that rebinds a DNS name to 127.0.0.1.
 */
import type { IncomingHttpHeaders } from 'node:http';

/** The placeholder the demo build is given for the node proxy's origin. */
export const SELF_HTTP = 'https://x2f-demo-self.invalid';
/** The placeholder the demo build is given for the relay's origin (its URL is SELF_WS + '/relay'). */
export const SELF_WS = 'wss://x2f-demo-self.invalid';

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() ?? '';
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
/** A host[:port] as a URL would spell it; anything else is refused. */
function hostOf(raw: string): string | null {
  if (raw === '' || /[\s/\\@?#]/.test(raw)) return null;
  try {
    const u = new URL(`https://${raw}`);
    return u.host === raw.toLowerCase() ? u.host : null;
  } catch {
    return null;
  }
}

/** Every host this request says it was sent to: Host and each X-Forwarded-Host entry. */
export function requestHosts(h: IncomingHttpHeaders): Set<string> {
  const raw = [h.host ?? '', ...String(h['x-forwarded-host'] ?? '').split(',')];
  const out = new Set<string>();
  for (const r of raw) {
    const host = hostOf(r.trim());
    if (host !== null) out.add(host);
  }
  return out;
}

/** True when `origin` is exactly https://<one of the request's own hosts>. */
export function isSelfOrigin(origin: string | undefined, h: IncomingHttpHeaders): boolean {
  if (typeof origin !== 'string' || !origin.startsWith('https://')) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  return u.origin === origin && requestHosts(h).has(u.host);
}

/**
 * The origin the browser sees for this request: X-Forwarded-Host (else Host), over
 * X-Forwarded-Proto (else http on loopback, https anywhere else: only a TLS front sends one).
 */
export function selfOriginOf(h: IncomingHttpHeaders): { http: string; ws: string } | null {
  const host = hostOf(first(h['x-forwarded-host'])) ?? hostOf(first(h.host));
  if (host === null) return null;
  const xfp = first(h['x-forwarded-proto']).toLowerCase();
  const secure = xfp === 'https' || (xfp !== 'http' && !LOOPBACK.test(host));
  return secure ? { http: `https://${host}`, ws: `wss://${host}` } : { http: `http://${host}`, ws: `ws://${host}` };
}

/** `text` with the placeholders replaced by the request's own origin. */
export function fillSelf(text: string, self: { http: string; ws: string }): string {
  return text.split(SELF_WS).join(self.ws).split(SELF_HTTP).join(self.http);
}

/** The request came through an https front (X-Forwarded-Proto: https). */
export const forwardedHttps = (h: IncomingHttpHeaders): boolean => first(h['x-forwarded-proto']).toLowerCase() === 'https';

/** True for a TCP peer on this machine (127.0.0.0/8, ::1, or either mapped into IPv6). */
export function isLoopbackPeer(address: string | undefined): boolean {
  if (typeof address !== 'string') return false;
  const a = address.toLowerCase().replace(/^::ffff:/, '');
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}
