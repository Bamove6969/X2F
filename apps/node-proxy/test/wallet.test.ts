import { mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import type { FastifyInstance } from 'fastify';
import { connectToDaemonRpc, type MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildNodeProxy, requireRestrictedNode } from '../src/server.js';

const XMR = 1_000_000_000_000n;

/**
 * Pins the allowlist with the real client: monero-ts 0.11.16 wallets (wallet2 inside) and its daemon
 * client work end to end through the proxy against a node in restricted RPC mode, and no call they
 * make is refused. A wallet that needs a call off the list fails here.
 */
describe('node proxy with monero-ts wallets on a restricted regtest node', () => {
  let node: Regtest;
  let app: FastifyInstance;
  let proxyUri: string;
  const wallets: MoneroWalletFull[] = [];
  /** Every call the proxy answered: path (and json_rpc method) with its status. */
  const calls: { call: string; status: number }[] = [];

  beforeAll(async () => {
    node = await startRegtest({ restrictedRpc: true });
    const restricted = node.restrictedRpcUri ?? '';
    // The startup check tells the two ports apart.
    await expect(requireRestrictedNode(node.rpcUri)).rejects.toThrow('node-not-restricted');
    await requireRestrictedNode(restricted);
    app = buildNodeProxy({ upstream: restricted, webOrigin: 'https://x2f.example' });
    app.addHook('onResponse', async (req, reply) => {
      let call = req.url;
      if (req.url === '/json_rpc' && Buffer.isBuffer(req.body)) {
        try {
          call += ` ${String((JSON.parse(req.body.toString()) as { method?: unknown }).method)}`;
        } catch {
          call += ' (unparsed)';
        }
      }
      calls.push({ call, status: reply.statusCode });
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const a = app.server.address();
    proxyUri = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  });

  afterAll(async () => {
    for (const w of wallets) await w.close();
    await app?.close();
    await node?.stop();
  });

  it('syncs, sends at default priority, relays and sees the pool tx and its block through the proxy', async () => {
    const alice = await newTestWallet(proxyUri);
    wallets.push(alice);
    const bob = await newTestWallet(proxyUri);
    wallets.push(bob);
    const aliceAddress = await alice.getPrimaryAddress();
    const bobAddress = await bob.getPrimaryAddress();

    // Mining needs the unrestricted port; everything a wallet does goes through the proxy.
    await mine(node.rpcUri, 80, aliceAddress);
    await mine(node.rpcUri, 12, aliceAddress);
    await alice.setDaemonConnection({ uri: proxyUri });
    await alice.sync();
    expect(await alice.getUnlockedBalance()).toBeGreaterThan(XMR);

    // Default priority: wallet2 adjusts it from the pool backlog and recent block headers.
    const tx = await alice.createTx({ accountIndex: 0, address: bobAddress, amount: XMR, relay: true });
    const hash = tx.getHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    await bob.setDaemonConnection({ uri: proxyUri });
    await bob.sync();
    const pooled = await bob.getTxs({ hash });
    expect(pooled).toHaveLength(1);
    expect(pooled[0]?.getInTxPool()).toBe(true);
    expect(pooled[0]?.getIncomingAmount()).toBe(XMR);

    // The escrow's txSeen path: monero-ts's daemon client through the proxy.
    const daemon = await connectToDaemonRpc({ uri: proxyUri });
    expect((await daemon.getTx(hash))?.getIsConfirmed()).toBe(false);
    await mine(node.rpcUri, 1, aliceAddress);
    expect((await daemon.getTx(hash))?.getIsConfirmed()).toBe(true);
    await bob.sync();
    expect((await bob.getTxs({ hash }))[0]?.getIsConfirmed()).toBe(true);

    const refused = calls.filter((c) => c.status !== 200);
    expect(refused).toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
    // Shown in the test output so a change in what wallets call is easy to review.
    console.log(`calls through the proxy: ${[...new Set(calls.map((c) => c.call))].sort().join(', ')}`);
  }, 600_000);
});
