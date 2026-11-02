import type { ReactNode } from 'react';
import './ui.css';

/** One key and value row; `rule` draws a line above it (the Refunded board's totals under the timeline). */
export interface Fact {
  key: string;
  /** What the row shows for its key, when it holds more than text (a username). Defaults to `key`. */
  label?: ReactNode;
  value: ReactNode;
  rule?: boolean;
}

/**
 * Key and value rows as a `<dl>` (Refunded "What happened", BuyerPaidWaiting "Your payment"): the
 * key muted on the left, the value in mono on the right.
 */
export function Facts({ rows, part }: { rows: readonly Fact[]; part?: string }) {
  return (
    <dl className="x2f-facts" data-part={part}>
      {rows.map((r) => (
        <div key={r.key} className="x2f-facts__row" data-rule={r.rule ? '' : undefined}>
          <dt className="x2f-facts__key">{r.label ?? r.key}</dt>
          <dd className="x2f-facts__value">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
