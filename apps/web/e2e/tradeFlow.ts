/**
 * Plan 3 Task 31: the trade steps the end-to-end specs share (trade.e2e.spec.ts and the
 * reputation specs), each as a trader does it in the browser.
 */
import { expect, type Browser, type Page } from '@playwright/test';
import type { MoneroWalletFull } from 'monero-ts';
import { codeOf, contextFor, funder, mine, pay, signUp, tradeView, type Size, type Trader } from './regtestKit.js';

export const XMR = 1_000_000_000_000n;
/** The trade amount every spec types: 0.2 XMR ($40 at the fixed $200 price). */
export const AMOUNT = 200_000_000_000n;
export const FEE = AMOUNT / 100n;
export const LONG = 5 * 60_000;

export const offer = (side: 'sell' | 'buy', maxUsd = '150', currency = 'USD') => ({
  side,
  currencies: [{ currency, bands: [{ min: '20', max: maxUsd, marginBps: 0, minTrades: null }] }],
  methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: 'My payment details come in the trade chat.' }],
  terms: 'Regtest e2e offer.',
});

export interface TradeView {
  state: string;
  releasable: boolean;
  amountAtomic: string;
  funding: { sellerFundsAtomic: string; escrowAddress: string | null } | null;
  txHash: string | null;
  settling: string | null;
}

export interface Open {
  code: string;
  seller: Trader;
  buyer: Trader;
  sellerPage: Page;
  buyerPage: Page;
  close(): Promise<void>;
}

/** The one-time tips a first trade shows ("Trading with more than one person?"), whenever they open. */
export async function dismissTips(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByRole('button', { name: 'Got it' }), async (b) => b.click());
}

/**
 * The poster posts an offer; the taker browses, taps Trade on it, types 0.2 XMR and taps Trade;
 * the poster picks a wallet on the accepted-offer sheet. Ends with the seller asked to fund.
 * With `poster`, that trader's own live offer (`offer(...)` on the matching side) is used instead.
 */
