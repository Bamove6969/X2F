/**
 * Settings → Blocked traders (Plan 3 Task 37, spec 2.4), after Claude Design's Block board (the
 * settings view): what blocking does, then the people I blocked, newest first. Unblock keeps the
 * row ("Unblocked. They can see your offers again.") with "Block <name> again" as the undo, and
 * announces the change (role="status"); the row's one button stays in place, so focus stays on it
 * (review M2). A row leaves only when the server confirms it is gone (review M1): a 404 is checked
 * by reading the list again; any other failure keeps the row and says so. Kit parts only.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { blockTrader, fetchBlocked, unblockTrader, type BlockedEntry } from './blockApi.js';
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
      mark(name, false);
      setSaid(C.reblocked(name));
    } catch {
      setError(C.failed(name));
    }
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
