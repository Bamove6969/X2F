/**
 * The escrow runtime for one device: everything `useEscrow` drives, run inside the worker.
 *
 * Per trade: make (once) and store the trade identity and the R27 wallet password, register the
 * identity with its proof, poll the attestation, verify it against the pinned moderation key
 * (any failure: `participants-mismatch`, stop, the party never runs), exchange signed
 * trade.terms on the signals channel, then run `runParty` with the attested participants. A
 * loop reads the trade view and this device's own `funds()`, keeps the trade's size from its
 * own reading (deviceAmount), and settles only outcomes that pass `cosignPolicy`. Everything is
 * saved before it is acted on, so a reload resumes from the store and settles the same outcome
 * (Review Focus 1). One tab at a time runs a trade (a Web Lock per trade), because two
 * parties signing from the same saved nonces would leak the key share (R26).
 */
import { normalizeTradeCode, type Role } from '@x2f/core';
import { EscrowError, PartyError, TransportClosedError, type EscrowEngine, type Outcome, type PartyArgs, type PartyHandle, type Payout, type Transport } from '@x2f/escrow';
import type { Identity, Participants } from '@x2f/protocol';
import {
  AttestationError,
  channelFor,
  escrowCheckWords,
  fiatCents,
  identityProofBytes,
  verifyAttestation,
  type Attestation,
  type AttestedTerms,
  type SettleKind,
  type TradeState,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { parseTradeView, type EscrowTradeView } from './adapters.js';
import { cosignPolicy, deviceAmount, outcomeFor, type Deal, type PolicyContext } from './policy.js';
import { runSignals, sameDeal, type SignalsHandle, type UserSignal } from './signals.js';
import type { EscrowRecord, EscrowStore, StoredIntent } from './store.js';

/**
 * `settled-without-device`: the trade closed with the escrow emptied by the other two parties, in
 * a way that needed nothing from this device (see EscrowRecord.settledWithoutDevice). Not an error.
 */
export type EscrowPhase = 'idle' | 'registering' | 'verifying' | 'setting-up' | 'ready' | 'signing' | 'done' | 'settled-without-device' | 'error';
/**
 * `participants-mismatch` is the plan's; the others are additions: the API or the moderator's
 * attestation disagrees with what the user confirmed (`deal-mismatch`, checked again on every
 * start, never kept), the party failed (a peer reported another escrow address, or the store
 * could not save), or the browser has no Web Locks.
 */
export type EscrowErrorCode = 'participants-mismatch' | 'deal-mismatch' | 'not-confirmed' | 'escrow-failed' | 'unsupported-browser';

/**
 * What the user saw and confirmed on this device when the trade started (the take or accept
 * screens, Tasks 18/19): their role, their own address (buyer payout / seller refund) and the
 * deal. It is the only source of what this device signs in trade.terms; the API's TradeView is
 * only checked against it, and any difference stops the trade before anything is signed.
 */
export interface ConfirmedTrade {
  role: 'buyer' | 'seller';
  ownAddress: string;
  deal: Deal;
}

/**
 * Something this device refuses for now without stopping the trade, shown to the user (never
 * silent). `amount-out-of-range`: the API's trade amount is below the amount at take or above
 * what this device worked out from its own escrow reading, so nothing is settled until it is
 * back in range (Plan 3 Revision 2026-10-24, starter caps; lead 2026-10-24). `amount-changed`:
 * this device already fixed the amount (paid, or an outcome handed to the party) and the API now
 * shows another one; nothing is signed until it shows the fixed amount again.
 * `paid-amount-refused` (seller, for good): the buyer's signed trade.paid has a total that does
 * not fit its amount, an amount below the take amount, or differs from an earlier trade.paid; no
 * release is signed. `paid-amount-waiting` (seller): the signed amount is above what this device's
 * own escrow reading supports yet; it is fixed as soon as the reading catches up. `amount-unknown`
 * (buyer): this device knows of "I've paid" but holds no fixed amount (a record from before the
 * field, or a paid state it never tapped); no release is signed. Refunds are never refused for
 * an amount (they pay the whole balance to the seller's signed address whatever the amount).
 * `attempts-exhausted`: the party used up its settlement attempts for the current outcome; it is
 * not retried (the trade needs a dispute or another outcome). `view-mismatch`: the API's trade
 * view disagrees with the deal this device signed (role, poster, currency, rate or maximum);
 * nothing is settled while it does, and the trade goes on once the view is right again (a lying
 * or drifting API never stops the device's key share for good).
 */
export type EscrowRefusal = 'amount-out-of-range' | 'amount-changed' | 'paid-amount-refused' | 'paid-amount-waiting' | 'amount-unknown' | 'attempts-exhausted' | 'view-mismatch';

export interface EscrowStatus {
  phase: EscrowPhase;
  error: EscrowErrorCode | null;
  /**
   * The error may be transient (a daemon or relay error, a failed save, a party that stopped
   * for a reason that is not an integrity failure): `retry()` (or a reload) runs the trade again,
   * and refunds stay possible. False for integrity failures, which are kept and stay stopped.
   */
  retryable: boolean;
  refusal: EscrowRefusal | null;
  checkWords: string[] | null;
  keepOpen: boolean;
  role: 'buyer' | 'seller' | null;
  /**
   * The trade amount this device will accept for a release right now, and its fiat total at the
   * locked rate: the amount a release is bound to (I1), else the fixed one (I2), else the API's
   * amount within [take, this device's own size]; null when none fits. The trade screens (Tasks
   * 18/19) show ONLY this as the sum to pay, never the API's amount (review 2026-10-26, I3).
   */
  amountAtomic: bigint | null;
  fiatCents: bigint | null;
  /**
   * The multisig address THIS device's party derived and confirmed (`party.ready()`, the address
   * the check words are computed from), or null until then. The only address the funding screen
   * (Task 22's TradeFund) shows or puts in a wallet link; the API's address is only compared with it.
   */
  escrowAddress: string | null;
  /** The deal this device stored from what the user confirmed (never the API's), or null before the record exists. */
  deal: Deal | null;
  /**
   * Buyer only: this device recorded the buyer's own "I've paid" (the tap fixed the amount, saved
   * before `trade.paid` left). False for the seller, and for a buyer that knows of paid only from
   * the API (then `refusal` is `amount-unknown`, and the tap must be finished on this device).
   * "Marked as paid" reads this (Task 23 review 2026-10-27, I2/I3; there is no ack of trade.paid).
   */
  paidRecorded: boolean;
  /**
   * The settle the user TAPPED on this device and that is saved (`buyer-cancel`, `mutual-cancel`,
   * `release`, a refund), done or not; null when there is none or the runtime chose it itself.
   * A screen offering "Try again" for a tap compares this with what the trade view asks for: the
   * same kind means the tap is saved and only waits (for unlocked coins, the other side), so there
   * is nothing to try again (Task 23 round 2, Minor 1).
   */
  intentKind: SettleKind | null;
  /**
   * The escrow `balance` exactly as this device's party read it with `funds()` on the last tick
   * (the wallet's own figure), or null until the first reading. Before any settlement it is what
   * has arrived; after one it falls to what is left.
   */
  receivedAtomic: bigint | null;
  /**
   * The sum of `funds().incoming[].amountAtomic` with `confirmations >= 1`, from the same reading
   * as `receivedAtomic`, or null until the first reading. It counts arrivals only (spends never
   * lower it), so it can exceed `balance` once the escrow paid out; it leaves out pool (0-conf)
   * payments, whatever the wallet engine counts in `balance`.
   * TradeFund sets its `funded` mark for good only from this (a 0-conf tx can be dropped).
   */
  confirmedAtomic: bigint | null;
}

export type EscrowAction =
  | { type: 'release' }
  | { type: 'build-refund' }
  | { type: 'buyer-cancel' }
  | { type: 'propose-cancel-sign' }
  /** The buyer's "I've paid", with the fiat total the buyer confirmed (the device checks it). */
  | { type: 'paid'; fiatCents: bigint }
  | { type: 'signal'; signal: Exclude<UserSignal, 'trade.paid'> };

/** The API calls the runtime makes (Tasks 6 and 8 routes). */
export interface EscrowApi {
  getTrade(code: string): Promise<unknown>;
  /** POST /v1/trades/:code/identity; 409 identity-exists counts as registered. */
  registerIdentity(code: string, body: { signPublic: string; boxPublic: string; proof: string }): Promise<void>;
  /** GET /v1/trades/:code/attestation; null while it answers 202. */
  getAttestation(code: string): Promise<{ attestation: unknown; sig: unknown } | null>;
}

export interface RuntimeConfig {
  modSigningPublic: string;
  feeWallet: string;
  relayUrl: string;
  daemonUri: string;
}

export interface RuntimeDeps {
  api: EscrowApi;
  store: EscrowStore;
  config: RuntimeConfig;
  engine: EscrowEngine;
  /** Makes a fresh trade identity (the worker passes the protocol's; only the worker may name it). */
  newIdentity(): Promise<Identity>;
  runParty(a: PartyArgs): PartyHandle;
  transport(a: { url: string; code: string; role: Role; me: Identity }): Transport;
  /** Runs `fn` holding an exclusive lock `name` (navigator.locks by default). */
  lock?: (name: string, fn: () => Promise<void>) => Promise<void>;
  pollMs?: number;
  /** The device clock in ms (Date.now by default); only for the after-close keep rules. */
  now?: () => number;
  /**
   * How long a closed, emptied escrow may wait for this device's own settle to resolve before
   * it counts as settled elsewhere (escrow-failed). Default 5 min: the party re-checks within 60 s.
   */
  settledElsewhereMs?: number;
  onStatus(code: string, s: EscrowStatus): void;
}

export interface EscrowRuntime {
  /** `confirmed` is required the first time (no stored record); a resume needs none. */
  start(code: string, confirmed?: ConfirmedTrade): Promise<void>;
  /** Starts every trade in the store (page load). */
  resumeAll(): Promise<void>;
  act(code: string, action: EscrowAction): Promise<void>;
  /** Runs a trade stopped by a retryable error again (from its stored record). */
  retry(code: string): Promise<void>;
  stop(code: string): Promise<void>;
  stopAll(): Promise<void>;
}

const CLOSED: readonly TradeState[] = ['released', 'refunded', 'cancelled'];
/** The escrow store outlives the trade by at least this long (lead 2026-10-24). */
export const KEEP_AFTER_CLOSE_MS = 30 * 24 * 60 * 60 * 1000;
const GROW_STATES: readonly TradeState[] = ['funding', 'securing', 'secured'];
/** Where a seller still waiting to fix the signed paid amount keeps reading its own size (I2). */
const SELLER_WAIT_STATES: readonly TradeState[] = ['paid', 'settling', 'refund_requested'];
const BUYER_RELEASE_STATES: readonly TradeState[] = ['secured', 'paid', 'settling', 'refund_requested'];
/** Where a mutual cancel can be proposed (Task 2 CANCEL_STATES) and the buyer may cancel alone before settling. */
const CANCEL_STATES: readonly TradeState[] = ['funding', 'securing', 'secured', 'paid'];
const BUYER_CANCEL_STATES: readonly TradeState[] = ['funding', 'securing', 'secured', 'paid', 'refund_requested'];

/**
 * Whether the trade view still supports a choice the user tapped. While the trade is settling,
 * only the kind it is settling; otherwise mutual cancel needs a standing proposal, the seller's
 * release needs secured or paid, and each refund its own state. A tap the view no longer
 * supports gives way to the automatic choice (a buyer who proposed a cancel and then paid
 * co-signs the release).
 */
export function viewSupports(kind: SettleKind, v: Pick<EscrowTradeView, 'state' | 'settling' | 'cancelProposedBy'>): boolean {
  if (v.state === 'settling') return v.settling === kind;
  switch (kind) {
    case 'mutual-cancel':
      return v.cancelProposedBy !== null && CANCEL_STATES.includes(v.state);
    case 'buyer-cancel':
      return BUYER_CANCEL_STATES.includes(v.state);
    case 'release':
      return v.state === 'secured' || v.state === 'paid';
    case 'auto-refund':
      return v.state === 'refund_requested';
    case 'lapse-refund':
      return v.state === 'lapsed';
  }
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
/** The API's error code on a thrown httpEscrowApi error (`{ status, code }`), if any. */
const apiCode = (e: unknown): string | null =>
  typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : null;
const sumOf = (to: readonly Payout[]): bigint => to.reduce((s, p) => s + p.amountAtomic, 0n);
const key = (o: { to: readonly Payout[]; builder: string; cosigner: string } | null): string =>
  o === null ? '' : JSON.stringify([o.builder, o.cosigner, o.to.map((p) => [p.address, p.amountAtomic.toString()])]);

function validConfirmed(c: ConfirmedTrade): boolean {
  const d = c.deal;
  return (
    (c.role === 'buyer' || c.role === 'seller') &&
    typeof c.ownAddress === 'string' &&
    c.ownAddress.length > 0 &&
    c.ownAddress.length <= 256 &&
    (d.poster === 'buyer' || d.poster === 'seller') &&
    typeof d.currency === 'string' &&
    /^[A-Z]{3}$/.test(d.currency) &&
    [d.takeAmountAtomic, d.centsPerXmr, d.maxFiatCents].every((x) => typeof x === 'bigint' && x > 0n)
  );
}

/**
 * The fixed parts of the TradeView agree with this device's deal (the amount may grow; the policy
 * checks it). The own payout address is not compared here: the view does not carry it. It is
 * verified through the attestation (`wrong-terms`) and at the settle points, never from the API view.
 */
function viewMatches(v: EscrowTradeView, role: 'buyer' | 'seller', d: Deal): boolean {
  return (
    v.role === role &&
    v.poster === d.poster &&
    v.currency === d.currency &&
    v.centsPerXmr === d.centsPerXmr &&
    v.maxFiatCents === d.maxFiatCents
  );
}

/** Party failures that mean someone cheated or the escrow is gone: never retried. */
function integrityError(e: unknown): boolean {
  return e instanceof PartyError && (e.code === 'equivocation' || e.code === 'address-mismatch' || e.code === 'settled-elsewhere');
}

function navigatorLock(name: string, fn: () => Promise<void>): Promise<void> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return Promise.reject(new Error('unsupported-browser'));
  return locks.request(name, { mode: 'exclusive' }, fn);
}

export function createEscrowRuntime(deps: RuntimeDeps): EscrowRuntime {
  const pollMs = deps.pollMs ?? 5000;
  const now = deps.now ?? (() => Date.now());
  const settledElsewhereMs = deps.settledElsewhereMs ?? 5 * 60 * 1000;
  const lock = deps.lock ?? navigatorLock;
  const runs = new Map<string, TradeRun>();

  class TradeRun {
    stopped = false;
    private wake: (() => void) | null = null;
    private rec!: EscrowRecord;
    private saving: Promise<void> = Promise.resolve();
    private party: PartyHandle | null = null;
    private signals: SignalsHandle | null = null;
    private participants: Participants | null = null;
    /** The moderator-attested terms, from the attestation verified in this run. */
    private attested: AttestedTerms | null = null;
    private view: EscrowTradeView | null = null;
    private isReady = false;
    private words: string[] | null = null;
    /** The address `party.ready()` resolved with (EscrowStatus.escrowAddress). */
    private address: string | null = null;
    /** The last `funds()` reading (EscrowStatus.receivedAtomic / confirmedAtomic). */
    private reading: { balance: bigint; confirmed: bigint } | null = null;
    error: EscrowErrorCode | null = null;
    retryable = false;
    private refusal: EscrowRefusal | null = null;
    /** The party gave up on these outcomes (attempts used up); shown, never retried silently. */
    private exhausted = new Set<string>();
    private phase: EscrowPhase = 'idle';
    private last = '';
    /** The settle() call in flight, by outcome key. */
    private inflight: string | null = null;
    /** Outcomes the party refused because another was already committed. */
    private refused = new Set<string>();
    private ticking: Promise<void> = Promise.resolve();
    /** Device clock when the escrow was first seen emptied while this device's settle was still open. */
    private emptiedWhileSettling: number | null = null;
    /**
     * The party's relay connection ended for good (the relay closes a trade's channels when the
     * trade ends, Task 7: 4404; or refused this role). Judged in tick against the view: expected
     * once the trade is closed, a retryable failure while it is open.
     */
    private relayClosed = false;
    readonly finished: Promise<void>;
    private finish!: () => void;
    acquired!: Promise<void>;
    /** The lock callback entered: the run is (or was) running and `ended` will resolve. */
    entered = false;
    /** Resolves once the run has returned and every save it started is stored. */
    readonly ended: Promise<void>;
    markEnded!: () => void;

    constructor(
      readonly code: string,
      private readonly confirmed: ConfirmedTrade | undefined,
    ) {
      this.finished = new Promise((r) => (this.finish = r));
      this.ended = new Promise((r) => (this.markEnded = r));
    }

    emit(): void {
      const amountAtomic = this.deviceAcceptedAmount();
      const s: EscrowStatus = {
        phase: this.error ? 'error' : this.phase,
        error: this.error,
        retryable: this.error ? this.retryable : false,
        refusal: this.error ? null : this.refusal,
        checkWords: this.words,
        keepOpen: ['registering', 'verifying', 'setting-up', 'signing'].includes(this.phase) && !this.error,
        role: this.rec?.role ?? null,
        amountAtomic,
        fiatCents: amountAtomic === null ? null : fiatCents(amountAtomic, { currency: this.rec.deal.currency, centsPerXmr: this.rec.deal.centsPerXmr }),
        escrowAddress: this.address,
        deal: (this.rec as EscrowRecord | undefined)?.deal ?? null,
        paidRecorded: this.rec?.role === 'buyer' && this.rec.paidSeen === true && (this.rec.acceptedAtomic ?? null) !== null,
        intentKind: (() => {
          const i = (this.rec as EscrowRecord | undefined)?.intent ?? null;
          return i !== null && !i.auto ? i.kind : null;
        })(),
        receivedAtomic: this.reading?.balance ?? null,
        confirmedAtomic: this.reading?.confirmed ?? null,
      };
      const j = JSON.stringify(s, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
      if (j !== this.last) {
        this.last = j;
        deps.onStatus(this.code, s);
      }
    }

    private set(p: EscrowPhase): void {
      this.phase = p;
      this.emit();
    }

    /** See EscrowStatus.amountAtomic: bound, else fixed, else the API's amount within [take, own size], else null. */
    private deviceAcceptedAmount(): bigint | null {
      const r = this.rec as EscrowRecord | undefined;
      if (!r) return null;
      const bound = r.releaseBoundAtomic ?? null;
      if (bound !== null) return bound;
      const fixed = r.acceptedAtomic ?? null;
      if (fixed !== null) return fixed;
      const v = this.view;
      if (!v || r.paidRefused === true) return null;
      return v.amountAtomic >= r.deal.takeAmountAtomic && v.amountAtomic <= r.sizeAtomic ? v.amountAtomic : null;
    }

    /**
     * Stops the trade on this device. Integrity failures (participants mismatch, and an
     * escrow-failed the caller marks `integrity`: the party's own) are kept in the record, so a
     * reload stops again and nothing retries them. Every other escrow-failed is transient: kept in
     * memory only and shown as retryable. A deal mismatch is neither: it is found again on the
     * next start from the attestation or the API, so nothing is kept (review 2026-10-26, I2).
     */
    fail(e: EscrowErrorCode, o: { integrity?: boolean } = {}): void {
      const integrity = e === 'participants-mismatch' || (e === 'escrow-failed' && o.integrity === true);
      this.error = e;
      this.retryable = e === 'escrow-failed' && !integrity;
      this.emit();
      if (integrity && this.rec && !this.stopped && this.rec.failed !== e) {
        this.rec.failed = e as NonNullable<EscrowRecord['failed']>;
        this.persist().catch(() => undefined);
      }
    }

    /**
     * Stores a snapshot of the record; resolves once it is stored. Saves never reorder. A stopped
     * run never writes again: another tab may hold the lock by now, and a late write would
     * replace its newer state (R26). Its callers stop instead of acting on an unsaved state.
     */
    persist(): Promise<void> {
      if (this.stopped) return Promise.reject(new Error('escrow run stopped'));
      const snap = structuredClone(this.rec);
      const p = this.saving.then(() => deps.store.save(snap));
      this.saving = p.catch(() => undefined);
      return p;
    }

    private sleep(ms: number): Promise<void> {
      return new Promise((r) => {
        const t = setTimeout(() => {
          this.wake = null;
          r();
        }, ms);
        this.wake = () => {
          clearTimeout(t);
          this.wake = null;
          r();
        };
      });
    }

    poke(): void {
      this.wake?.();
    }

    /** Retries an API call until it answers or the run stops. */
    private async retry<T>(fn: () => Promise<T>): Promise<T | undefined> {
      while (!this.stopped) {
        try {
          return await fn();
        } catch {
          await this.sleep(pollMs);
        }
      }
      return undefined;
    }

    async run(): Promise<void> {
      const loaded = await deps.store.load(this.code);
      if (loaded) {
        this.rec = loaded;
        // A deal mismatch kept by a record from before the fix of 2026-10-26 (one bad view or
        // trade.terms stopped the device for good) is dropped: it is checked again below.
        if (loaded.failed === 'deal-mismatch') loaded.failed = null;
        if (loaded.failed) return this.fail(loaded.failed, { integrity: true }); // stopped for good before: stays stopped
      }
      else {
        const view = await this.retry(async () => {
          const v = parseTradeView(await deps.api.getTrade(this.code));
          if (!v) throw new Error('unreadable trade view');
          return v;
        });
        if (!view) return;
        const c = this.confirmed;
        if (!c) return this.fail('not-confirmed');
        if (!validConfirmed(c)) return this.fail('not-confirmed');
        // The API must agree with what the user confirmed, or nothing is made, registered or signed.
        if (!viewMatches(view, c.role, c.deal) || view.amountAtomic !== c.deal.takeAmountAtomic) return this.fail('deal-mismatch');
        const id = await deps.newIdentity();
        this.rec = {
          v: 1,
          code: this.code,
          role: c.role,
          identity: { signPublic: id.signPublic, boxPublic: id.boxPublic, signSecret: id.signSecret, boxSecret: id.boxSecret },
          registered: false,
          attestation: null,
          partyState: null,
          signalGuard: null,
          signalSeq: 0,
          ownAddress: c.ownAddress,
          theirAddress: null,
          deal: { ...c.deal },
          theirDeal: null,
          sizeAtomic: c.deal.takeAmountAtomic,
          paidSeen: false,
          termsAcked: false,
          intent: null,
          fundedSeen: false,
        };
        await this.persist(); // the identity is stored before the API ever sees it
      }
      const password = await deps.store.createPassword(this.code);
      const me: Identity = { ...this.rec.identity };

      if (!this.rec.registered) {
        this.set('registering');
        await sodium.ready;
        const proof = toHex(sodium.crypto_sign_detached(identityProofBytes(this.code, this.rec.role, me.signPublic, me.boxPublic), me.signSecret));
        // 409 identity-conflict (the other slot already holds this key) is final: never retried.
        const ok = await this.retry(() =>
          deps.api.registerIdentity(this.code, { signPublic: me.signPublic, boxPublic: me.boxPublic, proof }).then(
            () => true,
            (e: unknown) => {
              if (apiCode(e) === 'identity-conflict') return false;
              throw e;
            },
          ),
        );
        if (ok === undefined) return;
        if (!ok) return this.fail('participants-mismatch');
        this.rec.registered = true;
        await this.persist();
      }

      this.set('verifying');
      let att = this.rec.attestation;
      while (!att && !this.stopped) {
        // 409 attestation-refused (the moderation service refused the trade's identities) is final.
        // 409 trade-closed (the trade closed before any attestation, review M2) is final too.
        const got = await this.retry(() =>
          deps.api.getAttestation(this.code).catch((e: unknown) => {
            const c = apiCode(e);
            if (c === 'attestation-refused') return 'refused' as const;
            if (c === 'trade-closed') return 'closed' as const;
            throw e;
          }),
        );
        if (got === undefined) return;
        if (got === 'refused') return this.fail('participants-mismatch');
        if (got === 'closed') return this.closedUnattested();
        if (got === null) await this.sleep(pollMs);
        else att = { attestation: got.attestation, sig: typeof got.sig === 'string' ? got.sig : '' };
      }
      if (!att || this.stopped) return;
      // Fail closed: no own address means nothing this device could sign terms for.
      if (this.rec.ownAddress === null || this.rec.ownAddress === '') return this.fail('deal-mismatch');
      try {
        await verifyAttestation(
          att.attestation as Attestation,
          att.sig,
          deps.config.modSigningPublic,
          { trade: this.code, role: this.rec.role, signPublic: me.signPublic, boxPublic: me.boxPublic, deal: this.rec.deal, ownAddress: this.rec.ownAddress },
        );
      } catch (e) {
        // stop: no terms, no party, no funding address
        this.fail(e instanceof AttestationError && e.code === 'wrong-terms' ? 'deal-mismatch' : 'participants-mismatch');
        return;
      }
      const attestation = att.attestation as Attestation;
      this.participants = attestation.participants;
      // verifyAttestation refused a trade attestation without terms, so they are here.
      if (attestation.terms === undefined) return this.fail('participants-mismatch');
      this.attested = attestation.terms;
      if (!this.rec.attestation) {
        this.rec.attestation = att;
        await this.persist();
      }
      // The counterparty's terms are the attested ones or none: a record that adopted others
      // (written before the fix of 2026-10-26) waits for the attested terms again.
      const attestedTheirAddress = this.rec.role === 'buyer' ? this.attested.sellerRefund : this.attested.buyerPayout;
      if (this.rec.theirAddress !== null && (this.rec.theirAddress !== attestedTheirAddress || !this.rec.theirDeal || !sameDeal(this.rec.deal, this.rec.theirDeal))) {
        this.rec.theirAddress = null;
        this.rec.theirDeal = null;
        await this.persist();
      }

      const ownAddress = this.rec.ownAddress;
      const [escrowChannel, signalsChannel] = await Promise.all([channelFor(this.code, 'escrow'), channelFor(this.code, 'signals')]);
      const role = this.rec.role;
      this.signals = runSignals({
        channel: signalsChannel,
        role,
        me,
        participants: this.participants,
        transport: deps.transport({ url: deps.config.relayUrl, code: signalsChannel, role, me }),
        state: {
          guard: this.rec.signalGuard ?? { trade: signalsChannel, seen: {} },
          seq: this.rec.signalSeq,
          theirAddress: this.rec.theirAddress,
          theirDeal: this.rec.theirDeal,
          termsAcked: this.rec.termsAcked,
        },
        ownAddress,
        deal: this.rec.deal,
        attestedTheirAddress,
        save: async (s) => {
          this.rec.signalGuard = s.guard;
          this.rec.signalSeq = s.seq;
          this.rec.theirAddress = s.theirAddress;
          this.rec.theirDeal = s.theirDeal;
          this.rec.termsAcked = s.termsAcked;
          await this.persist();
        },
        // Folded into the record before the signals state is saved: one save holds both.
        absorb: (type, from, p) => {
          if (type === 'trade.paid' && from === 'buyer' && this.rec.role === 'seller') this.absorbPaid(p.amountAtomic as bigint, p.fiatCents as bigint);
        },
        onSignal: () => this.poke(),
      });

      this.set('setting-up');
      this.party = deps.runParty({
        role,
        trade: escrowChannel,
        me,
        participants: this.participants,
        transport: deps.transport({ url: deps.config.relayUrl, code: escrowChannel, role, me }),
        engine: deps.engine,
        daemonUri: deps.config.daemonUri,
        password,
        store: {
          load: async () => this.rec.partyState,
          save: async (s) => {
            this.rec.partyState = s;
            await this.persist();
          },
        },
      });
      this.party.ready().then(
        async (address) => {
          this.words = await escrowCheckWords(this.participants!, address);
          this.address = address;
          this.isReady = true;
          this.refresh();
          this.poke();
        },
        (e: unknown) => this.partyFailed(e),
      );

      // A stored outcome goes back to the party first (through the policy, over its own sum),
      // so a resumed party carries on with exactly the outcome it was settling.
      await this.loadView();
      const intent = this.rec.intent;
      if (intent?.outcome && !intent.done) this.settle(this.fromStored(intent.outcome));

      while (!this.stopped) {
        await this.tickOnce();
        if (this.stopped) break;
        await this.sleep(pollMs);
      }
    }

    private fromStored(o: NonNullable<StoredIntent['outcome']>): Outcome {
      return { kind: 'release', to: o.to.map((p) => ({ address: p.address, amountAtomic: p.amountAtomic })), builder: o.builder, cosigner: o.cosigner };
    }

    tickOnce(): Promise<void> {
      // A tick that throws (a save that failed, most likely) left the record's memory copy ahead
      // of the store: nothing is settled on it. Shown as retryable; retry() reloads the stored record.
      this.ticking = this.ticking
        .then(() => this.tick())
        .catch(() => {
          if (!this.stopped && !this.error) this.fail('escrow-failed');
        });
      return this.ticking;
    }

    /** The policy context for this device right now, or null while the terms are incomplete. */
    /**
     * `refundOnly`: the outcome pays the whole balance to the seller's signed refund address, which
     * does not depend on the trade amount, so the API's amount is not consulted (an amount lie
     * never blocks a refund or cancel); the device's own size is used for the policy's maths.
     */
    private context(balance: bigint, refundOnly = false): PolicyContext | null {
      const v = this.view;
      const r = this.rec;
      if (!v || r.ownAddress === null || r.theirAddress === null || !r.theirDeal || !sameDeal(r.deal, r.theirDeal) || !this.theirAddressAttested()) return null;
      const size = refundOnly ? (r.acceptedAtomic ?? r.sizeAtomic) : this.acceptedAmount(v);
      if (size === null) return null;
      const payout = r.role === 'buyer' ? r.ownAddress : r.theirAddress;
      const refund = r.role === 'seller' ? r.ownAddress : r.theirAddress;
      return {
        role: r.role,
        own: r.role === 'buyer' ? { payout: r.ownAddress } : { refund: r.ownAddress },
        balance,
        trade: { state: v.state, poster: v.poster, amountAtomic: refundOnly ? size : v.amountAtomic, feeWallet: deps.config.feeWallet },
        deal: { poster: r.deal.poster, amountAtomic: size },
        signedTerms: { payout, refund },
      };
    }

    // ── The trade amount: invariants (each has a test in test/attestation-flow.test.ts) ──
    //
    // I1 Release binding. A release is signed for one amount only: the amount of the FIRST release
    //    this device handed to its party (releaseBoundAtomic, saved before the hand-over, never
    //    cleared by an intent change). A release for another amount is refused ('amount-changed'),
    //    and so is an "I've paid" tap for another amount. Refunds ignore it. Accepted cost: a real
    //    top-up after the first hand-over cannot be paid for (follow-up in docs/coordination.md).
    //    Tests: "a release handed over before paid binds its amount" (incl. reload), "I1: ... flips
    //    secured, lapsed, secured with a lower amount".
    // I2 Paid fixes the amount (acceptedAtomic). Buyer: only at its own tap, to the API amount if
    //    it lies in [take, this device's size], its fiat at the locked rate equals the total the
    //    buyer confirmed, and it equals any bound release; saved before trade.paid leaves. Seller:
    //    only from the buyer's signed trade.paid amount, folded into the same save as the signal's
    //    replay guard, never from the API: a total that fits and an amount >= take is kept pending
    //    and fixed once <= its own size (growth keeps running until then, 'paid-amount-waiting');
    //    a total that does not fit, an amount below take or a second different trade.paid is
    //    'paid-amount-refused' for good. Tests: "fixed by the tap itself", "a fiat total other than",
    //    "I2: a seller whose wallet saw the extra coins only after", "I2: a second, different",
    //    "the seller fixes the amount from the buyer's signed trade.paid", "a seller that sees paid
    //    in its API view first", "a signed trade.paid outside the seller's range".
    // I3 Once fixed, a release needs the view's amount to equal it ('amount-changed' otherwise),
    //    across reloads. Tests: "the API lowers / raises the amount after paid", "survives a reload".
    // I4 Without a fixed amount: the seller releases nothing ('amount-unknown'); a buyer that knows
    //    of paid releases nothing ('amount-unknown'); only a buyer before paid co-signs a release,
    //    within [take, its size] ('amount-out-of-range' outside). Tests: "the seller signs no
    //    release without the buyer's signed amount", "a buyer that knows of paid only from the
    //    API", "growth and starter caps".
    // I5 Refunds never depend on the amount: a refund-shaped outcome (the whole balance to the
    //    seller's signed refund address) uses this device's own size, never the API amount, is
    //    never bound and never refused for an amount. Tests: "an API amount lie never blocks a
    //    refund", "a hand-over before paid fixes nothing", the refund part of the I1 test.
    // I6 Growth only from this device's own funds(), only before it knows of paid.
    //    Tests: "no growth once this device knows of I've paid", "growth and starter caps".
    // I7 Missing or unknown fields fail closed: no acceptedAtomic means I4's refusals; a record
    //    without fundedSeen is unknown, never never-funded. Tests: I4's, "fail closed: a record
    //    without fundedSeen".
    // I8 Crash or reload at any step: every fixed or bound value is in the AES-GCM record (AAD
    //    bound to store and trade) before the action it guards (the tap's fix before trade.paid,
    //    releaseBoundAtomic before settle(), the seller's pending amount with the signal guard, the buyer-cancel
    //    intent before trade.cancel). Tests: the reload checks above, "buyerCancel saves its
    //    intent before trade.cancel leaves", "AAD binding" (escrow-store.test.ts).

    /**
     * The trade's size for a release (I1-I4): the fixed amount if there is one (the view must
     * equal it); otherwise, only for a buyer before paid, the API's amount within [take, this
     * device's size] (growth may stop lower, at the offer maximum or a starter cap the device does
     * not know), never above it. Otherwise null.
     */
    private acceptedAmount(v: EscrowTradeView): bigint | null {
      const r = this.rec;
      if (r.paidRefused === true) return null;
      const fixed = r.acceptedAtomic ?? null;
      if (fixed !== null) return v.amountAtomic === fixed ? fixed : null;
      // Fail closed (I1, I7): the seller releases only the amount the buyer's signed trade.paid
      // fixed; a buyer that knows of "I've paid" settles only an amount it fixed itself.
      if (r.role === 'seller' || r.paidSeen) return null;
      return v.amountAtomic >= r.deal.takeAmountAtomic && v.amountAtomic <= r.sizeAtomic ? v.amountAtomic : null;
    }

    /**
     * The seller's side of "I've paid": the buyer's signed amount and total, never the API's view.
     * The first trade.paid wins. A total that does not fit the amount at the locked rate, an amount
     * below the take amount, or a later trade.paid with another amount or total is refused for
     * good. Otherwise the amount is kept pending and fixed by `fixPending` once this device's own
     * size reaches it (its wallet may see the extra coins after the buyer's did).
     */
    private absorbPaid(amount: bigint, total: bigint): void {
      const r = this.rec;
      r.paidSeen = true;
      const first = r.paidPending ?? null;
      if (first !== null) {
        if (first.amountAtomic !== amount || first.fiatCents !== total) r.paidRefused = true;
        return;
      }
      if (r.paidRefused === true) return;
      const fits = amount >= r.deal.takeAmountAtomic && total === fiatCents(amount, { currency: r.deal.currency, centsPerXmr: r.deal.centsPerXmr });
      if (!fits) {
        r.paidRefused = true;
        return;
      }
      r.paidPending = { amountAtomic: amount, fiatCents: total };
      this.fixPending();
    }

    /** Seller: fixes the pending signed amount once it lies within [take, this device's size]. True when fixed now. */
    private fixPending(): boolean {
      const r = this.rec;
      const p = r.paidPending ?? null;
      if (r.role !== 'seller' || p === null || r.paidRefused === true || (r.acceptedAtomic ?? null) !== null) return false;
      if (p.amountAtomic < r.deal.takeAmountAtomic || p.amountAtomic > r.sizeAtomic) return false;
      const bound = r.releaseBoundAtomic ?? null;
      if (bound !== null && bound !== p.amountAtomic) {
        r.paidRefused = true;
        return true;
      }
      r.acceptedAtomic = p.amountAtomic;
      return true;
    }

    /**
     * Fixes the trade amount on this device (security fix), only at the buyer's own "I've paid"
     * tap: after this, a view with any other amount is refused for a release, so an API that
     * moves the amount after "I've paid" gets no signature. Returns true when it was fixed now.
     */
    private fixAmount(amount: bigint | null): boolean {
      if ((this.rec.acceptedAtomic ?? null) !== null || amount === null) return false;
      this.rec.acceptedAtomic = amount;
      return true;
    }

    private refusalFor(v: EscrowTradeView): EscrowRefusal | null {
      if (this.acceptedAmount(v) !== null) return null;
      const r = this.rec;
      if (r.paidRefused === true) return 'paid-amount-refused';
      if ((r.acceptedAtomic ?? null) !== null) return 'amount-changed';
      if (r.role === 'seller' && (r.paidPending ?? null) !== null) return 'paid-amount-waiting';
      if (r.role === 'seller') return r.paidSeen || r.intent?.kind === 'release' ? 'amount-unknown' : null; // nothing to release yet
      if (r.paidSeen) return 'amount-unknown';
      return 'amount-out-of-range';
    }

    /** The one place the app calls settle(): cosignPolicy over exactly what the party will pay. */
    private settle(o: Outcome): void {
      const k = key(o);
      if (this.error || !this.party || this.inflight === k || this.refused.has(k) || this.exhausted.has(k)) return;
      // The party pays only when the balance equals the payouts' sum, so that is the balance the policy checks.
      const refundAddress = this.rec.role === 'seller' ? this.rec.ownAddress : this.rec.theirAddress;
      const refundShaped = o.to.length === 1 && o.to[0]!.address === refundAddress;
      const ctx = this.context(sumOf(o.to), refundShaped);
      if (!ctx || !cosignPolicy(ctx, o)) return;
      this.inflight = k;
      this.party.settle(o).then(
        async () => {
          if (this.rec.intent) {
            this.rec.intent = { ...this.rec.intent, outcome: { to: o.to, builder: o.builder, cosigner: o.cosigner }, done: true };
            // Stopped meanwhile: the next run's party resolves the same outcome again.
            if (!(await this.persist().then(() => true, () => false))) return;
          }
          if (this.inflight === k) this.inflight = null;
          this.refresh();
        },
        (e: unknown) => {
          if (this.inflight === k) this.inflight = null;
          if (e instanceof PartyError && e.code === 'bad-outcome') {
            if (/already signed/.test(e.message)) this.refused.add(k);
            else if (/used up/.test(e.message)) {
              this.exhausted.add(k);
              this.refusal = 'attempts-exhausted';
              this.emit();
            }
            return;
          }
          if (e instanceof PartyError && e.code === 'stopped') return;
          this.partyFailed(e);
        },
      );
    }

    /** A ready() or settle() rejection: the relay's close is judged by tick; anything else stops the trade. */
    private partyFailed(e: unknown): void {
      if (this.stopped) return;
      if (e instanceof TransportClosedError) {
        this.relayClosed = true;
        this.poke();
        return;
      }
      this.fail('escrow-failed', { integrity: integrityError(e) });
    }

    private refresh(): void {
      if (this.error) return this.emit();
      const i = this.rec.intent;
      if (!this.isReady) return this.set('setting-up');
      if (i?.done) return this.set('done'); // only from this device's own settle
      if (this.rec.settledWithoutDevice === true) return this.set('settled-without-device');
      const active = i !== null && i.outcome !== null && (!i.auto || this.view?.state === 'settling' || this.view?.state === 'lapsed');
      this.set(active ? 'signing' : 'ready');
    }

    private async loadView(): Promise<void> {
      let view: EscrowTradeView | null = null;
      try {
        view = parseTradeView(await deps.api.getTrade(this.code));
      } catch {
        view = null;
      }
      if (view) this.view = view; // a view that disagrees with the deal stops the trade in tick()
    }

    /** The counterparty's signed address is the one the moderator attested for its role (or none yet). */
    private theirAddressAttested(): boolean {
      const r = this.rec;
      if (r.theirAddress === null) return true;
      if (!this.attested) return false;
      return r.theirAddress === (r.role === 'buyer' ? this.attested.sellerRefund : this.attested.buyerPayout);
    }

    private async tick(): Promise<void> {
      if (this.stopped || !this.party) return;
      await this.loadView();
      const v = this.view;
      if (!v) return;
      const closed = CLOSED.includes(v.state);
      // The relay dropped an open trade: nothing can be settled until retry() reconnects. Once the
      // trade is closed the relay's close is expected (Task 7) and the after-close rules run below.
      if (this.relayClosed && !closed && !this.error) return this.fail('escrow-failed');
      // The balance comes from the party's own wallet, which it keeps reading after the relay closed
      // the trade (the least invasive way to read it without a live party: no second wallet session
      // on the same keys; see PartyHandle.funds). A rejection is the party's own failure, except a
      // daemon that is briefly unreachable (read again next tick) and stop().
      let f: Awaited<ReturnType<PartyHandle['funds']>>;
      try {
        f = await this.party.funds();
      } catch (e) {
        if (e instanceof PartyError && e.code === 'stopped') return this.refresh();
        if (e instanceof EscrowError && e.code === 'daemon-unavailable') return this.refresh();
        if (!this.error || this.retryable) this.fail('escrow-failed', { integrity: integrityError(e) });
        return;
      }
      const r = this.rec;
      let changed = false;
      this.reading = { balance: f.balance, confirmed: f.incoming.reduce((sum, x) => (x.confirmations >= 1 ? sum + x.amountAtomic : sum), 0n) };
      this.emit();
      // Saved at once: every later branch may return early, and a reload must still know.
      if (r.fundedSeen !== true && (f.balance > 0n || f.incoming.length > 0)) {
        r.fundedSeen = true;
        await this.persist();
      }

      if (closed) {
        // No setup can finish over a closed relay, and none is needed: the after-close verdict is shown.
        if (this.relayClosed) this.isReady = true;
        if (await this.afterClose(f, v)) return;
      }
      // The API's view disagrees with the deal this device signed: shown, nothing settled this tick,
      // nothing kept (the view may be right again next tick). The counterparty's terms cannot
      // disagree: only the attested ones are ever adopted (signals.ts), and context() checks again.
      if (!viewMatches(v, r.role, r.deal)) {
        this.refusal = 'view-mismatch';
        this.refresh();
        return;
      }
      if (!r.paidSeen && (v.paidAt !== null || v.state === 'paid')) {
        r.paidSeen = true;
        changed = true;
      }
      // Growth runs only before this device knows of paid, except on a seller that has fixed no
      // amount yet: its signed pending amount is then fixed once its own size reaches it (I2),
      // which is safe because the fix is capped by both the buyer's signed amount and own funds.
      const sellerWaiting = r.role === 'seller' && (r.acceptedAtomic ?? null) === null && r.paidRefused !== true;
      if ((!r.paidSeen || sellerWaiting) && (GROW_STATES.includes(v.state) || (sellerWaiting && SELLER_WAIT_STATES.includes(v.state))) && f.balance > 0n) {
        const size = deviceAmount(r.deal, r.sizeAtomic, f.balance, f.unlocked);
        if (size !== r.sizeAtomic) {
          r.sizeAtomic = size;
          changed = true;
        }
      }
      if (this.fixPending()) changed = true;
      // An amount this device does not accept is refused visibly (never silently) until it fits.
      this.refusal = this.refusalFor(v) ?? (r.intent?.outcome && this.exhausted.has(key(r.intent.outcome)) ? 'attempts-exhausted' : null);
      // A tapped choice holds while the view supports it (or once it settled); otherwise the
      // automatic choice takes over, so an old tap never blocks the outcome the trade reached.
      const tapped = r.intent !== null && !r.intent.auto;
      const tapHolds = tapped && (r.intent!.done || viewSupports(r.intent!.kind, v));
      // Once closed nothing new is chosen: an open settle stays as it is (settled elsewhere is judged in afterClose).
      if (!CLOSED.includes(v.state) && !tapHolds && !(r.intent?.auto && r.intent.done)) {
        const kind = this.autoKind(v);
        if (kind && (tapped || r.intent?.kind !== kind)) {
          r.intent = { kind, outcome: null, done: false, auto: true };
          changed = true;
        } else if (!kind && tapped) {
          r.intent = null;
          changed = true;
        }
      }
      const i = r.intent;
      if (i && !i.done && f.balance > 0n && f.balance === f.unlocked) {
        const ctx = this.context(f.balance, i.kind !== 'release');
        let o = ctx ? outcomeFor(i.kind, ctx) : null;
        // I1: a release is bound to the amount of the first release ever handed over; another
        // amount is refused, whatever the intents did in between.
        if (o && ctx && i.kind === 'release') {
          const bound = r.releaseBoundAtomic ?? null;
          if (bound !== null && ctx.deal.amountAtomic !== bound) {
            o = null;
            this.refusal = 'amount-changed';
          } else if (bound === null) {
            r.releaseBoundAtomic = ctx.deal.amountAtomic;
            changed = true;
          }
        }
        // A changed balance (late surplus) before this side signed: re-derive and settle again.
        if (o && key(o) !== key(i.outcome)) {
          r.intent = { ...r.intent!, outcome: { to: o.to, builder: o.builder, cosigner: o.cosigner } };
          changed = true;
        }
        if (changed) await this.persist();
        if (o) this.settle(o);
      } else if (changed) await this.persist();
      this.refresh();
    }

    /**
     * The keep rules once the API says closed (lead 2026-10-24): the store stays for 30 days from
     * when this device first saw the trade closed, or until this device saw ITS OWN settle done
     * with the escrow empty and nothing in the pool, whichever is later; never on the API's word
     * alone. A funded escrow that empties without this device's own settle done was settled
     * elsewhere: escrow-failed (visible), never 'done', and the store stays. While this device's
     * own settle is still open, the party gets `settledElsewhereMs` to catch up first. An escrow
     * that never held coins has nothing to settle and goes after the 30 days.
     * Returns true once the trade is forgotten.
     */
    /**
     * The trade closed before any attestation (review M2): no escrow ever existed and nothing was
     * signed, so there is nothing to settle. Stop waiting (phase back to idle, no error) and keep the
     * record only for the 30-day after-close rule, as for a never-funded escrow; a resume after
     * that forgets it.
     */
    private async closedUnattested(): Promise<void> {
      const r = this.rec;
      const t = now();
      if (r.closedSeenAt == null) {
        r.closedSeenAt = t;
        await this.persist();
      }
      if (t >= r.closedSeenAt + KEEP_AFTER_CLOSE_MS) {
        await this.close();
        return;
      }
      this.set('idle');
    }

    private async afterClose(f: { balance: bigint; unlocked: bigint; incoming: { confirmations: number }[] }, v: EscrowTradeView): Promise<boolean> {
      const r = this.rec;
      const t = now();
      let changed = false;
      if (r.closedSeenAt == null) {
        r.closedSeenAt = t;
        changed = true;
      }
      const emptyInBlock = f.balance === 0n && f.unlocked === 0n && f.incoming.every((x) => x.confirmations > 0);
      const ownDone = r.intent?.done === true;
      const ownOpen = r.intent !== null && r.intent.outcome !== null && !r.intent.done;
      // Fail closed: every sign of coins counts, and a record without the field is unknown.
      const coins = r.fundedSeen === true || r.intent?.outcome != null || r.paidSeen === true || (r.acceptedAtomic ?? null) !== null || f.balance > 0n || f.incoming.length > 0;
      const neverFunded = r.fundedSeen === false && !coins;
      if (emptyInBlock && ownDone && r.settleSeenAt == null) {
        r.settleSeenAt = t;
        changed = true;
      }
      // Settled by the other two parties in a way that needs nothing from this device: the seller
      // in a buyer cancel; a buyer that never tapped "I've paid" in an auto or lapse refund. Only
      // with no tapped settle of its own still open. Not a failure (the 30-day rule applies).
      // TODO(lead, pending): prove it with the builder's signed txHash and an OutProof checked on
      // this device's own daemon (needs a Task 10 signal); until then the API's closed kind decides.
      const tappedOpen = r.intent !== null && !r.intent.auto && r.intent.outcome !== null && !r.intent.done;
      const byOthers =
        v.state === 'refunded' &&
        ((r.role === 'seller' && v.settling === 'buyer-cancel') ||
          (r.role === 'buyer' && (v.settling === 'auto-refund' || v.settling === 'lapse-refund') && (r.acceptedAtomic ?? null) === null));
      if (emptyInBlock && !ownDone && byOthers && !tappedOpen && !this.error) {
        this.emptiedWhileSettling = null;
        if (r.settledWithoutDevice !== true) {
          r.settledWithoutDevice = true;
          changed = true;
        }
      } else if (emptyInBlock && !ownDone && (ownOpen || coins)) {
        if (!ownOpen) this.emptiedWhileSettling ??= t - settledElsewhereMs; // nothing of ours could still land
        else this.emptiedWhileSettling ??= t;
        if (!this.error && t - this.emptiedWhileSettling >= settledElsewhereMs) this.fail('escrow-failed', { integrity: true }); // confirmed settled elsewhere
      } else this.emptiedWhileSettling = null;
      if (changed) await this.persist();
      const settled = r.settleSeenAt != null || neverFunded || r.settledWithoutDevice === true;
      if (!this.error && emptyInBlock && settled && t >= r.closedSeenAt + KEEP_AFTER_CLOSE_MS) {
        await this.close();
        return true;
      }
      return false;
    }

    private autoKind(v: EscrowTradeView): SettleKind | null {
      if (this.rec.role === 'seller') {
        if (v.state === 'lapsed') return 'lapse-refund';
        if (v.state === 'refund_requested') return 'auto-refund';
        if (v.state === 'settling' && v.settling === 'mutual-cancel') return 'mutual-cancel';
        return null;
      }
      if (v.state === 'lapsed') return 'lapse-refund';
      if (BUYER_RELEASE_STATES.includes(v.state)) return 'release'; // co-signing a release only pays the buyer
      return null;
    }

    async act(a: EscrowAction): Promise<void> {
      const r = this.rec;
      if (!r || this.error) throw new Error('escrow not running');
      // A tap must fit the trade as the API shows it now: the page records the event with the
      // API first (propose or accept the cancel, start the release), then asks for the signature.
      const fresh = async (kind: SettleKind): Promise<void> => {
        await this.loadView();
        if (!this.view || !viewSupports(kind, this.view)) throw new Error(`escrow: the trade does not allow ${kind} now`);
      };
      const user = (kind: SettleKind): void => {
        r.intent = { kind, outcome: null, done: false, auto: false };
      };
      switch (a.type) {
        case 'release':
          if (r.role !== 'seller') throw new Error('only the seller releases');
          await fresh('release');
          user('release');
          break;
        case 'build-refund': {
          if (r.role !== 'seller') throw new Error('only the seller builds a refund');
          await this.loadView();
          const kind = this.view?.state === 'lapsed' ? 'lapse-refund' : 'auto-refund';
          await fresh(kind);
          user(kind);
          break;
        }
        case 'buyer-cancel':
          if (r.role !== 'buyer') throw new Error('only the buyer cancels alone');
          await fresh('buyer-cancel');
          if (!this.signals) throw new Error('escrow: the signals channel is not running yet');
          user('buyer-cancel');
          await this.persist(); // the intent is saved before trade.cancel leaves: a reload still builds the refund
          await this.signals.send('trade.cancel');
          break;
        case 'propose-cancel-sign':
          await fresh('mutual-cancel');
          user('mutual-cancel');
          break;
        case 'paid': {
          if (r.role !== 'buyer') throw new Error('only the buyer marks paid');
          await this.loadView();
          const v = this.view;
          // A view that disagrees with the deal this device signed (role, poster, currency, rate,
          // maximum) is the shown `view-mismatch`: no tap is taken on it, even when the total
          // agrees (Task 23 round 2, I1), since nothing settles while it lasts.
          if (v && !viewMatches(v, r.role, r.deal)) throw new Error('escrow: the trade view does not match this device\'s deal');
          // The tap itself fixes the amount: the one already fixed, or the API's within [take, device size].
          const fixed = r.acceptedAtomic ?? null;
          const inRange = (x: bigint): boolean => x >= r.deal.takeAmountAtomic && x <= r.sizeAtomic;
          const amount = !v || r.paidRefused === true ? null : fixed !== null ? (v.amountAtomic === fixed ? fixed : null) : inRange(v.amountAtomic) ? v.amountAtomic : null;
          // The total the buyer confirmed must be this amount at the locked rate, or nothing happens.
          if (!v || amount === null || typeof a.fiatCents !== 'bigint' || a.fiatCents !== fiatCents(amount, { currency: r.deal.currency, centsPerXmr: r.deal.centsPerXmr })) {
            throw new Error('escrow: the total does not match the trade amount');
          }
          // I1: a release already handed over is bound to its amount; paying for another is refused.
          const bound = r.releaseBoundAtomic ?? null;
          if (bound !== null && bound !== amount) throw new Error('escrow: a release for another amount is already under way');
          if (!this.signals) throw new Error('escrow: the signals channel is not running yet');
          const signals = this.signals;
          this.fixAmount(amount);
          r.paidSeen = true;
          await this.persist(); // fixed before the signal leaves
          await signals.send('trade.paid', { amountAtomic: amount, fiatCents: a.fiatCents });
          break;
        }
        case 'signal':
          if ((a.signal as string) === 'trade.paid') throw new Error('escrow: use the paid action with the confirmed total');
          if (!this.signals) throw new Error('escrow: the signals channel is not running yet');
          await this.signals.send(a.signal);
          break;
      }
      await this.persist();
      await this.tickOnce();
    }

    /**
     * Forgets the trade (the store's keep rules are met). The phase stays what it was: 'done' only
     * if this device's own settle was done; a never-funded or settled-without-device trade is
     * never reported 'done' (review 2026-10-26, minor 6).
     */
    private async close(): Promise<void> {
      await this.halt(false);
      await this.saving;
      await deps.store.delete(this.code);
    }

    /**
     * Stops the run. With `wait` (any caller outside the run) it resolves only once the run has
     * returned and its last save is stored, so nothing it started can write after this.
     */
    async halt(wait = true): Promise<void> {
      this.stopped = true;
      this.poke();
      this.signals?.stop();
      await this.party?.stop().catch(() => undefined);
      this.finish();
      if (wait && this.entered) await this.ended;
    }

    /** Waits for the saves already queued; nothing new is queued once stopped. */
    flushed(): Promise<void> {
      return this.saving;
    }
  }

  const start = async (raw: string, confirmed?: ConfirmedTrade): Promise<void> => {
    const code = normalizeTradeCode(raw);
    if (code === null) throw new TypeError('escrow: invalid trade code');
    if (runs.has(code)) return;
    const run = new TradeRun(code, confirmed);
    runs.set(code, run);
    run.emit();
    let acquired!: () => void;
    run.acquired = new Promise((r) => (acquired = r));
    lock(`x2f-escrow:${code}`, async () => {
      acquired();
      if (run.stopped) return;
      run.entered = true;
      try {
        await run.run();
      } catch {
        if (!run.stopped) {
          run.fail('escrow-failed');
        }
      }
      await run.finished.catch(() => undefined);
      // The lock is released only after the run's last save: the next holder reads it.
      await run.flushed();
      run.markEnded();
    }).catch(() => {
      acquired();
      run.fail('unsupported-browser');
    });
    // The run waits for the lock; another tab holding it means this one stays 'idle'.
  };

  return {
    start,
    async resumeAll() {
      for (const code of await deps.store.codes()) await start(code);
    },
    async act(raw, action) {
      const code = normalizeTradeCode(raw);
      const run = code === null ? undefined : runs.get(code);
      if (!run) throw new Error('escrow not running');
      await run.act(action);
    },
    async retry(raw) {
      const code = normalizeTradeCode(raw);
      const run = code === null ? undefined : runs.get(code);
      if (!run || !run.error || !run.retryable) return;
      runs.delete(run.code);
      await run.halt();
      await start(run.code);
    },
    async stop(raw) {
      const code = normalizeTradeCode(raw);
      const run = code === null ? undefined : runs.get(code);
      if (!run) return;
      runs.delete(run.code);
      await run.halt();
    },
    async stopAll() {
      await Promise.all([...runs.values()].map((r) => r.halt()));
      runs.clear();
    },
  };
}
