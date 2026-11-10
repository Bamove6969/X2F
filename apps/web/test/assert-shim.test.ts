// The browser stand-in for Node's `assert` that monero-ts calls (src/assertShim.ts, vite.config.ts).
import { expect, it } from 'vitest';
import assert, { AssertionError } from '../src/assertShim.js';
import config from '../vite.config.js';

it('assert(cond, msg) passes truthy values and throws the message otherwise', () => {
  expect(() => assert(1)).not.toThrow();
  expect(() => assert(0, 'Log level must be an integer >= 0')).toThrow(new AssertionError('Log level must be an integer >= 0'));
  expect(() => assert(undefined)).toThrow(AssertionError);
  const own = new Error('custom');
  expect(() => assert(false, own)).toThrow(own);
});

it('equal is loose like Node, deepEqual compares own keys recursively', () => {
  expect(() => assert.equal(1, '1')).not.toThrow();
  expect(() => assert.equal(1, 2, 'no')).toThrow('no');
  expect(() => assert.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).not.toThrow();
  expect(() => assert.deepEqual({ a: [1] }, { a: [2] })).toThrow(AssertionError);
  expect(() => assert.deepEqual({ a: 1 }, { a: 1, b: undefined })).toThrow(AssertionError);
  expect(() => assert.deepEqual([1], { 0: 1 })).toThrow(AssertionError);
});

it('deepEqual fails closed on anything but plain objects and arrays (re-verify R2)', () => {
  // Node compares the contents of these; the shim compared only their (empty) key lists and passed.
  const odd: [unknown, unknown][] = [
    [new Map([[1, 'a']]), new Map([[1, 'b']])],
    [new Set([1]), new Set([2])],
    [new Date(0), new Date(1)],
    [Object(1), Object(2)],
    [new Uint8Array([1]), new Uint8Array([2])],
    [{ a: new Map() }, { a: new Map() }],
    [[new Set()], [new Set()]],
  ];
  for (const [a, b] of odd) expect(() => assert.deepEqual(a, b), String(a)).toThrow(AssertionError);
  const m = new Map();
  expect(() => assert.deepEqual(m, m)).toThrow(AssertionError); // even the same one: never judged
  // What monero-ts compares (GenUtils.reconcile) still works.
  expect(() => assert.deepEqual(Object.create(null), {})).not.toThrow();
  expect(() => assert.deepEqual(10n, 10n)).not.toThrow();
  expect(() => assert.deepEqual([1, [2n, 'x']], [1, [2n, 'x']])).not.toThrow();
});

it('the browser build maps assert (and node:assert) to the shim', () => {
  const cfg = typeof config === 'function' ? config({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }) : config;
  const alias = (cfg as { resolve: { alias: { find: RegExp; replacement: string }[] } }).resolve.alias;
  const hit = alias.find((a) => a.find.test('assert') && a.find.test('node:assert'));
  expect(hit?.replacement).toMatch(/assertShim\.ts$/);
});
