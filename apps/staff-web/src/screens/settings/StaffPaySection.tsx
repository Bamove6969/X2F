import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { putStaffPay, staffPay, type StaffPayRow } from '../../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../../refusals.js';
import { Button, CantDoThat, Notice } from '../../ui/kit.js';
import { KeyTapDialog } from '../../ui/KeyTapDialog.js';
import { ROLE_LABELS } from '../../ui/RoleChip.js';
import { Table, type Column } from '../../ui/Table.js';
import { xmrText } from '../staffFormat.js';
import { SettingsCard } from './sectionKit.js';

/**
 * Plan 4 Task 33 (D-041..D-045, clawback option A): what each staff member has earned and not yet
 * been paid (`GET /staff/v1/pay/staff`, earnings.read: the owner). Read only: pay moves only at a
 * correct clock-out. A member whose clawbacks are bigger than what they earned since owes X2F, and
 * the row says so. NEEDS_DESIGN_CLOCK_OUT: no board draws it. Words: COPY-UNSIGNED (all of C).
 *
 * Owner 26 Nov 2026: each moderator's and senior moderator's share of X2F's 1% fee is shown and set
 * here per person ("Share of the fee"), with a tap bound to the person and the value (`staff-pay`).
 * Empty means their role's default from the pay settings above.
 */
const C = {
  title: 'Staff pay owed',
  lead: 'Unpaid pay since each person last clocked out correctly. Dispute pay is in US dollars, paid in XMR at the clock-out price; large-trade shares and clawbacks are in XMR.',
  label: 'Pay owed per person',
  cols: { name: 'Name', role: 'Role', status: 'Status', share: 'Share of the fee', usd: 'Unpaid, USD', xmr: 'Unpaid, XMR', owes: 'Balance', work: 'Audit' },
  work: 'Work and hours',
  roleDefault: 'role default',
  notSet: 'Not set',
  change: 'Change',
  shareTitle: (name: string) => `${name}'s share of the fee`,
  shareHelp: "Percent of X2F's 1% fee on each trade whose dispute they rule, 0 to 100. Leave it empty to use their role's default.",
  // not-a-refusal: input help shown beside the field while it does not read as a percent; it stops nobody.
  shareBad: 'Type a percent from 0 to 100, with at most two decimals, or leave it empty.',
  save: 'Save',
  cancel: 'Cancel',
  tapTitle: (name: string) => `Change ${name}'s pay`,
  tapBody: 'Tap your security key to save this share of the fee.',
  saveFault: 'The share was not saved. Try again.',
  saved: 'Saved. It applies to disputes completed from now on.',
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

/** Basis points of the fee as a percent ("40", "12.5"). */
export function bpText(bp: number): string {
  return `${String(bp / 100)}%`;
}

/** A typed percent as basis points: '' = null (the role's default); undefined when it does not read as 0-100 with two decimals. */
export function bpOf(s: string): number | null | undefined {
  const t = s.trim().replace(/%$/, '').trim();
  if (t === '') return null;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const v = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return v <= 10_000 ? v : undefined;
}

const paidRole = (r: StaffPayRow) => r.role === 'mod' || r.role === 'senior';

function shareCell(r: StaffPayRow) {
  if (!paidRole(r)) return '';
  if (r.effectiveFeeBp === null) return C.notSet;
  return r.feeBp === null ? `${bpText(r.effectiveFeeBp)} (${C.roleDefault})` : bpText(r.effectiveFeeBp);
}

const COLUMNS: readonly Column<StaffPayRow>[] = [
  { title: C.cols.name, cell: (r) => <span data-username="">{r.tradeTag}</span> },
  { title: C.cols.role, cell: (r) => ROLE_LABELS[r.role] },
  { title: C.cols.status, cell: (r) => (r.switchedOff ? C.off : C.active) },
  { title: C.cols.share, cell: (r) => <span data-part="fee-share">{shareCell(r)}</span> },
  { title: C.cols.usd, cell: (r) => centsText(r.unpaidUsdCents), mono: true },
  { title: C.cols.xmr, cell: (r) => xmrText(r.unpaidAtomic), mono: true },
  {
    title: C.cols.owes,
    cell: (r) => (r.owed ? <strong data-part="pay-owed">{C.owes}</strong> : BigInt(r.unpaidUsdCents) === 0n && BigInt(r.unpaidAtomic) === 0n ? C.none : C.due),
  },
  { title: C.cols.work, cell: (r) => <Link to={`/performance/${encodeURIComponent(r.staffId)}/work`}>{C.work}</Link> },
];

/** One person's share, typed and saved with a tap. */
function ShareEditor({ row, onSaved }: { row: StaffPayRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(row.feeBp === null ? '' : String(row.feeBp / 100));
  const [tapping, setTapping] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const next = bpOf(draft);
  const save = async (tapId: string) => {
    setTapping(false);
    try {
      await putStaffPay(row.staffId, next ?? null, tapId);
      setSaved(true);
      setOpen(false);
      onSaved();
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else setFault(faultText(e, C.saveFault));
    }
  };
  if (!open) {
    return (
      <div className="x2f-stack" data-share-of={row.staffId}>
        <Button variant="secondary" onClick={() => { setOpen(true); setSaved(false); }}>{`${C.change}: ${row.tradeTag}`}</Button>
        {saved ? <Notice tone="plain" data-part="share-saved">{C.saved}</Notice> : null}
      </div>
    );
  }
  return (
    <fieldset className="x2f-card x2f-stack" data-share-of={row.staffId}>
      <legend><span data-username="">{C.shareTitle(row.tradeTag)}</span></legend>
      <label className="x2f-stack">
        <span>{C.shareHelp}</span>
        <input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={next === undefined} data-part="share-input" />
      </label>
      {next === undefined ? <Notice tone="danger" data-part="share-bad">{C.shareBad}</Notice> : null}
      {fault !== null ? <Notice tone="danger" data-part="share-fault">{fault}</Notice> : null}
      <div className="x2f-row">
        <Button variant="secondary" disabled={next === undefined || next === row.feeBp || tapping} onClick={() => setTapping(true)}>{C.save}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>{C.cancel}</Button>
      </div>
      {tapping && next !== undefined ? (
        <KeyTapDialog
          intent={{ kind: 'staff-pay', accountId: row.staffId, feeBp: next }}
          title={C.tapTitle(row.tradeTag)}
          body={C.tapBody}
          labels={{ accountId: row.tradeTag }}
          onDone={(tapId) => void save(tapId)}
          onCancel={() => setTapping(false)}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </fieldset>
  );
}

export function StaffPaySection() {
  const [rows, setRows] = useState<StaffPayRow[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const load = () => staffPay().then((r) => setRows(r.members), (e: unknown) => setFault(faultText(e, C.loadFault)));
  useEffect(() => {
    void load();
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
      {rows !== null
        ? rows.filter((r) => paidRole(r) && !r.switchedOff).map((r) => <ShareEditor key={r.staffId} row={r} onSaved={() => void load()} />)
        : null}
    </SettingsCard>
  );
}
