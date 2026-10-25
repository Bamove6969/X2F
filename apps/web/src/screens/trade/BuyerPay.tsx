/**
 * BuyerPay (boards BuyerPay.dc.html at 390×844 and Desktop.dc.html at 1280×800; Plan 3 Task 23):
 * the buyer's trade room from funding seen until the seller confirms, and the seller's waiting
 * room while the buyer pays (SellerWaiting). Both are trade-room screens with Task 22's
 * `TradeScreenProps` (copied in payTypes.ts until Task 22 merges): the room loads the trade,
 * owns the escrow handle and picks the screen; these screens only show the view and act.
 *
 * Every action records the event with the API first, then asks the escrow (Task 12's order):
 * - I've paid → PaidConfirmSheet → `mark-paid { fiatCents }` (the total the sheet showed), then
 *   `escrow.markPaid(fiatCents)` (the `trade.paid` signal). A `total-changed` refusal sends
 *   nothing: the trade is re-read and the sheet asks again with the new total.
 * - Cancel trade (buyer, spec 2.3): one tap before "I've paid" (`buyer-cancel`, then
 *   `escrow.buyerCancel()`, which sends `trade.cancel`); after it, CancelSheet's warning first.
 * - The seller never cancels alone: Propose cancel / Withdraw (mutual cancel); the buyer gets an
 *   accept/decline card, and Accept is `accept-cancel` then `escrow.proposeCancelSign()`.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatFiat, formatXmr } from '@x2f/trade';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { MethodExplainer } from '../../ui/MethodExplainer.js';
import { Sheet } from '../../ui/Sheet.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { CancelProposalCard, CancelSheet, SellerCancelControls } from './CancelSheet.js';
import { PaidConfirmSheet, type YesResult } from './PaidConfirmSheet.js';
import { buyerCancelMode, escrowChip, payTimer, showProposal, type EscrowChip } from './payModel.js';
import { GIFT_CARD_WARNING, methodOf, postTradeEvent, usePaidAck, usePaymentDetails, useTradeChat, type MethodInfo, type PayEvent } from './paySeams.js';
import { publicName, type Party, type TradeScreenProps, type TradeState, type TradeView } from './payTypes.js';
import { CounterpartyCard, Name, TradeTimeline } from './TradeTimeline.js';
import './pay.css';

/** Task 23's trade-room slots (Task 22's `registerTradeScreen`; see the tripwire in test/pay-tripwires.test.ts). */
export const TASK23_SLOTS: readonly { owner: 'Task 23'; role: Party; states: readonly TradeState[]; when?: undefined; screen: (p: TradeScreenProps) => ReactNode }[] = [
  // `paid` for the buyer is not in Task 22's ownership list; Task 23 takes it ("Marked as paid", the warned cancel).
  { owner: 'Task 23', role: 'buyer', states: ['securing', 'secured', 'paid'], screen: BuyerPay },
  { owner: 'Task 23', role: 'seller', states: ['secured'], screen: SellerWaiting },
];

const REFUSALS: Record<string, string> = {
  'too-late': "It's too late for that now.",
  'wrong-state': "The trade has moved on. It can't do that now.",
  'trading-paused': 'Trading is paused for maintenance. Try again soon.',
  'not-releasable': 'The escrow is not unlocked yet. Try again in a few minutes.',
};

/** A refusal as one plain sentence (never the raw code). */
function refusalText(e: unknown): string {
  if (e instanceof ApiCallError) return REFUSALS[e.code] ?? "That didn't go through. Try again.";
  return "That didn't go through. Check your connection and try again.";
}

const fiatOf = (v: TradeView): string => formatFiat(BigInt(v.fiatCents), v.lockedRate.currency);

