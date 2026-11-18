// Plan 5 Task 15 (P5-A25): the uploader's picked file is checked from its header BEFORE any decode.
// Unlike a received proof (at most PROOF_MAX_SIDE a side), a picked photo may be large (a phone's
// 4032 x 3024); what is refused is more than PROOF_MAX_DECODED_PIXELS in all, or an animation.
import { describe, expect, it } from 'vitest';
import { PROOF_MAX_DECODED_PIXELS, PROOF_MAX_INPUT_BYTES, ProofReceiveError, readInputHeader } from '../src/index.js';
import { PNG_SIGNATURE, concat, pngChunk, zlibStored } from './fixtures.js';

function ihdr(w: number, h: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  d[8] = 8;
  d[9] = 2;
  return pngChunk('IHDR', d);
}
const IEND = pngChunk('IEND', new Uint8Array(0));
const png = (w: number, h: number, ...extra: Uint8Array[]) => concat(PNG_SIGNATURE, ihdr(w, h), ...extra, pngChunk('IDAT', zlibStored(new Uint8Array(4))), IEND);

const code = (f: () => unknown): string => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return e instanceof ProofReceiveError ? e.code : 'other';
  }
};

describe('readInputHeader', () => {
  it('the limits are P5-A25', () => {
    expect(PROOF_MAX_DECODED_PIXELS).toBe(40_000_000);
    expect(PROOF_MAX_INPUT_BYTES).toBe(20 * 1024 * 1024);
  });

  it('a phone-sized photo passes (wider than a received proof may be)', () => {
    expect(readInputHeader(png(4032, 3024))).toEqual({ mime: 'image/png', width: 4032, height: 3024 });
  });

  it('a 12,000 x 12,000 header with a tiny body is too-large, before any decode', () => {
    expect(code(() => readInputHeader(png(12000, 12000)))).toBe('too-large');
  });

  it('an animated PNG is unsupported; zero bytes and junk are refused', () => {
    expect(code(() => readInputHeader(png(10, 10, pngChunk('acTL', new Uint8Array(8)))))).toBe('unsupported');
    expect(code(() => readInputHeader(new Uint8Array(0)))).toBe('unsupported');
    expect(code(() => readInputHeader(new Uint8Array(PROOF_MAX_INPUT_BYTES + 1)))).toBe('too-large');
  });
});
