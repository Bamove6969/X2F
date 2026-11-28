// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitAll } from '../src/ui/fitPrimaryLabels.js';

function makeHoldButton(labelText: string, clientWidth: number): { host: HTMLDivElement; hold: HTMLSpanElement; span: HTMLSpanElement } {
  const host = document.createElement('div');
  const hold = document.createElement('span');
  hold.className = 'x2f-ex__hold';
  hold.style.paddingLeft = '16px';
  hold.style.paddingRight = '16px';
  hold.style.fontSize = '27px';
  Object.defineProperty(hold, 'clientWidth', { value: clientWidth, configurable: true });

  const fill = document.createElement('i');
  fill.className = 'x2f-ex__fill';
  fill.setAttribute('aria-hidden', 'true');

  const span = document.createElement('span');
  span.textContent = labelText;

  hold.append(fill, span);
  host.append(hold);
  document.body.append(host);
  return { host, hold, span };
}

function stubRange(widthFor: (node: Node) => number): Node[] {
  const selected: Node[] = [];
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let target: Node | null = null;
    return {
      selectNodeContents(node: Node) {
        target = node;
        selected.push(node);
      },
      getBoundingClientRect() {
        const width = target ? widthFor(target) : 0;
        return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      },
    } as unknown as Range;
  });
  return selected;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('fitPrimaryLabels', () => {
  it('measures the label span of .x2f-ex__hold instead of the outer element containing .x2f-ex__fill, and does not shrink when the span fits', () => {
    const { host, hold, span } = makeHoldButton('Hold to release', 300);
    // Outer .x2f-ex__hold contains the full-width .x2f-ex__fill overlay (300px > 268px usable width),
    // while the label <span> itself is 180px and comfortably fits.
    const selected = stubRange((node) => (node === span ? 180 : 300));

    fitAll(host);

    expect(selected).toEqual([span]);
    expect(hold.style.getPropertyValue('--x2f-primary-fit')).toBe('');
  });

  it('shrinks .x2f-ex__hold when its label span genuinely exceeds the available width', () => {
    const { host, hold, span } = makeHoldButton('Hold to release 0.594354 XMR', 300);
    // Usable width is 300 - 32 = 268px. Width scales with font size (12px per px of font size):
    // at 27px -> 324px (too wide), stepping down until 22px -> 264px (fits).
    const selected = stubRange((node) => {
      if (node !== span) return 300;
      const fit = hold.style.getPropertyValue('--x2f-primary-fit');
      const size = fit ? parseFloat(fit) : 27;
      return size * 12;
    });

    fitAll(host);

    expect(selected.every((n) => n === span)).toBe(true);
    expect(hold.style.getPropertyValue('--x2f-primary-fit')).toBe('22px');
  });

  it('continues to measure the element directly for .x2f-button--primary', () => {
    const host = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'x2f-button--primary';
    btn.textContent = 'Post offer';
    btn.style.paddingLeft = '16px';
    btn.style.paddingRight = '16px';
    btn.style.fontSize = '27px';
    Object.defineProperty(btn, 'clientWidth', { value: 240, configurable: true });
    host.append(btn);
    document.body.append(host);

    const selected = stubRange((node) => {
      if (node !== btn) return 0;
      const fit = btn.style.getPropertyValue('--x2f-primary-fit');
      const size = fit ? parseFloat(fit) : 27;
      return size * 10;
    });

    fitAll(host);

    // Usable width is 240 - 32 = 208px; 20px * 10 = 200px fits.
    expect(selected.every((n) => n === btn)).toBe(true);
    expect(btn.style.getPropertyValue('--x2f-primary-fit')).toBe('20px');
  });
});
