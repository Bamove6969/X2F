// Team members (Plan 2 Task 18; spec 6.7, R44): the owner's Team screen, the join page an invite
// link opens, a member's login, what a member's device may and may not do, and the activity log.
// The API is stubbed per test with page.route in the shapes of apps/api/src/routes/team.ts (the
// server's own rules, races and refusals are tested in apps/api/test/team.test.ts); WebAuthn runs
// against a CDP virtual authenticator, on `localhost` (WebAuthn refuses an IP address).
//
// No Claude Design board yet (NEEDS_DESIGN_TEAM): no parity; the phone layout (expectPhoneLayout)
// at PHONE_VIEWPORTS only. The words pass copy-lint statically (apps/web/test/copy-lint.test.ts).
import { expect, test, type Browser, type CDPSession, type Page, type Request, type Route } from '@playwright/test';
import { sellerView } from './refundViews.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const LOCAL = `http://localhost:${process.env.X2F_E2E_PORT ?? 4317}`;
/** A 32-byte invite code, base64url (43 characters), as the API makes them. */
const CODE = 'Tq9vX2fInviteCodeAAAAAAAAAAAAAAAAAAAAAAA_-Z';
const PGP_MESSAGE = '-----BEGIN PGP MESSAGE-----\n\nwcBMA0team\n-----END PGP MESSAGE-----\n';
const FAKE_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDMEteam\n-----END PGP PUBLIC KEY BLOCK-----\n';
const FAKE_KEY_2 = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDMEsecond\n-----END PGP PUBLIC KEY BLOCK-----\n';
const LATER = '2099-01-01T00:00:00.000Z';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const OWNER_ME = { displayName: 'Calcium', kind: 'trader', level: 'full', termsCurrent: true, methods: ['password'], hasBackup: true, suggestions: [], member: null };
const memberMe = (roles: string[]) => ({ ...OWNER_ME, methods: ['pgp', 'security-key'], member: { name: 'Aurora', roles } });

type Member = { id: string; displayName: string; roles: string[]; status: string; inviteExpiresAt: string | null; joinedAt: string | null; createdAt: string };
const member = (id: string, displayName: string, roles: string[], status = 'active'): Member => ({
  id, displayName, roles, status, inviteExpiresAt: status === 'active' ? null : LATER, joinedAt: status === 'active' ? '2026-10-29T10:00:00.000Z' : null, createdAt: '2026-10-29T09:00:00.000Z',
});

/** The owner's side of the API: me, the team, its log, invites, roles, removal and the password confirm. */
async function ownerApi(page: Page, s: { members: Member[]; audit?: unknown[]; inviteAnswer?: (body: Record<string, unknown>) => { status: number; body: unknown } }) {
  const seen = { confirms: [] as Record<string, unknown>[], invites: [] as Record<string, unknown>[], audits: [] as string[], patches: [] as unknown[], deletes: [] as string[] };
  await page.route('**/v1/account/me', json(OWNER_ME));
  await page.route('**/v1/confirm/password', (r) => {
    seen.confirms.push(r.request().postDataJSON() as Record<string, unknown>);
    return json({ confirmToken: `tok-${seen.confirms.length}` })(r);
  });
  await page.route('**/v1/team', (r) => json({ members: s.members, max: 3 })(r));
  await page.route('**/v1/team/audit*', (r) => {
    const url = new URL(r.request().url());
    seen.audits.push(url.search);
    const who = url.searchParams.get('member');
    const rows = (s.audit ?? []) as { memberId: string }[];
    return json(who === null ? rows : rows.filter((e) => e.memberId === who))(r);
  });
  await page.route('**/v1/team/invites', (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    seen.invites.push(body);
    if (body.confirmToken === undefined) return json({ error: 'confirm-required', action: 'team-invite' }, 403)(r);
    const a = s.inviteAnswer?.(body);
    if (a) return json(a.body, a.status)(r);
    s.members = [...s.members, member(`m${s.members.length + 1}`, String(body.displayName), body.roles as string[], 'invited')];
    return json({ id: `m${s.members.length}`, invite: CODE, expiresAt: LATER }, 201)(r);
  });
  await page.route('**/v1/team/members/*', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop()!;
    const body = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const method = r.request().method();
    if (body.confirmToken === undefined) return json({ error: 'confirm-required', action: method === 'PATCH' ? 'team-roles' : 'team-remove' }, 403)(r);
    if (method === 'PATCH') {
      seen.patches.push(body);
      s.members = s.members.map((m) => (m.id === id ? { ...m, roles: body.roles as string[] } : m));
      return json(s.members.find((m) => m.id === id))(r);
    }
    seen.deletes.push(id);
    s.members = s.members.filter((m) => m.id !== id);
    return r.fulfill({ status: 204 });
  });
  return seen;
}

