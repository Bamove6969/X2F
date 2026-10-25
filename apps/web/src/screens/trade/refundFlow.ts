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
 */
import type { RefundEscrow } from './refundSlot.js';

export type Step = () => Promise<unknown>;

export interface Steps {
  (): Promise<void>;
  done(): boolean;
}

/** Runs `list` in order, each step once; a failed step is retried by the next call. */
export function steps(list: readonly Step[]): Steps {
  let next = 0;
  let running: Promise<void> | null = null;
  const go = async (): Promise<void> => {
    while (next < list.length) {
      await list[next]!();
      next += 1;
    }
  };
  const run = (() => {
    if (running === null) {
      const p = go().finally(() => {
        if (running === p) running = null;
      });
      running = p;
    }
    return running;
  }) as Steps;
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
