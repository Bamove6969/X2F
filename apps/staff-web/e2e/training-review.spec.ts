// Plan 4 Task 19, lead call 18 Nov (re-review 3): the curator's review pages in a real browser. The
// one thing a unit test cannot show is that a selection made with the mouse becomes exactly the
// range the API is sent: these tests drag over characters (after a multi-byte character, and after
// an automatic mask) and check the start and end offsets in the PUT body, then mark, unmark and the
// stale display. The staff API is stubbed with page.route in the shapes of apps/api/src/staff/training.ts.
import { expect, test, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const NAV = ['overview', 'disputes', 'staff', 'performance', 'training', 'log', 'settings'];
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV, sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };

const ID = 'a'.repeat(32);
// A note with a multi-byte character (an emoji, 2 UTF-16 units) and an accented letter before the
// text to hide, then an automatic mask, then more text to hide after it.
const NOTE = 'Café 😀 Buyer never paid, call me on [phone] at noon from Kowalski.';
const PHONE = NOTE.indexOf('[phone]');
const ITEM = { id: ID, closedMonth: '2026-11', method: 'REVOLUT', methodName: 'Revolut', xmr: '1300000000000', outcome: 'release-to-buyer', overturned: false, afterRefund: false };
const REASON = { text: 'Seller showed the statement for [account].', masks: [{ start: 32, end: 41, kind: 'account' }] };
const EVIDENCE = { text: 'Screenshot sent by Seller', masks: [] };

function reviewCase(status: string, manual: unknown[] = []) {
  return {
    ...ITEM, tradeCode: 'XXXX-XXXX-XXXX-XXXX', openedBy: 'seller', reason: 'paid', closedAt: 'T+52:00', chat: 'not-available', appeal: null,
    note: { text: NOTE, masks: [{ start: PHONE, end: PHONE + 7, kind: 'phone' }] },
    rulings: [{ round: 1, outcome: 'release-to-buyer', at: 'T+3:00', reason: REASON, evidence: [EVIDENCE] }],
    timeline: [],
    status,
    manual,
    reviewTag: 'c'.repeat(64),
    fields: { note: { text: NOTE, masks: [{ start: PHONE, end: PHONE + 7, kind: 'phone' }] }, 'ruling.1.reason': REASON, 'ruling.1.evidence.0': EVIDENCE },
  };
}

interface Calls {
  puts: unknown[];
  deletes: string[];
}

