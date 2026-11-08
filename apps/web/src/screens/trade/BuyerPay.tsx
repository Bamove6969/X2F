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
 *   nothing: the trade is re-read and the sheet asks again with the new total. Owner Q12: "I've
 *   paid" and the seller's payment details only once the escrow is secured (10 of 10); before
 *   that the button is closed and the details are a locked card (board Warn-IvePaid, Task 38's
 *   pay warning, is superseded by Q12 and gone).
 * - Cancel trade (buyer, spec 2.3; owner G56 and g67): before "I've paid" it opens the
 *   "Cancelling is final" sheet (CancelFinalSheet.tsx), whose Cancel trade posts `buyer-cancel`,
 *   then `escrow.buyerCancel()`, which sends `trade.cancel`. After "I've paid" there is no cancel
 *   at all (owner, Revision 2026-10-29b; Task 39): the link is gone and the API refuses it.
 * - The seller never cancels alone: Propose cancel / Withdraw (mutual cancel); the buyer gets an
 *   accept/decline card, and Accept is `accept-cancel` then `escrow.proposeCancelSign()`.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatXmr } from '@x2f/trade';
import { ApiCallError } from '../../api/client.js';
import { getTrade } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { MethodExplainer } from '../../ui/MethodExplainer.js';
import { Sheet } from '../../ui/Sheet.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { CancelFinalSheet } from './CancelFinalSheet.js';
import { CancelProposalCard, SellerCancelControls } from './CancelSheet.js';
import { setFinalAlertPaidSheet } from './FinalAlert.js';
import { errorSentence } from './SetupStatus.js';
import { deviceRate, deviceTotal, PaidFlowSheet, payBlockText, refusalText, stoppedText, type DeviceTotal } from './PaidFlowSheet.js';
import { buyerCancelMode, escrowChip, finishBlock, payBlock, paySecured, payTimer, showProposal, type EscrowChip } from './payModel.js';
import { GIFT_CARD_WARNING, payMethodOf, postPayEvent, usePaymentDetails, useTradeChat, type MethodInfo, type PayEvent } from './paySeams.js';
import { publicName, type TradeEscrow, type TradeScreenProps, type TradeView } from './payTypes.js';
import { MEMBER_TRADE_COPY } from '../settings/teamCopy.js';
import { focusChatPane, registerTradeScreen, useChatPane, type MemberScreenProps, type TradeSlot } from './TradeRoom.js';
import { CounterpartyCard, Name, TradeTimeline } from './TradeTimeline.js';
import './pay.css';

/**
 * Task 23's trade-room slots (Task 22's slot interface, TradeRoom.tsx), registered at import
 * (screens.ts imports this file). Task 23 also takes `paid` for the buyer ("Marked as paid", Finish);
 * both extra slots are in TradeRoom.tsx's ownership list and docs/coordination.md.
 */
export const TASK23_SLOTS: readonly TradeSlot[] = [
  { owner: 'Task 23', role: 'buyer', states: ['securing', 'secured', 'paid'], screen: BuyerPay },
  { owner: 'Task 23', role: 'seller', states: ['secured'], screen: SellerWaiting, forMembers: SellerWaitingMember },
  // After the buyer's cancel or an accepted mutual cancel the BUYER builds the refund (policy.ts
  // ROUTE), and only from a tapped intent: this screen keeps it in view (review I4; the release is
  // Task 24's).
  { owner: 'Task 23', role: 'buyer', states: ['settling'], when: (v) => v.settling === 'buyer-cancel' || v.settling === 'mutual-cancel', screen: BuyerCancelling },
];

const REFUSALS: Record<string, string> = {
  'too-late': "It's too late for that now.",
  // not-a-refusal: the trade state machine (see NOT_REFUSAL_CODES)
  'wrong-state': "The trade has moved on. It can't do that now.",
  'trading-paused': 'Trading is paused for maintenance. Try again soon.',
  'not-releasable': 'The escrow is not unlocked yet. Try again in a few minutes.',
};

