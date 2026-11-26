// Spec 6.6 "Settings" and My security in a real browser. The owner changes the starter limits and
// the fee wallet's sweep (each tapped with a soft security key, Chromium's virtual authenticator, the
// challenge the stub answers being the honest `tapChallenge(intent, nonce)` the page checks before it
// asks the key), saves the links (no tap) and reads the staff pay owed; a moderator removes a login
// method with a tap, logs another session out and marks an alert seen from My security. The staff
// API is stubbed with page.route in the shapes of apps/api/src/staff/{settings,starterLimits,
// feeSweep,pay,account}.ts; their own tests cover the server side. No board draws these screens.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { STARTER_DEFAULTS, hasIssuedAt, stampIssuedAt, tapChallenge, type KeyTapIntent } from '@x2f/staff';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const ends = () => new Date(Date.now() + 8 * H).toISOString();
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: ['overview', 'disputes', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'settings'], sessionEndsAt: ends() };
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: ends() };
const COLD = `4${'B'.repeat(94)}`;
const KEY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';

async function softKey(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const id = randomBytes(16);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await cdp.send('WebAuthn.addCredential', {
    authenticatorId,
    credential: {
      credentialId: id.toString('base64'),
      isResidentCredential: false,
      rpId: 'localhost',
      privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      signCount: 0,
    },
  });
  return id.toString('base64url');
}

interface Stub {
  calls: { method: string; path: string; body: Record<string, unknown> }[];
  taps: KeyTapIntent[];
}

