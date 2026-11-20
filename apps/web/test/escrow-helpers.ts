// Stubs for the escrow runtime tests: an in-memory API and relay, a spy party, and a test mod key.
import type { Role } from '@x2f/core';
import { TransportClosedError, type EscrowEngine, type Incoming, type Outcome, type PartyArgs, type PartyHandle, type Transport } from '@x2f/escrow';
import { canonicalJson, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, escrowPlan, instructionsSha256, type Attestation } from '@x2f/trade';
import { IDBFactory } from 'fake-indexeddb';
import sodium from 'libsodium-wrappers';
import { createEscrowRuntime, type ConfirmedTrade, type EscrowRuntime, type EscrowStatus } from '../src/escrow/runtime.js';
import { openEscrowStore, type EscrowStore } from '../src/escrow/store.js';

export const CODE = 'K7Q2-M9XA-3PRT-W8DN';
export const AMOUNT = 1_250_000_000_000n;
export const FEE_WALLET = '4FeeWalletAddress';
export const ADDR = { buyer: '4BuyerPayout', seller: '4SellerRefund' } as const;
export const ESCROW_ADDRESS = '5EscrowMultisigAddress';
/** The payment instructions locked at take; the attestation carries their SHA-256 (Task 34 review I1, restored after J-16). */
export const INSTRUCTIONS = 'Zelle to pay@example.test, memo: the trade code';
/** The method chosen at take, in the view and the attestation. */
export const METHOD_ID = 'ZELLE';

/**
 * A fresh trade identity for the stubs, made here with libsodium. apps/web may name the
 * protocol's identity maker only in the escrow worker (separation check, Task 8), so the
 * tests build theirs the same way the protocol does.
 */
export async function testIdentity(): Promise<Identity> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}

export async function modKey(): Promise<{ publicHex: string; secret: Uint8Array }> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return { publicHex: sodium.to_hex(kp.publicKey), secret: kp.privateKey };
}

export function signAttestation(a: Attestation, secret: Uint8Array): string {
  return sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), secret));
}

/** A relay that delivers each envelope to the other roles on the same channel. */
export class Hub {
  private boxes = new Map<string, { inbox: unknown[]; waiters: ((v: unknown) => void)[] }>();
  sent: { channel: string; from: Role; e: Envelope }[] = [];
  opened: { channel: string; role: Role }[] = [];
  private box(channel: string, role: Role) {
    const k = `${channel}/${role}`;
    let b = this.boxes.get(k);
    if (!b) this.boxes.set(k, (b = { inbox: [], waiters: [] }));
    return b;
  }
  transport = (a: { url: string; code: string; role: Role }): Transport => {
    this.opened.push({ channel: a.code, role: a.role });
    let closed = false;
    const me = this.box(a.code, a.role);
    const mine = new Set<(v: unknown) => void>();
    return {
      send: (e) => {
        if (closed) return;
        this.sent.push({ channel: a.code, from: a.role, e });
        for (const r of ['buyer', 'seller', 'mod'] as const) {
          if (r === a.role) continue;
          const b = this.box(a.code, r);
          const copy = JSON.parse(JSON.stringify(e)) as unknown;
          const w = b.waiters.shift();
          if (w) w(copy);
          else b.inbox.push(copy);
        }
      },
      next: () =>
        new Promise((resolve, reject) => {
          if (closed) return reject(new Error('closed'));
          const x = me.inbox.shift();
          if (x !== undefined) resolve(x);
          else {
            mine.add(resolve);
            me.waiters.push(resolve);
          }
        }),
      onReconnect: () => {},
      close: () => {
        closed = true;
        // A closed transport's pending read must not swallow frames meant for the next one.
        me.waiters = me.waiters.filter((w) => !mine.has(w));
      },
    };
  };
  /** Delivers a frame as if from a peer (e.g. the mod). */
  inject(channel: string, role: Role, e: unknown): void {
    const b = this.box(channel, role);
    const w = b.waiters.shift();
    if (w) w(e);
    else b.inbox.push(e);
  }
}

export interface Funds {
  balance: bigint;
  unlocked: bigint;
  incoming: Incoming[];
}

