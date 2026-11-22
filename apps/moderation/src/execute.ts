import type { Outcome, PartyHandle, Payout } from '@x2f/escrow';
import { ESCROW_OUTCOMES } from '@x2f/staff';
import { signRulingStatement, type RulingKind, type RulingStatement } from '@x2f/trade';
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
 * - the trade's desk armed a refund that is not blocked: `desk-armed` (review M5; the desk, in turn,
 *   hands nothing once a payout is recorded here);
 * - a payout is recorded for this trade but it is not this ruling or not these payouts (a later
 *   surplus, a different ruling): `mismatch`, logged; nothing else is ever settled for the trade;
 * - no escrow address recorded for the trade by this process (`mod_party_links`): `no-escrow`;
 * - else the payout is recorded in the sealed gate store (saved) BEFORE the party is asked; then
 *   (Haveno review 2026-11-12, finding 2, lead call) this process signs the ruling statement with
 *   its long-term key (`@x2f/trade` RulingStatement: the trade, the escrow address, round 1, the
 *   ruling, the winner and the payouts the gate worked out, issued at the record's time, so it is
 *   the same statement after a restart) and announces it to the API (`ruling-statement`), whose
 *   copy the traders' devices verify before they co-sign; until the API took it nothing is handed
 *   (`announce-failed`); then the payout is
 *   handed to the party once per process (`handed`, then `in-flight`); when settle() finishes the
 *   record says so (`settledAt`). After a restart an unfinished payout is handed again, identical,
 *   only after the gate authorised it again; the party resumes it (same outcome, Plan 1).
 *
 * Known limit, as for the desk's refunds (Plan 3 review R3-M1): a payout already handed to the party
 * in this process is not withdrawn by a later stop or pause (`PartyHandle` has no withdraw); a
 * restart then holds it until the stop or pause ends.
 *
 * Ruling-winner reasons (lead 22 Nov; review-lead-fix-ruling-pay, builder's question 1): a winner
 * whose party is already committed to another outcome never exports for the mod-built set, and the
 * payout used to wait at `ruling-signing` with no reason. On an `in-flight` pass at least
 * `winnerWaitMs` (RULING_WINNER_WAIT_MS) after the payout was recorded, the executor says why, from
 * this process's own party alone (`peerRelease`, the winner's own signed release messages to the
 * moderator; never the API's or a trader's word): `winner-committed` when the winner sent a built tx
 * set for another outcome (a builder commits when it builds: a buyer-built cancel, or a seller-built
 * refund, that the moderator co-signs), else `winner-offline` (nothing from the winner for this
 * payout: its app is not open, or it is committed to an outcome the moderator takes no part in, such
 * as a seller-built release the buyer co-signs; the moderator cannot tell which). Null once the
 * winner's export for the payout came. Each change is logged (`ruling-winner-committed`,
 * `ruling-winner-offline`, `ruling-winner-joined`) and reported (`reportWait`) for the staff case
 * view; a refused report is sent again on the next pass. A party without the read says nothing.
 * Nothing here changes what is handed to the party or signed.
 *
 * R-M2: the watcher's `settled` report for the mod-built sweep names the ruling's own kind
 * (`kindFor`, from this record), and the API applies it to the disputed trade in one transaction
 * (released or refunded, the dispute's execution recorded, `ruling.executed` logged:
 * apps/api disputes/execution.ts).
 */
export type RulingSource = GateSource & { storedRulings(code: string): Promise<StoredRulings> };

/** The refund this trade's desk armed (`DeskRecord.armed`), or null (security review 2026-11-12 M5). */
export type DeskArmed = { kind: 'auto-refund' | 'buyer-cancel'; blocked?: string | null } | null;

/** Why a handed ruling payout waits on its winner (see above), or null once the winner took part. */
export type RulingWait = 'winner-committed' | 'winner-offline';

/** How long after the payout was recorded a winner that has not taken part is named (lead default, owner question). */
export const RULING_WINNER_WAIT_MS = 60 * 60_000;

export interface RulingStepInput {
  code: string;
  /** The trade's moderator party: its settle(), and its read-only peerRelease() for why a payout waits. */
  handle: Pick<PartyHandle, 'settle' | 'peerRelease'>;
  /** The API's watch-list item: a brake only (state and maintenance), never a reason to pay. */
  api: { state: string; paused?: boolean };
  /** The escrow as this process's party reads it. */
  funds: { balance: bigint; unlocked: bigint };
  /** This process's own recorded terms (`recordedTerms`), or null when it has none. */
  recorded: RecordedTerms | null;
  /**
   * Review M5: the desk's armed refund for the trade. While one is armed and not blocked, nothing is
   * recorded or handed (`desk-armed`): the party would otherwise trade the desk's uncommitted refund
   * for the ruling's payout, or the reverse. An armed buyer cancel is never handed while the API
   * shows the trade disputed (the desk's `apiAllows`), so only an unblocked auto-refund waits.
   */
  deskArmed?: DeskArmed;
  /** The escrow address this process's party derived and reported at setup (the watcher's own row), or null. */
  escrowAddress: string | null;
  /**
   * Haveno finding 2: posts the signed statement to the API (`ruling-statement` over this service's
   * signed link); true once the API accepted it.
   */
  announce(r: { statement: RulingStatement; sig: string }): Promise<boolean>;
  /** Ruling-winner reasons: posts why the payout waits (or null: no longer) to the API; true once it took it. */
  reportWait?(reason: RulingWait | null): Promise<boolean>;
}

