/**
 * Per-image proof encryption (Plan 5 Task 8).
 *
 * Every proof image gets a fresh random 32-byte key and 24-byte nonce and is encrypted with
 * XChaCha20-Poly1305 (libsodium `crypto_aead_xchacha20poly1305_ietf_*`). The key never reaches
 * the API: it travels inside a Plan 1 sealed chat envelope (`payloads.ts`), and the API stores
 * only the ciphertext.
 *
 * Ciphertext layout: `nonce (24 bytes) ‖ AEAD output (plaintext length + 16-byte Poly1305 tag)`.
 *
 * Associated data binds the ciphertext to its place:
 *   "x2f/proof/v1\0" + normalizeTradeCode(code) + "\0" + proofId + "\0" + kind
 * so a ciphertext moved to another trade, proof id or kind does not open.
 *
 * `sha256` is SHA-256 of the plaintext image, lower-case hex. It is carried in the envelope
 * payload and checked after decryption.
 *
 * Browser-safe: libsodium and WebCrypto only, no Node-only APIs.
 */
import sodium from 'libsodium-wrappers';
import { normalizeTradeCode } from '@x2f/core';

export type ProofKind = 'proof' | 'evidence' | 'unblurred';
export const PROOF_KINDS: readonly ProofKind[] = ['proof', 'evidence', 'unblurred'];

export type ProofErrorCode = 'bad-ciphertext' | 'bad-payload';

/** Refusals of untrusted proof data. Messages never carry ids, codes or bytes. */
export class ProofError extends Error {
  readonly code: ProofErrorCode;
  constructor(code: ProofErrorCode, message: string) {
    super(message);
    this.name = 'ProofError';
    this.code = code;
  }
}

export interface ProofBinding {
  code: string;
  proofId: string;
  kind: ProofKind;
}

const AAD_DOMAIN = 'x2f/proof/v1\0';
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const PROOF_ID_BYTES = 16;
/** Crockford base32, as in @x2f/core's trade codes. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 16 bytes = 128 bits = 26 base32 characters; the last carries 3 data bits and 2 zero bits. */
const PROOF_ID = /^[0-9A-HJKMNP-TV-Z]{25}[048CGMRW]$/;
const utf8 = new TextEncoder();

export function isProofId(x: unknown): x is string {
  return typeof x === 'string' && PROOF_ID.test(x);
}

/** 16 random bytes as 26 upper-case Crockford base32 characters (big-endian, zero-padded bits). */
export function newProofId(): string {
  const bytes = new Uint8Array(PROOF_ID_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

function aad(a: ProofBinding, where: string): Uint8Array {
  if (typeof a !== 'object' || a === null) throw new TypeError(`${where}: invalid binding`);
  const code = typeof a.code === 'string' ? normalizeTradeCode(a.code) : null;
  if (code === null) throw new TypeError(`${where}: invalid trade code`);
  if (!isProofId(a.proofId)) throw new TypeError(`${where}: invalid proof id`);
  if (!PROOF_KINDS.includes(a.kind)) throw new TypeError(`${where}: invalid kind`);
  return utf8.encode(`${AAD_DOMAIN}${code}\0${a.proofId}\0${a.kind}`);
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  // A copy: WebCrypto takes only ArrayBuffer-backed views, and `b` may be a view of anything.
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(b)));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}

/** Encrypt one cleaned proof image under a fresh key and nonce. The caller zeroes `key` when done. */
export async function encryptProof(
  plain: Uint8Array,
  a: ProofBinding,
): Promise<{ ciphertext: Uint8Array; key: Uint8Array; sha256: string }> {
  if (!(plain instanceof Uint8Array)) throw new TypeError('encryptProof: plain must be a Uint8Array');
  const ad = aad(a, 'encryptProof');
  await sodium.ready;
  const key = sodium.randombytes_buf(KEY_BYTES);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, ad, null, nonce, key);
  const ciphertext = new Uint8Array(NONCE_BYTES + sealed.length);
  ciphertext.set(nonce);
  ciphertext.set(sealed, NONCE_BYTES);
  return { ciphertext, key, sha256: await sha256Hex(plain) };
}

/**
 * Decrypt a proof ciphertext. Throws ProofError('bad-ciphertext') when the key, layout, trade
 * code, proof id or kind do not match (AEAD failure), and also when the decrypted image's
 * SHA-256 differs from `a.sha256`. Invalid arguments throw TypeError.
 */
export async function decryptProof(
  ciphertext: Uint8Array,
  key: Uint8Array,
  a: ProofBinding & { sha256: string },
): Promise<Uint8Array> {
  if (!(ciphertext instanceof Uint8Array) || !(key instanceof Uint8Array)) {
    throw new TypeError('decryptProof: ciphertext and key must be Uint8Array');
  }
  const ad = aad(a, 'decryptProof');
  if (typeof a.sha256 !== 'string') throw new TypeError('decryptProof: invalid sha256');
  const fail = (): ProofError => new ProofError('bad-ciphertext', 'Proof does not decrypt');
  if (key.length !== KEY_BYTES || ciphertext.length < NONCE_BYTES + TAG_BYTES) throw fail();
  await sodium.ready;
  let plain: Uint8Array;
  try {
    plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext.subarray(NONCE_BYTES),
      ad,
      ciphertext.subarray(0, NONCE_BYTES),
      key,
    );
  } catch {
    throw fail();
  }
  if ((await sha256Hex(plain)) !== a.sha256) {
    sodium.memzero(plain);
    throw fail();
  }
  return plain;
}
