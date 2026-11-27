/**
 * Plan 4 Task 21: end-to-end dispute flows on regtest. Everything is real: the production trader
 * and staff builds, the API with its staff listener, the relay, the node proxy, the moderation
 * process with its ruling gate (the owner pinned with pin-owner), and monerod (stack.ts with
 * staffStack.ts). Traders act in their own browser contexts at 390×844 and 1280×800; staff at
 * 1280×800 on the staff origin, tapping a soft security key held by the browser's virtual
 * authenticator. Every payout is checked in the receiving wallets themselves, in exact atomic
 * amounts (and the fee wallet's), never on a screen alone.
 *
 * Where the plan's Task 21 text predates a later owner revision, the revision is what is checked,
 * and the row says so (Revision 2026-10-29: coins move at the ruling; a won appeal fixes the record
 * and never moves the coins again).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { LoginHours } from '@x2f/staff';
import { DESKTOP, mine, pay, PHONE, sql, stack, type Size } from '../../web/e2e/regtestKit.js';
import { AMOUNT, dismissTips, FEE, fund, holdToRelease, inRooms, incomingTxs, LONG, markPaid, openTrade, receivedIn, shows, untilState, XMR, type Open } from '../../web/e2e/tradeFlow.js';
import {
  appeal,
  approveRuling,
  caseOf,
  caseUrl,
  disputeUrl,
  feeIn,
  inOrder,
  logFor,
  messageBoth,
  openChat,
  openDispute,
  pastConfirmBy,
  proposeRuling,
  settled,
  takeCase,
  tapKey,
  txFee,
} from './disputeFlow.js';
import { hire, owner, setLargeTradeLimit, staffPage, type Staffer } from './staffKit.js';

const SIZES: Array<[string, Size]> = [['phone 390×844', PHONE], ['desktop 1280×800', DESKTOP]];

/**
 * Found by this spec (22 Nov 2026) and fixed on wip/lead-fix-ruling-pay: the winner's app never
 * co-signed the moderator-built ruling set (no ruling statement reached cosignPolicy), and after a
 * refund the seller's /dispute page showed a seller-sends-xmr ruling without the tx-proof form.
 */
/** How long a row waits for a ruling's payout (a mod-built release on regtest takes 2-3 minutes). */
const PAYOUT_WAIT = 4 * 60_000;

const NOTE = 'I paid by Zelle and the seller stopped answering.';

