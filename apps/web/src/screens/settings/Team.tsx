/**
 * Settings → Team (Plan 2 Task 18; spec 6.7, R44): the account owner's team members. What members
 * can do, the members and open invites (roles, remove), Invite a member (a one-time link shown
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
  teamInviteAction,
  teamRemoveAction,
  teamRolesAction,
  withConfirm,
  type TeamAuditEntry,
  type TeamMember,
  type TeamRole,
} from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { CantDoThat, isCantDoCode, type CantDoCode } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, HOLD_CODE, TOO_MANY_CHANGES_CODE, TOO_MANY_MEMBERS_CODE, holdChangesCantDoText, teamCantDoText, teamCantDoTitle } from '../../ui/cantDoCodes.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { holdSentence } from '../auth/refusals.js';
import { StagedNote } from './HoldChanges.js';
import { JOIN_PATH, ROLE_WORDS, TEAM_COPY as C, TEAM_PATH } from './teamCopy.js';
import '../screens.css';

const ROLES: readonly TeamRole[] = ['offers', 'trades', 'hold-see', 'hold-cancel', 'hold-end'];

/** The link a new member opens: the code rides in the fragment, which browsers never send. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}${JOIN_PATH}#${code}`;
}

function RolePicker({ value, onChange, idPrefix }: { value: readonly TeamRole[]; onChange: (r: TeamRole[]) => void; idPrefix: string }) {
  return (
    <fieldset className="x2f-field" data-part="roles">
      <legend className="x2f-label">Roles</legend>
      {ROLES.map((r) => (
        <label className="x2f-row x2f-team__role" key={r} htmlFor={`${idPrefix}-${r}`}>
          <input
            id={`${idPrefix}-${r}`}
            type="checkbox"
            checked={value.includes(r)}
            onChange={(e) => onChange(ROLES.filter((x) => (x === r ? e.target.checked : value.includes(x))))}
            data-role={r}
          />
          {ROLE_WORDS[r]}
        </label>
      ))}
    </fieldset>
  );
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
  const [roles, setRoles] = useState<TeamRole[]>(['offers']);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<{ id: string; roles: TeamRole[] } | null>(null);
  // The activity log's member filter ('' = every member; review e2e area 8).
  const [logMember, setLogMember] = useState('');
  const [logWho, setLogWho] = useState<{ id: string; name: string }[]>([]);

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
      for (const e of l) if (!who.has(e.memberId)) who.set(e.memberId, e.memberName);
      setLogWho([...who].map(([id, name]) => ({ id, name })));
      setState('ready');
    } catch (e) {
      const c = cantDoOf(e);
      if (c !== null) {
        setCantDo(c);
        setState('ready');
      } else setState(e instanceof AuthApiError && e.status === 401 ? 'signed-out' : 'load-failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      if (roles.length === 0) {
        setError(C.pickRole);
        return;
      }
      const displayName = name.trim();
      const r = await withConfirm(teamInviteAction(displayName, roles), (confirmToken) => authApi.inviteMember({ displayName, roles, confirmToken }), prove);
      setLink({ name: displayName, url: inviteLink(window.location.origin, r.invite) });
      setCopied(false);
      setName('');
      await load();
    });

  const saveRoles = (m: TeamMember, next: TeamRole[]) =>
    run(async () => {
      if (next.length === 0) {
        setError(C.pickRole);
        return;
      }
      const r = await withConfirm(teamRolesAction(m.id, next), (confirmToken) => authApi.setMemberRoles(m.id, { roles: next, confirmToken }), prove);
      setEditing(null);
      if (isStaged(r)) setStaged(true);
      else setSaid(C.rolesSaved(m.displayName));
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
          <ul className="x2f-sheet__body">
            {C.what.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="x2f-note">{C.ownerKeeps}</p>
          <p className="x2f-note">{C.twoFactors}</p>
          <p className="x2f-note">{C.releaseNote}</p>
          <p className="x2f-note">{C.oneReputation}</p>
        </section>

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
            {members.length === 0 ? <p className="x2f-note">{C.none}</p> : null}
            <ul className="x2f-list" data-part="member-list">
              {members.map((m) => (
                <li className="x2f-list__row" key={m.id} data-member={m.displayName} data-status={m.status}>
                  <span className="x2f-list__label">
                    <span data-username="">{m.displayName}</span>
                    <br />
                    <span className="x2f-list__time">
                      {C.roles(m.roles)} · {C.status[m.status]}
                      {m.inviteExpiresAt !== null ? ` · ${C.inviteUntil(m.inviteExpiresAt)}` : ''}
                    </span>
                  </span>
                  {editing?.id === m.id ? (
                    <div className="x2f-stack">
                      <RolePicker value={editing.roles} onChange={(r) => setEditing({ id: m.id, roles: r })} idPrefix={`roles-${m.id}`} />
                      <Button variant="secondary" aria-disabled={busy} onClick={() => void saveRoles(m, editing.roles)} data-part="save-roles">
                        {C.saveRoles}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="quiet" aria-label={C.changeRoles(m.displayName)} onClick={() => setEditing({ id: m.id, roles: [...m.roles] })} data-part="edit-roles">
                      Roles
                    </Button>
                  )}
                  <Button variant="danger" aria-disabled={busy} aria-label={C.removeLabel(m.displayName)} onClick={() => void remove(m)} data-part="remove-member">
                    {C.remove}
                  </Button>
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
                aria-describedby="team-name-hint"
                onChange={(e) => setName(e.target.value)}
              />
              <p className="x2f-note" id="team-name-hint">
                {C.nameHint}
              </p>
            </div>
            <RolePicker value={roles} onChange={setRoles} idPrefix="invite-role" />
            {full ? (
              <p className="x2f-note" id={fullId} data-part="team-full">
                {C.full(max)}
              </p>
            ) : null}
            <Button
              variant="primary"
              data-primary=""
              aria-disabled={busy || name.trim() === '' || full}
              aria-describedby={full ? fullId : undefined}
              onClick={() => (full || name.trim() === '' ? undefined : void invite())}
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
            {log.length === 0 ? <p className="x2f-note">{C.logEmpty}</p> : null}
            <ul className="x2f-list" data-part="log-list">
              {log.map((e) => (
                <li className="x2f-list__row" key={e.id} data-action={e.action}>
                  <span className="x2f-list__label">
                    {C.logRow(e.memberName, e.action)}
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
