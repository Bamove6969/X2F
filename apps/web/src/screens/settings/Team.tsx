/**
 * Settings → Team (Plan 2 Task 18, Job 1c; spec 6.7, R44): the account owner's team members. What members
 * can do, the members and open invites (their permission boxes from the API's catalogue, limits, remove), Invite a member (a one-time link shown
 * once, the code in the #fragment so it never reaches a server log), and the activity log of every
 * member action with an effect. Inviting, changing roles and removing need confirm-it's-you (one
 * shared ConfirmSheet). Every refusal (a member opening this screen: owner-only; the member limit)
 * goes through CantDoThat.
 *
 * No Claude Design board yet (NEEDS_DESIGN_TEAM in test/team-tripwires.test.ts): kit parts and
 * existing classes only, no stylesheet of its own and no inline styles.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import {
  AuthApiError,
  isStaged,
  teamAbilitiesAction,
  teamInviteAbilitiesAction,
  teamLimitsAction,
  teamRemoveAction,
  withConfirm,
  type TeamAuditEntry,
  type TeamMember,
  type TradeBand,
  type WorkingHours,
} from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { CantDoThat, isCantDoCode, type CantDoCode } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, HOLD_CODE, TOO_MANY_CHANGES_CODE, TOO_MANY_MEMBERS_CODE, holdChangesCantDoText, teamCantDoText, teamCantDoTitle } from '../../ui/cantDoCodes.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { holdSentence } from '../auth/refusals.js';
import { StagedNote } from './HoldChanges.js';
import { AbilityPicker } from './AbilityPicker.js';
import { MyAccess } from './MyAccess.js';
import { MemberSessions } from './MemberSessions.js';
import { fetchCatalogue, presetBoxes, presetMatching, sendable, type Catalogue } from './teamApi.js';
import { JOIN_PATH, PICKER_COPY as P, TEAM_COPY as C, TEAM_PAGE_COPY as T, TEAM_PATH, atomicOf, xmrOf } from './teamCopy.js';
import { TEAM_LOG_COPY, TEAM_LOG_PATH } from './teamLogCopy.js';
import '../screens.css';
import { hasSpace, spaceProblem } from '../setup/names.js';

/** How many of the latest member actions this screen shows; the Team log has the rest. */
const LOG_PREVIEW = 10;

/** A member's own work rows (team audit v2 also returns the team's changes, logins and the owner's own rows). */
function memberWork(log: readonly TeamAuditEntry[]): TeamAuditEntry[] {
  return log.filter((e) => e.memberId !== null && ((e as { category?: string }).category ?? 'work') === 'work');
}

/** The link a new member opens: the code rides in the fragment, which browsers never send. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}${JOIN_PATH}#${code}`;
}

type Day = Exclude<WorkingHours, 'any'>['days'][number];
const DAYS: readonly Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** J-20: the limits form's state (the band as typed, in XMR). */
interface LimitsDraft {
  id: string;
  anySize: boolean;
  min: string;
  max: string;
  anyTime: boolean;
  days: Day[];
  start: string;
  end: string;
  tz: string;
}

function draftOf(m: TeamMember): LimitsDraft {
  const b = m.band ?? null;
  const h = m.hours ?? 'any';
  return {
    id: m.id,
    anySize: b === null,
    min: b === null ? '' : xmrOf(b.minAtomic),
    max: b === null ? '' : xmrOf(b.maxAtomic),
    anyTime: h === 'any' || h === null,
    days: h !== 'any' && h !== null ? [...h.days] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start: h !== 'any' && h !== null ? h.start : '08:00',
    end: h !== 'any' && h !== null ? h.end : '18:00',
    tz: h !== 'any' && h !== null ? h.tz : 'UTC',
  };
}

