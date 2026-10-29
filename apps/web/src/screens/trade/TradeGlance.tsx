/**
 * The trade at a glance (Plan 3 Task 40; Fold-Tabletop's top half, Fold-Cover's card): who, the
 * code and method, the escrow's state, the amount and the time left. Information only: no link,
 * button or input, because on a tabletop every control sits in the bottom half and the flip cover
 * screen takes no trade actions. Sums are this device's own figures (the escrow's), never the
 * API's (Task 23 review I1); without them the amount is left out.
 */
import { formatXmr } from '@x2f/trade';
import { Countdown } from '../../ui/Countdown.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { deviceTotal } from './PaidFlowSheet.js';
import { escrowChip } from './payModel.js';
import { payMethodOf } from './paySeams.js';
import type { TradeScreenProps } from './payTypes.js';
import { Name } from './TradeTimeline.js';

export function TradeGlance({ view, escrow, serverClock, cover }: Pick<TradeScreenProps, 'view' | 'escrow' | 'serverClock'> & { cover: boolean }) {
  const chip = escrowChip(view);
  const total = deviceTotal(view, escrow);
  const method = payMethodOf(view);
  return (
    <div className="x2f-fold-glance" data-cover={cover || undefined}>
      <div className="x2f-trade-intro">
        <p className="x2f-trade-title">
          {view.role === 'buyer' ? 'Buying from' : 'Selling to'} <Name view={view} />
        </p>
        <span className="x2f-muted">
          Trade {view.code} · {method.name}
        </span>
      </div>
      {chip ? <StatusChip tone={chip.tone} icon={chip.icon} label={chip.label} /> : null}
      {total ? (
        <p className="x2f-fold-glance__fact">
          {/* COPY-UNSIGNED */}
          <span className="x2f-trade-label">Amount</span>
          <span className="x2f-mono">
            {total.text} {total.currency}
          </span>
          {escrow.amountAtomic !== null ? <span className="x2f-mono x2f-muted">{formatXmr(escrow.amountAtomic)} XMR</span> : null}
        </p>
      ) : null}
      {view.nextDeadline !== null && view.pausedAt === null ? (
        <p className="x2f-fold-glance__fact">
          {/* COPY-UNSIGNED */}
          <span className="x2f-trade-label">Time left</span>
          <span className="x2f-mono">
            <Countdown deadline={view.nextDeadline} serverClock={serverClock} format="minutes" />
          </span>
        </p>
      ) : null}
      {cover ? (
        // The Fold-Cover board's words; a web page cannot move itself to the main screen.
        <p className="x2f-muted" role="status">
          Open your phone to keep going.
        </p>
      ) : null}
    </div>
  );
}
