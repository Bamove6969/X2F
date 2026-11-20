/**
 * Plan 5 Task 12: a trader's profile (Profile board, design/x2f-app/Profile.dc.html), from
 * `GET /v1/traders/:name` (apps/api/src/reputation/profile.ts).
 *
 * - `/profile`: my own profile, by my public display name from the session, with "Choose badges"
 *   (→ /settings/badges), My offers (→ /profile/offers) and the signed record settings.
 * - `/u/:name`: another trader's public profile, with Block (the blocker still opens the profile of
 *   the person they blocked: that is where Unblock is, traders/blocks.ts).
 *
 * The board's stats, except its "trades cancelled" tile: the cancel figure is moderators' only
 * (owner T-017). Plus "Disputes: N won, M lost" (Revision 2026-10-29c). Reviews show month and year
 * only and never who left them (P5-A10, 2026-10-29b). "Account protected with PGP" only when the
 * API says so (the PGP badge is not Hidden, P5-A17); "Signed trade history available · Verify" only
 * while the record is public. No primary action, like the other tab screens (Main, My offers); the
 * board's Offers and Message on another trader's profile need a per-trader offer list (owner question).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { displayNameOf, useSession } from '../../session/useSession.js';
import { Avatar } from '../../ui/Avatar.js';
import { BadgeChips, badgesFromApi } from '../../ui/Badges.js';
import { Button } from '../../ui/Button.js';
import { UNDER_REVIEW_LABEL } from '@x2f/reputation';
import { BlockAction } from '../settings/BlockAction.js';
import { DISPUTE_COPY } from '../review/copy.js';
import { fetchProfile, type PublicReview, type TraderProfile } from './api.js';
import { PROFILE_COPY as C } from './profileCopy.js';
import '../screens.css';
import './profile.css';

type Load = { kind: 'loading' } | { kind: 'ok'; profile: TraderProfile } | { kind: 'missing' } | { kind: 'failed' };

function useProfile(name: string | null): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (name === null || name === '') return;
    const ctl = new AbortController();
    setLoad({ kind: 'loading' });
    fetchProfile(name, ctl.signal).then(
      (profile) => setLoad({ kind: 'ok', profile }),
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setLoad(e instanceof ApiCallError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed' });
      },
    );
    return () => ctl.abort();
  }, [name, tick]);
  return { load, retry: useCallback(() => setTick((t) => t + 1), []) };
}

function Stars({ review }: { review: PublicReview }) {
  if (review.neutral || review.stars === null) return <span className="x2f-profile__neutral">{C.neutral}</span>;
  return (
    <span className="x2f-profile__stars" role="img" aria-label={C.starsLabel(review.stars)}>
      <span aria-hidden="true">{'★'.repeat(review.stars)}</span>
      <span className="x2f-profile__stars-off" aria-hidden="true">
        {'★'.repeat(5 - review.stars)}
      </span>
    </span>
  );
}

function Review({ review }: { review: PublicReview }) {
  const words = [...review.phrases, ...review.tradeBadges];
  return (
    <li className="x2f-profile__review" data-part="review" data-under-review={review.underReview ? 'true' : undefined}>
      <span className="x2f-profile__review-top">
        <Stars review={review} />
        <span className="x2f-note">
          {review.age} · {review.method}
        </span>
      </span>
      {/* Task 19 (owner 2026-10-29b): a disputed review shows "Under review" at once, to everyone. */}
      {review.underReview ? (
        <span className="x2f-note" data-part="under-review">
          {UNDER_REVIEW_LABEL}
        </span>
      ) : null}
      {words.length > 0 ? <span className="x2f-profile__phrases">{words.join(' · ')}</span> : null}
      {review.note !== null ? <span className="x2f-profile__note">{review.note}</span> : null}
      {/* Task 19: only on my own profile (the API sends an id only there), once per review. */}
      {review.id !== undefined && review.disputable === true ? (
        <Link className="x2f-link x2f-profile__link" to={`/profile/reviews/${encodeURIComponent(review.id)}/dispute`} data-part="dispute-review">
          {DISPUTE_COPY.dispute}
        </Link>
      ) : null}
    </li>
  );
}

function Stat({ value, label, part }: { value: string; label: string; part: string }) {
  return (
    <div className="x2f-profile__stat" data-part={part}>
      <span className="x2f-profile__stat-value x2f-digits">{value}</span>
      <span className="x2f-profile__stat-label">{label}</span>
    </div>
  );
}