/** The band and hours a draft asks for, or the copy key of what is wrong with it. */
function limitsOf(d: LimitsDraft): { band: TradeBand | null; hours: WorkingHours } | 'badBand' | 'badHours' {
  let band: TradeBand | null = null;
  if (!d.anySize) {
    const min = atomicOf(d.min);
    const max = atomicOf(d.max);
    if (min === null || max === null || BigInt(max) === 0n || BigInt(max) < BigInt(min)) return 'badBand';
    band = { minAtomic: min, maxAtomic: max };
  }
  if (d.anyTime) return { band, hours: 'any' };
  if (d.days.length === 0 || d.start === d.end || !/^\d\d:\d\d$/.test(d.start) || !/^\d\d:\d\d$/.test(d.end) || d.tz.trim() === '') return 'badHours';
  return { band, hours: { days: DAYS.filter((x) => d.days.includes(x)), start: d.start, end: d.end, tz: d.tz.trim() } };
}

/** J-20 (owner p7-4, p7-11): a member's trade-size band and working hours. Kit parts only (no board yet). */
function LimitsEditor({ value, onChange }: { value: LimitsDraft; onChange: (d: LimitsDraft) => void }) {
  const p = `limits-${value.id}`;
  const set = (x: Partial<LimitsDraft>) => onChange({ ...value, ...x });
  return (
    <div className="x2f-stack" data-part="limits">
      <fieldset className="x2f-field" data-part="band">
        <legend className="x2f-label">{C.bandTitle}</legend>
        <label className="x2f-row x2f-team__role" htmlFor={`${p}-any-size`}>
          <input id={`${p}-any-size`} type="checkbox" checked={value.anySize} onChange={(e) => set({ anySize: e.target.checked })} data-part="band-none" />
          {C.bandNone}
        </label>
        {!value.anySize ? (
          <>
            <label className="x2f-label" htmlFor={`${p}-min`}>
              {C.bandMin}
            </label>
            <input className="x2f-input" id={`${p}-min`} inputMode="decimal" value={value.min} onChange={(e) => set({ min: e.target.value })} data-part="band-min" />
            <label className="x2f-label" htmlFor={`${p}-max`}>
              {C.bandMax}
            </label>
            <input className="x2f-input" id={`${p}-max`} inputMode="decimal" value={value.max} onChange={(e) => set({ max: e.target.value })} data-part="band-max" />
          </>
        ) : null}
        <p className="x2f-note">{C.bandHint}</p>
      </fieldset>
      <fieldset className="x2f-field" data-part="hours">
        <legend className="x2f-label">{C.hoursTitle}</legend>
        <label className="x2f-row x2f-team__role" htmlFor={`${p}-any-time`}>
          <input id={`${p}-any-time`} type="checkbox" checked={value.anyTime} onChange={(e) => set({ anyTime: e.target.checked })} data-part="hours-any" />
          {C.hoursAny}
        </label>
        {!value.anyTime ? (
          <>
            {DAYS.map((d) => (
              <label className="x2f-row x2f-team__role" key={d} htmlFor={`${p}-${d}`}>
                <input
                  id={`${p}-${d}`}
                  type="checkbox"
                  checked={value.days.includes(d)}
                  onChange={(e) => set({ days: DAYS.filter((x) => (x === d ? e.target.checked : value.days.includes(x))) })}
                  data-day={d}
                />
                {d}
              </label>
            ))}
            <label className="x2f-label" htmlFor={`${p}-start`}>
              {C.hoursStart}
            </label>
            <input className="x2f-input" id={`${p}-start`} type="time" value={value.start} onChange={(e) => set({ start: e.target.value })} data-part="hours-start" />
            <label className="x2f-label" htmlFor={`${p}-end`}>
              {C.hoursEnd}
            </label>
            <input className="x2f-input" id={`${p}-end`} type="time" value={value.end} onChange={(e) => set({ end: e.target.value })} data-part="hours-end" />
            <label className="x2f-label" htmlFor={`${p}-tz`}>
              {C.hoursZone}
            </label>
            <input className="x2f-input" id={`${p}-tz`} autoComplete="off" value={value.tz} onChange={(e) => set({ tz: e.target.value })} data-part="hours-tz" />
          </>
        ) : null}
        <p className="x2f-note">{C.hoursHint}</p>
      </fieldset>
    </div>
  );
}

/**
 * A member's row: the preset their boxes match (by the catalogue's label), else "Custom", else the
 * old roles they read as (an older API that sends no boxes), else "No roles yet".
 */
