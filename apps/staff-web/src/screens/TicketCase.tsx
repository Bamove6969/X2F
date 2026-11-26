import { TICKET_BODY_MAX } from '@x2f/staff';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { closeStaffTicket, codeOf, releaseTicket, replyToTicket, ticketCase, type TicketCase as Case } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from './TicketQueue.js';
import '../ui/staff.css';

// No board yet (DESIGN: not drawn, DESIGNER-REVIEW): the staff page head, the trader app's field
// and message-box styles (screens.css, loaded by main.tsx) and the kit's Button and Notice.
// Every sentence on this page is draft copy. COPY-UNSIGNED

const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');

/**
 * One support ticket (Plan 4 Tasks 30-31), opened only by the staff member who took it (the API
 * answers anyone else 403 `forbidden-case`, and logs each opening). The thread names neither the
 * trader nor any account: "Trader", "You" or "Staff" (another staff member who held it before).
 * Reply sets it to Answered; Close ends it; Put back returns it to the queue for someone else.
 * Nothing here reaches dispute evidence: a ticket carries only what the trader wrote.
 */
export function TicketCase() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [c, setCase] = useState<Case | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const textId = useId();

  useEffect(() => {
    let live = true;
    ticketCase(id).then(
      (r) => {
        if (live) setCase(r);
      },
      (e: unknown) => {
        if (!live) return;
        const code = codeOf(e);
        if (code === 'forbidden-case') setFault('Take this ticket from the queue to read it.');
        else if (code === 'not-found') setFault('This ticket is gone. It was deleted on its retention schedule.');
        else setFault(faultText(e, 'X2F could not load the ticket just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  const act = async (call: () => Promise<Case>, after?: () => void) => {
    setBusy(true);
    setFault(null);
    try {
      setCase(await call());
      after?.();
    } catch (e) {
      if (codeOf(e) === 'ticket-closed') setFault('The trader closed this ticket.');
      else if (codeOf(e) === 'bad-request') setFault('The reply has a hidden character or is too long. Retype it as plain text.');
      else setFault(faultText(e, 'That did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const putBack = async () => {
    setBusy(true);
    try {
      await releaseTicket(id);
      void navigate('/tickets');
    } catch (e) {
      setFault(faultText(e, 'X2F could not put the ticket back just now. Try again.'));
      setBusy(false);
    }
  };

  const clean = text.trim();
  const closed = c?.status === 'closed';
  const canSend = c !== null && !closed && clean !== '' && [...clean].length <= TICKET_BODY_MAX && !busy;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSend) void act(() => replyToTicket(id, clean), () => setText(''));
  };

  return (
    <section data-screen="ticket-case">
      <PageTitle title={c !== null ? TICKET_CATEGORY_LABELS[c.category] : 'Ticket'}>
        {c !== null ? (
          <p className="x2f-staff-page__lead" data-part="ticket-facts">
            {TICKET_STATUS_LABELS[c.status]} · opened <span className="x2f-staff-code">{when(c.createdAt)}</span> UTC
            {c.tradeCode !== null ? (
              <>
                {' '}
                · trade <span className="x2f-staff-code">{c.tradeCode}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </PageTitle>
      <p>
        <Link className="x2f-link" to="/tickets">
          Back to the queue
        </Link>
      </p>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {c !== null ? (
        <>
          <ol className="x2f-staff-thread" aria-label="Messages" data-part="ticket-thread">
            {c.messages.map((m, i) => (
              <li key={i} className="x2f-staff-thread__item" data-from={m.from} data-part="ticket-message">
                <p className="x2f-staff-hint">
                  <strong>{m.from === 'trader' ? 'Trader' : m.mine ? 'You' : 'Staff'}</strong> · <span className="x2f-staff-code">{when(m.at)}</span> UTC
                </p>
                <p className="x2f-staff-thread__body">{m.body}</p>
              </li>
            ))}
          </ol>
          {closed ? (
            <Notice tone="info" data-part="ticket-closed">
              This ticket is closed.
            </Notice>
          ) : (
            <form id={formId} onSubmit={submit} className="x2f-stack">
              <div className="x2f-field">
                <label htmlFor={textId} className="x2f-field-label">
                  Reply to the trader
                </label>
                <textarea id={textId} className="x2f-input x2f-input--message" rows={6} value={text} maxLength={TICKET_BODY_MAX} onChange={(e) => setText(e.target.value)} />
                <span className="x2f-field-count">
                  {text.length} of {TICKET_BODY_MAX} characters. The trader sees it as from X2F support, never your name.
                </span>
              </div>
              <div className="x2f-staff-actions">
                <Button variant="primary" type="submit" disabled={!canSend} aria-busy={busy}>
                  Send reply
                </Button>
                <Button variant="secondary" disabled={busy} data-part="ticket-close" onClick={() => void act(() => closeStaffTicket(id))}>
                  Close ticket
                </Button>
                <Button variant="quiet" disabled={busy} data-part="ticket-release" onClick={() => void putBack()}>
                  Put back in the queue
                </Button>
              </div>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}
