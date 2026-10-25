/**
 * The key store for sealed secrets (FU-C, ASVS 2.8.2). Today TOTP secrets are sealed with keys from
 * their own config secret (`X2F_TOTP_KEYS`, env or file), separate from `X2F_SERVER_KEY`; an HSM or
 * KMS (Plan 6) replaces `keyringBox` behind the same `SecretBox` interface.
 *
 * Blob formats (the first byte says which):
 * - `0x01 ‖ key id (u16 BE) ‖ nonce (12) ‖ AES-256-GCM ciphertext ‖ tag (16)`, the associated data
 *   being the 3-byte header followed by the context, so neither the key id nor the context can be
 *   swapped. Written by `seal`.
 * - `0x00 ‖ nonce (12) ‖ ciphertext ‖ tag (16)` under the legacy key with the context alone as
 *   associated data: Plan 2's sealing under `subkey('totp')`, marked by migration 011. Opened only,
 *   never written, until `rewrapTotpSecrets` has moved every such blob.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Keyring } from '../config.js';

export interface SecretBox {
  /** Seals `plain` under the current key, bound to `context`. */
  seal(plain: Uint8Array, context: string): Buffer;
  /** Throws when the blob is malformed, tampered with, bound to another context or its key is gone. */
  open(sealed: Buffer, context: string): Uint8Array;
  /** True when the blob is in the newest format under the current key (nothing to rewrap). */
  isCurrent(sealed: Buffer): boolean;
}

const FORMAT_LEGACY = 0x00;
const FORMAT_V1 = 0x01;
const HEADER = 3;
const NONCE = 12;
const TAG = 16;

function gcmOpen(key: Uint8Array, nonce: Buffer, body: Buffer, tag: Buffer, aad: Buffer): Uint8Array {
  const d = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG });
  d.setAAD(aad);
  d.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([d.update(body), d.final()]));
}

/** The file/env-backed key store: AES-256-GCM under the keys of `ring`; `legacyKey` opens format 0. */
export function keyringBox(ring: Keyring, legacyKey?: Uint8Array): SecretBox {
  const header = (id: number) => Buffer.from([FORMAT_V1, id >> 8, id & 0xff]);
  const keyOf = (id: number) => {
    const k = ring.keys.get(id);
    if (k === undefined) throw new Error(`sealed secret uses key ${id}, which the key ring no longer holds`);
    return k;
  };
  return {
    seal(plain, context) {
      const head = header(ring.current);
      const nonce = randomBytes(NONCE);
      const c = createCipheriv('aes-256-gcm', keyOf(ring.current), nonce, { authTagLength: TAG });
      c.setAAD(Buffer.concat([head, Buffer.from(context, 'utf8')]));
      const body = Buffer.concat([c.update(plain), c.final()]);
      return Buffer.concat([head, nonce, body, c.getAuthTag()]);
    },
    open(sealed, context) {
      if (sealed.length < 1) throw new Error('sealed secret is malformed');
      const ctx = Buffer.from(context, 'utf8');
      if (sealed[0] === FORMAT_V1) {
        if (sealed.length < HEADER + NONCE + TAG) throw new Error('sealed secret is malformed');
        const head = sealed.subarray(0, HEADER);
        const id = (sealed[1]! << 8) | sealed[2]!;
        return gcmOpen(
          keyOf(id), sealed.subarray(HEADER, HEADER + NONCE), sealed.subarray(HEADER + NONCE, sealed.length - TAG),
          sealed.subarray(sealed.length - TAG), Buffer.concat([head, ctx]),
        );
      }
      if (sealed[0] === FORMAT_LEGACY) {
        if (sealed.length < 1 + NONCE + TAG) throw new Error('sealed secret is malformed');
        if (legacyKey === undefined) throw new Error('sealed secret is format 0 and no legacy key is configured');
        return gcmOpen(
          legacyKey, sealed.subarray(1, 1 + NONCE), sealed.subarray(1 + NONCE, sealed.length - TAG),
          sealed.subarray(sealed.length - TAG), ctx,
        );
      }
      throw new Error('sealed secret has an unknown format');
    },
    isCurrent(sealed) {
      return sealed.length >= HEADER + NONCE + TAG && sealed.subarray(0, HEADER).equals(header(ring.current));
    },
  };
}
