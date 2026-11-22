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
import { DAEMON_TIMEOUT_MS, EscrowError, type EscrowEngine, type EscrowSession, type Incoming, type Outgoing, type Payout, type SavedSession } from './engine.js';
import type { Transport } from './transport.js';
import { MAX_NETWORK_FEE, sumPayouts } from './verify.js';

/** How a trade's escrow is paid out: `builder` builds, `cosigner` checks and signs. */
export interface Outcome {
  kind: 'release';
  to: Payout[];
  builder: Role;
  cosigner: Role;
  /**
   * A later release (late-funds step 1, docs/superpowers/specs/2026-11-12-escrow-later-release.md):
   * the tx (64 lower-case hex) that last emptied this escrow. Absent for the first release. A later
   * release is moderator-built only, follows this party's own done release with exactly this tx (or
   * is this party's first, when it took no part in the earlier one), pays the remaining balance, and
   * an escrow allows at most MAX_LATER_RELEASES of them.
   */
  after?: string;
}

/** The hard safety cap on later releases per escrow (lead, 2026-11-12): no product limit, but a bug cannot loop. */
export const MAX_LATER_RELEASES = 10;
const TX_HASH = /^[0-9a-f]{64}$/;

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
  /** A later release (late-funds step 1): the `after` of its outcome. Absent for a first release. */
  after?: string;
  part: 'builder' | 'cosigner';
  counterpart: Role;
  /** Per outcome: each failed build or check starts a new attempt with a fresh export. */
  attempt: number;
  /** Set once any tx set was built or received for this outcome; then it can't be switched. */
  committed?: boolean;
  phase: ReleasePhase;
  txSet?: string;
  /**
   * Co-signer: the network fee bound its check of `txSet` resolved with, as a decimal string (the
   * state is sealed as JSON), kept with the commitment so the re-check before signing is offline
   * and the same (review lead-escrow-harden M3). Absent in states saved before it: read again.
   */
  feeCeiling?: string;
  /** Builder: the secret key of the tx in `txSet` (its wallet stores none), sent with spend.info (review I1). */
  txKey?: string;
  /**
   * Builder: the network fee of the tx in `txSet` as built (buildRelease), a decimal string, saved
   * with `txKey` (review r-m1). The key check bounds payout 0's shortfall by it. Absent in states
   * saved before it: the daemon's copy of the tx gives the fee instead.
   */
  txFee?: string;
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
   * The earlier releases of this escrow, in order (late-funds step 1): a release is moved here when
   * a later one starts. Absent in states saved before it (none).
   */
  releases?: ReleaseState[];
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
   * `spentAtomic` is a decimal string: the moderation service seals this state as JSON, which has
   * no bigint (a bigint here made every save throw and killed the mod's party; demo, 10 Nov).
   */
  shown?: ShownTx[];
}

/**
 * A saved ShownTx exactly as this code writes it (security review L2): 64 lower-case hex, a whole
 * non-negative block height, and a strict decimal amount (no sign, no leading zero, no `0x`, no
 * whitespace, never empty: BigInt() would take all of those).
 */
function isShownTx(x: unknown): x is ShownTx {
  if (typeof x !== 'object' || x === null) return false;
  const t = x as Record<string, unknown>;
  return typeof t.txHash === 'string' && /^[0-9a-f]{64}$/.test(t.txHash)
    && typeof t.height === 'number' && Number.isSafeInteger(t.height) && t.height >= 0
    && typeof t.spentAtomic === 'string' && /^(0|[1-9][0-9]*)$/.test(t.spentAtomic);
}

const PHASES: readonly string[] = ['waiting-funds', 'export', 'built', 'cosigning', 'signed', 'done', 'exhausted', 'superseded'];

