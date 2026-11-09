/**
 * A user's Jabber address (owner rule p5-7): checked, sealed at rest under X2F_JABBER_KEYS with the
 * key store every sealed secret uses (auth/keystore.ts), and shown only masked. The address is
 * never logged and never sent back in full.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { keyringBox, type SecretBox } from '../auth/keystore.js';
import { BARE_JID, type Config, type Keyring } from '../config.js';

/** The address as stored and sent to: trimmed, lower-cased, bare. Null when it is not one. */
export function normalizeJid(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 320) return null;
  const jid = raw.trim().toLowerCase();
  return BARE_JID.test(jid) ? jid : null;
}

/** The board's mask: up to the first four characters, an ellipsis, then the server (`mira…@xmpp.example.org`). */
export function maskJid(jid: string): string {
  const at = jid.indexOf('@');
  return `${jid.slice(0, Math.min(4, at))}…${jid.slice(at)}`;
}

const boxes = new WeakMap<Keyring, SecretBox>();
function box(ring: Keyring): SecretBox {
  let b = boxes.get(ring);
  if (!b) boxes.set(ring, (b = keyringBox(ring)));
  return b;
}

/** Bound to the account, so a blob cannot be moved to another account's row. */
const context = (accountId: string) => `x2f/jabber-address/${accountId}`;

export function sealJid(ring: Keyring, accountId: string, jid: string): Buffer {
  return box(ring).seal(new TextEncoder().encode(jid), context(accountId));
}

/** Throws if the blob does not open (a removed key, another account's blob, tampering). */
export function openJid(ring: Keyring, accountId: string, sealed: Buffer): string {
  const jid = new TextDecoder().decode(box(ring).open(sealed, context(accountId)));
  if (!BARE_JID.test(jid)) throw new Error('jabber: sealed address is malformed');
  return jid;
}

/** Six random digits. */
export const newTestCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** HMAC-SHA-256 of the code under the ring's current key, bound to the account (the code itself is never stored). */
export function codeHash(config: Pick<Config, 'jabberKeys'>, accountId: string, code: string): Buffer {
  const ring = config.jabberKeys!;
  return createHmac('sha256', ring.keys.get(ring.current)!).update(`x2f/jabber-code\0${accountId}\0${code}`).digest();
}

export function codeMatches(config: Pick<Config, 'jabberKeys'>, accountId: string, code: string, stored: Buffer): boolean {
  const h = codeHash(config, accountId, code);
  return stored.length === h.length && timingSafeEqual(stored, h);
}
