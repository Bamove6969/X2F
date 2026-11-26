/**
 * Settings → Team, one member's signed-in sessions (the account owner): each with its device, when
 * the member signed in and when it was last seen, and a way to end it, or all of them (asked
 * first). A row opens the list (Disclosure), so the screen reads nothing until the owner asks.
 * Each session ended shows in the Team log as "You ended a session of <member>" (the API's
 * `session-ended` row, the owner's since migration 859). Owner, 26 Nov 2026: no passwords and no
 * weak sessions, so every login the owner holds may end a member's session.
 *
 * No Claude Design board yet (NEEDS_DESIGN_TEAM in test/team-tripwires.test.ts): kit parts and
 * existing classes only, no stylesheet of its own and no inline styles. Times through `When`
 * (ui/dates.ts). Words: `C` below (COPY-UNSIGNED).
 */
import { useCallback, useEffect, useState } from 'react';
import { AuthApiError, type MemberSession } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { Disclosure } from '../../ui/Disclosure.js';
import { Sheet } from '../../ui/Sheet.js';
import { When } from '../../ui/When.js';
import { authApi } from '../auth/authApi.js';

// COPY-UNSIGNED (all of MEMBER_SESSIONS_COPY).
export const MEMBER_SESSIONS_COPY = {
  title: 'Signed-in sessions',
  loading: 'Loading…',
  none: (member: string) => `${member} is not signed in on any device.`,
  signedIn: 'Signed in',
  lastSeen: 'last seen',
  end: 'End session',
  endLabel: (member: string, device: string) => `End ${member}'s session on ${device}`,
  endAll: 'End all sessions',
  endAllLabel: (member: string) => `End all of ${member}'s sessions`,
  logNote: 'Each session you end shows in the Team log.',
  ask: {
    oneTitle: (member: string) => `End ${member}'s session?`,
    oneText: (member: string, device: string) => `${member} is logged out of ${device} right away.`,
    allTitle: (member: string) => `End all of ${member}'s sessions?`,
    allText: (member: string, n: number) => (n === 1 ? `${member} is logged out of 1 device right away.` : `${member} is logged out of ${n} devices right away.`),
    cancel: 'Cancel',
  },
  done: {
    one: (member: string, device: string) => `${member} was logged out of ${device}.`,
    all: (member: string) => `${member} was logged out of every device.`,
  },
  loadFailed: 'The sessions did not load. Try again.',
  endFailed: 'That session did not end. Try again.',
  retry: 'Try again',
} as const;

const C = MEMBER_SESSIONS_COPY;

type Ask = { kind: 'one'; s: MemberSession } | { kind: 'all'; n: number };

/** One member's sessions, behind a row that opens them. */
export function MemberSessions({ member }: { member: { id: string; tradeTag: string } }) {
  return (
    <Disclosure summary={C.title} part="member-sessions">
      {(id) => <SessionList id={id} member={member} />}
    </Disclosure>
  );
}

function SessionList({ id, member }: { id: string; member: { id: string; tradeTag: string } }) {
  const name = member.tradeTag;
  const [sessions, setSessions] = useState<MemberSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setSessions((await authApi.memberSessions(member.id)).sessions);
    } catch {
      setFailed(true);
    }
  }, [member.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const end = async (a: Ask) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (a.kind === 'one') {
        await authApi.endMemberSession(member.id, a.s.id);
        setNote(C.done.one(name, a.s.deviceLabel));
      } else {
        await authApi.endMemberSessions(member.id);
        setNote(C.done.all(name));
      }
    } catch (e) {
      // A session that already ended (or a member removed meanwhile) needs no words: the list reloads.
      if (!(e instanceof AuthApiError && e.status === 404)) setError(C.endFailed);
    } finally {
      setBusy(false);
    }
    await load();
  };

  const confirm = () => {
    if (ask === null) return;
    setAsk(null);
    void end(ask);
  };

  return (
    <div className="x2f-stack" id={id} data-part="member-session-list">
      {failed ? (
        <>
          <p className="x2f-error" role="alert">
            {C.loadFailed}
          </p>
          <Button variant="quiet" onClick={() => void load()} data-part="sessions-retry">
            {C.retry}
          </Button>
        </>
      ) : sessions === null ? (
        <p className="x2f-note">{C.loading}</p>
      ) : sessions.length === 0 ? (
        <p className="x2f-note" data-part="sessions-none">
          {C.none(name)}
        </p>
      ) : (
        <ul className="x2f-list">
          {sessions.map((s) => (
            <li className="x2f-list__row" key={s.id} data-session={s.id}>
              <span className="x2f-list__label">
                <span data-part="session-device">{s.deviceLabel}</span>
                <br />
                <span className="x2f-list__time" data-part="session-times">
                  {C.signedIn} <When at={s.createdAt} /> · {C.lastSeen} <When at={s.lastSeenAt} />
                </span>
              </span>
              <Button
                variant="secondary"
                className="x2f-button--small"
                aria-label={C.endLabel(name, s.deviceLabel)}
                disabled={busy}
                onClick={() => setAsk({ kind: 'one', s })}
                data-part="end-member-session"
              >
                {C.end}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {sessions !== null && sessions.length > 1 ? (
        <Button variant="danger-outline" aria-label={C.endAllLabel(name)} disabled={busy} onClick={() => setAsk({ kind: 'all', n: sessions.length })} data-part="end-member-sessions">
          {C.endAll}
        </Button>
      ) : null}
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {note !== null ? (
        <p className="x2f-note" role="status" data-part="member-sessions-said">
          {note}
        </p>
      ) : null}
      {sessions !== null && sessions.length > 0 ? <p className="x2f-fine">{C.logNote}</p> : null}
      <Sheet
        open={ask !== null}
        title={ask === null ? '' : ask.kind === 'one' ? C.ask.oneTitle(name) : C.ask.allTitle(name)}
        closeButton={false}
        wide="dialog"
        onClose={() => setAsk(null)}
      >
        <div className="x2f-stack">
          <p className="x2f-body">{ask === null ? '' : ask.kind === 'one' ? C.ask.oneText(name, ask.s.deviceLabel) : C.ask.allText(name, ask.n)}</p>
          <Button variant="danger-outline" onClick={confirm} data-part="end-member-confirm">
            {ask?.kind === 'all' ? C.endAll : C.end}
          </Button>
          <Button variant="quiet" onClick={() => setAsk(null)} data-part="end-member-cancel">
            {C.ask.cancel}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
