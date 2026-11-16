/**
 * AccountFrozen (D-016, build spec j33a section 6; boards AccountFrozen(+Wide) on wip/design-brief,
 * new 9 Nov): the full-screen notice that a moderator froze trading on the account. Laid out like
 * Ban-Notice with a caution hero: the facts (since, no end date, the dispute it came from), what
 * still works, what is paused. "Go to your dispute" is the one primary; Close and "Not now" go home.
 * Every string is COPY-UNSIGNED. The wording matches My offers' hold notice.
 *
 * The frozen state comes from `GET /v1/account/freeze` (D-013..D-016: a moderator froze the account
 * as a party who ignored a dispute or a ruling; no end time; a moderator lifts it once the person
 * has done what the dispute asks, which they tell the moderator in the dispute chat). FROZEN_PATH
 * reads it and goes home while the account is not frozen. `FrozenWatch` opens the notice once per
 * freeze in this browser session after a login (the account owner's sessions; a team member's
 * login never asks). The Jabber alert is the generic account-change notice the freeze row already
 * sends (jabber/changePaths.ts). Not wired here: opening the notice from a refused take or post
 * (those show their CantDoThat words).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { formatXmr } from '@x2f/trade';
import { api } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { formatDateTime as utcDateTime } from '../../ui/dates.js';
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

const AMOUNT = /^[1-9][0-9]{0,30}$/;
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * `GET /v1/account/freeze`'s answer as the notice reads it: the oldest active freeze that still
 * names its dispute (a freeze whose trade record is gone, `dispute: null`, cannot fill the board's
 * Dispute row or its "Go to your dispute"), with the account's side as the board words it. Null
 * when the account is not frozen, and for anything malformed.
 */
export function parseFreeze(raw: unknown): FrozenState | null {
  if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as { freezes?: unknown }).freezes)) return null;
  for (const f of (raw as { freezes: unknown[] }).freezes) {
    if (f === null || typeof f !== 'object') return null;
    const { since, dispute } = f as { since?: unknown; dispute?: unknown };
    if (typeof since !== 'string' || Number.isNaN(Date.parse(since))) return null;
    if (dispute === null) continue;
    if (dispute === undefined || typeof dispute !== 'object') return null;
    const d = dispute as Record<string, unknown>;
    if (!isText(d.code) || !isText(d.counterparty) || typeof d.amountAtomic !== 'string' || !AMOUNT.test(d.amountAtomic)) return null;
    if (d.side !== 'buyer' && d.side !== 'seller') return null;
    if (d.incidentId !== null && !isText(d.incidentId)) return null;
    return {
      since,
      dispute: { code: d.code, incidentId: d.incidentId, side: d.side === 'seller' ? 'selling' : 'buying', amountAtomic: d.amountAtomic, counterparty: d.counterparty },
    };
  }
  return null;
}

/** The account's frozen state from the API; null when it is not frozen or the call fails. */
export function loadFrozenState(): Promise<FrozenState | null> {
  return api<unknown>('/v1/account/freeze').then(parseFreeze, () => null);
}

type Source = () => FrozenState | null | Promise<FrozenState | null>;
let source: Source | null = null;

/** Replaces where the frozen state comes from (a test); null restores the API. */
export function setFrozenSource(s: Source | null): void {
  source = s;
}

const readState = (): FrozenState | null | Promise<FrozenState | null> => (source ?? loadFrozenState)();

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

/** FROZEN_PATH: the notice for the account's frozen state; home while there is none. */
export function AccountFrozenRoute() {
  const pending = useRef<Promise<FrozenState | null> | null>(null);
  const [state, setState] = useState<FrozenState | null | 'loading'>(() => {
    const first = readState();
    if (!(first instanceof Promise)) return first;
    pending.current = first;
    return 'loading';
  });
  useEffect(() => {
    const p = pending.current;
    if (p === null) return;
    let live = true;
    void p.then((s) => live && setState(s), () => live && setState(null));
    return () => {
      live = false;
    };
  }, []);
  if (state === 'loading') return null;
  return state === null ? <Navigate to={HOME} replace /> : <AccountFrozen state={state} />;
}

/** Freezes this page load has already opened the notice for (`since`), when storage is unavailable. */
const shownHere = new Set<string>();
const SHOWN_KEY = 'x2f.frozen-shown';

function shownBefore(since: string): boolean {
  if (shownHere.has(since)) return true;
  try {
    return sessionStorage.getItem(SHOWN_KEY) === since;
  } catch {
    return false;
  }
}

function markShown(since: string): void {
  shownHere.add(since);
  try {
    sessionStorage.setItem(SHOWN_KEY, since);
  } catch {
    // Private window or blocked storage: this page load still remembers it.
  }
}

/** Pages the watch never leaves: the notice, and every trade page (its room, chat and dispute). */
const stayOn = (at: string) => at === FROZEN_PATH || at === '/trade' || at.startsWith('/trade/');

/**
 * D-016: after a login (`enabled`: the account owner's signed-in trader session), reads the frozen
 * state once and, when the account is frozen and this freeze's notice has not been opened in this
 * browser session, opens FROZEN_PATH. F2 (freeze review 12 Nov): never from the notice itself or any
 * trade page (`/trade/...`: the frozen person may still have to pay or release there); the notice
 * then waits, and opens on the first page they go to that is not one.
 */
export function FrozenWatch({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const where = useRef(pathname);
  where.current = pathname;
  /** The frozen state read, not yet shown because the person was on a trade page. */
  const [waiting, setWaiting] = useState<FrozenState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Promise.resolve(readState()).then(
      (s) => {
        if (!live || s === null || shownBefore(s.since)) return;
        if (stayOn(where.current)) {
          setWaiting(s);
          return;
        }
        markShown(s.since);
        void navigate(FROZEN_PATH);
      },
      () => undefined,
    );
    return () => {
      live = false;
      setWaiting(null);
    };
  }, [enabled, navigate]);
  useEffect(() => {
    if (waiting === null || stayOn(pathname)) return;
    setWaiting(null);
    if (shownBefore(waiting.since)) return;
    markShown(waiting.since);
    void navigate(FROZEN_PATH);
  }, [waiting, pathname, navigate]);
  return null;
}
