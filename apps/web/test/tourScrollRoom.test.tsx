// @vitest-environment happy-dom
// Owner demo notes #99 and #100 (16 Nov 2026, on a 1239x675 computer screen):
// - #99 "during the tour i am unable to scroll down on the right to see whats lower ... Screen should
//   prolly auto scroll down": every stop scrolls its target onto the screen, on a computer (the card
//   beside it) and on a phone; and the wheel, a finger drag and ↓ / Page Down still scroll the screen
//   behind the tour.
// - #100 "The tour is complete void of showing the actual trading window where the is an open chat
//   and it lists the two members in the chat and maybe show some communcation back and forth": the
//   first-trade tour's trade room stops, on the pretend trade only.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_NOTICE } from '../src/chat/ChatPanel.js';
import type { TourDef, TourStageProps } from '../src/tour/engine.js';
import { FirstTradeStage, ROOM_LINES, ROOM_NOTICE, screenOf } from '../src/tour/FirstTradeStage.js';
import { FIRST_TRADE_TOUR, TRADE_ROOM_TEXT } from '../src/tour/firstTradeTour.js';
import { TourProvider, useTour } from '../src/tour/TourProvider.js';
import { fire, render } from './render.js';

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const press = (key: string) => fire(document.body, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
}

/** A pretend scroller, 3000 px of content in a window-high box, and where it has been moved to. */
const scroller = { top: 0, calls: [] as number[] };
const FAR = 1200;

function fakeScroller(el: HTMLDivElement | null) {
  if (el === null) return;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scroller.top, set: (v: number) => (scroller.top = v) });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 3000 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => window.innerHeight });
  el.scrollBy = ((o: ScrollToOptions) => {
    scroller.calls.push(o.top ?? 0);
    scroller.top += o.top ?? 0;
  }) as typeof el.scrollBy;
}

function place(el: HTMLElement | null, y: () => number) {
  if (el === null) return;
  el.getBoundingClientRect = () => {
    const top = y();
    return { x: 16, y: top, left: 16, top, width: 300, height: 80, right: 316, bottom: top + 80, toJSON: () => ({}) } as DOMRect;
  };
}

/** One near the top, one far down the stage (1200 px), as a long screen on a short window. */
function LongStage(_: TourStageProps) {
  return (
    <div data-tour-scroll="" ref={fakeScroller}>
      <p id="near" ref={(el) => place(el, () => 100 - scroller.top)}>
        Near
      </p>
      <p id="far" ref={(el) => place(el, () => FAR - scroller.top)}>
        Far
      </p>
    </div>
  );
}

const LONG: TourDef = {
  id: 'long',
  flow: 'story',
  label: 'Long tour',
  pages: [
    {
      id: 'p',
      name: 'Long page',
      path: null,
      stage: LongStage,
      steps: [
        { id: 'near', target: '#near', body: 'Near the top.', placement: 'auto' },
        { id: 'far', target: '#far', body: 'Far down.', placement: 'auto' },
      ],
    },
  ],
};

function Starter({ tour }: { tour: TourDef }) {
  const t = useTour();
  return (
    <button type="button" id="start" onClick={() => t.start(tour)}>
      Start
    </button>
  );
}

function mount(tour: TourDef) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <TourProvider>
        <Starter tour={tour} />
      </TourProvider>
    </MemoryRouter>,
  );
}

const card = () => document.querySelector<HTMLElement>('[data-part="tour-card"]');
const next = () => card()!.querySelector<HTMLButtonElement>('[data-part="tour-next"]')!;
const tourRoot = () => document.querySelector<HTMLElement>('[data-part="tour"]')!;

