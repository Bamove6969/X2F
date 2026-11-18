// Plan 4 Task 31 / J-14: the staff Tickets and Compromised accounts pages in a real browser, under
// STAFF_CSP. No board exists yet (NEEDS_DESIGN), so no parity check: behaviour, no CSP violation,
// no request to another origin. The staff API is stubbed with page.route in the shapes of
// apps/api/src/tickets/staffRoutes.ts (its own tests cover the server side, the key tap included).
import { expect, test, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ends = () => new Date(Date.now() + 3600_000).toISOString();
const TICKET = { id: '11111111-1111-4111-8111-111111111111', number: 1001, category: 'trades', tradeCode: null, status: 'open', createdAt: '2026-11-09T10:00:00.000Z', updatedAt: '2026-11-09T10:00:00.000Z', closedAt: null, displayName: 'mira.k' };
const REPORT = { ...TICKET, id: '22222222-2222-4222-8222-222222222222', number: 1002, category: 'compromised', displayName: 'victim_1', matched: true, locked: true, methodsLeft: ['passkey'] };

async function stub(page: Page, nav: string[], role: string): Promise<string[]> {
  const posts: string[] = [];
  await page.route('**/staff/v1/**', (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') posts.push(path);
    if (path === '/staff/v1/me') return json({ displayName: `${role}_1`, role, nav, sessionEndsAt: ends() })(route);
    if (path === '/staff/v1/tickets') return json({ tickets: [TICKET] })(route);
    if (path === `/staff/v1/tickets/${TICKET.id}`) {
      return json({ ticket: TICKET, displayName: 'mira.k', messages: [{ author: 'trader', memberName: null, staffName: null, body: 'Where is my trade?', at: TICKET.createdAt }] })(route);
    }
    if (path === `/staff/v1/tickets/${TICKET.id}/messages`) return json({}, 201)(route);
    if (path === '/staff/v1/compromised') return json({ tickets: [REPORT] })(route);
    if (path === `/staff/v1/compromised/${REPORT.id}`) {
      return json({
        ticket: REPORT,
        methodsLeft: ['passkey'],
        comment: 'Phone stolen',
        account: { id: '33333333-3333-4333-8333-333333333333', displayName: 'victim_1', kind: 'trader', createdAt: '2026-01-01T00:00:00.000Z', lockedAt: REPORT.createdAt, openTrades: [{ code: 'ABCD-EFGH-JKMN-PQRS', state: 'secured', side: 'seller', paused: true }] },
      })(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return posts;
}

function watch(page: Page, origin: string): { violations: string[]; foreign: string[] } {
  const w = { violations: [] as string[], foreign: [] as string[] };
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) w.violations.push(m.text());
  });
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== origin) w.foreign.push(r.url());
  });
  return w;
}

test('a helper with the tickets grant works the queue and answers a ticket; no CSP violation, no other origin', async ({ page, baseURL }) => {
  const w = watch(page, new URL(baseURL!).origin);
  const posts = await stub(page, ['tickets'], 'helper');
  await page.goto('/tickets');
  await expect(page.getByRole('navigation', { name: 'Staff' }).getByRole('link')).toHaveText(['Tickets']);
  await page.getByRole('link', { name: '#1001' }).click();
  await expect(page.locator('[data-part="ticket-thread"]')).toContainText('Where is my trade?');
  await page.getByLabel('Answer').fill('Looking now.');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect.poll(() => posts).toContain(`/staff/v1/tickets/${TICKET.id}/messages`);
  expect(w.violations).toEqual([]);
  expect(w.foreign).toEqual([]);
});

test('a senior opens a compromised-account report: the account, its paused trades and the unlock', async ({ page, baseURL }) => {
  const w = watch(page, new URL(baseURL!).origin);
  await stub(page, ['disputes', 'training', 'log', 'feedback', 'compromised'], 'senior');
  await page.goto('/compromised');
  await page.getByRole('link', { name: '#1002' }).click();
  await expect(page.locator('[data-part="compromised-comment"]')).toHaveText('Phone stolen');
  await expect(page.getByRole('table', { name: 'Open trades' })).toContainText('ABCD-EFGH-JKMN-PQRS');
  await expect(page.getByRole('table', { name: 'Open trades' })).toContainText('Paused');
  await page.getByRole('button', { name: 'Unlock account' }).click();
  await expect(page.getByRole('dialog', { name: 'Unlock this account?' })).toBeVisible();
  expect(w.violations).toEqual([]);
  expect(w.foreign).toEqual([]);
});