/** A spy party: setup resolves at once with ESCROW_ADDRESS; settle calls are recorded. */
export class Parties {
  calls: { role: Role; args: PartyArgs }[] = [];
  settles: { role: Role; o: Outcome }[] = [];
  funds: Funds = { balance: 0n, unlocked: 0n, incoming: [] };
  /** Per-role readings that override `funds` (one wallet lagging behind the other). */
  fundsFor: Partial<Record<Role, Funds>> = {};
  /** How many times each role's runtime read funds() (one per tick once the party runs). */
  reads: Partial<Record<Role, number>> = {};
  /** Resolves once `role` has read funds() `n` more times: that many ticks went by. */
  ticks(role: Role, n = 2): Promise<void> {
    const want = (this.reads[role] ?? 0) + n;
    return new Promise((resolve) => this.tickWaiters.push({ role, want, resolve }));
  }
  private tickWaiters: { role: Role; want: number; resolve: () => void }[] = [];
  /** Settles resolve only when released. */
  pending: { role: Role; o: Outcome; resolve: (v: string | null) => void; reject: (e: unknown) => void }[] = [];
  committed = new Map<Role, string>();
  /**
   * What each role's party answers to committedBuilder() (the builder of a tx set it built or
   * accepted, so it can no longer switch outcomes); null when absent. A role in `noCommittedBuilder`
   * gets a party without the method (an older party: counts as committed, fail closed).
   */
  committedBuilders: Partial<Record<Role, Role | null>> = {};
  noCommittedBuilder = new Set<Role>();
  /**
   * acceptedOutcome(): the outcome the party's queued settle() job took (switched to). A settle is
   * taken at once unless its role is in `acceptHeld` (the job still waits behind the party's work, or
   * will be refused); `accept(role)` then takes the role's latest settle. A role in
   * `noCommittedBuilder` gets neither method.
   */
  accepted: Partial<Record<Role, Outcome | null>> = {};
  acceptHeld = new Set<Role>();
  accept(role: Role): void {
    this.acceptHeld.delete(role);
    const last = this.settles.filter((x) => x.role === role).at(-1);
    this.accepted[role] = last ? last.o : null;
  }
  /** When set for a role, that role's next ready() rejects with it (once). */
  readyError: Partial<Record<Role, unknown>> = {};
  /** When set for a role, every funds() of that role rejects with it until cleared (a dead party). */
  fundsError: Partial<Record<Role, unknown>> = {};
  /**
   * The relay closed the trade for this role (close code, e.g. 4404 at trade end): settles reject
   * with TransportClosedError, a new party's ready() rejects with it, and funds() keeps reading,
   * which is the party contract (packages/escrow/test/funds-after-relay.test.ts).
   */
  relayClosed: Partial<Record<Role, number>> = {};
  closeRelay(role: Role, code = 4404): void {
    this.relayClosed[role] = code;
    for (const p of this.pending.filter((x) => x.role === role)) p.reject(new TransportClosedError(code));
    this.pending = this.pending.filter((x) => x.role !== role);
  }
  runParty = (args: PartyArgs): PartyHandle => {
    this.calls.push({ role: args.role, args });
    // Saved like a real party's first save; a run stopped at once refuses it (no writes after stop).
    args.store.save({ v: 1, session: { v: 1, keys: 'k', cache: 'c' }, guard: { trade: args.trade, seen: {} }, seq: 1, step: 'msig.prepare:0', address: null, sent: {}, received: {}, release: null }).catch(() => undefined);
    const committedBuilder = this.noCommittedBuilder.has(args.role)
      ? {}
      : { committedBuilder: (): Role | null => this.committedBuilders[args.role] ?? null, acceptedOutcome: (): Outcome | null => this.accepted[args.role] ?? null };
    return {
      ...committedBuilder,
      ready: async () => {
        if (this.readyError[args.role] !== undefined) {
          const e = this.readyError[args.role];
          delete this.readyError[args.role];
          throw e;
        }
        const closed = this.relayClosed[args.role];
        if (closed !== undefined) throw new TransportClosedError(closed);
        return ESCROW_ADDRESS;
      },
      settle: (o) => {
        this.settles.push({ role: args.role, o });
        if (!this.acceptHeld.has(args.role)) this.accepted[args.role] = o;
        const closed = this.relayClosed[args.role];
        if (closed !== undefined) return Promise.reject(new TransportClosedError(closed));
        return new Promise((resolve, reject) => this.pending.push({ role: args.role, o, resolve, reject }));
      },
      // The runtime never calls these: the escrow party sends its post-release info to the mod itself (Task 9 I/O).
      spendInfo: async () => {
        throw new Error('not used by the runtime');
      },
      importSpendInfo: async () => {
        throw new Error('not used by the runtime');
      },
      funds: async () => {
        const n = (this.reads[args.role] = (this.reads[args.role] ?? 0) + 1);
        const f = structuredClone(this.fundsFor[args.role] ?? this.funds);
        for (const w of this.tickWaiters.splice(0)) {
          if (w.role === args.role && n >= w.want) setTimeout(w.resolve, 0); // after this tick has used the reading
          else this.tickWaiters.push(w);
        }
        const err = this.fundsError[args.role];
        if (err !== undefined) throw err;
        return f;
      },
      stop: async () => {
        for (const p of this.pending.filter((x) => x.role === args.role)) p.reject(Object.assign(new Error('stopped'), { code: 'stopped' }));
      },
    };
  };
}

