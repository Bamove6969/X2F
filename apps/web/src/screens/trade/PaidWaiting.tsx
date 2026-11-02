/**
 * The buyer's room after "I've paid" (board BuyerPaidWaiting.dc.html and -Wide; design review
 * 1 Nov 2026 shot 39, NEEDS_DESIGN "the after-I've-paid buyer state"): the status card says the
 * trade is paid and the seller is checking, the timer shows the seller's confirm window, "What
 * happens next" says what each side does, and the payment's details fold away under "Your
 * payment". The footer has Nudge (the API's nudge on an open trade, spec 2.4), Open a dispute
 * (disabled with "Available from … in …" until `disputeOpensAt`: 30 min after I've paid, owner
 * 2 Nov, but never before the server allows it), and the reminder that a paid trade can't be
 * cancelled.
 *
 * Once the window ends without a release the status turns to "hasn't confirmed in time" (the
 * board's window=ended). BuyerPay.tsx keeps the
 * escrow side: Finish marking as paid, the refusals and the stopped escrow come in as `notices`
 * and `primary`. Lines not on the board are COPY-UNSIGNED.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatXmr } from '@x2f/trade';
import { sendNudge } from '../../nudge/useNudge.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, NUDGE_TOO_SOON, NUDGE_TOO_SOON_CODE } from '../../ui/cantDoCodes.js';
import { Countdown, Duration } from '../../ui/Countdown.js';
import { Disclosure } from '../../ui/Disclosure.js';
import { KeyValues, type KeyValue } from '../../ui/KeyValues.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TimerCard } from '../../ui/TimerCard.js';
import { When } from '../../ui/When.js';
import type { DeviceTotal } from './PaidFlowSheet.js';
import { usePaymentDetails, type MethodInfo } from './paySeams.js';
import { publicName, type TradeView } from './payTypes.js';
import { Name } from './TradeTimeline.js';

const MIN_MS = 60_000;

/** The seller's confirm window, from the view: when it ends, how long it is, how much is left. */
export function confirmWindow(view: Pick<TradeView, 'paidAt' | 'confirmBy'>, nowMs: number): { ends: number; lengthMs: number; leftMs: number; ended: boolean } | null {
  const ends = view.confirmBy === null ? NaN : Date.parse(view.confirmBy);
  const paid = view.paidAt === null ? NaN : Date.parse(view.paidAt);
  if (!Number.isFinite(ends)) return null;
  const lengthMs = Number.isFinite(paid) ? Math.max(0, ends - paid) : 0;
  const leftMs = Math.max(0, ends - nowMs);
  return { ends, lengthMs, leftMs, ended: leftMs === 0 };
}

/** The owner's rule (2 Nov): the buyer may open a dispute 30 minutes after tapping I've paid. */
export const DISPUTE_AFTER_PAID_MS = 30 * MIN_MS;

/**
 * When the buyer's Open a dispute becomes available in `paid`: 30 minutes after I've paid (owner,
 * 2 Nov), but never before the server allows it. Today the state machine refuses the buyer's
 * dispute until confirmBy (machine.ts `too-early`), so that is the later of the two and the button
 * never offers what the server would refuse. Follow-up for the API: allow it 30 min after paid;
 * then this is paidAt + 30 min alone. Null when neither time is known (the button is offered).
 */
export function disputeOpensAt(view: Pick<TradeView, 'paidAt' | 'confirmBy'>): number | null {
  const paid = view.paidAt === null ? NaN : Date.parse(view.paidAt) + DISPUTE_AFTER_PAID_MS;
  const server = view.confirmBy === null ? NaN : Date.parse(view.confirmBy);
  const times = [paid, server].filter(Number.isFinite);
  return times.length === 0 ? null : Math.max(...times);
}

/** "2 hours", "1 hour", "90 minutes": the window's length in a sentence. */
export function windowWords(ms: number): string {
  const min = Math.round(ms / MIN_MS);
  if (min > 0 && min % 60 === 0) return min === 60 ? '1 hour' : `${min / 60} hours`;
  return min === 1 ? '1 minute' : `${min} minutes`;
}

