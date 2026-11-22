// Plan 7 Task 2, lead follow-up (the moderation-database purge) on regtest: two trades whose escrows
// are REAL 2-of-3 Monero multisig wallets (monero-ts on monerod regtest), the moderator's run by the
// moderation service itself (startModeration, its own party I/O, its keys sealed in its own
// database: mod_party_state, mod_wallet_secrets, mod_escrow_state, signed_terms). Trade A is
// cancelled before anyone pays in; the moderator's own watch reads its real wallet, closes it and
// drops it 30 days later. Trade B is funded with real coins and still open. The API (a lying one, for
// B) orders both shredded. A's keys are gone from the moderation database and nothing names A any
// more; B is untouched, and its moderator party still reopens the funded escrow from what is stored.
// The relay is the in-memory one (test/chain.ts): apps/moderation may not load @x2f/relay.
import type { Role } from '@x2f/core';
import { MoneroMultisigEngine, runParty, type PartyHandle, type PartyState, type PartyStore, type Transport } from '@x2f/escrow';
import type { Participants } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { channelFor, escrowPlan, sweepMinimums, type AttestedTerms } from '@x2f/trade';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { escrowStore, loadParty, startModeration, walletPassword, TRADE_SHRED_TABLES, type ModerationHandle, type PartyIO } from '../../src/main.js';
import { claimSweep } from '../../src/watcher.js';
import { loadEscrow } from '../../src/keystore.js';
import { memoryRelay } from '../chain.js';
import { API, FEE_WALLET, fakeNetwork, makeCtx, newTrade, RELAY, TERMS, type Ctx, type Trader } from '../harness.js';

const DAY = 86_400_000;
const FUNDED = 1_000_000_000_000n; // 1 XMR

/**
 * The desks' signals channel: nobody else talks on it here. Its close ends a pending read (the
 * in-memory relay's does not), so the service stops cleanly.
 */
function idleTransport(): Transport {
  let waiter: ((e: unknown) => void) | null = null;
  return {
    send: () => {},
    next: () => new Promise((_resolve, reject) => (waiter = reject)),
    onReconnect: () => {},
    close: () => {
      waiter?.(new Error('closed'));
      waiter = null;
    },
  };
}

/** Progress on stderr, so a slow chain step shows where it is. */
const step = (s: string): void => {
  process.stderr.write(`[trade-shred regtest] ${new Date().toISOString()} ${s}\n`);
};

function memoryStore(): PartyStore {
  let s: PartyState | null = null;
  return {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
    },
  };
}

