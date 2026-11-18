import { inviteTokenHash, validateHours, type KeyTapIntent, type LoginHours, type Weekday } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import {
  cancelInvite,
  createInvite,
  members as fetchMembers,
  removeMember,
  serverNow,
  setHours,
  setRole,
  switchOff,
  switchOn,
  type InviteRole,
  type Member,
} from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Notice, Sheet } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { ROLE_LABELS } from '../ui/RoleChip.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table, type Column } from '../ui/Table.js';
import { StaffGrantsSection } from './StaffGrants.js';
import { WEEK, expiresText, hoursText, lastActiveText, monthYear } from './staffFormat.js';
import '../ui/staff.css';

/**
 * The owner's Staff page (Plan 4 Task 17, board StaffList; perm staff.manage). The add panel makes
 * an invite: role card, login hours, then "Create invite link", which takes a `create-invite` tap
 * bound to a token this browser makes (api.ts `createInvite`) and shows the link once with "Copy
 * link". The table lists everyone the API returns, the owner first; the owner's own row has no
 * action (the API refuses every change to the owner too, 409 `owner-protected`).
 *
 * The actions, as the API takes them (apps/api/src/staff/members.ts, invites.ts):
 * - Switch off: at once, no tap (it only removes power; the plan's Task 7);
 * - Switch on: a `switch-on` tap bound to the person and their role;
 * - Cancel invite: no tap;
 * - Change (board: "You can change these any time from their row"; not drawn, DESIGNER-REVIEW):
 *   the role (a `set-role` tap), the login hours (no tap, as the API takes them) and Remove from
 *   staff (a `remove-staff` tap, owner G4).
 * Below the table, the per-person checkboxes (owner Q60, J-21; StaffGrants.tsx, not drawn).
 *
 * Board copy is verbatim. Copy the board does not have is draft. COPY-UNSIGNED
 */

/** The role cards, in the board's order with its descriptions. */
export const ROLE_CARDS: ReadonlyArray<{ role: InviteRole; desc: string }> = [
  { role: 'senior', desc: 'Handles disputes and appeals, co-approves rulings above your size limit, and can freeze or ban accounts.' },
  { role: 'mod', desc: 'Handles disputes and rules alone below your size limit. Larger rulings wait for a senior moderator or you.' },
  // not-a-refusal: describes what the role covers, stops nobody (board StaffList).
  { role: 'helper', desc: 'Answers questions and support tickets. Cannot see dispute evidence or rule on anything.' },
];

/** The board's time zone list; "Other…" opens a search over every zone `Intl` knows. */
export const TIME_ZONES = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/Berlin'] as const;
const OTHER = 'other';

/** The hours being edited (board StaffList's "Login hours" box). */
export interface HoursDraft {
  any: boolean;
  days: Weekday[];
  start: string;
  end: string;
  /** One of TIME_ZONES, or OTHER with `otherTz`. */
  tz: string;
  otherTz: string;
}

