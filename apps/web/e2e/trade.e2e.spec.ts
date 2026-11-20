/**
 * Plan 3 Task 31: end-to-end trades between two browsers on regtest, at 390×844 and 1280×800.
 * Everything is real: the production build, the API, the relay, the node proxy, the moderation
 * process and monerod (stack.ts). Each trader's escrow wallet runs in their own browser context.
 * Funding pays the address and amount the seller's page copies; every check of money reads the
 * receiving wallet itself.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { MoneroWalletFull } from 'monero-ts';
import { generateIdentity, signProof } from '../../../packages/protocol/src/identity.js';
import { identityProofBytes } from '../../../packages/trade/src/attestation.js';
import { codeOf, contextFor, DESKTOP, feeWallet, funder, mine, pay, PHONE, signUp, sql, stack, tradeView, txFee, type Size, type Trader } from './regtestKit.js';

const XMR = 1_000_000_000_000n;
/** The trade amount every spec types: 0.2 XMR ($40 at the fixed $200 price). */
const AMOUNT = 200_000_000_000n;
const FEE = AMOUNT / 100n;
const LONG = 5 * 60_000;

const offer = (side: 'sell' | 'buy') => ({
  side,
  currencies: [{ currency: 'USD', bands: [{ min: '20', max: '150', marginBps: 0, minTrades: null }] }],
  methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: 'My payment details come in the trade chat.' }],
  terms: 'Regtest e2e offer.',
});

interface TradeView {
  state: string;
  releasable: boolean;
  amountAtomic: string;
  funding: { sellerFundsAtomic: string; escrowAddress: string | null } | null;
  txHash: string | null;
  settling: string | null;
}

interface Open {
  code: string;
  seller: Trader;
  buyer: Trader;
  sellerPage: Page;
  buyerPage: Page;
  close(): Promise<void>;
}

/** The one-time tips a first trade shows ("Trading with more than one person?"), whenever they open. */
async function dismissTips(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByRole('button', { name: 'Got it' }), async (b) => b.click());
}

/**
 * The poster posts an offer; the taker browses, taps Trade on it, types 0.2 XMR and taps Trade;
 * the poster picks a wallet on the accepted-offer sheet. Ends with the seller asked to fund.
 */
