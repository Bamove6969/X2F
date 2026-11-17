import { useEffect, useState } from 'react';
import { revenue, type RevenueBucket, type RevenueReport } from '../api.js';
import { faultText } from '../refusals.js';
import { xmrText } from '../ui/ClockOut.js';
import { Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';

// DESIGN: needs drawing. NEEDS_DESIGN_REVENUE: no board draws the owner's books yet (StaffOverview's
// revenue card, growth, payroll and treasury are design's); plain kit pieces and StaffLog's table
// styles until then. Every sentence on this page is draft copy. COPY-UNSIGNED

/** The books are exact: all 12 places. */
const xmr = (atomic: string) => xmrText(atomic, 12);

/**
 * The owner's Revenue page, from `GET /staff/v1/revenue?by=month` (perm `earnings.read`, the
 * owner's alone; Overview, where it is linked, is the owner's alone too). Owner 16 Nov: each
 * receiver pays the network fee for its own payout output, X2F's fee output too, so the books show
 * the fees, the network fees X2F's fee outputs paid and the net after them: to date (every day
 * ever booked) and by month (the API's default twelve months). Read once on opening.
 */
export function Revenue() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
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
    </section>
  );
}