function boxesLine(m: TeamMember, cat: Catalogue | null): string {
  const preset = m.abilities !== undefined && cat !== null ? presetMatching(cat, m.abilities) : null;
  if (preset !== null) return P.presetLine(preset.label);
  if (m.custom === true) return C.custom;
  return m.roles.length === 0 ? C.noBoxes : C.roles(m.roles);
}

type CantDo = { code: CantDoCode; max?: number; holdUntil?: string };

function cantDoOf(e: unknown): CantDo | null {
  if (e instanceof AuthApiError && isCantDoCode(e.code)) {
    return { code: e.code, ...(e.max !== undefined ? { max: e.max } : {}), ...(e.holdUntil !== undefined ? { holdUntil: e.holdUntil } : {}) };
  }
  return null;
}

export function Team() {
  const { prove, confirmUi, open } = useConfirm();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [max, setMax] = useState(3);
  const [log, setLog] = useState<TeamAuditEntry[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'load-failed' | 'signed-out'>('loading');
  const [cantDo, setCantDo] = useState<CantDo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  // Hold model v3: a role change from a username-and-password login is staged as a draft (202).
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const nameSpaced = hasSpace(name.trim());
  // Job 1c: the API's permission catalogue (null while it loads; 'failed' when it did not).
  const [catalogue, setCatalogue] = useState<Catalogue | null | 'failed'>(null);
  const cat = catalogue === 'failed' ? null : catalogue;
  // The invite's boxes: the catalogue's start set once it has loaded (its own "every new member starts with").
  const [boxes, setBoxes] = useState<string[] | null>(null);
  const inviteBoxes = cat === null ? [] : sendable(cat, boxes ?? presetBoxes(cat, 'start'));
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<{ id: string; boxes: string[] } | null>(null);
  const [limits, setLimits] = useState<LimitsDraft | null>(null);
  // The activity log's member filter ('' = every member; review e2e area 8).
  const [logMember, setLogMember] = useState('');
  const [logWho, setLogWho] = useState<{ id: string; name: string }[]>([]);
  // A team member (refused here) is shown their own access instead (MyAccess.tsx).
  const [mine, setMine] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, l] = await Promise.all([authApi.getTeam(), authApi.teamAudit()]);
      setMembers(t.members);
      setMax(t.max);
      setLog(l);
      setLogMember('');
      // Everyone who can be in the log: current members and anyone already in it (a removed member stays).
      const who = new Map<string, string>();
      for (const m of t.members) who.set(m.id, m.displayName);
      // Team audit v2: rows by the account owner or X2F name no member (memberId null).
      for (const e of l) if (e.memberId !== null && !who.has(e.memberId)) who.set(e.memberId, e.memberName ?? '');
      setLogWho([...who].map(([id, name]) => ({ id, name })));
      setState('ready');
    } catch (e) {
      const c = cantDoOf(e);
      if (c !== null) {
        setCantDo(c);
        setState('ready');
        // J-20 review F8: a team member (refused here) is shown their own access (boxes, limits, lead).
        setMine(true);
      } else setState(e instanceof AuthApiError && e.status === 401 ? 'signed-out' : 'load-failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ctl = new AbortController();
    fetchCatalogue(ctl.signal).then(setCatalogue, () => {
      if (!ctl.signal.aborted) setCatalogue('failed');
    });
    return () => ctl.abort();
  }, []);

  const fail = (e: unknown) => {
    if (isConfirmAbort(e)) return;
    const c = cantDoOf(e);
    if (c !== null) setCantDo(c);
    else if (e instanceof AuthApiError && (e.code === 'display-name-invalid' || e.code === 'display-name-reserved')) setError(C.nameInvalid);
    else if (e instanceof AuthApiError && e.code === 'display-name-taken') setError(C.nameTaken);
    else setError(C.saveFailed);
  };

  const run = async (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaid('');
    setStaged(false);
    try {
      await f();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    run(async () => {
      // Only boxes the catalogue names as boxes, in its order: an owner-only or always-on one is never sent.
      const abilities = inviteBoxes;
      if (abilities.length === 0) {
        setError(P.pickBox);
        return;
      }
      const displayName = name.trim();
      const r = await withConfirm(
        teamInviteAbilitiesAction(displayName, abilities),
        (confirmToken) => authApi.inviteMember({ displayName, abilities, confirmToken }),
        prove,
      );
      setLink({ name: displayName, url: inviteLink(window.location.origin, r.invite) });
      // Owner p11-21 (S-104): from a username-and-password login the boxes wait as a draft.
      if (isStaged(r)) setStaged(true);
      setCopied(false);
      setName('');
      await load();
    });

  const saveBoxes = (m: TeamMember, next: readonly string[]) =>
    run(async () => {
      if (cat === null) return;
      const abilities = sendable(cat, next);
      if (abilities.length === 0) {
        setError(P.pickBox);
        return;
      }
      const r = await withConfirm(teamAbilitiesAction(m.id, abilities), (confirmToken) => authApi.setMemberAbilities(m.id, { abilities, confirmToken }), prove);
      setEditing(null);
      if (isStaged(r)) setStaged(true);
      else setSaid(P.boxesSaved(m.displayName));
      await load();
    });

  const saveLimits = (m: TeamMember, d: LimitsDraft) =>
    run(async () => {
      const l = limitsOf(d);
      if (l === 'badBand' || l === 'badHours') {
        setError(C[l]);
        return;
      }
      const r = await withConfirm(teamLimitsAction(m.id, l.band, l.hours), (confirmToken) => authApi.setMemberLimits(m.id, { ...l, confirmToken }), prove);
      setLimits(null);
      if (isStaged(r)) setStaged(true);
      else setSaid(C.limitsSaved(m.displayName));
      await load();
    });

  const remove = (m: TeamMember) =>
    run(async () => {
      const r = await withConfirm(teamRemoveAction(m.id), (confirmToken) => authApi.removeMember(m.id, { confirmToken }), prove);
      // Owner p5-7: from a username-and-password login the removal waits 24 h like every change.
      if (isStaged(r)) setStaged(true);
      else setSaid(C.removed(m.displayName));
      await load();
    });

  const filterLog = (memberId: string) => {
    setLogMember(memberId);
    authApi.teamAudit(memberId === '' ? {} : { member: memberId }).then(setLog, () => setError(C.loadFailed));
  };

  const copy = () => {
    void navigator.clipboard?.writeText(link?.url ?? '').then(
      () => setCopied(true),
      () => undefined,
    );
  };

  // Design review shot 19 (Team board, full state): at the limit the invite control is disabled
  // and the board's note says why; the server's too-many-members popup stays as a fallback.
  const full = members !== null && members.length >= max;
  const fullId = useId();

  return (
    <ConfirmOpenProvider value={open}>
      <main className="x2f-screen" data-screen="team">
        <h1 className="x2f-screen__title">{C.title}</h1>
        {state === 'signed-out' ? (
          <section className="x2f-card">
            <p className="x2f-note">{C.signedOut}</p>
            <Link className="x2f-button x2f-button--secondary" to={`/login?returnTo=${encodeURIComponent(TEAM_PATH)}`}>
              Log in
            </Link>
          </section>
        ) : null}
        {state === 'load-failed' ? (
          <p className="x2f-error" role="alert">
            {C.loadFailed}
          </p>
        ) : null}
        {state === 'loading' ? <p className="x2f-note">Loading…</p> : null}

        <section className="x2f-card" data-part="team-what" aria-labelledby="team-what-h">
          <h2 className="x2f-card__title" id="team-what-h">
            {C.whatTitle}
          </h2>
          <p className="x2f-note">{T.whatIntro}</p>
          {/* Job 1c: the owner's rules on top of the boxes, as the catalogue words them. */}
          {cat !== null && cat.rules.length > 0 ? (
            <ul className="x2f-sheet__body" data-part="ability-rules">
              {cat.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p className="x2f-note">{C.ownerKeeps}</p>
          <p className="x2f-note">{C.twoFactors}</p>
          <p className="x2f-note">{C.releaseNote}</p>
          <p className="x2f-note">{C.oneReputation}</p>
          <p className="x2f-note">{C.firstLoginNote}</p>
        </section>

        {mine ? <MyAccess /> : null}

        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="x2f-note" role="status" data-part="team-said">
          {said}
        </p>
        {staged ? <StagedNote /> : null}

        {members !== null ? (
          <section className="x2f-card" data-part="team-members" aria-labelledby="team-members-h">
            <h2 className="x2f-card__title" id="team-members-h">
              {C.membersTitle}
            </h2>
            <p className="x2f-note" data-part="team-count">
              {C.count(members.length, max)}
            </p>
            {members.length === 0 ? (
              <p className="x2f-note" data-part="team-empty">
                {T.empty(max)}
              </p>
            ) : null}
            <ul className="x2f-list" data-part="member-list">
              {members.map((m) => (
                <li className="x2f-list__row" key={m.id} data-member={m.displayName} data-status={m.status}>
                  <span className="x2f-list__label">
                    <span data-username="">{m.displayName}</span>
                    <br />
                    <span className="x2f-list__time">
                      {boxesLine(m, cat)} · {C.status[m.status]}
                      {m.inviteExpiresAt !== null ? ` · ${C.inviteUntil(m.inviteExpiresAt)}` : ''}
                    </span>
                    {m.chatLabel !== undefined ? (
                      <>
                        <br />
                        <span className="x2f-list__time" data-part="chat-label">
                          {C.chatLabel(m.chatLabel)}
                        </span>
                      </>
                    ) : null}
                    <br />
                    <span className="x2f-list__time" data-part="member-limits">
                      {C.limits(m.band, m.hours)}
                    </span>
                  </span>
                  {editing?.id === m.id && cat !== null ? (
                    <div className="x2f-stack">
                      <AbilityPicker catalogue={cat} value={editing.boxes} onChange={(b) => setEditing({ id: m.id, boxes: b })} idPrefix={`boxes-${m.id}`} />
                      <Button variant="secondary" aria-disabled={busy} onClick={() => void saveBoxes(m, editing.boxes)} data-part="save-boxes">
                        {P.saveBoxes}
                      </Button>
                      <Button variant="quiet" onClick={() => setEditing(null)} data-part="cancel-boxes">
                        {P.cancelEdit}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="quiet"
                      aria-label={P.changeBoxes(m.displayName)}
                      aria-disabled={cat === null}
                      // Job 1c: the member's stored boxes as the API sends them (a member moved from the
                      // old roles holds what migration 360 mapped them to, `ROLE_ABILITIES`).
                      onClick={() => (cat === null ? undefined : setEditing({ id: m.id, boxes: [...(m.abilities ?? [])] }))}
                      data-part="edit-boxes"
                    >
                      {P.editBoxes}
                    </Button>
                  )}
                  {limits?.id === m.id ? (
                    <div className="x2f-stack">
                      <LimitsEditor value={limits} onChange={setLimits} />
                      <Button variant="secondary" aria-disabled={busy} onClick={() => void saveLimits(m, limits)} data-part="save-limits">
                        {C.saveLimits}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="quiet" aria-label={C.changeLimits(m.displayName)} onClick={() => setLimits(draftOf(m))} data-part="edit-limits">
                      {C.limitsButton}
                    </Button>
                  )}
                  <Button variant="danger" aria-disabled={busy} aria-label={C.removeLabel(m.displayName)} onClick={() => void remove(m)} data-part="remove-member">
                    {C.remove}
                  </Button>
                  {m.status === 'active' ? <MemberSessions member={m} /> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {members !== null ? (
          <section className="x2f-card" data-part="team-invite" aria-labelledby="team-invite-h">
            <h2 className="x2f-card__title" id="team-invite-h">
              {C.inviteTitle}
            </h2>
            {link !== null ? (
              <div className="x2f-field" data-part="invite-link">
                <p className="x2f-note" role="status">
                  {C.inviteMade(link.name)}
                </p>
                <pre className="x2f-pre" data-part="invite-url">
                  {link.url}
                </pre>
                <Button variant="secondary" onClick={copy} data-part="copy-invite">
                  {copied ? C.copied : C.copyLink}
                </Button>
              </div>
            ) : null}
            <div className="x2f-field">
              <label className="x2f-label" htmlFor="team-name">
                {C.nameLabel}
              </label>
              <input
                className="x2f-input"
                id="team-name"
                autoComplete="off"
                maxLength={20}
                value={name}
                aria-describedby={nameSpaced ? 'team-name-space team-name-hint' : 'team-name-hint'}
                aria-invalid={nameSpaced ? true : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {/* Owner demo note #108: a member's display name holds no spaces (the API refuses one too). */}
              {nameSpaced ? (
                <p className="x2f-error" id="team-name-space" data-part="team-name-space">
                  {spaceProblem('display name')}
                </p>
              ) : null}
              <p className="x2f-note" id="team-name-hint">
                {C.nameHint}
              </p>
            </div>
            {cat !== null ? <AbilityPicker catalogue={cat} value={inviteBoxes} onChange={setBoxes} idPrefix="invite-box" /> : null}
            {catalogue === null ? <p className="x2f-note">Loading…</p> : null}
            {catalogue === 'failed' ? (
              <p className="x2f-error" role="alert" data-part="abilities-failed">
                {P.loadFailed}
              </p>
            ) : null}
            {/* Owner demo note #219 (25 Nov 2026): with every box unticked, Invite is dimmed and says why here. */}
            {cat !== null && inviteBoxes.length === 0 ? (
              <p className="x2f-note" id={`${fullId}-roles`} data-part="invite-pick-role">
                {P.pickBox}
              </p>
            ) : null}
            {full ? (
              <p className="x2f-note" id={fullId} data-part="team-full">
                {C.full(max)}
              </p>
            ) : null}
            <Button
              variant="primary"
              data-primary=""
              aria-disabled={busy || name.trim() === '' || nameSpaced || full || inviteBoxes.length === 0}
              aria-describedby={full ? fullId : cat !== null && inviteBoxes.length === 0 ? `${fullId}-roles` : undefined}
              onClick={() => (full || name.trim() === '' || nameSpaced || inviteBoxes.length === 0 ? undefined : void invite())}
              data-part="invite"
            >
              {C.inviteButton}
            </Button>
          </section>
        ) : null}

        {log !== null ? (
          <section className="x2f-card" data-part="team-log" aria-labelledby="team-log-h">
            <h2 className="x2f-card__title" id="team-log-h">
              {C.logTitle}
            </h2>
            {logWho.length > 0 ? (
              <div className="x2f-field">
                <label className="x2f-label" htmlFor="team-log-member">
                  {C.logFilter}
                </label>
                <select className="x2f-input" id="team-log-member" value={logMember} onChange={(e) => filterLog(e.target.value)} data-part="log-filter">
                  <option value="">{C.logEveryone}</option>
                  {logWho.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {/* Team audit v2: the full log (filters, integrity check, team changes, logins, download). */}
            <Link className="x2f-button x2f-button--secondary" to={TEAM_LOG_PATH} data-part="team-log-link">
              {TEAM_LOG_COPY.title}
            </Link>
            {memberWork(log).length === 0 ? <p className="x2f-note">{C.logEmpty}</p> : null}
            <ul className="x2f-list" data-part="log-list">
              {memberWork(log).slice(0, LOG_PREVIEW).map((e) => (
                <li className="x2f-list__row" key={e.id} data-action={e.action}>
                  <span className="x2f-list__label">
                    {C.logRow(e.memberName ?? '', e.action)}
                    <br />
                    <span className="x2f-list__time">{C.logWhen(e.at, e.tradeCode)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {cantDo !== null ? (
          <CantDoThat
            title={cantDo.code === TOO_MANY_CHANGES_CODE ? CANT_DO_TITLE.changes : teamCantDoTitle(cantDo.code)}
            body={
              // Owner 2026-10-30: every team change waits out the account's 24-hour hold (the hold's own sentence).
              cantDo.code === HOLD_CODE
                ? holdSentence(cantDo.holdUntil)
                : cantDo.code === TOO_MANY_CHANGES_CODE
                  ? holdChangesCantDoText(cantDo.max)
                  : teamCantDoText(cantDo.code, cantDo.max !== undefined ? { max: cantDo.max } : {})
            }
            from={cantDo.code}
            onClose={() => setCantDo(null)}
          />
        ) : null}
        {confirmUi}
      </main>
    </ConfirmOpenProvider>
  );
}
