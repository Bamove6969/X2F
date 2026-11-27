import { useEffect, useState } from 'react';
import { earnings, earningsTallies, revenue, type EarningsMonth, type EarningsPeriod, type EarningsReport, type EarningsTallies, type EarningsTally, type EarningsWallet, type RevenueBucket, type RevenueReport } from '../api.js';
import { faultText } from '../refusals.js';
import { usdText, xmrText } from '../ui/ClockOut.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';
import { FaultLine } from '../ui/FaultLine.js';

const REVENUE_LOAD_FAULT = 'X2F could not load the revenue just now. Open the page again to try again.';

// DESIGN: needs drawing. NEEDS_DESIGN_REVENUE: no board draws the owner's books yet (StaffOverview's
// revenue card, growth, payroll and treasury are design's); plain kit pieces and StaffLog's table
// styles until then. Every sentence on this page is draft copy. COPY-UNSIGNED

/** The books are exact: all 12 places. */
const xmr = (atomic: string) => xmrText(atomic, 12);

/** `2026-11-20T11:50:00.000Z` as `2026-11-20 11:50 UTC`. */
const utcText = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** Owner 26 Nov 2026: the Day / Week / Month switch above the wallets' table. */
const PERIODS: ReadonlyArray<{ period: EarningsPeriod; label: string }> = [
  { period: 'day', label: 'Day' },
  { period: 'week', label: 'Week' },
  { period: 'month', label: 'Month' },
];

/** The column and table names for each period; the tallies are cut in UTC (no time zone is stored for the site). */
const PERIOD_TEXT: Record<EarningsPeriod, { heading: string; table: string; column: string; total: string }> = {
  day: { heading: 'by UTC day, the last 31 days', table: 'Arrived by day', column: 'Day (UTC)', total: 'Last 31 days' },
  week: { heading: 'by UTC week (Monday to Sunday), the last 12 weeks', table: 'Arrived by week', column: 'Week (UTC, from Monday)', total: 'Last 12 weeks' },
  month: { heading: 'by UTC month', table: 'Arrived by month', column: 'Month (UTC)', total: '' },
};

/** A row of the wallets' table, whichever period it is. */
type ArrivedRow = Omit<EarningsMonth, 'month'> & { key: string; label: string };

const monthRow = (r: EarningsMonth): ArrivedRow => ({ ...r, key: r.month, label: r.month === 'all-time' ? 'All time' : r.month });
/** `2026-W48` reads as `2026-W48 (23 Nov to 29 Nov)`: the week's own dates beside its ISO number. */
const tallyRow = (period: EarningsPeriod, r: EarningsTally): ArrivedRow => ({
  ...r,
  key: r.period,
  label: period === 'week' ? `${r.period} (${r.from} to ${r.to})` : r.period,
});

function arrivedRows(period: EarningsPeriod, month: EarningsReport, tallies: EarningsTallies | undefined): ArrivedRow[] | null {
  if (period === 'month') return month.months.length === 0 ? [] : [...month.months, month.allTime].map(monthRow);
  if (tallies === undefined) return null;
  return [...tallies.tallies.map((r) => tallyRow(period, r)), { ...tallies.total, key: tallies.total.period, label: PERIOD_TEXT[period].total }, monthRow(tallies.allTime)];
}

/** One wallet's line above the monthly table: which wallet, and how fresh its figures are. */
function walletLine(name: string, w: EarningsWallet | null, notSetUp: string): string {
  if (w === null) return notSetUp;
  const which = `${name} ending ${w.walletEnd}`;
  switch (w.state) {
    case 'syncing':
      return `${which}: reading the wallet. The figures appear once the first read is done.`;
    case 'ready':
      return `${which}: read at ${utcText(w.syncedAt ?? '')}.`;
    case 'stale':
      return `${which}: the last read failed. These figures are from ${utcText(w.syncedAt ?? '')}.`;
    case 'unavailable':
      return `${which}: the wallet has not been read yet. The next try is within 10 minutes.`;
  }
}

/**
 * The owner's Revenue page, from `GET /staff/v1/revenue?by=month` (perm `earnings.read`, the
 * owner's alone; Overview, where it is linked, is the owner's alone too). Owner 16 Nov: each
 * receiver pays the network fee for its own payout output, X2F's fee output too, so the books show
 * the fees, the network fees X2F's fee outputs paid and the net after them: to date (every day
 * ever booked) and by month (the API's default twelve months). Read once on opening.
 *
 * Below them (Plan 4 Task 9, `GET /staff/v1/earnings`): what arrived in the fee wallet (seen
 * through its view-only key) and the payroll wallet by UTC month, the sweeps between them apart,
 * beside the books' figure for the same month, so the owner can check one against the other.
 * Owner 26 Nov 2026: a Day / Week / Month switch above that table. Month is the report above (every
 * month); Day and Week read `?period=day|week` the first time they are picked (the last 31 days,
 * the last 12 weeks from Monday, every one listed), each with the window's total and all time.
 */
