/**
 * The account chat key (ACK) keeper (J-23, S-075 phase 1 groundwork; docs/security/
 * multi-device-2026-11-09.md sections 4.2 and 6.2). Runs inside the escrow worker next to the chat
 * engine, on the chat store's account record: this device's X25519 device key and the ACK it holds.
 *
 * - `devicePublic()`: the key other devices seal the ACK to; made and saved on first use, then the
 *   same for the life of the record. The secret never leaves the worker.
 * - `makeKey(epoch)`: a fresh random 32-byte ACK when this device holds none (the first strong
 *   device of an account, or the first after a rotation). Never replaces a key already held.
 * - `sealFor(recipientPublic)`: the ACK sealed to another device's key (`crypto_box_seal`,
 *   @x2f/protocol `sealTo`) as base64url, with its epoch, for `POST /v1/account/chat-keys`; null
 *   when this device holds no key.
 * - `open(envelope)`: an envelope from `GET /v1/account/chat-keys`, opened with the device secret
 *   and kept as this device's ACK. `'opened'`, or `'already'` (the same key at the same epoch),
 *   `'stale-epoch'` (an older epoch than the key held), `'not-for-me'` (sealed to another device,
 *   tampered or truncated), `'bad-envelope'` (not base64url, or not a 32-byte key once opened).
 * - `status()`: whether a key is held and at which epoch; `forget()`: erases the record (a logout).
 *
 * Nothing here opens identity records or changes the engine's `other-device` rule yet: that is
 * section 4.2 rule 2, after the handover gesture (owner p12-5) is decided. No key, in any form, is
 * ever in a result: callers get hex public keys, base64url ciphertext and words.
 */
import type { BoxKeyPair } from '@x2f/protocol';
import { openSealed, sealTo } from '@x2f/protocol';
import type { ChatAccountRecord, ChatStore } from './store.js';

/** The ACK's length in bytes. */
export const ACK_BYTES = 32;

export type AckOpenResult = 'opened' | 'already' | 'stale-epoch' | 'not-for-me' | 'bad-envelope';

export interface AckKeeper {
  devicePublic(): Promise<string>;
  status(): Promise<{ hasKey: boolean; epoch: number | null }>;
  makeKey(epoch: number): Promise<{ epoch: number }>;
  sealFor(recipientPublic: string): Promise<{ sealed: string; epoch: number } | null>;
  open(envelope: { sealed: string; epoch: number }): Promise<AckOpenResult>;
  forget(): Promise<void>;
}

export interface AckKeeperDeps {
  store: ChatStore;
  /** The protocol's device key maker (`generateBoxKeyPair`), named by the worker only, as `newIdentity` is. */
  newBoxKeyPair: () => Promise<BoxKeyPair>;
  /** Random bytes (default: `crypto.getRandomValues`). */
  random?: (n: number) => Uint8Array;
}

const HEX_KEY = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export const toBase64Url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** The bytes of a base64url string, or null when it is not one. */
export function fromBase64Url(s: string): Uint8Array | null {
  if (typeof s !== 'string' || s.length === 0 || !B64URL.test(s)) return null;
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  } catch {
    return null;
  }
  const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return toBase64Url(out) === s ? out : null;
}

export function createAckKeeper(d: AckKeeperDeps): AckKeeper {
  const random = d.random ?? ((n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  /** One operation at a time: the record is read, changed and written whole. */
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  /** The record, made (with a fresh device key) when there is none. */
  async function ensure(): Promise<ChatAccountRecord> {
    const rec = await d.store.loadAccount();
    if (rec !== null) return rec;
    const kp = await d.newBoxKeyPair();
    const fresh: ChatAccountRecord = { v: 1, deviceKey: { boxPublic: kp.boxPublic, boxSecret: hex(kp.boxSecret) }, ack: null };
    await d.store.saveAccount(fresh);
    return fresh;
  }

  return {
    devicePublic: () => serial(async () => (await ensure()).deviceKey.boxPublic),

    status: () =>
      serial(async () => {
        const rec = await d.store.loadAccount();
        return rec?.ack ? { hasKey: true, epoch: rec.ack.epoch } : { hasKey: false, epoch: null };
      }),

    makeKey: (epoch) =>
      serial(async () => {
        if (!Number.isInteger(epoch) || epoch < 0) throw new TypeError('makeKey: bad epoch');
        const rec = await ensure();
        if (rec.ack !== null) return { epoch: rec.ack.epoch };
        const next: ChatAccountRecord = { ...rec, ack: { key: hex(random(ACK_BYTES)), epoch } };
        await d.store.saveAccount(next);
        return { epoch };
      }),

    sealFor: (recipientPublic) =>
      serial(async () => {
        if (typeof recipientPublic !== 'string' || !HEX_KEY.test(recipientPublic)) throw new TypeError('sealFor: bad recipient key');
        const rec = await d.store.loadAccount();
        if (rec?.ack == null) return null;
        const sealed = await sealTo(recipientPublic, unhex(rec.ack.key));
        return { sealed: toBase64Url(sealed), epoch: rec.ack.epoch };
      }),

    open: (envelope) =>
      serial(async () => {
        if (typeof envelope !== 'object' || envelope === null) return 'bad-envelope';
        const { sealed, epoch } = envelope;
        if (!Number.isInteger(epoch) || epoch < 0) return 'bad-envelope';
        const bytes = typeof sealed === 'string' ? fromBase64Url(sealed) : null;
        if (bytes === null) return 'bad-envelope';
        const rec = await ensure();
        if (rec.ack !== null && rec.ack.epoch > epoch) return 'stale-epoch';
        let key: Uint8Array;
        try {
          key = await openSealed({ boxPublic: rec.deviceKey.boxPublic, boxSecret: unhex(rec.deviceKey.boxSecret) }, bytes);
        } catch (e) {
          if ((e as { name?: unknown } | null)?.name === 'ProtocolError') return 'not-for-me';
          throw e;
        }
        if (key.length !== ACK_BYTES) return 'bad-envelope';
        const keyHex = hex(key);
        if (rec.ack !== null && rec.ack.epoch === epoch && rec.ack.key === keyHex) return 'already';
        await d.store.saveAccount({ ...rec, ack: { key: keyHex, epoch } });
        return 'opened';
      }),

    forget: () => serial(() => d.store.deleteAccount()),
  };
}
