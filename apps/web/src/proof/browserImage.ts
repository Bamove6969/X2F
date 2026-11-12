// The browser half of the proof upload (Plan 5 Task 15): decode with createImageBitmap, draw on an
// OffscreenCanvas, encode afresh. A canvas keeps only pixels, so nothing of the picked file but its
// picture reaches the encoder; upload.ts cleans the encoder's output anyway (`cleanImage` +
// `assertClean`). Not unit tested (Node has no canvas): upload.ts's rules are, with these passed in.
import type { ProofImageDeps } from './upload.js';

/** JPEG quality when the PNG is over the ciphertext cap (P5-A25). */
const JPEG_QUALITY = 0.85;

function canvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(w, h).getContext('2d');
  if (ctx === null) throw new Error('no canvas');
  return ctx;
}

export function browserProofImageDeps(): ProofImageDeps {
  return {
    decode: async (file, maxSide) => {
      // The picture's own orientation is applied to the pixels (Review Focus 2: upright output).
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      try {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas(width, height);
        try {
          // Transparency flattened onto white, so a hidden layer cannot carry anything.
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(bitmap, 0, 0, width, height);
          return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
        } finally {
          // Review M1: the canvas holds the unblurred picture. getImageData returned a copy, so it
          // is wiped and shrunk now rather than left to GC.
          ctx.clearRect(0, 0, width, height);
          ctx.canvas.width = 0;
          ctx.canvas.height = 0;
        }
      } finally {
        bitmap.close();
      }
    },
    encode: async (rgba, width, height, mime) => {
      const ctx = canvas(width, height);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      const blob = await ctx.canvas.convertToBlob(mime === 'image/jpeg' ? { type: mime, quality: JPEG_QUALITY } : { type: mime });
      return new Uint8Array(await blob.arrayBuffer());
    },
    // Plan 5 Task 13: the self-hosted OCR in its own worker (ocr.ts), loaded on the first proof (both
    // ocr.ts and tesseract.js are lazy chunks). It answers null when it cannot run, and a chunk that
    // fails to load throws, which prepareProof treats the same: no regions, and the editor says so.
    ocr: async (rgba, width, height) => (await import('./ocr.js')).ocr(rgba, width, height),
  };
}
