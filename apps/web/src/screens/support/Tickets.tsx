/**
 * Support tickets (Plan 4 Task 31; spec 6.6, Helper): the trader's list of their own tickets
 * (/support/tickets) and "Open a ticket" (/support/tickets/new), reached from Help, Support. The
 * trader picks a category ("Everything else" last), may name one of their own trades, writes, and
 * follows the thread (TicketThread.tsx). API: apps/api/src/tickets/traderRoutes.ts.
 *
 * No board yet (Task 31's controller step, "ticket boards for traders and staff", has not run):
 * built from kit parts only (FlowScreen, ChoiceGroup, StatusChip, EmptyState, Notice, Button,
 * CantDoThat) and the trades list's row styles. DESIGN: not drawn, DESIGNER-REVIEW; every word is
 * COPY-UNSIGNED (tickets-model.ts).
 *
 * Refusals: TICKET_OPEN_AT_ONCE tickets not closed (409 `too-many-tickets`) and a team member
 * (403 `owner-only`: tickets are the account owner's) open CantDoThat; the write gap and the daily
 * cap are said inline, as the feedback form says its limit.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { ChoiceGroup } from '../../ui/Choice.js';
import { CANT_DO_TITLE, TOO_MANY_TICKETS, TOO_MANY_TICKETS_CODE, isCantDoCode, teamCantDoText, teamCantDoTitle } from '../../ui/cantDoCodes.js';
import { formatDateTime } from '../../ui/dates.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { FlowScreen } from '../../ui/FlowScreen.js';
import { Notice } from '../../ui/Notice.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { waitSentence } from '../auth/refusals.js';
import {
  CATEGORY_LABELS, CATEGORY_ORDER, STATUS_LABELS, TICKET_BODY_MAX, TICKET_COPY, TICKET_OPEN_AT_ONCE, TICKET_OPEN_DAILY, TICKETS_DAILY_TEXT,
  listTickets, openTicket, type TicketCategory, type TicketStatus, type TicketSummary,
} from './tickets-model.js';
import '../screens.css';
import '../trades/trades.css';
import './support.css';

export const TICKETS_PATH = '/support/tickets';
export const NEW_TICKET_PATH = '/support/tickets/new';
export const ticketPath = (id: string) => `${TICKETS_PATH}/${encodeURIComponent(id)}`;

/** The chip of a status: whose turn it is, in words and an icon (never colour alone). */
export function TicketStatusChip({ status }: { status: TicketStatus }) {
  if (status === 'answered') return <StatusChip tone="escrow" icon="check" label={STATUS_LABELS.answered} />;
  if (status === 'closed') return <StatusChip tone="neutral" icon="close" label={STATUS_LABELS.closed} />;
  return <StatusChip tone="caution" icon="clock" label={STATUS_LABELS.open} />;
}

/** A refusal shown in CantDoThat. */
type Refusal = { from: string; title: string; body: string };

/** The code a refused call carries, as CantDoThat words, or null for anything that is not a refusal. */
export function ticketRefusal(e: unknown): Refusal | null {
  if (!(e instanceof ApiCallError) || !isCantDoCode(e.code)) return null;
  if (e.code === TOO_MANY_TICKETS_CODE) return { from: e.code, title: TOO_MANY_TICKETS.title, body: TOO_MANY_TICKETS.body(TICKET_OPEN_AT_ONCE) };
  // A team member without the box (403 forbidden: "See support tickets" or "Open support tickets", owner Q69):
  // the team refusal's own words. Any other code is said as a fault by the screen.
  const title = teamCantDoTitle(e.code);
  return title === CANT_DO_TITLE.team ? null : { from: e.code, title, body: teamCantDoText(e.code) };
}

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; items: TicketSummary[] };

