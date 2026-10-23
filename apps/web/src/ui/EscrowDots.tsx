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
