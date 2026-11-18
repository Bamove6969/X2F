/**
 * The self-destruct line in the trade room (Plan 7 Task 3; owner 2026-10-29, p11-11): the date the
 * server deletes the trade whole (`TradeView.deleteAt`: 30 days after it ended, or 90 days after
 * its last dispute closed), which is also when this device's own copies go (chat/localPurge.ts).
 * Shown only once the trade has a date (it has ended and no dispute or appeal is open).
 *
 * No board yet: Claude Design owns the look, so the line uses the existing `x2f-note` class and the
 * one date format (`When`, ui/dates.ts) and adds no styling. The copy is the plan's (Task 3),
 * COPY-UNSIGNED until the owner signs it off.
 */
import { useEffect, useState } from 'react';
import type { TradeView } from '../../api/trade.js';
import { endedForLocalPurge, purgeTradeLocally, rememberDeleteAt } from '../../chat/localPurge.js';
import { formatDate } from '../../ui/dates.js';
import { When } from '../../ui/When.js';

type DateView = Pick<TradeView, 'deleteAt' | 'dispute'>;

/** What the room's local purge reads from the view. */
export type SelfDestructView = Pick<TradeView, 'deleteAt' | 'state' | 'closedAt' | 'appealUntil'>;

/** The notice's text, or null when the trade has no date yet. */
export function selfDestructText(view: Partial<DateView>): string | null {
  const at = view.deleteAt ?? null;
  if (at === null) return null;
  // COPY-UNSIGNED (Plan 7 Task 3)
  if (view.dispute !== null && view.dispute !== undefined) return `Kept until ${formatDate(at)} because a dispute was opened.`;
  // COPY-UNSIGNED (Plan 7 Task 3)
  return `This trade self-destructs on ${formatDate(at)}.`;
}

/**
 * Remembers the trade's date on this device and, once it has passed by the server clock, deletes
 * this device's copies and reports `gone`. Review round 1, I2: only in a room that is not `broken`
 * (the escrow integrity check failed) and for a view that itself shows the trade ended
 * (`endedForLocalPurge`); otherwise it does nothing, except that a view with no date forgets any
 * date stored before. A view from an older API (no `deleteAt` at all) changes nothing.
 */
export function useSelfDestruct(code: string, view: SelfDestructView, serverClock: () => Date, broken = false): { gone: boolean } {
  const known = view.deleteAt !== undefined;
  const at = view.deleteAt ?? null;
  const { state, closedAt } = view;
  const appealUntil = view.appealUntil ?? null;
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!known || broken) return;
    if (at === null) {
      rememberDeleteAt(code, null);
      return;
    }
    const facts = { state, closedAt, deleteAt: at, appealUntil };
    if (!endedForLocalPurge(facts, serverClock().getTime())) return;
    rememberDeleteAt(code, at);
    let stop = false;
    const check = (): boolean => {
      if (Date.parse(at) > serverClock().getTime()) return false;
      if (!endedForLocalPurge(facts, serverClock().getTime())) return false;
      void purgeTradeLocally(code).then(() => {
        if (!stop) setGone(true);
      });
      return true;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!check()) {
      const wait = Date.parse(at) - serverClock().getTime();
      // setTimeout cannot wait longer than 2^31-1 ms (about 24 days); the room is reopened before then.
      if (Number.isFinite(wait) && wait <= 2 ** 31 - 1) timer = setTimeout(check, Math.max(0, wait));
    }
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [code, known, broken, at, state, closedAt, appealUntil, serverClock]);
  return { gone };
}

export function SelfDestructNotice({ view }: { view: Partial<DateView> }) {
  const at = view.deleteAt ?? null;
  if (at === null) return null;
  const date = <When at={at} form="date" />;
  return (
    <p className="x2f-note" data-part="self-destruct">
      {view.dispute !== null && view.dispute !== undefined ? (
        // COPY-UNSIGNED (Plan 7 Task 3)
        <>Kept until {date} because a dispute was opened.</>
      ) : (
        // COPY-UNSIGNED (Plan 7 Task 3)
        <>This trade self-destructs on {date}.</>
      )}
    </p>
  );
}

/** Shown in place of the trade once its date has passed on this device. */
export function SelfDestructed() {
  return (
    <p className="x2f-note" data-part="self-destructed" role="status">
      {/* COPY-UNSIGNED (Plan 7 Task 3) */}
      This trade has self-destructed. Its messages and details are gone from this device; the wallet keeps the escrow only while coins could still be in it.
    </p>
  );
}
