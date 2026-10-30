/**
 * The "I've paid" confirmation step, the second of the owner's two steps (spec 2.2 step 7; Plan 3
 * Task 23, reworked by Task 39 to the BuyerPay board of 2026-10-29b): "Mark this trade as paid?",
 * the REQUIRED tick "I sent exactly $412.50 by Zelle with the memo <code>.", the plain "After this
 * you can't cancel the trade" line, then Yes, mark as paid (disabled until ticked) or Not yet.
 * Yes hands the total the sheet showed to `onYes`; a trade that grew meanwhile comes back as
 * `total-changed`, and the sheet asks again with the new total (Revision 2026-10-21).
 */
import { useEffect, useId, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import './pay.css';

export type YesResult = { ok: true } | { ok: false; reason: 'total-changed' } | { ok: false; reason: 'error'; message: string };

export function PaidConfirmSheet({
  open,
  fiatCents,
  fiatText,
  methodName,
  code,
  grewTo,
  onYes,
  onNotYet,
}: {
  open: boolean;
  /** The total the sheet shows, in the currency's minor units: exactly what Yes confirms. */
  fiatCents: bigint;
  /** The same total, formatted ("$412.50"). */
  fiatText: string;
  methodName: string;
  code: string;
  /** Set after a `total-changed`: the grown amount ("1.312500"), for "Trade grew to … XMR, you now pay …". */
  grewTo: string | null;
  onYes(fiatCents: bigint): Promise<YesResult>;
  onNotYet(): void;
}) {
  const boxId = useId();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new total (or a fresh opening) must be ticked again: the box confirms one exact sentence.
  useEffect(() => {
    setTicked(false);
    setError(null);
  }, [fiatCents, open]);

  const yes = async () => {
    if (!ticked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onYes(fiatCents);
      if (!r.ok && r.reason === 'error') setError(r.message);
      if (!r.ok) setTicked(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title="Mark this trade as paid?" onClose={onNotYet}>
      <div className="x2f-sheet__body x2f-paid">
        {grewTo !== null ? (
          <p className="x2f-paid__grew" role="status">
            Trade grew to {grewTo} XMR, you now pay {fiatText}
          </p>
        ) : null}
        <label htmlFor={boxId} className="x2f-paid__check">
          <input id={boxId} type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span>
            I sent exactly <strong>{fiatText}</strong> by {methodName} with the memo <span className="x2f-mono">{code}</span>.
          </span>
        </label>
        {/* not-a-refusal: the board's plain notice before the buyer confirms (no cancel after "I've paid"); nothing is refused here */}
        <p className="x2f-paid__note">After this you can't cancel the trade. If something goes wrong, open a dispute.</p>
        {error !== null ? (
          <p className="x2f-paid__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="x2f-paid__actions">
          <Button variant="primary" disabled={!ticked || busy} aria-busy={busy || undefined} onClick={() => void yes()}>
            Yes, mark as paid
          </Button>
          <Button variant="quiet" onClick={onNotYet}>
            Not yet
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
