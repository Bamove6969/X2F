import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import { takeableWallets, type WalletView } from '../src/screens/wallets-model.js';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const parityHarness = fileURLToPath(new URL('./parity.ts', import.meta.url));
const walletRef = `${repo}design/x2f-app/refs/Wallet.png`;

const READY: WalletView = {
  id: 'w-ready',
  app: 'cake',
  label: 'Cake Wallet',
  address: '4AReadyAddressExampleExampleExampleExampleExampleExampleExampleExampleExampleExampleExamplek3Fz',
  addressEnd: '…k3Fz',
  usableFrom: '2026-10-20T00:00:00.000Z',
  usable: true,
};
const WAITING: WalletView = {
  id: 'w-waiting',
  app: 'edge',
  label: 'Edge',
  address: '4AWaitingAddressExampleExampleExampleExampleExampleExampleExampleExampleExampleExampleExa7HcW',
  addressEnd: '…7HcW',
  usableFrom: '2099-01-01T00:00:00.000Z',
  usable: false,
};

/** Stubs `me` (so the shell is quiet) and the wallet list; POST/DELETE are left to each test. */
async function stub(page: Page, wallets: WalletView[], onWrite?: (route: Route) => void): Promise<void> {
  await page.route('**/v1/account/me', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('**/v1/wallets', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, json: wallets });
    if (onWrite) return onWrite(route);
    return route.fulfill({ status: 500, json: { error: 'internal' } });
  });
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

test.afterEach(async ({ page }) => {
  await page.evaluate(() => indexedDB.deleteDatabase('x2f-escrow')).catch(() => {});
});

test('the wallets screen never claims a PGP backup of the escrow key (P3-I14)', async ({ page }) => {
  await stub(page, [READY]);
  await page.goto('/wallets');
  await expect(page.getByRole('heading', { name: 'Add a wallet' })).toBeVisible();
  await openTrade(page, CODE);
  await expect(page.getByText(CODE)).toBeVisible();
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toContain('backed up');
  expect(body).not.toMatch(/backup|to your pgp key/);
  await expect(page.getByText('It stays on this device and is deleted when the trade closes.')).toBeVisible();
  // Wallet wait by method (spec, decided 2026-10-23): no opt-in 24-hour setting is offered.
  expect(body).not.toContain('security settings');
  await expect(page.getByText(/security key and the wallet works\s+at once/)).toBeVisible();
});

test('the escrow key row appears while a trade is open and disappears after it closes', async ({ page }) => {
  await stub(page, [READY]);
  await page.goto('/wallets');
  await expect(page.getByRole('heading', { name: 'Add a wallet' })).toBeVisible();
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
  const waitingRow = page.getByRole('listitem').filter({ hasText: 'Edge' });
  await expect(waitingRow.getByText('Waiting')).toBeVisible();
  const readyRow = page.getByRole('listitem').filter({ hasText: 'Cake Wallet' });
  await expect(readyRow.getByText('Ready')).toBeVisible();
  // The one source the take picker (Tasks 17-19) filters its list through drops the waiting wallet.
  expect(takeableWallets([READY, WAITING])).toEqual([READY]);
});

test('/wallets?add=1&returnTo=… opens Add a wallet and returns to returnTo after the add', async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  await stub(page, [], (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      json: { ...READY, id: 'w-new', label: 'Cake Wallet' },
    });
  });
  await page.goto('/wallets?add=1&returnTo=%2Fbuy');
  await expect(page.getByRole('heading', { name: 'Add a wallet' })).toBeVisible();
  await page.getByLabel(/Receive address/).fill(READY.address);
  await page.getByRole('button', { name: 'Save wallet' }).click();
  await expect(page).toHaveURL(/\/buy$/);
  expect(posted).toMatchObject({ app: 'cake', address: READY.address });
});

test('parity with the Wallet board', async ({ page }) => {
  test.skip(
    !existsSync(parityHarness) || !existsSync(walletRef),
    'Task 15 parity harness / reference PNGs are not on this branch yet',
  );
  await stub(page, [READY, WAITING]);
  await page.goto('/wallets');
  const specifier = parityHarness;
  const { expectParity } = (await import(specifier)) as {
    expectParity: (p: Page, board: string, o?: unknown) => Promise<void>;
  };
  await expectParity(page, 'Wallet');
});

test('TRIPWIRE: the local ConfirmSheet stub is gone once Task 30 lands', () => {
  const real = fileURLToPath(new URL('../src/screens/auth/ConfirmSheet.tsx', import.meta.url));
  const stubFile = fileURLToPath(new URL('../src/screens/ConfirmSheet.stub.tsx', import.meta.url));
  test.skip(!existsSync(real), 'Task 30 ConfirmSheet is not on this branch yet; the add flow uses the local stub');
  // Task 30 has landed: the add flow must now use the real ConfirmSheet, and the stub must be deleted.
  expect(existsSync(stubFile)).toBe(false);
});
