/**
 * Settings → Blocked traders (Plan 3 Task 37, spec 2.4): the people I blocked, newest first, each
 * with Unblock. Unblocking restores everything at once (offers, takes, chats, presence). Built from
 * the existing kit only (x2f-screen, x2f-card, x2f-list, Button): Claude Design has no board for it
 * yet (brief item 14; tripwire NEEDS_DESIGN_BLOCK).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { fetchBlocked, unblockTrader, type BlockedEntry } from './blockApi.js';
import { BLOCK_COPY as C } from './blockCopy.js';
import '../screens.css';

export function Blocked() {
  const session = useSession();
  const [list, setList] = useState<BlockedEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = session.status === 'signed-in';

  const refresh = useCallback(async () => {
    setList(await fetchBlocked());
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void refresh().catch(() => setLoadFailed(true));
  }, [refresh, signedIn]);

  const unblock = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      await unblockTrader(name);
      setList((l) => (l ?? []).filter((e) => e.displayName !== name));
    } catch (e) {
      // Already gone (the account was closed): drop it from the list too.
      if (e instanceof ApiCallError && e.status === 404) setList((l) => (l ?? []).filter((x) => x.displayName !== name));
      else setError(C.unblockFailed(name));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="x2f-screen" data-screen="blocked">
      <h1 className="x2f-screen__title" id="blocked-h">
        {C.title}
      </h1>
      <section className="x2f-card" data-part="blocked" aria-labelledby="blocked-h">
        <p className="x2f-sheet__body">{C.intro}</p>
        {session.status === 'signed-out' ? (
          <p className="x2f-note">
            {C.signedOut} <Link to="/login?returnTo=%2Fsettings%2Fblocked">Log in</Link>
          </p>
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
        {list !== null && list.length === 0 ? (
          <p className="x2f-note" data-part="blocked-empty">
            {C.empty}
          </p>
        ) : null}
        {list !== null && list.length > 0 ? (
          <ul className="x2f-list" data-part="blocked-list">
            {list.map((e) => (
              <li className="x2f-list__row" key={e.displayName}>
                <span className="x2f-list__label" data-username="">
                  {e.displayName}
                </span>
                <Button variant="secondary" disabled={busy !== null} onClick={() => void unblock(e.displayName)} data-part="unblock">
                  {C.unblock}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
