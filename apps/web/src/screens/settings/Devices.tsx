/**
 * Signed-in devices (Task 30, spec §6.3): the session list with remote log-out. Ending another
 * device's session logs it out at once; the current device is marked and cannot log itself out
 * here (that is the Log out button elsewhere).
 */
import { useCallback, useEffect, useState } from 'react';
import type { SessionEntry } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';

export function Devices() {
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSessions(await authApi.listSessions());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError('Could not load your devices.'));
  }, [refresh]);

  const end = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.endSession(id);
      await refresh();
    } catch {
      setError('Could not log that device out. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-card" data-part="devices" aria-labelledby="devices-h">
      <h2 className="x2f-card__title" id="devices-h">
        Devices
      </h2>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="x2f-list" data-part="device-list">
        {(sessions ?? []).map((s) => (
          <li className="x2f-list__row" key={s.id} data-current={s.current ? 'true' : 'false'}>
            <span className="x2f-list__label">
              {s.deviceLabel}
              {s.current ? ' (this device)' : ''}
              {s.level === 'recovery' ? ' · recovery' : ''}
            </span>
            {s.current ? null : (
              <Button variant="danger" disabled={busy} onClick={() => void end(s.id)} data-part="end-session">
                Log out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
