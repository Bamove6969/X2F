/**
 * TradeFund (Task 22; board TradeFund.dc.html; spec 2.2 step 5): the seller funds the escrow from
 * their own wallet; the buyer waits ("Waiting for <seller> to fund") and never funds anything
 * (no deposits, spec 2.5).
 *
 * The funding guard (owner 2026-10-21): "Open in <wallet>" is a 1.5 s hold that opens the wallet
 * once per trade, then shows "Waiting for your payment…" (the QR code and copy stay until
 * funded). Once the full amount is seen, the address, QR code, copy buttons and wallet link are
 * replaced by "Escrow funded" and never rendered again for that trade, across reloads.
 *
 * After a short payment (review 2026-10-27, I1) the link, QR code and "Copy amount" carry only the
 * remainder, worked out from what THIS device's escrow has seen arrive (`escrow.receivedAtomic`);
 * until the device has that reading only the address is shown, with the rest as text.
 */
import { useEffect, useRef, useState } from 'react';
import { formatFiat, formatXmr, moneroUri } from '@x2f/trade';
import { methodOf, type TradeView } from '../../api/trade.js';
import { Amount } from '../../ui/Amount.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { EscrowDots } from '../../ui/EscrowDots.js';
import { HoldButton } from '../../ui/HoldButton.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { exactXmr, hasFundMark, isFunded, isPhoneDevice, setFundMark, walletName } from './fund.js';
import { FundFallback, type SendNow } from './FundFallback.js';
import { IntegrityFailed, Name, EscrowCheck, SetupStatus } from './SetupStatus.js';
import { amountToSend, verifiedFunding } from './seams.js';
import { registerTradeScreen, setIntegrityScreen, type TradeScreenProps } from './TradeRoom.js';
import './trade.css';

export const GIFT_CARD_WARNING =
  'When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware.';
export const EDGE_TIP = "For best privacy, turn on Full Sync in Edge's Monero settings.";

/** What the seller sends: the funding amount while unfunded, else the amount plus the poster's fee. */
function sellerFundsOf(view: TradeView): bigint {
  if (view.funding) return BigInt(view.funding.sellerFundsAtomic);
  const fee = view.poster === 'seller' && view.fee ? BigInt(view.fee.atomic) : 0n;
  return BigInt(view.amountAtomic) + fee;
}

const fiat = (view: TradeView, cents: string | bigint) => `${formatFiat(BigInt(cents), view.lockedRate.currency)} ${view.lockedRate.currency}`;

function Header({ view, selling }: { view: TradeView; selling: boolean }) {
  const m = methodOf(view);
  return (
    <TradeHeader
      title={
        <>
          {selling ? 'Selling to' : 'Buying from'} <Name view={view} />
        </>
      }
      code={view.code}
      method={{ name: m.name, whatItIs: m.whatItIs }}
      backTo="/sell"
    />
  );
}

function Row({ label, value, total = false }: { label: string; value?: string; total?: boolean }) {
  return (
    <div className="x2f-quote-row" data-total={total ? 'true' : 'false'}>
      <span className="x2f-quote-row__label">{label}</span>
      {value === undefined ? null : <span className="x2f-mono">{value}</span>}
    </div>
  );
}

/** The grown totals for both sides (plan Revision 2026-10-20). */
function Grown({ view }: { view: TradeView }) {
  if (!view.grown) return null;
  const xmr = formatXmr(BigInt(view.amountAtomic));
  const total = formatFiat(BigInt(view.fiatCents), view.lockedRate.currency);
  return (
    <p className="x2f-notice" role="status" data-grown={view.grown.at}>
      Trade grew to {xmr} XMR, you now {view.role === 'buyer' ? 'pay' : 'receive'} {total}
    </p>
  );
}

function GiftCard({ view }: { view: TradeView }) {
  return methodOf(view).giftCard ? <p className="x2f-gift-warning">{GIFT_CARD_WARNING}</p> : null;
}

function HowEscrow({ view }: { view: TradeView }) {
  return (
    <section className="x2f-how" aria-label="How the escrow works">
      <div className="x2f-how__head">
        <h2>Escrow ready: 3 keys, any 2 release it</h2>
        <span className="x2f-muted">
          Yours, <Name view={view} />
          's and the moderator's. One key alone can't move anything.
        </span>
      </div>
      <ul className="x2f-how__list">
        <li>
          <EscrowDots filled={[true, true, false]} tone="escrow" />
          <span>
            <strong>Trade completes:</strong>{' '}
            <span className="x2f-muted">
              you and <Name view={view} /> sign, XMR goes to <Name view={view} />
            </span>
          </span>
        </li>
        <li>
          <EscrowDots filled={[true, true, false]} tone="escrow" />
          <span>
            <strong>You both cancel:</strong>{' '}
            <span className="x2f-muted">
              you and <Name view={view} /> sign, XMR comes back to you
            </span>
          </span>
        </li>
        <li>
          <EscrowDots filled={[false, true, true]} tone="caution" />
          <span>
            <strong>Dispute:</strong> <span className="x2f-muted">the moderator signs with whoever is in the right</span>
          </span>
        </li>
      </ul>
    </section>
  );
}

