import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../src/base64.js';

describe('base64', () => {
  it('round-trips bytes, including sizes above one chunk', () => {
    for (const n of [0, 1, 2, 3, 255, 0x8000, 0x8000 * 3 + 7]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
  });

  it('encodes a DataView over just its window', () => {
    const buf = new Uint8Array([9, 1, 2, 3, 9]).buffer;
    expect(toBase64(new DataView(buf, 1, 3))).toBe(toBase64(new Uint8Array([1, 2, 3])));
  });

  it('matches standard base64', () => {
    expect(toBase64(new TextEncoder().encode('x2f'))).toBe('eDJm');
  });

  it('throws on invalid input', () => {
    expect(() => fromBase64('not base64!')).toThrow();
  });
});
