/**
 * The two protobuf wire types libsignal's messages use: varint (wire type 0, for `uint32`) and
 * length-delimited (wire type 2, for `bytes`). Enough to frame `SignalMessage` and
 * `PreKeySignalMessage` (WhisperTextProtocol.proto) without a protobuf library.
 */

export type ProtoField = { n: number; varint: number } | { n: number; bytes: Uint8Array };
export type DecodedField = { varint: number } | { bytes: Buffer };

const MAX_FIELD = 2 ** 29 - 1;
const MAX_UINT32 = 2 ** 32 - 1;

function varint(value: number, out: number[]): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) throw new RangeError('protobuf: varint out of range');
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

/** Encodes `fields` in the order given (libsignal's parsers do not mind the order). */
export function encodeFields(fields: ProtoField[]): Buffer {
  const out: number[] = [];
  for (const f of fields) {
    if (!Number.isInteger(f.n) || f.n < 1 || f.n > MAX_FIELD) throw new RangeError('protobuf: field number out of range');
    if ('varint' in f) {
      varint(f.n * 8, out);
      varint(f.varint, out);
    } else {
      varint(f.n * 8 + 2, out);
      varint(f.bytes.length, out);
      for (const b of f.bytes) out.push(b);
    }
  }
  return Buffer.from(out);
}

/**
 * Decodes a message into its fields by number, repeated fields in order. Throws on truncated
 * input, a varint over 10 bytes, a varint field above uint32, or a wire type other than 0 and 2.
 */
export function decodeFields(buf: Uint8Array): Map<number, DecodedField[]> {
  const out = new Map<number, DecodedField[]>();
  let i = 0;
  const readVarint = (): number => {
    let value = 0;
    let scale = 1;
    for (let n = 0; n < 10; n++) {
      if (i >= buf.length) throw new RangeError('protobuf: truncated');
      const b = buf[i++]!;
      value += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) {
        if (value > MAX_UINT32) throw new RangeError('protobuf: varint too large');
        return value;
      }
      scale *= 0x80;
    }
    throw new RangeError('protobuf: varint too long');
  };
  while (i < buf.length) {
    const tag = readVarint();
    const n = Math.floor(tag / 8);
    const wire = tag % 8;
    if (n < 1) throw new RangeError('protobuf: bad field number');
    let field: DecodedField;
    if (wire === 0) {
      field = { varint: readVarint() };
    } else if (wire === 2) {
      const len = readVarint();
      if (i + len > buf.length) throw new RangeError('protobuf: truncated');
      field = { bytes: Buffer.from(buf.subarray(i, i + len)) };
      i += len;
    } else {
      throw new RangeError('protobuf: unsupported wire type');
    }
    const list = out.get(n);
    if (list) list.push(field);
    else out.set(n, [field]);
  }
  return out;
}

/** The single value of field `n`, or undefined. Throws when the field repeats. */
export function one(fields: Map<number, DecodedField[]>, n: number): DecodedField | undefined {
  const list = fields.get(n);
  if (list === undefined) return undefined;
  if (list.length !== 1) throw new RangeError('protobuf: repeated field');
  return list[0];
}