async function confirmWithPassword(page: Page, says: string | RegExp): Promise<void> {
  const sheet = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(says);
  await sheet.getByLabel('Your password').fill('Correct-Horse-9!');
  await sheet.getByRole('button', { name: 'Confirm' }).click();
}

/** A CDP virtual authenticator: `internal` makes passkeys, `usb` security keys. */
async function authenticator(page: Page, transport: 'internal' | 'usb'): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport, hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return client;
}

/** Every request a page makes: the invite code must never be in a URL or a Referer (review area 2). */
function watchRequests(page: Page): Request[] {
  const all: Request[] = [];
  page.on('request', (r) => void all.push(r));
  return all;
}

async function expectCodeNeverSent(all: Request[]): Promise<void> {
  expect(all.length).toBeGreaterThan(0);
  for (const r of all) {
    expect(r.url(), 'a request URL carries the invite code').not.toContain(CODE);
    const referer = (await r.allHeaders())['referer'] ?? '';
    expect(referer, `the Referer of ${r.url()} carries the invite code`).not.toContain(CODE);
  }
}

// ---- 1. The owner invites ----------------------------------------------------------------------

for (const viewport of PHONE_VIEWPORTS) {
  test(`the owner invites at ${viewport}: confirm names the member, the code is only after #, copy works`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const seen = await ownerApi(page, { members: [] });
    await page.goto('/settings/team');
    await setPhone(page, viewport);
    await expect(page.locator('[data-part="team-count"]')).toHaveText('0 of 3 members');
    await page.getByLabel('Their name in trade chats').fill('Aurora.K');
    await page.locator('input[data-role="offers"]').uncheck();
    await page.locator('input[data-role="trades"]').check();
    await expectPhoneLayout(page);
    await page.locator('[data-part="invite"]').click();
    // Review M9(a): the confirm is for this one named member and these roles.
    await confirmWithPassword(page, 'invite Aurora.K as a team member (Trades)');
    const url = page.locator('[data-part="invite-url"]');
    await expect(url).toHaveText(`${new URL(page.url()).origin}/team/join#${CODE}`);
    const [before] = (await url.innerText()).split('#');
    expect(before).not.toContain(CODE);
    expect(seen.confirms[0]!.action).toEqual({ kind: 'team-invite', name: 'Aurora.K', roles: 'trades' });
    expect(seen.invites.at(-1)).toEqual({ displayName: 'Aurora.K', roles: ['trades'], confirmToken: 'tok-1' });
    await page.locator('[data-part="copy-invite"]').click();
    await expect(page.locator('[data-part="copy-invite"]')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/team/join#${CODE}`);
    await expect(page.locator('[data-member="Aurora.K"]')).toHaveAttribute('data-status', 'invited');
    await expectPhoneLayout(page);
  });
}

test('a 4th member is refused through CantDoThat (too-many-members), from the server and from a full list', async ({ page }) => {
  await ownerApi(page, {
    members: [member('m1', 'Aurora', ['trades']), member('m2', 'Basil', ['offers'])],
    inviteAnswer: () => ({ status: 409, body: { error: 'too-many-members', max: 3 } }),
  });
  await page.goto('/settings/team');
  await page.getByLabel('Their name in trade chats').fill('Cedric');
  await page.locator('[data-part="invite"]').click();
  await confirmWithPassword(page, 'invite Cedric as a team member (Offers)');
  const popup = page.locator('[data-part="cant-do-that"]');
  await expect(popup).toHaveAttribute('data-from', 'too-many-members');
  await expect(popup).toContainText('A team can have at most 3 members.');
  await expectPhoneLayout(page);
});

// ---- 2 and 3. Joining in a fresh browser ---------------------------------------------------------

