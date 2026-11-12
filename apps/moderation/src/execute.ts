import type { Outcome, PartyHandle, Payout } from '@x2f/escrow';
import { ESCROW_OUTCOMES } from '@x2f/staff';
import { gateCheck, type GateContext, type GateRuling, type GateSource, type GateStore, type RecordedTerms, type RulingExecution, type StoredRulings } from './gate/index.js';

/**
 * Plan 4 Task 14: the ruling executor. For a trade the API shows disputed, it settles the round-1
 * escrow ruling exactly as the gate authorised it, through the escrow party's existing `settle`
 * (no new signing route): the moderator builds the release to the payouts the gate computed from
 * this process's own recorded terms and the escrow's balance, and the winner's party co-signs
 * (`builder: 'mod'`, the winner the co-signer; the plan's rule: a ruling is never a trader-built set
 * the moderator co-signs, that is only the desk's guarded refunds).
 *
 * Each pass (`step`), in order; the first that holds answers:
 * - the trade's payout is already recorded as finished: `settled` (never again, across restarts);
 * - the API does not show the trade `disputed`: `none`;
 * - the API shows the trade paused for maintenance: `paused` (nothing is handed while it holds);
 * - no published round-1 escrow ruling (none yet, or an after-refund outcome, which never reaches
 *   settle): `none`; once there is an appeal, round 1 still pays from its own ruling (Note
 *   2026-10-30 M3) and round 2 never reaches settle;
 * - no recorded terms for the trade: `no-terms`; the escrow not wholly unlocked: `waiting-funds`;
 * - the gate (`gateCheck`: the registry synced first, so a tapped emergency stop or a switch-off
 *   counts at once; then the ruling's stored taps) refuses: `refused-<reason>` (e.g. `stopped`);
 * - a payout is recorded for this trade but it is not this ruling or not these payouts (a later
 *   surplus, a different ruling): `mismatch`, logged; nothing else is ever settled for the trade;
 * - else the payout is recorded in the sealed gate store (saved) BEFORE the party is asked, then
 *   handed to the party once per process (`handed`, then `in-flight`); when settle() finishes the
 *   record says so (`settledAt`). After a restart an unfinished payout is handed again, identical,
 *   only after the gate authorised it again; the party resumes it (same outcome, Plan 1).
 *
 * Known limit, as for the desk's refunds (Plan 3 review R3-M1): a payout already handed to the party
 * in this process is not withdrawn by a later stop or pause (`PartyHandle` has no withdraw); a
 * restart then holds it until the stop or pause ends.
 *
 * NEEDS_PLAN_4_RULING_PAYOUT (R-M2, follow-up): the watcher's `settled` report for this sweep must
 * name the ruling's own kind (`RulingKind`) and the API must apply it to the disputed trade (released
 * or refunded, the dispute closed, `ruling.executed` appended); until then the API refuses the report
 * (`settle-kind-unknown`, the watcher backs off) and the trade stays disputed after the payout.
 */
export type RulingSource = GateSource & { storedRulings(code: string): Promise<StoredRulings> };

export interface RulingStepInput {
  code: string;
  /** The trade's moderator party (only its settle() is used). */
  handle: Pick<PartyHandle, 'settle'>;
  /** The API's watch-list item: a brake only (state and maintenance), never a reason to pay. */
  api: { state: string; paused?: boolean };
  /** The escrow as this process's party reads it. */
  funds: { balance: bigint; unlocked: bigint };
  /** This process's own recorded terms (`recordedTerms`), or null when it has none. */
  recorded: RecordedTerms | null;
}

export type RulingStepResult = 'none' | 'settled' | 'paused' | 'no-terms' | 'waiting-funds' | `refused-${string}` | 'mismatch' | 'handed' | 'in-flight';

export interface RulingExecutor {
  step(s: RulingStepInput): Promise<RulingStepResult>;
}

