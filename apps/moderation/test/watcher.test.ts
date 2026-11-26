// Plan 3 Task 9 I/O: the moderator party and the chain watcher inside the moderation service.
// Hermetic: a fake API internal listener and relay admin listener behind the injected fetch (they
// CHECK every moderation signature), and a recorded party starter in place of the escrow party.
import { createHash, randomBytes } from 'node:crypto';
import { feeFor, newTradeCode, type Role } from '@x2f/core';
import type { Incoming, Outgoing, PartyHandle, Payout } from '@x2f/escrow';
import { canonicalJson, generateIdentity, type Identity } from '@x2f/protocol';
import {
  channelFor,
  identityProofBytes,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  type AttestedTerms,
  type ModPartyArgs,
  WATCH_RESTART_GRACE_MS,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { relayRegisterMessage, startModeration, type Fetch, type ModerationHandle, type WorkItem } from '../src/main.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const API = 'http://api-internal.test';
const RELAY = 'http://relay-admin.test';
const TERMS: AttestedTerms = {
  deal: { poster: 'seller', takeAmountAtomic: '250000000000', currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  payWindowMin: 90,
  buyerPayout: '4'.padEnd(95, 'B'),
  sellerRefund: '8'.padEnd(95, 'S'),
};
/** What a lying API might serve later for the same trade. */
const OTHER_TERMS: AttestedTerms = { ...TERMS, buyerPayout: '4'.padEnd(95, 'X'), sellerRefund: '8'.padEnd(95, 'Y') };
const ESCROW = '5'.padEnd(95, 'E');
const XMR = 1_000_000_000_000n;
/**
 * A tx hash named by one hex char, salted per test (round 2, R2-I1): the moderation database records
 * each counted sweep tx for one trade only, and every test here shares that database.
 */
let salt = randomBytes(28).toString('hex');
const hash = (c: string): string => c.repeat(8) + salt;

let db: pg.Pool;
let keystoreKey: Uint8Array;
let modSign: { public: string; secret: Uint8Array };
let clock = new Date('2026-10-28T12:00:00Z');

beforeAll(async () => {
  await sodium.ready;
  const name = `x2f_mod_w_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: `${inject('modPgUrl')}/postgres` });
  await admin.connect();
  try {
    await admin.query(`create database ${name} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  db = new pg.Pool({ connectionString: `${inject('modPgUrl')}/${name}`, max: 4 });
  keystoreKey = new Uint8Array(randomBytes(32));
  const kp = sodium.crypto_sign_keypair();
  modSign = { public: sodium.to_hex(kp.publicKey), secret: kp.privateKey };
});

afterAll(async () => {
  await db.end();
});

beforeEach(() => {
  salt = randomBytes(28).toString('hex');
});

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

async function work(code: string, terms: AttestedTerms = TERMS): Promise<WorkItem> {
  const reg = async (role: 'buyer' | 'seller') => {
    const id: Identity = await generateIdentity();
    const proof = sodium.to_hex(sodium.crypto_sign_detached(identityProofBytes(code, role, id.signPublic, id.boxPublic), id.signSecret));
    return { signPublic: id.signPublic, boxPublic: id.boxPublic, proof };
  };
  return { trade: code, participants: { buyer: await reg('buyer'), seller: await reg('seller') }, terms };
}

type Report = Record<string, unknown> & { kind: string };

/** The API's internal listener and the relay's admin listener, signature-checked, scripted and recorded. */
function fakeNetwork() {
  const net = {
    work: [] as WorkItem[],
    states: new Map<string, string>(),
    /** settleKind per trade on the watch list (default null), and the paused trades. */
    kinds: new Map<string, string>(),
    paused: new Set<string>(),
    reports: [] as Report[],
    closed: [] as string[],
    unsigned: [] as string[],
    /** Answers a watcher report; default 201. */
    answer: (_r: Report): { status: number; error?: string } => ({ status: 201 }),
    relayCloseStatus: 200,
  };
  const modKey = () => sodium.from_hex(modSign.public);
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
        return reply(200, { trades: [...net.states].map(([trade, state]) => ({ trade, state, settleKind: net.kinds.get(trade) ?? null, paused: net.paused.has(trade) })) });
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
    if (u.origin === RELAY && u.pathname === '/v1/admin/trades') {
      const body = JSON.parse(init.body ?? '{}') as { channel: string; signPublics: Record<Role, string>; at: number; sig: string };
      const ok = sodium.crypto_sign_verify_detached(
        sodium.from_base64(body.sig, sodium.base64_variants.ORIGINAL),
        relayRegisterMessage({ channel: body.channel, signPublics: body.signPublics, at: body.at }),
        modKey(),
      );
      return reply(ok ? 201 : 401);
    }
    if (u.origin === RELAY && u.pathname === '/v1/admin/trades/close') {
      const body = JSON.parse(init.body ?? '{}') as { channel: string; at: number; sig: string };
      // The relay's close message: domain `x2f/relay-close/v1\0` + canonical JSON of { channel, at }.
      const msg = new TextEncoder().encode(`x2f/relay-close/v1\0${canonicalJson({ channel: body.channel, at: body.at })}`);
      if (!sodium.crypto_sign_verify_detached(sodium.from_base64(body.sig, sodium.base64_variants.ORIGINAL), msg, modKey())) {
        net.unsigned.push('relay-close');
        return reply(401);
      }
      if (net.relayCloseStatus === 200) net.closed.push(body.channel);
      return reply(net.relayCloseStatus);
    }
    return reply(404);
  };
  return { net, fetch };
}

/** A stand-in escrow party: scripted funds, a ready() the test resolves. */
interface FakeParty {
  funds: {
    balance: bigint;
    unlocked: bigint;
    incoming: Incoming[];
    chainHeight: number | undefined;
    outgoing: Outgoing[] | undefined;
    spendClaims?: Role[];
    ownTxs?: string[];
    spendProofs?: { from: Role; txHash: string; txKey: string }[];
  };
  /** proveSweep's answer (default: nothing proven); every call is recorded. */
  prove: (txHash: string, txKey: string, minimums: Payout[]) => boolean;
  proveCalls: { txHash: string; txKey: string; minimums: Payout[] }[];
  stopped: boolean;
  resolveReady: (a: string) => void;
  handle: PartyHandle;
}

function fakeParty(): FakeParty {
  let resolveReady: (a: string) => void = () => {};
  const ready = new Promise<string>((r) => (resolveReady = r));
  const p: FakeParty = {
    funds: { balance: 0n, unlocked: 0n, incoming: [], chainHeight: 100, outgoing: [] },
    stopped: false,
    resolveReady,
    prove: () => false,
    proveCalls: [],
    handle: {
      ready: () => ready,
      settle: async () => null,
      funds: async () => {
        const { chainHeight, outgoing, ...rest } = p.funds;
        return { ...rest, incoming: rest.incoming.map((i) => ({ ...i })), ...(chainHeight === undefined ? {} : { chainHeight }), ...(outgoing === undefined ? {} : { outgoing }) };
      },
      // The party itself imports a releasing party's spend.info; the watcher never calls these.
      spendInfo: async () => {
        throw new Error('not used by the watcher');
      },
      importSpendInfo: async () => {
        throw new Error('not used by the watcher');
      },
      proveSweep: async (txHash: string, txKey: string, minimums: Payout[]) => {
        p.proveCalls.push({ txHash, txKey, minimums });
        return p.prove(txHash, txKey, minimums);
      },
      stop: async () => {
        p.stopped = true;
      },
    } as PartyHandle,
  };
  return p;
}

/** One moderation instance with recorded party starts. */
async function moderation(fetch: Fetch, logs: string[] = []) {
  const started: ModPartyArgs[] = [];
  const parties = new Map<string, FakeParty>();
  const handle: ModerationHandle = await startModeration(
    {
      apiInternalUrl: API,
      relayAdminUrl: RELAY,
      relayUrl: 'ws://relay.test',
      network: 'regtest',
      daemonUri: 'http://127.0.0.1:1',
      db,
      keystoreKey,
      signingSecret: modSign.secret,
      feeWallet: '5'.repeat(95),
      payrollWallet: '6'.repeat(95),
    },
    {
      fetch,
      now: () => clock,
      intervalMs: 0,
      watchIntervalMs: 0,
      log: (e) => logs.push(e.reason),
      startParty: async (a) => {
        started.push(a);
        const p = fakeParty();
        parties.set(a.trade, p);
        return p.handle;
      },
    },
  );
  running.push(handle);
  return { handle, started, parties, logs };
}
/** Stopped after each test, so a failed test leaves no instance lock held (security review 7 Nov, finding 2). */
const running: ModerationHandle[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
  // Every test shares this database, and a pass watches every watching row. A closed trade an
  // earlier test left with its channels open (late coins, or the API's close alone) would be resumed
  // by the next test's instance with a fresh fakeParty that shows no coins, read as "never got a
  // coin", and closed into THAT test's relay record: whichever test first runs a pass absorbs it, so
  // a failed or filtered test moved the closes into the I2 tests. Rows stay (no re-insert from
  // signed_terms); they are just no longer watched.
  await db.query('update mod_watch set watching = false');
});

