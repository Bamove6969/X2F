// DESIGN: owner 17 Nov black+orange rule, the staff app: every staff screen, at 1366x768 and
// 390x844, with the staff API answering (empty) and down, shows the brand orange above the fold
// (apps/web/e2e/orange.ts counts it on a screenshot, every brand mark masked first: lead, 17 Nov,
// the logo's dot does not count). With X2F_ORANGE_AUDIT=1 the audit test writes staff-results.json
// and a screenshot of each screen with none to X2F_ORANGE_AUDIT_DIR (every screen's to
// X2F_ORANGE_AUDIT_SHOTS when set).
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { MIN_ORANGE, countOrange, maskedShot, orangeThings } from '../../web/e2e/orange.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const NAV = ['overview', 'disputes', 'past-reputation', 'accounts', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'tickets', 'settings'];
const ME = { displayName: 'owner_1', role: 'owner', nav: NAV, sessionEndsAt: '2099-01-01T00:00:00.000Z' };

type Mode = 'ok' | 'down';
const SCREENS: readonly { name: string; path: string; door?: boolean }[] = [
  { name: 'Staff login', path: '/login', door: true },
  { name: 'Owner setup', path: '/setup', door: true },
  { name: 'Staff invite', path: '/invite/abc', door: true },
  // '/staff' is left out: the staff server answers that path itself (its API prefix), so a direct
  // load is not the SPA; the Staff page is reached from the rail (reported in the audit).
  ...NAV.filter((n) => n !== 'staff').map((n) => ({ name: `Staff ${n}`, path: `/${n}` })),
  { name: 'Staff news editor', path: '/overview/news' },
  { name: 'Staff notifications', path: '/notifications' },
  // The screens main added since 17 Nov (each must pass the same rule).
  { name: 'Staff my security', path: '/security' },
  { name: 'Staff revenue', path: '/overview/revenue' },
  { name: 'Staff trade status', path: '/overview/trades' },
  { name: 'Staff work and hours', path: '/performance/st_1/work' },
  { name: 'Staff ticket case', path: '/tickets/tk_1' },
  { name: 'Staff compromised list', path: '/accounts/compromised' },
  { name: 'Staff compromised report', path: '/accounts/compromised/cr_1' },
];
const SIZES = [
  { name: '1366', width: 1366, height: 768 },
  { name: '390', width: 390, height: 844 },
] as const;

async function look(page: Page, s: (typeof SCREENS)[number], size: (typeof SIZES)[number], mode: Mode) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.route('**/staff/v1/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/staff/v1/me') return s.door ? json({ error: 'not-authenticated' }, 401)(r) : json(ME)(r);
    if (mode === 'down') return json({ error: 'internal' }, 503)(r);
    return json({ error: 'not-found' }, 404)(r);
  });
  await page.goto(s.path);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const orange = await countOrange(page.context().browser()!, await maskedShot(page));
  const title = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() ?? '');
  const what = await orangeThings(page);
  return { screen: s.name, path: s.path, size: size.name, mode, orange, title, what, shot };
}

const cases = SCREENS.flatMap((s) => SIZES.flatMap((size) => (['ok', 'down'] as const).map((mode) => ({ s, size, mode }))));

test.describe('every staff screen shows the brand orange above the fold (owner 17 Nov black+orange rule)', () => {
  test.skip(process.env.X2F_ORANGE_AUDIT === '1', 'the audit run writes the report instead');
  for (const { s, size, mode } of cases) {
    test(`${s.name} ${s.path} at ${size.name}, API ${mode}`, async ({ page }) => {
      const r = await look(page, s, size, mode);
      expect(r.orange, `${r.screen} (${r.path}, ${r.title}) shows no brand orange outside the logo`).toBeGreaterThanOrEqual(MIN_ORANGE);
    });
  }
});

test('staff orange audit report (X2F_ORANGE_AUDIT=1)', async ({ page }) => {
  test.skip(process.env.X2F_ORANGE_AUDIT !== '1', 'set X2F_ORANGE_AUDIT=1');
  test.setTimeout(600_000);
  const out = process.env.X2F_ORANGE_AUDIT_DIR ?? '/home/user/X2F/owner-review/orange-audit/';
  const all = process.env.X2F_ORANGE_AUDIT_SHOTS;
  mkdirSync(`${out}no-orange/`, { recursive: true });
  if (all) mkdirSync(all, { recursive: true });
  const rows = [];
  for (const { s, size, mode } of cases) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const { shot, ...r } = await look(page, s, size, mode);
    rows.push(r);
    const file = `staff_${s.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}-${size.name}-${mode}.png`;
    if (r.orange < MIN_ORANGE) writeFileSync(`${out}no-orange/${file}`, shot);
    if (all) writeFileSync(`${all}/${file}`, shot);
  }
  writeFileSync(`${out}staff-results.json`, JSON.stringify(rows, null, 2));
});