export interface RulingExecutorOptions {
  store: GateStore;
  source: RulingSource;
  ctx: GateContext;
  /** Reasons only, never codes, keys or addresses. */
  log: (e: { reason: string }) => void;
}

const isEscrow = (r: GateRuling): boolean => r.round === 1 && (ESCROW_OUTCOMES as readonly string[]).includes(r.outcome);
const asRecord = (p: readonly Payout[]): RulingExecution['payouts'] => p.map((x) => ({ address: x.address, amountAtomic: x.amountAtomic.toString() }));
const keyOf = (rulingId: string, winner: string, p: RulingExecution['payouts']): string => JSON.stringify([rulingId, winner, p.map((x) => [x.address, x.amountAtomic])]);

export function rulingExecutor(o: RulingExecutorOptions): RulingExecutor {
  /** The payout handed to the party in this process, per trade code (its key). */
  const inFlight = new Map<string, string>();

  const step = async (s: RulingStepInput): Promise<RulingStepResult> => {
    const done = o.store.state.executions[s.code];
    if (done !== undefined && done.settledAt !== null) return 'settled';
    if (s.api.state !== 'disputed') return 'none';
    if (s.api.paused === true) return 'paused';
    const stored = await o.source.storedRulings(s.code);
    // Round 1 pays from its own ruling, also once an appeal made round 2 current (Note 2026-10-30 M3).
    const r1 = stored.current?.round === 1 ? stored.current : stored.round1;
    if (r1 === null || !isEscrow(r1)) return 'none';
    if (s.recorded === null) return 'no-terms';
    const { balance, unlocked } = s.funds;
    if (balance <= 0n || balance !== unlocked) return 'waiting-funds';
    const auth = await gateCheck(o.store, o.source, { ruling: r1, recorded: s.recorded, balanceAtomic: balance }, o.ctx);
    if (!auth.ok) {
      o.log({ reason: `ruling-refused-${auth.reason}` });
      return `refused-${auth.reason}`;
    }
    if (auth.settle === null) return 'none';
    const { winner } = auth.settle;
    const payouts = asRecord(auth.settle.payouts);
    const key = keyOf(r1.id, winner, payouts);
    // Recorded (and saved) before the party is ever asked; an existing record must be this very payout.
    const recordedOk = await o.store.exclusive(async () => {
      const ex = o.store.state.executions[s.code];
      if (ex !== undefined) return keyOf(ex.rulingId, ex.winner, ex.payouts) === key;
      o.store.state.executions[s.code] = { rulingId: r1.id, winner, payouts, recordedAt: o.ctx.now().toISOString(), settledAt: null, settledTx: null };
      await o.store.save();
      return true;
    });
    if (!recordedOk) {
      o.log({ reason: 'ruling-execution-mismatch' });
      return 'mismatch';
    }
    if (inFlight.get(s.code) === key) return 'in-flight';
    inFlight.set(s.code, key);
    const outcome: Outcome = { kind: 'release', to: auth.settle.payouts, builder: 'mod', cosigner: winner };
    o.log({ reason: 'ruling-signing' });
    s.handle.settle(outcome).then(
      (tx) =>
        o.store
          .exclusive(async () => {
            const ex = o.store.state.executions[s.code];
            if (ex === undefined || keyOf(ex.rulingId, ex.winner, ex.payouts) !== key || ex.settledAt !== null) return;
            o.store.state.executions[s.code] = { ...ex, settledAt: o.ctx.now().toISOString(), settledTx: tx };
            await o.store.save();
          })
          .then(
            () => o.log({ reason: 'ruling-settled' }),
            // The release is done in the party; the record is retried by the next pass's settle() answer.
            () => {
              if (inFlight.get(s.code) === key) inFlight.delete(s.code);
              o.log({ reason: 'ruling-settled-unsaved' });
            },
          ),
      () => {
        if (inFlight.get(s.code) === key) inFlight.delete(s.code); // the next pass asks again
        o.log({ reason: 'ruling-settle-failed' });
      },
    );
    return 'handed';
  };

  return { step };
}