export type RulingStepResult = 'none' | 'settled' | 'paused' | 'no-terms' | 'waiting-funds' | 'desk-armed' | 'no-escrow' | 'announce-failed' | `refused-${string}` | 'mismatch' | 'handed' | 'in-flight';

export interface RulingExecutor {
  step(s: RulingStepInput): Promise<RulingStepResult>;
  /**
   * R-M2: the kind of the payout recorded for this trade (`dispute-buyer` when it pays the buyer,
   * `dispute-seller` the seller), from the sealed gate store only, or null: the watcher's `settled`
   * report for the mod-built sweep names it.
   */
  kindFor(code: string): RulingKind | null;
}

export interface RulingExecutorOptions {
  store: GateStore;
  source: RulingSource;
  ctx: GateContext;
  /** Reasons only, never codes, keys or addresses. */
  log: (e: { reason: string }) => void;
  /** MOD_SIGNING_SECRET (64-byte Ed25519): signs the ruling statements (Haveno finding 2). */
  signingSecret: Uint8Array;
  /** Ruling-winner reasons: RULING_WINNER_WAIT_MS unless set (tests). */
  winnerWaitMs?: number;
}

const isEscrow = (r: GateRuling): boolean => r.round === 1 && (ESCROW_OUTCOMES as readonly string[]).includes(r.outcome);
const asRecord = (p: readonly Payout[]): RulingExecution['payouts'] => p.map((x) => ({ address: x.address, amountAtomic: x.amountAtomic.toString() }));
const keyOf = (rulingId: string, winner: string, p: RulingExecution['payouts']): string => JSON.stringify([rulingId, winner, p.map((x) => [x.address, x.amountAtomic])]);

export function rulingExecutor(o: RulingExecutorOptions): RulingExecutor {
  /** The payout handed to the party in this process, per trade code (its key). */
  const inFlight = new Map<string, string>();
  /** The statement the API accepted in this process, per trade code (its payout key). */
  const announced = new Map<string, string>();
  /** The wait reason the API took in this process, per trade code (absent: none reported yet). */
  const waitReported = new Map<string, RulingWait | null>();
  const waitMs = o.winnerWaitMs ?? RULING_WINNER_WAIT_MS;

  /**
   * Why the recorded payout `ex` waits on its winner, from this process's own party only, or null
   * when the winner took part; undefined before the set time, or when the party cannot tell.
   */
  const waitOf = (s: RulingStepInput, ex: RulingExecution): RulingWait | null | undefined => {
    if (o.ctx.now().getTime() - Date.parse(ex.recordedAt) < waitMs) return undefined;
    const view = s.handle.peerRelease?.(ex.winner);
    if (view === undefined) return undefined;
    if (view.current) return null;
    return view.elsewhere?.txSet === true ? 'winner-committed' : 'winner-offline';
  };

  /** Logs and reports a change of the wait reason (never anything else); a refused report is tried again. */
  const waitPass = async (s: RulingStepInput, ex: RulingExecution): Promise<void> => {
    const why = waitOf(s, ex);
    if (why === undefined || !s.reportWait) return;
    const was = waitReported.get(s.code);
    if (was === why) return;
    if (was === undefined && why === null) {
      // Nothing was said in this process: one clear, in case an earlier process reported a reason.
      const took = await s.reportWait(null).catch(() => false);
      if (took) waitReported.set(s.code, null);
      return;
    }
    const took = await s.reportWait(why).catch(() => false);
    if (!took) return;
    waitReported.set(s.code, why);
    o.log({ reason: why === null ? 'ruling-winner-joined' : `ruling-${why}` });
  };

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
    // Review M5: the desk's armed, unblocked refund goes first; the ruling waits until it is blocked.
    if (s.deskArmed?.kind === 'auto-refund' && (s.deskArmed.blocked ?? null) === null && o.store.state.executions[s.code] === undefined) {
      o.log({ reason: 'ruling-waits-desk-armed' });
      return 'desk-armed';
    }
    if (typeof s.escrowAddress !== 'string' || s.escrowAddress === '') {
      o.log({ reason: 'ruling-no-escrow' });
      return 'no-escrow';
    }
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
    if (announced.get(s.code) !== key) {
      const ex = o.store.state.executions[s.code]!;
      const statement: RulingStatement = {
        v: 1,
        trade: s.code,
        escrowAddress: s.escrowAddress,
        round: 1,
        rulingId: ex.rulingId,
        outcome: ex.winner === 'buyer' ? 'release-to-buyer' : 'refund-to-seller',
        winner: ex.winner,
        payouts: ex.payouts.map((p) => ({ address: p.address, amountAtomic: p.amountAtomic })),
        issuedAt: ex.recordedAt,
      };
      const sig = await signRulingStatement(statement, o.signingSecret);
      const took = await s.announce({ statement, sig }).catch(() => false);
      if (took !== true) {
        o.log({ reason: 'ruling-statement-refused' });
        return 'announce-failed';
      }
      announced.set(s.code, key);
    }
    if (inFlight.get(s.code) === key) {
      await waitPass(s, o.store.state.executions[s.code]!);
      return 'in-flight';
    }
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

  const kindFor = (code: string): RulingKind | null => {
    const ex = o.store.state.executions[code];
    return ex === undefined ? null : ex.winner === 'buyer' ? 'dispute-buyer' : 'dispute-seller';
  };

  return { step, kindFor };
}
