/**
 * Hold model v3 (lead hold v3 review item 3; owner G29, G31, G36): the account owner's changes that
 * wait 24 hours.
 *
 * - A change made from a login with just a username and password answers 202 `{ status: 'staged',
 *   changeId }`: the screen that made it shows `StagedNote` ("Saved as a draft") with a link here,
 *   and tells this panel to load again (`notifyHoldChanged`).
 * - `AccountChanges` (on Settings → Security and its own screen, `CHANGES_PATH`): the drafts in one
 *   review, each before → after, with the 24-hour wait said before the one final submit and the
 *   push to add a stronger login (G29); then the waiting changes (g65: one view of every change and
 *   its effect, the date and a countdown, each ticked: untick to cancel it, or Cancel all changes
 *   with a short confirm; a cancelled change never applies). A login with a passkey, security key or
 *   PGP key (`changesWait` false) sees the same view with Approve now (G58: `POST
 *   /v1/account/hold/changes/approve { ids }`, the API route is being added) and Make changes.
 * - `ChangesBanner` (the app shell): "N changes take effect on <date>" with Review changes while
 *   changes wait, from `me().pendingChanges`. A team member (owner p4-8, HoldMember board) sees "A
 *   hold is on" instead (`me().teamHold`), and the panel shows them what the right the lead granted
 *   allows (`HoldView.rights`): none (that a hold is on, its countdown), see (the list), cancel
 *   (ticks and Cancel all changes), end (also End the hold, from their strong login). Removals wait
 *   like every change (owner p5-7).
 * - `ChangesCapPopup` (the app shell): 409 `too-many-changes` from any screen, through CantDoThat
 *   (G36: at most 20).
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AuthApiError, type HoldView } from '@x2f/auth-client';
import { ApiCallError, returnToFrom } from '../../api/client.js';
import { memberOf } from '../../session/member.js';
import { refreshSession, useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { Countdown } from '../../ui/Countdown.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, TOO_MANY_CHANGES_CODE, holdChangesCantDoText } from '../../ui/cantDoCodes.js';
import { Notice } from '../../ui/Notice.js';
import { Sheet } from '../../ui/Sheet.js';
import { authApi } from '../auth/authApi.js';
import { CHANGES_PATH, HOLD_COPY as C, MEMBER_HOLD_COPY as M, NEW_CODE_COPY, changeWords } from './holdCopy.js';
import '../screens.css';
import { RetryLine } from '../../ui/RetryButton.js';

const CHANGED = 'x2f:hold-changed';
/** The hold view sends no server time; the date beside the countdown is in UTC either way. */
const deviceClock = () => new Date();
const CAPPED = 'x2f:changes-cap';

/** A change was staged, submitted or cancelled: every mounted `AccountChanges` and banner loads again. */
export function notifyHoldChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

function useOnHoldChanged(f: () => void): void {
  useEffect(() => {
    window.addEventListener(CHANGED, f);
    return () => window.removeEventListener(CHANGED, f);
  }, [f]);
}

/** The cap the API sent with 409 `too-many-changes`, or null for any other error. */
export function changesCapOf(e: unknown): { max: number | undefined } | null {
  if (e instanceof AuthApiError && e.code === TOO_MANY_CHANGES_CODE) return { max: e.max };
  if (e instanceof ApiCallError && e.code === TOO_MANY_CHANGES_CODE) return { max: typeof e.extra.max === 'number' ? e.extra.max : undefined };
  return null;
}

/** True (and the shell's popup opens) when `e` is 409 `too-many-changes`; the caller then shows nothing else. */
export function reportChangesCap(e: unknown): boolean {
  const cap = changesCapOf(e);
  if (cap === null) return false;
  window.dispatchEvent(new CustomEvent(CAPPED, { detail: cap.max }));
  return true;
}

