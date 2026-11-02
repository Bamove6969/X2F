/**
 * The trade at a glance (Plan 3 Task 40; Fold-Tabletop's top half, Fold-Cover's card): who, the
 * code and method, the trade's status, the time left and the amount. On a tabletop it is
 * information only: no link, button or input, because every control sits in the bottom half. The
 * flip cover screen takes no trade actions either; its one button is Fold-Cover's "Open on main
 * screen". Sums are this device's own figures (the escrow's), never the API's (Task 23 review I1);
 * without them the amount is left out. What it says about the escrow is this device's too: a
 * stopped escrow or a refusal shows its warning, and the API's escrow chip is never shown here
 * (Task 40 review I1). The status pill comes from the trade's state and the viewer's role only
 * (Fold-Tabletop and Fold-Cover boards), and it is left out while there is a warning, so "Pay now"
 * never stands beside "Don't send any money". The room never hands the glance a trade that failed
 * its integrity check: the screen's own alert shows instead, in every layout.
 *
 * The warning follows the screens (round-2 review m2): nothing once this device is done
 * (`done` or `settled-without-device`, as BuyerCancelling), and each role's own sentences: the
 * buyer's from PaidFlowSheet ("Don't send any money"), the seller's from the release screens
 * (release/view.ts `refusalCopy`, SetupStatus's `errorSentence`). It is a visual summary with no
 * live region: the screen's own notice is the one announcement (round-2 review m1). The one live
 * region is the cover's answer to its own button.
 *
 * On a tabletop the screen in the bottom half leaves out what the glance shows (its header, the
 * payment timer and the "Send exactly" card carry `data-fold-glance`, styles/fold.css), so nothing
 * is shown twice and the screen's controls fit the bottom half.
 */
import { useState } from 'react';
import { formatXmr } from '@x2f/trade';
import { publicName, type TradeView } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import type { IconName } from '../../ui/icons.js';
import { StatusChip, type Tone } from '../../ui/StatusChip.js';
import { deviceTotal, payBlockText, refusalText, stoppedText, type DeviceTotal } from './PaidFlowSheet.js';
import { payBlock, payTimer } from './payModel.js';
import { GIFT_CARD_WARNING, payMethodOf, usePaymentDetails, type MethodInfo } from './paySeams.js';
import type { TradeScreenProps } from './payTypes.js';
import { refusalCopy } from './release/view.js';
import { errorSentence } from './SetupStatus.js';
import { Name } from './TradeTimeline.js';

/**
 * What the glance warns about, in the viewer's role's words, or null (nothing to say, or done).
 * For the buyer before "I've paid" it is the pay screen's own gate (payModel.ts `payBlock`, review
 * 2026-11-01 I1): while the escrow is still checking, the device has no amount or the totals
 * differ, the glance says not to pay, exactly as BuyerPay does, so "Pay now" and "Send exactly"
 * never show while the screen under them says "don't send any money".
 */
export function glanceWarning(
  view: Pick<TradeScreenProps['view'], 'role' | 'state' | 'paidAt' | 'fiatCents' | 'amountAtomic'> & {
    counterparty: Pick<TradeScreenProps['view']['counterparty'], 'displayName'>;
  },
  escrow: Pick<TradeScreenProps['escrow'], 'phase' | 'error' | 'retryable' | 'refusal' | 'fiatCents' | 'amountAtomic'>,
): string | null {
  if (escrow.phase === 'done' || escrow.phase === 'settled-without-device') return null;
  if (view.role === 'buyer') {
    if (glanceStep(view) === 'pay') {
      const block = payBlock(view, escrow);
      return block === null ? null : payBlockText(block, escrow);
    }
    return escrow.error !== null ? stoppedText(escrow) : refusalText(escrow.refusal);
  }
  if (escrow.error !== null) return errorSentence(escrow) ?? 'The escrow stopped on this device.';
  return escrow.refusal !== null ? refusalCopy(escrow.refusal, publicName(view.counterparty)) : null;
}

/**
 * The steps the boards draw: the buyer paying (Fold-Tabletop's default, Fold-Cover's
 * `waiting-payment`), the buyer after "I've paid" (`paid`) and a dispute (Fold-Cover's `dispute`).
 * Null for every other step: the boards have no pill or timer words for them, so the glance keeps
 * its plain "Time left".
 */
export type GlanceStep = 'pay' | 'paid' | 'dispute' | null;

