import { expect, test, type Page, type Route } from '@playwright/test';
import { expectParity } from './parity.js';
import { takeableWallets, type WalletRule, type WalletView } from '../src/screens/wallets-model.js';

/** A 95-character standard address ending in `end` (the API's `addressEnd` is its last 6 characters). */
const address = (seed: string, end: string) => `4${seed.repeat(95).slice(0, 88)}${end}`;

const READY: WalletView = {
  id: 'w-ready',
  app: 'cake',
  label: 'Savings',
  address: address('A', 'Rk3Fz1'),
  addressEnd: 'Rk3Fz1',
  usableFrom: '2026-10-20T00:00:00.000Z',
  usable: true,
};
const WAITING: WalletView = {
  id: 'w-waiting',
  app: 'edge',
  label: 'Wallet 2',
  address: address('B', 'W7HcW2'),
  addressEnd: 'W7HcW2',
  usableFrom: '2099-01-01T12:00:00.000Z',
  usable: false,
};

// GET /v1/wallets/rule fixtures, same shape as the lead's FU-B (`WalletRule` in @x2f/auth-client).
const RULE_FIRST: WalletRule = { firstWallet: true, strongMethods: [], password: 'immediate', waitHours: 24 };
const RULE_KEY: WalletRule = { firstWallet: false, strongMethods: ['security-key'], password: 'none', waitHours: 24 };
const RULE_KEY_AND_PASSWORD: WalletRule = {
  firstWallet: false,
  strongMethods: ['passkey', 'pgp'],
  password: 'waits',
  waitHours: 24,
};
const RULE_PASSWORD_ONLY: WalletRule = { firstWallet: false, strongMethods: [], password: 'waits', waitHours: 24 };

interface Stub {
  posts: Record<string, unknown>[];
}

/**
 * Stubs `me` (a password account, so Task 30's ConfirmSheet offers the password), its password
 * confirm, the wallet list and the account's wallet rule. Each POST body is recorded; `onPost`
 * answers it (default 500).
 */
async function stub(
  page: Page,
  wallets: WalletView[],
  rule: WalletRule = RULE_KEY,
  onPost?: (body: Record<string, unknown>, n: number, route: Route) => Promise<void> | void,
): Promise<Stub> {
  const s: Stub = { posts: [] };
  await page.route('**/v1/account/me', (route) => route.fulfill({ status: 200, json: { methods: ['password'] } }));
  await page.route('**/v1/confirm/password', (route) => route.fulfill({ status: 200, json: { confirmToken: 'tok-1' } }));
  await page.route('**/v1/wallets/rule', (route) => route.fulfill({ status: 200, json: rule }));
  await page.route('**/v1/wallets', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, json: wallets });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    s.posts.push(body);
    if (onPost) return onPost(body, s.posts.length, route);
    return route.fulfill({ status: 500, json: { error: 'internal' } });
  });
  return s;
}

/** The server's answer to a batch: every wallet in it shares one `usableFrom` (FU-B). */
function created(body: Record<string, unknown>, usableFrom: string, usable: boolean): WalletView[] {
  const list = body.wallets as { app: WalletView['app']; label: string; address: string }[];
  return list.map((w, i) => ({ ...w, id: `w-new-${i}`, addressEnd: w.address.slice(-6), usableFrom, usable }));
}

const CODE = 'K7M2-9QXA-4FTR-8WPN';