describe('the moderation trade shred on regtest (Plan 7 Task 2 follow-up)', () => {
  let node: Regtest;
  let funder: MoneroWalletFull;
  let ctx: Ctx;
  let mod: ModerationHandle | null = null;
  const parties: PartyHandle[] = [];
  const engine = new MoneroMultisigEngine({ network: 'regtest' });
  const relays = new Map<string, ReturnType<typeof memoryRelay>>();
  const relayOf = (channel: string) => {
    let r = relays.get(channel);
    if (!r) relays.set(channel, (r = memoryRelay()));
    return r;
  };

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    ctx = await makeCtx();
    // This service's own clock is the wall clock here: its rows are made by the database's.
    ctx.clock.now = new Date();
  });

  afterAll(async () => {
    await mod?.stop();
    for (const p of parties.splice(0)) await p.stop().catch(() => undefined);
    await funder?.close();
    await ctx?.db.end();
    await node?.stop();
  });

  /** Every row naming `code` in every table the shred deletes, as text. */
  async function rowsOf(code: string): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const t of TRADE_SHRED_TABLES) {
      const { rows } = await ctx.db.query<{ j: string }>(`select row_to_json(x)::text as j from ${t} x where x.trade = $1 order by 1`, [code]);
      out[t] = rows.map((r) => r.j);
    }
    return out;
  }

  async function dumpAll(): Promise<string> {
    const { rows: tables } = await ctx.db.query<{ t: string }>(`select quote_ident(tablename) as t from pg_tables where schemaname = 'public'`);
    const parts: string[] = [];
    for (const { t } of tables) parts.push(...(await ctx.db.query<{ j: string }>(`select row_to_json(x)::text as j from ${t} x`)).rows.map((r) => r.j));
    return parts.join('\n');
  }

  /** The two traders' real escrow parties for an attested trade, against the mod's sealed participants. */
  async function traders(code: string, buyer: Trader, seller: Trader): Promise<Record<'buyer' | 'seller', PartyHandle>> {
    const sealed = await loadParty<{ participants: Participants }>(ctx.db, ctx.keystoreKey, code);
    const channel = await channelFor(code, 'escrow');
    const out = {} as Record<'buyer' | 'seller', PartyHandle>;
    for (const t of [buyer, seller]) {
      const p = runParty({
        role: t.role as Role,
        trade: channel,
        me: t.id,
        participants: sealed!.participants,
        transport: relayOf(channel).transport(t.role),
        engine,
        daemonUri: node.rpcUri,
        password: `pw-${t.role}`,
        store: memoryStore(),
        resendMs: 500,
        resendMaxMs: 2000,
      });
      parties.push(p);
      out[t.role] = p;
    }
    return out;
  }

  it("a closed, empty escrow loses every key and row after its own watch dropped it; an open funded one is untouched and still opens", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const logs: string[] = [];
    const io: PartyIO = {
      relayUrl: 'ws://relay.test',
      engine,
      run: (a) => runParty({ ...a, resendMs: 500, resendMaxMs: 2000 }),
      transport: ({ code, role }) => relayOf(code).transport(role),
    };
    mod = await startModeration(
      { apiInternalUrl: API, relayAdminUrl: RELAY, relayUrl: 'ws://relay.test', network: 'regtest', daemonUri: node.rpcUri, db: ctx.db, keystoreKey: ctx.keystoreKey, signingSecret: ctx.modSign.secret, feeWallet: FEE_WALLET },
      { fetch, now: () => ctx.clock.now, intervalMs: 0, watchIntervalMs: 0, partyIO: io, signalsTransport: () => idleTransport(), log: (e) => logs.push(e.reason) },
    );

    // Both trades attested and sealed by the service; its real moderator parties start.
    const a = await newTrade();
    const b = await newTrade();
    step('attesting');
    net.work = [a.work, b.work];
    expect((await mod.tick()).sort()).toEqual([a.code, b.code].sort());
    net.work = [];
    const aParties = await traders(a.code, a.buyer, a.seller);
    const bParties = await traders(b.code, b.buyer, b.seller);
    step('waiting for both escrows');
    const [aAddress] = await Promise.all([aParties.buyer.ready(), aParties.seller.ready()]);
    const [bAddress] = await Promise.all([bParties.buyer.ready(), bParties.seller.ready()]);
    step('escrows ready');
    net.states.set(a.code, 'setup');
    net.states.set(b.code, 'setup');
    await expect
      .poll(async () => {
        await mod!.watch();
        return [a.code, b.code].every((c) => net.reports.some((r) => r.kind === 'setup-done' && r.trade === c));
      }, { timeout: 300_000, interval: 1000 })
      .toBe(true);
    expect(net.reports.find((r) => r.kind === 'setup-done' && r.trade === a.code)?.escrowAddress).toBe(aAddress);
    // The moderator's escrow key material is sealed in its own database.
    expect(await loadEscrow(ctx.db, ctx.keystoreKey, a.code)).not.toBeNull();
    expect(await loadEscrow(ctx.db, ctx.keystoreKey, b.code)).not.toBeNull();

    step('setup-done reported');
    // B: the seller pays in real coins; B stays open (secured).
    net.states.set(b.code, 'funding');
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: bAddress, amount: FUNDED, relay: true });
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
    await expect
      .poll(async () => {
        await mod!.watch();
        return net.reports.some((r) => r.kind === 'chain' && r.trade === b.code && r.receivedAtomic === FUNDED.toString());
      }, { timeout: 300_000, interval: 1000 })
      .toBe(true);
    net.states.set(b.code, 'secured');
    step('B funded and seen');

    // A: cancelled with nothing paid in. The moderator's watch reads its real wallet (empty), closes
    // it, and drops it 30 days later.
    net.states.set(a.code, 'cancelled');
    await expect
      .poll(async () => {
        await mod!.watch();
        const { rows } = await ctx.db.query<{ state: { closedAt: string | null; channelsClosed: boolean } }>('select state from mod_watch where trade = $1', [a.code]);
        return rows[0]?.state.closedAt !== null && rows[0]?.state.channelsClosed === true;
      }, { timeout: 120_000, interval: 1000 })
      .toBe(true);
    step('A closed by the watch');
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    await mod.watch();
    expect((await ctx.db.query('select watching from mod_watch where trade = $1', [a.code])).rows).toEqual([{ watching: false }]);

    // The API purged A (off its list) and, lying, orders B shredded too while B is open and listed.
    net.states.delete(a.code);
    const bBefore = await rowsOf(b.code);
    net.tradeShred = [{ trade: a.code, purgedAt: ctx.clock.now.toISOString() }, { trade: b.code, purgedAt: ctx.clock.now.toISOString() }];
    expect(await mod.tradeShredTick()).toEqual([a.code]);
    expect(logs).toContain('trade-shred-held-listed');
    expect(net.reports.filter((r) => r.kind === 'trade-shredded').map((r) => r.trade)).toEqual([a.code]);

    // A: every key and row is gone; nothing in the moderation database names it.
    for (const [t, rows] of Object.entries(await rowsOf(a.code))) expect(rows, t).toEqual([]);
    expect(await loadEscrow(ctx.db, ctx.keystoreKey, a.code)).toBeNull();
    expect(await loadParty(ctx.db, ctx.keystoreKey, a.code)).toBeNull();
    expect(await escrowStore(ctx.db, ctx.keystoreKey, a.code).load()).toBeNull();
    expect(await dumpAll()).not.toContain(a.code);

    // B: untouched, and hidden from the list it is still kept (its party runs here).
    expect(await rowsOf(b.code)).toEqual(bBefore);
    net.states.delete(b.code);
    net.tradeShred = [{ trade: b.code, purgedAt: ctx.clock.now.toISOString() }];
    expect(await mod.tradeShredTick()).toEqual([]);
    expect(logs).toContain('trade-shred-held-running');
    expect(await rowsOf(b.code)).toEqual(bBefore);

    // What is stored for B still opens its escrow: a fresh moderator party resumed from the sealed
    // state and its R27 password shows the same address and the coins paid in.
    step('stopping the service');
    await mod.stop();
    mod = null;
    step('resuming B from the store');
    const channel = await channelFor(b.code, 'escrow');
    const sealed = await loadParty<{ me: { signPublic: string; boxPublic: string; signSecret: string; boxSecret: string }; participants: Participants }>(ctx.db, ctx.keystoreKey, b.code);
    const me = {
      signPublic: sealed!.me.signPublic,
      boxPublic: sealed!.me.boxPublic,
      signSecret: new Uint8Array(Buffer.from(sealed!.me.signSecret, 'hex')),
      boxSecret: new Uint8Array(Buffer.from(sealed!.me.boxSecret, 'hex')),
    };
    const resumed = runParty({
      role: 'mod',
      trade: channel,
      me,
      participants: sealed!.participants,
      transport: memoryRelay().transport('mod'),
      engine,
      daemonUri: node.rpcUri,
      password: await walletPassword(ctx.db, ctx.keystoreKey, b.code),
      store: escrowStore(ctx.db, ctx.keystoreKey, b.code),
      resendMs: 500,
      resendMaxMs: 2000,
    });
    parties.push(resumed);
    expect(await resumed.ready()).toBe(bAddress);
    await expect.poll(async () => (await resumed.funds()).balance, { timeout: 120_000, interval: 1000 }).toBe(FUNDED);
    step('done');
  }, 1_500_000);

  /** Keeps mining while `p` runs: a release counts as done only once it is in a block. */
  async function mining<T>(p: Promise<T>): Promise<T> {
    let done = false;
    const address = await funder.getPrimaryAddress();
    const miner = (async () => {
      while (!done) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!done) await mine(node.rpcUri, 1, address).catch(() => undefined);
      }
    })();
    try {
      return await p;
    } finally {
      done = true;
      await miner;
    }
  }

  // Review lead-mod-purge m4: the R2-I2 path end to end. A real release, seller-built and
  // buyer-co-signed, swept to real wallets; the moderator's watcher proves and counts the sweep,
  // closes the escrow and drops it 30 days later; then the shred destroys every key and row, and
  // leaves only the sweep's keyed tag, so no other trade can count that tx (review M2).
  it('a released, swept escrow: shown empty by its own watch, dropped, then every key and row goes and its sweep is tagged spent', async () => {
    const wallets = await Promise.all([newTestWallet(node.rpcUri), newTestWallet(node.rpcUri), newTestWallet(node.rpcUri)]);
    try {
      const [buyerW, sellerW, feeW] = wallets as [MoneroWalletFull, MoneroWalletFull, MoneroWalletFull];
      const feeWallet = await feeW.getPrimaryAddress();
      const terms: AttestedTerms = { ...TERMS, buyerPayout: await buyerW.getPrimaryAddress(), sellerRefund: await sellerW.getPrimaryAddress() };
      const { net, fetch } = fakeNetwork(ctx);
      const logs: string[] = [];
      const io: PartyIO = {
        relayUrl: 'ws://relay.test',
        engine,
        run: (a) => runParty({ ...a, resendMs: 500, resendMaxMs: 2000 }),
        transport: ({ code, role }) => relayOf(code).transport(role),
      };
      ctx.clock.now = new Date();
      mod = await startModeration(
        { apiInternalUrl: API, relayAdminUrl: RELAY, relayUrl: 'ws://relay.test', network: 'regtest', daemonUri: node.rpcUri, db: ctx.db, keystoreKey: ctx.keystoreKey, signingSecret: ctx.modSign.secret, feeWallet },
        { fetch, now: () => ctx.clock.now, intervalMs: 0, watchIntervalMs: 0, partyIO: io, signalsTransport: () => idleTransport(), log: (e) => logs.push(e.reason) },
      );
      const t = await newTrade(terms);
      net.work = [t.work];
      expect(await mod.tick()).toEqual([t.code]);
      net.work = [];
      const p = await traders(t.code, t.buyer, t.seller);
      const [address] = await Promise.all([p.buyer.ready(), p.seller.ready()]);
      net.states.set(t.code, 'setup');
      await expect
        .poll(async () => {
          await mod!.watch();
          return net.reports.some((r) => r.kind === 'setup-done' && r.trade === t.code);
        }, { timeout: 300_000, interval: 1000 })
        .toBe(true);
      step('released trade: escrow ready');

      // Funded with exactly what the deal needs, then released: buyer and fee wallet paid, the whole escrow swept.
      net.states.set(t.code, 'funding');
      const funds = escrowPlan({ amountAtomic: BigInt(terms.deal.takeAmountAtomic), poster: terms.deal.poster }).sellerFundsAtomic;
      await funder.setDaemonConnection({ uri: node.rpcUri });
      await funder.sync();
      await funder.createTx({ accountIndex: 0, address, amount: funds, relay: true });
      await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
      await expect
        .poll(async () => {
          await mod!.watch();
          return net.reports.some((r) => r.kind === 'chain' && r.trade === t.code && r.receivedAtomic === funds.toString());
        }, { timeout: 300_000, interval: 1000 })
        .toBe(true);
      net.states.set(t.code, 'settling');
      net.settleKinds.set(t.code, 'release');
      const to = sweepMinimums({ kind: 'release', terms, feeWallet, sweptAtomic: funds })!;
      // The co-signer (buyer) submits, so its settle() answers the tx hash (as packages/escrow's spend-info regtest).
      const [sweepTx] = await mining(Promise.all([p.buyer.settle({ kind: 'release', to, builder: 'seller', cosigner: 'buyer' }), p.seller.settle({ kind: 'release', to, builder: 'seller', cosigner: 'buyer' })]));
      step('released trade: release mined');
      const txHash = sweepTx ?? null;
      await expect
        .poll(async () => {
          await mine(node.rpcUri, 1, await funder.getPrimaryAddress());
          await mod!.watch();
          return net.reports.find((r) => r.kind === 'settled' && r.trade === t.code)?.txHash ?? null;
        }, { timeout: 300_000, interval: 2000 })
        .not.toBeNull();
      const settled = net.reports.find((r) => r.kind === 'settled' && r.trade === t.code)!.txHash as string;
      if (txHash !== null) expect(settled).toBe(txHash);
      expect((await ctx.db.query('select trade from mod_sweeps where tx_hash = $1', [settled])).rows).toEqual([{ trade: t.code }]);
      step('released trade: sweep counted');

      // The API shows it released; the watch closes the escrow (shown empty) and drops it 30 days later.
      net.states.set(t.code, 'released');
      net.settleKinds.delete(t.code);
      await mod.watch();
      const { rows } = await ctx.db.query<{ state: { closedAt: string | null; channelsClosed: boolean; settledTx: string | null } }>('select state from mod_watch where trade = $1', [t.code]);
      expect(rows[0]!.state.closedAt).not.toBeNull();
      expect(rows[0]!.state.channelsClosed).toBe(true);
      expect(rows[0]!.state.settledTx).toBe(settled);
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
      await mod.watch();
      expect((await ctx.db.query('select watching from mod_watch where trade = $1', [t.code])).rows).toEqual([{ watching: false }]);

      net.states.delete(t.code);
      net.tradeShred = [{ trade: t.code, purgedAt: ctx.clock.now.toISOString() }];
      expect(await mod.tradeShredTick()).toEqual([t.code]);
      for (const [tbl, r] of Object.entries(await rowsOf(t.code))) expect(r, tbl).toEqual([]);
      expect(await loadEscrow(ctx.db, ctx.keystoreKey, t.code)).toBeNull();
      expect(await loadParty(ctx.db, ctx.keystoreKey, t.code)).toBeNull();
      const dump = await dumpAll();
      expect(dump).not.toContain(t.code);
      expect(dump).not.toContain(settled);
      // Its sweep can never be counted for another trade.
      expect(await claimSweep(ctx.db, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', settled, ctx.keystoreKey)).toBe(false);
      await mod.stop();
      mod = null;
      step('released trade: done');
    } finally {
      for (const w of wallets) await w.close().catch(() => undefined);
    }
  }, 1_500_000);
});
