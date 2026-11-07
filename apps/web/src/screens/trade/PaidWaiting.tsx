/**
 * The buyer's room after "I've paid" (board BuyerPaidWaiting.dc.html and -Wide; design review
 * 1 Nov 2026 shot 39, NEEDS_DESIGN "the after-I've-paid buyer state"): the status card says the
 * trade is paid and the seller is checking, the timer shows the seller's confirm window, "What
 * happens next" says what each side does, and the payment's details fold away under "Your
 * payment". The footer has Nudge (the API's nudge on an open trade, spec 2.4), Open dispute (the terms list)
 * (disabled with "Available from … in …" until `disputeOpensAt`: 90 min after I've paid for an
 * instant payment type, owner F9 7 Nov, but never before the server allows it), and the reminder that a paid trade can't be
 * cancelled. While trading is paused for maintenance both clocks stop at the pause (owner Q10).
 *
 * The status is the board's caution hero (chip, key mark, lead, then the timer inside it); once the
 * window ends without a release its chip reads "Paid · not confirmed in time" (the board's
 * window=ended). BuyerPay.tsx keeps the
 * escrow side: Finish marking as paid, the refusals and the stopped escrow come in as `notices`
 * and `primary`. Lines not on the board are COPY-UNSIGNED.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatXmr } from '@x2f/trade';
import { sendNudge } from '../../nudge/useNudge.js';
import { Xmr } from '../../ui/Amount.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, NUDGE_TOO_SOON, NUDGE_TOO_SOON_CODE } from '../../ui/cantDoCodes.js';
import { Countdown, Duration } from '../../ui/Countdown.js';
import { Disclosure } from '../../ui/Disclosure.js';
import { Facts, type Fact } from '../../ui/Facts.js';
import { Icon } from '../../ui/icons.js';
import { KeyMark } from '../../ui/EscrowDots.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TimerCard } from '../../ui/TimerCard.js';
import { When } from '../../ui/When.js';
import type { DeviceTotal } from './PaidFlowSheet.js';
import { usePaymentDetails, type MethodInfo } from './paySeams.js';
import { publicName, type TradeView } from './payTypes.js';
import { Name } from './TradeTimeline.js';

const MIN_MS = 60_000;
/** The server's limit between two nudges (spec 2.4), said in the "Nudge sent" line. */
const NUDGE_AGAIN_MS = 10 * MIN_MS;

/** The seller's confirm window, from the view: when it ends, how long it is, how much is left. */
export function confirmWindow(view: Pick<TradeView, 'paidAt' | 'confirmBy'>, nowMs: number): { ends: number; lengthMs: number; leftMs: number; ended: boolean } | null {
  const ends = view.confirmBy === null ? NaN : Date.parse(view.confirmBy);
  const paid = view.paidAt === null ? NaN : Date.parse(view.paidAt);
  if (!Number.isFinite(ends)) return null;
  const lengthMs = Number.isFinite(paid) ? Math.max(0, ends - paid) : 0;
  const leftMs = Math.max(0, ends - nowMs);
  return { ends, lengthMs, leftMs, ended: leftMs === 0 };
}

/**
 * The owner's rule for instant payment types (F9, 7 Nov 2026; was 60 min on 6 Nov, 30 min on 2 Nov):
 * the buyer may open a dispute 90 minutes after tapping I've paid. Slower types wait longer: the
 * server's confirmBy covers them here, and the per-type wait comes from the API once it carries it
 * (wip/second-api-cap-dispute).
 */
export const DISPUTE_AFTER_PAID_MS = 90 * MIN_MS;

/**
 * The clock the paid room counts with: the server's, stopped at `pausedAt` while trading is paused
 * for maintenance (owner Q10: the clock pauses then; lead review 2026-11-06 m2).
 */
export function roomClock(view: Pick<TradeView, 'pausedAt'>, serverClock: () => Date): { clock: () => Date; paused: boolean } {
  const at = view.pausedAt === null ? NaN : Date.parse(view.pausedAt);
  if (!Number.isFinite(at)) return { clock: serverClock, paused: false };
  return { clock: () => new Date(Math.min(at, serverClock().getTime())), paused: true };
}

