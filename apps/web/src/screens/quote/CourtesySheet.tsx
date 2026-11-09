import { useId, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { turnCourtesyOff } from './courtesy.js';

/**
 * "Trading with more than one person?" (build spec j31a section 2, owner p9-3 / T-039; boards
 * BuyQuote, SellQuote: a bottom sheet; SellQuote-Wide: a centred dialog). After a taker's trade
 * request is sent, before the trade room, on every trade until they tick "Don't show this again".
 * Posters never see it, and there is no penalty for opening several trades (T-038). "Got it" is the
 * only action and goes on to the trade room; closing the sheet any other way does the same, since
 * the trade is already open. COPY-UNSIGNED
 */
export function CourtesySheet({ open, onDone }: { open: boolean; onDone: () => void }) {
  const bodyId = useId();
  const tickId = useId();
  const [skip, setSkip] = useState(false);
  const done = () => {
    if (skip) turnCourtesyOff();
    onDone();
  };
  return (
    <Sheet open={open} title="Trading with more than one person?" describedBy={bodyId} closeButton={false} handle wide="dialog" onClose={done}>
      <div className="x2f-sheet__body x2f-courtesy" data-sheet="courtesy">
        <p id={bodyId} className="x2f-courtesy__text">
          If you opened trades with several people to see who answers first, close the others once you&apos;ve picked one. That way nobody is left waiting on
          you.
        </p>
        <label htmlFor={tickId} className="x2f-courtesy__tick">
          <input id={tickId} type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          <span>Don&apos;t show this again</span>
        </label>
        <Button variant="primary" onClick={done}>
          Got it
        </Button>
      </div>
    </Sheet>
  );
}
