import type { ReactNode } from 'react';
import './ui.css';

/** One key and value row; `rule` draws a line above it (the Refunded board's totals under the timeline). */
export interface KeyValue {
  key: string;
  /** What the row shows for its key, when it holds more than text (a username). Defaults to `key`. */
  label?: ReactNode;
  value: ReactNode;
  rule?: boolean;
}

/**
 * Key and value rows as a `<dl>`, the key and value side by side (the kit's `.x2f-facts` stacks
 * them, LoginApprove board) (Refunded "What happened", BuyerPaidWaiting "Your payment"): the
 * key muted on the left, the value in mono on the right.
 */
export function KeyValues({ rows, part }: { rows: readonly KeyValue[]; part?: string }) {
  return (
    <dl className="x2f-kv" data-part={part}>
      {rows.map((r) => (
        <div key={r.key} className="x2f-kv__row" data-rule={r.rule ? '' : undefined}>
          <dt className="x2f-kv__key">{r.label ?? r.key}</dt>
          <dd className="x2f-kv__value">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
