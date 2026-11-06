import { useEffect, useState } from 'react';
import { formFeedback, moodFeedback, type FormItem, type MoodItem } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';

// No board yet (NEEDS_DESIGN; Claude Design owns the look): StaffLog's table styles. DESIGNER-REVIEW
// Every sentence on this page is draft copy. COPY-UNSIGNED

export const MOOD_LABELS: Readonly<Record<MoodItem['mood'], string>> = { great: 'Great', ok: 'OK', 'needs-work': 'Needs work' };
const KIND_LABELS: Readonly<Record<FormItem['kind'], string>> = { complaint: 'Complaint', feedback: 'Feedback', recommendation: 'Recommendation' };

interface Pages<T> {
  items: T[];
  next: string | null;
}

/**
 * The owner's Feedback page (Plan 5 Tasks 4 and 21 on the staff API, perm `feedback.read`): the
 * "How's X2F doing?" answers with their 30-day Great / OK / Needs work counts, and the feedback
 * form's messages (the "can't do that" popups link to it), each newest first, 50 a page with
 * "Show older". A message's sender shows only as "Named" or "Anonymous"; the account id is never
 * shown.
 */
export function Feedback() {
  const [moods, setMoods] = useState<Pages<MoodItem> | null>(null);
  const [counts, setCounts] = useState<{ great: number; ok: number; needsWork: number } | null>(null);
  const [forms, setForms] = useState<Pages<FormItem> | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([moodFeedback(), formFeedback()]).then(
      ([m, f]) => {
        if (!live) return;
        setMoods({ items: m.items, next: m.next });
        setCounts(m.counts);
        setForms({ items: f.items, next: f.next });
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the feedback just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const olderMoods = async () => {
    if (!moods?.next) return;
    try {
      const m = await moodFeedback(moods.next);
      setMoods({ items: [...moods.items, ...m.items], next: m.next });
    } catch (e) {
      setFault(faultText(e, 'X2F could not load older answers. Try again.'));
    }
  };
  const olderForms = async () => {
    if (!forms?.next) return;
    try {
      const f = await formFeedback(forms.next);
      setForms({ items: [...forms.items, ...f.items], next: f.next });
    } catch (e) {
      setFault(faultText(e, 'X2F could not load older messages. Try again.'));
    }
  };

  return (
    <section data-screen="feedback">
      <PageTitle title="Feedback">
        <p className="x2f-staff-page__lead">What traders tell X2F. Nothing here says who sent it.</p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <h2 className="x2f-h2">How's X2F doing?</h2>
      {counts !== null ? (
        <ul className="x2f-staff-counts" aria-label="Last 30 days" data-part="mood-counts">
          <li>
            <span className="x2f-staff-counts__n">{counts.great}</span>
            Great
          </li>
          <li>
            <span className="x2f-staff-counts__n">{counts.ok}</span>
            OK
          </li>
          <li>
            <span className="x2f-staff-counts__n">{counts.needsWork}</span>
            Needs work
          </li>
        </ul>
      ) : null}
      {moods !== null ? (
        <Table
          label="Answers"
          rows={moods.items}
          rowKey={(r) => r.id}
          empty="No answers yet."
          columns={[
            { title: 'Day', cell: (r) => r.createdOn, mono: true },
            { title: 'Answer', cell: (r) => MOOD_LABELS[r.mood] },
            { title: 'Note', cell: (r) => r.note ?? '' },
          ]}
        />
      ) : null}
      {moods?.next ? (
        <Button variant="secondary" onClick={() => void olderMoods()}>
          Show older answers
        </Button>
      ) : null}
      <h2 className="x2f-h2">Messages</h2>
      {forms !== null ? (
        <Table
          label="Messages"
          rows={forms.items}
          rowKey={(r) => r.id}
          empty="No messages yet."
          columns={[
            { title: 'Day', cell: (r) => r.createdOn, mono: true },
            { title: 'Kind', cell: (r) => KIND_LABELS[r.kind] },
            { title: 'From the popup', cell: (r) => r.from ?? '', mono: true },
            { title: 'Sender', cell: (r) => (r.accountId === null ? 'Anonymous' : 'Named') },
            { title: 'Message', cell: (r) => r.text },
          ]}
        />
      ) : null}
      {forms?.next ? (
        <Button variant="secondary" onClick={() => void olderForms()}>
          Show older messages
        </Button>
      ) : null}
    </section>
  );
}
