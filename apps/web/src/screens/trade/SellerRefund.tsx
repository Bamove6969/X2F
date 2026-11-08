/**
 * SellerRefund (board SellerRefund.dc.html, plan Task 25; owner G2 and g66, 7 Nov): the seller's
 * screen once the buyer's payment window has ended without "I've paid". The board copy, the
 * dispute-after-refund warning (spec 2.3, shown before the tap; the old final-alert steps are
 * gone from here, G2), then one of two footers:
 *
 * - **Locked** (no nudge since the escrow was secured, `refundNeedsNudge`): **Nudge <buyer>** is
 *   the primary, Give 30 more min, and the note that Cancel unlocks after 90 min and one nudge.
 *   An accepted nudge re-reads the trade, whose `sellerNudgedAt` then unlocks Cancel.
 * - **Available**: **Cancel & get refund** (primary): `request-refund`, the `trade.refund-request`
 *   signal, then `buildRefund()` (refundFlow.ts). The buyer gets the final alert; the moderator
 *   co-signs only once its own guard allows (Task 10). Then Give 30 more min and Nudge again (one
 *   per 15 min, as many as needed: owner 7 Nov).
 * - **Give 30 more min**: `extend` and the `trade.extend` signal; hidden once the machine refuses
 *   it (after the second extension, spec 2.3).
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { sendNudge } from '../../nudge/useNudge.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, NUDGE_TOO_SOON, NUDGE_TOO_SOON_CODE, extendCantDoText, isCantDoCode, type CantDoCode } from '../../ui/cantDoCodes.js';
import { ApiCallError } from '../../api/client.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { extendSteps, pendingRefundRun, refundRun, type RefundFlowDeps, type Steps } from './refundFlow.js';
import { canExtend, canRequestRefund, finalAlertEnds, refundNeedsNudge } from './refundRules.js';
import { methodOf, publicName, type RefundScreenProps, type RefundSignal } from './refundSlot.js';
import { postTradeEvent, TRY_AGAIN, useServerNow, xmrText } from './refundUi.js';
import './refund.css';

const NUDGE_SENT = 'Nudge sent.';

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
        <Link to={`/trade/${encodeURIComponent(view.code)}#chat`} className="x2f-refund__chat" data-chat-link="">
          Chat
        </Link>
      }
    />
  );
}

/**
 * The dispute-after-refund warning (spec 2.3), the one card left before the tap once G2 dropped
 * the final-alert steps from it. The XMR owed after a lost dispute is the trade amount this device
 * accepts (Task 12's status), never the API's while the device has one (Task 12 review I3). The
 * `?? view.amountAtomic` fallback is a deliberate departure from I3's "null = no sum yet": this is
 * a warning sentence, not a sum to pay, and it must stay on screen before the tap.
 */
function LateDispute({ view, escrow }: Pick<RefundScreenProps, 'view' | 'escrow'>) {
  const name = publicName(view.counterparty);
  const owed = xmrText(escrow.amountAtomic ?? view.amountAtomic);
  return (
    <p className="x2f-refund__late" data-late-dispute="">
      Even after your refund, <Name name={name} /> can still open a dispute if they sent the money anyway. A moderator can pause your account
      from trading until it's resolved, then reviews it fairly. If their payment reached you, you'll be asked to send <Name name={name} /> the{' '}
      {owed} XMR as agreed. Refusing leads to an account suspension and a possible lifetime ban.
    </p>
  );
}

/**
 * What happens after the request while the machine still runs the final alert (refund_requested):
 * the buyer has 15 minutes to say they paid. Shown only on the requested screen.
 */
function FinalAlertSteps({ view }: Pick<RefundScreenProps, 'view'>) {
  const name = publicName(view.counterparty);
  return (
    <ol className="x2f-refund__steps">
      <li>
        <Name name={name} /> gets a final alert and 15 minutes to say they already paid.
      </li>
      <li>If they stay silent, your {xmrText(view.receivedAtomic)} XMR comes back to your wallet automatically. No moderator needed.</li>
      <li>If they say they paid, a moderator checks both sides before anything moves.</li>
    </ol>
  );
}

