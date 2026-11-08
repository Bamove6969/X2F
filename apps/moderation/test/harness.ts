// Shared by the Task 10 tests: one moderation service with desks, a fake API internal listener and
// relay admin listener behind the injected fetch (both CHECK every moderation signature), a recorded
// stand-in escrow party, and an in-memory signals transport the test feeds with envelopes sealed by
// the real trader identities (Plan 1 envelopes, real signatures).
import { createHash, randomBytes } from 'node:crypto';
import { newTradeCode, type Role } from '@x2f/core';
import type { Incoming, Outcome, Outgoing, PartyHandle, Payout, Transport } from '@x2f/escrow';
import { generateIdentity, open, ReplayGuard, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import {
  channelFor,
  escrowPlan,
  identityProofBytes,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  type AttestedTerms,
  type ModPartyArgs,
  type SignalType,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import pg from 'pg';
import { expect, inject } from 'vitest';
import { startModeration, type Fetch, type ModerationHandle, type WorkItem } from '../src/main.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

export const API = 'http://api-internal.test';
export const RELAY = 'http://relay-admin.test';
export const TERMS: AttestedTerms = {
  deal: { poster: 'seller', takeAmountAtomic: '250000000000', currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000' },
  buyerPayout: '4'.padEnd(95, 'B'),
  sellerRefund: '8'.padEnd(95, 'S'),
};
/** What a lying API might serve for the same trade: an attacker's addresses. */
export const OTHER_TERMS: AttestedTerms = { ...TERMS, buyerPayout: '4'.padEnd(95, 'X'), sellerRefund: '8'.padEnd(95, 'Y') };
export const DEAL = { poster: 'seller' as const, takeAmountAtomic: 250_000_000_000n, currency: 'USD', centsPerXmr: 16_250n, maxFiatCents: 100_000n };
export const FUNDS = escrowPlan({ amountAtomic: DEAL.takeAmountAtomic, poster: 'seller' }).sellerFundsAtomic;
export const FEE_WALLET = '5'.repeat(95);
export const ESCROW = '5'.padEnd(95, 'E');
export const MIN = 60_000;
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
export const hash = (c: string): string => c.repeat(64);

export interface Ctx {
  db: pg.Pool;
  keystoreKey: Uint8Array;
  modSign: { public: string; secret: Uint8Array };
  clock: { now: Date };
}

export async function makeCtx(): Promise<Ctx> {
  await sodium.ready;
  const name = `x2f_mod_t10_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: `${inject('modPgUrl')}/postgres` });
  await admin.connect();
  try {
    await admin.query(`create database ${name} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  const kp = sodium.crypto_sign_keypair();
  return {
    db: new pg.Pool({ connectionString: `${inject('modPgUrl')}/${name}`, max: 4 }),
    keystoreKey: new Uint8Array(randomBytes(32)),
    modSign: { public: sodium.to_hex(kp.publicKey), secret: kp.privateKey },
    clock: { now: new Date('2026-10-29T12:00:00Z') },
  };
}

export type Report = Record<string, unknown> & { kind: string };

/** The API's internal listener (signature-checked, scripted, recorded) and the relay admin listener. */
export function fakeNetwork(ctx: Ctx) {
  const net = {
    work: [] as WorkItem[],
    states: new Map<string, string>(),
    seen: new Map<string, Date>(),
    paused: new Set<string>(),
    /** The API's own (pause-shifted) final alert per trade (Task 10 review I1). */
    alerts: new Map<string, Date>(),
    /** settleKindFor at the API, per trade (default null). */
    settleKinds: new Map<string, string>(),
    reports: [] as Report[],
    unsigned: [] as string[],
    answer: (_r: Report): { status: number; error?: string } => ({ status: 201 }),
  };
  const modKey = () => sodium.from_hex(ctx.modSign.public);
  const fetch: Fetch = async (url, init) => {
    const reply = (status: number, body: unknown = {}) => ({ status, json: async () => body });
    const u = new URL(url);
    if (u.origin === API) {
      const at = Number(init.headers[INTERNAL_AT_HEADER]);
      const sig = init.headers[INTERNAL_SIG_HEADER];
      const msg = internalSignedBytes({ method: init.method, path: u.pathname, at, bodyHash: sha256Hex(init.body ?? '') });
      if (!sig || !sodium.crypto_sign_verify_detached(sodium.from_base64(sig, sodium.base64_variants.ORIGINAL), msg, modKey())) {
        net.unsigned.push(u.pathname);
        return reply(401);
      }
      if (init.method === 'GET' && u.pathname === '/internal/v1/work') return reply(200, { work: net.work });
      if (init.method === 'GET' && u.pathname === '/internal/v1/watch') {
        return reply(200, {
          trades: [...net.states].map(([trade, state]) => ({
            trade,
            state,
            settleKind: net.settleKinds.get(trade) ?? null,
            paused: net.paused.has(trade),
            finalAlertSeenAt: net.seen.get(trade)?.toISOString() ?? null,
            finalAlertAt: net.alerts.get(trade)?.toISOString() ?? null,
          })),
        });
      }
      if (init.method === 'POST' && u.pathname === '/internal/v1/reports') {
        const body = JSON.parse(init.body ?? '{}') as Report;
        if (body.kind === 'attestation' || body.kind === 'refused') return reply(201, { ok: true });
        net.reports.push(body);
        const a = net.answer(body);
        return reply(a.status, a.error ? { error: a.error } : { ok: true });
      }
      return reply(404);
    }
    if (u.origin === RELAY) return reply(u.pathname.endsWith('/close') ? 200 : 201);
    return reply(404);
  };
  return { net, fetch };
}

/** A stand-in escrow party: scripted funds, a ready() the test resolves, every settle() recorded. */
export interface FakeParty {
  funds: { balance: bigint; unlocked: bigint; incoming: Incoming[]; chainHeight: number; outgoing: Outgoing[]; ownTxs?: string[]; spendProofs?: { from: Role; txHash: string; txKey: string }[] };
  settles: Outcome[];
  /** proveSweep's answer (default: nothing proven); every call is recorded. */
  prove: (txHash: string, txKey: string, minimums: Payout[]) => boolean;
  proveCalls: { txHash: string; txKey: string; minimums: Payout[] }[];
  resolveReady: (a: string) => void;
  /**
   * Committed to the first outcome (review R4-M2): like the real party once `rel.committed` is set
   * (packages/escrow party.ts), every later settle() with another outcome is recorded and refused.
   */
  committed: boolean;
  /** Runs inside every funds() call, after the watch list was read (review 7 Nov, finding 1: the pass is slow). */
  onFunds: (() => void | Promise<void>) | null;
  handle: PartyHandle;
}

/** An outcome as text for comparing: its amounts are bigints, which plain JSON.stringify refuses. */
export const outcomeJson = (o: unknown): string => JSON.stringify(o, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

function fakeParty(): FakeParty {
  let resolveReady: (a: string) => void = () => {};
  const ready = new Promise<string>((r) => (resolveReady = r));
  const p: FakeParty = {
    funds: { balance: 0n, unlocked: 0n, incoming: [], chainHeight: 100, outgoing: [] },
    settles: [],
    prove: () => false,
    proveCalls: [],
    resolveReady,
    committed: false,
    onFunds: null,
    handle: {
      ready: () => ready,
      // The real party co-signs only a tx set equal to this outcome (Plan 1, packages/escrow); here
      // it is only recorded, and stays pending like a co-signer waiting for the builder.
      settle: (o: Outcome) => {
        const first = p.settles[0];
        p.settles.push(structuredClone(o));
        if (p.committed && first !== undefined && outcomeJson(first) !== outcomeJson(o)) {
          return Promise.reject(new Error('bad-outcome: committed to an earlier outcome'));
        }
        return new Promise<string | null>(() => {});
      },
      funds: async () => {
        await p.onFunds?.();
        return { ...p.funds, incoming: p.funds.incoming.map((i) => ({ ...i })) };
      },
      spendInfo: async () => {
        throw new Error('not used');
      },
      importSpendInfo: async () => {
        throw new Error('not used');
      },
      proveSweep: async (txHash: string, txKey: string, minimums: Payout[]) => {
        p.proveCalls.push({ txHash, txKey, minimums });
        return p.prove(txHash, txKey, minimums);
      },
      stop: async () => {},
    },
  };
  return p;
}

/** An in-memory signals transport: the test pushes frames in, the moderator's acks are recorded. */
export interface FakeTransport {
  transport: Transport;
  sent: Envelope[];
  push(frame: unknown): void;
}

function fakeTransport(): FakeTransport {
  const inbox: unknown[] = [];
  let waiter: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
  let closed = false;
  const sent: Envelope[] = [];
  return {
    sent,
    push(frame) {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.resolve(frame);
      } else inbox.push(frame);
    },
    transport: {
      send: (e) => {
        sent.push(e);
      },
      next: () => {
        if (inbox.length > 0) return Promise.resolve(inbox.shift());
        if (closed) return Promise.reject(new Error('closed'));
        return new Promise((resolve, reject) => (waiter = { resolve, reject }));
      },
      onReconnect: () => {},
      close: () => {
        closed = true;
        waiter?.reject(new Error('closed'));
        waiter = null;
      },
    },
  };
}

export interface Trader {
  role: 'buyer' | 'seller';
  id: Identity;
  seq: number;
}

export interface Mod {
  handle: ModerationHandle;
  parties: Map<string, FakeParty>;
  transports: Map<string, FakeTransport>;
  started: ModPartyArgs[];
  logs: string[];
}

/** `deskFails.on`: every desk open fails while set (review M2: the watcher retries it). */
/** `logs`: where the log goes (to read it when the start is refused). */
export async function moderation(ctx: Ctx, fetch: Fetch, opts: { deskFails?: { on: boolean }; logs?: string[] } = {}): Promise<Mod> {
  const parties = new Map<string, FakeParty>();
  const transports = new Map<string, FakeTransport>();
  const started: ModPartyArgs[] = [];
  const logs: string[] = opts.logs ?? [];
  const handle = await startModeration(
    {
      apiInternalUrl: API,
      relayAdminUrl: RELAY,
      relayUrl: 'ws://relay.test',
      network: 'regtest',
      daemonUri: 'http://127.0.0.1:1',
      db: ctx.db,
      keystoreKey: ctx.keystoreKey,
      signingSecret: ctx.modSign.secret,
      feeWallet: FEE_WALLET,
    },
    {
      fetch,
      now: () => ctx.clock.now,
      intervalMs: 0,
      watchIntervalMs: 0,
      log: (e) => logs.push(e.reason),
      startParty: async (a) => {
        started.push(a);
        const p = fakeParty();
        parties.set(a.trade, p);
        return p.handle;
      },
      signalsTransport: ({ channel }) => {
        if (opts.deskFails?.on) throw new Error('desk open failed (test)');
        const t = fakeTransport();
        transports.set(channel, t);
        return t.transport;
      },
    },
  );
  running.push(handle);
  return { handle, parties, transports, started, logs };
}

/** Every service `moderation()` started; stopAll() after each test, so a failed test leaves no instance lock held (finding 2). */
const running: ModerationHandle[] = [];
export async function stopAll(): Promise<void> {
  await Promise.all(running.splice(0).map((h) => h.stop()));
}

/** A trade with fresh buyer and seller identities, as the API's work list serves it. */
export async function newTrade(terms: AttestedTerms = TERMS): Promise<{ code: string; buyer: Trader; seller: Trader; work: WorkItem }> {
  const code = newTradeCode();
  const reg = async (role: 'buyer' | 'seller') => {
    const id = await generateIdentity();
    const proof = sodium.to_hex(sodium.crypto_sign_detached(identityProofBytes(code, role, id.signPublic, id.boxPublic), id.signSecret));
    return { trader: { role, id, seq: 0 } as Trader, reg: { signPublic: id.signPublic, boxPublic: id.boxPublic, proof } };
  };
  const b = await reg('buyer');
  const s = await reg('seller');
  return { code, buyer: b.trader, seller: s.trader, work: { trade: code, participants: { buyer: b.reg, seller: s.reg }, terms } };
}

export interface Live {
  m: Mod;
  net: ReturnType<typeof fakeNetwork>['net'];
  code: string;
  buyer: Trader;
  seller: Trader;
  participants: Participants;
  channel: string;
  party: FakeParty;
  signals: FakeTransport;
}

/** Attested, party and desk running, ready() resolved with ESCROW, setup-done accepted, API in funding. */
export async function inFunding(ctx: Ctx, m: Mod, net: Live['net'], terms: AttestedTerms = TERMS): Promise<Live> {
  const t = await newTrade(terms);
  net.work = [t.work];
  expect(await m.handle.tick()).toEqual([t.code]);
  net.work = [];
  const party = m.parties.get(t.code)!;
  party.resolveReady(ESCROW);
  net.states.set(t.code, 'setup');
  await expect.poll(async () => {
    await m.handle.watch();
    return net.reports.some((r) => r.kind === 'setup-done' && r.trade === t.code);
  }).toBe(true);
  net.states.set(t.code, 'funding');
  const channel = await channelFor(t.code, 'signals');
  const args = m.started.find((a) => a.trade === t.code)!;
  await expect.poll(() => m.transports.has(channel)).toBe(true);
  return { m, net, code: t.code, buyer: t.buyer, seller: t.seller, participants: args.participants, channel, party, signals: m.transports.get(channel)! };
}

export const incoming = (txHash: string, amountAtomic: bigint, height: number | null, unlocked = false): Incoming => ({
  txHash,
  amountAtomic,
  height,
  unlocked,
  confirmations: height === null ? 0 : 100 - height,
});

/** Seals a signal as `from` (any identity: a forger passes its own) and hands it to the moderator. */
export async function signal(l: Live, from: Trader, type: SignalType, payload: Record<string, unknown>, to: readonly Role[] = ['buyer', 'seller', 'mod']): Promise<void> {
  from.seq += 1;
  // A forger seals under its own key in the role's slot (seal checks `me` against it); the
  // moderator opens with the attested participants, so the signature cannot match.
  const participants = { ...l.participants, [from.role]: { signPublic: from.id.signPublic, boxPublic: from.id.boxPublic } };
  const e = await seal({ trade: l.channel, from: from.role, seq: from.seq, type, payload, to, me: from.id, participants });
  l.signals.push(e);
}

/** Sends a signal and waits for the moderator's ack of it (acked signals only). */
export async function acked(l: Live, from: Trader, type: SignalType, payload: Record<string, unknown>): Promise<void> {
  const before = l.signals.sent.length;
  await signal(l, from, type, payload);
  await expect.poll(() => l.signals.sent.length).toBeGreaterThan(before);
}

/** Opens the moderator's acks as `who` (each sealed to its sender only). */
export async function acksFor(l: Live, who: Trader): Promise<string[]> {
  const out: string[] = [];
  const guard = new ReplayGuard(l.channel);
  for (const e of l.signals.sent) {
    try {
      const o = await open(e, { me: who.id, myRole: who.role, participants: l.participants, trade: l.channel, guard });
      out.push(`${o.type}:${(o.payload as { of: string }).of}`);
    } catch {
      // not for this trader
    }
  }
  return out;
}

/** Waits until the desk has handled everything pushed so far (the frame queue is serial). */
export async function drained(): Promise<void> {
  // A step runs after every frame taken before it (one serial queue per desk); a watch pass is a step.
  await new Promise((r) => setTimeout(r, 50));
}

/** Both traders' terms, acked; funding seen and the whole escrow unlocked (shadow secured). */
export async function secured(ctx: Ctx, l: Live): Promise<void> {
  await acked(l, l.seller, 'trade.terms', { refundAddress: TERMS.sellerRefund, deal: DEAL });
  await acked(l, l.buyer, 'trade.terms', { payoutAddress: TERMS.buyerPayout, deal: DEAL });
  l.party.funds = { ...l.party.funds, balance: FUNDS, unlocked: 0n, incoming: [incoming(hash('a'), FUNDS, 99)] };
  await l.m.handle.watch();
  l.net.states.set(l.code, 'securing');
  l.party.funds = { ...l.party.funds, balance: FUNDS, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true)] };
  await l.m.handle.watch();
  l.net.states.set(l.code, 'secured');
}

export const later = (ctx: Ctx, ms: number): void => {
  ctx.clock.now = new Date(ctx.clock.now.getTime() + ms);
};