/** A trade attested by `m`, its party started, ready() resolved with ESCROW and setup-done reported. */
async function inFunding(m: Awaited<ReturnType<typeof moderation>>, net: ReturnType<typeof fakeNetwork>['net']): Promise<string> {
  const code = newTradeCode();
  net.work = [await work(code)];
  expect(await m.handle.tick()).toEqual([code]);
  net.work = [];
  m.parties.get(code)!.resolveReady(ESCROW);
  net.states.set(code, 'setup');
  await expect.poll(async () => {
    await m.handle.watch();
    return net.reports.some((r) => r.kind === 'setup-done' && r.trade === code);
  }).toBe(true);
  net.states.set(code, 'funding');
  return code;
}

const incoming = (txHash: string, amountAtomic: bigint, height: number | null, unlocked = false): Incoming => ({
  txHash,
  amountAtomic,
  height,
  unlocked,
  confirmations: height === null ? 0 : 100 - height,
});

describe('the moderator party', () => {
  it('starts the real party for an attested trade with modPartyArgs and the SIGNED terms; nothing is deferred', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = newTradeCode();
    net.work = [await work(code)];
    expect(await m.handle.tick()).toEqual([code]);
    expect(m.started).toHaveLength(1);
    expect(m.started[0]).toMatchObject({ trade: code, role: 'mod', terms: TERMS, daemonUri: 'http://127.0.0.1:1' });
    expect(m.started[0]!.password).toMatch(/^[0-9a-f]{64}$/);
    expect(m.logs).not.toContain('party-deferred');
    await m.handle.stop();
  });

  it('after a restart resumes the party from the moderation database, with the signed terms even when the API now serves others', async () => {
    const { net, fetch } = fakeNetwork();
    const first = await moderation(fetch);
    const code = await inFunding(first, net);
    const signedMe = first.started[0]!.me.signPublic;
    await first.handle.stop();
    expect(first.parties.get(code)!.stopped).toBe(true);

    // The API (lying or buggy) now serves the same trade with other addresses.
    net.work = [await work(code, OTHER_TERMS)];
    const again = await moderation(fetch);
    await again.handle.tick();
    await again.handle.watch();
    const resumed = again.started.filter((a) => a.trade === code);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.terms).toEqual(TERMS);
    expect(resumed[0]!.terms.sellerRefund).not.toBe(OTHER_TERMS.sellerRefund);
    expect(resumed[0]!.me.signPublic).toBe(signedMe);
    // setup-done was already reported before the restart: not again.
    expect(net.reports.filter((r) => r.kind === 'setup-done' && r.trade === code)).toHaveLength(1);
    await again.handle.stop();
  });

  it('a posted attestation with no watch row (e.g. a crash between the two writes) still gets its party after a restart', async () => {
    const { net, fetch } = fakeNetwork();
    const first = await moderation(fetch);
    const code = newTradeCode();
    net.work = [await work(code)];
    await first.handle.tick();
    net.work = [];
    await first.handle.stop();
    await db.query('delete from mod_watch where trade = $1', [code]);
    net.states.set(code, 'setup');
    const again = await moderation(fetch);
    await again.handle.watch();
    expect(again.started.filter((a) => a.trade === code)).toHaveLength(1);
    expect(again.started[0]!.terms).toEqual(TERMS);
    await again.handle.stop();
  });

  it('setup-done accepted by the API but not recorded here: once the API is past setup the escrow is watched anyway', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    await db.query('update mod_watch set setup_done_at = null where trade = $1', [code]);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, incoming: [incoming(hash('a'), XMR, 99)] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'chain' && r.trade === code)).toHaveLength(1);
    expect(net.reports.filter((r) => r.kind === 'setup-done' && r.trade === code)).toHaveLength(1);
    await m.handle.stop();
  });

  it('reports setup-done once, with the address ready() resolved with', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    expect(net.reports.filter((r) => r.trade === code)).toEqual([{ kind: 'setup-done', trade: code, escrowAddress: ESCROW }]);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'setup-done' && r.trade === code)).toHaveLength(1);
    expect(net.unsigned).toEqual([]);
    await m.handle.stop();
  });
});

