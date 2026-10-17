import { ROLES, type Role } from '@x2f/core';
import {
  ProtocolError,
  ReplayGuard,
  canonicalJson,
  open,
  seal,
  type Identity,
  type Participants,
  type ReplayGuardJSON,
} from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import type { EscrowEngine, EscrowSession, Payout, SavedSession } from './engine.js';
import type { Transport } from './transport.js';

/** How a trade's escrow is paid out: `builder` builds, `cosigner` checks and signs. */
export interface Outcome {
  kind: 'release';
  to: Payout[];
  builder: Role;
  cosigner: Role;
}

export type PartyErrorCode = 'equivocation' | 'address-mismatch' | 'bad-outcome' | 'stopped';

export class PartyError extends Error {
  constructor(readonly code: PartyErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PartyError';
  }
}

interface Received {
  payload: Record<string, unknown>;
  digest: string;
}

interface ReleaseState {
  /** Digest of the outcome this party agreed to settle; a different one is refused. */
  outcome: string;
  phase: 'export' | 'built' | 'cosigning' | 'done';
  txSet?: string;
  txHash?: string;
}

/** Everything a party needs to resume; saved before it acts on or sends anything. */
export interface PartyState {
  v: 1;
  session: SavedSession;
  guard: ReplayGuardJSON;
  seq: number;
  /** The setup message this party has sent and is waiting on peers for. */
  step: string;
  address: string | null;
  sent: Record<string, Record<string, unknown>>;
  received: Record<string, Partial<Record<Role, Received>>>;
  release: ReleaseState | null;
}

export interface PartyStore {
  load(): Promise<PartyState | null>;
  save(s: PartyState): Promise<void>;
}

export interface PartyHandle {
  /** The escrow address, once all three parties have set up and confirmed the same one. */
  ready(): Promise<string>;
  /** Settle the escrow. Resolves with the tx hash for the co-signer, null for the others. */
  settle(o: Outcome): Promise<string | null>;
  stop(): Promise<void>;
}

export interface PartyArgs {
  role: Role;
  trade: string;
  me: Identity;
  /** Fixed at trade creation from a source outside the protocol messages. */
  participants: Participants;
  transport: Transport;
  engine: EscrowEngine;
  daemonUri: string;
  password: string;
  store: PartyStore;
}

const PREPARE = 'msig.prepare:0';
const MAKE = 'msig.make:1';
const ADDR = 'msig.addr:0';
const EXPORT = 'state.export:0';
const TXSET = 'release.txset:0';
const DONE = 'release.done:0';

function digestOf(key: string, payload: Record<string, unknown>): string {
  return sodium.to_hex(sodium.crypto_generichash(32, canonicalJson({ key, payload }), null));
}

function outcomeDigest(o: Outcome): string {
  return digestOf('outcome', {
    builder: o.builder,
    cosigner: o.cosigner,
    to: o.to.map((p) => ({ address: p.address, amount: p.amountAtomic.toString() })),
  });
}

/** The setup step after `key`; kex rounds count up from 2 until the wallets report ready. */
function nextSetupKey(key: string): string {
  if (key === PREPARE) return MAKE;
  if (key === MAKE) return 'msig.kex:2';
  const [type, n] = key.split(':') as [string, string];
  if (type === 'msig.kex') return `msig.kex:${Number(n) + 1}`;
  return ADDR;
}

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const MAX_KEX_ROUND = 12;
const KEX = /^msig\.kex:(\d{1,2})$/;

/** Only known message keys with the fields they need; anything else is ignored. */
function wellFormed(p: Record<string, unknown>): boolean {
  const str = (k: string): boolean => typeof p[k] === 'string';
  const key = p.key as string;
  const kex = KEX.exec(key);
  if (kex) {
    const n = Number(kex[1]);
    return n >= 2 && n <= MAX_KEX_ROUND && str('hex') && isPlainRecord(p.echo);
  }
  switch (key) {
    case PREPARE:
      return str('hex');
    case MAKE:
      return str('hex') && isPlainRecord(p.echo);
    case ADDR:
      return str('address') && str('prev') && isPlainRecord(p.echo);
    case EXPORT:
      return str('hex');
    case TXSET:
      return str('txSet');
    case DONE:
      return str('txHash');
    default:
      return false;
  }
}

