// Demo, 10 Nov: a trader's page reloaded mid-trade never synced its escrow wallet again. A resumed
// regtest wallet runs in-process (monero-ts 0.11.16 drops the regtest flag when its worker reopens
// wallet data), and in the web app's bundle the in-process wallet has no working HTTP: monero-ts
// never sets the global `HttpClient` its WebAssembly glue calls (`typeof require` is undefined
// there; every sync failed with "Cannot read properties of undefined (reading 'HttpClient')", seen
// in both reloaded escrow workers), and its own client cannot send anyway (`http.Agent` is
// missing). Here, in Node, the in-process HTTP is taken away the same way and a resumed regtest
// session must still sync and see what was paid to it. (The glue's `this.HttpClient` read is
// fixed in the web build: apps/web/moneroGlue.ts.) Regtest.
import { fundedWallet, mine, startRegtest, type Regtest } from '@x2f/regtest';
import { HttpClient, LibraryUtils, type MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MoneroMultisigEngine } from '../src/index.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;

/** monero-ts's in-process HTTP as the web bundle has it. Returns the undo. */
async function inProcessHttpAsInTheBundle(): Promise<() => void> {
  await LibraryUtils.loadWasmModule();
  const g = globalThis as { HttpClient?: unknown };
  const h = HttpClient as unknown as { getHttpAgent: () => unknown; getHttpsAgent: () => unknown };
  const [was, http, https] = [g.HttpClient, h.getHttpAgent, h.getHttpsAgent];
  const fail = (): never => {
    throw new TypeError('o.default.Agent is not a constructor');
  };
  delete g.HttpClient;
  h.getHttpAgent = fail;
  h.getHttpsAgent = fail;
  return () => {
    g.HttpClient = was;
    h.getHttpAgent = http;
    h.getHttpsAgent = https;
  };
}

describe('a resumed regtest session syncs without monero-ts\'s in-process HTTP (a reload in the web app)', () => {
  let node: Regtest;
  let funder: MoneroWalletFull;

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
  });

  afterAll(async () => {
    await funder?.close();
    await node?.stop();
  });

  it('resumes in-process, syncs and sees the coins paid to it', async () => {
    const opts = { daemonUri: node.rpcUri, password: 'reload-test' };
    const first = await engine.create(opts);
    const address = await first.wallet.getPrimaryAddress();
    const saved = await first.save();
    await first.close();

    const funderAddress = await funder.getPrimaryAddress();
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address, amount: XMR, relay: true });
    await mine(node.rpcUri, 2, funderAddress);

    const restore = await inProcessHttpAsInTheBundle();
    try {
      const resumed = await engine.resume(saved, opts);
      try {
        expect((resumed.wallet as unknown as { getWalletProxy(): unknown }).getWalletProxy()).toBeFalsy(); // in-process, as every resumed regtest wallet
        const { balance } = await resumed.sync(); // before the fix: daemon-unavailable, every time
        expect(balance).toBe(XMR);
        expect(await resumed.chainHeight()).toBe((await (await fetch(`${node.rpcUri}/get_height`, { method: 'POST' })).json() as { height: number }).height);
        expect((await resumed.incoming()).map((i) => i.amountAtomic)).toEqual([XMR]);
      } finally {
        await resumed.close();
      }
    } finally {
      restore();
    }
  }, 300_000);
});
