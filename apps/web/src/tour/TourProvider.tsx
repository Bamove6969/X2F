/**
 * The tour shell (owner, 12 Nov 2026, demo note #47: "a high quality tour with a quality looking
 * arrow that points to the area that's been explained and the area highlights"; design,
 * wip/design-brief b3b8315b: tour-stops.md §1 the shell, tour-motion.md §3-4 and §7 its motion).
 *
 * `TourProvider` sits inside the router around the whole app. `useTour().start(tour)` draws, over
 * the app (which is inert while the tour runs):
 * - an example stage when the page has one (the first-trade tour's pretend screens);
 * - the scrim (`tour-overlay`): an even-odd SVG path with a hole cut 6 px round the target, radius 14, and
 *   its ring (`tour-ring`), 2 px ink. The hole fades out (90 ms) and back in (120 ms) between stops,
 *   tweens when it moves within a stop, and on stop 1 alternates between targets with a breathing ring;
 * - the arrow (`tour-arrow`): one curved stroke, 2.5 px ink, its end aimed straight at the target,
 *   drawn in (320 ms) and its open chevron head faded in after;
 * - the card (`tour-card`): page bars, the count, the text, Skip tour / Back / Next (Done, Finish or
 *   Next screen by flow). Below the target when it fits with the 60 px arrow gap, else above, else
 *   the screen scrolls first; on a wide landscape screen (860+ wide) the card sits beside the target.
 * Keys: → and Enter Next, ← Back, Esc Skip tour; focus stays in the card. Skip shows "Tour closed"
 * with Restart for 6 s. The stop reached is kept on this device until the tour is finished, so the
 * Settings row can read "Carry on the tour". prefers-reduced-motion: parts swap with fades only.
 * While a Sheet is open (a session prompt), the tour waits out of the way (review 12 Nov, T1).
 *
 * CSS, SVG and the Web Animations API only; no runtime dependency. No 3D or illustration layer (the
 * owner rejected the isometric style on 12 Nov).
 *
 * DESIGNER-REVIEW: built from design's spec and prototype; design to check it against the boards.
 */