/**
 * Runs one party's side of a trade's escrow over the relay (strict state machine, R11).
 *
 * Setup: prepare → make → kex rounds → addr. Each message goes to both peers in ONE
 * envelope and echoes the digests of the previous step's messages from the other two, so a
 * party that sends different content to different peers is caught (equivocation) before
 * anyone advances. All three confirm the same escrow address before ready() resolves.
 *
 * Settlement: builder and co-signer swap fresh multisig state, the builder sends one tx set,
 * the co-signer checks and signs it. A built tx set and a set being co-signed are saved
 * before they leave the device; after a restart the same set is resent or re-signed, never a
 * new one, so signing nonces are never reused on a different message (R26).
 *
 * Every incoming envelope is opened (signature, participants, replay) and ignored if that
 * fails. State is saved before acting; messages lost by the at-most-once relay are resent,
 * re-sealed with a new seq, after a reconnect or restart.
 */
export function runParty(a: PartyArgs): PartyHandle {
  const peers = ROLES.filter((r) => r !== a.role);
  let state!: PartyState;
  let session!: EscrowSession;
  let guard!: ReplayGuard;
  let stopped = false;
  let failure: Error | null = null;
  let chain: Promise<void> = Promise.resolve();

  let readyResolve!: (addr: string) => void;
  let readyReject!: (e: unknown) => void;
  const readyP = new Promise<string>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  readyP.catch(() => undefined);
  let settleWaiter: { resolve: (v: string | null) => void; reject: (e: unknown) => void } | null = null;
  let settleOutcome: Outcome | null = null;

  const fail = (e: Error): void => {
    if (failure) return;
    failure = e;
    readyReject(e);
    settleWaiter?.reject(e);
  };

  /** Serialise all work, so session calls and state changes never interleave. */
  const run = (fn: () => Promise<void>): Promise<void> => {
    chain = chain.then(async () => {
      if (stopped || failure) return;
      try {
        await fn();
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
    return chain;
  };

  const persist = async (): Promise<void> => {
    state.session = await session.save();
    state.guard = guard.toJSON();
    await a.store.save(structuredClone(state));
  };

  const send = async (key: string, to: readonly Role[]): Promise<void> => {
    const payload = state.sent[key];
    if (!payload) return;
    const [type] = key.split(':') as [string];
    state.seq += 1;
    await a.store.save(structuredClone(state));
    const e = await seal({ trade: a.trade, from: a.role, seq: state.seq, type, payload: { key, ...payload }, to, me: a.me, participants: a.participants });
    a.transport.send(e);
  };

  const recipientsFor = (key: string): readonly Role[] => {
    if (key === EXPORT || key === TXSET) {
      const o = settleOutcome;
      if (!o) return [];
      return [a.role === o.builder ? o.cosigner : o.builder];
    }
    return peers;
  };

  /** Resend everything still awaited: the current setup step and any settlement messages. */
  const resendPending = async (): Promise<void> => {
    if (!state.address) await send(state.step, peers);
    else if (!state.received[ADDR] || peers.some((p) => !state.received[ADDR]?.[p])) await send(ADDR, peers);
    for (const key of [EXPORT, TXSET, DONE]) if (state.sent[key]) await send(key, key === DONE ? peers : recipientsFor(key));
  };

  const echoFor = (prevKey: string): Record<string, string> => {
    const echo: Record<string, string> = {};
    for (const p of peers) echo[p] = state.received[prevKey]?.[p]?.digest ?? '';
    return echo;
  };

  const prevKeyOf = (key: string): string => {
    if (key === MAKE) return PREPARE;
    if (key === ADDR) return state.step; // the last kex step before the wallets were ready
    const n = Number(key.split(':')[1]);
    return n === 2 ? MAKE : `msig.kex:${n - 1}`;
  };

  /** A peer's step message must echo what it got from me and from the third party. */
  const checkEcho = (key: string, from: Role, payload: Record<string, unknown>): void => {
    if (key === PREPARE) return;
    const prevKey = prevKeyOf(key);
    if (key === ADDR && payload.prev !== prevKey) throw new PartyError('equivocation', `${from} finished setup at another step`);
    const echo = payload.echo;
    if (!isPlainRecord(echo)) throw new PartyError('equivocation', 'missing echo');
    const mine = state.sent[prevKey];
    if (!mine || echo[a.role] !== digestOf(prevKey, mine)) throw new PartyError('equivocation', `${from} saw a different message from me`);
    const third = peers.find((p) => p !== from)!;
    const theirs = state.received[prevKey]?.[third];
    if (!theirs || echo[third] !== theirs.digest) throw new PartyError('equivocation', `${third} sent different messages`);
  };

  const peerHex = (key: string): string[] => peers.map((p) => String(state.received[key]![p]!.payload.hex));

  /** Advance setup while every peer's message for the current step is in. */
  const advanceSetup = async (): Promise<void> => {
    while (!state.address) {
      const key = state.step;
      const got = state.received[key];
      if (!got || peers.some((p) => !got[p])) return;
      for (const p of peers) checkEcho(key, p, got[p]!.payload);
      const echo = echoFor(key);
      let next: string;
      let out: Record<string, unknown>;
      if (key === PREPARE) {
        next = MAKE;
        out = { hex: await session.make(peerHex(PREPARE)), echo };
      } else {
        const r = await session.exchange(peerHex(key));
        if (r.ready) {
          state.address = await session.address();
          next = ADDR;
          out = { address: state.address, prev: key, echo };
        } else {
          next = nextSetupKey(key);
          out = { hex: r.hex, echo };
        }
      }
      state.sent[next] = out;
      if (next !== ADDR) state.step = next;
      await persist();
      await send(next, peers);
    }
    await checkAddresses();
  };

  const checkAddresses = async (): Promise<void> => {
    const got = state.received[ADDR];
    if (!state.address || !got || peers.some((p) => !got[p])) return;
    for (const p of peers) {
      checkEcho(ADDR, p, got[p]!.payload);
      if (got[p]!.payload.address !== state.address) throw new PartyError('address-mismatch', `${p} reports another escrow address`);
    }
    readyResolve(state.address);
    if (settleOutcome && !state.release) await startRelease(settleOutcome);
    else await advanceRelease();
  };

  const advanceRelease = async (): Promise<void> => {
    const o = settleOutcome;
    const rel = state.release;
    if (!o || !rel || !state.address) return;
    const counterpart = a.role === o.builder ? o.cosigner : o.builder;
    if (a.role === o.builder) {
      if (rel.phase === 'export' && state.received[EXPORT]?.[counterpart]) {
        await session.importState([String(state.received[EXPORT][counterpart]!.payload.hex)]);
        const { txSet } = await session.buildRelease(o.to);
        rel.phase = 'built';
        rel.txSet = txSet;
        state.sent[TXSET] = { txSet };
        await persist(); // the set is saved before it leaves the device
        await send(TXSET, [counterpart]);
      }
      if (state.received[DONE]?.[counterpart]) {
        rel.phase = 'done';
        rel.txHash = String(state.received[DONE][counterpart]!.payload.txHash);
        await persist();
        settleWaiter?.resolve(null);
      }
      return;
    }
    // Co-signer.
    if (rel.phase === 'done') {
      settleWaiter?.resolve(rel.txHash ?? null);
      return;
    }
    const txMsg = state.received[TXSET]?.[counterpart];
    const exp = state.received[EXPORT]?.[counterpart];
    if (rel.phase === 'export' && txMsg && exp) {
      await session.importState([String(exp.payload.hex)]);
      rel.phase = 'cosigning';
      rel.txSet = String(txMsg.payload.txSet);
      await persist(); // never sign any other set for this trade
    }
    if (rel.phase === 'cosigning' && rel.txSet) {
      const txHash = await session.cosign(rel.txSet, o.to);
      rel.phase = 'done';
      rel.txHash = txHash;
      state.sent[DONE] = { txHash };
      await persist();
      await send(DONE, peers);
      settleWaiter?.resolve(txHash);
    }
  };

  const startRelease = async (o: Outcome): Promise<void> => {
    if (!state.address || peers.some((p) => !state.received[ADDR]?.[p])) return; // resumes once ready
    const digest = outcomeDigest(o);
    if (state.release) {
      if (state.release.outcome !== digest) throw new PartyError('bad-outcome', 'a different outcome is already being settled');
    } else {
      state.release = { outcome: digest, phase: 'export' };
      await session.sync();
      state.sent[EXPORT] = { hex: await session.exportState() };
      await persist(); // the export's nonces are saved with the wallet before they are sent
    }
    if (state.release.phase === 'export') await send(EXPORT, recipientsFor(EXPORT));
    await advanceRelease();
  };

  /** Accept a peer message once per (sender, key); a different copy is equivocation. */
  const onMessage = async (raw: unknown): Promise<void> => {
    let opened;
    try {
      opened = await open(raw, { me: a.me, myRole: a.role, participants: a.participants, trade: a.trade, guard });
    } catch (e) {
      if (e instanceof ProtocolError) return; // forged, replayed, not for me: ignore
      throw e;
    }
    const from = (raw as { from: Role }).from;
    const p = opened.payload;
    if (!isPlainRecord(p) || typeof p.key !== 'string' || p.key.split(':')[0] !== opened.type || !wellFormed(p)) return;
    const { key, ...payload } = p;
    const digest = digestOf(key, payload);
    const slot = (state.received[key] ??= {});
    const seen = slot[from];
    if (seen) {
      if (seen.digest !== digest) throw new PartyError('equivocation', `${from} sent two versions of ${key}`);
      state.guard = guard.toJSON();
      await a.store.save(structuredClone(state));
      return;
    }
    slot[from] = { payload, digest };
    state.guard = guard.toJSON();
    await a.store.save(structuredClone(state)); // saved before acting on it
    if (!state.address) await advanceSetup();
    else if (key === ADDR) await checkAddresses();
    else await advanceRelease();
  };

  const loop = async (): Promise<void> => {
    while (!stopped && !failure) {
      let raw: unknown;
      try {
        raw = await a.transport.next();
      } catch (e) {
        if (!stopped) fail(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      await run(() => onMessage(raw));
    }
  };

  void run(async () => {
    await sodium.ready;
    const saved = await a.store.load();
    if (saved) {
      state = saved;
      session = await a.engine.resume(saved.session, { daemonUri: a.daemonUri, password: a.password });
      guard = ReplayGuard.from(saved.guard);
    } else {
      session = await a.engine.create({ daemonUri: a.daemonUri, password: a.password });
      guard = new ReplayGuard(a.trade);
      state = {
        v: 1,
        session: await session.save(),
        guard: guard.toJSON(),
        seq: 0,
        step: PREPARE,
        address: null,
        sent: { [PREPARE]: { hex: await session.prepare() } },
        received: {},
        release: null,
      };
      await persist();
    }
    a.transport.onReconnect(() => void run(resendPending));
    await resendPending();
    if (!state.address) await advanceSetup();
    else await checkAddresses();
  });
  void loop();

  return {
    ready: () => readyP,
    settle(o) {
      if (!o.to.length || o.builder === o.cosigner || !ROLES.includes(o.builder) || !ROLES.includes(o.cosigner)) {
        return Promise.reject(new PartyError('bad-outcome'));
      }
      if (a.role !== o.builder && a.role !== o.cosigner) return Promise.resolve(null);
      settleOutcome = o;
      const p = new Promise<string | null>((resolve, reject) => {
        settleWaiter = { resolve, reject };
      });
      if (failure) settleWaiter?.reject(failure);
      void run(() => startRelease(o));
      return p;
    },
    async stop() {
      stopped = true;
      a.transport.close();
      await chain;
      fail(new PartyError('stopped'));
      await session?.close().catch(() => undefined);
    },
  };
}
