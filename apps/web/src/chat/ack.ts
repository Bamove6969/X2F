/**
 * The account chat key (ACK) keeper (J-23, S-075 phase 1 groundwork; docs/security/
 * multi-device-2026-11-09.md sections 4.2 and 6.2). Runs inside the escrow worker next to the chat
 * engine, on the chat store's account record: this device's X25519 device key and the ACK it holds.
 *
 * - `devicePublic(handover?)`: the key other devices seal the ACK to; made and saved on first use,
 *   then the same for the life of the record. The secret never leaves the worker. Given a handover
 *   context `{ accountId, epoch }` (this device publishing its key to receive the ACK), it also
 *   starts a pending handover for that account and epoch, open `HANDOVER_WINDOW_MS`.
 * - `makeKey(epoch)`: a fresh random 32-byte ACK when this device holds none (the first strong
 *   device of an account, or the first after a rotation). Never replaces a key already held.
 * - `sealFor(recipientPublic, accountId)`: the box `crypto_box_seal('x2f/ack/v1' || accountId ||
 *   epoch || ACK)` to another device's key (`ackPayload`; @x2f/protocol `sealTo`) as base64url,
 *   with its epoch, for `POST /v1/account/chat-keys`; null when this device holds no key.
 * - `open(envelope)`: a box from `GET /v1/account/chat-keys`, opened with the device secret.
 *   Review F1 (lead 10 Nov): it is taken only while a handover this device started is pending,
 *   and only when the context inside the box is that handover's account and epoch; the epoch
 *   outside the box (the server's field) is ignored. A key held at the same epoch is never
 *   overwritten. Results: `'opened'` (kept; the handover ends), `'already'` (the same key at the
 *   same epoch; the handover ends), `'conflict'` (another key at the epoch held: refused),
 *   `'stale-epoch'` (older than the key held), `'not-pending'` (no handover started, or it ran
 *   out or ended), `'wrong-context'` (another account or epoch, or not an ACK box),
 *   `'not-for-me'` (sealed to another device, tampered or truncated), `'bad-envelope'` (not
 *   base64url, or not the payload's length once opened).
 * - `status()`: whether a key is held and at which epoch; `forget()`: erases the record and the
 *   pending handover (a logout).
 *
 * NEEDS_P12_5_SENDER_PROOF: `crypto_box_seal` does not say who sealed the box, so a party that
 * knows the published device key (the API included) can still seal a key of its choosing into an
 * open handover. The pending window and the context narrow that; proving the sender (a
 * `crypto_box` from the approving device's key, or a signature, bound to the approval and the
 * code of the design note's section 3.3) waits for the p12-5 design. Nothing may seal identity
 * records under a handed-over ACK, or wire `open` to a screen, until that exists.
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

/** The versioned context label at the start of every ACK box. */
export const ACK_CONTEXT = 'x2f/ack/v1';
/** How long a handover this device started stays open for its box (review F1). */
export const HANDOVER_WINDOW_MS = 10 * 60_000;

export type AckOpenResult = 'opened' | 'already' | 'conflict' | 'stale-epoch' | 'not-pending' | 'wrong-context' | 'not-for-me' | 'bad-envelope';

/** The account and epoch a handover is for: what this device expects inside the box. */
export interface HandoverContext {
  /** The account id, a lower-case UUID. */
  accountId: string;
  epoch: number;
}

export interface AckKeeper {
  devicePublic(handover?: HandoverContext): Promise<string>;
  status(): Promise<{ hasKey: boolean; epoch: number | null }>;
  makeKey(epoch: number): Promise<{ epoch: number }>;
  sealFor(recipientPublic: string, accountId: string): Promise<{ sealed: string; epoch: number } | null>;
  /** `epoch` outside the box is accepted for the envelope's shape and ignored. */
  open(envelope: { sealed: string; epoch?: number }): Promise<AckOpenResult>;
  forget(): Promise<void>;
}

export interface AckKeeperDeps {
  store: ChatStore;
  /** The protocol's device key maker (`generateBoxKeyPair`), named by the worker only, as `newIdentity` is. */
  newBoxKeyPair: () => Promise<BoxKeyPair>;
  /** Random bytes (default: `crypto.getRandomValues`). */
  random?: (n: number) => Uint8Array;
  /** Milliseconds now (default: `Date.now`), for the handover window. */
  now?: () => number;
}

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL = new TextEncoder().encode(ACK_CONTEXT);
/** Label (10) + account id (36) + epoch (4, big-endian) + ACK (32). */
const PAYLOAD_BYTES = LABEL.length + 36 + 4 + 32;
const MAX_EPOCH = 2_147_483_647;