/** A refusal as one plain sentence (never the raw code). */
function apiRefusalText(e: unknown): string {
  if (e instanceof ApiCallError) return REFUSALS[e.code] ?? "That didn't go through. Try again.";
  return "That didn't go through. Check your connection and try again.";
}

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
        await postPayEvent(p.view.code, e);
      } catch (err) {
        setError(apiRefusalText(err));
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

/**
 * A help tip (BuyerPay board): a mouse shows it on hover; a tap or click opens it (never toggles,
 * so a phone's emulated hover before the click cannot shut it again), and a tap outside, Escape
 * or leaving the trigger by keyboard closes it (review Minor 2).
 */
function useTip() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return {
    open,
    trigger: {
      ref: (el: HTMLElement | null) => {
        ref.current = el;
      },
      onPointerEnter: (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse') setOpen(true);
      },
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse') setOpen(false);
      },
      onClick: () => setOpen(true),
      onBlur: () => setOpen(false),
    },
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
    <section aria-label="Payment timer" className="x2f-card x2f-pay-timer" data-fold-glance="timer">
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

/**
 * Owner Q12: before the escrow is secured the seller's details are a locked card (board BuyerPay,
 * escrow=securing), and they are not even asked for; from `secured` on, "Send exactly".
 */
function PaymentCard(p: { view: TradeView; method: MethodInfo; total: DeviceTotal | null; rate: string | null }) {
  if (paySecured(p.view)) return <SendExactlyCard {...p} />;
  const etaMin = escrowChip(p.view)?.bar?.etaMin ?? null;
  return (
    <section aria-label="Payment details" className="x2f-card x2f-pay-card" data-fold-glance="pay" data-locked="">
      <div className="x2f-pay-card__locked">
        <span className="x2f-pay-card__lock" data-lock-tile="" aria-hidden="true">
          <Icon name="lock" size={20} stroke={1.75} />
        </span>
        <span className="x2f-pay-card__locked-text">
          <h2 className="x2f-pay-card__title">Payment details</h2>
          {/* COPY-UNSIGNED: the no-minutes line is not on the board (the ETA is always known while securing). */}
          <span className="x2f-pay-card__note">
            {etaMin === null ? (
              'They appear when the escrow is secured.'
            ) : (
              <>
                They appear when the escrow is secured, in about <span className="x2f-mono">{etaMin}</span> min.
              </>
            )}
          </span>
        </span>
      </div>
    </section>
  );
}

/** "Send exactly": the total, the seller's details for the method, the memo, (desktop) the rate, and the own-name warning. */
function SendExactlyCard({ view, method, total, rate }: { view: TradeView; method: MethodInfo; total: DeviceTotal | null; rate: string | null }) {
  const details = usePaymentDetails(view.code);
  const rows: { label: string; value: string }[] = details ?? [{ label: `${method.name} to`, value: 'Ask in the chat' }];
  return (
    <section aria-label="Send this payment" className="x2f-card x2f-pay-card" data-fold-glance="pay">
      <h2 className="x2f-pay-card__title">Send exactly</h2>
      {total ? (
        <span className="x2f-pay-card__total">
          {total.text} <span className="x2f-pay-card__currency">{total.currency}</span>
        </span>
      ) : (
        <span className="x2f-pay-card__total" data-no-total="">
          No total yet
        </span>
      )}
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
        {rate !== null ? (
          <div className="x2f-pay-card__row">
            <span className="x2f-ink-muted">Rate</span>
            <span className="x2f-mono x2f-pay-card__value">{rate}</span>
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
  // With the room's chat pane showing (Task 40), the chat is already beside the screen: the sheet
  // closes on unfold (one draft, one composer), and the primary Chat moves the focus there.
  const paned = useChatPane(view);
  useEffect(() => {
    if (!paned || !open) return;
    setOpen(false);
    // The sheet already closed (`open && !paned`) and handed the focus back to the header Chat,
    // hidden now under [data-chat-link]: give it to the pane's composer, which holds the same
    // draft, once the pane is laid out (round-2 review m4).
    requestAnimationFrame(() => focusChatPane());
  }, [paned, open]);
  const onChat = () => (paned ? focusChatPane() : setOpen(true));
  return (
    <>
      {primary ? (
        <Button variant="primary" onClick={onChat}>
          Chat
        </Button>
      ) : (
        <button type="button" className="x2f-room__chat" onClick={onChat} data-chat-link="">
          Chat
        </button>
      )}
      <Sheet open={open && !paned} title={`Chat with ${publicName(view.counterparty)}`} onClose={() => setOpen(false)}>
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

/**
 * "Trade grew to … XMR, you now pay …" (Revision 2026-10-21; review Minor 1): whenever the view
 * says the trade grew, in this device's own figures (none without them), so a buyer who copied
 * the old total into a bank app sees the change before ticking the new sentence.
 */
function GrownNote({ view, escrow, children }: { view: TradeView; escrow: Pick<TradeEscrow, 'amountAtomic' | 'fiatCents' | 'deal'>; children: ReactNode }) {
  const total = deviceTotal(view, escrow);
  if (view.grown === null || escrow.amountAtomic === null || total === null) return null;
  return (
    <p className="x2f-room__grown" role="status" data-grown="">
      Trade grew to {formatXmr(escrow.amountAtomic)} XMR, {children} {total.text}
    </p>
  );
}

/** Focuses the composer of the chat beside the wide room, if one is installed. */
function focusAsideChat(from: HTMLElement): void {
  from.closest('.x2f-room')?.querySelector<HTMLElement>('.x2f-room__chat-panel :is(input, textarea, [contenteditable="true"])')?.focus();
}


export function BuyerPay(p: TradeScreenProps) {
  const { view, escrow, serverClock, wide } = p;
  const method = payMethodOf(view);
  const chip = escrowChip(view);
  const action = useTradeAction(p);
  const [paySheet, setPaySheet] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const cancelMode = buyerCancelMode(view);
  const paid = view.state === 'paid';
  const total = deviceTotal(view, escrow);
  const block = payBlock(view, escrow);
  // Paid on the server, but this device never recorded the tap (a reload, another tab, a lost
  // answer, a refused markPaid): the runtime says `amount-unknown` (review I2). While the view
  // disagrees with the deal the runtime says `view-mismatch` instead (it reads nothing more from
  // that view): Finish is still shown, refused, so the buyer is told not to pay again (round 2, I1).
  const needsFinish = paid && !escrow.paidRecorded && (escrow.refusal === 'amount-unknown' || escrow.refusal === 'view-mismatch');
  const finishBlocked = finishBlock(view, escrow);
  const finishOk = finishBlocked === null;
  // Owner Q12: no "I've paid" before the escrow is secured (`not-secured`), so no warning in front of it.
  const payWhenId = useId();
  // Owner G56: the buyer's cancel asks once, "Cancelling is final".
  const [cancelSheet, setCancelSheet] = useState(false);
  const onIvePaid = () => {
    if (block !== null) return;
    setPaySheet(true);
  };

  const finish = async () => {
    if (!finishOk || finishing || escrow.fiatCents === null) return;
    setFinishing(true);
    setFinishError(null);
    try {
      await escrow.markPaid(escrow.fiatCents);
    } catch {
      setFinishError("Your device couldn't record it. Try again.");
    } finally {
      setFinishing(false);
    }
  };

  const onCancel = async () => {
    // The cancel (after its confirm sheet) trusts no view up to POLL_MS old: "I've paid" may have landed meanwhile
    // (another tab, or a mark-paid whose answer was lost), and then there is no cancel (review
    // Minor 4; Revision 2026-10-29b). The API refuses it in `paid` too.
    const fresh = await getTrade(view.code).catch(() => null);
    if (fresh === null) return action.setError("Couldn't check the trade. Check your connection and try again.");
    if (buyerCancelMode(fresh) === 'none') return void p.refresh();
    await action.run({ type: 'buyer-cancel' }, () => escrow.buyerCancel(), "Couldn't start the refund. Try again.");
  };

  // Owner Q12: before secured the reason is the button's muted caption (board BuyerPay, pay-when).
  const primary = !paid && block === 'not-secured' ? (
    <div className="x2f-pay__primary">
      <Button variant="primary" disabled aria-describedby={payWhenId} onClick={onIvePaid}>
        I've paid
      </Button>
      <p id={payWhenId} className="x2f-pay__caption" data-pay-block="not-secured">
        {payBlockText(block, escrow)}
      </p>
    </div>
  ) : !paid ? (
    <Button variant="primary" disabled={block !== null} onClick={onIvePaid}>
      I've paid
    </Button>
  ) : needsFinish ? (
    <Button variant="primary" disabled={!finishOk || finishing} aria-busy={finishing || undefined} onClick={() => void finish()}>
      Finish marking as paid
    </Button>
  ) : (
    <Button variant="primary" disabled aria-live="polite">
      {escrow.paidRecorded ? 'Marked as paid' : 'Marking as paid…'}
    </Button>
  );
  const cancel =
    cancelMode === 'none' ? null : (
      <Button variant="quiet" disabled={action.busy} onClick={() => setCancelSheet(true)}>
        Cancel trade
      </Button>
    );
  // The buyer's dispute in paid opens at confirmBy (machine.ts: too-early before it; review Minor 7).
  const disputeWait = paid && view.confirmBy !== null && serverClock().getTime() < Date.parse(view.confirmBy);
  const dispute = disputeWait ? (
    <span className="x2f-room__dispute-wait">
      Dispute opens in <Countdown deadline={view.confirmBy!} serverClock={serverClock} format="minutes" />
    </span>
  ) : (
    <Link to={`/trade/${encodeURIComponent(view.code)}/dispute`} className="x2f-button x2f-button--danger">
      Open dispute
    </Link>
  );
  const refusal = refusalText(escrow.refusal);
  const notices = (
    <>
      {!paid ? (
        <GrownNote view={view} escrow={escrow}>
          you now pay
        </GrownNote>
      ) : null}
      {showProposal(view) ? (
        <CancelProposalCard view={view} busy={action.busy} onAccept={() => void action.run({ type: 'accept-cancel' }, () => escrow.proposeCancelSign())} />
      ) : null}
      {escrow.error !== null ? (
        <div className="x2f-room__error" role="alert" data-pay-block="escrow-stopped">
          <p>{stoppedText(escrow)}</p>
          {escrow.retryable ? (
            <Button variant="secondary" onClick={() => escrow.retry()}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : !paid && block !== null && block !== 'not-secured' && !(block === 'escrow-refused' && refusal !== null) ? (
        <p className="x2f-room__error" role="status" data-pay-block={block}>
          {payBlockText(block, escrow)}
        </p>
      ) : null}
      {needsFinish ? (
        <p className="x2f-room__error" role="alert" data-paid-unrecorded="">
          Your device hasn't recorded your payment. Tap to finish.
          {finishOk
            ? null
            : finishBlocked === 'escrow-refused'
              // not-a-refusal: an escrow safety check on this device (view-mismatch)
              ? " The trade's details on the server don't match what you agreed to, so your device can't record it yet. Don't pay again. Open a dispute if this doesn't clear."
              : " Your device can't confirm the total the trade shows. Don't pay again. Ask in the chat, or open a dispute if it doesn't clear."}
          {finishError !== null ? ` ${finishError}` : null}
        </p>
      ) : refusal !== null && escrow.error === null ? (
        <p className="x2f-room__error" role="status" data-escrow-refusal={escrow.refusal ?? undefined}>
          {refusal}
        </p>
      ) : null}
      {action.error !== null ? (
        <p className="x2f-room__error" role="alert">
          {action.error}
        </p>
      ) : null}
    </>
  );
  const sheets = (
    <>
      <PaidFlowSheet view={view} escrow={escrow} refresh={p.refresh} open={paySheet && !paid} onClose={() => setPaySheet(false)} />
      <CancelFinalSheet
        open={cancelSheet && cancelMode !== 'none'}
        view={view}
        busy={action.busy}
        onKeep={() => setCancelSheet(false)}
        onCancel={() => {
          setCancelSheet(false);
          void onCancel();
        }}
      />
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
            <PaymentCard view={view} method={method} total={total} rate={deviceRate(escrow)} />
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
        <PaymentCard view={view} method={method} total={total} rate={null} />
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

// ---- The buyer's room while the cancel's refund is built ----

/**
 * The buyer in `settling` after `buyer-cancel` or `mutual-cancel` (review I4): the buyer's device
 * builds the refund to the seller, so it says to keep the page open, and it offers Try again
 * while nothing is being signed. Try again calls only the escrow (`buyerCancel()` or
 * `proposeCancelSign()`, or `retry()` for a stopped escrow), never a second POST: the API already
 * moved the trade on.
 */
export function BuyerCancelling(p: TradeScreenProps) {
  const { view, escrow, serverClock, wide } = p;
  const method = payMethodOf(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = escrow.phase === 'done' || escrow.phase === 'settled-without-device';
  const stopped = escrow.error !== null;
  // Try again only while nothing is being signed AND the tap this refund needs is not saved on
  // this device (it never got saved, or another one is). A saved tap of this kind only waits (the
  // coins unlock up to about 20 min after funding): no Try again then (round 2, Minor 1).
  const saved = escrow.intentKind !== null && escrow.intentKind === view.settling;
  const canRetry = !done && (stopped ? escrow.retryable : escrow.phase === 'ready' && !saved);
  // A refusal (the attempts ran out, or the server's view drifted) is said under the card with its
  // next step, so the room never just says "Keep this page open" forever (round-3 review, Minor 1).
  const refusal = done || stopped ? null : refusalText(escrow.refusal);

  const again = async () => {
    if (busy) return;
    if (stopped) {
      escrow.retry();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (view.settling === 'mutual-cancel' ? escrow.proposeCancelSign() : escrow.buyerCancel());
    } catch {
      setError("Couldn't start the refund. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const title = (
    <>
      Cancelling with <Name view={view} />
    </>
  );
  const body = (
    <>
      <section aria-label="Refund" className="x2f-card x2f-wait">
        {done ? (
          <p className="x2f-wait__title">
            The XMR is on its way back to <Name view={view} />.
          </p>
        ) : (
          <p className="x2f-wait__title">
            Returning the XMR to <Name view={view} />. Keep this page open.
          </p>
        )}
      </section>
      {stopped ? (
        <p className="x2f-room__error" role="alert" data-pay-block="escrow-stopped">
          {errorSentence(escrow) ?? 'The escrow stopped on this device.'}
        </p>
      ) : null}
      {refusal !== null ? (
        <p className="x2f-room__error" role="status" data-escrow-refusal={escrow.refusal ?? undefined}>
          {refusal}
        </p>
      ) : null}
      {error !== null ? (
        <p className="x2f-room__error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
  const primary = canRetry ? (
    <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void again()}>
      Try again
    </Button>
  ) : (
    <Button variant="primary" disabled aria-live="polite">
      {done ? 'Refund sent' : 'Returning the XMR…'}
    </Button>
  );

  if (wide) {
    return (
      <WideRoom view={view} method={method} title={title} chip={null}>
        <TradeTimeline view={view} serverClock={serverClock} />
        {body}
        <div className="x2f-room__actions">{primary}</div>
      </WideRoom>
    );
  }
  return (
    <div className="x2f-pay" data-layout="phone">
      <TradeHeader title={title} code={view.code} method={method} backTo="/trades" action={<ChatButton view={view} />} />
      <div className="x2f-pay__main">{body}</div>
      <footer className="x2f-pay__footer">{primary}</footer>
    </div>
  );
}

// ---- The seller's room while the buyer pays ----

/** The seller in `secured` (before payBy; SellerRefund takes over after it, Task 25): wait, chat, or propose a mutual cancel. */
export function SellerWaiting(p: TradeScreenProps) {
  const { view, escrow, serverClock, wide } = p;
  const method = payMethodOf(view);
  const chip = escrowChip(view);
  const action = useTradeAction(p);
  const total = deviceTotal(view, escrow);
  const chatInstalled = useTradeChat() !== null;
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
      {total ? (
        <span className="x2f-pay-card__total">
          {total.text} <span className="x2f-pay-card__currency">{total.currency}</span>
        </span>
      ) : null}
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
        <GrownNote view={view} escrow={escrow}>
          <Name view={view} /> now pays
        </GrownNote>
        {waiting}
        {error}
        <div className="x2f-room__actions">
          {/* The chat is already beside the room: Chat goes there, never a second panel (review Minor 5).
              Until Task 20 installs its panel (setTradeChat) there is nothing to go to: disabled, and says so (round 2, Minor 3). */}
          {chatInstalled ? (
            <Button variant="primary" onClick={(e) => focusAsideChat(e.currentTarget)}>
              Chat
            </Button>
          ) : (
            <>
              <Button variant="primary" disabled aria-describedby="x2f-room-chat-hint">
                Chat
              </Button>
              <span id="x2f-room-chat-hint" className="x2f-room__hint">
                {/* not-a-refusal: a feature not built yet (Plan 3 Task 20) */}
                Chat isn't available here yet.
              </span>
            </>
          )}
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
        <GrownNote view={view} escrow={escrow}>
          <Name view={view} /> now pays
        </GrownNote>
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

/**
 * SellerWaiting on a team member's device (Plan 2 Task 18 review round 2, n3): no escrow there, so
 * no device total, escrow status or chat; the waiting card, the owner's-device notice, and Propose
 * cancel / Withdraw (a mutual cancel only records a choice; if the buyer accepts, the account
 * owner's device co-signs the refund). Kit parts only (NEEDS_DESIGN_TEAM).
 */
export function SellerWaitingMember({ code, view, refresh, serverClock }: MemberScreenProps) {
  const method = payMethodOf(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (type: 'propose-cancel' | 'withdraw-cancel') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await postPayEvent(code, { type });
      await refresh();
    } catch (err) {
      setError(apiRefusalText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="x2f-pay" data-layout="phone" data-member-screen="">
      <TradeHeader
        title={
          <>
            Selling to <Name view={view} />
          </>
        }
        code={view.code}
        method={method}
        backTo="/trades"
      />
      <div className="x2f-pay__main">
        <section aria-label="Waiting for payment" className="x2f-card x2f-wait">
          <p className="x2f-wait__title">
            Waiting for <Name view={view} /> to pay
          </p>
          {view.payBy !== null ? (
            <span className="x2f-wait__left">
              Time to pay <Countdown deadline={view.payBy} serverClock={serverClock} format="minutes" />
            </span>
          ) : null}
        </section>
        <p className="x2f-room__hint" data-part="member-waiting">
          {MEMBER_TRADE_COPY.roomWaiting}
        </p>
        {error !== null ? (
          <p className="x2f-room__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="x2f-pay__footer">
        <div className="x2f-pay__footer-row">
          <SellerCancelControls view={view} busy={busy} onPropose={() => void run('propose-cancel')} onWithdraw={() => void run('withdraw-cancel')} />
        </div>
      </footer>
    </div>
  );
}

for (const slot of TASK23_SLOTS) registerTradeScreen(slot);
// Task 25's FinalAlert: its I've paid is this same paid step (refund-tripwires NEEDS_TASK_23).
setFinalAlertPaidSheet(PaidFlowSheet);