const saved = { w: window.innerWidth, h: window.innerHeight };
function screen(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

describe('demo note #99: the tour scrolls', () => {
  beforeEach(() => {
    window.localStorage.clear();
    scroller.top = 0;
    scroller.calls = [];
  });
  afterEach(() => screen(saved.w, saved.h));

  for (const [name, w, h, placement] of [
    ['the owner\'s computer (1239x675), the card beside', 1239, 675, 'side'],
    ['a phone (390x844), the card below', 390, 844, 'below'],
  ] as const) {
    it(`on ${name}: a stop whose target is below the fold scrolls it onto the screen; one in view stays put`, async () => {
      screen(w, h);
      const { host } = mount(LONG);
      click(host.querySelector('#start')!);
      await settle();
      expect(card()?.dataset.placement).toBe(placement);
      expect(scroller.calls).toEqual([]);
      click(next());
      await settle();
      expect(card()?.dataset.placement).toBe(placement);
      // Brought near the top: 12 px edge, 6 px ring padding and 4 px.
      expect(scroller.calls).toEqual([FAR - 22]);
      const far = document.querySelector('#far')!.getBoundingClientRect();
      expect(far.top).toBeGreaterThanOrEqual(0);
      expect(far.bottom).toBeLessThanOrEqual(h);
      // Back to the first stop: its target is above the screen now, so it comes back near the top.
      click(card()!.querySelector<HTMLButtonElement>('[data-part="tour-back"]')!);
      await settle();
      expect(scroller.calls).toEqual([FAR - 22, 100 - FAR]);
      expect(document.querySelector('#near')!.getBoundingClientRect().top).toBe(22);
    });
  }

  it('the wheel over the tour scrolls the screen behind it (and is not left to the page)', async () => {
    screen(1239, 675);
    const { host } = mount(LONG);
    click(host.querySelector('#start')!);
    await settle();
    const wheel = new WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true });
    fire(document.querySelector('.x2f-tour__catch')!, wheel);
    expect(scroller.top).toBe(300);
    expect(wheel.defaultPrevented).toBe(true);
    // Lines are turned into pixels; it stops at the ends.
    fire(tourRoot(), new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true }));
    expect(scroller.top).toBe(180);
    fire(tourRoot(), new WheelEvent('wheel', { deltaY: -5000, bubbles: true, cancelable: true }));
    expect(scroller.top).toBe(0);
    fire(tourRoot(), new WheelEvent('wheel', { deltaY: 9000, bubbles: true, cancelable: true }));
    expect(scroller.top).toBe(3000 - 675);
    // The highlight follows: the tour is still on its first stop.
    expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe('1 of 2');
  });

  it('↓ and Page Down scroll; ↑ and Page Up scroll back; → still goes to the next stop', async () => {
    screen(1239, 675);
    const { host } = mount(LONG);
    click(host.querySelector('#start')!);
    await settle();
    press('ArrowDown');
    expect(scroller.top).toBe(40);
    press('PageDown');
    expect(scroller.top).toBeCloseTo(40 + 675 * 0.85);
    press('PageUp');
    press('ArrowUp');
    expect(scroller.top).toBeCloseTo(0);
    expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe('1 of 2');
    press('ArrowRight');
    await settle();
    expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe('2 of 2');
  });

  it('a finger drag on a phone scrolls the screen behind', async () => {
    screen(390, 844);
    const { host } = mount(LONG);
    click(host.querySelector('#start')!);
    await settle();
    const at = (y: number) => [{ clientX: 100, clientY: y, identifier: 1, target: tourRoot() }] as unknown as Touch[];
    const touch = (type: string, y: number) =>
      new TouchEvent(type, { touches: type === 'touchend' ? [] : at(y), changedTouches: at(y), bubbles: true, cancelable: true });
    fire(tourRoot(), touch('touchstart', 600));
    const move = touch('touchmove', 450);
    fire(tourRoot(), move);
    expect(scroller.top).toBe(150);
    expect(move.defaultPrevented).toBe(true);
    fire(tourRoot(), touch('touchmove', 500));
    expect(scroller.top).toBe(100);
    fire(tourRoot(), touch('touchend', 500));
    fire(tourRoot(), touch('touchmove', 300));
    expect(scroller.top).toBe(100);
  });
});

