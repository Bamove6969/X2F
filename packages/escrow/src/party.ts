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
import { EscrowError, type EscrowEngine, type EscrowSession, type Payout, type SavedSession } from './engine.js';
import type { Transport } from './transport.js';
import { sumPayouts } from './verify.js';

/** How a trade's escrow is paid out: `builder` builds, `cosigner` checks and signs. */
export interface Outcome {
  kind: 'release';
  to: Payout[];
  builder: Role;
  cosigner: Role;
}

export type PartyErrorCode = 'equivocation' | 'address-mismatch' | 'bad-outcome' | 'bad-state' | 'stopped';

export class PartyError extends Error {
  constructor(readonly code: PartyErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PartyError';
  }
}

interface Received {
  payload: Record<string, string | Record<string, string>>;
  digest: string;
}

type ReleasePhase = 'waiting-funds' | 'export' | 'built' | 'cosigning' | 'signed' | 'done';

interface ReleaseState {
  /** Digest of the outcome being settled. */
  outcome: string;
  part: 'builder' | 'cosigner';
  counterpart: Role;
  /** Each failed build or check starts a new attempt with a fresh export (fresh nonces). */
  attempt: number;
  phase: ReleasePhase;
  txSet?: string;
  signedHex?: string;
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
  sent: Record<string, Record<string, string | Record<string, string>>>;
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
  /**
   * Settle the escrow once it is funded and fully unlocked. Resolves with the tx hash for
   * the co-signer, null for the others. A later call with another outcome replaces this
   * one (the earlier promise rejects) unless this party has already signed.
   */
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
  /** How often to re-check funds and progress; also the first resend delay. Default 3 s. */
  resendMs?: number;
  /** Resends back off exponentially up to this, and restart at resendMs on progress. Default 60 s. */
  resendMaxMs?: number;
  /** Told about every ignored envelope or message, with a reason (no contents). */
  onIgnored?: (reason: string) => void;
}

const PREPARE = 'msig.prepare:0';
const MAKE = 'msig.make:1';
const ADDR = 'msig.addr:0';
/** "I have checked all three addresses": nobody funds until both peers confirm too. */
const READY = 'msig.ready:0';
const MAX_KEX_ROUND = 12;
const MAX_ATTEMPT = 20;
const KEX = /^msig\.kex:(\d{1,2})$/;
const RELEASE_KEY = /^(state\.export|release\.txset|release\.done):(\d{1,2})$/;
const exportKey = (n: number): string => `state.export:${n}`;
const txSetKey = (n: number): string => `release.txset:${n}`;
const DONE = 'release.done:0';

function digestOf(key: string, payload: unknown): string {
  return sodium.to_hex(sodium.crypto_generichash(32, canonicalJson({ key, payload }), null));
}

function outcomeDigest(o: Outcome): string {
  return digestOf('outcome', {
    builder: o.builder,
    cosigner: o.cosigner,
    to: o.to.map((p) => ({ address: p.address, amount: p.amountAtomic.toString() })),
  });
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function exactStrings(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => typeof o[k] === 'string');
}

/**
 * Only known message keys with exactly the fields they need, all strings (echo: a map of
 * the two other roles to digests). Anything else is ignored, never fatal.
 */
function wellFormed(p: Record<string, unknown>, from: Role): boolean {
  const key = p.key;
  if (typeof key !== 'string') return false;
  const echoOk = (): boolean => {
    const e = p.echo;
    return isRecord(e) && exactStrings(e, ROLES.filter((r) => r !== from));
  };
  const kex = KEX.exec(key);
  if (kex) {
    const n = Number(kex[1]);
    return n >= 2 && n <= MAX_KEX_ROUND && Object.keys(p).length === 3 && typeof p.hex === 'string' && echoOk();
  }
  if (key === PREPARE) return exactStrings(p, ['key', 'hex']);
  if (key === MAKE) return Object.keys(p).length === 3 && typeof p.hex === 'string' && echoOk();
  if (key === ADDR) return Object.keys(p).length === 4 && typeof p.address === 'string' && typeof p.prev === 'string' && echoOk();
  if (key === READY) return exactStrings(p, ['key', 'address']);
  const rel = RELEASE_KEY.exec(key);
  if (!rel || Number(rel[2]) > MAX_ATTEMPT) return false;
  if (rel[1] === 'state.export') return exactStrings(p, ['key', 'hex']);
  if (rel[1] === 'release.txset') return exactStrings(p, ['key', 'txSet']);
  return key === DONE && exactStrings(p, ['key', 'txHash']);
}

