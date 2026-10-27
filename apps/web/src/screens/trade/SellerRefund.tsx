/**
 * SellerRefund (board SellerRefund.dc.html, plan Task 25): the seller's screen once the buyer's
 * payment window has ended without "I've paid". The board copy, the dispute-after-refund warning
 * (spec 2.3, shown before the tap), then:
 *
 * - **Cancel & get refund** (primary): `request-refund`, the `trade.refund-request` signal, then
 *   `buildRefund()` (refundFlow.ts). The buyer gets the final alert; the moderator co-signs only
 *   once its own guard allows (Task 10).
 * - **Give 30 more min**: `extend` and the `trade.extend` signal; hidden once the machine refuses
 *   it (after the second extension, spec 2.3).
 * - **Nudge <buyer>** (Task 26).
 *
 * The room shows it only once `payBy` has passed by the server clock (`sellerRefundOpen`), and
 * every button asks the @x2f/trade machine again on the server clock (refundRules.ts). After the
 * request the seller sees the final alert running, with its countdown; if the run that started
 * it is not finished (the signal or the tx set failed, or the room re-read the trade while it was
 * in flight) that view resumes it, and offers Retry when it fails again (review 2026-10-27 I1).
 *
 * The header's Chat link is the board's; the chat screen is Task 20's, so it points at the room's
 * chat anchor for now.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { sendNudge } from '../../nudge/useNudge.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { extendSteps, pendingRefundRun, refundRun, type RefundFlowDeps, type Steps } from './refundFlow.js';
import { canExtend, canRequestRefund, finalAlertEnds } from './refundRules.js';
import { methodOf, publicName, type RefundScreenProps } from './refundSlot.js';
import { postTradeEvent, TRY_AGAIN, useServerNow, xmrText } from './refundUi.js';
import './refund.css';

const NUDGE_SENT = 'Nudge sent.';
const NUDGE_TOO_SOON = 'You can nudge once every 10 minutes.';

/** The buyer's public name, marked for the username rules (Global Constraints). */
function Name({ name }: { name: string }) {
  return <span data-username="">{name}</span>;
}

export function SellerRefund(props: RefundScreenProps) {
  return props.view.state === 'refund_requested' ? <RefundRequested {...props} /> : <WindowEnded {...props} />;
}

function Header({ view }: Pick<RefundScreenProps, 'view'>) {
  const name = publicName(view.counterparty);
  return (
    <TradeHeader
      title={
        <>
          Selling to <Name name={name} />
        </>
      }
      code={view.code}
      method={methodOf(view)}
      backTo="/sell"
      action={
        <Link to={`/trade/${encodeURIComponent(view.code)}#chat`} className="x2f-refund__chat">
          Chat
        </Link>
      }
    />
  );
}

/** The board's "If you cancel" steps (the last is the dispute-after-refund warning, spec 2.3). */
function IfYouCancel({ view, all }: { view: RefundScreenProps['view']; all: boolean }) {
  const name = publicName(view.counterparty);
  const held = xmrText(view.receivedAtomic);
  const owed = xmrText(view.amountAtomic);
  return (
    <ol className="x2f-refund__steps">
      <li>
        <Name name={name} /> gets a final alert and 15 minutes to say they already paid.
      </li>
      <li>If they stay silent, your {held} XMR comes back to your wallet automatically. No moderator needed.</li>
      <li>If they say they paid, a moderator checks both sides before anything moves.</li>
      {all ? (
        <li>
          Even after your refund, <Name name={name} /> can still open a dispute if they sent the money anyway. A moderator can pause your
          account from trading until it's resolved, then reviews it fairly. If their payment reached you, you'll be asked to send{' '}
          <Name name={name} /> the {owed} XMR as agreed. Refusing leads to an account suspension and a possible lifetime ban.
        </li>
      ) : null}
    </ol>
  );
}

