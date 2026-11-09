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
import { EscrowError, type EscrowEngine, type EscrowSession, type Incoming, type Outgoing, type Payout, type SavedSession } from './engine.js';
import type { Transport } from './transport.js';
import { MAX_NETWORK_FEE, sumPayouts } from './verify.js';

/** How a trade's escrow is paid out: `builder` builds, `cosigner` checks and signs. */
export interface Outcome {
  kind: 'release';
  to: Payout[];
  builder: Role;
  cosigner: Role;
}

export type PartyErrorCode = 'equivocation' | 'address-mismatch' | 'bad-outcome' | 'bad-state' | 'stopped' | 'settled-elsewhere';

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

/** 'superseded': this party's signed tx can never confirm because another tx emptied the escrow. */
type ReleasePhase = 'waiting-funds' | 'export' | 'built' | 'cosigning' | 'signed' | 'done' | 'exhausted' | 'superseded';

interface ReleaseState {
  /** Digest of the outcome being settled; its first 16 hex chars tag every release message. */
  outcome: string;
  part: 'builder' | 'cosigner';
  counterpart: Role;
  /** Per outcome: each failed build or check starts a new attempt with a fresh export. */
  attempt: number;
  /** Set once any tx set was built or received for this outcome; then it can't be switched. */
  committed?: boolean;
  phase: ReleasePhase;
  txSet?: string;
  /** Builder: the secret key of the tx in `txSet` (its wallet stores none), sent with spend.info (review I1). */
  txKey?: string;
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
  /**
   * Moderator only: the trade parties whose sealed post-release info (`spend.info`, or
   * `spend.claim` when theirs is too big to send) this party has received, in arrival order,
   * whether or not the import was refused (Task 9 I/O, lead decision b: the watcher reports
   * `release-claimed`). Saved before the import is tried. Absent in states saved before it.
   */
  claims?: Role[];
  /**
   * Moderator only (review M2): every in-block tx its wallet has ever shown as spending the escrow.
   * A later import replaces the wallet's composite key images and can make it forget a sweep it
   * showed; funds().outgoing is the union of these and the wallet's current view. Absent before.
   */
  shown?: Outgoing[];
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
  /**
   * The builder of the outcome this party is committed to (a tx set was built or received for it,
   * so it can no longer switch), or null. Read from the saved state, so it survives a restart. The
   * moderation watcher names its own tx's settlement kind from it (watcher revival re-verify R2).
   */
  committedBuilder?(): Role | null;
  /**
   * The escrow's balance and incoming payments, read inside the party's own work queue so
   * wallet calls never interleave. Watchers and apps read the escrow only through this. Still
   * answers after the relay connection ended for good (ready() and settle() reject with the
   * TransportClosedError): the wallet needs no peer. Rejects after a PartyError or stop().
   * `chainHeight` and `outgoing` (Task 9's watcher) come from the same sync when the engine
   * provides them (the Monero engine does). `spendClaims`, `ownTxs`, `spendProofs`: moderator only.
   */
  funds(): Promise<Funds>;
  /**
   * This party's post-release multisig info (hex), for the moderator, who takes no part in a
   * seller–buyer release and so cannot see that spend on its own (Task 9, lead decision A). The
   * party sends it to the moderator by itself (`spend.info`, below); this only reads it.
   * Only once this party's release is done (the co-signer submitted it, or the builder saw it in a
   * block); before that it rejects with PartyError('bad-state'), because a fresh export replaces the
   * signing nonces a release in progress depends on. Exported once and saved (with the wallet,
   * before it leaves); later calls return the same hex.
   */
  spendInfo(): Promise<string>;
  /**
   * Imports a peer's post-release multisig info (the moderator's side of spendInfo()), so this
   * wallet can compute the escrow's key images and its own outgoing view (funds().outgoing)
   * shows the spend. The import is NOT proof on its own (review I1): wallet2 adds the peer's
   * partial key images unchecked, and a trade party knows every partial but the mod's, so a forged
   * info can make the wallet attribute an unrelated in-block tx to the escrow. The watcher counts
   * such a sweep only once the tx key sent with spend.info proves the payouts (proveSweep). Rejects with
   * EscrowError('bad-spend-info') for anything that is not a well-formed export of this escrow
   * (not hex, over SPEND_INFO_MAX_HEX, another wallet, a bad signature), PartyError('bad-state')
   * before setup ended or while this party's own release is under way (an import replaces the
   * peer nonces it is signing with). Saved with the wallet afterwards.
   */
  importSpendInfo(info: string): Promise<void>;
  /**
   * Review I1: true only when the tx is in a block, spends one of this escrow's outputs (round 2,
   * R2-I1: an input with this wallet's key image for that output, the output in its ring; see the
   * Monero engine's proveTx), and its secret key (additional keys included, R2-I2) proves it pays at least
   * `minimums` (payout 0 may be short by exactly the tx's network fee, which comes off it). Read in
   * the party's work queue. Optional so that test doubles may leave it out (then nothing is proven).
   */
  proveSweep?(txHash: string, txKey: string, minimums: Payout[]): Promise<boolean>;
  stop(): Promise<void>;
}