/** Funded, paid, the seller silent past confirmBy, and the buyer's dispute opened in the browser. */
async function disputed(o: Open): Promise<bigint> {
  const funds = await fund(o);
  await markPaid(o.buyerPage);
  // The buyer's device records "I've paid" (a signed event) a moment after the tap.
  await untilState(o.buyer, o.code, ['paid']);
  await pastConfirmBy(o.code);
  await openDispute(o.buyerPage, o.code, { reason: /I paid, but the seller hasn't released/, note: NOTE });
  return funds;
}

/** A staff page for `p` that closes with the trade's rooms. */
async function withStaff<T>(browser: Browser, p: Staffer, body: (page: Page) => Promise<T>, o: { keys?: number[] } = {}): Promise<T> {
  const s = await staffPage(browser, p, DESKTOP, o);
  try {
    return await body(s.page);
  } finally {
    await s.close();
  }
}

/**
 * A wallet's incoming txs, for a row's "before" snapshot and its checks (review p4t22 re-review, the desktop flakes):
 * the wallet caches the daemon's height when it is made, so its connection is refreshed first and
 * the sync then reaches the chain as it is now. A stale snapshot made later txs of the run look new.
 */
async function walletSnapshot(w: Parameters<typeof incomingTxs>[0]): Promise<Set<string>> {
  await w.setDaemonConnection({ uri: stack().monerod });
  return incomingTxs(w);
}

/** The buyer is paid `toBuyer − network fee` in `tx`, the fee wallet exactly `fee`, the seller nothing. */
async function buyerPaid(o: Open, tx: string, toBuyer: bigint, fee: bigint): Promise<void> {
  await mine(12);
  const network = await txFee(tx);
  expect(network).toBeGreaterThan(0n);
  expect(await receivedIn(o.buyer.wallet, tx)).toBe(toBuyer - network);
  expect(await feeIn(tx)).toBe(fee);
  expect(await receivedIn(o.seller.wallet, tx)).toBe(0n);
}

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test('below the limit, buyer wins: the buyer disputes past confirmBy; the moderator takes it, joins the chat, messages both and rules with a tap; the traders see the ruling and the 48 h appeal window; the buyer receives amount − 1% − network fee, the fee wallet exactly 1%; the log has every step in order', async ({ browser }) => {
      const mod = await hire('mod');
      // Taker seller, poster buyer: the poster pays the 1% out of the escrow.
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, () =>
        withStaff(browser, mod, async (staff) => {
          expect(await disputed(o)).toBe(AMOUNT);
          await takeCase(staff, o.code);
          await openChat(staff);
          // The API announces a moderator to the traders with their first message (staffRoutes
          // `announce`), not at the chat read: then both see the join card and the message.
          await messageBoth(staff, 'Hello both. Seller, please show whether the payment arrived.');
          for (const page of [o.buyerPage, o.sellerPage]) {
            await page.goto(disputeUrl(o.code));
            await expect(page.getByLabel('Moderator joined')).toContainText(`Moderator ${mod.tradeTag} joined this dispute`, { timeout: LONG });
            await shows(page, /Seller, please show whether the payment arrived/);
            // The message carries the X2F Moderator badge.
            await expect(page.getByText('X2F Moderator').first()).toBeVisible();
          }

          await proposeRuling(staff, 'Release to buyer');
          for (const page of [o.buyerPage, o.sellerPage]) {
            await expect(page.getByRole('region', { name: 'Appeal' })).toContainText(/\(48 h\)/, { timeout: LONG });
          }
          // Revision 2026-10-29: the payout is at the ruling (the moderator builds, the buyer's app completes).
          const tx = await settled(o.buyer, o.code, 'released', PAYOUT_WAIT);
          await buyerPaid(o, tx, AMOUNT - FEE, FEE);

          const log = await logFor(o.code);
          expect(inOrder(log, ['dispute.opened', 'dispute.assigned', 'chat.read', 'chat.message-sent', 'ruling.proposed', 'ruling.published', 'ruling.executed']), log.join(', ')).toBe(true);
        }),
      );
    });

    test('above the limit (the owner lowers it to 30 USD for this 40 USD trade): the moderator proposes, nothing moves before approval; the owner approves with the spare key; the buyer receives amount − 1% − network fee, the fee wallet exactly 1%', async ({ browser }) => {
      const mod = await hire('mod');
      // New traders are held to the starter limit ($200 a trade), so the trade stays $40 and the
      // owner lowers the large-trade limit to $30 for this row (a tapped settings change), then
      // puts it back.
      const limit = await setLargeTradeLimit(30);
      const six = AMOUNT;
      const fee6 = FEE;
      const o = await openTrade(browser, size, 'seller');
      const own = await owner();
      try {
      await inRooms(o, async () => {
        expect(await disputed(o)).toBe(six);
        const before = { buyer: await walletSnapshot(o.buyer.wallet), seller: await walletSnapshot(o.seller.wallet) };
        await withStaff(browser, mod, async (staff) => {
          await takeCase(staff, o.code);
          await expect(staff.locator('[data-part="case-chips"]')).toContainText('Above the');
          await proposeRuling(staff, 'Release to buyer');
          await expect(staff.locator('[data-part="ruling-waiting"]')).toContainText('Waiting for approval', { timeout: LONG });
        });
        // Nothing moves before approval: blocks come and go, the trade stays disputed, no wallet receives anything.
        for (let i = 0; i < 6; i++) {
          await mine(1);
          await new Promise((r) => setTimeout(r, 5000));
        }
        expect((await caseOf(o.code)).status).toBe('awaiting-approval');
        expect((await untilState(o.buyer, o.code, ['disputed'], 10_000)).state).toBe('disputed');
        expect(await walletSnapshot(o.buyer.wallet)).toEqual(before.buyer);
        expect(await walletSnapshot(o.seller.wallet)).toEqual(before.seller);
        // The owner approves with the spare key (the only key in this browser).
        await withStaff(browser, own, async (staff) => {
          await staff.goto(caseUrl(o.code));
          await approveRuling(staff);
        }, { keys: [1] });
        const tx = await settled(o.buyer, o.code, 'released', PAYOUT_WAIT);
        await buyerPaid(o, tx, six - fee6, fee6);
        const log = await logFor(o.code);
        expect(inOrder(log, ['dispute.opened', 'dispute.assigned', 'ruling.proposed', 'ruling.approved', 'ruling.published', 'ruling.executed']), log.join(', ')).toBe(true);
      });
      } finally {
        await setLargeTradeLimit(limit);
      }
    });

    test('review p4t22 M1 (lead default, owner question OQ1): a EUR trade far under the limit needs two people; the moderator proposes, nothing moves; the owner approves; the buyer receives amount − 1% − network fee, the fee wallet exactly 1%', async ({ browser }) => {
      const mod = await hire('mod');
      // EUR 40 at the fixed feed (1 EUR = 1 USD): far under the $1,000 limit. Before the fix the API
      // published it on one tap and the ruling gate refused it for good (needs-second): stranded coins.
      const o = await openTrade(browser, size, 'seller', { currency: 'EUR' });
      const own = await owner();
      await inRooms(o, async () => {
        expect(await disputed(o)).toBe(AMOUNT);
        const before = { buyer: await walletSnapshot(o.buyer.wallet), seller: await walletSnapshot(o.seller.wallet) };
        await withStaff(browser, mod, async (staff) => {
          await takeCase(staff, o.code);
          await expect(staff.locator('[data-part="case-chips"]')).toContainText('Needs a second approval: not in US dollars');
          await proposeRuling(staff, 'Release to buyer');
          await expect(staff.locator('[data-part="ruling-waiting"]')).toContainText('Waiting for approval', { timeout: LONG });
        });
        // The same wait as the above-limit row (review p4t22 re-review: the EUR row's co-sign ran slow).
        for (let i = 0; i < 6; i++) {
          await mine(1);
          await new Promise((r) => setTimeout(r, 5000));
        }
        expect((await caseOf(o.code)).status).toBe('awaiting-approval');
        expect((await untilState(o.buyer, o.code, ['disputed'], 10_000)).state).toBe('disputed');
        expect(await walletSnapshot(o.buyer.wallet)).toEqual(before.buyer);
        expect(await walletSnapshot(o.seller.wallet)).toEqual(before.seller);
        await withStaff(browser, own, async (staff) => {
          await staff.goto(caseUrl(o.code));
          await approveRuling(staff);
        }, { keys: [1] });
        const tx = await settled(o.buyer, o.code, 'released', PAYOUT_WAIT);
        await buyerPaid(o, tx, AMOUNT - FEE, FEE);
        const log = await logFor(o.code);
        expect(inOrder(log, ['dispute.opened', 'ruling.proposed', 'ruling.approved', 'ruling.published', 'ruling.executed']), log.join(', ')).toBe(true);
        // The gate never refused it.
        expect(log).not.toContain('ruling.gate-refused');
      });
    });

    test('appeal overturns: the seller appeals inside the window; a fresh senior moderator reviews and overturns; the round-1 payout stands (no second tx, Revision 2026-10-29) and the moderator\'s round-1 ruling counts as overturned on Performance', async ({ browser }) => {
      const mod = await hire('mod');
      const senior = await hire('senior');
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        await disputed(o);
        const before = { buyer: await walletSnapshot(o.buyer.wallet), seller: await walletSnapshot(o.seller.wallet) };
        await withStaff(browser, mod, async (staff) => {
          await takeCase(staff, o.code);
          await proposeRuling(staff, 'Release to buyer');
        });
        // Review p4t22 m1 (lead default, owner question OQ2): round 1's payout stands once it ran;
        // an appeal decided before it ran pays round 2 instead (covered by the unit and API tests).
        // So this row waits for round 1's payout before the appeal is decided.
        const tx = await settled(o.buyer, o.code, 'released', PAYOUT_WAIT);

        await o.sellerPage.goto(disputeUrl(o.code));
        await appeal(o.sellerPage, 'I never received the Zelle payment; my bank statement shows nothing that day.');
        await expect.poll(async () => (await caseOf(o.code)).status, { timeout: LONG }).toBe('appealed');
        await withStaff(browser, senior, async (staff) => {
          await takeCase(staff, o.code);
          await proposeRuling(staff, 'Refund to seller', 'On appeal: the seller showed the bank statement; no payment arrived that day.');
          if ((await caseOf(o.code)).status === 'awaiting-approval') throw new Error('the appeal ruling waits for an approval this row does not expect');
        });
        await expect.poll(async () => (await caseOf(o.code)).status, { timeout: LONG }).toMatch(/final|closed/);
        // Performance: the moderator's round-1 ruling is overturned.
        await withStaff(browser, await owner(), async (staff) => {
          await staff.goto('/performance');
          const row = staff.locator('tr', { hasText: mod.tradeTag });
          await expect(row.locator('[data-part="overturned"]')).toHaveText(/^1 of \d+$/, { timeout: LONG });
        });
        // Revision 2026-10-29: the round-1 ruling paid out at once, exactly once, and the overturn moves
        // no coins again (a lien goes on the buyer instead, Task 25).
        await buyerPaid(o, tx, AMOUNT - FEE, FEE);
        for (let i = 0; i < 4; i++) await mine(1);
        expect([...(await walletSnapshot(o.buyer.wallet))].filter((h) => !before.buyer.has(h))).toEqual([tx]);
        expect([...(await walletSnapshot(o.seller.wallet))].filter((h) => !before.seller.has(h))).toEqual([]);
      });
    });

    test('winner offline: the buyer closes X2F before the ruling; the seller\'s room says it waits for the buyer to open X2F; the buyer opens it again and the release completes; exactly one tx, the buyer paid amount − 1% − network fee, the fee wallet exactly 1%', async ({ browser }) => {
      const mod = await hire('mod');
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        await disputed(o);
        const before = { buyer: await walletSnapshot(o.buyer.wallet), seller: await walletSnapshot(o.seller.wallet) };
        // The buyer's X2F is closed (the tab), the device keeps its data.
        const buyerContext = o.buyerPage.context();
        await o.buyerPage.close();
        await withStaff(browser, mod, async (staff) => {
          await takeCase(staff, o.code);
          await proposeRuling(staff, 'Release to buyer');
        });
        await o.sellerPage.goto(disputeUrl(o.code));
        await shows(o.sellerPage, new RegExp(`Waiting for ${o.buyer.tradeTag} to open X2F`), LONG, { mining: true });
        // Nothing is broadcast while the winner is away.
        expect(await walletSnapshot(o.buyer.wallet)).toEqual(before.buyer);
        o.buyerPage = await buyerContext.newPage();
        await dismissTips(o.buyerPage);
        await o.buyerPage.goto(disputeUrl(o.code));
        const tx = await settled(o.buyer, o.code, 'released', PAYOUT_WAIT);
        await buyerPaid(o, tx, AMOUNT - FEE, FEE);
        for (let i = 0; i < 4; i++) await mine(1);
        const fresh = [...(await walletSnapshot(o.buyer.wallet))].filter((h) => !before.buyer.has(h));
        expect(fresh).toEqual([tx]);
        expect([...(await walletSnapshot(o.seller.wallet))].filter((h) => !before.seller.has(h))).toEqual([]);
      });
    });

    test('dispute after refund: the auto-refund fires; the buyer disputes; the seller is held (Post offer refused); the moderator rules seller-sends-xmr; the seller sends exactly the trade\'s XMR from a regtest wallet and submits the tx proof; the hold lifts and the case closes', async ({ browser }) => {
      const mod = await hire('mod');
      const o = await openTrade(browser, size, 'seller', { beforeAccept: oneMinuteToPay });
      // Lead default, owner question: liens (the hold of Task 25) are switched off in a new database
      // (migration 400, `site_flags.liens_enabled`), and nothing else holds the seller of an
      // after-refund ruling; the row switches them on in this run's database, the only switch there is.
      await sql('update site_flags set liens_enabled = true');
      try {
        await inRooms(o, async () => {
          const funds = await fund(o);
          // Plan 3's path: past the time to pay, the seller's Cancel and get refund; the moderator sends it alone.
          await shows(o.sellerPage, /didn't mark the payment in time/, 3 * 60_000);
          await o.sellerPage.getByRole('button', { name: 'Cancel and get refund' }).click();
          const refundTx = await settled(o.buyer, o.code, 'refunded');
          await mine(12);
          expect(await receivedIn(o.seller.wallet, refundTx)).toBe(funds - (await txFee(refundTx)));

          // The buyer paid after all and disputes the refund.
          await o.buyerPage.goto(`/trade/${encodeURIComponent(o.code)}`);
          await o.buyerPage.locator('[data-part="refunded-open-dispute"]').click();
          await o.buyerPage.waitForURL(/\/dispute$/);
          await o.buyerPage.getByRole('radio').first().check();
          await o.buyerPage.getByLabel('Tell the moderator what happened').fill('I paid late; the seller has my money and the refund.');
          await o.buyerPage.locator('.dispute-footer').getByRole('button', { name: 'Open dispute' }).click();
          await expect(o.buyerPage.locator('.dispute-footer')).toHaveCount(0, { timeout: LONG });

          await withStaff(browser, mod, async (staff) => {
            await takeCase(staff, o.code);
            await proposeRuling(staff, 'Seller sends the XMR', 'The buyer showed the payment; the seller got the refund and the money.');
          });
          // The seller is held: their Post offer is refused. (The taker seller is made a vendor first,
          // as regtestKit.signUp does, so posting is theirs to do at all.)
          await sql("update accounts set account_type = 'vendor', vendor_since = now() where trade_tag = $1", [o.seller.tradeTag]);
          const held = await o.seller.api.call('POST', '/v1/offers', { side: 'sell', currencies: [{ currency: 'USD', bands: [{ min: '20', max: '150', marginBps: 0, minTrades: null }] }], methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: 'x' }], terms: 'x' });
          expect([held.status, (held.body as { error?: string } | null)?.error]).toEqual([409, 'lien']);

          // The seller pays exactly what the ruling card asks, to the address it shows, from a regtest wallet.
          await o.sellerPage.goto(disputeUrl(o.code));
          const card = o.sellerPage.getByRole('region', { name: 'Transfer proof' });
          await expect(card).toBeVisible({ timeout: LONG });
          const address = (await card.locator('[data-part="pay-address"]').innerText()).trim();
          expect(address).toBe(o.buyer.address);
          await pay(o.seller.address, AMOUNT + XMR / 10n);
          await mine(12);
          await o.seller.wallet.sync();
          const sent = await o.seller.wallet.createTx({ accountIndex: 0, address, amount: AMOUNT, relay: true });
          const txHash = sent.getHash()!;
          const txKey = await o.seller.wallet.getTxKey(txHash);
          await card.getByLabel('Transaction ID').fill(txHash);
          await card.getByLabel('Transaction key').fill(txKey);
          await card.getByRole('button', { name: 'Send proof' }).click();
          await expect(o.sellerPage.locator('[data-part="tx-proof-sent"]')).toBeVisible({ timeout: LONG });
          await mine(12);
          expect(await receivedIn(o.buyer.wallet, txHash)).toBe(AMOUNT);
          // Accepted at 10 confirmations (the dispute timer checks again): `complied`, and the hold lifts.
          await expect.poll(async () => (await logFor(o.code)).includes('dispute.complied'), { timeout: 2 * LONG, intervals: [10_000] }).toBe(true);
          const free = await o.seller.api.call('POST', '/v1/offers', { side: 'sell', currencies: [{ currency: 'USD', bands: [{ min: '20', max: '150', marginBps: 0, minTrades: null }] }], methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: 'x' }], terms: 'x' });
          expect(free.status, JSON.stringify(free.body)).toBeLessThan(300);
          // The case closes once the 48 h appeal window ends (packages/staff dispute.ts: `complied`
          // inside the window only records the payment; `window-closed` then closes it). The row
          // ends the window now in this run's database instead of waiting two days.
          expect((await caseOf(o.code)).status).toBe('published');
          await sql("update disputes set appeal_ends_at = now() - interval '1 second' where code = $1 and status = 'published'", [o.code]);
          await expect.poll(async () => (await caseOf(o.code)).status, { timeout: 2 * LONG, intervals: [10_000] }).toBe('closed');
        });
      } finally {
        await sql('update site_flags set liens_enabled = false');
      }
    });

    test('emergency stop: the owner pauses with a tap; the trader board shows the notice and Trade is disabled; an escrow in progress still releases (the buyer paid amount − 1% − network fee, the fee wallet exactly 1%)', async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      const own = await owner();
      await inRooms(o, async () => {
        expect(await fund(o)).toBe(AMOUNT);
        await markPaid(o.buyerPage);
        await withStaff(browser, own, async (staff) => {
          await staff.goto('/');
          const card = staff.locator('[data-part="emergency-stop"]');
          await card.getByRole('button', { name: 'Pause all new trades' }).click();
          await tapKey(staff);
          await expect(card).toContainText('New trades are paused', { timeout: LONG });
          try {
            // The trader board: the notice, and no offer to take.
            const board = await o.buyerPage.context().newPage();
            await board.goto('/buy/ZELLE?currency=USD');
            await expect(board.locator('[data-part="trading-stopped"]')).toBeVisible({ timeout: LONG });
            await expect(board.getByRole('button', { name: /^Trade with / })).toHaveCount(0);
            await board.close();
            // The escrow in progress still releases.
            await o.sellerPage.goto(`/trade/${encodeURIComponent(o.code)}`);
            await holdToRelease(o.sellerPage);
            const tx = await settled(o.buyer, o.code, 'released');
            await buyerPaid(o, tx, AMOUNT - FEE, FEE);
          } finally {
            await staff.goto('/');
            const resume = card.getByRole('button', { name: 'Tap key and resume trading' });
            await resume.click();
            await tapKey(staff);
            await expect(card).toContainText('X2F is live', { timeout: LONG });
          }
        });
      });
    });
  });
}

