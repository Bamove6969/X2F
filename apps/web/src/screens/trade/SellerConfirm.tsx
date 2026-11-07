import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TIMERS } from '@x2f/trade';
import { ApiCallError, useServerClock } from '../../api/client.js';
import { postTradeEvent } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { HoldButton } from '../../ui/HoldButton.js';
import { Icon } from '../../ui/icons.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { clearReleaseAsked, markReleaseAsked, releaseAsked } from './release/marker.js';
import { ReleaseWarning } from './ReleaseWarning.js';
import { setWarned, warned } from './warned.js';
import { ESCROW_STOPPED, amounts, publicName, firstPerson, profileCopy, refusalCopy, type MethodInfo, type ReleaseEscrow, type ReleaseTrade } from './release/view.js';
import './release/release.css';

/**
 * SellerConfirm (board SellerConfirm.dc.html; spec 2.2 steps 8-9): the buyer has marked paid; the
 * seller checks their own account, ticks the box and presses and holds to release. The hold is
 * locked until the box is ticked, while the escrow is not releasable ("Releasable in N min"), and
 * while this device has no accepted amount, a Task 12 refusal or a stopped escrow. A full hold
 * posts `release-started`, then calls `escrow.release()`; the buyer's app co-signs.
 *
 * Every amount and fiat total shown is the one THIS device accepts (`escrow.amountAtomic` /
 * `fiatCents`), the amount its release is bound to; the API's is never shown (review 2026-10-27,
 * I3). The "released" look comes from the device (`escrow.phase` `done`), never from the API's
 * `settling` alone (I1). While the API says the release is settling and the device has not signed,
 * the screen calls `release()` again by itself ONLY when this device asked for the release (the
 * marker in release/marker.ts, written before the POST: a lost POST answer, a reload between the
 * POST and `release()`), and offers "Finish the release on this device" if that fails. Without
 * the marker (another device, a cleared store, or an API that moved the trade alone) the seller
 * gets the box and an explicit "Hold to finish the release": the API's word is never consent
 * (round-2 review 2026-10-28, Important 1). The marker is keyed by `escrowCode`, the trade the
 * room's escrow runs for, never by the API's `trade.code` (round-3 review, Important 1).
 * The smart proof card is Plan 5 (`proofSlot`, masked on the board comparison).
 *
 * Before the hold works the seller goes past the release warning once for the trade (Task 38,
 * ReleaseWarning): it opens with the screen and again on ticking the box, and the hold stays
 * locked until "It's in my account" (kept per `escrowCode` on this device, warned.ts).
 */