/** Review I2: a saved earlier release as this code writes it (the history moves only done releases). */
function isSavedRelease(x: unknown): boolean {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  return typeof r.outcome === 'string' && /^[0-9a-f]{64}$/.test(r.outcome)
    && (r.part === 'builder' || r.part === 'cosigner') && typeof r.counterpart === 'string' && (ROLES as readonly string[]).includes(r.counterpart)
    && typeof r.phase === 'string' && PHASES.includes(r.phase)
    && (r.after === undefined || (typeof r.after === 'string' && /^[0-9a-f]{64}$/.test(r.after)))
    && (r.txHash === undefined || (typeof r.txHash === 'string' && /^[0-9a-f]{64}$/.test(r.txHash)));
}

/** An in-block tx the moderator's wallet once showed spending the escrow (PartyState.shown): JSON-safe. */
export interface ShownTx {
  txHash: string;
  height: number | null;
  /** Outgoing.spentAtomic, in decimal. */
  spentAtomic: string;
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
   * Ruling-winner reasons (lead, 22 Nov): what this party has heard from `from` about settling, read
   * only and never acted on. `current`: a message of this party's current release came from `from`
   * (its export, its set or its DONE, as saved). `elsewhere`: the latest release message `from` sent
   * this party for any other outcome, opened under the trade's participants (so signed by `from`'s
   * own trade identity), in memory only, or null: the outcome's tag (releaseTag), whether a tx set
   * for it came (then `from` built it and is committed to it: a builder commits when it builds), and
   * when it last came (this process's clock, ms). Such a message is never stored, imported, signed
   * or answered (`not-current-release`). The moderation process words why a ruling's payout waits
   * from it; it changes nothing this party signs.
   */
  peerRelease?(from: Role): { current: boolean; elsewhere: { tag: string; txSet: boolean; at: number } | null };
  /**
   * This party's own part of the settle of `o` is finished, as far as this party knows: the
   * co-signer has submitted the signed tx itself, or (for the builder) the co-signer REPORTED that it
   * did, in a signed DONE for this release that is not yet checked on the chain (the builder checks
   * it before its settle() resolves: `landed`). Nothing more is signed or sent by this party for it.
   * False before then, for another outcome (review m3: tied to `o` by its digest), with no settle,
   * and for a release that was exhausted or superseded. Read from the saved state (it survives a
   * restart); pure, no daemon call. A screen uses it to word the wait (gap 4).
   */
  settleSent?(o: Outcome): boolean;
  /**
   * Chain proof that `o` landed (review M1 fix b/c, 20 Nov): the hash of a tx in a block that spent
   * this escrow and pays `o`, from this party's own wallet and daemon, or null when there is none
   * (yet). Never anyone's word:
   * - a tx this party submitted, or the co-signer's DONE names: this wallet shows it spending the
   *   escrow in a block (`spentBy`) and the daemon has it (`txSeen`); and when this party built the
   *   release and kept its tx secret key, that key proves the tx pays `o` (below).
   * - without either, for a builder with its saved tx secret key: one of this wallet's confirmed
   *   outgoing txs (spentBy + txSeen: it spent this escrow in a block) that the key fits
   *   (check_tx_key: a key fits only the tx built with it) and that pays each of `o`'s payouts
   *   (payout 0 less at most MAX_NETWORK_FEE, the fee).
   * Read-only: it syncs and reads, never signs, exports, imports or sends, and works with no peer
   * (after the relay closed the trade, like funds()). Rejects as funds() does.
   */
  landed?(o: Outcome): Promise<string | null>;
  /**
   * The outcome this party's settle() queue has taken as the one it works toward (a later settle()
   * replaced the earlier one, or this was the first), or null. Read-only and in memory: it changes
   * only inside the party's work queue, once a settle() job passed the switch check, so an app can
   * tell a switch the party accepted from one still queued (or refused: the earlier outcome then
   * stays). The web runtime shows a rebound sum only once this names it (growth-binding review M1).
   */
  acceptedOutcome?(): Outcome | null;
  /**
   * Review I3: who built the release whose tx this is, among every release of this escrow this
   * party signed or saw done (the history too), or null. The watcher names an older tx by it, never
   * by the current release's builder.
   */
  builderOf?(txHash: string): Role | null;
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
  /**
   * The longest this party waits on one of the session's daemon lookups (sync, txStatus, txSeen,
   * spentBy, submit, proveTx) before it counts as 'daemon-unavailable' and is tried again on a
   * later tick. A backstop: the Monero engine gives up on its own after DAEMON_TIMEOUT_MS. Default
   * DAEMON_TIMEOUT_MS + 5 s.
   */
  daemonTimeoutMs?: number;
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
    // A later release's messages never mix with an earlier one's, even with identical payouts; a
    // first release's digest is unchanged (saved states and peers on earlier code agree on it).
    ...(o.after !== undefined ? { after: o.after } : {}),
  });
}

