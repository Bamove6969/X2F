import type { StaffRole } from '@x2f/staff';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { disputeQueue, serverNow, takeCase, takeNext, type Queue, type QueueRow } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import { approvalText, codeText, deadline, limitText, span, usdText, xmrShort } from './modModel.js';
import '../ui/staff.css';

type Filter = 'all' | 'mine' | 'free' | 'approval';

/** Board ModQueue's chips, in its order and words. */
const FILTERS: readonly (readonly [Filter, string])[] = [
  ['all', 'All open'],
  ['mine', 'Assigned to you'],
  ['free', 'Unassigned'],
  ['approval', 'Needs approval'],
];

const passes = (f: Filter, r: QueueRow) =>
  f === 'all' || (f === 'mine' && r.mine) || (f === 'free' && r.assignee === null) || (f === 'approval' && r.status === 'awaiting-approval');

const OPENED_BY: Readonly<Record<QueueRow['openedBy'], string>> = { buyer: 'Buyer', seller: 'Seller', system: 'X2F' };

/**
 * Whether this person may take the row (the API's rule, so the button never offers a refusal): an
 * unassigned open case for anyone with disputes.handle; an appeal only for a senior moderator or the
 * owner (a moderator never gets one, R37 aside, which the API still checks).
 */
export const takeable = (r: Pick<QueueRow, 'assignee' | 'status'>, role: StaffRole) =>
  r.assignee === null && (r.status === 'open' || (r.status === 'appealed' && (role === 'senior' || role === 'owner')));

/**
 * The moderator's queue (Plan 4 Task 18, board ModQueue): the header naming the first-reply time,
 * "Take next case", four tiles, the filter chips with their counts, one row per open case with its
 * deadline bar, approval chip and assignee, and the footer naming the large-trade limit.
 *
 * The counts on the chips are of the rows shown (the API's first 500, closest deadline first); the
 * tiles are the API's counts over every open case. The board's waiting rows say how long the first
 * reply took ("Replied in 38 min"); the queue answer does not carry that time, so a replied row
 * says "Replied" with no bar. DESIGNER-REVIEW. Sentences the board does not word are COPY-UNSIGNED.
 */
