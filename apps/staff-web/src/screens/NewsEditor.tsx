import { newsPublishIntent, type KeyTapIntent } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import { codeOf, newsAdd, newsDelete, newsEdit, newsList } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Notice, NewsMessage, NewsPost, Sheet, type NewsItem } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { PageTitle } from '../ui/StaffShell.js';
import '../ui/staff.css';

// No board (DESIGNER-REVIEW); where it sits in the nav (under Overview) is not settled (OWNER-Q).
// Every sentence here is draft copy. COPY-UNSIGNED

/** The API's limits (apps/api news/store.ts). */
export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 4000;

/**
 * The owner writes, edits and deletes News for traders (Plan 4 Task 28; the staff API's
 * site.control routes, each change logged by the API). The preview is the trader view, "As traders
 * will see it" (design final call 10 Nov 2026): the News page's own post (apps/web NewsPost through the
 * kit), open and marked New, so the owner sees the message exactly as traders will.
 */
export function NewsEditor() {
  const titleId = useId();
  const bodyId = useId();
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [deleting, setDeleting] = useState<NewsItem | null>(null);
  // The preview post opens like the trader's; it starts open so the message is read at once.
  const [previewOpen, setPreviewOpen] = useState(true);
  // Review p4t22 m2 (lead default): publishing or editing a message takes the owner's key tap.
  const [tap, setTap] = useState<{ intent: KeyTapIntent; run: (tapId: string) => Promise<void> } | null>(null);

  const load = () =>
    newsList().then(
      (r) => setItems(r.items),
      (e: unknown) => setFault(faultText(e, 'X2F could not load the news just now. Reload to try again.')),
    );
  useEffect(() => {
    void load();
  }, []);

  const run = async (f: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setFault(null);
    setDone(null);
    try {
      await f();
      await load();
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else if (codeOf(e) === 'bad-request') setFault(`Check the title (up to ${NEWS_TITLE_MAX} characters) and the message (up to ${NEWS_BODY_MAX}).`);
      else setFault(faultText(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const draft = { title: title.trim(), body: body.trim() };
    const target = editing;
    setTap({
      // Bound to the title and the message exactly as sent (and to the message being edited).
      intent: newsPublishIntent({ newsId: target === null ? null : target.id, ...draft }),
      run: (tapId) =>
        run(async () => {
          if (target === null) await newsAdd(draft, tapId);
          else await newsEdit(target.id, draft, tapId);
          setDone(target === null ? 'Published. Traders see it in News.' : 'Saved. Traders see the new text in News.');
          setEditing(null);
          setTitle('');
          setBody('');
        }, 'That message was not saved. Try again.'),
    });
    return Promise.resolve();
  };

  const remove = (item: NewsItem) =>
    run(async () => {
      try {
        await newsDelete(item.id);
      } catch (e) {
        if (codeOf(e) !== 'not-found') throw e;
      }
      setDeleting(null);
      if (editing?.id === item.id) {
        setEditing(null);
        setTitle('');
        setBody('');
      }
      setDone('Deleted.');
    }, 'That message was not deleted. Try again.');

  const tooLong = title.length > NEWS_TITLE_MAX || body.length > NEWS_BODY_MAX;
  const empty = title.trim() === '' || body.trim() === '';
  const preview: NewsItem = { id: editing?.id ?? 0, title: title.trim() || 'Title', body: body.trim() || 'Your message.', publishedAt: editing?.publishedAt ?? new Date().toISOString(), editedAt: null };

  return (
    <section data-screen="news-editor">
      <PageTitle title="News for traders">
        <p className="x2f-staff-page__lead">Messages every trader sees in News, newest first. Each change is recorded in the activity log.</p>
      </PageTitle>
      <div className="x2f-stack">
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={titleId}>
            Title
          </label>
          <input id={titleId} className="x2f-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="x2f-staff-hint" data-part="title-count">{`${title.length} / ${NEWS_TITLE_MAX}`}</p>
        </div>
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={bodyId}>
            Message
          </label>
          <textarea id={bodyId} className="x2f-textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="x2f-staff-hint" data-part="body-count">{`${body.length} / ${NEWS_BODY_MAX}`}</p>
        </div>
        {/* COPY-UNSIGNED: "As traders will see it" (design final call 10 Nov 2026). */}
        <h2 className="x2f-h2">As traders will see it</h2>
        <div data-part="news-preview">
          <NewsPost item={preview} isNew open={previewOpen} onToggle={() => setPreviewOpen((o) => !o)} />
        </div>
        {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
        {done !== null ? <Notice tone="plain">{done}</Notice> : null}
        <Button variant="primary" disabled={busy || empty || tooLong} onClick={() => void save()}>
          {editing === null ? 'Publish' : 'Save changes'}
        </Button>
        {editing !== null ? (
          <Button
            variant="quiet"
            onClick={() => {
              setEditing(null);
              setTitle('');
              setBody('');
            }}
          >
            Cancel editing
          </Button>
        ) : null}
      </div>
      <h2 className="x2f-h2">Published</h2>
      {items !== null && items.length === 0 ? <p className="x2f-staff-hint">No news yet.</p> : null}
      <div className="x2f-stack" data-part="news-published">
        {(items ?? []).map((i) => (
          <div key={i.id} className="x2f-stack" data-part="news-row">
            <NewsMessage item={i} isNew={false} />
            <div className="x2f-row">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(i);
                  setTitle(i.title);
                  setBody(i.body);
                  setDone(null);
                }}
              >
                Edit
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setDeleting(i)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Sheet open={deleting !== null} title="Delete this message?" wide="dialog" onClose={() => setDeleting(null)}>
        <div className="x2f-stack">
          {/* not-a-refusal: says what deleting does, stops nobody. */}
          <p>Traders will no longer see it in News.</p>
          <Button variant="danger-outline" disabled={busy} onClick={() => deleting !== null && void remove(deleting)}>
            Delete
          </Button>
          <Button variant="quiet" onClick={() => setDeleting(null)}>
            Keep it
          </Button>
        </div>
      </Sheet>
      {tap !== null ? (
        <KeyTapDialog
          intent={tap.intent}
          // COPY-UNSIGNED
          title={editing === null ? 'Publish to News' : 'Save the edited message'}
          body="Tap your security key to publish this message to every trader."
          tapLabel="Tap key and publish"
          labels={{ titleSha256: 'the title above', bodySha256: 'the message above', newsId: 'the message you are editing' }}
          onDone={(tapId) => {
            const t = tap;
            setTap(null);
            void t.run(tapId);
          }}
          onCancel={() => setTap(null)}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}
