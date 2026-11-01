/**
 * Proof key payloads carried inside Plan 1 sealed chat envelopes (Plan 5 Task 8).
 *
 * - `proof.attached` is sealed `to: ['buyer', 'seller', 'mod']`: the blurred proof or dispute
 *   evidence, its key and what was hidden.
 * - `proof.unblurred` is sealed `to: ['mod']` only: the unblurred copy's key, so no trader can
 *   read it.
 *
 * Neither carries a file name, original type or anything else about the source file.
 * `parseProofPayload` checks an opened envelope's `{type, payload}` exactly.
 */
import { hasExactKeys, isPlainObject } from '@x2f/protocol';
import type { HiddenKind } from './detect.js';
import { ProofError, isProofId } from './seal.js';

/** P5-A25: the output image's longest side, in pixels. */
export const PROOF_MAX_SIDE = 2600;

export type ProofMime = 'image/png' | 'image/jpeg';
const MIMES: readonly string[] = ['image/png', 'image/jpeg'] satisfies ProofMime[];

const HIDDEN_KINDS = ['name', 'account', 'card', 'iban', 'address', 'phone', 'email', 'handle', 'manual'] as const;
// Compile-time check that HIDDEN_KINDS is exactly HiddenKind.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _hiddenKindsExact: Same<(typeof HIDDEN_KINDS)[number], HiddenKind> = true;
void _hiddenKindsExact;

export interface ProofAttachedPayload {
  proofId: string;
  kind: 'proof' | 'evidence';
  /** base64 (standard alphabet, padded) of the 32-byte key. */
  key: string;
  /** Lower-case hex SHA-256 of the plaintext image. */
  sha256: string;
  width: number;
  height: number;
  mime: ProofMime;
  /** What was blurred, each kind at most once. */
  hidden: HiddenKind[];
}

export interface ProofUnblurredPayload {
  proofId: string;
  key: string;
  sha256: string;
  width: number;
  height: number;
  mime: ProofMime;
}

export type ProofEnvelope =
  | { type: 'proof.attached'; payload: ProofAttachedPayload }
  | { type: 'proof.unblurred'; payload: ProofUnblurredPayload };

const ATTACHED_KEYS = ['proofId', 'kind', 'key', 'sha256', 'width', 'height', 'mime', 'hidden'] as const;
const UNBLURRED_KEYS = ['proofId', 'key', 'sha256', 'width', 'height', 'mime'] as const;
/** 32 bytes in padded standard base64: 42 data characters, a last one with 2 zero bits, '='. */
const KEY_B64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const fail = (): ProofError => new ProofError('bad-payload', 'Invalid proof payload');

const isSide = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= PROOF_MAX_SIDE;

function common(p: Record<string, unknown>): ProofUnblurredPayload {
  const { proofId, key, sha256, width, height, mime } = p;
  if (!isProofId(proofId)) throw fail();
  if (typeof key !== 'string' || !KEY_B64.test(key)) throw fail();
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) throw fail();
  if (!isSide(width) || !isSide(height)) throw fail();
  if (typeof mime !== 'string' || !MIMES.includes(mime)) throw fail();
  return { proofId, key, sha256, width, height, mime: mime as ProofMime };
}

function hiddenList(h: unknown): HiddenKind[] {
  if (!Array.isArray(h) || Object.getPrototypeOf(h) !== Array.prototype || h.length > HIDDEN_KINDS.length) throw fail();
  const seen = new Set<string>();
  for (const k of h as unknown[]) {
    if (typeof k !== 'string' || !(HIDDEN_KINDS as readonly string[]).includes(k) || seen.has(k)) throw fail();
    seen.add(k);
  }
  return [...seen] as HiddenKind[];
}

/**
 * Validate an opened envelope's type and payload. Returns a fresh copy; throws
 * ProofError('bad-payload') for an unknown type, a missing or extra field, a key that is not
 * exactly 32 bytes of canonical base64, a malformed proof id or sha256, a side outside
 * 1..PROOF_MAX_SIDE, a mime other than PNG or JPEG, or `hidden` that is not a set of HiddenKind.
 */
export function parseProofPayload(type: string, payload: unknown): ProofEnvelope {
  if (!isPlainObject(payload)) throw fail();
  if (type === 'proof.attached') {
    if (!hasExactKeys(payload, ATTACHED_KEYS)) throw fail();
    const kind = payload['kind'];
    if (kind !== 'proof' && kind !== 'evidence') throw fail();
    const c = common(payload);
    return { type, payload: { proofId: c.proofId, kind, key: c.key, sha256: c.sha256, width: c.width, height: c.height, mime: c.mime, hidden: hiddenList(payload['hidden']) } };
  }
  if (type === 'proof.unblurred') {
    if (!hasExactKeys(payload, UNBLURRED_KEYS)) throw fail();
    return { type, payload: common(payload) };
  }
  throw fail();
}
