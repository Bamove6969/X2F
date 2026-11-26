import { TICKET_CATEGORIES, type TicketCategory } from '@x2f/staff';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { codeOf, serverNow, takeTicket, ticketQueue, type TicketQueueItem } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import { span } from './modModel.js';
import '../ui/staff.css';

// No board yet (Task 31's controller step, "ticket boards for traders and staff", has not run):
// ModQueue's table, chips and hint styles. DESIGN: not drawn, DESIGNER-REVIEW.
// Every sentence on this page is draft copy. COPY-UNSIGNED

/** The categories as staff read them, in the API's order ("Everything else" last). COPY-UNSIGNED */
export const TICKET_CATEGORY_LABELS: Readonly<Record<TicketCategory, string>> = {
  account: 'Account and login',
  trades: 'Trades',
  offers: 'Offers',
  wallets: 'Wallets',
  alerts: 'Alerts and notices',
  'everything-else': 'Everything else',
};

/** COPY-UNSIGNED */
export const TICKET_STATUS_LABELS = { open: 'Waiting for staff', answered: 'Answered', closed: 'Closed' } as const;

type Filter = 'all' | TicketCategory;

/**
 * The support-ticket queue (Plan 4 Tasks 30-31; perm `tickets.handle`): every ticket not closed,
 * oldest first, filtered by category, with its age, whose turn it is and who holds it. No text and
 * no trader here: a ticket's thread opens once you take it (TicketCase). The API logs every take.
 */
export function TicketQueue() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TicketQueueItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    ticketQueue().then(
      (r) => {
        if (live) setItems(r.items);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the tickets just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const take = async (id: string) => {
    setBusy(true);
    setFault(null);
    try {
      await takeTicket(id);
      void navigate(`/tickets/${id}`);
    } catch (e) {
      const code = codeOf(e);
      if (code === 'ticket-taken') setFault('Someone else took this ticket a moment ago.');
      else if (code === 'ticket-closed') setFault('The trader closed this ticket.');
      else setFault(faultText(e, 'X2F could not take the ticket just now. Try again.'));
      setItems((cur) => (cur === null ? cur : cur.filter((r) => r.id !== id || (code !== 'ticket-closed' && code !== 'ticket-taken'))));
    } finally {
      setBusy(false);
    }
  };

  const rows = items === null ? [] : items.filter((r) => filter === 'all' || r.category === filter);
  const count = (f: Filter) => (items === null ? 0 : items.filter((r) => f === 'all' || r.category === f).length);
  const now = serverNow().getTime();
  return (
    <section data-screen="ticket-queue">
      <PageTitle title="Tickets">
        <p className="x2f-staff-page__lead">
          Questions traders sent to X2F, oldest first. Take one to read and answer it. Only you can read a ticket you took, and every take is logged.
        </p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <div className="x2f-staff-chips" role="group" aria-label="Category" data-part="ticket-filters">
        {(['all', ...TICKET_CATEGORIES] as const).map((f) => (
          <button key={f} type="button" className="x2f-staff-filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : TICKET_CATEGORY_LABELS[f]} {count(f)}
          </button>
        ))}
      </div>
      {items !== null ? (
        <Table
          label="Tickets"
          rows={rows}
          rowKey={(r) => r.id}
          empty="No tickets waiting."
          columns={[
            { title: 'Category', cell: (r) => TICKET_CATEGORY_LABELS[r.category] },
            { title: 'Age', cell: (r) => span(now - Date.parse(r.createdAt)), mono: true },
            { title: 'Status', cell: (r) => (r.waiting === 'staff' ? TICKET_STATUS_LABELS.open : TICKET_STATUS_LABELS.answered) },
            { title: 'Last activity', cell: (r) => `${span(now - Date.parse(r.updatedAt))} ago`, mono: true },
            {
              title: 'Taken by',
              cell: (r) =>
                r.taken === 'me' ? (
                  <Link className="x2f-link" to={`/tickets/${r.id}`} data-part="ticket-open">
                    You
                  </Link>
                ) : r.taken === 'other' ? (
                  <span className="x2f-staff-hint">Another staff member</span>
                ) : (
                  <Button variant="secondary" disabled={busy} data-part="ticket-take" onClick={() => void take(r.id)}>
                    Take
                  </Button>
                ),
            },
          ]}
        />
      ) : null}
    </section>
  );
}
