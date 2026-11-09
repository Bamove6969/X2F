/**
 * The idle reminder (owner, Q75, 6 Nov 2026). Mounted once by the app shell. When the person has
 * turned it on (`useIdleReminderSetting`) and has not used the app for that many minutes (no key,
 * pointer, touch or wheel), it shows "Still there?". A reminder only: it never logs anyone out,
 * never calls the server and never moves the session's end ("Stay logged in?" and the session
 * length do that). Dismissing it starts the wait over. Checked every second, so a sleeping tab
 * catches up when it wakes. Words: IDLE_COPY (DESIGN: wording).
 */
import { useEffect, useRef, useState } from 'react';
import { IDLE_COPY as C } from '../screens/auth/sessionCopy.js';
import { Button } from '../ui/Button.js';
import { Sheet } from '../ui/Sheet.js';
import { useIdleReminderSetting } from './idleReminderWatch.js';

const ACTIVITY = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const;

export function IdleReminder() {
  const minutes = useIdleReminderSetting();
  const last = useRef(Date.now());
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (minutes === null) {
      setShown(false);
      return;
    }
    last.current = Date.now();
    const seen = () => {
      last.current = Date.now();
    };
    for (const e of ACTIVITY) window.addEventListener(e, seen, { passive: true });
    const id = setInterval(() => {
      if (Date.now() - last.current >= minutes * 60_000) setShown(true);
    }, 1000);
    return () => {
      clearInterval(id);
      for (const e of ACTIVITY) window.removeEventListener(e, seen);
    };
  }, [minutes]);

  if (!shown || minutes === null) return null;
  const dismiss = () => {
    last.current = Date.now();
    setShown(false);
  };
  return (
    <Sheet open title={C.reminderTitle} wide="dialog" onClose={dismiss}>
      <div className="x2f-stack" data-part="idle-reminder">
        <p className="x2f-body" role="status">
          {C.reminderBody(minutes)}
        </p>
        <Button variant="primary" onClick={dismiss} data-part="idle-reminder-dismiss">
          {C.dismiss}
        </Button>
      </div>
    </Sheet>
  );
}
