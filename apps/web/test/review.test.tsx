// @vitest-environment happy-dom
// Plan 5 Task 6: the rating card, "How's X2F doing?", the card on a finished trade and the
// rate-first gate (spec 5.1, 5.2; P5-A4, P5-A6, P5-A7, P5-A19; owner 2026-11-01 Skip review,
// 2026-11-02 no blind reveal).
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewInput } from '@x2f/reputation';
import { ApiCallError } from '../src/api/client.js';
import { AcceptedSheet, type AcceptedTradeView, type AcceptedWallet } from '../src/screens/AcceptedSheet.js';
import { takeRefusal } from '../src/screens/quote/takeErrors.js';
import { FeedbackCard } from '../src/screens/review/FeedbackCard.js';
import { RateFirst } from '../src/screens/review/RateFirstSheet.js';
import { ReviewCard, type ReviewOutcome } from '../src/screens/review/ReviewCard.js';
import { TradeReview } from '../src/screens/review/TradeReview.js';
import type { PendingReview, TradeReviewView } from '../src/screens/review/api.js';
import { RATE_FIRST } from '../src/ui/cantDoCodes.js';
import type { QuoteOffer } from '../src/screens/quote/quoteModel.js';
import { fire, render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const flush = () => act(async () => undefined);
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true }));
const buttonNamed = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text);
const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function card(o: { rated?: 'buyer' | 'seller'; submit?: (c: string, b: ReviewInput) => Promise<void>; skip?: (c: string) => Promise<void> } = {}) {
  const sent: ReviewInput[] = [];
  const skipped: string[] = [];
  const done: ReviewOutcome[] = [];
  const { host } = render(
    <ReviewCard
      code={CODE}
      counterparty="satoshi_ghost"
      rated={o.rated ?? 'seller'}
      onDone={(x) => done.push(x)}
      submit={o.submit ?? (async (_c, b) => void sent.push(b))}
      skip={o.skip ?? (async (c) => void skipped.push(c))}
    />,
  );
  return { host, sent, skipped, done };
}

