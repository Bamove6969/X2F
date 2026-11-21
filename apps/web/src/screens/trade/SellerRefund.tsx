/**
 * SellerRefund (board SellerRefund.dc.html, plan Task 25; owner 8 Nov, p6-1, p9-2, p9-4): the
 * seller's screen once the buyer's time to pay has ended without "I've paid". Three views:
 *
 * - **Time to pay ended** (`secured`, past `payBy` by the server clock, `sellerRefundOpen`): the
 *   board copy, the dispute-after-refund warning (spec 2.3, shown before the tap), then
 *   **Cancel and get refund** (the one primary): `request-refund`, the `trade.refund-request`
 *   signal, then `buildRefund()` (refundFlow.ts). The refund starts at once: no final warning to
 *   the buyer and no nudge needed. Then Give 30 more min and Nudge, which the screen offers and
 *   encourages (it often saves starting a new trade) but never requires; one per 15 min, as many
 *   as needed. Until the seller cancels, the buyer can still tap "I've paid" (the time to pay is
 *   not a hard end); once they have, this view is gone (the trade is `paid`).
 * - **Refund in progress** (`settling` as `auto-refund`): the refund is being signed and sent. A
 *   run this page started and did not finish (the signal or the tx set) is resumed here on mount;
 *   after a reload the view sends the signal and asks for the tx set again (`refundResume`). When
 *   it fails the seller sees why and Retry (review 2026-10-27 I1). The refund is seller-built
 *   (builder seller, co-signer mod, Task 25): the moderator can co-sign only the tx set THIS device
 *   builds, after the two have swapped fresh multisig info, so the refund waits for this device
 *   until the moderator reports it sent (`handedOff`, its signed DONE). Until then the view says to
 *   keep the page open, and that a closed page only pauses the refund: opening the trade again on
 *   this device resumes it (gap 4, 20 Nov: the e2e saw the refund never land once the page was
 *   closed early). The page may close once this device saw the refund in a block (`done`; review M1).
 * - **Refunded** (`refunded` as `auto-refund`): the refund's confirmations from X2F's own node;
 *   the trade is complete once it has all 10 (owner 8 Nov).
 *
 * Every button asks the @x2f/trade machine again on the server clock (refundRules.ts). The
 * header's Chat link is the board's; it points at the room's chat anchor.
 *
 * COPY-UNSIGNED: the board predates the owner's 8 Nov reversal; the lead and nudge lines, and the
 * refund-in-progress and refunded views, have no signed copy yet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatXmr, formatXmrExact } from '@x2f/trade';
import { Link } from 'react-router';
import { sendNudge } from '../../nudge/useNudge.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, NUDGE_TOO_SOON, NUDGE_TOO_SOON_CODE, extendCantDoText, isCantDoCode, type CantDoCode } from '../../ui/cantDoCodes.js';
import { ApiCallError } from '../../api/client.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { useLeaveWarning } from '../../ui/useLeaveWarning.js';
import { useConfirmations } from './release/seams.js';
import { extendSteps, refundResume, refundRun, startedRefundRun, type RefundFlowDeps, type Steps } from './refundFlow.js';
import { canExtend, canRequestRefund } from './refundRules.js';
import { methodOf, publicName, type RefundScreenProps, type RefundSignal } from './refundSlot.js';
import { postTradeEvent, TRY_AGAIN, useServerNow } from './refundUi.js';
import './trade.css';
import './refund.css';

const NUDGE_SENT = 'Nudge sent.';

/** The buyer's public name, marked for the username rules (Global Constraints). */
function Name({ name }: { name: string }) {
  return <span data-username="">{name}</span>;
}

/** A number in the board's mono digits (design v2: numbers mono, units in the body face). */
function Num({ children }: { children: string | number }) {
  return <span className="x2f-num">{children}</span>;
}

/**
 * An XMR amount as the boards write it: 6 decimals ("1.250000 XMR"), the digits mono. `exact` is
 * for an amount the seller may have to send (review kit round 1, finding 1): more places when the
 * digits past the 6th are non-zero (formatXmrExact).
 */
function Xmr({ atomic, exact = false }: { atomic: string | bigint; exact?: boolean }) {
  return (
    <>
      <Num>{(exact ? formatXmrExact : formatXmr)(BigInt(atomic))}</Num> <span className="x2f-refund__unit">XMR</span>
    </>
  );
}

