import type { StaffRole } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { disputeQueue, serverNow, takeCase, takeNext, type Queue, type QueueRow } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import { isLimitDecider } from './LimitRecommendations.js';
import { QUEUE_STATUS_LABELS, ageChoices, approvalText, assigneeText, codeText, deadline, limitText, oldestWaiting, olderThan, span, usdText, xmrShort, type QueueAge } from './modModel.js';
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
 *
 * Mod polish (no board; DESIGNER-REVIEW, COPY-UNSIGNED): two filters beside the chips, by status
 * and by how long a case has waited (over 1 hour, over the first-reply time, over 24 hours); a
 * count badge of the rows shown; and the oldest-waiting timer, the case that has waited longest
 * for its first reply against the first-reply setting (`settings.firstResponseH`), ticking each
 * 30 seconds from the API's `waitingMs`.
 */
export function ModQueue({ role }: { role: StaffRole }) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [status, setStatus] = useState<string>('');
  const [age, setAge] = useState<QueueAge>('any');
  // When the queue was read, so a wait keeps counting between reads.
  const [loadedAt, setLoadedAt] = useState(() => serverNow().getTime());
  const [, setTick] = useState(0);
  const ids = { status: useId(), age: useId() };
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const q = await disputeQueue();
      setLoadedAt(serverNow().getTime());
      setQueue(q);
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
  const now = serverNow();
  const since = Math.max(0, now.getTime() - loadedAt);
  // Each row's wait as of now: the API's figure at the read, plus the time since.
  const rows = (queue?.rows ?? []).map((r) => ({ ...r, waitingMs: r.waitingMs + since }));
  const narrowed = rows.filter((r) => (status === '' || r.status === status) && olderThan(age, r.waitingMs, h ?? 0));
  const shown = narrowed.filter((r) => passes(filter, r));
  const statuses = [...new Set([...Object.keys(QUEUE_STATUS_LABELS).filter((k) => k !== 'complying'), ...rows.map((r) => r.status)])];
  const oldest = oldestWaiting(rows);

  return (
    <section data-screen="mod-queue">
      <PageTitle title="Disputes">
        <p className="x2f-staff-page__lead" data-part="queue-lead">
          {h === null ? 'Open disputes, closest deadline first.' : `Open disputes, closest deadline first. A moderator must reply within ${h} hours of a dispute opening.`}
          {/* Owner 26 Nov 2026: the pool time. COPY-UNSIGNED */}
          {queue?.settings.autoAssign?.on === true ? ` A case nobody takes within ${queue.settings.autoAssign.minutes} minutes goes to the moderator on shift with the fewest open cases.` : null}
        </p>
        <Button variant="primary" disabled={busy} onClick={() => void next()}>
          Take next case
        </Button>
        {/* Plan 4 Task 26 (no board; a lead default): where a senior moderator or the owner decides recommended limits. COPY-UNSIGNED */}
        {isLimitDecider(role) ? (
          <Link className="x2f-link" to="/disputes/limits">
            Recommended limits
          </Link>
        ) : null}
        {/* Plan 5 Task 19 (lead default, DESIGNER-REVIEW: no board places it). COPY-UNSIGNED */}
        <Link className="x2f-link" to="/disputes/reviews" data-part="review-disputes-link">
          Review disputes
        </Link>
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
          <OldestWaiting row={oldest} hours={queue.settings.firstResponseH} now={now} />
          <div className="x2f-staff-chips" role="group" aria-label="Show" data-part="queue-filters">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className="x2f-staff-filter" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {`${label} (${narrowed.filter((r) => passes(id, r)).length})`}
              </button>
            ))}
          </div>
          <div className="x2f-staff-queue-filters" data-part="queue-more-filters">
            <label htmlFor={ids.status} className="x2f-sr-only">
              Status
            </label>
            <select id={ids.status} className="x2f-input x2f-staff-queue-filters__select" data-part="queue-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {statuses.map((k) => (
                <option key={k} value={k}>
                  {QUEUE_STATUS_LABELS[k] ?? k}
                </option>
              ))}
            </select>
            <label htmlFor={ids.age} className="x2f-sr-only">
              How long it has waited
            </label>
            <select id={ids.age} className="x2f-input x2f-staff-queue-filters__select" data-part="queue-age" value={age} onChange={(e) => setAge(e.target.value as QueueAge)}>
              {ageChoices(queue.settings.firstResponseH).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <span className="x2f-staff-count-badge" data-part="queue-badge" aria-label={`${shown.length} of ${rows.length} cases shown`}>
              {`${shown.length} of ${rows.length}`}
            </span>
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
              // Owner 26 Nov 2026 ("Pool first, auto-assign if untaken"): a free case says when the
              // timer assigns it; one the timer gave this person says so. COPY-UNSIGNED
              { title: 'Assigned to', cell: (r) => <span data-part="queue-assignee">{assigneeText(r, now)}</span> },
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

/** The case that has waited longest for its first reply, against the first-reply setting. COPY-UNSIGNED, DESIGNER-REVIEW */
function OldestWaiting({ row, hours, now }: { row: QueueRow | null; hours: number; now: Date }) {
  if (row === null) {
    return (
      <p className="x2f-staff-hint" data-part="queue-oldest" data-tone="replied">
        Every open case has had its first reply.
      </p>
    );
  }
  const d = deadline(row, hours, now);
  return (
    <p className="x2f-staff-oldest" data-part="queue-oldest" data-tone={row.deadlineTone === 'overdue' || Date.parse(row.replyDueAt) <= now.getTime() ? 'overdue' : 'due'}>
      <span>{'Oldest waiting for a first reply: '}</span>
      <Link className="x2f-link" to={`/disputes/${row.code}`} data-part="queue-oldest-code">
        {codeText(row.code)}
      </Link>
      <span>{`, waiting ${span(row.waitingMs)}. ${d.text}.`}</span>
    </p>
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
