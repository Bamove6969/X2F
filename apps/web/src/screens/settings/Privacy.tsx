/**
 * Settings → Privacy (Plan 7 Task 4): what X2F keeps about a trade and when it is deleted, from
 * the shared retention constants (privacyCopy.ts says which purge each line describes). Opened from
 * Settings → Help, like the idle reminder is from Security, so a team member reads it too. No
 * choices and no API call: the rule is the same for everyone. No board yet (DESIGNER-REVIEW), so
 * only existing UI-kit classes, no styling of its own.
 */
import { PRIVACY_COPY as C } from './privacyCopy.js';
import '../screens.css';

export { PRIVACY_PATH } from './privacyCopy.js';

export function Privacy() {
  return (
    <main className="x2f-screen" data-screen="privacy">
      <h1 className="x2f-screen__title">{C.title}</h1>
      <section className="x2f-card" data-part="privacy-deleted" aria-labelledby="privacy-deleted-h">
        <h2 className="x2f-card__title" id="privacy-deleted-h">
          {C.deletedTitle}
        </h2>
        {C.deleted.map((t) => (
          <p className="x2f-sheet__body" key={t}>
            {t}
          </p>
        ))}
      </section>
      <section className="x2f-card" data-part="privacy-stays" aria-labelledby="privacy-stays-h">
        <h2 className="x2f-card__title" id="privacy-stays-h">
          {C.staysTitle}
        </h2>
        {C.stays.map((t) => (
          <p className="x2f-sheet__body" key={t}>
            {t}
          </p>
        ))}
      </section>
    </main>
  );
}