export function SellerRefund(props: RefundScreenProps) {
  if (props.view.state === 'settling') return <Refunding {...props} />;
  if (props.view.state === 'refunded') return <Refunded {...props} />;
  return <WindowEnded {...props} />;
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
 * The dispute-after-refund warning (spec 2.3; owner 8 Nov, p9-2: a buyer who paid late can
 * dispute at once). The XMR owed after a lost dispute is the trade amount this device accepts
 * (Task 12's status), never the API's while the device has one (Task 12 review I3). The
 * `?? view.amountAtomic` fallback is a deliberate departure from I3's "null = no sum yet": this is
 * a warning sentence, not a sum to pay, and it must stay on screen before the tap.
 */
function LateDispute({ view, escrow }: Pick<RefundScreenProps, 'view' | 'escrow'>) {
  const name = publicName(view.counterparty);
  const owed = escrow.amountAtomic ?? view.amountAtomic;
  return (
    <p className="x2f-refund__late" data-late-dispute="">
      Even after your refund, <Name name={name} /> can still open a dispute if they sent the money anyway. A moderator can pause your account
      from trading until it's resolved, then reviews it fairly. If their payment reached you, you'll be asked to send <Name name={name} /> the{' '}
      <Xmr atomic={owed} exact /> as agreed. Refusing leads to an account suspension and a possible lifetime ban.
    </p>
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
  // One refund run per trade, kept in refundFlow.ts so the refund view can finish it; it is created
  // at the tap (see refundRun). The extension run is kept until it is done, not keyed on the view:
  // the API commits extend before the signal, so a re-read after a failed signal already counts the
  // extension, and a new run there would post extend again (spending the second, last extension
  // unasked) and never send the first one's signal. A new run starts only once the last is done.
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
    } catch {
      setNudge(TRY_AGAIN);
    }
  };

  const mayRefund = canRequestRefund(view, now) && busy === null;
  const offerExtend = canExtend(view, now);
  const method = methodOf(view);
  const held = <Xmr atomic={view.receivedAtomic} />;

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
            Your {held} is still safe in escrow. You can cancel now and get it back, or give <Name name={name} /> more time. Until you cancel,{' '}
            <Name name={name} /> can still pay and tap I've paid.
          </p>
        </section>
        <section aria-label="How the refund works" className="x2f-refund__card">
          <h2 className="x2f-refund__card-title">
            If <Name name={name} /> paid after all
          </h2>
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
      <footer className="x2f-refund__footer" data-refund-cancel="available">
        {error ? (
          <p role="alert" className="x2f-refund__error">
            {TRY_AGAIN}
          </p>
        ) : null}
        <Button variant="primary" disabled={!mayRefund} onClick={() => void go('refund', refundRun(view.code, deps))}>
          Cancel and get refund
        </Button>
        <div className="x2f-refund__row">
          {offerExtend ? (
            <Button variant="secondary" disabled={busy !== null} onClick={() => void go('extend', extend())}>
              Give <Num>30</Num> more min
            </Button>
          ) : null}
          <Button variant="secondary" className="x2f-refund__nudge" onClick={() => void onNudge()}>
            <Icon name="bell-ring" size={20} />
            Nudge <Name name={name} />
          </Button>
        </div>
        <p className="x2f-refund__note" data-refund-nudge-note="">
          No word from <Name name={name} />? A nudge before you cancel often saves starting a new trade with someone else. You can nudge every{' '}
          <Num>15</Num> min, as often as you need. Cancelling starts your refund at once.
        </p>
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
 * After Cancel and get refund (settling as `auto-refund`): the refund to the seller is being signed
 * and sent. The run this page started is resumed on mount; with none (a reload, another device) the
 * signal and the tx set are asked for again. When it fails the seller sees why and Retry.
 */
function Refunding({ view, escrow }: RefundScreenProps) {
  const name = publicName(view.counterparty);
  const deps = useFlowDeps(view.code, escrow);
  const [pending, setPending] = useState<'none' | 'running' | 'failed'>('none');
  // This page's own Cancel run (still running, failed, or done: then a no-op), else the resume run.
  const runFor = (): Steps => startedRefundRun(view.code, deps) ?? refundResume(view.code, deps);
  // The browser asks before the page goes while this device is still needed (lead call, gap 4).
  useLeaveWarning(stillNeeded(escrow));

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
    void resume(runFor());
    // Once per mount and per trade; a changed escrow is picked up by the run through `deps`.
  }, [view.code]);

  return (
    <div className="x2f-refund" data-screen-part="seller-refund-requested">
      <Header view={view} />
      <section className="x2f-refund__body">
        <div>
          <StatusChip tone="caution" icon="clock" label="Refund in progress" />
        </div>
        <section className="x2f-refund__intro">
          <h1 className="x2f-refund__title">Your XMR is on its way back</h1>
          <p className="x2f-refund__lead">
            You cancelled after the time to pay. The refund of your <Xmr atomic={view.receivedAtomic} /> to your wallet has started. The trade is
            complete once it has <Num>10</Num> confirmations.
          </p>
          <HandOff escrow={escrow} />
        </section>
        <section aria-label="How the refund works" className="x2f-refund__card">
          <h2 className="x2f-refund__card-title">
            If <Name name={name} /> paid after all
          </h2>
          <LateDispute view={view} escrow={escrow} />
        </section>
      </section>
      {pending === 'failed' ? (
        <footer className="x2f-refund__footer">
          <p role="alert" className="x2f-refund__error">
            {TRY_AGAIN}
          </p>
          <Button variant="primary" onClick={() => void resume(runFor())}>
            Retry
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

/**
 * What the refund needs from this device (gap 4 and its security review, 20 Nov). The refund is
 * built by this device:
 * - `signing` (or ready) before `handedOff`: keep the page open; a closed page pauses the refund
 *   until the trade is opened again on this device. The browser asks before leaving (stillNeeded).
 * - `handedOff` (the moderator's signed report that it sent the refund, not yet seen in a block):
 *   keep the page open a few minutes while it confirms (review M1 a, m2).
 * - `done` (this device saw its own refund in a block): the page may close.
 * - `idle` (review m6): this device does not hold the trade's escrow, so it is not needed here:
 *   no warning, and the room's own "not on this device" line.
 * - stopped: waiting for this device (retryable), or stopped for good (an integrity error, review
 *   m5).
 * COPY-UNSIGNED (every line here).
 */
export const REFUND_NOT_HERE = 'This device doesn’t hold this trade’s escrow yet. If you set the trade up on another device, open it there.';

/** The refund still needs this device, now: it runs here, has not stopped, and the moderator has not reported it sent. */
function stillNeeded(escrow: RefundScreenProps['escrow']): boolean {
  return escrow.error === null && escrow.phase !== 'idle' && !escrow.handedOff && escrow.phase !== 'done';
}

function HandOff({ escrow }: Pick<RefundScreenProps, 'escrow'>) {
  if (escrow.error !== null) {
    // (No "after the hand-off" line: the runtime reports handedOff false whenever the escrow has
    // stopped, so this device cannot tell; review n1, 21 Nov.)
    const line = !escrow.retryable
      ? // not-a-refusal: a device fault
        'The escrow on this device stopped for good, so it can’t finish this refund. If the refund doesn’t reach your wallet, open a dispute.'
      : 'The escrow stopped on this device, so the refund is waiting for it.';
    return (
      <div className="x2f-refund__stopped" role="alert" data-refund-escrow-stopped="" data-for-good={escrow.retryable ? undefined : ''}>
        <p>{line}</p>
        {escrow.retryable ? (
          <Button variant="secondary" onClick={() => escrow.retry()}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  if (escrow.phase === 'idle') {
    return (
      <p className="x2f-keep-open" role="status" data-refund-not-here="">
        <Icon name="info" size={16} /> {REFUND_NOT_HERE}
      </p>
    );
  }
  if (escrow.phase === 'done') {
    return (
      <p className="x2f-keep-open" role="status" data-refund-can-close="">
        <Icon name="check" size={16} /> The refund is in a block. You can close this page now.
      </p>
    );
  }
  if (escrow.handedOff) {
    return (
      <p className="x2f-keep-open" role="status" data-refund-handed-off="">
        <Icon name="clock" size={16} /> The moderator has sent the refund. Keep this page open a few minutes while it confirms.
      </p>
    );
  }
  return (
    <p className="x2f-keep-open" role="status" data-keep-open="">
      <Icon name="info" size={16} /> Keep this page open while this device signs the refund. If you close it, the refund waits until you open this trade
      again on this device.
    </p>
  );
}

/** The refund landed (refunded as `auto-refund`): its confirmations; complete at all 10 (owner 8 Nov). */
function Refunded({ view, escrow }: RefundScreenProps) {
  const got = useConfirmations(view);
  const target = got?.target ?? 10;
  const count = got?.confirmations ?? null;
  const done = count !== null && count >= target;
  return (
    <div className="x2f-refund" data-screen-part="seller-refunded" data-escrow-phase={escrow.phase}>
      <Header view={view} />
      <section className="x2f-refund__body">
        <div>
          {done ? <StatusChip tone="escrow" icon="check" label="Trade complete" /> : <StatusChip tone="caution" icon="clock" label="Refund sent" />}
        </div>
        <section className="x2f-refund__intro">
          <h1 className="x2f-refund__title">{done ? 'Your XMR is back' : 'Your refund is confirming'}</h1>
          <p className="x2f-refund__lead" data-refund-confirmations="">
            {count === null ? (
              <>Waiting for the network to count the refund's confirmations.</>
            ) : (
              <>
                <Num>{Math.min(count, target)}</Num> of <Num>{target}</Num> confirmations.{' '}
                {done ? 'The trade is complete.' : 'The trade is complete at 10.'}
              </>
            )}
          </p>
        </section>
        {/* Review M1: a device whose escrow stopped says so here too (a false "settled elsewhere" was invisible). */}
        {escrow.error !== null ? <HandOff escrow={escrow} /> : null}
        <section aria-label="If the buyer paid" className="x2f-refund__card">
          <LateDispute view={view} escrow={escrow} />
        </section>
      </section>
    </div>
  );
}
