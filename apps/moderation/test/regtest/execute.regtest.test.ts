// Plan 4 Task 14 on regtest: a whole dispute's payout, end to end, on a real chain. A moderator
// proposes "release to buyer" on a trade above the large-trade limit and the owner approves it, each
// with a real WebAuthn tap; the moderation process's gate authorises the ruling against its own
// pinned registry and recorded terms; the executor hands the gate's payouts to the moderator's real
// escrow party (`builder: 'mod'`), the buyer's party co-signs as its app would (Task 15), and the
// buyer and the fee wallet are paid on regtest. Exactly once: a restarted executor settles nothing.
// The chain, wallets, multisig engine and all three parties are real; the relay is the in-memory one
// (test/chain.ts): apps/moderation may not load @x2f/relay, tests included (separation check P3-C1).
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLES, type Role } from '@x2f/core';
import { MoneroMultisigEngine, runParty, type PartyHandle, type PartyState, type PartyStore } from '@x2f/escrow';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rulingExecutor } from '../../src/execute.js';
import { memoryRelay } from '../chain.js';
import { openGateStore } from '../../src/gate/index.js';
import { BALANCE, ctx, recorded, ruling, tapBy, world } from '../gateWorld.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
/** The most a network fee may take (Plan 1's MAX_NETWORK_FEE is 0.01 XMR). */
const MAX_NET_FEE = 10_000_000_000n;

function memoryStore(): PartyStore {
  let s: PartyState | null = null;
  return {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
    },
  };
}

describe('a ruling paid out on regtest (Plan 4 Task 14)', () => {
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

  /** Keeps mining while `p` runs: the builder counts a release done only once it is in a block. */
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

  async function balanceOf(w: MoneroWalletFull): Promise<bigint> {
    await w.setDaemonConnection({ uri: node.rpcUri });
    await w.sync();
    return w.getBalance();
  }

  it('propose, approve, gate, payout: the buyer and the fee wallet are paid, once', async () => {
    // The staff and the ruling: a moderator proposes, the owner approves (the trade is above the gate's limit).
    const w = await world();
    const mod = w.hire('mod');
    const c = ruling(mod, { approver: w.owner, outcome: 'release-to-buyer' });
    const code = c.ruling.code;
    w.api.taps.push(tapBy(mod, c.intent('propose')), tapBy(w.owner, c.intent('approve')));
    w.api.rulings.set(code, { current: c.ruling, round1: null, involved: [] });
    const dir = await mkdtemp(join(tmpdir(), 'x2f-exec-rt-'));
    dirs.push(dir);
    const key = new Uint8Array(randomBytes(32));
    const store = await openGateStore(dir, key);
    store.state = w.gate;
    await store.save();

    // The escrow: three real parties, funded with the seller's whole deposit.
    const ids = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await generateIdentity()] as const))) as Record<Role, Identity>;
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    const relay = memoryRelay();
    const parties = Object.fromEntries(
      ROLES.map((role) => {
        const p = runParty({
          role,
          trade: code,
          me: ids[role],
          participants,
          transport: relay.transport(role),
          engine,
          daemonUri: node.rpcUri,
          password: `pw-${role}`,
          store: memoryStore(),
          resendMs: 500,
          resendMaxMs: 2000,
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

    // This process's own recorded terms: the attested deal and the traders' addresses.
    const [buyerW, sellerW, feeW] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    wallets.push(buyerW, sellerW, feeW);
    const terms = { ...recorded(200_000n), buyerPayout: await buyerW.getPrimaryAddress(), sellerRefund: await sellerW.getPrimaryAddress(), feeWallet: await feeW.getPrimaryAddress() };

    // The executor's pass, on the funds the moderator's own party reads, until it hands the payout.
    const exec = rulingExecutor({ store, source: w.api, ctx: ctx(), log: () => {} });
    const pass = async () => {
      const f = await parties.mod.funds();
      return exec.step({ code, handle: parties.mod, api: { state: 'disputed', paused: false }, funds: { balance: f.balance, unlocked: f.unlocked }, recorded: terms });
    };
    await expect.poll(pass, { timeout: 120_000, interval: 2000 }).toBe('handed');
    const ex = store.state.executions[code]!;
    expect(ex).toMatchObject({ rulingId: c.ruling.id, winner: 'buyer', settledAt: null });
    const to = ex.payouts.map((p) => ({ address: p.address, amountAtomic: BigInt(p.amountAtomic) }));
    expect(to.map((p) => p.address)).toEqual([terms.buyerPayout, terms.feeWallet]);

    // The buyer's app co-signs exactly that mod-built set (Task 15's cosignPolicy); the tx lands.
    const tx = await mining(parties.buyer.settle({ kind: 'release', to, builder: 'mod', cosigner: 'buyer' }));
    expect(tx).toMatch(/^[0-9a-f]{64}$/);
    await mining(expect.poll(() => store.state.executions[code]?.settledAt ?? null, { timeout: 120_000, interval: 1000 }).not.toBeNull());
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
    const feePayout = to[1]!.amountAtomic;
    expect(await balanceOf(feeW)).toBe(feePayout);
    const got = await balanceOf(buyerW);
    expect(got).toBeLessThan(to[0]!.amountAtomic);
    expect(got).toBeGreaterThan(to[0]!.amountAtomic - MAX_NET_FEE);
    expect(await balanceOf(sellerW)).toBe(0n);

    // Once: this executor and a restarted one (the gate reopened from disk) settle nothing more.
    expect(await pass()).toBe('settled');
    const reopened = await openGateStore(dir, key);
    const restarted = rulingExecutor({ store: reopened, source: w.api, ctx: ctx(), log: () => {} });
    const asked: unknown[] = [];
    expect(await restarted.step({ code, handle: { settle: async (o) => (asked.push(o), null) }, api: { state: 'disputed', paused: false }, funds: { balance: BALANCE, unlocked: BALANCE }, recorded: terms })).toBe('settled');
    expect(asked).toEqual([]);
  });
});
