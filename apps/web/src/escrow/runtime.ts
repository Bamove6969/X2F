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
import { PartyError, type EscrowEngine, type Outcome, type PartyArgs, type PartyHandle, type Payout, type Transport } from '@x2f/escrow';
import type { Identity, Participants } from '@x2f/protocol';
import { channelFor, type SettleKind, type TradeState } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { escrowCheckWords, identityProofBytes, parseTradeView, verifyAttestation, type Attestation, type EscrowTradeView } from './adapters.js';
import { cosignPolicy, deviceAmount, outcomeFor, type Deal, type PolicyContext } from './policy.js';
import { runSignals, sameDeal, type SignalsHandle, type UserSignal } from './signals.js';
import type { EscrowRecord, EscrowStore, StoredIntent } from './store.js';

export type EscrowPhase = 'idle' | 'registering' | 'verifying' | 'setting-up' | 'ready' | 'signing' | 'done' | 'error';
/**
 * `participants-mismatch` is the plan's; the others are additions: the two sides signed
 * different deals, the party failed (a peer reported another escrow address, or the store
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
 * back in range (Plan 3 Revision 2026-10-24, starter caps; lead 2026-10-24).
 */
export type EscrowRefusal = 'amount-out-of-range';

export interface EscrowStatus {
  phase: EscrowPhase;
  error: EscrowErrorCode | null;
  refusal: EscrowRefusal | null;
  checkWords: string[] | null;
  keepOpen: boolean;
  role: 'buyer' | 'seller' | null;
}

export type EscrowAction =
  | { type: 'release' }
  | { type: 'build-refund' }
  | { type: 'buyer-cancel' }
  | { type: 'propose-cancel-sign' }
  | { type: 'signal'; signal: UserSignal };

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
  generateIdentity(): Promise<Identity>;
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
  stop(code: string): Promise<void>;
  stopAll(): Promise<void>;
}

const CLOSED: readonly TradeState[] = ['released', 'refunded', 'cancelled'];
/** The escrow store outlives the trade by at least this long (lead 2026-10-24). */
export const KEEP_AFTER_CLOSE_MS = 30 * 24 * 60 * 60 * 1000;
const GROW_STATES: readonly TradeState[] = ['funding', 'securing', 'secured'];
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

