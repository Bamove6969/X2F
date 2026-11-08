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

it('the browser build maps assert (and node:assert) to the shim', () => {
  const cfg = typeof config === 'function' ? config({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }) : config;
  const alias = (cfg as { resolve: { alias: { find: RegExp; replacement: string }[] } }).resolve.alias;
  const hit = alias.find((a) => a.find.test('assert') && a.find.test('node:assert'));
  expect(hit?.replacement).toMatch(/assertShim\.ts$/);
});