describe('ReviewCard', () => {
  it('asks about the counterparty by display name, with five named stars; Submit is disabled until a star is picked', () => {
    const { host } = card();
    expect(host.querySelector('h2')!.textContent).toBe('How was trading with satoshi_ghost?');
    const stars = [...host.querySelectorAll('[role="radiogroup"][aria-label="Stars"] [role="radio"]')];
    expect(stars.map((s) => s.getAttribute('aria-label'))).toEqual(['1 star', '2 stars', '3 stars', '4 stars', '5 stars']);
    expect(buttonNamed(host, 'Submit rating')!.disabled).toBe(true);
    click(stars[3]!);
    expect(buttonNamed(host, 'Submit rating')!.disabled).toBe(false);
    expect(stars[3]!.getAttribute('aria-checked')).toBe('true');
    // The one primary is Submit rating.
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('never promises the dropped blind reveal (owner 2026-11-02)', () => {
    const { host } = card();
    expect(host.textContent).not.toMatch(/only after they rate you/i);
  });

  it('P5-A7: a buyer rating a seller sees "Fast release"; a seller rating a buyer sees "Fast payment"', () => {
    const seller = card({ rated: 'seller' }).host.textContent!;
    expect(seller).toContain('Fast release');
    expect(seller).not.toContain('Fast payment');
    const buyer = card({ rated: 'buyer' }).host.textContent!;
    expect(buyer).toContain('Fast payment');
    expect(buyer).not.toContain('Fast release');
  });

  it('Submit rating sends the stars, the picked phrases in the board order and the trimmed note', async () => {
    const { host, sent, done } = card();
    click(buttonNamed(host, '5 stars')!);
    click(buttonNamed(host, 'Clear instructions')!);
    click(buttonNamed(host, 'Fast release')!);
    click(buttonNamed(host, 'Slow')!);
    click(buttonNamed(host, 'Slow')!);
    expect(buttonNamed(host, 'Fast release')!.getAttribute('aria-pressed')).toBe('true');
    expect(buttonNamed(host, 'Slow')!.getAttribute('aria-pressed')).toBe('false');
    typeInto(host.querySelector('input[type="text"]')!, '  Smooth trade  ');
    click(buttonNamed(host, 'Submit rating')!);
    await flush();
    expect(sent).toEqual([{ neutral: false, stars: 5, phrases: ['Fast release', 'Clear instructions'], tradeBadges: [], note: 'Smooth trade' }]);
    expect(done).toEqual(['rated']);
  });

  it('the note is one line of at most 120 characters, and a blank note is not sent', async () => {
    const { host, sent } = card();
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.maxLength).toBe(120);
    typeInto(input, 'one\ntwo');
    expect(input.value).toBe('one two');
    typeInto(input, '   ');
    click(buttonNamed(host, '3 stars')!);
    click(buttonNamed(host, 'Submit rating')!);
    await flush();
    expect(sent).toEqual([{ neutral: false, stars: 3, phrases: [], tradeBadges: [] }]);
  });

  it('Neutral sends { neutral: true } only, whatever was picked', async () => {
    const { host, sent, done } = card();
    click(buttonNamed(host, '2 stars')!);
    click(buttonNamed(host, 'Friendly')!);
    click(buttonNamed(host, 'Neutral, skip details')!);
    await flush();
    expect(sent).toEqual([{ neutral: true }]);
    expect(done).toEqual(['neutral']);
  });

  it('Skip review calls the skip route and sends no review (owner 2026-11-01, item 28)', async () => {
    const { host, sent, skipped, done } = card();
    click(buttonNamed(host, 'Skip review')!);
    await flush();
    expect(skipped).toEqual([CODE]);
    expect(sent).toEqual([]);
    expect(done).toEqual(['skipped']);
  });

  it('P5-A6: a note with personal details is refused with its own line, and the card stays', async () => {
    const { host, done } = card({ submit: async () => Promise.reject(new ApiCallError(400, 'note-personal-details')) });
    click(buttonNamed(host, '4 stars')!);
    click(buttonNamed(host, 'Submit rating')!);
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Remove personal details from the note.');
    expect(done).toEqual([]);
    expect(buttonNamed(host, 'Submit rating')!.disabled).toBe(false);
  });

  it('a 409 review-exists (rated in another tab) finishes the card; another failure says try again', async () => {
    const a = card({ submit: async () => Promise.reject(new ApiCallError(409, 'review-exists')) });
    click(buttonNamed(a.host, 'Neutral, skip details')!);
    await flush();
    expect(a.done).toEqual(['neutral']);
    const b = card({ skip: async () => Promise.reject(new ApiCallError(500, 'internal')) });
    click(buttonNamed(b.host, 'Skip review')!);
    await flush();
    expect(b.host.querySelector('[role="alert"]')!.textContent).toBe('That did not work. Try again.');
    expect(b.done).toEqual([]);
  });
});

describe('FeedbackCard', () => {
  it('sends exactly { mood, note }, only once a mood is picked; it is not a primary', async () => {
    const sent: unknown[] = [];
    const { host } = render(<FeedbackCard send={async (mood, note) => void sent.push({ mood, note })} />);
    expect(host.querySelector('h2')!.textContent).toBe("How's X2F doing?");
    expect(host.textContent).toContain('Sent without your username or trade details.');
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(0);
    expect(buttonNamed(host, 'Send feedback')!.disabled).toBe(true);
    click(buttonNamed(host, 'Needs work')!);
    typeInto(host.querySelector('textarea')!, 'More gift cards');
    click(buttonNamed(host, 'Send feedback')!);
    await flush();
    expect(sent).toEqual([{ mood: 'needs-work', note: 'More gift cards' }]);
    expect(host.querySelector('[data-part="feedback-sent"]')).not.toBeNull();
  });

  it('the real request body has exactly the keys mood and note', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: 202 });
      }),
    );
    const { host } = render(<FeedbackCard />);
    click(buttonNamed(host, 'Great')!);
    click(buttonNamed(host, 'Send feedback')!);
    await flush();
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0] as object).sort()).toEqual(['mood', 'note']);
  });

  it('Not now closes it without sending', () => {
    const send = vi.fn(async () => undefined);
    const { host } = render(<FeedbackCard send={send} />);
    click(buttonNamed(host, 'Not now')!);
    expect(host.querySelector('[data-part="feedback-card"]')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('TradeReview (the card under Released and on a closed dispute)', () => {
  const view = (over: Partial<TradeReviewView> = {}): TradeReviewView => ({ reviewable: true, mine: null, theirs: null, skipped: false, held: false, ...over });
  /** A 201 for the review POST; the card's default call goes through the app's API client. */
  const okFetch = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));

  async function shown(completed: number | null, o: { view?: TradeReviewView; action?: string } = {}) {
    okFetch();
    const { host } = render(<TradeReview code={CODE} counterparty="mira.k" rated="buyer" load={async () => o.view ?? view()} completed={async () => completed} />);
    await flush();
    if (o.action !== undefined) {
      if (o.action === 'Submit rating') click(buttonNamed(host, '5 stars')!);
      click(buttonNamed(host, o.action)!);
      await flush();
      await flush();
    }
    return host;
  }

  it('shows nothing when this side may not rate (already rated, skipped, not a rated trade)', async () => {
    expect((await shown(1, { view: view({ reviewable: false, skipped: true }) })).textContent).toBe('');
  });

  it('the feedback card does not appear before the rating is saved', async () => {
    const host = await shown(1);
    expect(host.querySelector('[data-part="review-card"]')).not.toBeNull();
    expect(host.querySelector('[data-part="feedback-card"]')).toBeNull();
  });

  it('after the rating: "Rating saved", then "How\'s X2F doing?" on the 1st and 10th completed trade only (P5-A19)', async () => {
    for (const [n, asks] of [[1, true], [2, false], [10, true], [11, false]] as const) {
      const host = await shown(n, { action: 'Submit rating' });
      expect(host.querySelector('[data-part="rating-saved"]')!.textContent).toBe('Rating saved. mira.k can see it now.');
      expect(host.querySelector('[data-part="feedback-card"]') !== null, `trade ${n}`).toBe(asks);
    }
  });

  it('Neutral is a saved rating too; Skip review leaves nothing on the screen', async () => {
    expect((await shown(1, { action: 'Neutral, skip details' })).querySelector('[data-part="feedback-card"]')).not.toBeNull();
    expect((await shown(1, { action: 'Skip review' })).textContent).toBe('');
  });
});

describe('RateFirst (the rate-first gate)', () => {
  const P = (code: string, counterparty: string): PendingReview => ({ code, counterparty, reviewableSince: '2026-11-01T00:00:00.000Z' });

  function gate(lists: PendingReview[][]) {
    const cleared: boolean[] = [];
    let i = 0;
    okFetch();
    const { host } = render(
      <MemoryRouter>
        <RateFirst onCleared={(r) => cleared.push(r)} loadPending={async () => lists[Math.min(i++, lists.length - 1)]!} loadRated={async () => 'seller'} />
      </MemoryRouter>,
    );
    return { host, cleared };
  }
  const okFetch = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));

  it('says why, shows the card for the oldest pending trade, and carries the feedback line', async () => {
    const { host } = gate([[P('A', 'mira.k'), P('B', 'satoshi_ghost')]]);
    await flush();
    await flush();
    expect(host.querySelector('[data-part="rate-first-body"]')!.textContent).toBe(RATE_FIRST.body);
    expect(host.querySelector('[data-part="rate-first-count"]')!.textContent).toBe('2 trades to rate');
    expect(host.querySelector('h2')!.textContent).toBe('How was trading with mira.k?');
    expect(host.querySelector('[data-part="feedback-line"] a')!.getAttribute('href')).toBe('/feedback?from=review-pending');
  });

  it('one card per pending trade; once the list is empty it reports cleared (so the take goes again)', async () => {
    const { host, cleared } = gate([[P('A', 'mira.k'), P('B', 'satoshi_ghost')], [P('B', 'satoshi_ghost')], []]);
    await flush();
    await flush();
    click(buttonNamed(host, 'Neutral, skip details')!);
    await flush();
    await flush();
    await flush();
    expect(host.querySelector('h2')!.textContent).toBe('How was trading with satoshi_ghost?');
    expect(cleared).toEqual([]);
    click(buttonNamed(host, 'Skip review')!);
    await flush();
    await flush();
    expect(cleared).toEqual([true]);
  });

  it('an empty list from the start reports cleared(false): nothing was rated, so nothing is retried', async () => {
    const { cleared } = gate([[]]);
    await flush();
    expect(cleared).toEqual([false]);
  });
});

