// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldButton } from '../src/ui/HoldButton.js';
import { advance, key, pointer, render, setReducedMotion } from './render.js';

const LABEL = 'Hold to release 1.25 XMR to mira.k';
const HOLDING = 'Keep holding…';

function setup(props: Partial<Parameters<typeof HoldButton>[0]> = {}) {
  const onComplete = vi.fn();
  const { host, rerender } = render(<HoldButton label={LABEL} holdingLabel={HOLDING} onComplete={onComplete} {...props} />);
  const button = host.querySelector('button');
  if (!button) throw new Error('no button');
  return { button, onComplete, host, rerender };
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
});