/**
 * When the buyer's Open a dispute becomes available in `paid`: 90 minutes after I've paid (owner
 * F9, instant types), but never before the server allows it. The state machine refuses the buyer's dispute until
 * confirmBy, and while confirmBy is unknown (machine.ts `too-early`), so the time is the later of
 * paid + 90 min and confirmBy, and null (not offered at all) without confirmBy (review M5). The view
 * carries no dispute time of its own, so this is the client's own reckoning: it can never offer
 * the dispute before confirmBy, but a server rule that opens it later than both is not seen here.
 */
export function disputeOpensAt(view: Pick<TradeView, 'paidAt' | 'confirmBy'>): number | null {
  const server = view.confirmBy === null ? NaN : Date.parse(view.confirmBy);
  if (!Number.isFinite(server)) return null;
  const paid = view.paidAt === null ? NaN : Date.parse(view.paidAt) + DISPUTE_AFTER_PAID_MS;
  return Number.isFinite(paid) ? Math.max(paid, server) : server;
}

/** The status card, the timer, What happens next and Your payment (the board's main column). */
export function PaidWaitingBody({
  view,
  method,
  total,
  serverClock,
  chatAction,
  wide,
  actions,
}: {
  view: TradeView;
  method: MethodInfo;
  total: DeviceTotal | null;
  serverClock: () => Date;
  chatAction: ReactNode;
  wide: boolean;
  /** Wide only: the actions go right under the hero (the Wide board's order; design review P2-10). */
  actions?: ReactNode;
}) {
  const details = usePaymentDetails(view.code);
  const { clock, paused } = roomClock(view, serverClock);
  const win = confirmWindow(view, clock().getTime());
  const ended = win?.ended ?? false;
  // The window's length as a Duration ("2 h"), never in words (the duration rule; design review P1-4).
  const length = win === null || win.lengthMs === 0 ? null : <Duration ms={win.lengthMs} />;
  const xmr = <Xmr value={formatXmr(BigInt(view.amountAtomic))} />;

  // The hero (standard 11; design review P1-3): one caution card with the chip and the key mark,
  // the lead (the page's h1 stays "Buying from …"), a divider, then the timer inside it.
  const timer =
    win === null ? null : (
      <TimerCard
        label="Time left to confirm"
        part="confirm-timer"
        tone="caution"
        inset
        left={win.leftMs}
        total={win.lengthMs}
        ringLabel={
          ended
            ? 'No time left to confirm'
            : win.lengthMs > 0
              ? `${Math.ceil(win.leftMs / MIN_MS)} of ${Math.round(win.lengthMs / MIN_MS)} minutes left to confirm`
              : `${Math.ceil(win.leftMs / MIN_MS)} minutes left to confirm`
        }
        glance="timer"
        value={ended ? <Duration ms={0} /> : <Countdown deadline={new Date(win.ends)} serverClock={clock} format="minutes" />}
        hint={
          paused ? (
            // The end moves later by the pause, so no clock time is shown while paused.
            'Trading is paused for maintenance.'
          ) : (
            <>
              {length !== null ? (
                <>
                  {method.name} gets {length} ·{' '}
                </>
              ) : null}
              ends <When at={win.ends} />
            </>
          )
        }
      />
    );

  const status = (
    <section role="status" aria-labelledby="paid-title" className="x2f-hero" data-tone="caution" data-wide={wide ? '' : undefined} data-part="paid-status">
      <div className="x2f-hero__head">
        <StatusChip tone="caution" look="tint" icon="check" label={ended ? 'Paid · not confirmed in time' : 'Paid'} />
        <KeyMark className="x2f-hero__mark" />
      </div>
      <p id="paid-title" className="x2f-hero__lead">
        {ended ? (
          <>
            {length !== null ? (
              <>
                Their {length} to check {method.name} ended
              </>
            ) : (
              `Their time to check ${method.name} ended`
            )}
            {win !== null ? (
              <>
                {' at '}
                <When at={win.ends} />
              </>
            ) : null}
            . The XMR is still safe in escrow. You can open a dispute now, or keep waiting and nudge them.
          </>
        ) : (
          <>
            You marked this trade as paid
            {view.paidAt !== null ? (
              <>
                {' at '}
                <When at={view.paidAt} />
              </>
            ) : null}
            . <Name view={view} /> has been told and has{' '}
            {length !== null ? (
              <>
                up to {length}
              </>
            ) : (
              'time'
            )}{' '}
            to check {method.name} and release.
          </>
        )}
      </p>
      {timer !== null ? (
        <>
          <div className="x2f-hero__rule" aria-hidden="true" data-fold-glance="timer" />
          {timer}
        </>
      ) : null}
    </section>
  );

  const next = (
    <section className="x2f-panel" aria-labelledby="paid-next" data-part="paid-next">
      <h2 id="paid-next" className="x2f-section-title">
        What happens next
      </h2>
      <ol className="x2f-steps">
        <li>
          <Name view={view} /> checks their {method.name} for <strong>{total !== null ? total.text : 'your payment'}</strong> with the memo{' '}
          <span className="x2f-when">{view.code}</span>.
        </li>
        <li>
          {/* COPY-UNSIGNED: design's wording (7 Nov), owner still to sign. The co-sign runs in the open page (Released.tsx). */}
          When they release, {xmr} goes to your wallet once your app co-signs. Keep this page open until it arrives.
        </li>
        <li>
          {win !== null ? (
            <>
              If they don't confirm by <When at={win.ends} />, you can open a dispute.
            </>
          ) : (
            "If they don't confirm in time, you can open a dispute."
          )}{' '}
          A moderator checks the chat and proof, then decides.
        </li>
      </ol>
      {chatAction}
    </section>
  );

  const rows: Fact[] = [
    ...(details ?? []).map((d) => ({ key: d.label === `${method.name} to` ? 'Sent to' : d.label, value: d.value, mono: true })),
    { key: 'Memo', value: view.code, mono: true },
    { key: 'For', value: xmr },
    ...(view.paidAt !== null ? [{ key: 'Marked as paid', value: <When at={view.paidAt} />, mono: true }] : []),
    // The board's design call keeps this row (design review P2-17). The upload is not built yet, so
    // no proof is ever attached here and the row says so. COPY-UNSIGNED (design's wording)
    { key: 'Payment proof', value: 'Add payment proof · optional' },
  ];
  // On surface with no border, the rows in the raised box; two columns on wide (design review P2-16).
  const payment = (
    <section aria-label="Your payment" data-part="paid-payment">
      <Disclosure
        part="paid-payment-toggle"
        summary="Your payment"
        note={
          <>
            {total !== null ? <span className="x2f-when x2f-ink">{total.text}</span> : null}
            {total !== null ? ' · ' : ''}
            {method.name}
          </>
        }
      >
        {(id) => (
          <div id={id} className="x2f-disclosure__body" data-part="paid-payment-body">
            <Facts layout="raised" rows={rows} columns={wide ? 2 : undefined} />
          </div>
        )}
      </Disclosure>
    </section>
  );

  // The boards' order: the progress, the hero (timer inside), on wide the actions row, then What
  // happens next and Your payment (design review P2-9, P2-10).
  return (
    <>
      <PaidProgress view={view} serverClock={clock} />
      {status}
      {wide ? actions : null}
      {next}
      {payment}
    </>
  );
}

