// Plan 5 Task 11: the moderators' Past reputation page in a real browser, under STAFF_CSP. No board
// draws it (DESIGN: not drawn), so there is no parity check. The staff API is stubbed with
// page.route in the shapes of apps/api/src/staff/pastrep.ts. The evidence link opens the archive in
// a new tab with no referrer and no opener (the archive never learns the staff site, and cannot
// reach back into it); the page itself never requests the archive. Approve needs the fingerprint
// tick, the profile tick (review M2) and the trades shown (P5-A23) and sends exactly those.
import { expect, test, type Page, type Request, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const ME = { tradeTag: 'dmitri_k', role: 'mod', nav: ['disputes', 'past-reputation', 'training', 'log'], sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };
const ARCHIVE = 'https://web.archive.org/web/2023/https://localmonero.co/user/rook';
const CLAIM = {
  id: '11111111-1111-4111-8111-111111111111', site: 'LocalMonero', url: ARCHIVE, claimedTrades: 1300, verifiedTrades: null, verifiedUsdCents: null,
  status: 'signed', fingerprint: 'A1B2 C3D4 E5F6 0718 293A 4B5C 6D7E 8F90 1234 5678', keyId: '6D7E8F9012345678', signatureValid: true,
  tradeTag: 'rook88', createdAt: '2026-11-01T10:00:00.000Z', originalHost: 'localmonero.co',
};

async function stub(page: Page, posts: Array<{ path: string; body: unknown }>): Promise<void> {
  let queue: unknown[] = [CLAIM];
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/staff/v1/me') return json(ME)(route);
    if (path === '/staff/v1/past-rep' && req.method() === 'GET') return json({ items: queue, next: null })(route);
    if (req.method() === 'POST' && path === `/staff/v1/past-rep/${CLAIM.id}/approve`) {
      posts.push({ path, body: req.postDataJSON() });
      queue = [];
      return json({ id: CLAIM.id, status: 'approved', verifiedTrades: 1240 })(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
}

test('a moderator checks the archive in a new tab (no referrer, no opener) and approves with the fingerprint tick; no CSP violation', async ({ page, context }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  // Every request to the archive: only the new tab may make one, and never with a referrer.
  const archive: Request[] = [];
  await context.route('https://web.archive.org/**', (route) => {
    archive.push(route.request());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Archive</title><p>archived</p>' });
  });
  const posts: Array<{ path: string; body: unknown }> = [];
  await stub(page, posts);
  await page.goto('/past-reputation');
  await expect(page.locator('[data-screen="past-rep"]')).toBeVisible();
  await expect(page.locator('nav[aria-label="Staff"] a[data-nav="past-reputation"]')).toHaveText('Past reputation');
  await expect(page.locator('[data-part="fingerprint"]')).toHaveText(CLAIM.fingerprint);
  await expect(page.locator('[data-part="evidence-note"]')).toHaveText('Opens the archive in your browser. X2F never fetches it.');
  // Review M2: the full link as text and the archived site's host.
  await expect(page.locator('[data-part="evidence-url"]')).toHaveText(ARCHIVE);
  await expect(page.locator('[data-part="original-host"]')).toHaveText('Archived site: localmonero.co');
  expect(archive).toHaveLength(0);

  const link = page.locator('[data-part="evidence-link"] a');
  await expect(link).toHaveAttribute('href', ARCHIVE);
  await expect(link).toHaveAttribute('target', '_blank');
  expect((await link.getAttribute('rel'))?.split(' ')).toEqual(expect.arrayContaining(['noreferrer', 'noopener']));
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await popup.waitForLoadState();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(archive.length).toBeGreaterThan(0);
  for (const r of archive) {
    expect(r.headers().referer).toBeUndefined();
    expect(r.frame().page()).toBe(popup);
  }
  await popup.close();

  const approve = page.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeDisabled();
  // Review m1: the trades filled, no tick: still off; one tick of two: still off.
  await page.getByLabel('Trades shown on the archived page').fill('1240');
  await expect(approve).toBeDisabled();
  await page.getByLabel('The archived page shows this exact full fingerprint').check();
  await expect(approve).toBeDisabled();
  await page.getByLabel("The archived page is the trader's profile on LocalMonero").check();
  await expect(approve).toBeEnabled();
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await approve.click();
  await expect(page.locator('[data-part="no-claims"]')).toBeVisible();
  expect(posts).toEqual([{ path: `/staff/v1/past-rep/${CLAIM.id}/approve`, body: { fingerprintSeen: true, profileSeen: true, tradesSeen: 1240 } }]);
  expect(violations).toEqual([]);
});
