import { describe, expect, it } from 'vitest';
import { assertDemo, assertDemoFlag, assertLoopbackUrl, assertRegtestDaemon, DemoRefused, demoFlagOn, isRegtestInfo } from '../demo/guard.js';

/** A fetch that answers get_info with `result` (or throws, or answers garbage). */
function daemon(result: unknown, opts: { throws?: boolean; raw?: string } = {}): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    calls.push(String(url));
    if (opts.throws) throw new Error('ECONNREFUSED');
    return new Response(opts.raw ?? JSON.stringify({ jsonrpc: '2.0', id: '0', result }), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const REGTEST = { nettype: 'fakechain', mainnet: false, stagenet: false, testnet: false };

describe('demo guard: X2F_DEMO', () => {
  it('is on only when X2F_DEMO is exactly "1"', () => {
    expect(demoFlagOn({ X2F_DEMO: '1' })).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1', '1 ', '01', 'TRUE', '2']) expect(demoFlagOn({ X2F_DEMO: v })).toBe(false);
    expect(demoFlagOn({})).toBe(false);
  });

  it('assertDemoFlag refuses without it', () => {
    expect(() => assertDemoFlag({})).toThrow(DemoRefused);
    expect(() => assertDemoFlag({ X2F_DEMO: 'true' })).toThrow(/X2F_DEMO=1 is not set/);
    expect(() => assertDemoFlag({ X2F_DEMO: '1' })).not.toThrow();
  });
});

describe('demo guard: the daemon', () => {
  it('accepts only a fakechain node with no real-network flag', () => {
    expect(isRegtestInfo(REGTEST)).toBe(true);
    expect(isRegtestInfo({ nettype: 'fakechain' })).toBe(true);
    expect(isRegtestInfo({ nettype: 'mainnet', mainnet: true })).toBe(false);
    expect(isRegtestInfo({ nettype: 'stagenet', stagenet: true })).toBe(false);
    expect(isRegtestInfo({ nettype: 'testnet', testnet: true })).toBe(false);
    // A contradictory answer is refused, whichever flag lies.
    expect(isRegtestInfo({ ...REGTEST, mainnet: true })).toBe(false);
    expect(isRegtestInfo({ ...REGTEST, stagenet: true })).toBe(false);
    expect(isRegtestInfo({ ...REGTEST, testnet: true })).toBe(false);
    expect(isRegtestInfo({})).toBe(false);
    expect(isRegtestInfo({ nettype: 'FAKECHAIN' })).toBe(false);
  });

  it('only a loopback daemon URL', () => {
    for (const u of ['http://127.0.0.1:18481', 'http://localhost:18481', 'http://[::1]:18481']) expect(() => assertLoopbackUrl(u)).not.toThrow();
    for (const u of ['http://0.0.0.0:18481', 'http://10.0.0.2:18081', 'http://node.example.org:18081', 'http://127.0.0.1.example.org', 'not a url', ''])
      expect(() => assertLoopbackUrl(u)).toThrow(DemoRefused);
  });

  it('asks get_info and passes a regtest node', async () => {
    const d = daemon(REGTEST);
    await expect(assertRegtestDaemon('http://127.0.0.1:18481', d.fetch)).resolves.toBeUndefined();
    expect(d.calls).toEqual(['http://127.0.0.1:18481/json_rpc']);
  });

  it.each([
    ['mainnet', { nettype: 'mainnet', mainnet: true }],
    ['stagenet', { nettype: 'stagenet', stagenet: true }],
    ['testnet', { nettype: 'testnet', testnet: true }],
    ['no nettype', {}],
  ])('refuses a %s node', async (_n, info) => {
    await expect(assertRegtestDaemon('http://127.0.0.1:18481', daemon(info).fetch)).rejects.toThrow(/not a regtest node/);
  });

  it('refuses a daemon that does not answer, or answers garbage', async () => {
    await expect(assertRegtestDaemon('http://127.0.0.1:18481', daemon(null, { throws: true }).fetch)).rejects.toThrow(/did not answer/);
    await expect(assertRegtestDaemon('http://127.0.0.1:18481', daemon(null, { raw: 'not json' }).fetch)).rejects.toThrow(/did not answer/);
    await expect(assertRegtestDaemon('http://127.0.0.1:18481', daemon(null, { raw: '{"error":{"message":"x"}}' }).fetch)).rejects.toThrow(/not a regtest node/);
  });

  it('never asks a remote daemon at all', async () => {
    const d = daemon(REGTEST);
    await expect(assertRegtestDaemon('http://node.example.org:18081', d.fetch)).rejects.toThrow(DemoRefused);
    expect(d.calls).toEqual([]);
  });

  it('assertDemo checks the flag before touching the daemon', async () => {
    await expect(assertDemo({}, 'http://127.0.0.1:1')).rejects.toThrow(/X2F_DEMO=1 is not set/);
  });
});
