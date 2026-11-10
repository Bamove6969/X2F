// The two protobuf wire types libsignal's messages use (varint and length-delimited), hand-checked
// against bytes worked out from the protobuf encoding rules, so no protobuf library is needed.
import { describe, expect, it } from 'vitest';
import { decodeFields, encodeFields } from '../src/protobuf.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('protobuf: varint and bytes fields', () => {
  it('encodes a varint field: tag = (n << 3) | 0, base-128 little-endian with continuation bits', () => {
    expect(hex(encodeFields([{ n: 2, varint: 0 }]))).toBe('1000');
    expect(hex(encodeFields([{ n: 2, varint: 1 }]))).toBe('1001');
    expect(hex(encodeFields([{ n: 2, varint: 127 }]))).toBe('107f');
    expect(hex(encodeFields([{ n: 2, varint: 128 }]))).toBe('108001');
    expect(hex(encodeFields([{ n: 2, varint: 300 }]))).toBe('10ac02');
    expect(hex(encodeFields([{ n: 5, varint: 0xffffffff }]))).toBe('28ffffffff0f');
    // Field numbers above 15 take a two-byte tag.
    expect(hex(encodeFields([{ n: 16, varint: 1 }]))).toBe('800101');
  });

  it('encodes a bytes field: tag = (n << 3) | 2, then the length as a varint, then the bytes', () => {
    expect(hex(encodeFields([{ n: 1, bytes: Buffer.from('abcd', 'hex') }]))).toBe('0a02abcd');
    expect(hex(encodeFields([{ n: 4, bytes: Buffer.alloc(0) }]))).toBe('2200');
    const long = Buffer.alloc(300, 7);
    expect(hex(encodeFields([{ n: 4, bytes: long }]))).toBe(`22ac02${'07'.repeat(300)}`);
  });

  it('writes fields in the order given and refuses values outside uint32 or field numbers outside 1..2^29-1', () => {
    expect(hex(encodeFields([{ n: 2, varint: 1 }, { n: 1, bytes: Buffer.from([9]) }]))).toBe('10010a0109');
    expect(() => encodeFields([{ n: 1, varint: -1 }])).toThrow();
    expect(() => encodeFields([{ n: 1, varint: 2 ** 32 }])).toThrow();
    expect(() => encodeFields([{ n: 1, varint: 1.5 }])).toThrow();
    expect(() => encodeFields([{ n: 0, varint: 1 }])).toThrow();
    expect(() => encodeFields([{ n: 2 ** 29, varint: 1 }])).toThrow();
  });

  it('decodes what it encodes, keeping repeated fields in order, and reads libsignal-shaped messages', () => {
    const msg = encodeFields([
      { n: 1, bytes: Buffer.alloc(33, 5) }, { n: 2, varint: 7 }, { n: 3, varint: 0 }, { n: 4, bytes: Buffer.from('ciphertext') },
    ]);
    const d = decodeFields(msg);
    expect(d.get(1)).toEqual([{ bytes: Buffer.alloc(33, 5) }]);
    expect(d.get(2)).toEqual([{ varint: 7 }]);
    expect(d.get(3)).toEqual([{ varint: 0 }]);
    expect(d.get(4)).toEqual([{ bytes: Buffer.from('ciphertext') }]);
    expect(d.get(5)).toBeUndefined();
    const repeated = decodeFields(Buffer.from('10011002', 'hex'));
    expect(repeated.get(2)).toEqual([{ varint: 1 }, { varint: 2 }]);
  });

  it('refuses truncated input, wire types it does not know, and varints over 10 bytes', () => {
    expect(() => decodeFields(Buffer.from('0a05abcd', 'hex'))).toThrow();
    expect(() => decodeFields(Buffer.from('10', 'hex'))).toThrow();
    expect(() => decodeFields(Buffer.from('1080', 'hex'))).toThrow();
    expect(() => decodeFields(Buffer.from('0900000000000000', 'hex'))).toThrow(); // wire type 1 (64-bit)
    expect(() => decodeFields(Buffer.from('0d00000000', 'hex'))).toThrow(); // wire type 5 (32-bit)
    expect(() => decodeFields(Buffer.from('13', 'hex'))).toThrow(); // wire type 3 (group)
    expect(() => decodeFields(Buffer.from(`10${'ff'.repeat(10)}01`, 'hex'))).toThrow();
    expect(decodeFields(Buffer.alloc(0)).size).toBe(0);
  });
});
