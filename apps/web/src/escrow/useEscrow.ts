/**
 * useEscrow(code): the page's handle on one trade's escrow, which runs in the escrow worker.
 * The page sees only status (phase, error, check words, keepOpen) and asks for actions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConfirmedTrade, EscrowAction, EscrowErrorCode, EscrowPhase, EscrowRefusal, EscrowStatus } from './runtime.js';
import type { UserSignal } from './signals.js';
import type { FromWorker, ToWorker } from './worker.js';

export interface EscrowClient {
  start(code: string, confirmed?: ConfirmedTrade): void;
  act(code: string, action: EscrowAction): Promise<void>;
  /** Runs a trade stopped by a retryable error again. */
  retry(code: string): void;
  /** Calls `cb` with the latest status now (if any) and on every change. */
  subscribe(code: string, cb: (s: EscrowStatus) => void): () => void;
}

/** An EscrowClient over a worker speaking the worker.ts protocol. Resumes every stored trade at once. */
export function workerClient(w: Pick<Worker, 'postMessage' | 'addEventListener'>): EscrowClient {
  const latest = new Map<string, EscrowStatus>();
  const subs = new Map<string, Set<(s: EscrowStatus) => void>>();
  const waiting = new Map<number, (ok: boolean) => void>();
  let nextId = 1;
  w.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m?.t === 'status') {
      latest.set(m.code, m.status);
      for (const cb of subs.get(m.code) ?? []) cb(m.status);
    } else if (m?.t === 'acted') {
      waiting.get(m.id)?.(m.ok);
      waiting.delete(m.id);
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

/** The escrow client, starting the worker (and resuming every stored trade) on first use. */
export function escrowClient(): EscrowClient {
  client ??= workerClient(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'x2f-escrow' }));
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

const IDLE: EscrowStatus = { phase: 'idle', error: null, retryable: false, refusal: null, checkWords: null, keepOpen: false, role: null, amountAtomic: null, fiatCents: null };

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
    release: () => act({ type: 'release' }),
    buildRefund: () => act({ type: 'build-refund' }),
    buyerCancel: () => act({ type: 'buyer-cancel' }),
    proposeCancelSign: () => act({ type: 'propose-cancel-sign' }),
    markPaid: (fiatCents) => act({ type: 'paid', fiatCents }),
    retry: () => c.retry(code),
    signal: (type) => act({ type: 'signal', signal: type }),
  };
}
