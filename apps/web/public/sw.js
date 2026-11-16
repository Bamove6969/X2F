// X2F service worker (Plan 3 Task 19): Web Push only. Served from this origin at /sw.js (CSP
// worker-src 'self'); it caches nothing and makes no request. It posts no final-alert seen-receipt:
// a notification in the tray is not proof the buyer read it (lead 2026-10-27). That receipt comes
// only from Task 25's FinalAlert, once the alert is on screen in the app.
//
// A push can only ever show one of four fixed texts (the nudge, the trade change, the owner's
// alert, and the seller's "Your input is needed to cancel this trade." of Task 39). Whatever the payload says, anything else is shown as the generic trade text, so no code,
// amount, name, alert detail or link can reach the lock screen even if a payload were tampered
// with. A tap opens (or focuses) this site at `/`.
const NUDGE = 'Someone nudged you on X2F';
const TRADE = 'Something changed in a trade on X2F';
const ALERT = 'Something needs your attention';
const CANCEL = 'Your input is needed to cancel this trade.';

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let text = '';
  try {
    text = event.data ? event.data.text() : '';
  } catch {
    text = '';
  }
  const body = text === NUDGE ? NUDGE : text === ALERT ? ALERT : text === CANCEL ? CANCEL : TRADE;
  // One tag per kind: replacing a same-tag notification skips the alert steps (no sound or
  // vibration), so a trade push must never land on an unread nudge's tag and go silent.
  const tag = body === NUDGE ? 'x2f-nudge' : body === ALERT ? 'x2f-alert' : body === CANCEL ? 'x2f-cancel' : 'x2f-trade';
  // W-006: tell open X2F windows which kind arrived (only the kind, never the payload), so the
  // loud alarm (apps/web/src/alerts/alarm.tsx) can ring in an open tab.
  const kind = body === NUDGE ? 'nudge' : body === ALERT ? 'alert' : body === CANCEL ? 'cancel-confirm' : 'trade';
  event.waitUntil(
    (async () => {
      await self.registration.showNotification('X2F', { body, tag });
      try {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const w of windows) {
          if (new URL(w.url).origin === self.location.origin && typeof w.postMessage === 'function') w.postMessage({ type: 'x2f-push', kind });
        }
      } catch {
        // the notification is shown; an alarm in an open tab is extra
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) return w.focus();
      }
      return self.clients.openWindow('/');
    })(),
  );
});
