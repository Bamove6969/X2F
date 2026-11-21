/**
 * Plan 3 Task 31: end-to-end trades between two browsers on regtest, at 390×844 and 1280×800.
 * Everything is real: the production build, the API, the relay, the node proxy, the moderation
 * process and monerod (stack.ts). Each trader's escrow wallet runs in their own browser context.
 * Funding pays the address and amount the seller's page copies; every check of money reads the
 * receiving wallet itself.
 */
import { expect, test, type Page } from '@playwright/test';
import { feeFor } from '@x2f/core';
import { foreignIdentityRegistration } from '../../../tools/regtest/e2e/foreignIdentity.js';
import { modHoldsSellerSet } from '../../../tools/regtest/e2e/modState.js';
import { contextFor, DESKTOP, feeWallet, mine, pay, PHONE, sql, stack, tradeView, txFee, type Size } from './regtestKit.js';
import { AMOUNT, buyerCancels, copiedFunding, dismissTips, FEE, fund, holdToRelease, inRooms, incomingTxs, LONG, markPaid, openTrade, receivedIn, shows, untilState, XMR, type TradeView } from './tradeFlow.js';

const SIZES: Array<[string, Size]> = [['phone 390×844', PHONE], ['desktop 1280×800', DESKTOP]];

/**
 * A 1-minute time to pay (the method's window is fixed at take and signed into the terms the
 * moderation attests, so it is set before the poster accepts; the set-once guard is lifted for this
 * one update in the throwaway database).
 */
async function oneMinuteToPay(code: string): Promise<void> {
  await sql('alter table trades disable trigger trades_set_once_pay_window');
  try {
    await sql('update trades set pay_window_min = 1 where code = $1', [code]);
  } finally {
    await sql('alter table trades enable trigger trades_set_once_pay_window');
  }
}

