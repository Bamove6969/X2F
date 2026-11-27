import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  getPerformance,
  getPerformanceWeeks,
  type Performance,
  type PerformanceFigures,
  type PerformancePeriod,
  type PerformanceWeeks,
} from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { ROLE_LABELS } from '../ui/RoleChip.js';
import { PageTitle } from '../ui/StaffShell.js';
import { WeekBars } from '../ui/WeekBars.js';
import { WeekLine, fmtMinutes } from '../ui/WeekLine.js';
import '../ui/staff.css';
import { FaultLine } from '../ui/FaultLine.js';

const PERIOD_LABELS: Readonly<Record<PerformancePeriod, string>> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
};

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const overOf = (f: Pick<PerformanceFigures, 'overturned' | 'cases'>) => `${f.overturned} of ${f.cases}`;

/**
 * Moderator performance (Plan 4 Task 20, board StaffPerformance; spec 6.6, the owner only, perm
 * `perf.read`): per staff member over the period, cases, the typical first reply and time to
 * ruling, rulings overturned on appeal (amber when any), the share replied to within the deadline
 * and open cases. "Show chart" opens that person's last 8 weeks: cases per week as bars, the
 * typical first reply per week as a line against the first-response deadline, a hover readout and
 * "Show as table". The board's coaching paragraph is example copy and is not rendered (Task 20).
 * No trader appears anywhere on the page: the API sends staff names, roles and numbers only.
 */
