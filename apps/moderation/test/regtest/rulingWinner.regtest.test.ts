// Ruling-winner reasons on regtest (lead 22 Nov; review-lead-fix-ruling-pay, builder's question 1),
// with three real escrow parties, the real gate and the executor. Case (b): the buyer wins, but its
// party had already built a buyer-cancel (buyer-built, the moderator co-signs) and is committed to
// it, so it never exports for the mod-built ruling set. The moderation process names that from its
// own party's view alone (the buyer's signed release messages) and reports `winner-committed`; it
// signs nothing else. And a winner whose app is not open is `winner-offline` until it takes part,
// then the reason clears and the ruling pays. The relay is the in-memory one (separation check P3-C1).
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLES, type Role } from '@x2f/core';
import { MoneroMultisigEngine, runParty, type Outcome, type PartyHandle, type PartyState, type PartyStore, type Transport } from '@x2f/escrow';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import type { MoneroWalletFull } from 'monero-ts';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rulingExecutor, type RulingWait } from '../../src/execute.js';
import { openGateStore } from '../../src/gate/index.js';
import { memoryRelay } from '../chain.js';
import { BALANCE, ctx, newGate, recorded, ruling, tapBy, world } from '../gateWorld.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });

function memoryStore(): PartyStore & { current(): PartyState | null } {
  let s: PartyState | null = null;
  return {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
    },
    current: () => s,
  };
}

/** A transport whose incoming frames can be held back (each waits, in order, while `held`). */
function holdable(t: Transport): { transport: Transport; hold(on: boolean): void } {
  let held = false;
  return {
    transport: {
      ...t,
      next: async () => {
        const f = await t.next();
        while (held) await new Promise((r) => setTimeout(r, 200));
        return f;
      },
    },
    hold: (on) => {
      held = on;
    },
  };
}

