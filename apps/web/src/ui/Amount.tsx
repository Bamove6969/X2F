import './ui.css';

const SIX_DECIMALS = /^-?\d+\.\d{6}$/;
/** formatXmrExact output: 6 places, or up to 12 when the digits past the 6th are non-zero (no trailing zero past the 6th). */
const EXACT_DECIMALS = /^-?\d+\.(\d{6}|\d{6,11}[1-9])$/;

// The `amount` type style (TradeFund board: "1.250000 XMR" with the unit in monero-ink), with the
// fiat total beside it in ink-muted (Global Constraints). Callers pass formatXmr / formatFiat output
// from @x2f/trade (Task 1). `exact` is for a figure the user must send (review kit round 1,
// finding 1): it takes formatXmrExact output, which keeps every non-zero digit past the 6th.
export function Amount({ xmr, fiat, exact = false }: { xmr: string; fiat?: string; exact?: boolean }) {
  if (exact ? !EXACT_DECIMALS.test(xmr) : !SIX_DECIMALS.test(xmr)) {
    throw new Error(exact ? 'Amount: an exact XMR figure has 6 to 12 decimals' : 'Amount: XMR is shown with 6 decimals');
  }
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
