// P0 of 8 Nov (local demo): a seller-built release never settled. The buyer (co-signer) submitted
// and was done, the tx was mined, but the seller (builder) stayed in 'built' for good, so it never
// sent its spend.info and the moderation watcher (which needs BOTH traders to name the sweep, R3-I1)
// logged sweep-unproven every pass. Cause: the builder's done needs `txSeen`, a daemon lookup, and
// in the web app's bundle monero-ts's in-process HTTP client cannot send: its Node `http`/`https`
// imports resolve to an empty module (`module.exports = {}` in the built worker), so
// `new http.Agent()` throws before every request and each lookup was 'daemon-unavailable',
// retried forever. The wallet itself runs in monero-ts's prebuilt worker, whose HTTP works, so the
// buyer's submit and the seller's wallet view were fine. Here the escrow parties run with
// monero-ts's in-process HTTP broken the same way (its agent getters throw, as `new {}.Agent()`
// does in the bundle); the wallets keep running in their worker threads, as in the browser.
// Regtest.
import { ROLES } from '@x2f/core';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import { HttpClient, connectToDaemonRpc, type MoneroWalletFull } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MoneroMultisigEngine, type Outcome } from '../src/index.js';
import { minedWhile, partyKit } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;

/** monero-ts's in-process HTTP as the web bundle has it: no request can be sent. Returns the undo. */
function breakInProcessHttp(): () => void {
  const h = HttpClient as unknown as { getHttpAgent: () => unknown; getHttpsAgent: () => unknown };
  const [http, https] = [h.getHttpAgent, h.getHttpsAgent];
  const fail = (): never => {
    throw new TypeError('o.default.Agent is not a constructor');
  };
  h.getHttpAgent = fail;
  h.getHttpsAgent = fail;
  return () => {
    h.getHttpAgent = http;
    h.getHttpsAgent = https;
  };
}

describe('a seller-built release settles with monero-ts\'s in-process HTTP broken as in the web bundle (regtest)', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  let funderAddress: string;
  const kit = partyKit({ relay: () => relay, relayUrl: () => relayUrl, daemonUri: () => node.rpcUri, engine });

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    funderAddress = await funder.getPrimaryAddress();
    relay = await buildRelay();
    await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = relay.app.server.address();
    relayUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await kit.stopAll();
  });

  afterAll(async () => {
    await funder?.close();
    await relay?.app.close();
    await node?.stop();
  });

  it('the builder sees its release in a block, is done and sends spend.info; the mod then holds both traders\' proofs', async () => {
    const t = await kit.newTrade();
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addresses[0]!, amount: XMR, relay: true });
    await mine(node.rpcUri, 12, funderAddress);
    const dest = await newTestWallet(node.rpcUri);
    const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
    const restore = breakInProcessHttp();
    let hash: string | null;
    try {
      // The browser's condition: monero-ts's in-process daemon client cannot send anything.
      const daemon = await connectToDaemonRpc({ server: { uri: node.rpcUri }, proxyToWorker: false });
      await expect(daemon.getHeight()).rejects.toThrow(/not a constructor/);
      const sellerDone = t.parties.seller.settle(o);
      const stuck = new Promise<'stuck'>((r) => setTimeout(() => r('stuck'), 120_000));
      let seller: string | null | 'stuck';
      [hash, seller] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), Promise.race([sellerDone, stuck])]));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(seller).toBeNull(); // before the fix: 'stuck' (the builder never saw its tx in a block)
      expect(t.stores.seller.current()!.release!.phase).toBe('done');
      // settle() resolves once 'done' is saved; the spend.info is exported and saved on the same
      // pass right after (never before done: the export replaces the nonces a release signs with),
      // so it is waited for here, not read at once (batch 7: 1 run in 3 read it too early).
      await expect.poll(() => t.stores.seller.current()!.sent['spend.info:0'], { timeout: 30_000, interval: 100 }).toMatchObject({ txHash: hash });
      await expect.poll(async () => [...((await t.parties.mod.funds()).spendProofs ?? [])].map((p) => [p.from, p.txHash]).sort(), { timeout: 60_000, interval: 1000 })
        .toEqual([['buyer', hash], ['seller', hash]]);
      expect(kit.ignoredBy.seller).not.toContain('daemon-unavailable');
    } finally {
      restore();
    }
    // The moderator (Node, its daemon client works) proves the payout with the seller's key.
    const sellerKey = (await t.parties.mod.funds()).spendProofs!.find((p) => p.from === 'seller')!.txKey;
    expect(await t.parties.mod.proveSweep!(hash!, sellerKey, [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }])).toBe(true);
    await dest.close();
  }, 300_000);
});
