import { describe, expect, test } from 'vitest';
import type { PartyArgs, PartyStore, Transport } from '@x2f/escrow';
import {
  channelFor,
  modPartyArgs,
  modPartyPlan,
  newWatchState,
  watchStep,
  type ModPartyArgs,
  type ModPartyFacts,
  type TradeState,
} from '../src/index.js';

const CODE = 'ABCD2345EFGH6789';
const keys = (c: string) => ({ signPublic: c.repeat(64), boxPublic: c.repeat(64) });
const participants: PartyArgs['participants'] = { buyer: keys('1'), seller: keys('2'), mod: keys('3') };
const me: PartyArgs['me'] = { ...keys('3'), signSecret: new Uint8Array(64), boxSecret: new Uint8Array(32) };
const start: ModPartyArgs = {
  trade: CODE,
  role: 'mod',
  me,
  participants,
  password: 'ab'.repeat(32),
  daemonUri: 'http://127.0.0.1:18081',
  feeWallet: '4fee',
  payrollWallet: '4payroll',
  terms: {
    deal: { poster: 'seller', takeAmountAtomic: '250000000000', currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    payWindowMin: 90,
    buyerPayout: '4'.padEnd(95, 'B'),
    sellerRefund: '8'.padEnd(95, 'S'),
  },
};

const facts = (o: Partial<ModPartyFacts> = {}): ModPartyFacts => ({
  attested: true,
  running: false,
  escrowAddress: null,
  setupDoneReported: false,
  apiState: 'setup',
  watching: true,
  ...o,
});

describe('moderator party decisions (Task 9, pure)', () => {
  test('starts the party once the trade is attested (and again after a restart, from its saved state)', () => {
    expect(modPartyPlan(facts())).toEqual({ start: true, reportSetupDone: null, stop: false });
    expect(modPartyPlan(facts({ attested: false }))).toEqual({ start: false, reportSetupDone: null, stop: false });
    expect(modPartyPlan(facts({ running: true }))).toEqual({ start: false, reportSetupDone: null, stop: false });
  });

  test('on ready() reports setup-done with the escrow address, once, only while the API trade is in setup', () => {
    expect(modPartyPlan(facts({ running: true, escrowAddress: '4escrow' })).reportSetupDone).toBe('4escrow');
    expect(modPartyPlan(facts({ running: true, escrowAddress: '4escrow', setupDoneReported: true })).reportSetupDone).toBeNull();
    for (const apiState of ['funding', 'cancelled', 'securing'] as TradeState[]) {
      expect(modPartyPlan(facts({ running: true, escrowAddress: '4escrow', apiState })).reportSetupDone).toBeNull();
    }
    expect(modPartyPlan(facts({ running: true, escrowAddress: '' })).reportSetupDone).toBeNull();
  });

  test('a trade cancelled before any escrow address existed: stop, never start', () => {
    expect(modPartyPlan(facts({ running: true, apiState: 'cancelled' }))).toEqual({ start: false, reportSetupDone: null, stop: true });
    expect(modPartyPlan(facts({ apiState: 'cancelled' }))).toEqual({ start: false, reportSetupDone: null, stop: false });
  });

  test('a closed trade with an escrow keeps its party for the watcher until the watch ends', () => {
    expect(modPartyPlan(facts({ running: true, escrowAddress: '4escrow', apiState: 'released', setupDoneReported: true })).stop).toBe(false);
    expect(modPartyPlan(facts({ escrowAddress: '4escrow', apiState: 'cancelled' })).start).toBe(true);
    expect(modPartyPlan(facts({ running: true, escrowAddress: '4escrow', apiState: 'released', watching: false }))).toEqual({
      start: false,
      reportSetupDone: null,
      stop: true,
    });
    expect(modPartyPlan(facts({ escrowAddress: '4escrow', apiState: 'released', watching: false })).start).toBe(false);
  });

  test('a trade escalated after its close keeps its party even when the 30-day watch has passed', () => {
    for (const apiState of ['disputed', 'settling'] as TradeState[]) {
      const f = facts({ running: true, escrowAddress: '4escrow', apiState, watching: false, setupDoneReported: true });
      expect(modPartyPlan(f).stop).toBe(false);
      expect(modPartyPlan({ ...f, running: false }).start).toBe(true);
    }
  });

  test("follows the watcher's latest close: a ruling at day 31 keeps the party for 30 days after it", () => {
    const DAY = 24 * 60 * 60_000;
    const T = Date.parse('2026-10-18T12:00:00.000Z');
    const late = { txHash: 'd'.repeat(64), amountAtomic: 7n, height: 990, unlocked: true };
    const funds = { balance: 7n, unlocked: 7n, chainHeight: 1000, incoming: [late] };
    let state = newWatchState();
    const at = (apiState: TradeState, ms: number) => {
      const r = watchStep({ trade: { state: apiState }, funds, spend: null, state, now: new Date(T + ms) });
      state = r.state;
      return modPartyPlan(facts({ running: true, escrowAddress: '4escrow', setupDoneReported: true, apiState, watching: r.watching }));
    };
    expect(at('released', 0).stop).toBe(false);
    expect(at('disputed', 31 * DAY).stop).toBe(false);
    expect(at('refunded', 31 * DAY + 1).stop).toBe(false);
    expect(at('refunded', 61 * DAY + 1).stop).toBe(false);
    expect(at('refunded', 61 * DAY + 2).stop).toBe(true);
  });

  test('after a restart the persisted escrow address restarts the party for a closed trade with late funds', () => {
    // running: false (fresh process); escrowAddress comes from mod_party_state / the API trade, not ready()
    for (const apiState of ['released', 'cancelled', 'refunded'] as TradeState[]) {
      expect(modPartyPlan(facts({ escrowAddress: '4escrow', apiState, setupDoneReported: true }))).toEqual({
        start: true,
        reportSetupDone: null,
        stop: false,
      });
    }
  });
});

describe('modPartyArgs (the runParty arguments for the moderator)', () => {
  const transport = {} as Transport;
  const asked: string[] = [];
  const io = {
    transport: (channel: string) => {
      asked.push(channel);
      return transport;
    },
    engine: {} as never,
    store: {} as PartyStore,
  };

  test('runs as mod on the escrow channel, never the trade code, with the attested participants and R27 password', async () => {
    asked.length = 0;
    const { args: a, channel } = await modPartyArgs(start, io);
    expect(channel).toBe(await channelFor(CODE, 'escrow'));
    expect(a.role).toBe('mod');
    expect(a.trade).toBe(channel);
    expect(a.trade).not.toBe(CODE);
    // the transport is built on the same channel
    expect(asked).toEqual([channel]);
    expect(a.participants).toBe(participants);
    expect(a.me).toBe(me);
    expect(a.password).toBe(start.password);
    expect(a.daemonUri).toBe(start.daemonUri);
    expect(a.transport).toBe(transport);
    expect(a.store).toBe(io.store);
  });

  test('refuses a password that is not 32 random bytes as hex (R27), a wrong role, or a bad code', async () => {
    await expect(modPartyArgs({ ...start, password: 'hunter2' }, io)).rejects.toThrow(RangeError);
    await expect(modPartyArgs({ ...start, password: 'AB'.repeat(32) }, io)).rejects.toThrow(RangeError);
    await expect(modPartyArgs({ ...start, role: 'buyer' as 'mod' }, io)).rejects.toThrow(RangeError);
    await expect(modPartyArgs({ ...start, trade: 'not a code' }, io)).rejects.toThrow(RangeError);
  });

  test('refuses terms that are not the attested terms shape (review M5)', async () => {
    await expect(modPartyArgs({ ...start, terms: undefined as unknown as ModPartyArgs['terms'] }, io)).rejects.toThrow(RangeError);
    await expect(modPartyArgs({ ...start, terms: { ...start.terms, sellerRefund: '' } }, io)).rejects.toThrow(RangeError);
  });

  test("refuses when the mod's own keys are not the attested mod slot", async () => {
    await expect(modPartyArgs({ ...start, me: { ...me, signPublic: '4'.repeat(64) } }, io)).rejects.toThrow(RangeError);
  });

  test("refuses when the attested mod slot's box key is swapped", async () => {
    const swapped = { ...participants, mod: { ...participants.mod, boxPublic: '5'.repeat(64) } };
    await expect(modPartyArgs({ ...start, participants: swapped }, io)).rejects.toThrow(RangeError);
  });

  test('builds no transport when it refuses', async () => {
    asked.length = 0;
    await expect(modPartyArgs({ ...start, password: 'hunter2' }, io)).rejects.toThrow(RangeError);
    expect(asked).toEqual([]);
  });
});