/** What funds() reads (see PartyHandle.funds). */
export interface Funds {
  balance: bigint;
  unlocked: bigint;
  incoming: Incoming[];
  chainHeight?: number;
  outgoing?: Outgoing[];
  /** Moderator only: PartyState.claims. */
  spendClaims?: Role[];
  /**
   * Moderator only (review I1): the txs its own party signed (as co-signer, or built and saw done).
   * Its wallet shows these without any import; every other outgoing tx was shown only through an
   * import and needs a proof (`spendProofs`, `proveSweep`).
   */
  ownTxs?: string[];
  /** Moderator only (review I1): per trade party whose spend.info it imported, the tx and the tx key it sent ('' when it had none). */
  spendProofs?: { from: Role; txHash: string; txKey: string }[];
}

/** The longest post-release multisig info importSpendInfo() takes (hex characters). */
export const SPEND_INFO_MAX_HEX = 60_000; // fits one sealed message (64 KiB padded plaintext, R9)
const HEX = /^[0-9a-f]+$/;

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
/**
 * Post-release multisig info (Task 9, lead decision A): `{ hex, txHash, txKey }`: the info, the
 * release's tx and its secret key ('' when this party has none; review I1). A buyer or seller whose
 * release is done sends it to the moderator, and resends it (timer, reconnect) until the moderator's SPEND_ACK;
 * the moderator imports it and acks. Outside the release's attempt tags: it is about a spend
 * that already happened.
 */
const SPEND_INFO = 'spend.info:0';
const SPEND_ACK = 'spend.ack:0';
/**
 * Sent instead of SPEND_INFO when this party's info is over SPEND_INFO_MAX_HEX (a dust-attacked
 * escrow): no info, only the claim that its release is done, so the moderator's watcher still
 * reports `release-claimed` and the 6 h fallback escalates (lead decision b). Acked by SPEND_ACK.
 */
const SPEND_CLAIM = 'spend.claim:0';
/** Review M2: a refused spend.info from one sender is tried again at most this often. */
export const SPEND_IMPORT_RETRY_MS = 30_000;
const KEY_HEX = /^[0-9a-f]{64}$/;
/**
 * A tx secret key with any additional tx keys (review round 2, R2-I2): wallet2 concatenates one per
 * output when a tx pays a subaddress among other destinations; at most 16 outputs. Same as the Monero
 * engine's TX_KEY (kept here so the party never loads monero-ts); the engine checks every chunk is a scalar.
 */
