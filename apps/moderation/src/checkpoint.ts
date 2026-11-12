import { logHead, pgChainReader, verifyChain, type Querier } from '@x2f/logchain';
import type { GateStore } from './gate/index.js';
import type { Link } from './link.js';

/**
 * Plan 4 Task 14: the activity log's checkpoints, kept where the API cannot reach them. Each pass
 * (every `intervalMs`, 10 minutes by default) reads the log's head through the read-only role
 * (`x2f_mod_reader`, migration 212), records `{ id, hash, at }` in the sealed gate store (saved
 * before anything leaves) when the head moved, and reports it (`log-checkpoint`: the API logs
 * `log.checkpoint` only for the row that still has that hash). A head whose only new row is the
 * API's own `log.checkpoint` for the newest checkpoint is not a move (review I2). Once
 * `verifyEveryMs` (a day) has passed since the last verification, the pass also verifies: the whole
 * chain from its first row (`verifyChain`, @x2f/logchain, the API's own function; review M2: the
 * oldest checkpoint then anchors every row before it, since a rewrite re-chained up to it changes
 * its hash), and that every stored checkpoint's row still has its hash.
 *
 * The alarm (`log-alarm`: the API sets `site_flags.log_alarm`, shown on Overview; `log-alarm` in the
 * log; and stderr, which an API that ignores the report cannot silence) is raised on (review M3):
 * a failed verification; a 409 `checkpoint-mismatch` (the API's view of a row differs from the
 * reader's, read moments before); a head that has not moved past an accepted checkpoint (the API
 * appends its `log.checkpoint`, so an unmoving head is a frozen view); and no successful
 * verification for longer than `verifyEveryMs` plus `OVERDUE_MARGIN_MS` (the reader refused, locked
 * or the table gone: an overdue verify alarms once until one succeeds). The reader's pool has a
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

export function startCheckpoints(o: CheckpointOptions): Checkpoints {
  const every = o.verifyEveryMs ?? VERIFY_EVERY_MS;
  const alarmLine = o.alarm ?? ((line: string) => process.stderr.write(`${line}\n`));
  const chain = pgChainReader(o.reader);
  let lastVerify: number | null = null;
  /** The last successful verification, or the start: an overdue one is an alarm (review M3). */
  let lastOk = o.now().getTime();
  let overdueRaised = false;
  /** The checkpoint the API accepted last pass: the head must have moved past it since (review M3). */
  let accepted: string | null = null;

  const raise = async (why: string): Promise<void> => {
    o.log({ reason: 'log-alarm' });
    alarmLine(JSON.stringify({ level: 60, msg: `activity log: ${why} (log_alarm)` }));
    const res = await o.link.report({ kind: 'log-alarm' }).catch(() => ({ status: 0, error: null }));
    if (res.status !== 201 && res.status !== 200) o.log({ reason: `log-alarm-report-refused-${res.status}` });
  };

  const verify = async (): Promise<boolean> => {
    const cps = o.store.state.checkpoints;
    let ok = true;
    if (cps.length > 0) {
      // Review M2: from the log's first row, so the oldest checkpoint anchors everything before it.
      const r = await verifyChain(chain);
      ok = r.ok;
      for (const cp of cps) {
        if (!ok) break;
        const row = await chain.row(cp.id);
        ok = row !== null && row.hash.toString('hex') === cp.hash;
      }
    }
    lastVerify = o.now().getTime();
    if (ok) {
      lastOk = lastVerify;
      overdueRaised = false;
      o.log({ reason: 'log-verified' });
      return true;
    }
    await raise('a checkpoint no longer matches the log');
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

  const pass = async (): Promise<void> => {
    // Review M3: checked first, so a reader that fails every query still raises it.
    if (!overdueRaised && o.now().getTime() - lastOk > every + OVERDUE_MARGIN_MS) {
      overdueRaised = true;
      await raise('the daily verification is overdue (the log could not be read)');
    }
    const head = await logHead(o.reader);
    const last = o.store.state.checkpoints.at(-1);
    if (accepted !== null) {
      const was = accepted;
      accepted = null;
      if (head === null || BigInt(head.id) <= BigInt(was)) await raise('the head did not move past an accepted checkpoint (a frozen view)');
    }
    if (head !== null && last?.id !== head.id && !(last !== undefined && (await onlyOwnCheckpoint(last)))) {
      await o.store.exclusive(async () => {
        o.store.state.checkpoints.push({ id: head.id, hash: head.hash, at: o.now().toISOString() });
        await o.store.save();
      });
      const res = await o.link.report({ kind: 'log-checkpoint', id: head.id, hash: head.hash }).catch(() => ({ status: 0, error: null }));
      if (res.status === 201 || res.status === 200) accepted = head.id;
      else if (res.status === 409 && res.error === 'checkpoint-mismatch') await raise('the API and this reader see different rows (checkpoint-mismatch)');
      else o.log({ reason: `log-checkpoint-refused-${res.status}` });
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