function WindowEnded({ view, escrow, refresh, serverClock }: RefundScreenProps) {
  const name = publicName(view.counterparty);
  const now = useServerNow(serverClock);
  const [busy, setBusy] = useState<'refund' | 'extend' | null>(null);
  const [error, setError] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);

  const deps = useFlowDeps(view.code, escrow);
  // One refund run per trade, kept in refundFlow.ts so the refund_requested view can finish it;
  // one extension run per extension (the second extension is a new run).
  const refund = refundRun(view.code, deps);
  const extend = useMemo(() => extendSteps(deps), [deps, view.extensions]);

  const go = async (which: 'refund' | 'extend', run: Steps) => {
    setBusy(which);
    setError(false);
    try {
      await run();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
      await refresh().catch(() => undefined);
    }
  };

  const onNudge = async () => {
    try {
      const r = await sendNudge(name, view.code);
      setNudge(r.result === 'sent' ? NUDGE_SENT : r.result === 'too-soon' ? NUDGE_TOO_SOON : TRY_AGAIN);
    } catch {
      setNudge(TRY_AGAIN);
    }
  };

  const mayRefund = canRequestRefund(view, now) && busy === null;
  const offerExtend = canExtend(view, now);
  const method = methodOf(view);

  return (
    <div className="x2f-refund" data-screen-part="seller-refund">
      <Header view={view} />
      <section className="x2f-refund__body">
        <div>
          <StatusChip tone="caution" icon="clock" label="Payment window ended" />
        </div>
        <section className="x2f-refund__intro">
          <h1 className="x2f-refund__title">
            <Name name={name} /> didn't mark the payment in time
          </h1>
          <p className="x2f-refund__lead">
            Your {xmrText(view.receivedAtomic)} XMR is still safe in escrow. You can take it back, or give <Name name={name} /> more time.
          </p>
        </section>
        <section aria-label="How the refund works" className="x2f-refund__card">
          <h2 className="x2f-refund__card-title">If you cancel</h2>
          <IfYouCancel view={view} all />
        </section>
        <section className="x2f-refund__check">
          <span className="x2f-refund__check-icon">
            <Icon name="shield" size={20} />
          </span>
          <p>
            Check your bank account first. If <Name name={name} />
            's {method.name} payment did arrive, release instead of cancelling.
          </p>
        </section>
      </section>
      <footer className="x2f-refund__footer">
        {error ? (
          <p role="alert" className="x2f-refund__error">
            {TRY_AGAIN}
          </p>
        ) : null}
        <Button variant="primary" disabled={!mayRefund} onClick={() => void go('refund', refund)}>
          Cancel &amp; get refund
        </Button>
        <div className="x2f-refund__row">
          {offerExtend ? (
            <Button variant="secondary" disabled={busy !== null} onClick={() => void go('extend', extend)}>
              Give 30 more min
            </Button>
          ) : null}
          <Button variant="secondary" className="x2f-refund__nudge" onClick={() => void onNudge()}>
            <Icon name="bell-ring" size={20} />
            Nudge <Name name={name} />
          </Button>
        </div>
        {nudge !== null ? (
          <p role="status" className="x2f-refund__note">
            {nudge}
          </p>
        ) : null}
      </footer>
    </div>
  );
}

function useFlowDeps(code: string, escrow: RefundScreenProps['escrow']): RefundFlowDeps {
  return useMemo(() => ({ post: (e: { type: 'extend' } | { type: 'request-refund' }) => postTradeEvent(code, e), escrow }), [code, escrow]);
}

/**
 * After Cancel & get refund: the buyer's final alert is running (seller, refund_requested). A run
 * this page started and did not finish (the signal or the tx set) is resumed here on mount; when
 * it fails again the seller sees why and Retry.
 */
function RefundRequested({ view, escrow, serverClock }: RefundScreenProps) {
  const name = publicName(view.counterparty);
  const ends = finalAlertEnds(view);
  const deps = useFlowDeps(view.code, escrow);
  const [pending, setPending] = useState<'none' | 'running' | 'failed'>('none');

  const resume = async (run: Steps) => {
    setPending('running');
    try {
      await run();
      setPending('none');
    } catch {
      setPending('failed');
    }
  };
  useEffect(() => {
    const run = pendingRefundRun(view.code, deps);
    if (run !== null) void resume(run);
    // Once per mount and per trade; a changed escrow is picked up by the run through `deps`.
  }, [view.code]);
  const onRetry = () => {
    const run = pendingRefundRun(view.code, deps);
    if (run !== null) void resume(run);
    else setPending('none');
  };

  return (
    <div className="x2f-refund" data-screen-part="seller-refund-requested">
      <Header view={view} />
      <section className="x2f-refund__body">
        <div>
          <StatusChip tone="caution" icon="clock" label="Final alert sent" />
        </div>
        <section className="x2f-refund__intro">
          <h1 className="x2f-refund__title">
            Waiting for <Name name={name} />
          </h1>
        </section>
        {ends ? (
          <section aria-label="Final alert" className="x2f-refund__timer">
            <Countdown deadline={ends} serverClock={serverClock} />
          </section>
        ) : null}
        <section aria-label="How the refund works" className="x2f-refund__card">
          <IfYouCancel view={view} all={false} />
        </section>
      </section>
      {pending === 'failed' ? (
        <footer className="x2f-refund__footer">
          <p role="alert" className="x2f-refund__error">
            {TRY_AGAIN}
          </p>
          <Button variant="primary" onClick={onRetry}>
            Retry
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
