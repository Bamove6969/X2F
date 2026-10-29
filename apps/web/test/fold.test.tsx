// @vitest-environment happy-dom
// Plan 3 Task 40: the fold layout reader, the panes and the kept text (src/ui/fold.ts, Panes.tsx).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FOLD_QUERIES, foldLayoutOf, forgetKeptText, hasPanes, paneOf, useKeptText, type FoldLayout } from '../src/ui/fold.js';
import { Panes } from '../src/ui/Panes.js';
import { Sheet } from '../src/ui/Sheet.js';
import { fire, render } from './render.js';

const none = { tabletop: false, three: false, two: false, panes: false, wide: false, cover: false };

describe('foldLayoutOf', () => {
  it('uses the width alone where the browser reports no segments (Safari on the iPhone Fold)', () => {
    expect(foldLayoutOf({ ...none })).toBe('phone');
    expect(foldLayoutOf({ ...none, cover: true })).toBe('cover');
    expect(foldLayoutOf({ ...none, panes: true })).toBe('two');
    expect(foldLayoutOf({ ...none, panes: true, wide: true })).toBe('wide');
  });

  it('lets reported segments win over the width (Chrome on Android)', () => {
    expect(foldLayoutOf({ ...none, panes: true, wide: true, two: true })).toBe('two');
    expect(foldLayoutOf({ ...none, panes: true, wide: true, three: true })).toBe('three');
    expect(foldLayoutOf({ ...none, panes: true, two: true, tabletop: true })).toBe('tabletop');
    expect(foldLayoutOf({ ...none, tabletop: true })).toBe('tabletop');
  });

  it('reads the board breakpoints: phone under 600, two panes 600 to 999, wide from 1000', () => {
    expect(FOLD_QUERIES.panes).toBe('(min-width: 600px)');
    expect(FOLD_QUERIES.wide).toBe('(min-width: 1000px)');
    expect(FOLD_QUERIES.two).toBe('(horizontal-viewport-segments: 2)');
    expect(FOLD_QUERIES.three).toBe('(horizontal-viewport-segments: 3)');
    expect(FOLD_QUERIES.tabletop).toBe('(vertical-viewport-segments: 2)');
  });

  it('only two, three and tabletop have panes', () => {
    const all: FoldLayout[] = ['phone', 'cover', 'two', 'three', 'tabletop', 'wide'];
    expect(all.filter(hasPanes)).toEqual(['two', 'three', 'tabletop']);
  });
});

describe('Panes', () => {
  const slots = (host: HTMLElement) => [...host.querySelectorAll('[data-pane]')].map((e) => e.getAttribute('data-pane'));

  it('shows only the screen on a phone and in the wide layout, the chat beside it with panes, the glance on a tabletop and the cover', () => {
    const ui = (layout: FoldLayout) => <Panes layout={layout} glance={<p>glance</p>} main={<p>main</p>} side={<p>chat</p>} />;
    const { host, rerender } = render(ui('phone'));
    expect(slots(host)).toEqual(['main']);
    rerender(ui('wide'));
    expect(slots(host)).toEqual(['main']);
    rerender(ui('two'));
    expect(slots(host)).toEqual(['main', 'side']);
    rerender(ui('three'));
    expect(slots(host)).toEqual(['main', 'side']);
    rerender(ui('tabletop'));
    expect(slots(host)).toEqual(['glance', 'main', 'side']);
    rerender(ui('cover'));
    expect(slots(host)).toEqual(['glance', 'main']);
  });

  it('never remounts the screen when the layout changes: typed text and state stay', () => {
    function Typed() {
      const [text, setText] = useState('');
      return <input value={text} onChange={(e) => setText(e.target.value)} />;
    }
    const ui = (layout: FoldLayout) => <Panes layout={layout} glance={<p>glance</p>} main={<Typed />} side={<p>chat</p>} />;
    const { host, rerender } = render(ui('two'));
    const input = host.querySelector('input')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '41');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const layout of ['phone', 'tabletop', 'cover', 'three', 'wide', 'two'] as const) {
      rerender(ui(layout));
      expect(host.querySelector('input')).toBe(input);
      expect(input.value).toBe('41');
    }
  });
});

