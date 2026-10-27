// X2F service worker (Plan 3 Task 19): Web Push only. Served from this origin at /sw.js (CSP
// worker-src 'self'); it caches nothing. Its one request: after showing a trade push it tells the
// API the final alert was seen (POST /v1/account/final-alert-seen, same origin, no body).
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
  event.waitUntil(
    (async () => {
      await self.registration.showNotification('X2F', { body, tag: 'x2f' });
      // The seen-receipt (P3-I13): only a shown trade push counts. A failure leaves the trade's
      // final_alert_delivered unset, which moderation treats as not seen.
      if (body === TRADE) {
        await self.fetch('/v1/account/final-alert-seen', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
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
