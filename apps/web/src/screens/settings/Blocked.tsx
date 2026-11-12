/**
 * Settings → Blocked traders (Plan 3 Task 37, spec 2.4), after Claude Design's Block board (the
 * settings view): what blocking does, then the people I blocked, newest first. Unblock keeps the
 * row ("Unblocked. They can see your offers again.") with "Block <name> again" as the undo, and
 * announces the change (role="status"); the row's one button stays in place, so focus stays on it
 * (review M2). A row leaves only when the server confirms it is gone (review M1): a 404 is checked
 * by reading the list again; any other failure keeps the row and says so. Kit parts only.
 *
 * S-093 (owner p7-6, 8 Nov 2026): each row shows when the person was blocked (date and time) and my
 * own private note, which I add, change or clear in place ("Add a note" / "Edit note", Save,
 * Cancel). Only I ever see it, and unblocking deletes it (the row says so). After Undo the row
 * shows the server's new block, with no note (review M1). DESIGN: not drawn (the Block board has no
 * note); COPY-UNSIGNED.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { BLOCK_NOTE_MAX, blockTrader, fetchBlocked, setBlockNote, unblockTrader, type BlockedEntry } from './blockApi.js';
import { BLOCK_COPY as C } from './blockCopy.js';
import '../screens.css';

type Row = BlockedEntry & { unblocked: boolean };

export function Blocked() {
  const session = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const signedIn = session.status === 'signed-in';

  const load = useCallback(async () => {
    setRows((await fetchBlocked()).map((e) => ({ ...e, unblocked: false })));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void load().catch(() => setLoadFailed(true));
  }, [load, signedIn]);

  const mark = (name: string, unblocked: boolean) => setRows((l) => (l ?? []).map((r) => (r.displayName === name ? { ...r, unblocked } : r)));

  const unblock = async (name: string) => {
    try {
      await unblockTrader(name);
      mark(name, true);
      setSaid(C.unblocked(name));
    } catch (e) {
      // A 404 means no account has that name now: drop the row only if the server's list agrees.
      if (e instanceof ApiCallError && e.status === 404) {
        const now = await fetchBlocked().catch(() => null);
        if (now !== null && !now.some((x) => x.displayName === name)) {
          setRows((l) => (l ?? []).filter((r) => r.displayName !== name));
          return;
        }
      }
      setError(C.unblockFailed(name));
    }
  };

  const reblock = async (name: string) => {
    try {
      await blockTrader(name);
    } catch {
      setError(C.failed(name));
      return;
    }
    // Review M1: the unblock deleted the row and its note, and this block is a new row (no note, a
    // new time). Show the server's row, keeping every other row (and its undo) as it is; if the list
    // cannot be read, at least drop the deleted note.
    const now = await fetchBlocked().catch(() => null);
    const fresh = now?.find((x) => x.displayName === name);
    setRows((l) => (l ?? []).map((r) => (r.displayName === name ? { ...r, ...(fresh ?? { note: null }), unblocked: false } : r)));
    setSaid(C.reblocked(name));
  };

  const toggle = async (r: Row) => {
    if (busy !== null) return;
    setBusy(r.displayName);
    setError(null);
    setSaid('');
    try {
      await (r.unblocked ? reblock(r.displayName) : unblock(r.displayName));
    } finally {
      setBusy(null);
    }
  };

  const saveNote = async (name: string, text: string): Promise<boolean> => {
    setError(null);
    setSaid('');
    try {
      const note = await setBlockNote(name, text);
      setRows((l) => (l ?? []).map((r) => (r.displayName === name ? { ...r, note } : r)));
      setSaid(note === null ? C.noteRemoved(name) : C.noteSaved(name));
      return true;
    } catch {
      setError(C.noteFailed(name));
      return false;
    }
  };

  const still = (rows ?? []).filter((r) => !r.unblocked).length;

  return (
    <main className="x2f-screen" data-screen="blocked">
      <h1 className="x2f-screen__title" id="blocked-h">
        {C.title}
      </h1>
      <section className="x2f-card" data-part="blocked-what" aria-labelledby="blocked-what-h">
        <h2 className="x2f-card__title" id="blocked-what-h">
          {C.whatTitle}
        </h2>
        <ul className="x2f-sheet__body">
          {C.what.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="x2f-note">{C.whatNote}</p>
      </section>
      <section className="x2f-card" data-part="blocked" aria-labelledby="blocked-h">
        {session.status === 'signed-out' ? (
          <>
            <p className="x2f-note">{C.signedOut}</p>
            {/* The kit's secondary button look on a router link (no new CSS). */}
            <Link className="x2f-button x2f-button--secondary" to="/login?returnTo=%2Fsettings%2Fblocked">
              Log in
            </Link>
          </>
        ) : null}
        {loadFailed ? (
          <p className="x2f-error" role="alert">
            {C.loadFailed}
          </p>
        ) : null}
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        {/* Always mounted, so the polite announcement is read when its text changes. */}
        <p className="x2f-note" role="status" data-part="blocked-said">
          {said}
        </p>
        {rows !== null && rows.length === 0 ? (
          <p className="x2f-note" data-part="blocked-empty">
            {C.empty}
          </p>
        ) : null}
        {rows !== null && rows.length > 0 ? (
          <>
            <h2 className="x2f-card__title" data-part="blocked-count">
              {C.count(still)}
            </h2>
            <ul className="x2f-list" data-part="blocked-list">
              {rows.map((r) => (
                <li className="x2f-list__row" key={r.displayName} data-unblocked={r.unblocked ? 'true' : 'false'}>
                  <span className="x2f-list__label">
                    <span data-username="">{r.displayName}</span>
                    <br />
                    <span className="x2f-list__time">{r.unblocked ? C.unblockedRow : C.blockedOn(r.blockedAt)}</span>
                    {!r.unblocked ? <BlockNote name={r.displayName} note={r.note} save={saveNote} /> : null}
                  </span>
                  <Button
                    variant="secondary"
                    // Not `disabled`: disabling the focused button would drop focus to the page.
                    aria-disabled={busy !== null}
                    aria-label={r.unblocked ? C.undo(r.displayName) : C.unblock(r.displayName)}
                    onClick={() => void toggle(r)}
                    data-part="unblock"
                  >
                    {r.unblocked ? C.undoButton : C.unblockButton}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </main>
  );
}

/** S-093: one row's private note, shown, or edited in place (Save stores it; Cancel keeps it as it was). */
function BlockNote({ name, note, save }: { name: string; note: string | null; save: (name: string, text: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (editing) box.current?.focus();
  }, [editing]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (await save(name, text)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="x2f-field" data-part="note-form">
        <label className="x2f-label" htmlFor={id}>
          {C.noteLabel(name)}
        </label>
        <textarea
          ref={box}
          className="x2f-input x2f-textarea"
          id={id}
          rows={3}
          maxLength={BLOCK_NOTE_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-part="note-text"
        />
        <span className="x2f-note">{C.notePrivate}</span>
        <span className="x2f-row">
          <Button variant="secondary" aria-disabled={saving} onClick={() => void submit()} data-part="note-save">
            {C.noteSave}
          </Button>
          <Button variant="quiet" onClick={() => setEditing(false)} data-part="note-cancel">
            {C.noteCancel}
          </Button>
        </span>
      </span>
    );
  }
  return (
    <>
      {note !== null ? (
        <>
          <br />
          <span className="x2f-note" data-part="block-note">
            {note}
          </span>
          <br />
          <span className="x2f-note">{C.notePrivate}</span>
          <br />
          <span className="x2f-note" data-part="note-unblock-warning">
            {C.noteGoesOnUnblock}
          </span>
        </>
      ) : null}
      <br />
      <Button
        variant="quiet"
        onClick={() => {
          setText(note ?? '');
          setEditing(true);
        }}
        data-part="note-edit"
      >
        {note === null ? C.noteAdd : C.noteEdit}
      </Button>
    </>
  );
}
