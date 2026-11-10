/**
 * Proof key payloads carried inside Plan 1 sealed chat envelopes (Plan 5 Task 8).
 *
 * - `proof.attached` is sealed `to: ['buyer', 'seller', 'mod']`: the blurred proof or dispute
 *   evidence, its key and what was hidden.
 * - `proof.unblurred` is sealed `to: ['mod']` only: the unblurred copy's key, so no trader can
 *   read it.
 *
 * The recipients are fixed by type in PROOF_RECIPIENTS; senders seal only through
 * `sealProofEnvelope`, which takes no `to` and refuses one, so an unblurred key can never be
 * sealed to a trader by a wrong call site.
 *
 * Neither carries a file name, original type or anything else about the source file, except
 * `proof.attached`'s `photoTakenAt`: the time the picture was made, read from its own metadata on
 * the poster's device before cleaning (owner G16), as a UTC instant to the second, or null. The
 * metadata block itself never leaves the device. (Named so as not to be confused with a trade's
 * `takenAt`, when the trade was taken.)
 * `parseProofPayload` checks an opened envelope's `{type, payload}` exactly.
 */
import sodium from 'libsodium-wrappers';
import { hasExactKeys, isPlainObject, seal, type Envelope, type SealArgs } from '@x2f/protocol';
import type { HiddenKind } from './detect.js';
import { ProofError, SHA256_HEX, isProofId } from './seal.js';

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
  /**
   * When the picture was made, from its own Exif/XMP date (owner G16): `YYYY-MM-DDTHH:MM:SSZ`, or
   * null. Always written; an envelope without it (a client from before the field) parses as null.
   */
  photoTakenAt: string | null;
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

const ATTACHED_KEYS = ['proofId', 'kind', 'key', 'sha256', 'width', 'height', 'mime', 'hidden', 'photoTakenAt'] as const;
/** `proof.attached` keys an older client leaves out (review 2026-11-10 finding 6: backward compatible). */
const ATTACHED_OPTIONAL: readonly string[] = ['photoTakenAt'];
const UNBLURRED_KEYS = ['proofId', 'key', 'sha256', 'width', 'height', 'mime'] as const;
/** 32 bytes in padded standard base64: 42 data characters, a last one with 2 zero bits, '='. */
const KEY_B64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

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

const UTC_SECOND = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** `YYYY-MM-DDTHH:MM:SSZ` naming a real instant in 1990..2200, as `toUtcSecond` writes it. */
export function isUtcSecond(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = UTC_SECOND.exec(s);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  const y = Number(m[1]);
  return y >= 1990 && y <= 2200 && toUtcSecond(new Date(t)) === s;
}

/** A time as `proof.attached` carries it: UTC, to the second (`2026-10-16T12:32:05Z`). */
export function toUtcSecond(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function photoTakenAtOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (!isUtcSecond(v)) throw fail();
  return v;
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
 * 1..PROOF_MAX_SIDE, a mime other than PNG or JPEG, `hidden` that is not a set of HiddenKind, or a
 * `photoTakenAt` that is neither null nor `isUtcSecond`. A missing `photoTakenAt` is null.
 */
export function parseProofPayload(type: string, payload: unknown): ProofEnvelope {
  if (!isPlainObject(payload)) throw fail();
  if (type === 'proof.attached') {
    const missing = ATTACHED_OPTIONAL.filter((k) => !Object.prototype.hasOwnProperty.call(payload, k));
    if (!hasExactKeys(payload, ATTACHED_KEYS.filter((k) => !missing.includes(k)))) throw fail();
    const kind = payload['kind'];
    if (kind !== 'proof' && kind !== 'evidence') throw fail();
    const c = common(payload);
    return { type, payload: { proofId: c.proofId, kind, key: c.key, sha256: c.sha256, width: c.width, height: c.height, mime: c.mime, hidden: hiddenList(payload['hidden']), photoTakenAt: photoTakenAtOf(payload['photoTakenAt']) } };
  }
  if (type === 'proof.unblurred') {
    if (!hasExactKeys(payload, UNBLURRED_KEYS)) throw fail();
    return { type, payload: common(payload) };
  }
  throw fail();
}

/** Who each proof envelope is sealed to. `proof.unblurred` is the moderator only (spec 6.6). */
export const PROOF_RECIPIENTS = Object.freeze({
  'proof.attached': Object.freeze(['buyer', 'seller', 'mod'] as const),
  'proof.unblurred': Object.freeze(['mod'] as const),
});

/** Plan 1 seal arguments without `type`, `payload` and `to`, which come from the proof envelope. */
export type ProofSealArgs = Omit<SealArgs, 'type' | 'payload' | 'to'>;

const FIXED_ARGS = ['type', 'payload', 'to'] as const;

/**
 * Seal a proof envelope with Plan 1 `seal`, to the recipients PROOF_RECIPIENTS fixes for its
 * type. The payload is checked with parseProofPayload first (ProofError('bad-payload')), and
 * seal arguments that carry their own `to`, `type` or `payload` are refused with TypeError.
 */
export async function sealProofEnvelope(env: ProofEnvelope, a: ProofSealArgs): Promise<Envelope> {
  if (!isPlainObject(a) || FIXED_ARGS.some((k) => Object.prototype.hasOwnProperty.call(a, k))) {
    throw new TypeError('sealProofEnvelope: recipients, type and payload come from the proof envelope');
  }
  if (!isPlainObject(env)) throw new TypeError('sealProofEnvelope: invalid envelope');
  const parsed = parseProofPayload(env['type'] as string, env['payload']);
  return seal({
    trade: a.trade,
    from: a.from,
    seq: a.seq,
    me: a.me,
    participants: a.participants,
    type: parsed.type,
    payload: parsed.payload,
    to: PROOF_RECIPIENTS[parsed.type],
  });
}

/**
 * The payload's `key` field: padded standard base64 (libsodium's ORIGINAL variant, not its
 * URL-safe default). Throws TypeError unless `key` is 32 bytes. The returned string cannot be
 * zeroed; drop it as soon as it is sealed (a residual for the Plan 5 security review).
 */
export async function proofKeyToBase64(key: Uint8Array): Promise<string> {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new TypeError('proofKeyToBase64: key must be 32 bytes');
  await sodium.ready;
  return sodium.to_base64(key, sodium.base64_variants.ORIGINAL);
}

/**
 * Decode a payload `key`: exactly 32 bytes of canonical padded standard base64 (the same check
 * parseProofPayload makes), else ProofError('bad-payload'). The caller zeroes the result
 * (`sodium.memzero`) once the proof is decrypted.
 */
export async function proofKeyFromBase64(s: string): Promise<Uint8Array> {
  if (typeof s !== 'string' || !KEY_B64.test(s)) throw fail();
  await sodium.ready;
  let key: Uint8Array;
  try {
    key = sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
  } catch {
    throw fail();
  }
  if (key.length !== 32) throw fail();
  return key;
}
