import { ROLES } from '@x2f/core';
import { ReplayGuard, open, seal } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import type { MoneroWalletFull } from 'monero-ts';
import sodium from 'libsodium-wrappers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DAEMON_TIMEOUT_MS, EscrowError, MoneroMultisigEngine, MoneroMultisigSession, type EscrowSession, type Outcome } from '../src/index.js';
import { blackHole, holdableProxy, minedWhile, partyKit, spyEngine, type Trade } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;
const randomHash = (): string => sodium.to_hex(sodium.randombytes_buf(32));

describe('Plan 1 follow-ups on regtest', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  let funderAddress: string;
  let daemonUri = '';
  const kit = partyKit({ relay: () => relay, relayUrl: () => relayUrl, daemonUri: () => daemonUri, engine });
  const sessions: EscrowSession[] = [];

  beforeAll(async () => {
    await sodium.ready;
    node = await startRegtest();
    daemonUri = node.rpcUri;
    funder = await fundedWallet(node.rpcUri);
    funderAddress = await funder.getPrimaryAddress();
    relay = await buildRelay();
    await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = relay.app.server.address();
    relayUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await kit.stopAll();
    daemonUri = node.rpcUri;
  });

  afterAll(async () => {
    for (const s of sessions) await s.close().catch(() => undefined);
    await funder?.close();
    await relay?.app.close();
    await node?.stop();
  });

  async function pay(address: string, amount: bigint): Promise<string> {
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    return (await funder.createTx({ accountIndex: 0, address, amount, relay: true })).getHash();
  }

  async function readyAndFund(t: Trade, amount = XMR): Promise<string> {
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
    await pay(addresses[0]!, amount);
    await mine(node.rpcUri, 12, funderAddress);
    return addresses[0]!;
  }

  it('txSeen is false for a tx only in the pool and true once it is in a block', async () => {
    const s = await engine.create({ daemonUri: node.rpcUri, password: 'x' });
    sessions.push(s);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const hash = await pay(await dest.getPrimaryAddress(), XMR);
      expect(await s.txStatus(hash)).toBe('pool');
      expect(await s.txSeen(hash)).toBe(false);
      await mine(node.rpcUri, 1, funderAddress);
      expect(await s.txStatus(hash)).toBe('block');
      expect(await s.txSeen(hash)).toBe(true);
      expect(await s.txSeen(randomHash())).toBe(false);
      expect(await s.txSeen('not a hash')).toBe(false);
    } finally {
      await dest.close();
    }
  });

  it('a co-signer reporting a made-up DONE hash leaves the builder waiting', async () => {
    const t = await kit.newTrade();
    await readyAndFund(t);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // The buyer co-signs and broadcasts, but its real DONE never reaches the seller...
      t.stores.buyer.onSave = (x) => {
        if (x.release?.phase === 'done') t.taps.buyer.dropSend = () => true;
      };
      let sellerResult: unknown = 'pending';
      void t.parties.seller.settle(o).then((v) => (sellerResult = v), (e: unknown) => (sellerResult = e));
      const hash = await t.parties.buyer.settle(o);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // ...a made-up one does.
      const tag = t.stores.seller.current()!.release!.outcome.slice(0, 16);
      t.taps.seller.inject(await seal({ trade: t.code, from: 'buyer', seq: 1_000_000, type: 'release.done', payload: { key: `release.done:${tag}.0`, txHash: randomHash() }, to: ['seller'], me: t.ids.buyer, participants: t.participants }));
      await mine(node.rpcUri, 12, funderAddress);
      await expect.poll(() => t.stores.seller.current()?.received[`release.done:${tag}.0`]?.buyer !== undefined, { timeout: 30_000 }).toBe(true);
      // The escrow is empty and the real tx is in a block, but the reported hash is not: keep waiting.
      const s = await engine.create({ daemonUri: node.rpcUri, password: 'x' });
      sessions.push(s);
      expect(await s.txSeen(hash!)).toBe(true);
      await new Promise((r) => setTimeout(r, 8000));
      expect(sellerResult).toBe('pending');
      expect(t.stores.seller.current()!.release!.phase).toBe('built');
      expect(t.stores.seller.current()!.release!.txHash).toBeUndefined();
    } finally {
      await dest.close();
    }
  });

  it('a submit refused because another tx emptied the escrow stops for good, without resending', async () => {
    const t = await kit.newTrade();
    await readyAndFund(t);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // The buyer signs, then dies before broadcasting.
      t.stores.buyer.onSave = (x) => {
        if (x.release?.phase === 'signed') throw new Error('power cut');
      };
      const sellerDone = t.parties.seller.settle(o);
      sellerDone.catch(() => undefined);
      expect(String(await t.parties.buyer.settle(o).catch((e: unknown) => e))).toMatch(/power cut/);
      await t.parties.buyer.stop();
      t.stores.buyer.onSave = undefined;
      const saved = t.stores.buyer.current()!;
      // That set reaches the chain anyway (another approved set, from this party's view)...
      const other = await engine.resume(saved.session, { daemonUri: node.rpcUri, password: 'pw-buyer' });
      sessions.push(other);
      const otherHash = await other.submit(saved.release!.signedHex!);
      await mine(node.rpcUri, 1, funderAddress);
      // ...while the party holds a different signed tx, which the daemon now refuses for good.
      t.stores.buyer.set({ ...saved, release: { ...saved.release!, signedHex: '00', txHash: randomHash() } });
      const spy = spyEngine(engine);
      const restarted = kit.startParty(t, 'buyer', { engine: spy });
      await restarted.party.ready();
      await expect(restarted.party.settle(o)).rejects.toMatchObject({ code: 'settled-elsewhere' });
      expect(t.stores.buyer.current()!.release!.phase).toBe('superseded');
      expect(spy.calls.submit).toBe(1);
      // It may still answer setup resends, but never sends a release message again.
      const sentBefore = restarted.tap.out.length;
      await new Promise((r) => setTimeout(r, 5000));
      const later = restarted.tap.out.slice(sentBefore);
      const keys: string[] = [];
      for (const env of later) {
        const opened = await open(env, { me: t.ids.seller, myRole: 'seller', participants: t.participants, trade: t.code, guard: new ReplayGuard(t.code) }).catch(() => null);
        if (opened) keys.push(String((opened.payload as { key: string }).key));
      }
      expect(keys.filter((k) => !k.startsWith('msig.'))).toEqual([]);
      expect(spy.calls.submit).toBe(1); // never resubmitted
      expect(spy.calls.buildRelease ?? 0).toBe(0); // never rebuilt
      expect(spy.calls.signRelease ?? 0).toBe(0);
      expect(await restarted.party.settle(o).catch((e: unknown) => e)).toMatchObject({ code: 'settled-elsewhere' });
      expect(otherHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await dest.close();
    }
  });

  it('a frame whose raw `from` differs from the signed one is attributed to the signed sender', async () => {
    const t = await kit.newTrade();
    await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    const o: Outcome = { kind: 'release', to: [{ address: 'nowhere', amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
    void t.parties.buyer.settle(o).catch(() => undefined);
    await expect.poll(() => t.stores.buyer.current()?.release?.outcome).toBeTruthy();
    const tag = t.stores.buyer.current()!.release!.outcome.slice(0, 16);
    const key = `state.export:${tag}.1`;
    const e = await seal({ trade: t.code, from: 'seller', seq: 1_000_000, type: 'state.export', payload: { key, hex: 'x' }, to: ['buyer'], me: t.ids.seller, participants: t.participants });
    // The checks see the signed fields; a later read of `from` says 'mod'.
    t.taps.buyer.inject(new Proxy({ ...e }, { get: (target, k) => (k === 'from' ? 'mod' : Reflect.get(target, k)) }));
    await expect.poll(() => t.stores.buyer.current()?.received[key]?.seller !== undefined, { timeout: 30_000 }).toBe(true);
    expect(t.stores.buyer.current()!.received[key]!.mod).toBeUndefined();
  });

  it('a daemon that stops answering: the party sees a retryable timeout, keeps going and settles', async () => {
    const proxy = await holdableProxy(node.rpcUri);
    try {
      daemonUri = proxy.uri;
      const t = await kit.newTrade();
      await readyAndFund(t);
      const dest = await newTestWallet(node.rpcUri);
      try {
        const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
        proxy.hold();
        const settled = Promise.all(ROLES.map((r) => t.parties[r].settle(o)));
        settled.catch(() => undefined);
        await expect.poll(() => kit.ignoredBy.buyer.includes('daemon-unavailable'), { timeout: 3 * DAEMON_TIMEOUT_MS, interval: 500 }).toBe(true);
        proxy.release();
        const [b, s] = await minedWhile(node.rpcUri, funderAddress, settled);
        expect(b).toMatch(/^[0-9a-f]{64}$/);
        expect(s).toBeNull();
      } finally {
        await dest.close();
      }
    } finally {
      await proxy.close();
    }
  });

  it(`every daemon call gives up after ${DAEMON_TIMEOUT_MS / 1000} s with a retryable error`, async () => {
    expect(DAEMON_TIMEOUT_MS).toBe(15_000);
    const hole = await blackHole();
    // A wallet created against the real node (creating one needs the daemon), then pointed at the hole.
    const real = await engine.create({ daemonUri: node.rpcUri, password: 'x' });
    sessions.push(real);
    const s = new MoneroMultisigSession(real.wallet, hole.uri, 'x');
    try {
      for (const call of [() => s.sync(), () => s.txStatus(randomHash())]) {
        const started = Date.now();
        const err = await call().then(() => null, (e: unknown) => e);
        const took = Date.now() - started;
        expect(err).toBeInstanceOf(EscrowError);
        expect((err as EscrowError).code).toBe('daemon-unavailable');
        expect(took).toBeGreaterThanOrEqual(DAEMON_TIMEOUT_MS - 100);
        expect(took).toBeLessThan(DAEMON_TIMEOUT_MS + 5000);
      }
    } finally {
      await hole.close(); // the dropped calls now fail fast, so the wallet can close
    }
  });
});