const TX_KEY = /^(?:[0-9a-f]{64}){1,17}$/;
const MAX_KEX_ROUND = 12;
const MAX_ATTEMPT = 20;
const KEX = /^msig\.kex:(\d{1,2})$/;
// Release keys carry the outcome's tag, so messages for different outcomes never mix.
const RELEASE_KEY = /^(state\.export|release\.txset|release\.done):([0-9a-f]{16})\.(\d{1,2})$/;
const tagOf = (outcome: string): string => outcome.slice(0, 16);
const exportKey = (r: ReleaseState, n = r.attempt): string => `state.export:${tagOf(r.outcome)}.${n}`;
const txSetKey = (r: ReleaseState): string => `release.txset:${tagOf(r.outcome)}.${r.attempt}`;
const doneKey = (r: ReleaseState): string => `release.done:${tagOf(r.outcome)}.0`;

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
  if (key === SPEND_INFO) {
    // txKey may carry additional tx keys (a release paying a subaddress; review round 2, R2-I2).
    return from !== 'mod' && exactStrings(p, ['key', 'hex', 'txHash', 'txKey']) && KEY_HEX.test(p.txHash as string) && (p.txKey === '' || TX_KEY.test(p.txKey as string));
  }
  if (key === SPEND_ACK) return from === 'mod' && exactStrings(p, ['key']);
  if (key === SPEND_CLAIM) return from !== 'mod' && exactStrings(p, ['key']);
  const rel = RELEASE_KEY.exec(key);
  if (!rel || Number(rel[3]) > MAX_ATTEMPT) return false;
  if (rel[1] === 'state.export') return exactStrings(p, ['key', 'hex']);
  if (rel[1] === 'release.txset') return exactStrings(p, ['key', 'txSet']);
  return rel[3] === '0' && exactStrings(p, ['key', 'txHash']);
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
 * others could not settle. A party that has checked the addresses itself can settle, and
 * from then on ignores setup messages, even if a peer withholds its confirmation.
 *
 * Settlement waits until the escrow is funded, fully unlocked and matches the outcome. The
 * builder and co-signer swap fresh multisig state, the builder sends one tx set, the
 * co-signer checks and signs it. Anything that fails before a signature starts a new attempt
 * with a fresh export. Exports, built sets, the set being signed and the signed tx are saved
 * before they leave the device; after a restart the same ones are resent or re-signed, never
 * new ones, so signing nonces are never reused on a different message (R26). A broadcast
 * whose result is unknown is resubmitted until the tx is in a block, or until the escrow is
 * seen emptied by another tx ('settled-elsewhere'). The builder counts the co-signer's DONE
 * only once its own wallet sees the escrow empty and the reported tx in a block. A daemon that
 * times out (15 s) or can't be reached is retried on the next tick, never fatal.
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
  /** Both peers confirmed: the funding signal for ready(). */
  let isReady = false;
  /** This party has checked all three addresses itself: enough to settle, and setup is over. */
  const checked = (): boolean => state.sent[READY] !== undefined;
  let readyResends = 0;
  let checkedResends = 0;
  let mismatchLogged = false;
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
    } else if (!isReady && checkedResends < 20) {
      // Capped: a peer that never confirms may be offline for the whole trade.
      if (checked()) checkedResends += 1;
      await send(state.step, peers); // the final kex message, in case a peer lost it
      await send(ADDR, peers);
      await send(READY, peers);
    } else if (readyResends < 5) {
      // A few more, in case a peer lost ours; an uninvolved peer may stay offline for good.
      readyResends += 1;
      await send(READY, peers.filter((p) => !pastSetup(p)));
    }
    if (!state.received[SPEND_ACK]?.mod) await sendSpend();
    const rel = state.release;
    if (!rel) return;
    if (rel.phase === 'exhausted' || rel.phase === 'superseded') return;
    if (rel.phase !== 'waiting-funds') await send(exportKey(rel), [rel.counterpart]);
    if (rel.part === 'builder' && rel.phase === 'built') await send(txSetKey(rel), [rel.counterpart]);
    if (rel.phase === 'done' && rel.part === 'cosigner') await send(doneKey(rel), [rel.counterpart]);
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
      if (confirmed[p]!.payload.address !== state.address) {
        // This party has checked the addresses and can still settle with the honest peer, so a
        // wrong confirmation only means "don't fund": ready() fails, the party lives on.
        if (!mismatchLogged) ignored('ready-mismatch');
        mismatchLogged = true;
        readyReject(new PartyError('address-mismatch', `${p} confirmed another escrow address`));
        return;
      }
    }
    isReady = true;
    readyResolve(state.address);
  };

  // ── Settlement ────────────────────────────────────────────────────────

  /** Start a new attempt: drop this attempt's work; the next step exports afresh. */
  /**
   * A refused or failed attempt also lifts the outcome lock: a set this party built earlier may
   * still complete, but it pays an outcome this party approved, and the caller may now switch
   * (e.g. after dust changed the escrow balance).
   */
  const nextAttempt = async (rel: ReleaseState): Promise<void> => {
    rel.attempt += 1;
    rel.committed = false;
    delete rel.txSet;
    delete rel.txKey;
    if (rel.attempt > MAX_ATTEMPT) {
      // Give up on this outcome only; the party stays alive and can settle another.
      rel.phase = 'exhausted';
      await saveState();
      settleWaiter?.reject(new PartyError('bad-outcome', 'settlement attempts for this outcome are used up'));
      return;
    }
    rel.phase = 'waiting-funds';
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

  /** The counterpart moved one attempt ahead (it refused or failed ours). Never jump further. */
  const counterpartNext = (rel: ReleaseState): boolean => state.received[exportKey(rel, rel.attempt + 1)]?.[rel.counterpart] !== undefined;

  const advanceRelease = async (): Promise<void> => {
    const o = settleOutcome;
    const rel = state.release;
    if (!o || !rel || !checked() || rel.outcome !== outcomeDigest(o) || rel.phase === 'exhausted') return;
    if (rel.phase === 'superseded') {
      settleWaiter?.reject(new PartyError('settled-elsewhere', 'another transaction emptied the escrow'));
      return;
    }
    const cp = rel.counterpart;
    const theirs = (key: string): Received | undefined => state.received[key]?.[cp];

    // The counterpart moved to the next attempt (e.g. it refused our set): follow, unless we signed.
    if (counterpartNext(rel) && (rel.phase === 'waiting-funds' || rel.phase === 'export' || rel.phase === 'built')) {
      await nextAttempt(rel);
      if ((rel.phase as ReleasePhase) === 'exhausted') return;
    }

    if (rel.phase === 'waiting-funds') {
      if (!(await fundsReady(o))) return;
      state.sent[exportKey(rel)] = { hex: await session.exportState() };
      rel.phase = 'export';
      await persist(); // the export's nonces are saved with the wallet before they are sent
      await send(exportKey(rel), [cp]);
    }

    if (rel.part === 'builder') {
      const exp = theirs(exportKey(rel));
      if (rel.phase === 'export' && exp) {
        try {
          await importPeer(exp);
          if (!(await fundsReady(o))) throw new EscrowError('not-ready');
          const { txSet, txKey } = await session.buildRelease(o.to);
          rel.phase = 'built';
          rel.committed = true;
          rel.txSet = txSet;
          if (txKey !== undefined) rel.txKey = txKey;
          state.sent[txSetKey(rel)] = { txSet };
          await persist(); // the set is saved before it leaves the device; never rebuilt
          await send(txSetKey(rel), [cp]);
        } catch (e) {
          if (!(e instanceof EscrowError) || !RETRYABLE.has(e.code)) throw e;
          ignored(`build-${e.code}`);
          await nextAttempt(rel);
        }
      }
      const done = theirs(doneKey(rel));
      if (rel.phase === 'built' && done) {
        // Never take the co-signer's word: done only once this wallet sees the escrow emptied by
        // the reported tx and confirmed. `spentBy` already requires the tx to be confirmed (it is
        // the wallet's own view: an outgoing, in-block tx with that hash); the `txSeen` call is a
        // deliberate belt-and-braces cross-check against the daemon's view of the same hash, so a
        // wallet that has not yet caught up cannot declare done on a tx the daemon has not blocked.
        // Until all three hold, keep waiting (and resending).
        // NOTE (liveness only, not safety): if a *different* tx empties the escrow, or coins arrive
        // after release, the builder's `balance === 0n` may never line up with this reported hash
        // and it waits here indefinitely. Task 9's watcher owns that: it reports `settled` (escrow
        // emptied by an in-block tx) or `late-funds`, which resolves the trade outside this loop.
        const txHash = String(done.payload.txHash);
        if ((await session.sync()).balance === 0n && (await session.spentBy(txHash)) && (await session.txSeen(txHash))) {
          rel.phase = 'done';
          rel.txHash = txHash;
          await saveState();
        }
      }
      if (rel.phase === 'done') settleWaiter?.resolve(null);
      return;
    }

    // Co-signer.
    const exp = theirs(exportKey(rel));
    const tx = theirs(txSetKey(rel));
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
      rel.committed = true;
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
        const status = await session.txStatus(rel.txHash);
        if (status === 'pool') return; // broadcast; done once it is in a block
        if (status === 'none') {
          // Refused for good once another tx has emptied the escrow: stop, never rebuild or resend.
          if ((await session.sync()).balance === 0n) {
            rel.phase = 'superseded';
            await saveState();
            settleWaiter?.reject(new PartyError('settled-elsewhere', 'another transaction emptied the escrow'));
          }
          return; // otherwise retried on the next tick
        }
      }
      rel.phase = 'done';
      state.sent[doneKey(rel)] = { txHash: rel.txHash };
      await saveState();
      await send(doneKey(rel), [cp]);
    }
    if (rel.phase === 'done') settleWaiter?.resolve(rel.txHash ?? null);
  };

  // ── Spend info (Task 9, lead decision A) ──────────────────────────────

  /**
   * Buyer or seller: once its release is done, export fresh multisig info once, save it with the
   * wallet, and send it to the moderator (resent by `resend` until acked). Not after a release
   * the moderator co-signed: its own wallet shows that one. Never before done: the export
   * replaces the nonces a release in progress signs with.
   */
  const offerSpendInfo = async (): Promise<void> => {
    const rel = state.release;
    if (a.role === 'mod' || !rel || rel.phase !== 'done' || rel.counterpart === 'mod' || state.sent[SPEND_INFO]) return;
    try {
      await exportSpendInfo();
    } catch {
      // Never fatal after a release that is done: nothing was sent, tried again on the next tick.
      return ignored('spend-info-export-failed');
    }
    await sendSpend();
  };

  /** The exported info when it fits one sealed message, else the claim alone (never sent before an export). */
  const sendSpend = async (): Promise<void> => {
    if (!state.sent[SPEND_INFO]) return;
    if (spendInfoSendable()) return send(SPEND_INFO, ['mod']);
    state.sent[SPEND_CLAIM] ??= {};
    await send(SPEND_CLAIM, ['mod']);
  };

  /** Exported and small enough for one sealed message (else never sent: the watcher's fallback escalates). */
  const spendInfoSendable = (): boolean => {
    const hex = state.sent[SPEND_INFO]?.hex;
    return typeof hex === 'string' && hex.length <= SPEND_INFO_MAX_HEX;
  };

  const exportSpendInfo = async (): Promise<string> => {
    const rel = state.release!;
    // The co-signer submitted the tx, so its wallet stores the key; the builder kept it from the build.
    const txKey = rel.txKey ?? (rel.txHash && session.txKey ? await session.txKey(rel.txHash) : null) ?? '';
    const hex = await session.exportState();
    if (hex.length > SPEND_INFO_MAX_HEX) ignored('spend-info-too-large');
    state.sent[SPEND_INFO] = { hex, txHash: rel.txHash ?? '', txKey };
    try {
      await persist(); // the export's fresh nonces are saved with the wallet before it leaves
    } catch (e) {
      delete state.sent[SPEND_INFO]; // never sent unsaved; exported afresh next time
      throw e;
    }
    return hex;
  };

  /** Null when the info may be imported now, else why not. */
  const importRefusal = (info: unknown): EscrowError | PartyError | null => {
    if (typeof info !== 'string' || info.length === 0 || info.length > SPEND_INFO_MAX_HEX || info.length % 2 !== 0 || !HEX.test(info)) {
      return new EscrowError('bad-spend-info', 'not a hex string of the right size');
    }
    if (!state.address || !checked()) return new PartyError('bad-state', 'setup has not ended');
    const ph = state.release?.phase;
    if (ph !== undefined && ph !== 'done' && ph !== 'exhausted' && ph !== 'superseded' && ph !== 'waiting-funds') {
      return new PartyError('bad-state', 'a release of this party is under way');
    }
    return null;
  };

  /**
   * Sync first (the wallet must know the escrow's outputs to complete their key images), then
   * import one peer's info alone (never with another peer's: a bad one would spoil the
   * composite key images of a good one), then save the wallet. Anything the wallet refuses (not
   * an export of this escrow, a bad signature) is EscrowError('bad-spend-info'); a daemon that
   * does not answer stays 'daemon-unavailable'.
   */
  const importSpendInfo = async (info: string): Promise<void> => {
    await session.sync();
    try {
      await session.importState([info]);
    } catch (e) {
      if (e instanceof EscrowError) throw e;
      throw new EscrowError('bad-spend-info', e instanceof Error ? e.message.slice(0, 120) : 'import failed');
    }
    await persist();
  };

  /** Moderator: when each sender's last spend.info import was tried (in memory; review M2). */
  const importTried = new Map<Role, number>();

  /**
   * Moderator (review M2): the wallet's outgoing view now, plus every in-block tx it ever showed
   * (PartyState.shown, saved), so a later import that changes the composite key images cannot
   * make a shown sweep disappear.
   */
  const shownOutgoing = async (now: Outgoing[]): Promise<Outgoing[]> => {
    const shown = state.shown ?? [];
    const fresh = now.filter((o) => o.height !== null && !shown.some((x) => x.txHash === o.txHash));
    if (fresh.length > 0) {
      state.shown = [...shown, ...fresh];
      await saveState();
    }
    const out = [...now];
    for (const o of state.shown ?? []) if (!out.some((x) => x.txHash === o.txHash)) out.push(o);
    return out;
  };

  /** A spend message (opened, well-formed): the moderator imports info and acks; a party records the ack. */
  const onSpend = async (key: string, from: Role, payload: Received['payload']): Promise<void> => {
    const digest = digestOf(key, payload);
    if (key === SPEND_ACK) {
      if (a.role === 'mod' || !state.sent[SPEND_INFO] || state.received[SPEND_ACK]?.mod) return ignored('duplicate');
      (state.received[SPEND_ACK] ??= {}).mod = { payload, digest };
      state.guard = guard.toJSON();
      await saveState();
      return;
    }
    if (a.role !== 'mod') return ignored('spend-info-not-mod');
    // Opened, signed by a trade party: a claim that its release is done, imported or not (lead decision b).
    if (!(state.claims ?? []).includes(from)) {
      state.claims = [...(state.claims ?? []), from];
      await saveState();
    }
    if (key === SPEND_CLAIM) {
      (state.received[SPEND_CLAIM] ??= {})[from] ??= { payload, digest };
    } else if (state.received[SPEND_INFO]?.[from] === undefined) {
      // Review M2: one import per sender. A later, different info from a sender already imported is
      // only acked (below), never imported; a refused one is tried again at most every
      // SPEND_IMPORT_RETRY_MS, so resends cannot make the mod sync and import on every frame.
      const last = importTried.get(from);
      if (last !== undefined && Date.now() - last < SPEND_IMPORT_RETRY_MS) return ignored('spend-info-throttled');
      importTried.set(from, Date.now());
      const hex = payload.hex;
      if (importRefusal(hex) !== null) return ignored('spend-info-refused');
      try {
        await importSpendInfo(hex as string);
      } catch (e) {
        // Garbage, another escrow's info, or a daemon that did not answer: not recorded, so the
        // sender's next resend is tried again. Never fatal.
        return ignored(e instanceof EscrowError && e.code === 'daemon-unavailable' ? 'daemon-unavailable' : 'spend-info-refused');
      }
      (state.received[SPEND_INFO] ??= {})[from] = { payload, digest };
    } else if (state.received[SPEND_INFO][from]!.digest !== digest) {
      ignored('spend-info-again');
    }
    state.guard = guard.toJSON();
    state.sent[SPEND_ACK] = {};
    await saveState();
    await send(SPEND_ACK, [from]); // also for a resend: our ack may have been lost
  };

  const beginRelease = async (o: Outcome): Promise<void> => {
    const digest = outcomeDigest(o);
    const rel = state.release;
    if (rel && rel.outcome === digest) return;
    // Once a set was built or accepted for checking under this outcome, it may still complete,
    // so the outcome can no longer be switched.
    if (rel && rel.committed) throw new PartyError('bad-outcome', 'already signed for another outcome');
    const part = a.role === o.builder ? 'builder' : 'cosigner';
    state.release = {
      outcome: digest,
      part,
      counterpart: part === 'builder' ? o.cosigner : o.builder,
      attempt: 1, // attempts are counted per outcome
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
    const from = opened.from; // the signed sender, never the raw frame's field
    const p = opened.payload;
    if (!isRecord(p) || !wellFormed(p, from) || (p.key as string).split(':')[0] !== opened.type) {
      ignored('malformed');
      return;
    }
    const { key: k, ...rest } = p;
    const key = k as string;
    const payload = rest as Received['payload'];
    // Once this party has checked the addresses, setup is over for it: only peers' READY still counts.
    if (isSetupKey(key) && key !== READY && state.address !== null && checked()) {
      // A peer still resending setup has not heard everything from us: answer it again.
      readyResends = 0;
      checkedResends = 0;
      nextResendAt = 0;
      ignored('setup-after-ready');
      return;
    }
    if (key === SPEND_INFO || key === SPEND_ACK || key === SPEND_CLAIM) {
      await onSpend(key, from, payload);
      return;
    }
    if (!isSetupKey(key)) {
      const rel = state.release;
      if (!rel || from !== rel.counterpart || !key.includes(`:${tagOf(rel.outcome)}.`)) {
        ignored('not-current-release');
        return;
      }
    }
    const digest = digestOf(key, payload);
    const slot = (state.received[key] ??= {});
    const seen = slot[from];
    if (seen) {
      if (seen.digest !== digest && isSetupKey(key) && !checked()) throw new PartyError('equivocation', `${from} sent two versions of ${key}`);
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
    try {
      if (!state.address) await advanceSetup();
      else await checkAddresses();
      if (settleOutcome && state.address !== null && checked()) {
        await beginRelease(settleOutcome);
        await advanceRelease();
      }
      await offerSpendInfo();
    } catch (e) {
      // A slow or unreachable daemon is retried on the next tick. Nothing is saved or sent
      // between a daemon call and the step it guards, so the step simply runs again.
      if (e instanceof EscrowError && e.code === 'daemon-unavailable') {
        ignored('daemon-unavailable');
        return;
      }
      throw e;
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
        if (switching && rel.committed) {
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
    committedBuilder() {
      const rel = state.release;
      if (!rel || !rel.committed) return null;
      return rel.part === 'builder' ? a.role : rel.counterpart;
    },
    funds() {
      // The wallet stays readable after the relay connection ended for good (the relay closes a
      // trade's channels when the trade ends, Task 7, or refuses this role: 4401/4404/4409), so the
      // app can still see the escrow emptied and apply its after-close rules (Task 12). Reading
      // needs no peer and signs nothing (R26); it is serialised on the same chain as every other
      // wallet call. A party-level failure (PartyError: equivocation, address mismatch, bad state,
      // settled elsewhere), a session that never came up, and stop() still reject.
      return new Promise((resolve, reject) => {
        chain = chain.then(async () => {
          if (stopped) return reject(new PartyError('stopped'));
          if (failure && (failure instanceof PartyError || !session)) return reject(failure);
          try {
            const { balance, unlocked } = await session.sync();
            const incoming = await session.incoming();
            const extra: Omit<Funds, 'balance' | 'unlocked' | 'incoming'> = {};
            if (session.chainHeight) extra.chainHeight = await session.chainHeight();
            if (session.outgoing) extra.outgoing = await session.outgoing();
            if (a.role === 'mod') {
              extra.spendClaims = [...(state.claims ?? [])];
              if (extra.outgoing) extra.outgoing = await shownOutgoing(extra.outgoing);
              const rel = state.release;
              // The txs this mod signed. 'superseded' counts too (review round 2, R2-M3): the mod signed
              // that tx, so if it is in the wallet's outgoing view at all it landed after all and is
              // the mod's own spend of this escrow; while it has not landed it is not in `outgoing`
              // and so never reaches the watcher.
              extra.ownTxs = rel?.txHash && (rel.phase === 'signed' || rel.phase === 'done' || rel.phase === 'superseded') ? [rel.txHash] : [];
              extra.spendProofs = Object.entries(state.received[SPEND_INFO] ?? {}).map(([from, r]) => ({
                from: from as Role,
                txHash: String(r!.payload.txHash ?? ''),
                txKey: String(r!.payload.txKey ?? ''),
              }));
            }
            resolve({ balance, unlocked, incoming, ...extra });
          } catch (e) {
            reject(e);
          }
        });
      });
    },
    spendInfo() {
      return new Promise((resolve, reject) => {
        chain = chain.then(async () => {
          if (stopped) return reject(new PartyError('stopped'));
          if (failure && (failure instanceof PartyError || !session)) return reject(failure); // as funds(): no peer needed
          const sent = state.sent[SPEND_INFO];
          if (sent) return resolve(String(sent.hex));
          if (state.release?.phase !== 'done') return reject(new PartyError('bad-state', 'no release of this party is done'));
          try {
            resolve(await exportSpendInfo());
          } catch (e) {
            reject(e);
          }
        });
      });
    },
    importSpendInfo(info) {
      return new Promise((resolve, reject) => {
        chain = chain.then(async () => {
          if (stopped) return reject(new PartyError('stopped'));
          if (failure && (failure instanceof PartyError || !session)) return reject(failure); // as funds(): no peer needed
          const refusal = importRefusal(info);
          if (refusal) return reject(refusal);
          try {
            await importSpendInfo(info);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    },
    proveSweep(txHash, txKey, minimums) {
      return new Promise((resolve, reject) => {
        chain = chain.then(async () => {
          if (stopped) return reject(new PartyError('stopped'));
          if (failure && (failure instanceof PartyError || !session)) return reject(failure); // as funds(): no peer needed
          try {
            if (!session.proveTx || minimums.length === 0) return resolve(false);
            const r = await session.proveTx(txHash, txKey, minimums.map((m) => m.address));
            // Review round 2 (R2-I1): the tx must spend one of THIS escrow's outputs (spendsEscrow), so
            // another trade's release, or an old tx, can never be counted for this escrow.
            if (r === null || !r.inBlock || r.spendsEscrow !== true || r.received.length !== minimums.length) return resolve(false);
            // Payout 0 bears the network fee (buildRelease subtracts it from output 0), up to the
            // largest fee a release may carry: a tx cannot "pay" payout 0 by burning a huge fee.
            const fee = r.feeAtomic > MAX_NETWORK_FEE ? MAX_NETWORK_FEE : r.feeAtomic;
            resolve(minimums.every((m, i) => r.received[i]! + (i === 0 ? fee : 0n) >= m.amountAtomic));
          } catch (e) {
            reject(e);
          }
        });
      });
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