import { Suspense, createContext, useId, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { TOUR_LABELS, backPos, indexOf, nextLabel, nextPos, posOf, progressOf, resolvePath, stepAt, type TourDef, type TourPos, type TourStep } from './engine.js';
import { clearTourProgress, saveTourProgress, tourProgress } from './progress.js';
import './tour.css';

interface TourApi {
  /** Starts `tour` at its first stop, or (`resume`) where this device left it. */
  start: (tour: TourDef, o?: { resume?: boolean }) => void;
  skip: () => void;
  active: boolean;
}

const TourContext = createContext<TourApi>({ start: () => undefined, skip: () => undefined, active: false });

export function useTour(): TourApi {
  return useContext(TourContext);
}

type Run = { tour: TourDef; pos: TourPos; visited: Record<number, string> };

/** A Sheet (ui/Sheet.tsx) open on the page: it portals its layer straight into <body>. */
const SHEET_LAYER = 'body > .x2f-sheet-layer';

/**
 * Whether a Sheet is open. Review 12 Nov, T1: "Stay logged in?" (SessionPrompt), the idle reminder
 * and any other Sheet that opens while a tour runs must not sit under the scrim or lose the keyboard
 * to the card, so the tour waits while one is open and carries on at the same stop when it closes.
 */
function useSheetOpen(): boolean {
  const [open, setOpen] = useState(() => document.querySelector(SHEET_LAYER) !== null);
  useEffect(() => {
    const check = () => setOpen(document.querySelector(SHEET_LAYER) !== null);
    check();
    const watch = new MutationObserver(check);
    watch.observe(document.body, { childList: true });
    return () => watch.disconnect();
  }, []);
  return open;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [run, setRun] = useState<Run | null>(null);
  const [closed, setClosed] = useState<TourDef | null>(null);
  const sheetOpen = useSheetOpen();

  /** Moves to `to`, going to its page's screen first when the page changes. */
  const go = useCallback(
    (r: Omit<Run, 'pos'> & { pos: TourPos | null }, to: TourPos) => {
      const visited = { ...r.visited };
      if (r.pos === null || r.pos.page !== to.page) {
        const page = r.tour.pages[to.page]!;
        const here = window.location.pathname + window.location.search;
        // Back to a page already seen: the same screen as then. Forward: where the page says.
        const path = visited[to.page] ?? resolvePath(page, document);
        if (path !== null && path !== here) void navigate(path);
        visited[to.page] = path ?? here;
      }
      saveTourProgress(r.tour.id, indexOf(r.tour, to));
      setRun({ tour: r.tour, pos: to, visited });
    },
    [navigate],
  );

  const start = useCallback(
    (tour: TourDef, o?: { resume?: boolean }) => {
      setClosed(null);
      const saved = o?.resume === true ? tourProgress(tour.id) : null;
      go({ tour, pos: null, visited: {} }, saved === null ? { page: 0, step: 0 } : posOf(tour, saved));
    },
    [go],
  );
  const skip = useCallback(() => {
    setRun((r) => {
      if (r !== null) setClosed(r.tour);
      return null;
    });
  }, []);
  const next = useCallback(() => {
    if (run === null) return;
    const n = nextPos(run.tour, run.pos);
    if (n !== 'done') return go(run, n);
    clearTourProgress(run.tour.id);
    setRun(null);
    if (run.tour.endPath !== undefined) void navigate(run.tour.endPath);
  }, [run, go, navigate]);
  const back = useCallback(() => {
    if (run === null) return;
    const b = backPos(run.tour, run.pos);
    if (b !== null) go(run, b);
  }, [run, go]);

  // The app behind the tour is inert while it runs (tour-stops.md §1: "Everything behind it is inert").
  useEffect(() => {
    const root = document.getElementById('root');
    if (root === null || run === null) return;
    root.setAttribute('inert', '');
    return () => root.removeAttribute('inert');
  }, [run === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo(() => ({ start, skip, active: run !== null }), [start, skip, run]);
  return (
    <TourContext.Provider value={api}>
      {children}
      {/* While a Sheet is open the tour draws nothing and takes no keys: the Sheet is the person's (T1). */}
      {run !== null && !sheetOpen ? createPortal(<TourOverlay run={run} onNext={next} onBack={back} onSkip={skip} />, document.body) : null}
      {closed !== null && run === null ? createPortal(<ClosedLine onRestart={() => start(closed)} onGone={() => setClosed(null)} />, document.body) : null}
    </TourContext.Provider>
  );
}

/** "Tour closed" with Restart, for 6 s or until the next tap elsewhere (tour-stops.md §1). */
function ClosedLine({ onRestart, onGone }: { onRestart: () => void; onGone: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const id = setTimeout(onGone, 6000);
    const tap = (e: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onGone();
    };
    document.addEventListener('pointerdown', tap, true);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', tap, true);
    };
  }, [onGone]);
  return (
    <div ref={ref} className="x2f-tour-closed" role="status" data-part="tour-closed">
      <span>{TOUR_LABELS.closed}</span>
      <button type="button" className="x2f-tour-closed__restart" onClick={onRestart}>
        {TOUR_LABELS.restart}
      </button>
    </div>
  );
}

const REDUCED = '(prefers-reduced-motion: reduce)';
function prefersReduced(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;
}

/** The highlight's fade out before the next stop (tour-motion.md §4). */
const OUT_MS = 120;
/** How long a stop waits for its target to appear (a list still loading) before centring the card. */
const FIND_MS = 1500;
/** When the stop's action plays, after its text (tour-motion.md §4: "+700 to +1100"); calm: 300. */
const ACT_MS = 700;
const PAD = 6;
const EDGE = 12;
const GAP = 60;
const SIDE_GAP = 40;

type Rect = { x: number; y: number; w: number; h: number };
type Where = 'below' | 'above' | 'side' | 'center';

function visible(el: Element): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) return true;
  // Nothing laid out (happy-dom in unit tests): it counts when it is not hidden.
  return typeof (el as HTMLElement).checkVisibility === 'function' ? (el as HTMLElement).checkVisibility() : true;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

