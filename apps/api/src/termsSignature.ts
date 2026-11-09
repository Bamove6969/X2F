/**
 * The signature a trader gives when accepting the Terms (owner, 8 Nov 2026): once, at account
 * opening, and again whenever the Terms version changes, never per trade. Stored with the account
 * (`accounts.terms_signature`, migration 316) next to `terms_version` and `terms_accepted_at`, and
 * erased when the account closes (owner, 9 Nov 2026, p11-13: "Erase it when the account closes"):
 * a deleted row takes it, and every close that keeps the row calls `eraseTermsSignature` in its
 * transaction (a staff member removed; the 60-day close when it lands, see the tripwire in
 * test/termsSignature.test.ts). Nothing else is recorded with it: no IP address, user agent or device
 * fingerprint. It is never shown to other users, and no route reads it back (a staff route may come
 * later, by owner decision).
 *
 * Two shapes, both plain data (never markup):
 * - `{ kind: 'drawn', width, height, path }`: the strokes drawn on the pad, as a compact SVG path
 *   of absolute integer moves and lines (`M12 30L14 31L20 35M40 30L41 32`) inside a `width` x
 *   `height` box. Chosen over a PNG because it is a few kilobytes where a PNG is tens, it carries
 *   no image metadata, and the server can check it with a strict linear grammar instead of an
 *   image decoder; it can still be drawn later as an SVG path or turned into an image.
 * - `{ kind: 'typed', name }`: the name typed by someone who cannot draw (accessibility).
 *
 * `checkTermsSignature` refuses with 400: missing → `signature-required`; not one of the two shapes
 * (extra keys, a bad path, coordinates outside the box, an empty, control-character, invisible-character or lone-surrogate name) →
 * `signature-invalid`; more than `SIGNATURE_MAX_BYTES` as JSON → `signature-too-large`. Only the
 * fields of a recognised shape are ever measured or read, so hostile nesting can't overflow the
 * stack, and the size comes before the path grammar and the name's normalising.
 *
 * At rest it is sealed (`sealTermsSignature`): a signature or typed name identifies a person, so a
 * database dump or backup alone must not reveal it (security review 2026-11-08, finding 3).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { subkey, type Config } from './config.js';
import type { Queryable } from './db/pool.js';
import { ApiError } from './errors.js';

/** The cap on a signature, as its JSON text in UTF-8 (owner's example, 64 KB). */
export const SIGNATURE_MAX_BYTES = 64 * 1024;
/** The largest stored value: nonce (12) ‖ the JSON ‖ tag (16). Migration 316's check is this number. */
export const SIGNATURE_SEALED_MAX_BYTES = 12 + SIGNATURE_MAX_BYTES + 16;
/** Room a sign-up or accept route adds to its body limit for the signature (its JSON, plus the key). */
export const SIGNATURE_BODY_ALLOWANCE = SIGNATURE_MAX_BYTES + 1024;
/** The body limit of a route that takes a signature: the app's default (`BODY_LIMIT`, 16 KiB) plus that room. */
export const SIGNED_BODY_LIMIT = 16 * 1024 + SIGNATURE_BODY_ALLOWANCE;
/** The pad's box, in CSS pixels: width and height are whole numbers in 1..MAX_BOX. */
export const MAX_BOX = 4096;
/** A typed name, after trimming: 1..MAX_TYPED_NAME characters. */
export const MAX_TYPED_NAME = 100;

export type TermsSignature =
  | { kind: 'drawn'; width: number; height: number; path: string }
  | { kind: 'typed'; name: string };

const invalid = (): ApiError => new ApiError(400, 'signature-invalid');

