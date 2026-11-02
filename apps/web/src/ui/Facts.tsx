import type { ReactNode } from 'react';
import './ui.css';

/** One key and value; `label` replaces the key's text when it holds more (a username). */
export interface Fact {
  key: string;
  label?: ReactNode;
  value: ReactNode;
  /** rows: a line above it (the Refunded board's totals under the timeline). */
  rule?: boolean;
  /** stacked: the value in 16/600 (LoginApprove "Device"). */
  strong?: boolean;
  /** stacked: the value in mono (a time). */
  mono?: boolean;
}

/**
 * Facts as a `<dl class="x2f-facts">`, in one of two layouts:
 * - `stacked` (LoginApprove board): the key over the value, in a raised box;
 * - `rows` (Refunded "What happened", BuyerPaidWaiting "Your payment"): the key muted on the left,
 *   the value in mono on the right, no box of its own.
 */
export function Facts({ rows, layout, part }: { rows: readonly Fact[]; layout: 'stacked' | 'rows'; part?: string }) {
  return (
    <dl className="x2f-facts" data-layout={layout} data-part={part}>
      {rows.map((r) => (
        <div key={r.key} data-rule={r.rule ? '' : undefined}>
          <dt>{r.label ?? r.key}</dt>
          <dd data-strong={r.strong ? 'true' : undefined} className={r.mono ? 'x2f-num' : undefined}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
