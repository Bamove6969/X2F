/**
 * The whole "I've paid" step, for BuyerPay and for Task 25's FinalAlert (`setFinalAlertPaidSheet`):
 * the sum is this device's own (`escrow.fiatCents`, Task 12), never the API's (review 2026-10-27,
 * I1); Yes posts `mark-paid { fiatCents }` with exactly that total, then `escrow.markPaid` (the
 * `trade.paid` signal). A `total-changed` refusal sends nothing: the trade is re-read and the sheet
 * asks again with the new total. A `wrong-state` (the trade moved on, or an earlier `mark-paid`
 * landed and its answer was lost) closes the sheet and re-reads; if the trade is now paid and this
 * device never recorded it, BuyerPay offers "Finish marking as paid" (review I2).
 */
import { useEffect, useRef, useState } from 'react';
import { formatFiat, formatXmr } from '@x2f/trade';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { confirmSkipped, skipConfirm } from './confirmSkip.js';
import { PaidConfirmSheet, type YesResult } from './PaidConfirmSheet.js';
import { payBlock, type PayBlock } from './payModel.js';
import { payMethodOf, postPayEvent } from './paySeams.js';
import type { TradeEscrow, TradeView } from './payTypes.js';
import { errorSentence } from './SetupStatus.js';

/** The parts of the room's escrow handle the paid step reads. */
export type PaidFlowEscrow = Pick<TradeEscrow, 'phase' | 'error' | 'retryable' | 'refusal' | 'fiatCents' | 'amountAtomic' | 'deal' | 'markPaid'>;

/** The sum to pay as THIS device works it out (Task 12's `escrow.fiatCents`); null when the device has none. */
export interface DeviceTotal {
  cents: bigint;
  text: string;
  currency: string;
}

export function deviceTotal(view: Pick<TradeView, 'lockedRate'>, escrow: Pick<TradeEscrow, 'fiatCents' | 'deal'>): DeviceTotal | null {
  if (escrow.fiatCents === null) return null;
  const currency = escrow.deal?.currency ?? view.lockedRate.currency;
  return { cents: escrow.fiatCents, text: formatFiat(escrow.fiatCents, currency), currency };
}

/** The locked rate from the deal this device stored ("$330.00 / XMR"), or null before it has one. */
export function deviceRate(escrow: Pick<TradeEscrow, 'deal'>): string | null {
  return escrow.deal ? `${formatFiat(escrow.deal.centsPerXmr, escrow.deal.currency)} / XMR` : null;
}

/** A stopped escrow, in words (Task 22's sentences). */
export function stoppedText(escrow: Pick<TradeEscrow, 'error' | 'retryable'>): string {
  return `${errorSentence(escrow) ?? 'The escrow stopped on this device.'} Don't send any money until it runs again.`;
}

/**
 * The escrow's refusals that block paying, in words (review I2: shown, never silent; round 2, I1).
 * `amount-out-of-range` is the "no total" note before paid; `amount-unknown` is the Finish card;
 * the seller-only ones never reach the buyer, and get the general sentence if they ever do.
 */
export function refusalText(r: TradeEscrow['refusal']): string | null {
  switch (r) {
    case null:
    case 'amount-out-of-range':
    case 'amount-unknown':
      return null;
    case 'amount-changed':
      return "The trade's amount changed on the server after you paid. Your device settles only the amount you paid. Open a dispute if this doesn't clear.";
    case 'view-mismatch':
      return "The trade's details on the server don't match what you agreed to. Don't send any money. Open a dispute if this doesn't clear.";
    case 'attempts-exhausted':
      return "Your device couldn't settle this trade. Open a dispute.";
    default:
      return "Your device can't settle this trade as the server shows it. Don't send any money. Open a dispute if this doesn't clear.";
  }
}

/** Why I've paid waits, in words (payModel.ts `payBlock`). */
export function payBlockText(b: PayBlock, escrow: Pick<TradeEscrow, 'error' | 'retryable' | 'refusal'>): string {
  switch (b) {
    case 'escrow-stopped':
      return stoppedText(escrow);
    case 'escrow-refused':
      return refusalText(escrow.refusal) ?? "Your device can't settle this trade as the server shows it. Don't send any money.";
    case 'not-secured':
      // Board BuyerPay (escrow=securing), owner Q12.
      return 'Opens once the escrow is secured.';
    case 'escrow-not-ready':
      return "Your device is still checking the escrow. Keep this page open, and don't send any money yet.";
    case 'no-amount':
      return "Your device can't confirm the trade amount. Don't send any money yet. Ask in the chat, or open a dispute if it doesn't clear.";
    case 'amount-differs':
      return "Your device is checking the new total. Don't send any money yet.";
    case 'total-wrong':
      return "The trade's total on the server doesn't match your trade. Don't send any money. Ask in the chat, or open a dispute if it doesn't clear.";
  }
}

