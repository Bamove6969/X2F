/**
 * Canonical JSON: object keys sorted (by UTF-16 code units, as `Array.prototype.sort` does), no
 * whitespace, a `bigint` as its decimal string. It is what key taps and the activity log hash, so
 * every input that plain `JSON.stringify` would change or drop silently is refused with a
 * TypeError instead: a `Date` (callers pass an ISO string), `undefined`, `NaN`/`Infinity`,
 * functions, symbols, sparse arrays and any object that is not a plain object or array.
 */
export function canonicalJson(v: unknown): string {
  return enc(v, 0);
}

const MAX_DEPTH = 64;

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function enc(v: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new TypeError('canonicalJson: too deep');
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(v);
    case 'bigint':
      return JSON.stringify(v.toString());
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalJson: ${typeof v} is not allowed`);
  }
  if (Array.isArray(v)) {
    if (!isPlainArray(v)) throw new TypeError('canonicalJson: not a plain array');
    const parts: string[] = [];
    for (let i = 0; i < v.length; i++) {
      if (!Object.hasOwn(v, i)) throw new TypeError('canonicalJson: sparse array');
      parts.push(enc(v[i], depth + 1));
    }
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(v)) throw new TypeError('canonicalJson: not a plain object');
  if (Object.getOwnPropertySymbols(v).length > 0) throw new TypeError('canonicalJson: symbol key');
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${enc(o[k], depth + 1)}`).join(',')}}`;
}

function isPlainArray(a: unknown[]): boolean {
  if (Object.getPrototypeOf(a) !== Array.prototype) return false;
  // No extra named properties beyond the indices and `length`.
  return Object.keys(a).length <= a.length && Object.getOwnPropertySymbols(a).length === 0;
}
