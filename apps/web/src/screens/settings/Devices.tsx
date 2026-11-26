/**
 * Devices and sessions (Task 30, spec §6.3; Plan 2 Task 16 for the limit and the approval rule;
 * Plan 2 Task 18 for team members' sessions): its own screen at /settings/devices, linked from
 * Settings → Security. The count against the limit with a meter, your devices with remote log-out
 * (asked first), "Log out all other devices" (your own devices only), team members' sessions in
 * their own card with "Log out all team members" (asked first; owner, via the Devices board), the "One device at a time" switch (confirm-it's-you), this session's length ("Stay logged in for", owner 2 Nov 2026) and how a new device gets
 * in. The current device is marked and cannot log itself out here (that is the Log out button
 * elsewhere).
 *
 * Laid out to the "Devices and sessions" board (C2-D1; docs/design-boards/Devices.dc.html and
 * -Wide on wip/design-brief); all look comes from the UI kit. Words: `C` below
 * (COPY-UNSIGNED). The count is the API's: a team member's session counts toward the limit
 * (`devicesInUse`), so the screen counts it too.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { isVendor, withConfirm, type ConfirmAction, type DeviceSettings, type SessionEntry, type SessionInfo } from '@x2f/auth-client';
import { Avatar, RoleTag } from '../../ui/Avatar.js';
import { Button } from '../../ui/Button.js';
import { FlowScreen } from '../../ui/FlowScreen.js';
import { Icon } from '../../ui/icons.js';
import { lastActive } from '../../ui/lastActive.js';
import { Meter } from '../../ui/Meter.js';
import { Sheet } from '../../ui/Sheet.js';
import { Switch } from '../../ui/Switch.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { SessionLengthField } from '../auth/SessionLength.js';
import { SESSION_COPY } from '../auth/sessionCopy.js';
import { shareSessionInfo } from '../../session/sessionWatch.js';
import { refusalText } from '../auth/refusals.js';
import { DEVICES_TITLE, deviceKind, initials } from './devicesCopy.js';
import { OwnerOnly } from './OwnerOnly.js';
import { TEAM_PATH } from './teamCopy.js';
import '../screens.css';

// COPY-UNSIGNED (all of DEVICES_COPY).
const C = {
  title: DEVICES_TITLE,
  back: 'Back to settings',
  devicesTitle: 'Devices',
  atLimit: "You're at the limit. To let a new device in, you'll pick one to log out.",
  oneMore: 'One more device can log in.',
  // G-007 (build spec j33b section 7): over the limit (One device at a time on, more logged in).
  overCount: (used: number, max: number) => `${used} logged in · your limit is ${max}`,
  over: 'Log one out to keep going.',
  // G-007: the session length line under the field.
  lengthLine: (hours: number | null) =>
    hours === null ? "You stay logged in for the length you pick. Then we ask you to confirm it's you." : `You stay logged in for ${hours} h. Then we ask you to confirm it's you.`,
  more: (n: number) => `${n} more devices can log in.`,
  mineTitle: 'Your devices',
  thisDevice: 'This device',
  logOut: 'Log out',
  logOutLabel: (name: string) => `Log out ${name}`,
  logOutAll: 'Log out all other devices',
  teamTitle: 'Team members logged in',
  // The board's G-007 sentence goes on "They stay logged in until their session ends or you switch
  // them off.": left out while members have no "Can log in" switch (see the top of devicesCopy.ts).
  teamNotYours: "These are your team members' logins, not yours.",
  // G-007: the team card with no members yet, and with members none of whom is logged in.
  teamEmptyTitle: 'No team members yet',
  teamEmpty: (max: number) => `Add up to ${max} people to help with your trades. You choose what each one can do.`,
  teamAdd: 'Add a team member',
  teamAllOut: 'No team members are logged in.',
  teamMember: 'Team member',
  teamLogOutLabel: (member: string, device: string) => `Log out ${member} on ${device}`,
  logOutTeam: 'Log out all team members',
  teamAllCovers: '"Log out all other devices" covers only your own devices. Use "Log out all team members" for your team.',
  manageTeam: 'Manage roles and invites in Team',
  optionsTitle: 'Options',
  oneDevice: 'One device at a time',
  oneDeviceHint: 'When on, approving a new device logs out the one you were using.',
  oneDeviceOn: 'One device at a time is on.',
  oneDeviceOff: 'One device at a time is off.',
  howTitle: 'How a new device gets in',
  howApproveTitle: 'Approve it on a logged-in device',
  // not-a-refusal: explains how approval works
  howApprove: 'Your other devices ask "Is this you?". Tap the 2-digit number the new device shows. Say no and the login is blocked.',
  noIp: "X2F doesn't log IP addresses, so devices are named only by browser and system.",
  ask: {
    oneTitle: (name: string) => `Log out ${name}?`,
    oneText: "It's logged out right away. To use it again, approve it from a device you're still logged in on.",
    memberTitle: (member: string) => `Log out ${member}?`,
    memberText: (member: string, device: string) => `${member}'s session on ${device} ends right away.`,
    allTitle: (n: number) => (n === 1 ? 'Log out 1 other device?' : `Log out ${n} other devices?`),
    allText: (names: string[]) => `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} logged out right away. Only this device stays logged in.`,
    teamTitle: 'Log out all team members?',
    // The board's second sentence ("They can log in again unless you switch them off.") names the
    // members' switch, which X2F does not have yet, so it is left out.
    teamText: 'Every team member is logged out right away.',
    teamCancel: 'Keep them logged in',
    cancel: 'Cancel',
  },
  done: {
    one: (name: string) => `${name} was logged out.`,
    member: (member: string, device: string) => `${member} was logged out of ${device}.`,
    all: 'All other devices were logged out.',
    team: 'All team members were logged out.',
  },
} as const;

type Ask = { kind: 'one'; s: SessionEntry } | { kind: 'all'; ids: string[]; names: string[] } | { kind: 'team'; ids: string[] };

const memberOfSession = (s: SessionEntry): string | null => (typeof s.member === 'string' && s.member !== '' ? s.member : null);

/** The /settings/devices route: the account owner's screen, with its own confirm-it's-you sheet. */
export function DevicesRoute() {
  return (
    <OwnerOnly screen="devices">
      <DevicesWithConfirm />
    </OwnerOnly>
  );
}

