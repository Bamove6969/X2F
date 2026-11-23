// Review p4t22 M2: the after-refund "seller sends XMR" ruling is signed by the moderation key only
// after the ruling gate authorised its staff taps, from this process's own attested amount and the
// buyer's address. A ruling the API invented (no taps, another amount) gets no statement.
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAfterRefundStatement, type AfterRefundStatement } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { afterRefundSigner, type AfterRefundStepInput } from '../src/afterRefund.js';
import { openGateStore } from '../src/gate/index.js';
import { AMOUNT, BUYER, ctx, newGate, recorded, ruling, tapBy, world } from './gateWorld.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
let modKey: { publicKey: Uint8Array; privateKey: Uint8Array };
beforeAll(async () => {
  await sodium.ready;
  modKey = sodium.crypto_sign_keypair();
});

async function setup(o: { outcome?: 'seller-sends-xmr' | 'no-action' | 'seller-returns-fiat' | 'release-to-buyer'; tap?: boolean } = {}) {
  const w = await world();
  const mod = w.hire('mod');
  const c = ruling(mod, { outcome: o.outcome ?? 'seller-sends-xmr' });
  if (o.tap !== false) w.api.taps.push(tapBy(mod, c.intent('propose')));
  const dir = await mkdtemp(join(tmpdir(), 'x2f-ar-'));
  dirs.push(dir);
  const key = new Uint8Array(randomBytes(32));
  await newGate(dir, key);
  const store = await openGateStore(dir, key);
  store.state = w.gate;
  await store.save();
  const logs: string[] = [];
  const signer = afterRefundSigner({ store, source: w.api, ctx: ctx(), log: (e) => logs.push(e.reason), signingSecret: modKey.privateKey });
  return { w, mod, c, store, signer, logs };
}

function input(c: { ruling: { code: string } }, stored: AfterRefundStepInput['stored'], over: Partial<AfterRefundStepInput> = {}) {
  const sent: Array<{ statement: AfterRefundStatement; sig: string }> = [];
  const refusals: Array<{ rulingId: string; reason: string | null }> = [];
  const s: AfterRefundStepInput = {
    code: c.ruling.code,
    stored,
    recorded: recorded(41_250n),
    announce: async (r) => (sent.push(r), true),
    reportRefusal: async (r) => (refusals.push(r), true),
    ...over,
  };
  return { s, sent, refusals };
}