export function StaffPerformance() {
  const [period, setPeriod] = useState<PerformancePeriod>('30d');
  const [data, setData] = useState<Performance | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<PerformanceWeeks | null>(null);
  const [table, setTable] = useState(false);
  const periodId = useId();
  // The person whose chart is wanted now: a late answer for someone else is dropped.
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    getPerformance(period)
      .then((d) => {
        if (!live) return;
        setData(d);
        setFault(null);
      })
      .catch((e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the figures just now. Reload to try again.')); // COPY-UNSIGNED
      });
    return () => {
      live = false;
    };
  }, [period]);

  const show = useCallback((id: string | null) => {
    wanted.current = id;
    setPick(id);
    setWeeks(null);
    if (id === null) return;
    getPerformanceWeeks(id)
      .then((w) => {
        if (wanted.current === id) setWeeks(w);
      })
      .catch((e: unknown) => {
        if (wanted.current === id) setFault(faultText(e, 'X2F could not load the chart just now. Try again.')); // COPY-UNSIGNED
      });
  }, []);

  return (
    <section data-screen="staff-performance" className="x2f-perf">
      <PageTitle title="Moderator performance">
        <p className="x2f-staff-page__lead">How quickly and how well each person handles disputes. Use it for coaching, pay and deciding who becomes a senior moderator.</p>
      </PageTitle>
      {fault !== null ? (
        <Notice tone="danger" data-part="performance-fault">
          {/* DESIGN: owner 17 Nov black+orange rule: the load fault's retry is the orange text button. */}
          <FaultLine text={fault} />
        </Notice>
      ) : null}
      <div className="x2f-perf__filters">
        <label htmlFor={periodId} className="x2f-sr-only">
          Period
        </label>
        <select id={periodId} className="x2f-select x2f-perf__period" value={period} onChange={(e) => setPeriod(e.target.value as PerformancePeriod)}>
          {(Object.keys(PERIOD_LABELS) as PerformancePeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="x2f-perf__scroll">
        <table className="x2f-staff-table x2f-perf__table" aria-label="Moderator performance">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col" data-num="">Cases</th>
              <th scope="col" data-num="">Typical first reply</th>
              <th scope="col" data-num="">Typical time to ruling</th>
              <th scope="col" data-num="">Overturned on appeal</th>
              <th scope="col" data-num="">Replied within deadline</th>
              <th scope="col" data-num="">Open now</th>
              <th scope="col">
                <span className="x2f-sr-only">Chart</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data !== null && data.people.length === 0 ? (
              <tr>
                <td colSpan={9} className="x2f-staff-table__empty">
                  {/* COPY-UNSIGNED */}
                  No one handles disputes yet.
                </td>
              </tr>
            ) : null}
            {(data?.people ?? []).map((p) => {
              const on = pick === p.id;
              return (
                <tr key={p.id} data-part="performance-row" data-on={on ? 'true' : undefined}>
                  <td data-mono="" className="x2f-perf__name" id={`perf-${p.id}`}>
                    {p.name}
                  </td>
                  <td className="x2f-perf__role">{ROLE_LABELS[p.role]}</td>
                  <td data-mono="" data-num="">
                    {String(p.cases)}
                  </td>
                  <td data-mono="" data-num="">
                    {fmtMinutes(p.firstReplyMin)}
                  </td>
                  <td data-mono="" data-num="">
                    {fmtMinutes(p.rulingMin)}
                  </td>
                  <td data-mono="" data-num="" data-part="overturned" data-tone={p.overturned > 0 ? 'caution' : undefined}>
                    {overOf(p)}
                  </td>
                  <td data-mono="" data-num="">
                    {pct(p.withinDeadlinePct)}
                  </td>
                  <td data-mono="" data-num="">
                    {String(p.open)}
                  </td>
                  <td data-num="">
                    <button type="button" className="x2f-perf__toggle" aria-pressed={on} aria-describedby={`perf-${p.id}`} onClick={() => show(on ? null : p.id)}>
                      {on ? 'Hide chart' : 'Show chart'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pick !== null && weeks !== null && weeks.id === pick ? (
        <section className="x2f-perf__panel" aria-label={`${weeks.name} charts`} data-part="performance-panel">
          <div className="x2f-perf__panel-head">
            <h2 className="x2f-perf__panel-title">
              <span className="x2f-perf__mono">{weeks.name}</span>, last 8 weeks
            </h2>
            <Button variant="secondary" onClick={() => setTable((t) => !t)}>
              {table ? 'Show as charts' : 'Show as table'}
            </Button>
          </div>
          <dl className="x2f-perf__totals">
            <div>
              <dt>Cases</dt>
              <dd>{String(weeks.summary.cases)}</dd>
            </div>
            <div>
              <dt>Overturned on appeal</dt>
              <dd>{overOf(weeks.summary)}</dd>
            </div>
            <div>
              <dt>Replied within deadline</dt>
              <dd>{pct(weeks.summary.withinDeadlinePct)}</dd>
            </div>
            {/* Revisions 2026-10-29 and 2026-10-29c (owner): Task 20 reports the 24-hour goal, the
                48-hour deadline and the appeals' 48-hour goal. No board draws them yet
                (DESIGNER-REVIEW): three more figures in the board's row. COPY-UNSIGNED */}
            <div>
              <dt>Settled within 24 h</dt>
              <dd>{pct(weeks.summary.settledWithinGoalPct)}</dd>
            </div>
            <div>
              <dt>Settled within 48 h</dt>
              <dd>{pct(weeks.summary.settledWithinDeadlinePct)}</dd>
            </div>
            <div>
              <dt>Appeals decided within 48 h</dt>
              <dd>{weeks.summary.appeals === 0 ? '—' : `${pct(weeks.summary.appealsWithinGoalPct)} of ${weeks.summary.appeals}`}</dd>
            </div>
          </dl>
          {table ? (
            <table className="x2f-staff-table" aria-label={`${weeks.name}, last 8 weeks`} data-part="weeks-table">
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col" data-num="">Cases</th>
                  <th scope="col" data-num="">Typical first reply</th>
                </tr>
              </thead>
              <tbody>
                {weeks.weeks.map((w) => (
                  <tr key={w.start}>
                    <td>{w.weekOf}</td>
                    <td data-mono="" data-num="">
                      {String(w.cases)}
                    </td>
                    <td data-mono="" data-num="">
                      {fmtMinutes(w.firstReplyMin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="x2f-perf__charts">
              <WeekBars who={weeks.name} weeks={weeks.weeks} />
              <WeekLine who={weeks.name} weeks={weeks.weeks} deadlineH={weeks.firstResponseH} />
            </div>
          )}
        </section>
      ) : null}

      <p className="x2f-perf__foot">Typical means the middle value, so one slow case doesn&apos;t skew it.</p>
    </section>
  );
}
