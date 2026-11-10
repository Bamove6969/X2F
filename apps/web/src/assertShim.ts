// Stands in for Node's `assert` in the browser bundle (vite.config.ts resolve.alias). monero-ts calls
// `assert(cond, msg)`, `assert.equal(a, b, msg)` and `assert.deepEqual(a, b, msg)` (GenUtils) as its
// own internal checks; Vite's default browser stub for `assert` is an empty module, so every wallet
// call threw "(0, n.default) is not a function" in a real browser (the demo's browser run, 2026-11-08).

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function fail(message: unknown, fallback: string): never {
  if (message instanceof Error) throw message;
  throw new AssertionError(typeof message === 'string' ? message : fallback);
}

/** An array, or an object whose prototype is Object.prototype or null. */
function plain(x: object): boolean {
  if (Array.isArray(x)) return true;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

function deep(a: unknown, b: unknown): boolean {
  // Node's legacy (loose) deepEqual: == for primitives, then own enumerable keys, recursively. Any
  // other object (Map, Set, Date, a typed array, a boxed primitive...) is never judged and fails
  // closed: comparing only its keys would call two different ones equal (re-verify R2). monero-ts's
  // one caller (GenUtils.reconcile) compares primitives, bigints and arrays.
  for (const x of [a, b]) if (typeof x === 'object' && x !== null && !plain(x)) return false;
  // eslint-disable-next-line eqeqeq
  if (a == b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function assert(value: unknown, message?: unknown): asserts value {
  if (!value) fail(message, 'assertion failed');
}

// eslint-disable-next-line eqeqeq
assert.equal = (actual: unknown, expected: unknown, message?: unknown): void => { if (!(actual == expected)) fail(message, `${String(actual)} == ${String(expected)}`); };
assert.deepEqual = (actual: unknown, expected: unknown, message?: unknown): void => { if (!deep(actual, expected)) fail(message, 'values are not deeply equal'); };
assert.ok = assert;
assert.AssertionError = AssertionError;

export default assert;
