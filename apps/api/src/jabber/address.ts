/**
 * A user's Jabber address (owner rule p5-7): checked, sealed at rest under X2F_JABBER_KEYS with the
 * key store every sealed secret uses (auth/keystore.ts), and shown only masked. The address is
 * never logged and never sent back in full.
 */
import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';
import { keyringBox, type SecretBox } from '../auth/keystore.js';
import { BARE_JID, type Config, type Keyring } from '../config.js';

/** The address as stored and sent to: trimmed, lower-cased, bare. Null when it is not one. */
export function normalizeJid(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 320) return null;
  const jid = raw.trim().toLowerCase();
  return BARE_JID.test(jid) ? jid : null;
}

/**
 * The board's mask: the first four characters, an ellipsis, then the server (`mira…@xmpp.example.org`).
 * A local part of four characters or fewer shows only its first character (review L3), so the
 * mask never gives back a whole short address (`b…@xmpp.org`, not `bob…@xmpp.org`).
 */
export function maskJid(jid: string): string {
  const at = jid.indexOf('@');
  return `${jid.slice(0, at > 4 ? 4 : 1)}…${jid.slice(at)}`;
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

/**
 * HMAC-SHA-256 of the code, bound to the account (the code itself is never stored), under a subkey
 * of the ring's current key: HKDF-SHA-256, info `x2f/jabber-code` (review L7: the raw key is the
 * AES-GCM sealing key and is not used by a second primitive). A key rotation between the test
 * message and the code makes the code fail; the user sends a new test message.
 */
export function codeHash(config: Pick<Config, 'jabberKeys'>, accountId: string, code: string): Buffer {
  const ring = config.jabberKeys!;
  const subkey = Buffer.from(hkdfSync('sha256', ring.keys.get(ring.current)!, new Uint8Array(0), 'x2f/jabber-code', 32));
  return createHmac('sha256', subkey).update(`${accountId}\0${code}`).digest();
}

export function codeMatches(config: Pick<Config, 'jabberKeys'>, accountId: string, code: string, stored: Buffer): boolean {
  const h = codeHash(config, accountId, code);
  return stored.length === h.length && timingSafeEqual(stored, h);
}
