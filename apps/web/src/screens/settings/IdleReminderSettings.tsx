/**
 * The idle reminder setting (owner, Q75, 6 Nov 2026): at /settings/idle-reminder, the person's own
 * setting, a team member's included (it is stored on their own login). Off by default; on, with
 * one of IDLE_REMINDER_MINUTES. A change saves at once. Linked from Settings → Security and from the
 * question after every login (where a team member, who has no Security screen, finds it).
 * Placement and words: DESIGN (no board yet; IDLE_COPY).
 */
import { useEffect, useId, useState } from 'react';
import { IDLE_REMINDER_MINUTES, isIdleReminderMinutes } from '@x2f/auth-client';
import { authApi } from '../auth/authApi.js';
import { IDLE_COPY as C, IDLE_REMINDER_PATH } from '../auth/sessionCopy.js';
import { publishIdleReminder } from '../../session/idleReminderWatch.js';
import '../screens.css';

export { IDLE_REMINDER_PATH };

export function IdleReminderScreen() {
  const id = useId();
  const [value, setValue] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authApi.me().then(
      (m) => {
        if (live) setValue(m.idleReminderMinutes ?? null);
      },
      () => {
        if (live) setValue(null);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const save = async (minutes: number | null) => {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const r = await authApi.setIdleReminder({ minutes });
      setValue(r.idleReminderMinutes);
      publishIdleReminder(r.idleReminderMinutes);
      setNote(C.saved);
    } catch {
      setError(C.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  if (value === undefined) return <main className="x2f-screen" data-screen="idle-reminder" aria-busy="true" />;
  return (
    <main className="x2f-screen" data-screen="idle-reminder">
      <h1 className="x2f-screen__title">{C.title}</h1>
      <section className="x2f-card">
        <div className="x2f-field" data-part="idle-reminder-field">
          <label className="x2f-label" htmlFor={id}>
            {C.label}
          </label>
          <select
            className="x2f-select"
            id={id}
            value={value === null ? 'off' : String(value)}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value === 'off' ? null : Number(e.target.value);
              if (v === null || isIdleReminderMinutes(v)) void save(v);
            }}
            data-part="idle-reminder-select"
          >
            <option value="off">{C.off}</option>
            {IDLE_REMINDER_MINUTES.map((m) => (
              <option value={String(m)} key={m}>
                {C.option(m)}
              </option>
            ))}
          </select>
          <p className="x2f-fine">{C.hint}</p>
        </div>
        {note !== null ? (
          <p className="x2f-fine" role="status">
            {note}
          </p>
        ) : null}
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
