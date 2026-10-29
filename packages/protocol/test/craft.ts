/**
 * Test-only envelope crafting. Plays a participant who holds a valid signing key but
 * builds the envelope by hand: arbitrary padded plaintext, per-role content keys
 * (equivocation), forged key hashes, custom signature domain. Kept out of src on purpose.
 */
import sodium from 'libsodium-wrappers';
import type { Role } from '@x2f/core';
import type { Envelope, Identity, Participants } from '../src/index.js';

const ROLE_LIST: Role[] = ['buyer', 'seller', 'mod'];
export const DOMAIN = 'x2f/envelope/v1\0';
export const BUCKETS = [256, 1024, 4096, 16384, 65536] as const;

/** Sorted keys, no whitespace. */
export function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(',')}}`;
}

/** ISO/IEC 7816-4 padding to the smallest bucket. */
export function pad(bytes: Uint8Array): Uint8Array {
  const bucket = BUCKETS.find((b) => b >= bytes.length + 1);
  if (bucket === undefined) throw new Error('too large for test pad');
  const out = new Uint8Array(bucket);
  out.set(bytes);
  out[bytes.length] = 0x80;
  return out;
}

export const b64 = (b: Uint8Array): string => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);

export interface CraftArgs {
  sender: Identity;
  from: Role;
  trade: string;
  seq: number;
  participants: Participants;
  /** Exact bytes to secretbox (already padded, or deliberately not). */
  padded: Uint8Array;
  /** Roles that get a real wrapped key; others get 48 random bytes. */
  wrapTo: Role[];
  /** Content key used for ct (default random). */
  key?: Uint8Array;
  /** Per-role key to wrap instead of `key` (equivocation). */
  keyFor?: Partial<Record<Role, Uint8Array>>;
  /** Key hashed into kh (default `key`). */
  khKey?: Uint8Array;
  /** Signature domain (default the real one). */
  domain?: string;
}

export function craft(a: CraftArgs): Envelope {
  const key = a.key ?? sodium.randombytes_buf(32);
  const ctNonce = sodium.randombytes_buf(24);
  const ct = sodium.crypto_secretbox_easy(a.padded, ctNonce, key);
  const nonce = sodium.randombytes_buf(24);
  const slots = {} as Record<Role, string>;
  for (const r of ROLE_LIST) {
    if (a.wrapTo.includes(r)) {
      const k = a.keyFor?.[r] ?? key;
      slots[r] = b64(sodium.crypto_box_easy(k, nonce, sodium.from_hex(a.participants[r].boxPublic), a.sender.boxSecret));
    } else {
      slots[r] = b64(sodium.randombytes_buf(48));
    }
  }
  const unsigned = {
    v: 1 as const,
    trade: a.trade,
    from: a.from,
    seq: a.seq,
    slots,
    nonce: b64(nonce),
    kh: sodium.to_hex(sodium.crypto_generichash(32, a.khKey ?? key, null)),
    ct: b64(ct),
    ctNonce: b64(ctNonce),
  };
  return { ...unsigned, sig: resign(unsigned, a.sender, a.domain) };
}

/** Sign an arbitrary unsigned envelope body. */
export function resign(unsigned: object, signer: Identity, domain = DOMAIN): string {
  return sodium.to_hex(sodium.crypto_sign_detached(sodium.from_string(domain + canon(unsigned)), signer.signSecret));
}

/** Replace fields and re-sign with `signer` (keeps the signature valid). */
export function patchAndSign(e: Envelope, patch: Partial<Envelope>, signer: Identity): Envelope {
  const { sig: _sig, ...rest } = { ...e, ...patch };
  void _sig;
  return { ...rest, sig: resign(rest, signer) } as Envelope;
}