describe('why a ruling payout waits on its winner, on regtest (ruling-winner-committed / -offline)', () => {
  let node: Regtest;
  let funder: MoneroWalletFull;
  const running: PartyHandle[] = [];
  const wallets: MoneroWalletFull[] = [];
  const dirs: string[] = [];

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
  });
  afterAll(async () => {
    for (const p of running.splice(0)) await p.stop();
    for (const w of wallets.splice(0)) await w.close();
    await funder?.close();
    await node?.stop();
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

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

  /** A buyer-wins ruling (moderator proposes, owner approves), a funded escrow with three real parties, and an executor that reports its waits. */
  async function world3() {
    const w = await world();
    const mod = w.hire('mod');
    const c = ruling(mod, { approver: w.owner, outcome: 'release-to-buyer' });
    const code = c.ruling.code;
    w.api.taps.push(tapBy(mod, c.intent('propose')), tapBy(w.owner, c.intent('approve')));
    w.api.rulings.set(code, { current: c.ruling, round1: null, involved: [] });
    const dir = await mkdtemp(join(tmpdir(), 'x2f-winner-rt-'));
    dirs.push(dir);
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    const store = await openGateStore(dir, key);
    store.state = w.gate;
    await store.save();

    const ids = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await generateIdentity()] as const))) as Record<Role, Identity>;
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    const relay = memoryRelay();
    const modIn = holdable(relay.transport('mod'));
    const stores = Object.fromEntries(ROLES.map((r) => [r, memoryStore()])) as Record<Role, ReturnType<typeof memoryStore>>;
    const parties = Object.fromEntries(
      ROLES.map((role) => {
        const p = runParty({
          role, trade: code, me: ids[role], participants, transport: role === 'mod' ? modIn.transport : relay.transport(role), engine,
          daemonUri: node.rpcUri, password: `pw-${role}`, store: stores[role], resendMs: 500, resendMaxMs: 2000,
        });
        running.push(p);
        return [role, p] as const;
      }),
    ) as Record<Role, PartyHandle>;
    const addresses = await Promise.all(ROLES.map((r) => parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addresses[0]!, amount: BALANCE, relay: true });
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());

    const [buyerW, sellerW, feeW] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    wallets.push(buyerW, sellerW, feeW);
    const terms = { ...recorded(200_000n), buyerPayout: await buyerW.getPrimaryAddress(), sellerRefund: await sellerW.getPrimaryAddress(), feeWallet: await feeW.getPrimaryAddress() };

    await sodium.ready;
    const modKey = sodium.crypto_sign_keypair();
    const logs: string[] = [];
    const reports: Array<RulingWait | null> = [];
    const exec = rulingExecutor({ store, source: w.api, ctx: ctx(), log: (e) => logs.push(e.reason), signingSecret: modKey.privateKey, winnerWaitMs: 0 });
    const pass = async () => {
      const f = await parties.mod.funds();
      return exec.step({
        code, handle: parties.mod, api: { state: 'disputed', paused: false }, funds: { balance: f.balance, unlocked: f.unlocked }, recorded: terms,
        escrowAddress: addresses[0]!, announce: async () => true, reportWait: async (r) => (reports.push(r), true),
      });
    };
    return { code, store, parties, stores, modIn, terms, pass, logs, reports };
  }

  it("case (b): the buyer won but its party is committed to its own buyer-cancel: winner-committed, and the moderator signs nothing", async () => {
    const x = await world3();
    // The buyer's cancel, before any dispute: the moderator's party took it and exported, but the
    // buyer's set had not reached it (held here) when the trade was disputed and the ruling came.
    const cancel: Outcome = { kind: 'release', to: [{ address: x.terms.sellerRefund, amountAtomic: BALANCE }], builder: 'buyer', cosigner: 'mod' };
    x.modIn.hold(true);
    x.parties.mod.settle(cancel).catch(() => undefined);
    x.parties.buyer.settle(cancel).catch(() => undefined);
    await expect.poll(() => x.parties.buyer.committedBuilder!(), { timeout: 180_000, interval: 1000 }).toBe('buyer');
    expect(x.parties.mod.committedBuilder!()).toBeNull();
    // The ruling: recorded, announced and handed (the moderator's uncommitted cancel is replaced).
    await expect.poll(x.pass, { timeout: 120_000, interval: 2000 }).toBe('handed');
    await expect.poll(() => x.stores.mod.current()?.release?.part ?? null, { timeout: 60_000 }).toBe('builder');
    x.modIn.hold(false);
    // The buyer's party keeps resending its built cancel; the moderator's party only notes it.
    await expect.poll(() => x.parties.mod.peerRelease!('buyer').elsewhere?.txSet ?? false, { timeout: 120_000, interval: 1000 }).toBe(true);
    expect(x.parties.mod.peerRelease!('buyer').current).toBe(false);
    expect(await x.pass()).toBe('in-flight');
    expect(x.reports).toEqual(['winner-committed']);
    expect(x.logs).toContain('ruling-winner-committed');
    // Nothing was signed by the moderator: no tx of its own, the escrow untouched, its release still waiting for the winner's export.
    await mining(new Promise((r) => setTimeout(r, 8000)));
    const f = await x.parties.mod.funds();
    expect(f.ownTxs ?? []).toEqual([]);
    expect(f.balance).toBe(BALANCE);
    expect(x.stores.mod.current()!.release).toMatchObject({ part: 'builder', counterpart: 'buyer', phase: 'export' });
    expect(x.parties.mod.committedBuilder!()).toBeNull();
    expect(await x.pass()).toBe('in-flight');
    expect(x.reports).toEqual(['winner-committed']);
  });

  it('a winner whose app is not open is winner-offline; once it takes part the reason clears and the ruling pays', async () => {
    const x = await world3();
    await expect.poll(x.pass, { timeout: 120_000, interval: 2000 }).toBe('handed');
    expect(await x.pass()).toBe('in-flight');
    expect(x.reports).toEqual(['winner-offline']);
    // The buyer's app opens and co-signs the mod-built set (Task 15's cosignPolicy would check the statement first).
    const ex = x.store.state.executions[x.code]!;
    // The buyer won: a completed trade's outputs (buyer, fee) each bear their share of the network fee (netfee split).
    const to = ex.payouts.map((p) => ({ address: p.address, amountAtomic: BigInt(p.amountAtomic), bearsNetworkFee: true }));
    const paid = x.parties.buyer.settle({ kind: 'release', to, builder: 'mod', cosigner: 'buyer' });
    await expect.poll(() => x.parties.mod.peerRelease!('buyer').current, { timeout: 120_000, interval: 1000 }).toBe(true);
    await x.pass();
    expect(x.reports).toEqual(['winner-offline', null]);
    expect(x.logs).toContain('ruling-winner-joined');
    expect(await mining(paid)).toMatch(/^[0-9a-f]{64}$/);
  });
});