/** The shell's CantDoThat for 409 `too-many-changes` (G36), whichever screen made the change. */
export function ChangesCapPopup() {
  const [max, setMax] = useState<number | undefined | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMax((e as CustomEvent<number | undefined>).detail);
    window.addEventListener(CAPPED, on);
    return () => window.removeEventListener(CAPPED, on);
  }, []);
  if (max === null) return null;
  return <CantDoThat title={CANT_DO_TITLE.changes} body={holdChangesCantDoText(max)} from={TOO_MANY_CHANGES_CODE} onClose={() => setMax(null)} />;
}

/** Says a change was staged (202), with the way to review and submit it. Tells the panel to load again. */
export function StagedNote({ part = 'staged-note' }: { part?: string }) {
  useEffect(() => {
    notifyHoldChanged();
  }, []);
  return (
    <p className="x2f-note" role="status" data-part={part}>
      {C.staged}{' '}
      <Link className="x2f-link" to={CHANGES_PATH}>
        {C.stagedLink}
      </Link>
    </p>
  );
}

function ChangeRow({ title, before, after, meta, action }: { title: string; before: string; after: string; meta?: string[]; action: React.ReactNode }) {
  return (
    <li className="x2f-list__row x2f-change" data-part="change">
      <span className="x2f-change__body">
        <span className="x2f-list__label">{title}</span>
        <span className="x2f-change__ba">
          <span className="x2f-change__before">
            <span className="x2f-change__k">{C.before}</span> {before}
          </span>
          <span className="x2f-change__after">
            <span className="x2f-change__k">{C.after}</span> {after}
          </span>
        </span>
        {(meta ?? []).map((m) => (
          <span className="x2f-list__time" key={m}>
            {m}
          </span>
        ))}
      </span>
      {action}
    </li>
  );
}

type Status = { kind: 'done' | 'error'; text: string } | null;

/**
 * The drafts to review and submit, and the waiting changes to cancel. Renders nothing while there
 * are none (unless `standalone`, its own screen, which then says so), and nothing when the list
 * cannot be read (a team member's 403, an older API).
 */
