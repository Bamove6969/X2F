// Plan 4 Task 20: the owner's Moderator performance page in a real browser, checked with the
// parity harness against board StaffPerformance at its size (1280x1400) with the figures masked,
// dmitri_k's chart open as the board draws it. The staff API is stubbed with page.route in the
// shapes of apps/api/src/staff/performance.ts, filled with the board's own example data. Also:
// hovering a bar reads out that week, "Show as table" lists the 8 weeks, and the page loads under
// STAFF_CSP with no violation.
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectParity } from '../../web/e2e/parity.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const NAV = ['overview', 'disputes', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'settings'];
const ME = { tradeTag: 'lumen.k', role: 'owner', nav: NAV, sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };

const WEEKS = ['Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12'];
/** The board's example data (StaffPerformance's renderVals). */
const BOARD = {
  'sarah.v': { id: '11111111-1111-4111-8111-111111111111', role: 'senior', cases: [4, 5, 6, 5, 4, 6, 5, 6], reply: [42, 35, 40, 30, 45, 38, 36, 33], first: 38, ruling: 190, over: 0, within: 96 },
  dmitri_k: { id: '22222222-2222-4222-8222-222222222222', role: 'mod', cases: [1, 2, 2, 3, 2, 3, 2, 2], reply: [95, 130, 150, 90, 160, 140, 100, 120], first: 112, ruling: 400, over: 3, within: 82 },
  'lumen.k': { id: '33333333-3333-4333-8333-333333333333', role: 'owner', cases: [1, 1, 2, 1, 1, 1, 1, 1], reply: [20, 25, 18, 30, 22, 19, 24, 21], first: 22, ruling: 65, over: 0, within: 100 },
} as const;

const figures = (b: (typeof BOARD)[keyof typeof BOARD]) => {
  const cases = b.cases.reduce((x, y) => x + y, 0);
  return {
    cases, firstReplyMin: b.first, rulingMin: b.ruling, overturned: b.over, withinDeadlinePct: b.within, open: 1, payableCases: cases - b.over,
    settledWithinGoalPct: null, settledWithinDeadlinePct: null, appeals: 0, appealsWithinGoalPct: null,
  };
};

async function stub(page: Page): Promise<void> {
  await page.route('**/staff/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/staff/v1/me') return json(ME)(route);
    if (path === '/staff/v1/performance') {
      return json({ period: '30d', firstResponseH: 4, people: Object.entries(BOARD).map(([name, b]) => ({ id: b.id, name, role: b.role, ...figures(b) })) })(route);
    }
    const m = /^\/staff\/v1\/performance\/([^/]+)\/weeks$/.exec(path);
    const hit = m ? Object.entries(BOARD).find(([, b]) => b.id === m[1]) : undefined;
    if (hit) {
      const [name, b] = hit;
      return json({
        id: b.id, name, role: b.role, firstResponseH: 4, from: '2026-08-24T00:00:00.000Z', summary: figures(b),
        weeks: WEEKS.map((weekOf, i) => ({ weekOf, start: new Date(Date.UTC(2026, 7, 24 + 7 * i)).toISOString(), cases: b.cases[i], firstReplyMin: b.reply[i] })),
      })(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
}

async function openDmitri(page: Page): Promise<void> {
  await stub(page);
  await page.goto('/performance');
  await expect(page.locator('[data-screen="staff-performance"]')).toBeVisible();
  await expect(page.locator('[data-part="performance-row"]')).toHaveCount(3);
  await page.locator('[data-part="performance-row"]', { hasText: 'dmitri_k' }).getByRole('button', { name: 'Show chart' }).click();
  await expect(page.locator('[data-part="performance-panel"]')).toBeVisible();
}

/**
 * Board copy the page does not show: the coaching paragraph, which Task 20 names as example copy
 * that is not rendered ("The board's coaching paragraph is example copy and is not rendered").
 */
const KNOWN = [/^board copy missing: "dmitri_k had 3 rulings overturned on appeal this month.*"$/];

test('StaffPerformance parity at 1280x1400 with the figures masked, dmitri_k\'s chart open; no CSP violation', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  await openDmitri(page);
  await page.locator('[data-part="week-bar"]').nth(2).hover();
  await page.getByRole('button', { name: 'Show as table' }).click();
  await page.getByRole('button', { name: 'Show as charts' }).click();
  // The page itself, its charts included, sets no inline style. Checked before the parity harness,
  // which parses the board (inline styles throughout) inside the page and is refused by the CSP.
  expect(violations).toEqual([]);
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  let failures: string[] = [];
  try {
    await expectParity(page, 'StaffPerformance', {
      primary: false,
      masks: [page.locator('.x2f-perf__table td[data-mono]'), page.locator('.x2f-perf__totals dd'), page.locator('.x2f-perf-chart__readout')],
    });
  } catch (e) {
    failures = String((e as Error).message).split('\n  - ').slice(1).map((l) => l.trim());
  }
  expect(failures.filter((f) => !KNOWN.some((k) => k.test(f)))).toEqual([]);
  // Overturned on appeal is amber only where it is above 0 (dmitri_k's 3 of 17).
  await expect(page.locator('[data-part="overturned"][data-tone="caution"]')).toHaveText(['3 of 17']);
});

test('hovering a bar shows that week\'s cases, and a dot that week\'s typical first reply', async ({ page }) => {
  await openDmitri(page);
  await page.locator('[data-part="week-bar"]').nth(3).hover();
  await expect(page.locator('[data-part="cases-readout"]')).toHaveText('Week of Sep 14: 3 cases');
  await page.locator('[data-part="week-bar"]').nth(0).hover();
  await expect(page.locator('[data-part="cases-readout"]')).toHaveText('Week of Aug 24: 1 case');
  await page.locator('[data-part="week-dot"]').nth(1).hover();
  await expect(page.locator('[data-part="reply-readout"]')).toHaveText('Week of Aug 31: typical first reply 2 h 10 min');
});

test('"Show as table" shows the 8 weeks as rows', async ({ page }) => {
  await openDmitri(page);
  await page.getByRole('button', { name: 'Show as table' }).click();
  const rows = page.locator('[data-part="weeks-table"] tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toHaveText(/Aug 24\s*1\s*1 h 35 min/);
  await page.getByRole('button', { name: 'Show as charts' }).click();
  await expect(page.locator('[data-part="cases-chart"]')).toBeVisible();
});
