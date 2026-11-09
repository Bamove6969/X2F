/**
 * Sends the queued account-change notices (owner rule p5-7). The change itself only inserted a row
 * in `jabber_outbox` (migration 331's triggers), so a slow or broken Jabber server never delays or
 * fails it: this worker runs on its own timer, after commit. Each notice is the fixed sentence and
 * nothing else (`NOTICE_TEXT`: the account-change sentence, or the trade-attention one for a dispute). A failed send is retried a few times with a growing wait and then dropped. Logs
 * carry counts only: never an address, an account id or an error message (which could quote one).
 */
import type pg from 'pg';
import type { Config } from '../config.js';
import { openJid } from './address.js';
import type { JabberSender, NoticeKind } from './sender.js';

/** Tries per notice, and the wait before each retry. */
export const OUTBOX_ATTEMPTS = 4;
const RETRY_WAIT_MS = [60_000, 5 * 60_000, 30 * 60_000];
/** Notices per pass; a pass sends them one after another. */
export const OUTBOX_BATCH = 25;
/** A send that has not finished by then counts as failed. */
export const SEND_TIMEOUT_MS = 30_000;

export interface OutboxDeps {
  db: pg.Pool;
  clock: () => Date;
  config: Pick<Config, 'jabberKeys'>;
  sender: JabberSender;
}

export interface OutboxResult {
  sent: number;
  retried: number;
  dropped: number;
}

/** Rejects after `ms` (never quoting anything). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('jabber: send timed out')), ms);
    timer.unref();
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * One pass: takes up to `OUTBOX_BATCH` due notices (removing them, so two API processes never send
 * the same one), sends each, puts a failed one back for later and records `last_sent_at` on success.
 */
export async function sendDueNotices(deps: OutboxDeps): Promise<OutboxResult> {
  const out: OutboxResult = { sent: 0, retried: 0, dropped: 0 };
  const ring = deps.config.jabberKeys;
  if (ring === null) return out;
  const now = deps.clock();
  const { rows } = await deps.db.query<{ account_id: string; jid_sealed: Buffer; txid: string; kind: NoticeKind; attempts: number }>(
    `delete from jabber_outbox where id in (
       select id from jabber_outbox where next_at is null or next_at <= $1 order by id limit $2 for update skip locked)
     returning account_id, jid_sealed, txid, kind, attempts`,
    [now, OUTBOX_BATCH],
  );
  for (const row of rows) {
    let jid: string;
    try {
      jid = openJid(ring, row.account_id, row.jid_sealed);
    } catch {
      out.dropped++; // a blob that does not open never will
      continue;
    }
    try {
      await withTimeout(deps.sender.send(jid, { kind: row.kind }), SEND_TIMEOUT_MS);
      out.sent++;
      await deps.db.query('update jabber_contacts set last_sent_at = $2 where account_id = $1', [row.account_id, deps.clock()]);
    } catch {
      const attempts = row.attempts + 1;
      if (attempts >= OUTBOX_ATTEMPTS) {
        out.dropped++;
        continue;
      }
      out.retried++;
      await deps.db.query(
        `insert into jabber_outbox (account_id, jid_sealed, txid, kind, attempts, next_at) values ($1, $2, $3, $4, $5, $6)
         on conflict (account_id, txid, kind) do nothing`,
        [row.account_id, row.jid_sealed, row.txid, row.kind, attempts, new Date(deps.clock().getTime() + RETRY_WAIT_MS[attempts - 1]!)],
      );
    }
  }
  return out;
}

/** The only log lines: counts. */
export type OutboxLog = (e: { jabber: 'outbox'; sent: number; retried: number; dropped: number } | { jabber: 'outbox'; failed: true }) => void;

/**
 * Runs `sendDueNotices` every `everyMs` (default 5 s; a pass in flight makes the next tick skip).
 * Returns `stop`, which resolves once the pass in flight has finished.
 */
export function startOutbox(deps: OutboxDeps, log: OutboxLog, everyMs = 5_000): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const tick = () => {
    if (inFlight || stopped) return;
    const p = sendDueNotices(deps).then(
      (r) => {
        if (r.sent + r.retried + r.dropped > 0) log({ jabber: 'outbox', ...r });
      },
      () => log({ jabber: 'outbox', failed: true }),
    );
    inFlight = p;
    void p.finally(() => {
      if (inFlight === p) inFlight = null;
    });
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