const same = (a: Rect | null, b: Rect | null) =>
  a === b || (a !== null && b !== null && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

function viewport(): { w: number; h: number } {
  return { w: window.innerWidth || 390, h: window.innerHeight || 844 };
}

/** Wide landscape (tour-motion.md §3 rule 3): an unfolded phone on its side, or any 860+ wide screen. */
function sideMode(): boolean {
  const v = viewport();
  return v.w >= 860 && v.w > v.h;
}

/** Below, above, or (neither fits) the scroll that makes room: where the card goes for `r`. */
function decide(el: Element | null, step: TourStep, cardHeight: number, reduced: boolean): Where {
  if (el === null || step.placement === 'center') return 'center';
  if (sideMode()) return 'side';
  const v = viewport();
  const r = el.getBoundingClientRect();
  const sticky = el.closest('.x2f-ex__foot') !== null;
  const fitsBelow = r.bottom + PAD + GAP + cardHeight + EDGE <= v.h;
  const fitsAbove = r.top - PAD - GAP - cardHeight >= EDGE;
  if (step.placement === 'below' && fitsBelow) return 'below';
  if (step.placement === 'above' && fitsAbove) return 'above';
  if (sticky) return 'above';
  if (fitsBelow) return 'below';
  if (fitsAbove) return 'above';
  // Neither fits: scroll the highlight near the top, with the card below it (§3 rule 2).
  const scroller = el.closest<HTMLElement>('[data-tour-scroll]');
  const by = r.top - (EDGE + PAD + 4);
  if (Math.abs(by) > 1) {
    const behavior = (reduced ? 'instant' : 'smooth') as ScrollBehavior;
    if (scroller !== null) scroller.scrollBy({ top: by, behavior });
    else if (typeof window.scrollBy === 'function') window.scrollBy({ top: by, behavior });
  }
  return 'below';
}

const EYE_OFF = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a15 15 0 0 1-2.6 3.1M6.3 7.6A15 15 0 0 0 2.5 12c1 1.5 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1" />
    <path d="M9.9 10a3 3 0 0 0 4.1 4.2" />
  </svg>
);
const TICK = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