/** Writes one escrow record keyed by its trade code and tells the page the store changed. */
async function openTrade(page: Page, code: string): Promise<void> {
  await page.evaluate(
    (c) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('x2f-escrow', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('records')) db.createObjectStore('records');
          if (!db.objectStoreNames.contains('x2f-escrow-secrets')) db.createObjectStore('x2f-escrow-secrets');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('records', 'readwrite');
          tx.objectStore('records').put({ partyState: {} }, c);
          tx.oncomplete = () => {
            db.close();
            window.dispatchEvent(new Event('x2f:escrow-changed'));
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    code,
  );
}

/** Deletes the escrow record, as the worker does when a trade closes, and tells the page. */
async function closeTrade(page: Page, code: string): Promise<void> {
  await page.evaluate(
    (c) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('x2f-escrow', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('records', 'readwrite');
          tx.objectStore('records').delete(c);
          tx.oncomplete = () => {
            db.close();
            window.dispatchEvent(new Event('x2f:escrow-changed'));
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    code,
  );
}

/** Opens Add a wallet from the list and gets past the rule popup. */
async function startAdding(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const popup = page.getByRole('dialog', { name: 'Before you add a wallet' });
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: 'Continue' }).click();
  await expect(popup).toHaveCount(0);
}

/** Confirms it's you in Task 30's ConfirmSheet with the account's password. */
async function confirmWithPassword(page: Page): Promise<void> {
  const sheet = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Your password').fill('Correct-Horse-9!');
  await sheet.getByRole('button', { name: 'Confirm' }).click();
}

/** Fills one wallet in the Add a wallet form. */
async function fillWallet(page: Page, addr: string, label?: string): Promise<void> {
  if (label !== undefined) await page.getByLabel('Name', { exact: true }).fill(label);
  await page.getByLabel(/Receive address/).fill(addr);
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => indexedDB.deleteDatabase('x2f-escrow')).catch(() => {});
});

test('the wallets screen never claims a PGP backup of the escrow key (P3-I14)', async ({ page }) => {
  await stub(page, [READY]);
  await page.goto('/wallets');
  await expect(page.getByRole('heading', { name: 'Your wallets' })).toBeVisible();
  await openTrade(page, CODE);
  await expect(page.getByText(CODE)).toBeVisible();
  await startAdding(page);
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toMatch(/backed up|backup|to your pgp key/);
  await expect(page.getByText('It stays on this device and is deleted when the trade closes.')).toBeVisible();
  // Wallet wait by method (decided 2026-10-23): the old opt-in 24-hour setting is not offered.
  expect(body).not.toContain('security settings');
});

test('the list shows name, address end and status, never a balance', async ({ page }) => {
  await stub(page, [READY]);
  await page.goto('/wallets');
  const row = page.getByRole('listitem').filter({ hasText: 'Savings' });
  await expect(row.getByText('…Rk3Fz1')).toBeVisible();
  await expect(row.getByText('Ready')).toBeVisible();
  expect((await row.innerText()).toLowerCase()).not.toMatch(/xmr|balance/);
});

test('the escrow key row appears while a trade is open and disappears after it closes', async ({ page }) => {
  await stub(page, [READY]);
  await page.goto('/wallets');
  await expect(page.getByRole('heading', { name: 'Your wallets' })).toBeVisible();
  const row = page.getByText(CODE);
  await expect(row).toHaveCount(0);
  await openTrade(page, CODE);
  await expect(row).toBeVisible();
  await closeTrade(page, CODE);
  await expect(row).toHaveCount(0);
});

test('a waiting wallet shows its status and is absent from the take picker', async ({ page }) => {
  await stub(page, [READY, WAITING]);
  await page.goto('/wallets');
  const waitingRow = page.getByRole('listitem').filter({ hasText: 'Wallet 2' });
  await expect(waitingRow.getByText('Waiting')).toBeVisible();
  const readyRow = page.getByRole('listitem').filter({ hasText: 'Savings' });
  await expect(readyRow.getByText('Ready')).toBeVisible();
  // The one source the take picker (Tasks 17-19) filters its list through drops the waiting wallet.
  expect(takeableWallets([READY, WAITING])).toEqual([READY]);
});

test.describe('the rule popup explains what adding does for this account', () => {
  const cases: { name: string; rule: WalletRule; says: RegExp[]; never: RegExp[] }[] = [
    {
      name: 'first wallet',
      rule: RULE_FIRST,
      says: [/This is your first wallet, so it works at once, however you confirm\./],
      never: [/24 hours/],
    },
    {
      name: 'security key only',
      rule: RULE_KEY,
      says: [/You use a security key: confirm with it and your new wallets work at once\./],
      never: [/24 hours/, /password/i],
    },
    {
      name: 'strong methods and a password',
      rule: RULE_KEY_AND_PASSWORD,
      says: [
        /You use a passkey and a PGP key: confirm with one of them and your new wallets work at once\./,
        /If you confirm with your password instead, they work 24 hours after you add them\./,
      ],
      never: [],
    },
    {
      name: 'username and password, nothing stronger',
      rule: RULE_PASSWORD_ONLY,
      says: [
        /You have no passkey, security key or PGP key yet: new wallets will work 24 hours after you add them\./,
        /Add one first to skip the wait\./,
      ],
      never: [],
    },
  ];
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await stub(page, [READY], c.rule);
      await page.goto('/wallets');
      await page.getByRole('button', { name: 'Add a wallet' }).click();
      const popup = page.getByRole('dialog', { name: 'Before you add a wallet' });
      await expect(popup).toBeVisible();
      const text = await popup.innerText();
      for (const s of c.says) expect(text).toMatch(s);
      for (const n of c.never) expect(text).not.toMatch(n);
      if (!c.rule.firstWallet) expect(text).toMatch(/One confirm covers several wallets/);
    });
  }
});

