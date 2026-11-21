/**
 * Plan 5 Task 17 (the trader-only rows, on Plan 3 Task 31's regtest stack): a payment proof sent
 * before "I've paid", the ratings after a release, both profiles, and the "How's X2F doing?" card.
 *
 * Owner rule R-007 (2 Nov, owner-answers-register): a review shows as soon as the trade is
 * complete and it is submitted (no blind reveal), so the plan's "the buyer's profile shows no
 * change" and "7-day reveal" rows no longer apply. The rows that need a moderator (the unblurred
 * request, past reputation) wait for Plan 4 Task 21's staff stack; the smart proof card's "the
 * right amount" waits for Plan 5 Tasks 13 and 16 (OCR, smart card), not built yet.
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, sql, type Size } from './regtestKit.js';
import { fund, holdToRelease, inRooms, LONG, markPaid, openTrade, shows } from './tradeFlow.js';

const RECEIPT = fileURLToPath(new URL('./fixtures/proofs/bank-labelled.png', import.meta.url));
const SIZES: Array<[string, Size]> = [['phone 390×844', PHONE], ['desktop 1280×800', DESKTOP]];

/** The public profile of `name` as `page`'s trader sees it. */
async function profileText(page: Page, name: string): Promise<string> {
  await page.goto(`/u/${encodeURIComponent(name)}`);
  await shows(page, new RegExp(name), 60_000);
  await page.waitForTimeout(1500);
  return page.evaluate(() => document.body.innerText);
}

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test('proof: the buyer adds a receipt, checks the blur and sends it before I\'ve paid; the seller sees it in the trade chat', async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        await fund(o);
        await o.buyerPage.locator('[data-part="add-proof"] input[type="file"]').setInputFiles(RECEIPT);
        const editor = o.buyerPage.locator('[data-part="blur-editor"]');
        await expect(editor).toBeVisible({ timeout: 60_000 });
        await expect(editor).toContainText('Check your proof');
        await o.buyerPage.locator('[data-part="send-proof"]').click();
        await expect(editor).toHaveCount(0, { timeout: 60_000 });
        // Gap 5: the seller never opened the chat, yet its chat identity is registered and the chat attested.
        const att = await sql<{ n: string }>(
          "select count(*) as n from chats c join chat_attestations a on a.chat = c.code join chat_identities s on s.chat = c.code and s.role = 'seller' where c.trade_code = $1",
          [o.code],
        );
        expect(Number(att[0]!.n)).toBe(1);
        await markPaid(o.buyerPage);
        await shows(o.sellerPage, /PAYMENT RECEIVED/i, 2 * 60_000);
        // The seller sees it in the trade chat (the smart card on SellerConfirm is Plan 5 Task 16, not built).
        // The release screen's Chat is a link (release/slots.tsx), hidden where the chat has a pane of its own.
        const chatLink = o.sellerPage.locator('[data-chat-link]:visible').first();
        if ((await chatLink.count()) > 0) await chatLink.click();
        await expect(o.sellerPage.locator('[data-part="chat-proof"]').first()).toBeVisible({ timeout: 2 * 60_000 });
      });
    });

    test('reviews: after a release both rate (5 stars, Neutral); both reviews show at once on both profiles; the How\'s X2F card stores no account', async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      await inRooms(o, async () => {
        await fund(o);
        await markPaid(o.buyerPage);
        await holdToRelease(o.sellerPage);
        await shows(o.sellerPage, /RELEASED/, LONG, { mining: true });
        await shows(o.buyerPage, /RELEASED/, LONG, { mining: true });

        await shows(o.sellerPage, new RegExp(`How was trading with ${o.buyer.displayName}`));
        await shows(o.buyerPage, new RegExp(`How was trading with ${o.seller.displayName}`));
        await o.sellerPage.getByRole('radio', { name: '5 stars' }).click();
        await o.sellerPage.getByRole('button', { name: 'Submit rating' }).click();
        await o.buyerPage.getByRole('button', { name: 'Neutral, skip details' }).click();

        // After the first completed trade: "How's X2F doing?". Its stored row holds no account.
        const card = o.buyerPage.locator('[data-part="feedback-card"]');
        await expect(card).toBeVisible({ timeout: 60_000 });
        const before = Number((await sql<{ n: string }>('select count(*) as n from platform_feedback'))[0]!.n);
        await card.getByRole('radio', { name: 'Great' }).click();
        await card.getByRole('button', { name: 'Send feedback' }).click();
        await expect(o.buyerPage.locator('[data-part="feedback-sent"]')).toBeVisible();
        const cols = await sql<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'platform_feedback' order by 1");
        expect(cols.map((c) => c.column_name)).toEqual(['created_on', 'id', 'mood', 'note']);
        expect(Number((await sql<{ n: string }>('select count(*) as n from platform_feedback'))[0]!.n)).toBe(before + 1);

        // Both reviews show on both profiles at once (R-007); the buyer's % positive is 100.
        for (const page of [o.sellerPage, o.buyerPage]) {
          const buyerProfile = await profileText(page, o.buyer.displayName);
          expect(buyerProfile).toMatch(/1\s*completed trade/i);
          expect(buyerProfile).toMatch(/100\s*%/);
          expect(buyerProfile).not.toMatch(/No reviews yet/);
          const sellerProfile = await profileText(page, o.seller.displayName);
          expect(sellerProfile).toMatch(/1\s*completed trade/i);
          expect(sellerProfile).toMatch(/Neutral/);
        }
      });
    });
  });
}