/** The member's side of the API for a fresh browser; `finish` answers join/finish (a race test makes one lose). */
async function joinApi(page: Page, o: { invite?: { status: number; body: unknown }; finish?: () => { status: number; body: unknown } } = {}) {
  const seen = { bodies: {} as Record<string, unknown[]> };
  const record = (r: Route) => {
    const path = new URL(r.request().url()).pathname;
    (seen.bodies[path] ??= []).push(r.request().postDataJSON());
  };
  let signedIn = false;
  await page.route('**/v1/account/me', (r) => (signedIn ? json(memberMe(['trades']))(r) : json({ error: 'not-authenticated' }, 401)(r)));
  await page.route('**/v1/team/invite', (r) => {
    record(r);
    const a = o.invite ?? { status: 200, body: { team: 'Calcium', displayName: 'Aurora', roles: ['trades'], expiresAt: LATER } };
    return json(a.body, a.status)(r);
  });
  await page.route('**/v1/team/join/start', (r) => (record(r), json({ challengeId: 'c1', encryptedMessage: PGP_MESSAGE, expiresAt: LATER })(r)));
  await page.route('**/v1/team/join/finish', (r) => {
    record(r);
    const a = o.finish?.() ?? { status: 201, body: { setupId: 's1', needs: ['security-key', 'passkey', 'pgp'], setupUntil: LATER } };
    return json(a.body, a.status)(r);
  });
  await page.route('**/v1/team/join/second/webauthn/start', (r) => {
    record(r);
    const kind = (r.request().postDataJSON() as { kind: string }).kind;
    return json({
      challengeId: 'w1',
      options: {
        challenge: 'dGVhbWNoYWxsZW5nZQ',
        rp: { name: 'X2F', id: 'localhost' },
        user: { id: 'bWVtYmVy', name: 'Calcium', displayName: 'Calcium' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: 60_000,
        attestation: kind === 'security-key' ? 'direct' : 'none',
        excludeCredentials: [],
        authenticatorSelection: { residentKey: kind === 'passkey' ? 'required' : 'discouraged', userVerification: 'preferred' },
      },
    })(r);
  });
  const finished = (r: Route) => {
    record(r);
    signedIn = true;
    return json({ status: 'ok' }, 201)(r);
  };
  await page.route('**/v1/team/join/second/webauthn/finish', finished);
  await page.route('**/v1/team/join/second/pgp/start', (r) => (record(r), json({ challengeId: 'c2', encryptedMessage: `${PGP_MESSAGE}#2`, expiresAt: LATER })(r)));
  await page.route('**/v1/team/join/second/pgp/finish', finished);
  return seen;
}

async function proveFirstKey(page: Page): Promise<void> {
  await page.getByLabel('Your private login name').fill('aurora_login');
  await page.locator('#join-key').fill(FAKE_KEY);
  await page.locator('[data-part="send-message"]').click();
  await expect(page.locator('[data-part="pgp-message"]')).toContainText('BEGIN PGP MESSAGE');
  await page.getByLabel('Code', { exact: true }).fill('12345678');
  await page.locator('[data-part="prove"]').click();
}

async function freshPhone(browser: Browser, viewport: string) {
  const [width, height] = viewport.split('x').map(Number) as [number, number];
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', serviceWorkers: 'block' });
  return { context, page: await context.newPage() };
}

for (const [second, viewport] of [['security-key', '390x844'], ['passkey', '360x800'], ['pgp', '390x844']] as const) {
  test(`joining with a PGP key then a ${second} (${viewport}): the code never leaves the fragment, which is cleared`, async ({ browser }) => {
    const { context, page } = await freshPhone(browser, viewport);
    try {
      const all = watchRequests(page);
      const seen = await joinApi(page);
      await page.goto(`${LOCAL}/team/join#${CODE}`);
      await expect(page.locator('[data-part="invite-who"]')).toHaveText('Calcium invited you as Aurora, for Trades.');
      expect(page.url()).not.toContain('#');
      expect(await page.evaluate(() => location.hash)).toBe('');
      await expectPhoneLayout(page);
      await proveFirstKey(page);
      await expect(page.locator('[data-part="join-second"]')).toBeVisible();
      await expectPhoneLayout(page);
      if (second === 'pgp') {
        await page.locator('[data-part="second-pgp"]').click();
        await page.locator('#join-key').fill(FAKE_KEY_2);
        await page.locator('[data-part="send-message"]').click();
        await expect(page.locator('[data-part="pgp-message"]')).toContainText('#2');
        await page.getByLabel('Code', { exact: true }).fill('87654321');
        await page.locator('[data-part="prove"]').click();
      } else {
        await authenticator(page, second === 'passkey' ? 'internal' : 'usb');
        await page.locator(second === 'passkey' ? '[data-part="second-passkey"]' : '[data-part="second-security-key"]').click();
      }
      // Signed in as the member: the app's home.
      await expect(page).toHaveURL(/\/sell$/);
      expect(seen.bodies['/v1/team/invite']).toEqual([{ invite: CODE }]);
      expect(seen.bodies['/v1/team/join/start']).toEqual([{ invite: CODE, loginName: 'aurora_login', publicKey: FAKE_KEY.trim() }]);
      if (second === 'pgp') {
        expect(seen.bodies['/v1/team/join/second/pgp/finish']).toEqual([{ setupId: 's1', challengeId: 'c2', code: '87654321', deviceLabel: expect.any(String) }]);
      } else {
        expect(seen.bodies['/v1/team/join/second/webauthn/start']).toEqual([{ setupId: 's1', kind: second }]);
        expect(seen.bodies['/v1/team/join/second/webauthn/finish']![0]).toMatchObject({ setupId: 's1', challengeId: 'w1', deviceLabel: expect.any(String) });
      }
      await expectCodeNeverSent(all);
    } finally {
      await context.close();
    }
  });
}

test('a used or expired link, and a garbled one, all say the invite is gone (the garbled one asks nothing)', async ({ browser }) => {
  for (const [hash, answer] of [
    [`#${CODE}`, { status: 404, body: { error: 'not-found' } }],
    ['#not-a-whole-code', null],
    ['', null],
  ] as const) {
    const { context, page } = await freshPhone(browser, '360x800');
    try {
      const seen = await joinApi(page, answer ? { invite: answer } : {});
      await page.goto(`/team/join${hash}`);
      await expect(page.locator('[data-part="invite-gone"]')).toHaveText('This invite link has been used, has run out or is not complete. Ask for a new one.');
      expect(page.url()).not.toContain('#');
      expect(seen.bodies['/v1/team/invite']?.length ?? 0).toBe(answer ? 1 : 0);
      await expect(page.locator('[data-part="join-first"]')).toHaveCount(0);
      await expectPhoneLayout(page);
    } finally {
      await context.close();
    }
  }
});

test('two browsers finishing the same invite: one wins, the other is told and stays put', async ({ browser }) => {
  let finishes = 0;
  // The server's single use (apps/api/test/team.test.ts): the second finish finds the invite gone.
  const finish = () => (++finishes === 1 ? { status: 201, body: { setupId: 's1', needs: ['security-key', 'passkey', 'pgp'], setupUntil: LATER } } : { status: 404, body: { error: 'not-found' } });
  const a = await freshPhone(browser, '390x844');
  const b = await freshPhone(browser, '360x800');
  try {
    await joinApi(a.page, { finish });
    await joinApi(b.page, { finish });
    await a.page.goto(`/team/join#${CODE}`);
    await b.page.goto(`/team/join#${CODE}`);
    await proveFirstKey(a.page);
    await expect(a.page.locator('[data-part="join-second"]')).toBeVisible();
    await proveFirstKey(b.page);
    await expect(b.page.getByRole('alert')).toBeVisible();
    await expect(b.page.locator('[data-part="join-second"]')).toHaveCount(0);
    expect(finishes).toBe(2);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

// ---- 4. A member's login after logout -------------------------------------------------------------

test("a member logs in with PGP first, then a security key; a member's passkey as the first factor is refused", async ({ page }) => {
  await page.route('**/v1/account/me', json(memberMe(['trades'])));
  await page.route('**/v1/login/pgp/start', json({ challengeId: 'c1', encryptedMessage: PGP_MESSAGE, expiresAt: LATER }));
  await page.route('**/v1/login/pgp/finish', json({ status: 'second-factor', pendingId: 'p1', needs: ['pgp', 'security-key', 'passkey'] }));
  let firstFactorPasskey = true;
  let webauthnStarts: unknown[] = [];
  await page.route('**/v1/login/webauthn/start', (r) => {
    webauthnStarts.push(r.request().postDataJSON());
    return json({ challengeId: 'w1', options: { challenge: 'dGVzdGNoYWxsZW5nZQ', timeout: 60_000, rpId: 'localhost', allowCredentials: [], userVerification: 'preferred' } })(r);
  });
  // Review M8: the API's discoverable login accepts traders only; a member's passkey gets webauthn-failed.
  await page.route('**/v1/login/webauthn/finish', (r) => (firstFactorPasskey ? json({ error: 'webauthn-failed' }, 401)(r) : json({ status: 'ok' })(r)));

  await page.goto(`${LOCAL}/login?returnTo=%2Fprofile%2Foffers`);
  const cdp = await authenticator(page, 'internal');
  await page.evaluate(async () => {
    await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array([1, 2, 3, 4]),
        rp: { name: 'X2F', id: location.hostname },
        user: { id: new Uint8Array([9, 9, 9]), name: 'aurora', displayName: 'aurora' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        timeout: 10_000,
      },
    });
  });
  await page.click('[data-method="passkey"]');
  await page.click('[data-part="passkey-login"]');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(webauthnStarts).toEqual([{}]);

  firstFactorPasskey = false;
  webauthnStarts = [];
  await page.goto(`${LOCAL}/login?returnTo=%2Fprofile%2Foffers`);
  await page.click('[data-method="pgp"]');
  await page.fill('#pgp-key', FAKE_KEY);
  await page.click('text=Send me a login message');
  await page.fill('[aria-label="Login code"]', '12345678');
  await page.click('[data-part="pgp-login"]');
  await expect(page.locator('[data-part="second-step"]')).toBeVisible();
  await expectPhoneLayout(page);
  await page.click('[data-part="second-step-key"]');
  await expect(page).toHaveURL(/\/profile\/offers$/);
  expect(webauthnStarts).toEqual([{ pendingId: 'p1' }]);
  await cdp.detach();
});

// ---- 5. Role limits in the UI ------------------------------------------------------------------------

/** PostOffer's stubs (post.spec.ts's shapes): one method, a price, and what POST /v1/offers answers. */
async function postApi(page: Page, roles: string[], post: { status: number; body: unknown }) {
  await page.route('**/v1/account/me', json(memberMe(roles)));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 0, bestRate: null }] }));
  await page.route('**/v1/offers?*', json([]));
  await page.route(/\/v1\/price\?/, json({ currency: 'USD', centsPerXmr: '32990', usdCentsPerXmr: '32990', exponent: 2, at: '2026-10-24T12:00:00.000Z' }));
  const posts: unknown[] = [];
  await page.route('**/v1/offers', (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    posts.push(r.request().postDataJSON());
    return json(post.body, post.status)(r);
  });
  return posts;
}

