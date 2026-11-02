import type { ReactNode } from 'react';
import './ui.css';

// A one-line outcome under a screen's header. `caution` for something X2F's rules held back (a
// hold, a refusal: information, not an error), `danger` for a fault that left things unchanged,
// `plain` for a done change. Caution and danger are announced as alerts, plain as a status.
export type NoticeTone = 'plain' | 'caution' | 'danger';

// An optional `title` goes in bold above the words (My offers' trading-hold notice).
export function Notice({ tone, title, children, ...data }: { tone: NoticeTone; title?: string; children: ReactNode; [k: `data-${string}`]: string | undefined }) {
  return (
    <div {...data} className="x2f-outcome" data-tone={tone} role={tone === 'plain' ? 'status' : 'alert'}>
      {title !== undefined ? <p className="x2f-outcome__title">{title}</p> : null}
      <p className="x2f-outcome__body">{children}</p>
    </div>
  );
}
