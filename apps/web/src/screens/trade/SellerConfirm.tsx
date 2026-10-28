import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, useServerClock } from '../../api/client.js';
import { Countdown } from '../../ui/Countdown.js';
import { HoldButton } from '../../ui/HoldButton.js';
import { Icon } from '../../ui/icons.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
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
 * `settling` alone (I1): while the API says the release is settling and the device has not
 * signed (a lost POST answer, a reload between the POST and `release()`, an `act` that threw), the
 * screen calls `release()` again once the device is ready (Task 12's runtime accepts it while the
 * view is settling a release), and offers "Finish the release on this device" if that fails.
 * The smart proof card is Plan 5 (`proofSlot`, masked on the board comparison).
 */
export function SellerConfirm({
  trade,
  method,
  escrow,
  onTrade,
  headerAction,
  proofSlot,
  serverClock,
}: {
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
  const [failed, setFailed] = useState<'start' | 'sign' | null>(null);
  /** The API took `release-started` on this mount (its answer reached us), before the room refreshes (Minor 11). */
  const [started, setStarted] = useState(false);
  // A new key gives a fresh HoldButton after a failed attempt (it fires onComplete once per mount).
  const [attempt, setAttempt] = useState(0);
  /** `release()` was asked for on this mount: the automatic resume runs at most once. */
  const asked = useRef(false);

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
    let next: ReleaseTrade;
    try {
      next = await api<ReleaseTrade>(`/v1/trades/${encodeURIComponent(trade.code)}/events`, {
        method: 'POST',
        body: { type: 'release-started' },
      });
    } catch {
      // Refused or unreachable. If the API did apply it (a lost answer), the room's next read
      // shows the release settling and the resume below signs it.
      asked.current = false;
      setFailed('start');
      setAttempt((n) => n + 1);
      setBusy(false);
      return;
    }
    setStarted(true);
    onTrade(next);
    await sign();
  };

  // I1: the API says the release is settling, the device is ready and has not signed, and nothing
  // was asked on this mount: sign it now (reload, lost POST answer). Once per mount.
  useEffect(() => {
    if (!apiReleasing || asked.current || busy) return;
    if (escrow.phase !== 'ready' || escrow.refusal !== null || escrow.error !== null) return;
    void sign();
  }, [apiReleasing, busy, escrow.phase, escrow.refusal, escrow.error]);

  const problem = stopped ? ESCROW_STOPPED : escrow.refusal !== null ? refusalCopy(escrow.refusal, buyer) : null;

  const caption = done
    ? 'Released'
    : releasing
      ? 'Signing…'
      : notReleasable
        ? trade.releasableEtaMin !== null
          ? `Releasable in ${trade.releasableEtaMin} min`
          : 'Waiting for the escrow to unlock'
        : 'Payment received';
  const hint = done
    ? `Both signatures sent. ${buyer} will be asked to rate the trade.`
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
              checked={checked || releasing}
              disabled={releasing || busy}
              onChange={(e) => setChecked(e.currentTarget.checked)}
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
          disabled={!checked || notReleasable || busy || blocked || releasing}
          done={done}
          onComplete={() => void release()}
          caption={caption}
          holdingLabel="Keep holding…"
          label={done ? `${amount} is on its way to ${buyer}` : releasing ? `Releasing ${amount} to ${buyer}` : `Hold to release ${amount} to ${buyer}`}
          accessibleLabel={
            done
              ? `Released ${amount} to ${buyer}`
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
            {failed === 'start' ? 'The release didn’t start. Try again.' : 'The release didn’t finish on this device. Keep this page open.'}
          </span>
        ) : null}
        {releasing && !done && !busy && failed === 'sign' && escrow.phase === 'ready' && escrow.refusal === null ? (
          <button type="button" className="x2f-button x2f-button--quiet" onClick={() => void sign()}>
            Finish the release on this device
          </button>
        ) : null}
        {releasing ? null : (
          <div className="x2f-release__actions">
            <Link className="x2f-button x2f-button--quiet" to={`/trade/${trade.code}/dispute`}>
              Payment not received
            </Link>
            <Link className="x2f-button x2f-button--danger" to={`/trade/${trade.code}/dispute`}>
              Open dispute
            </Link>
          </div>
        )}
      </footer>
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
        bank wires get up to 24. If time runs out, {buyer} can ask a moderator to step in. Nothing is released without you or a
        moderator.
      </span>
    </>
  );
}
