// DESIGN: owner 17 Nov black+orange rule. "Our theme really is black and orange. I do not think there
// should be a single page that doesn't have black and orange on it... the orange is like a feature
// wall." Every screen of the web app, at 1366x768 and 390x844, with the API answering (the screen's
// usual or empty state) and with the API down (its error state), must show the brand orange
// (--x2f-monero, #ff6600, src/theme/tokens.css) somewhere above the fold.
//
// The check reads pixels, not styles: a screenshot of the viewport, decoded on a canvas in a blank
// page, counts the pixels of the brand orange's hue (anti-aliased edges included). So it sees an
// orange button, an orange label or icon alike. Lead, 17 Nov: the logo's orange dot does NOT
// count: every brand mark (orange.ts BRAND_MARK) is masked in black before counting, so the
// orange must be an accent on the screen itself.
//
// With X2F_ORANGE_AUDIT=1 the audit test also writes owner-review/orange-audit/ (the results JSON,
// summarised in its README.md, and a screenshot of each screen with no
// orange) to X2F_ORANGE_AUDIT_DIR (default: the main checkout's owner-review/orange-audit/). With
// X2F_ORANGE_AUDIT_SHOTS=<dir> it also writes every screen's (unmasked) screenshot there.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { CATALOG } from './browse-stub.js';
import { MIN_ORANGE, countOrange, maskedShot, orangeThings } from './orange.js';
import { INSIDE } from './session.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ROWS = CATALOG.map((m) => ({ id: m.id, name: m.name, group: m.group, giftCard: m.giftCard === true, offers: 0, bestRate: null })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
const ME = {
  displayName: 'viewer_1',
  needsLoginName: false,
  ...INSIDE,
  accountType: 'vendor',
  holdUntil: null,
  methods: ['password'],
  hasBackup: true,
  suggestions: [],
  logoutTimer: { idleHours: 12, adjustable: true },
  member: null,
};
const SITE_OFF = { banner: null, tradingPaused: false, maintenance: null, plannedMaintenance: null };

type Mode = 'ok' | 'down';
interface Screen {
  name: string;
  path: string;
  door?: boolean;
  /** The screen only exists in one mode (the maintenance screen replaces the app). */
  only?: Mode;
  site?: unknown;
}

/** Every route of src/App.tsx (and the setup flow's entry), signed in behind the door or signed out at it. */
export const SCREENS: readonly Screen[] = [
  { name: 'Landing', path: '/', door: true },
  { name: 'Login', path: '/login', door: true },
  { name: 'Login with backup', path: '/login/backup', door: true },
  { name: 'Session length', path: '/session-length', door: true },
  { name: 'Terms', path: '/terms', door: true },
  { name: 'Sign up (first step)', path: '/setup', door: true },
  { name: 'Team join', path: '/team/join', door: true },
  { name: 'Help topic', path: '/help/recovery', door: true },
  { name: 'Maintenance', path: '/', door: true, only: 'ok', site: { ...SITE_OFF, maintenance: { kind: 'emergency', message: null, since: null, backBy: null } } },
  { name: 'Sell (methods)', path: '/sell' },
  { name: 'Buy (methods)', path: '/buy' },
  { name: 'Welcome', path: '/welcome' },
  { name: 'Help', path: '/help' },
  { name: 'My offers', path: '/profile/offers' },
  { name: 'Post offer', path: '/post' },
  { name: 'Offers for a method', path: '/sell/ZELLE' },
  { name: 'Offer quote', path: '/sell/ZELLE/of_1' },
  { name: 'My trades', path: '/trades' },
  { name: 'Trade room', path: '/trade/AB12CD' },
  { name: 'Open a dispute', path: '/trade/AB12CD/dispute' },
  { name: 'Wallets', path: '/wallets' },
  { name: 'Security', path: '/settings/security' },
  { name: 'Account changes', path: '/settings/changes' },
  { name: 'Devices', path: '/settings/devices' },
  { name: 'Blocked', path: '/settings/blocked' },
  { name: 'Jabber', path: '/settings/jabber' },
  { name: 'Jabber events', path: '/settings/jabber/events' },
  { name: 'Team', path: '/settings/team' },
  { name: 'Idle reminder', path: '/settings/idle-reminder' },
  { name: 'Account type', path: '/settings/account-type' },
  { name: 'News', path: '/news' },
  { name: 'Feedback', path: '/feedback' },
  { name: 'Account frozen', path: '/account/frozen' },
  // The screens main added since 17 Nov (each must pass the same rule).
  { name: 'My profile', path: '/profile' },
  { name: 'Trader profile', path: '/u/viewer_2' },
  { name: 'Review dispute', path: '/profile/reviews/rv_1/dispute' },
  { name: 'Alerts', path: '/settings/alerts' },
  { name: 'Account', path: '/settings/account' },
  { name: 'Settings help', path: '/settings/help' },
  { name: 'Liens', path: '/settings/liens' },
  { name: 'Badges', path: '/settings/badges' },
  { name: 'Record export', path: '/settings/record' },
  { name: 'Public record', path: '/u/viewer_2/record' },
  { name: 'Tickets', path: '/support/tickets' },
  { name: 'New ticket', path: '/support/tickets/new' },
  { name: 'Ticket thread', path: '/support/tickets/tk_1' },
  { name: 'Account banned', path: '/account/banned' },
  { name: 'Preferences', path: '/settings/preferences' },
  { name: 'Privacy', path: '/settings/privacy' },
  { name: 'Team log', path: '/settings/team/log' },
  { name: 'Compromised account', path: '/login/compromised', door: true },
];

