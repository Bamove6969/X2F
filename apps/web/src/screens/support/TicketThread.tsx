/**
 * One support ticket (Plan 4 Task 31; /support/tickets/:id): the thread, oldest first, the trader's
 * reply box and Close ticket. A staff line says "X2F support" and never which staff member wrote
 * it (the API sends no name). A team member's line names the member (`by`, owner Q69: a team shares
 * its tickets); the account owner's own lines say "You". A closed ticket shows its thread and "Open a ticket".
 * API: apps/api/src/tickets/traderRoutes.ts. DESIGN: not drawn (no board), kit parts only.
 * COPY-UNSIGNED (tickets-model.ts).
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { formatDateTime } from '../../ui/dates.js';
import { FlowScreen } from '../../ui/FlowScreen.js';
import { Notice } from '../../ui/Notice.js';
import { memberOf } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { waitSentence } from '../auth/refusals.js';
import { NEW_TICKET_PATH, TICKETS_PATH, TicketStatusChip, ticketRefusal } from './Tickets.js';
import { CATEGORY_LABELS, REPLIES_DAILY_TEXT, TICKET_BODY_MAX, TICKET_COPY, closeTicket, getTicket, replyTicket, whoWrote, type TicketThreadView } from './tickets-model.js';
import '../screens.css';
import './support.css';

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | { kind: 'ready'; t: TicketThreadView };

export function TicketThread() {
  const { id = '' } = useParams();
  // Team tickets (owner Q69): whose lines are "You" depends on who is reading.
  const viewer = memberOf(useSession())?.name ?? null;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ReturnType<typeof ticketRefusal>>(null);
  const formId = useId();
  const textId = useId();
  const countId = useId();

  useEffect(() => {
    const ctl = new AbortController();
    setLoad({ kind: 'loading' });
    getTicket(id, ctl.signal).then(
      (t) => {
        if (!ctl.signal.aborted) setLoad({ kind: 'ready', t });
      },
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setRefusal(ticketRefusal(e));
        setLoad(e instanceof ApiCallError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed' });
      },
    );
    return () => ctl.abort();
  }, [id]);

  const clean = text.trim();
  const ready = load.kind === 'ready' && load.t.status !== 'closed' && clean !== '' && [...clean].length <= TICKET_BODY_MAX && !busy;

  const act = async (call: () => Promise<TicketThreadView>, after?: () => void) => {
    setBusy(true);
    setFault(null);
    try {
      const t = await call();
      setLoad({ kind: 'ready', t });
      after?.();
    } catch (err) {
      const r = ticketRefusal(err);
      if (r !== null) setRefusal(r);
      else if (err instanceof ApiCallError && err.status === 409 && err.code === 'ticket-closed') {
        // Closed meanwhile (by staff): show it as it is now.
        setLoad((cur) => (cur.kind === 'ready' ? { kind: 'ready', t: { ...cur.t, status: 'closed' } } : cur));
      } else if (err instanceof ApiCallError && err.status === 429 && err.extra.limit === 'daily') setFault(REPLIES_DAILY_TEXT);
      else if (err instanceof ApiCallError && err.status === 429) setFault(waitSentence(err.retryAfterSeconds));
      else if (err instanceof ApiCallError && err.status === 400) setFault(TICKET_COPY.badText);
      else setFault(TICKET_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    void act(() => replyTicket(id, clean), () => setText(''));
  };

  const t = load.kind === 'ready' ? load.t : null;
  const closed = t?.status === 'closed';
  return (
    <FlowScreen
      screen="ticket-thread"
      title={t !== null ? CATEGORY_LABELS[t.category] : TICKET_COPY.threadTitle}
      sub={t !== null ? <TicketStatusChip status={t.status} /> : undefined}
      back={{ label: TICKET_COPY.back, to: TICKETS_PATH }}
      busy={load.kind === 'loading'}
      footer={
        // DESIGN: owner 17 Nov black+orange rule: a ticket that is missing or could not load offers
        // "Open a ticket" as its primary, as a closed one does.
        t === null ? (
          load.kind === 'missing' || load.kind === 'failed' ? (
            <Link className="x2f-button x2f-button--primary" data-primary="" to={NEW_TICKET_PATH} data-part="open-ticket">
              {TICKET_COPY.open}
            </Link>
          ) : undefined
        ) : closed ? (
          <Link className="x2f-button x2f-button--primary" data-primary="" to={NEW_TICKET_PATH} data-part="open-ticket">
            {TICKET_COPY.open}
          </Link>
        ) : (
          <>
            <Button variant="primary" type="submit" form={formId} disabled={!ready} aria-busy={busy}>
              {TICKET_COPY.send}
            </Button>
            <Button variant="quiet" disabled={busy} data-part="close-ticket" onClick={() => void act(() => closeTicket(id))}>
              {TICKET_COPY.close}
            </Button>
          </>
        )
      }
    >
      {load.kind === 'failed' && refusal === null ? <Notice tone="danger">{TICKET_COPY.loadFailed}</Notice> : null}
      {load.kind === 'missing' ? (
        <Notice tone="danger" data-part="ticket-missing">
          {TICKET_COPY.missing}
        </Notice>
      ) : null}
      {t !== null ? (
        <>
          <p className="x2f-fine" data-part="ticket-facts">
            {TICKET_COPY.opened} {formatDateTime(t.createdAt)}
            {t.tradeCode !== null ? (
              <>
                {' '}· {TICKET_COPY.tradeLine} <span className="x2f-when">{t.tradeCode}</span>
              </>
            ) : null}
          </p>
          <ol className="x2f-ticket-thread" aria-label={TICKET_COPY.threadTitle}>
            {t.messages.map((m, i) => (
              <li key={i} className="x2f-ticket-msg" data-from={m.from} data-part="ticket-message">
                <p className="x2f-ticket-msg__who">
                  <strong>{whoWrote(m, viewer)}</strong> · {formatDateTime(m.at)}
                </p>
                <p className="x2f-ticket-msg__body">{m.body}</p>
              </li>
            ))}
          </ol>
          {closed ? (
            <Notice tone="info" data-part="ticket-closed">
              {TICKET_COPY.closedNote}
            </Notice>
          ) : (
            <form id={formId} onSubmit={submit}>
              <div className="x2f-field">
                <label htmlFor={textId} className="x2f-field-label">
                  {TICKET_COPY.replyLabel}
                </label>
                <textarea
                  id={textId}
                  className="x2f-input x2f-input--message"
                  rows={5}
                  value={text}
                  maxLength={TICKET_BODY_MAX}
                  aria-describedby={countId}
                  onChange={(e) => setText(e.target.value)}
                />
                <span id={countId} className="x2f-field-count">
                  <span className="x2f-when">{text.length}</span> of {TICKET_BODY_MAX} characters
                </span>
              </div>
            </form>
          )}
          {fault !== null ? (
            <Notice tone="danger" data-part="ticket-failed">
              {fault}
            </Notice>
          ) : null}
        </>
      ) : null}
      {refusal !== null ? <CantDoThat title={refusal.title} body={refusal.body} from={refusal.from} onClose={() => setRefusal(null)} /> : null}
    </FlowScreen>
  );
}