/** Posts a trade event, then runs the escrow step, then re-reads the trade; one at a time. */
function useTradeAction(p: TradeScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (e: PayEvent, escrowStep?: () => Promise<void>, escrowError?: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      try {
        await postTradeEvent(p.view.code, e);
      } catch (err) {
        setError(refusalText(err));
        return false;
      }
      if (escrowStep) {
        try {
          await escrowStep();
        } catch {
          setError(escrowError ?? "That didn't go through. Try again.");
        }
      }
      await p.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

// ---- Parts shared by the phone and desktop rooms ----

function TradeSub({ view, method }: { view: TradeView; method: MethodInfo }) {
  const [explain, setExplain] = useState(false);
  return (
    <span className="x2f-trade-header__sub">
      Trade {view.code} ·{' '}
      <button type="button" className="x2f-method-name" aria-haspopup="dialog" onClick={() => setExplain(true)}>
        {method.name}
      </button>
      <MethodExplainer open={explain} name={method.name} whatItIs={method.whatItIs} onClose={() => setExplain(false)} />
    </span>
  );
}

const CONFIRM_TIP =
  "The seller's XMR is already locked in the escrow. It's secured once the Monero network confirms it 10 times, about 20 min in total. For the safest trade, wait until this finishes before you pay. If you're comfortable with this seller, feel free to move the trade along now.";
const PAY_TIP =
  "You get 90 minutes to send the money and tap I've paid. The clock starts once the escrow has settled, so waiting for it never costs you time. If time runs out without that tap, the seller can cancel and get a refund, or give you more time.";

/** A help tip: hover or tap the trigger to show it (BuyerPay board). */
function useTip() {
  const [open, setOpen] = useState(false);
  return {
    open,
    trigger: { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false), onClick: () => setOpen((o) => !o) },
  };
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

/** The escrow chip and, while securing, the confirmations bar with its tip. */
function EscrowStatus({ chip, withBar }: { chip: EscrowChip; withBar: boolean }) {
  const tip = useTip();
  const bar = withBar ? chip.bar : null;
  return (
    <div className="x2f-escrow">
      <StatusChip tone={chip.tone} icon={chip.icon} label={chip.label} />
      {bar ? (
        <span className="x2f-escrow__bar-wrap">
          <button type="button" className="x2f-escrow__bar" aria-describedby="tip-rel" {...tip.trigger}>
            <span className="x2f-escrow__bar-head">
              <span className="x2f-escrow__bar-label">
                Confirmations
                <InfoIcon />
              </span>
              <span>
                <span className="x2f-mono x2f-ink">
                  {bar.confirmations} of {bar.of}
                </span>{' '}
                · about {bar.etaMin} min
              </span>
            </span>
            <span
              role="progressbar"
              aria-label="Escrow confirmations"
              aria-valuemin={0}
              aria-valuemax={bar.of}
              aria-valuenow={bar.confirmations}
              className="x2f-escrow__track"
            >
              <span className="x2f-escrow__fill" style={{ '--x2f-fill': `${(100 * bar.confirmations) / bar.of}%` } as CSSProperties} />
            </span>
          </button>
          {tip.open ? (
            <span id="tip-rel" role="tooltip" className="x2f-tip">
              {CONFIRM_TIP}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

/** "Time to pay": 90 min not started while securing (with when it starts), then the countdown. */
function PayTimerCard({ view, serverClock }: { view: TradeView; serverClock: () => Date }) {
  const tip = useTip();
  const t = payTimer(view, serverClock().getTime());
  const ring = t.started ? (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${t.leftMin} of ${t.totalMin} minutes left`} className="x2f-pay-timer__ring">
      <circle cx="28" cy="28" r={RING_R} fill="none" className="x2f-pay-timer__ring-track" strokeWidth="6" />
      <circle
        cx="28"
        cy="28"
        r={RING_R}
        fill="none"
        className="x2f-pay-timer__ring-left"
        strokeWidth="6"
        strokeDasharray={`${(RING_C * Math.min(t.leftMin, t.totalMin)) / t.totalMin} ${RING_C}`}
        transform="rotate(-90 28 28)"
      />
    </svg>
  ) : (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${t.totalMin} of ${t.totalMin} minutes left, not started`} className="x2f-pay-timer__ring">
      <circle cx="28" cy="28" r={RING_R} fill="none" className="x2f-pay-timer__ring-left" strokeWidth="6" strokeDasharray="4 4" />
    </svg>
  );
  return (
    <section aria-label="Payment timer" className="x2f-card x2f-pay-timer">
      <button type="button" className="x2f-pay-timer__text" aria-describedby="tip-pay" {...tip.trigger}>
        <span className="x2f-pay-timer__label">
          Time to pay
          <InfoIcon />
        </span>
        {t.started ? (
          <span className="x2f-pay-timer__value">
            <Countdown deadline={t.payBy} serverClock={serverClock} format="minutes" />
          </span>
        ) : (
          <>
            <span className="x2f-pay-timer__value">{t.totalMin} min</span>
            <span className="x2f-pay-timer__hint">
              {t.startsInMin === null ? 'Clock starts when escrow settles' : `Clock starts when escrow settles, in ${t.startsInMin} min`}
            </span>
          </>
        )}
      </button>
      {tip.open ? (
        <span id="tip-pay" role="tooltip" className="x2f-tip">
          {PAY_TIP}
        </span>
      ) : null}
      {ring}
    </section>
  );
}

/** "Send exactly": the total, the seller's details for the method, the memo, (desktop) the rate, and the own-name warning. */
function PaymentCard({ view, method, withRate }: { view: TradeView; method: MethodInfo; withRate: boolean }) {
  const details = usePaymentDetails(view.code);
  const fiat = fiatOf(view);
  const rows: { label: string; value: string }[] = details ?? [{ label: `${method.name} to`, value: 'Ask in the chat' }];
  return (
    <section aria-label="Send this payment" className="x2f-card x2f-pay-card">
      <h2 className="x2f-pay-card__title">Send exactly</h2>
      <span className="x2f-pay-card__total">
        {fiat} <span className="x2f-pay-card__currency">{view.lockedRate.currency}</span>
      </span>
      <div className="x2f-pay-card__rows">
        {rows.map((r) => (
          <div key={r.label} className="x2f-pay-card__row">
            <span className="x2f-ink-muted">{r.label}</span>
            <span className="x2f-mono x2f-pay-card__value">{r.value}</span>
          </div>
        ))}
        <div className="x2f-pay-card__row">
          <span className="x2f-ink-muted">Memo</span>
          <span className="x2f-mono x2f-pay-card__value">{view.code}</span>
        </div>
        {withRate ? (
          <div className="x2f-pay-card__row">
            <span className="x2f-ink-muted">Rate</span>
            <span className="x2f-mono x2f-pay-card__value">{formatFiat(BigInt(view.lockedRate.centsPerXmr), view.lockedRate.currency)} / XMR</span>
          </div>
        ) : null}
      </div>
      <p className="x2f-pay-card__note">Pay from an account in your own name. Payments from someone else's account may be rejected or frozen. Use at your own risk.</p>
      {method.giftCard ? (
        <p className="x2f-giftcard" data-tone="danger">
          <strong>{GIFT_CARD_WARNING}</strong>
        </p>
      ) : null}
    </section>
  );
}

/** The payment proof slot. The upload itself is Plan 5's; here it is the board's slot, not yet active. */
function ProofSlot({ wide }: { wide: boolean }) {
  return (
    <section aria-label="Payment proof" className="x2f-proof" data-wide={wide || undefined}>
      <label htmlFor="proof" className="x2f-proof__slot" aria-disabled="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
        </svg>
        <span className="x2f-proof__text">
          <span className="x2f-proof__title">Add payment proof</span>
          <span className="x2f-proof__hint">Private details are blurred for you to check next. Location and device info are removed.</span>
        </span>
        <input id="proof" type="file" accept="image/*" disabled className="x2f-visually-hidden" />
      </label>
    </section>
  );
}

/** The chat for the trade (Task 20's ChatPanel through the seam), or nothing until it is installed. */
function ChatSlot({ view }: { view: TradeView }) {
  const Chat = useTradeChat();
  return Chat ? <Chat code={view.code} name={publicName(view.counterparty)} /> : null;
}

function ChatButton({ view, primary }: { view: TradeView; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {primary ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Chat
        </Button>
      ) : (
        <button type="button" className="x2f-room__chat" onClick={() => setOpen(true)}>
          Chat
        </button>
      )}
      <Sheet open={open} title={`Chat with ${publicName(view.counterparty)}`} onClose={() => setOpen(false)}>
        <div className="x2f-sheet__body">
          <ChatSlot view={view} />
        </div>
      </Sheet>
    </>
  );
}

/** The wide room (Desktop board): the trade on the left, the counterparty and the chat on the right. */
function WideRoom({ view, method, title, chip, children }: { view: TradeView; method: MethodInfo; title: ReactNode; chip: EscrowChip | null; children: ReactNode }) {
  return (
    <div className="x2f-room" data-layout="wide">
      <div className="x2f-room__main">
        <div className="x2f-room__head">
          <div className="x2f-room__head-text">
            <TradeSub view={view} method={method} />
            <h1 className="x2f-room__title">{title}</h1>
          </div>
          {chip ? <StatusChip tone={chip.tone} icon={chip.icon} label={chip.label} /> : null}
        </div>
        {children}
      </div>
      <aside aria-label={`Chat with ${publicName(view.counterparty)}`} className="x2f-room__aside">
        <CounterpartyCard view={view} />
        <div className="x2f-room__chat-panel">
          <ChatSlot view={view} />
        </div>
      </aside>
    </div>
  );
}

// ---- BuyerPay ----

export function BuyerPay(p: TradeScreenProps) {
  const { view, escrow, serverClock, wide } = p;
  const method = methodOf(view);
  const chip = escrowChip(view);
  const acked = usePaidAck(view.code);
  const action = useTradeAction(p);
  const [paySheet, setPaySheet] = useState(false);
  const [grew, setGrew] = useState(false);
  const [cancelSheet, setCancelSheet] = useState(false);
  const [unsent, setUnsent] = useState<bigint | null>(null);
  const [retrying, setRetrying] = useState(false);
  const cancelMode = buyerCancelMode(view);
  const paid = view.state === 'paid';

  const onYes = async (fiatCents: bigint): Promise<YesResult> => {
    try {
      await postTradeEvent(view.code, { type: 'mark-paid', fiatCents });
    } catch (e) {
      if (e instanceof ApiCallError && e.status === 409 && e.code === 'total-changed') {
        // The trade grew while the sheet was open: nothing is sent; re-read and ask again.
        setGrew(true);
        await p.refresh();
        return { ok: false, reason: 'total-changed' };
      }
      return { ok: false, reason: 'error', message: refusalText(e) };
    }
    setPaySheet(false);
    setGrew(false);
    try {
      await escrow.markPaid(fiatCents);
      setUnsent(null);
    } catch {
      setUnsent(fiatCents);
    }
    await p.refresh();
    return { ok: true };
  };

  const retrySignal = async () => {
    if (unsent === null || retrying) return;
    setRetrying(true);
    try {
      await escrow.markPaid(unsent);
      setUnsent(null);
    } catch {
      // Still not sent: the message stays.
    } finally {
      setRetrying(false);
    }
  };

  const cancelNow = async () => {
    const ok = await action.run({ type: 'buyer-cancel' }, () => escrow.buyerCancel(), "Couldn't start the refund. Try again.");
    if (ok) setCancelSheet(false);
  };
  const onCancel = () => {
    if (cancelMode === 'warn') setCancelSheet(true);
    else void cancelNow();
  };

  const primary = paid ? (
    <Button variant="primary" disabled aria-live="polite">
      {acked ? 'Marked as paid' : 'Marking as paid…'}
    </Button>
  ) : (
    <Button variant="primary" onClick={() => setPaySheet(true)}>
      I've paid
    </Button>
  );
  const cancel =
    cancelMode === 'none' ? null : (
      <Button variant="quiet" disabled={action.busy} onClick={onCancel}>
        Cancel trade
      </Button>
    );
  const dispute = (
    <Link to={`/trade/${encodeURIComponent(view.code)}/dispute`} className="x2f-button x2f-button--danger">
      Open dispute
    </Link>
  );
  const notices = (
    <>
      {showProposal(view) ? (
        <CancelProposalCard view={view} busy={action.busy} onAccept={() => void action.run({ type: 'accept-cancel' }, () => escrow.proposeCancelSign())} />
      ) : null}
      {paid && unsent !== null ? (
        <p className="x2f-room__error" role="alert">
          Couldn't tell the escrow you paid. Try again.{' '}
          <Button variant="secondary" disabled={retrying} onClick={() => void retrySignal()}>
            Try again
          </Button>
        </p>
      ) : null}
      {action.error !== null && !cancelSheet ? (
        <p className="x2f-room__error" role="alert">
          {action.error}
        </p>
      ) : null}
    </>
  );
  const sheets = (
    <>
      <PaidConfirmSheet
        open={paySheet}
        fiatCents={BigInt(view.fiatCents)}
        fiatText={fiatOf(view)}
        methodName={method.name}
        code={view.code}
        grewTo={grew ? formatXmr(BigInt(view.amountAtomic)) : null}
        onYes={onYes}
        onNotYet={() => {
          setPaySheet(false);
          setGrew(false);
        }}
      />
      <CancelSheet open={cancelSheet} busy={action.busy} error={cancelSheet ? action.error : null} onConfirm={() => void cancelNow()} onClose={() => setCancelSheet(false)} />
    </>
  );
  const title = (
    <>
      Buying from <Name view={view} />
    </>
  );

  if (wide) {
    return (
      <>
        <WideRoom view={view} method={method} title={title} chip={chip}>
          {chip?.bar ? <EscrowStatus chip={chip} withBar /> : null}
          <TradeTimeline view={view} serverClock={serverClock} />
          {notices}
          <div className="x2f-room__grid">
            <PaymentCard view={view} method={method} withRate />
            <ProofSlot wide />
          </div>
          <div className="x2f-room__actions">
            {primary}
            {cancel}
            <span className="x2f-room__spacer" />
            {dispute}
          </div>
        </WideRoom>
        {sheets}
      </>
    );
  }

  return (
    <div className="x2f-pay" data-layout="phone">
      <TradeHeader title={title} code={view.code} method={method} backTo="/trades" action={<ChatButton view={view} />} />
      <div className="x2f-pay__main">
        {chip ? <EscrowStatus chip={chip} withBar /> : null}
        {notices}
        {paid ? null : <PayTimerCard view={view} serverClock={serverClock} />}
        <PaymentCard view={view} method={method} withRate={false} />
        <ProofSlot wide={false} />
      </div>
      <footer className="x2f-pay__footer">
        {primary}
        <div className="x2f-pay__footer-row">
          {cancel ?? <span />}
          {dispute}
        </div>
      </footer>
      {sheets}
    </div>
  );
}

// ---- The seller's room while the buyer pays ----

/** The seller in `secured` (before payBy; SellerRefund takes over after it, Task 25): wait, chat, or propose a mutual cancel. */
export function SellerWaiting(p: TradeScreenProps) {
  const { view, serverClock, wide } = p;
  const method = methodOf(view);
  const chip = escrowChip(view);
  const action = useTradeAction(p);
  const cancel = (
    <SellerCancelControls
      view={view}
      busy={action.busy}
      onPropose={() => void action.run({ type: 'propose-cancel' })}
      onWithdraw={() => void action.run({ type: 'withdraw-cancel' })}
    />
  );
  const waiting = (
    <section aria-label="Waiting for payment" className="x2f-card x2f-wait">
      <p className="x2f-wait__title">
        Waiting for <Name view={view} /> to pay
      </p>
      <span className="x2f-pay-card__total">
        {fiatOf(view)} <span className="x2f-pay-card__currency">{view.lockedRate.currency}</span>
      </span>
      {view.payBy !== null ? (
        <span className="x2f-wait__left">
          Time to pay <Countdown deadline={view.payBy} serverClock={serverClock} format="minutes" />
        </span>
      ) : null}
    </section>
  );
  const error =
    action.error !== null ? (
      <p className="x2f-room__error" role="alert">
        {action.error}
      </p>
    ) : null;
  const title = (
    <>
      Selling to <Name view={view} />
    </>
  );

  if (wide) {
    return (
      <WideRoom view={view} method={method} title={title} chip={chip}>
        <TradeTimeline view={view} serverClock={serverClock} />
        {waiting}
        {error}
        <div className="x2f-room__actions">
          <ChatButton view={view} primary />
          {cancel}
        </div>
      </WideRoom>
    );
  }
  return (
    <div className="x2f-pay" data-layout="phone">
      <TradeHeader title={title} code={view.code} method={method} backTo="/trades" />
      <div className="x2f-pay__main">
        {chip ? <EscrowStatus chip={chip} withBar /> : null}
        {waiting}
        {error}
      </div>
      <footer className="x2f-pay__footer">
        <ChatButton view={view} primary />
        <div className="x2f-pay__footer-row">{cancel}</div>
      </footer>
    </div>
  );
}