/** The board's starting point: Mon–Fri, 09:00–17:00 UTC. */
export const DEFAULT_HOURS: HoursDraft = { any: false, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00', tz: 'UTC', otherTz: '' };

export function draftOf(h: LoginHours): HoursDraft {
  if (h === 'any') return { ...DEFAULT_HOURS, any: true };
  const listed = (TIME_ZONES as readonly string[]).includes(h.tz);
  return { any: false, days: [...h.days], start: h.start, end: h.end, tz: listed ? h.tz : OTHER, otherTz: listed ? '' : h.tz };
}

/** The draft as the API takes it (days in the board's week order), or null while it is not valid hours. */
export function hoursOf(d: HoursDraft): LoginHours | null {
  if (d.any) return 'any';
  const h = { days: WEEK.filter((w) => d.days.includes(w)), start: d.start, end: d.end, tz: d.tz === OTHER ? d.otherTz.trim() : d.tz };
  try {
    return validateHours(h);
  } catch {
    return null;
  }
}

let zones: readonly string[] | null = null;
const allZones = (): readonly string[] => (zones ??= Intl.supportedValuesOf('timeZone'));

/** The Login hours fieldset: day pills, From/to, Time zone, and "Any time". */
function HoursEditor({ value, onChange, idPrefix }: { value: HoursDraft; onChange: (d: HoursDraft) => void; idPrefix: string }) {
  const listId = useId();
  const set = (p: Partial<HoursDraft>) => onChange({ ...value, ...p });
  return (
    <fieldset className="x2f-staff-box x2f-stack">
      <legend className="x2f-staff-box__legend">Login hours</legend>
      <span className="x2f-staff-hint">They can only log in during these hours. When the window closes, any open session ends.</span>
      {/* COPY-UNSIGNED, DESIGNER-REVIEW: the board shows "Any time" in the table but no way to pick it. */}
      <label className="x2f-check">
        <input type="checkbox" data-part="any-time" checked={value.any} onChange={(e) => set({ any: e.target.checked })} />
        <span>Any time</span>
      </label>
      {value.any ? null : (
        <>
          <div role="group" aria-label="Days" className="x2f-staff-pills">
            {WEEK.map((d) => {
              const on = value.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className="x2f-staff-pill"
                  aria-pressed={on}
                  onClick={() => set({ days: on ? value.days.filter((x) => x !== d) : [...value.days, d] })}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="x2f-staff-hours-row">
            <label htmlFor={`${idPrefix}-from`} className="x2f-staff-hint">
              From
            </label>
            <input id={`${idPrefix}-from`} type="time" className="x2f-input x2f-staff-time" value={value.start} onChange={(e) => set({ start: e.target.value })} />
            <label htmlFor={`${idPrefix}-to`} className="x2f-staff-hint">
              to
            </label>
            <input id={`${idPrefix}-to`} type="time" className="x2f-input x2f-staff-time" value={value.end} onChange={(e) => set({ end: e.target.value })} />
            <label htmlFor={`${idPrefix}-tz`} className="x2f-staff-sr">
              Time zone
            </label>
            <select id={`${idPrefix}-tz`} className="x2f-input x2f-staff-select" value={value.tz} onChange={(e) => set({ tz: e.target.value })}>
              {TIME_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
              {/* COPY-UNSIGNED: the plan's searchable "Other…" list of Intl zones. */}
              <option value={OTHER}>Other…</option>
            </select>
            {value.tz === OTHER ? (
              <>
                <label htmlFor={`${idPrefix}-other`} className="x2f-staff-sr">
                  Other time zone
                </label>
                <input
                  id={`${idPrefix}-other`}
                  className="x2f-input x2f-staff-select"
                  list={listId}
                  placeholder="Search time zones"
                  value={value.otherTz}
                  onChange={(e) => set({ otherTz: e.target.value })}
                />
                <datalist id={listId}>
                  {allZones().map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </>
            ) : null}
          </div>
        </>
      )}
      <span className="x2f-staff-hint">You can change these any time from their row. Your owner account has no time limit.</span>
    </fieldset>
  );
}

/** The role cards (board StaffList): radios drawn as cards, with the board's descriptions. */
function RoleCards({ value, onChange }: { value: InviteRole; onChange: (r: InviteRole) => void }) {
  return (
    <div role="radiogroup" aria-label="Role" className="x2f-staff-role-cards">
      {ROLE_CARDS.map((c) => (
        <button key={c.role} type="button" role="radio" aria-checked={value === c.role} className="x2f-staff-role-card" onClick={() => onChange(c.role)}>
          <span className="x2f-staff-role-card__name">{ROLE_LABELS[c.role]}</span>
          <span className="x2f-staff-role-card__desc">{c.desc}</span>
        </button>
      ))}
    </div>
  );
}

const base64url = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** An invite works for 24 hours (spec 6.6; the API's INVITE_TTL_MS). */
const INVITE_TTL_MS = 24 * 3_600_000;

interface PendingInvite {
  role: InviteRole;
  hours: LoginHours;
  inviteId: string;
  token: string;
  expiresAt: string;
}

/** COPY-UNSIGNED: the methods G3 lists, as the Status cell names them. */
const METHOD_NAMES = { 'security-key': 'security key', pgp: 'PGP key', passkey: 'passkey' } as const;
function missingText(m: Member['missingMethods']): string | null {
  if (m.length === 0) return null;
  const names = m.map((x) => METHOD_NAMES[x]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `No ${list} yet`;
}

type Tap = { intent: KeyTapIntent; title: string; body: string; labels?: Record<string, string>; run: (tapId: string) => Promise<void> };

export function StaffList() {
  const [list, setList] = useState<Member[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [role, setNewRole] = useState<InviteRole>('mod');
  const [draft, setDraft] = useState<HoursDraft>(DEFAULT_HOURS);
  const [link, setLink] = useState<{ link: string; role: InviteRole } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tap, setTap] = useState<Tap | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await fetchMembers();
      setList(r.members);
    } catch (e) {
      setFault(faultText(e, 'X2F could not load the staff list just now. Reload to try again.'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  /** Runs an action; a refusal is the kit's CantDoThat, anything else a fault notice. Then reads the list again. */
  const act = async (f: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setFault(null);
    try {
      await f();
      return true;
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else setFault(faultText(e, fallback));
      return false;
    } finally {
      setBusy(false);
      await load();
    }
  };

  const openAdd = () => {
    setAdding(true);
    setLink(null);
    setCopied(false);
  };

  const newHours = hoursOf(draft);
  const makeLink = () => {
    if (newHours === null) return;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const p: PendingInvite = {
      role,
      hours: newHours,
      inviteId: crypto.randomUUID(),
      token: base64url(bytes),
      expiresAt: new Date(serverNow().getTime() + INVITE_TTL_MS).toISOString(),
    };
    setTap({
      intent: { kind: 'create-invite', inviteId: p.inviteId, role: p.role, tokenHash: inviteTokenHash(p.token), expiresAt: p.expiresAt },
      title: `Invite a new ${ROLE_LABELS[p.role].toLowerCase()}`,
      body: 'Tap your security key to create the invite link.',
      labels: { tokenHash: 'the link you are about to send' },
      run: async (tapId) => {
        await act(async () => {
          const r = await createInvite({ ...p, tapId });
          setLink({ link: r.link, role: p.role });
        }, 'The invite link was not made. Try again.');
      },
    });
  };

  const copy = async () => {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const nameOf = (m: Member) => m.displayName ?? '';

  const askSwitchOn = (m: Member) =>
    setTap({
      intent: { kind: 'switch-on', accountId: m.accountId!, role: m.role as InviteRole },
      title: `Switch ${nameOf(m)} back on`,
      body: 'Tap your security key to switch them back on.',
      labels: { accountId: nameOf(m) },
      run: async (tapId) => void (await act(() => switchOn(m.accountId!, tapId), 'They were not switched on. Try again.')),
    });

  const action = (m: Member) => {
    if (m.role === 'owner') return null;
    if (m.status === 'waiting') {
      return (
        <Button variant="secondary" disabled={busy} onClick={() => void act(() => cancelInvite(m.inviteId!), 'The invite was not cancelled. Try again.')}>
          Cancel invite
        </Button>
      );
    }
    return (
      <span className="x2f-staff-actions">
        {m.status === 'active' ? (
          <Button variant="secondary" disabled={busy} onClick={() => void act(() => switchOff(m.accountId!), 'They were not switched off. Try again.')}>
            Switch off
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => askSwitchOn(m)}>
            Switch on
          </Button>
        )}
        {/* COPY-UNSIGNED, DESIGNER-REVIEW: not drawn; the board says changes are made from the row. */}
        <Button variant="quiet" disabled={busy} onClick={() => setEditing(m.accountId)}>
          Change
        </Button>
      </span>
    );
  };

  const now = serverNow();
  const columns: Column<Member>[] = [
    { title: 'Name', mono: true, cell: (m) => <span data-username>{m.status === 'waiting' ? 'Invite sent' : nameOf(m)}</span> },
    { title: 'Role', cell: (m) => <span className="x2f-staff-role" data-role={m.role}>{ROLE_LABELS[m.role]}</span> },
    {
      title: 'Status',
      cell: (m) => {
        const missing = missingText(m.missingMethods);
        return (
          <>
            <span className="x2f-staff-status" data-status={m.status}>
              {m.status === 'waiting' ? 'Waiting' : m.status === 'switched-off' ? 'Switched off' : 'Active'}
            </span>
            {missing !== null ? (
              <span className="x2f-staff-hint" data-part="missing-methods">
                {missing}
              </span>
            ) : null}
          </>
        );
      },
    },
    { title: 'Login hours', cell: (m) => hoursText(m.hours) },
    { title: 'Joined', cell: (m) => (m.status === 'waiting' ? (m.expiresAt !== null ? expiresText(m.expiresAt, now) : '') : m.joinedAt !== null ? monthYear(m.joinedAt) : '') },
    { title: 'Last active', cell: (m) => (m.status === 'waiting' ? '' : lastActiveText(m.lastActiveAt, now)) },
    { title: 'Cases', mono: true, cell: (m) => (m.status === 'waiting' ? '' : String(m.openCases)) },
    { title: 'Actions', cell: action },
  ];

  const editMember = list?.find((m) => m.accountId === editing && m.accountId !== null) ?? null;
  const addPrimary = !adding || link !== null;

  return (
    <section data-screen="staff">
      <div className="x2f-staff-head-row">
        <PageTitle title="Staff">
          <p className="x2f-staff-page__lead">Everyone who helps run X2F. Only you can add or remove people.</p>
        </PageTitle>
        <Button variant={addPrimary ? 'primary' : 'secondary'} data-part="add-staff" onClick={openAdd}>
          Add staff member
        </Button>
      </div>
      {fault !== null ? (
        <Notice tone="danger" data-part="staff-fault">
          {fault}
        </Notice>
      ) : null}

      {adding ? (
        <section aria-label="Add staff member" className="x2f-staff-add x2f-stack">
          <h2 className="x2f-h2">Add a staff member</h2>
          <RoleCards
            value={role}
            onChange={(r) => {
              setNewRole(r);
              setLink(null);
            }}
          />
          <HoursEditor value={draft} onChange={setDraft} idPrefix="staff" />
          {link === null ? (
            <div className="x2f-staff-hours-row">
              <Button variant="primary" disabled={busy || newHours === null} onClick={makeLink}>
                Create invite link
              </Button>
              {/* not-a-refusal: board StaffList's note on how staff log in. */}
              <span className="x2f-staff-hint">They set up their own staff login with a security key or PGP. Staff can't use passwords.</span>
            </div>
          ) : (
            <div className="x2f-stack" data-part="invite-link">
              <span className="x2f-staff-hint">{`Invite link for a new ${ROLE_LABELS[link.role].toLowerCase()}. Send it to them privately. It works once and expires in 24 hours.`}</span>
              <div className="x2f-staff-hours-row">
                <input aria-label="Invite link" type="text" readOnly className="x2f-input x2f-staff-link" value={link.link} data-mask="" />
                <Button variant="secondary" onClick={() => void copy()}>
                  Copy link
                </Button>
              </div>
              {copied ? (
                // COPY-UNSIGNED
                <span className="x2f-staff-hint" role="status">
                  Copied.
                </span>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      <div className="x2f-staff-scroll">
        <Table columns={columns} rows={list ?? []} rowKey={(m) => m.accountId ?? `invite-${m.inviteId}`} label="Staff" />
      </div>
      <p className="x2f-staff-hint">Switching someone off takes effect immediately; everything they did stays in the activity log.</p>

      <StaffGrantsSection members={(list ?? []).filter((m) => m.accountId !== null && m.role !== 'owner')} />

      {editMember !== null && tap === null ? (
        <MemberEdit
          member={editMember}
          busy={busy}
          onClose={() => setEditing(null)}
          onHours={(h) => act(() => setHours(editMember.accountId!, h), 'The login hours were not saved. Try again.')}
          onRole={(r) =>
            setTap({
              intent: { kind: 'set-role', accountId: editMember.accountId!, role: r },
              title: `Change ${nameOf(editMember)}'s role`,
              body: `Tap your security key to make them a ${ROLE_LABELS[r].toLowerCase()}.`,
              labels: { accountId: nameOf(editMember) },
              run: async (tapId) => {
                if (await act(() => setRole(editMember.accountId!, r, tapId), 'The role was not changed. Try again.')) setEditing(null);
              },
            })
          }
          onRemove={() =>
            setTap({
              intent: { kind: 'remove-staff', accountId: editMember.accountId! },
              title: `Remove ${nameOf(editMember)} from staff`,
              body: 'Tap your security key to remove them for good. Everything they did stays in the activity log.',
              labels: { accountId: nameOf(editMember) },
              run: async (tapId) => {
                if (await act(() => removeMember(editMember.accountId!, tapId), 'They were not removed. Try again.')) setEditing(null);
              },
            })
          }
        />
      ) : null}

      {tap !== null ? (
        <KeyTapDialog
          intent={tap.intent}
          title={tap.title}
          body={tap.body}
          labels={tap.labels ?? {}}
          onDone={(tapId) => {
            const t = tap;
            setTap(null);
            void t.run(tapId);
          }}
          onCancel={() => setTap(null)}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}

/** A member's role, login hours and removal (not drawn). COPY-UNSIGNED DESIGNER-REVIEW */
function MemberEdit({
  member,
  busy,
  onClose,
  onHours,
  onRole,
  onRemove,
}: {
  member: Member;
  busy: boolean;
  onClose: () => void;
  onHours: (h: LoginHours) => Promise<boolean>;
  onRole: (r: InviteRole) => void;
  onRemove: () => void;
}) {
  const current = member.role as InviteRole;
  const [role, setRoleDraft] = useState<InviteRole>(current);
  const [draft, setDraft] = useState<HoursDraft>(() => draftOf(member.hours));
  const [saved, setSaved] = useState(false);
  const hours = hoursOf(draft);
  const name = member.displayName ?? '';
  return (
    <Sheet open title={`Change ${name}`} wide="dialog" onClose={onClose}>
      <div className="x2f-stack" data-part="member-edit">
        <RoleCards value={role} onChange={setRoleDraft} />
        <Button variant="secondary" disabled={busy || role === current} onClick={() => onRole(role)}>
          Save role
        </Button>
        <HoursEditor
          value={draft}
          onChange={(d) => {
            setSaved(false);
            setDraft(d);
          }}
          idPrefix="member"
        />
        <Button
          variant="secondary"
          disabled={busy || hours === null}
          onClick={() => {
            if (hours !== null) void onHours(hours).then((ok) => setSaved(ok));
          }}
        >
          Save login hours
        </Button>
        {saved ? (
          <Notice tone="plain" data-part="hours-saved">
            Saved.
          </Notice>
        ) : null}
        <Button variant="danger" disabled={busy} onClick={onRemove}>
          Remove from staff
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
    </Sheet>
  );
}
