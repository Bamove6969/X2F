// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldButton } from '../src/ui/HoldButton.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advance, fire, key, pointer, render, setReducedMotion } from './render.js';
import { contrast, mix, token } from './contrast.js';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/ui.css'), 'utf8');

const LABEL = 'Hold to release 1.25 XMR to mira.k';
const HOLDING = 'Keep holding…';

function setup(props: Partial<Parameters<typeof HoldButton>[0]> = {}) {
  const onComplete = vi.fn();
  const { host, rerender, unmount } = render(<HoldButton label={LABEL} holdingLabel={HOLDING} onComplete={onComplete} {...props} />);
  const button = host.querySelector('button');
  if (!button) throw new Error('no button');
  return { button, onComplete, host, rerender, unmount };
}

describe('HoldButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not complete after 1,499 ms', () => {
    const { button, onComplete } = setup();
    pointer(button, 'pointerdown');
    advance(1499, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('completes once at 1,500 ms, and later holds do nothing', () => {
    const { button, onComplete } = setup();
    pointer(button, 'pointerdown');
    advance(1500, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
    pointer(button, 'pointerup');
    pointer(button, 'pointerdown');
    advance(5000, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('an early release resets the hold', () => {
    const { button, onComplete } = setup();
    pointer(button, 'pointerdown');
    advance(1000, vi);
    expect(button.dataset.holding).toBe('true');
    pointer(button, 'pointerup');
    expect(button.dataset.holding).toBe('false');
    pointer(button, 'pointerdown');
    advance(1000, vi);
    expect(onComplete).not.toHaveBeenCalled();
    advance(500, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('leaving or cancelling the pointer resets the hold', () => {
    const { button, onComplete } = setup();
    pointer(button, 'pointerdown');
    advance(1000, vi);
    pointer(button, 'pointerleave');
    advance(1000, vi);
    pointer(button, 'pointerdown');
    advance(1000, vi);
    pointer(button, 'pointercancel');
    advance(1000, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('honours a custom holdMs', () => {
    const { button, onComplete } = setup({ holdMs: 3000 });
    pointer(button, 'pointerdown');
    advance(2999, vi);
    expect(onComplete).not.toHaveBeenCalled();
    advance(1, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('disabled ignores holds', () => {
    const { button, onComplete } = setup({ disabled: true });
    expect(button.disabled).toBe(true);
    pointer(button, 'pointerdown');
    key(button, 'keydown', ' ');
    advance(5000, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('becoming disabled mid-hold stops the hold', () => {
    const { button, onComplete, rerender } = setup();
    pointer(button, 'pointerdown');
    advance(1000, vi);
    rerender(<HoldButton label={LABEL} holdingLabel={HOLDING} onComplete={onComplete} disabled />);
    advance(1000, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a keyboard hold with Space works, and key repeats do not restart it', () => {
    const { button, onComplete } = setup();
    key(button, 'keydown', ' ');
    advance(1000, vi);
    key(button, 'keydown', ' ', true);
    advance(499, vi);
    expect(onComplete).not.toHaveBeenCalled();
    advance(1, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a keyboard hold with Enter works; releasing the key early resets it', () => {
    const { button, onComplete } = setup();
    key(button, 'keydown', 'Enter');
    advance(1000, vi);
    key(button, 'keyup', 'Enter');
    advance(1000, vi);
    expect(onComplete).not.toHaveBeenCalled();
    key(button, 'keydown', 'Enter');
    advance(1500, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('other keys do nothing', () => {
    const { button, onComplete } = setup();
    key(button, 'keydown', 'a');
    advance(2000, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows the holding label while held, and the label throughout', () => {
    const { button } = setup({ caption: 'Payment received' });
    expect(button.textContent).toContain(LABEL);
    expect(button.textContent).toContain('Payment received');
    expect(button.textContent).not.toContain(HOLDING);
    pointer(button, 'pointerdown');
    expect(button.textContent).toContain(HOLDING);
    expect(button.textContent).toContain(LABEL);
  });

  it('is the screen primary action', () => {
    const { button } = setup();
    expect(button.hasAttribute('data-primary')).toBe(true);
  });

  it('the fill runs over holdMs and an early release resets it', () => {
    const { button } = setup();
    const fill = button.querySelector<HTMLElement>('[data-fill]');
    expect(fill?.style.getPropertyValue('--x2f-hold-ms')).toBe('1500ms');
    pointer(button, 'pointerdown');
    expect(button.dataset.holding).toBe('true');
    pointer(button, 'pointerup');
    expect(button.dataset.holding).toBe('false');
  });

  it('under reduced motion it counts down in text instead', () => {
    setReducedMotion(true);
    const { button, onComplete } = setup();
    pointer(button, 'pointerdown');
    expect(button.textContent).toContain('Keep holding… 1.5 s');
    advance(500, vi);
    expect(button.textContent).toContain('Keep holding… 1.0 s');
    advance(1000, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('losing focus mid-hold stops the hold', () => {
    const { button, onComplete } = setup();
    key(button, 'keydown', ' ');
    advance(1000, vi);
    // React's onBlur listens for focusout.
    fire(button, new FocusEvent('focusout', { bubbles: true }));
    expect(button.dataset.holding).toBe('false');
    advance(1500, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('unmounting mid-hold never completes', () => {
    const { button, onComplete, unmount } = setup();
    pointer(button, 'pointerdown');
    advance(1000, vi);
    unmount();
    advance(1500, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('done shows the completed look and ignores holds', () => {
    const { button, onComplete } = setup({ done: true, label: 'Done label', caption: 'Done caption' });
    expect(button.dataset.done).toBe('true');
    // The board locks the button once done (disabled, like `locked`).
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Done label');
    expect(button.textContent).toContain('Done caption');
    expect(button.querySelector('[data-fill]')).toBeNull();
    pointer(button, 'pointerdown');
    key(button, 'keydown', ' ');
    advance(1500, vi);
    expect(button.dataset.holding).toBe('false');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('is not done unless told', () => {
    const { button } = setup();
    expect(button.dataset.done).toBe('false');
  });

  it('becoming done mid-hold stops the hold', () => {
    const { button, onComplete, rerender } = setup();
    pointer(button, 'pointerdown');
    advance(1000, vi);
    rerender(<HoldButton label={LABEL} holdingLabel={HOLDING} onComplete={onComplete} done />);
    advance(1000, vi);
    expect(onComplete).not.toHaveBeenCalled();
  });

  describe('completeOn="release" (the user\'s release performs the action, so a touch hold keeps user activation; Task 22 review I2)', () => {
    const release = (props: Partial<Parameters<typeof HoldButton>[0]> = {}) =>
      setup({ completeOn: 'release', releaseLabel: 'Release to open', caption: 'Press and hold', ...props });

    it('arms at holdMs instead of completing, says "Release to open", and completes synchronously inside pointerup', () => {
      const { button, onComplete } = release();
      pointer(button, 'pointerdown');
      advance(1500, vi);
      expect(onComplete).not.toHaveBeenCalled();
      expect(button.dataset.armed).toBe('true');
      expect(button.textContent).toContain('Release to open');
      // A document listener runs after React's root listener for the same pointerup: by then it has completed.
      let calledWithinPointerup = false;
      const probe = () => {
        calledWithinPointerup = onComplete.mock.calls.length === 1;
      };
      document.addEventListener('pointerup', probe);
      pointer(button, 'pointerup');
      document.removeEventListener('pointerup', probe);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(calledWithinPointerup).toBe(true);
      expect(button.dataset.armed).toBe('false');
    });

    it('never completes from the timer, however long the finger stays down', () => {
      const { button, onComplete } = release();
      pointer(button, 'pointerdown');
      advance(60_000, vi);
      expect(onComplete).not.toHaveBeenCalled();
      expect(button.textContent).toContain('Release to open');
    });

    it('a release before holdMs resets and does nothing', () => {
      const { button, onComplete } = release();
      pointer(button, 'pointerdown');
      advance(1499, vi);
      pointer(button, 'pointerup');
      expect(onComplete).not.toHaveBeenCalled();
      expect(button.dataset.armed).toBe('false');
      expect(button.textContent).toContain('Press and hold');
    });

    it('leaving or cancelling while armed disarms; a later pointerup does nothing', () => {
      const { button, onComplete } = release();
      pointer(button, 'pointerdown');
      advance(1500, vi);
      pointer(button, 'pointerleave');
      expect(button.dataset.armed).toBe('false');
      pointer(button, 'pointerup');
      expect(onComplete).not.toHaveBeenCalled();
      pointer(button, 'pointerdown');
      advance(1500, vi);
      pointer(button, 'pointercancel');
      pointer(button, 'pointerup');
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('completes once; later holds do nothing', () => {
      const { button, onComplete } = release();
      pointer(button, 'pointerdown');
      advance(1500, vi);
      pointer(button, 'pointerup');
      pointer(button, 'pointerdown');
      advance(1500, vi);
      pointer(button, 'pointerup');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('a keyboard hold completes on the key release once armed', () => {
      const { button, onComplete } = release();
      key(button, 'keydown', ' ');
      advance(1500, vi);
      expect(onComplete).not.toHaveBeenCalled();
      key(button, 'keyup', ' ');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('under reduced motion the countdown ends in "Release to open"', () => {
      setReducedMotion(true);
      const { button } = release();
      pointer(button, 'pointerdown');
      expect(button.textContent).toContain('Keep holding… 1.5 s');
      advance(1500, vi);
      expect(button.textContent).toContain('Release to open');
      expect(button.textContent).not.toContain('Keep holding');
    });
  });

  it('the default completes from the timer and is never armed', () => {
    const { button, onComplete } = setup();
    pointer(button, 'pointerdown');
    advance(1500, vi);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(button.dataset.armed).toBe('false');
  });

  it('the stylesheet gives done the escrow fill on ground text, with no lift or glow', () => {
    const rule = css.match(/\.x2f-hold\[data-done='true'\][^{]*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule![1]!.replace(/\s+/g, ' ');
    expect(body).toContain('background: var(--x2f-escrow);');
    expect(body).toContain('color: var(--x2f-ground);');
    expect(body).toContain('cursor: default;');
    // Kit 1.5: no state of the hold button has a lift or a glow, so done needs no reset.
    const all = [...css.matchAll(/([^{}]*\.x2f-hold[^{}]*)\{([^}]*)\}/g)].map((m) => m[2]!).join(' ');
    expect(all).not.toMatch(/box-shadow|translateY/);
  });

  // Review 4 (WCAG 1.4.11): hold progress must show at 3:1 against the unfilled button, and the
  // label must still read 4.5:1 on the filled part. An on-monero overlay cannot do both (3:1 needs
  // 58%+, 4.5:1 text needs 20% or less), so the fill is the strongest overlay the text allows and
  // its moving front is a 2 px on-monero edge, which carries the 3:1.
  describe('hold progress contrast', () => {
    const body = (sel: string) => {
      const at = css.indexOf(`${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    const p = Number(/color-mix\(in srgb, var\(--x2f-on-monero\) (\d+)%, transparent\)/.exec(body('.x2f-hold__fill'))?.[1]) / 100;

    it('no single overlay reaches 3:1 for the fill and 4.5:1 for the text', () => {
      for (const theme of ['night', 'day'] as const) {
        const [o, n] = [token('monero', theme), token('on-monero', theme)];
        for (let q = 0; q <= 1; q += 0.01) {
          const f = mix(n, q, o);
          expect(contrast(f, o) >= 3 && contrast(n, f) >= 4.5, `${theme} ${q}`).toBe(false);
        }
      }
    });

    it('the fill is as strong as the label allows: text 4.5:1+ on it, and 2 points more would not be', () => {
      expect(p).toBeGreaterThan(0.16);
      for (const theme of ['night', 'day'] as const) {
        const [o, n] = [token('monero', theme), token('on-monero', theme)];
        expect(contrast(n, mix(n, p, o))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(n, mix(n, p + 0.02, o))).toBeLessThan(4.5);
      }
    });

    it('the moving front is a 2 px on-monero edge at 3:1+ against the unfilled button', () => {
      expect(body(".x2f-hold[data-holding='true'] .x2f-hold__fill")).toContain('border-right: 2px solid var(--x2f-on-monero);');
      for (const theme of ['night', 'day'] as const) {
        expect(contrast(token('on-monero', theme), token('monero', theme))).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
