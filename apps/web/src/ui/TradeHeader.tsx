import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './icons.js';
import { MethodExplainer } from './MethodExplainer.js';
import './ui.css';

/**
 * The trade-room header (TradeFund, BuyerPay, SellerConfirm boards): back, the title
 * ("Selling to mira.k"), "Trade <code> · <method>" and an optional action on the right (the
 * boards' Chat link). Tapping the method name opens its "What is this?" explainer (spec 2.6).
 * Pass the title with the username wrapped in `data-username` (Global Constraints).
 */
export function TradeHeader({
  title,
  code,
  method,
  backTo,
  action,
}: {
  title: ReactNode;
  code: string;
  method: { name: string; whatItIs: string };
  backTo: string;
  action?: ReactNode;
}) {
  const [explain, setExplain] = useState(false);
  return (
    <header className="x2f-trade-header">
      <Link to={backTo} className="x2f-icon-button" aria-label="Back to trades">
        <Icon name="chevron-left" />
      </Link>
      <div className="x2f-trade-header__text">
        <span className="x2f-trade-header__title">{title}</span>
        <span className="x2f-trade-header__sub">
          Trade {code} ·{' '}
          <button type="button" className="x2f-method-name" aria-haspopup="dialog" onClick={() => setExplain(true)}>
            {method.name}
          </button>
        </span>
      </div>
      {action}
      <MethodExplainer open={explain} name={method.name} whatItIs={method.whatItIs} onClose={() => setExplain(false)} />
    </header>
  );
}