export const SIZES = [
  { name: '1366', width: 1366, height: 768 },
  { name: '390', width: 390, height: 844 },
] as const;

/** 'ok': the usual answers, with empty lists; anything else 404. 'down': every API call but the session fails 503. */
async function stub(page: Page, s: Screen, mode: Mode): Promise<void> {
  await page.route('**/v1/**', (r) => {
    const url = new URL(r.request().url());
    const p = url.pathname;
    if (p === '/v1/site') return json(s.site ?? SITE_OFF)(r);
    if (p === '/v1/account/me') return s.door ? json({ error: 'not-authenticated' }, 401)(r) : json(ME)(r);
    if (p === '/v1/events') return r.abort();
    if (mode === 'down') return json({ error: 'internal' }, 503)(r);
    if (p === '/v1/methods') return json({ live: [], all: ROWS })(r);
    if (p === '/v1/price') return json({ currency: url.searchParams.get('currency') ?? 'USD', centsPerXmr: '32990', usdCentsPerXmr: '32990', exponent: 2, at: '2026-10-24T12:00:00.000Z' })(r);
    if (p === '/v1/offers' || p === '/v1/account/offers') return json([])(r);
    if (p === '/v1/trades') return json({ trades: [], next: null })(r);
    if (p === '/v1/news') return json({ items: [], next: null })(r);
    return json({ error: 'not-found' }, 404)(r);
  });
}

export interface Result {
  screen: string;
  path: string;
  size: string;
  mode: Mode;
  /** Brand-orange pixels above the fold, every brand mark (logo, Landing board, Welcome mark) masked. */
  orange: number;
  title: string;
  alert: string;
  /** What draws the orange (orange.ts orangeThings). */
  what: string[];
  shot: Buffer;
}

async function look(page: Page, browser: Browser, s: Screen, size: (typeof SIZES)[number], mode: Mode): Promise<Result> {
  await page.setViewportSize({ width: size.width, height: size.height });
  await stub(page, s, mode);
  await page.goto(s.path);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.mouse.move(0, 0);
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const orange = await countOrange(browser, await maskedShot(page));
  const info = await page.evaluate(() => {
    const vis = (el: Element) => (el as HTMLElement).checkVisibility();
    const h1 = Array.from(document.querySelectorAll('h1')).find(vis)?.textContent?.trim() ?? '';
    const alert = Array.from(document.querySelectorAll('[role="alert"]')).find(vis)?.textContent?.trim().slice(0, 80) ?? '';
    return { h1, alert, path: location.pathname };
  });
  const what = await orangeThings(page);
  return { what, screen: s.name, path: `${s.path}${info.path !== s.path ? ` -> ${info.path}` : ''}`, size: size.name, mode, orange, title: info.h1, alert: info.alert, shot };
}

const cases = SCREENS.flatMap((s) => SIZES.flatMap((size) => (['ok', 'down'] as const).filter((m) => s.only === undefined || s.only === m).map((mode) => ({ s, size, mode }))));

test.describe('every screen shows the brand orange above the fold (owner 17 Nov black+orange rule)', () => {
  test.skip(process.env.X2F_ORANGE_AUDIT === '1', 'the audit run writes the report instead');
  for (const { s, size, mode } of cases) {
    test(`${s.name} ${s.path} at ${size.name}, API ${mode}`, async ({ page, browser }) => {
      const r = await look(page, browser, s, size, mode);
      expect(r.orange, `${r.screen} (${r.path}, ${r.title || 'no h1'}${r.alert ? `, alert "${r.alert}"` : ''}) shows no brand orange outside the logo`).toBeGreaterThanOrEqual(MIN_ORANGE);
    });
  }
});

test('orange audit report (X2F_ORANGE_AUDIT=1)', async ({ page, browser }) => {
  test.skip(process.env.X2F_ORANGE_AUDIT !== '1', 'set X2F_ORANGE_AUDIT=1 to write owner-review/orange-audit/');
  test.setTimeout(600_000);
  const out = process.env.X2F_ORANGE_AUDIT_DIR ?? '/home/user/X2F/owner-review/orange-audit/';
  const all = process.env.X2F_ORANGE_AUDIT_SHOTS;
  mkdirSync(`${out}no-orange/`, { recursive: true });
  if (all) mkdirSync(all, { recursive: true });
  const rows: Omit<Result, 'shot'>[] = [];
  for (const { s, size, mode } of cases) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const { shot, ...r } = await look(page, browser, s, size, mode);
    rows.push(r);
    const file = `${s.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}${s.only ? '-maintenance' : ''}-${size.name}-${mode}.png`;
    if (r.orange < MIN_ORANGE) writeFileSync(`${out}no-orange/${file}`, shot);
    if (all) writeFileSync(`${all}/${file}`, shot);
  }
  writeFileSync(`${out}${process.env.X2F_ORANGE_AUDIT_NAME ?? 'results'}.json`, JSON.stringify(rows, null, 2));
});
