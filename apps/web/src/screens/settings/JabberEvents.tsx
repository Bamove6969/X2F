/**
 * Settings → Alerts → Jabber notifications (W-021, owner p11-27): each user picks which events send
 * them a secure Jabber notice. The events are the ones the API lists (`GET /v1/account/jabber/events`,
 * its notice kinds), each a checkbox; a tick or untick calls the API for that event only, and the
 * box shows what the server answered. No board draws this page yet: the words are COPY-UNSIGNED
 * (jabberCopy.ts) and the layout follows JabberSetup.
 */
import { ALERTS_PATH } from './settingsCopy.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { JabberEventKind, JabberEvents, JabberStatus } from '@x2f/auth-client';
import { Checkbox } from '../../ui/Checkbox.js';
import { authApi } from '../auth/authApi.js';
import { jabberErrorText } from './JabberSetup.js';
import { JABBER_COPY as C } from './jabberCopy.js';
import '../screens.css';
import { RetryLine } from '../../ui/RetryButton.js';

/** Words for a kind this build does not know: the kind is never shown raw. */
const wordsOf = (kind: string): { label: string; note: string } =>
  Object.hasOwn(C.events, kind) ? C.events[kind as keyof typeof C.events] : { label: 'Other notices', note: '' };

/** Trade milestones (owner 27 Nov 2026) in a card of their own, under the account notices. */
const isTrade = (kind: string) => kind.startsWith('trade-');
const GROUPS = [
  { part: 'jabber-events', title: C.eventsRow, has: (k: string) => !isTrade(k) },
  { part: 'jabber-events-trades', title: C.tradesRow, has: isTrade },
] as const;

export function JabberEventsScreen() {
  const [status, setStatus] = useState<JabberStatus | null>(null);
  const [events, setEvents] = useState<JabberEvents['events'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([authApi.getJabber(), authApi.getJabberEvents()]).then(
      ([s, e]) => {
        if (!live) return;
        setStatus(s);
        setEvents(e.events);
      },
      (e: unknown) => {
        if (!live) return;
        setError(jabberErrorText(e));
        setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (kind: JabberEventKind, on: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setLoadFailed(false);
    try {
      setEvents((await authApi.setJabberEvent({ kind, on })).events);
    } catch (e) {
      setError(jabberErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setUp = status !== null && (status.state === 'on' || status.state === 'paused');

  return (
    <main className="x2f-screen" data-screen="jabber-events">
      <Link className="x2f-button x2f-button--quiet" to={ALERTS_PATH} aria-label={C.back}>
        ‹
      </Link>
      <p className="x2f-note">{C.kicker}</p>
      <h1 className="x2f-screen__title">{C.eventsTitle}</h1>
      <p className="x2f-note">{C.eventsLead}</p>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {/* DESIGN: owner 17 Nov black+orange rule: a failed load's "Try again" is the orange retry (reloads the page). */}
          {loadFailed ? <RetryLine text={error} data-part="jabber-events-retry" /> : error}
        </p>
      ) : null}
      {status !== null && !setUp ? (
        <section className="x2f-card" data-part="jabber-events-setup">
          <p className="x2f-note">{C.eventsNeedSetUp}</p>
          <Link className="x2f-button x2f-button--primary" to="/settings/jabber">
            {C.eventsSetUpLink}
          </Link>
        </section>
      ) : null}
      {setUp && events !== null ? (
        <>
          {GROUPS.map((g) => {
            const rows = events.filter((e) => g.has(e.kind));
            if (rows.length === 0) return null;
            return (
              <section className="x2f-card" data-part={g.part} aria-labelledby={`je-${g.part}`} key={g.part}>
                <h2 className="x2f-card__title" id={`je-${g.part}`}>
                  {g.title}
                </h2>
                <ul className="x2f-list">
                  {rows.map((e) => {
                    const id = `je-${e.kind}`;
                    const w = wordsOf(e.kind);
                    const described = [w.note ? `${id}-n` : null, e.canTurnOff ? null : 'je-always-on'].filter((x) => x !== null).join(' ');
                    return (
                      <li className="x2f-list__row" key={e.kind}>
                        <Checkbox
                          id={id} data-kind={e.kind} checked={e.on || !e.canTurnOff} disabled={busy || !e.canTurnOff}
                          aria-describedby={described || undefined}
                          onChange={(on) => {
                            if (e.canTurnOff) void toggle(e.kind, on);
                          }}
                        />
                        <span className="x2f-list__label">
                          <label htmlFor={id}>{w.label}</label>
                          {w.note ? (
                            <>
                              <br />
                              <span className="x2f-list__time" id={`${id}-n`}>
                                {w.note}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {g.part === 'jabber-events' && rows.some((e) => !e.canTurnOff) ? (
                  <p className="x2f-note" id="je-always-on" data-part="jabber-events-always-on">
                    {C.alwaysOnNote}
                  </p>
                ) : null}
              </section>
            );
          })}
        </>
      ) : null}
    </main>
  );
}
