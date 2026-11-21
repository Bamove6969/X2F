/**
 * Plan 5 Task 17 (the trader-only rows, on Plan 3 Task 31's regtest stack): a payment proof sent
 * before "I've paid", the ratings after a release, both profiles, and the "How's X2F doing?" card.
 *
 * Owner rule R-007 (2 Nov, owner-answers-register): a review shows as soon as the trade is
 * complete and it is submitted (no blind reveal), so the plan's "the buyer's profile shows no
 * change" and "7-day reveal" rows no longer apply. The rows that need a moderator (the unblurred
 * request, past reputation) wait for Plan 4 Task 21's staff stack.
 *
 * The smart proof card (Plan 5 Tasks 13 and 16): the seller's own device reads the buyer's
 * screenshot with the self-hosted OCR (the stack checks /ocr/* is the pinned set with the worker
 * CSP) and says "Shows $40.00, the right amount". Starter + New (spec 2.3): a fresh account's
 * offer card features New, which cannot be hidden, and keeps it at 19 completed trades until the
 * 20th graduates it.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { contextFor, DESKTOP, PHONE, signUp, sql, tradeView, type Size, type Trader } from './regtestKit.js';
import { fund, holdToRelease, inRooms, LONG, markPaid, offer, openTrade, shows } from './tradeFlow.js';

const SIZES: Array<[string, Size]> = [['phone 390×844', PHONE], ['desktop 1280×800', DESKTOP]];

/**
 * A made-up bank-app screenshot of this trade's payment (no real person's receipt): the amount, the
 * trade code in the memo, a sender name after a label and today's date, rendered in Chromium.
 */
async function receipt(browser: Browser, o: { amount: string; code: string }): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
  const now = new Date(Date.now() - 2 * 60_000);
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  await page.setContent(
    `<!doctype html><style>body{margin:0;font-family:"DejaVu Sans",sans-serif} #r{width:760px;padding:40px 48px;box-sizing:border-box;background:#fff;color:#111} h1{font-size:34px;margin:0 0 24px} .row{margin:14px 0;font-size:26px} .lbl{color:#555}</style>
     <div id="r"><h1>Zelle</h1>
       <div class="row">Payment sent</div>
       <div class="row"><span class="lbl">Amount:</span> ${o.amount}</div>
       <div class="row"><span class="lbl">From:</span> Jordan Avery</div>
       <div class="row">Memo ${o.code}</div>
       <div class="row">${day} at ${time}</div></div>`,
  );
  const shot = await page.locator('#r').screenshot({ type: 'png' });
  await page.close();
  return shot;
}

/** `cents` as the app writes a USD total ("$40.00"). */
const usd = (cents: string) => `$${(Number(cents) / 100).toFixed(2)}`;

interface Poster {
  stage: string;
  badges: string[];
  featuredBadges: number;
}

/** `name`'s poster summary on the buy offers for Zelle in USD, as `viewer` gets it from the API. */
async function posterOf(viewer: Trader, name: string): Promise<Poster> {
  const list = await viewer.api.ok<Array<{ poster: Poster & { displayName: string } }>>('GET', '/v1/offers?side=buy&method=ZELLE&currency=USD');
  const mine = list.filter((o) => o.poster.displayName === name);
  expect(mine).toHaveLength(1);
  return mine[0]!.poster;
}

/** `name`'s offer card on /sell (the buy offers) as `page`'s trader sees it, with its featured pills. */
async function offerCard(page: Page, name: string) {
  await page.goto('/sell/ZELLE?currency=USD');
  const card = page.locator('article.x2f-offer', { has: page.getByRole('button', { name: `Trade with ${name}` }) });
  await expect(card).toHaveCount(1, { timeout: 60_000 });
  return { card, pills: card.locator('.x2f-offer__badges > .x2f-badge') };
}

