import { bannerPublishIntent, maintenanceOnIntent, type KeyTapIntent } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import {
  disputeQueue,
  ownerAlerts,
  removeBanner,
  resumeTrading,
  revenue as fetchRevenue,
  serverNow,
  setBanner,
  setMaintenance,
  site as fetchSite,
  stopTrading,
  type MaintenanceKind,
  type RevenueBucket,
  type StaffSite,
} from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Icon, Notice } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { PageTitle } from '../ui/StaffShell.js';
import { PlannedMaintenance } from './PlannedMaintenance.js';
import { usdText, utcClock, utcMinuteText, xmrText } from './staffFormat.js';
import '../ui/staff.css';

/**
 * The owner's Overview (Plan 4 Task 17, board StaffOverview), the owner controls:
 * - the log-alarm card, only while `site_flags.log_alarm` is set (the moderation process's failed
 *   daily activity-log check, Task 14; `GET /staff/v1/site` `logAlarm`). Its words are the plan's
 *   A8 draft. COPY-UNSIGNED
 * - the emergency stop: live → "Pause all new trades" → the key tap ("Tap key and pause", intent
 *   `emergency-stop`) → paused ("Tap key and resume trading", intent `resume-trading`);
 * - earnings: this month, last month and all time from the internal revenue ledger (Task 32,
 *   `GET /staff/v1/revenue`; perm earnings.read). The board's fee-wallet sentence names the
 *   wallet's last characters and a view-only key: the staff API has neither (the fee wallet's
 *   address lives only in the moderation process, NEEDS_PLAN_6_FEE_WALLET), so the sentence here
 *   is draft copy that says where the figures come from. COPY-UNSIGNED OWNER-Q
 * - the banner editor: message, Information/Warning, the live preview, the 140-character counter,
 *   "Show to everyone" / "Remove banner";
 * - maintenance mode: the message and the switch. The API requires a kind (owner G19: planned or
 *   unplanned, no default), so the switch waits until one is picked (not drawn: COPY-UNSIGNED,
 *   DESIGNER-REVIEW). The announced planned maintenance (`PUT …/maintenance/planned`, tapped:
 *   review p4t22 N2) is PlannedMaintenance.tsx's card below it.
 * - the way to News for traders (no board places it; kept here from the shell's first version).
 * - Mod polish, the Today card (no board; DESIGNER-REVIEW, COPY-UNSIGNED): open disputes and
 *   appeals waiting (the queue, `GET /staff/v1/disputes`: its count of every open case, and its
 *   appealed rows, of the first 500 it lists) and new alerts (the owner's unread notifications,
 *   `GET /staff/v1/owner/alerts`). Existing reads only. Support tickets are left out: the staff API
 *   has no tickets route yet (Task 30). A figure that cannot be read shows a dash.
 *
 * Exactly one primary: "Show to everyone"/"Remove banner" while trading is live, "Tap key and
 * resume trading" while it is paused (the board draws both orange). DESIGNER-REVIEW
 */

/** The banner's limit (apps/api/src/staff/site.ts BANNER_MAX, in characters). */
export const BANNER_MAX = 140;
/** The maintenance message's limit (site.ts MAINTENANCE_MESSAGE_MAX). */
export const MAINTENANCE_MESSAGE_MAX = 500;

const chars = (s: string) => [...s].length;

/** The revenue range: by month, from the first of a month nine years back to today (the API allows 3,660 days). */
function revenueRange(now: Date): { by: 'month'; from: string; to: string } {
  return { by: 'month', from: `${now.getUTCFullYear() - 9}-01-01`, to: now.toISOString().slice(0, 10) };
}

const monthKey = (d: Date, back: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)).toISOString().slice(0, 7);

type Tap = { intent: KeyTapIntent; title: string; body: string; tapLabel: string; labels?: Readonly<Record<string, string>>; run: (tapId: string) => Promise<StaffSite> };

