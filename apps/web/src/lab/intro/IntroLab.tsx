// The owner's intro proof of concept (/lab/intro, demo builds only; App.tsx folds it away elsewhere):
// tours and the landing intro in an isometric 3D style, built in code. An orthographic Three.js
// scene of soft-shaded blocks in X2F's colours (scene.ts, loaded lazily) morphs through three
// scenes, cube → stack → lock, while a tour points at parts of a stand-in screen: a highlight ring
// and an arrow that fade in quickly and fade out quickly. prefers-reduced-motion switches off the
// morph and the fades. Copy is a placeholder: COPY-UNSIGNED.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { IntroColors, IntroScene } from './scene.js';
import './intro.css';

type Target = 'offer' | 'escrow' | 'release';

interface Step {
  title: string;
  text: string;
  target: Target;
}

// COPY-UNSIGNED: placeholder lines for the owner's look at the motion, not product copy.
const STEPS: readonly Step[] = [
  { title: 'Pick an offer', text: 'The blocks come together. You choose who to trade with.', target: 'offer' },
  { title: 'The coins go into escrow', text: 'The cube splits into a stack. Each part of the trade has its place.', target: 'escrow' },
  { title: 'Locked until you release', text: 'The blocks become a lock. Nobody moves the coins until the trade is done.', target: 'release' },
];

/** How long the ring and the arrow take to fade out before they move (intro.css fades in as quickly). */
const FADE_OUT_MS = 120;

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = (): void => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** The theme's colours from tokens.css, so the blocks follow the night and day themes. */
function themeColors(): IntroColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    base: v('--x2f-surface-raised', '#20262f'),
    escrow: v('--x2f-escrow', '#4cc3d9'),
    monero: v('--x2f-monero', '#ff6600'),
    ground: v('--x2f-ground', '#0e1116'),
    ink: v('--x2f-ink', '#eef1f5'),
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function IntroLab() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [ring, setRing] = useState<{ box: Box | null; shown: boolean }>({ box: null, shown: false });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<IntroScene | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  // The scene, once (again if the motion preference changes). Three.js is fetched here, not before.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let live = true;
    import('./scene.js')
      .then(({ startIntroScene }) => {
        if (!live) return;
        sceneRef.current = startIntroScene(canvas, themeColors(), reduced);
        sceneRef.current.show(stepRef.current);
      })
      .catch(() => {
        // No WebGL (or the chunk failed): the tour still works over a plain panel.
        canvas.dataset.introScene = 'unavailable';
      });
    return () => {
      live = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    sceneRef.current?.show(step);
  }, [step]);

  /** The target's box inside the stage, with room for the ring around it. */
  const measure = useCallback((target: Target): Box | null => {
    const stage = stageRef.current;
    const el = stage?.querySelector(`[data-tour-target="${target}"]`);
    if (!stage || !el) return null;
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const pad = 6;
    return { x: r.left - s.left - pad, y: r.top - s.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad };
  }, []);

  // The ring and the arrow: out quickly, move, in quickly. With reduced motion, simply there.
  useLayoutEffect(() => {
    const target = STEPS[step]!.target;
    if (reduced) {
      setRing({ box: measure(target), shown: true });
      return;
    }
    setRing((r) => ({ ...r, shown: false }));
    const t = setTimeout(() => setRing({ box: measure(target), shown: true }), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [step, reduced, measure]);

  useEffect(() => {
    const again = (): void => setRing((r) => ({ ...r, box: measure(STEPS[stepRef.current]!.target) }));
    window.addEventListener('resize', again);
    return () => window.removeEventListener('resize', again);
  }, [measure]);

  const current = STEPS[step]!;
  const box = ring.box;
  return (
    <main className="intro-lab" data-intro-root data-motion={reduced ? 'reduced' : 'full'}>
      <header className="intro-lab__head">
        <p className="intro-lab__kicker">Intro lab · proof of concept</p>
        <h1 className="intro-lab__title">{current.title}</h1>
        <p className="intro-lab__text">{current.text}</p>
      </header>
      <canvas ref={canvasRef} className="intro-lab__canvas" data-intro-canvas aria-hidden="true" />
      <div ref={stageRef} className="intro-lab__stage" aria-label="Example screen">
        <div className="intro-lab__card">
          <div className="intro-lab__row">
            <span className="intro-lab__label">Zelle · $412.50</span>
            <span className="intro-lab__fake" data-tour-target="offer">
              Buy XMR
            </span>
          </div>
          <div className="intro-lab__row">
            <span className="intro-lab__label">Trade K7M2</span>
            <span className="intro-lab__chip" data-tour-target="escrow">
              Escrow secured
            </span>
          </div>
          <div className="intro-lab__row">
            <span className="intro-lab__label">Payment received</span>
            <span className="intro-lab__fake" data-tour-target="release">
              Release
            </span>
          </div>
        </div>
        <div
          className="intro-lab__ring"
          data-tour-ring
          data-shown={ring.shown && box !== null ? 'true' : 'false'}
          style={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined}
          aria-hidden="true"
        />
        <svg
          className="intro-lab__arrow"
          data-tour-arrow
          data-shown={ring.shown && box !== null ? 'true' : 'false'}
          style={box ? { left: box.x - 42, top: box.y + box.h / 2 - 14 } : undefined}
          width="34"
          height="28"
          viewBox="0 0 34 28"
          aria-hidden="true"
        >
          <path d="M2 14 H26 M18 5 L30 14 L18 23" />
        </svg>
      </div>
      <nav className="intro-lab__controls" aria-label="Tour">
        <button type="button" className="x2f-button x2f-button--secondary intro-lab__button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </button>
        <span className="intro-lab__count" aria-live="polite">
          {step + 1} of {STEPS.length}
        </span>
        <button type="button" className="x2f-button x2f-button--primary intro-lab__button" data-primary onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>
          Next
        </button>
      </nav>
    </main>
  );
}