describe('demo note #100: the trade room with its chat', () => {
  beforeEach(() => window.localStorage.clear());

  const roomPage = FIRST_TRADE_TOUR.pages.findIndex((p) => p.id === 'room');
  const first = FIRST_TRADE_TOUR.pages.slice(0, roomPage).reduce((n, p) => n + p.steps.length, 0);

  it('comes right after Fund and before the buyer pays: stops 15 and 16 of 19, on the members and the chat', () => {
    expect(roomPage).toBe(4);
    expect(first).toBe(14);
    const steps = FIRST_TRADE_TOUR.pages[roomPage]!.steps;
    expect(steps.map((s) => s.body)).toEqual([...TRADE_ROOM_TEXT]);
    expect(steps.map((s) => s.target)).toEqual(['[data-part="tour-stage"] [data-tour="members"]', '[data-part="tour-stage"] [data-tour="chat"]']);
    expect([screenOf(13), screenOf(14), screenOf(15), screenOf(16)]).toEqual([3, 4, 4, 5]);
  });

  it('uses the real chat notice word for word', () => {
    expect(ROOM_NOTICE).toBe(CHAT_NOTICE);
  });

  it('lists the two people in the chat, and the lines come in back and forth when the chat stop plays', async () => {
    const r = render(<FirstTradeStage stop={14} acted={true} reduced={false} />);
    const members = r.host.querySelector('[data-tour="members"]')!;
    expect(members.getAttribute('aria-label')).toBe('In this chat');
    expect([...members.querySelectorAll('.x2f-ex__person .x2f-ex__name > span:first-child')].map((n) => n.textContent)).toEqual(['You', 'example_seller Vendor']);
    expect(r.host.querySelector('[data-part="example"]')).not.toBeNull();
    const lines = () => [...r.host.querySelectorAll('[data-tour="chat"] .x2f-ex__line')].map((l) => (l as HTMLElement).dataset.from);
    expect(lines()).toEqual(['them']);
    expect(r.host.querySelector('[data-tour="chat"] .x2f-ex__notice')?.textContent).toBe(CHAT_NOTICE);
    // Stop 16: the seller's reply, then the buyer's answer.
    r.rerender(<FirstTradeStage stop={15} acted={false} reduced={false} />);
    expect(lines()).toEqual(['them']);
    r.rerender(<FirstTradeStage stop={15} acted={true} reduced={false} />);
    await act(async () => {
      await new Promise((res) => setTimeout(res, 1000));
    });
    expect(lines()).toEqual(['them', 'me', 'them']);
    expect([...r.host.querySelectorAll('.x2f-ex__bubble')].map((b) => b.textContent)).toEqual(ROOM_LINES.map((l) => l.text));
    // Back undoes it.
    r.rerender(<FirstTradeStage stop={14} acted={true} reduced={false} />);
    expect(lines()).toEqual(['them']);
  });

  it('calm: all the lines at once; and the screens after it keep their places', () => {
    const r = render(<FirstTradeStage stop={15} acted={true} reduced={true} />);
    expect(r.host.querySelectorAll('[data-tour="chat"] .x2f-ex__line')).toHaveLength(3);
    r.rerender(<FirstTradeStage stop={16} acted={true} reduced={false} />);
    expect(r.host.querySelector('[data-tour="paid"]')?.textContent).toContain('example_seller marked this trade paid.');
    r.rerender(<FirstTradeStage stop={18} acted={false} reduced={false} />);
    expect(r.host.querySelector('.x2f-ex__stars')).not.toBeNull();
  });

  it('the whole tour walks through the room: count 15 of 19 on the members, 16 of 19 on the chat', async () => {
    const { host } = mount(FIRST_TRADE_TOUR);
    click(host.querySelector('#start')!);
    await settle();
    for (let i = 1; i <= first; i++) {
      click(next());
      await settle();
    }
    expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe('15 of 19');
    expect(card()?.querySelector('[data-part="tour-body"]')?.textContent).toBe(TRADE_ROOM_TEXT[0]);
    expect(card()?.querySelector('[aria-label="Page 5 of 7, Trade room"]')).not.toBeNull();
    expect(document.querySelector('[data-part="tour-stage"] [data-tour="members"]')).not.toBeNull();
    expect(document.querySelector('[data-part="tour-ring"]')).not.toBeNull();
    click(next());
    await settle();
    expect(card()?.querySelector('[data-part="tour-count"]')?.textContent).toBe('16 of 19');
    expect(card()?.querySelector('[data-part="tour-body"]')?.textContent).toBe(TRADE_ROOM_TEXT[1]);
    click(next());
    await settle();
    expect(document.querySelector('[data-part="tour-stage"] [data-tour="paid"]')).not.toBeNull();
   }, 20_000);
});
