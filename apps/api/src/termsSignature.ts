/**
 * The signature a trader gives when accepting the Terms (owner, 8 Nov 2026): once, at account
 * opening, and again whenever the Terms version changes, never per trade. Stored with the account
 * (`accounts.terms_signature`, migration 316) next to `terms_version` and `terms_accepted_at`, and
 * deleted with it. Nothing else is recorded with it: no IP address, user agent or device
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
 * `signature-invalid`; more than `SIGNATURE_MAX_BYTES` as JSON → `signature-too-large` (checked
 * first, so a huge value is never parsed).
 */
import { ApiError } from './errors.js';

/** The cap on a signature, as its JSON text in UTF-8 (owner's example, 64 KB). */
export const SIGNATURE_MAX_BYTES = 64 * 1024;
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

/** Control, bidi and invisible characters (ALM, ZWSP, LRM/RLM, word joiner and invisible operators, BOM, tag characters), refused in a typed name. ZWNJ and ZWJ stay allowed: some scripts and emoji need them. */
const BAD_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/u;
/** Nothing visible once ZWNJ, ZWJ and whitespace are gone. */
const NO_VISIBLE = /^[\u200c\u200d\s]*$/u;

/** The checked signature (see the module comment for the refusals). */
export function checkTermsSignature(value: unknown): TermsSignature {
  if (value === undefined || value === null) throw new ApiError(400, 'signature-required');
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid();
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > SIGNATURE_MAX_BYTES) throw new ApiError(400, 'signature-too-large');
  const o = value as Record<string, unknown>;
  if (o.kind === 'drawn') {
    if (!exactKeys(o, ['kind', 'width', 'height', 'path'])) throw invalid();
    const { width, height, path } = o;
    if (!isBox(width) || !isBox(height) || typeof path !== 'string' || !validPath(path, width, height)) throw invalid();
    return { kind: 'drawn', width, height, path };
  }
  if (o.kind === 'typed') {
    if (!exactKeys(o, ['kind', 'name'])) throw invalid();
    if (typeof o.name !== 'string') throw invalid();
    const raw = o.name.normalize('NFC');
    const name = raw.trim().replace(/\s+/gu, ' ');
    if (!o.name.isWellFormed()) throw invalid(); // a lone surrogate would reach Postgres and fail there with a 500
    if (NO_VISIBLE.test(name) || [...name].length > MAX_TYPED_NAME || BAD_NAME_CHARS.test(raw)) throw invalid();
    return { kind: 'typed', name };
  }
  throw invalid();
}