describe('the after-refund statement pass (review p4t22 M2)', () => {
  it('signs a gate-authorised seller-sends-xmr ruling: this trade, its round and ruling, the attested XMR and buyer address', async () => {
    const { c, signer } = await setup();
    const { s, sent, refusals } = input(c, { current: c.ruling, round1: null, involved: [] });
    expect(await signer.step(s)).toBe('announced');
    expect(sent).toHaveLength(1);
    const st = sent[0]!.statement;
    expect(st).toMatchObject({ v: 1, kind: 'after-refund', trade: c.ruling.code, round: 1, rulingId: c.ruling.id, outcome: 'seller-sends-xmr', amountAtomic: AMOUNT.toString(), buyerPayout: BUYER });
    const check = await verifyAfterRefundStatement(st, sent[0]!.sig, sodium.to_hex(modKey.publicKey), { trade: c.ruling.code, amountAtomic: AMOUNT, buyerPayout: BUYER });
    expect(check.ok).toBe(true);
    expect(refusals).toEqual([{ rulingId: c.ruling.id, reason: null }]);
    // Once the API took it, nothing again in this process.
    expect(await signer.step(s)).toBe('done');
    expect(sent).toHaveLength(1);
  });

  it('a ruling with no staff tap (one the API made up) is refused by the gate: no statement, the refusal reported', async () => {
    const { c, signer } = await setup({ tap: false });
    const { s, sent, refusals } = input(c, { current: c.ruling, round1: null, involved: [] });
    expect(await signer.step(s)).toMatch(/^refused-/);
    expect(sent).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.rulingId).toBe(c.ruling.id);
  });

  it('a tap for another amount is no authorisation for this one', async () => {
    const w = await world();
    const mod = w.hire('mod');
    const c = ruling(mod, { outcome: 'seller-sends-xmr' });
    w.api.taps.push(tapBy(mod, c.intent('propose', { amountAtomic: '1' })));
    const dir = await mkdtemp(join(tmpdir(), 'x2f-ar-'));
    dirs.push(dir);
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    const store = await openGateStore(dir, key);
    store.state = w.gate;
    const signer = afterRefundSigner({ store, source: w.api, ctx: ctx(), log: () => {}, signingSecret: modKey.privateKey });
    const { s, sent } = input(c, { current: c.ruling, round1: null, involved: [] });
    expect(await signer.step(s)).toBe('refused-intent-mismatch');
    expect(sent).toEqual([]);
  });

  it('residual (a): a decided round with nothing to send is signed too, with its own outcome', async () => {
    for (const outcome of ['no-action', 'seller-returns-fiat'] as const) {
      const other = await setup({ outcome });
      const { s, sent } = input(other.c, { current: other.c.ruling, round1: null, involved: [] });
      expect(await other.signer.step(s)).toBe('announced');
      expect(sent[0]!.statement).toMatchObject({ outcome, round: 1, rulingId: other.c.ruling.id, amountAtomic: AMOUNT.toString(), buyerPayout: BUYER });
    }
  });

  it('residual (a): a round 2 that overrules round 1 with nothing to send gets its own signed statement', async () => {
    const { w, c, signer } = await setup();
    expect(await signer.step(input(c, { current: c.ruling, round1: null, involved: [] }).s)).toBe('announced');
    const senior = w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: c.ruling.id, code: c.ruling.code, outcome: 'no-action' });
    w.api.taps.push(tapBy(senior, r2.intent('propose')));
    const decided = input(c, { current: r2.ruling, round1: c.ruling, involved: [] });
    expect(await signer.step(decided.s)).toBe('announced');
    expect(decided.sent[0]!.statement).toMatchObject({ round: 2, rulingId: r2.ruling.id, outcome: 'no-action' });
  });

  it('nothing for an escrow outcome, nothing without recorded terms, nothing on a refused announcement (tried again)', async () => {
    const other = await setup({ outcome: 'release-to-buyer' });
    expect(await other.signer.step(input(other.c, { current: other.c.ruling, round1: null, involved: [] }).s)).toBe('none');
    const { c, signer } = await setup();
    const stored = { current: c.ruling, round1: null, involved: [] };
    expect(await signer.step(input(c, stored, { recorded: null }).s)).toBe('no-terms');
    expect(await signer.step(input(c, stored, { announce: async () => false }).s)).toBe('announce-failed');
    expect(await signer.step(input(c, stored).s)).toBe('announced');
  });

  it('while an appeal is pending, round 1 is in force; a decided round 2 is checked after round 1 (R37)', async () => {
    const { w, mod, c, signer } = await setup();
    const pending = input(c, { current: null, round1: c.ruling, involved: [] });
    expect(await signer.step(pending.s)).toBe('announced');
    expect(pending.sent[0]!.statement.round).toBe(1);
    // Round 2 by the round-1 moderator: refused `involved`.
    const self = ruling(mod, { round: 2, round1Id: c.ruling.id, code: c.ruling.code, outcome: 'seller-sends-xmr' });
    w.api.taps.push(tapBy(mod, self.intent('propose')));
    expect(await signer.step(input(c, { current: self.ruling, round1: c.ruling, involved: [] }).s)).toBe('refused-involved');
    // An uninvolved senior: signed as round 2.
    const senior = w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: c.ruling.id, code: c.ruling.code, outcome: 'seller-sends-xmr' });
    w.api.taps.push(tapBy(senior, r2.intent('propose')));
    const decided = input(c, { current: r2.ruling, round1: c.ruling, involved: [] });
    expect(await signer.step(decided.s)).toBe('announced');
    expect(decided.sent[0]!.statement).toMatchObject({ round: 2, rulingId: r2.ruling.id });
  });
});
