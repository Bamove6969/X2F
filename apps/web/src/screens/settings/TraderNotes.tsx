/**
 * Notes on traders (Job 1c, J-10; owner S-094, p7-8): the account's private notes on another
 * trader, wherever the account's team sees that trader (their profile, `/u/:name`, and the trade
 * room's counterparty). A Disclosure, closed at first: nothing is asked of the API until it opens,
 * and nobody looking over a shoulder reads a note by accident.
 *
 * Who does what is the API's (apps/api/src/team/notes.ts), mirrored from the session's boxes so no
 * control leads only to a refusal: the account owner reads, adds and deletes; a member reads with
 * "View notes on traders" and adds with "Add notes on traders"; no member deletes. A note is never
 * edited (migration 361: it is signed with its writer and time), so there is no Edit. A refusal the
 * API still sends (a box taken away meanwhile, the note cap) opens CantDoThat.
 *
 * No Claude Design board yet (NEEDS_DESIGN_TEAM): kit parts and existing classes only. COPY-UNSIGNED
 * (NOTES_COPY in teamCopy.ts).
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiCallError } from '../../api/client.js';
import { notesAccessOf, type NotesAccess } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat, isCantDoCode, type CantDoCode } from '../../ui/CantDoThat.js';
import { Disclosure } from '../../ui/Disclosure.js';
import { notesCantDoText, notesCantDoTitle } from '../../ui/cantDoCodes.js';
import { formatDateTime } from '../../ui/dates.js';
import { NOTE_MAX, addNote, deleteNote, fetchNotes, type TraderNote } from './teamApi.js';
import { NOTES_COPY as C } from './teamCopy.js';

type Load = { kind: 'loading' } | { kind: 'ok'; notes: TraderNote[] } | { kind: 'failed' };
type CantDo = { code: CantDoCode; max?: number };

function cantDoOf(e: unknown): CantDo | null {
  if (e instanceof ApiCallError && isCantDoCode(e.code)) {
    const max = e.extra.max;
    return { code: e.code, ...(typeof max === 'number' ? { max } : {}) };
  }
  return null;
}

function NotesBody({ tradeTag, access, id }: { tradeTag: string; access: NotesAccess; id: string }) {
  const [load, setLoad] = useState<Load>(access.view ? { kind: 'loading' } : { kind: 'ok', notes: [] });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [cantDo, setCantDo] = useState<CantDo | null>(null);
  const [tick, setTick] = useState(0);
  const boxId = useId();

  useEffect(() => {
    if (!access.view) return;
    const ctl = new AbortController();
    setLoad({ kind: 'loading' });
    fetchNotes(tradeTag, ctl.signal).then(
      (notes) => setLoad({ kind: 'ok', notes }),
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        const c = cantDoOf(e);
        if (c !== null) setCantDo(c);
        setLoad({ kind: 'failed' });
      },
    );
    return () => ctl.abort();
  }, [tradeTag, access.view, tick]);

  const fail = useCallback((e: unknown) => {
    const c = cantDoOf(e);
    if (c !== null) setCantDo(c);
    else setError(C.saveFailed);
  }, []);

  const save = async () => {
    if (busy) return;
    const t = text.trim();
    setSaid('');
    if (t === '') return setError(C.empty);
    if (Array.from(t).length > NOTE_MAX) return setError(C.tooLong(NOTE_MAX));
    setError(null);
    setBusy(true);
    try {
      const note = await addNote(tradeTag, t);
      setText('');
      setSaid(C.saved);
      if (access.view) setLoad((l) => (l.kind === 'ok' ? { kind: 'ok', notes: [note, ...l.notes] } : l));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: TraderNote) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaid('');
    try {
      await deleteNote(n.id);
      setAsking(null);
      setSaid(C.deleted);
      setLoad((l) => (l.kind === 'ok' ? { kind: 'ok', notes: l.notes.filter((x) => x.id !== n.id) } : l));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-stack" id={id} data-part="notes-panel" aria-label={C.summary(tradeTag)}>
      <p className="x2f-note">{C.privacy}</p>
      {access.view && load.kind === 'loading' ? <p className="x2f-note">{C.loading}</p> : null}
      {access.view && load.kind === 'failed' && cantDo === null ? (
        <>
          <p className="x2f-error" role="alert">
            {C.loadFailed}
          </p>
          <Button variant="secondary" onClick={() => setTick((n) => n + 1)} data-part="notes-retry">
            {C.retry}
          </Button>
        </>
      ) : null}
      {access.view && load.kind === 'ok' ? (
        load.notes.length === 0 ? (
          <p className="x2f-note" data-part="notes-empty">
            {C.none}
          </p>
        ) : (
          <ul className="x2f-list" data-part="notes-list">
            {load.notes.map((n) => (
              <li className="x2f-list__row" key={n.id} data-note={n.id}>
                <span className="x2f-list__label">
                  <span className="x2f-profile__note" data-part="note-text">
                    {n.text}
                  </span>
                  <br />
                  <span className="x2f-list__time" data-part="note-by">
                    {C.by(n.by, n.byLead, n.at)}
                  </span>
                </span>
                {access.remove ? (
                  asking === n.id ? (
                    <span className="x2f-stack" data-part="note-delete-ask">
                      <span className="x2f-note">{C.deleteAsk}</span>
                      <Button variant="danger" aria-disabled={busy} onClick={() => void remove(n)} data-part="note-delete-yes">
                        {C.deleteYes}
                      </Button>
                      <Button variant="quiet" onClick={() => setAsking(null)} data-part="note-delete-no">
                        {C.deleteNo}
                      </Button>
                    </span>
                  ) : (
                    <Button variant="quiet" aria-label={C.deleteLabel(formatDateTime(n.at))} onClick={() => setAsking(n.id)} data-part="note-delete">
                      {C.delete}
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {access.add ? (
        <div className="x2f-field" data-part="note-add">
          <label className="x2f-label" htmlFor={boxId}>
            {C.addLabel}
          </label>
          <textarea
            className="x2f-input x2f-textarea"
            id={boxId}
            rows={3}
            maxLength={NOTE_MAX}
            value={text}
            aria-describedby={`${boxId}-hint`}
            onChange={(e) => setText(e.target.value)}
            data-part="note-input"
          />
          <p className="x2f-note" id={`${boxId}-hint`}>
            {C.addHint(NOTE_MAX)}
          </p>
          <Button variant="secondary" aria-disabled={busy} onClick={() => void save()} data-part="note-save">
            {C.save}
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="notes-error">
          {error}
        </p>
      ) : null}
      <p className="x2f-note" role="status" data-part="notes-said">
        {said}
      </p>
      {cantDo !== null ? (
        <CantDoThat title={notesCantDoTitle(cantDo.code)} body={notesCantDoText(cantDo.code, cantDo.max !== undefined ? { max: cantDo.max } : {})} from={cantDo.code} onClose={() => setCantDo(null)} />
      ) : null}
    </section>
  );
}

/** The Notes panel for `tradeTag`, as `access` allows; nothing at all for a session that may neither read nor add. */
export function TraderNotes({ tradeTag, access }: { tradeTag: string; access: NotesAccess }) {
  if (!access.view && !access.add) return null;
  return (
    <div className="x2f-card" data-part="trader-notes">
      <Disclosure summary={C.summary(tradeTag)} part="notes-open">
        {(id) => <NotesBody tradeTag={tradeTag} access={access} id={id} />}
      </Disclosure>
    </div>
  );
}

/** The panel for the signed-in session (its owner or member boxes). */
export function SessionTraderNotes({ tradeTag }: { tradeTag: string }) {
  const session = useSession();
  return <TraderNotes tradeTag={tradeTag} access={notesAccessOf(session)} />;
}
