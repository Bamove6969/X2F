// Plan 7 Task 2, lead follow-up (the moderation-database purge): when the API purges a trade it
// leaves a trade shred order (API migration 761). The order is only a trigger: this service deletes
// a trade's records (the signed terms with both addresses, the sealed party state, the wallet
// password, the escrow state, the watch state, the desk, the counted sweeps, the dispute and chat
// links) only when its OWN records say the trade is over, past its own clock, out of any dispute, its
// chats already shredded, and its escrow shown EMPTY by its own watch (review-p7-retention round 2,
// R2-I2: never on the API's word). An open trade is never touched, whatever the API says.
import { randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { TRADE_KEEP_DAYS, CHAT_AFTER_DISPUTE_DAYS } from '@x2f/trade';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyGate, forgetTrade, tradeRulingPending } from '../src/gate/store.js';
import { loadEscrow, saveEscrow } from '../src/keystore.js';
import { loadParty, saveParty, TRADE_SHRED_KEPT, TRADE_SHRED_TABLES, walletPassword, type GateRun } from '../src/main.js';
import { fakeNetwork, hash, inFunding, makeCtx, moderation, outcomeJson, secured, stopAll, type Ctx } from './harness.js';

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

