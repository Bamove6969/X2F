// X2F service worker (Plan 3 Task 19): Web Push only. Served from this origin at /sw.js (CSP
// worker-src 'self'); it caches nothing and fetches nothing.
//
// A push can only ever show one of two fixed texts. Whatever the payload says, anything else is
// shown as the generic trade text, so no code, amount, name or link can reach the lock screen even
// if a payload were tampered with. A tap opens (or focuses) this site at `/`.
const NUDGE = 'Someone nudged you on X2F';
const TRADE = 'Something changed in a trade on X2F';

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
  const body = text === NUDGE ? NUDGE : TRADE;
  event.waitUntil(self.registration.showNotification('X2F', { body, tag: 'x2f' }));
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