/** Past the time to pay, the seller taps Cancel and get refund (the buyer stays silent). */
async function cancelAndRefund(page: Page): Promise<void> {
  await shows(page, /didn't mark the payment in time/, 3 * 60_000);
  await page.getByRole('button', { name: 'Cancel and get refund' }).click();
  await shows(page, /Your XMR is on its way back/);
}

/**
 * The seller's room says the page may close: "You can close this page now" (the refund in a block,
 * the room still settling) or, once the API has moved on, the refunded room with this device done.
 * A block comes every 5 s meanwhile.
 */
async function mayClose(page: Page): Promise<void> {
  const until = Date.now() + 3 * 60_000;
  let next = 0;
  for (;;) {
    if (/You can close this page now/.test(await page.evaluate(() => document.body.innerText))) return;
    if ((await page.locator('[data-screen-part="seller-refunded"][data-escrow-phase="done"]').count()) > 0) return;
    if (Date.now() > until) throw new Error(`${page.url()} never said the page may close`);
    if (Date.now() >= next) {
      await mine(1);
      next = Date.now() + 5000;
    }
    await page.waitForTimeout(500);
  }
}

/** The trade ends refunded; the seller's wallet gets everything less the network fee, the fee wallet nothing. */
async function refundLanded(o: { buyer: Parameters<typeof untilState>[0]; seller: { wallet: Parameters<typeof receivedIn>[0] }; code: string }, funds: bigint): Promise<void> {
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
}

test("the production build serves monero-ts's wallet worker (Task 12: without it no escrow wallet starts in a browser)", async () => {
  // Gap 1, fixed on main: the build copies it to /monero/ and the API serves it; stack.ts copies nothing in.
  const res = await fetch(`${stack().origin}/monero/monero.worker.js`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/javascript/);
  expect((await res.text()).length).toBeGreaterThan(1000);
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
        expect(await receivedIn(o.buyer.wallet, v.txHash!)).toBe(grown - feeFor(grown) - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(feeFor(grown));
        } finally {
          await fw.close();
        }
      });
    });

    test('surplus after secured: extra coins hold the release until they have 12 blocks, then everything is swept to the buyer less 1% of the grown amount and the network fee; the fee wallet exactly 1% of the grown amount', async ({ browser }) => {
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
        // The fee output is always feeFor(amount) of the grown amount (packages/trade payouts.ts).
        expect(await receivedIn(o.buyer.wallet, v.txHash!)).toBe(grown - feeFor(grown) - network);
        const fw = await feeWallet();
        try {
          expect(await receivedIn(fw, v.txHash!)).toBe(feeFor(grown));
        } finally {
          await fw.close();
        }
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
        // Both sides accepted: the trade settles as a mutual cancel (machine.ts keeps `settling`
        // set to the kind once the trade closes, so a fast close still passes this).
        await expect.poll(async () => {
          const t = await tradeView<TradeView>(o.seller, o.code);
          return `${t.state} ${t.settling}`;
        }, { timeout: LONG }).toMatch(/^(settling|refunded|cancelled) mutual-cancel$/);
        // KNOWN GAP 3 (Plan 3 Task 31): a mutual cancel after funding never completes; the trade
        // stays settling, so untilState below throws "settling, not refunded/cancelled". The fix
        // waits on an owner decision. The marker covers only this wait and what follows it: a break
        // in any step above is a real failure. Once the gap is fixed this spec passes, Playwright
        // reports it as an unexpected pass, and the marker must be removed.
        test.fail(true, 'gap 3: mutual cancel after funding stays settling (owner decision pending)');
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

    test("buyer cancel ignored by the seller: the seller's wallet gets the balance less the network fee, the fee wallet nothing; 48 h after Confirm cancel became available the trade stays refunded with the seller's confirmation recorded", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        const funds = await fund(o);
        await buyerCancels(o.buyerPage);
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
        await expect.poll(async () => (await sql('select cancel_confirmable_at from trades where code = $1', [o.code]))[0]!.cancel_confirmable_at, { timeout: LONG }).not.toBeNull();
        // The clock 48 h on: the API's timer loop closes it (cancel-timeout records the confirmation).
        await sql("update trades set cancel_confirmable_at = now() - interval '48 hours 1 second' where code = $1", [o.code]);
        await expect.poll(async () => (await tradeView<{ cancelConfirmedAt: string | null }>(o.seller, o.code)).cancelConfirmedAt, { timeout: 3 * 60_000 }).not.toBeNull();
        // machine.ts (cancel-timeout, confirm-cancel): the confirmation is recorded on the refunded trade; it never becomes cancelled.
        const after = await tradeView<TradeView>(o.seller, o.code);
        expect(after.state).toBe('refunded');
        expect(after.txHash).toBe(v.txHash);
      });
    });

    // Gap 4 (20 Nov): the no-show refund is seller-built (builder seller, co-signer mod, Task 25), so
    // it needs the seller's device until the moderator has sent it, and the page may close once the
    // device saw it in a block (security review M1 a). A page closed earlier pauses the refund
    // until the trade is opened again on that device.
    test("buyer no-show: past the time to pay the seller taps Cancel and get refund; the buyer stays silent with the room open; the room says to keep the page open, that the moderator sent it, then (in a block) that it may close; closed then (the whole browser profile gone), the refund lands", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller', { beforeAccept: oneMinuteToPay });
      await inRooms(o, async () => {
        const funds = await fund(o);
        await cancelAndRefund(o.sellerPage);
        await shows(o.sellerPage, /Keep this page open while this device signs the refund/);
        // No block yet: the moderator's report alone never says the page may close.
        await shows(o.sellerPage, /The moderator has sent the refund\. Keep this page open a few minutes while it confirms\./, 3 * 60_000);
        expect(await o.sellerPage.evaluate(() => document.body.innerText)).not.toMatch(/You can close this page/);
        await mayClose(o.sellerPage);
        await o.sellerPage.context().close();
        await refundLanded(o, funds);
      });
    });

    // Security review M1: the seller closes the tab once the moderator reported the refund sent, the
    // trade closes without the seller (its relay channels with it), and the seller opens the trade
    // again later: the device proves its own refund landed and ends done, never "settled elsewhere"
    // (an integrity failure), also past the 5-minute settled-elsewhere grace.
    test("buyer no-show: the seller closes the tab once the moderator sent the refund; the trade closes; reopened later, the room shows the refund done, never an escrow failure", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller', { beforeAccept: oneMinuteToPay });
      await inRooms(o, async () => {
        const funds = await fund(o);
        await cancelAndRefund(o.sellerPage);
        await shows(o.sellerPage, /The moderator has sent the refund\./, 3 * 60_000);
        const context = o.sellerPage.context();
        await o.sellerPage.close(); // the tab only: the device keeps its escrow store
        await untilState(o.buyer, o.code, ['refunded']);
        await mine(2);
        await new Promise((r) => setTimeout(r, 20_000)); // the watcher closes the trade's relay channels
        o.sellerPage = await context.newPage();
        await dismissTips(o.sellerPage);
        await o.sellerPage.goto(`/trade/${o.code}`);
        const room = o.sellerPage.locator('[data-screen-part="seller-refunded"]');
        await expect(room).toBeVisible({ timeout: 60_000 });
        await expect(room).toHaveAttribute('data-escrow-phase', 'done', { timeout: 3 * 60_000 });
        // Past the settled-elsewhere grace (5 min), blocks coming: still done, nothing stopped.
        const until = Date.now() + 6 * 60_000;
        while (Date.now() < until) {
          await mine(1);
          expect(await o.sellerPage.locator('[data-refund-escrow-stopped]').count()).toBe(0);
          await expect(room).toHaveAttribute('data-escrow-phase', 'done');
          await o.sellerPage.waitForTimeout(10_000);
        }
        await refundLanded(o, funds);
      });
    });

    // Security review M1, the builder's own follow-up (lead 20 Nov): the seller's tab closes the moment
    // the moderator holds the seller's export and tx set for its current attempt, before it signed,
    // submitted or sent its DONE. The
    // trade closes without the seller (its relay channels with it, so no DONE is ever delivered), and
    // the trade opened again later proves its own refund by its tx key (check_tx_key through the node
    // proxy): done, never an escrow failure, also past the 5-minute settled-elsewhere grace.
    test("buyer no-show: the seller's tab closes before the moderator's DONE; the trade closes; reopened later, the device proves its refund by its tx key and ends done, never an escrow failure", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller', { beforeAccept: oneMinuteToPay });
      await inRooms(o, async () => {
        const funds = await fund(o);
        await cancelAndRefund(o.sellerPage);
        const until = Date.now() + 3 * 60_000;
        while (!(await modHoldsSellerSet(stack(), o.code))) {
          if (Date.now() > until) throw new Error('the seller\'s tx set never reached the moderator');
          await new Promise((r) => setTimeout(r, 100));
        }
        const before = await o.sellerPage.evaluate(() => document.body.innerText);
        const context = o.sellerPage.context();
        await o.sellerPage.close(); // the tab only: the device keeps its escrow store
        expect(before).not.toMatch(/The moderator has sent the refund/); // closed before any DONE
        await untilState(o.buyer, o.code, ['refunded']);
        await mine(2);
        await new Promise((r) => setTimeout(r, 20_000)); // the watcher closes the trade's relay channels
        o.sellerPage = await context.newPage();
        await dismissTips(o.sellerPage);
        await o.sellerPage.goto(`/trade/${o.code}`);
        const room = o.sellerPage.locator('[data-screen-part="seller-refunded"]');
        await expect(room).toBeVisible({ timeout: 60_000 });
        await expect(room).toHaveAttribute('data-escrow-phase', 'done', { timeout: 3 * 60_000 });
        const grace = Date.now() + 6 * 60_000;
        while (Date.now() < grace) {
          await mine(1);
          expect(await o.sellerPage.locator('[data-refund-escrow-stopped]').count()).toBe(0);
          await expect(room).toHaveAttribute('data-escrow-phase', 'done');
          await o.sellerPage.waitForTimeout(10_000);
        }
        await refundLanded(o, funds);
      });
    });

    test("buyer no-show: the seller closes the page while it still says to keep it open; the refund waits; opening the trade again on the same device finishes it", async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller', { beforeAccept: oneMinuteToPay });
      await inRooms(o, async () => {
        const funds = await fund(o);
        await cancelAndRefund(o.sellerPage);
        await shows(o.sellerPage, /Keep this page open while this device signs the refund/);
        const context = o.sellerPage.context();
        await o.sellerPage.close(); // the tab only: the device keeps its escrow store
        await expect(untilState(o.buyer, o.code, ['refunded'], 90_000)).rejects.toThrow(/is settling/);
        o.sellerPage = await context.newPage();
        await dismissTips(o.sellerPage);
        await o.sellerPage.goto(`/trade/${o.code}`);
        await mayClose(o.sellerPage);
        await refundLanded(o, funds);
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
            await route.continue({ postData: JSON.stringify(await foreignIdentityRegistration(code, 'buyer')) });
          });
        },
      });
      await inRooms(o, async () => {
        await shows(o.buyerPage, /Security check failed/);
        await expect(o.buyerPage.getByRole('button', { name: /Copy address/ })).toHaveCount(0);
        // The escrow cannot be set up with a buyer key the buyer's device does not hold: the trade
        // never gets an escrow address, the seller is never asked to fund, and no check words on the
        // two screens ever match. The words come only from a finished escrow's address
        // (escrow/runtime.ts, escrowCheckWords), so with none they never render on either screen:
        // words shown on either side would mean an escrow was set up after all, and fail here.
        const words = async (page: Page) => (await page.locator('[data-escrow-check] li').allInnerTexts()).join(' ');
        for (let i = 0; i < 12; i++) {
          expect((await tradeView<TradeView>(o.seller, o.code)).funding?.escrowAddress ?? null).toBeNull();
          expect((await sql<{ escrow_address: string | null }>('select escrow_address from trades where code = $1', [o.code]))[0]!.escrow_address).toBeNull();
          await expect(o.sellerPage.getByRole('button', { name: 'Copy address' })).toHaveCount(0);
          const [sw, bw] = [await words(o.sellerPage), await words(o.buyerPage)];
          if (sw !== '' && bw !== '') expect(sw).not.toBe(bw);
          expect({ seller: sw, buyer: bw }).toEqual({ seller: '', buyer: '' });
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