describe('the refused take', () => {
  it('review-pending is worded as the rate-first line', () => {
    expect(takeRefusal(new ApiCallError(409, 'review-pending'), { minTrades: 0 } as QuoteOffer)).toBe(RATE_FIRST.inline);
    expect(RATE_FIRST.title).toBe('Rate your last trade to continue');
  });
});

describe('AcceptedSheet meets the gate (409 review-pending on the wallet pick)', () => {
  const EVENT = { type: 'accepted' as const, code: 'X2F-7KQ4-M9TD', by: 'mira.K_77' };
  const WALLET: AcceptedWallet = { id: 'w1', app: 'cake', label: 'Cake main', address: `5${'A'.repeat(88)}a1b2c3`, addressEnd: 'a1b2c3', usable: true };
  const VIEW: AcceptedTradeView = { role: 'seller', poster: 'seller', amountAtomic: '1250000000000', grown: null, lockedRate: { currency: 'EUR', centsPerXmr: '15000' }, maxFiatCents: '20000' };

  it('shows the rating for the pending trade, then picks the same wallet again and moves on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));
    const calls: string[] = [];
    let refuse = true;
    const done: string[] = [];
    const lists: PendingReview[][] = [[{ code: 'OLD-1', counterparty: 'bob', reviewableSince: '2026-11-01T00:00:00.000Z' }], []];
    render(
      <MemoryRouter>
        <AcceptedSheet
          event={EVENT}
          loadWallets={async () => [WALLET]}
          loadTrade={async () => VIEW}
          submit={async (_c, w) => {
            calls.push(w);
            if (refuse) {
              refuse = false;
              throw new ApiCallError(409, 'review-pending');
            }
          }}
          rateFirst={{ loadPending: async () => lists.shift() ?? [], loadRated: async () => 'buyer' }}
          onDone={(c) => done.push(c)}
          onClose={() => undefined}
        />
      </MemoryRouter>,
    );
    await flush();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    click(dialog.querySelector('input[type="radio"]')!);
    click(buttonNamed(dialog, 'Use this wallet')!);
    await flush();
    await flush();
    await flush();
    expect(dialog.querySelector('[data-part="rate-first-title"]')!.textContent).toBe('Rate your last trade to continue');
    expect(dialog.querySelector('[data-part="review-card"] h2')!.textContent).toBe('How was trading with bob?');
    // The poster rates a buyer: "Fast payment".
    expect(dialog.textContent).toContain('Fast payment');
    click(buttonNamed(dialog, 'Neutral, skip details')!);
    await flush();
    await flush();
    await flush();
    expect(calls).toEqual(['w1', 'w1']);
    expect(done).toEqual([EVENT.code]);
  });
});