function isBox(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_BOX;
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

/**
 * True for `M x y` followed by any number of `L x y`, repeated, with every x in 0..width and y in
 * 0..height (whole numbers without leading zeros, one space between x and y, nothing else). A
 * single pass over the string, so a long path costs linear time.
 */
export function validPath(path: string, width: number, height: number): boolean {
  const n = path.length;
  if (n === 0) return false;
  let i = 0;
  let first = true;
  const num = (max: number): boolean => {
    const start = i;
    while (i < n && path.charCodeAt(i) >= 48 && path.charCodeAt(i) <= 57) i++;
    const len = i - start;
    if (len === 0 || len > 4 || (len > 1 && path[start] === '0')) return false;
    return Number(path.slice(start, i)) <= max;
  };
  while (i < n) {
    const c = path[i];
    if (c !== 'M' && c !== 'L') return false;
    if (first && c !== 'M') return false;
    first = false;
    i++;
    if (!num(width)) return false;
    if (path[i] !== ' ') return false;
    i++;
    if (!num(height)) return false;
  }
  return true;
}

/**
 * Refused in a typed name: control and format characters and everything Unicode marks as ignorable
 * (each draws nothing), plus the blank braille cell U+2800. ZWNJ and ZWJ stay allowed: some scripts
 * and emoji need them. The web's `typedSignature` has the same rule.
 */
const BAD_NAME_CHARS = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u;
/** Nothing visible once ZWNJ, ZWJ and whitespace are gone (`BAD_NAME_CHARS` has refused the rest). */
const NO_VISIBLE = /^[\u200c\u200d\s]*$/u;
/** With the `u` flag a valid pair is one code point, so this matches lone surrogates only. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** Measures a signature whose fields are already known to be flat. */
function assertFits(signature: TermsSignature): void {
  if (Buffer.byteLength(JSON.stringify(signature), 'utf8') > SIGNATURE_MAX_BYTES) throw new ApiError(400, 'signature-too-large');
}

/** The checked signature (see the module comment for the refusals). */
export function checkTermsSignature(value: unknown): TermsSignature {
  if (value === undefined || value === null) throw new ApiError(400, 'signature-required');
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const o = value as Record<string, unknown>;
  if (o.kind === 'drawn') {
    if (!exactKeys(o, ['kind', 'width', 'height', 'path'])) throw invalid();
    const { width, height, path } = o;
    if (!isBox(width) || !isBox(height) || typeof path !== 'string') throw invalid();
    assertFits({ kind: 'drawn', width, height, path });
    if (!validPath(path, width, height)) throw invalid();
    return { kind: 'drawn', width, height, path };
  }
  if (o.kind === 'typed') {
    if (!exactKeys(o, ['kind', 'name'])) throw invalid();
    if (typeof o.name !== 'string') throw invalid();
    assertFits({ kind: 'typed', name: o.name });
    if (LONE_SURROGATE.test(o.name)) throw invalid(); // it would reach Postgres and fail there with a 500
    const raw = o.name.normalize('NFC');
    const name = raw.trim().replace(/\s+/gu, ' ');
    if (NO_VISIBLE.test(name) || [...name].length > MAX_TYPED_NAME || BAD_NAME_CHARS.test(raw)) throw invalid();
    return { kind: 'typed', name };
  }
  throw invalid();
}

const sealAad = (accountId: string) => Buffer.from(`x2f/terms-signature/${accountId}`, 'utf8');

/**
 * AES-256-GCM under `subkey('terms-signature')`, bound to the account: nonce (12) \u2016 ciphertext \u2016
 * tag (16), the shape of `sealKey`. A stored signature moved to another row does not open.
 */
export function sealTermsSignature(config: Config, signature: TermsSignature, accountId: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subkey(config, 'terms-signature'), nonce, { authTagLength: 16 });
  cipher.setAAD(sealAad(accountId));
  const body = Buffer.concat([cipher.update(JSON.stringify(signature), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** Opens a stored signature in memory. Throws if it was altered or belongs to another account. */
export function openTermsSignature(config: Config, sealed: Buffer, accountId: string): TermsSignature {
  if (sealed.length < 12 + 16) throw new Error('stored signature is malformed');
  const decipher = createDecipheriv('aes-256-gcm', subkey(config, 'terms-signature'), sealed.subarray(0, 12), { authTagLength: 16 });
  decipher.setAAD(sealAad(accountId));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const text = Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]).toString('utf8');
  return JSON.parse(text) as TermsSignature;
}

/**
 * Erases an account's stored signature, inside the caller's transaction (owner, 9 Nov 2026, p11-13:
 * "Erase it when the account closes"). Every close that keeps the account row calls it; a close
 * that deletes the row needs nothing more. The Terms version and acceptance time stay: they say
 * which Terms the account was under, not who signed.
 */
export async function eraseTermsSignature(db: Queryable, accountId: string): Promise<void> {
  await db.query('update accounts set terms_signature = null where id = $1', [accountId]);
}
