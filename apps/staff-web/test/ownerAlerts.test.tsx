// @vitest-environment happy-dom
// O-040 (owner Q35): the owner's notifications on the staff site: an unread badge in the shell and
// a page listing them newest first, each marked read on its own or all at once. Owner only.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { button, click, fakeApi, render, settle } from './helpers.js';

const me = (role: 'owner' | 'senior' | 'mod' | 'helper') => ({
  tradeTag: 'lumen.k',
  role,
  nav: NAV[role],
  sessionEndsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
});
const alerts = (unread: number) => ({
  items: [
    { id: 'a2', kind: 'fee-sweep-due', message: 'The fee wallet reached your threshold', detail: {}, createdAt: '2026-11-12T09:02:00.000Z', seenAt: null },
    { id: 'a1', kind: 'price-source-failing', message: 'Kraken price feed is failing', detail: {}, createdAt: '2026-11-12T09:01:00.000Z', seenAt: unread > 1 ? null : '2026-11-12T09:05:00.000Z' },
    { id: 'a0', kind: 'auto-close-capped', message: null, detail: { closed: 50 }, createdAt: '2026-11-12T09:00:00.000Z', seenAt: '2026-11-12T09:03:00.000Z' },
  ],
  unread,
  next: null,
});

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const badge = () => document.querySelector('[data-part="alerts-badge"]');

describe('owner notifications (O-040)', () => {
  it('the owner sees a Notifications link with the unread count; other roles see none and the API is not asked', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: me('owner') }, 'GET /staff/v1/owner/alerts': { body: alerts(2) } });
    await open('/overview');
    expect(document.querySelector('a[href="/notifications"]')?.textContent).toContain('Notifications');
    expect(badge()?.textContent).toBe('2');
    expect(api.calls.some((c) => c.path.startsWith('/staff/v1/owner/alerts'))).toBe(true);
    document.body.innerHTML = '';
    const mod = fakeApi({ 'GET /staff/v1/me': { body: me('mod') } });
    await open('/disputes');
    expect(document.querySelector('a[href="/notifications"]')).toBeNull();
    expect(mod.calls.some((c) => c.path.startsWith('/staff/v1/owner/alerts'))).toBe(false);
  });

  it('no badge when nothing is unread', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('owner') }, 'GET /staff/v1/owner/alerts': { body: { ...alerts(0), items: [] } } });
    await open('/overview');
    expect(badge()).toBeNull();
  });

  it('the page lists them newest first, unread ones marked; Mark as read and Mark all as read call the API and update the list and badge', async () => {
    let unread = 2;
    const api = fakeApi({
      'GET /staff/v1/me': { body: me('owner') },
      'GET /staff/v1/owner/alerts': () => ({ body: alerts(unread) }),
      'POST /staff/v1/owner/alerts/:id/read': () => {
        unread = 1;
        return { status: 204 };
      },
      'POST /staff/v1/owner/alerts/read-all': () => {
        unread = 0;
        return { status: 204 };
      },
    });
    await open('/notifications');
    const rows = [...document.querySelectorAll('[data-part="alert-row"]')];
    expect(rows.map((r) => r.getAttribute('data-unread'))).toEqual(['true', 'true', 'false']);
    expect(rows[0]!.textContent).toContain('The fee wallet reached your threshold');
    // An alert with no message still reads as its kind.
    expect(rows[2]!.textContent).toContain('Inactive accounts');
    await click(button('Mark as read', rows[1]!));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/staff/v1/owner/alerts/a1/read')).toBe(true);
    expect(badge()?.textContent).toBe('1');
    await click(button('Mark all as read'));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/staff/v1/owner/alerts/read-all')).toBe(true);
    await settle();
    expect(badge()).toBeNull();
  });

  it('another role on /notifications sees nothing of it', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: me('senior') } });
    await open('/notifications');
    expect(document.querySelector('[data-part="alert-row"]')).toBeNull();
    expect(document.body.textContent).toContain('Nothing to show for your role yet');
  });
});