export function Revenue() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [earned, setEarned] = useState<EarningsReport | null>(null);
  const [earnedFault, setEarnedFault] = useState<string | null>(null);
  const [period, setPeriod] = useState<EarningsPeriod>('month');
  const [tallies, setTallies] = useState<Partial<Record<EarningsPeriod, EarningsTallies>>>({});
  const [talliesFault, setTalliesFault] = useState<string | null>(null);
  const [tallyAttempt, setTallyAttempt] = useState(0);

  useEffect(() => {
    if (period === 'month' || tallies[period] !== undefined) {
      setTalliesFault(null);
      return;
    }
    let live = true;
    setTalliesFault(null);
    earningsTallies(period).then(
      (r) => {
        if (live) setTallies((t) => ({ ...t, [period]: r }));
      },
      (e: unknown) => {
        if (live) setTalliesFault(faultText(e, 'X2F could not load these tallies just now. Pick the period again to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, [period, tallies, tallyAttempt]);

  useEffect(() => {
    let live = true;
    // Plan 4 Task 9: what arrived in the wallets, read apart so one failing never hides the other.
    earnings().then(
      (r) => {
        if (live) setEarned(r);
      },
      (e: unknown) => {
        if (live) setEarnedFault(faultText(e, 'X2F could not load what arrived in its wallets just now. Open the page again to try again.'));
      },
    );
    revenue().then(
      (r) => {
        if (live) setReport(r);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, REVENUE_LOAD_FAULT));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section data-screen="revenue">
      <PageTitle title="Revenue" />
      {fault !== null ? (
        <Notice tone="danger" data-part="revenue-fault">
          {/* DESIGN: owner 17 Nov black+orange rule: the load fault's retry is the orange text button. */}
          <FaultLine text={fault} reload={fault === REVENUE_LOAD_FAULT} />
        </Notice>
      ) : null}
      {report !== null ? (
        <>
          <Table<RevenueBucket>
            label="Revenue to date"
            rows={[report.toDate]}
            rowKey={(r) => r.period}
            columns={[
              { title: 'Fees to date', cell: (r) => xmr(r.totalAtomic), mono: true },
              { title: 'Monero network fees paid to date', cell: (r) => xmr(r.networkFeeAtomic), mono: true },
              { title: 'Net to date', cell: (r) => xmr(r.netAtomic), mono: true },
            ]}
          />
          {!report.treasuryNetworkFeesRecorded ? (
            <p className="x2f-staff-page__lead" data-part="treasury-fees">
              Monero network fees for fee sweeps and payroll payments are not recorded yet.
            </p>
          ) : null}
          <h2 className="x2f-h2">By month</h2>
          <Table
            label="Revenue by month"
            rows={report.buckets}
            rowKey={(r) => r.period}
            empty="No revenue yet."
            columns={[
              { title: 'Month', cell: (r) => r.period, mono: true },
              { title: 'Trades', cell: (r) => String(r.trades), mono: true },
              { title: 'Fees', cell: (r) => xmr(r.totalAtomic), mono: true },
              { title: 'Monero network fees paid', cell: (r) => xmr(r.networkFeeAtomic), mono: true },
              { title: 'Net', cell: (r) => xmr(r.netAtomic), mono: true },
            ]}
          />
        </>
      ) : null}
      <h2 className="x2f-h2">{`Arrived in X2F's wallets, ${PERIOD_TEXT[period].heading}`}</h2>
      {earnedFault !== null ? (
        <Notice tone="danger" data-part="earnings-fault">
          {earnedFault}
        </Notice>
      ) : null}
      {earned !== null ? (
        <>
          <p className="x2f-staff-page__lead" data-part="fee-wallet-state">
            {walletLine('Fee wallet', earned.feeWallet, 'The fee wallet has no view-only key on this server, so what arrived in it is not shown.')}
          </p>
          <p className="x2f-staff-page__lead" data-part="payroll-wallet-state">
            {walletLine('Payroll wallet', earned.payrollWallet, 'The payroll wallet is not connected on this server, so what arrived in it is not shown.')}
          </p>
          <div className="x2f-row" role="group" aria-label="Tally by" data-part="earnings-period">
            {PERIODS.map((p) => (
              <Button
                key={p.period}
                variant="secondary"
                aria-pressed={p.period === period}
                onClick={() => {
                  if (p.period === period && talliesFault !== null) setTallyAttempt((n) => n + 1);
                  else setPeriod(p.period);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          {period !== 'month' && talliesFault !== null ? (
            <Notice tone="danger" data-part="tallies-fault">
              {talliesFault}
            </Notice>
          ) : null}
          {(() => {
            const rows = arrivedRows(period, earned, tallies[period]);
            if (rows === null) return null;
            return (
              <Table<ArrivedRow>
                label={PERIOD_TEXT[period].table}
                rows={rows}
                rowKey={(r) => r.key}
                empty="Nothing has arrived yet."
                columns={[
                  { title: PERIOD_TEXT[period].column, cell: (r) => r.label, mono: true },
                  { title: 'Fee wallet', cell: (r) => xmr(r.feeWalletAtomic), mono: true },
                  { title: 'Payroll wallet', cell: (r) => xmr(r.payrollWalletAtomic), mono: true },
                  { title: 'Received', cell: (r) => xmr(r.earnedAtomic), mono: true },
                  { title: 'USD at today\'s price', cell: (r) => (r.usdEstimateCents === null ? 'No price' : usdText(r.usdEstimateCents)), mono: true },
                  { title: 'Booked, after network fees', cell: (r) => xmr(r.bookedNetAtomic), mono: true },
                  { title: 'Trades', cell: (r) => String(r.trades), mono: true },
                  { title: 'Moved from the payroll wallet', cell: (r) => xmr(r.sweptInAtomic), mono: true },
                ]}
              />
            );
          })()}
          <p className="x2f-staff-page__lead" data-part="earnings-note">
            Received is what reached the two wallets from trades. What the payroll wallet moved to the fee wallet is shown on its own and not counted twice.
          </p>
        </>
      ) : null}
    </section>
  );
}
