import { useEffect, useId, useState } from 'react';
import { decideReviewDispute, reviewDisputes, type ReviewDisputeItem, type ReviewDisputeOutcome } from '../api.js';
import { faultText, refusalOf } from '../refusals.js';
import { Button, ChoiceGroup, EmptyState, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import '../ui/staff.css';

// Plan 5 Task 19 (Revision 2026-10-29b, owner). No board yet (NEEDS_DESIGN; Claude Design owns the
// look): built from the kit with the staff pages' classes. DESIGNER-REVIEW: where the page sits (under
// Disputes, /disputes/reviews, with a link from the queue) is a lead default.
// Every sentence on this page is draft copy. COPY-UNSIGNED

/** The moderator's shortest reason (apps/api/src/reviews/disputes.ts DECISION_REASON_MIN). */
export const DECISION_REASON_MIN = 20;

const OUTCOMES: readonly { value: ReviewDisputeOutcome; label: string; note: string }[] = [
  { value: 'stands', label: 'Let it stand', note: 'The review counts again, as it is.' },
  { value: 'comments-removed', label: 'Remove some comments', note: 'Remove the note, phrases or trade badges you pick. The stars stay.' },
  // not-a-refusal: what the outcome does to the review, not a rule stopping the moderator
  { value: 'removed', label: 'Remove the review', note: 'It no longer shows or counts anywhere.' },
];

const SIDE = { buyer: 'the buyer', seller: 'the seller' } as const;

function rating(r: ReviewDisputeItem['review']): string {
  return r.neutral || r.stars === null ? 'Neutral' : `${r.stars} ${r.stars === 1 ? 'star' : 'stars'}`;
}

/** The decision form for one dispute (the page's one primary action). */
function Decide({ item, onDone }: { item: ReviewDisputeItem; onDone: () => void }) {
  const [outcome, setOutcome] = useState<ReviewDisputeOutcome | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(false);
  const [phrases, setPhrases] = useState<string[]>([]);
  const [badges, setBadges] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const reasonId = useId();
  const groupId = useId();
  const text = reason.trim();
  const removesSomething = note || phrases.length > 0 || badges.length > 0;
  const ready = outcome !== null && [...text].length >= DECISION_REASON_MIN && (outcome !== 'comments-removed' || removesSomething);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    if (!ready || busy || outcome === null) return;
    setBusy(true);
    setFault(null);
    try {
      await decideReviewDispute(item.id, {
        outcome,
        reason: text,
        ...(outcome === 'comments-removed' ? { remove: { note, phrases, tradeBadges: badges } } : {}),
      });
      onDone();
    } catch (e) {
      setFault(refusalOf(e)?.text ?? faultText(e, 'X2F could not save the decision. Reload and try again.'));
      setBusy(false);
    }
  };

  const r = item.review;
  return (
    <div className="x2f-stack" data-part="decide">
      <h3 className="x2f-h2" id={groupId}>
        Your decision
      </h3>
      <ChoiceGroup look="card" labelledBy={groupId} part="outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} disabled={busy} />
      {outcome === 'comments-removed' ? (
        <fieldset className="x2f-stack" data-part="remove">
          <legend>What to remove</legend>
          {r.note !== null ? (
            <label>
              <input type="checkbox" checked={note} onChange={() => setNote(!note)} /> The note
            </label>
          ) : null}
          {r.phrases.map((p) => (
            <label key={`p-${p}`}>
              <input type="checkbox" checked={phrases.includes(p)} onChange={() => toggle(phrases, setPhrases, p)} /> {p}
            </label>
          ))}
          {r.tradeBadges.map((b) => (
            <label key={`b-${b}`}>
              <input type="checkbox" checked={badges.includes(b)} onChange={() => toggle(badges, setBadges, b)} /> {b}
            </label>
          ))}
        </fieldset>
      ) : null}
      <label htmlFor={reasonId} className="x2f-field-label">
        Why (at least {DECISION_REASON_MIN} characters, seen by staff only)
      </label>
      <textarea id={reasonId} className="x2f-input" rows={4} maxLength={1000} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
        Save decision
      </Button>
    </div>
  );
}

/**
 * Review disputes (Plan 5 Task 19 on the staff API, perm `reputation.review`): the reviews traders
 * disputed, oldest first. Each shows the review as the public sees it (stars, phrases, trade badges,
 * note, method, month), which side wrote it and the trader's reason; never a name. While the trade
 * still exists its code is shown; once it was deleted (30 days after it ended) there is no chat to
 * read, and the decision rests on the review and the reason. One dispute is open for a decision at a
 * time, so the page has one primary action.
 */
export function ReviewDisputes() {
  const [items, setItems] = useState<ReviewDisputeItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    reviewDisputes().then(
      (r) => {
        if (!live) return;
        setItems(r.items);
        setNext(r.next);
        setOpen(r.items[0]?.id ?? null);
      },
      (e: unknown) => {
        if (live) setFault(refusalOf(e)?.text ?? faultText(e, 'X2F could not load the review disputes just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const older = async () => {
    if (items === null || next === null) return;
    try {
      const r = await reviewDisputes(next);
      setItems([...items, ...r.items]);
      setNext(r.next);
    } catch (e) {
      setFault(faultText(e, 'X2F could not load older disputes. Try again.'));
    }
  };

  const done = (id: string) => {
    const rest = (items ?? []).filter((i) => i.id !== id);
    setItems(rest);
    setOpen(rest[0]?.id ?? null);
    setSaved(true);
  };

  return (
    <section data-screen="review-disputes">
      <PageTitle title="Review disputes">
        <p className="x2f-staff-page__lead">
          Reviews that the trader they are about has disputed. Until you decide, the review shows &quot;Under review&quot; and does not count in their stats.
        </p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {saved ? (
        <p role="status" className="x2f-note" data-part="decision-saved">
          Decision saved.
        </p>
      ) : null}
      {items !== null && items.length === 0 ? (
        <EmptyState icon="shield" title="No review disputes are waiting" data-part="no-review-disputes">
          When a trader disputes a review of them, it shows here.
        </EmptyState>
      ) : null}
      {items !== null && items.length > 0 ? (
        <ul className="x2f-stack" data-part="review-disputes">
          {items.map((i) => (
            <li key={i.id} className="x2f-card" data-part="review-dispute" data-open={open === i.id ? 'true' : 'false'}>
              <p className="x2f-note">
                {rating(i.review)} · {i.review.age} · {i.review.method} · written by {SIDE[i.review.reviewerRole]}
              </p>
              {i.review.phrases.length + i.review.tradeBadges.length > 0 ? <p>{[...i.review.phrases, ...i.review.tradeBadges].join(' · ')}</p> : null}
              {i.review.note !== null ? <p data-part="review-note">{i.review.note}</p> : null}
              <p className="x2f-note">The trader&apos;s reason</p>
              <p data-part="dispute-reason">{i.reason}</p>
              <p className="x2f-note" data-part="trade-line">
                {i.tradeCode !== null ? `Trade ${i.tradeCode}` : 'The trade was deleted (30 days after it ended). Decide on the review and the reason.'}
              </p>
              {open === i.id ? (
                <Decide key={i.id} item={i} onDone={() => done(i.id)} />
              ) : (
                <Button variant="secondary" onClick={() => setOpen(i.id)}>
                  Decide this one
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {next !== null ? (
        <Button variant="quiet" onClick={() => void older()}>
          Show older
        </Button>
      ) : null}
    </section>
  );
}
