// A small render helper over react-dom/client and React's act (no extra test library).
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount());
    m.host.remove();
  }
});

export function render(ui: ReactNode): {
  host: HTMLElement;
  rerender: (next: ReactNode) => void;
  unmount: () => void;
} {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const entry = { root, host };
  mounted.push(entry);
  act(() => root.render(ui));
  return {
    host,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      mounted.splice(mounted.indexOf(entry), 1);
      act(() => root.unmount());
      host.remove();
    },
  };
}

export function fire(el: Element, event: Event): void {
  act(() => {
    el.dispatchEvent(event);
  });
}

export function pointer(el: Element, type: 'pointerdown' | 'pointerup' | 'pointerleave' | 'pointercancel'): void {
  const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true };
  // React derives onPointerLeave from pointerout, as browsers send both.
  if (type === 'pointerleave') fire(el, new PointerEvent('pointerout', { ...init, relatedTarget: document.body }));
  else fire(el, new PointerEvent(type, init));
}

export function key(el: Element, type: 'keydown' | 'keyup', k: string, repeat = false): void {
  fire(el, new KeyboardEvent(type, { bubbles: true, cancelable: true, key: k, repeat }));
}

export function advance(ms: number, vi: { advanceTimersByTime: (ms: number) => unknown }): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Sets `prefers-reduced-motion` for code that reads it through matchMedia. */
export function setReducedMotion(on: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * Polls inside act until `ready()` holds, every 10 ms up to `deadlineMs` (2 s), so a test waits
 * for an async result instead of a fixed pause that a loaded machine can outrun. Throws `what`
 * when the deadline passes.
 */
export async function waitUntil(ready: () => boolean, what: string, deadlineMs = 2000): Promise<void> {
  const end = Date.now() + deadlineMs;
  for (;;) {
    let ok = false;
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      ok = ready();
    });
    if (ok) return;
    if (Date.now() > end) throw new Error(`waitUntil: ${what} did not happen within ${deadlineMs} ms`);
  }
}

/** The element `selector` finds in `root`, once it is there (`waitUntil`). */
export async function waitFor(root: ParentNode, selector: string, deadlineMs = 2000): Promise<Element> {
  await waitUntil(() => root.querySelector(selector) !== null, `${selector} to appear`, deadlineMs);
  return root.querySelector(selector)!;
}
