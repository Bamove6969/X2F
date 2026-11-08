// The unblurred copy a moderator asks for (Plan 4 Task 15, DisputeRoom's "Send unblurred proof to
// <mod>"): the picture is drawn again on a canvas and saved as a fresh JPEG 0.9 of at most 5 MB.
// A canvas keeps only pixels, so the original's Exif (GPS, camera, times) and XMP never reach the
// output; hasImageMetadata scans the result anyway and a copy that still carries any is refused.
// The caller seals the Blob `to: ['mod']` as `proof.unblurred` (NEEDS_PLAN_5: the request card and
// the sealing are wired with Plan 5's proof pipeline and Plan 4's proof request record, seams.tsx).

export const MAX_UNBLURRED_BYTES = 5 * 1024 * 1024;
const QUALITY = 0.9;
/** Each try past the first draws the picture at this share of its last size (keeps the quality). */
const SHRINK = 0.8;
const MAX_TRIES = 8;

/** The browser parts, passed in so the rule can be tested without a canvas. */
export interface ReencodeDeps {
  createImageBitmap: (file: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  makeCanvas: (
    width: number,
    height: number,
  ) => {
    getContext: (kind: '2d') => { drawImage: (img: never, x: number, y: number, w: number, h: number) => void } | null;
    convertToBlob: (o: { type: string; quality: number }) => Promise<Blob>;
  };
}

function browserDeps(): ReencodeDeps {
  return {
    // The picture's own orientation is applied to the pixels, so nothing is lost with the Exif tag.
    createImageBitmap: (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
    makeCanvas: (w, h) => new OffscreenCanvas(w, h) as unknown as ReturnType<ReencodeDeps['makeCanvas']>,
  };
}

const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP = Array.from('http://ns.adobe.com/xap/1.0/', (c) => c.charCodeAt(0));

function contains(bytes: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** True when the bytes carry an Exif block or an XMP packet anywhere. */
export function hasImageMetadata(bytes: Uint8Array): boolean {
  return contains(bytes, EXIF) || contains(bytes, XMP);
}

export async function reencodeImage(file: Blob, deps: ReencodeDeps = browserDeps()): Promise<Blob> {
  const bitmap = await deps.createImageBitmap(file);
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    if (!(width > 0 && height > 0)) throw new RangeError('not a picture');
    for (let tries = 0; tries < MAX_TRIES; tries++) {
      const canvas = deps.makeCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no canvas');
      ctx.drawImage(bitmap as never, 0, 0, width, height);
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
      if (out.size <= MAX_UNBLURRED_BYTES) {
        if (hasImageMetadata(new Uint8Array(await out.arrayBuffer()))) throw new Error('the copy still carries metadata');
        return out.type === 'image/jpeg' ? out : new Blob([out], { type: 'image/jpeg' });
      }
      width = Math.max(1, Math.round(width * SHRINK));
      height = Math.max(1, Math.round(height * SHRINK));
    }
    throw new RangeError('too big');
  } finally {
    bitmap.close?.();
  }
}