describe('the chain watcher', () => {
  it('reports chain facts (bigints as decimal strings) only when they change', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: 0n, incoming: [incoming(hash('a'), XMR, 99)] };
    await m.handle.watch();
    await m.handle.watch();
    const chain = net.reports.filter((r) => r.kind === 'chain' && r.trade === code);
    expect(chain).toEqual([{ kind: 'chain', trade: code, receivedAtomic: XMR.toString(), unlockedAtomic: '0', confirmations: 1 }]);
    await m.handle.stop();
  });

  it('reports nothing when the escrow facts lack heights (an engine without them)', async () => {
    const { net, fetch } = fakeNetwork();
    const logs: string[] = [];
    const m = await moderation(fetch, logs);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, incoming: [incoming(hash('a'), XMR, 99)], chainHeight: undefined };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'chain' && r.trade === code)).toEqual([]);
    expect(logs).toContain('escrow-facts-incomplete');
    await m.handle.stop();
  });

  it("a sweep the mod's own wallet shows in a block → settled, then the signed relay close for both channels, once", async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    await m.handle.watch();
    net.states.set(code, 'settling');
    // In the pool only: not settled, and no "empty escrow" chain report.
    p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('b'), height: null, spentAtomic: XMR }], ownTxs: [hash('b')] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === code && r.kind !== 'setup-done' && r.kind !== 'chain')).toEqual([]);
    expect(net.reports.filter((r) => r.trade === code && r.kind === 'chain')).toHaveLength(1);
    // In a block.
    // The wallet's record of the tx carries its network fee: the report passes it on for the books (owner 16 Nov).
    p.funds = { ...p.funds, outgoing: [{ txHash: hash('b'), height: 90, spentAtomic: XMR, feeAtomic: 30_720_000n }] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([{ kind: 'settled', trade: code, txHash: hash('b'), settleKind: null, networkFeeAtomic: '30720000' }]);
    expect(net.closed.sort()).toEqual([await channelFor(code, 'escrow'), await channelFor(code, 'signals')].sort());
    net.states.set(code, 'released');
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(1);
    expect(net.closed).toHaveLength(2);
    expect(net.unsigned).toEqual([]);
    await m.handle.stop();
  });

  it('a refused relay close keeps the state unpersisted: the next pass repeats settled and the close', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    net.states.set(code, 'settling');
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('c'), height: 90, spentAtomic: XMR }], ownTxs: [hash('c')] };
    net.relayCloseStatus = 503;
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(1);
    net.relayCloseStatus = 200;
    // The API refuses the repeat as wrong-state: that counts as done.
    net.answer = (r) => (r.kind === 'settled' ? { status: 409, error: 'wrong-state' } : { status: 201 });
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(2);
    expect(net.closed).toHaveLength(2);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(2);
    await m.handle.stop();
  });

  it('settle-kind-unknown is logged and backed off, never retried every pass', async () => {
    const { net, fetch } = fakeNetwork();
    const logs: string[] = [];
    const m = await moderation(fetch, logs);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    net.states.set(code, 'secured');
    net.answer = (r) => (r.kind === 'settled' ? { status: 409, error: 'settle-kind-unknown' } : { status: 201 });
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('d'), height: 90, spentAtomic: XMR }], ownTxs: [hash('d')] };
    await m.handle.watch();
    await m.handle.watch();
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(1);
    expect(logs).toContain('settle-kind-unknown');
    // After the back-off it is tried again.
    clock = new Date(clock.getTime() + 61_000);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(2);
    clock = new Date(clock.getTime() + 61_000);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(2); // the back-off doubled
    await m.handle.stop();
  });

  it('funds arriving after the close → chain of the late coins, then late-funds (once)', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    net.states.set(code, 'settling');
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('e'), height: 90, spentAtomic: XMR }], ownTxs: [hash('e')] };
    await m.handle.watch();
    net.states.set(code, 'released');
    p.funds = { ...p.funds, balance: 5n, incoming: [...p.funds.incoming, incoming(hash('f'), 5n, null)] };
    await m.handle.watch();
    await m.handle.watch();
    const after = net.reports.filter((r) => r.trade === code && (r.kind === 'late-funds' || (r.kind === 'chain' && r.receivedAtomic === '5')));
    expect(after).toEqual([
      { kind: 'chain', trade: code, receivedAtomic: '5', unlockedAtomic: '0', confirmations: 0 },
      { kind: 'late-funds', trade: code },
    ]);
    await m.handle.stop();
  });

  it('settling 6 h with no spend shown → spend-unshown once (fake clock); a restart neither forgets the anchor nor repeats it', async () => {
    const { net, fetch } = fakeNetwork();
    const first = await moderation(fetch);
    const code = await inFunding(first, net);
    const p = first.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    await first.handle.watch();
    // A seller-buyer release was submitted; the mod is never shown it (no spend.info arrives).
    net.states.set(code, 'settling');
    const start = clock.getTime();
    await first.handle.watch();
    const unshown = () => net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === code);
    clock = new Date(start + 3 * 60 * 60_000);
    await first.handle.watch();
    expect(unshown()).toEqual([]);
    // A restart halfway: the anchor is the persisted first sight, not the restart.
    await first.handle.stop();
    const second = await moderation(fetch);
    await second.handle.watch();
    second.parties.get(code)!.funds = p.funds;
    clock = new Date(start + 6 * 60 * 60_000 - 1000);
    await second.handle.watch();
    expect(unshown()).toEqual([]);
    clock = new Date(start + 6 * 60 * 60_000);
    await second.handle.watch();
    expect(unshown()).toEqual([{ kind: 'spend-unshown', trade: code }]);
    // The API has not shown the dispute yet: no repeat, not even after another restart.
    clock = new Date(start + 7 * 60 * 60_000);
    await second.handle.watch();
    await second.handle.stop();
    const third = await moderation(fetch);
    await third.handle.watch();
    clock = new Date(start + 8 * 60 * 60_000);
    await third.handle.watch();
    expect(unshown()).toHaveLength(1);
    await third.handle.stop();
  });

  it('a trade party\'s claim (spend.info refused, or spend.claim when too big) → release-claimed once, surviving a restart; 6 h after it with no spend shown → spend-unshown once (lead decision b)', async () => {
    const { net, fetch } = fakeNetwork();
    const first = await moderation(fetch);
    const code = await inFunding(first, net);
    const p = first.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    net.states.set(code, 'settling');
    const start = clock.getTime();
    await first.handle.watch();
    const claimed = () => net.reports.filter((r) => r.kind === 'release-claimed' && r.trade === code);
    const unshown = () => net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === code);
    expect(claimed()).toEqual([]);
    // 10 min in, the seller's too-big info arrives as a claim alone (the party's PartyState.claims).
    clock = new Date(start + 10 * 60_000);
    p.funds = { ...p.funds, spendClaims: ['seller'] };
    await first.handle.watch();
    expect(claimed()).toEqual([{ kind: 'release-claimed', trade: code }]);
    // the API keeps the claimed trade settling past its 15-min window; the buyer's refused info adds a second claimant
    clock = new Date(start + 30 * 60_000);
    p.funds = { ...p.funds, spendClaims: ['seller', 'buyer'] };
    await first.handle.watch();
    await first.handle.stop();
    const second = await moderation(fetch);
    await second.handle.watch();
    second.parties.get(code)!.funds = p.funds;
    await second.handle.watch();
    expect(claimed()).toHaveLength(1);
    // 6 h after settling started is not enough: the fallback counts from the claim
    clock = new Date(start + 6 * 60 * 60_000 + 60_000);
    await second.handle.watch();
    expect(unshown()).toEqual([]);
    clock = new Date(start + 10 * 60_000 + 6 * 60 * 60_000);
    await second.handle.watch();
    expect(unshown()).toEqual([{ kind: 'spend-unshown', trade: code }]);
    clock = new Date(start + 8 * 60 * 60_000);
    await second.handle.watch();
    expect(unshown()).toHaveLength(1);
    expect(claimed()).toHaveLength(1);
    await second.handle.stop();
  });

  it('a claim followed by the sweep shown within 6 h settles normally; nothing escalates', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)], spendClaims: ['buyer'] };
    net.states.set(code, 'settling');
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === code).map((r) => r.kind)).toContain('release-claimed');
    clock = new Date(clock.getTime() + 60 * 60_000);
    p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('b'), height: 90, spentAtomic: XMR }], ownTxs: [hash('b')] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === code)).toEqual([{ kind: 'settled', trade: code, txHash: hash('b'), settleKind: null }]);
    net.states.set(code, 'released');
    clock = new Date(clock.getTime() + 7 * 60 * 60_000);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === code)).toEqual([]);
    await m.handle.stop();
  });

  it('spend-unshown refused by the API (not wrong-state) is posted again on the next pass', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    net.states.set(code, 'settling');
    await m.handle.watch();
    clock = new Date(clock.getTime() + 6 * 60 * 60_000);
    net.answer = (r) => (r.kind === 'spend-unshown' ? { status: 503 } : { status: 201 });
    await m.handle.watch();
    net.answer = () => ({ status: 201 });
    await m.handle.watch();
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === code)).toHaveLength(2);
    await m.handle.stop();
  });

  it('a trade the API closed before any escrow existed: the party is stopped and dropped', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = newTradeCode();
    net.work = [await work(code)];
    await m.handle.tick();
    net.states.set(code, 'cancelled');
    await m.handle.watch();
    expect(m.parties.get(code)!.stopped).toBe(true);
    await m.handle.stop();
  });

  describe('a sweep shown only through an import counts only with a tx-key proof (review I1) named by both parties (round 3, R3-I1)', () => {
    const KEY = '7'.repeat(64);
    const FEE_WALLET = '5'.repeat(95);
    async function settlingRelease(net: ReturnType<typeof fakeNetwork>['net'], m: Awaited<ReturnType<typeof moderation>>) {
      const code = await inFunding(m, net);
      const p = m.parties.get(code)!;
      p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
      await m.handle.watch();
      net.states.set(code, 'settling');
      net.kinds.set(code, 'release');
      // The mod's wallet shows a tx it did not sign, after importing a party's info.
      p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('b'), height: 90, spentAtomic: XMR }], ownTxs: [] };
      return { code, p };
    }

    it('no proof (no tx key sent, or one that proves nothing): never settled, logged, and the channels stay open', async () => {
      const { net, fetch } = fakeNetwork();
      const logs: string[] = [];
      const m = await moderation(fetch, logs);
      const { code, p } = await settlingRelease(net, m);
      await m.handle.watch();
      p.funds = { ...p.funds, spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: '' }, { from: 'buyer', txHash: hash('b'), txKey: '' }] };
      await m.handle.watch();
      expect(p.proveCalls).toEqual([]);
      // a key that does not prove the payouts (the forged sweep pays someone else)
      p.funds = { ...p.funds, spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: KEY }, { from: 'buyer', txHash: hash('b'), txKey: '' }] };
      await m.handle.watch();
      expect(p.proveCalls).toHaveLength(1);
      expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === code)).toEqual([]);
      expect(logs).toContain('sweep-unproven');
      expect(net.closed).toEqual([]);
      // ...and the 6 h fallback still escalates it
      clock = new Date(clock.getTime() + 6 * 60 * 60_000);
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === code)).toHaveLength(1);
      await m.handle.stop();
    });

    it('a proof against the minimums from the SIGNED terms (never an API read) → settled, then the close', async () => {
      const { net, fetch } = fakeNetwork();
      const m = await moderation(fetch);
      const { code, p } = await settlingRelease(net, m);
      p.funds = { ...p.funds, spendProofs: [{ from: 'buyer', txHash: hash('b'), txKey: KEY }, { from: 'seller', txHash: hash('b'), txKey: '' }] };
      p.prove = () => true;
      await m.handle.watch();
      expect(p.proveCalls).toEqual([{
        txHash: hash('b'),
        txKey: KEY,
        minimums: [
          { address: TERMS.buyerPayout, amountAtomic: 250_000_000_000n, bearsNetworkFee: true },
          { address: FEE_WALLET, amountAtomic: feeFor(250_000_000_000n) - feeFor(250_000_000_000n) / 2n, bearsNetworkFee: true },
          { address: '6'.repeat(95), amountAtomic: feeFor(250_000_000_000n) / 2n, bearsNetworkFee: true },
        ],
      }]);
      expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([{ kind: 'settled', trade: code, txHash: hash('b'), settleKind: 'release' }]);
      expect(net.closed).toHaveLength(2);
      await m.handle.stop();
    });

    it('settled names the kind the sweep was proven for; a 409 settle-kind-changed is not counted, is backed off, and is proven again after the back-off (security review 7 Nov finding 3, re-verify R2)', async () => {
      const { net, fetch } = fakeNetwork();
      const logs: string[] = [];
      const m = await moderation(fetch, logs);
      const { code, p } = await settlingRelease(net, m);
      p.funds = { ...p.funds, spendProofs: [{ from: 'buyer', txHash: hash('b'), txKey: KEY }, { from: 'seller', txHash: hash('b'), txKey: '' }] };
      p.prove = () => true;
      net.answer = (r) => (r.kind === 'settled' ? { status: 409, error: 'settle-kind-changed' } : { status: 201 });
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([{ kind: 'settled', trade: code, txHash: hash('b'), settleKind: 'release' }]);
      expect(logs).toContain('settle-kind-changed');
      expect(net.closed).toEqual([]);
      // Re-verify R2: backed off like settle-kind-unknown, never asked again every pass.
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(1);
      // The trade now settles as a mutual cancel: once the back-off is over, proven again against its minimums, then accepted.
      net.kinds.set(code, 'mutual-cancel');
      net.answer = () => ({ status: 201 });
      clock = new Date(clock.getTime() + 61_000);
      await m.handle.watch();
      expect(p.proveCalls.at(-1)!.minimums).toEqual([{ address: TERMS.sellerRefund, amountAtomic: XMR }]);
      expect(net.reports.filter((r) => r.kind === 'settled').at(-1)).toEqual({ kind: 'settled', trade: code, txHash: hash('b'), settleKind: 'mutual-cancel' });
      expect(net.closed).toHaveLength(2);
      await m.handle.stop();
    });

    it('a seller-buyer refund is proven against everything the sweep spent, to the signed refund address', async () => {
      const { net, fetch } = fakeNetwork();
      const m = await moderation(fetch);
      const { code, p } = await settlingRelease(net, m);
      net.kinds.set(code, 'mutual-cancel');
      p.funds = { ...p.funds, spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: KEY }, { from: 'buyer', txHash: hash('b'), txKey: '' }] };
      p.prove = () => true;
      await m.handle.watch();
      expect(p.proveCalls[0]!.minimums).toEqual([{ address: TERMS.sellerRefund, amountAtomic: XMR }]);
      expect(net.reports.filter((r) => r.kind === 'settled')).toHaveLength(1);
      await m.handle.stop();
    });

    it('the same proven tx offered for two trades counts for the first only, also after a restart (round 2, R2-I1 b)', async () => {
      const { net, fetch } = fakeNetwork();
      const logs: string[] = [];
      const m = await moderation(fetch, logs);
      const t3 = await settlingRelease(net, m);
      const t2 = await settlingRelease(net, m);
      // Trade 3's real release, proven.
      t3.p.funds = { ...t3.p.funds, spendProofs: [{ from: 'buyer', txHash: hash('b'), txKey: KEY }, { from: 'seller', txHash: hash('b'), txKey: '' }] };
      t3.p.prove = () => true;
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([{ kind: 'settled', trade: t3.code, txHash: hash('b'), settleKind: 'release' }]);
      // Trade 2's mod wallet is made to attribute the same tx to escrow 2, with the key that proves it.
      t2.p.funds = { ...t2.p.funds, spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: KEY }, { from: 'buyer', txHash: hash('b'), txKey: '' }] };
      t2.p.prove = () => true;
      await m.handle.watch();
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === t2.code)).toEqual([]);
      expect(logs).toContain('sweep-counted-elsewhere');
      expect(net.closed.sort()).toEqual([await channelFor(t3.code, 'escrow'), await channelFor(t3.code, 'signals')].sort());
      // The record is durable: a restarted service still refuses it for trade 2.
      await m.handle.stop();
      const logs2: string[] = [];
      const m2 = await moderation(fetch, logs2);
      await m2.handle.watch();
      const p2 = m2.parties.get(t2.code)!;
      p2.funds = { ...t2.p.funds };
      p2.prove = () => true;
      await m2.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === t2.code)).toEqual([]);
      expect(logs2).toContain('sweep-counted-elsewhere');
      // ...and its 6 h fallback escalates it instead
      clock = new Date(clock.getTime() + 6 * 60 * 60_000 + WATCH_RESTART_GRACE_MS);
      await m2.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === t2.code)).toHaveLength(1);
      await m2.handle.stop();
    });

    it('an honest seller-buyer sweep counts only once BOTH parties\' sealed spend.info name it (round 3, R3-I1)', async () => {
      const { net, fetch } = fakeNetwork();
      const logs: string[] = [];
      const m = await moderation(fetch, logs);
      const { code, p } = await settlingRelease(net, m);
      p.prove = () => true;
      // only the seller's statement, with a key that proves the minimums: not counted
      p.funds = { ...p.funds, spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: KEY }] };
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === code)).toEqual([]);
      expect(logs).toContain('sweep-unproven');
      expect(net.closed).toEqual([]);
      // the buyer's statement names the same tx (no key of its own): now counted, then the close
      p.funds = { ...p.funds, spendProofs: [...p.funds.spendProofs!, { from: 'buyer', txHash: hash('b'), txKey: '' }] };
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([{ kind: 'settled', trade: code, txHash: hash('b'), settleKind: 'release' }]);
      expect(net.closed).toHaveLength(2);
      await m.handle.stop();
    });

    it('a decoy attack: trade B\'s real release with escrow A\'s output as a ring decoy and forged partials for mod A, named only by the seller, never counts for A and leaves the record free for B (round 3, R3-I1)', async () => {
      const { net, fetch } = fakeNetwork();
      const logs: string[] = [];
      const m = await moderation(fetch, logs);
      const a = await settlingRelease(net, m);
      const b = await settlingRelease(net, m);
      // Trade A: the seller alone names T_B (hash b) with T_B's tx key; the proof passes (the decoy
      // puts A's output in the ring, T_B pays A's buyer address and fee at least A's minimums).
      a.p.funds = { ...a.p.funds, spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: KEY }] };
      a.p.prove = () => true;
      // Trade A is watched first, more than once: it never claims T_B.
      await m.handle.watch();
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === a.code)).toEqual([]);
      expect(logs).toContain('sweep-unproven');
      expect(logs).not.toContain('sweep-counted-elsewhere');
      // Trade B: both its parties name T_B, so it counts for B.
      b.p.funds = { ...b.p.funds, spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: KEY }, { from: 'buyer', txHash: hash('b'), txKey: KEY }] };
      b.p.prove = () => true;
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([{ kind: 'settled', trade: b.code, txHash: hash('b'), settleKind: 'release' }]);
      expect(net.closed.sort()).toEqual([await channelFor(b.code, 'escrow'), await channelFor(b.code, 'signals')].sort());
      // ...and A escalates through its 6 h fallback instead
      clock = new Date(clock.getTime() + 6 * 60 * 60_000);
      await m.handle.watch();
      expect(net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === a.code)).toHaveLength(1);
      expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === a.code)).toEqual([]);
      await m.handle.stop();
    });

    it('watchStep\'s no-close rule, with a STUBBED proof (the real spendsEscrow never proves a tx mined before the escrow was funded: a ring cannot hold a later output): such a tx is settled, then late-funds, and the channels stay open for the dispute (round 2, R2-I1; round 3, R3-M3)', async () => {
      const { net, fetch } = fakeNetwork();
      const m = await moderation(fetch);
      const { code, p } = await settlingRelease(net, m);
      // proven, but mined at height 40, below the escrow's funding at 50: it swept nothing
      p.funds = { ...p.funds, outgoing: [{ txHash: hash('b'), height: 40, spentAtomic: XMR }], spendProofs: [{ from: 'buyer', txHash: hash('b'), txKey: KEY }, { from: 'seller', txHash: hash('b'), txKey: '' }] };
      p.prove = () => true;
      await m.handle.watch();
      expect(net.reports.filter((r) => r.trade === code && (r.kind === 'settled' || r.kind === 'late-funds')).map((r) => r.kind)).toEqual(['settled', 'late-funds']);
      net.states.set(code, 'disputed');
      await m.handle.watch();
      expect(net.closed).toEqual([]);
      await m.handle.stop();
    });

    it('no settle kind from the API, or a kind the mod co-signs: nothing to prove against, never counted', async () => {
      const { net, fetch } = fakeNetwork();
      const m = await moderation(fetch);
      const { code, p } = await settlingRelease(net, m);
      p.funds = { ...p.funds, spendProofs: [{ from: 'buyer', txHash: hash('b'), txKey: KEY }, { from: 'seller', txHash: hash('b'), txKey: '' }] };
      p.prove = () => true;
      for (const kind of [null, 'buyer-cancel', 'auto-refund']) {
        if (kind === null) net.kinds.delete(code);
        else net.kinds.set(code, kind);
        await m.handle.watch();
      }
      expect(p.proveCalls).toEqual([]);
      expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([]);
      await m.handle.stop();
    });
  });

  describe('relay channels close only after a sweep this mod showed, or for an escrow that never got a coin (review I2)', () => {
    it('the API alone says released while the escrow holds coins: no close, the coins escalate as late', async () => {
      const { net, fetch } = fakeNetwork();
      const m = await moderation(fetch);
      const code = await inFunding(m, net);
      const p = m.parties.get(code)!;
      p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
      await m.handle.watch();
      for (const state of ['released', 'cancelled']) {
        net.states.set(code, state);
        await m.handle.watch();
        await m.handle.watch();
      }
      expect(net.closed).toEqual([]);
      expect(net.reports.filter((r) => r.kind === 'late-funds' && r.trade === code)).toHaveLength(1);
      // once its own wallet shows the sweep (e.g. a ruling it co-signed), it closes
      p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('c'), height: 90, spentAtomic: XMR }], ownTxs: [hash('c')] };
      await m.handle.watch();
      expect(net.closed.sort()).toEqual([await channelFor(code, 'escrow'), await channelFor(code, 'signals')].sort());
      await m.handle.stop();
    });

    it('the API says cancelled and the escrow never got a coin: closed once', async () => {
      const { net, fetch } = fakeNetwork();
      const m = await moderation(fetch);
      const code = await inFunding(m, net);
      await m.handle.watch();
      net.states.set(code, 'cancelled');
      await m.handle.watch();
      await m.handle.watch();
      expect(net.closed).toHaveLength(2);
      await m.handle.stop();
    });
  });

  it('a paused settling trade never escalates; after a restart the fallback waits 30 min (review M3)', async () => {
    const { net, fetch } = fakeNetwork();
    const first = await moderation(fetch);
    const code = await inFunding(first, net);
    const p = first.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    net.states.set(code, 'settling');
    net.paused.add(code);
    const start = clock.getTime();
    const unshown = () => net.reports.filter((r) => r.kind === 'spend-unshown' && r.trade === code);
    for (const h of [0, 3, 7]) {
      clock = new Date(start + h * 60 * 60_000);
      await first.handle.watch();
    }
    expect(unshown()).toEqual([]);
    net.paused.delete(code);
    await first.handle.watch(); // the 6 h count from here (7 h)
    await first.handle.stop();
    // the moderation service is down from 8 h to 14 h, then starts again
    clock = new Date(start + 14 * 60 * 60_000);
    const second = await moderation(fetch);
    await second.handle.watch();
    second.parties.get(code)!.funds = p.funds;
    await second.handle.watch();
    expect(unshown()).toEqual([]);
    clock = new Date(start + 14 * 60 * 60_000 + 30 * 60_000);
    await second.handle.watch();
    expect(unshown()).toHaveLength(1);
    await second.handle.stop();
  });

  it('a closed trade the API no longer lists is still watched for its own 30 days: late coins escalate, then the party stops (review M6)', async () => {
    const { net, fetch } = fakeNetwork();
    const logs: string[] = [];
    const m = await moderation(fetch, logs);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    net.states.set(code, 'settling');
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('e'), height: 90, spentAtomic: XMR }], ownTxs: [hash('e')] };
    await m.handle.watch();
    const closedAt = clock.getTime();
    net.states.delete(code); // e.g. the API's close was earlier than this watcher's
    clock = new Date(closedAt + 20 * 86_400_000);
    p.funds = { ...p.funds, balance: 5n, incoming: [...p.funds.incoming, incoming(hash('f'), 5n, null)] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'late-funds' && r.trade === code)).toHaveLength(1);
    expect(p.stopped).toBe(false);
    // the escalation is unconfirmed (the trade is not listed, so no dispute is seen): the watch goes on
    clock = new Date(closedAt + 31 * 86_400_000);
    await m.handle.watch();
    expect(p.stopped).toBe(false);
    await m.handle.stop();
  });

  it('an unlisted closed trade with nothing late stops after its 30 days (review M6)', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    const p = m.parties.get(code)!;
    net.states.set(code, 'settling');
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('e'), height: 90, spentAtomic: XMR }], ownTxs: [hash('e')] };
    await m.handle.watch();
    const closedAt = clock.getTime();
    net.states.delete(code);
    clock = new Date(closedAt + 29 * 86_400_000);
    await m.handle.watch();
    expect(p.stopped).toBe(false);
    clock = new Date(closedAt + 31 * 86_400_000);
    await m.handle.watch();
    expect(p.stopped).toBe(true);
    await m.handle.stop();
  });

  it('stop() stops every running party', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    await m.handle.stop();
    expect(m.parties.get(code)!.stopped).toBe(true);
  });
});