export async function openTrade(
  browser: Browser,
  size: Size,
  taker: 'seller' | 'buyer',
  o: {
    buyerPage?: (page: Page) => Promise<void>;
    beforeAccept?: (code: string) => Promise<void>;
    /** The amount the taker types (default 0.2 XMR) and the offer's largest USD amount (default 150). */
    xmr?: string;
    maxUsd?: string;
    poster?: Trader;
    /** Review p4t22 M1: the offer's and the trade's currency (default USD; the regtest feed prices EUR at the USD figure). */
    currency?: string;
  } = {},
): Promise<Open> {
  const currency = o.currency ?? 'USD';
  void funder(); // mined and synced while the trade is set up
  const poster = o.poster ?? (await signUp(taker === 'seller' ? 'buyer' : 'seller', { vendor: true }));
  if (!o.poster) await poster.api.ok('POST', '/v1/offers', offer(taker === 'seller' ? 'buy' : 'sell', o.maxUsd, currency));
  const takerT = await signUp(taker);
  const p = await contextFor(browser, poster, size);
  const t = await contextFor(browser, takerT, size);
  await dismissTips(p.page);
  await dismissTips(t.page);
  await o.buyerPage?.(taker === 'seller' ? p.page : t.page);
  await p.page.goto('/sell');
  // The taker sells to a buy ad on /sell, buys from a sell ad on /buy.
  await t.page.goto(`/${taker === 'seller' ? 'sell' : 'buy'}/ZELLE?currency=${currency}`);
  await t.page.getByRole('button', { name: `Trade with ${poster.displayName}` }).click();
  // The amount in XMR (the buy quote opens in the fiat currency).
  await expect(t.page.locator('input[type=text]:visible').first()).toBeVisible();
  const inXmr = t.page.getByRole('button', { name: 'Enter XMR' });
  if (await inXmr.isVisible()) {
    await inXmr.click();
    await expect(t.page.getByRole('button', { name: new RegExp(`^Enter (${currency}|\\$|€)`) })).toBeVisible();
  }
  await t.page.locator('input[type=text]:visible').first().fill(o.xmr ?? '0.2');
  await t.page.locator('input[type=radio][name=wallet]').first().check();
  const trade = t.page.getByRole('button', { name: 'Trade', exact: true });
  await trade.click();
  await t.page.waitForURL(/\/trade\//);
  await o.beforeAccept?.(codeOf(t.page));
  const use = p.page.getByRole('button', { name: 'Use this wallet' });
  await expect(use).toBeVisible({ timeout: 60_000 });
  await p.page.locator('input[type=radio][name=accepted-wallet]').first().check();
  await use.click();
  await p.page.waitForURL(/\/trade\//);
  const sellerIsTaker = taker === 'seller';
  return {
    code: codeOf(t.page),
    seller: sellerIsTaker ? takerT : poster,
    buyer: sellerIsTaker ? poster : takerT,
    sellerPage: sellerIsTaker ? t.page : p.page,
    buyerPage: sellerIsTaker ? p.page : t.page,
    close: async () => {
      await p.context.close();
      await t.context.close();
    },
  };
}

/**
 * Waits until the page's rendered text (as shown, so CSS capitals count) matches `re`. With
 * `mining`, a block comes every 5 s meanwhile, as the chain moves on mainnet: a party's wallet
 * sees a spend only once it is in a block.
 */
export async function shows(page: Page, re: RegExp, timeout = LONG, o: { mining?: boolean } = {}): Promise<void> {
  const until = Date.now() + timeout;
  let next = 0;
  for (;;) {
    if (re.test(await page.evaluate(() => document.body.innerText))) return;
    if (Date.now() > until) throw new Error(`${page.url()} never showed ${re}`);
    if (o.mining && Date.now() >= next) {
      await mine(1);
      next = Date.now() + 5000;
    }
    await page.waitForTimeout(500);
  }
}

/** Wraps a spec body: on failure both rooms' text goes to the log, then the error. */
export async function inRooms(o: Open, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (e) {
    for (const [who, page] of [['seller', o.sellerPage], ['buyer', o.buyerPage]] as const) {
      console.log(`---- ${who} @ ${page.url()}\n${await page.evaluate(() => document.body.innerText).catch(() => '(closed)')}`);
    }
    throw e;
  } finally {
    await o.close();
  }
}

export function xmrToAtomic(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(s.replace(/\s*XMR$/i, '').trim());
  if (!m) throw new Error(`not an XMR amount: ${s}`);
  return BigInt(m[1]!) * XMR + BigInt((m[2] ?? '').padEnd(12, '0'));
}

/** The seller's page copies the escrow address and the amount; returns both (read from the clipboard). */
export async function copiedFunding(page: Page): Promise<{ address: string; atomic: bigint }> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const copy = page.getByRole('button', { name: 'Copy address' });
  await expect(copy).toBeVisible({ timeout: LONG });
  await copy.click();
  const address = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  await page.getByRole('button', { name: 'Copy amount' }).click();
  const amount = await page.evaluate(() => navigator.clipboard.readText());
  return { address, atomic: xmrToAtomic(amount) };
}

/** Pays the escrow what the seller's page asks (plus `extra`), mines 12 blocks and waits for secured. */
export async function fund(o: Open, extra = 0n): Promise<bigint> {
  const asked = await copiedFunding(o.sellerPage);
  const v = await tradeView<TradeView>(o.seller, o.code);
  expect(asked.address).toBe(v.funding!.escrowAddress);
  expect(asked.atomic).toBe(BigInt(v.funding!.sellerFundsAtomic));
  await pay(asked.address, asked.atomic + extra);
  await mine(12);
  await shows(o.sellerPage, /ESCROW SECURED/);
  await shows(o.buyerPage, /ESCROW SECURED/);
  // The seller's room never offers a cancel of its own (Revision 2026-10-29b; proto review P2).
  await expect(o.sellerPage.getByRole('button', { name: /cancel/i })).toHaveCount(0);
  return asked.atomic;
}

export async function markPaid(page: Page): Promise<void> {
  await page.getByRole('button', { name: "I've paid" }).click();
  // With the proof screens on and no proof added, the no-proof sheet comes first.
  const withoutProof = page.getByRole('button', { name: 'Mark paid without proof' });
  const sure = page.getByRole('button', { name: 'Yes, mark as paid' });
  await expect(withoutProof.or(sure).first()).toBeVisible();
  if (await withoutProof.isVisible()) await withoutProof.click();
  await page.locator('.x2f-sheet-layer input[type=checkbox]').first().check();
  await page.getByRole('button', { name: 'Yes, mark as paid' }).click();
  // Done only once this device has recorded the tap. The sheet posts mark-paid to the API first and
  // only then asks the device (escrow.markPaid), which fixes the trade amount at the tap. Until then
  // the room shows "I've paid" (the old view) or "Marking as paid…"; a device that missed it shows
  // "Finish marking as paid". The 23 Nov dispute flake: the specs moved on once the API said paid,
  // and the next page.goto killed the page between the two. The device then knew of paid without a
  // fixed amount, so it co-signed nothing, neither the release nor the moderator-built ruling set.
  await expect(page.getByRole('button', { name: /^(I've paid|Marking as paid…|Finish marking as paid)$/ })).toHaveCount(0, { timeout: 60_000 });
}

/** The seller ticks the check, holds "Payment received" and confirms the warning. */
export async function holdToRelease(page: Page): Promise<void> {
  const hold = page.locator('button', { hasText: 'PAYMENT RECEIVED' });
  await expect(hold).toBeVisible({ timeout: 2 * 60_000 });
  await page.locator('input[type=checkbox]:visible').first().check();
  await expect(hold).toBeEnabled();
  // The mouse holds at page coordinates, so the button must be on screen (a phone room with the
  // smart proof card is taller than the viewport).
  await hold.scrollIntoViewIfNeeded();
  const bb = (await hold.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await page.getByRole('button', { name: "It's in my account" }).click();
}

/** Waits until the API says one of `states`, mining a block every few seconds (the watcher runs every 15 s). */
export async function untilState(t: Trader, code: string, states: string[], timeoutMs = LONG): Promise<TradeView> {
  const until = Date.now() + timeoutMs;
  let v = await tradeView<TradeView>(t, code);
  while (!states.includes(v.state)) {
    if (Date.now() > until) throw new Error(`trade ${code} is ${v.state}, not ${states.join('/')}`);
    await mine(1);
    await new Promise((r) => setTimeout(r, 4000));
    v = await tradeView<TradeView>(t, code);
  }
  return v;
}

/** What `w` received in transaction `txHash` (atomic). */
export async function receivedIn(w: MoneroWalletFull, txHash: string): Promise<bigint> {
  await w.sync();
  const ts = (await w.getIncomingTransfers({} as never)).filter((t) => t.getTx().getHash() === txHash);
  return ts.reduce((s, t) => s + t.getAmount(), 0n);
}

/** The hashes of every transaction `w` has received. */
export async function incomingTxs(w: MoneroWalletFull): Promise<Set<string>> {
  await w.sync();
  return new Set((await w.getIncomingTransfers({} as never)).map((t) => t.getTx().getHash()!));
}

/** The buyer's Cancel trade, then Cancel trade on the "Cancelling is likely final" sheet. */
export async function buyerCancels(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cancel trade' }).click();
  await page.locator('.x2f-sheet-layer').getByRole('button', { name: 'Cancel trade' }).click();
}

