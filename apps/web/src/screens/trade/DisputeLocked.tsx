/**
 * "Open dispute", locked until the wait is over, with when it opens (board BuyerPaidWaiting
 * window=in-window: "Available from 15:35 UTC · in 88 min"). Shared by the buyer's BuyerPay and the
 * seller's SellerConfirm: in `paid` either side waits the payment method's full time from "I've
 * paid" (owner p9-4, 8 Nov).
 */
import { useEffect, useId, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { utcDate, utcDateTime } from '../../ui/dates.js';
import './pay.css';

/** Re-renders every `ms` so a time written into the text stays true (the Countdown does this for its own). */
function useTick(ms: number): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** "in 88 min" up to two hours (the board's), then "in 23 h" (whole hours down, as DisputeRoom's "(in 23 h)"). */
function waitLeft(ms: number): string {
  const min = Math.max(1, Math.ceil(Math.max(0, ms) / 60_000));
  return min < 120 ? `in ${min} min` : `in ${Math.floor(min / 60)} h`;
}

/**
 * "Open dispute", locked until the buyer's wait is over (board BuyerPaidWaiting window=in-window:
 * "Available from 15:35 UTC · in 88 min"). The time is UTC for every viewer (design X5); a wait that
 * ends on another day names the date. COPY-UNSIGNED beyond the board's line.
 */
export function DisputeLocked({ until, serverClock }: { until: string; serverClock: () => Date }) {
  useTick(15_000);
  const id = useId();
  const end = new Date(until);
  const now = serverClock();
  const full = utcDateTime(end);
  const when = utcDate(end) === utcDate(now) ? full.slice(full.indexOf(', ') + 2) : full;
  return (
    <span className="x2f-room__dispute-locked">
      <Button variant="quiet" disabled aria-describedby={id}>
        Open dispute
      </Button>
      <span id={id} className="x2f-room__dispute-wait" data-dispute-wait="">
        Available from <span className="x2f-mono">{when}</span> · <span className="x2f-mono">{waitLeft(end.getTime() - now.getTime())}</span>
      </span>
    </span>
  );
}
