import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { staffAudit, type StaffAudit, type StaffAuditItem } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { ROLE_LABELS } from '../ui/RoleChip.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table, type Column } from '../ui/Table.js';
import { fmtMinutes } from '../ui/WeekLine.js';
import { centsText } from './settings/StaffPaySection.js';
import { xmrText } from './staffFormat.js';
import '../ui/staff.css';
import { FaultLine } from '../ui/FaultLine.js';

/**
 * Owner 26 Nov 2026: one staff member's work and hours, for the owner's audit
 * (`GET /staff/v1/pay/staff/:id/audit`, earnings.read: the owner). Their shifts with how long each
 * lasted and how it ended, every pay item with the case, the round, the amount and where it stands
 * (unpaid, waiting to send, paid), and the totals over the period. What they
 * did in each case is in the activity log, linked filtered to them. No board draws it
 * (DESIGNER-REVIEW). Words: COPY-UNSIGNED (all of C).
 */
const C = {
  title: (name: string) => `Work and hours: ${name}`,
  back: 'Back to performance',
  periods: [7, 30, 90, 365] as const,
  period: (d: number) => (d === 365 ? 'Last year' : `Last ${d} days`),
  totals: 'Totals',
  hours: 'Time logged in',
  shifts: 'Shifts',
  clockOuts: 'Clocked out correctly',
  disputes: 'Disputes ruled',
  appeals: 'Appeals decided',
  earned: 'Earned',
  clawedBack: 'Taken back',
  shiftsTitle: 'Shifts',
  shiftCols: { start: 'Logged in', end: 'Ended', how: 'How it ended', length: 'Length' },
  ended: { 'clock-out': 'Clocked out', 'auto-logout': 'Logged out automatically', ended: 'Logged out' } as Record<string, string>,
  open: 'Still logged in',
  payTitle: 'Pay per case',
  payCols: { when: 'Earned', what: 'For', trade: 'Trade', round: 'Round', usd: 'USD', xmr: 'XMR', status: 'Where it stands' },
  kinds: { dispute: 'Dispute pay', 'fee-share': 'Share of the fee', 'large-trade': 'Large-trade share', clawback: 'Taken back (overruled)' } as Record<string, string>,
  rounds: { 1: 'Ruling', 2: 'Appeal' } as Record<number, string>,
  status: { unpaid: 'Due at next clock-out', 'waiting-send': 'Sending', paid: 'Paid', failed: 'Send failed' } as Record<string, string>,
  log: 'See everything they did in the activity log',
  empty: 'Nothing in this period.',
  loadFault: 'X2F could not load this just now. Reload to try again.',
} as const;

const when = (iso: string | null) => (iso === null ? '' : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);

const SHIFT_COLUMNS: readonly Column<StaffAudit['shifts'][number]>[] = [
  { title: C.shiftCols.start, cell: (s) => when(s.clockedInAt), mono: true },
  { title: C.shiftCols.end, cell: (s) => (s.endedAt === null ? C.open : when(s.endedAt)), mono: true },
  { title: C.shiftCols.how, cell: (s) => (s.ended === null ? C.open : (C.ended[s.ended] ?? s.ended)) },
  { title: C.shiftCols.length, cell: (s) => fmtMinutes(s.minutes), mono: true },
];

const PAY_COLUMNS: readonly Column<StaffAuditItem>[] = [
  { title: C.payCols.when, cell: (i) => when(i.earnedAt), mono: true },
  { title: C.payCols.what, cell: (i) => C.kinds[i.kind] ?? i.kind },
  { title: C.payCols.trade, cell: (i) => i.code ?? '', mono: true },
  { title: C.payCols.round, cell: (i) => C.rounds[i.round] ?? '' },
  { title: C.payCols.usd, cell: (i) => (i.usdCents === null ? '' : centsText(i.usdCents)), mono: true },
  { title: C.payCols.xmr, cell: (i) => (i.atomic === null ? '' : xmrText(i.atomic)), mono: true },
  { title: C.payCols.status, cell: (i) => <span data-status={i.status}>{C.status[i.status] ?? i.status}</span> },
];

export function StaffWork() {
  const { id = '' } = useParams();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<StaffAudit | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  useEffect(() => {
    setFault(null);
    staffAudit(id, days).then(setData, (e: unknown) => setFault(faultText(e, C.loadFault)));
  }, [id, days]);
  const t = data?.totals;
  return (
    <div className="x2f-stack" data-screen="staff-work">
      <PageTitle title={data ? C.title(data.displayName) : C.title('')} />
      <Link to="/performance">{C.back}</Link>
      <div className="x2f-row" role="group" aria-label="Period">
        {C.periods.map((d) => (
          <Button key={d} variant="secondary" aria-pressed={d === days} onClick={() => setDays(d)}>
            {C.period(d)}
          </Button>
        ))}
      </div>
      {/* DESIGN: owner 17 Nov black+orange rule: the load fault's retry is the orange text button. */}
      {fault !== null ? (
        <Notice tone="danger" data-part="work-fault">
          <FaultLine text={fault} />
        </Notice>
      ) : null}
      {data && t ? (
        <>
          <section className="x2f-card x2f-stack" aria-label={C.totals} data-part="work-totals">
            <h2>{`${C.totals} · ${ROLE_LABELS[data.role]}`}</h2>
            <dl className="x2f-stack">
              <div><dt>{C.hours}</dt><dd data-total="minutes">{fmtMinutes(t.minutes)}</dd></div>
              <div><dt>{C.shifts}</dt><dd data-total="shifts">{t.shifts}</dd></div>
              <div><dt>{C.clockOuts}</dt><dd data-total="clock-outs">{t.clockOuts}</dd></div>
              <div><dt>{C.disputes}</dt><dd data-total="disputes">{t.disputes}</dd></div>
              <div><dt>{C.appeals}</dt><dd data-total="appeals">{t.appeals}</dd></div>
              <div><dt>{C.earned}</dt><dd data-total="earned">{`${centsText(t.earnedUsdCents)} + ${xmrText(t.earnedAtomic)} XMR`}</dd></div>
              <div><dt>{C.clawedBack}</dt><dd data-total="clawed-back">{`${centsText(t.clawedBackUsdCents)} + ${xmrText(t.clawedBackAtomic)} XMR`}</dd></div>
            </dl>
            <Link to={`/log?actor=${encodeURIComponent(data.staffId)}`}>{C.log}</Link>
          </section>
          <section className="x2f-stack" aria-label={C.payTitle}>
            <h2>{C.payTitle}</h2>
            <div className="x2f-staff-scroll">
              <Table label={C.payTitle} columns={PAY_COLUMNS} rows={data.items} rowKey={(i) => `${i.kind}-${i.code}-${i.seq}-${i.round}-${i.earnedAt}`} empty={C.empty} />
            </div>
          </section>
          <section className="x2f-stack" aria-label={C.shiftsTitle}>
            <h2>{C.shiftsTitle}</h2>
            <div className="x2f-staff-scroll">
              <Table label={C.shiftsTitle} columns={SHIFT_COLUMNS} rows={data.shifts} rowKey={(s) => s.clockedInAt} empty={C.empty} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
