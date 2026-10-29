/**
 * Signed-in devices (Task 30, spec §6.3; Plan 2 Task 16 for the limit and the approval rule): the
 * session list with remote log-out, how many of the allowed devices are in use, "Log out all other
 * devices", and the "One device at a time" setting (confirm-it's-you). Ending another device's
 * session logs it out at once; the current device is marked and cannot log itself out here (that
 * is the Log out button elsewhere).
 *
 * Built from existing UI-kit parts only, with no styling of its own: the Devices board is still in
 * progress (test/devices-tripwire.test.ts NEEDS_DESIGN_DEVICES). The words are the board's.
 */
import { useCallback, useEffect, useState } from 'react';
import { withConfirm, type ConfirmAction, type DeviceSettings, type SessionEntry } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { isConfirmAbort } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { refusalText } from '../auth/refusals.js';

export function Devices({ prove }: { prove?: (a: ConfirmAction) => Promise<string> }) {
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSessions(await authApi.listSessions());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError('Could not load your devices.'));
    // Staff and owner accounts have no device setting (403): the section then shows the list only.
    authApi.getDeviceSettings().then(setSettings, () => undefined);
  }, [refresh]);

  const end = async (ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const id of ids) await authApi.endSession(id);
      await refresh();
    } catch {
      setError('Could not log that device out. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (settings === null || prove === undefined) return;
    const on = !settings.oneDevice;
    setBusy(true);
    setError(null);
    try {
      const next = await withConfirm(
        { kind: 'set-one-device', on: on ? 'on' : 'off' },
        (t) => authApi.setOneDevice({ on, ...(t !== undefined ? { confirmToken: t } : {}) }),
        prove,
      );
      setSettings(next);
    } catch (e) {
      if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not change that setting. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const list = sessions ?? [];
  const full = list.filter((s) => s.level === 'full');
  const others = list.filter((s) => !s.current);

  return (
    <section className="x2f-card" data-part="devices" aria-labelledby="devices-h">
      <h2 className="x2f-card__title" id="devices-h">
        Devices
      </h2>
      {settings !== null ? (
        <p className="x2f-sheet__body" data-part="devices-rule">
          You can be logged in on up to {settings.maxDevices} devices at once. A new device has to be approved from one of these.
        </p>
      ) : null}
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {settings !== null && sessions !== null ? (
        <p className="x2f-label" data-part="devices-count">
          Logged in · {full.length} of {settings.oneDevice ? 1 : settings.maxDevices}
        </p>
      ) : null}
      <ul className="x2f-list" data-part="device-list">
        {list.map((s) => (
          <li className="x2f-list__row" key={s.id} data-current={s.current ? 'true' : 'false'}>
            <span className="x2f-list__label">
              {s.deviceLabel}
              {s.current ? ' (this device)' : ''}
              {s.level === 'recovery' ? ' · recovery' : ''}
            </span>
            {s.current ? null : (
              <Button variant="danger" disabled={busy} onClick={() => void end([s.id])} data-part="end-session">
                Log out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 1 ? (
        <Button variant="quiet" disabled={busy} onClick={() => void end(others.map((s) => s.id))} data-part="end-others">
          Log out all other devices
        </Button>
      ) : null}
      {settings !== null ? (
        <div className="x2f-field" data-part="one-device">
          <p className="x2f-label">Extra safety</p>
          <p className="x2f-label">One device at a time</p>
          <p className="x2f-note">When you approve a new device, the one you were using is logged out. Only one device is ever logged in.</p>
          <Button
            variant="secondary"
            className={settings.oneDevice ? 'x2f-segmented__on' : ''}
            aria-pressed={settings.oneDevice}
            disabled={busy || prove === undefined}
            onClick={() => void toggle()}
            data-part="one-device-toggle"
          >
            {settings.oneDevice ? 'On' : 'Off'}
          </Button>
          <p className="x2f-label">How a new device gets in</p>
          <p className="x2f-note">
            When you log in somewhere new, every device here asks "Is this you?" and you tap the number the new device shows. If you say no, the login is
            blocked.
          </p>
          <p className="x2f-note">X2F doesn't log IP addresses, so devices are named only by browser and system.</p>
        </div>
      ) : null}
    </section>
  );
}