const validEpoch = (e: unknown): e is number => typeof e === 'number' && Number.isInteger(e) && e >= 0 && e <= MAX_EPOCH;

/** The plaintext of an ACK box: `'x2f/ack/v1' || accountId || epoch (u32 BE) || ACK`. */
export function ackPayload(accountId: string, epoch: number, key: Uint8Array): Uint8Array {
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) throw new TypeError('ackPayload: bad account id');
  if (!validEpoch(epoch)) throw new TypeError('ackPayload: bad epoch');
  if (!(key instanceof Uint8Array) || key.length !== ACK_BYTES) throw new TypeError('ackPayload: bad key');
  const out = new Uint8Array(PAYLOAD_BYTES);
  out.set(LABEL, 0);
  out.set(new TextEncoder().encode(accountId), LABEL.length);
  new DataView(out.buffer).setUint32(LABEL.length + 36, epoch, false);
  out.set(key, LABEL.length + 40);
  return out;
}

/** The context and key of an opened payload, or null when it is not one of the right length. */
function readPayload(p: Uint8Array): { label: Uint8Array; accountId: string; epoch: number; key: Uint8Array } | null {
  if (p.length !== PAYLOAD_BYTES) return null;
  return {
    label: p.subarray(0, LABEL.length),
    accountId: new TextDecoder().decode(p.subarray(LABEL.length, LABEL.length + 36)),
    epoch: new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(LABEL.length + 36, false),
    key: p.subarray(LABEL.length + 40),
  };
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
  const now = d.now ?? (() => Date.now());
  /** The handover this device started (in memory only: a restarted worker has none). */
  let pending: (HandoverContext & { until: number }) | null = null;
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
    devicePublic: (handover) =>
      serial(async () => {
        if (handover !== undefined) {
          if (typeof handover !== 'object' || handover === null || typeof handover.accountId !== 'string' || !ACCOUNT_ID.test(handover.accountId) || !validEpoch(handover.epoch)) {
            throw new TypeError('devicePublic: bad handover context');
          }
        }
        const pub = (await ensure()).deviceKey.boxPublic;
        if (handover !== undefined) pending = { accountId: handover.accountId, epoch: handover.epoch, until: now() + HANDOVER_WINDOW_MS };
        return pub;
      }),

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

    sealFor: (recipientPublic, accountId) =>
      serial(async () => {
        if (typeof recipientPublic !== 'string' || !HEX_KEY.test(recipientPublic)) throw new TypeError('sealFor: bad recipient key');
        if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) throw new TypeError('sealFor: bad account id');
        const rec = await d.store.loadAccount();
        if (rec?.ack == null) return null;
        const sealed = await sealTo(recipientPublic, ackPayload(accountId, rec.ack.epoch, unhex(rec.ack.key)));
        return { sealed: toBase64Url(sealed), epoch: rec.ack.epoch };
      }),

    open: (envelope) =>
      serial(async (): Promise<AckOpenResult> => {
        if (typeof envelope !== 'object' || envelope === null) return 'bad-envelope';
        // The epoch outside the box is the server's word: ignored (review F1).
        const { sealed } = envelope;
        const bytes = typeof sealed === 'string' ? fromBase64Url(sealed) : null;
        if (bytes === null) return 'bad-envelope';
        if (pending === null || now() >= pending.until) {
          pending = null;
          return 'not-pending';
        }
        const want = pending;
        const rec = await ensure();
        let plain: Uint8Array;
        try {
          plain = await openSealed({ boxPublic: rec.deviceKey.boxPublic, boxSecret: unhex(rec.deviceKey.boxSecret) }, bytes);
        } catch (e) {
          if ((e as { name?: unknown } | null)?.name === 'ProtocolError') return 'not-for-me';
          throw e;
        }
        const box = readPayload(plain);
        if (box === null) return 'bad-envelope';
        if (!box.label.every((b, k) => b === LABEL[k]) || box.accountId !== want.accountId || box.epoch !== want.epoch) return 'wrong-context';
        const keyHex = hex(box.key);
        if (rec.ack !== null) {
          if (rec.ack.epoch > box.epoch) return 'stale-epoch';
          if (rec.ack.epoch === box.epoch) {
            if (rec.ack.key !== keyHex) return 'conflict';
            pending = null;
            return 'already';
          }
        }
        await d.store.saveAccount({ ...rec, ack: { key: keyHex, epoch: box.epoch } });
        pending = null;
        return 'opened';
      }),

    forget: () =>
      serial(async () => {
        pending = null;
        await d.store.deleteAccount();
      }),
  };
}