async function stub(page: Page, me: object, credId: string): Promise<Stub> {
  const s: Stub = { calls: [], taps: [] };
  let starter: Record<string, unknown> = { ...STARTER_DEFAULTS, updatedAt: null };
  let links: Record<string, unknown> = { moderatorContactUrl: null, communityMatrixUrl: null, communityTelegramUrl: null };
  let sweep: Record<string, unknown> = { thresholdAtomic: null, floatAtomic: null, coldAddress: null, on: false, walletWired: false, lastSweep: null };
  let methods = [
    { type: 'pgp', id: '11111111-1111-4111-8111-111111111111', label: 'PGP key …ABCD 1234', createdAt: '2026-10-02T09:00:00.000Z', lastUsedAt: null },
    { type: 'passkey', id: '33333333-3333-4333-8333-333333333333', label: 'Phone passkey', createdAt: '2026-10-02T09:02:00.000Z', lastUsedAt: null },
    { type: 'security-key', id: KEY_ID, label: 'YubiKey 5', createdAt: '2026-10-02T09:05:00.000Z', lastUsedAt: null },
  ];
  let sessions = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', deviceLabel: 'Chrome on Linux', site: 'staff', createdAt: new Date(Date.now() - H).toISOString(), lastSeenAt: new Date().toISOString(), current: true },
    { id: OTHER, deviceLabel: 'Safari on macOS', site: 'staff', createdAt: new Date(Date.now() - 30 * H).toISOString(), lastSeenAt: new Date(Date.now() - 3 * H).toISOString(), current: false },
  ];
  let alerts = [{ id: 'b1', kind: 'new-login', detail: { method: 'security-key', deviceLabel: 'Safari on macOS' }, createdAt: new Date(Date.now() - 30 * H).toISOString(), seenAt: null as string | null }];
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    s.calls.push({ method: req.method(), path, body });
    const key = `${req.method()} ${path}`;
    if (key === 'GET /staff/v1/me') return json(me)(route);
    if (key === 'GET /staff/v1/owner/alerts') return json({ items: [], unread: 0, next: null })(route);
    if (key === 'POST /staff/v1/taps/start') {
      const intent = body as unknown as KeyTapIntent;
      s.taps.push(intent);
      const nonce = randomBytes(16);
      const at = new Date();
      const challenge = Buffer.from(tapChallenge(stampIssuedAt(intent, at), nonce)).toString('base64url');
      return json({
        tapId: `tap-${s.taps.length}`,
        nonce: nonce.toString('hex'),
        issuedAt: hasIssuedAt(intent.kind) ? at.toISOString() : null,
        options: { challenge, rpId: 'localhost', allowCredentials: [{ id: credId, type: 'public-key' }], userVerification: 'discouraged', timeout: 60_000 },
      })(route);
    }
    if (/^POST \/staff\/v1\/taps\/[^/]+\/finish$/.test(key)) return json({ tapId: path.split('/')[4] })(route);
    if (key === 'GET /staff/v1/settings') return json({ largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48, ...links })(route);
    if (key === 'PUT /staff/v1/settings') {
      links = { ...links, ...body };
      return json({ largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48, ...links })(route);
    }
    if (key === 'GET /staff/v1/pay/settings') return json({ modDisputeUsdCents: null, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null })(route);
    if (key === 'GET /staff/v1/starter-limits') return json(starter)(route);
    if (key === 'PUT /staff/v1/starter-limits') {
      if (typeof body.tapId !== 'string') return json({ error: 'tap-invalid' }, 403)(route);
      const { tapId: _t, ...rest } = body;
      starter = { ...rest, updatedAt: new Date(Date.UTC(2026, 10, 26, 10, 0)).toISOString() };
      return json(starter)(route);
    }
    if (key === 'GET /staff/v1/fee-sweep') return json(sweep)(route);
    if (key === 'PUT /staff/v1/fee-sweep') {
      if (typeof body.tapId !== 'string') return json({ error: 'tap-invalid' }, 403)(route);
      const { tapId: _t, ...rest } = body;
      sweep = { ...sweep, ...rest, on: rest.thresholdAtomic !== null };
      return json(sweep)(route);
    }
    if (key === 'GET /staff/v1/pay/staff') {
      return json({ members: [{ staffId: 's-1', displayName: 'sarah.v', role: 'senior', switchedOff: false, unpaidUsdCents: '4500', unpaidAtomic: '0', owed: false }] })(route);
    }
    if (key === 'GET /staff/v1/account/methods') return json(methods)(route);
    if (key === 'GET /staff/v1/account/sessions') return json(sessions)(route);
    if (key === 'GET /staff/v1/account/alerts') return json(alerts)(route);
    const del = /^DELETE \/staff\/v1\/account\/methods\/([^/]+)\/([^/]+)$/.exec(key);
    if (del) {
      if (typeof body.tapId !== 'string') return json({ error: 'tap-invalid' }, 403)(route);
      methods = methods.filter((m) => m.id !== del[2]);
      return route.fulfill({ status: 204 });
    }
    const end = /^DELETE \/staff\/v1\/account\/sessions\/([^/]+)$/.exec(key);
    if (end) {
      sessions = sessions.filter((x) => x.id !== end[1]);
      return route.fulfill({ status: 204 });
    }
    const seen = /^POST \/staff\/v1\/account\/alerts\/([^/]+)\/seen$/.exec(key);
    if (seen) {
      alerts = alerts.map((a) => (a.id === seen[1] ? { ...a, seenAt: new Date().toISOString() } : a));
      return route.fulfill({ status: 204 });
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return s;
}

test('Settings: the starter limits saved with a soft-key tap of all seven numbers', async ({ page }) => {
  const s = await stub(page, OWNER, await softKey(page));
  await page.goto('/settings');
  const card = page.getByRole('region', { name: 'Starter limits' });
  await expect(card.getByRole('textbox', { name: 'Starter: largest trade' })).toHaveValue('200');
  const save = card.getByRole('button', { name: 'Save starter limits' });
  await expect(save).toBeDisabled();
  await card.getByRole('textbox', { name: 'Building: largest trade' }).fill('150');
  await expect(card.locator('[data-part="starter-limits-invalid"]')).toContainText("Building's largest trade (at least Starter's)");
  await expect(save).toBeDisabled();
  await card.getByRole('textbox', { name: 'Building: largest trade' }).fill('1500');
  await save.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tap security key' }).click();
  await expect(card.locator('[data-part="starter-limits-saved"]')).toBeVisible();
  await expect(card.locator('[data-part="starter-limits-updated"]')).toHaveText('Last changed 2026-11-26 10:00 UTC');
  const next = { ...STARTER_DEFAULTS, buildingCapUsd: 1500 };
  expect(s.taps).toEqual([{ kind: 'starter-limits', ...next }]);
  expect(s.calls.find((c) => c.method === 'PUT' && c.path === '/staff/v1/starter-limits')?.body).toEqual({ ...next, tapId: 'tap-1' });
  await expect(save).toBeDisabled();
});

