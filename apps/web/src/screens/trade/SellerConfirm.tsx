import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, useServerClock } from '../../api/client.js';
import { Countdown } from '../../ui/Countdown.js';
import { HoldButton } from '../../ui/HoldButton.js';
import { Icon } from '../../ui/icons.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { amounts, publicName, firstPerson, profileCopy, type MethodInfo, type ReleaseEscrow, type ReleaseTrade } from './release/view.js';
import './release/release.css';

/**
 * SellerConfirm (board SellerConfirm.dc.html; spec 2.2 steps 8-9): the buyer has marked paid; the
 * seller checks their own account, ticks the box and presses and holds to release. The hold is
 * locked until the box is ticked and while the escrow is not releasable ("Releasable in N min").
 * A full hold posts `release-started`, then calls `escrow.release()`; the buyer's app co-signs.
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
  // A new key gives a fresh HoldButton after a failed attempt (it fires onComplete once per mount).
  const [attempt, setAttempt] = useState(0);

  const buyer = publicName(trade.counterparty);
  const { amount, fiat } = amounts(trade);
  const { place, checkPrompt } = profileCopy(trade.profile);
  const done = trade.state === 'settling' && trade.settling === 'release';
  const waiting = !trade.releasable && !done;

  const release = async () => {
    setBusy(true);
    setFailed(null);
    let next: ReleaseTrade;
    try {
      next = await api<ReleaseTrade>(`/v1/trades/${encodeURIComponent(trade.code)}/events`, {
        method: 'POST',
        body: { type: 'release-started' },
      });
    } catch {
      // Refused or unreachable: nothing was signed, and the seller can hold again.
      setFailed('start');
      setAttempt((n) => n + 1);
      setBusy(false);
      return;
    }
    onTrade(next);
    try {
      await escrow.release();
    } catch {
      // The trade is settling; the escrow runtime keeps the attempt and retries (Task 12).
      setFailed('sign');
    } finally {
      setBusy(false);
    }
  };

  const caption = done ? 'Released' : waiting && trade.releasableEtaMin !== null ? `Releasable in ${trade.releasableEtaMin} min` : 'Payment received';
  const hint = done
    ? `Both signatures sent. ${buyer} will be asked to rate the trade.`
    : checked
      ? 'Press and hold for 1.5 seconds. Once released, the XMR can’t be taken back.'
      : 'Tick the box above to unlock this release button.';

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
          {trade.confirmBy !== null && !done ? <ConfirmWindow deadline={trade.confirmBy} clock={clock} buyer={buyer} place={place} /> : null}
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
              checked={checked || done}
              disabled={done || busy}
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
          disabled={!checked || waiting || busy}
          done={done}
          onComplete={() => void release()}
          caption={caption}
          holdingLabel="Keep holding…"
          label={done ? `${amount} is on its way to ${buyer}` : `Hold to release ${amount} to ${buyer}`}
          accessibleLabel={done ? `Released ${amount} to ${buyer}` : `Press and hold for 1.5 seconds to release ${amount} to ${buyer}`}
        />
        <span className="x2f-release__hint">{hint}</span>
        {failed !== null ? (
          <span role="alert" className="x2f-release__error">
            {failed === 'start' ? 'The release didn’t start. Try again.' : 'The release didn’t finish on this device. Keep this page open.'}
          </span>
        ) : null}
        {done ? null : (
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
