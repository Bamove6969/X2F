// D-005 (owner 28 Oct; Plan 4 Task 24): a "File appeal" button on the trade page and on the
// completed-trades list row, shown only while an appeal can still be filed and gone at the deadline.
// The deadline is the trade view's `appealUntil` (the API sends it only to a viewer the appeal route
// lets through: the account owner, or a member with the File an appeal box), compared with the
// server clock. It opens the trade's dispute page, whose ruling card holds the appeal form
// (POST /v1/trades/:code/appeal). The completed-trades list is not built yet (Desktop board note):
// its row takes this same component. DESIGNER-REVIEW: no board shows it; placement and words are ours.
import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { dayTime } from './rules.js';
import './dispute.css';

/** Whether an appeal can still be filed at `now` (server ms): strictly before a valid deadline. */
export function appealOpen(appealUntil: string | null | undefined, now: number): boolean {
  if (typeof appealUntil !== 'string') return false;
  const until = Date.parse(appealUntil);
  return Number.isFinite(until) && now < until;
}

export function FileAppeal({ code, appealUntil, serverClock }: { code: string; appealUntil: string | null | undefined; serverClock: () => Date }) {
  const [, tick] = useState(0);
  const until = typeof appealUntil === 'string' ? Date.parse(appealUntil) : Number.NaN;
  // Re-render at the deadline so the button goes on time, not at the next re-read.
  useEffect(() => {
    if (!Number.isFinite(until)) return;
    const wait = until - serverClock().getTime();
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const id = setTimeout(() => tick((n) => n + 1), wait);
    return () => clearTimeout(id);
  }, [until, serverClock]);
  if (!appealOpen(appealUntil, serverClock().getTime())) return null;
  const at = new Date(until);
  return (
    <section aria-label="Appeal" className="x2f-stack" data-part="file-appeal">
      <p className="dispute-muted-sm">
        {/* COPY-UNSIGNED (Plan 4 Task 24's outcome notice, shortened) */}
        {"Don't agree with the moderator's decision? You can appeal until "}
        <time dateTime={at.toISOString()}>{dayTime(at)}</time>.
      </p>
      <Button variant="secondary" href={`/trade/${encodeURIComponent(code)}/dispute`}>
        {/* COPY-UNSIGNED */}
        File appeal
      </Button>
    </section>
  );
}
