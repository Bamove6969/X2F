import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { fundedWallet, startRegtest, type Regtest } from './regtest.js';

const started: Regtest[] = [];
async function start(): Promise<Regtest> {
  const r = await startRegtest();
  started.push(r);
  return r;
}


function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('regtest harness', () => {
  afterEach(async () => {
    await Promise.all(started.splice(0).map((r) => r.stop()));
  });

  it('fundedWallet has unlocked funds', async () => {
    const node = await start();
    const wallet = await fundedWallet(node.rpcUri);
    try {
      expect(await wallet.getUnlockedBalance()).toBeGreaterThan(0n);
    } finally {
      await wallet.close();
    }
  });

  it('runs two nodes side by side on distinct ports', async () => {
    const a = await start();
    const b = await start();
    expect(a.rpcUri).not.toBe(b.rpcUri);
    for (const n of [a, b]) {
      const res = await fetch(`${n.rpcUri}/get_info`);
      expect(res.ok).toBe(true);
    }
  });

  it('stop leaves no monerod process and removes the data dir', async () => {
    const node = await start();
    expect(existsSync(node.dataDir)).toBe(true);
    expect(alive(node.pid)).toBe(true);
    await node.stop();
    expect(alive(node.pid)).toBe(false);
    expect(existsSync(node.dataDir)).toBe(false);
  });
});
