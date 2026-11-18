import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useParams } from 'react-router';
import { trainingCase, trainingList, type ScrubbedText, type TrainingCase, type TrainingItem } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';
import { describeLog } from './logModel.js';
import { OUTCOME_LABELS, reasonText, xmrShort } from './modModel.js';

// No board (A8; NEEDS_DESIGN, Claude Design owns the look): StaffLog's table styles. DESIGNER-REVIEW
// Every sentence on these pages is draft copy. COPY-UNSIGNED

/**
 * Plan 4 Task 19, as Revision 2026-10-29b changed it: the training library is the closed dispute
 * records themselves, read through the anonymizer (no stored copy). The list shows the closing month,
 * method, amount (rounded by the API to 2 significant figures, review m1) and outcome; a case shows the dispute's reason, the opener's note, each ruling with
 * its reason and evidence, the appeal, and how the case ran, every text already scrubbed by the API
 * and every mask marked. NEEDS_P4_CHAT_MEMBERSHIP: the chat is not here yet.
 */
export function Training() {
  return (
    <Routes>
      <Route index element={<TrainingList />} />
      <Route path=":id" element={<TrainingCaseView />} />
    </Routes>
  );
}

const outcomeText = (o: string | null) => (o !== null && Object.hasOwn(OUTCOME_LABELS, o) ? OUTCOME_LABELS[o as keyof typeof OUTCOME_LABELS] : 'No ruling');

function TrainingList() {
  const [items, setItems] = useState<TrainingItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    trainingList().then(
      (p) => {
        if (!live) return;
        setItems(p.items);
        setNext(p.next);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the training library just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const older = async () => {
    if (next === null) return;
    try {
      const p = await trainingList(next);
      setItems((cur) => [...(cur ?? []), ...p.items]);
      setNext(p.next);
    } catch (e) {
      setFault(faultText(e, 'X2F could not load older cases. Try again.'));
    }
  };

  return (
    <section data-screen="training">
      <PageTitle title="Training library">
        <p className="x2f-staff-page__lead">
          {/* Review m6: no purge period is promised until Task 23 deletes dispute records (NEEDS_P4_TASK23). COPY-UNSIGNED */}
          Closed disputes, with the traders, staff, trade code and private details taken out. Use them to learn how cases are decided. Amounts are rounded.
        </p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {items !== null ? (
        <Table
          label="Training cases"
          rows={items}
          rowKey={(r) => r.id}
          empty="No closed cases yet."
          columns={[
            { title: 'Closed', cell: (r) => r.closedMonth, mono: true },
            { title: 'Method', cell: (r) => r.methodName },
            { title: 'Amount', cell: (r) => `about ${xmrShort(r.xmr)} XMR`, mono: true },
            { title: 'Outcome', cell: (r) => `${outcomeText(r.outcome)}${r.overturned ? ' (overruled on appeal)' : ''}` },
            {
              title: 'Case',
              cell: (r) => (
                <Link className="x2f-link" to={`/training/${r.id}`}>
                  Read the case
                </Link>
              ),
            },
          ]}
        />
      ) : null}
      {next !== null ? (
        <Button variant="secondary" onClick={() => void older()}>
          Show older cases
        </Button>
      ) : null}
    </section>
  );
}

/** A scrubbed text with each mask marked (`mark[data-mask]`), so the reader sees what was taken out. */
export function Masked({ s }: { s: ScrubbedText }): ReactNode {
  const parts: ReactNode[] = [];
  let at = 0;
  const masks = [...s.masks].sort((a, b) => a.start - b.start);
  masks.forEach((m, i) => {
    if (m.start < at || m.end > s.text.length) return;
    parts.push(<Fragment key={`t${i}`}>{s.text.slice(at, m.start)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className="x2f-staff-mask" data-mask={m.kind}>
        {s.text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  });
  parts.push(<Fragment key="end">{s.text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

const SIDE = (s: string) => (s === 'buyer' ? 'The buyer' : s === 'seller' ? 'The seller' : 'X2F');

function TrainingCaseView() {
  const { id = '' } = useParams();
  const [c, setC] = useState<TrainingCase | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    trainingCase(id).then(
      (v) => {
        if (live) setC(v);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load this case. It may have been deleted. Go back to the library.'));
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <section data-screen="training-case">
      <PageTitle title="Training case">
        <p className="x2f-staff-page__lead">
          <Link className="x2f-link" to="/training">
            Back to the training library
          </Link>
        </p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {c !== null ? (
        <div className="x2f-staff-training">
          <p className="x2f-staff-training__facts">
            <span data-mono="">{c.tradeCode}</span>
            {` · ${c.methodName} · about ${xmrShort(c.xmr)} XMR · closed in ${c.closedMonth} (${c.closedAt} after it opened)`}
          </p>
          <h2 className="x2f-h2">The dispute</h2>
          <p>{`${SIDE(c.openedBy)} opened it${c.afterRefund ? ' after the refund' : ''}: ${reasonText(c.openedBy, c.reason)}.`}</p>
          {c.note !== null ? (
            <blockquote className="x2f-staff-training__quote">
              <Masked s={c.note} />
            </blockquote>
          ) : null}
          <Notice tone="info" data-part="no-chat">
            The trade chat is not in the library yet. It will be shown here, with the same details taken out, once staff devices can open dispute chats.
          </Notice>
          {c.rulings.map((r) => (
            <div key={r.round} className="x2f-staff-training__ruling">
              <h2 className="x2f-h2">{r.round === 1 ? 'The ruling' : 'The appeal ruling'}</h2>
              <p>{`${outcomeText(r.outcome)}, at ${r.at}.`}</p>
              <blockquote className="x2f-staff-training__quote">
                <Masked s={r.reason} />
              </blockquote>
              {r.evidence.length > 0 ? (
                <ul className="x2f-staff-training__evidence" aria-label="What the moderator relied on">
                  {r.evidence.map((e, i) => (
                    <li key={i}>
                      <Masked s={e} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          {c.appeal !== null ? (
            <div className="x2f-staff-training__ruling">
              <h2 className="x2f-h2">The appeal</h2>
              <p>{`${SIDE(c.appeal.by)} appealed at ${c.appeal.at}.`}</p>
              <blockquote className="x2f-staff-training__quote">
                <Masked s={c.appeal.why} />
              </blockquote>
            </div>
          ) : null}
          {c.overturned ? <p>The appeal overruled the first decision.</p> : null}
          <h2 className="x2f-h2">How the case ran</h2>
          <Table
            label="How the case ran"
            rows={c.timeline.map((t, i) => ({ ...t, i }))}
            rowKey={(r) => String(r.i)}
            empty="Nothing was logged on this case."
            columns={[
              { title: 'When', cell: (r) => r.at, mono: true },
              { title: 'Who', cell: (r) => r.who },
              { title: 'What happened', cell: (r) => describeLog({ action: r.action, detail: {}, actor: { kind: 'system', role: null, id: null, name: null } }) },
            ]}
          />
        </div>
      ) : null}
    </section>
  );
}
