// The browser half of the receiving device's proof check (row P-031, job J-22). The rule itself
// (type allowlist, header walk, size cap, decode, redraw, output check) is @x2f/proof's
// `receiveProof`; this file gives it the browser's decoder and a fresh canvas, and turns the fresh
// PNG into the `data:` URL the page shows (Plan 3's CSP allows `img-src 'self' data:`).
// The received bytes themselves never reach an <img>.
//
// Plan 5 Task 16: the seller's smart proof card reads the words on the picture with this device's
// own OCR (never a value from the buyer). The OCR reads the redrawn copy only, the one this check
// made and shows, after it is shown, and only the words go back to the caller (`onWords`): the
// pixels stay on this path and in the self-hosted OCR worker (proof/ocr.ts, same origin, the worker
// CSP on /ocr/*).
import { type OcrWord, type ReceiveDeclared, type ReceiveDeps, receiveProof } from '@x2f/proof';

/** The receive check's browser parts, and the OCR of the redrawn copy (Task 16). */
export interface ShowDeps extends ReceiveDeps {
  /** The words on the redrawn PNG, or null when they cannot be read (never a throw that matters: a throw reads as null). */
  readWords?(png: Uint8Array, width: number, height: number): Promise<OcrWord[] | null>;
}

/** Decodes this device's own redrawn PNG to pixels and runs the self-hosted OCR on them. */
async function browserReadWords(png: Uint8Array, width: number, height: number): Promise<OcrWord[] | null> {
  const bitmap = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  let rgba: Uint8ClampedArray;
  try {
    if (bitmap.width !== width || bitmap.height !== height) return null;
    const ctx = new OffscreenCanvas(width, height).getContext('2d');
    if (ctx === null) return null;
    try {
      ctx.drawImage(bitmap, 0, 0, width, height);
      rgba = ctx.getImageData(0, 0, width, height).data;
    } finally {
      ctx.canvas.width = 0;
      ctx.canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
  try {
    return await (await import('./ocr.js')).ocr(rgba, width, height);
  } finally {
    rgba.fill(0);
  }
}

export function browserReceiveDeps(): ShowDeps {
  return {
    readWords: browserReadWords,
    // No imageOrientation option: 'none' is deprecated and browsers read it as 'from-image' (Exif
    // applied), so it never protected anything. receiveProof strips the metadata before it hands the
    // bytes here, so there is no orientation tag left to apply, and the decoded size is the header's.
    decode: (bytes, mime) => createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })),
    render: async (bitmap, width, height) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no canvas');
      ctx.drawImage(bitmap as ImageBitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

/** base64 of bytes, in pieces so a large image never overflows the argument list. */
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let at = 0; at < bytes.length; at += 0x8000) s += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(s);
}

export interface ShownProof {
  /** `data:image/png;base64,...` of the copy drawn on this device. */
  src: string;
  width: number;
  height: number;
}

/**
 * Check a decrypted proof image and return the redrawn copy to show. Rejects with ProofReceiveError.
 * With `onWords` (the seller's card, Task 16), the redrawn copy is then read by `deps.readWords` and
 * `onWords` gets the words, or null when they cannot be read (no reader, a failure). Never on a
 * refusal: a proof that fails the check is not read at all.
 */
export async function showableProof(
  bytes: Uint8Array,
  declared: ReceiveDeclared,
  deps: ShowDeps = browserReceiveDeps(),
  onWords?: (words: OcrWord[] | null) => void,
): Promise<ShownProof> {
  const out = await receiveProof(bytes, declared, deps);
  const shown = { src: `data:image/png;base64,${base64(out.png)}`, width: out.width, height: out.height };
  if (onWords !== undefined) {
    const read = deps.readWords;
    if (read === undefined) onWords(null);
    else
      void read.call(deps, out.png, out.width, out.height).then(
        (words) => onWords(Array.isArray(words) ? words : null),
        () => onWords(null),
      );
  }
  return shown;
}