async function postOffer(page: Page): Promise<void> {
  await page.goto('/post?method=ZELLE');
  await page.getByLabel('Smallest trade').fill('$50');
  await page.getByLabel('Largest trade').fill('$2,000');
  await page.getByRole('button', { name: 'Post offer' }).click();
}

test('an Offers member posts an offer for the account', async ({ page }) => {
  const posts = await postApi(page, ['offers'], { status: 201, body: { id: 'of_1' } });
  await postOffer(page);
  await expect(page).not.toHaveURL(/\/post/);
  expect(posts).toHaveLength(1);
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`a Trades-only member cannot post: CantDoThat says the role does not include it (${viewport})`, async ({ page }) => {
    await postApi(page, ['trades'], { status: 403, body: { error: 'forbidden' } });
    await setPhone(page, viewport);
    await postOffer(page);
    const popup = page.locator('[data-part="cant-do-that"]');
    await expect(popup).toHaveAttribute('data-from', 'forbidden');
    await expect(popup).toContainText("Your team role doesn't include this.");
    await expect(page).toHaveURL(/\/post/);
    await expectPhoneLayout(page);
  });
}

for (const [path, screen] of [['/wallets', 'wallets'], ['/settings/security', 'security'], ['/settings/team', 'team']] as const) {
  test(`a member opening ${path} gets CantDoThat owner-only, never a blank screen`, async ({ page }) => {
    await page.route('**/v1/account/me', json(memberMe(['offers', 'trades'])));
    // The API refuses every owner-only call too (requireSession's fail-closed default).
    await page.route(/\/v1\/(team|wallets|account\/(sessions|security|alerts|blocks)).*/, json({ error: 'owner-only' }, 403));
    await page.goto(path);
    const popup = page.locator('[data-part="cant-do-that"]');
    await expect(popup).toHaveAttribute('data-from', 'owner-only');
    await expect(popup).toContainText('Only the account owner can do this.');
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    await expectPhoneLayout(page);
  });
}

