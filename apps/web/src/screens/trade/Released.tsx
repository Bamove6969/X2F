import type { CSSProperties, ReactNode } from 'react';
import { EscrowDots } from '../../ui/EscrowDots.js';
import { ExternalLink } from '../../ui/ExternalLink.js';
import { Icon } from '../../ui/icons.js';
import { useLeaveWarning } from '../../ui/useLeaveWarning.js';
import { useConfirmations } from './release/seams.js';
import { ESCROW_STOPPED, amounts, isTxHash, publicName, refusalCopy, type ReleaseEscrow, type ReleaseTrade } from './release/view.js';
import './release/release.css';

/** The public explorer the board links to; it gets the tx hash and nothing else (no referrer). */
export const EXPLORER_TX = 'https://xmrchain.net/tx/';

/**
 * Released (the released part of board Review.dc.html; spec 2.2 step 10): where the XMR went,
 * live confirmations ("1 of 10") from X2F's own node, and the optional explorer link with its
 * note. Only the ad poster sees the X2F fee (Global Constraints): a poster buyer gets the board's
 * Trade amount / "X2F fee (1%, your ad) −0.012500 XMR" / You receive; a poster seller the amount
 * they funded. The rating cards are Plan 5 (`reviewSlot`).
 *
 * The amounts are the ones THIS device accepted (`escrow.amountAtomic`, review 2026-10-27 I3). The
 * device may have forgotten a finished trade, so once the trade is `released` (and only then) the
 * API's amount is the fallback, when it is a plain positive amount: nothing is signed from this
 * screen. Before that, with no device amount, the words name no amount (round-2 Minor 1). The buyer sees it from `settling` on; until
 * their own device has co-signed (`escrow.phase` `done`) it says the device is adding its
 * signature, and shows a Task 12 refusal or a stopped escrow instead of "is yours" (I2).
 */
export function Released({ trade, escrow, reviewSlot }: { trade: ReleaseTrade; escrow: ReleaseEscrow; reviewSlot?: ReactNode }) {
  const live = useConfirmations(trade);
  const other = publicName(trade.counterparty);
  const settled = trade.state === 'released';
  const plain = (v: string) => /^[0-9]{1,30}$/.test(v);
  const a =
    amounts(trade, escrow) ??
    (settled && plain(trade.amountAtomic) && plain(trade.fiatCents)
      ? amounts(trade, { amountAtomic: BigInt(trade.amountAtomic), fiatCents: BigInt(trade.fiatCents) })
      : null);
  const amountText = a?.amount ?? 'the XMR';
  const buyer = trade.role === 'buyer';
  const cosigned = settled || escrow.phase === 'done' || escrow.phase === 'settled-without-device';
  const problem = cosigned ? null : escrow.phase === 'error' || escrow.error !== null ? ESCROW_STOPPED : escrow.refusal !== null ? refusalCopy(escrow.refusal, other) : null;
  // Lead call (gap 4): while the buyer's device co-signs (it submits the release), the browser asks before the page goes.
  useLeaveWarning(buyer && !cosigned && problem === null && escrow.phase === 'signing' && escrow.handedOff !== true);
  const target = live?.target ?? 10;
  const count = live?.confirmations ?? null;
  const shown = count === null ? null : Math.min(count, target);

  return (
    <div className="x2f-release" data-screen="released">
      <section aria-label="Trade complete" className="x2f-released">
        <EscrowDots filled={[true, true, false]} tone="escrow" />
        <span className="x2f-released__label">{cosigned ? 'Released' : 'Releasing'}</span>
        {buyer && !cosigned ? (
          <>
            <h1 className="x2f-released__title">
              <span data-username="">{other}</span> released {amountText} to you
            </h1>
            {problem !== null ? (
              <p role="alert" className="x2f-release__error">
                {problem}
              </p>
            ) : (
              <p className="x2f-released__where">Your device is adding its signature. Keep this page open.</p>
            )}
          </>
        ) : buyer ? (
          <>
            <h1 className="x2f-released__title">{a?.buyerReceives ?? 'The XMR'} is yours</h1>
            <p className="x2f-released__where">
              Released by you and <span data-username="">{other}</span>.{' '}
              {live?.payoutEnd !== undefined ? (
                <>
                  It&apos;s on its way to your external wallet ending <span className="x2f-released__mono">…{live.payoutEnd}</span>.
                </>
              ) : (
                <>It&apos;s on its way to your external wallet.</>
              )}
            </p>
          </>
        ) : (
          <>
            <h1 className="x2f-released__title">
              {a?.amount ?? 'The XMR'} is on its way to <span data-username="">{other}</span>
            </h1>
            <p className="x2f-released__where">
              Both signatures sent. <span data-username="">{other}</span> will be asked to rate the trade.
            </p>
          </>
        )}

        {a !== null && a.fee !== null ? (
          <dl aria-label={buyer ? 'What you receive' : 'What you sent'} className="x2f-released__sums">
            <div>
              <dt>Trade amount</dt>
              <dd>{a.amount}</dd>
            </div>
            <div>
              <dt>X2F fee (1%, your ad)</dt>
              <dd>{buyer ? `−${a.fee}` : a.fee}</dd>
            </div>
            <div className="x2f-released__rule" aria-hidden="true" />
            <div className="x2f-released__total">
              <dt>{buyer ? 'You receive' : 'You sent'}</dt>
              <dd>{buyer ? a.buyerReceives : a.sellerSent}</dd>
            </div>
          </dl>
        ) : null}
        {/* COPY-UNSIGNED (owner 16 Nov: each receiving output pays the network fee for itself). Only the
            poster sees the X2F fee (Global Constraints), so the sentence about its 1% is the poster
            buyer's only (review B1, 16 Nov); a taker buyer reads the first sentence alone. */}
        {buyer ? (
          <span className="x2f-released__note">
            {trade.fee // the API sends `fee` to the ad poster only (release/view.ts)
              ? 'Before the network fee for your payout. X2F pays the network fee for its own 1%.'
              : 'Before the network fee for your payout.'}
          </span>
        ) : null}

        <div className="x2f-released__confirm">
          <div className="x2f-released__confirm-row">
            <span>Confirmations</span>
            <span className="x2f-released__mono">
              {shown === null ? 'Checking…' : `${shown} of ${target}`}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Confirmations"
            aria-valuemin={0}
            aria-valuemax={target}
            {...(shown === null ? {} : { 'aria-valuenow': shown })}
            className="x2f-released__bar"
          >
            <span style={{ '--x2f-confirmed': `${shown === null ? 0 : (shown / target) * 100}%` } as CSSProperties} />
          </div>
          {isTxHash(trade.txHash) ? (
            <ExternalLink href={`${EXPLORER_TX}${trade.txHash}`}>
              View on the Monero blockchain
              <Icon name="external" size={14} />
            </ExternalLink>
          ) : null}
          <span className="x2f-released__note">
            Opens a public block explorer. It shows the transaction and its confirmations, never the amount or who received it.
          </span>
        </div>
      </section>
      {reviewSlot}
    </div>
  );
}
