import './ui.css';

const SIX_DECIMALS = /^-?\d+\.\d{6}$/;

// The `amount` type style (TradeFund board: "1.250000 XMR" with the unit in monero-ink), with the
// fiat total beside it in ink-muted (Global Constraints). Callers pass formatXmr / formatFiat output
// from @x2f/trade (Task 1).
export function Amount({ xmr, fiat }: { xmr: string; fiat?: string }) {
  if (!SIX_DECIMALS.test(xmr)) throw new Error('Amount: XMR is shown with 6 decimals');
  return (
    <span className="x2f-amount">
      <span className="x2f-amount__xmr">
        {xmr} <span data-part="unit" className="x2f-amount__unit">XMR</span>
      </span>
      {fiat === undefined ? null : (
        <span data-part="fiat" className="x2f-amount__fiat">
          {fiat}
        </span>
      )}
    </span>
  );
}

/**
 * An XMR amount inside a sentence or a row (standard 7; BuyerPaidWaiting and Refunded boards): the
 * digits in mono, the "XMR" unit at 600 in monero-ink. `ink` keeps the digits in ink inside a muted
 * line. The text reads "1.250000 XMR".
 */
export function Xmr({ value, ink }: { value: string; ink?: boolean }) {
  return (
    <span className="x2f-xmr">
      <span className="x2f-num" data-ink={ink ? 'true' : undefined}>
        {value}
      </span>{' '}
      <span data-part="unit" className="x2f-xmr__unit">
        XMR
      </span>
    </span>
  );
}
