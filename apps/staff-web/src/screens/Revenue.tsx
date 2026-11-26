import { useEffect, useState } from 'react';
import { earnings, revenue, type EarningsMonth, type EarningsReport, type EarningsWallet, type RevenueBucket, type RevenueReport } from '../api.js';
import { faultText } from '../refusals.js';
import { usdText, xmrText } from '../ui/ClockOut.js';
import { Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';

// DESIGN: needs drawing. NEEDS_DESIGN_REVENUE: no board draws the owner's books yet (StaffOverview's
// revenue card, growth, payroll and treasury are design's); plain kit pieces and StaffLog's table
// styles until then. Every sentence on this page is draft copy. COPY-UNSIGNED

/** The books are exact: all 12 places. */
const xmr = (atomic: string) => xmrText(atomic, 12);

/** `2026-11-20T11:50:00.000Z` as `2026-11-20 11:50 UTC`. */
const utcText = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

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
 */
export function Revenue() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [earned, setEarned] = useState<EarningsReport | null>(null);
  const [earnedFault, setEarnedFault] = useState<string | null>(null);

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
        if (live) setFault(faultText(e, 'X2F could not load the revenue just now. Open the page again to try again.'));
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
          {fault}
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
      <h2 className="x2f-h2">Arrived in X2F's wallets, by UTC month</h2>
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
          <Table<EarningsMonth>
            label="Arrived by month"
            rows={earned.months.length === 0 ? [] : [...earned.months, earned.allTime]}
            rowKey={(r) => r.month}
            empty="Nothing has arrived yet."
            columns={[
              { title: 'Month (UTC)', cell: (r) => (r.month === 'all-time' ? 'All time' : r.month), mono: true },
              { title: 'Fee wallet', cell: (r) => xmr(r.feeWalletAtomic), mono: true },
              { title: 'Payroll wallet', cell: (r) => xmr(r.payrollWalletAtomic), mono: true },
              { title: 'Received', cell: (r) => xmr(r.earnedAtomic), mono: true },
              { title: 'USD at today\'s price', cell: (r) => (r.usdEstimateCents === null ? 'No price' : usdText(r.usdEstimateCents)), mono: true },
              { title: 'Booked, after network fees', cell: (r) => xmr(r.bookedNetAtomic), mono: true },
              { title: 'Trades', cell: (r) => String(r.trades), mono: true },
              { title: 'Moved from the payroll wallet', cell: (r) => xmr(r.sweptInAtomic), mono: true },
            ]}
          />
          <p className="x2f-staff-page__lead" data-part="earnings-note">
            Received is what reached the two wallets from trades. What the payroll wallet moved to the fee wallet is shown on its own and not counted twice.
          </p>
        </>
      ) : null}
    </section>
  );
}
