/**
 * Devices and sessions (Task 30, spec §6.3; Plan 2 Task 16 for the limit and the approval rule;
 * Plan 2 Task 18 for team members' sessions): its own screen at /settings/devices, linked from
 * Settings → Security. The count against the limit with a meter, your devices with remote log-out
 * (asked first), "Log out all other devices" (your own devices only), team members' sessions in
 * their own card with "Log out all team members" (asked first; owner, via the Devices board), the "One device at a time" switch (confirm-it's-you) and how a new device gets
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
import { isHeld, withConfirm, type ConfirmAction, type DeviceSettings, type SessionEntry } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, type CantDoCode } from '../../ui/cantDoCodes.js';
import { FlowScreen } from '../../ui/FlowScreen.js';
import { Icon } from '../../ui/icons.js';
import { lastActive } from '../../ui/lastActive.js';
import { Meter } from '../../ui/Meter.js';
import { Sheet } from '../../ui/Sheet.js';
import { Switch } from '../../ui/Switch.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { heldNote, refusalText, weakSessionCantDo } from '../auth/refusals.js';
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
  more: (n: number) => `${n} more devices can log in.`,
  mineTitle: 'Your devices',
  thisDevice: 'This device',
  logOut: 'Log out',
  logOutLabel: (name: string) => `Log out ${name}`,
  logOutAll: 'Log out all other devices',
  teamTitle: 'Team members logged in',
  teamNotYours: "These are your team members' logins, not yours.",
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
  recovery: 'Recovery login',
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
  // Plan 2 Task 17: a change from a login with one way of proving it's you waits out the hold.
  const [held, setHeld] = useState<string | null>(null);
  // Plan 2 Task 17 review round 2: a device whose login waits may not log stronger ones out (CantDoThat).
  const [cantDo, setCantDo] = useState<{ code: CantDoCode; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setSessions(await authApi.listSessions());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError('Could not load your devices.'));
    // Staff and owner accounts have no device setting (403): the screen then shows the list only.
    authApi.getDeviceSettings().then(setSettings, () => undefined);
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
      const refused = weakSessionCantDo(e);
      if (refused !== null) setCantDo(refused);
      else setError('Could not log that device out. Try again.');
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
    setHeld(null);
    setOptNote(null);
    try {
      const next = await withConfirm(
        { kind: 'set-one-device', on: on ? 'on' : 'off' },
        (t) => authApi.setOneDevice({ on, ...(t !== undefined ? { confirmToken: t } : {}) }),
        prove,
      );
      if (isHeld(next)) setHeld(heldNote(next.holdUntil));
      else {
        setSettings(next);
        setOptNote(next.oneDevice ? C.oneDeviceOn : C.oneDeviceOff);
      }
    } catch (e) {
      if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not change that setting. Try again.'));
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
  const meterNote = max === null || settings?.oneDevice ? null : used >= max ? C.atLimit : max - used === 1 ? C.oneMore : C.more(max - used);

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
                  <span className="x2f-num">{used}</span> of <span className="x2f-num">{max}</span> devices logged in
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
                      {s.current ? <span className="x2f-tag">{C.thisDevice}</span> : null}
                      <span className="x2f-item__note">
                        {s.current ? 'Active now' : lastActive(s.lastSeenAt)}
                        {s.level === 'recovery' ? ` · ${C.recovery}` : ''}
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
            {team.length > 0 ? (
              <section className="x2f-panel" data-tone="team" aria-labelledby="devices-team-h" data-part="team-sessions">
                <h3 className="x2f-h3 x2f-icon-line" id="devices-team-h">
                  <Icon name="team" size={20} />
                  {C.teamTitle}
                </h3>
                <p className="x2f-fine">{C.teamNotYours}</p>
                <ul className="x2f-items" aria-labelledby="devices-team-h">
                  {team.map((s) => {
                    const m = memberOfSession(s)!;
                    return (
                      <li className="x2f-item" key={s.id} data-member={m}>
                        <span className="x2f-avatar" aria-hidden="true">
                          {initials(m)}
                        </span>
                        <span className="x2f-item__text">
                          <span className="x2f-item__name">{m}</span>
                          <span className="x2f-tag" data-tone="team">
                            {C.teamMember}
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
                <Button
                  variant="secondary"
                  data-tone="team"
                  disabled={busy}
                  onClick={() => setAsk({ kind: 'team', ids: team.map((s) => s.id) })}
                  data-part="end-team"
                >
                  {C.logOutTeam}
                </Button>
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
                    on={settings.oneDevice}
                    onToggle={() => void toggle()}
                    labelledBy="devices-one-l"
                    describedBy="devices-one-d"
                    disabled={busy || prove === undefined}
                    part="one-device-toggle"
                  />
                </div>
                {held !== null ? (
                  <p className="x2f-fine" role="status" data-part="held-note">
                    {held}
                  </p>
                ) : null}
                {optNote !== null ? (
                  <p className="x2f-icon-line" role="status" data-part="one-device-note">
                    <Icon name="check" size={18} />
                    <span>{optNote}</span>
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
      {cantDo !== null ? <CantDoThat title={CANT_DO_TITLE.devices} body={cantDo.text} from={cantDo.code} onClose={() => setCantDo(null)} /> : null}
    </FlowScreen>
  );
}
