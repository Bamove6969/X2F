import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
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
import { confirmSkipped, skipConfirm } from './confirmSkip.js';
import { DisputeLocked } from './DisputeLocked.js';
import { GiftCardEvidence } from '../giftcard/GiftCardRules.js';
import { formatDate as utcDate, formatDateTime as utcDateTime } from '../../ui/dates.js';
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
 * The release warning (Task 38, ReleaseWarning) opens only on "Payment received", the completed
 * hold (design proto review P2, 8 Nov: it used to open with the screen, before the seller had read
 * it): the release then waits for "It's in my account", once per trade on this device (warned.ts),
 * or never again once the seller ticked "Do not show me this warning again" (owner p7-2,
 * confirmSkip.ts). "Payment not received" before the confirm window ends (the method's wait) says
 * to check again first, and only after it goes to the dispute screen. "Open dispute" is locked
 * with its UTC time until then too: the seller waits the method's full time from "I've paid"
 * before a dispute, as the buyer does (owner p9-4, 8 Nov; the machine refuses it, too-early).
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
  const [acked, setAcked] = useState(() => warned('release', escrowCode) || confirmSkipped('release'));
  /** "Payment not received" was tapped before the confirm window ended: the check-first note shows. */
  const [notYet, setNotYet] = useState(false);

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

  // The release warning opens on "Payment received" (the completed hold) until the seller has gone
  // past it (Task 38; proto review P2), never over a release already under way from this device or done.
  const warnDue = !acked && !done && !(releasing && !foreign);
  const [warnOpen, setWarnOpen] = useState(false);
  /** The hold completed; the release waits for the warning's answer. */
  const onHold = () => {
    if (warnDue && !confirmSkipped('release')) {
      setWarnOpen(true);
      return;
    }
    void (foreign ? finish() : release());
  };
  const ackWarning = (dontShow: boolean) => {
    setWarned('release', escrowCode);
    if (dontShow) skipConfirm('release');
    setAcked(true);
    setWarnOpen(false);
    void (foreign ? finish() : release());
  };
  const backFromWarning = () => {
    setWarnOpen(false);
    // HoldButton fires once per mount: a fresh one for the next hold.
    setAttempt((n) => n + 1);
  };
  const confirmEnded = trade.confirmBy === null || clock().getTime() >= Date.parse(trade.confirmBy);
  // Re-render once the confirm window ends on screen, so the dispute ways open by themselves.
  const [, setEndedTick] = useState(0);
  useEffect(() => {
    if (confirmEnded || trade.confirmBy === null) return;
    const left = Date.parse(trade.confirmBy) - clock().getTime();
    if (!Number.isFinite(left)) return;
    const id = setTimeout(() => setEndedTick((n) => n + 1), Math.min(left + 250, 2_147_000_000));
    return () => clearTimeout(id);
  }, [confirmEnded, trade.confirmBy, clock]);

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
        {/* J-17 (G50, G52): the seller checks the card within its window; what they keep for a dispute. */}
        {method.giftCard ? <GiftCardEvidence role="checker" /> : null}

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
                setChecked(e.currentTarget.checked);
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
          disabled={foreign ? !checked || busy || blocked || escrow.phase !== 'ready' || warnOpen : !checked || notReleasable || busy || blocked || releasing || warnOpen}
          done={done}
          onComplete={onHold}
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
            {confirmEnded ? (
              <Link className="x2f-button x2f-button--quiet" to={`/trade/${escrowCode}/dispute`} onClick={retract}>
                Payment not received
              </Link>
            ) : (
              <Button variant="quiet" aria-expanded={notYet} onClick={() => setNotYet(true)}>
                Payment not received
              </Button>
            )}
            {confirmEnded ? (
              <Link className="x2f-button x2f-button--danger" to={`/trade/${escrowCode}/dispute`} onClick={retract}>
                Open dispute
              </Link>
            ) : (
              <DisputeLocked until={trade.confirmBy!} serverClock={clock} />
            )}
          </div>
        )}
        {notYet && !confirmEnded && trade.confirmBy !== null && !(releasing && !foreign) ? (
          <p className="x2f-release__hint" role="status" data-not-received="">
            {/* COPY-UNSIGNED (design proto review P2: check first, the dispute after the confirm window). */}
            Payments can take a while to arrive. Check {place} again. If the money still isn&apos;t there at {untilText(trade.confirmBy, clock())}, tap
            Payment not received again to ask a moderator.
          </p>
        ) : null}
      </footer>
      <ReleaseWarning
        open={warnOpen && warnDue}
        fiat={sums?.fiat ?? null}
        amount={sums?.amount ?? null}
        buyer={buyer}
        methodName={method.name}
        onOk={ackWarning}
        onBack={backFromWarning}
      />
    </div>
  );
}

/** "13:52 UTC" when the window ends today (server clock), else "26 Oct 2026, 13:52 UTC" (design X5). */
function untilText(iso: string, now: Date): string {
  const end = new Date(iso);
  const full = utcDateTime(end);
  return utcDate(end) === utcDate(now) ? full.slice(full.indexOf(', ') + 2) : full;
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
        {/* COPY-UNSIGNED: the board's line, changed for owner F9 (7 Nov, the times) and p9-4 (8 Nov, the seller waits too). */}
        Time for the payment to arrive and for you to check {place}. Instant apps like Zelle get 90 min; same or next day transfers get
        24 h; slow ones like mail get up to 4 days. After that, you or {buyer} can ask a moderator to step in. Nothing is released
        without you or a moderator.
      </span>
    </>
  );
}