export function AccountChanges({ standalone = false }: { standalone?: boolean }) {
  const [view, setView] = useState<HoldView | null>(null);
  const [failed, setFailed] = useState(false);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [ask, setAsk] = useState(false);
  // Owner g65: the waiting changes the person unticked (to cancel).
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const askId = useId();

  const load = useCallback(async () => {
    try {
      const v = await authApi.holdView();
      setView(v);
      setUnticked((u) => new Set([...u].filter((id) => v.changes.items.some((c) => c.id === id))));
      setFailed(false);
      // A role change names its member (G29's before → after); the team list has their names.
      if ([...v.drafts, ...v.changes.items].some((c) => c.memberId !== undefined)) {
        authApi.getTeam().then((t) => setNames(new Map(t.members.map((m) => [m.id, m.displayName]))), () => undefined);
      }
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useCallback(() => void load(), [load]);
  useOnHoldChanged(reload);

  const after = async (f: () => Promise<Status>) => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      setStatus(await f());
    } finally {
      setBusy(false);
      await load();
      refreshSession();
    }
  };

  const submit = () =>
    after(async () => {
      try {
        const r = await authApi.submitHoldChanges({ ids: view!.drafts.map((d) => d.id) });
        return { kind: 'done', text: C.submitted(r.takesEffectAt) };
      } catch (e) {
        if (e instanceof AuthApiError && e.code === 'changes-changed') return { kind: 'error', text: C.changed };
        return { kind: 'error', text: C.submitFailed };
      }
    });

  const cancelOne = (id: string) =>
    after(async () => {
      try {
        await authApi.cancelHoldChange(id);
        return null;
      } catch {
        return { kind: 'error', text: C.cancelFailed };
      }
    });

  /** Cancels each unticked waiting change, one by one; a cancelled change never applies (g65). */
  const cancelIds = async (ids: readonly string[]): Promise<boolean> => {
    for (const id of ids) await authApi.cancelHoldChange(id);
    setUnticked(new Set());
    return true;
  };

  const cancelUnticked = () =>
    after(async () => {
      try {
        await cancelIds([...unticked]);
        return { kind: 'done', text: C.cancelled };
      } catch {
        return { kind: 'error', text: C.cancelFailed };
      }
    });

  // Owner G58: a strong login approves the ticked changes now (they apply at once); unticked ones are cancelled first.
  const approve = () =>
    after(async () => {
      try {
        const keep = waiting.filter((c) => !unticked.has(c.id)).map((c) => c.id);
        await cancelIds([...unticked]);
        if (keep.length > 0) await authApi.approveHoldChanges({ ids: keep });
        return { kind: 'done', text: isMember ? M.ended : C.approved };
      } catch (e) {
        if (e instanceof AuthApiError && e.code === 'changes-changed') return { kind: 'error', text: C.changed };
        return { kind: 'error', text: C.approveFailed };
      }
    });

  const cancelAll = () => {
    setAsk(false);
    void after(async () => {
      try {
        const n = waiting.length;
        await authApi.cancelHoldChanges();
        return { kind: 'done', text: isMember ? M.cancelled(n) : C.cancelled };
      } catch {
        return { kind: 'error', text: C.cancelFailed };
      }
    });
  };

  const drafts = view?.drafts ?? [];
  const waiting = view?.changes.items ?? [];
  const due = view?.changes.takesEffectAt ?? null;
  // Owner p4-8: a team member's view follows the hold right the lead granted (`rights`).
  const rights = view?.rights;
  const isMember = rights !== undefined;
  const lead = view?.lead ?? '';
  // This session's own changes apply at once (a passkey, security key or PGP key login): G58's Approve now.
  const strong = view !== null && !view.changesWait && !isMember;
  const canTick = !isMember || rights === 'cancel' || rights === 'end';
  const canApprove = isMember ? rights === 'end' : strong;
  // A member without a right still sees that a hold is on (the date, no list).
  const holdOn = waiting.length > 0 || (isMember && due !== null);

  const statusLine =
    status === null ? null : status.kind === 'error' ? (
      <p className="x2f-error" role="alert" data-part="changes-status">
        {status.text}
      </p>
    ) : (
      <p className="x2f-note" role="status" data-part="changes-status">
        {status.text}
      </p>
    );

  if (failed) {
    return standalone ? (
      <p className="x2f-error" role="alert" data-part="changes-load-error">
        {/* DESIGN: owner 17 Nov black+orange rule: the load error's orange retry (reloads the page). */}
        <RetryLine text={C.loadFailed} data-part="changes-retry" />
      </p>
    ) : null;
  }
  if (view === null) return null;
  if (drafts.length === 0 && !holdOn) {
    if (statusLine !== null) return <section className="x2f-card" data-part="account-changes">{statusLine}</section>;
    return standalone ? (
      <section className="x2f-card" data-part="account-changes">
        <p className="x2f-note" data-part="changes-none">
          {C.none}
        </p>
      </section>
    ) : null;
  }

  return (
    <>
      {drafts.length > 0 ? (
        <section className="x2f-card" data-part="change-drafts" aria-labelledby={`${askId}-drafts`}>
          <h2 className="x2f-card__title" id={`${askId}-drafts`}>
            {C.draftsTitle}
          </h2>
          <p className="x2f-note" data-part="drafts-count">
            {C.draftsCount(drafts.length, 20)}
          </p>
          <ul className="x2f-list" data-part="draft-list">
            {drafts.map((d) => {
              const w = changeWords(d, names);
              return (
                <ChangeRow
                  key={d.id}
                  {...w}
                  action={
                    <Button variant="quiet" disabled={busy} onClick={() => void cancelOne(d.id)} aria-label={C.removeLabel(w.title)} data-part="draft-remove">
                      {C.remove}
                    </Button>
                  }
                />
              );
            })}
          </ul>
          {/* G29: a username-and-password person is told of the 24-hour wait before submitting. */}
          <Notice tone="caution" title={C.waitTitle} live="off" data-part="drafts-wait">
            <p>{C.waitBody}</p>
            <p>{C.telling}</p>
            <p>{C.throwAway}</p>
          </Notice>
          <Notice tone="info" data-part="drafts-stronger">
            <p>
              {C.stronger}{' '}
              <Link className="x2f-link" to="/settings/security#methods-h">
                {C.strongerLink}
              </Link>
            </p>
          </Notice>
          <p className="x2f-note">{C.nothingYet}</p>
          <Button variant="primary" disabled={busy} onClick={() => void submit()} data-part="drafts-submit">
            {C.submit(drafts.length)}
          </Button>
        </section>
      ) : null}
      {holdOn ? (
        <section className="x2f-card" data-part="changes-waiting" data-rights={rights} aria-labelledby={`${askId}-waiting`}>
          <h2 className="x2f-card__title" id={`${askId}-waiting`}>
            {isMember ? M.title : C.waitingTitle}
          </h2>
          {isMember ? (
            <Notice tone="caution" live="off" data-part="member-hold">
              <p>{M.hero(lead)}</p>
              <p>{M.why(lead)}</p>
            </Notice>
          ) : null}
          {due !== null ? (
            <>
              {!isMember ? (
                <p className="x2f-note" data-part="waiting-when">
                  {C.banner(waiting.length, due)}
                </p>
              ) : null}
              {/* g65: a countdown while the changes are held. */}
              <p className="x2f-change__countdown" data-part="waiting-countdown">
                <span className="x2f-change__k">{isMember ? M.endsIn : C.countdownLead}</span> <Countdown deadline={due} serverClock={deviceClock} format="minutes" />
              </p>
            </>
          ) : null}
          {isMember ? (
            <>
              <p className="x2f-note">{M.trading}</p>
              <p className="x2f-note" data-part="member-rights">
                {rights === 'none' ? M.none(lead) : rights === 'see' ? M.see : M.cancel}
              </p>
              {waiting.length > 0 ? <p className="x2f-list__time">{M.submittedBy(lead)}</p> : null}
            </>
          ) : null}
          {strong ? (
            <Notice tone="info" data-part="waiting-strong">
              <p>{C.strongNote}</p>
            </Notice>
          ) : null}
          {canTick && !isMember ? <p className="x2f-note">{C.untickHelp}</p> : null}
          {waiting.length > 0 ? (
          <ul className="x2f-list" data-part="waiting-list">
            {waiting.map((c) => {
              const w = changeWords(c, names);
              const removal = c.kind === 'remove-wallet' || c.kind === 'team-remove';
              // Each waiting change has its own date (lead review 8 Nov I4).
              const at = c.takesEffectAt ?? due;
              const effect = at !== null ? [removal ? C.removes(at) : C.applies(at)] : [];
              const from = isMember ? null : c.mine ? C.fromHere : c.by !== null ? C.from(c.by) : null;
              const meta = [...effect, from].filter((m): m is string => m !== null);
              const kept = !unticked.has(c.id);
              return (
                <ChangeRow
                  key={c.id}
                  {...w}
                  meta={meta}
                  action={
                    !canTick ? null : <Checkbox
                      checked={kept}
                      disabled={busy}
                      aria-label={C.keepLabel(w.title)}
                      data-part="waiting-keep"
                      onChange={(on) =>
                        setUnticked((u) => {
                          const next = new Set(u);
                          if (on) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    />
                  }
                />
              );
            })}
          </ul>
          ) : null}
          {canApprove && isMember && waiting.length > 0 ? <p className="x2f-note" data-part="member-end-note">{M.endNote}</p> : null}
          {canApprove && waiting.length > 0 ? (
            <Button variant="primary" disabled={busy || unticked.size === waiting.length} onClick={() => void approve()} data-part="waiting-approve">
              {isMember ? M.end : C.approve(waiting.length - unticked.size)}
            </Button>
          ) : null}
          {canTick && unticked.size > 0 ? (
            <Button variant="secondary" disabled={busy} onClick={() => void cancelUnticked()} data-part="waiting-cancel-unticked">
              {C.cancelUnticked(unticked.size)}
            </Button>
          ) : null}
          {canTick && waiting.length > 0 ? (
            <Button variant="danger-outline" disabled={busy} onClick={() => setAsk(true)} data-part="waiting-cancel-all">
              {C.cancelAll}
            </Button>
          ) : null}
          {strong ? (
            <Link className="x2f-button x2f-button--tertiary" to="/settings/security#methods-h" data-part="waiting-make-changes">
              {C.makeChanges}
            </Link>
          ) : null}
        </section>
      ) : null}
      {statusLine}
      <Sheet open={ask} title={C.cancelAsk(waiting.length)} describedBy={`${askId}-ask`} onClose={() => setAsk(false)}>
        <div className="x2f-stack" data-part="cancel-ask">
          <p id={`${askId}-ask`}>{C.cancelAskBody}</p>
          <Button variant="danger-outline" onClick={cancelAll} data-part="cancel-yes">
            {C.cancelYes}
          </Button>
          <Button variant="tertiary" onClick={() => setAsk(false)} data-part="cancel-keep">
            {C.cancelKeep}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** `CHANGES_PATH`: the account owner's own screen for the drafts and the waiting changes (the banner's Review changes). */
export function AccountChangesScreen() {
  const { search } = useLocation();
  // After a strong login (G58) the screen comes first and Continue goes on where the person was going.
  const onward = new URLSearchParams(search).has('returnTo') ? returnToFrom(search) : null;
  // Owner p4-8: a team member comes here too; the API answers what their hold right allows.
  return (
      <main className="x2f-screen" data-screen="account-changes">
        <h1 className="x2f-screen__title">{C.screenTitle}</h1>
        <AccountChanges standalone />
        {onward !== null ? (
          <Link className="x2f-button x2f-button--tertiary" to={onward} data-part="changes-continue">
            {C.continue}
          </Link>
        ) : null}
      </main>
  );
}

/**
 * The shell's banner (HoldChange board): while changes wait, "N changes take effect on <date>" and
 * Review changes; while a new recovery code waits to be written down, the reminder (RecoveryCode
 * board, reminder step). Not on the screens that show these in full. A team member's overview has
 * neither (G31).
 */
export function ChangesBanner() {
  const session = useSession();
  const { pathname } = useLocation();
  const [, bump] = useState(0);
  useOnHoldChanged(useCallback(() => bump((n) => n + 1), []));
  if (session.status !== 'signed-in') return null;
  if (pathname === CHANGES_PATH || pathname === '/settings/security') return null;
  const me = session.me;
  // Owner p4-8: a team member is told only that a hold is on (HoldMember board).
  if (memberOf(session) !== null) {
    if ((me.teamHold ?? null) === null) return null;
    return (
      <div className="x2f-changes-banner" data-part="changes-banner">
        <p role="status" data-part="changes-banner-member">
          {M.banner}{' '}
          <Link className="x2f-link" to={CHANGES_PATH}>
            {M.bannerLink}
          </Link>
        </p>
      </div>
    );
  }
  const pending = me.pendingChanges ?? null;
  const code = me.recoveryCodeToShow === true;
  if (pending === null && !code) return null;
  return (
    <div className="x2f-changes-banner" data-part="changes-banner">
      {pending !== null ? (
        <p role="status" data-part="changes-banner-pending">
          {C.banner(pending.count, pending.takesEffectAt)}{' '}
          <Link className="x2f-link" to={CHANGES_PATH}>
            {C.review}
          </Link>
        </p>
      ) : null}
      {code ? (
        <p role="status" data-part="changes-banner-code">
          {NEW_CODE_COPY.bannerText}{' '}
          <Link className="x2f-link" to="/settings/security">
            {NEW_CODE_COPY.bannerLink}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
