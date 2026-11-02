// Irreversible redaction on raw RGBA pixels (Plan 5 Task 7, P5-A26).
//
// A redacted region becomes its mean colour plus a fixed texture that depends only on (x, y), so
// its output pixels carry nothing of the original glyphs but one average colour. No blur, no
// pixelation: both can be undone.
import type { Box, HiddenKind, Region } from './detect.js';

/** Which kind a merged region keeps, first wins (a hidden sender name matters to the proof card). */
const MERGE_ORDER: HiddenKind[] = ['name', 'card', 'iban', 'account', 'address', 'phone', 'email', 'handle', 'manual'];

function checkSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) throw new RangeError('bad image size');
}

function checkRegion(r: Region): void {
  if (![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)) throw new RangeError('region must be finite');
}

/** A region rounded outward to whole pixels and clamped to the image; null when nothing is left. */
function clampRegion(r: Region, w: number, h: number): Region | null {
  const x0 = Math.max(0, Math.floor(r.x0));
  const y0 = Math.max(0, Math.floor(r.y0));
  const x1 = Math.min(w, Math.ceil(r.x1));
  const y1 = Math.min(h, Math.ceil(r.y1));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1, kind: r.kind } : null;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** `r` minus `k`: up to four boxes (above, below, left, right of `k`), each with `r`'s kind. */
function cut(r: Region, k: Box): Region[] {
  if (!overlaps(r, k)) return [r];
  const out: Region[] = [];
  if (r.y0 < k.y0) out.push({ ...r, y1: k.y0 });
  if (k.y1 < r.y1) out.push({ ...r, y0: k.y1 });
  const y0 = Math.max(r.y0, k.y0);
  const y1 = Math.min(r.y1, k.y1);
  if (r.x0 < k.x0) out.push({ ...r, y0, y1, x1: k.x0 });
  if (k.x1 < r.x1) out.push({ ...r, y0, y1, x0: k.x1 });
  return out;
}

/**
 * Pad each region by `padPx` (covering anti-aliased glyph edges), clamp to the image, drop empty ones
 * and merge every group of overlapping regions into one box. A merged box keeps the first kind of
 * `name, card, iban, account, address, phone, email, handle, manual`. Sorted top to bottom, left to right.
 *
 * `keepClear` (the trade amount's boxes, from `amountBoxes`): no automatic region reaches into them,
 * by padding or by merging (owner 2026-11-02: the automatic blur never hides the amount). A padded
 * automatic region is cut around them, and two regions are not merged when their joint box would
 * cover one that neither covered. Only a `manual` region (the uploader's own) may cover them. Nothing
 * is ever taken away from the regions given: every pixel of each still lies in an output region
 * (outside `keepClear`, for automatic ones).
 */
export function padAndMerge(rs: Region[], w: number, h: number, padPx = 4, keepClear: readonly Box[] = []): Region[] {
  checkSize(w, h);
  if (!Number.isFinite(padPx) || padPx < 0) throw new RangeError('padPx must be a finite number >= 0');
  for (const k of keepClear) if (![k.x0, k.y0, k.x1, k.y1].every(Number.isFinite)) throw new RangeError('keepClear box must be finite');
  let boxes: Region[] = [];
  for (const r of rs) {
    checkRegion(r);
    const c = clampRegion({ x0: r.x0 - padPx, y0: r.y0 - padPx, x1: r.x1 + padPx, y1: r.y1 + padPx, kind: r.kind }, w, h);
    if (!c) continue;
    let parts = [c];
    if (r.kind !== 'manual') for (const k of keepClear) parts = parts.flatMap((p) => cut(p, k));
    boxes.push(...parts);
  }
  for (let merged = true; merged; ) {
    merged = false;
    const next: Region[] = [];
    for (const b of boxes) {
      const o = next.find((n) => {
        if (!overlaps(n, b)) return false;
        const joint = { x0: Math.min(n.x0, b.x0), y0: Math.min(n.y0, b.y0), x1: Math.max(n.x1, b.x1), y1: Math.max(n.y1, b.y1) };
        return keepClear.every((k) => !overlaps(joint, k) || overlaps(n, k) || overlaps(b, k));
      });
      if (!o) {
        next.push({ ...b });
        continue;
      }
      o.x0 = Math.min(o.x0, b.x0);
      o.y0 = Math.min(o.y0, b.y0);
      o.x1 = Math.max(o.x1, b.x1);
      o.y1 = Math.max(o.y1, b.y1);
      if (MERGE_ORDER.indexOf(b.kind) < MERGE_ORDER.indexOf(o.kind)) o.kind = b.kind;
      merged = true;
    }
    boxes = next;
  }
  return boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** The fixed frosted texture: a value in -12..12 that depends only on the pixel's position. */
function texture(x: number, y: number): number {
  let n = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n ^= n >>> 13;
  return ((n >>> 0) % 25) - 12;
}

/**
 * Redact regions in place: each region (rounded outward, clamped) is replaced by its mean colour,
 * each pixel's RGB shifted by the same position-only texture value; alpha becomes the mean alpha.
 * Two images that differ only inside a region and share its mean give identical output.
 */
export function redact(rgba: Uint8ClampedArray, width: number, height: number, rs: Region[]): void {
  checkSize(width, height);
  if (rgba.length !== width * height * 4) throw new RangeError('pixel buffer does not match the size');
  for (const r of rs) checkRegion(r);
  for (const raw of rs) {
    const r = clampRegion(raw, width, height);
    if (!r) continue;
    const sum = [0, 0, 0, 0];
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) sum[c]! += rgba[i + c]!;
      }
    }
    const n = (r.x1 - r.x0) * (r.y1 - r.y0);
    const mean = sum.map((s) => Math.round(s / n));
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = (y * width + x) * 4;
        const t = texture(x, y);
        rgba[i] = mean[0]! + t;
        rgba[i + 1] = mean[1]! + t;
        rgba[i + 2] = mean[2]! + t;
        rgba[i + 3] = mean[3]!;
      }
    }
  }
}
