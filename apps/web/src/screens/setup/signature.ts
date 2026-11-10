/**
 * The Terms signature's model (owner, 8 Nov 2026), kept apart from the pad so it can be tested
 * without a canvas. The API checks the same shapes (apps/api/src/termsSignature.ts):
 *
 * - drawn: the pad's strokes as an SVG path of whole-pixel moves and lines inside the pad's box
 *   (`{ kind: 'drawn', width, height, path }`). Points closer than `MIN_STEP` to the last one are
 *   dropped, and the pad stops taking points after `MAX_POINTS`, which keeps the path well under the
 *   API's 64 KB cap (each point is at most "L4096 4096", 10 bytes).
 * - typed: the name typed instead, for someone who can't draw (`{ kind: 'typed', name }`).
 */
import type { TermsSignature } from '@x2f/auth-client';

export type Point = readonly [number, number];
export type Stroke = readonly Point[];

/** The API's cap on a signature, as JSON (SIGNATURE_MAX_BYTES there). */
export const SIGNATURE_MAX_BYTES = 64 * 1024;
/** The API's largest box side and longest typed name. */
export const MAX_BOX = 4096;
export const MAX_TYPED_NAME = 100;
/** The pad keeps at most this many points in all (10 bytes each at most: under the cap). */
export const MAX_POINTS = 6000;
/** A new point closer than this (in CSS pixels) to the stroke's last one is dropped. */
export const MIN_STEP = 2;

const clamp = (n: number, max: number): number => Math.min(max, Math.max(0, Math.round(n)));

/** The box the API accepts for a pad of this size (whole pixels, 1..MAX_BOX). */
export function boxOf(width: number, height: number): { width: number; height: number } {
  return { width: Math.min(MAX_BOX, Math.max(1, Math.round(width))), height: Math.min(MAX_BOX, Math.max(1, Math.round(height))) };
}

/** Whether `p` is far enough from the stroke's last point to keep. */
export function keepPoint(stroke: Stroke, p: Point): boolean {
  const last = stroke[stroke.length - 1];
  if (last === undefined) return true;
  return Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_STEP;
}

/** Every point of every stroke. */
export function pointCount(strokes: readonly Stroke[]): number {
  return strokes.reduce((n, s) => n + s.length, 0);
}

/** `M x yL x y…` per stroke, rounded and kept inside the box; a single tap is drawn as a dot (a line to itself). */
export function strokesToPath(strokes: readonly Stroke[], width: number, height: number): string {
  let out = '';
  for (const s of strokes) {
    if (s.length === 0) continue;
    const pts = s.length === 1 ? [s[0]!, s[0]!] : s;
    pts.forEach((p, i) => {
      out += `${i === 0 ? 'M' : 'L'}${clamp(p[0], width)} ${clamp(p[1], height)}`;
    });
  }
  return out;
}

/** The drawn signature for these strokes on a pad of this size, or `null` when nothing is drawn. */
export function drawnSignature(strokes: readonly Stroke[], width: number, height: number): TermsSignature | null {
  const box = boxOf(width, height);
  const path = strokesToPath(strokes, box.width, box.height);
  return path === '' ? null : { kind: 'drawn', width: box.width, height: box.height, path };
}

/**
 * Refused in a typed name: control and format characters and everything Unicode marks as ignorable
 * (each draws nothing), plus the blank braille cell U+2800. ZWNJ and ZWJ stay allowed: some scripts
 * and emoji need them. The API's `checkTermsSignature` has the same rule.
 */
const BAD_NAME_CHARS = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u;
/** Nothing visible once ZWNJ, ZWJ and whitespace are gone (`BAD_NAME_CHARS` has refused the rest). */
const NO_VISIBLE = /^[\u200c\u200d\s]*$/u;
/** With the `u` flag a valid pair is one code point, so this matches lone surrogates only. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** The typed signature, trimmed with runs of spaces folded, or `null` when nothing usable is typed. */
export function typedSignature(name: string): TermsSignature | null {
  const raw = name.normalize('NFC');
  const clean = raw.trim().replace(/\s+/gu, ' ');
  if (LONE_SURROGATE.test(name) || NO_VISIBLE.test(clean) || [...clean].length > MAX_TYPED_NAME || BAD_NAME_CHARS.test(raw)) return null;
  return { kind: 'typed', name: clean };
}

/** The signature's size as the API measures it (its JSON in UTF-8). */
export function signatureBytes(sig: TermsSignature): number {
  return new TextEncoder().encode(JSON.stringify(sig)).length;
}

/** Strokes drawn on a box of `from` size, scaled to a box of `to` size (the pad was resized). */
export function scaleStrokes(
  strokes: readonly Stroke[],
  from: { width: number; height: number },
  to: { width: number; height: number },
): Stroke[] {
  if (from.width === to.width && from.height === to.height) return strokes.map((s) => [...s]);
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return strokes.map((s) => s.map(([x, y]) => [x * sx, y * sy] as const));
}