test('Settings: links save without a tap; the fee sweep is turned on with a tap; staff pay owed is listed', async ({ page }) => {
  const s = await stub(page, OWNER, await softKey(page));
  await page.goto('/settings');
  const links = page.getByRole('region', { name: 'Contact and community links' });
  await links.getByRole('textbox', { name: 'Moderator contact' }).fill('https://discord.gg/x2f');
  await expect(links.locator('[data-part="links-invalid"]')).toContainText('Moderator contact (a matrix.to or t.me link)');
  await expect(links.getByRole('button', { name: 'Save links' })).toBeDisabled();
  await links.getByRole('textbox', { name: 'Moderator contact' }).fill('https://matrix.to/#/@moderators:x2f.example');
  await links.getByRole('textbox', { name: 'Community on Telegram' }).fill('https://t.me/x2f');
  await links.getByRole('button', { name: 'Save links' }).click();
  await expect(links.locator('[data-part="links-saved"]')).toBeVisible();
  expect(s.calls.filter((c) => c.method === 'PUT' && c.path === '/staff/v1/settings').map((c) => c.body)).toEqual([
    { moderatorContactUrl: 'https://matrix.to/#/@moderators:x2f.example', communityTelegramUrl: 'https://t.me/x2f' },
  ]);
  expect(s.taps).toEqual([]);

  const fee = page.getByRole('region', { name: 'Fee wallet' });
  await expect(fee.locator('[data-part="fee-sweep-state"]')).toHaveText('The sweep is off.');
  await fee.getByRole('textbox', { name: 'Move fees at' }).fill('10');
  await fee.getByRole('textbox', { name: 'Keep in the fee wallet' }).fill('1.25');
  await fee.getByRole('textbox', { name: 'Your offline wallet address' }).fill(COLD);
  await fee.getByRole('button', { name: 'Save fee wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tap security key' }).click();
  await expect(fee.locator('[data-part="fee-sweep-state"]')).toHaveText('The sweep is on.');
  expect(s.taps).toEqual([{ kind: 'fee-sweep', thresholdAtomic: '10000000000000', floatAtomic: '1250000000000', coldAddress: COLD }]);

  const pay = page.getByRole('table', { name: 'Pay owed per person' });
  await expect(pay.locator('tbody tr')).toHaveCount(1);
  await expect(pay.locator('tbody tr').first()).toContainText('$45.00');
  // The page keeps its one primary action, "Save settings".
  await expect(page.locator('[data-screen="staff-settings"] [data-primary]')).toHaveCount(1);
});

test('My security: a moderator removes a key with a tap, logs another session out and marks an alert seen', async ({ page }) => {
  const s = await stub(page, MOD, await softKey(page));
  await page.goto('/disputes');
  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'My security' }).click();
  await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My security');

  await page.getByRole('button', { name: 'Remove Security key YubiKey 5' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tap security key' }).click();
  await expect(page.locator('[data-part="security-note"]')).toHaveText('Removed. Your other sessions were logged out.');
  expect(s.taps).toEqual([{ kind: 'remove-method', methodType: 'security-key', methodId: KEY_ID }]);
  await expect(page.locator('[data-part="method"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Log out Safari on macOS' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.locator('[data-part="session"]')).toHaveCount(1);
  expect(s.calls.filter((c) => c.method === 'DELETE' && c.path.startsWith('/staff/v1/account/sessions/')).map((c) => c.path)).toEqual([`/staff/v1/account/sessions/${OTHER}`]);

  await expect(page.locator('[data-part="alert-new"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mark new login as seen' }).click();
  await expect(page.locator('[data-part="alert-new"]')).toHaveCount(0);
});
