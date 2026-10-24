import { describe, expect, test } from 'vitest';
import type { PartyArgs, PartyStore, Transport } from '@x2f/escrow';
import { channelFor, modPartyArgs, modPartyPlan, type ModPartyArgs, type ModPartyFacts, type TradeState } from '../src/index.js';

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
});

describe('modPartyArgs (the runParty arguments for the moderator)', () => {
  const io = { transport: {} as Transport, engine: {} as never, store: {} as PartyStore };

  test('runs as mod on the escrow channel, never the trade code, with the attested participants and R27 password', async () => {
    const a = await modPartyArgs(start, io);
    expect(a.role).toBe('mod');
    expect(a.trade).toBe(await channelFor(CODE, 'escrow'));
    expect(a.trade).not.toBe(CODE);
    expect(a.participants).toBe(participants);
    expect(a.me).toBe(me);
    expect(a.password).toBe(start.password);
    expect(a.daemonUri).toBe(start.daemonUri);
    expect(a.transport).toBe(io.transport);
    expect(a.store).toBe(io.store);
  });

  test('refuses a password that is not 32 random bytes as hex (R27), a wrong role, or a bad code', async () => {
    await expect(modPartyArgs({ ...start, password: 'hunter2' }, io)).rejects.toThrow(RangeError);
    await expect(modPartyArgs({ ...start, password: 'AB'.repeat(32) }, io)).rejects.toThrow(RangeError);
    await expect(modPartyArgs({ ...start, role: 'buyer' as 'mod' }, io)).rejects.toThrow(RangeError);
    await expect(modPartyArgs({ ...start, trade: 'not a code' }, io)).rejects.toThrow(RangeError);
  });

  test("refuses when the mod's own keys are not the attested mod slot", async () => {
    await expect(modPartyArgs({ ...start, me: { ...me, signPublic: '4'.repeat(64) } }, io)).rejects.toThrow(RangeError);
  });
});