const isSetupKey = (key: string): boolean => key === PREPARE || key === MAKE || key === ADDR || key === READY || KEX.test(key);
const RETRYABLE = new Set(['bad-payouts', 'not-ready', 'payout-mismatch']);

/**
 * Runs one party's side of a trade's escrow over the relay (strict state machine, R11).
 *
 * Setup: prepare → make → kex rounds → addr. Each message goes to both peers in ONE
 * envelope and echoes the digests of the previous step's messages from the other two, so a
 * party that sends different content to different peers is caught (equivocation) before
 * anyone advances. Each party checks all three addresses, then confirms (msig.ready); ready()
 * resolves only once both peers have confirmed too, so nobody funds an escrow that one of the
 * others could not settle. After that, setup messages are ignored.
 *
 * Settlement waits until the escrow is funded, fully unlocked and matches the outcome. The
 * builder and co-signer swap fresh multisig state, the builder sends one tx set, the
 * co-signer checks and signs it. Anything that fails before a signature starts a new attempt
 * with a fresh export. Exports, built sets, the set being signed and the signed tx are saved
 * before they leave the device; after a restart the same ones are resent or re-signed, never
 * new ones, so signing nonces are never reused on a different message (R26). A broadcast
 * whose result is unknown is resubmitted until the daemon has seen the tx.
 *
 * Every incoming envelope is opened (signature, participants, replay); failures are ignored.
 * State is saved before acting. Unanswered messages are resent on a timer and after any
 * reconnect, re-sealed with a new seq, because the relay delivers at most once.
 */