export function Tickets() {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    listTickets(ctl.signal).then(
      (r) => {
        if (!ctl.signal.aborted) setLoad({ kind: 'ready', items: r.items });
      },
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setRefusal(ticketRefusal(e));
        setLoad({ kind: 'failed' });
      },
    );
    return () => ctl.abort();
  }, []);

  return (
    <FlowScreen
      screen="tickets"
      title={TICKET_COPY.listTitle}
      back={{ label: TICKET_COPY.back, to: '/help/support' }}
      busy={load.kind === 'loading'}
      footer={
        <Link className="x2f-button x2f-button--primary" data-primary="" to={NEW_TICKET_PATH} data-part="open-ticket">
          {TICKET_COPY.open}
        </Link>
      }
    >
      {load.kind === 'failed' && refusal === null ? <Notice tone="danger">{TICKET_COPY.loadFailed}</Notice> : null}
      {load.kind === 'ready' && load.items.length === 0 ? (
        <EmptyState icon="info" title={TICKET_COPY.emptyTitle} data-part="no-tickets">
          {TICKET_COPY.emptyBody}
        </EmptyState>
      ) : null}
      {load.kind === 'ready' && load.items.length > 0 ? (
        <>
          <p className="x2f-lead">{TICKET_COPY.listLead}</p>
          <ul className="x2f-trades__list" aria-label={TICKET_COPY.listTitle}>
            {load.items.map((t) => (
              <li key={t.id} className="x2f-trades__row" data-part="ticket-row" data-status={t.status}>
                <Link to={ticketPath(t.id)} className="x2f-trades__link">
                  <span className="x2f-trades__top">
                    <span className="x2f-trades__side">{CATEGORY_LABELS[t.category]}</span>
                    <TicketStatusChip status={t.status} />
                  </span>
                  <span className="x2f-trades__line">
                    {t.tradeCode !== null ? (
                      <>
                        <span className="x2f-trades__mono">{t.tradeCode}</span> ·{' '}
                      </>
                    ) : null}
                    {formatDateTime(t.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {refusal !== null ? (
        <CantDoThat
          title={refusal.title}
          body={refusal.body}
          from={refusal.from}
          onClose={() => {
            setRefusal(null);
            void navigate('/help/support');
          }}
        />
      ) : null}
    </FlowScreen>
  );
}

type Sending = { kind: 'idle' } | { kind: 'sending' } | { kind: 'failed'; message: string; field?: 'trade' };

export function TicketNew() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [tradeCode, setTradeCode] = useState('');
  const [text, setText] = useState('');
  const [state, setState] = useState<Sending>({ kind: 'idle' });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const formId = useId();
  const groupId = useId();
  const textId = useId();
  const countId = useId();
  const tradeId = useId();
  const tradeHintId = useId();
  const clean = text.trim();
  const tooLong = [...clean].length > TICKET_BODY_MAX;
  const ready = category !== null && clean !== '' && !tooLong && state.kind !== 'sending';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || category === null) return;
    setState({ kind: 'sending' });
    try {
      const code = tradeCode.trim();
      const { id } = await openTicket({ category, body: clean, ...(code !== '' ? { tradeCode: code } : {}) });
      void navigate(ticketPath(id), { replace: true });
    } catch (err) {
      const r = ticketRefusal(err);
      if (r !== null) {
        setRefusal(r);
        setState({ kind: 'idle' });
      } else if (err instanceof ApiCallError && err.status === 429 && err.extra.limit === 'daily') setState({ kind: 'failed', message: TICKETS_DAILY_TEXT(TICKET_OPEN_DAILY) });
      else if (err instanceof ApiCallError && err.status === 429) setState({ kind: 'failed', message: waitSentence(err.retryAfterSeconds) });
      else if (err instanceof ApiCallError && err.status === 404) setState({ kind: 'failed', message: TICKET_COPY.tradeUnknown, field: 'trade' });
      else if (err instanceof ApiCallError && err.status === 400) setState({ kind: 'failed', message: TICKET_COPY.badText });
      else setState({ kind: 'failed', message: TICKET_COPY.failed });
    }
  };

  return (
    <FlowScreen
      screen="ticket-new"
      title={TICKET_COPY.newTitle}
      back={{ label: TICKET_COPY.back, to: TICKETS_PATH }}
      footer={
        <Button variant="primary" type="submit" form={formId} disabled={!ready} aria-busy={state.kind === 'sending'}>
          {TICKET_COPY.send}
        </Button>
      }
    >
      <form id={formId} className="x2f-stack" onSubmit={(e) => void submit(e)}>
        <p className="x2f-fine" data-part="ticket-privacy">
          {TICKET_COPY.privacy}
        </p>
        <div className="x2f-field">
          <span id={groupId} className="x2f-field-label">
            {TICKET_COPY.categoryLabel}
          </span>
          <ChoiceGroup
            look="card"
            labelledBy={groupId}
            part="ticket-category"
            value={category}
            onChange={setCategory}
            options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />
        </div>
        <div className="x2f-field">
          <label htmlFor={tradeId} className="x2f-field-label">
            {TICKET_COPY.tradeLabel}
          </label>
          <input
            id={tradeId}
            className="x2f-input"
            value={tradeCode}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={tradeHintId}
            aria-invalid={state.kind === 'failed' && state.field === 'trade' ? true : undefined}
            onChange={(e) => setTradeCode(e.target.value)}
          />
          <span id={tradeHintId} className="x2f-field-count">
            {TICKET_COPY.tradeHint}
          </span>
        </div>
        <div className="x2f-field">
          <label htmlFor={textId} className="x2f-field-label">
            {TICKET_COPY.messageLabel}
          </label>
          <textarea
            id={textId}
            className="x2f-input x2f-input--message"
            rows={9}
            value={text}
            maxLength={TICKET_BODY_MAX}
            placeholder={TICKET_COPY.messagePlaceholder}
            aria-describedby={countId}
            onChange={(e) => setText(e.target.value)}
          />
          <span id={countId} className="x2f-field-count" data-part="ticket-count">
            <span className="x2f-when">{text.length}</span> of {TICKET_BODY_MAX} characters
          </span>
        </div>
        {state.kind === 'failed' ? (
          <Notice tone="danger" data-part="ticket-failed">
            {state.message}
          </Notice>
        ) : null}
      </form>
      {refusal !== null ? <CantDoThat title={refusal.title} body={refusal.body} from={refusal.from} onClose={() => setRefusal(null)} /> : null}
    </FlowScreen>
  );
}
