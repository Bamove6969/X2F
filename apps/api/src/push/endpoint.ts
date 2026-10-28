import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/** Longest endpoint accepted; real ones are a few hundred characters. */
export const ENDPOINT_MAX = 1024;

/**
 * Push services a browser subscription may point at (Chrome and most Chromium browsers, Firefox,
 * Safari, Edge). The API POSTs to the endpoint, so any other host would let a caller aim the
 * server at a URL of their choosing (SSRF). A host matches itself or any subdomain.
 */
export const PUSH_SERVICE_DOMAINS: readonly string[] = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

/** One DNS label: lower-case ASCII letters, digits and inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The endpoint as a URL when it is safe to POST to, else null. Shared by the subscribe route and
 * the sender, so a row that got into the table some other way is never sent to.
 *
 * Only the canonical form passes: `raw` must equal its own WHATWG `href`, which refuses every
 * parser trick that changes the URL when parsed (backslashes, tabs and spaces, percent-encoded or
 * upper-case hosts, numeric IPv4 forms, non-ASCII dots, `:443`). Then: https, no userinfo, no
 * port, no fragment, a host of plain DNS labels (no IP literal, no trailing dot) that is a push
 * service on the list.
 */
export function canonicalEndpoint(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > ENDPOINT_MAX) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.href !== raw || raw.includes('#')) return null;
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const host = url.hostname;
  if (!host.split('.').every((l) => LABEL.test(l))) return null;
  if (!PUSH_SERVICE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  return url;
}

/** IPv4 ranges that are not the public internet (RFC 6890 special-purpose and the like). */
const V4_PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  V4_PRIVATE.addSubnet(net, prefix, 'ipv4');
}

/** IPv6: only global unicast (2000::/3) counts as public. */
const V6_GLOBAL = new BlockList();
V6_GLOBAL.addSubnet('2000::', 3, 'ipv6');
/** Inside 2000::/3 but not public, or embedding an IPv4 address (Teredo, 6to4), or documentation. */
const V6_PRIVATE = new BlockList();
for (const [net, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  V6_PRIVATE.addSubnet(net, prefix, 'ipv6');
}

/**
 * True only for a public unicast address. IPv4-mapped (`::ffff:…`), NAT64 (`64:ff9b::/96`),
 * link-local, unique-local, loopback and unspecified IPv6 all fall outside 2000::/3 and are refused.
 */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return !V4_PRIVATE.check(ip, 'ipv4');
  if (v === 6) return V6_GLOBAL.check(ip, 'ipv6') && !V6_PRIVATE.check(ip, 'ipv6');
  return false;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
/** The shape of `dns.lookup` as net/tls `lookup` options call it. */
export type LookupFn = (hostname: string, options: object, callback: LookupCallback) => void;

/**
 * A `lookup` for the push agent: resolves every address of the host and refuses the connection
 * if any one is not public, so a push-service name that resolves (or is rebound) to an internal
 * address is never connected to. The address checked is the address connected to.
 */
export function publicOnlyLookup(lookup: LookupFn = dnsLookup as unknown as LookupFn): LookupFn {
  return (hostname, options, callback) => {
    const opts = (typeof options === 'object' && options !== null ? options : {}) as { all?: boolean };
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0 || !list.every((a) => isPublicAddress(a.address))) {
        return callback(new Error('push: refused address'), []);
      }
      if (opts.all) return callback(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };
}
