/**
 * Encode-only CBOR (RFC 8949) for the soft authenticator: maps, arrays, byte strings, text strings
 * and integers. Tests only; the server decodes with @simplewebauthn/server.
 */
export type CborValue = number | string | Uint8Array | CborValue[] | Map<number | string, CborValue>;

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

export function cborEncode(v: CborValue): Buffer {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || Math.abs(v) > 0xffffffff) throw new TypeError('cbor: integers up to 32 bits only');
    return v >= 0 ? head(0, v) : head(1, -1 - v);
  }
  if (typeof v === 'string') {
    const bytes = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cborEncode)]);
  const parts: Buffer[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cborEncode(k), cborEncode(val));
  return Buffer.concat(parts);
}