function DevicesWithConfirm() {
  const { prove, confirmUi, open } = useConfirm();
  return (
    <ConfirmOpenProvider value={open}>
      <Devices prove={prove} />
      {confirmUi}
    </ConfirmOpenProvider>
  );
}

export function Devices({ prove }: { prove?: (a: ConfirmAction) => Promise<string> }) {
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [optNote, setOptNote] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  // Session length (owner, 2 Nov 2026): this session's own length, as after the login.
  const [length, setLength] = useState<SessionInfo | null>(null);
  const [lengthNote, setLengthNote] = useState<string | null>(null);
  // G-007: the team's size, so the team card can say none are logged in, or there are none yet;
  // null when this account has no team (the call is refused) or it has not answered. Only a vendor
  // account has a team (owner, 2 Nov 2026), but GET /v1/team answers a plain trader's own session
  // too ({ members: [], max: 3 }), so the reply counts only once me() says the account is a vendor.
  const [teamReply, setTeamReply] = useState<{ members: number; max: number } | null>(null);
  const [vendor, setVendor] = useState(false);
  const teamSize = vendor ? teamReply : null;

  const refresh = useCallback(async () => {
    setSessions(await authApi.listSessions());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError('Could not load your devices.'));
    // Staff and owner accounts have no device setting (403): the screen then shows the list only.
    authApi.getDeviceSettings().then(setSettings, () => undefined);
    // Staff, owner and backup sessions have no length (null): the field is then left out.
    authApi.me().then(
      (m) => {
        setLength(m.session ?? null);
        setVendor(isVendor(m));
      },
      () => undefined,
    );
    authApi.getTeam().then((t) => setTeamReply({ members: t.members.length, max: t.max }), () => undefined);
  }, [refresh]);

  const end = async (ids: string[], done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      for (const id of ids) await authApi.endSession(id);
      setNote(done);
      await refresh();
    } catch (e) {
      setError(refusalText(e, 'Could not log that device out. Try again.'));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const confirmAsk = () => {
    if (ask === null) return;
    setAsk(null);
    if (ask.kind === 'all') void end(ask.ids, C.done.all);
    else if (ask.kind === 'team') void end(ask.ids, C.done.team);
    else {
      const m = memberOfSession(ask.s);
      void end([ask.s.id], m !== null ? C.done.member(m, ask.s.deviceLabel) : C.done.one(ask.s.deviceLabel));
    }
  };

  const toggle = async () => {
    if (settings === null || prove === undefined) return;
    const on = !settings.oneDevice;
    setBusy(true);
    setError(null);
    setOptNote(null);
    try {
      const next = await withConfirm(
        { kind: 'set-one-device', on: on ? 'on' : 'off' },
        (t) => authApi.setOneDevice({ on, ...(t !== undefined ? { confirmToken: t } : {}) }),
        prove,
      );
      setSettings(next);
      setOptNote(next.oneDevice ? C.oneDeviceOn : C.oneDeviceOff);
    } catch (e) {
      if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not change that setting. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  // This session only (owner F18). The new time starts now (owner G24): the server ends the session
  // `now + hours`; a time that would end it later answers confirm-required, and then "Stay logged
  // in" with a login method makes the same change (the server decides, review M2).
  const changeLength = async (hours: number) => {
    if (length === null) return;
    setBusy(true);
    setLengthNote(null);
    setError(null);
    try {
      const run = (t?: string) => (t === undefined ? authApi.setSessionLength({ hours }) : authApi.extendSession({ confirmToken: t, hours }));
      const next = prove === undefined ? await run() : await withConfirm({ kind: 'extend-session' }, run, prove);
      setLength(next);
      shareSessionInfo(next);
      setLengthNote(SESSION_COPY.saved);
    } catch (e) {
      if (!isConfirmAbort(e)) setError(SESSION_COPY.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const list = sessions ?? [];
  const used = list.filter((s) => s.level === 'full').length;
  const mine = list.filter((s) => memberOfSession(s) === null);
  const team = list.filter((s) => memberOfSession(s) !== null);
  // "Log out all other devices" covers only your own devices (owner, 2 Nov, Devices board).
  const others = mine.filter((s) => !s.current);
  const max = settings === null ? null : settings.oneDevice ? 1 : settings.maxDevices;
  const over = max !== null && used > max;
  const meterNote = over ? C.over : max === null || settings?.oneDevice ? null : used >= max ? C.atLimit : max - used === 1 ? C.oneMore : C.more(max - used);
  // The team card shows with members logged in, and (G-007) whenever the account has a team.
  const showTeam = team.length > 0 || teamSize !== null;

  let askTitle = '';
  let askText = '';
  let askConfirm: string = C.logOut;
  let askCancel: string = C.ask.cancel;
  if (ask?.kind === 'all') {
    askTitle = C.ask.allTitle(ask.ids.length);
    askText = C.ask.allText(ask.names);
    askConfirm = C.logOutAll;
  } else if (ask?.kind === 'team') {
    // Owner, via the Devices board: a separate bulk logout for team members.
    askTitle = C.ask.teamTitle;
    askText = C.ask.teamText;
    askConfirm = C.logOutTeam;
    askCancel = C.ask.teamCancel;
  } else if (ask?.kind === 'one') {
    const m = memberOfSession(ask.s);
    askTitle = m !== null ? C.ask.memberTitle(m) : C.ask.oneTitle(ask.s.deviceLabel);
    askText = m !== null ? C.ask.memberText(m, ask.s.deviceLabel) : C.ask.oneText;
  }

  return (
    <FlowScreen screen="devices" title={C.title} back={{ label: C.back, to: '/settings/security' }} look="page">
      <div className="x2f-columns" data-part="devices">
        <div>
          <section className="x2f-section" aria-labelledby="devices-h">
            <h2 className="x2f-section-title" id="devices-h">
              {C.devicesTitle}
            </h2>
            {error !== null ? (
              <p className="x2f-error" role="alert">
                {error}
              </p>
            ) : null}
            {max !== null && sessions !== null ? (
              <div className="x2f-panel">
                <p className="x2f-h3" data-part="devices-count">
                  {over ? (
                    <>
                      <span className="x2f-num">{used}</span> logged in · your limit is <span className="x2f-num">{max}</span>
                    </>
                  ) : (
                    <>
                      <span className="x2f-num">{used}</span> of <span className="x2f-num">{max}</span> devices logged in
                    </>
                  )}
                </p>
                <Meter used={used} max={max} part="devices-meter" />
                {meterNote !== null ? <p className="x2f-fine">{meterNote}</p> : null}
              </div>
            ) : null}
            {note !== null ? (
              <p className="x2f-icon-line" role="status" data-part="devices-note">
                <Icon name="check" size={18} />
                <span>{note}</span>
              </p>
            ) : null}
            <div className="x2f-panel">
              <h3 className="x2f-h3" id="devices-mine-h">
                {C.mineTitle}
              </h3>
              <ul className="x2f-items" aria-labelledby="devices-mine-h" data-part="device-list">
                {mine.map((s) => (
                  <li className="x2f-item" key={s.id} data-current={s.current ? 'true' : 'false'}>
                    <span className="x2f-item__icon" data-device-icon={deviceKind(s.deviceLabel)}>
                      <Icon name={deviceKind(s.deviceLabel)} size={20} />
                    </span>
                    <span className="x2f-item__text">
                      <span className="x2f-item__name">{s.deviceLabel}</span>
                      {s.current ? (
                        <span className="x2f-item__tag">
                          <RoleTag role="neutral" tone="escrow">
                            {C.thisDevice}
                          </RoleTag>
                        </span>
                      ) : null}
                      <span className="x2f-item__note">
                        {s.current ? 'Active now' : lastActive(s.lastSeenAt)}
                      </span>
                    </span>
                    {s.current ? null : (
                      <Button
                        variant="secondary"
                        className="x2f-button--small"
                        aria-label={C.logOutLabel(s.deviceLabel)}
                        disabled={busy}
                        onClick={() => setAsk({ kind: 'one', s })}
                        data-part="end-session"
                      >
                        {C.logOut}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                variant="secondary"
                disabled={busy || others.length === 0}
                onClick={() => setAsk({ kind: 'all', ids: others.map((s) => s.id), names: others.map((s) => s.deviceLabel) })}
                data-part="end-others"
              >
                {C.logOutAll}
              </Button>
            </div>
            {showTeam ? (
              <section className="x2f-panel" data-tone="team" aria-labelledby="devices-team-h" data-part="team-sessions">
                <h3 className="x2f-h3 x2f-icon-line" id="devices-team-h">
                  <Icon name="team" size={20} />
                  {C.teamTitle}
                </h3>
                <p className="x2f-fine">{C.teamNotYours}</p>
                {team.length === 0 && teamSize !== null && teamSize.members === 0 ? (
                  <div className="x2f-team-empty" data-part="team-empty">
                    <h4 className="x2f-team-empty__title">{C.teamEmptyTitle}</h4>
                    <p className="x2f-fine">{C.teamEmpty(teamSize.max)}</p>
                    <Link className="x2f-link x2f-team-empty__add" to={TEAM_PATH}>
                      {C.teamAdd}
                    </Link>
                  </div>
                ) : null}
                {team.length === 0 && teamSize !== null && teamSize.members > 0 ? <p className="x2f-fine">{C.teamAllOut}</p> : null}
                <ul className="x2f-items" aria-labelledby="devices-team-h" hidden={team.length === 0}>
                  {team.map((s) => {
                    const m = memberOfSession(s)!;
                    return (
                      <li className="x2f-item" key={s.id} data-member={m}>
                        <Avatar name={m} initials={initials(m)} kind="team" />
                        <span className="x2f-item__text">
                          <span className="x2f-item__name">{m}</span>
                          <span className="x2f-item__tag">
                            <RoleTag role="team" />
                          </span>
                          <span className="x2f-item__note">
                            {s.deviceLabel} · {lastActive(s.lastSeenAt)}
                          </span>
                        </span>
                        <Button
                          variant="secondary"
                          className="x2f-button--small"
                          aria-label={C.teamLogOutLabel(m, s.deviceLabel)}
                          disabled={busy}
                          onClick={() => setAsk({ kind: 'one', s })}
                          data-part="end-session"
                        >
                          {C.logOut}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {teamSize !== null && teamSize.members === 0 && team.length === 0 ? null : (
                  <Button
                    variant="secondary"
                    data-tone="team"
                    disabled={busy || team.length === 0}
                    onClick={() => setAsk({ kind: 'team', ids: team.map((s) => s.id) })}
                    data-part="end-team"
                  >
                    {C.logOutTeam}
                  </Button>
                )}
                <p className="x2f-fine" data-part="team-all-covers">
                  {C.teamAllCovers}
                </p>
                <Link className="x2f-row-link" to={TEAM_PATH}>
                  <span>{C.manageTeam}</span>
                  <Icon name="chevron-right" size={18} />
                </Link>
              </section>
            ) : null}
          </section>
        </div>
        <div>
          <section className="x2f-section" aria-labelledby="devices-opt-h">
            <h2 className="x2f-section-title" id="devices-opt-h">
              {C.optionsTitle}
            </h2>
            {settings !== null ? (
              <div className="x2f-panel" data-part="one-device">
                <div className="x2f-setting">
                  <span className="x2f-setting__text">
                    <span className="x2f-h3" id="devices-one-l">
                      {C.oneDevice}
                    </span>
                    <span className="x2f-fine" id="devices-one-d">
                      {C.oneDeviceHint}
                    </span>
                  </span>
                  <Switch
                    checked={settings.oneDevice}
                    onClick={() => void toggle()}
                    aria-labelledby="devices-one-l"
                    aria-describedby="devices-one-d"
                    disabled={busy || prove === undefined}
                    data-part="one-device-toggle"
                  />
                </div>
                {optNote !== null ? (
                  <p className="x2f-icon-line" role="status" data-part="one-device-note">
                    <Icon name="check" size={18} />
                    <span>{optNote}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
            {length !== null ? (
              <div className="x2f-panel" data-part="session-length-panel">
                <SessionLengthField
                  choices={length.choices}
                  value={length.lengthHours}
                  onChange={(h) => void changeLength(h)}
                  disabled={busy}
                  askHint={C.lengthLine(length.lengthHours)}
                />
                {lengthNote !== null ? (
                  <p className="x2f-icon-line" role="status" data-part="session-length-note">
                    <Icon name="check" size={18} />
                    <span>{lengthNote}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
          <section className="x2f-section" aria-labelledby="devices-how-h">
            <h2 className="x2f-section-title" id="devices-how-h">
              {C.howTitle}
            </h2>
            <div className="x2f-panel">
              <h3 className="x2f-h3">{C.howApproveTitle}</h3>
              <p className="x2f-fine">{C.howApprove}</p>
            </div>
            <p className="x2f-fine">{C.noIp}</p>
          </section>
        </div>
      </div>
      <Sheet open={ask !== null} title={askTitle} closeButton={false} wide="dialog" onClose={() => setAsk(null)}>
        <div className="x2f-stack">
          <p className="x2f-body">{askText}</p>
          <Button variant="danger-outline" onClick={confirmAsk} data-part="end-confirm">
            {askConfirm}
          </Button>
          <Button variant="quiet" onClick={() => setAsk(null)} data-part="end-cancel">
            {askCancel}
          </Button>
        </div>
      </Sheet>
    </FlowScreen>
  );
}
