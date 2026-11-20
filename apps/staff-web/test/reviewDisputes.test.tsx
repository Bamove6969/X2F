// @vitest-environment happy-dom
// Plan 5 Task 19 (Revision 2026-10-29b, owner): the moderators' Review disputes page, under Disputes
// (/disputes/reviews), against a fake staff API in the shapes of apps/api/src/staff/reviewDisputes.ts
// (apps/api/test/reviewDisputes.test.ts checks those against the real routes).
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { button, click, fakeApi, field, render, settle, tick, typeInto } from './helpers.js';

const ME = { displayName: 'nightowl_44', role: 'mod', nav: NAV.mod, sessionEndsAt: new Date(Date.now() + 3600_000).toISOString() };
const ITEM = (id: string, tradeCode: string | null) => ({
  id,
  openedAt: '2026-11-12T12:00:00.000Z',
  reason: 'Revenge for the dispute I opened.',
  review: { neutral: false, stars: 1, phrases: ['Slow', 'Went quiet'], tradeBadges: [], note: 'Rude and slow', method: 'Zelle', age: 'Nov 2026', reviewerRole: 'buyer' },
  tradeCode,
});

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

describe('Review disputes (moderators)', () => {
  it('the queue links to it; each dispute shows the review, the side, the reason and the trade line, never a name', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: ME },
      'GET /staff/v1/review-disputes': { body: { items: [ITEM('d1', 'TR-7KQ2'), ITEM('d2', null)], next: null } },
    });
    await open('/disputes');
    expect(document.querySelector('[data-part="review-disputes-link"]')?.getAttribute('href')).toBe('/disputes/reviews');
    await click(document.querySelector('[data-part="review-disputes-link"]'));
    const cards = document.querySelectorAll('[data-part="review-dispute"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('1 star · Nov 2026 · Zelle · written by the buyer');
    expect(cards[0]!.querySelector('[data-part="dispute-reason"]')?.textContent).toBe('Revenge for the dispute I opened.');
    expect(cards[0]!.querySelector('[data-part="trade-line"]')?.textContent).toBe('Trade TR-7KQ2');
    expect(cards[1]!.querySelector('[data-part="trade-line"]')?.textContent).toBe('The trade was deleted (30 days after it ended). Decide on the review and the reason.');
    // One decision form at a time: the page has exactly one primary action.
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('remove some comments: pick what goes, give a reason of 20 or more characters, save; the dispute leaves the list', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: ME },
      'GET /staff/v1/review-disputes': { body: { items: [ITEM('d1', null)], next: null } },
      'POST /staff/v1/review-disputes/:id/decide': { body: { ok: true } },
    });
    await open('/disputes/reviews');
    const save = button('Save decision')!;
    expect(save.disabled).toBe(true);
    await tick(document.querySelectorAll<HTMLInputElement>('[data-part="outcome"] input')[1]);
    await tick([...document.querySelectorAll<HTMLInputElement>('[data-part="remove"] input')][0]);
    typeInto(field('Why'), 'too short');
    await settle();
    expect(button('Save decision')!.disabled).toBe(true);
    typeInto(field('Why'), 'The note shares the trader\'s bank name.');
    await settle();
    await click(button('Save decision'));
    expect(api.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/staff/v1/review-disputes/d1/decide',
      body: { outcome: 'comments-removed', reason: "The note shares the trader's bank name.", remove: { note: true, phrases: [], tradeBadges: [] } },
    });
    expect(document.querySelectorAll('[data-part="review-dispute"]')).toHaveLength(0);
    expect(document.querySelector('[data-part="decision-saved"]')?.textContent).toBe('Decision saved.');
    expect(document.querySelector('[data-part="no-review-disputes"]')).not.toBeNull();
  });

  it('a decision already made by someone else is a fault notice, and the form stays', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: ME },
      'GET /staff/v1/review-disputes': { body: { items: [ITEM('d1', null)], next: null } },
      'POST /staff/v1/review-disputes/:id/decide': { status: 409, body: { error: 'dispute-decided' } },
    });
    await open('/disputes/reviews');
    await tick(document.querySelectorAll<HTMLInputElement>('[data-part="outcome"] input')[0]);
    typeInto(field('Why'), 'The review is fair and on topic.');
    await settle();
    await click(button('Save decision'));
    expect(document.body.textContent).toContain('X2F could not save the decision. Reload and try again.');
    expect(document.querySelectorAll('[data-part="review-dispute"]')).toHaveLength(1);
  });
});