export function runParty(a: PartyArgs): PartyHandle {
  const peers = ROLES.filter((r) => r !== a.role);
  const ignored = a.onIgnored ?? (() => {});
  let state!: PartyState;
  let session!: EscrowSession;
  let guard!: ReplayGuard;
  let stopped = false;
  let failure: Error | null = null;
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;

  let readyResolve!: (addr: string) => void;
  let readyReject!: (e: unknown) => void;
  const readyP = new Promise<string>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  readyP.catch(() => undefined);
  let isReady = false;
  let settleOutcome: Outcome | null = null;
  let settleWaiter: { resolve: (v: string | null) => void; reject: (e: unknown) => void } | null = null;

  const fail = (e: Error): void => {
    if (failure) return;
    failure = e;
    clearInterval(timer);
    readyReject(e);
    settleWaiter?.reject(e);
    a.transport.close();
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

  const saveState = (): Promise<void> => a.store.save(structuredClone(state));
  const persist = async (): Promise<void> => {
    state.session = await session.save();
    state.guard = guard.toJSON();
    await saveState();
  };

  const send = async (key: string, to: readonly Role[]): Promise<void> => {
    const payload = state.sent[key];
    if (!payload || to.length === 0) return;
    const [type] = key.split(':') as [string];
    state.seq += 1;
    await saveState();
    a.transport.send(await seal({ trade: a.trade, from: a.role, seq: state.seq, type, payload: { key, ...payload }, to, me: a.me, participants: a.participants }));
  };

  const prevKeyOf = (key: string): string => {
    if (key === MAKE) return PREPARE;
    if (key === ADDR) return state.step; // the last kex step before the wallets were ready
    const n = Number(key.split(':')[1]);
    return n === 2 ? MAKE : `msig.kex:${n - 1}`;
  };

  /** Peers that have sent a settlement message have clearly finished setup. */
  const pastSetup = (p: Role): boolean =>
    Object.keys(state.received).some((k) => !isSetupKey(k) && state.received[k]?.[p] !== undefined);

  /** Resend everything a peer may still be waiting for. Duplicates are ignored by peers. */
  const resend = async (): Promise<void> => {
    lastResend = Date.now();
    if (!state.address) {
      if (state.step !== PREPARE) await send(prevKeyOf(state.step), peers);
      await send(state.step, peers);
    } else if (!isReady) {
      await send(state.step, peers); // the final kex message, in case a peer lost it
      await send(ADDR, peers);
      await send(READY, peers);
    } else {
      await send(READY, peers.filter((p) => !pastSetup(p)));
    }
    const rel = state.release;
    if (!rel) return;
    if (rel.phase !== 'waiting-funds') await send(exportKey(rel.attempt), [rel.counterpart]);
    if (rel.part === 'builder' && rel.phase === 'built') await send(txSetKey(rel.attempt), [rel.counterpart]);
    if (rel.phase === 'done' && rel.part === 'cosigner') await send(DONE, [rel.counterpart]);
  };

  // Resends back off while nothing happens and restart quickly after progress.
  const baseMs = a.resendMs ?? 3000;
  const maxMs = a.resendMaxMs ?? 60_000;
  let resendDelay = baseMs;
  let nextResendAt = 0;
  let lastResend = 0;
  let tickQueued = false;
  const progressed = (): void => {
    resendDelay = baseMs;
    nextResendAt = Date.now() + baseMs;
  };

  // ── Setup ─────────────────────────────────────────────────────────────

  /** A peer's step message must echo what it got from me and from the third party. */
  const checkEcho = (key: string, from: Role, payload: Received['payload']): void => {
    if (key === PREPARE) return;
    const prevKey = prevKeyOf(key);
    if (key === ADDR && payload.prev !== prevKey) throw new PartyError('equivocation', `${from} finished setup at another step`);
    const echo = payload.echo as Record<string, string>;
    const mine = state.sent[prevKey];
    if (!mine || echo[a.role] !== digestOf(prevKey, mine)) throw new PartyError('equivocation', `${from} saw a different message from me`);
    const third = peers.find((p) => p !== from)!;
    const theirs = state.received[prevKey]?.[third];
    if (!theirs || echo[third] !== theirs.digest) throw new PartyError('equivocation', `${third} sent different messages to ${from} and me`);
  };

  const echoFor = (prevKey: string): Record<string, string> =>
    Object.fromEntries(peers.map((p) => [p, state.received[prevKey]?.[p]?.digest ?? '']));
  const peerHex = (key: string): string[] => peers.map((p) => String(state.received[key]![p]!.payload.hex));

  const advanceSetup = async (): Promise<void> => {
    while (!state.address) {
      const key = state.step;
      const got = state.received[key];
      if (!got || peers.some((p) => !got[p])) return;
      for (const p of peers) checkEcho(key, p, got[p]!.payload);
      const echo = echoFor(key);
      let next: string;
      let out: Record<string, string | Record<string, string>>;
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
          next = KEX.test(key) ? `msig.kex:${Number(key.split(':')[1]) + 1}` : 'msig.kex:2';
          if (Number(next.split(':')[1]) > MAX_KEX_ROUND) throw new PartyError('bad-state', 'multisig setup did not converge');
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

  /** Check all three addresses, confirm, and become ready once both peers have confirmed. */
  const checkAddresses = async (): Promise<void> => {
    const got = state.received[ADDR];
    if (isReady || !state.address || !got || peers.some((p) => !got[p])) return;
    if (!state.sent[READY]) {
      for (const p of peers) {
        checkEcho(ADDR, p, got[p]!.payload);
        if (got[p]!.payload.address !== state.address) throw new PartyError('address-mismatch', `${p} reports another escrow address`);
      }
      state.sent[READY] = { address: state.address };
      await saveState();
      await send(READY, peers);
    }
    const confirmed = state.received[READY];
    if (!confirmed || peers.some((p) => !confirmed[p])) return;
    for (const p of peers) {
      if (confirmed[p]!.payload.address !== state.address) throw new PartyError('address-mismatch', `${p} confirmed another escrow address`);
    }
    isReady = true;
    readyResolve(state.address);
  };

  // ── Settlement ────────────────────────────────────────────────────────

  /** Start a new attempt: drop this attempt's work; the next step exports afresh. */
  const nextAttempt = async (rel: ReleaseState, to = 0): Promise<void> => {
    rel.attempt = Math.max(rel.attempt + 1, to);
    if (rel.attempt > MAX_ATTEMPT) throw new PartyError('bad-state', 'too many settlement attempts');
    rel.phase = 'waiting-funds';
    delete rel.txSet;
    await saveState();
  };

  /** The escrow holds exactly what the outcome pays, all of it unlocked. */
  const fundsReady = async (o: Outcome): Promise<boolean> => {
    const { balance, unlocked } = await session.sync();
    return balance > 0n && balance === unlocked && sumPayouts(o.to) === balance;
  };

  /** Import the counterpart's export; garbage counts as a refused attempt, not a crash. */
  const importPeer = async (exp: Received): Promise<void> => {
    try {
      await session.importState([String(exp.payload.hex)]);
    } catch {
      throw new EscrowError('payout-mismatch', 'counterpart export could not be imported');
    }
  };

  /** The highest attempt the counterpart has exported for. */
  const counterpartAttempt = (cp: Role): number => {
    let n = 0;
    for (const k of Object.keys(state.received)) {
      const m = /^state\.export:(\d+)$/.exec(k);
      if (m && state.received[k]?.[cp]) n = Math.max(n, Number(m[1]));
    }
    return n;
  };

  const advanceRelease = async (): Promise<void> => {
    const o = settleOutcome;
    const rel = state.release;
    if (!o || !rel || !isReady || rel.outcome !== outcomeDigest(o)) return;
    const cp = rel.counterpart;
    const theirs = (key: string): Received | undefined => state.received[key]?.[cp];

    // The counterpart moved to a later attempt (e.g. it refused our set): follow, unless we signed.
    const ahead = counterpartAttempt(cp);
    if (ahead > rel.attempt && (rel.phase === 'waiting-funds' || rel.phase === 'export' || rel.phase === 'built')) {
      await nextAttempt(rel, ahead);
    }

    if (rel.phase === 'waiting-funds') {
      if (!(await fundsReady(o))) return;
      state.sent[exportKey(rel.attempt)] = { hex: await session.exportState() };
      rel.phase = 'export';
      await persist(); // the export's nonces are saved with the wallet before they are sent
      await send(exportKey(rel.attempt), [cp]);
    }

    if (rel.part === 'builder') {
      const exp = theirs(exportKey(rel.attempt));
      if (rel.phase === 'export' && exp) {
        try {
          await importPeer(exp);
          if (!(await fundsReady(o))) throw new EscrowError('not-ready');
          const { txSet } = await session.buildRelease(o.to);
          rel.phase = 'built';
          rel.txSet = txSet;
          state.sent[txSetKey(rel.attempt)] = { txSet };
          await persist(); // the set is saved before it leaves the device; never rebuilt
          await send(txSetKey(rel.attempt), [cp]);
        } catch (e) {
          if (!(e instanceof EscrowError) || !RETRYABLE.has(e.code)) throw e;
          ignored(`build-${e.code}`);
          await nextAttempt(rel);
        }
      }
      const done = theirs(DONE);
      if (rel.phase === 'built' && done) {
        rel.phase = 'done';
        rel.txHash = String(done.payload.txHash);
        await saveState();
      }
      if (rel.phase === 'done') settleWaiter?.resolve(null);
      return;
    }

    // Co-signer.
    const exp = theirs(exportKey(rel.attempt));
    const tx = theirs(txSetKey(rel.attempt));
    if (rel.phase === 'export' && exp && tx) {
      try {
        await importPeer(exp);
        await session.sync();
        // Check before committing to this set, so a garbage set cannot lock the outcome.
        await session.checkRelease(String(tx.payload.txSet), o.to);
      } catch (e) {
        if (!(e instanceof EscrowError) || !RETRYABLE.has(e.code)) throw e;
        ignored(`cosign-${e.code}`);
        await nextAttempt(rel);
        return;
      }
      rel.phase = 'cosigning';
      rel.txSet = String(tx.payload.txSet);
      await persist(); // from here on, never sign any other set for this trade
    }
    if (rel.phase === 'cosigning' && rel.txSet) {
      try {
        const { signedHex, txHash } = await session.signRelease(rel.txSet, o.to);
        rel.phase = 'signed';
        rel.signedHex = signedHex;
        rel.txHash = txHash;
        await persist();
      } catch (e) {
        // signRelease checks before it signs, so a refused set was never signed.
        if (!(e instanceof EscrowError) || !RETRYABLE.has(e.code)) throw e;
        ignored(`cosign-${e.code}`);
        await nextAttempt(rel);
        return;
      }
    }
    if (rel.phase === 'signed' && rel.signedHex && rel.txHash) {
      try {
        await session.submit(rel.signedHex);
      } catch {
        // Already broadcast (e.g. before a crash) or rejected: only the daemon knows.
        if (!(await session.txSeen(rel.txHash))) return; // retried on the next tick
      }
      rel.phase = 'done';
      state.sent[DONE] = { txHash: rel.txHash };
      await saveState();
      await send(DONE, [cp]);
    }
    if (rel.phase === 'done') settleWaiter?.resolve(rel.txHash ?? null);
  };

  const beginRelease = async (o: Outcome): Promise<void> => {
    const digest = outcomeDigest(o);
    const rel = state.release;
    if (rel && rel.outcome === digest) return;
    // A built set carries this party's partial signature, so it counts as signed too.
    if (rel && (rel.phase === 'built' || rel.phase === 'cosigning' || rel.phase === 'signed' || rel.phase === 'done')) {
      throw new PartyError('bad-outcome', 'already signed for another outcome');
    }
    const part = a.role === o.builder ? 'builder' : 'cosigner';
    state.release = {
      outcome: digest,
      part,
      counterpart: part === 'builder' ? o.cosigner : o.builder,
      attempt: rel ? rel.attempt + 1 : 1,
      phase: 'waiting-funds',
    };
    await saveState();
  };

  // ── Incoming ──────────────────────────────────────────────────────────

  /** Accept a peer message once per (sender, key); during setup a different copy is fatal. */
  const onMessage = async (raw: unknown): Promise<void> => {
    let opened;
    try {
      opened = await open(raw, { me: a.me, myRole: a.role, participants: a.participants, trade: a.trade, guard });
    } catch (e) {
      if (e instanceof ProtocolError) {
        ignored(e.code);
        return;
      }
      throw e;
    }
    const from = (raw as { from: Role }).from;
    const p = opened.payload;
    if (!isRecord(p) || !wellFormed(p, from) || (p.key as string).split(':')[0] !== opened.type) {
      ignored('malformed');
      return;
    }
    const { key: k, ...rest } = p;
    const key = k as string;
    const payload = rest as Received['payload'];
    if (isSetupKey(key) && isReady) {
      ignored('setup-after-ready');
      return;
    }
    if (!isSetupKey(key) && state.release && from !== state.release.counterpart) {
      ignored('not-counterpart');
      return;
    }
    const digest = digestOf(key, payload);
    const slot = (state.received[key] ??= {});
    const seen = slot[from];
    if (seen) {
      if (seen.digest !== digest && isSetupKey(key)) throw new PartyError('equivocation', `${from} sent two versions of ${key}`);
      ignored('duplicate');
      return;
    }
    slot[from] = { payload, digest };
    state.guard = guard.toJSON();
    await saveState(); // saved before acting on it
    progressed();
    await advance();
  };

  const advance = async (): Promise<void> => {
    if (!state.address) await advanceSetup();
    else await checkAddresses();
    if (settleOutcome && isReady) {
      await beginRelease(settleOutcome);
      await advanceRelease();
    }
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
      if (saved.v !== 1) throw new PartyError('bad-state', 'unknown saved state version');
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
    // Loss signals (reconnect, queue-full) resend at most once per base interval.
    a.transport.onReconnect(() => {
      if (Date.now() - lastResend >= baseMs) void run(resend);
    });
    timer = setInterval(() => {
      if (tickQueued) return; // a slow daemon call is still running; don't pile up ticks
      tickQueued = true;
      void run(async () => {
        try {
          if (Date.now() >= nextResendAt) {
            await resend();
            nextResendAt = Date.now() + resendDelay;
            resendDelay = Math.min(resendDelay * 2, maxMs);
          }
          await advance();
        } finally {
          tickQueued = false;
        }
      });
    }, baseMs);
    await resend();
    nextResendAt = Date.now() + resendDelay;
    await advance();
  });
  void loop();

  return {
    ready: () => readyP,
    settle(o) {
      if (!o.to.length || o.builder === o.cosigner || !ROLES.includes(o.builder) || !ROLES.includes(o.cosigner)) {
        return Promise.reject(new PartyError('bad-outcome'));
      }
      if (a.role !== o.builder && a.role !== o.cosigner) return Promise.resolve(null);
      if (failure) return Promise.reject(failure);
      let mine!: { resolve: (v: string | null) => void; reject: (e: unknown) => void };
      const p = new Promise<string | null>((resolve, reject) => {
        mine = { resolve, reject };
      });
      void run(async () => {
        const rel = state.release;
        const switching = rel !== null && rel.outcome !== outcomeDigest(o);
        if (switching && ['built', 'cosigning', 'signed', 'done'].includes(rel.phase)) {
          mine.reject(new PartyError('bad-outcome', 'already signed for another outcome')); // the earlier settle() keeps going
          return;
        }
        settleWaiter?.reject(new PartyError('bad-outcome', 'replaced by a later settle()'));
        settleWaiter = mine;
        settleOutcome = o;
        await advance();
      });
      return p;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      a.transport.close();
      await chain;
      fail(new PartyError('stopped'));
      await session?.close().catch(() => undefined);
    },
  };
}
