// Task 9 I/O, lead decision (A) of 2026-10-29: after a seller–buyer release, the releasing device
// sends the moderator its post-release multisig info; the moderator imports it, and only then does
// its OWN wallet show the spend (funds().outgoing). Regtest.
import { ROLES } from '@x2f/core';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MoneroMultisigEngine, SPEND_INFO_MAX_HEX, runParty, wsTransport, type Outcome, type Transport } from '../src/index.js';
import { minedWhile, partyKit, type Trade } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;

describe('post-release multisig info shows the moderator a seller-buyer release (regtest)', () => {
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

  async function fund(t: Trade, amount: bigint): Promise<string> {
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addresses[0]!, amount, relay: true });
    await mine(node.rpcUri, 12, funderAddress);
    return addresses[0]!;
  }

  it('a seller-buyer release is shown to the mod only through the releasing parties\' spend.info: strict import, resent until acked', async () => {
    const [t, other] = [await kit.newTrade(), await kit.newTrade()];
    await fund(t, XMR);
    await Promise.all(ROLES.map((r) => other.parties[r].ready()));
    const dest = await newTestWallet(node.rpcUri);
    // The mod's party is restarted on a transport that drops every incoming frame while `deaf`.
    await t.parties.mod.stop();
    await new Promise((r) => setTimeout(r, 2000)); // the relay drops the old connection first (else 4409)
    let deaf = true;
    const inner = wsTransport({ url: relayUrl, code: t.code, role: 'mod', me: t.ids.mod });
    const deafTransport: Transport = {
      send: (e) => inner.send(e),
      next: async () => {
        for (;;) {
          const f = await inner.next();
          if (!deaf) return f;
        }
      },
      onReconnect: (cb) => inner.onReconnect(cb),
      close: () => inner.close(),
    };
    const modIgnored: string[] = [];
    // runParty directly: kit.startParty would open a second mod socket, and the relay keeps one per role (4409).
    const mod = runParty({
      role: 'mod', trade: t.code, me: t.ids.mod, participants: t.participants, transport: deafTransport, engine,
      daemonUri: node.rpcUri, password: 'pw-mod', store: t.stores.mod, resendMs: 500, resendMaxMs: 2000, onIgnored: (r) => modIgnored.push(r),
    });
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // Before any release is done there is nothing to export (the nonces are in use).
      await expect(t.parties.buyer.spendInfo()).rejects.toMatchObject({ code: 'bad-state' });
      const [hash] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), t.parties.seller.settle(o)]));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      await mine(node.rpcUri, 2, funderAddress);

      // The gap: the mod took no part, so its own wallet does not show the spend.
      let f = await mod.funds();
      expect(f.outgoing).toEqual([]);

      // Strict input: garbage, wrong size, another escrow's info and a tampered one are refused.
      await expect(mod.importSpendInfo('zz')).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(mod.importSpendInfo('abc')).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(mod.importSpendInfo('ab'.repeat(SPEND_INFO_MAX_HEX / 2 + 1))).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(mod.importSpendInfo('00'.repeat(200))).rejects.toMatchObject({ code: 'bad-spend-info' });
      const info = await t.parties.buyer.spendInfo();
      expect(info).toMatch(/^[0-9a-f]+$/);
      expect(info.length).toBeLessThanOrEqual(SPEND_INFO_MAX_HEX);
      expect(await t.parties.buyer.spendInfo()).toBe(info); // exported once, saved
      expect(t.stores.buyer.current()!.sent['spend.info:0']).toEqual({ hex: info });
      await expect(other.parties.mod.importSpendInfo(info)).rejects.toMatchObject({ code: 'bad-spend-info' });
      const flipped = info.slice(0, -4) + (info.slice(-4) === '0000' ? '0001' : '0000');
      await expect(mod.importSpendInfo(flipped)).rejects.toMatchObject({ code: 'bad-spend-info' });
      // A party never imports (its own release is done; the info is for the moderator only).
      f = await mod.funds();
      expect(f.outgoing).toEqual([]);
      expect(t.stores.buyer.current()!.received['spend.ack:0']).toBeUndefined();

      // The mod hears again: the parties' resends arrive, it imports, its own wallet shows the
      // sweep in its block spending everything, and both releasing parties get the ack.
      deaf = false;
      await expect.poll(async () => (await mod.funds()).outgoing?.map((x) => x.txHash), { timeout: 60_000, interval: 1000 }).toEqual([hash]);
      f = await mod.funds();
      expect(f.balance).toBe(0n);
      expect(f.outgoing![0]).toMatchObject({ txHash: hash, spentAtomic: XMR });
      expect(typeof f.outgoing![0]!.height).toBe('number');
      await expect.poll(() => [t.stores.buyer, t.stores.seller].map((s) => s.current()!.received['spend.ack:0']?.mod !== undefined), { timeout: 60_000 }).toEqual([true, true]);
      expect(Object.keys(t.stores.mod.current()!.received['spend.info:0'] ?? {}).sort()).toEqual(['buyer', 'seller']);
      expect(modIgnored).not.toContain('spend-info-refused');
    } finally {
      await mod.stop();
      await dest.close();
    }
  });
});
