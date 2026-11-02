import type { ReactNode } from 'react';
import './ui.css';

// A one-line outcome under a screen's header. `caution` for something X2F's rules held back (a
// hold, a refusal: information, not an error), `danger` for a fault that left things unchanged,
// `plain` for a done change. Caution and danger are announced as alerts, plain as a status.
export type NoticeTone = 'plain' | 'caution' | 'danger';

export function Notice({ tone, children, ...data }: { tone: NoticeTone; children: ReactNode; [k: `data-${string}`]: string | undefined }) {
  return (
    <p {...data} className="x2f-outcome" data-tone={tone} role={tone === 'plain' ? 'status' : 'alert'}>
      {children}
    </p>
  );
}
