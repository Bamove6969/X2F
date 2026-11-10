// The browser half of the receiving device's proof check (row P-031, job J-22). The rule itself
// (type allowlist, header walk, size cap, decode, redraw, output check) is @x2f/proof's
// `receiveProof`; this file gives it the browser's decoder and a fresh canvas, and turns the fresh
// PNG into the `data:` URL the page shows (Plan 3's CSP allows `img-src 'self' data:`).
// The received bytes themselves never reach an <img>.
import { type ReceiveDeclared, type ReceiveDeps, receiveProof } from '@x2f/proof';

export function browserReceiveDeps(): ReceiveDeps {
  return {
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

/** Check a decrypted proof image and return the redrawn copy to show. Rejects with ProofReceiveError. */
export async function showableProof(bytes: Uint8Array, declared: ReceiveDeclared, deps: ReceiveDeps = browserReceiveDeps()): Promise<ShownProof> {
  const out = await receiveProof(bytes, declared, deps);
  return { src: `data:image/png;base64,${base64(out.png)}`, width: out.width, height: out.height };
}
