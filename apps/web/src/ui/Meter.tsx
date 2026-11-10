import './ui.css';

/**
 * A row of pills, `used` of `max` filled in ink (Devices board: "2 of 3 devices logged in").
 * Decorative: the sentence beside it says the same in words, so it is hidden from screen readers.
 */
export function Meter({ used, max, part }: { used: number; max: number; part?: string }) {
  return (
    <span className="x2f-meter" aria-hidden="true" data-part={part}>
      {/* G-007: over the limit, a pill for each device logged in, those past the limit marked (caution). */}
      {Array.from({ length: Math.max(1, max, used) }, (_, i) => (
        <span key={i} className="x2f-meter__pill" data-filled={i < used ? 'true' : 'false'} data-over={i < used && i >= max ? 'true' : 'false'} />
      ))}
    </span>
  );
}