function TourOverlay({ run, onNext, onBack, onSkip }: { run: Run; onNext: () => void; onBack: () => void; onSkip: () => void }) {
  const { tour, pos } = run;
  const [reduced, setReduced] = useState(prefersReduced);
  // The stop on screen: its position, where the card goes, and whether its action has played.
  const [shown, setShown] = useState<{ pos: TourPos; where: Where; acted: boolean; moved: boolean } | null>(null);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [alt, setAlt] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; n: number } | null>(null);
  const [size, setSize] = useState(viewport);
  const [cardHeight, setCardHeight] = useState(200);
  const cardRef = useRef<HTMLElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const keyboard = useRef(false);
  const bodyId = useId();
  const titleId = useId();

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(REDUCED);
    const on = () => setReduced(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);

  const step = stepAt(tour, shown?.pos ?? pos);
  // The example stage moves to the new stop's screen at once (it pushes in while the old highlight
  // fades), so the new target is there to be found; its action plays only once the stop is shown.
  const stop = indexOf(tour, pos);
  const stageActed = shown !== null && shown.pos.page === pos.page && shown.pos.step === pos.step && shown.acted;
  const Stage = tour.pages[pos.page]!.stage;

  // A new stop: fade the old highlight out, find the target (it may still be loading), decide where
  // the card goes, fade in; then play the stop's action, and move the highlight if the stop says.
  const key = `${pos.page}.${pos.step}`;
  useEffect(() => {
    const s = stepAt(tour, pos);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(() => !cancelled && fn(), ms));
    const startedAt = Date.now();
    const show = (el: Element | null) => {
      const where = decide(el, s, cardRef.current?.offsetHeight || cardHeight, reduced);
      setAlt(0);
      setShown({ pos, where, acted: false, moved: false });
      setPhase('in');
      later(() => {
        setShown((v) => (v === null ? v : { ...v, acted: true }));
        if (s.tap !== undefined) {
          const t = document.querySelector(s.tap);
          if (t !== null) {
            const r = t.getBoundingClientRect();
            setRipple((p) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, n: (p?.n ?? 0) + 1 }));
            if (!reduced && typeof (t as HTMLElement).animate === 'function') {
              (t as HTMLElement).animate([{ transform: 'scale(1)' }, { transform: 'scale(0.98)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'ease-out' });
            }
          }
        }
        if (s.then !== undefined) {
          later(() => {
            const t = document.querySelector(s.then!);
            const where2 = decide(t, s, cardRef.current?.offsetHeight || cardHeight, reduced);
            setShown((v) => (v === null ? v : { ...v, where: where2, moved: true }));
          }, reduced ? Math.min(400, s.thenAfter ?? 400) : (s.thenAfter ?? 400));
        }
      }, reduced ? 300 : ACT_MS);
    };
    const look = () => {
      if (cancelled) return;
      const el = s.target === null || s.placement === 'center' ? null : document.querySelector(s.target);
      if (el !== null && visible(el)) return show(el);
      if (s.target === null || s.placement === 'center' || Date.now() - startedAt >= FIND_MS) return show(null);
      timers.push(setTimeout(look, 50));
    };
    setPhase('out');
    timers.push(setTimeout(look, reduced ? 0 : OUT_MS));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per stop
  }, [tour, key]);

  // Stop 1: the highlight fades back and forth between its targets every 1.3 s until Next.
  const alternates = shown !== null && step.alternate !== undefined && shown.where !== 'center';
  useEffect(() => {
    if (!alternates) return;
    const id = setInterval(() => setAlt((a) => a + 1), 1300);
    return () => clearInterval(id);
  }, [alternates, key]);

  // The selector the highlight is on now.
  const current: string | null =
    shown === null || shown.where === 'center'
      ? null
      : shown.moved && step.then !== undefined
        ? step.then
        : alternates
          ? step.alternate![alt % step.alternate!.length]!
          : step.target;
  // The card is placed on the stop's main target (it stays put while the highlight alternates).
  const anchor: string | null = shown === null || shown.where === 'center' ? null : shown.moved && step.then !== undefined ? step.then : step.target;

  // Follow the target while it moves (a screen pushing in, a menu opening, a scroll), every frame.
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = current === null ? null : document.querySelector(current);
      const a = anchor === null ? null : document.querySelector(anchor);
      const r = el === null ? null : rectOf(el);
      const ar = a === null ? null : rectOf(a);
      setRect((p) => (same(p, r) ? p : r));
      setAnchorRect((p) => (same(p, ar) ? p : ar));
      const v = viewport();
      setSize((p) => (p.w === v.w && p.h === v.h ? p : v));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [current, anchor]);

  // Keys (tour-stops.md §1): → and Enter Next, ← Back, Esc Skip tour; Tab stays in the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      keyboard.current = true;
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (e.key === 'Escape') onSkip();
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) onNext();
      else if (e.key === 'ArrowLeft') onBack();
      else if (e.key === 'Tab' && cardRef.current !== null) {
        const items = [...cardRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]!.focus();
      } else return;
      if (e.key !== 'Tab') e.preventDefault();
    };
    const onPointer = () => {
      keyboard.current = false;
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onNext, onBack, onSkip]);
  const shownKey = shown === null ? null : `${shown.pos.page}.${shown.pos.step}`;
  useEffect(() => {
    if (shownKey === null) return;
    // Focus moves into the card at each stop; to Next when the person is using the keyboard.
    if (keyboard.current) nextRef.current?.focus({ preventScroll: true });
    else cardRef.current?.focus({ preventScroll: true });
  }, [shownKey]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h !== undefined && h > 0 && h !== cardHeight) setCardHeight(h);
  });

  const motion = reduced ? 'reduced' : 'full';
  if (shown === null) {
    return (
      <div className="x2f-tour" data-part="tour" data-tour={tour.id} data-motion={motion}>
        {Stage ? (
          <div className="x2f-ex" data-part="tour-stage">
            <Suspense fallback={null}>
              <Stage stop={stop} acted={false} reduced={reduced} />
            </Suspense>
          </div>
        ) : null}
        <div className="x2f-tour__catch" aria-hidden="true" />
      </div>
    );
  }

  const where = shown.where;
  const { index, total } = progressOf(tour, shown.pos);
  const label = nextLabel(tour, shown.pos);
  const first = backPos(tour, shown.pos) === null;
  const vw = size.w;
  const vh = size.h;

  // Where the card goes, and the arrow from it to the target.
  const side = where === 'side';
  const column = Math.min(480, vw);
  const cardWidth = side ? Math.max(300, Math.min(360, vw - (anchorRect ? anchorRect.x + anchorRect.w : 0) - SIDE_GAP - 24)) : Math.min(448, column - 32);
  let cardX = Math.round((vw - cardWidth) / 2);
  let cardY = Math.round(Math.max(EDGE, (vh - cardHeight) / 2));
  let arrow: { d: string; head: string } | null = null;
  const ar = anchorRect;
  const hole = where === 'center' ? null : rect;
  const dim = dimPath(vw, vh, hole);
  if (ar !== null && where !== 'center') {
    if (side) {
      cardX = Math.round(Math.min(vw - cardWidth - 12, ar.x + ar.w + SIDE_GAP));
      cardY = Math.round(Math.min(vh - cardHeight - EDGE, Math.max(EDGE, ar.y + ar.h / 2 - cardHeight / 2)));
      const sx = cardX - 4;
      const sy = Math.min(cardY + cardHeight - 24, Math.max(cardY + 24, ar.y + ar.h / 2));
      const ex = ar.x + ar.w + 4;
      const ey = ar.y + ar.h / 2;
      arrow = curve(sx, sy, (sx + ex) / 2, ey, ex, ey);
    } else if (where === 'below') {
      cardY = Math.round(Math.min(vh - cardHeight - EDGE, ar.y + ar.h + GAP));
      const ex = Math.min(vw - 24, Math.max(24, ar.x + ar.w / 2));
      const ey = ar.y + ar.h + 4;
      const sx = Math.min(cardX + cardWidth - 32, Math.max(cardX + 32, ex + (ex < vw / 2 ? 24 : -24)));
      const sy = cardY - 4;
      if (sy - ey >= 24) arrow = curve(sx, sy, ex, (sy + ey) / 2, ex, ey);
    } else {
      cardY = Math.round(Math.max(EDGE, ar.y - GAP - cardHeight));
      const ex = Math.min(vw - 24, Math.max(24, ar.x + ar.w / 2));
      const ey = ar.y - 4;
      const sx = Math.min(cardX + cardWidth - 32, Math.max(cardX + 32, ex + (ex < vw / 2 ? 24 : -24)));
      const sy = cardY + cardHeight + 4;
      if (ey - sy >= 24) arrow = curve(sx, sy, ex, (sy + ey) / 2, ex, ey);
    }
  }
  const pages = tour.pages;
  const pageIndex = shown.pos.page;

  return (
    <div className="x2f-tour" data-part="tour" data-tour={tour.id} data-motion={motion} data-phase={phase}>
      {Stage ? (
        <div className="x2f-ex" data-part="tour-stage" data-side={side ? 'true' : 'false'}>
          <Suspense fallback={null}>
            <Stage stop={stop} acted={stageActed} reduced={reduced} />
          </Suspense>
        </div>
      ) : null}
      {/* Taps behind the scrim do nothing (the app is inert too). */}
      <div className="x2f-tour__catch" aria-hidden="true" />
      <svg className="x2f-tour__scrim" data-part="tour-overlay" aria-hidden="true" width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
        {/*
          The dim with its hole, without an SVG mask (a mask needs url(), which the proof-image
          tripwire bans from code): one even-odd path, the screen with the hole's rounded rect cut out.
          Its shape is also set as CSS `d`, which tour.css transitions like the ring's x, y, width and
          height, and it is keyed like the ring, so the hole and the ring glide together (review M1).
        */}
        <path
          key={hole === null ? 'dim' : `dim-${shownKey}-${alt}`}
          className="x2f-tour__dim"
          data-part="tour-dim"
          fillRule="evenodd"
          d={dim}
          style={{ d: `path("${dim}")` } as CSSProperties}
        />
        {hole !== null ? (
          <rect
            key={`ring-${shownKey}-${alt}`}
            className="x2f-tour__ring"
            data-part="tour-ring"
            data-phase={phase}
            rx="14"
            style={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }}
          />
        ) : null}
        {hole !== null && alternates ? (
          <rect key={`pulse-${alt}`} className="x2f-tour__pulse" data-part="tour-pulse" rx="14" style={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }} />
        ) : null}
      </svg>
      {arrow !== null ? (
        <svg key={`arrow-${shownKey}-${shown.moved ? 'm' : 's'}`} className="x2f-tour__arrow" data-part="tour-arrow" data-phase={phase} aria-hidden="true" width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
          <path className="x2f-tour__arrow-line" d={arrow.d} pathLength={1} />
          <path className="x2f-tour__arrow-head" d={arrow.head} />
        </svg>
      ) : null}
      {ripple !== null ? <span key={`ripple-${ripple.n}`} className="x2f-tour__ripple" aria-hidden="true" style={{ left: ripple.x, top: ripple.y }} /> : null}
      <section
        ref={cardRef}
        className="x2f-tour__card"
        data-part="tour-card"
        data-placement={where}
        data-phase={phase}
        role="dialog"
        aria-modal="true"
        aria-label={step.title === undefined ? tour.label : undefined}
        aria-labelledby={step.title === undefined ? undefined : titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={{ width: cardWidth, transform: `translate(${cardX}px, ${cardY}px)` }}
      >
        <div className="x2f-tour__prog">
          <span className="x2f-tour__bars" role="img" aria-label={`Page ${pageIndex + 1} of ${pages.length}, ${pages[pageIndex]!.name}`}>
            {pages.map((p, i) => (
              <i key={p.id} data-state={i < pageIndex ? 'done' : i === pageIndex ? 'current' : 'next'} />
            ))}
          </span>
          <span className="x2f-tour__count" data-part="tour-count">{`${index} of ${total}`}</span>
        </div>
        <div className="x2f-tour__text" key={`text-${shownKey}`} data-center={where === 'center' && step.icon !== undefined ? 'true' : 'false'}>
          {where === 'center' && step.icon !== undefined ? (
            <span className="x2f-tour__tile" data-icon={step.icon} aria-hidden="true">
              {step.icon === 'tick' ? TICK : EYE_OFF}
            </span>
          ) : null}
          {step.title !== undefined ? (
            <h2 id={titleId} className="x2f-tour__title">
              {step.title}
            </h2>
          ) : null}
          <p id={bodyId} className="x2f-tour__body" data-part="tour-body">
            {step.body}
          </p>
        </div>
        <div className="x2f-tour__controls">
          <button type="button" className="x2f-tour__skip" data-part="tour-skip" onClick={onSkip}>
            {TOUR_LABELS.skip}
          </button>
          <button type="button" className="x2f-button x2f-button--secondary x2f-tour__back" data-part="tour-back" onClick={onBack} disabled={first}>
            {TOUR_LABELS.back}
          </button>
          <button ref={nextRef} type="button" className="x2f-button x2f-button--primary x2f-tour__next" data-part="tour-next" onClick={onNext}>
            {label}
          </button>
        </div>
      </section>
    </div>
  );
}

