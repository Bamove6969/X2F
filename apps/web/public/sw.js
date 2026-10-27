// X2F service worker (Plan 3 Task 19): Web Push only. Served from this origin at /sw.js (CSP
// worker-src 'self'); it caches nothing and makes no request. It posts no final-alert seen-receipt:
// a notification in the tray is not proof the buyer read it (lead 2026-10-27). That receipt comes
// only from Task 25's FinalAlert, once the alert is on screen in the app.
//
// A push can only ever show one of three fixed texts (the nudge, the trade change, the owner's
// alert). Whatever the payload says, anything else is shown as the generic trade text, so no code,
// amount, name, alert detail or link can reach the lock screen even if a payload were tampered
// with. A tap opens (or focuses) this site at `/`.
const NUDGE = 'Someone nudged you on X2F';
const TRADE = 'Something changed in a trade on X2F';
const ALERT = 'Something needs your attention';

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
  const body = text === NUDGE ? NUDGE : text === ALERT ? ALERT : TRADE;
  // One tag per kind: replacing a same-tag notification skips the alert steps (no sound or
  // vibration), so a trade push must never land on an unread nudge's tag and go silent.
  const tag = body === NUDGE ? 'x2f-nudge' : body === ALERT ? 'x2f-alert' : 'x2f-trade';
  event.waitUntil(
    (async () => {
      await self.registration.showNotification('X2F', { body, tag });
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
