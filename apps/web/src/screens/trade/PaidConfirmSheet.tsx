/**
 * The "I've paid" confirmation step (spec 2.2 step 7; Plan 3 Task 23): the buyer ticks "I sent
 * exactly $412.50 via Zelle with <code> in the memo", then Yes, I've paid or Not yet. Yes hands
 * the total the sheet showed to `onYes`; a trade that grew meanwhile comes back as
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
    <Sheet open={open} title="I've paid" onClose={onNotYet}>
      <div className="x2f-sheet__body x2f-paid">
        {grewTo !== null ? (
          <p className="x2f-paid__grew" role="status">
            Trade grew to {grewTo} XMR, you now pay {fiatText}
          </p>
        ) : null}
        <label htmlFor={boxId} className="x2f-paid__check">
          <input id={boxId} type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span>
            I sent exactly {fiatText} via {methodName} with {code} in the memo
          </span>
        </label>
        <p className="x2f-paid__note">Sending without proof makes disputes harder.</p>
        {error !== null ? (
          <p className="x2f-paid__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="x2f-paid__actions">
          <Button variant="primary" disabled={!ticked || busy} aria-busy={busy || undefined} onClick={() => void yes()}>
            Yes, I've paid
          </Button>
          <Button variant="quiet" onClick={onNotYet}>
            Not yet
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
