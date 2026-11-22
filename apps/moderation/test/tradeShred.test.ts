// Plan 7 Task 2, lead follow-up (the moderation-database purge): when the API purges a trade it
// leaves a trade shred order (API migration 761). The order is only a trigger: this service deletes
// a trade's records (the signed terms with both addresses, the sealed party state, the wallet
// password, the escrow state, the watch state, the desk, the counted sweeps, the dispute and chat
// links) only when its OWN records say the trade is over, past its own clock, out of any dispute, its
// chats already shredded, and its escrow shown EMPTY by its own watch (review-p7-retention round 2,
// R2-I2: never on the API's word). An open trade is never touched, whatever the API says.
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { TRADE_KEEP_DAYS, CHAT_AFTER_DISPUTE_DAYS, newWatchState } from '@x2f/trade';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyGate, forgetTrade, GATE_OTHER_FIELDS, GATE_TRADE_FIELDS, tradeRulingPending } from '../src/gate/store.js';
import { loadEscrow, saveEscrow, sweepTag } from '../src/keystore.js';
import { loadParty, saveParty, TRADE_SHRED_KEPT, TRADE_SHRED_TABLES, walletPassword, type GateRun } from '../src/main.js';
import { claimSweep } from '../src/watcher.js';
import { fakeNetwork, hash, inFunding, makeCtx, moderation, newTrade, outcomeJson, secured, stopAll, type Ctx } from './harness.js';
import { dumpWatchState } from '../src/watcher.js';

const DAY = 86_400_000;
const ctxs: Ctx[] = [];
afterEach(async () => {
  await stopAll();
  for (const c of ctxs.splice(0)) await c.db.end();
});

async function setup(opts: { gate?: () => Promise<GateRun> } = {}) {
  const ctx = await makeCtx();
  ctxs.push(ctx);
  const { net, fetch } = fakeNetwork(ctx);
  const m = await moderation(ctx, fetch, opts.gate ? { gate: opts.gate } : {});
  return { ctx, net, m, fetch };
}

/** The rows were made by the database clock; this service's own clock is ctx.clock. */
async function madeAt(ctx: Ctx, code: string, at: Date): Promise<void> {
  await ctx.db.query('update signed_terms set created_at = $2 where trade = $1', [code, at]);
  await ctx.db.query('update mod_wallet_secrets set created_at = $2 where trade = $1', [code, at]);
}

/** Every row naming `code` in every table this shred deletes, as text (to compare before and after). */
async function rowsOf(ctx: Ctx, code: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of TRADE_SHRED_TABLES) {
    const { rows } = await ctx.db.query<{ j: string }>(`select row_to_json(x)::text as j from ${t} x where x.trade = $1 order by 1`, [code]);
    out[t] = rows.map((r) => r.j);
  }
  return out;
}

/** Every row of every table in the moderation database, as text. */
async function dumpAll(ctx: Ctx): Promise<string> {
  const { rows: tables } = await ctx.db.query<{ t: string }>(`select quote_ident(tablename) as t from pg_tables where schemaname = 'public'`);
  const parts: string[] = [];
  for (const { t } of tables) {
    const { rows } = await ctx.db.query<{ j: string }>(`select row_to_json(x)::text as j from ${t} x`);
    parts.push(...rows.map((r) => r.j));
  }
  return parts.join('\n');
}

/** A trade attested through the work list (tick), its party started by the watcher; returns its code. */
async function newTradeFor(m: Awaited<ReturnType<typeof moderation>>, net: ReturnType<typeof fakeNetwork>['net']): Promise<string> {
  const t = await newTrade();
  net.work = [t.work];
  expect(await m.handle.tick()).toEqual([t.code]);
  net.work = [];
  return t.code;
}

const order = (ctx: Ctx, trade: unknown) => ({ trade, purgedAt: new Date(ctx.clock.now.getTime() - 1000).toISOString() });
const shredded = (net: { reports: Array<Record<string, unknown>> }, code: string) => net.reports.filter((r) => r.kind === 'trade-shredded' && r.trade === code).length;