/** The fixed parts of the TradeView agree with this device's deal (the amount may grow; the policy checks it). */
function viewMatches(v: EscrowTradeView, role: 'buyer' | 'seller', d: Deal, ownAddress: string | null): boolean {
  return (
    v.role === role &&
    v.poster === d.poster &&
    v.currency === d.currency &&
    v.centsPerXmr === d.centsPerXmr &&
    v.maxFiatCents === d.maxFiatCents &&
    (v.ownAddress === null || v.ownAddress === ownAddress)
  );
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
    private view: EscrowTradeView | null = null;
    private isReady = false;
    private words: string[] | null = null;
    error: EscrowErrorCode | null = null;
    private refusal: EscrowRefusal | null = null;
    private phase: EscrowPhase = 'idle';
    private last = '';
    /** The settle() call in flight, by outcome key. */
    private inflight: string | null = null;
    /** Outcomes the party refused because another was already committed. */
    private refused = new Set<string>();
    private ticking: Promise<void> = Promise.resolve();
    /** Device clock when the escrow was first seen emptied while this device's settle was still open. */
    private emptiedWhileSettling: number | null = null;
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
      const s: EscrowStatus = {
        phase: this.error ? 'error' : this.phase,
        error: this.error,
        refusal: this.error ? null : this.refusal,
        checkWords: this.words,
        keepOpen: ['registering', 'verifying', 'setting-up', 'signing'].includes(this.phase) && !this.error,
        role: this.rec?.role ?? null,
      };
      const j = JSON.stringify(s);
      if (j !== this.last) {
        this.last = j;
        deps.onStatus(this.code, s);
      }
    }

    private set(p: EscrowPhase): void {
      this.phase = p;
      this.emit();
    }

    fail(e: EscrowErrorCode): void {
      this.error = e;
      this.emit();
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
      if (loaded) this.rec = loaded;
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
        if (!viewMatches(view, c.role, c.deal, c.ownAddress) || view.amountAtomic !== c.deal.takeAmountAtomic) return this.fail('deal-mismatch');
        const id = await deps.generateIdentity();
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
        };
        await this.persist(); // the identity is stored before the API ever sees it
      }
      const password = await deps.store.createPassword(this.code);
      const me: Identity = { ...this.rec.identity };

      if (!this.rec.registered) {
        this.set('registering');
        await sodium.ready;
        const proof = toHex(sodium.crypto_sign_detached(identityProofBytes(this.code, this.rec.role, me.signPublic, me.boxPublic), me.signSecret));
        const ok = await this.retry(() => deps.api.registerIdentity(this.code, { signPublic: me.signPublic, boxPublic: me.boxPublic, proof }).then(() => true));
        if (!ok) return;
        this.rec.registered = true;
        await this.persist();
      }

      this.set('verifying');
      let att = this.rec.attestation;
      while (!att && !this.stopped) {
        const got = await this.retry(() => deps.api.getAttestation(this.code));
        if (got === undefined) return;
        if (got === null) await this.sleep(pollMs);
        else att = { attestation: got.attestation, sig: typeof got.sig === 'string' ? got.sig : '' };
      }
      if (!att || this.stopped) return;
      try {
        await verifyAttestation(att.attestation, att.sig, deps.config.modSigningPublic, { role: this.rec.role, signPublic: me.signPublic, boxPublic: me.boxPublic }, this.code);
      } catch {
        this.fail('participants-mismatch'); // stop: no terms, no party, no funding address
        return;
      }
      const attestation = att.attestation as Attestation;
      this.participants = attestation.participants;
      if (!this.rec.attestation) {
        this.rec.attestation = att;
        await this.persist();
      }

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
        ownAddress: this.rec.ownAddress!,
        deal: this.rec.deal,
        save: async (s) => {
          this.rec.signalGuard = s.guard;
          this.rec.signalSeq = s.seq;
          this.rec.theirAddress = s.theirAddress;
          this.rec.theirDeal = s.theirDeal;
          this.rec.termsAcked = s.termsAcked;
          await this.persist();
        },
        onSignal: (type, from) => {
          if (type === 'trade.paid' && from === 'buyer' && !this.rec.paidSeen) {
            this.rec.paidSeen = true;
            this.persist().catch(() => undefined);
          }
          this.poke();
        },
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
          this.isReady = true;
          this.refresh();
          this.poke();
        },
        () => {
          if (!this.stopped) this.fail('escrow-failed');
        },
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
      this.ticking = this.ticking.then(() => this.tick()).catch(() => undefined);
      return this.ticking;
    }

    /** The policy context for this device right now, or null while the terms are incomplete. */
    private context(balance: bigint): PolicyContext | null {
      const v = this.view;
      const r = this.rec;
      if (!v || r.ownAddress === null || r.theirAddress === null || !r.theirDeal || !sameDeal(r.deal, r.theirDeal)) return null;
      const size = this.acceptedAmount(v);
      if (size === null) return null;
      const payout = r.role === 'buyer' ? r.ownAddress : r.theirAddress;
      const refund = r.role === 'seller' ? r.ownAddress : r.theirAddress;
      return {
        role: r.role,
        own: r.role === 'buyer' ? { payout: r.ownAddress } : { refund: r.ownAddress },
        balance,
        trade: { state: v.state, poster: v.poster, amountAtomic: v.amountAtomic, feeWallet: deps.config.feeWallet },
        deal: { poster: r.deal.poster, amountAtomic: size },
        signedTerms: { payout, refund },
      };
    }

    /**
     * The trade's size to settle: the API's amount, accepted only from the amount at take up to
     * the size this device worked out from its own escrow (growth may stop lower, at the offer
     * maximum or a starter cap the device does not know), never above it. Otherwise null.
     */
    private acceptedAmount(v: EscrowTradeView): bigint | null {
      return v.amountAtomic >= this.rec.deal.takeAmountAtomic && v.amountAtomic <= this.rec.sizeAtomic ? v.amountAtomic : null;
    }

    /** The one place the app calls settle(): cosignPolicy over exactly what the party will pay. */
    private settle(o: Outcome): void {
      const k = key(o);
      if (this.error || !this.party || this.inflight === k || this.refused.has(k)) return;
      // The party pays only when the balance equals the payouts' sum, so that is the balance the policy checks.
      const ctx = this.context(sumOf(o.to));
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
            return;
          }
          if (e instanceof PartyError && e.code === 'stopped') return;
          if (!this.stopped) this.fail('escrow-failed');
        },
      );
    }

    private refresh(): void {
      if (this.error) return this.emit();
      const i = this.rec.intent;
      if (!this.isReady) return this.set('setting-up');
      if (i?.done || (this.rec.settleSeenAt != null && this.view !== null && CLOSED.includes(this.view.state))) return this.set('done');
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

    private async tick(): Promise<void> {
      if (this.stopped || !this.party) return;
      await this.loadView();
      const v = this.view;
      if (!v) return;
      let f: Awaited<ReturnType<PartyHandle['funds']>>;
      try {
        f = await this.party.funds();
      } catch {
        return this.refresh();
      }
      const r = this.rec;
      let changed = false;

      if (CLOSED.includes(v.state)) {
        if (await this.afterClose(f)) return;
      }
      if ((r.theirDeal && !sameDeal(r.deal, r.theirDeal)) || !viewMatches(v, r.role, r.deal, r.ownAddress)) {
        this.fail('deal-mismatch');
        return;
      }
      if (!r.paidSeen && (v.paidAt !== null || v.state === 'paid')) {
        r.paidSeen = true;
        changed = true;
      }
      if (!r.paidSeen && GROW_STATES.includes(v.state) && f.balance > 0n) {
        const size = deviceAmount(r.deal, r.sizeAtomic, f.balance, f.unlocked);
        if (size !== r.sizeAtomic) {
          r.sizeAtomic = size;
          changed = true;
        }
      }
      // The API's amount out of range is refused visibly until it is back in range.
      this.refusal = this.acceptedAmount(v) === null ? 'amount-out-of-range' : null;
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
        const ctx = this.context(f.balance);
        const o = ctx ? outcomeFor(i.kind, ctx) : null;
        // A changed balance (late surplus) before this side signed: re-derive and settle again.
        if (o && key(o) !== key(i.outcome)) {
          r.intent = { ...i, outcome: { to: o.to, builder: o.builder, cosigner: o.cosigner } };
          changed = true;
        }
        if (changed) await this.persist();
        if (o) this.settle(o);
      } else if (changed) await this.persist();
      this.refresh();
    }

    /**
     * The keep rules once the API says closed (lead 2026-10-24): the store stays for 30 days from
     * when this device first saw the trade closed, or until this device saw its own settle done
     * and the escrow empty with nothing in the pool, whichever is later; never on the API's word
     * alone. A closed escrow emptied while this device's own settle is still open, for longer
     * than the party needs to catch up, was settled elsewhere: escrow-failed, and the store stays.
     * Returns true once the trade is forgotten.
     */
    private async afterClose(f: { balance: bigint; unlocked: bigint; incoming: { confirmations: number }[] }): Promise<boolean> {
      const r = this.rec;
      const t = now();
      let changed = false;
      if (r.closedSeenAt == null) {
        r.closedSeenAt = t;
        changed = true;
      }
      const emptyInBlock = f.balance === 0n && f.unlocked === 0n && f.incoming.every((x) => x.confirmations > 0);
      const open = r.intent !== null && r.intent.outcome !== null && !r.intent.done;
      if (emptyInBlock && open) {
        this.emptiedWhileSettling ??= t;
        if (!this.error && t - this.emptiedWhileSettling >= settledElsewhereMs) this.fail('escrow-failed');
      } else this.emptiedWhileSettling = null;
      if (emptyInBlock && !open && r.settleSeenAt == null) {
        r.settleSeenAt = t;
        changed = true;
      }
      if (changed) await this.persist();
      if (!this.error && emptyInBlock && r.settleSeenAt != null && t >= r.closedSeenAt + KEEP_AFTER_CLOSE_MS) {
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
          await this.signals?.send('trade.cancel');
          user('buyer-cancel');
          break;
        case 'propose-cancel-sign':
          await fresh('mutual-cancel');
          user('mutual-cancel');
          break;
        case 'signal':
          await this.signals?.send(a.signal);
          if (a.signal === 'trade.paid') r.paidSeen = true;
          break;
      }
      await this.persist();
      await this.tickOnce();
    }

    private async close(): Promise<void> {
      await this.halt(false);
      await this.saving;
      await deps.store.delete(this.code);
      this.isReady = true;
      this.set('done');
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