// ---- 6. The trade side until Plan 3 Task 42 ----------------------------------------------------------

const TRADE = sellerView().code;

async function liveAccepted(page: Page, me: unknown, wallets: unknown[] = []) {
  await page.route('**/v1/account/me', json(me));
  await page.route('**/v1/wallets', json(wallets));
  await page.route(`**/v1/trades/${TRADE}`, json({ ...sellerView(), role: 'seller', poster: 'seller', amountAtomic: '1250000000000', grown: null, lockedRate: { currency: 'USD', centsPerXmr: '33000' }, maxFiatCents: '50000' }));
  await page.route('**/v1/events', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      body: `retry: 600000\n\ndata: ${JSON.stringify({ type: 'accepted', code: TRADE, by: 'mira.k' })}\n\n`,
    }),
  );
}

for (const viewport of PHONE_VIEWPORTS) {
  test(`a Trades member's device never gets the accept sheet, only a notice (review I1, ${viewport})`, async ({ page }) => {
    const walletReads: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/v1/wallets') walletReads.push(r.url());
    });
    await liveAccepted(page, memberMe(['trades']));
    await page.goto('/sell');
    await setPhone(page, viewport);
    const notice = page.locator('[data-part="member-accepted"]');
    await expect(notice).toContainText("mira.k took one of your team's offers. The account owner's device sets up the trade");
    await expect(page.getByRole('dialog', { name: 'Your offer was taken' })).toBeVisible();
    // The accept sheet's wallet pick never loads (it would store a ConfirmedTrade on this device).
    expect(walletReads).toEqual([]);
    await expectPhoneLayout(page);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(notice).toHaveCount(0);
  });
}