/** The seller's quote card (board "Quote"): what goes into escrow, the locked rate, the fees and the fiat total. */
function SellerQuote({ view }: { view: TradeView }) {
  const funds = sellerFundsOf(view);
  const rate = `${formatFiat(BigInt(view.lockedRate.centsPerXmr), view.lockedRate.currency)} / XMR`;
  return (
    <section className="x2f-quote" aria-label="Quote">
      <div className="x2f-quote__head">
        <span className="x2f-label">You send to escrow</span>
        <Amount xmr={formatXmr(funds)} />
      </div>
      <div className="x2f-quote__rows">
        <Row label="Rate (locked when the trade started)" value={rate} />
        {view.poster === 'seller' && view.fee ? <Row label="Includes X2F fee (1%, your ad)" value={`${formatXmr(BigInt(view.fee.atomic))} XMR`} /> : null}
        <Row label="Network fee · set in your wallet" />
        <div className="x2f-quote__rule" />
        <Row label="You receive" value={fiat(view, view.fiatCents)} total />
      </div>
    </section>
  );
}

/**
 * The phone's funding footer: the 1.5 s hold that opens the wallet once per trade (then
 * "Waiting for your payment…"), its hint, and the way to the QR code. It stays on screen at
 * every phone size; the QR code and address go in the scrolling body.
 */
function WalletFooter({
  view,
  uri,
  fundsAtomic,
  opened,
  onOpened,
  fallbackShown,
  onShowFallback,
}: {
  view: TradeView;
  /** Built on this device from the verified address (never the API's link). */
  uri: string;
  /** The device-verified amount the link carries (the whole funding, or the remainder this device worked out). */
  fundsAtomic: bigint;
  opened: boolean;
  onOpened: () => void;
  fallbackShown: boolean;
  onShowFallback: () => void;
}) {
  const f = view.funding!;
  const wallet = walletName(f.walletApp);
  const link = useRef<HTMLAnchorElement>(null);
  const open = () => {
    // Once per trade on this device, whatever re-renders or reloads happened since.
    if (hasFundMark(view.code, 'opened')) return;
    setFundMark(view.code, 'opened');
    onOpened();
    link.current?.click();
  };
  return (
    <footer className="x2f-fund-footer">
      <a ref={link} href={uri} hidden data-wallet-link="" tabIndex={-1} aria-hidden="true">
        {wallet}
      </a>
      <HoldButton
        label={opened ? 'Waiting for your payment…' : `Open in ${wallet}`}
        holdingLabel="Keep holding…"
        caption={opened ? `Opened ${wallet}` : 'Press and hold'}
        done={opened}
        onComplete={open}
      />
      {opened ? null : (
        <span className="x2f-fund-hint">
          Opens {wallet} with the escrow address and {exactXmr(fundsAtomic)} XMR filled in. You confirm there.
        </span>
      )}
      {opened || fallbackShown ? null : (
        <Button variant="quiet" onClick={onShowFallback}>
          Use another wallet (QR code or address)
        </Button>
      )}
    </footer>
  );
}

/** moneroUri, or null (nothing to fund with) for an address it refuses: fail closed. */
function safeUri(address: string, funds: bigint): string | null {
  try {
    return moneroUri(address, funds);
  } catch {
    return null;
  }
}