export const engine = {} as EscrowEngine;

export interface ApiState {
  identities: Partial<Record<'buyer' | 'seller', { signPublic: string; boxPublic: string; proof: string }>>;
  view: Record<string, unknown>;
  /** Replaces the attestation the API serves (for the mismatch tests). */
  tamper?: (a: Attestation) => Attestation;
  resign?: Uint8Array;
  /** Final 409 answers of the Task 8 routes: `identity-conflict` on register, `attestation-refused` or `trade-closed` on fetch. */
  refuse?: { identity?: 'identity-conflict'; attestation?: 'attestation-refused' | 'trade-closed' };
  /** Per-role fields laid over the view (a lying API telling each side something else). */
  roleView?: Partial<Record<'buyer' | 'seller', Record<string, unknown>>>;
  /**
   * The attestation's issuedAt. Default: the clock of the device it is served to, at its identity
   * registration (the moderation service attests after both registered, so never before either
   * identity was made). Per device, as tests may give the two devices different clocks.
   */
  issuedAt?: string;
}

export function tradeView(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: CODE,
    state: 'setup',
    poster: 'seller',
    amountAtomic: AMOUNT.toString(),
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    maxFiatCents: '50000',
    settling: null,
    paidAt: null,
    // The time to pay the API sends with every trade (owner p9-6); the attestation below signs the same.
    payWindowMin: 90,
    methodId: METHOD_ID,
    // The locked text the attestation signs (review M1: once secured, a view must carry it).
    paymentInstructions: INSTRUCTIONS,
    ...over,
  };
}

/** The participants the API would attest, with a mod identity of its own. */
export async function makeApi(mod: { publicHex: string; secret: Uint8Array }, state: ApiState) {
  const modId = await testIdentity();
  /** Each device's clock (ms) at its identity registration (device() reports it). */
  const registeredAt: Partial<Record<'buyer' | 'seller', number>> = {};
  const attest = async (role: 'buyer' | 'seller'): Promise<{ attestation: Attestation; sig: string } | null> => {
    const { buyer, seller } = state.identities;
    if (!buyer || !seller) return null;
    const participants: Participants = {
      buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic },
      seller: { signPublic: seller.signPublic, boxPublic: seller.boxPublic },
      mod: { signPublic: modId.signPublic, boxPublic: modId.boxPublic },
    };
    const d = confirmedFor('buyer').deal;
    let a: Attestation = {
      v: 1,
      trade: CODE,
      channels: { escrow: await channelFor(CODE, 'escrow'), signals: await channelFor(CODE, 'signals') },
      participants,
      issuedAt: state.issuedAt ?? new Date(registeredAt[role] ?? Date.parse('2026-10-23T12:00:00.000Z')).toISOString(),
      terms: {
        deal: {
          poster: d.poster, takeAmountAtomic: d.takeAmountAtomic.toString(), currency: d.currency, centsPerXmr: d.centsPerXmr.toString(), maxFiatCents: d.maxFiatCents.toString(),
          methodId: METHOD_ID, instructionsSha256: await instructionsSha256(INSTRUCTIONS),
        },
        payWindowMin: 90,
        buyerPayout: ADDR.buyer,
        sellerRefund: ADDR.seller,
      },
    };
    if (state.tamper) a = state.tamper(a);
    return { attestation: a, sig: signAttestation(a, state.resign ?? mod.secret) };
  };
  const forRole = (role: 'buyer' | 'seller') => ({
    getTrade: async () => ({ ...state.view, role, ...(state.roleView?.[role] ?? {}) }),
    registerIdentity: async (_code: string, body: { signPublic: string; boxPublic: string; proof: string }) => {
      if (state.refuse?.identity) throw Object.assign(new Error('api 409'), { status: 409, code: state.refuse.identity });
      state.identities[role] ??= body;
    },
    /** The registering device's clock, as device() reports it before each registration. */
    clockAt: (ms: number) => {
      registeredAt[role] = ms;
    },
    getAttestation: async () => {
      if (state.refuse?.attestation) throw Object.assign(new Error('api 409'), { status: 409, code: state.refuse.attestation });
      return attest(role);
    },
  });
  return { modId, forRole };
}

