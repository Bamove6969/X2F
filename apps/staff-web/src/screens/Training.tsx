import { applyManualMasks, can } from '@x2f/staff';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useParams } from 'react-router';
import {
  StaffApiError, markTrainingCase, trainingCase, trainingList, trainingReviewCase, trainingReviewList, unmarkTrainingCase,
  type ManualMask, type ScrubbedText, type TrainingCase, type TrainingItem, type TrainingReviewCase, type TrainingReviewItem, type TrainingStatus,
} from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle, useMe } from '../ui/StaffShell.js';
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
 * Lead call 18 Nov (re-review): review-first. Only cases a curator (`training.curate`, the owner)
 * has marked are listed; the curator's pages (`/training/review`) show every closed case with its
 * status, and one case's texts pre-masked, where the curator hides more by selecting it (or a whole
 * text) and marks the case.
 */
export function Training() {
  return (
    <Routes>
      <Route index element={<TrainingList />} />
      <Route path="review" element={<TrainingReview />} />
      <Route path="review/:id" element={<TrainingReviewCaseView />} />
      <Route path=":id" element={<TrainingCaseView />} />
    </Routes>
  );
}

const outcomeText = (o: string | null) => (o !== null && Object.hasOwn(OUTCOME_LABELS, o) ? OUTCOME_LABELS[o as keyof typeof OUTCOME_LABELS] : 'No ruling');

