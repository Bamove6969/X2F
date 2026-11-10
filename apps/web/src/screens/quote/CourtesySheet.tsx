import { useId, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { turnCourtesyOff } from './courtesy.js';
import './courtesy.css';

/**
 * "Trading with more than one person?" (build spec j31a section 2, owner p9-3 / T-039; boards
 * BuyQuote, SellQuote: a bottom sheet; SellQuote-Wide: a centred dialog). Design final call (10 Nov
 * 2026): it shows OVER the trade room the first time the taker's new trade opens (TradeRoom.tsx,
 * quote/courtesy.ts), never on the quote before the room, so the browser's Back cannot lose the step
 * into the room (review L2); on every new trade until they tick "Don't show this again" (kept on this
 * device). Posters never see it, and there is no penalty for opening several trades (T-038). "Got it"
 * is the only action and closes it; closing the sheet any other way does the same, since the trade is
 * already open underneath. COPY-UNSIGNED
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