test('/wallets?add=1&returnTo=… opens Add a wallet and returns to returnTo after the add', async ({ page }) => {
  const s = await stub(page, [], RULE_FIRST, (body, _n, route) =>
    route.fulfill({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) }),
  );
  await page.goto('/wallets?add=1&returnTo=%2Fbuy');
  // The rule popup opens at once on the no-wallet path.
  const popup = page.getByRole('dialog', { name: 'Before you add a wallet' });
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: 'Continue' }).click();
  await fillWallet(page, READY.address);
  await page.getByRole('button', { name: 'Save wallet' }).click();
  await expect(page).toHaveURL(/\/buy$/);
  expect(s.posts).toHaveLength(1);
  expect(s.posts[0]).toMatchObject({ wallets: [{ app: 'cake', address: READY.address }] });
});

test("/wallets?add=1&returnTo=… returns to returnTo after confirm-it's-you when the new wallet works at once", async ({ page }) => {
  const s = await stub(page, [READY], RULE_KEY, (body, n, route) =>
    n === 1
      ? route.fulfill({ status: 403, json: { error: 'confirm-required', action: 'add-wallets' } })
      : route.fulfill({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) }),
  );
  await page.goto('/wallets?add=1&returnTo=%2Fbuy%3Fresume%3Dn1');
  const popup = page.getByRole('dialog', { name: 'Before you add a wallet' });
  await popup.getByRole('button', { name: 'Continue' }).click();
  await fillWallet(page, address('C', 'AAAAA1'));
  await page.getByRole('button', { name: 'Save wallet' }).click();
  await confirmWithPassword(page);
  await expect(page).toHaveURL(/\/buy\?resume=n1$/);
  expect(s.posts).toHaveLength(2);
  expect(s.posts[1]!.confirmToken).toBe('tok-1');
});

test('the first wallet never waits: no confirm, no wait, and the screen says so', async ({ page }) => {
  const s = await stub(page, [], RULE_FIRST, (body, _n, route) =>
    route.fulfill({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) }),
  );
  await page.goto('/wallets');
  await startAdding(page);
  await expect(page.getByText('Your first wallet works at once.')).toBeVisible();
  await fillWallet(page, READY.address, 'Savings');
  await page.getByRole('button', { name: 'Save wallet' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Savings' });
  await expect(row.getByText('Ready')).toBeVisible();
  await expect(page.getByRole('dialog', { name: "Confirm it's you" })).toHaveCount(0);
  expect(s.posts).toHaveLength(1);
  expect(s.posts[0]).not.toHaveProperty('confirmToken');
});

test('several wallets are added under one confirm', async ({ page }) => {
  const s = await stub(page, [READY], RULE_KEY, (body, n, route) =>
    n === 1
      ? route.fulfill({ status: 403, json: { error: 'confirm-required', action: 'add-wallets' } })
      : route.fulfill({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) }),
  );
  await page.goto('/wallets');
  await startAdding(page);
  await fillWallet(page, address('C', 'AAAAA1'), 'Wallet 2');
  await page.getByRole('button', { name: 'Add another' }).click();
  await fillWallet(page, address('D', 'BBBBB2'), 'Wallet 3');
  await page.getByRole('button', { name: 'Add another' }).click();
  await fillWallet(page, address('E', 'CCCCC3'), 'Wallet 4');
  await page.getByRole('button', { name: 'Save 3 wallets' }).click();
  const confirm = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('3 payout wallets');
  await confirmWithPassword(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'Wallet 4' })).toBeVisible();
  await expect(confirm).toHaveCount(0);
  // Exactly one confirm: one refused request, then one retry with the token, for the same three wallets in order.
  expect(s.posts).toHaveLength(2);
  const addrs = (b: Record<string, unknown>) => (b.wallets as { address: string }[]).map((w) => w.address);
  expect(addrs(s.posts[0]!)).toEqual([address('C', 'AAAAA1'), address('D', 'BBBBB2'), address('E', 'CCCCC3')]);
  expect(addrs(s.posts[1]!)).toEqual(addrs(s.posts[0]!));
  expect(s.posts[0]).not.toHaveProperty('confirmToken');
  expect(s.posts[1]!.confirmToken).toBe('tok-1');
});

