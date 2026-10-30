/**
 * Settings → Privacy (Plan 7 Task 4; owner 2026-10-29 and 2026-10-29b): what X2F keeps about a
 * trade and for how long. No choices, only plain statements: there is one fixed rule and nobody
 * can change it (R36). Every number comes from the shared constants (@x2f/trade), never a typed
 * copy, so the page cannot drift from what the purge does. Works logged out: the rule is the same
 * for everyone.
 *
 * Review I2 (lead 2026-10-30): the page states ONLY what is true and built today. The self-destruct
 * statements show only while the server says the purge is on (`GET /v1/privacy`, X2F_TRADE_PURGE);
 * while it is off the page says trades are kept. Not stated until built: backups being cleared
 * (Plan 6 D6, owner unconfirmed: BACKUP_KEEP_DAYS is not read here), blurred dispute records
 * (Plan 4), reviews (Plan 5) and proofs (Plan 5 Task 14).
 *
 * No board yet: Claude Design owns the look (test/privacy-tripwire.test.ts NEEDS_DESIGN_PRIVACY),
 * so this screen uses only existing UI-kit classes and adds no styling of its own, and there is no
 * menu entry (Claude Design places it). All copy is // COPY-UNSIGNED for the owner.
 *
 * SEAMS: the links to the lawful-requests page (Plan 7 Task 12, `/legal/requests`) and to Delete
 * my account (Task 18) are added when those routes exist (the tripwire checks App.tsx).
 */
import { DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS } from '@x2f/trade';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import '../screens.css';

/** The page's statements, built from the shared constants (exported for the test). */
export const PRIVACY_COPY = {
  title: 'Privacy',
  // COPY-UNSIGNED (Plan 7 Task 4)
  keptTitle: 'What happens to a trade',
  // COPY-UNSIGNED (Plan 7 Task 4): while X2F_TRADE_PURGE is off (review I2).
  off: ['Trades do not self-destruct yet. Until self-destruct is switched on, X2F keeps your trades.'],
  // COPY-UNSIGNED (Plan 7 Task 4): only while X2F_TRADE_PURGE is on.
  kept: [
    `Every trade self-destructs ${TRADE_KEEP_DAYS} days after it ends: the trade, its chat and its addresses are deleted.`,
    `If a dispute is opened, the trade is kept ${DISPUTE_KEEP_DAYS} days from that moment. Then it is deleted.`,
    'A dispute that is still open is never deleted. It is deleted once it is closed and its time has passed.',
    'Nobody can delete a trade early, not even X2F.',
  ],
  // COPY-UNSIGNED (Plan 7 Task 4): only while X2F_TRADE_PURGE is on.
  staysTitle: 'What stays',
  stays: ['Your trade count stays on your profile.', 'The trade room shows the date each trade self-destructs.'],
  // COPY-UNSIGNED (Plan 7 Task 4)
  failed: 'This page could not load. Try again later.',
} as const;

type PurgeState = 'loading' | 'on' | 'off' | 'failed';

/** `GET /v1/privacy`: whether the whole-trade purge runs on this server. */
export async function fetchPurgeOn(): Promise<boolean> {
  const v = await api<unknown>('/v1/privacy');
  const on = v !== null && typeof v === 'object' ? (v as Record<string, unknown>).tradePurge : undefined;
  if (typeof on !== 'boolean') throw new Error('privacy: bad answer');
  return on;
}

export function Privacy() {
  const C = PRIVACY_COPY;
  const [state, setState] = useState<PurgeState>('loading');
  useEffect(() => {
    let live = true;
    fetchPurgeOn().then(
      (on) => {
        if (live) setState(on ? 'on' : 'off');
      },
      () => {
        if (live) setState('failed');
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <main className="x2f-screen" data-screen="privacy" data-purge={state}>
      <h1 className="x2f-screen__title">{C.title}</h1>
      {state === 'failed' ? (
        <p className="x2f-note" role="alert" data-part="privacy-failed">
          {C.failed}
        </p>
      ) : null}
      {state === 'on' || state === 'off' ? (
        <section className="x2f-card" data-part="privacy-kept" aria-labelledby="privacy-kept-h">
          <h2 className="x2f-card__title" id="privacy-kept-h">
            {C.keptTitle}
          </h2>
          <ul className="x2f-sheet__body">
            {(state === 'on' ? C.kept : C.off).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {state === 'on' ? (
        <section className="x2f-card" data-part="privacy-stays" aria-labelledby="privacy-stays-h">
          <h2 className="x2f-card__title" id="privacy-stays-h">
            {C.staysTitle}
          </h2>
          <ul className="x2f-sheet__body">
            {C.stays.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
