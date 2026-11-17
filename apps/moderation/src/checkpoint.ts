import { logHead, pgChainReader, verifyChain, type Querier } from '@x2f/logchain';
import type { GateStore } from './gate/index.js';
import type { Link } from './link.js';

/**
 * Plan 4 Task 14: the activity log's checkpoints, kept where the API cannot reach them. Each pass
 * (every `intervalMs`, 10 minutes by default) reads the log's head through the read-only role
 * (`x2f_mod_reader`, migration 212), records `{ id, hash, at }` in the sealed gate store (saved
 * before anything leaves) when the head moved, and reports it (`log-checkpoint`: the API logs
 * `log.checkpoint` only for the row that still has that hash). Once `verifyEveryMs` (a day) has
 * passed since the last verification, the pass also verifies: the whole chain from the oldest
 * checkpoint (`verifyChain`, @x2f/logchain, the API's own function), and that every stored
 * checkpoint's row still has its hash. A failure reports the alarm (`log-alarm`: the API sets
 * `site_flags.log_alarm`, shown on Overview), logs `log-alarm` and writes to stderr: an API that
 * ignores the report cannot silence the process's own output.
 *
 * Residual (as the plan says): an entry rewritten and re-chained after the newest checkpoint is
 * found only by the next checkpoint's mismatch with what the API logged; rows before the oldest
 * checkpoint are verified only as far as their links to it.
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

export function startCheckpoints(o: CheckpointOptions): Checkpoints {
  const every = o.verifyEveryMs ?? VERIFY_EVERY_MS;
  const alarm = o.alarm ?? ((line: string) => process.stderr.write(`${line}\n`));
  const chain = pgChainReader(o.reader);
  let lastVerify: number | null = null;

  const verify = async (): Promise<boolean> => {
    const cps = o.store.state.checkpoints;
    let ok = true;
    if (cps.length > 0) {
      const r = await verifyChain(chain, { id: cps[0]!.id, hash: cps[0]!.hash });
      ok = r.ok;
      for (const cp of cps) {
        if (!ok) break;
        const row = await chain.row(cp.id);
        ok = row !== null && row.hash.toString('hex') === cp.hash;
      }
    }
    lastVerify = o.now().getTime();
    if (ok) {
      o.log({ reason: 'log-verified' });
      return true;
    }
    o.log({ reason: 'log-alarm' });
    alarm(JSON.stringify({ level: 60, msg: 'activity log: a checkpoint no longer matches the log (log_alarm)' }));
    const res = await o.link.report({ kind: 'log-alarm' }).catch(() => ({ status: 0, error: null }));
    if (res.status !== 201 && res.status !== 200) o.log({ reason: `log-alarm-report-refused-${res.status}` });
    return false;
  };

  const pass = async (): Promise<void> => {
    const head = await logHead(o.reader);
    const last = o.store.state.checkpoints.at(-1);
    if (head !== null && last?.id !== head.id) {
      await o.store.exclusive(async () => {
        o.store.state.checkpoints.push({ id: head.id, hash: head.hash, at: o.now().toISOString() });
        await o.store.save();
      });
      const res = await o.link.report({ kind: 'log-checkpoint', id: head.id, hash: head.hash }).catch(() => ({ status: 0, error: null }));
      if (res.status !== 201 && res.status !== 200) o.log({ reason: `log-checkpoint-refused-${res.status}` });
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