test("the owner's device still gets the accept sheet", async ({ page }) => {
  await liveAccepted(page, OWNER_ME, [{ id: 'w1', app: 'cake', label: 'Cake Wallet', address: '4TESTADDRESSCAKE00009QxA', addressEnd: '009QxA', usable: true }]);
  await page.goto('/sell');
  await expect(page.locator('[data-part="member-accepted"]')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('mira.k');
  await expect(page.getByRole('dialog')).toContainText('Cake Wallet');
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`a member's trade room waits for the owner's device: no escrow, no escrow error (${viewport})`, async ({ page }) => {
    await page.route('**/v1/account/me', json(memberMe(['trades'])));
    await page.route(`**/v1/trades/${TRADE}`, json(sellerView()));
    await page.route('**/v1/events', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'retry: 600000\n\n' }));
    const identity: string[] = [];
    page.on('request', (r) => {
      if (/\/identity$|\/attestation$/.test(new URL(r.url()).pathname)) identity.push(r.url());
    });
    await page.goto(`/trade/${TRADE}`);
    await setPhone(page, viewport);
    const room = page.locator('[data-screen="trade"][data-member]');
    await expect(room).toBeVisible();
    await expect(room.getByRole('status')).toHaveText("Waiting for the account owner's device. It sets up, secures and releases this trade.");
    await expect(page.locator('body')).not.toContainText(/Security check failed|not-confirmed|couldn't|Something went wrong/i);
    expect(identity).toEqual([]);
    await expectPhoneLayout(page);
  });
}

// ---- 7. The owner manages the team -------------------------------------------------------------------