export function TradeFund({ view, escrow, serverClock }: TradeScreenProps) {
  const fundedNow = isFunded(view);
  const funded = fundedNow || hasFundMark(view.code, 'funded');
  useEffect(() => {
    if (fundedNow) setFundMark(view.code, 'funded');
  }, [fundedNow, view.code]);
  const phone = isPhoneDevice(navigator.userAgent, navigator.maxTouchPoints);
  // The only address this screen ever shows or links: the one this device derived and verified
  // (check words ready, no error, the API's address equal to it). Until then it shows setup progress.
  const verified = verifiedFunding(escrow, view);
  const settingUp = view.state === 'setup' || verified === null;
  const funds = sellerFundsOf(view);
  const received = BigInt(view.receivedAtomic);
  const wallet = view.funding?.walletApp ?? null;
  const [opened, setOpened] = useState(() => hasFundMark(view.code, 'opened'));
  const [fallbackShown, setFallbackShown] = useState(false);
  const canFund = !funded && !settingUp && verified !== null;
  // The `monero:` link, QR code and copy text are built here from the device-verified address and
  // amount only; the API's `funding.uri` is never used. After a short payment they carry the
  // remainder this device itself has seen, or nothing at all (address only) until it has (I1).
  const toSend = canFund ? amountToSend(verified, received) : null;
  const uri = canFund && toSend !== null ? safeUri(verified.address, toSend) : null;
  const send: SendNow | null = uri !== null && toSend !== null ? { uri, atomic: toSend, rest: toSend !== verified!.fundsAtomic } : null;
  const addressOnly = canFund && send === null;
  const fallback =
    canFund && (addressOnly || !phone || opened || fallbackShown) ? (
      <FundFallback address={verified!.address} send={send} restAtomic={funds > received ? funds - received : 0n} primary={!phone || addressOnly} />
    ) : null;

  return (
    <div className="x2f-trade" data-trade-fund="" data-funded={funded ? 'true' : 'false'}>
      <Header view={view} selling />
      <div className="x2f-trade-body">
        {funded ? (
          <div className="x2f-trade-chip-row">
            <StatusChip tone="escrow" icon="shield-check" label="Escrow funded" />
          </div>
        ) : settingUp ? null : (
          <div className="x2f-trade-chip-row">
            <StatusChip tone="caution" icon="clock" label="Waiting for you to fund" />
            {view.fundBy ? <Countdown deadline={view.fundBy} serverClock={serverClock} /> : null}
          </div>
        )}
        {funded ? (
          <section className="x2f-trade-intro">
            <h1 className="x2f-trade-title">Escrow funded</h1>
            <p className="x2f-trade-lead">
              {view.state === 'setup' || view.state === 'funding' || view.state === 'securing'
                ? `Securing escrow · confirmations ${Math.min(view.confirmations, 10)} of 10.`
                : 'The escrow holds the XMR.'}{' '}
              Neither of you can take it alone now.
            </p>
          </section>
        ) : settingUp ? (
          <SetupStatus view={view} escrow={escrow} />
        ) : (
          <section className="x2f-trade-intro">
            <h1 className="x2f-trade-title">
              <Name view={view} /> is in. Fund the escrow to lock the trade.
            </h1>
            <p className="x2f-trade-lead">
              Once funded, neither of you can take the XMR alone. It's released when you both agree, or by a moderator if there's a
              dispute.
            </p>
          </section>
        )}
        <Grown view={view} />
        {!funded && received > 0n && received < funds ? (
          <p className="x2f-notice" role="status" data-short="">
            Received {formatXmr(received)} of {formatXmr(funds)} XMR, send the rest
          </p>
        ) : null}
        <GiftCard view={view} />
        {fallback}
        <SellerQuote view={view} />
        {settingUp && !funded ? null : <HowEscrow view={view} />}
        {!settingUp && escrow.checkWords ? <EscrowCheck view={view} words={escrow.checkWords} /> : null}
        {!funded && wallet === 'edge' ? <p className="x2f-muted x2f-tip">{EDGE_TIP}</p> : null}
      </div>
      {send !== null && phone ? (
        <WalletFooter
          view={view}
          uri={send.uri}
          fundsAtomic={send.atomic}
          opened={opened}
          onOpened={() => setOpened(true)}
          fallbackShown={fallbackShown}
          onShowFallback={() => setFallbackShown(true)}
        />
      ) : null}
    </div>
  );
}

/** The buyer before funding: setup progress, then "Waiting for <seller> to fund". No address, QR code or wallet link. */
export function BuyerWaitFund({ view, escrow, serverClock }: TradeScreenProps) {
  const settingUp = view.state === 'setup';
  return (
    <div className="x2f-trade" data-buyer-wait="">
      <Header view={view} selling={false} />
      <div className="x2f-trade-body">
        {settingUp ? (
          <SetupStatus view={view} escrow={escrow} />
        ) : (
          <div className="x2f-trade-chip-row">
            <StatusChip tone="caution" icon="clock" label="Waiting for funding" />
            {view.fundBy ? <Countdown deadline={view.fundBy} serverClock={serverClock} /> : null}
          </div>
        )}
        <section className="x2f-trade-intro">
          <h1 className="x2f-trade-title">
            Waiting for <Name view={view} /> to fund
          </h1>
          <p className="x2f-trade-lead">You don't send anything yet. Pay only once the escrow is funded and secured.</p>
        </section>
        <Grown view={view} />
        <GiftCard view={view} />
        <section className="x2f-quote" aria-label="Quote">
          <div className="x2f-quote__head">
            <span className="x2f-label">You get</span>
            <Amount xmr={formatXmr(BigInt(view.amountAtomic) - (view.poster === 'buyer' && view.fee ? BigInt(view.fee.atomic) : 0n))} />
          </div>
          <div className="x2f-quote__rows">
            <Row label="You pay" value={fiat(view, view.fiatCents)} total />
          </div>
        </section>
        {!settingUp && escrow.checkWords ? <EscrowCheck view={view} words={escrow.checkWords} /> : null}
      </div>
    </div>
  );
}

registerTradeScreen({ owner: 'Task 22', role: 'seller', states: ['setup', 'funding', 'securing'], screen: TradeFund });
registerTradeScreen({ owner: 'Task 22', role: 'buyer', states: ['setup', 'funding'], screen: BuyerWaitFund });
setIntegrityScreen(IntegrityFailed);
