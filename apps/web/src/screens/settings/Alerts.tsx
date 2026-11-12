/**
 * Security alerts (Task 30, spec §6.4): new logins, login methods and wallets added or removed, devices logged out, and paused logins. X2F
 * never stores an email address, so these are in-app (and, in Plan 3, phone push). Opening the
 * list marks each one seen.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AlertEntry, JabberStatus } from '@x2f/auth-client';
import { authApi } from '../auth/authApi.js';
import { formatDateTime } from '../../ui/dates.js';
import { JABBER_COPY as J } from './jabberCopy.js';
import { AlarmSettingsCard } from '../../alerts/alarm.js';

/**
 * Plain words for every alert kind the server records (`AlertKind` in apps/api/src/alerts.ts).
 * A kind this list does not know reads as a generic label, never as raw kebab-case.
 */
const KIND_WORDS: Record<string, string> = {
  'new-login': 'New login',
  'recovery-login': 'Logged in with a backup',
  'recovery-hold-cancelled': 'A backup login was cancelled',
  // not-a-refusal: an alert kind (a security throttle)
  'login-locked': 'Logins paused after too many tries',
  'login-method-added': 'A login method was added',
  // not-a-refusal: an alert kind, not a refusal code
  'login-name-set': 'Your login name was set',
  'login-method-removed': 'A login method was removed',
  'sessions-ended': 'Other devices were logged out',
  'wallet-added': 'A payout wallet was added',
  'wallet-removed': 'A payout wallet was removed',
  'device-key-added': 'A trade signing key was added',
  // Plan 2 Task 16.
  'login-approval': 'A new device asked to log in',
  'login-blocked': 'A login was blocked',
  'logged-out-by-new-device': 'A new device logged other devices out',
  'one-device-set': 'One device at a time was changed',
  // Plan 2 Task 17.
  'hold-started': 'A 24-hour hold started',
  'hold-ended': 'The 24-hour hold ended',
  // Hold model v3 (COPY-UNSIGNED): a moderator moved the hold's end; a username-and-password
  // login's changes submitted, cancelled, thrown away early or applied; the used recovery code replaced.
  'hold-extended': 'A moderator changed when the 24-hour hold ends',
  'hold-changes-submitted': 'Account changes were submitted',
  'hold-changes-cancelled': 'Waiting account changes were cancelled',
  'hold-changes-discarded': 'Waiting account changes were thrown away',
  'hold-changes-applied': 'Waiting account changes took effect',
  'recovery-code-renewed': 'You have a new recovery code',
  // Plan 2 Task 18.
  'team-member-joined': 'A team member joined',
  'team-member-login': 'A team member logged in',
};

const count = (n: unknown, one: string, many: string): string | null =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 ? `${n} ${n === 1 ? one : many}` : null;

/**
 * The line under a hold v3 alert, from its detail (never a secret or an address): how many changes,
 * and when they take effect; why they were thrown away; what applied. Null for any other alert.
 * COPY-UNSIGNED
 */
export function alertDetail(kind: string, detail: unknown): string | null {
  const d = (detail !== null && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
  switch (kind) {
    case 'hold-changes-submitted': {
      const n = count(d.count, 'change', 'changes');
      const at = typeof d.takesEffectAt === 'string' && Number.isFinite(Date.parse(d.takesEffectAt)) ? formatDateTime(d.takesEffectAt) : null;
      if (n === null) return null;
      return at === null ? `${n} waiting.` : `${n} waiting. They take effect on ${at} unless someone cancels them.`;
    }
    case 'hold-changes-cancelled': {
      const n = count(d.count, 'change', 'changes');
      return n === null ? null : `${n} cancelled. Nothing on your account changed.`;
    }
    case 'hold-changes-discarded': {
      const n = count(d.count, 'change', 'changes');
      if (n === null) return null;
      return d.reason === 'owner-login' ? `${n} thrown away after a login with a passkey, a security key or a PGP key.` : `${n} thrown away.`;
    }
    case 'hold-changes-applied': {
      const applied = Array.isArray(d.applied) ? d.applied.length : null;
      const dropped = Array.isArray(d.dropped) ? d.dropped.length : 0;
      const a = count(applied, 'change', 'changes');
      if (a === null) return null;
      return dropped > 0 ? `${a} applied. ${count(dropped, 'change', 'changes')} could not be applied and were dropped.` : `${a} applied.`;
    }
    case 'recovery-code-renewed':
      return 'Your used recovery code was replaced. Write down the new one on the Security screen.';
    default:
      return null;
  }
}

export function alertWords(kind: string): string {
  return Object.hasOwn(KIND_WORDS, kind) ? KIND_WORDS[kind]! : 'Security alert';
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
    <>
    <AlarmSettingsCard />
    <JabberAlerts />
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
            <span className="x2f-list__label">
              {alertWords(a.kind)}
              {alertDetail(a.kind, a.detail) !== null ? (
                <>
                  <br />
                  <span className="x2f-list__time" data-part="alert-detail">
                    {alertDetail(a.kind, a.detail)}
                  </span>
                </>
              ) : null}
            </span>
            <time className="x2f-list__time x2f-when" dateTime={a.createdAt}>
              {formatDateTime(a.createdAt)}
            </time>
          </li>
        ))}
      </ul>
    </section>
    </>
  );
}

/**
 * Owner rule p5-7, the Alerts board's "Secure Jabber (XMPP)" section: account-change alerts with
 * no details in them. The switch shows only once an address is proven; the address row opens the
 * set-up (JabberSetup) and shows the address masked, or "Not set up".
 */
export function JabberAlerts() {
  const [s, setS] = useState<JabberStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void authApi.getJabber().then(
      (r) => live && setS(r),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  if (s === null || !s.available) return null;
  // `broken` (review M4): no notice can reach the address, so there is no switch to show.
  const setUp = s.state === 'on' || s.state === 'paused';
  const on = s.state === 'on';
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setS(await authApi.setJabberEnabled({ on: !on }));
    } catch {
      setError(J.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-card" data-part="jabber-alerts" aria-labelledby="al-xmpp">
      <h2 className="x2f-card__title" id="al-xmpp">
        {J.sectionTitle}
      </h2>
      <p className="x2f-list__label" id="al-xmpp-l">
        {J.rowTitle}
      </p>
      <p className="x2f-note">{J.rowNote}</p>
      {setUp ? (
        <button type="button" role="switch" aria-checked={on} aria-labelledby="al-xmpp-l" aria-disabled={busy} onClick={() => void toggle()} data-part="jabber-switch">
          {on ? 'On' : 'Off'}
        </button>
      ) : null}
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <Link className="x2f-list__row" to="/settings/jabber" aria-label={s.state === 'broken' ? J.brokenRowLabel : J.rowLabel(s.address)} data-part="jabber-address-row">
        <span className="x2f-list__label">{J.addressLabel}</span>
        <span>{s.state === 'broken' ? J.needsSetUpAgain : (s.address ?? J.notSetUp)}</span>
      </Link>
      {setUp ? (
        <Link className="x2f-list__row" to="/settings/jabber/events" data-part="jabber-events-row">
          <span className="x2f-list__label">{J.eventsRow}</span>
        </Link>
      ) : null}
      {setUp && s.lastSentAt !== null ? (
        <p className="x2f-note" data-part="jabber-last">
          {J.lastMessage} <time dateTime={s.lastSentAt}>{formatDateTime(s.lastSentAt)}</time>
        </p>
      ) : null}
    </section>
  );
}
