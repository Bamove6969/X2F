import { logHead, pgChainReader, verifyChain, type Querier } from '@x2f/logchain';
import type { GateStore } from './gate/index.js';
import type { Link } from './link.js';

/**
 * Plan 4 Task 14: the activity log's checkpoints, kept where the API cannot reach them. Each pass
 * (every `intervalMs`, 10 minutes by default) reads the log's head through the read-only role
 * (`x2f_mod_reader`, migration 212), records `{ id, hash, at }` in the sealed gate store (saved
 * before anything leaves) when the head moved, and reports it (`log-checkpoint`: the API logs
 * `log.checkpoint` only for the row that still has that hash). A head whose only new row is the
 * API's own `log.checkpoint` for the newest checkpoint is not a move (review I2), for at most
 * `CHECKPOINT_IDLE_MAX_MS` (3 hours; M3 re-verify A): then it is checkpointed and reported anyway, so
 * the API appends again and a reader view frozen at that row shows as a head that did not move. Once
 * `verifyEveryMs` (a day) has passed since the last verification, the pass also verifies: the whole
 * chain from its first row (`verifyChain`, @x2f/logchain, the API's own function; review M2: the
 * oldest checkpoint then anchors every row before it, since a rewrite re-chained up to it changes
 * its hash), and that every stored checkpoint's row still has its hash.
 *
 * The alarm (`log-alarm`: the API sets `site_flags.log_alarm`, shown on Overview; `log-alarm` in the
 * log; and stderr, which an API that ignores the report cannot silence) is raised on (review M3):
 * a failed verification; a 409 `checkpoint-mismatch` (the API's view of a row differs from the
 * reader's, read moments before); `CHECKPOINT_REFUSALS_MAX` (3) reports in a row refused or failed
 * with any other status (a refused report is sent again each pass; M3 re-verify B); a head that has
 * not moved past an accepted checkpoint (the API appends its `log.checkpoint`, so an unmoving head is
 * a frozen view); and no successful verification for longer than `verifyEveryMs` plus
 * `OVERDUE_MARGIN_MS` (the reader refused, locked or the table gone: an overdue verify alarms once
 * until one succeeds). The time of the last successful verification and of the overdue alarm are
 * sealed in gate.bin (`logVerifiedAt`, `logOverdueAlarmAt`), so restarts reset neither (M3 re-verify
 * C); before any verification the clock runs from the first start. The reader's pool has a
 * `statement_timeout` (main.ts), so a locked table fails a pass rather than stopping the loop.
 *
 * Residual: an entry rewritten and re-chained after the newest checkpoint is found only by the next
 * checkpoint's mismatch with what the API logged; and a database that shows this role one
 * consistent forged view (and appends the expected rows to it) cannot be caught from inside the
 * database: the checkpoints sealed in gate.bin are the evidence for an offline audit.
 */
export interface CheckpointOptions {
  store: GateStore;
  /** The API database through the read-only role. */
  reader: Querier;
  link: Pick<Link, 'report'>;
  now: () => Date;
  /** Reasons only. */
  log: (e: { reason: string }) => void;
  /** Pass period; 0 runs no timer (callers drive `pass`). Default 10 minutes. */
  intervalMs?: number;
  /** Default one day. */
  verifyEveryMs?: number;
  /** Where the alarm is written besides the report. Default stderr. */
  alarm?: (line: string) => void;
}

export interface Checkpoints {
  /** One pass: a new checkpoint when the head moved; the verification when it is due. */
  pass(): Promise<void>;
  /** Verifies now; true when the chain and every checkpoint hold. */
  verify(): Promise<boolean>;
  stop(): Promise<void>;
}

export const CHECKPOINT_INTERVAL_MS = 10 * 60_000;
export const VERIFY_EVERY_MS = 24 * 60 * 60_000;
/** How late the daily verification may be before its absence raises the alarm (review M3). */
export const OVERDUE_MARGIN_MS = 60 * 60_000;
/**
 * M3 re-verify (A): the longest an idle log goes without a new checkpoint. Past it, the head is
 * checkpointed and reported even when its only new row is the API's own `log.checkpoint`, so the
 * API appends again and the head must move past it: a reader view frozen at that row alarms.
 */
export const CHECKPOINT_IDLE_MAX_MS = 3 * 60 * 60_000;
/** M3 re-verify (B): consecutive refused or failed `log-checkpoint` reports (any status) that raise the alarm. */
export const CHECKPOINT_REFUSALS_MAX = 3;