// Staff only once the dispute is open: one size.
test('login hours: a moderator whose window ends in a minute or two is returned to Login with "Your login hours have ended." and their open case stays assigned to them', async ({ browser }) => {
  const o = await openTrade(browser, DESKTOP, 'seller');
  await inRooms(o, async () => {
    await disputed(o);
    // A window that ends two minutes from now (UTC), started an hour ago.
    const hhmm = (d: Date) => d.toISOString().slice(11, 16);
    const now = Date.now();
    const hours: LoginHours = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start: hhmm(new Date(now - 3_600_000)), end: hhmm(new Date(now + 2 * 60_000 + 60_000 - (now % 60_000))), tz: 'UTC' };
    const mod = await hire('mod', { hours });
    await withStaff(browser, mod, async (staff) => {
      await takeCase(staff, o.code);
      await expect(staff.getByText('Your login hours have ended.')).toBeVisible({ timeout: 5 * 60_000 });
      await expect(staff).toHaveURL(/\/login/);
    });
    const c = await caseOf(o.code);
    expect(c.assignee).toBe(mod.tradeTag);
    expect(c.status).toBe('open');
  });
});

/**
 * A 1-minute time to pay (as trade.e2e.spec.ts: the method's window is fixed at take and signed
 * into the terms, so it is set before the poster accepts; the set-once guard is lifted for this
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
