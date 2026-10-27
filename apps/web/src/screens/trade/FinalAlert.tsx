/**
 * FinalAlert (plan Task 25; spec 2.3): the buyer's screen while the seller's refund request runs
 * (`refund_requested`). The danger alert "The seller is cancelling. If you already paid, tap I've
 * paid now.", the 15-minute countdown on the server clock (the machine's `nextDeadline`), and
 * I've paid as the primary until the machine refuses it (`too-late`, the same instant the
 * moderator's auto-refund guard opens).
 *
 * I've paid opens the paid sheet: Task 23's PaidConfirmSheet, which posts `mark-paid`, calls
 * `markPaid` and sends the `trade.paid` signal. Task 23 builds in parallel, so the sheet is a
 * seam (`setFinalAlertPaidSheet`; tripwire in test/refund-tripwires.test.ts).
 *
 * Showing this screen is the buyer seeing the alert, so it sends Task 19's seen-receipt
 * (`POST /v1/trades/:code/final-alert-seen`, the only proof of delivery the auto-refund accepts,
 * P3-I13) once, and only while the page is visible.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { api } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { canMarkPaid, finalAlertEnds } from './refundRules.js';
import { methodOf, publicName, type RefundScreenProps } from './refundSlot.js';
import { useServerNow } from './refundUi.js';
import './refund.css';

export const FINAL_ALERT_TEXT = "The seller is cancelling. If you already paid, tap I've paid now.";

export type PaidSheetProps = RefundScreenProps & { open: boolean; onClose(): void };
let paidSheet: ComponentType<PaidSheetProps> | null = null;

/** Task 23's PaidConfirmSheet (or a test's); null removes it. */
export function setFinalAlertPaidSheet(s: ComponentType<PaidSheetProps> | null): void {
  paidSheet = s;
}

/** Sends the seen-receipt once per final alert, when the page is (or becomes) visible. */
function useSeenReceipt(code: string, finalAlertAt: string | null): void {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (finalAlertAt === null) return;
    const send = () => {
      if (document.visibilityState !== 'visible' || sent.current === finalAlertAt) return;
      sent.current = finalAlertAt;
      // Idempotent on the API; a failure is retried by the next visibility change or by Task 19's live-event receipt.
      api(`/v1/trades/${encodeURIComponent(code)}/final-alert-seen`, { method: 'POST' }).catch(() => {
        if (sent.current === finalAlertAt) sent.current = null;
      });
    };
    send();
    document.addEventListener('visibilitychange', send);
    return () => document.removeEventListener('visibilitychange', send);
  }, [code, finalAlertAt]);
}

export function FinalAlert(props: RefundScreenProps) {
  const { view, serverClock } = props;
  const name = publicName(view.counterparty);
  const now = useServerNow(serverClock);
  const [sheet, setSheet] = useState(false);
  useSeenReceipt(view.code, view.finalAlertAt);
  const ends = finalAlertEnds(view);
  const open = canMarkPaid(view, now);
  const Sheet = paidSheet;

  return (
    <div className="x2f-refund" data-screen-part="final-alert">
      <TradeHeader
        title={
          <>
            Buying from <span data-username="">{name}</span>
          </>
        }
        code={view.code}
        method={methodOf(view)}
        backTo="/buy"
      />
      <section className="x2f-refund__body">
        <p role="alert" className="x2f-final-alert__chip">
          <Icon name="alert" size={20} />
          <span>{FINAL_ALERT_TEXT}</span>
        </p>
        {ends ? (
          <section aria-label="Final alert" className="x2f-refund__timer">
            <span className="x2f-refund__timer-label">Time to pay</span>
            <Countdown deadline={ends} serverClock={serverClock} />
          </section>
        ) : null}
        {!open ? <p className="x2f-refund__lead">The 15 minutes have passed.</p> : null}
      </section>
      <footer className="x2f-refund__footer">
        <Button variant="primary" disabled={!open} onClick={() => setSheet(true)}>
          I've paid
        </Button>
      </footer>
      {Sheet ? <Sheet {...props} open={sheet} onClose={() => setSheet(false)} /> : null}
    </div>
  );
}
