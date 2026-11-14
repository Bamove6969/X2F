/**
 * The welcome screen's letter intro (design, wip/design-brief b3b8315b tour-motion.md §2, "The
 * letters"): the real logo split into four layers, X, 2, F and the orange dot, in one box, so the
 * end state is exactly the static logo. X, then 2, then F spring up from their baselines; the dot
 * drops in last with a ring leaving it; the full logo holds, settles back and loops. Driven by the
 * Web Animations API (transform and opacity only). The loop pauses while the page is hidden and
 * stops after about 30 s, resting on the full logo (design's suggestion for WCAG 2.2.2; owner to
 * confirm, tour-motion.md §9). Reduced motion: the full logo, faded in by CSS, no loop.
 *
 * DESIGNER-REVIEW: timings are design's; the spring easings are sampled as she describes.
 */
import { useEffect, useRef } from 'react';
import { LARGE_RIM } from '../../ui/Logo.js';

const X = 'M0 120L0 119.1L35.4 56.3L5.1 0.9L5.1 0L32.6 0L54.3 40.2L58 40.2L79.1 0L105.5 0L105.5 0.9L75.4 56.3L110.5 119.1L110.5 120L81.8 120L56.6 72.5L52.9 72.5L27.4 120Z';
const TWO =
  'M115.1 120L115.1 99.7Q127.8 90 137.4 82.2Q146.9 74.5 153.7 68Q163.8 58.5 169 50.8Q174.2 43.1 174.2 34.6Q174.2 26.9 169.8 22.1Q165.4 17.2 157.1 17.2Q147.7 17.2 142.9 23.3Q138.2 29.4 138.2 39.4L115.1 39.4Q115.1 26.9 119.8 17.5Q124.6 8.2 134.1 3Q143.5 -2.2 157.5 -2.2Q177.4 -2.2 188.2 7.9Q199.1 18 199.1 34.5Q199.1 46.3 192.9 56.2Q186.8 66.2 174.6 77.1Q169.4 81.8 163 86.8Q156.6 91.8 150.3 96L150.3 99.7L203.1 99.7L203.1 120Z';
const F = 'M212.9 0H292V20.3H238.5V47.5H255.4V66.3H238.5V120H212.9Z';
const VIEW = '0 -2.15 292 122.15';

/** A damped spring sampled into a CSS linear() easing (tour-motion.md §1). */
export function spring(zeta: number, omega: number, ms: number, samples = 40): string {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = ((i / samples) * ms) / 1000;
    const v = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    pts.push((i === samples ? 1 : v).toFixed(4));
  }
  return `linear(${pts.join(', ')})`;
}

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
function easing(kind: 'letter' | 'dot'): string {
  const supported = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timing-function', 'linear(0, 1)');
  if (!supported) return EASE_OUT;
  return kind === 'letter' ? spring(0.62, 13.5, 600) : spring(0.48, 15, 700);
}

const LOOP_MS = 3610;
const STOP_AFTER_MS = 30_000;

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function X2FMark() {
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = box.current;
    if (root === null || reducedMotion() || typeof root.animate !== 'function') return;
    const layer = (n: string) => root.querySelector<HTMLElement>(`[data-part="letter-${n}"]`)!;
    const letters = [layer('x'), layer('2'), layer('f')];
    const dot = layer('dot');
    const ring = root.querySelector<HTMLElement>('[data-part="dot-ring"]')!;
    const letterEase = easing('letter');
    const dotEase = easing('dot');
    let running: Animation[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    // A cancelled animation rejects its `finished` promise; nothing waits on it here.
    const keep = (a: Animation) => {
      a.finished?.catch(() => undefined);
      running.push(a);
    };
    const loop = () => {
      running.forEach((a) => a.cancel());
      // The last pass rests on the full logo (no settle) once 30 s have passed.
      const last = Date.now() - started + LOOP_MS >= STOP_AFTER_MS;
      const opts = (delay: number, duration: number, e: string): KeyframeAnimationOptions => ({ delay, duration, easing: e, fill: 'both' });
      running = [];
      letters.forEach((el, i) => {
        keep(el.animate([{ transform: 'translateY(10px) scale(0.36)', opacity: 0 }, { opacity: 1, offset: 0.27 }, { transform: 'none', opacity: 1 }], opts(i * 200, 600, letterEase)));
      });
      keep(dot.animate([{ transform: 'translateY(-34px) scale(0.55)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'none', opacity: 1 }], opts(660, 700, dotEase)));
      keep(ring.animate([{ transform: 'scale(1)', opacity: 0.55 }, { transform: 'scale(2.3)', opacity: 0 }], opts(850, 620, EASE_OUT)));
      if (last) return;
      [...letters, dot].forEach((el, i) => {
        keep(el.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0.86)', opacity: 0 }], { delay: 2560 + i * 50, duration: 420, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards', composite: 'replace' }));
      });
      timer = setTimeout(loop, LOOP_MS);
    };
    const onVisible = () => {
      const pause = document.visibilityState === 'hidden';
      running.forEach((a) => (pause ? a.pause() : a.play()));
    };
    loop();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      running.forEach((a) => a.cancel());
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <div ref={box} className="x2f-mark" role="img" aria-label="X2F" data-part="welcome-mark">
      <svg className="x2f-mark__layer" data-part="letter-x" viewBox={VIEW} aria-hidden="true">
        <path fill="currentColor" d={X} />
      </svg>
      <svg className="x2f-mark__layer" data-part="letter-2" viewBox={VIEW} aria-hidden="true">
        <path fill="currentColor" d={TWO} />
      </svg>
      <svg className="x2f-mark__layer" data-part="letter-f" viewBox={VIEW} aria-hidden="true">
        <path fill="currentColor" d={F} />
      </svg>
      <svg className="x2f-mark__layer" data-part="letter-dot" viewBox={VIEW} aria-hidden="true">
        <circle fill="var(--x2f-monero)" cx="275.1" cy="56.9" r="15.1" />
        <path fill="color-mix(in srgb, var(--x2f-monero) 74%, var(--x2f-on-monero))" fillRule="evenodd" d={LARGE_RIM} />
      </svg>
      <span className="x2f-mark__ring" data-part="dot-ring" aria-hidden="true" />
    </div>
  );
}