/** A trade attested here at ctx time and never started (no watch row, no escrow): `posted` like tick would. */
async function attestedOnly(ctx: Ctx, o: { escrow?: boolean } = {}): Promise<string> {
  const code = newTradeCode();
  await ctx.db.query('insert into signed_terms (trade, attestation, sig) values ($1, $2, $3)', [code, JSON.stringify({ trade: code }), 'ab'.repeat(64)]);
  await saveParty(ctx.db, ctx.keystoreKey, code, { v: 1, trade: code });
  await walletPassword(ctx.db, ctx.keystoreKey, code);
  if (o.escrow) await saveEscrow(ctx.db, ctx.keystoreKey, code, { escrow: true });
  await madeAt(ctx, code, ctx.clock.now);
  return code;
}

describe('the trade shred: what goes', () => {
  it('an escrow the API cancelled before funding, watched to its drop: every per-trade row and all key material go, and the API is told', async () => {
    const { ctx, net, m } = await setup();
    const l = await inFunding(ctx, m, net);
    // As the real party and watcher leave them: the sealed escrow state and a counted sweep.
    await saveEscrow(ctx.db, ctx.keystoreKey, l.code, { escrow: 'state' });
    await ctx.db.query('insert into mod_sweeps (tx_hash, trade) values ($1, $2)', [hash('9'), l.code]);
    await madeAt(ctx, l.code, ctx.clock.now);
    // The API cancels it with nothing ever paid in; the watch closes it and drops it 30 days later.
    net.states.set(l.code, 'cancelled');
    await m.handle.watch();
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    await m.handle.watch();
    expect((await ctx.db.query<{ watching: boolean }>('select watching from mod_watch where trade = $1', [l.code])).rows).toEqual([{ watching: false }]);
    expect((await ctx.db.query('select 1 from mod_trade_desk where trade = $1', [l.code])).rowCount).toBe(1);

    // The API purges it (off its watch list) and orders the shred.
    net.states.delete(l.code);
    net.tradeShred = [order(ctx, l.code)];
    expect(await m.handle.tradeShredTick()).toEqual([l.code]);
    for (const [t, rows] of Object.entries(await rowsOf(ctx, l.code))) expect(rows, t).toEqual([]);
    expect(await loadParty(ctx.db, ctx.keystoreKey, l.code)).toBeNull();
    expect(await loadEscrow(ctx.db, ctx.keystoreKey, l.code)).toBeNull();
    expect((await ctx.db.query('select 1 from mod_wallet_secrets where trade = $1', [l.code])).rowCount).toBe(0);
    // Nothing anywhere in the moderation database names the trade any more.
    expect(await dumpAll(ctx)).not.toContain(l.code);
    expect(shredded(net, l.code)).toBe(1);
    expect(m.logs).toContain('trade-shredded');
    // Idempotent: the same order again finds nothing to delete and is reported done again.
    expect(await m.handle.tradeShredTick()).toEqual([l.code]);
    expect(shredded(net, l.code)).toBe(2);
    // The watcher does not bring the trade back.
    await m.handle.watch();
    expect(await dumpAll(ctx)).not.toContain(l.code);
  });

  it('a trade this service attested but never started an escrow for goes once its own clock passed TRADE_KEEP_DAYS; before that it is held (young)', async () => {
    const { ctx, net, m } = await setup();
    const code = await attestedOnly(ctx);
    net.tradeShred = [order(ctx, code)];
    ctx.clock.now = new Date(ctx.clock.now.getTime() + TRADE_KEEP_DAYS * DAY - 1000);
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-young');
    expect((await ctx.db.query('select 1 from signed_terms where trade = $1', [code])).rowCount).toBe(1);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 2000);
    expect(await m.handle.tradeShredTick()).toEqual([code]);
    for (const [t, rows] of Object.entries(await rowsOf(ctx, code))) expect(rows, t).toEqual([]);
  });

  it('a refused report is logged and asked again: the records are already gone, and the next pass reports it done', async () => {
    const { ctx, net, m } = await setup();
    const code = await attestedOnly(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, code)];
    net.answer = (r) => (r.kind === 'trade-shredded' ? { status: 503 } : { status: 201 });
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-report-refused-503');
    expect((await ctx.db.query('select 1 from signed_terms where trade = $1', [code])).rowCount).toBe(0);
    net.answer = () => ({ status: 201 });
    expect(await m.handle.tradeShredTick()).toEqual([code]);
  });
});