/** A quadratic curve from (sx, sy) to (ex, ey) through control (cx, cy), and an open chevron head (9 x 14) aimed along its end. */
function curve(sx: number, sy: number, cx: number, cy: number, ex: number, ey: number): { d: string; head: string } {
  let dx = ex - cx;
  let dy = ey - cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const bx = ex - dx * 9;
  const by = ey - dy * 9;
  const px = -dy * 7;
  const py = dx * 7;
  const f = (n: number) => n.toFixed(1);
  return {
    d: `M${f(sx)} ${f(sy)} Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`,
    head: `M${f(bx + px)} ${f(by + py)} L${f(ex)} ${f(ey)} L${f(bx - px)} ${f(by - py)}`,
  };
}

/** The scrim's outline: the whole screen, less the hole (a rect with 14 px corners) when there is one. */
function dimPath(vw: number, vh: number, hole: { x: number; y: number; w: number; h: number } | null): string {
  const screen = `M0 0H${vw}V${vh}H0Z`;
  if (hole === null) return screen;
  const { x, y, w, h } = hole;
  const r = Math.max(0, Math.min(14, w / 2, h / 2));
  const arc = (ex: number, ey: number) => `A${r} ${r} 0 0 1 ${ex} ${ey}`;
  return (
    `${screen}M${x + r} ${y}H${x + w - r}${arc(x + w, y + r)}V${y + h - r}${arc(x + w - r, y + h)}` +
    `H${x + r}${arc(x, y + h - r)}V${y + r}${arc(x + r, y)}Z`
  );
}