/** The tag a release's message keys carry (the first 16 hex of the outcome's digest). */
export const releaseTag = (o: Outcome): string => tagOf(outcomeDigest(o));

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

  // Every daemon lookup on the settle path is bounded here too, whatever the engine does: one that
  // never answers would otherwise hold `chain` (and so every later tick, message, funds() and
  // stop()) for good. Only reads, and submit (re-broadcasting the same signed tx is harmless):
  // never a call that makes or uses signing nonces (buildRelease, signRelease, export/import), which
  // must not be abandoned and run again on the same state (R26).
  const daemonMs = a.daemonTimeoutMs ?? DAEMON_TIMEOUT_MS + 5_000;
  const bounded = async <T>(what: string, call: () => Promise<T>): Promise<T> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const p = call();
    p.catch(() => undefined);
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          t = setTimeout(() => reject(new EscrowError('daemon-unavailable', `${what}: no answer in ${daemonMs} ms`)), daemonMs);
        }),
      ]);
    } finally {
      clearTimeout(t);
    }
  };
  const daemon = {
    sync: () => bounded('sync', () => session.sync()),
    txStatus: (h: string) => bounded('tx lookup', () => session.txStatus(h)),
    txSeen: (h: string) => bounded('tx lookup', () => session.txSeen(h)),
    spentBy: (h: string) => bounded('spent by', () => session.spentBy(h)),
    submit: (hex: string) => bounded('submit', () => session.submit(hex)),
  };

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

  /**
   * Review multisig-vs-RetoSwap F3: a session that refuses to make the multisig (peers' signer keys
   * not distinct) or to give an address (the finished wallet is not a 2-of-3) stops this party with
   * PartyError('bad-state'), before it sends msig.addr or msig.ready: nobody is shown that address.
   */
  const shaped = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (e) {
      if (e instanceof EscrowError && e.code !== 'daemon-unavailable') throw new PartyError('bad-state', `multisig refused: ${e.message.slice(0, 120)}`);
      throw e;
    }
  };

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
        out = { hex: await shaped(() => session.make(peerHex(PREPARE))), echo };
      } else {
        const r = await session.exchange(peerHex(key));
        if (r.ready) {
          state.address = await shaped(() => session.address());
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
    delete rel.txFee;
    delete rel.feeCeiling;
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
    const { balance, unlocked } = await daemon.sync();
    return balance > 0n && balance === unlocked && sumPayouts(o.to) === balance;
  };

  /** The earlier releases (late-funds step 1), the history only. */
  const history = (): ReleaseState[] => state.releases ?? [];
  /** Every release of this escrow this party has, earlier and current. */
  const allReleases = (): ReleaseState[] => [...history(), ...(state.release ? [state.release] : [])];
  /** The tx of this party's latest done release in the history (the one a current later release follows), or null. */
  const priorDoneTx = (): string | null => history().filter((r) => r.phase === 'done' && r.txHash).at(-1)?.txHash ?? null;
  /** The co-signer's export this process already imported before building (re-verify gap (b)), by message key. */
  let importedEarly: string | null = null;
  /** peerRelease: per sender, its latest release message for another outcome than the current release (in memory only). */
  const heardElsewhere = new Map<Role, { tag: string; txSet: boolean; at: number }>();

  /**
   * Before this party exports for an attempt. Review M2 / lead call: the full check (the escrow
   * holds exactly what the outcome pays, by this wallet's own view) for every first release, every
   * builder, and a co-signer whose own latest done release is the one this later release follows
   * (it knows the true balance). A co-signer that took no part in the release `after` names (none of
   * its own, or an older one: review M3, alternating co-signers) cannot see that spend, so it exports
   * once the balance is all unlocked; the exact match and the proof of `after` run after importing
   * the builder's export (`afterImport`), before anything is signed.
   *
   * The builder of a later release (the moderator):
   * - re-verify gap (b): when the co-signer's export for this attempt is already here, it is
   *   imported first (after a sync, as the co-signer does with the builder's), so a moderator that
   *   never imported a spend.info still sees the earlier release's spend. An import never touches
   *   this wallet's own nonces, and the builder imports that export again before building anyway.
   * - re-verify N1: one that has no release of its own waits until its wallet shows `after` as a
   *   confirmed tx that spent this escrow (`spentBy`). A builder with a release names its own
   *   latest done tx (outcomeRefusal), which it has already seen spend the escrow.
   */
  const readyToExport = async (o: Outcome, rel: ReleaseState): Promise<boolean> => {
    if (o.after !== undefined && rel.part === 'builder') {
      const key = exportKey(rel);
      const exp = state.received[key]?.[rel.counterpart];
      if (exp && importedEarly !== `${key}/${exp.digest}`) {
        await daemon.sync();
        await importPeer(exp);
        importedEarly = `${key}/${exp.digest}`;
      }
      if (priorDoneTx() !== o.after) {
        await daemon.sync();
        if (!(await daemon.spentBy(o.after))) return false;
      }
      return fundsReady(o);
    }
    if (o.after === undefined || rel.part !== 'cosigner' || priorDoneTx() === o.after) return fundsReady(o);
    const { balance, unlocked } = await daemon.sync();
    return balance > 0n && balance === unlocked;
  };

  /**
   * Why `o` may not be settled now, or null (spec 2026-11-12, rules 1 and 2, the cap; review B1, M1,
   * M3). Read only: nothing is saved or sent for a refused one.
   */
  const outcomeRefusal = async (o: Outcome): Promise<string | null> => {
    const digest = outcomeDigest(o);
    const rel = state.release;
    // B1: an outcome already settled in an earlier release never comes back (its messages are stored).
    if (history().some((r) => r.outcome === digest)) return 'that outcome was an earlier release';
    if (o.after === undefined) {
      // B1: past the first release, every outcome is a later one (it names the tx it follows).
      if (history().length > 0 || rel?.after !== undefined) return 'a later release names the tx it follows';
      return null;
    }
    if (o.builder !== 'mod') return 'a later release is moderator-built';
    if (typeof o.after !== 'string' || !TX_HASH.test(o.after)) return 'after is not a tx hash';
    if (rel && rel.outcome === digest) return null; // already this one (a resumed later release)
    let cur = rel;
    if (rel && rel.phase !== 'done') {
      // M1: a first release in progress, exhausted or superseded refuses.
      if (rel.after === undefined) return 'a first release is under way';
      if (rel.committed || rel.phase === 'superseded') return 'a release is under way';
      // Re-verify N2: an uncommitted later release (nothing signed, nothing committed in this
      // attempt) may be replaced, also by one naming another `after`, so one wrong `after` never
      // locks the party to it. The new outcome passes every check a fresh one does, as if the
      // current release were not there: it is dropped (beginRelease), never kept in the history.
      cur = null;
    }
    // Review I1: every later release counts, for every party alike.
    const mine = [...history(), ...(cur ? [cur] : [])];
    if (mine.filter((r) => r.after !== undefined).length >= MAX_LATER_RELEASES) return 'the later-release cap is reached';
    if (mine.length === 0) {
      // No release of its own: this party took no part so far; this is its first. Re-verify N1:
      // `after` must still be a tx in a block, so a made-up hash is refused here and then. A
      // builder also waits, before it exports, until its own wallet shows that `after` spent this
      // escrow (readyToExport), so the first-ever release can never run as a "later" one.
      if (!(await daemon.txSeen(o.after))) return 'after is not a tx in a block';
      return null;
    }
    const own = mine.filter((r) => r.phase === 'done' && r.txHash).map((r) => r.txHash!);
    const latest = own.at(-1)!;
    if (o.after === latest) return null;
    // An older tx of its own is never the latest emptying tx.
    if (own.includes(o.after)) return 'after is not the latest release';
    // M3: a newer tx it took no part in (another trader co-signed it): only as a co-signer, proven
    // before signing (spentBy and txSeen after importing the builder's export). The builder (the
    // moderator, who builds every later release) always names its own latest.
    if (a.role === o.builder) return 'after is not this party\'s latest release';
    // Evidence now, before anything is saved or sent: the daemon has `after` in a block. That it
    // spent this escrow is proven after importing the builder's export, before signing.
    if (!(await daemon.txSeen(o.after))) return 'after is not a tx in a block';
    return null;
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

  /**
   * The tx secret key `key` (the builder's own, saved at build) fits `h` and `h` pays each payout
   * of `o`, out of the pool: every payout receives something (review N-m1: wallet2's check_tx_key
   * answers "good" with 0 received for a key of another tx, so on a dust payout a fee allowance alone
   * proved nothing), and payout 0 is short by at most the tx's own network fee (which buildRelease
   * takes off it; as the moderator's sweepMinimums), itself at most MAX_NETWORK_FEE. A key fits only
   * the tx built with it, so this names "the tx this builder built"; the callers pair it with
   * `spentBy` + `txSeen` (this wallet's escrow spent by `h` in a block, and the daemon has it).
   * Through the wallet's own daemon connection only (txKeyPays, not proveTx: that one reads the
   * daemon through a client that cannot send in the web bundle). False when the engine cannot.
   */
  const keyProof = async (rel: ReleaseState, o: Outcome, h: string): Promise<boolean | 'unavailable'> => {
    const key = rel.txKey;
    if (!session.txKeyPays || key === undefined) return false;
    if (!TX_HASH.test(h)) return false;
    // Review r-m1: the fee this builder saved from buildRelease, else (older state) the daemon's.
    const stored = rel.txFee !== undefined && /^(?:0|[1-9][0-9]{0,30})$/.test(rel.txFee) ? BigInt(rel.txFee) : undefined;
    const r = await bounded('check tx key', () => session.txKeyPays!(h, key, o.to.map((p) => p.address), stored));
    if (r === 'unavailable') return 'unavailable';
    if (r === null || r.inPool || r.received.length !== o.to.length) return false;
    const fee = stored ?? r.feeAtomic;
    if (fee < 0n || fee > MAX_NETWORK_FEE) return false;
    return o.to.every((p, i) => r.received[i]! > 0n && r.received[i]! + (i === 0 ? fee : 0n) >= p.amountAtomic);
  };
  const provenByKey = async (rel: ReleaseState, o: Outcome, h: string): Promise<boolean> => (await keyProof(rel, o, h)) === true;
  /**
   * Review m4: a builder that kept its tx key accepts only its own tx: the key must be checked and
   * fit. A read that failed or was refused ('unavailable') is never taken as proof: the step waits
   * and checks again on the next tick. Only an engine with no key check at all (test doubles)
   * takes the named tx on spentBy + txSeen alone, as before.
   */
  const keyAllows = async (rel: ReleaseState, o: Outcome, h: string): Promise<boolean> => {
    if (rel.part !== 'builder' || rel.txKey === undefined || !session.txKeyPays) return true;
    return (await keyProof(rel, o, h)) === true;
  };

  /** See PartyHandle.landed. Runs in the work queue. */
  const landedNow = async (o: Outcome): Promise<string | null> => {
    const digest = outcomeDigest(o);
    const rel = allReleases().filter((r) => r.outcome === digest).at(-1);
    if (!rel) return null;
    await daemon.sync();
    // Review N-M1 (21 Nov): a DONE is the co-signer's report to the builder. A co-signer's only
    // proof is the tx it signed itself (rel.txHash, whose payouts it checked before signing); a
    // DONE from the builder is never stored (onMessage) and never read here.
    const done = rel.part === 'builder' ? state.received[doneKey(rel)]?.[rel.counterpart]?.payload.txHash : undefined;
    const named = [rel.txHash, done].filter((h): h is string => typeof h === 'string' && TX_HASH.test(h));
    for (const h of new Set(named)) {
      if ((await daemon.spentBy(h)) && (await daemon.txSeen(h)) && (await keyAllows(rel, o, h))) return h;
    }
    if (rel.part !== 'builder' || rel.txKey === undefined || !session.outgoing) return null;
    for (const out of await session.outgoing()) {
      if (out.height === null || named.includes(out.txHash)) continue;
      if ((await daemon.spentBy(out.txHash)) && (await daemon.txSeen(out.txHash)) && (await provenByKey(rel, o, out.txHash))) return out.txHash;
    }
    return null;
  };

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
      // M4: an earlier release's spend.info is exported and sent before this release's first export.
      if (spendInfoRelease() !== null) return;
      let ready: boolean;
      try {
        ready = await readyToExport(o, rel);
      } catch (e) {
        // Re-verify gap (b): a co-signer's export the builder's wallet refuses counts as a refused attempt, not a crash.
        if (!(e instanceof EscrowError) || e.code !== 'payout-mismatch') throw e;
        ignored('build-payout-mismatch');
        await nextAttempt(rel);
        return;
      }
      if (!ready) return;
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
          const { txSet, txKey, feeAtomic } = await session.buildRelease(o.to);
          rel.phase = 'built';
          rel.committed = true;
          rel.txSet = txSet;
          if (txKey !== undefined) rel.txKey = txKey;
          if (feeAtomic !== undefined) rel.txFee = feeAtomic.toString();
          state.sent[txSetKey(rel)] = { txSet };
          await persist(); // the set is saved before it leaves the device; never rebuilt
          // Gap 4 e2e (21 Nov): this party's own export may have reached the co-signer before the
          // co-signer had this release (a seller whose tap comes before the moderator arms the
          // refund): it was ignored there, and only the resend timer (backing off to a minute) would
          // bring it. Send the same saved export again with the set, so the co-signer holds both now
          // and this device's part is done once they leave. A resend of saved content (R26).
          await send(exportKey(rel), [cp]);
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
        // Review B2 (lead): whatever the balance later (late coins may land before this party saw
        // the escrow empty), done once this wallet shows its outputs spent by the reported tx in a
        // block and the daemon has it too. The sync stays: `spentBy` reads the wallet's own view.
        await daemon.sync();
        // Review m4 (20 Nov): and, with this builder's own tx secret key, the tx must be the one it
        // built for this outcome (`provenByKey`), so a co-signer cannot name another spend.
        if ((await daemon.spentBy(txHash)) && (await daemon.txSeen(txHash)) && (await keyAllows(rel, o, txHash))) {
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
      let bound: bigint;
      try {
        await importPeer(exp);
        // A later release's exact match, now that the builder's export is imported (readyToExport),
        // and, for a release this party took no part in, the proof that `after` emptied the escrow.
        if (o.after !== undefined) {
          if (!(await fundsReady(o))) throw new EscrowError('payout-mismatch', 'the escrow does not hold exactly what the outcome pays');
          if (priorDoneTx() !== o.after && history().length > 0 && !((await daemon.spentBy(o.after)) && (await daemon.txSeen(o.after)))) {
            throw new EscrowError('payout-mismatch', 'the release this one follows is not proven');
          }
        }
        await daemon.sync();
        // Check before committing to this set, so a garbage set cannot lock the outcome.
        bound = await session.checkRelease(String(tx.payload.txSet), o.to);
      } catch (e) {
        if (!(e instanceof EscrowError) || !RETRYABLE.has(e.code)) throw e;
        ignored(`cosign-${e.code}`);
        await nextAttempt(rel);
        return;
      }
      rel.phase = 'cosigning';
      rel.committed = true;
      rel.txSet = String(tx.payload.txSet);
      rel.feeCeiling = bound.toString();
      await persist(); // from here on, never sign any other set for this trade
    }
    if (rel.phase === 'cosigning' && rel.txSet) {
      try {
        const stored = rel.feeCeiling !== undefined && /^[1-9][0-9]*$/.test(rel.feeCeiling) ? BigInt(rel.feeCeiling) : undefined;
        const { signedHex, txHash } = await session.signRelease(rel.txSet, o.to, stored);
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
        await daemon.submit(rel.signedHex);
      } catch {
        // Already broadcast (e.g. before a crash) or rejected: only the daemon knows.
        const status = await daemon.txStatus(rel.txHash);
        if (status === 'pool') return; // broadcast; done once it is in a block
        if (status === 'none') {
          // Refused for good once another tx has emptied the escrow: stop, never rebuild or resend.
          if ((await daemon.sync()).balance === 0n) {
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
  /**
   * The done release whose spend.info this party still owes the moderator (one the moderator did
   * not sign; review M4: also once it moved to the history), or null. At most one per trade: every
   * later release is moderator-signed.
   */
  const spendInfoRelease = (): ReleaseState | null => {
    if (a.role === 'mod' || state.sent[SPEND_INFO]) return null;
    return allReleases().filter((r) => r.phase === 'done' && r.counterpart !== 'mod').at(-1) ?? null;
  };

  const offerSpendInfo = async (): Promise<void> => {
    const rel = spendInfoRelease();
    if (!rel) return;
    try {
      await exportSpendInfo(rel);
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

  const exportSpendInfo = async (rel: ReleaseState): Promise<string> => {
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
    await daemon.sync();
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
      state.shown = [...shown, ...fresh.map((o) => ({ txHash: o.txHash, height: o.height, spentAtomic: o.spentAtomic.toString() }))];
      await saveState();
    }
    const out = [...now];
    for (const o of state.shown ?? []) {
      if (!out.some((x) => x.txHash === o.txHash)) out.push({ txHash: o.txHash, height: o.height, spentAtomic: BigInt(o.spentAtomic) });
    }
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
    if (o.after !== undefined && rel && rel.phase === 'done') {
      // A later release (checked by `outcomeRefusal` before it was accepted): the done one is kept in the history.
      state.releases = [...(state.releases ?? []), rel];
      state.release = null;
    } else if (rel && rel.committed) {
      // Once a set was built or accepted for checking under this outcome, it may still complete,
      // so the outcome can no longer be switched.
      throw new PartyError('bad-outcome', 'already signed for another outcome');
    }
    const part = a.role === o.builder ? 'builder' : 'cosigner';
    state.release = {
      outcome: digest,
      ...(o.after !== undefined ? { after: o.after } : {}),
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
        // peerRelease: remembered, never stored or acted on. A set for that outcome stays counted.
        const m = RELEASE_KEY.exec(key);
        if (m && (!rel || m[2] !== tagOf(rel.outcome))) {
          const was = heardElsewhere.get(from);
          heardElsewhere.set(from, { tag: m[2]!, txSet: m[1] === 'release.txset' || (was?.tag === m[2] && was.txSet), at: Date.now() });
        }
        ignored('not-current-release');
        return;
      }
      // Review N-M1 (21 Nov): only a co-signer sends a DONE (it submitted the tx); one from the
      // builder side is dropped, never stored, so no path can read it as proof.
      if (key.startsWith('release.done:') && rel.part !== 'builder') {
        ignored('done-from-builder');
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
      await offerSpendInfo(); // M4: before a later release can export
      if (settleOutcome && state.address !== null && checked()) {
        await beginRelease(settleOutcome);
        await advanceRelease();
      }
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
      if (saved.shown !== undefined && !(Array.isArray(saved.shown) && saved.shown.every(isShownTx))) {
        throw new PartyError('bad-state', 'saved shown sweeps are malformed');
      }
      if (saved.releases !== undefined && !(Array.isArray(saved.releases) && saved.releases.every(isSavedRelease))) {
        throw new PartyError('bad-state', 'saved earlier releases are malformed');
      }
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
      if (o.after !== undefined && (o.builder !== 'mod' || typeof o.after !== 'string' || !TX_HASH.test(o.after))) {
        return Promise.reject(new PartyError('bad-outcome', 'a later release is moderator-built and names the earlier tx'));
      }
      if (a.role !== o.builder && a.role !== o.cosigner) return Promise.resolve(null);
      if (failure) return Promise.reject(failure);
      let mine!: { resolve: (v: string | null) => void; reject: (e: unknown) => void };
      const p = new Promise<string | null>((resolve, reject) => {
        mine = { resolve, reject };
      });
      void run(async () => {
        const rel = state.release;
        let why: string | null;
        try {
          why = await outcomeRefusal(o);
        } catch (e) {
          mine.reject(e); // a daemon that cannot answer now: nothing saved or sent, the caller retries
          return;
        }
        if (why !== null) {
          mine.reject(new PartyError('bad-outcome', why)); // the earlier settle() keeps going
          return;
        }
        const switching = rel !== null && rel.outcome !== outcomeDigest(o) && o.after === undefined;
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
    builderOf(txHash) {
      const r = allReleases().find((x) => x.txHash === txHash && (x.phase === 'signed' || x.phase === 'done' || x.phase === 'superseded'));
      if (!r) return null;
      return r.part === 'builder' ? a.role : r.counterpart;
    },
    settleSent(o) {
      const rel = (state as PartyState | undefined)?.release ?? null;
      if (!rel || rel.outcome !== outcomeDigest(o)) return false;
      if (rel.phase === 'done') return true;
      return rel.part === 'builder' && rel.phase === 'built' && state.received[doneKey(rel)]?.[rel.counterpart] !== undefined;
    },
    acceptedOutcome() {
      const o = settleOutcome;
      return o === null ? null : { ...o, to: o.to.map((p) => ({ ...p })) };
    },
    peerRelease(from) {
      const rel = (state as PartyState | undefined)?.release ?? null;
      const tag = rel === null ? null : `:${tagOf(rel.outcome)}.`;
      const current = tag !== null && Object.entries((state as PartyState | undefined)?.received ?? {}).some(([k, slot]) => RELEASE_KEY.test(k) && k.includes(tag) && slot?.[from] !== undefined);
      const e = heardElsewhere.get(from);
      return { current, elsewhere: e === undefined ? null : { ...e } };
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
            const { balance, unlocked } = await daemon.sync();
            const incoming = await session.incoming();
            const extra: Omit<Funds, 'balance' | 'unlocked' | 'incoming'> = {};
            if (session.chainHeight) extra.chainHeight = await session.chainHeight();
            if (session.outgoing) extra.outgoing = await session.outgoing();
            if (a.role === 'mod') {
              extra.spendClaims = [...(state.claims ?? [])];
              if (extra.outgoing) extra.outgoing = await shownOutgoing(extra.outgoing);
              // The txs this mod signed, in every release of this escrow (late-funds step 1: the earlier
              // ones too). 'superseded' counts too (review round 2, R2-M3): the mod signed that tx, so if
              // it is in the wallet's outgoing view at all it landed after all and is the mod's own spend
              // of this escrow; while it has not landed it is not in `outgoing` and so never reaches the watcher.
              extra.ownTxs = [...(state.releases ?? []), ...(state.release ? [state.release] : [])]
                .filter((r) => r.txHash !== undefined && (r.phase === 'signed' || r.phase === 'done' || r.phase === 'superseded'))
                .map((r) => r.txHash!);
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
          const owed = spendInfoRelease();
          if (owed === null) return reject(new PartyError('bad-state', 'no release of this party is done'));
          try {
            resolve(await exportSpendInfo(owed));
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
    landed(o) {
      return new Promise((resolve, reject) => {
        chain = chain.then(async () => {
          if (stopped) return reject(new PartyError('stopped'));
          if (failure && (failure instanceof PartyError || !session)) return reject(failure); // as funds(): no peer needed
          try {
            resolve(await landedNow(o));
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
            const r = await bounded('prove tx', () => session.proveTx!(txHash, txKey, minimums.map((m) => m.address)));
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