/** The status card, the timer, What happens next and Your payment (the board's main column). */
export function PaidWaitingBody({
  view,
  method,
  total,
  serverClock,
  chatAction,
  wide,
}: {
  view: TradeView;
  method: MethodInfo;
  total: DeviceTotal | null;
  serverClock: () => Date;
  chatAction: ReactNode;
  wide: boolean;
}) {
  const details = usePaymentDetails(view.code);
  const win = confirmWindow(view, serverClock().getTime());
  const ended = win?.ended ?? false;
  const length = win === null || win.lengthMs === 0 ? null : windowWords(win.lengthMs);
  const xmr = `${formatXmr(BigInt(view.amountAtomic))} XMR`;

  const status = (
    <section role="status" aria-labelledby="paid-title" className="x2f-panel" data-part="paid-status">
      {ended ? (
        <StatusChip tone="caution" icon="clock" label="Paid · not confirmed in time" />
      ) : (
        <StatusChip tone="escrow" icon="check" label="Paid" />
      )}
      <h1 id="paid-title" className="x2f-h2">
        {ended ? (
          <>
            <Name view={view} /> hasn't confirmed in time
          </>
        ) : (
          <>
            Paid · waiting for <Name view={view} /> to confirm
          </>
        )}
      </h1>
      <p className="x2f-fine">
        {ended ? (
          <>
            {length !== null ? `Their ${length} to check ${method.name} ended` : `Their time to check ${method.name} ended`}
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
            . <Name view={view} /> has been told and has {length !== null ? `up to ${length}` : 'time'} to check {method.name} and release.
          </>
        )}
      </p>
    </section>
  );

  const timer =
    win === null ? null : (
      <TimerCard
        label="Time left to confirm"
        part="confirm-timer"
        tone={ended ? 'caution' : 'escrow'}
        left={win.leftMs}
        total={win.lengthMs}
        ringLabel={ended ? 'No time left to confirm' : `${Math.ceil(win.leftMs / MIN_MS)} of ${Math.round(win.lengthMs / MIN_MS)} minutes left to confirm`}
        value={ended ? <Duration ms={0} /> : <Countdown deadline={new Date(win.ends)} serverClock={serverClock} format="minutes" />}
        hint={
          <>
            {length !== null ? `${method.name} gets ${length} · ` : ''}ends <When at={win.ends} />
          </>
        }
      />
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
          When they release, <span className="x2f-when">{xmr}</span> reaches your wallet within seconds. Your app co-signs by itself.
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

  const rows: KeyValue[] = [
    ...(details ?? []).map((d) => ({ key: d.label === `${method.name} to` ? 'Sent to' : d.label, value: d.value })),
    { key: 'Memo', value: view.code },
    { key: 'For', value: xmr },
    ...(view.paidAt !== null ? [{ key: 'Marked as paid', value: <When at={view.paidAt} /> }] : []),
  ];
  const payment = (
    <section className="x2f-panel" data-outline="" aria-label="Your payment" data-part="paid-payment">
      {/* The kit's Disclosure (the LoginApprove board's open and close row). */}
      <Disclosure
        part="paid-payment-toggle"
        summary={
          <>
            <span>Your payment</span>
            <span className="x2f-fine">
              {total !== null ? <span className="x2f-when">{total.text}</span> : null}
              {total !== null ? ' · ' : ''}
              {method.name}
            </span>
          </>
        }
      >
        {(id) => (
          <div id={id}>
            <KeyValues rows={rows} />
          </div>
        )}
      </Disclosure>
    </section>
  );

  if (wide) {
    return (
      <>
        {status}
        <div className="x2f-room__grid">
          {timer}
          {payment}
        </div>
        {next}
      </>
    );
  }
  return (
    <>
      {status}
      {timer}
      {next}
      {payment}
    </>
  );
}

/** The footer: Nudge, the dispute (waiting or open), and the no-cancel line. */
export function PaidWaitingActions({ view, serverClock }: { view: TradeView; serverClock: () => Date }) {
  const name = publicName(view.counterparty);
  const now = serverClock().getTime();
  const opensAt = disputeOpensAt(view);
  const [nudge, setNudge] = useState<'sent' | 'failed' | null>(null);
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
      } else setNudge(r.result === 'sent' ? 'sent' : 'failed');
    } catch {
      setNudge('failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {nudge === 'sent' ? (
        <p role="status" className="x2f-footnote" data-part="nudge-sent">
          Nudge sent. You can send another in 10 min.
        </p>
      ) : (
        <Button variant="secondary" data-tone="caution" disabled={busy} onClick={() => void onNudge()} data-part="nudge">
          <Icon name="bell-ring" size={20} />
          Nudge <Name view={view} />
        </Button>
      )}
      {nudge === 'failed' ? (
        <p role="alert" className="x2f-error">
          That did not work. Try again.
        </p>
      ) : null}
      {opensAt === null || now >= opensAt ? (
        <Link to={`/trade/${encodeURIComponent(view.code)}/dispute`} className="x2f-button x2f-button--danger-outline" data-part="paid-dispute">
          Open a dispute
        </Link>
      ) : (
        <>
          <Button variant="secondary" disabled aria-describedby="paid-dispute-when" data-part="paid-dispute">
            Open a dispute
          </Button>
          <p id="paid-dispute-when" className="x2f-footnote">
            Available from <When at={opensAt} />, in <Countdown deadline={new Date(opensAt)} serverClock={serverClock} format="minutes" />.
          </p>
        </>
      )}
      <p className="x2f-footnote">
        {/* not-a-refusal: says ahead of time what a paid trade allows; nothing is refused here (owner, Revision 2026-10-29b) */}
        You can't cancel after marking as paid. Tapped it by mistake? Explain in chat or open a dispute.
      </p>
      {nudgeLimit ? <CantDoThat title={CANT_DO_TITLE.nudge} body={NUDGE_TOO_SOON} from={NUDGE_TOO_SOON_CODE} onClose={() => setNudgeLimit(false)} /> : null}
    </>
  );
}