async function openTrade(browser: Browser, size: Size, taker: 'seller' | 'buyer', o: { buyerPage?: (page: Page) => Promise<void>; beforeAccept?: (code: string) => Promise<void> } = {}): Promise<Open> {
  void funder(); // mined and synced while the trade is set up
  const poster = await signUp(taker === 'seller' ? 'buyer' : 'seller', { vendor: true });
  await poster.api.ok('POST', '/v1/offers', offer(taker === 'seller' ? 'buy' : 'sell'));
  const takerT = await signUp(taker);
  const p = await contextFor(browser, poster, size);
  const t = await contextFor(browser, takerT, size);
  await dismissTips(p.page);
  await dismissTips(t.page);
  await o.buyerPage?.(taker === 'seller' ? p.page : t.page);
  await p.page.goto('/sell');
  // The taker sells to a buy ad on /sell, buys from a sell ad on /buy.
  await t.page.goto(`/${taker === 'seller' ? 'sell' : 'buy'}/ZELLE?currency=USD`);
  await t.page.getByRole('button', { name: `Trade with ${poster.displayName}` }).click();
  // The amount in XMR (the buy quote opens in the fiat currency).
  await expect(t.page.locator('input[type=text]:visible').first()).toBeVisible();
  const inXmr = t.page.getByRole('button', { name: 'Enter XMR' });
  if (await inXmr.isVisible()) {
    await inXmr.click();
    await expect(t.page.getByRole('button', { name: /^Enter (USD|\$)/ })).toBeVisible();
  }
  await t.page.locator('input[type=text]:visible').first().fill('0.2');
  await t.page.locator('input[type=radio][name=wallet]').first().check();
  const trade = t.page.getByRole('button', { name: 'Trade', exact: true });
  if (!(await trade.isEnabled())) console.log(`quote (${taker}):\n${await t.page.evaluate(() => document.body.innerText)}\n${await t.page.evaluate(() => [...document.querySelectorAll('input')].map((i) => `${i.type}:${i.name}:${i.checked}:${i.value}`).join(' | '))}`);
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
async function shows(page: Page, re: RegExp, timeout = LONG, o: { mining?: boolean } = {}): Promise<void> {
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
async function inRooms(o: Open, body: () => Promise<void>): Promise<void> {
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

function xmrToAtomic(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(s.replace(/\s*XMR$/i, '').trim());
  if (!m) throw new Error(`not an XMR amount: ${s}`);
  return BigInt(m[1]!) * XMR + BigInt((m[2] ?? '').padEnd(12, '0'));
}

/** The seller's page copies the escrow address and the amount; returns both (read from the clipboard). */
async function copiedFunding(page: Page): Promise<{ address: string; atomic: bigint }> {
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
async function fund(o: Open, extra = 0n): Promise<bigint> {
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

async function markPaid(page: Page): Promise<void> {
  await page.getByRole('button', { name: "I've paid" }).click();
  await page.locator('.x2f-sheet-layer input[type=checkbox]').first().check();
  await page.getByRole('button', { name: 'Yes, mark as paid' }).click();
}

/** The seller ticks the check, holds "Payment received" and confirms the warning. */
async function holdToRelease(page: Page): Promise<void> {
  const hold = page.locator('button', { hasText: 'PAYMENT RECEIVED' });
  await expect(hold).toBeVisible({ timeout: 2 * 60_000 });
  await page.locator('input[type=checkbox]:visible').first().check();
  await expect(hold).toBeEnabled();
  const bb = (await hold.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await page.getByRole('button', { name: "It's in my account" }).click();
}

/** Waits until the API says one of `states`, mining a block every few seconds (the watcher runs every 15 s). */
async function untilState(t: Trader, code: string, states: string[], timeoutMs = LONG): Promise<TradeView> {
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
async function receivedIn(w: MoneroWalletFull, txHash: string): Promise<bigint> {
  await w.sync();
  const ts = (await w.getIncomingTransfers({} as never)).filter((t) => t.getTx().getHash() === txHash);
  return ts.reduce((s, t) => s + t.getAmount(), 0n);
}

/** The hashes of every transaction `w` has received. */
async function incomingTxs(w: MoneroWalletFull): Promise<Set<string>> {
  await w.sync();
  return new Set((await w.getIncomingTransfers({} as never)).map((t) => t.getTx().getHash()!));
}

/** The buyer's Cancel trade, then Cancel trade on the "Cancelling is likely final" sheet. */
async function buyerCancels(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cancel trade' }).click();
  await page.locator('.x2f-sheet-layer').getByRole('button', { name: 'Cancel trade' }).click();
}

const SIZES: Array<[string, Size]> = [['phone 390×844', PHONE], ['desktop 1280×800', DESKTOP]];

test("the production build serves monero-ts's wallet worker (Task 12: without it no escrow wallet starts in a browser)", () => {
  // KNOWN GAP: until it does, stack.ts copies monero-ts's file in so the trade specs can run.
  expect(stack().buildServesMoneroWorker).toBe(true);
});

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test('taker seller, poster buyer: the buyer receives amount − 1% − network fee, the fee wallet exactly 1%; only the buyer sees the fee row', async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        // The poster (buyer) pays the fee out of the escrow; the seller funds the amount only.
        expect(await fund(o)).toBe(AMOUNT);
        await markPaid(o.buyerPage);
        await holdToRelease(o.sellerPage);
        await shows(o.buyerPage, /RELEASED/, LONG, { mining: true });
        await shows(o.sellerPage, /RELEASED/, LONG, { mining: true });
        const v = await untilState(o.seller, o.code, ['released']);
        expect(v.txHash).toMatch(/^[0-9a-f]{64}$/);
        await mine(12);
        // The network fee comes off the buyer's payout, all of it.
        const network = await txFee(v.txHash!);
        expect(network).toBeGreaterThan(0n);
        expect(await receivedIn(o.buyer.wallet, v.txHash!)).toBe(AMOUNT - FEE - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(FEE);
        } finally {
          await fw.close();
        }
        await expect(o.buyerPage.getByText(/X2F fee \(1%/)).toBeVisible();
        await expect(o.sellerPage.getByText(/X2F fee/)).toHaveCount(0);
      });
    });

    test('taker buyer, poster seller: the seller funds amount + 1%; the buyer receives the amount less the network fee and never sees a fee', async ({ browser }) => {
      const o = await openTrade(browser, size, 'buyer');
      await inRooms(o, async () => {
        const feeOnBuyerPage: string[] = [];
        const noFee = async (where: string) => {
          if ((await o.buyerPage.getByText(/X2F fee|fee \(1%/).count()) > 0) feeOnBuyerPage.push(where);
        };
        await noFee('funding');
        expect(await fund(o)).toBe(AMOUNT + FEE);
        await noFee('secured');
        await markPaid(o.buyerPage);
        await noFee('paid');
        await holdToRelease(o.sellerPage);
        await shows(o.buyerPage, /RELEASED/, LONG, { mining: true });
        await noFee('released');
        const v = await untilState(o.buyer, o.code, ['released']);
        await mine(12);
        const network = await txFee(v.txHash!);
        expect(network).toBeGreaterThan(0n);
        expect(await receivedIn(o.buyer.wallet, v.txHash!)).toBe(AMOUNT - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(FEE);
        } finally {
          await fw.close();
        }
        expect(feeOnBuyerPage).toEqual([]);
      });
    });

    test("reload the seller's page while signing and the buyer's while co-signing: both resume, exactly one release tx, ending released", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        await fund(o);
        const before = await incomingTxs(o.buyer.wallet);
        await markPaid(o.buyerPage);
        await holdToRelease(o.sellerPage);
        await shows(o.sellerPage, /SIGNING|RELEASED/, 60_000);
        await o.sellerPage.reload();
        await shows(o.buyerPage, /RELEASING|RELEASED/, LONG, { mining: true });
        await o.buyerPage.reload();
        await shows(o.buyerPage, /RELEASED/, LONG, { mining: true });
        await shows(o.sellerPage, /RELEASED/, LONG, { mining: true });
        const v = await untilState(o.seller, o.code, ['released']);
        await mine(12);
        const fresh = [...(await incomingTxs(o.buyer.wallet))].filter((h) => !before.has(h));
        expect(fresh).toEqual([v.txHash]);
      });
    });

    // "Extra XMR replaces surplus to the ad poster" (plan Revision, Tasks 1, 2, 7, 9, 10, 12, 31):
    // extra coins before "I've paid" grow the trade; with a buyer poster the new amount is all
    // the escrow holds, and the fee is 1% of it.
    test('surplus at funding: the taker seller overpays a buyer ad by 0.0001 XMR; the trade grows to it, the buyer pays the grown total and receives it less 1% and the network fee; the fee wallet exactly 1%', async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        const extra = XMR / 10_000n;
        await fund(o, extra);
        const grown = AMOUNT + extra;
        await expect.poll(async () => BigInt((await tradeView<TradeView>(o.seller, o.code)).amountAtomic), { timeout: LONG }).toBe(grown);
        await shows(o.buyerPage, /Trade grew to 0\.200100 XMR, you now pay \$40\.02/);
        await markPaid(o.buyerPage);
        await holdToRelease(o.sellerPage);
        await shows(o.sellerPage, /RELEASED/, LONG, { mining: true });
        const v = await untilState(o.seller, o.code, ['released']);
        await mine(12);
        const network = await txFee(v.txHash!);
        expect(await receivedIn(o.buyer.wallet, v.txHash!)).toBe(grown - grown / 100n - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(grown / 100n);
        } finally {
          await fw.close();
        }
      });
    });

    test('surplus after secured: extra coins hold the release until they have 12 blocks, then everything is swept to the buyer', async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        const extra = XMR / 10_000n;
        await fund(o);
        expect((await tradeView<TradeView>(o.seller, o.code)).releasable).toBe(true);
        await pay((await tradeView<TradeView>(o.seller, o.code)).funding?.escrowAddress ?? (await sql<{ escrow_address: string }>('select escrow_address from trades where code = $1', [o.code]))[0]!.escrow_address, extra);
        await mine(1);
        await expect.poll(async () => (await tradeView<TradeView>(o.seller, o.code)).releasable, { timeout: LONG }).toBe(false);
        await mine(12);
        await expect.poll(async () => (await tradeView<TradeView>(o.seller, o.code)).releasable, { timeout: LONG }).toBe(true);
        const grown = AMOUNT + extra;
        await expect.poll(async () => BigInt((await tradeView<TradeView>(o.seller, o.code)).amountAtomic), { timeout: LONG }).toBe(grown);
        await markPaid(o.buyerPage);
        await holdToRelease(o.sellerPage);
        await shows(o.sellerPage, /RELEASED/, LONG, { mining: true });
        const v = await untilState(o.seller, o.code, ['released']);
        await mine(12);
        const network = await txFee(v.txHash!);
        expect(await receivedIn(o.buyer.wallet, v.txHash!)).toBe(grown - grown / 100n - network);
      });
    });

    test("mutual cancel after funding: the seller's proposal, the buyer's Accept; the XMR goes back to the seller with no fee output", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        const funds = await fund(o);
        // No room offers the seller a Propose cancel any more (proto review P2), so the proposal
        // is the seller's own API call; the buyer answers it in the room.
        await o.seller.api.ok('POST', `/v1/trades/${o.code}/events`, { type: 'propose-cancel' });
        await o.buyerPage.reload();
        await o.buyerPage.getByRole('button', { name: 'Accept' }).click();
        const v = await untilState(o.seller, o.code, ['refunded', 'cancelled']);
        expect(v.txHash).toMatch(/^[0-9a-f]{64}$/);
        await mine(12);
        const network = await txFee(v.txHash!);
        expect(await receivedIn(o.seller.wallet, v.txHash!)).toBe(funds - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(0n);
        } finally {
          await fw.close();
        }
      });
    });

    test("buyer cancel before I've paid: the seller's refund address gets the balance less the network fee with the seller's page closed; Confirm cancel waits for 10 confirmations", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        const funds = await fund(o);
        await o.sellerPage.context().close();
        await buyerCancels(o.buyerPage);
        const v = await untilState(o.buyer, o.code, ['refunded', 'cancelled']);
        expect(v.txHash).toMatch(/^[0-9a-f]{64}$/);
        const network = await txFee(v.txHash!);
        expect(await receivedIn(o.seller.wallet, v.txHash!)).toBe(funds - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(0n);
        } finally {
          await fw.close();
        }
        // The seller comes back: Confirm cancel is greyed out until the return has 10 confirmations.
        const back = await contextFor(browser, o.seller, size);
        o.sellerPage = back.page;
        const close = o.close;
        o.close = async () => {
          await back.context.close();
          await close();
        };
        await dismissTips(back.page);
        await back.page.goto(`/trade/${o.code}`);
        const confirm = back.page.getByRole('button', { name: 'Confirm cancel' });
        await expect(confirm).toBeVisible({ timeout: LONG });
        await mine(12);
        await expect(confirm).toBeEnabled({ timeout: LONG });
        await shows(back.page, /Your input is needed to cancel this trade/);
        await confirm.click();
        // Confirmed: the trade stays refunded, with the seller's confirmation recorded.
        await expect.poll(async () => (await tradeView<{ cancelConfirmedAt: string | null }>(o.seller, o.code)).cancelConfirmedAt, { timeout: 2 * 60_000 }).not.toBeNull();
        await expect(confirm).toHaveCount(0);
      });
    });

    test("buyer cancel ignored by the seller: the trade closes as cancelled 48 h after Confirm cancel became available", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        await fund(o);
        await buyerCancels(o.buyerPage);
        await untilState(o.buyer, o.code, ['refunded']);
        await mine(12);
        await expect.poll(async () => (await sql('select cancel_confirmable_at from trades where code = $1', [o.code]))[0]!.cancel_confirmable_at, { timeout: LONG }).not.toBeNull();
        // The clock 48 h on: the API's timer loop closes it (cancel-timeout records the confirmation).
        await sql("update trades set cancel_confirmable_at = now() - interval '48 hours 1 second' where code = $1", [o.code]);
        await expect.poll(async () => (await tradeView<{ cancelConfirmedAt: string | null }>(o.seller, o.code)).cancelConfirmedAt, { timeout: 3 * 60_000 }).not.toBeNull();
      });
    });

    test("buyer no-show: past the time to pay the seller taps Cancel and get refund; the buyer stays silent with the room open; the refund lands with the seller's page closed", async ({ browser }) => {
      // A 1-minute time to pay (the method's window is fixed at take and signed into the terms the
      // moderation attests, so it is set before the poster accepts; the set-once guard is lifted
      // for this one update in the throwaway database).
      const o = await openTrade(browser, size, 'seller', {
        beforeAccept: async (code) => {
          await sql('alter table trades disable trigger trades_set_once_pay_window');
          try {
            await sql('update trades set pay_window_min = 1 where code = $1', [code]);
          } finally {
            await sql('alter table trades enable trigger trades_set_once_pay_window');
          }
        },
      });
      await inRooms(o, async () => {
        const funds = await fund(o);
        await shows(o.sellerPage, /didn't mark the payment in time/, 3 * 60_000);
        await o.sellerPage.getByRole('button', { name: 'Cancel and get refund' }).click();
        await shows(o.sellerPage, /Your XMR is on its way back/);
        await o.sellerPage.waitForTimeout(10_000);
        await o.sellerPage.context().close();
        const v = await untilState(o.buyer, o.code, ['refunded']);
        expect(v.txHash).toMatch(/^[0-9a-f]{64}$/);
        await mine(12);
        const network = await txFee(v.txHash!);
        expect(await receivedIn(o.seller.wallet, v.txHash!)).toBe(funds - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(0n);
        } finally {
          await fw.close();
        }
      });
    });

    test("swapped participants: the API holds another key as the buyer's; the buyer's room says Security check failed, the seller is never asked to fund and no check words match", async ({ browser }) => {
      // Stands in for an API that swaps the buyer's identity: the buyer's registration reaches it
      // carrying another key pair (with a valid proof for this trade and role).
      const o = await openTrade(browser, size, 'seller', {
        buyerPage: async (page) => {
          await page.context().route('**/v1/trades/*/identity', async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            const code = decodeURIComponent(/\/v1\/trades\/([^/]+)\/identity/.exec(route.request().url())![1]!);
            const other = await generateIdentity();
            const proof = await signProof(other, identityProofBytes(code, 'buyer', other.signPublic, other.boxPublic));
            await route.continue({ postData: JSON.stringify({ signPublic: other.signPublic, boxPublic: other.boxPublic, proof }) });
          });
        },
      });
      await inRooms(o, async () => {
        await shows(o.buyerPage, /Security check failed/);
        await expect(o.buyerPage.getByRole('button', { name: /Copy address/ })).toHaveCount(0);
        // The escrow cannot be set up with a buyer key the buyer's device does not hold: the
        // seller is never asked to fund, and no check words on the two screens ever match.
        const words = async (page: Page) => (await page.locator('[data-escrow-check] li').allInnerTexts()).join(' ');
        for (let i = 0; i < 12; i++) {
          await expect(o.sellerPage.getByRole('button', { name: 'Copy address' })).toHaveCount(0);
          const [sw, bw] = [await words(o.sellerPage), await words(o.buyerPage)];
          if (sw !== '' && bw !== '') expect(sw).not.toBe(bw);
          await o.sellerPage.waitForTimeout(5000);
        }
      });
    });

    // The buyer's lapse copy says the trade was cancelled and there is nothing to do; the plan's
    // "no penalty" wording is not on the screen (copy question in the Task 31 report).
    test("lapse: the seller never funds; the buyer's room says the trade ended and asks nothing of them", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        await copiedFunding(o.sellerPage);
        // The clock past fundBy: the API's timer loop lapses the trade on its next pass.
        await sql("update trades set fund_by = now() - interval '1 second' where code = $1", [o.code]);
        await untilState(o.buyer, o.code, ['lapsed', 'cancelled'], 3 * 60_000);
        await o.buyerPage.reload();
        await shows(o.buyerPage, /CANCELLED/, 30_000);
        await shows(o.buyerPage, /time to fund ran out/i, 30_000);
        await shows(o.buyerPage, /You don't need to do anything/, 30_000);
      });
    });
  });
}
