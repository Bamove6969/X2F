/**
 * Past reputation (Plan 5 Task 10; spec 5.5): the sites, the archive hosts, the evidence-link
 * check and the exact text the trader signs with their old key.
 *
 * The evidence link is checked by syntax only (P5-A20, review 2026-10-24): no DNS lookup and no
 * fetch, ever (tools/semgrep/pastrep-no-fetch.yml). The moderator opens it in their own browser.
 */
import { randomBytes } from 'node:crypto';
import { ApiError } from '../errors.js';

/** P5-A21. */
export const PAST_REP_SITES = ['LocalMonero', 'AgoraDesk', 'LocalBitcoins', 'Paxful', 'Hodl Hodl', 'Bisq', 'Other'] as const;
export type PastRepSite = (typeof PAST_REP_SITES)[number];

/** P5-A20: the only hosts an evidence link may name. */
export const PAST_REP_ARCHIVE_HOSTS = ['web.archive.org', 'archive.ph', 'archive.today', 'archive.is'] as const;

/** How long a challenge can be finished. */
export const PAST_REP_CHALLENGE_MINUTES = 60;

/** Longest evidence link accepted (an archive URL wraps the old one, so allow room). */
export const PAST_REP_URL_MAX = 2048;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 Crockford base32 characters (80 bits) from the OS random generator. */
export function pastRepNonce(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

/** A fingerprint uppercase in groups of 4: `ABCD EF01 …`. */
export function groupFingerprint(fingerprint: string): string {
  return (fingerprint.toUpperCase().match(/.{1,4}/g) ?? []).join(' ');
}

const isoSeconds = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;

/** The exact text the trader signs (Task 10 interface). */
export function pastRepChallenge(a: {
  origin: string;
  displayName: string;
  site: string;
  url: string;
  fingerprint: string;
  nonce: string;
  issuedAt: Date;
}): string {
  return [
    'X2F past reputation proof',
    `Site: ${a.origin}`,
    `X2F name: ${a.displayName}`,
    `Old site: ${a.site}`,
    `Old profile: ${a.url}`,
    `Key: ${groupFingerprint(a.fingerprint)}`,
    `Nonce: ${a.nonce}`,
    `Issued: ${isoSeconds(a.issuedAt)}`,
  ].join('\n');
}

/** The `Issued:` time of a text `pastRepChallenge` made, or null. */
export function issuedAtOf(text: string): Date | null {
  const m = /^Issued: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/m.exec(text);
  if (!m) return null;
  const t = Date.parse(m[1]!);
  return Number.isNaN(t) ? null : new Date(t);
}

/** 400 `bad-site` unless one of PAST_REP_SITES exactly. */
export function checkSite(site: unknown): PastRepSite {
  if (typeof site !== 'string' || !(PAST_REP_SITES as readonly string[]).includes(site)) throw new ApiError(400, 'bad-site');
  return site as PastRepSite;
}

/**
 * 400 `bad-url` unless `https:`, the hostname (lower case, no trailing dot) exactly one of
 * PAST_REP_ARCHIVE_HOSTS, no userinfo and no port. Purely syntactic: `new URL()` only. Returns the
 * parsed link's `href` (the form stored and shown). A line break or other control character, which
 * the URL parser would silently drop, is refused too, so the link in the signed text is the one stored.
 */
export function checkEvidenceUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0 || url.length > PAST_REP_URL_MAX) throw new ApiError(400, 'bad-url');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f\\]/.test(url)) throw new ApiError(400, 'bad-url');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ApiError(400, 'bad-url');
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') throw new ApiError(400, 'bad-url');
  if (!(PAST_REP_ARCHIVE_HOSTS as readonly string[]).includes(u.hostname)) throw new ApiError(400, 'bad-url');
  // The authority as typed must be the bare host: no `:443`, which the parser would drop.
  const typed = url.toLowerCase();
  if (typed !== `https://${u.hostname}` && !typed.startsWith(`https://${u.hostname}/`)) throw new ApiError(400, 'bad-url');
  if (u.href.length > PAST_REP_URL_MAX) throw new ApiError(400, 'bad-url');
  return u.href;
}
