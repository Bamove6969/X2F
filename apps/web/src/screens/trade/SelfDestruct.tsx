/**
 * The self-destruct notice line in the trade room (Plan 7 Task 3; owner 2026-10-29): the date the
 * server will delete the trade whole (`TradeView.deleteAt`), and the same date for this device's
 * own copies (localPurge). Shown only once a trade has a date (it has ended and no dispute is
 * pending).
 *
 * No board yet: Claude Design owns the look, so this line uses the existing `x2f-note` class only
 * and adds no styling (test/privacy-tripwire.test.ts NEEDS_DESIGN_SELFDESTRUCT). Copy is the
 * plan's, // COPY-UNSIGNED until the owner signs it off.
 */
import { useEffect, useState } from 'react';
import type { TradeView } from '../../api/trade.js';
import { currentAccountId, purgeTradeLocally, rememberDeleteAt } from '../../chat/localPurge.js';
import '../screens.css';

/** The self-destruct date as the reader's locale writes a date. */
export function deleteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** The notice's text, or null when the trade has no date yet. */
export function selfDestructText(view: Pick<TradeView, 'deleteAt' | 'dispute'>): string | null {
  const at = view.deleteAt ?? null;
  if (at === null) return null;
  // COPY-UNSIGNED (Plan 7 Task 3)
  if (view.dispute !== null) return `Kept until ${deleteDate(at)} because a dispute was opened.`;
  // COPY-UNSIGNED (Plan 7 Task 3)
  return `This trade self-destructs on ${deleteDate(at)}.`;
}

/**
 * Remembers the trade's date on this device (with the signed-in account, review R2-m3) and, once
 * it has passed (server time), deletes this device's copies and reports `gone`. `accountId` is
 * injectable for tests.
 */
export function useSelfDestruct(
  code: string,
  view: Pick<TradeView, 'deleteAt'>,
  serverClock: () => Date,
  accountId: () => Promise<string | null> = currentAccountId,
): { gone: boolean } {
  const at = view.deleteAt ?? null;
  const [gone, setGone] = useState(false);
  useEffect(() => {
    rememberDeleteAt(code, at);
    if (at === null) return;
    let stop = false;
    let purged = false;
    void accountId().then(
      (id) => {
        // Not after the purge: that would bring the entry back.
        if (!stop && !purged && id !== null) rememberDeleteAt(code, at, id);
      },
      () => undefined,
    );
    const check = () => {
      if (Date.parse(at) > serverClock().getTime()) return false;
      purged = true;
      void purgeTradeLocally(code).then(() => {
        if (!stop) setGone(true);
      });
      return true;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!check()) {
      const wait = Date.parse(at) - serverClock().getTime();
      if (Number.isFinite(wait) && wait <= 2 ** 31 - 1) timer = setTimeout(check, Math.max(0, wait));
    }
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [code, at, serverClock, accountId]);
  return { gone };
}

export function SelfDestructNotice({ view }: { view: Pick<TradeView, 'deleteAt' | 'dispute'> }) {
  const at = view.deleteAt ?? null;
  if (at === null) return null;
  const date = <time dateTime={at}>{deleteDate(at)}</time>;
  return (
    <p className="x2f-note" data-part="self-destruct">
      {view.dispute !== null ? <>Kept until {date} because a dispute was opened.</> : <>This trade self-destructs on {date}.</>}
    </p>
  );
}

/** Shown in place of the trade once its date has passed on this device. */
export function SelfDestructed() {
  return (
    <p className="x2f-note" data-part="self-destructed" role="status">
      {/* COPY-UNSIGNED (Plan 7 Task 3) */}
      This trade has self-destructed. Nothing about it is kept on this device.
    </p>
  );
}
