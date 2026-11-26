/**
 * useEscrow(code): the page's handle on one trade's escrow, which runs in the escrow worker.
 * The page sees only status (phase, error, check words, keepOpen) and asks for actions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Deal } from './policy.js';
import type { ConfirmedTrade, EscrowAction, EscrowErrorCode, EscrowPhase, EscrowRefusal, EscrowStatus } from './runtime.js';
import type { UserSignal } from './signals.js';
import type { RecoveryAddressStatement, SettleKind } from '@x2f/trade';
import type { FromWorker, ToWorker } from './worker.js';
import type { BoxKeyPair } from '@x2f/protocol';

export interface EscrowClient {
  start(code: string, confirmed?: ConfirmedTrade): void;
  act(code: string, action: EscrowAction): Promise<void>;
  /** Runs a trade stopped by a retryable error again. */
  retry(code: string): void;
  /** Calls `cb` with the latest status now (if any) and on every change. */
  subscribe(code: string, cb: (s: EscrowStatus) => void): () => void;
  /** Lien recovery (Q2): this device's signed "pay my recoveries to `address`" for the dispute of trade `code`; null when it holds no record of that trade. */
  signRecoveryAddress?(code: string, address: string, issuedAt: string): Promise<{ statement: RecoveryAddressStatement; sig: string } | null>;
  /** Escrow-key sync: opens and stores every trade copy this device does not hold; the codes, or null on a failure. */
  restoreTrades?(reader: BoxKeyPair): Promise<string[] | null>;
}

/** An EscrowClient over a worker speaking the worker.ts protocol. Resumes every stored trade at once. */
export function workerClient(w: Pick<Worker, 'postMessage' | 'addEventListener'>): EscrowClient {
  const latest = new Map<string, EscrowStatus>();
  const subs = new Map<string, Set<(s: EscrowStatus) => void>>();
  const waiting = new Map<number, (ok: boolean) => void>();
  const signing = new Map<number, (signed: { statement: RecoveryAddressStatement; sig: string } | null) => void>();
  const restoring = new Map<number, (codes: string[] | null) => void>();
  let nextId = 1;
  w.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m?.t === 'status') {
      latest.set(m.code, m.status);
      for (const cb of subs.get(m.code) ?? []) cb(m.status);
    } else if (m?.t === 'acted') {
      waiting.get(m.id)?.(m.ok);
      waiting.delete(m.id);
    } else if (m?.t === 'signed-recovery-address') {
      signing.get(m.id)?.(m.signed);
      signing.delete(m.id);
    } else if (m?.t === 'restored-trades') {
      restoring.get(m.id)?.(m.codes);
      restoring.delete(m.id);
    }
  });
  const post = (m: ToWorker): void => w.postMessage(m);
  post({ t: 'resume-all' });
  return {
    start: (code, confirmed) => post(confirmed ? { t: 'start', code, confirmed } : { t: 'start', code }),
    act: (code, action) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, (ok) => (ok ? resolve() : reject(new Error('escrow action refused'))));
        post({ t: 'act', id, code, action });
      }),
    retry: (code) => post({ t: 'retry', code }),
    signRecoveryAddress: (code, address, issuedAt) =>
      new Promise((resolve) => {
        const id = nextId++;
        signing.set(id, resolve);
        post({ t: 'sign-recovery-address', id, code, address, issuedAt });
      }),
    restoreTrades: (reader) =>
      new Promise((resolve) => {
        const id = nextId++;
        restoring.set(id, resolve);
        post({ t: 'restore-trades', id, boxPublic: reader.boxPublic, boxSecret: reader.boxSecret });
      }),
    subscribe(code, cb) {
      let set = subs.get(code);
      if (!set) subs.set(code, (set = new Set()));
      set.add(cb);
      const now = latest.get(code);
      if (now) cb(now);
      return () => set.delete(cb);
    },
  };
}

let client: EscrowClient | null = null;

/** Sets the client (the app shell, or a test); `null` drops it. */
export function setEscrowClient(c: EscrowClient | null): void {
  client = c;
}

let worker: Worker | null = null;

/** The one escrow worker of this page (the escrow and the chat engine share it, Task 20). */
export function escrowWorker(): Worker {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'x2f-escrow' });
  return worker;
}

/** The escrow client, starting the worker (and resuming every stored trade) on first use. */
export function escrowClient(): EscrowClient {
  client ??= workerClient(escrowWorker());
  return client;
}

