/**
 * Strict payload encoding. Accepted: plain objects (prototype Object.prototype or null),
 * arrays, strings, finite numbers (not -0), booleans, null and bigint. bigint travels as
 * {"__t":"bigint","v":"<decimal>"}; user keys matching /^~*__t$/ get one extra '~' so a
 * lookalike object always stays data. Everything else is a TypeError at seal time.
 */
export const MAX_DEPTH = 64;

const TAG = '__t';
const ESCAPABLE = /^~*__t$/;
const ESCAPED = /^~+__t$/;
const BIGINT_DEC = /^-?(?:0|[1-9]\d*)$/;

function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  // defineProperty keeps keys such as __proto__ as own data instead of touching the prototype.
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

function dataValue(o: object, k: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (d === undefined || !('value' in d) || !d.enumerable) throw new TypeError('payload: accessor or hidden properties are not representable');
  return d.value;
}

export function encodePayload(value: unknown, depth = 0): unknown {
  switch (typeof value) {
    case 'bigint':
      return { [TAG]: 'bigint', v: value.toString() };
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('payload: numbers must be finite');
      if (Object.is(value, -0)) throw new TypeError('payload: negative zero is not representable');
      return value;
    case 'object': {
      if (value === null) return null;
      const d = depth + 1;
      if (d > MAX_DEPTH) throw new TypeError('payload: nested too deeply');
      if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('payload: symbol keys are not representable');
      const names = Object.getOwnPropertyNames(value);
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('payload: array subclasses are not representable');
        if (names.length !== value.length + 1) throw new TypeError('payload: sparse arrays and extra array properties are not representable');
        const out: unknown[] = [];
        for (let i = 0; i < value.length; i++) out.push(encodePayload(dataValue(value, String(i)), d));
        return out;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) throw new TypeError('payload: objects must be plain objects');
      const out: Record<string, unknown> = {};
      for (const k of names) setOwn(out, ESCAPABLE.test(k) ? `~${k}` : k, encodePayload(dataValue(value, k), d));
      return out;
    }
    default:
      throw new TypeError(`payload: ${typeof value} is not representable`);
  }
}

/** Inverse of encodePayload over JSON.parse output. Throws on anything encodePayload cannot produce. */
export function decodePayload(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('payload: bad number');
    return value;
  }
  if (typeof value !== 'object') throw new Error('payload: bad value');
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, TAG)) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    const v = o['v'];
    if (keys.length !== 2 || o[TAG] !== 'bigint' || typeof v !== 'string' || !BIGINT_DEC.test(v) || v === '-0') {
      throw new Error('payload: bad tag');
    }
    return BigInt(v);
  }
  const d = depth + 1;
  if (d > MAX_DEPTH) throw new Error('payload: nested too deeply');
  if (Array.isArray(value)) return value.map((x) => decodePayload(x, d));
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) setOwn(out, ESCAPED.test(k) ? k.slice(1) : k, decodePayload(src[k], d));
  return out;
}

/** Canonical JSON: object keys sorted (UTF-16 order), no whitespace. Input is JSON-safe data. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  throw new TypeError('canonicalJson: unsupported value');
}
