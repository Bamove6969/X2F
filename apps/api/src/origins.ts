/**
 * One check for every exact origin the API takes from its settings (review m-1, m-4 of
 * wip/lead-p5t13-16-ocr): X2F_ORIGINS (config.ts, and the OCR worker CSP in static/serve.ts),
 * X2F_RELAY_ORIGIN and X2F_NODE_PROXY_ORIGIN (the page CSP).
 *
 * `new URL(v).origin === v` alone is not enough for a value that goes into a header: WHATWG URL
 * keeps `;`, `,`, `'` and `*` in a host (`wss://r.test;sandbox` round-trips), and in a CSP a `;`
 * ends the directive and a `,` starts a second policy. So the host must also be plain host-name
 * characters (lower-case letters, digits, hyphens, dots; IDN arrives as xn--) or a bracketed IPv6
 * address, with an optional port.
 */
const PLAIN = /^[a-z][a-z0-9+.-]*:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/** `value` when it is exactly an origin with one of `schemes` (`'https:'`, ...) and a plain host; else null. */
export function plainOrigin(value: string, schemes: ReadonlySet<string>): string | null {
  if (typeof value !== 'string' || !PLAIN.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!schemes.has(url.protocol) || url.origin !== value) return null;
  return value;
}

/** The schemes of the site's own origins (X2F_ORIGINS). */
export const SITE_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:']);
