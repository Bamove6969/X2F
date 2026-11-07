import './ui.css';

// The 2-of-3 motif (design-system README; TradeFund board): three dots, the filled ones in the
// context's state colour, the empty ones outlined in `line`. Decorative next to its words.
export function EscrowDots({
  filled,
  tone,
}: {
  filled: readonly [boolean, boolean, boolean];
  tone: 'escrow' | 'caution';
}) {
  return (
    <span className="x2f-dots" data-tone={tone} aria-hidden="true">
      {filled.map((on, i) => (
        <span key={i} className="x2f-dot" data-dot={on ? 'filled' : 'empty'} />
      ))}
    </span>
  );
}

/**
 * The hero's key mark (visual system v2; BuyerPaidWaiting and Refunded boards): 62×14, two filled
 * dots and the third an outline ring, in the current colour (the hero's tone). Decorative.
 */
export function KeyMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="62" height="14" viewBox="0 0 62 14" aria-hidden="true" focusable="false" data-part="key-mark">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <circle cx="31" cy="7" r="7" fill="currentColor" />
      <circle cx="55" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
