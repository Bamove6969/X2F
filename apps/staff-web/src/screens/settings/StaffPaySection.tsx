import { useEffect, useState } from 'react';
import { staffPay, type StaffPayRow } from '../../api.js';
import { faultText } from '../../refusals.js';
import { Notice } from '../../ui/kit.js';
import { ROLE_LABELS } from '../../ui/RoleChip.js';
import { Table, type Column } from '../../ui/Table.js';
import { xmrText } from '../staffFormat.js';
import { SettingsCard } from './sectionKit.js';

/**
 * Plan 4 Task 33 (D-041..D-045, clawback option A): what each staff member has earned and not yet
 * been paid (`GET /staff/v1/pay/staff`, earnings.read: the owner). Read only: pay moves only at a
 * correct clock-out. A member whose clawbacks are bigger than what they earned since owes X2F, and
 * the row says so. NEEDS_DESIGN_CLOCK_OUT: no board draws it. Words: COPY-UNSIGNED (all of C).
 */
const C = {
  title: 'Staff pay owed',
  lead: 'Unpaid pay since each person last clocked out correctly. Dispute pay is in US dollars, paid in XMR at the clock-out price; large-trade shares and clawbacks are in XMR.',
  label: 'Pay owed per person',
  cols: { name: 'Name', role: 'Role', status: 'Status', usd: 'Unpaid, USD', xmr: 'Unpaid, XMR', owes: 'Balance' },
  active: 'Active',
  off: 'Switched off',
  owes: 'Owes X2F',
  due: 'Due at clock-out',
  none: 'Nothing due',
  empty: 'No staff yet.',
  loadFault: 'X2F could not load staff pay just now. Reload to try again.',
} as const;

/** Signed US cents as dollars and cents ("$12.50", "-$3.00"). */
export function centsText(cents: string): string {
  const v = BigInt(cents);
  const a = v < 0n ? -v : v;
  const whole = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0n ? '-' : ''}$${whole}.${(a % 100n).toString().padStart(2, '0')}`;
}

const COLUMNS: readonly Column<StaffPayRow>[] = [
  { title: C.cols.name, cell: (r) => <span data-username="">{r.displayName}</span> },
  { title: C.cols.role, cell: (r) => ROLE_LABELS[r.role] },
  { title: C.cols.status, cell: (r) => (r.switchedOff ? C.off : C.active) },
  { title: C.cols.usd, cell: (r) => centsText(r.unpaidUsdCents), mono: true },
  { title: C.cols.xmr, cell: (r) => xmrText(r.unpaidAtomic), mono: true },
  {
    title: C.cols.owes,
    cell: (r) => (r.owed ? <strong data-part="pay-owed">{C.owes}</strong> : BigInt(r.unpaidUsdCents) === 0n && BigInt(r.unpaidAtomic) === 0n ? C.none : C.due),
  },
];

export function StaffPaySection() {
  const [rows, setRows] = useState<StaffPayRow[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  useEffect(() => {
    staffPay().then((r) => setRows(r.members), (e: unknown) => setFault(faultText(e, C.loadFault)));
  }, []);
  return (
    <SettingsCard label={C.title} lead={C.lead} part="staff-pay">
      {fault !== null ? (
        <Notice tone="danger" data-part="staff-pay-fault">
          {fault}
        </Notice>
      ) : null}
      {rows !== null ? (
        <div className="x2f-staff-scroll">
          <Table label={C.label} columns={COLUMNS} rows={rows} rowKey={(r) => r.staffId} empty={C.empty} />
        </div>
      ) : null}
    </SettingsCard>
  );
}