/** The public profile of `name` as `page`'s trader sees it. */
async function profileText(page: Page, name: string): Promise<string> {
  await page.goto(`/u/${encodeURIComponent(name)}`);
  await shows(page, new RegExp(name), 60_000);
  await page.waitForTimeout(1500);
  return page.evaluate(() => document.body.innerText);
}

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test('proof to review: the buyer sends this trade\'s receipt; the seller\'s own OCR says "the right amount"; the hold still needs the box; both rate after the release', async ({ browser }) => {
      const o = await openTrade(browser, size, 'seller');
      // Every /ocr/ file the seller's page loads, with the CSP it came with.
      const ocr = new Map<string, string>();
      o.sellerPage.context().on('response', (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith('/ocr/')) ocr.set(u.pathname, r.headers()['content-security-policy'] ?? '');
      });
      await inRooms(o, async () => {
        await fund(o);
        const v = await tradeView<{ fiatCents: string }>(o.buyer, o.code);
        const total = usd(v.fiatCents);
        expect(total).toBe('$40.00'); // 0.2 XMR at the stack's fixed $200
        const png = await receipt(browser, { amount: total, code: o.code });
        await o.buyerPage.locator('[data-part="add-proof"] input[type="file"]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
        const editor = o.buyerPage.locator('[data-part="blur-editor"]');
        await expect(editor).toBeVisible({ timeout: 2 * 60_000 });
        await expect(editor).toContainText('Check your proof');
        // The buyer's device read it too: no "couldn't check" line, and the sender name is blurred.
        await expect(editor.locator('[data-part="proof-no-auto-check"]')).toHaveCount(0);
        expect(await editor.locator('[data-part="blur-region"]').count()).toBeGreaterThan(0);
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

        // The smart card on SellerConfirm (Task 16): the seller's own OCR of the decrypted copy.
        const card = o.sellerPage.locator('[data-part="smart-proof"]');
        await expect(card).toHaveAttribute('data-state', 'checked', { timeout: 3 * 60_000 });
        await expect(card.locator('[data-part="smart-proof-head"]')).toHaveText(`We checked ${o.buyer.displayName}'s screenshot`);
        const lines = card.locator('[data-part="smart-proof-line"]');
        await expect(lines.nth(0)).toHaveText(`Shows ${total}, the right amount`);
        await expect(lines.nth(0)).toHaveAttribute('data-tone', 'escrow');
        await expect(lines.nth(1)).toHaveText(`Note says ${o.code}, this trade's code`);
        await expect(lines.nth(1)).toHaveAttribute('data-tone', 'escrow');
        await expect(card.locator('[data-part="smart-proof-closing"]')).toHaveText(new RegExp(`^Look for a \\${total} payment with the note ${o.code} in your bank\\.`));
        await expect(card.locator('img[data-part="proof-image"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
        // It ran in the self-hosted worker, under the worker CSP (connect-src only this site's /ocr/).
        expect(ocr.has('/ocr/worker.min.js')).toBe(true);
        expect(ocr.has('/ocr/eng.traineddata.gz')).toBe(true);
        for (const [path, csp] of ocr) expect(csp, path).toMatch(/connect-src http:\/\/localhost:\d+\/ocr\/;/);

        // The card never unlocks the release by itself.
        const hold = o.sellerPage.locator('button', { hasText: 'PAYMENT RECEIVED' });
        await expect(hold).toBeDisabled();
        expect((await tradeView<{ state: string }>(o.seller, o.code)).state).toBe('paid');

        // The seller sees it in the trade chat too. The release screen's Chat is a link
        // (release/slots.tsx), hidden where the chat has a pane of its own.
        const chatLink = o.sellerPage.locator('[data-chat-link]:visible').first();
        const linked = (await chatLink.count()) > 0;
        if (linked) await chatLink.click();
        await expect(o.sellerPage.locator('[data-part="chat-proof"]').first()).toBeVisible({ timeout: 2 * 60_000 });
        if (linked) await o.sellerPage.goto(`/trade/${encodeURIComponent(o.code)}`);

        await holdToRelease(o.sellerPage);
        await shows(o.sellerPage, /RELEASED/, LONG, { mining: true });
        await shows(o.buyerPage, /RELEASED/, LONG, { mining: true });
        expect((await tradeView<{ state: string }>(o.seller, o.code)).state).toBe('released');
        await shows(o.sellerPage, new RegExp(`How was trading with ${o.buyer.displayName}`));
        await shows(o.buyerPage, new RegExp(`How was trading with ${o.seller.displayName}`));
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

    test('Starter + New: a fresh account\'s offer card features New, which cannot be hidden, through 19 trades; the 20th graduates it', async ({ browser }) => {
      const fresh = await signUp('buyer', { vendor: true });
      await fresh.api.ok('POST', '/v1/offers', offer('buy'));
      const viewer = await signUp('viewer');
      const v = await contextFor(browser, viewer, size);
      const f = await contextFor(browser, fresh, size);
      try {
        // Fresh: Starter, New earned and Featured first, on the card in the caution tone.
        let p = await posterOf(viewer, fresh.displayName);
        expect(p.stage).toBe('starter');
        expect(p.badges[0]).toBe('new');
        expect(p.featuredBadges).toBeGreaterThanOrEqual(1);
        let shown = await offerCard(v.page, fresh.displayName);
        await expect(shown.pills.first()).toHaveText('New');
        await expect(shown.pills.first()).toHaveAttribute('data-tone', 'caution');

        // It cannot be hidden: the API refuses any change to New, and Badge settings offers none.
        const mine = await fresh.api.ok<{ featured: string[]; earned: Array<{ id: string; level: string }> }>('GET', '/v1/account/badges');
        expect(mine.featured[0]).toBe('new');
        for (const level of ['hidden', 'hover']) {
          const r = await fresh.api.call<{ error: string }>('PUT', '/v1/account/badges', { id: 'new', level });
          expect(r.status).toBe(400);
          expect(r.body.error).toBe('new-is-fixed');
        }
        expect((await fresh.api.ok<{ featured: string[] }>('GET', '/v1/account/badges')).featured[0]).toBe('new');
        await f.page.goto('/settings/badges');
        const row = f.page.locator('[data-screen="badge-settings"] li[data-badge="new"]');
        await expect(row).toBeVisible({ timeout: 60_000 });
        await expect(row.locator('button')).toHaveCount(0);
        await expect(f.page.getByText("The New badge always shows while you have it and can't be hidden.")).toBeVisible();

        // Seeded: 19 completed trades (Plan 7's running total of purged trades, which every count
        // reads) on an account 31 days old, so only the 20th trade stands between it and Graduated.
        await sql("update accounts set created_at = now() - interval '31 days' where display_name = $1", [fresh.displayName]);
        await sql(
          `insert into account_traded_totals (account_id, purged_completed) select id, 19 from accounts where display_name = $1
           on conflict (account_id) do update set purged_completed = 19`,
          [fresh.displayName],
        );
        p = await posterOf(viewer, fresh.displayName);
        expect(p.stage).toBe('building');
        expect(p.badges).toContain('new');
        expect(p.badges[0]).toBe('new');
        shown = await offerCard(v.page, fresh.displayName);
        await expect(shown.pills.first()).toHaveText('New');
        await expect(shown.card).toContainText(/19\s*trades/);
      } finally {
        await v.context.close();
        await f.context.close();
      }

      // The 20th, a real trade on its own offer: released, it graduates and New is gone everywhere.
      const o = await openTrade(browser, size, 'seller', { poster: fresh });
      await inRooms(o, async () => {
        await fund(o);
        await markPaid(o.buyerPage);
        await holdToRelease(o.sellerPage);
        await shows(o.sellerPage, /RELEASED/, LONG, { mining: true });
        expect((await tradeView<{ state: string }>(o.seller, o.code)).state).toBe('released');
        const p = await posterOf(viewer, fresh.displayName);
        expect(p.stage).toBe('graduated');
        expect(p.badges).not.toContain('new');
        const mine = await fresh.api.ok<{ featured: string[]; earned: Array<{ id: string }> }>('GET', '/v1/account/badges');
        expect(mine.earned.map((b) => b.id)).not.toContain('new');
        const shown = await offerCard(o.sellerPage, fresh.displayName);
        await expect(shown.card).toContainText(/20\s*trades/);
        await expect(shown.pills.filter({ hasText: /^New$/ })).toHaveCount(0);
        await expect(shown.pills.first()).toBeVisible(); // its earned badges still show (10 trades)
      });
    });
  });
}
