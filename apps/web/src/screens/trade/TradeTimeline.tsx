/**
 * The Desktop board's trade progress (TradeTimeline) and the counterparty card at the top of its
 * chat column (CounterpartyCard). Built for the wide trade room (Task 23).
 */
import type { ReactNode } from 'react';
import { Countdown } from '../../ui/Countdown.js';
import { counterpartyLine, timelineSteps, type StepKey } from './payModel.js';
import { publicName, type TradeView } from './payTypes.js';
import './pay.css';

/** The other trader's public Trade Tag, marked for parity (never text-transformed). */
export function Name({ view }: { view: Pick<TradeView, 'counterparty'> }) {
  return <span data-username="">{publicName(view.counterparty)}</span>;
}

function label(key: StepKey, view: TradeView, serverClock: () => Date): ReactNode {
  const buyer = view.role === 'buyer';
  switch (key) {
    case 'funded':
      return 'Escrow funded';
    case 'pay': {
      const who = buyer ? 'You pay' : <><Name view={view} /> pays</>;
      // The countdown only runs once the escrow settled and the 90 minutes started.
      if (view.payBy === null || (view.state !== 'secured' && view.state !== 'securing')) return who;
      return (
        <>
          {who} · <Countdown deadline={view.payBy} serverClock={serverClock} format="minutes" /> left
        </>
      );
    }
    case 'confirm':
      return buyer ? 'Seller confirms' : 'You confirm';
    case 'released':
      return 'XMR released';
  }
}

export function TradeTimeline({ view, serverClock }: { view: TradeView; serverClock: () => Date }) {
  return (
    <ol aria-label="Trade progress" className="x2f-timeline">
      {timelineSteps(view).map((s) => (
        <li key={s.key} className="x2f-timeline__step" data-status={s.status} aria-current={s.status === 'current' ? 'step' : undefined}>
          <span className="x2f-timeline__bar" aria-hidden="true" />
          <span className="x2f-timeline__label">{label(s.key, view, serverClock)}</span>
        </li>
      ))}
    </ol>
  );
}

/** "satoshi_ghost", "412 trades · 99% positive · releases in ~6 min" and the badges. */
export function CounterpartyCard({ view }: { view: TradeView }) {
  const badges = view.counterparty.badges;
  return (
    <div className="x2f-counterparty">
      <div className="x2f-counterparty__text">
        <span className="x2f-counterparty__name">
          <Name view={view} />
        </span>
        <span className="x2f-counterparty__line">{counterpartyLine(view)}</span>
      </div>
      {badges.length > 0 ? (
        <span className="x2f-counterparty__badges">
          {badges.map((b) => (
            <span key={b} className="x2f-counterparty__badge">
              {b}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