function WindowEnded({ view, escrow, refresh, serverClock }: RefundScreenProps) {
  const name = publicName(view.counterparty);
  const now = useServerNow(serverClock);
  const [busy, setBusy] = useState<'refund' | 'extend' | null>(null);
  const [error, setError] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const [nudgeLimit, setNudgeLimit] = useState(false);
  // 409 `no-extensions-left` (a second tab, a stale view): CantDoThat, not "try again" (round-2 N-M4).
  const [extendRefused, setExtendRefused] = useState<{ code: CantDoCode; text: string } | null>(null);

  const deps = useFlowDeps(view.code, escrow);
  // One refund run per trade, kept in refundFlow.ts so the refund_requested view can finish it; it
  // is created at the tap (see refundRun). The extension run is kept until it is done, not keyed on
  // the view: the API commits extend before the signal, so a re-read after a failed signal already
  // counts the extension, and a new run there would post extend again (spending the second, last
  // extension unasked) and never send the first one's signal. A new run starts only once the last is done.
  const extendRun = useRef<Steps | null>(null);
  const extend = (): Steps => {
    if (extendRun.current === null || extendRun.current.done()) extendRun.current = extendSteps(deps);
    return extendRun.current;
  };

  const go = async (which: 'refund' | 'extend', run: Steps) => {
    setBusy(which);
    setError(false);
    try {
      await run();
    } catch (e) {
      const code = which === 'extend' && e instanceof ApiCallError && isCantDoCode(e.code) ? e.code : null;
      const text = code === null ? null : extendCantDoText(code);
      if (code !== null && text !== null) setExtendRefused({ code, text });
      else setError(true);
    } finally {
      setBusy(null);
      await refresh().catch(() => undefined);
    }
  };

  const onNudge = async () => {
    try {
      const r = await sendNudge(name, view.code);
      // The nudge limit is a rule: CantDoThat with its feedback link (Plan 5 Task 21).
      if (r.result === NUDGE_TOO_SOON_CODE) {
        setNudge(null);
        setNudgeLimit(true);
      } else setNudge(r.result === 'sent' ? NUDGE_SENT : TRY_AGAIN);
      // An accepted nudge sets the trade's sellerNudgedAt (owner G2): re-read it, so Cancel unlocks.
      if (r.result === 'sent') await refresh().catch(() => undefined);
    } catch {
      setNudge(TRY_AGAIN);
    }
  };

  // Owner G2: until the seller has nudged once since the escrow was secured, Cancel is locked and
  // Nudge is the one primary.
  const locked = refundNeedsNudge(view, now);
  const mayRefund = canRequestRefund(view, now) && busy === null;
  const offerExtend = canExtend(view, now);
  const method = methodOf(view);
  const held = xmrText(view.receivedAtomic);
  const extendButton = offerExtend ? (
    <Button variant="secondary" disabled={busy !== null} onClick={() => void go('extend', extend())}>
      Give 30 more min
    </Button>
  ) : null;

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
            Your {held} XMR is still safe in escrow.{' '}
            {locked ? (
              <>
                Nudge <Name name={name} />, or give them more time.
              </>
            ) : (
              <>
                You can take it back, or give <Name name={name} /> more time.
              </>
            )}
          </p>
        </section>
        <section aria-label="How the refund works" className="x2f-refund__card">
          <h2 className="x2f-refund__card-title">If you cancel</h2>
          <LateDispute view={view} escrow={escrow} />
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
      <footer className="x2f-refund__footer" data-refund-cancel={locked ? 'locked' : 'available'}>
        {error ? (
          <p role="alert" className="x2f-refund__error">
            {TRY_AGAIN}
          </p>
        ) : null}
        {locked ? (
          <>
            <Button variant="primary" onClick={() => void onNudge()}>
              <Icon name="bell-ring" size={20} />
              Nudge <Name name={name} />
            </Button>
            {extendButton}
            <p className="x2f-refund__note" data-refund-lock-note="">
              No word from <Name name={name} />? After 90 min and at least one nudge, you can cancel and get your {held} XMR back.
            </p>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={!mayRefund} onClick={() => void go('refund', refundRun(view.code, deps))}>
              Cancel &amp; get refund
            </Button>
            <div className="x2f-refund__row">
              {extendButton}
              <Button variant="secondary" className="x2f-refund__nudge" onClick={() => void onNudge()}>
                <Icon name="bell-ring" size={20} />
                Nudge again
              </Button>
            </div>
            <p className="x2f-refund__note" data-refund-lock-note="">
              You can nudge again every 15 min, as often as you need. You can cancel now.
            </p>
          </>
        )}
        {nudge !== null ? (
          <p role="status" className="x2f-refund__note">
            {nudge}
          </p>
        ) : null}
        {extendRefused !== null ? (
          <CantDoThat title={CANT_DO_TITLE.extend} body={extendRefused.text} from={extendRefused.code} onClose={() => setExtendRefused(null)} />
        ) : null}
        {nudgeLimit ? <CantDoThat title={CANT_DO_TITLE.nudge} body={NUDGE_TOO_SOON} from={NUDGE_TOO_SOON_CODE} onClose={() => setNudgeLimit(false)} /> : null}
      </footer>
    </div>
  );
}

/**
 * The flow's deps, one object per trade for the life of the screen: Task 12's `useEscrow` returns
 * a new object on every render of the room, and a run keeps its cursor only while its deps stay
 * the same (the extend run is memoised on them). Each call goes to the latest escrow the room
 * passed, never a stale one.
 */
function useFlowDeps(code: string, escrow: RefundScreenProps['escrow']): RefundFlowDeps {
  const latest = useRef(escrow);
  useEffect(() => {
    latest.current = escrow;
  });
  return useMemo(
    () => ({
      post: (e: { type: 'extend' } | { type: 'request-refund' }) => postTradeEvent(code, e),
      escrow: { signal: (s: RefundSignal) => latest.current.signal(s), buildRefund: () => latest.current.buildRefund() },
    }),
    [code],
  );
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
          <FinalAlertSteps view={view} />
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