describe('the trade shred: what is kept', () => {
  it('an open trade is never touched, whatever the API orders: listed (open), or hidden from the list by a lying API (its party runs, or its watch still watches)', async () => {
    const { ctx, net, m, fetch } = await setup();
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await saveEscrow(ctx.db, ctx.keystoreKey, l.code, { escrow: 'state' });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 400 * DAY);
    await madeAt(ctx, l.code, new Date(ctx.clock.now.getTime() - 300 * DAY));
    const before = await rowsOf(ctx, l.code);
    const party = await loadParty(ctx.db, ctx.keystoreKey, l.code);
    expect(party).not.toBeNull();

    net.tradeShred = [order(ctx, l.code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-listed');
    // Hidden from the list: its party still runs here.
    net.states.delete(l.code);
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-running');
    // After a restart (no party started yet): its own watch row still watches it.
    await m.handle.stop();
    const again = await moderation(ctx, fetch);
    expect(await again.handle.tradeShredTick()).toEqual([]);
    expect(again.logs).toContain('trade-shred-held-watching');

    expect(await rowsOf(ctx, l.code)).toEqual(before);
    expect(await loadParty(ctx.db, ctx.keystoreKey, l.code)).toEqual(party);
    expect(await loadEscrow(ctx.db, ctx.keystoreKey, l.code)).toEqual({ escrow: 'state' });
    expect(shredded(net, l.code)).toBe(0);
  });

  it('a closed escrow whose own watch never showed it empty keeps its keys after the drop (coins may remain): held escrow', async () => {
    const { ctx, net, m } = await setup();
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await saveEscrow(ctx.db, ctx.keystoreKey, l.code, { escrow: 'state' });
    await madeAt(ctx, l.code, ctx.clock.now);
    // The API says released, but no sweep is shown: the coins are late and escalate; the dispute is
    // seen, then the trade closes again with the coins still unswept, and the watch runs out.
    net.states.set(l.code, 'released');
    await m.handle.watch();
    expect(l.net.reports.some((r) => r.kind === 'late-funds' && r.trade === l.code)).toBe(true);
    net.states.set(l.code, 'disputed');
    await m.handle.watch();
    net.states.set(l.code, 'released');
    await m.handle.watch();
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    await m.handle.watch();
    expect((await ctx.db.query<{ watching: boolean }>('select watching from mod_watch where trade = $1', [l.code])).rows).toEqual([{ watching: false }]);

    // Past the dispute's 90 days too, and off the list: only the escrow fact holds it.
    ctx.clock.now = new Date(ctx.clock.now.getTime() + (CHAT_AFTER_DISPUTE_DAYS + 1) * DAY);
    net.states.delete(l.code);
    const before = await rowsOf(ctx, l.code);
    net.tradeShred = [order(ctx, l.code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-escrow');
    expect(await rowsOf(ctx, l.code)).toEqual(before);
    expect(await loadEscrow(ctx.db, ctx.keystoreKey, l.code)).toEqual({ escrow: 'state' });
  });

  it('an escrow state with no watch row was never shown empty: held escrow, however old', async () => {
    const { ctx, net, m } = await setup();
    const code = await attestedOnly(ctx, { escrow: true });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 400 * DAY);
    net.tradeShred = [order(ctx, code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-escrow');
    expect(await loadEscrow(ctx.db, ctx.keystoreKey, code)).toEqual({ escrow: true });
  });

  it('a watch state that does not read back is never taken as empty: held escrow', async () => {
    const { ctx, net, m } = await setup();
    const code = await attestedOnly(ctx);
    await ctx.db.query(`insert into mod_watch (trade, state, watching) values ($1, '{"bad":true}', false)`, [code]);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 400 * DAY);
    net.tradeShred = [order(ctx, code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-escrow');
  });

  it('seen disputed by this service within CHAT_AFTER_DISPUTE_DAYS: held dispute; after them it goes, its dispute record with it', async () => {
    const { ctx, net, m } = await setup();
    const code = await attestedOnly(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 60 * DAY);
    const seen = new Date(ctx.clock.now.getTime() - 10 * DAY);
    await ctx.db.query('insert into mod_dispute_seen (trade, first_seen_at, last_seen_at) values ($1, $2, $2)', [code, seen]);
    net.tradeShred = [order(ctx, code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-dispute');
    expect((await ctx.db.query('select 1 from signed_terms where trade = $1', [code])).rowCount).toBe(1);
    ctx.clock.now = new Date(seen.getTime() + CHAT_AFTER_DISPUTE_DAYS * DAY + 1000);
    expect(await m.handle.tradeShredTick()).toEqual([code]);
    expect((await ctx.db.query('select 1 from mod_dispute_seen where trade = $1', [code])).rowCount).toBe(0);
  });

  it("a chat linked to the trade whose keys are still here holds it (the chat shred goes first); once the chat is shredded the trade goes with its links", async () => {
    const { ctx, net, m } = await setup();
    const code = await attestedOnly(ctx);
    const chat = newTradeCode();
    await ctx.db.query('insert into mod_chat_trade (chat, trade, first_seen_at, last_seen_at) values ($1, $2, $3, $3)', [chat, code, ctx.clock.now]);
    await ctx.db.query('insert into mod_chat_identities (chat, sealed) values ($1, $2)', [chat, randomBytes(64)]);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-chat');
    await ctx.db.query('delete from mod_chat_identities where chat = $1', [chat]);
    expect(await m.handle.tradeShredTick()).toEqual([code]);
    expect((await ctx.db.query('select 1 from mod_chat_trade where chat = $1', [chat])).rowCount).toBe(0);
  });

  it('the watch list unreadable this pass: every order held unknown', async () => {
    const { ctx, net, m } = await setup();
    const code = await attestedOnly(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, code)];
    net.watchDown = true;
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-unknown');
    expect((await ctx.db.query('select 1 from signed_terms where trade = $1', [code])).rowCount).toBe(1);
  });

  it('a held order is skipped, never a stop; a malformed one is logged and skipped', async () => {
    const { ctx, net, m } = await setup();
    const held = await attestedOnly(ctx, { escrow: true });
    const due = await attestedOnly(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, 'not a code'), order(ctx, 7), order(ctx, held), order(ctx, due)];
    expect(await m.handle.tradeShredTick()).toEqual([due]);
    expect(m.logs.filter((r) => r === 'bad-trade-shred')).toHaveLength(2);
  });

  it("the ruling gate's own records: a recorded payout not yet finished holds the trade (ruling); otherwise they are forgotten after the rows go", async () => {
    let pending = true;
    const forgotten: string[] = [];
    const { ctx, net, m } = await setup({
      gate: async () => ({ tradeRecords: { pending: () => pending, forget: async (c) => void forgotten.push(c) }, stop: async () => {} }),
    });
    const code = await attestedOnly(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-ruling');
    expect(forgotten).toEqual([]);
    pending = false;
    expect(await m.handle.tradeShredTick()).toEqual([code]);
    expect(forgotten).toEqual([code]);
  });

  it('a gate that fails to forget leaves the order unreported, and the next pass tries again', async () => {
    let fail = true;
    const { ctx, net, m } = await setup({
      gate: async () => ({ tradeRecords: { pending: () => false, forget: async () => { if (fail) throw new Error('disk'); } }, stop: async () => {} }),
    });
    const code = await attestedOnly(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, code)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-failed');
    expect(shredded(net, code)).toBe(0);
    fail = false;
    expect(await m.handle.tradeShredTick()).toEqual([code]);
  });
});

describe('the list of what goes and what stays', () => {
  it('covers every moderation table with a trade column: deleted, or kept by a named rule', async () => {
    const ctx = await makeCtx();
    ctxs.push(ctx);
    const { rows } = await ctx.db.query<{ t: string }>(
      `select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'trade' order by 1`,
    );
    expect(rows.map((r) => r.t).sort()).toEqual([...TRADE_SHRED_TABLES, ...TRADE_SHRED_KEPT].sort());
    // Review 22 Nov m2: any column that can name a trade or its escrow (a trade code under another
    // name, an escrow address, a sweep tx) is in a table the shred reaches by its `trade` column.
    const { rows: hits } = await ctx.db.query<{ t: string; c: string }>(
      `select table_name as t, column_name as c from information_schema.columns
        where table_schema = 'public' and column_name in ('trade', 'trade_code', 'code', 'escrow_address', 'tx_hash') order by 1, 2`,
    );
    const known = new Set<string>([...TRADE_SHRED_TABLES, ...TRADE_SHRED_KEPT]);
    expect(hits.filter((h) => !known.has(h.t)).map((h) => `${h.t}.${h.c}`)).toEqual([]);
    // The trade-keyed key material is all on the delete list.
    for (const t of ['mod_party_state', 'mod_wallet_secrets', 'mod_escrow_state', 'signed_terms', 'mod_watch', 'mod_sweeps']) expect(TRADE_SHRED_TABLES).toContain(t);
  });
});

describe("the ruling gate's per-trade records (gate.bin)", () => {
  it('forgetTrade drops the trade\'s payout record and the rulings seen for it, and keeps every used nonce and every other trade', () => {
    const g = emptyGate();
    const code = newTradeCode();
    const other = newTradeCode();
    g.executions[code] = { rulingId: 'r1', winner: 'buyer', payouts: [{ address: '4'.repeat(95), amountAtomic: '1' }], recordedAt: 'x', settledAt: 'y', settledTx: null };
    g.executions[other] = { rulingId: 'r2', winner: 'seller', payouts: [], recordedAt: 'x', settledAt: 'y', settledTx: null };
    g.rulingsSeen.r1 = { code, round: 1, signers: ['a'], publishedSeenAt: 'x' };
    g.rulingsSeen.r1b = { code, round: 2, signers: ['b'], publishedSeenAt: 'x' };
    g.rulingsSeen.r2 = { code: other, round: 1, signers: ['a'], publishedSeenAt: 'x' };
    g.usedNonces.n1 = 'ruling:r1:propose';
    expect(forgetTrade(g, code)).toBe(true);
    expect(Object.keys(g.executions)).toEqual([other]);
    expect(Object.keys(g.rulingsSeen)).toEqual(['r2']);
    expect(g.usedNonces).toEqual({ n1: 'ruling:r1:propose' });
    expect(outcomeJson(g)).not.toContain(code);
    expect(forgetTrade(g, code)).toBe(false);
  });

  it('a payout recorded and not yet finished is pending, and forgetTrade refuses it', () => {
    const g = emptyGate();
    const code = newTradeCode();
    expect(tradeRulingPending(g, code)).toBe(false);
    g.executions[code] = { rulingId: 'r1', winner: 'buyer', payouts: [], recordedAt: 'x', settledAt: null, settledTx: null };
    expect(tradeRulingPending(g, code)).toBe(true);
    expect(() => forgetTrade(g, code)).toThrow(/pending/);
    expect(g.executions[code]).toBeDefined();
    g.executions[code] = { ...g.executions[code]!, settledAt: 'y' };
    expect(tradeRulingPending(g, code)).toBe(false);
  });
});


describe("review 22 Nov m2: gate.bin's fields", () => {
  it('every GateState field is classed as holding a trade (forgetTrade clears it) or not', () => {
    expect(Object.keys(emptyGate()).sort()).toEqual([...GATE_TRADE_FIELDS, ...GATE_OTHER_FIELDS].sort());
    expect([...GATE_TRADE_FIELDS].sort()).toEqual(['executions', 'rulingsSeen']);
  });
});

/** A sealed escrow state as the escrow party saves it, with just the fields the M1 rule reads. */
const escrowState = (o: { address?: string | null; sent?: Record<string, unknown> } = {}) => ({ v: 1, step: 'msig.make:1', address: o.address ?? null, sent: o.sent ?? {}, received: {}, release: null });

describe('review 22 Nov M1: a trade cancelled in setup before any escrow address existed', () => {
  it('without a restart: the watch stops it, and once past its own clock every row and key goes', async () => {
    const { ctx, net, m } = await setup();
    const t = await newTradeFor(m, net);
    await saveEscrow(ctx.db, ctx.keystoreKey, t, escrowState());
    net.states.set(t, 'setup');
    await m.handle.watch();
    net.states.set(t, 'cancelled');
    await m.handle.watch();
    expect((await ctx.db.query('select watching, escrow_address, setup_done_at from mod_watch where trade = $1', [t])).rows).toEqual([{ watching: false, escrow_address: null, setup_done_at: null }]);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.states.delete(t);
    net.tradeShred = [order(ctx, t)];
    expect(await m.handle.tradeShredTick()).toEqual([t]);
    for (const [tbl, rows] of Object.entries(await rowsOf(ctx, t))) expect(rows, tbl).toEqual([]);
  });

  it('after a restart, listed cancelled: the watch row stops watching; listed or not, it goes once past its own clock', async () => {
    for (const listed of [true, false]) {
      const { ctx, net, m, fetch } = await setup();
      const t = await newTradeFor(m, net);
      net.states.set(t, 'setup');
      await m.handle.watch();
      await m.handle.stop();
      const again = await moderation(ctx, fetch);
      if (listed) {
        net.states.set(t, 'cancelled');
        await again.handle.watch();
        expect((await ctx.db.query('select watching from mod_watch where trade = $1', [t])).rows).toEqual([{ watching: false }]);
      } else {
        net.states.delete(t);
        await again.handle.watch();
      }
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
      net.states.delete(t);
      net.tradeShred = [order(ctx, t)];
      expect(await again.handle.tradeShredTick(), `listed ${listed}`).toEqual([t]);
      expect(await loadParty(ctx.db, ctx.keystoreKey, t)).toBeNull();
      await stopAll();
    }
  });

  it('never for a trade that ever had an escrow address: in the watch row, in the sealed escrow state, or sent to the peers', async () => {
    const cases: Array<{ name: string; row?: { escrow_address?: string; setup_done?: boolean }; escrow?: ReturnType<typeof escrowState> }> = [
      { name: 'watch row address', row: { escrow_address: '5'.padEnd(95, 'E') } },
      { name: 'setup-done reported', row: { setup_done: true } },
      { name: 'sealed state address', escrow: escrowState({ address: '5'.padEnd(95, 'E') }) },
      { name: 'sent msig.addr', escrow: escrowState({ sent: { 'msig.addr:0': { address: '5'.padEnd(95, 'E') } } }) },
      { name: 'sent msig.ready', escrow: escrowState({ sent: { 'msig.ready:0': { address: '5'.padEnd(95, 'E') } } }) },
    ];
    for (const c of cases) {
      const { ctx, net, m } = await setup();
      const t = await attestedOnly(ctx);
      await ctx.db.query(`insert into mod_watch (trade, state, watching, escrow_address, setup_done_at) values ($1, $2, false, $3, $4)`, [
        t, JSON.stringify(dumpWatchState(newWatchState())), c.row?.escrow_address ?? null, c.row?.setup_done ? ctx.clock.now : null,
      ]);
      if (c.escrow) await saveEscrow(ctx.db, ctx.keystoreKey, t, c.escrow);
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 400 * DAY);
      net.tradeShred = [order(ctx, t)];
      expect(await m.handle.tradeShredTick(), c.name).toEqual([]);
      expect(m.logs, c.name).toContain('trade-shred-held-escrow');
      expect((await ctx.db.query('select 1 from signed_terms where trade = $1', [t])).rowCount, c.name).toBe(1);
      await stopAll();
    }
  });

  it('a sealed escrow state that does not open is never taken as never finalised', async () => {
    const { ctx, net, m } = await setup();
    const t = await attestedOnly(ctx);
    await ctx.db.query(`insert into mod_watch (trade, state, watching) values ($1, $2, false)`, [t, JSON.stringify(dumpWatchState(newWatchState()))]);
    await ctx.db.query('insert into mod_escrow_state (trade, sealed) values ($1, $2)', [t, randomBytes(80)]);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 400 * DAY);
    net.tradeShred = [order(ctx, t)];
    expect(await m.handle.tradeShredTick()).toEqual([]);
    expect(m.logs).toContain('trade-shred-held-escrow');
  });
});

describe('review 22 Nov M2: a shredded trade\'s sweep can never be counted for another trade', () => {
  it('the shred leaves a keyed tag of each counted sweep; claimSweep refuses a tagged tx for any trade', async () => {
    const { ctx, net, m } = await setup();
    const a = await attestedOnly(ctx);
    const b = newTradeCode();
    const tx = hash('7');
    expect(await claimSweep(ctx.db, a, tx, ctx.keystoreKey)).toBe(true);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, a)];
    expect(await m.handle.tradeShredTick()).toEqual([a]);
    expect((await ctx.db.query('select 1 from mod_sweeps where tx_hash = $1', [tx])).rowCount).toBe(0);
    // The re-claim: trade B presents A's old sweep.
    expect(await claimSweep(ctx.db, b, tx, ctx.keystoreKey)).toBe(false);
    // The tag names neither the tx nor the trade.
    const dump = await dumpAll(ctx);
    expect(dump).not.toContain(tx);
    expect(dump).not.toContain(a);
    expect((await ctx.db.query('select count(*)::int as n from mod_sweeps_spent')).rows[0]!.n).toBe(1);
  });
});

describe('review 22 Nov m1: the shred transaction and the watcher pass', () => {
  it('a failure part-way through the deletes leaves every row in place (one transaction)', async () => {
    const { ctx, net, m } = await setup();
    const t = await attestedOnly(ctx);
    await ctx.db.query(`insert into mod_watch (trade, state, watching) values ($1, $2, false)`, [t, JSON.stringify(dumpWatchState(newWatchState()))]);
    await ctx.db.query(`create function x2f_test_fail_delete() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$`);
    await ctx.db.query('create trigger x2f_test_fail_delete before delete on mod_watch for each row execute function x2f_test_fail_delete()');
    const before = await rowsOf(ctx, t);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, t)];
    try {
      expect(await m.handle.tradeShredTick()).toEqual([]);
      expect(m.logs).toContain('trade-shred-failed');
      expect(await rowsOf(ctx, t)).toEqual(before);
      expect(before.signed_terms).toHaveLength(1);
    } finally {
      await ctx.db.query('drop trigger x2f_test_fail_delete on mod_watch');
    }
  });

  it('runs between two watcher passes: a shred asked during a pass waits for it to end', async () => {
    const { ctx, net, m } = await setup();
    const l = await inFunding(ctx, m, net);
    const t = await attestedOnly(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    await madeAt(ctx, l.code, ctx.clock.now);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inPass = false;
    l.party.onFunds = async () => {
      inPass = true;
      await gate;
    };
    const pass = m.handle.watch();
    await expect.poll(() => inPass).toBe(true);
    net.tradeShred = [order(ctx, t)];
    let shredDone = false;
    const shred = m.handle.tradeShredTick().then((r) => {
      shredDone = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(shredDone).toBe(false);
    expect((await ctx.db.query('select 1 from signed_terms where trade = $1', [t])).rowCount).toBe(1);
    l.party.onFunds = null;
    release();
    await pass;
    expect(await shred).toEqual([t]);
  });
});

describe('review 22 Nov m3 and Q-B', () => {
  it('young goes by this service\'s own clock: the attestation row is stamped with it', async () => {
    const { ctx, net, m } = await setup();
    const t = await newTradeFor(m, net);
    const { rows } = await ctx.db.query<{ at: Date }>('select created_at as at from signed_terms where trade = $1', [t]);
    expect(rows[0]!.at.toISOString()).toBe(ctx.clock.now.toISOString());
  });

  it('the shred blanks the trade code on the used API log entries and keeps their ids (one use each)', async () => {
    const { ctx, net, m } = await setup();
    const t = await attestedOnly(ctx);
    const id = String(2_000_000 + Math.floor(Math.random() * 1_000_000_000));
    await ctx.db.query("insert into used_log_entries (id, action, trade) values ($1, 'chat.read', $2)", [id, t]);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * DAY);
    net.tradeShred = [order(ctx, t)];
    expect(await m.handle.tradeShredTick()).toEqual([t]);
    expect((await ctx.db.query('select id::text, trade from used_log_entries where id = $1', [id])).rows).toEqual([{ id, trade: '' }]);
    expect(await dumpAll(ctx)).not.toContain(t);
  });
});

describe('re-review 22 Nov r1-r4: the never-release guards', () => {
  /** A dropped watch row with no escrow address and no setup-done, its watch state as given, and no escrow state unless given. */
  async function heldWith(state: ReturnType<typeof newWatchState>, escrow?: ReturnType<typeof escrowState>): Promise<string[]> {
    const { ctx, net, m } = await setup();
    const t = await attestedOnly(ctx);
    await ctx.db.query('insert into mod_watch (trade, state, watching) values ($1, $2, false)', [t, JSON.stringify(dumpWatchState(state))]);
    if (escrow) await saveEscrow(ctx.db, ctx.keystoreKey, t, escrow);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 400 * DAY);
    net.tradeShred = [order(ctx, t)];
    const done = await m.handle.tradeShredTick();
    const kept = (await ctx.db.query('select 1 from signed_terms where trade = $1', [t])).rowCount;
    await stopAll();
    return [...done, kept === 1 && m.logs.includes('trade-shred-held-escrow') ? 'held' : 'gone'];
  }

  it('r1: a watch that ever saw a chain fact, a close, a sweep or a late coin never takes the no-escrow path', async () => {
    const tx = hash('3');
    const cases: Record<string, ReturnType<typeof newWatchState>> = {
      lastChain: { ...newWatchState(), lastChain: { receivedAtomic: 0n, unlockedAtomic: 0n, confirmations: 0 } },
      closedAt: { ...newWatchState(), closedAt: new Date('2026-10-01T00:00:00Z') },
      settledTx: { ...newWatchState(), settledTx: tx },
      sweepTxs: { ...newWatchState(), sweepTxs: [tx] },
      lateReported: { ...newWatchState(), lateReported: [tx] },
    };
    for (const [name, state] of Object.entries(cases)) expect(await heldWith(state), name).toEqual(['held']);
    // The control: an untouched watch state with nothing else does take it.
    expect(await heldWith(newWatchState())).toHaveLength(2);
  });

  it('r2: a sealed escrow state with a release, earlier releases or a shown sweep is never taken as never finalised', async () => {
    const cases: Record<string, ReturnType<typeof escrowState>> = {
      release: { ...escrowState(), release: { phase: 'built' } as unknown as null },
      releases: { ...escrowState(), releases: [{ phase: 'done' }] } as ReturnType<typeof escrowState>,
      shown: { ...escrowState(), shown: [{ txHash: hash('4'), height: 10, spentAtomic: '1' }] } as ReturnType<typeof escrowState>,
    };
    for (const [name, escrow] of Object.entries(cases)) expect(await heldWith(newWatchState(), escrow), name).toEqual(['held']);
    expect(await heldWith(newWatchState(), escrowState())).toHaveLength(2);
  });

  it('r3: after a restart with the API showing cancelled, a row that has an escrow address keeps watching', async () => {
    // Any stored address counts, even one modPartyPlan itself would not read as one (''): only a row
    // with NO address stops here. With a real address the party is started again and watched.
    for (const address of ['5'.padEnd(95, 'E'), '']) {
      const { ctx, net, m, fetch } = await setup();
      const t = await newTradeFor(m, net);
      await ctx.db.query('update mod_watch set escrow_address = $2 where trade = $1', [t, address]);
      await m.handle.stop();
      const again = await moderation(ctx, fetch);
      net.states.set(t, 'cancelled');
      await again.handle.watch();
      expect((await ctx.db.query('select watching from mod_watch where trade = $1', [t])).rows, `address '${address.slice(0, 4)}'`).toEqual([{ watching: true }]);
      expect(again.logs).not.toContain('watch-ended-no-escrow');
      await stopAll();
    }
  });

  it('r4: sweepTag is HMAC-SHA256 under HKDF(key, info x2f/mod/sweeps) of x2f/mod/sweep-spent/v1|<tx>, and not under the gate or wallet subkeys', () => {
    const key = new Uint8Array(32).fill(7);
    const tx = 'ab'.repeat(32);
    const under = (label: string): string =>
      createHmac('sha256', Buffer.from(hkdfSync('sha256', key, new Uint8Array(0), `x2f/mod/${label}`, 32))).update(`x2f/mod/sweep-spent/v1|${tx}`, 'utf8').digest('hex');
    const tag = sweepTag(key, tx).toString('hex');
    // Known answer (computed once with node:crypto, 22 Nov).
    expect(tag).toBe('e7b20b720ceefdc0a252c4d39bfa9105d230c891a7823527f8745ee0e20eac9a');
    expect(tag).toBe(under('sweeps'));
    expect(tag).not.toBe(under('gate'));
    expect(tag).not.toBe(under('wallet'));
    expect(under('gate')).toBe('de3e14a5d82a1546bfecc874433b75f9e59e359c9b16c006822cca75998489b1');
    expect(under('wallet')).toBe('4bf5daaf6a124a5808c83840fe1a1ea56b211be35eb3a0b4c398815291b84bf4');
    expect(sweepTag(key, 'cd'.repeat(32)).toString('hex')).not.toBe(tag);
  });
});