export function SellerConfirm({
  escrowCode,
  trade,
  method,
  escrow,
  onTrade,
  headerAction,
  proofSlot,
  serverClock,
}: {
  /**
   * The trade code the room's escrow runs for (TradeScreenProps `code`, the route's): the release
   * marker, the POST and the dispute links use it, never `trade.code` (API data; round-3 review,
   * Important 1).
   */
  escrowCode: string;
  trade: ReleaseTrade;
  method: MethodInfo;
  escrow: ReleaseEscrow;
  /** The trade as the events route returned it after `release-started`. */
  onTrade: (next: ReleaseTrade) => void;
  /** The header's right-hand action (the board's Chat link), from the trade room. */
  headerAction?: ReactNode;
  /** Plan 5's smart proof card. */
  proofSlot?: ReactNode;
  /** The trade room's server clock; by default one anchored on `trade.serverNow`. */
  serverClock?: () => Date;
}) {
  const ownClock = useServerClock(trade.serverNow);
  const clock = serverClock ?? ownClock;
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 'start': the API refused release-started; 'unknown': it did not answer (it may have started); 'sign': the device refused. */
  const [failed, setFailed] = useState<'start' | 'unknown' | 'sign' | null>(null);
  /** The API took `release-started` on this mount (its answer reached us), before the room refreshes (Minor 11). */
  const [started, setStarted] = useState(false);
  // A new key gives a fresh HoldButton after a failed attempt (it fires onComplete once per mount).
  const [attempt, setAttempt] = useState(0);
  /** `release()` was asked for on this mount: the automatic resume runs at most once. */
  const asked = useRef(false);
  /** Task 38: the seller went past the release warning for this trade on this device. */
  const [acked, setAcked] = useState(() => warned('release', escrowCode));

  const buyer = publicName(trade.counterparty);
  const sums = amounts(trade, escrow);
  const amount = sums?.amount ?? 'the XMR';
  const { place, checkPrompt } = profileCopy(trade.profile);
  const apiReleasing = trade.state === 'settling' && trade.settling === 'release';
  const releasing = apiReleasing || started;
  const signed = escrow.phase === 'done' || escrow.phase === 'settled-without-device';
  const done = releasing && signed;
  const signing = releasing && !signed && (escrow.phase === 'signing' || busy);
  const stopped = escrow.phase === 'error' || escrow.error !== null;
  const blocked = sums === null || escrow.refusal !== null || stopped;
  const notReleasable = !trade.releasable && !releasing;
  /** This device asked for this release (round-2 I1): only then may it sign without a hold here. */
  const askedHere = started || releaseAsked(escrowCode);
  /**
   * The API says a release is settling that this device did not ask for (another device, a cleared
   * store, or an API that moved the trade alone): the box and an explicit hold, never a silent
   * signature (round-2 review 2026-10-28, Important 1).
   */
  const foreign = apiReleasing && !askedHere && !signed && escrow.phase !== 'signing' && !busy;
  /** This device does not run the trade's escrow (round-2 Minor 2): only `idle`, never the boot phases after a reload (round-3 Minor 3). */
  const notHere = escrow.phase === 'idle';
  /** The device's escrow is still starting (after a reload: registering → verifying → ready). */
  const starting = ['registering', 'verifying', 'setting-up'].includes(escrow.phase);

  const sign = async () => {
    asked.current = true;
    setBusy(true);
    setFailed(null);
    try {
      await escrow.release();
    } catch {
      // Nothing was handed to the device's party (the runtime refused the act): say so and offer it again.
      setFailed('sign');
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    asked.current = true;
    setBusy(true);
    setFailed(null);
    // Before the POST, so a lost answer or a reload still lets this device finish what it asked.
    markReleaseAsked(escrowCode);
    let next: ReleaseTrade;
    try {
      next = await postTradeEvent(escrowCode, { type: 'release-started' });
    } catch (err) {
      // Refused (the API answered): nothing was started, so the marker goes. Unreachable: it may
      // have been applied (a lost answer); the marker stays and the room's next read resumes it.
      const refused = err instanceof ApiCallError;
      if (refused) clearReleaseAsked(escrowCode);
      asked.current = false;
      setFailed(refused ? 'start' : 'unknown');
      setAttempt((n) => n + 1);
      setBusy(false);
      return;
    }
    setStarted(true);
    onTrade(next);
    await sign();
  };

  /** The explicit hold for a release this device did not ask for: no new POST (the API is already settling). */
  const finish = async () => {
    markReleaseAsked(escrowCode);
    await sign();
  };

  // I1: the API says the release is settling, THIS device asked for it (the marker, written before
  // the POST), the device is ready and has not signed, and nothing was asked on this mount: sign it
  // now (reload, lost POST answer). Once per mount. Without the marker, the hold above (`foreign`).
  useEffect(() => {
    if (!apiReleasing || asked.current || busy || !releaseAsked(escrowCode)) return;
    if (escrow.phase !== 'ready' || escrow.refusal !== null || escrow.error !== null) return;
    void sign();
  }, [apiReleasing, busy, escrow.phase, escrow.refusal, escrow.error, escrowCode]);

  // The marker goes once this device has signed (and on the dispute taps below; else after the settle window).
  useEffect(() => {
    if (signed) clearReleaseAsked(escrowCode);
  }, [signed, escrowCode]);
  /** "Payment not received" / "Open dispute": the seller's last act retracts the release (round-3 Minor 1). */
  const retract = () => clearReleaseAsked(escrowCode);

  // The release warning opens with the screen until the seller has gone past it (Task 38), never
  // over a release already under way from this device or done.
  const warnDue = !acked && !done && !(releasing && !foreign);
  const [warnOpen, setWarnOpen] = useState(warnDue);
  const ackWarning = () => {
    setWarned('release', escrowCode);
    setAcked(true);
    setWarnOpen(false);
  };

  const problem = stopped ? ESCROW_STOPPED : escrow.refusal !== null ? refusalCopy(escrow.refusal, buyer) : null;

  const caption = done
    ? 'Released'
    : foreign
      ? 'Release under way'
      : releasing
        ? 'Signing…'
      : notReleasable
        ? trade.releasableEtaMin !== null
          ? `Releasable in ${trade.releasableEtaMin} min`
          : 'Waiting for the escrow to unlock'
        : 'Payment received';
  const hint = done
    ? `Both signatures sent. ${buyer} will be asked to rate the trade.`
    : releasing && notHere
      ? 'This device doesn’t hold this trade’s escrow yet. If you set the trade up on another device, open it there.'
      : foreign
      ? `X2F shows a release under way that wasn’t started on this device. Check ${place} first.`
      : releasing && starting
      ? 'Starting this device’s escrow…'
      : releasing
      ? signing || escrow.keepOpen
        ? 'Signing the release on this device. Keep this page open.'
        : 'The release isn’t signed on this device yet. Keep this page open.'
      : !checked
        ? 'Tick the box above to unlock this release button.'
        : !acked
          ? // COPY-UNSIGNED (review M6): the box is ticked but the warning was not answered yet.
            'Read the warning before you release: the hold works once you answer it.'
        : sums === null && problem === null
          ? 'Waiting for this device to confirm the trade amount.'
          : blocked
            ? null
            : notReleasable
              ? 'The XMR in escrow needs more confirmations before it can be released.'
              // not-a-refusal: explains that a release is final
              : 'Press and hold for 1.5 seconds. Once released, the XMR can’t be taken back.';
  const fiat = sums?.fiat ?? 'the payment';

  return (
    <div className="x2f-release" data-screen="seller-confirm">
      <TradeHeader
        title={
          <>
            Selling to <span data-username="">{buyer}</span>
          </>
        }
        code={trade.code}
        method={method}
        backTo="/sell"
        {...(headerAction !== undefined ? { action: headerAction } : {})}
      />

      <div className="x2f-release__main">
        <div className="x2f-release__status">
          <span className="x2f-chip x2f-release__paid" data-tone="caution">
            <Icon name="check" size={16} />
            <span>
              <span data-username="">{buyer}</span>: Payment sent
            </span>
          </span>
          {trade.confirmBy !== null && !releasing ? <ConfirmWindow deadline={trade.confirmBy} clock={clock} buyer={buyer} place={place} /> : null}
        </div>

        <h1 className="x2f-release__title">
          Check {place} for {fiat} sent via {method.name}
        </h1>

        {checkPrompt !== null ? <p className="x2f-release__prompt">{checkPrompt}</p> : null}
        {proofSlot}

        <section aria-label="Before you release" className="x2f-release__warning">
          <h2 className="x2f-release__warning-title">
            <Icon name="alert" size={20} />
            Screenshots can be faked
          </h2>
          <label className="x2f-release__check">
            <input
              type="checkbox"
              checked={checked || (releasing && !foreign)}
              disabled={(releasing && !foreign) || busy}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                setChecked(on);
                // Ticking before going past the warning opens it again: the hold needs both.
                if (on && !acked) setWarnOpen(true);
              }}
            />
            <span>
              I checked {firstPerson(place)} myself and the {fiat} from {method.name} is there.
            </span>
          </label>
        </section>
      </div>

      <footer className="x2f-release__footer">
        <HoldButton
          key={attempt}
          disabled={foreign ? !checked || !acked || busy || blocked || escrow.phase !== 'ready' : !checked || !acked || notReleasable || busy || blocked || releasing}
          done={done}
          onComplete={() => void (foreign ? finish() : release())}
          caption={caption}
          holdingLabel="Keep holding…"
          label={
            done
              ? `${amount} is on its way to ${buyer}`
              : foreign
                ? `Hold to finish the release of ${amount} to ${buyer}`
                : releasing
                  ? `Releasing ${amount} to ${buyer}`
                  : `Hold to release ${amount} to ${buyer}`
          }
          accessibleLabel={
            done
              ? `Released ${amount} to ${buyer}`
              : foreign
                ? `Press and hold for 1.5 seconds to finish the release of ${amount} to ${buyer}`
                : releasing
                  ? `Releasing ${amount} to ${buyer}`
                  : `Press and hold for 1.5 seconds to release ${amount} to ${buyer}`
          }
        />
        {hint !== null ? <span className="x2f-release__hint">{hint}</span> : null}
        {checked && !acked && !warnOpen && warnDue ? (
          // COPY-UNSIGNED (review M6): the kit's quiet button; not on the Warn-Release board.
          <Button variant="quiet" onClick={() => setWarnOpen(true)}>
            Show the warning again
          </Button>
        ) : null}
        {problem !== null && !done ? (
          <span role="alert" className="x2f-release__error">
            {problem}
          </span>
        ) : failed !== null && !done ? (
          <span role="alert" className="x2f-release__error">
            {failed === 'start'
              ? 'The release didn’t start. Try again.'
              : failed === 'unknown'
                ? 'We couldn’t confirm the release started. If it did, this device will finish it.'
                : 'The release didn’t finish on this device. Keep this page open.'}
          </span>
        ) : null}
        {releasing && !done && !busy && failed === 'sign' && escrow.phase === 'ready' && escrow.refusal === null ? (
          <button type="button" className="x2f-button x2f-button--quiet" onClick={() => void sign()}>
            Finish the release on this device
          </button>
        ) : null}
        {releasing && !foreign ? null : (
          <div className="x2f-release__actions">
            <Link className="x2f-button x2f-button--quiet" to={`/trade/${escrowCode}/dispute`} onClick={retract}>
              Payment not received
            </Link>
            <Link className="x2f-button x2f-button--danger" to={`/trade/${escrowCode}/dispute`} onClick={retract}>
              Open dispute
            </Link>
          </div>
        )}
      </footer>
      <ReleaseWarning
        open={warnOpen && warnDue}
        fiat={sums?.fiat ?? null}
        amount={sums?.amount ?? null}
        buyer={buyer}
        methodName={method.name}
        onOk={ackWarning}
        onBack={() => setWarnOpen(false)}
      />
    </div>
  );
}

/** "1 h 52 min to confirm", with the board's explanation on hover, focus or tap. */
function ConfirmWindow({ deadline, clock, buyer, place }: { deadline: string; clock: () => Date; buyer: string; place: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="x2f-release__window"
        aria-describedby="x2f-confirm-tip"
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="clock" size={16} />
        <span>
          <Countdown deadline={deadline} serverClock={clock} format="minutes" /> to confirm
        </span>
      </button>
      <span id="x2f-confirm-tip" role="tooltip" className="x2f-release__tip" hidden={!open}>
        Time you have to check {place} and release, or report that the money didn&apos;t arrive. Instant apps like Zelle get 2 hours;
        bank wires get up to 24.{' '}
        {/* DESIGN: wording (cap-dispute review I1). Owner 2026-11-06 Q36: the buyer waits 60 minutes; maintenance pauses it (Q10). */}
        {buyer} can ask a moderator to step in from {TIMERS.buyerDisputeAfterPaidMin} minutes after marking paid. Nothing is
        released without you or a moderator.
      </span>
    </>
  );
}
