import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './icons.js';
import { MethodExplainer } from './MethodExplainer.js';
import { ScreenHeader } from './ScreenHeader.js';
import './ui.css';

/**
 * The trade-room header (TradeFund, BuyerPay, SellerConfirm boards): back, the title
 * ("Selling to mira.k"), "Trade <code> · <method>" and an optional action on the right (the
 * boards' Chat link). Tapping the method name opens its "What is this?" explainer (spec 2.6).
 * Pass the title with the username wrapped in `data-username` (Global Constraints). On a
 * tabletop the room's glance shows the same title, code and method in the top half, so the header
 * is left out of the bottom half there (`data-fold-glance`, styles/fold.css; Fold-Tabletop board).
 *
 * Owner demo notes 12 Nov #37, lead follow-up (DESIGNER-REVIEW): logo D and the room's name ("Trade ·
 * K7M2", "Dispute · K7M2") above the board's header, in the room's own tree so folding keeps its
 * scroll; hidden with the header on a tabletop, and beside the wide rail (which names the page).
 */
export function TradeHeader({
  title,
  code,
  method,
  backTo,
  action,
  heading,
}: {
  title: ReactNode;
  code: string;
  method: { name: string; whatItIs: string };
  backTo: string;
  action?: ReactNode;
  /** The title is the page's h1 (BuyerPaidWaiting: the hero below has no heading of its own). */
  heading?: boolean;
}) {
  const [explain, setExplain] = useState(false);
  return (
    <div className="x2f-trade-header-wrap" data-fold-glance="header">
      <div className="x2f-trade-header__brand">
        <ScreenHeader />
      </div>
      <header className="x2f-trade-header">
        <Link to={backTo} className="x2f-icon-button" aria-label="Back to trades">
          <Icon name="chevron-left" />
        </Link>
        <div className="x2f-trade-header__text">
          {heading ? <h1 className="x2f-trade-header__title">{title}</h1> : <span className="x2f-trade-header__title">{title}</span>}
          <span className="x2f-trade-header__sub">
            Trade <span className="x2f-num">{code}</span> ·{' '}
            <button type="button" className="x2f-method-name" aria-haspopup="dialog" onClick={() => setExplain(true)}>
              {method.name}
            </button>
          </span>
        </div>
        {action}
        <MethodExplainer open={explain} name={method.name} whatItIs={method.whatItIs} onClose={() => setExplain(false)} />
      </header>
    </div>
  );
}
