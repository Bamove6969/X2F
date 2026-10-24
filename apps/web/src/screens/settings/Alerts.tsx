/**
 * Security alerts (Task 30, spec §6.4): new logins, a wallet added or removed, and the like. X2F
 * never stores an email address, so these are in-app (and, in Plan 3, phone push). Opening the
 * list marks each one seen.
 */
import { useEffect, useState } from 'react';
import type { AlertEntry } from '@x2f/auth-client';
import { authApi } from '../auth/authApi.js';

/** Plain words for the alert kinds the account raises (spec §6.3/§6.4). Unknown kinds show as-is. */
const KIND_WORDS: Record<string, string> = {
  'new-login': 'A new login',
  'wallet-added': 'A payout wallet was added',
  'wallet-removed': 'A payout wallet was removed',
  'method-added': 'A login method was added',
  'method-removed': 'A login method was removed',
  'password-changed': 'Your password was changed',
};

function words(kind: string): string {
  return KIND_WORDS[kind] ?? kind;
}

export function Alerts() {
  const [alerts, setAlerts] = useState<AlertEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void authApi.listAlerts().then(
      (list) => {
        if (!live) return;
        setAlerts(list);
        for (const a of list) if (a.seenAt === null) void authApi.markAlertSeen(a.id).catch(() => undefined);
      },
      () => {
        if (live) setError('Could not load your alerts.');
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="x2f-card" data-part="alerts" aria-labelledby="alerts-h">
      <h2 className="x2f-card__title" id="alerts-h">
        Alerts
      </h2>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {alerts !== null && alerts.length === 0 ? <p className="x2f-note">No alerts.</p> : null}
      <ul className="x2f-list" data-part="alert-list">
        {(alerts ?? []).map((a) => (
          <li className="x2f-list__row" key={a.id} data-kind={a.kind} data-unseen={a.seenAt === null ? 'true' : 'false'}>
            <span className="x2f-list__label">{words(a.kind)}</span>
            <time className="x2f-list__time" dateTime={a.createdAt}>
              {new Date(a.createdAt).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
