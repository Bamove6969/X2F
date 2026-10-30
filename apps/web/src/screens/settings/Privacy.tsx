/**
 * Settings → Privacy (Plan 7 Task 4; owner 2026-10-29 and 2026-10-29b): what X2F keeps about a
 * trade and for how long. No choices, only plain statements: there is one fixed rule and nobody
 * can change it (R36). Every number comes from the shared constants (@x2f/trade), never a typed
 * copy, so the page cannot drift from what the purge does. Works logged out: the rule is the same
 * for everyone.
 *
 * Revision 2026-10-29b: no 6-month training copy exists, so the page never mentions one; dispute
 * records are kept 90 days for moderator training, with as much private detail blurred as possible.
 *
 * No board yet: Claude Design owns the look (test/privacy-tripwire.test.ts NEEDS_DESIGN_PRIVACY),
 * so this screen uses only existing UI-kit classes and adds no styling of its own, and there is no
 * menu entry (Claude Design places it). All copy is // COPY-UNSIGNED for the owner.
 *
 * SEAMS: the links to the lawful-requests page (Plan 7 Task 12, `/legal/requests`) and to Delete
 * my account (Task 18) are added when those routes exist (the tripwire checks App.tsx).
 */
import { BACKUP_KEEP_DAYS, DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS } from '@x2f/trade';
import '../screens.css';

/** The page's statements, built from the shared constants (exported for the test). */
export const PRIVACY_COPY = {
  title: 'Privacy',
  // COPY-UNSIGNED (Plan 7 Task 4)
  keptTitle: 'What happens to a trade',
  kept: [
    `Every trade self-destructs ${TRADE_KEEP_DAYS} days after it ends: the trade, its chat, its proofs and its addresses are deleted.`,
    `If a dispute is opened, the trade is kept ${DISPUTE_KEEP_DAYS} days from that moment, for moderator training, with as much private detail blurred as possible. Then it is deleted.`,
    'A dispute that is still open is never deleted. It is deleted once it is closed and its time has passed.',
    'Nobody can delete a trade early or keep it longer, not even X2F.',
  ],
  // COPY-UNSIGNED (Plan 7 Task 4)
  staysTitle: 'What stays',
  stays: ['Your reviews and your trade count stay on your profile.', 'The trade room shows the date each trade self-destructs.'],
  // COPY-UNSIGNED (Plan 7 Task 4)
  backups: `Backups are cleared within ${BACKUP_KEEP_DAYS} days, so a deleted trade is gone from them too.`,
} as const;

export function Privacy() {
  const C = PRIVACY_COPY;
  return (
    <main className="x2f-screen" data-screen="privacy">
      <h1 className="x2f-screen__title">{C.title}</h1>
      <section className="x2f-card" data-part="privacy-kept" aria-labelledby="privacy-kept-h">
        <h2 className="x2f-card__title" id="privacy-kept-h">
          {C.keptTitle}
        </h2>
        <ul className="x2f-sheet__body">
          {C.kept.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <section className="x2f-card" data-part="privacy-stays" aria-labelledby="privacy-stays-h">
        <h2 className="x2f-card__title" id="privacy-stays-h">
          {C.staysTitle}
        </h2>
        <ul className="x2f-sheet__body">
          {C.stays.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="x2f-note" data-part="privacy-backups">
          {C.backups}
        </p>
      </section>
    </main>
  );
}