async function stub(page: Page, status: string, manual: unknown[] = []): Promise<Calls> {
  const calls: Calls = { puts: [], deletes: [] };
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/staff/v1/me') return json(OWNER)(route);
    if (u.pathname === '/staff/v1/training') return json({ items: [], next: null })(route);
    if (u.pathname === '/staff/v1/training/review') return json({ items: [{ ...ITEM, status }] })(route);
    if (u.pathname === `/staff/v1/training/review/${ID}`) {
      if (req.method() === 'PUT') {
        calls.puts.push(req.postDataJSON());
        return json({ id: ID, status: 'marked' })(route);
      }
      if (req.method() === 'DELETE') {
        calls.deletes.push(u.pathname);
        return json({ id: ID, status: 'unmarked' })(route);
      }
      return json(reviewCase(status, manual))(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return calls;
}

/** The on-screen box of the UTF-16 unit at `index` of a review field's text (a surrogate pair as one character). */
async function charBox(page: Page, field: string, index: number): Promise<{ x: number; y: number; w: number }> {
  return page.evaluate(
    ([f, i]) => {
      const box = document.querySelector(`[data-field="${f}"] [data-part="field-text"]`)!;
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        const t = n.textContent ?? '';
        if (i < seen + t.length) {
          const off = i - seen;
          const code = t.charCodeAt(off);
          const r = document.createRange();
          r.setStart(n, off);
          r.setEnd(n, off + (code >= 0xd800 && code <= 0xdbff ? 2 : 1));
          const rect = r.getBoundingClientRect();
          return { x: rect.left, y: rect.top + rect.height / 2, w: rect.width };
        }
        seen += t.length;
      }
      throw new Error(`no character ${i} in ${f}`);
    },
    [field, index] as const,
  );
}

/** Drags the mouse from the first character of [start, end) to its last, as a curator selecting it. */
async function dragSelect(page: Page, field: string, start: number, end: number): Promise<string> {
  const a = await charBox(page, field, start);
  const b = await charBox(page, field, end - 1);
  await page.mouse.move(a.x + 1, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.w - 1, b.y, { steps: 8 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

const field = (page: Page, f: string) => page.locator(`[data-field="${f}"]`);

test('the owner reaches the review from the library and sees each closed case with its status', async ({ page }) => {
  await stub(page, 'unmarked');
  await page.goto('/training');
  await page.getByRole('link', { name: 'Review closed cases' }).click();
  await expect(page.locator('[data-screen="training-review"]')).toBeVisible();
  await expect(page.locator('table[aria-label="Closed cases"] tbody tr')).toHaveCount(1);
  await expect(page.locator('table[aria-label="Closed cases"] tbody tr')).toContainText('Not in the library');
  await page.getByRole('link', { name: 'Review the case' }).click();
  await expect(page.locator('[data-screen="training-review-case"]')).toBeVisible();
});

test('a mouse selection after a multi-byte character and after an automatic mask is sent as exactly those offsets', async ({ page }) => {
  const calls = await stub(page, 'unmarked');
  await page.goto(`/training/review/${ID}`);
  await expect(field(page, 'note')).toContainText('never paid');

  // After the emoji (2 UTF-16 units) and the accented letter: "never paid".
  const first = { start: NOTE.indexOf('never paid'), end: NOTE.indexOf('never paid') + 'never paid'.length };
  expect(await dragSelect(page, 'note', first.start, first.end)).toBe('never paid');
  await field(page, 'note').getByRole('button', { name: 'Hide the selected text' }).click();
  await expect(field(page, 'note').locator('mark[data-mask="manual"]')).toHaveText(['never paid']);

  // After the automatic [phone] mask: "noon".
  const second = { start: NOTE.indexOf('noon'), end: NOTE.indexOf('noon') + 'noon'.length };
  expect(await dragSelect(page, 'note', second.start, second.end)).toBe('noon');
  await field(page, 'note').getByRole('button', { name: 'Hide the selected text' }).click();
  await expect(field(page, 'note').locator('mark[data-mask="manual"]')).toHaveText(['never paid', 'noon']);

  // A selection cutting into the automatic mask is refused and adds nothing.
  const cut = { start: PHONE - 3, end: PHONE + 3 };
  expect(await dragSelect(page, 'note', cut.start, cut.end)).toBe(NOTE.slice(cut.start, cut.end));
  await field(page, 'note').getByRole('button', { name: 'Hide the selected text' }).click();
  await expect(page.getByText('Select whole words outside the marked details.', { exact: false })).toBeVisible();
  await expect(field(page, 'note').locator('mark[data-mask="manual"]')).toHaveCount(2);

  // A whole text, then the mark.
  await field(page, 'ruling.1.evidence.0').getByRole('button', { name: 'Hide this whole text' }).click();
  await page.getByRole('button', { name: 'Mark as training case' }).click();
  await expect(page.locator('[data-part="review-status"]')).toContainText('This case is in the training library.');
  expect(calls.puts).toEqual([
    {
      masks: [
        { field: 'note', start: first.start, end: first.end },
        { field: 'note', start: second.start, end: second.end },
        { field: 'ruling.1.evidence.0', whole: true },
      ],
      reviewTag: 'c'.repeat(64),
    },
  ]);
  // The offsets are UTF-16 units, as the API counts them: the emoji counts twice.
  expect(first.start).toBe([...NOTE.slice(0, first.start)].length + 1);
  expect(NOTE.slice(first.start, first.end)).toBe('never paid');
  expect(NOTE.slice(second.start, second.end)).toBe('noon');
});

test('a marked case can be taken out of the library', async ({ page }) => {
  const calls = await stub(page, 'marked', [{ field: 'note', start: NOTE.indexOf('never paid'), end: NOTE.indexOf('never paid') + 10 }]);
  await page.goto(`/training/review/${ID}`);
  await expect(page.locator('[data-part="review-status"]')).toContainText('This case is in the training library.');
  await expect(field(page, 'note').locator('mark[data-mask="manual"]')).toHaveText(['never paid']);
  await page.getByRole('button', { name: 'Take it out of the library' }).click();
  await expect(page.locator('[data-part="review-status"]')).toContainText('This case is not in the training library.');
  expect(calls.deletes).toEqual([`/staff/v1/training/review/${ID}`]);
  await expect(page.getByRole('button', { name: 'Take it out of the library' })).toHaveCount(0);
});

test('a stale case says its masks no longer fit, and marking it again saves them', async ({ page }) => {
  const calls = await stub(page, 'stale', [{ field: 'ruling.1.evidence.0', whole: true }]);
  await page.goto('/training/review');
  await expect(page.locator('table[aria-label="Closed cases"] tbody tr')).toContainText('Hidden: review the masks again');
  await page.getByRole('link', { name: 'Review the case' }).click();
  await expect(page.locator('[data-part="review-status"]')).toContainText('no longer fit its texts, so it is hidden from the library');
  await page.getByRole('button', { name: 'Mark as training case' }).click();
  await expect(page.locator('[data-part="review-status"]')).toContainText('This case is in the training library.');
  expect(calls.puts).toEqual([{ masks: [{ field: 'ruling.1.evidence.0', whole: true }], reviewTag: 'c'.repeat(64) }]);
  const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(scroll.wide).toBeLessThanOrEqual(scroll.view);
});