export function glanceStep(view: Pick<TradeView, 'role' | 'state' | 'paidAt'>): GlanceStep {
  if (view.state === 'disputed') return 'dispute';
  if (view.role !== 'buyer') return null;
  if (view.state === 'secured' && view.paidAt === null) return 'pay';
  if (view.state === 'paid') return 'paid';
  return null;
}

export type GlanceLayout = 'tabletop' | 'cover';

/** The status pill in the board's words, or null: none for a step the boards don't draw, none beside a warning. */
export function glancePill(step: GlanceStep, layout: GlanceLayout, name: string, warning: string | null): { tone: Tone; icon: IconName; label: string } | null {
  if (warning !== null || step === null) return null;
  if (step === 'pay') return { tone: 'caution', icon: 'clock', label: layout === 'cover' ? 'Pay now' : 'Waiting for your payment' };
  if (step === 'paid') return { tone: 'escrow', icon: 'check', label: layout === 'cover' ? 'You paid' : `Paid · waiting for ${name}` };
  // Fold-Tabletop has no dispute state; Fold-Cover's is "Dispute open".
  return layout === 'cover' ? { tone: 'danger', icon: 'alert', label: 'Dispute open' } : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "31 Oct 2026, 14:05 UTC" (CONVENTIONS dates), or null for a date that doesn't parse. */
export function utcDateTime(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export interface GlanceTimer {
  label: string;
  deadline: string;
  note: string | null;
  /** Fold-Cover's "62 min left". */
  left: boolean;
}

/** The timer the glance shows: its label, the deadline it counts to and the line under it; null for none. */
export function glanceTimer(
  view: Pick<TradeView, 'payBy' | 'confirmBy' | 'nextDeadline' | 'pausedAt' | 'extensions' | 'releasableEtaMin' | 'counterparty'>,
  step: GlanceStep,
  layout: GlanceLayout,
  method: string,
  warning: string | null,
  nowMs: number,
): GlanceTimer | null {
  if (view.pausedAt !== null) return null;
  if (step === 'pay' && view.payBy !== null) {
    if (layout === 'cover') {
      // "Send by Zelle, then tap I've paid" tells the buyer to pay: never beside a warning.
      return { label: 'Time to pay', deadline: view.payBy, note: warning === null ? `Send by ${method}, then tap I've paid` : null, left: true };
    }
    const ends = utcDateTime(view.payBy);
    return { label: 'Time to pay', deadline: view.payBy, note: `of ${payTimer(view, nowMs).totalMin} min${ends ? ` · ends ${ends}` : ''}`, left: false };
  }
  if (step === 'paid' && view.confirmBy !== null) {
    // On the tabletop this is Fold-Cover's line (COPY-UNSIGNED there): Fold-Tabletop's "… checks
    // their bank, then releases your XMR. Zelle trades get 2 hours." names a bank and one method's hours.
    return { label: 'Seller confirms within', deadline: view.confirmBy, note: `Left for ${publicName(view.counterparty)} to check and release`, left: false };
  }
  if (step === 'dispute' || view.nextDeadline === null) return null;
  // COPY-UNSIGNED
  return { label: 'Time left', deadline: view.nextDeadline, note: null, left: false };
}

export function TradeGlance({ view, escrow, serverClock, layout }: Pick<TradeScreenProps, 'view' | 'escrow' | 'serverClock'> & { layout: GlanceLayout }) {
  const cover = layout === 'cover';
  const warning = glanceWarning(view, escrow);
  const total = deviceTotal(view, escrow);
  const method = payMethodOf(view);
  const step = glanceStep(view);
  const pill = glancePill(step, layout, publicName(view.counterparty), warning);
  const timer = glanceTimer(view, step, layout, method.name, warning, serverClock().getTime());
  const chip = pill ? <StatusChip tone={pill.tone} icon={pill.icon} label={pill.label} /> : null;
  // Fold-Tabletop's "Send exactly" and "Memo" (before and after "I've paid"): the buyer only, with
  // this device's own total, and never beside a warning.
  const pay = !cover && (step === 'pay' || step === 'paid') && warning === null && total !== null;
  return (
    <div className="x2f-fold-glance" data-cover={cover || undefined} data-step={step ?? undefined}>
      {cover ? (
        <div className="x2f-fold-glance__top">
          {/* Fold-Cover's "X2F · +2 more trades": the count of the other trades needs the API (not built). */}
          <span className="x2f-trade-label">X2F</span>
          {chip}
        </div>
      ) : null}
      <div className="x2f-fold-glance__head">
        <div className="x2f-trade-intro">
          <p className="x2f-trade-title">
            {view.role === 'buyer' ? 'Buying from' : 'Selling to'} <Name view={view} />
          </p>
          {cover ? null : (
            <span className="x2f-muted">
              Trade {view.code} · {method.name}
            </span>
          )}
        </div>
        {cover ? null : chip}
      </div>
      {warning !== null ? (
        <p className="x2f-fold-glance__fact" data-glance-warning="">
          {warning}
        </p>
      ) : null}
      <div className="x2f-fold-glance__facts">
        {timer ? (
          <p className="x2f-fold-glance__fact" data-glance-timer="">
            {/* The cover drops the label only for Fold-Cover's "62 min left" (review N2). */}
            {cover && timer.left ? null : <span className="x2f-trade-label">{timer.label}</span>}
            <span className="x2f-mono">
              <Countdown deadline={timer.deadline} serverClock={serverClock} format="minutes" />
              {timer.left ? ' left' : null}
            </span>
            {timer.note !== null ? <span className="x2f-muted">{timer.note}</span> : null}
          </p>
        ) : null}
        {pay ? (
          <PayFacts view={view} method={method} total={total} xmr={escrow.amountAtomic} />
        ) : total ? (
          <p className="x2f-fold-glance__fact" data-glance-amount="">
            {/* COPY-UNSIGNED */}
            {cover ? null : <span className="x2f-trade-label">Amount</span>}
            <span className="x2f-mono">
              {total.text} {total.currency}
            </span>
            {escrow.amountAtomic !== null ? <span className="x2f-mono x2f-muted">{formatXmr(escrow.amountAtomic)} XMR</span> : null}
          </p>
        ) : null}
      </div>
      {cover ? <OpenOnMain /> : null}
    </div>
  );
}

/**
 * Fold-Tabletop's "Send exactly" and "Memo": the buyer's payment, read at a glance. It hides the
 * pay screen's PaymentCard in the bottom half (styles/fold.css), so it carries that card's safety
 * lines too (review 2026-11-01 I2): pay from an account in your own name and, for a gift-card
 * method, the gift-card warning. Information only: no control.
 */
function PayFacts({ view, method, total, xmr }: { view: TradeView; method: MethodInfo; total: DeviceTotal; xmr: bigint | null }) {
  const details = usePaymentDetails(view.code);
  return (
    <>
      <p className="x2f-fold-glance__fact" data-glance-pay="">
        <span className="x2f-trade-label">Send exactly</span>
        <span className="x2f-mono">{total.text}</span>
        <span className="x2f-muted">
          {total.currency} by {method.name}
          {xmr !== null ? (
            <>
              {' '}
              for <span className="x2f-mono">{formatXmr(xmr)} XMR</span>
            </>
          ) : null}
        </span>
        {(details ?? []).map((d) => (
          <span key={d.label} className="x2f-muted">
            {d.label} <span className="x2f-mono">{d.value}</span>
          </span>
        ))}
      </p>
      <p className="x2f-fold-glance__fact" data-glance-memo="">
        <span className="x2f-trade-label">Memo</span>
        <span className="x2f-mono">{view.code}</span>
        <span className="x2f-muted">
          Put this in the {method.name} memo so <Name view={view} /> can match your payment.
        </span>
      </p>
      <p className="x2f-fold-glance__fact x2f-muted" data-glance-own-name="">
        Pay from an account in your own name. Payments from someone else's account may be rejected or frozen. Use at your own risk.
      </p>
      {method.giftCard ? (
        <p className="x2f-giftcard x2f-fold-glance__fact" data-tone="danger">
          <strong>{GIFT_CARD_WARNING}</strong>
        </p>
      ) : null}
    </>
  );
}

/** Fold-Cover's one button. The trade carries on on the main screen; the room stays under the card. */
function OpenOnMain() {
  const [asked, setAsked] = useState(false);
  return (
    <div className="x2f-fold-glance__open">
      <Button variant="secondary" onClick={() => setAsked(true)}>
        Open on main screen
      </Button>
      <span role="status">{asked ? 'Open your phone to keep going.' : null}</span>
    </div>
  );
}
