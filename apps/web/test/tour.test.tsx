// @vitest-environment happy-dom
// The welcome screen and the guided tour (owner, 12 Nov 2026, demo note #47 on /sell; to-design
// 12 Nov, "Guided site tour"): the tour engine's step order and labels, the once-per-device welcome
// flag, the trader tour's content, and the tour shell (card, Back / Next / Next screen, Skip, the
// optional illustration slot for the isometric scene).
import { act, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backPos, nextLabel, nextPos, stepAt, type TourDef } from '../src/tour/engine.js';
import { TourProvider, useTour } from '../src/tour/TourProvider.js';
import { TRADER_TOUR } from '../src/tour/traderTour.js';
import { WELCOME_SEEN_KEY, markWelcomeSeen, resetWelcomeMemory, welcomeSeen } from '../src/tour/welcomeSeen.js';
import { fire, render, setReducedMotion } from './render.js';

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));

const TWO_PAGES: TourDef = {
  id: 'test',
  pages: [
    {
      id: 'a',
      name: 'Page A',
      path: '/a',
      steps: [
        { id: 'a1', target: '#a1', title: 'First A', body: 'The first thing on page A.', placement: 'auto' },
        { id: 'a2', target: '#a2', title: 'Second A', body: 'The second thing on page A.', placement: 'below', illustration: 'scene-a2' },
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

  it('labels Next, then "Next screen" after the last feature on a page, then Finish', () => {
    expect(nextLabel(TWO_PAGES, { page: 0, step: 0 })).toBe('Next');
    expect(nextLabel(TWO_PAGES, { page: 0, step: 1 })).toBe('Next screen');
    expect(nextLabel(TWO_PAGES, { page: 1, step: 0 })).toBe('Finish');
  });

  it('finds the step at a position', () => {
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

describe('the trader tour content', () => {
  const ids = TRADER_TOUR.pages.map((p) => p.id);
  const all = TRADER_TOUR.pages.flatMap((p) => p.steps);
  const text = (pageId: string) =>
    TRADER_TOUR.pages
      .find((p) => p.id === pageId)!
      .steps.map((s) => `${s.title} ${s.body}`)
      .join(' ');

  it('covers the main screens in order', () => {
    expect(ids).toEqual(['buy-sell', 'offers', 'post', 'trades', 'wallets', 'security']);
    for (const p of TRADER_TOUR.pages) expect(p.steps.length, p.id).toBeGreaterThanOrEqual(2);
  });

  it('every step has a unique id, a short title and a real explanation, with no exclamation marks', () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(s.title.length, s.id).toBeLessThanOrEqual(40);
      expect(s.body.length, s.id).toBeGreaterThanOrEqual(60);
      expect(s.body.length, s.id).toBeLessThanOrEqual(320);
      expect(`${s.title}${s.body}`, s.id).not.toContain('!');
    }
  });

  it('says how X2F works: the method picker, 2-of-3 escrow, the poster-only 1% fee, I\'ve paid, release, dispute', () => {
    expect(text('buy-sell')).toMatch(/payment method/i);
    expect(text('offers')).toMatch(/taking an offer is free/i);
    expect(text('post')).toMatch(/1%/);
    expect(text('post')).toMatch(/only when someone takes your offer|only the person who posted/i);
    expect(text('trades')).toMatch(/2-of-3/);
    expect(text('trades')).toMatch(/I.ve paid/);
    expect(text('trades')).toMatch(/hold/i);
    expect(text('trades')).toMatch(/dispute/i);
    expect(text('trades')).toMatch(/end-to-end encrypted/i);
    expect(text('wallets')).toMatch(/never holds your coins/i);
  });

  it('never tells the taker they pay the X2F fee', () => {
    expect(text('offers')).not.toMatch(/you pay (a |the )?1%/i);
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
    <button type="button" id="start" onClick={() => t.start(tour)}>
      Start
    </button>
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

function mount(renderIllustration?: (scene: string) => ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Where />
      <TourProvider {...(renderIllustration ? { renderIllustration } : {})}>
        <Routes>
          <Route path="/start" element={<Starter tour={TWO_PAGES} />} />
          <Route path="/a" element={<Page name="a" />} />
          <Route path="/b" element={<Page name="b" />} />
        </Routes>
      </TourProvider>
    </MemoryRouter>,
  );
}

const card = () => document.querySelector<HTMLElement>('[data-part="tour-card"]');
const btn = (label: string) => [...(card()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label);

describe('the tour shell', () => {
  it('opens on the first page, goes Next, then "Next screen" goes to the next page', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    expect(where).toBe('/a');
    expect(card()?.querySelector('h2')?.textContent).toBe('First A');
    expect(card()?.textContent).toContain('1 of 3');
    expect(btn('Back')?.disabled).toBe(true);
    click(btn('Next')!);
    await settle();
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
    click(btn('Next screen')!);
    await settle();
    expect(where).toBe('/b');
    expect(card()?.querySelector('h2')?.textContent).toBe('Only B');
    // Back from the first step of page B returns to page A's last step.
    click(btn('Back')!);
    await settle();
    expect(where).toBe('/a');
    expect(card()?.querySelector('h2')?.textContent).toBe('Second A');
  });

  it('highlights the target, and centres the card with no arrow when a step has none', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    expect(document.querySelector('[data-part="tour-spot"]')).not.toBeNull();
    expect(document.querySelector('[data-part="tour-arrow"]')).not.toBeNull();
    click(btn('Next')!);
    await settle();
    click(btn('Next screen')!);
    await settle();
    expect(document.querySelector('[data-part="tour-spot"]')).toBeNull();
    expect(document.querySelector('[data-part="tour-arrow"]')).toBeNull();
    expect(card()?.dataset.placement).toBe('center');
  });

  it('Skip ends the tour at any step, and so does Escape', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    click(card()!.querySelector('[data-part="tour-skip"]')!);
    await settle();
    expect(card()).toBeNull();
    click(host.querySelector('#start')!);
    await settle();
    expect(card()).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();
    expect(card()).toBeNull();
  });

  it('Finish on the last step ends the tour', async () => {
    const { host } = mount();
    click(host.querySelector('#start')!);
    await settle();
    click(btn('Next')!);
    await settle();
    click(btn('Next screen')!);
    await settle();
    click(btn('Finish')!);
    await settle();
    expect(card()).toBeNull();
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

  it('hosts an illustration only where a step names a scene and a renderer is given', async () => {
    const { host } = mount((scene) => <span data-scene={scene}>art</span>);
    click(host.querySelector('#start')!);
    await settle();
    expect(document.querySelector('[data-part="tour-illustration"]')).toBeNull();
    click(btn('Next')!);
    await settle();
    expect(document.querySelector('[data-part="tour-illustration"] [data-scene="scene-a2"]')).not.toBeNull();
  });
});