function TrainingList() {
  const me = useMe();
  const curator = me !== null && can(me.role, 'training.curate');
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
          Closed disputes the owner has reviewed, with the traders, staff, trade code and private details taken out. Use them to learn how cases are decided. Amounts are rounded.
        </p>
        {curator ? (
          <p>
            <Link className="x2f-link" to="/training/review">
              Review closed cases
            </Link>
          </p>
        ) : null}
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {items !== null ? (
        <Table
          label="Training cases"
          rows={items}
          rowKey={(r) => r.id}
          empty="No training cases yet."
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

// ---------------------------------------------------------------------------------------------
// The curator's review (lead call 18 Nov, re-review): every closed case with its status, and one
// case's texts pre-masked, where the curator hides more and marks the case.

const STATUS_TEXT: Readonly<Record<TrainingStatus, string>> = {
  unmarked: 'Not in the library',
  marked: 'In the library',
  stale: 'Hidden: review the masks again',
};

function TrainingReview() {
  const [items, setItems] = useState<TrainingReviewItem[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    trainingReviewList().then(
      (p) => {
        if (live) setItems(p.items);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the closed cases just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <section data-screen="training-review">
      <PageTitle title="Review closed cases">
        <p className="x2f-staff-page__lead">
          A closed case reaches the training library only after you review it. X2F hides the details it recognizes; you hide anything else that could identify someone, then mark the case.
        </p>
        <p>
          <Link className="x2f-link" to="/training">
            Back to the training library
          </Link>
        </p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {items !== null ? (
        <Table
          label="Closed cases"
          rows={items}
          rowKey={(r) => r.id}
          empty="No closed cases yet."
          columns={[
            { title: 'Closed', cell: (r) => r.closedMonth, mono: true },
            { title: 'Method', cell: (r) => r.methodName },
            { title: 'Amount', cell: (r) => `about ${xmrShort(r.xmr)} XMR`, mono: true },
            { title: 'Outcome', cell: (r) => `${outcomeText(r.outcome)}${r.overturned ? ' (overruled on appeal)' : ''}` },
            { title: 'Status', cell: (r) => STATUS_TEXT[r.status] },
            {
              title: 'Case',
              cell: (r) => (
                <Link className="x2f-link" to={`/training/review/${r.id}`}>
                  Review the case
                </Link>
              ),
            },
          ]}
        />
      ) : null}
    </section>
  );
}

const REVIEW_STATUS: Readonly<Record<TrainingStatus, string>> = {
  unmarked: 'This case is not in the training library. X2F hid the details it recognized (marked below). Hide anything else that could identify someone, then mark the case.',
  marked: 'This case is in the training library.',
  stale: 'The masks saved for this case no longer fit its texts, so it is hidden from the library. Review them again and mark the case.', // not-a-refusal: the case's curation status, not a refused action
};

/** What each field of a case is, for the curator. */
function fieldLabel(key: string): string {
  if (key === 'note') return "The opener's note";
  if (key === 'appeal') return 'The appeal';
  const m = /^ruling\.(\d+)\.(reason|evidence)(?:\.(\d+))?$/.exec(key);
  if (m === null) return key;
  const which = m[1] === '1' ? 'The ruling' : 'The appeal ruling';
  return m[2] === 'reason' ? `${which}: its reason` : `${which}: what the moderator relied on (${Number(m[3]) + 1})`;
}

/** The selection's offsets inside `box`'s text, or null when nothing in it is selected. */
function selectionIn(box: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!box.contains(r.startContainer) || !box.contains(r.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(box);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  const end = start + r.toString().length;
  return end > start ? { start, end } : null;
}

/** A pre-masked text with the automatic masks and the curator's ranges marked (the text itself unchanged, so offsets stay). */
function ReviewText({ s, ranges, whole }: { s: ScrubbedText; ranges: Array<{ start: number; end: number }>; whole: boolean }): ReactNode {
  if (whole) {
    return (
      <mark className="x2f-staff-mask" data-mask="manual">
        {s.text}
      </mark>
    );
  }
  const all = [...s.masks.map((m) => ({ ...m })), ...ranges.map((r) => ({ ...r, kind: 'manual' }))].sort((a, b) => a.start - b.start);
  return <Masked s={{ text: s.text, masks: all }} />;
}

function TrainingReviewCaseView() {
  const { id = '' } = useParams();
  const [c, setC] = useState<TrainingReviewCase | null>(null);
  const [masks, setMasks] = useState<ManualMask[]>([]);
  const [status, setStatus] = useState<TrainingStatus>('unmarked');
  const [fault, setFault] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const boxes = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    let live = true;
    trainingReviewCase(id).then(
      (v) => {
        if (!live) return;
        setC(v);
        setMasks(v.manual);
        setStatus(v.status);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load this case. It may have been deleted. Go back to the closed cases.'));
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  const rangesOf = (field: string) => masks.filter((m): m is Extract<ManualMask, { start: number }> => m.field === field && 'start' in m);
  const isWhole = (field: string) => masks.some((m) => m.field === field && 'whole' in m);

  const hideSelection = (field: string) => {
    const box = boxes.current.get(field);
    const s = c?.fields[field];
    if (!box || !s) return;
    const sel = selectionIn(box);
    if (sel === null) {
      setHint('Select the text to hide first.');
      return;
    }
    try {
      // The same check the API makes: no overlap, nothing cut out of an automatic mask.
      const auto = { text: s.text, masks: s.masks.map((m) => ({ start: m.start, end: m.end, kind: 'manual' as const })) };
      applyManualMasks(auto, [...rangesOf(field), sel].map(({ start, end }) => ({ start, end })));
    } catch {
      setHint('Select whole words outside the marked details. A selection cannot overlap another one or cut into a marked detail.'); // not-a-refusal: a hint about the selection, nothing was sent
      return;
    }
    setHint(null);
    setMasks((cur) => [...cur, { field, start: sel.start, end: sel.end }]);
    window.getSelection()?.removeAllRanges();
  };
  const toggleWhole = (field: string) =>
    setMasks((cur) => (cur.some((m) => m.field === field && 'whole' in m) ? cur.filter((m) => !(m.field === field && 'whole' in m)) : [...cur, { field, whole: true }]));
  const clear = (field: string) => setMasks((cur) => cur.filter((m) => m.field !== field));

  const mark = async () => {
    try {
      if (c === null) return;
      await markTrainingCase(id, masks, c.reviewTag);
      setStatus('marked');
      setFault(null);
    } catch (e) {
      // Re-review 3 m1: the texts changed after the case was opened; the masks were not saved.
      if (e instanceof StaffApiError && e.code === 'case-changed') setFault('This case changed after you opened it. Reload it and review it again.');
      else setFault(faultText(e, 'X2F could not mark this case. Reload it and try again.'));
    }
  };
  const unmark = async () => {
    try {
      await unmarkTrainingCase(id);
      setStatus('unmarked');
      setFault(null);
    } catch (e) {
      setFault(faultText(e, 'X2F could not take this case out of the library. Try again.'));
    }
  };

  return (
    <section data-screen="training-review-case">
      <PageTitle title="Review a closed case">
        <p className="x2f-staff-page__lead">
          <Link className="x2f-link" to="/training/review">
            Back to the closed cases
          </Link>
        </p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {c !== null ? (
        <div className="x2f-staff-training">
          <Notice tone={status === 'stale' ? 'danger' : 'info'} data-part="review-status">
            {REVIEW_STATUS[status]}
          </Notice>
          <p className="x2f-staff-training__facts">
            <span data-mono="">{c.tradeCode}</span>
            {` · ${c.methodName} · about ${xmrShort(c.xmr)} XMR · closed in ${c.closedMonth}`}
          </p>
          {hint !== null ? <Notice tone="danger">{hint}</Notice> : null}
          {Object.entries(c.fields).map(([field, s]) => (
            <div key={field} className="x2f-staff-training__ruling" data-field={field}>
              <h2 className="x2f-h2">{fieldLabel(field)}</h2>
              <blockquote
                className="x2f-staff-training__quote"
                data-part="field-text"
                ref={(el) => {
                  if (el) boxes.current.set(field, el);
                }}
              >
                <ReviewText s={s} ranges={rangesOf(field)} whole={isWhole(field)} />
              </blockquote>
              <p>
                <Button variant="secondary" onClick={() => hideSelection(field)}>
                  Hide the selected text
                </Button>{' '}
                <Button variant="secondary" onClick={() => toggleWhole(field)}>
                  {isWhole(field) ? 'Show this text again' : 'Hide this whole text'}
                </Button>{' '}
                {masks.some((m) => m.field === field) ? (
                  <Button variant="secondary" onClick={() => clear(field)}>
                    Undo my masks here
                  </Button>
                ) : null}
              </p>
            </div>
          ))}
          <p>
            <Button variant="primary" onClick={() => void mark()}>
              Mark as training case
            </Button>{' '}
            {status !== 'unmarked' ? (
              <Button variant="secondary" onClick={() => void unmark()}>
                Take it out of the library
              </Button>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
