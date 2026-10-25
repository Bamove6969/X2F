import type { CSSProperties, ReactNode } from 'react';
import { EscrowDots } from '../../ui/EscrowDots.js';
import { ExternalLink } from '../../ui/ExternalLink.js';
import { Icon } from '../../ui/icons.js';
import { useConfirmations } from './release/seams.js';
import { amounts, type ReleaseTrade } from './release/view.js';
import './release/release.css';

/** The public explorer the board links to; it gets the tx hash and nothing else (no referrer). */
export const EXPLORER_TX = 'https://xmrchain.net/tx/';

/**
 * Released (the released part of board Review.dc.html; spec 2.2 step 10): where the XMR went,
 * live confirmations ("1 of 10") from X2F's own node, and the optional explorer link with its
 * note. Only the ad poster sees the X2F fee (Global Constraints): a poster buyer gets the board's
 * Trade amount / "X2F fee (1%, your ad) −0.012500 XMR" / You receive; a poster seller the amount
 * they funded. The rating cards are Plan 5 (`reviewSlot`).
 */
export function Released({ trade, reviewSlot }: { trade: ReleaseTrade; reviewSlot?: ReactNode }) {
  const live = useConfirmations(trade.code);
  const other = trade.counterparty.username;
  const a = amounts(trade);
  const buyer = trade.role === 'buyer';
  const target = live?.target ?? 10;
  const count = live?.confirmations ?? null;
  const shown = count === null ? null : Math.min(count, target);

  return (
    <div className="x2f-release" data-screen="released">
      <section aria-label="Trade complete" className="x2f-released">
        <EscrowDots filled={[true, true, false]} tone="escrow" />
        <span className="x2f-released__label">Released</span>
        {buyer ? (
          <>
            <h1 className="x2f-released__title">{a.buyerReceives} is yours</h1>
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
              {a.amount} is on its way to <span data-username="">{other}</span>
            </h1>
            <p className="x2f-released__where">
              Both signatures sent. <span data-username="">{other}</span> will be asked to rate the trade.
            </p>
          </>
        )}

        {a.fee !== null ? (
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

        <div className="x2f-released__confirm">
          <div className="x2f-released__confirm-row">
            <span>Confirmations</span>
            <span className="x2f-released__mono" data-mask="confirmations">
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
          {trade.txHash !== null ? (
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
