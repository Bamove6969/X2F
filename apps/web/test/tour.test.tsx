// @vitest-environment happy-dom
// The welcome screen and the guided tours (owner, 12 Nov 2026, demo note #47; design,
// wip/design-brief b3b8315b tour-stops.md and tour-motion.md): the engine's two flows, the
// once-per-device welcome flag, the remembered stop, the first-trade tour's 17 stops word for word,
// and the shell (scrim and ring, card, Skip / Back / Next, keys, the closed line, reduced motion).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backPos, indexOf, nextLabel, nextPos, posOf, progressOf, stepAt, type TourDef } from '../src/tour/engine.js';
import { FIRST_TRADE_TEXT, FIRST_TRADE_TOUR } from '../src/tour/firstTradeTour.js';
import { clearTourProgress, replayLabel, saveTourProgress, tourProgress } from '../src/tour/progress.js';
import { TourProvider, useTour } from '../src/tour/TourProvider.js';
import { WELCOME_SEEN_KEY, markWelcomeSeen, resetWelcomeMemory, welcomeSeen } from '../src/tour/welcomeSeen.js';
import { Sheet } from '../src/ui/Sheet.js';
import { fire, render, setReducedMotion } from './render.js';

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const press = (key: string) => fire(document.body, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
/** A key on whatever has focus, as a browser sends it. */
const pressOn = (key: string, shiftKey = false) =>
  fire(document.activeElement ?? document.body, new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

/** A page-by-page tour, as the staff and team-member tours will be. */
const TWO_PAGES: TourDef = {
  id: 'test',
  flow: 'screens',
  label: 'Test tour',
  pages: [
    {
      id: 'a',
      name: 'Page A',
      path: '/a',
      steps: [
        { id: 'a1', target: '#a1', title: 'First A', body: 'The first thing on page A.', placement: 'auto' },
        { id: 'a2', target: '#a2', title: 'Second A', body: 'The second thing on page A.', placement: 'below' },
      ],
    },
    {
      id: 'b',
      name: 'Page B',
      path: '/b',
      steps: [{ id: 'b1', target: null, title: 'Only B', body: 'The only thing on page B.', placement: 'center' }],
    },
  ],
};

describe('tour engine', () => {
  it('walks the steps of a page, then the next page, then ends', () => {
    expect(nextPos(TWO_PAGES, { page: 0, step: 0 })).toEqual({ page: 0, step: 1 });
    expect(nextPos(TWO_PAGES, { page: 0, step: 1 })).toEqual({ page: 1, step: 0 });
    expect(nextPos(TWO_PAGES, { page: 1, step: 0 })).toBe('done');
  });

  it('goes back within a page, then to the last step of the page before, and not before the first', () => {
    expect(backPos(TWO_PAGES, { page: 1, step: 0 })).toEqual({ page: 0, step: 1 });
    expect(backPos(TWO_PAGES, { page: 0, step: 1 })).toEqual({ page: 0, step: 0 });
    expect(backPos(TWO_PAGES, { page: 0, step: 0 })).toBeNull();
  });

  it('page by page: Next, then "Next screen" after the last stop on a page, then Finish; counted per page', () => {
    expect(nextLabel(TWO_PAGES, { page: 0, step: 0 })).toBe('Next');
    expect(nextLabel(TWO_PAGES, { page: 0, step: 1 })).toBe('Next screen');
    expect(nextLabel(TWO_PAGES, { page: 1, step: 0 })).toBe('Finish');
    expect(progressOf(TWO_PAGES, { page: 0, step: 1 })).toEqual({ index: 2, total: 2 });
    expect(progressOf(TWO_PAGES, { page: 1, step: 0 })).toEqual({ index: 1, total: 1 });
  });

  it('a story: Next on every stop, Done on the last, never "Next screen"; counted across the tour', () => {
    const labels = FIRST_TRADE_TEXT.map((_, i) => nextLabel(FIRST_TRADE_TOUR, posOf(FIRST_TRADE_TOUR, i)));
    expect(labels.slice(0, 16).every((l) => l === 'Next')).toBe(true);
    expect(labels[16]).toBe('Done');
    expect(progressOf(FIRST_TRADE_TOUR, posOf(FIRST_TRADE_TOUR, 5))).toEqual({ index: 6, total: 17 });
  });

  it('maps tour-wide indexes and positions both ways', () => {
    for (let i = 0; i < 17; i++) expect(indexOf(FIRST_TRADE_TOUR, posOf(FIRST_TRADE_TOUR, i))).toBe(i);
    expect(posOf(FIRST_TRADE_TOUR, 99)).toEqual(posOf(FIRST_TRADE_TOUR, 16));
    expect(stepAt(TWO_PAGES, { page: 1, step: 0 }).id).toBe('b1');
  });
});

describe('the welcome flag (once per device)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWelcomeMemory();
  });
  afterEach(() => vi.restoreAllMocks());

  it('is unseen on a new device and seen once marked, in localStorage', () => {
    expect(welcomeSeen()).toBe(false);
    markWelcomeSeen();
    expect(welcomeSeen()).toBe(true);
    expect(window.localStorage.getItem(WELCOME_SEEN_KEY)).toBe('1');
  });

  it('falls back to memory when the store throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(welcomeSeen()).toBe(false);
    markWelcomeSeen();
    expect(welcomeSeen()).toBe(true);
  });
});

