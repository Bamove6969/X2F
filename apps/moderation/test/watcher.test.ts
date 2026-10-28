// Plan 3 Task 9 I/O: the moderator party and the chain watcher inside the moderation service.
// Hermetic: a fake API internal listener and relay admin listener behind the injected fetch (they
// CHECK every moderation signature), and a recorded party starter in place of the escrow party.
import { createHash, randomBytes } from 'node:crypto';
import { newTradeCode, type Role } from '@x2f/core';
import type { Incoming, Outgoing, PartyHandle } from '@x2f/escrow';
import { canonicalJson, generateIdentity, type Identity } from '@x2f/protocol';
import {
  channelFor,
  identityProofBytes,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  type AttestedTerms,
  type ModPartyArgs,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { relayRegisterMessage, startModeration, type Fetch, type ModerationHandle, type WorkItem } from '../src/main.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const API = 'http://api-internal.test';
const RELAY = 'http://relay-admin.test';
const TERMS: AttestedTerms = {
  deal: { poster: 'seller', takeAmountAtomic: '250000000000', currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000' },
  buyerPayout: '4'.padEnd(95, 'B'),
  sellerRefund: '8'.padEnd(95, 'S'),
};
/** What a lying API might serve later for the same trade. */
const OTHER_TERMS: AttestedTerms = { ...TERMS, buyerPayout: '4'.padEnd(95, 'X'), sellerRefund: '8'.padEnd(95, 'Y') };
const ESCROW = '5'.padEnd(95, 'E');
const XMR = 1_000_000_000_000n;
const hash = (c: string): string => c.repeat(64);

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
        return reply(200, { trades: [...net.states].map(([trade, state]) => ({ trade, state })) });
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
  funds: { balance: bigint; unlocked: bigint; incoming: Incoming[]; chainHeight: number | undefined; outgoing: Outgoing[] | undefined };
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
    handle: {
      ready: () => ready,
      settle: async () => null,
      funds: async () => {
        const { chainHeight, outgoing, ...rest } = p.funds;
        return { ...rest, incoming: rest.incoming.map((i) => ({ ...i })), ...(chainHeight === undefined ? {} : { chainHeight }), ...(outgoing === undefined ? {} : { outgoing }) };
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
  return { handle, started, parties, logs };
}

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
    p.funds = { ...p.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('b'), height: null, spentAtomic: XMR }] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === code && r.kind !== 'setup-done' && r.kind !== 'chain')).toEqual([]);
    expect(net.reports.filter((r) => r.trade === code && r.kind === 'chain')).toHaveLength(1);
    // In a block.
    p.funds = { ...p.funds, outgoing: [{ txHash: hash('b'), height: 90, spentAtomic: XMR }] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled')).toEqual([{ kind: 'settled', trade: code, txHash: hash('b') }]);
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
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('c'), height: 90, spentAtomic: XMR }] };
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
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('d'), height: 90, spentAtomic: XMR }] };
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
    p.funds = { ...p.funds, balance: 0n, incoming: [incoming(hash('a'), XMR, 50, true)], outgoing: [{ txHash: hash('e'), height: 90, spentAtomic: XMR }] };
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

  it('stop() stops every running party', async () => {
    const { net, fetch } = fakeNetwork();
    const m = await moderation(fetch);
    const code = await inFunding(m, net);
    await m.handle.stop();
    expect(m.parties.get(code)!.stopped).toBe(true);
  });
});
