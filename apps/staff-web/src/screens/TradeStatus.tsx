import { useEffect, useRef, useState } from 'react';
import { tradeStatus, writeOffLien, type TradeAuditRow, type TradeAuditStatus, type TradeStatusPage } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { xmrText } from '../ui/ClockOut.js';
import { Button, CantDoThat, Notice } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table, type Column } from '../ui/Table.js';
import '../ui/staff.css';
import { FaultLine } from '../ui/FaultLine.js';

/**
 * Owner 26 Nov 2026: every trade not deleted yet, by status (`GET /staff/v1/trades/status`,
 * log.read.all: the owner), newest first, 50 a page. A trade with an unpaid lien has no delete date;
 * the owner can write its lien off as uncollectible here (tap `lien-uncollectible`), which ends the
 * lien (any ban stays) and gives the trade its delete date back, 90 days on. Linked from Overview.
 * No board draws it (DESIGNER-REVIEW). Words: COPY-UNSIGNED (all of C).
 */
const C = {
  title: 'Trade status',
  lead: 'Every trade that has not been deleted yet. A trade with an unpaid lien is never deleted until the lien is repaid or you mark it uncollectible.',
  all: 'All',
  status: { lien: 'Lien unpaid', uncollectible: 'Uncollectible', disputed: 'In dispute', open: 'Open', completed: 'Completed', closed: 'Refunded or cancelled' } as Record<TradeAuditStatus, string>,
  cols: { code: 'Trade', status: 'Status', taken: 'Taken', closed: 'Closed', xmr: 'XMR', deletes: 'Deletes on', lien: 'Lien' },
  never: 'Not while the lien is unpaid',
  none: 'No date yet',
  writeOff: 'Mark uncollectible',
  tapTitle: (code: string) => `Write off the lien on ${code}`,
  tapBody: 'The debt is written off: no more recovery from their trades. Any ban stays as it is. Tap your security key to confirm.',
  more: 'Older trades',
  empty: 'No trades with this status.',
  label: 'Trades',
  loadFault: 'X2F could not load the trades just now. Reload to try again.',
  saveFault: 'The lien was not written off. Try again.',
  lienWords: { active: 'Unpaid', suspended: 'Paused', repaid: 'Repaid', void: 'Void', uncollectible: 'Written off' } as Record<string, string>,
  lienEnded: 'Ended',
} as const;
// not-a-refusal: the status filter values, not a refusal code.
const FILTERS: ReadonlyArray<TradeAuditStatus | null> = [null, 'lien', 'uncollectible', 'disputed', 'open', 'completed', 'closed'];
const day = (iso: string | null) => (iso === null ? '' : iso.slice(0, 10));

export function TradeStatus() {
  const [filter, setFilter] = useState<TradeAuditStatus | null>(null);
  const [counts, setCounts] = useState<TradeStatusPage['counts'] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TradeAuditRow[]>([]);
  // Each load's number: an answer that is not the latest one asked for is dropped.
  const seq = useRef(0);
  const [fault, setFault] = useState<string | null>(null);
  const [writing, setWriting] = useState<{ code: string; lienId: string } | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const load = (status: TradeAuditStatus | null, before: string | null) => {
    const mine = ++seq.current;
    setLoading(true);
    return tradeStatus(status, before).then(
      (p) => {
        if (mine !== seq.current) return;
        setCounts(p.counts);
        setNext(p.next);
        setFault(null);
        setRows((r) => {
          if (before === null) return p.trades;
          const have = new Set(r.map((t) => t.code));
          return [...r, ...p.trades.filter((t) => !have.has(t.code))];
        });
        setLoading(false);
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        setFault(faultText(e, C.loadFault));
        setLoading(false);
      },
    );
  };
  useEffect(() => {
    setRows([]);
    setNext(null);
    void load(filter, null);
    return () => {
      seq.current++;
    };
  }, [filter]);

  const writeOff = async (tapId: string) => {
    const w = writing;
    setWriting(null);
    if (w === null) return;
    try {
      await writeOffLien(w.lienId, tapId);
      await load(filter, null);
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else setFault(faultText(e, C.saveFault));
    }
  };

  const columns: readonly Column<TradeAuditRow>[] = [
    { title: C.cols.code, cell: (t) => t.code, mono: true },
    { title: C.cols.status, cell: (t) => <span data-status={t.status}>{C.status[t.status]}</span> },
    { title: C.cols.taken, cell: (t) => day(t.takenAt), mono: true },
    { title: C.cols.closed, cell: (t) => day(t.closedAt), mono: true },
    { title: C.cols.xmr, cell: (t) => xmrText(t.amountAtomic), mono: true },
    // not-a-refusal: compares the trade's status, not a refusal code.
    { title: C.cols.deletes, cell: (t) => (t.deleteAt !== null ? day(t.deleteAt) : t.status === 'lien' ? C.never : C.none), mono: true },
    {
      title: C.cols.lien,
      cell: (t) => {
        const open = t.liens.find((l) => l.status === 'active' || l.status === 'suspended');
        return open ? (
          <Button variant="secondary" onClick={() => setWriting({ code: t.code, lienId: open.id })}>{C.writeOff}</Button>
        ) : (
          t.liens.map((l) => C.lienWords[l.status] ?? C.lienEnded).join(', ')
        );
      },
    },
  ];

  return (
    <div className="x2f-stack" data-screen="trade-status">
      <PageTitle title={C.title} />
      <p className="x2f-staff-page__lead">{C.lead}</p>
      <div className="x2f-row" role="group" aria-label="Status">
        {FILTERS.map((f) => (
          <Button key={f ?? 'all'} variant="secondary" aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {`${f === null ? C.all : C.status[f]}${counts ? ` (${f === null ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[f]})` : ''}`}
          </Button>
        ))}
      </div>
      {/* DESIGN: owner 17 Nov black+orange rule: the load fault's retry is the orange text button. */}
      {fault !== null ? (
        <Notice tone="danger" data-part="trade-status-fault">
          <FaultLine text={fault} />
        </Notice>
      ) : null}
      <div className="x2f-staff-scroll">
        <Table label={C.label} columns={columns} rows={rows} rowKey={(t) => t.code} empty={C.empty} />
      </div>
      {next !== null ? (
        <Button variant="secondary" disabled={loading} onClick={() => void load(filter, next)}>{C.more}</Button>
      ) : null}
      {writing !== null ? (
        <KeyTapDialog
          intent={{ kind: 'lien-uncollectible', lienId: writing.lienId }}
          title={C.tapTitle(writing.code)}
          body={C.tapBody}
          onDone={(tapId) => void writeOff(tapId)}
          onCancel={() => setWriting(null)}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </div>
  );
}