test('a batch that waits shows one shared wait for all of its wallets', async ({ page }) => {
  const later = '2099-01-01T12:00:00.000Z';
  await stub(page, [READY], RULE_PASSWORD_ONLY, (body, n, route) =>
    n === 1
      ? route.fulfill({ status: 403, json: { error: 'confirm-required', action: 'add-wallets' } })
      : route.fulfill({ status: 201, json: created(body, later, false) }),
  );
  await page.goto('/wallets');
  await startAdding(page);
  await fillWallet(page, address('C', 'AAAAA1'), 'Wallet 2');
  await page.getByRole('button', { name: 'Add another' }).click();
  await fillWallet(page, address('D', 'BBBBB2'), 'Wallet 3');
  await page.getByRole('button', { name: 'Save 2 wallets' }).click();
  await confirmWithPassword(page);
  const status = page.getByRole('status');
  await expect(status).toContainText('Your 2 new wallets can be paid from');
  await expect(status).toContainText('one wait for all of them');
  for (const name of ['Wallet 2', 'Wallet 3']) {
    await expect(page.getByRole('listitem').filter({ hasText: name }).getByText('Waiting')).toBeVisible();
  }
  // The same "until" on both rows: one clock.
  const notes = await page.getByRole('listitem').filter({ hasText: 'Waiting' }).getByText(/^Until /).allInnerTexts();
  expect(notes).toHaveLength(2);
  expect(new Set(notes).size).toBe(1);
});

test('labels: neutral names are suggested and the screen warns against naming where money came from', async ({ page }) => {
  const s = await stub(page, [READY], RULE_FIRST, (body, _n, route) =>
    route.fulfill({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) }),
  );
  await page.goto('/wallets');
  await startAdding(page);
  await expect(
    page.getByText('X2F stores this name. Keep it neutral, and never write where the money came from.'),
  ).toBeVisible();
  // One existing wallet: the next neutral name is "Wallet 2".
  await page.getByRole('button', { name: 'Wallet 2' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Wallet 2');
  await page.getByRole('button', { name: 'Spending' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Spending');
  // Left empty, the name defaults to the next neutral one.
  await page.getByLabel('Name', { exact: true }).fill('');
  await fillWallet(page, address('C', 'AAAAA1'));
  await page.getByRole('button', { name: 'Save wallet' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Wallet 2' })).toBeVisible();
  expect(s.posts[0]).toMatchObject({ wallets: [{ label: 'Wallet 2' }] });
});

test('the Save footer stays pinned on a 390x844 phone while the add form scrolls (review item 8)', async ({ page }) => {
  await stub(page, [READY, WAITING]);
  await page.goto('/wallets');
  await openTrade(page, CODE);
  await startAdding(page);
  await page.getByRole('radio', { name: 'Edge', exact: true }).click();
  await fillWallet(page, address('C', 'AAAAA1'), 'Wallet 3');
  await page.getByRole('button', { name: 'Add another' }).click();
  await fillWallet(page, address('D', 'BBBBB2'), 'Wallet 4');
  const save = page.getByRole('button', { name: 'Save 2 wallets' });
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  // The page itself does not scroll: the list and form scroll inside the screen.
  const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, view: window.innerHeight }));
  expect(scroll.doc).toBeLessThanOrEqual(scroll.view);
});

test('parity with the Wallet board', async ({ page }) => {
  // The board's state: two linked wallets, the add form open on Edge, one escrow key on this device.
  await stub(page, [READY, WAITING]);
  await page.goto('/wallets');
  await openTrade(page, CODE);
  await expect(page.getByText(CODE)).toBeVisible();
  await startAdding(page);
  await page.getByRole('radio', { name: 'Edge', exact: true }).click();
  await expectParity(page, 'Wallet');
});