// Review B1 and M2 (lien recovery, 2026-11-16): a recovery this service signed counts against its
// source trade's lien until the watcher itself sees the trade end without paying it: a refund
// proven to the signed refund address, or a watch that ends with no coin ever received.
describe('lien recoveries signed here are freed only by what the watcher sees (review B1, M2)', () => {
  const owing = async (code: string) => {
    await db.query(
      `insert into mod_liens (lien_id, source_code, creditor_side, debtor, creditor, amount_atomic, rate_bps, statement, sig)
       values ($1, 'SRCE-SRCE-SRCE-SRCE', 'buyer', 'd', 'c', 1000, 5000, '{}', 'x') on conflict (lien_id) do nothing`,
      [`lien-${code}`],
    );
    await db.query(`insert into mod_lien_recoveries (trade, lien_id, source_code, creditor, amount_atomic) values ($1, $2, 'SRCE-SRCE-SRCE-SRCE', 'buyer', 1000)`, [code, `lien-${code}`]);
  };
  const freed = async (code: string) => (await db.query<{ f: boolean }>('select freed_at is not null as f from mod_lien_recoveries where trade = $1', [code])).rows[0]!.f;

  it('a trade the API closed before any escrow existed frees it', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = newTradeCode();
    net.work = [await work(code)];
    await m.handle.tick();
    await owing(code);
    net.states.set(code, 'cancelled');
    await m.handle.watch();
    expect(await freed(code)).toBe(true);
    await m.handle.stop();
  });

  it('a released trade keeps it (the recovery was paid); an own sweep of unknown kind keeps it too', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    await owing(code);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    await m.handle.watch();
    net.states.set(code, 'settling');
    p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('b'), height: 90, spentAtomic: XMR }], ownTxs: [hash('b')] };
    await m.handle.watch();
    expect(net.reports.some((r) => r.kind === 'settled' && r.trade === code)).toBe(true);
    net.states.set(code, 'released');
    clock = new Date(clock.getTime() + 31 * 86_400_000);
    await m.handle.watch();
    expect(await freed(code)).toBe(false);
    await m.handle.stop();
  });

  it('review M2: a recovery freed earlier (a refunded trade) counts again when a sweep that pays it is counted (late coins ruled for the buyer)', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    await owing(code);
    await db.query('update mod_lien_recoveries set freed_at = now() where trade = $1', [code]);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    await m.handle.watch();
    net.states.set(code, 'settling');
    net.kinds.set(code, 'release');
    p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('b'), height: 90, spentAtomic: XMR }], ownTxs: [hash('b')] };
    await m.handle.watch();
    expect(net.reports.some((r) => r.kind === 'settled' && r.trade === code)).toBe(true);
    expect(await freed(code)).toBe(false);
    await m.handle.stop();
  });

  it('a refund proven to the signed refund address frees it', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    await owing(code);
    const p = m.parties.get(code)!;
    p.funds = { ...p.funds, balance: XMR, unlocked: XMR, incoming: [incoming(hash('a'), XMR, 50, true)] };
    await m.handle.watch();
    net.states.set(code, 'settling');
    net.kinds.set(code, 'mutual-cancel');
    p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('b'), height: 90, spentAtomic: XMR }], ownTxs: [], spendProofs: [{ from: 'seller', txHash: hash('b'), txKey: 'k'.repeat(64) }, { from: 'buyer', txHash: hash('b'), txKey: '' }] };
    p.prove = () => true;
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === code)).toHaveLength(1);
    expect(await freed(code)).toBe(true);
    await m.handle.stop();
  });

  it('cancelled with an escrow that never got a coin: kept while late coins could still come, freed when the watch ends', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    await owing(code);
    await m.handle.watch();
    net.states.set(code, 'cancelled');
    await m.handle.watch();
    expect(await freed(code)).toBe(false);
    clock = new Date(clock.getTime() + 31 * 86_400_000);
    await m.handle.watch();
    expect(m.parties.get(code)!.stopped).toBe(true);
    expect(await freed(code)).toBe(true);
    await m.handle.stop();
  });
});
