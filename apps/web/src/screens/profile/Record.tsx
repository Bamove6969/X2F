/**
 * Plan 5 Task 12: the signed reputation record (P5-A18), on apps/api/src/reputation/record.ts. No
 * board: kit parts only, every line COPY-UNSIGNED (profileCopy.ts RECORD_COPY).
 *
 * - `/settings/record` (RecordExport): make the signed record (at most once a minute), optionally
 *   with my PGP fingerprint (P5-A35: off unless ticked), save it as `x2f-reputation-<date>.txt`
 *   through a `data:` link, and "Show on my profile" (private by default).
 * - `/u/:name/record`: a trader's public record, as X2F signed it, to check in a PGP app.
 *
 * VerifyRecord (`/verify`: checking a pasted record in the browser against the pinned X2F key) is
 * not built here; see the branch report.
 */
import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { displayNameOf, useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { Switch } from '../../ui/Switch.js';
import { fetchMyRecord, fetchProfile, fetchPublicRecord, setRecordPublic } from './api.js';
import { RECORD_COPY as C } from './profileCopy.js';
import '../screens.css';
import './profile.css';

/** A `data:` URL for the record text (no blob, no network). */
export function recordHref(text: string): string {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
}

export function RecordExport({ now = () => new Date() }: { now?: () => Date }) {
  const session = useSession();
  const name = session.status === 'signed-in' ? displayNameOf(session.me) : '';
  const [withPgp, setWithPgp] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<boolean | null>(null);
  const showLabel = useId();
  const showNote = useId();
  const pgpLabel = useId();

  useEffect(() => {
    if (name === '') return;
    const ctl = new AbortController();
    fetchProfile(name, ctl.signal).then((p) => setShown(p.recordPublic), () => {});
    return () => ctl.abort();
  }, [name]);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setText(await fetchMyRecord(withPgp));
    } catch (e) {
      setError(e instanceof ApiCallError && e.code === 'slow-down' && e.retryAfterSeconds !== undefined ? C.slowDown(e.retryAfterSeconds) : C.failed);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (shown === null) return;
    try {
      setShown(await setRecordPublic(!shown));
    } catch {
      setError(C.failed);
    }
  };

  return (
    <main className="x2f-screen" data-screen="record-export">
      <h1 className="x2f-screen__title">{C.title}</h1>
      <section className="x2f-card x2f-stack">
        <p>{C.intro}</p>
        <span className="x2f-row" data-part="include-pgp">
          <Checkbox checked={withPgp} onChange={setWithPgp} aria-labelledby={pgpLabel} />
          <span id={pgpLabel}>{C.includePgp}</span>
        </span>
        <p className="x2f-note">{C.includePgpNote}</p>
        <Button variant="primary" aria-disabled={busy} onClick={() => void (busy ? undefined : make())} data-part="make-record">
          {C.download}
        </Button>
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        {text !== null ? (
          <div className="x2f-stack" data-part="record-ready">
            <p role="status">{C.ready}</p>
            <a className="x2f-button x2f-button--secondary" href={recordHref(text)} download={C.fileName(now().toISOString().slice(0, 10))} data-part="save-record">
              {C.save}
            </a>
            <pre className="x2f-pre x2f-record__text" data-part="record-text">
              {text}
            </pre>
          </div>
        ) : null}
        <p className="x2f-note">{C.pgpHint}</p>
      </section>
      <section className="x2f-card x2f-stack">
        <span className="x2f-row">
          <span id={showLabel}>{C.show}</span>
          <Switch checked={shown === true} disabled={shown === null} aria-labelledby={showLabel} aria-describedby={showNote} onClick={() => void toggle()} data-part="show-record" />
        </span>
        <p className="x2f-note" id={showNote}>
          {C.showNote}
        </p>
      </section>
    </main>
  );
}

/** `/u/:name/record`: the public copy, as X2F signed it. */
export function PublicRecord() {
  const { name = '' } = useParams();
  const [text, setText] = useState<string | null | 'missing'>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetchPublicRecord(name, ctl.signal).then(setText, () => {
      if (!ctl.signal.aborted) setText('missing');
    });
    return () => ctl.abort();
  }, [name]);
  return (
    <main className="x2f-screen" data-screen="public-record">
      <h1 className="x2f-screen__title">{C.publicTitle(name)}</h1>
      {text === 'missing' ? <p className="x2f-note">{C.publicMissing}</p> : null}
      {text !== null && text !== 'missing' ? (
        <section className="x2f-card x2f-stack">
          <p className="x2f-note">{C.publicNote}</p>
          <pre className="x2f-pre x2f-record__text" data-part="record-text">
            {text}
          </pre>
        </section>
      ) : null}
      <Link className="x2f-link x2f-profile__link" to={`/u/${encodeURIComponent(name)}`}>
        {name}
      </Link>
    </main>
  );
}