const PROGRESS = ['Escrow', 'You pay', 'Seller checks', 'Released'] as const;

/**
 * "Trade progress" (BuyerPaidWaiting and -Wide boards; design review P2-9): four bars, Escrow and
 * You pay done in escrow, Seller checks current with a caution fill for the share of the seller's
 * window that has run (all of it once it ended), Released still to come.
 */
export function PaidProgress({ view, serverClock }: { view: Pick<TradeView, 'paidAt' | 'confirmBy'>; serverClock: () => Date }) {
  const win = confirmWindow(view, serverClock().getTime());
  const run = win === null ? 0 : win.ended || win.lengthMs === 0 ? 1 : 1 - win.leftMs / win.lengthMs;
  const fill = `${Math.round(Math.min(Math.max(run, 0), 1) * 100)}%`;
  return (
    <ol aria-label="Trade progress" className="x2f-paid-progress" data-part="paid-progress">
      {PROGRESS.map((label, i) => {
        const status = i < 2 ? 'done' : i === 2 ? 'current' : 'todo';
        return (
          <li key={label} data-status={status} aria-current={status === 'current' ? 'step' : undefined}>
            <span className="x2f-paid-progress__track" aria-hidden="true">
              <span className="x2f-paid-progress__fill" style={status === 'current' ? ({ '--x2f-fill': fill } as CSSProperties) : undefined} />
            </span>
            <span className="x2f-paid-progress__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The actions. Phone (the footer; design review P2-11): the dispute first (56 px, locked on
 * surface-raised with "Available from … · in …" under it, or the danger outline once open), then
 * Nudge, then the no-cancel line. Wide (P2-10): one row, Nudge left and the dispute right, the
 * "Available from" line right-aligned under it, then the no-cancel line. Nudge is ink with only its
 * bell in caution (P2-13).
 */
export function PaidWaitingActions({ view, serverClock, wide = false }: { view: TradeView; serverClock: () => Date; wide?: boolean }) {
  const name = publicName(view.counterparty);
  const { clock, paused } = roomClock(view, serverClock);
  const now = clock().getTime();
  const opensAt = disputeOpensAt(view);
  const [nudge, setNudge] = useState<'sent' | 'failed' | 'gone' | null>(null);
  const [nudgeLimit, setNudgeLimit] = useState(false);
  const [busy, setBusy] = useState(false);

  const onNudge = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await sendNudge(name, view.code);
      // The nudge limit is a rule: CantDoThat with its feedback link (Plan 5 Task 21).
      if (r.result === NUDGE_TOO_SOON_CODE) {
        setNudge(null);
        setNudgeLimit(true);
      } else if (r.result === 'no-shared-context') {
        // Nothing shared to nudge about any more (the trade moved on): the button goes (review N2).
        setNudge('gone');
      } else setNudge(r.result === 'sent' ? 'sent' : 'failed');
    } catch {
      setNudge('failed');
    } finally {
      setBusy(false);
    }
  };

  const nudgeButton =
    nudge === 'gone' ? null : (
      <Button variant="secondary" disabled={busy} onClick={() => void onNudge()} data-part="nudge">
        <Icon name="bell-ring" size={20} />
        Nudge <Name view={view} />
      </Button>
    );
  // Review N1 keeps the button after a send; the server's 10-minute limit answers a second tap.
  // (Design review P2-14 asks to hide it and show only the line; that waits for the owner or design.)
  const nudgeLines = (
    <>
      {nudge === 'sent' ? (
        <p role="status" className="x2f-footnote" data-part="nudge-sent">
          Nudge sent. You can send another in <Duration ms={NUDGE_AGAIN_MS} />.
        </p>
      ) : null}
      {nudge === 'failed' ? (
        <p role="alert" className="x2f-error">
          That did not work. Try again.
        </p>
      ) : null}
    </>
  );
  const open = opensAt !== null && now >= opensAt;
  const disputeButton = open ? (
    <Link
      to={`/trade/${encodeURIComponent(view.code)}/dispute`}
      className="x2f-button x2f-button--danger-outline"
      data-size={wide ? 'medium' : undefined}
      data-part="paid-dispute"
    >
      Open dispute
    </Link>
  ) : (
    // aria-disabled, not disabled: it stays focusable, so its "Available from" is reachable (review N4).
    <Button variant="secondary" aria-disabled="true" aria-describedby={opensAt !== null ? 'paid-dispute-when' : undefined} data-size={wide ? undefined : 'large'} data-part="paid-dispute">
      Open dispute
    </Button>
  );
  const disputeWhen =
    open || opensAt === null ? null : (
      <p id="paid-dispute-when" className="x2f-footnote" data-align={wide ? 'end' : undefined}>
        {/* COPY-UNSIGNED "after the maintenance" (owner Q10; design words it) */}
        {paused ? 'Available after the maintenance' : <>Available from <When at={opensAt} form="time" /></>}
        {' · in '}
        <Countdown deadline={new Date(opensAt)} serverClock={clock} format="minutes" />
      </p>
    );
  const noCancel = (
    <p className="x2f-footnote" data-align={wide ? 'start' : undefined}>
      {/* not-a-refusal: says ahead of time what a paid trade allows; nothing is refused here (owner, Revision 2026-10-29b) */}
      You can't cancel after marking as paid. Tapped it by mistake? Explain in chat or open a dispute.
    </p>
  );
  const limit = nudgeLimit ? <CantDoThat title={CANT_DO_TITLE.nudge} body={NUDGE_TOO_SOON} from={NUDGE_TOO_SOON_CODE} onClose={() => setNudgeLimit(false)} /> : null;

  if (wide) {
    return (
      <>
        <div className="x2f-paid-actions__row">
          {nudgeButton}
          <span className="x2f-room__spacer" />
          {disputeButton}
        </div>
        {disputeWhen}
        {nudgeLines}
        {noCancel}
        {limit}
      </>
    );
  }
  return (
    <>
      {disputeButton}
      {disputeWhen}
      {nudgeButton}
      {nudgeLines}
      {noCancel}
      {limit}
    </>
  );
}