const REFUSALS: Record<string, string> = {
  'too-late': "It's too late for that now.",
  // not-a-refusal: the trade state machine (see NOT_REFUSAL_CODES)
  'wrong-state': "The trade has moved on. It can't do that now.",
  'trading-paused': 'Trading is paused for maintenance. Try again soon.',
};

export interface PaidFlowSheetProps {
  view: TradeView;
  escrow: PaidFlowEscrow;
  refresh(): Promise<void>;
  open: boolean;
  onClose(): void;
}

export function PaidFlowSheet({ view, escrow, refresh, open, onClose }: PaidFlowSheetProps) {
  const [grew, setGrew] = useState(false);
  /**
   * Owner p7-2: this user ticked "Do not show me this warning again", so an opening marks paid at
   * once with this device's total ('direct'); anything but a clean yes ('ask') shows the sheet.
   * Only this "Are you sure…?" step can be skipped. The no-proof warning ("Mark paid without
   * proof?", ProofBlur, not built yet) goes BEFORE this point and is always shown (lead, 8 Nov):
   * when it lands, an opening without proof shows it first and only its answer may lead here.
   */
  const [direct, setDirect] = useState<'idle' | 'running' | 'ask'>('idle');
  const total = deviceTotal(view, escrow);
  const block = payBlock(view, escrow);
  const close = () => {
    setGrew(false);
    setDirect('idle');
    onClose();
  };

  const onYes = async (fiatCents: bigint, dontShow = false): Promise<YesResult> => {
    const r = await markPaid(fiatCents);
    if (r.ok && dontShow) skipConfirm('paid');
    return r;
  };

  const yesRef = useRef(onYes);
  yesRef.current = onYes;
  useEffect(() => {
    if (!open) return setDirect('idle');
    if (direct !== 'idle' || block !== null || total === null || !confirmSkipped('paid')) return;
    setDirect('running');
    void yesRef.current(total.cents).then((r) => {
      if (!r.ok) setDirect('ask');
    });
    // Once per opening: only `open` re-runs it.
  }, [open]);

  const markPaid = async (fiatCents: bigint): Promise<YesResult> => {
    // Only the device's own total, and only while the API shows the same one.
    if (payBlock(view, escrow) !== null || escrow.fiatCents !== fiatCents) {
      return { ok: false, reason: 'error', message: "Your device can't confirm this total. Don't send any money yet." };
    }
    try {
      await postPayEvent(view.code, { type: 'mark-paid', fiatCents });
    } catch (e) {
      if (e instanceof ApiCallError && e.status === 409 && e.code === 'total-changed') {
        // The trade grew while the sheet was open: nothing is sent; re-read and ask again.
        setGrew(true);
        await refresh();
        return { ok: false, reason: 'total-changed' };
      }
      // too-early: the server has not seen the escrow secured yet (owner Q12), whatever this view said.
      if (e instanceof ApiCallError && e.status === 409 && (e.code === 'wrong-state' || e.code === 'too-early')) {
        // Moved on, or an earlier mark-paid landed and its answer was lost: re-read, and the screen for the new state takes over.
        close();
        await refresh();
        return { ok: true };
      }
      return { ok: false, reason: 'error', message: e instanceof ApiCallError ? (REFUSALS[e.code] ?? "That didn't go through. Try again.") : "That didn't go through. Check your connection and try again." };
    }
    close();
    // A refusal here leaves the trade paid on the server and not recorded on this device: the
    // runtime then reports `amount-unknown` and BuyerPay offers "Finish marking as paid".
    await escrow.markPaid(fiatCents).catch(() => undefined);
    await refresh();
    return { ok: true };
  };

  if (open && (block !== null || total === null)) {
    return (
      <Sheet open title="I've paid" onClose={close}>
        <div className="x2f-sheet__body x2f-paid">
          <p className="x2f-paid__error" role="alert" data-pay-block={block ?? 'no-amount'}>
            {payBlockText(block ?? 'no-amount', escrow)}
          </p>
          <div className="x2f-paid__actions">
            <Button variant="quiet" onClick={close}>
              Not yet
            </Button>
          </div>
        </div>
      </Sheet>
    );
  }
  return (
    <PaidConfirmSheet
      open={open && total !== null && direct !== 'running'}
      fiatCents={total?.cents ?? 0n}
      fiatText={total?.text ?? ''}
      methodName={payMethodOf(view).name}
      code={view.code}
      grewTo={grew && escrow.amountAtomic !== null ? formatXmr(escrow.amountAtomic) : null}
      onYes={onYes}
      onNotYet={close}
    />
  );
}