test('the owner changes roles and removes a member; the member is then signed out; Devices names member sessions', async ({ page, browser }) => {
  const s = { members: [member('m1', 'Aurora', ['offers', 'trades'])] };
  const seen = await ownerApi(page, s);
  await page.goto('/settings/team');
  await page.getByRole('button', { name: 'Change roles for Aurora' }).click();
  await page.locator('input[data-role="offers"]').first().uncheck();
  await page.locator('[data-part="save-roles"]').click();
  await confirmWithPassword(page, "change a team member's roles to Trades");
  await expect(page.locator('[data-part="team-said"]')).toHaveText('Roles saved for Aurora.');
  expect(seen.patches).toEqual([{ roles: ['trades'], confirmToken: 'tok-1' }]);
  await expect(page.locator('[data-member="Aurora"]')).toContainText('Trades');

  // The member's tab, open meanwhile in another browser.
  const m = await freshPhone(browser, '390x844');
  let removed = false;
  try {
    await m.page.route('**/v1/account/me', (r) => (removed ? json({ error: 'not-authenticated' }, 401)(r) : json(memberMe(['trades']))(r)));
    await m.page.route(/\/v1\/team.*/, json({ error: 'owner-only' }, 403));
    await m.page.goto('/settings/team');
    await expect(m.page.locator('[data-part="cant-do-that"]')).toHaveAttribute('data-from', 'owner-only');

    await page.getByRole('button', { name: 'Remove Aurora' }).click();
    await confirmWithPassword(page, 'remove a team member');
    await expect(page.locator('[data-part="team-said"]')).toHaveText('Aurora was removed. Their sessions have ended.');
    expect(seen.deletes).toEqual(['m1']);
    removed = true;
    // The API answers the removed member's next request 401 (apps/api/test/team.test.ts).
    await m.page.unroute(/\/v1\/team.*/);
    await m.page.route(/\/v1\/team.*/, json({ error: 'not-authenticated' }, 401));
    await m.page.reload();
    await expect(m.page).toHaveURL(/\/login\?returnTo=%2Fsettings%2Fteam|\/settings\/team/);
    await expect(m.page.locator('[data-part="cant-do-that"]')).toHaveCount(0);
  } finally {
    await m.context.close();
  }

  // Settings → Security → Devices names a member's session, and the owner can end it.
  await page.route('**/v1/account/sessions', json([
    { id: 's-own', deviceLabel: 'Pixel 8', level: 'full', createdAt: LATER, lastSeenAt: LATER, current: true, member: null },
    { id: 's-m', deviceLabel: 'Firefox on Linux', level: 'full', createdAt: LATER, lastSeenAt: LATER, current: false, member: 'Basil' },
  ]));
  await page.route(/\/v1\/account\/security.*/, json({ idleHours: 12, adjustable: true }));
  await page.goto('/settings/security');
  const row = page.locator('[data-part="device-list"] li[data-member="Basil"]');
  await expect(row).toContainText('Firefox on Linux · team member Basil');
  await expect(row.locator('[data-part="end-session"]')).toBeVisible();
});

// ---- 8. The activity log -----------------------------------------------------------------------------

test('the activity log lists member actions newest first, and filters by member', async ({ page }) => {
  const audit = [
    { id: '4', at: '2026-10-30T10:03:00.000Z', memberId: 'm2', memberName: 'Basil', action: 'mark-paid', tradeCode: 'K7M2-9QXA-4FTR-8WPN', detail: {} },
    { id: '3', at: '2026-10-30T10:02:00.000Z', memberId: 'm1', memberName: 'Aurora', action: 'offer-paused', tradeCode: null, detail: {} },
    { id: '2', at: '2026-10-30T10:01:00.000Z', memberId: 'm2', memberName: 'Basil', action: 'dispute-opened', tradeCode: 'K7M2-9QXA-4FTR-8WPN', detail: {} },
    { id: '1', at: '2026-10-30T10:00:00.000Z', memberId: 'm1', memberName: 'Aurora', action: 'offer-posted', tradeCode: null, detail: {} },
  ];
  const seen = await ownerApi(page, { members: [member('m1', 'Aurora', ['offers']), member('m2', 'Basil', ['trades'])], audit });
  await page.goto('/settings/team');
  const rows = page.locator('[data-part="log-list"] li');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Basil marked the payment sent');
  await expect(rows.nth(0)).toContainText('trade K7M2-9QXA-4FTR-8WPN');
  await expect(rows.nth(3)).toContainText('Aurora posted an offer');
  await page.getByLabel('Show activity of').selectOption({ label: 'Aurora' });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Aurora turned an offer off');
  expect(seen.audits.at(-1)).toBe('?member=m1');
  await page.getByLabel('Show activity of').selectOption({ label: 'Every member' });
  await expect(rows).toHaveCount(4);
  await expectPhoneLayout(page);
});
