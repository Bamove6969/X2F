/**
 * The seller's two actions on SellerRefund (plan Task 25), as ordered steps:
 *
 * - Cancel & get refund: `request-refund` to the API (the server clock decides; this starts the
 *   buyer's final alert), then the `trade.refund-request` signal to the moderation service, then
 *   `buildRefund()` (Task 12 settles `payoutsFor('auto-refund')` with builder seller and cosigner
 *   mod; the moderator signs only once its own guard allows, Task 10).
 * - Give 30 more min: `extend`, then the `trade.extend` signal.
 *
 * Nothing after a refused step runs, so no signal and no refund leave the device unless the API
 * accepted the event. A retry resumes at the step that failed (an event the API accepted is never
 * posted twice, a signal that went out is never sent twice), and a second tap while running
 * shares the run in flight.
 *
 * The Cancel & get refund run outlives the screen that started it (`refundRun`): once the API has
 * accepted request-refund the trade is `refund_requested` and the room swaps the "window ended"
 * view for the "final alert sent" view, which must still finish the signal and the tx set (the
 * seller's device is the builder; without its set the moderator has nothing to co-sign). Review
 * 2026-10-27 I1. The cursor lives in this module for the life of the page; a reload loses it
 * (follow-up: persist it in Task 12's store).
 */
import type { RefundEscrow } from './refundSlot.js';

export type Step = () => Promise<unknown>;

export interface Steps {
  (): Promise<void>;
  /** True once the run was called at all (even if its first step failed). */
  started(): boolean;
  done(): boolean;
}

/** Runs `list` in order, each step once; a failed step is retried by the next call. */
export function steps(list: readonly Step[]): Steps {
  let next = 0;
  let started = false;
  let running: Promise<void> | null = null;
  const go = async (): Promise<void> => {
    while (next < list.length) {
      await list[next]!();
      next += 1;
    }
  };
  const run = (() => {
    started = true;
    if (running === null) {
      const p = go().finally(() => {
        if (running === p) running = null;
      });
      running = p;
    }
    return running;
  }) as Steps;
  run.started = () => started;
  run.done = () => next >= list.length;
  return run;
}

export interface RefundFlowDeps {
  /** POST /v1/trades/:code/events with this event. */
  post(e: { type: 'extend' } | { type: 'request-refund' }): Promise<unknown>;
  escrow: RefundEscrow;
}

export function cancelAndRefundSteps(d: RefundFlowDeps): Steps {
  return steps([() => d.post({ type: 'request-refund' }), () => d.escrow.signal('trade.refund-request'), () => d.escrow.buildRefund()]);
}

export function extendSteps(d: RefundFlowDeps): Steps {
  return steps([() => d.post({ type: 'extend' }), () => d.escrow.signal('trade.extend')]);
}

interface RefundRunEntry {
  steps: Steps;
  /** The deps of the latest screen that holds the run: a resume calls the room's current escrow, not a stale one. */
  deps: RefundFlowDeps;
}

const refundRuns = new Map<string, RefundRunEntry>();

/**
 * The one Cancel & get refund run for `code`, created on the first call and returned again for the
 * life of the page, done or not: a done run is a no-op, so a second tap that lands after the run
 * finished but before the room re-read the trade posts nothing (a trade is refunded once). Each call
 * records `deps` as the ones the run uses from now on. Call it at the tap, not at render: a run that
 * was created but never started is not pending (review item 8), so a refund requested from another
 * device, or one whose response was lost, is not re-posted from step 0 by the refund_requested view.
 * Tests call `forgetRefundRuns()` between trades.
 */
export function refundRun(code: string, deps: RefundFlowDeps): Steps {
  let entry = refundRuns.get(code);
  if (entry === undefined) {
    const e: RefundRunEntry = { deps, steps: null as unknown as Steps };
    e.steps = cancelAndRefundSteps({
      post: (ev) => e.deps.post(ev),
      escrow: { signal: (s) => e.deps.escrow.signal(s), buildRefund: () => e.deps.escrow.buildRefund() },
    });
    refundRuns.set(code, e);
    entry = e;
  }
  entry.deps = deps;
  return entry.steps;
}

/** The run for `code` if it was started on this page (called at least once) and has not finished; `deps` (when given) are recorded as above. */
export function pendingRefundRun(code: string, deps?: RefundFlowDeps): Steps | null {
  const entry = refundRuns.get(code);
  if (entry === undefined || !entry.steps.started() || entry.steps.done()) return null;
  if (deps !== undefined) entry.deps = deps;
  return entry.steps;
}

/** Drops every run (tests). */
export function forgetRefundRuns(): void {
  refundRuns.clear();
}