describe('the remembered stop', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads "Carry on the tour" while one is half done, "Take the tour again" otherwise', () => {
    expect(replayLabel('first-trade')).toBe('Take the tour again');
    saveTourProgress('first-trade', 4);
    expect(tourProgress('first-trade')).toBe(4);
    expect(replayLabel('first-trade')).toBe('Carry on the tour');
    clearTourProgress('first-trade');
    expect(replayLabel('first-trade')).toBe('Take the tour again');
  });
});

describe('the first-trade tour (design, tour-stops.md §2)', () => {
  const steps = FIRST_TRADE_TOUR.pages.flatMap((p) => p.steps);

  it('is 17 stops on 6 screens, every one on an example stage', () => {
    expect(FIRST_TRADE_TOUR.flow).toBe('story');
    expect(FIRST_TRADE_TOUR.pages.map((p) => p.name)).toEqual(['Find a trade', 'Offers', 'Quote', 'Fund', 'Check and release', 'Released']);
    expect(FIRST_TRADE_TOUR.pages.map((p) => p.steps.length)).toEqual([5, 5, 2, 2, 2, 1]);
    for (const p of FIRST_TRADE_TOUR.pages) expect(p.stage, p.id).toBeDefined();
  });

  it('uses design\'s card text exactly, with no titles', () => {
    expect(steps.map((s) => s.body)).toEqual([
      "First, decide why you're here: to buy Monero or to sell it.",
      "Let's pretend we're selling. Tap Sell.",
      'Next, pick the currency you want to be paid in.',
      'Then pick how you want to be paid.',
      "X2F hides every offer you don't qualify for yet. If a buyer only trades with people who have 10 or more completed trades, a brand-new account won't see that offer. Everything you see, you can take right now.",
      'Here are the offers open to you.',
      "Each card tells you about the trader: the badges they've earned...",
      "...how far above the market price they'll pay: this one pays 2% above market...",
      '...and the trade sizes they accept: this one takes $50 to $1,000. In other currencies we convert at the real exchange rate, with nothing added.',
      "Let's take this one. Tap the offer.",
      "Enter how much you want to sell. You'll see exactly what you get.",
      'Send your request. The buyer accepts, and the trade starts.',
      'Now lock your Monero in escrow. Scan this code with your wallet, or copy the address and amount.',
      "Once it's secured, the buyer is told to pay you. Nobody can touch the coins while the trade is open.",
      "The buyer sends $200 by Cash App and taps I've paid. Check your Cash App: only your own account proves the money arrived.",
      'Got the money? Press and hold to release. The Monero goes to the buyer.',
      "That's your first trade. Rate the buyer, and you're done. Buying works the same way, the other way round.",
    ]);
    expect(steps.every((s) => s.title === undefined)).toBe(true);
  });

  it('centres stops 5 and 17 with their tiles; stop 1 alternates; every other stop has a target', () => {
    expect([steps[4]!.icon, steps[4]!.target, steps[16]!.icon, steps[16]!.target]).toEqual(['eye-off', null, 'tick', null]);
    expect(steps[0]!.alternate).toHaveLength(2);
    expect(steps.filter((s, i) => i !== 4 && i !== 16).every((s) => s.target !== null)).toBe(true);
  });
});

