// Plan 4 Task 26: recommended account limits in a real browser. A moderator recommends limits from
// a case (ModCase's Recommend limits card); a senior moderator approves at /disputes/limits with a
// soft security key (Chromium's virtual authenticator), the challenge the stub answers being the
// honest `tapChallenge(intent, nonce)` the page checks before it asks the key. The staff API is
// stubbed with page.route in the shapes of apps/api/src/staff/limits.ts and disputes/staffRoutes.ts;
// apps/api/test/staff/limits.test.ts covers the server side. No board draws either screen.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { tapChallenge, type KeyTapIntent } from '@x2f/staff';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const ends = () => new Date(Date.now() + 8 * H).toISOString();
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: ends() };
const SENIOR = { displayName: 'sarah.v', role: 'senior', nav: ['disputes', 'training', 'log', 'feedback'], sessionEndsAt: ends() };
const CODE = '7RWD3MXEKQ84HN2T';
const REASON = 'Third dispute this month as a buyer who marks paid and never pays.';
const REC = '0d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d';
const ACCT = '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';

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

const trader = (name: string) => ({
  displayName: name, completedTrades: 30, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: 100, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [],
});
const kase = () => ({
  code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
  afterRefund: false, openedAt: new Date(Date.now() - 2 * H).toISOString(), replyDueAt: new Date(Date.now() + 2 * H).toISOString(),
  rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '330.00', overLimit: false, limitUsd: 1000,
  assignee: 'dmitri_k', assignedToYou: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: trader('harbor_lin'), seller: trader('quietfox') },
  escrow: { state: 'escrow-secured', amountAtomic: '1000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '33000', confirmations: 10, takenAt: new Date(Date.now() - 3 * H).toISOString() },
  ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
  freezes: { buyer: false, seller: false },
});
const rec = () => ({
  id: REC, accountId: ACCT, displayName: 'harbor_lin', capUsd: 300, stage: null, reason: REASON, code: CODE, recommendedBy: 'dmitri_k',
  mine: false, createdAt: new Date(Date.now() - H).toISOString(), currentStage: 'graduated', currentCapUsdCents: null,
});

interface Stub {
  calls: { method: string; path: string; body: Record<string, unknown> }[];
  taps: KeyTapIntent[];
}

async function stub(page: Page, me: typeof MOD, credId: string | null): Promise<Stub> {
  const s: Stub = { calls: [], taps: [] };
  let decided = false;
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    s.calls.push({ method: req.method(), path, body });
    const key = `${req.method()} ${path}`;
    if (key === 'GET /staff/v1/me') return json(me)(route);
    if (key === `GET /staff/v1/disputes/${CODE}`) return json(kase())(route);
    if (key === `POST /staff/v1/disputes/${CODE}/limit-recommendations`) return json({ id: REC }, 201)(route);
    if (key === 'GET /staff/v1/limit-recommendations') return json({ recommendations: decided ? [] : [rec()] })(route);
    if (key === 'POST /staff/v1/taps/start' && credId !== null) {
      const intent = body as unknown as KeyTapIntent;
      s.taps.push(intent);
      const nonce = randomBytes(16);
      const challenge = Buffer.from(tapChallenge(intent, nonce)).toString('base64url');
      return json({
        tapId: `tap-${s.taps.length}`, nonce: nonce.toString('hex'), issuedAt: null,
        options: { challenge, rpId: 'localhost', allowCredentials: [{ id: credId, type: 'public-key' }], userVerification: 'discouraged', timeout: 60_000 },
      })(route);
    }
    if (/^POST \/staff\/v1\/taps\/[^/]+\/finish$/.test(key)) return json({ tapId: path.split('/')[4] })(route);
    if (key === `POST /staff/v1/accounts/${ACCT}/limit-recommendations/${REC}/decide`) {
      if (body.tapId !== 'tap-1') return json({ error: 'tap-invalid' }, 403)(route);
      decided = true;
      return json({ status: body.approve === true ? 'approved' : 'declined' })(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return s;
}

function noErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test('a moderator recommends a cap from the case', async ({ page }) => {
  const errors = noErrors(page);
  const s = await stub(page, MOD, null);
  await page.goto(`/disputes/${CODE}`);
  const card = page.locator('[data-part="limits"]');
  await expect(card).toContainText('A senior moderator or the owner decides');
  const send = card.getByRole('button', { name: 'Recommend limits' });
  await expect(send).toBeDisabled();
  await card.getByText('harbor_lin').click();
  await card.getByText('A cap per trade').click();
  await card.getByLabel('Largest trade (USD)').fill('300');
  await card.getByLabel(/Reason \(staff only/).fill(REASON);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(card).toContainText('Sent to a senior moderator or the owner to decide.');
  expect(s.calls.find((c) => c.method === 'POST' && c.path.endsWith('/limit-recommendations'))!.body).toEqual({ side: 'buyer', capUsd: 300, reason: REASON });
  expect(errors).toEqual([]);
});

test('a senior moderator approves with a security-key tap bound to exactly this decision', async ({ page }) => {
  const errors = noErrors(page);
  const credId = await softKey(page);
  const s = await stub(page, SENIOR, credId);
  await page.goto('/disputes');
  await page.getByRole('link', { name: 'Recommended limits' }).click();
  await expect(page.locator('[data-screen="limit-recommendations"]')).toBeVisible();
  const item = page.locator('[data-part="limit-rec"]');
  await expect(item).toContainText('harbor_lin: Limit to $300 per trade');
  await expect(item).toContainText(REASON);
  await item.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Tap security key' }).click();
  await expect(page.locator('[data-part="limits-empty"]')).toBeVisible();
  expect(s.taps).toEqual([{ kind: 'account-limit', recId: REC, accountId: ACCT, approve: true, capUsd: 300, stage: null }]);
  expect(s.calls.find((c) => c.path.endsWith('/decide'))!.body).toEqual({ approve: true, tapId: 'tap-1' });
  expect(errors).toEqual([]);
});