export function ModQueue({ role }: { role: StaffRole }) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setQueue(await disputeQueue());
    } catch (e) {
      setFault(faultText(e, 'The disputes could not be loaded just now. Reload to try again.'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const next = async () => {
    setBusy(true);
    setFault(null);
    try {
      const { code } = await takeNext();
      if (code === null) setFault('No case is free to take right now.');
      else void navigate(`/disputes/${code}`);
    } catch (e) {
      setFault(faultText(e, 'No case could be taken just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const take = async (code: string) => {
    setFault(null);
    try {
      await takeCase(code);
    } catch (e) {
      // not-a-refusal: a case taken by someone else meanwhile is a changed state, shown as a fault.
      setFault(faultText(e, 'That case could not be taken. Someone may have taken it first.'));
    }
    await load();
  };

  const h = queue?.settings.firstResponseH ?? null;
  const rows = queue?.rows ?? [];
  const shown = rows.filter((r) => passes(filter, r));
  const now = serverNow();

  return (
    <section data-screen="mod-queue">
      <PageTitle title="Disputes">
        <p className="x2f-staff-page__lead" data-part="queue-lead">
          {h === null ? 'Open disputes, closest deadline first.' : `Open disputes, closest deadline first. A moderator must reply within ${h} hours of a dispute opening.`}
        </p>
        <Button variant="primary" disabled={busy} onClick={() => void next()}>
          Take next case
        </Button>
      </PageTitle>
      {fault !== null ? (
        <Notice tone="danger" data-part="queue-fault">
          {fault}
        </Notice>
      ) : null}
      {queue !== null ? (
        <>
          <ul className="x2f-staff-counts" aria-label="Open disputes" data-part="queue-counts">
            <li>
              <span className="x2f-staff-counts__n">{queue.counts.open}</span>
              <span>Open</span>
            </li>
            <li>
              <span className="x2f-staff-counts__n">{queue.counts.overdue}</span>
              <span>Overdue</span>
            </li>
            <li>
              <span className="x2f-staff-counts__n">{queue.counts.unassigned}</span>
              <span>Unassigned</span>
            </li>
            <li>
              <span className="x2f-staff-counts__n">{queue.counts.needApproval}</span>
              <span>Need a second approval</span>
            </li>
          </ul>
          <div className="x2f-staff-chips" role="group" aria-label="Show" data-part="queue-filters">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className="x2f-staff-filter" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {`${label} (${rows.filter((r) => passes(id, r)).length})`}
              </button>
            ))}
          </div>
          <Table
            label="Disputes"
            rows={shown}
            rowKey={(r) => r.code}
            empty="Nothing here right now."
            columns={[
              {
                title: 'Trade',
                cell: (r) => (
                  <>
                    <span data-part="queue-code">{codeText(r.code)}</span>
                    {/* Plan 4 Task 12 (A6): the comply time lapsed with no proof. COPY-UNSIGNED; DESIGNER-REVIEW (no board). */}
                    {r.complyLapsed === true ? (
                      <span className="x2f-staff-approval" data-part="queue-comply-lapsed">
                        {' '}
                        Payment not proven
                      </span>
                    ) : null}
                  </>
                ),
                mono: true,
              },
              {
                title: 'Amount',
                cell: (r) => (
                  <>
                    <span className="x2f-staff-cell__main">{`${xmrShort(r.xmr)} XMR`}</span> <span className="x2f-staff-hint">{usdText(r.usd)}</span>
                  </>
                ),
              },
              { title: 'Method', cell: (r) => r.methodName },
              { title: 'Opened by', cell: (r) => OPENED_BY[r.openedBy] },
              { title: 'Waiting · deadline', cell: (r) => <DeadlineCell row={r} hours={queue.settings.firstResponseH} now={now} /> },
              {
                title: 'Approval',
                cell: (r) => (
                  <span className={r.approval === 'not-needed' ? 'x2f-staff-hint' : 'x2f-staff-approval'} data-part="queue-approval">
                    {approvalText(r.approval)}
                  </span>
                ),
              },
              { title: 'Assigned to', cell: (r) => (r.assignee === null ? 'Unassigned' : r.mine ? 'You' : r.assignee) },
              {
                title: 'Actions',
                cell: (r) => (
                  <span className="x2f-row">
                    {takeable(r, role) ? (
                      <Button variant="secondary" onClick={() => void take(r.code)}>
                        Take
                      </Button>
                    ) : null}
                    <Link className="x2f-link" to={`/disputes/${r.code}`}>
                      Open case
                    </Link>
                  </span>
                ),
              },
            ]}
          />
          <p className="x2f-staff-hint" data-part="queue-foot">
            {`Rulings at or above the ${limitText(queue.settings.largeTradeLimitUsd)} large-trade limit need a second approval from a senior moderator or the owner. Opening a case's chat or asking for unblurred proof is written to the activity log.`}
          </p>
        </>
      ) : null}
    </section>
  );
}

function DeadlineCell({ row, hours, now }: { row: QueueRow; hours: number; now: Date }) {
  const d = deadline(row, hours, now);
  return (
    <span className="x2f-staff-deadline" data-tone={row.deadlineTone}>
      <span className="x2f-staff-hint">{`Waiting ${span(row.waitingMs)}`}</span>
      <span className="x2f-staff-deadline__text">{d.text}</span>
      {d.pct !== null ? (
        <span
          className="x2f-staff-deadline__bar"
          role="progressbar"
          aria-label={`Time used of the ${hours}-hour reply deadline`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={d.pct}
        >
          <span className="x2f-staff-deadline__fill" style={{ width: `${d.pct}%` }} />
        </span>
      ) : null}
    </span>
  );
}