let where = '';
function Where() {
  where = useLocation().pathname;
  return null;
}
function Starter({ tour }: { tour: TourDef }) {
  const t = useTour();
  return (
    <>
      <button type="button" id="start" onClick={() => t.start(tour)}>
        Start
      </button>
      <button type="button" id="resume" onClick={() => t.start(tour, { resume: true })}>
        Resume
      </button>
    </>
  );
}
function Page({ name }: { name: string }) {
  return (
    <main>
      <p id={`${name}1`}>One</p>
      <p id={`${name}2`}>Two</p>
    </main>
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
}

function mount(tour: TourDef = TWO_PAGES) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Where />
      <TourProvider>
        <Starter tour={tour} />
        <Routes>
          <Route path="/start" element={null} />
          <Route path="/a" element={<Page name="a" />} />
          <Route path="/b" element={<Page name="b" />} />
          <Route path="/sell" element={null} />
        </Routes>
      </TourProvider>
    </MemoryRouter>,
  );
}

const card = () => document.querySelector<HTMLElement>('[data-part="tour-card"]');
const btn = (part: string) => card()?.querySelector<HTMLButtonElement>(`[data-part="${part}"]`) ?? null;

describe('the tour shell', () => {
  beforeEach(() => window.localStorage.clear());

  it('opens on the first page, Next, then "Next screen" goes to the next page, Back returns', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    expect(where).toBe('/a');
    expect(card()?.querySelector('h2')?.textContent).toBe('First A');
    expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe('1 of 2');
    expect(card()?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Page 1 of 2, Page A');
    expect(btn('tour-back')?.disabled).toBe(true);
    click(btn('tour-next')!);
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
    expect(btn('tour-next')?.textContent).toBe('Next screen');
    click(btn('tour-next')!);
    await settle();
    expect(where).toBe('/b');
    expect(card()?.querySelector('h2')?.textContent).toBe('Only B');
    click(btn('tour-back')!);
    await settle();
    expect(where).toBe('/a');
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
  });

  it('cuts a hole with a ring round the target and draws no ring for a centred stop', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    expect(document.querySelector('[data-part="tour-overlay"]')).not.toBeNull();
    expect(document.querySelector('[data-part="tour-ring"]')).not.toBeNull();
    click(btn('tour-next')!);
    await settle();
    click(btn('tour-next')!);
    await settle();
    expect(document.querySelector('[data-part="tour-ring"]')).toBeNull();
    expect(document.querySelector('[data-part="tour-arrow"]')).toBeNull();
    expect(card()?.dataset.placement).toBe('center');
  });

  it('keys: → Next, ← Back, Esc Skip tour', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    press('ArrowRight');
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
    press('ArrowLeft');
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('First A');
    press('Escape');
    await settle();
    expect(card()).toBeNull();
  });

  it('Skip tour closes it at once and shows "Tour closed" with Restart', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    click(btn('tour-skip')!);
    await settle();
    expect(card()).toBeNull();
    const line = document.querySelector('[data-part="tour-closed"]');
    expect(line?.textContent).toContain('Tour closed. Take it again any time from Settings, under Help.');
    click(line!.querySelector('button')!);
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('First A');
  });

  // The member tour has no Settings › Help to replay from yet: its closed line says only that.
  it('a tour may name its own closed line', async () => {
    const { host } = mount({ ...TWO_PAGES, closed: 'Tour closed.' });
    click(host.querySelector('#start')!);
    await settle();
    click(btn('tour-skip')!);
    await settle();
    expect(document.querySelector('[data-part="tour-closed"] span')?.textContent).toBe('Tour closed.');
  });

  it('remembers the stop until finished, and resumes there', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    click(btn('tour-next')!);
    await settle();
    expect(tourProgress('test')).toBe(1);
    click(btn('tour-skip')!);
    await settle();
    click(host.querySelector('#resume')!);
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
    click(btn('tour-next')!);
    await settle();
    click(btn('tour-next')!);
    await settle();
    expect(card()).toBeNull();
    expect(tourProgress('test')).toBeNull();
  });

  it('the first-trade tour runs on its example stage, with no title, counted "n of 17", ending on Done', async () => {
    const { host } = mount(FIRST_TRADE_TOUR);
    click(host.querySelector('#start')!);
    await settle();
    expect(document.querySelector('[data-part="tour-stage"] [data-tour="seg"]')).not.toBeNull();
    expect(card()?.querySelector('h2')).toBeNull();
    expect(card()?.getAttribute('aria-label')).toBe('First trade tour');
    expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe('1 of 17');
    expect(card()?.querySelector('[data-part="tour-body"]')?.textContent).toBe(FIRST_TRADE_TEXT[0]);
    for (let i = 1; i < 17; i++) {
      click(btn('tour-next')!);
      await settle();
      expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe(`${i + 1} of 17`);
    }
    expect(document.querySelector('[data-part="tour-stage"] [data-part="example"]')).not.toBeNull();
    expect(btn('tour-next')?.textContent).toBe('Done');
    click(btn('tour-next')!);
    await settle();
    expect(card()).toBeNull();
    expect(where).toBe('/sell');
  });

  it('runs the calm version under prefers-reduced-motion', async () => {
    setReducedMotion(true);
    try {
      const { host } = mount();
      click(host.querySelector('#start')!);
      await settle();
      expect(document.querySelector<HTMLElement>('[data-part="tour"]')?.dataset.motion).toBe('reduced');
    } finally {
      setReducedMotion(false);
    }
  });

  // Review 12 Nov, T2: the app behind the tour is inert, and Tab never leaves the card.
  it('makes #root inert while the tour runs, and lets it go when the tour ends', async () => {
    const { host } = mount();
    host.id = 'root';
    expect(host.hasAttribute('inert')).toBe(false);
    click(host.querySelector('#start')!);
    await settle();
    expect(host.hasAttribute('inert')).toBe(true);
    // The tour itself is outside the inert tree.
    expect(host.contains(card())).toBe(false);
    click(btn('tour-skip')!);
    await settle();
    expect(host.hasAttribute('inert')).toBe(false);
  });

  it('Tab and Shift+Tab stay in the card, round its buttons', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    click(btn('tour-next')!);
    await settle();
    // Second A: Skip tour, Back and Next are all enabled.
    btn('tour-next')!.focus();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      pressOn('Tab');
      expect(card()!.contains(document.activeElement)).toBe(true);
      seen.push((document.activeElement as HTMLElement).dataset.part!);
    }
    expect(seen).toEqual(['tour-skip', 'tour-back', 'tour-next', 'tour-skip', 'tour-back', 'tour-next']);
    pressOn('Tab', true);
    expect((document.activeElement as HTMLElement).dataset.part).toBe('tour-back');
    pressOn('Tab', true);
    pressOn('Tab', true);
    expect((document.activeElement as HTMLElement).dataset.part).toBe('tour-next');
  });

  // Review 12 Nov, T1: a Sheet ("Stay logged in?", the idle reminder) that opens during a tour is never
  // covered or cut off from the keyboard: the tour waits, out of the way, and comes back where it was.
  it('waits while a Sheet is open: no scrim or card, the keys are the Sheet\'s, then it carries on at the same stop', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    click(btn('tour-next')!);
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
    let closed = 0;
    const sheet = render(
      <Sheet open title="Stay logged in?" onClose={() => closed++}>
        <button type="button" id="stay">
          Stay logged in
        </button>
      </Sheet>,
    );
    await settle();
    expect(document.querySelector('[data-part="tour"]')).toBeNull();
    expect(card()).toBeNull();
    // The Sheet has focus, and the keys reach it: Escape closes the Sheet, not the tour.
    expect(document.querySelector('.x2f-sheet')!.contains(document.activeElement)).toBe(true);
    pressOn('ArrowRight');
    pressOn('Escape');
    expect(closed).toBe(1);
    sheet.unmount();
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
    expect(tourProgress('test')).toBe(1);
  });

  it('cuts the hole with an even-odd path, not an SVG mask (the proof tripwire allows no url())', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    expect(document.querySelector('[data-part="tour-overlay"] mask')).toBeNull();
    const dim = document.querySelector('[data-part="tour-overlay"] [data-part="tour-dim"]')!;
    expect(dim.getAttribute('fill-rule')).toBe('evenodd');
    // The screen, then the rounded hole round the target.
    expect(dim.getAttribute('d')!.match(/Z/g)).toHaveLength(2);
    click(btn('tour-next')!);
    await settle();
    click(btn('tour-next')!);
    await settle();
    // A centred stop has no hole.
    expect(document.querySelector('[data-part="tour-dim"]')!.getAttribute('d')!.match(/Z/g)).toHaveLength(1);
  });

  it('the example trader is example_seller, a reserved name nobody can register', async () => {
    const { host } = mount(FIRST_TRADE_TOUR);
    click(host.querySelector('#start')!);
    await settle();
    for (let i = 1; i < 12; i++) {
      click(btn('tour-next')!);
      await settle();
    }
    const text = document.querySelector('[data-part="tour-stage"]')!.textContent!;
    expect(text).toContain('example_seller');
    expect(text).not.toContain('satoshi_ghost');
  });

  it('has no illustration or 3D layer (owner, 12 Nov: the isometric style is rejected)', async () => {
    const { host } = mount(FIRST_TRADE_TOUR);
    click(host.querySelector('#start')!);
    await settle();
    expect(document.querySelector('[data-part="tour-illustration"], canvas')).toBeNull();
  });
});