/** The profile itself, for one loaded answer. */
export function ProfileView({ profile: p }: { profile: TraderProfile }) {
  const badges = badgesFromApi([...p.badges.featured, ...p.badges.more]);
  // Only the badges the app knows are drawn; Featured are the first ones (New included).
  const featured = badgesFromApi(p.badges.featured).length;
  const name = p.displayName;
  return (
    <main className="x2f-screen" data-screen="profile" data-self={p.self ? 'true' : 'false'}>
      <h1 className="x2f-screen__title">{C.title}</h1>
      <section className="x2f-card x2f-profile__head" aria-label={name}>
        <Avatar name={name} size={48} online={p.online} trusted={p.badges.featured.includes('trusted') || p.badges.more.includes('trusted')} />
        <span className="x2f-profile__who">
          <span className="x2f-profile__name" data-username>
            {name}
          </span>
          <span className="x2f-note" data-part="presence">
            {C.presence(p.online, p.memberSince)}
          </span>
        </span>
      </section>

      <section className="x2f-profile__stats" aria-label="Stats" data-part="stats">
        <Stat part="completed" value={p.stats.completedTrades.toLocaleString('en-US')} label={C.completed} />
        {p.stats.positivePct !== null ? (
          <Stat part="positive" value={`${p.stats.positivePct}%`} label={C.positive(p.stats.ratedReviews)} />
        ) : (
          <Stat part="positive" value="–" label={C.noPct} />
        )}
        {p.stats.typicalMinutes !== null ? <Stat part="typical" value={C.typicalValue(p.stats.typicalMinutes)} label={C.typical} /> : null}
      </section>
      <p className="x2f-note" data-part="disputes">
        {C.disputes(p.stats.disputes)}
      </p>
      {p.tradedOverXmr !== null ? (
        <p className="x2f-note" data-part="traded-line">
          {C.traded(p.tradedOverXmr)}
        </p>
      ) : null}
      {p.imported.map((l) => (
        <p key={l.site} className="x2f-note" data-part="imported-line">
          {C.imported(l)}
        </p>
      ))}

      <section className="x2f-card" aria-labelledby="profile-badges-h" data-part="badges">
        <span className="x2f-profile__section-top">
          <h2 className="x2f-card__title" id="profile-badges-h">
            {C.badges}
          </h2>
          {p.self ? (
            <Link className="x2f-link x2f-profile__link" to="/settings/badges" data-part="choose-badges">
              {C.chooseBadges}
            </Link>
          ) : null}
        </span>
        {badges.length > 0 ? <BadgeChips name={name} badges={badges} featured={featured} /> : <p className="x2f-note">{C.noBadges}</p>}
      </section>

      <section className="x2f-card" aria-labelledby="profile-reviews-h" data-part="reviews">
        <h2 className="x2f-card__title" id="profile-reviews-h">
          {C.recentReviews}
        </h2>
        {p.reviews.length > 0 ? (
          <ul className="x2f-profile__reviews">
            {p.reviews.map((r, i) => (
              <Review key={i} review={r} />
            ))}
          </ul>
        ) : (
          <p className="x2f-note">{C.noReviews}</p>
        )}
      </section>

      {p.pgpProtected ? (
        <p className="x2f-note" data-part="pgp-line">
          {C.pgp}
        </p>
      ) : null}
      {p.recordPublic ? (
        <p className="x2f-note" data-part="record-line">
          {C.record}{' '}
          <Link className="x2f-link x2f-profile__link" to={`/u/${encodeURIComponent(name)}/record`}>
            {C.verify}
          </Link>
        </p>
      ) : null}

      {p.self ? (
        <div className="x2f-stack" data-part="own-links">
          <Link className="x2f-button x2f-button--secondary" to="/profile/offers" data-part="my-offers">
            {C.myOffers(p.offers)}
          </Link>
          <Link className="x2f-button x2f-button--secondary" to="/settings/record" data-part="record-settings">
            {C.recordSettings}
          </Link>
        </div>
      ) : (
        <div className="x2f-stack" data-part="their-links">
          <p className="x2f-note" data-part="offers-count">
            {C.offers(p.offers)}
          </p>
          <BlockAction displayName={name} />
        </div>
      )}
    </main>
  );
}

function Loaded({ load, retry }: { load: Load; retry: () => void }) {
  if (load.kind === 'ok') return <ProfileView profile={load.profile} />;
  return (
    <main className="x2f-screen" data-screen="profile">
      <h1 className="x2f-screen__title">{C.title}</h1>
      {load.kind === 'loading' ? <p className="x2f-note">{C.loading}</p> : null}
      {load.kind === 'missing' ? <p className="x2f-note">{C.notFound}</p> : null}
      {load.kind === 'failed' ? (
        <>
          <p className="x2f-error" role="alert">
            {C.loadFailed}
          </p>
          <Button variant="secondary" onClick={retry}>
            {C.retry}
          </Button>
        </>
      ) : null}
    </main>
  );
}

/** `/profile`: my own profile, by my public display name. */
export function MyProfile() {
  const session = useSession();
  const name = session.status === 'signed-in' ? displayNameOf(session.me) : null;
  const { load, retry } = useProfile(name);
  return <Loaded load={name === null ? { kind: 'loading' } : load} retry={retry} />;
}

/** `/u/:name`: another trader's public profile. */
export function TraderProfileRoute() {
  const { name = '' } = useParams();
  const { load, retry } = useProfile(name);
  return <Loaded key={name} load={load} retry={retry} />;
}