export function StaffOverview() {
  const [state, setState] = useState<StaffSite | null>(null);
  const [earn, setEarn] = useState<{ buckets: RevenueBucket[]; total: RevenueBucket } | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [tap, setTap] = useState<Tap | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'info' | 'warning'>('info');
  const [message, setMessage] = useState('');
  const [mKind, setMKind] = useState<MaintenanceKind | null>(null);
  const msgId = useId();
  const mmId = useId();
  const [today, setToday] = useState<Today>({ open: null, appeals: null, alerts: null });

  useEffect(() => {
    fetchSite().then(
      (s) => {
        setState(s);
        if (s.banner !== null) {
          setText(s.banner.text);
          setKind(s.banner.kind);
        }
        if (s.maintenance !== null) {
          setMessage(s.maintenance.message ?? '');
          setMKind(s.maintenance.kind);
        }
      },
      (e: unknown) => setFault(faultText(e, 'X2F could not load the site controls just now. Reload to try again.')),
    );
    fetchRevenue(revenueRange(serverNow())).then(setEarn, () => setEarn(null));
    disputeQueue().then(
      (q) => setToday((t) => ({ ...t, open: q.counts.open, appeals: q.rows.filter((r) => r.status === 'appealed').length })),
      () => undefined,
    );
    ownerAlerts().then(
      (a) => setToday((t) => ({ ...t, alerts: a.unread })),
      () => undefined,
    );
  }, []);

  const run = async (f: () => Promise<StaffSite | null>, fallback: string) => {
    setBusy(true);
    setFault(null);
    try {
      const s = await f();
      if (s !== null) setState(s);
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else setFault(faultText(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const paused = state?.tradingPaused === true;

  const askPause = () =>
    setTap({
      intent: { kind: 'emergency-stop' },
      title: 'Pause all new trades',
      body: 'Tap your security key to pause all new trades. Everyone will see a notice until you resume.',
      tapLabel: 'Tap key and pause',
      run: stopTrading,
    });
  const askResume = () =>
    setTap({
      intent: { kind: 'resume-trading' },
      // COPY-UNSIGNED
      title: 'Resume trading',
      body: 'Tap your security key to open new trades and offers again.',
      tapLabel: 'Tap key and resume trading',
      run: resumeTrading,
    });

  // The banner.
  const trimmed = text.trim();
  const tooLong = chars(text) > BANNER_MAX;
  const shown = state?.banner ?? null;
  const unchanged = shown !== null && shown.text === trimmed && shown.kind === kind;
  // Review p4t22 m2 (lead default): text shown to every user takes the owner's key tap, bound to it.
  const showBanner = () =>
    setTap({
      intent: bannerPublishIntent({ bannerKind: kind, text: trimmed }),
      // COPY-UNSIGNED
      title: 'Show the banner',
      body: 'Tap your security key to show this banner to everyone.',
      tapLabel: 'Tap key and show',
      labels: { textSha256: 'the banner text above' },
      run: (tapId) => setBanner(trimmed, kind, tapId),
    });
  const hideBanner = () =>
    run(async () => {
      await removeBanner();
      return state === null ? null : { ...state, banner: null };
    }, 'The banner was not removed. Try again.');

  // Maintenance.
  const on = state?.maintenance !== null && state?.maintenance !== undefined;
  const msgTooLong = chars(message) > MAINTENANCE_MESSAGE_MAX;
  // Review p4t22 m2 (lead default): switching maintenance on takes the owner's key tap; off does not.
  const toggleMaintenance = () => {
    if (on) return run(() => setMaintenance({ on: false }), 'Maintenance mode was not changed. Try again.');
    const sent = message.trim() === '' ? null : message.trim();
    const maintenanceKind = mKind!;
    // Review p4t22 N2: a planned switch-on with no message of its own shows the announced plan's, and its tap binds that.
    const inherits = sent === null && maintenanceKind === 'planned' && (state?.planned ?? null) !== null;
    const shown = inherits ? (state!.planned!.message ?? null) : sent;
    setTap({
      intent: maintenanceOnIntent({ maintenanceKind, message: shown, backBy: null }),
      // COPY-UNSIGNED
      title: 'Turn maintenance mode on',
      // not-a-refusal: a description of what switching maintenance on does, in the tap dialog.
      body: 'Tap your security key to turn maintenance mode on. Traders cannot use X2F until you turn it off.',
      tapLabel: 'Tap key and turn on',
      labels: { messageSha256: inherits ? "the planned maintenance's message" : 'the message above' },
      run: (tapId) => setMaintenance({ on: true, kind: maintenanceKind, message: sent, tapId }),
    });
    return Promise.resolve();
  };

  const now = serverNow();
  const month = earn?.buckets.find((b) => b.period === monthKey(now, 0)) ?? null;
  const last = earn?.buckets.find((b) => b.period === monthKey(now, 1)) ?? null;

  return (
    <section data-screen="staff-overview" className="x2f-staff-narrow">
      <PageTitle title="Overview">
        <p className="x2f-staff-page__lead">Owner controls. Every change here is recorded in the activity log.</p>
      </PageTitle>
      {state?.logAlarm ? (
        <Notice tone="danger" title="Activity log alarm" data-part="log-alarm">
          {`The activity log failed its integrity check at ${utcMinuteText(state.logAlarm)}. Contact your security reviewer.`}
        </Notice>
      ) : null}
      {fault !== null ? (
        <Notice tone="danger" data-part="overview-fault">
          {fault}
        </Notice>
      ) : null}

      <TodayCard t={today} />

      <section aria-label="Emergency stop" className="x2f-staff-card x2f-stack" data-part="emergency-stop">
        <h2 className="x2f-h2">Emergency stop</h2>
        {state === null ? null : paused ? (
          <>
            <p className="x2f-staff-state" data-tone="danger">
              {`New trades are paused since ${state.stoppedAt !== null ? utcClock(state.stoppedAt) : ''}. Trades in escrow are carrying on.`}
            </p>
            <div>
              <Button variant="primary" disabled={busy} onClick={askResume}>
                Tap key and resume trading
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="x2f-staff-state" data-tone="ok">
              <Icon name="check" size={18} />
              X2F is live. New trades are open.
            </p>
            <p className="x2f-staff-page__lead">
              If something goes wrong, such as an attack or a serious bug, pause every new trade and offer at once. Trades already in escrow can still be released, refunded or disputed, so nobody's coins get stuck.
            </p>
            <div>
              <Button variant="danger-outline" disabled={busy} onClick={askPause}>
                Pause all new trades
              </Button>
            </div>
          </>
        )}
      </section>

      <section aria-label="Earnings" className="x2f-staff-card x2f-stack" data-part="earnings">
        <h2 className="x2f-h2">Earnings</h2>
        <div className="x2f-staff-earnings">
          <EarningsCard title="This month" b={month} trades />
          <EarningsCard title="Last month" b={last} trades />
          <EarningsCard title="All time" b={earn?.total ?? null} />
        </div>
        {/* COPY-UNSIGNED, OWNER-Q: replaces the board's wallet-end and view-only-key sentence (see the header). */}
        <p className="x2f-staff-hint">The 1% fee from each completed trade and each settled dispute goes to X2F's fee wallet. These figures come from X2F's own record of every fee paid.</p>
        {/* NEEDS_DESIGN_REVENUE: no board places the owner's books (network fees paid and the net, owner
            16 Nov); a plain link to the minimal Revenue page until design draws it. COPY-UNSIGNED */}
        <p className="x2f-staff-page__lead">
          <Link className="x2f-link" to="/overview/revenue">
            Revenue
          </Link>
          {' · '}
          {/* Owner 26 Nov 2026: every trade not deleted yet, by status (TradeStatus). COPY-UNSIGNED */}
          <Link className="x2f-link" to="/overview/trades">
            Trade status
          </Link>
        </p>
      </section>

      <section aria-label="Announcement banner" className="x2f-staff-card x2f-stack" data-part="banner">
        <h2 className="x2f-h2">Announcement banner</h2>
        <p className="x2f-staff-page__lead">Show a message at the top of every screen, for every user. Change or remove it whenever you like.</p>
        <div className="x2f-field">
          <label htmlFor={msgId} className="x2f-label">
            Message
          </label>
          <input id={msgId} type="text" className="x2f-input" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="x2f-staff-hint x2f-staff-count" data-part="banner-count" data-tone={tooLong ? 'danger' : 'plain'}>{`${chars(text)} / ${BANNER_MAX}`}</span>
        </div>
        <div role="radiogroup" aria-label="Banner type" className="x2f-staff-pills">
          {(
            [
              ['info', 'Information'],
              ['warning', 'Warning'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className="x2f-staff-pill" onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="x2f-staff-hint">Preview</span>
        <div aria-label="Banner preview" className="x2f-staff-banner-preview" data-kind={kind}>
          {text}
        </div>
        <div className="x2f-staff-hours-row">
          {unchanged ? (
            <Button variant={paused ? 'secondary' : 'primary'} disabled={busy} onClick={() => void hideBanner()}>
              Remove banner
            </Button>
          ) : (
            <Button variant={paused ? 'secondary' : 'primary'} disabled={busy || tooLong || trimmed === ''} onClick={() => void showBanner()}>
              Show to everyone
            </Button>
          )}
          {shown !== null && !unchanged ? (
            <Button variant="quiet" disabled={busy} onClick={() => void hideBanner()}>
              Remove banner
            </Button>
          ) : null}
        </div>
        <span className="x2f-staff-hint" data-part="banner-state">
          {shown !== null ? 'Showing to everyone now.' : 'Not showing.'}
        </span>
      </section>

      <section aria-label="Maintenance mode" className="x2f-staff-card x2f-stack" data-part="maintenance">
        <h2 className="x2f-h2">Maintenance mode</h2>
        <p className="x2f-staff-page__lead">For planned upgrades. Users see the message below instead of the app; trades in escrow keep their timers paused until you switch it off.</p>
        <div className="x2f-field">
          <label htmlFor={mmId} className="x2f-label">
            Message to users
          </label>
          <input id={mmId} type="text" className="x2f-input" value={message} disabled={on} onChange={(e) => setMessage(e.target.value)} />
        </div>
        {/* COPY-UNSIGNED, DESIGNER-REVIEW: the kind the API requires (owner G19), not on the board. */}
        <div role="radiogroup" aria-label="Maintenance kind" className="x2f-staff-pills">
          {(
            [
              ['planned', 'Planned'],
              ['unplanned', 'Unplanned'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mKind === k} disabled={on} className="x2f-staff-pill" onClick={() => setMKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <label className="x2f-check">
          <input type="checkbox" checked={on} disabled={busy || state === null || (!on && (mKind === null || msgTooLong))} onChange={() => void toggleMaintenance()} />
          <span>Maintenance mode on</span>
        </label>
      </section>

      <PlannedMaintenance plan={state?.planned} onChange={(s) => setState(s ?? (state === null ? null : { ...state, planned: null }))} />

      <p className="x2f-staff-page__lead">
        <Link className="x2f-link" to="/overview/news">
          News for traders
        </Link>
      </p>

      {tap !== null ? (
        <KeyTapDialog
          intent={tap.intent}
          title={tap.title}
          body={tap.body}
          tapLabel={tap.tapLabel}
          {...(tap.labels ? { labels: tap.labels } : {})}
          onDone={(tapId) => {
            const t = tap;
            setTap(null);
            void run(() => t.run(tapId), 'That did not go through. Try again.');
          }}
          onCancel={() => setTap(null)}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}

interface Today {
  open: number | null;
  appeals: number | null;
  alerts: number | null;
}

/** Mod polish: today's figures, each a way to the page that holds them. COPY-UNSIGNED, DESIGNER-REVIEW */
function TodayCard({ t }: { t: Today }) {
  const n = (v: number | null) => (v === null ? '–' : String(v));
  const tiles: ReadonlyArray<readonly [string, number | null, string, string]> = [
    ['today-open', t.open, 'Open disputes', '/disputes'],
    ['today-appeals', t.appeals, 'Appeals waiting', '/disputes'],
    ['today-alerts', t.alerts, 'New alerts', '/notifications'],
  ];
  return (
    <section aria-label="Today" className="x2f-staff-card x2f-stack" data-part="today">
      <h2 className="x2f-h2">Today</h2>
      <ul className="x2f-staff-today">
        {tiles.map(([part, v, label, to]) => (
          <li key={part} className="x2f-staff-earn" data-part={part}>
            <span className="x2f-staff-today__n">{n(v)}</span>
            <Link className="x2f-link" to={to}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EarningsCard({ title, b, trades = false }: { title: string; b: RevenueBucket | null; trades?: boolean }) {
  const xmr = b?.totalAtomic ?? '0';
  const usd = b?.usdEstimateCents ?? '0';
  const n = b?.trades ?? 0;
  return (
    <div className="x2f-staff-earn" data-part="earnings-card">
      <span className="x2f-staff-hint">{title}</span>
      <span className="x2f-staff-earn__xmr" data-mask="">{`${xmrText(xmr)} XMR`}</span>
      <span className="x2f-staff-hint">{`about ${usdText(usd)}${trades ? ` · ${n} ${n === 1 ? 'trade' : 'trades'}` : ''}`}</span>
    </div>
  );
}