export function startCheckpoints(o: CheckpointOptions): Checkpoints {
  const every = o.verifyEveryMs ?? VERIFY_EVERY_MS;
  const alarmLine = o.alarm ?? ((line: string) => process.stderr.write(`${line}\n`));
  const chain = pgChainReader(o.reader);
  let lastVerify: number | null = null;
  /** The checkpoint the API accepted last pass: the head must have moved past it since (review M3). */
  let accepted: string | null = null;
  /** The newest checkpoint while its report was refused: reported again each pass (M3 re-verify B). */
  let unreported: { id: string; hash: string } | null = null;
  let refusals = 0;

  /** Seals the overdue clock's fields in gate.bin (M3 re-verify C: they survive restarts). */
  const seal = (f: (s: GateStore['state']) => void): Promise<void> =>
    o.store.exclusive(async () => {
      f(o.store.state);
      await o.store.save();
    });
  const iso = () => o.now().toISOString();

  const raise = async (why: string): Promise<void> => {
    o.log({ reason: 'log-alarm' });
    alarmLine(JSON.stringify({ level: 60, msg: `activity log: ${why} (log_alarm)` }));
    const res = await o.link.report({ kind: 'log-alarm' }).catch(() => ({ status: 0, error: null }));
    if (res.status !== 201 && res.status !== 200) o.log({ reason: `log-alarm-report-refused-${res.status}` });
  };

  const verify = async (): Promise<boolean> => {
    const cps = o.store.state.checkpoints;
    // Review M2: from the log's first row, so the oldest checkpoint anchors everything before it.
    // Review of ruling-payout a42dad1b, N1: always, checkpoints or not, and an empty log is never
    // verified (a live site always holds owner.setup-completed): a reader view that is empty from
    // the first start (hidden rows, another table) raises the alarm instead of passing on nothing.
    const r = await verifyChain(chain);
    const empty = r.ok && r.head === null;
    let ok = r.ok && !empty;
    for (const cp of cps) {
      if (!ok) break;
      const row = await chain.row(cp.id);
      ok = row !== null && row.hash.toString('hex') === cp.hash;
    }
    lastVerify = o.now().getTime();
    if (ok) {
      await seal((st) => {
        st.logVerifiedAt = iso();
        st.logOverdueAlarmAt = null;
      });
      o.log({ reason: 'log-verified' });
      return true;
    }
    await raise(empty ? 'the log is empty to this reader (an empty log is never verified)' : 'a checkpoint no longer matches the log');
    return false;
  };

  /** True when every row after the newest checkpoint is the API's own `log.checkpoint` for it (review I2). */
  const onlyOwnCheckpoint = async (last: { id: string; hash: string }): Promise<boolean> => {
    const rows = await chain.after(last.id, 2);
    if (rows.length !== 1 || rows[0]!.action !== 'log.checkpoint') return false;
    try {
      const d = JSON.parse(rows[0]!.detail) as { id?: unknown; hash?: unknown };
      return d.id === last.id && d.hash === last.hash;
    } catch {
      return false;
    }
  };

  /** Reports a checkpoint; counts refusals of any kind (M3 re-verify B), alarms at once on a mismatch. */
  const report = async (cp: { id: string; hash: string }): Promise<void> => {
    const res = await o.link.report({ kind: 'log-checkpoint', id: cp.id, hash: cp.hash }).catch(() => ({ status: 0, error: null }));
    if (res.status === 201 || res.status === 200) {
      accepted = cp.id;
      unreported = null;
      refusals = 0;
      return;
    }
    unreported = cp;
    refusals++;
    o.log({ reason: `log-checkpoint-refused-${res.status}` });
    if (res.status === 409 && res.error === 'checkpoint-mismatch') await raise('the API and this reader see different rows (checkpoint-mismatch)');
    else if (refusals === CHECKPOINT_REFUSALS_MAX) await raise(`${refusals} checkpoint reports in a row were refused or failed`);
  };

  const pass = async (): Promise<void> => {
    // M3 re-verify C: the overdue clock is sealed in gate.bin; before the first verification it runs from the first start.
    if (o.store.state.logVerifiedAt === null) await seal((st) => void (st.logVerifiedAt ??= iso()));
    const lastOk = Date.parse(o.store.state.logVerifiedAt!);
    // Review M3: checked first, so a reader that fails every query still raises it, once until a verification succeeds.
    if (o.store.state.logOverdueAlarmAt === null && o.now().getTime() - lastOk > every + OVERDUE_MARGIN_MS) {
      await seal((st) => void (st.logOverdueAlarmAt = iso()));
      await raise('the daily verification is overdue (the log could not be read)');
    }
    const head = await logHead(o.reader);
    const last = o.store.state.checkpoints.at(-1);
    if (accepted !== null) {
      const was = accepted;
      accepted = null;
      if (head === null || BigInt(head.id) <= BigInt(was)) await raise('the head did not move past an accepted checkpoint (a frozen view)');
    }
    // Review I2, bounded (M3 re-verify A): the API's own log.checkpoint is no move for at most CHECKPOINT_IDLE_MAX_MS.
    const idle = last !== undefined && o.now().getTime() - Date.parse(last.at) < CHECKPOINT_IDLE_MAX_MS && (await onlyOwnCheckpoint(last));
    if (head !== null && last?.id !== head.id && !idle) {
      const cp = { id: head.id, hash: head.hash };
      await o.store.exclusive(async () => {
        o.store.state.checkpoints.push({ ...cp, at: iso() });
        await o.store.save();
      });
      await report(cp);
    } else if (unreported !== null) {
      await report(unreported);
    }
    if (lastVerify === null || o.now().getTime() - lastVerify >= every) await verify();
  };

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();
  const interval = o.intervalMs ?? CHECKPOINT_INTERVAL_MS;
  const loop = (): void => {
    if (stopped) return;
    running = pass()
      .catch(() => o.log({ reason: 'log-checkpoint-failed' }))
      .finally(() => {
        if (!stopped) timer = setTimeout(loop, interval);
      });
  };
  if (interval > 0) loop();

  return {
    pass,
    verify,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
