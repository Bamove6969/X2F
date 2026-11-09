/**
 * AccountFrozen (D-016, build spec j33a section 6; boards AccountFrozen(+Wide) on wip/design-brief,
 * new 9 Nov): the full-screen notice that a moderator froze trading on the account. Laid out like
 * Ban-Notice with a caution hero: the facts (since, no end date, the dispute it came from), what
 * still works, what is paused. "Go to your dispute" is the one primary; Close and "Not now" go home.
 * Every string is COPY-UNSIGNED. The wording matches My offers' hold notice.
 *
 * NEEDS_API_FROZEN_STATE: the API has trading holds (trading_holds; refusals 'trading-hold') but no
 * call that tells the web an account is frozen, since when, or from which dispute. Until it does,
 * the screen is reached only at FROZEN_PATH, whose route reads `setFrozenSource` (nothing installs
 * one yet) and goes home while there is no state. Not wired yet, waiting on that state: opening it
 * at the next login after a freeze, and when a frozen user tries to start or join a trade or post
 * an offer; the Jabber alert.
 */
import { Link, Navigate, useNavigate } from 'react-router';
import { formatXmr } from '@x2f/trade';
import { Button } from '../../ui/Button.js';
import { utcDateTime } from '../../ui/dates.js';
import { Hero, ResultHeadline } from '../../ui/Hero.js';
import { Icon, type IconName } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import './frozen.css';

export const FROZEN_PATH = '/account/frozen';

/**
 * What the notice shows: when the freeze started and the dispute it came from (the viewer's side of
 * that trade). `incidentId` is the dispute's own incident ID as the API stores it (G37: 9 characters,
 * disputes.incident_id, the one the trade header and the moderator show), never derived here; null
 * while the API gives none, and then the notice shows no ID.
 */
export interface FrozenState {
  since: string;
  dispute: { code: string; incidentId: string | null; side: 'buying' | 'selling'; amountAtomic: string; counterparty: string };
}

let source: (() => FrozenState | null) | null = null;

/** Installs where the frozen state comes from (the API, once it says; a test); null removes it. */
export function setFrozenSource(s: (() => FrozenState | null) | null): void {
  source = s;
}

const HOME = '/';

const WORKS: { icon: IconName; text: string }[] = [
  { icon: 'check', text: 'You can log in and use your wallets.' },
  { icon: 'chat', text: "You can chat in your dispute. When you've done what the moderator asks, tell them there and they'll check and lift the freeze." },
  { icon: 'swap', text: 'Trades you already started carry on.' },
  { icon: 'shield', text: "Your XMR isn't affected. Your wallet keys are on your device, so no one can freeze your coins." },
];

const PAUSED = ['Starting or joining new trades.', 'Posting offers. Your offers are hidden for now.'];

export function AccountFrozen({ state }: { state: FrozenState }) {
  const navigate = useNavigate();
  const d = state.dispute;
  const since = utcDateTime(new Date(state.since));
  return (
    <main className="x2f-frozen" data-screen="account-frozen" aria-labelledby="frozen-title">
      <header className="x2f-frozen__header">
        <Link className="x2f-icon-button" to={HOME} aria-label="Close">
          <Icon name="close" size={24} stroke={1.75} />
        </Link>
        <span className="x2f-frozen__page">Account frozen</span>
      </header>
      <Hero tone="caution" kind="result" label="Account frozen" chip={<StatusChip tone="caution" icon="snowflake" label="Trading frozen" />}>
        <ResultHeadline id="frozen-title" title="A moderator froze trading on your account" lead="Open your dispute to see what you need to do to get it back." />
        <dl className="x2f-frozen__facts">
          <div>
            <dt>Frozen since</dt>
            <dd className="x2f-frozen__mono">{since}</dd>
          </div>
          <div>
            <dt>Ends</dt>
            <dd>When a moderator lifts it</dd>
          </div>
          <div>
            <dt>Dispute</dt>
            <dd>
              {d.incidentId !== null && (
                <>
                  <span className="x2f-frozen__mono">#{d.incidentId}</span> ·{' '}
                </>
              )}
              {d.side === 'selling' ? 'Selling' : 'Buying'}{' '}
              <span className="x2f-frozen__mono">{formatXmr(BigInt(d.amountAtomic))}</span> XMR {d.side === 'selling' ? 'to' : 'from'}{' '}
              <span data-username="">{d.counterparty}</span>
            </dd>
          </div>
        </dl>
      </Hero>
      <section className="x2f-frozen__card" aria-labelledby="frozen-works">
        <h2 className="x2f-section-title" id="frozen-works">
          What still works
        </h2>
        <ul className="x2f-frozen__list" data-tone="escrow">
          {WORKS.map((w) => (
            <li key={w.text}>
              <Icon name={w.icon} size={20} stroke={1.75} />
              <span>{w.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="x2f-frozen__card" aria-labelledby="frozen-paused">
        <h2 className="x2f-section-title" id="frozen-paused">
          Paused until it's lifted
        </h2>
        <ul className="x2f-frozen__list" data-tone="caution">
          {PAUSED.map((t) => (
            <li key={t}>
              <Icon name="pause-circle" size={20} stroke={1.75} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
      <footer className="x2f-frozen__actions">
        <Button variant="primary" href={`/trade/${encodeURIComponent(d.code)}/dispute`}>
          Go to your dispute
        </Button>
        <Button variant="quiet" onClick={() => void navigate(HOME)}>
          Not now
        </Button>
      </footer>
    </main>
  );
}

/** FROZEN_PATH: the notice for the frozen state its source gives; home while there is none. */
export function AccountFrozenRoute() {
  const state = source?.() ?? null;
  return state === null ? <Navigate to={HOME} replace /> : <AccountFrozen state={state} />;
}
