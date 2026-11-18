import { expect, test, type Page } from '@playwright/test';
import { signedIn, signedOut } from './session.js';
import { expectPhoneLayout } from './phone.js';

// The help library (owner, 18 Nov 2026; src/screens/help/): /help lists every question by topic, a
// search filters questions and answers, and /help/<topic>#faq-<id> opens that question (the first
// form, #<id>, is rewritten to it). It is on the
// front door, so it is read signed out as well as signed in. Checked at desktop and phone sizes.

const SIZES = [
  { name: 'desktop 1280x800', width: 1280, height: 800 },
  { name: 'phone 360x800', width: 360, height: 800 },
] as const;

/** The status line's text once it settles (the screen's own, not the sync live region). */
const count = (page: Page) => page.locator('[data-part="help-count"]');

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('/help: every topic with its questions, a search that filters, and no primary action', async ({ page }) => {
      await signedOut(page);
      await page.goto('/help');
      const main = page.locator('main[data-screen="help"]');
      await expect(main.locator('h1')).toHaveText('Help');
      await expect(main.locator('section[data-topic] > h2')).toHaveText([
        'Getting started', 'Buying and selling', 'Escrow and Monero', 'Disputes and appeals', 'Account safety', 'Teams', 'Privacy', 'Fees',
      ]);
      const all = await main.locator('[data-question]').count();
      expect(all).toBeGreaterThanOrEqual(60);
      await expect(count(page)).toHaveText(`${all} questions`);
      // The page has no orange primary action.
      await expect(page.locator('[data-primary]')).toHaveCount(0);

      // Keyboard: open and close a question with Enter and Space.
      const toggle = main.locator('[data-question="how-escrow-works"] button');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panel = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
      await expect(panel).toBeVisible();
      // A labelled group, not a landmark (review m7).
      await expect(panel).toHaveAttribute('role', 'group');
      await expect(main.locator('[role="region"]')).toHaveCount(0);
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toBeHidden();

      // The search reaches the answers: "YubiKey" is only in an answer.
      const search = page.getByRole('searchbox', { name: 'Search help' });
      await search.fill('yubikey');
      await expect(main.locator('[data-question]')).toHaveCount(1);
      await expect(main.locator('[data-question]')).toHaveAttribute('data-question', 'passkey-or-security-key');
      await expect(count(page)).toHaveText('1 question');
      await search.fill('zzqx');
      await expect(main.locator('[data-question]')).toHaveCount(0);
      await expect(count(page)).toContainText('No questions match "zzqx"');
      await search.fill('');
      await expect(main.locator('[data-question]')).toHaveCount(all);
      if (size.width < 600) await expectPhoneLayout(page);
    });

    test('a deep link opens its question on its topic page, and the topic links move between topics', async ({ page }) => {
      await signedIn(page);
      await page.goto('/help/fees#faq-fee-when');
      const main = page.locator('main[data-screen="help-fees"]');
      await expect(main.locator('h1')).toHaveText('Fees');
      const toggle = main.locator('[data-question="fee-when"] button');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toBeFocused();
      await expect(main.locator('[data-question="fee-when"] [role="group"]')).toContainText('When a trade completes');
      await expect(main.locator('[data-question="fee-when"]')).toBeInViewport();
      // Only the fees are listed here, and the topic link says where you are.
      await expect(main.locator('section[data-topic]')).toHaveCount(0);
      await expect(page.locator('nav[aria-label="Help topics"] a[aria-current="page"]')).toHaveText('Fees');
      await page.locator('nav[aria-label="Help topics"]').getByRole('link', { name: 'Teams' }).click();
      await expect(page).toHaveURL('/help/teams');
      await expect(page.locator('main[data-screen="help-teams"] h1')).toHaveText('Teams');
      // Signed in, the way back leads to trading.
      await expect(page.locator('[data-part="help-back"]')).toHaveAttribute('href', '/sell');
      // The answer's own link is the deep link.
      const first = page.locator('main [data-question]').first();
      await first.locator('button').click();
      const question = await first.locator('button').innerText();
      const link = first.getByRole('link', { name: `Link to this answer: ${question.trim()}`, exact: true });
      await expect(link).toHaveAttribute('href', `/help/teams#faq-${await first.getAttribute('data-question')}`);
      if (size.width < 600) await expectPhoneLayout(page);
      // Nothing in the help page is a primary action; the shell around it has one at most.
      await expect(page.locator('main [data-primary]')).toHaveCount(0);
      expect(await page.locator('[data-primary]').count()).toBeLessThanOrEqual(1);
    });

    test('a link in the first form (#fee-when) is rewritten to #faq-fee-when and opens its question', async ({ page }) => {
      await signedOut(page);
      await page.goto('/help/fees#fee-when');
      await expect(page).toHaveURL('/help/fees#faq-fee-when');
      const toggle = page.locator('main[data-screen="help-fees"] [data-question="fee-when"] button');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toBeFocused();
    });
  });
}