describe('useKeptText', () => {
  afterEach(() => forgetKeptText());

  function Draft({ id }: { id: string }) {
    const [text, setText] = useKeptText(`chat:${id}`);
    return <input data-id={id} value={text} onChange={(e) => setText(e.target.value)} />;
  }

  it('keeps a draft when its input unmounts and mounts again elsewhere, per key', () => {
    const { host, rerender } = render(<Draft id="A" />);
    const input = host.querySelector('input')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'on my way');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    rerender(<p>folded</p>);
    rerender(
      <section>
        <Draft id="A" />
        <Draft id="B" />
      </section>,
    );
    expect(host.querySelector<HTMLInputElement>('[data-id="A"]')!.value).toBe('on my way');
    expect(host.querySelector<HTMLInputElement>('[data-id="B"]')!.value).toBe('');
  });
});

describe('Sheet in a pane', () => {
  it('records the pane that opened it, so it opens inside that pane', () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <Sheet open={open} title="Chat" onClose={() => setOpen(false)}>
            <p>body</p>
          </Sheet>
        </>
      );
    }
    const { host } = render(<Panes layout="two" main={<p>main</p>} side={<Opener />} />);
    const button = host.querySelector('button')!;
    expect(paneOf(button)).toBe('side');
    button.focus();
    fire(button, new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.x2f-sheet-layer')!.getAttribute('data-pane-of')).toBe('side');
  });
});

describe('styles/fold.css', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/styles/fold.css'), 'utf8');

  it('places the panes from the reported segments, with the width rules first', () => {
    expect(css).toContain('@media (horizontal-viewport-segments: 2)');
    expect(css).toContain('env(viewport-segment-right 0 0');
    expect(css).toContain('env(viewport-segment-left 1 0');
    expect(css).toContain('env(viewport-segment-bottom 0 0');
    expect(css).toContain('env(viewport-segment-top 0 1');
    expect(css.indexOf(":root[data-fold='two'] {")).toBeLessThan(css.indexOf('@media (horizontal-viewport-segments: 2)'));
  });

  it('adds no colours or type of its own: layout only', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|oklch|oklab|lab|lch|color-mix)\(/i);
    // Longhands too (review M1): background-color, font-size, border-radius, outline, opacity, …
    expect(body).not.toMatch(
      /(^|[\s;{])(color|accent-color|caret-color|background(-[a-z]+)?|font(-[a-z]+)?|border(-[a-z]+)*|box-shadow|outline(-[a-z]+)?|opacity|fill|stroke(-[a-z]+)?|text-(decoration|transform|shadow)(-[a-z]+)?|letter-spacing|line-height|filter|backdrop-filter)\s*:/m,
    );
    // No named colours either.
    expect(body).not.toMatch(/:\s*(transparent|currentcolor|white|black|red|orange|gray|grey)\b/i);
  });

  it('the property check catches longhands', () => {
    const banned = /(^|[\s;{])(color|accent-color|caret-color|background(-[a-z]+)?|font(-[a-z]+)?|border(-[a-z]+)*|box-shadow|outline(-[a-z]+)?|opacity|fill|stroke(-[a-z]+)?|text-(decoration|transform|shadow)(-[a-z]+)?|letter-spacing|line-height|filter|backdrop-filter)\s*:/m;
    for (const decl of ['background-color: x;', 'font-size: 1px;', 'border-radius: 2px;', 'outline: 0;', 'opacity: 0.5;', 'line-height: 1;', 'text-decoration: none;']) {
      expect(`.a {\n  ${decl}\n}`).toMatch(banned);
    }
    expect('.a {\n  max-height: 1px;\n  gap: 2px;\n}').not.toMatch(banned);
  });
});
