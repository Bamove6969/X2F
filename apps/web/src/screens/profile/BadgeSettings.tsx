/**
 * Plan 5 Task 12: Settings → Your badges (BadgeSettings board, design/x2f-app/BadgeSettings.dc.html),
 * on `GET`/`PUT /v1/account/badges` (apps/api/src/reputation/badgeRoutes.ts).
 *
 * The preview "On your offers" (my name, the Featured chips and "+N"), "Featured N of 2", the
 * notice when featuring a third moved the oldest to On hover (announced: role="status"), the Earned
 * list with Featured / On hover / Hidden for each badge, the next milestones, and the board's
 * footer. New has no controls (it always shows while earned). Badges are earned, never set: the
 * only write is a badge's visibility, and the screen shows what the server answered.
 */
import { useEffect, useState } from 'react';
import { displayNameOf, useSession } from '../../session/useSession.js';
import { BadgeChips, BadgeSeal, badgeFromApi } from '../../ui/Badges.js';
import { Button } from '../../ui/Button.js';
import { chooseBadge, fetchBadgeSettings, type BadgeSettings as Settings, type Visibility } from './api.js';
import { BADGE_COPY as C } from './profileCopy.js';
import '../screens.css';
import './profile.css';

const LEVELS: readonly Visibility[] = ['featured', 'hover', 'hidden'];

export function BadgeSettings() {
  const session = useSession();
  const name = session.status === 'signed-in' ? displayNameOf(session.me) : '';
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== 'signed-in') return;
    const ctl = new AbortController();
    fetchBadgeSettings(ctl.signal).then(setSettings, () => {
      if (!ctl.signal.aborted) setError(C.loadFailed);
    });
    return () => ctl.abort();
  }, [session.status]);

  const choose = async (id: string, level: Visibility) => {
    setBusy(id);
    setError(null);
    try {
      const next = await chooseBadge(id, level);
      setSettings(next);
      setNotice(next.notice);
    } catch {
      setError(C.failed);
    } finally {
      setBusy(null);
    }
  };

  const shown = settings === null ? [] : [...settings.featured, ...settings.more].flatMap((id) => badgeFromApi(id) ?? []);
  const featuredDrawn = settings === null ? 0 : settings.featured.flatMap((id) => badgeFromApi(id) ?? []).length;
  return (
    <main className="x2f-screen" data-screen="badge-settings">
      <h1 className="x2f-screen__title">{C.title}</h1>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {settings === null ? null : (
        <>
          <section className="x2f-card x2f-badgeset__preview" aria-labelledby="badgeset-preview-h" data-part="preview">
            <h2 className="x2f-card__title" id="badgeset-preview-h">
              {C.preview}
            </h2>
            <span data-username>{name}</span>
            <BadgeChips name={name} badges={shown} featured={featuredDrawn} />
            <p className="x2f-note" data-part="featured-count">
              {C.featuredCount(settings.featured.length)}
            </p>
          </section>
          <p className="x2f-note" role="status" data-part="notice">
            {notice ?? ''}
          </p>

          <section className="x2f-card" aria-labelledby="badgeset-earned-h" data-part="earned">
            <h2 className="x2f-card__title" id="badgeset-earned-h">
              {C.earned}
            </h2>
            {settings.earned.length === 0 ? <p className="x2f-note">{C.none}</p> : null}
            <ul className="x2f-badgeset__list">
              {settings.earned.map(({ id, level }) => {
                const b = badgeFromApi(id);
                if (b === null) return null;
                return (
                  <li key={id} className="x2f-badgeset__item" data-badge={id} data-level={level}>
                    <span className="x2f-badge-row">
                      <BadgeSeal badge={b} size={40} />
                      <span className="x2f-badge-row__text">
                        <span className="x2f-badge-row__name">{b.name}</span>
                        <span className="x2f-badge-row__meaning">{b.meaning}</span>
                      </span>
                    </span>
                    {id === 'new' ? null : (
                      <span className="x2f-badgeset__levels" role="group" aria-label={`${b.name}: where it shows`}>
                        {LEVELS.map((l) => (
                          <Button
                            key={l}
                            variant="secondary"
                            {...(l === level ? { className: 'x2f-segmented__on' } : {})}
                            aria-pressed={l === level}
                            aria-disabled={busy !== null}
                            data-part={`level-${l}`}
                            onClick={() => {
                              if (busy === null && l !== level) void choose(id, l);
                            }}
                          >
                            {C.levels[l]}
                          </Button>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {settings.nextMilestones.length > 0 ? (
            <section className="x2f-card" aria-labelledby="badgeset-next-h" data-part="milestones">
              <h2 className="x2f-card__title" id="badgeset-next-h">
                {C.next}
              </h2>
              {settings.nextMilestones.map((m) => (
                <p key={m.label} className="x2f-badgeset__milestone">
                  <span>{m.label}</span>
                  <span className="x2f-digits">{C.progress(m.have, m.need)}</span>
                </p>
              ))}
            </section>
          ) : null}
          <p className="x2f-note">{C.newFixed}</p>
        </>
      )}
    </main>
  );
}