/** What the user confirmed on the take / accept screen in these tests. */
export function confirmedFor(role: 'buyer' | 'seller', over: Partial<ConfirmedTrade['deal']> = {}): ConfirmedTrade {
  return { role, ownAddress: ADDR[role], deal: { poster: 'seller', takeAmountAtomic: AMOUNT, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n, ...over } };
}

export interface Device {
  role: 'buyer' | 'seller';
  /** The runtime's own start, without the default confirmation. */
  rawStart: EscrowRuntime['start'];
  store: EscrowStore;
  idb: IDBFactory;
  runtime: EscrowRuntime;
  statuses: EscrowStatus[];
  last(): EscrowStatus | undefined;
  /** Resolves with the first status (the latest one, or a later one) that matches; event-driven, no polling. */
  status(pred: (s: EscrowStatus) => boolean): Promise<EscrowStatus>;
}

export async function device(
  role: 'buyer' | 'seller',
  o: {
    api: ReturnType<Awaited<ReturnType<typeof makeApi>>['forRole']>;
    hub: Hub;
    parties: Parties;
    modPublic: string;
    idb?: IDBFactory;
    lock?: (n: string, fn: () => Promise<void>) => Promise<void>;
    /** The device clock (ms). */
    now?: () => number;
    settledElsewhereMs?: number;
  },
): Promise<Device> {
  const idb = o.idb ?? new IDBFactory();
  const store = await openEscrowStore({ indexedDB: idb });
  const statuses: EscrowStatus[] = [];
  const waiters: { pred: (s: EscrowStatus) => boolean; resolve: (s: EscrowStatus) => void }[] = [];
  const onStatus = (s: EscrowStatus): void => {
    statuses.push(s);
    for (const w of waiters.splice(0)) {
      if (w.pred(s)) w.resolve(s);
      else waiters.push(w);
    }
  };
  const status = (pred: (s: EscrowStatus) => boolean): Promise<EscrowStatus> => {
    const now = statuses.at(-1);
    if (now && pred(now)) return Promise.resolve(now);
    return new Promise((resolve) => waiters.push({ pred, resolve }));
  };
  const clock = o.now ?? (() => Date.now());
  const api = {
    ...o.api,
    registerIdentity: async (code: string, body: { signPublic: string; boxPublic: string; proof: string }) => {
      o.api.clockAt(clock());
      return o.api.registerIdentity(code, body);
    },
  };
  const runtime = createEscrowRuntime({
    api,
    store,
    config: { modSigningPublic: o.modPublic, feeWallet: FEE_WALLET, relayUrl: 'ws://relay.test', daemonUri: 'http://node.test' },
    engine,
    newIdentity: testIdentity,
    runParty: o.parties.runParty,
    transport: o.hub.transport,
    lock: o.lock ?? ((_n, fn) => fn()),
    pollMs: 5,
    ...(o.now ? { now: o.now } : {}),
    ...(o.settledElsewhereMs !== undefined ? { settledElsewhereMs: o.settledElsewhereMs } : {}),
    onStatus: (_c, s) => onStatus(s),
  });
  const rawStart = runtime.start.bind(runtime);
  runtime.start = (code, confirmed) => rawStart(code, confirmed ?? confirmedFor(role));
  return { role, rawStart, store, idb, runtime, statuses, last: () => statuses.at(-1), status };
}

export async function until(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function funded(poster: 'seller' | 'buyer' = 'seller', extra = 0n): Funds {
  const b = escrowPlan({ amountAtomic: AMOUNT, poster }).sellerFundsAtomic + extra;
  return { balance: b, unlocked: b, incoming: [{ txHash: 'aa', amountAtomic: b, confirmations: 12, unlocked: true }] };
}

export const json = (x: unknown): string => canonicalJson(JSON.parse(JSON.stringify(x, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))));