export interface UseEscrow {
  phase: EscrowPhase;
  error: EscrowErrorCode | null;
  /** The error may be transient: offer `retry()` (refunds stay possible once it runs again). */
  retryable: boolean;
  /** A refusal the trade screen must show (the trade waits; see EscrowRefusal). */
  refusal: EscrowRefusal | null;
  checkWords: string[] | null;
  keepOpen: boolean;
  /** `EscrowStatus.amountAtomic` / `fiatCents`: the trade amount this device accepts now and its fiat total; the screens show these, never the API's. */
  amountAtomic: bigint | null;
  fiatCents: bigint | null;
  /** `EscrowStatus.escrowAddress`: the address this device's party derived (null until set up); the only one the funding screen shows. */
  escrowAddress: string | null;
  /** `EscrowStatus.deal`: the deal this device stored from what the user confirmed. */
  deal: Deal | null;
  /** `EscrowStatus.methodId`: the attested method (review M2); the trade room shows this one. */
  methodId: string | null;
  /** `EscrowStatus.paymentInstructions`: the locked payment instructions, only when they match the attested hash; the only ones a screen may show. */
  paymentInstructions: string | null;
  /** `EscrowStatus.instructionsMismatch`: the API showed other instructions; warn, never show them. */
  instructionsMismatch: boolean;
  /** `EscrowStatus.receivedAtomic`: the escrow `balance` from this device's own last `funds()` reading. */
  receivedAtomic: bigint | null;
  /** `EscrowStatus.confirmedAtomic`: the 1+-confirmation part of what arrived, from the same reading (see EscrowStatus). */
  confirmedAtomic: bigint | null;
  /** `EscrowStatus.role`: this device's own record's role, null until the record is loaded (optional for fakes, which then gate nothing). */
  role?: 'buyer' | 'seller' | null;
  /** `EscrowStatus.paidRecorded`: the buyer's own "I've paid" is recorded on this device ("Marked as paid"). */
  paidRecorded: boolean;
  /** `EscrowStatus.intentKind`: the settle the user tapped on this device and that is saved, or null. */
  intentKind: SettleKind | null;
  /** `EscrowStatus.handedOff`: the co-signer reported (signed, not yet seen in a block) that it sent the settle this device signs. */
  handedOff: boolean;
  /** `EscrowStatus.restitution`: the seller's payment a ruling orders, from the attested terms only (absent: none). */
  restitution?: { address: string; amountAtomic: bigint } | null;
  release(): Promise<void>;
  buildRefund(): Promise<void>;
  buyerCancel(): Promise<void>;
  proposeCancelSign(): Promise<void>;
  /**
   * The buyer's "I've paid", with the fiat total (minor units) the buyer confirmed on screen. The
   * device refuses it unless that is the trade amount it accepts at the locked rate, and from
   * then on settles only that amount.
   */
  markPaid(fiatCents: bigint): Promise<void>;
  retry(): void;
  signal(type: Exclude<UserSignal, 'trade.paid'>): Promise<void>;
}

const IDLE: EscrowStatus = { phase: 'idle', error: null, retryable: false, refusal: null, checkWords: null, keepOpen: false, role: null, amountAtomic: null, fiatCents: null, escrowAddress: null, deal: null, methodId: null, paymentInstructions: null, instructionsMismatch: false, receivedAtomic: null, confirmedAtomic: null, paidRecorded: false, intentKind: null, handedOff: false };

/**
 * Plan 4 Task 21 bug 2: the seller's `restitution` (EscrowStatus.restitution: the attested buyer
 * address and this device's accepted amount) for a page outside the trade room, such as
 * /trade/:code/dispute. It only subscribes to the escrow worker's status (the worker resumes every
 * stored trade by itself): it never starts a trade, so it is not a second escrow handle.
 */
export function useEscrowRestitution(code: string): { address: string; amountAtomic: bigint } | null {
  const [r, setR] = useState<{ address: string; amountAtomic: bigint } | null>(null);
  const c = useMemo(() => escrowClient(), []);
  useEffect(() => {
    setR(null);
    const off = c.subscribe(code, (s) => setR(s.restitution ?? null));
    return () => void off();
  }, [c, code]);
  return r;
}

/**
 * This device's escrow status for `code`, for a page outside the trade room (the dispute route's
 * "Finish marking as paid" gate, payModel `disputeNeedsFinish`). Subscribe only, like
 * useEscrowRestitution: it never starts a trade. Null until the worker reports one (or never, when
 * this device holds no record of the trade).
 */
export function useEscrowStatus(code: string): EscrowStatus | null {
  const [s, setS] = useState<EscrowStatus | null>(null);
  const c = useMemo(() => escrowClient(), []);
  useEffect(() => {
    setS(null);
    const off = c.subscribe(code, setS);
    return () => void off();
  }, [c, code]);
  return s;
}

/**
 * `confirmed` is what the user confirmed on the take or accept screen (Tasks 18/19); it is
 * needed the first time a trade starts on this device and ignored once it is stored.
 */
export function useEscrow(code: string, confirmed?: ConfirmedTrade): UseEscrow {
  const [status, setStatus] = useState<EscrowStatus>(IDLE);
  const c = useMemo(() => escrowClient(), []);
  useEffect(() => {
    setStatus(IDLE);
    const off = c.subscribe(code, setStatus);
    c.start(code, confirmed);
    return off;
    // `confirmed` only matters for the first start of a code, so it is not a dependency.
  }, [c, code]);
  const act = useCallback((a: EscrowAction) => c.act(code, a), [c, code]);
  return {
    phase: status.phase,
    error: status.error,
    retryable: status.retryable,
    refusal: status.refusal,
    checkWords: status.checkWords,
    keepOpen: status.keepOpen,
    amountAtomic: status.amountAtomic,
    fiatCents: status.fiatCents,
    escrowAddress: status.escrowAddress,
    deal: status.deal,
    methodId: status.methodId,
    paymentInstructions: status.paymentInstructions,
    instructionsMismatch: status.instructionsMismatch,
    receivedAtomic: status.receivedAtomic,
    confirmedAtomic: status.confirmedAtomic,
    role: status.role,
    paidRecorded: status.paidRecorded,
    intentKind: status.intentKind,
    handedOff: status.handedOff,
    restitution: status.restitution ?? null,
    release: () => act({ type: 'release' }),
    buildRefund: () => act({ type: 'build-refund' }),
    buyerCancel: () => act({ type: 'buyer-cancel' }),
    proposeCancelSign: () => act({ type: 'propose-cancel-sign' }),
    markPaid: (fiatCents) => act({ type: 'paid', fiatCents }),
    retry: () => c.retry(code),
    signal: (type) => act({ type: 'signal', signal: type }),
  };
}
