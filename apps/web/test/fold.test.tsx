// @vitest-environment happy-dom
// Plan 3 Task 40: the fold layout reader, the panes and the kept text (src/ui/fold.ts, Panes.tsx).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FOLD_QUERIES, foldLayoutOf, forgetKeptText, hasPanes, paneOf, useKeptText, type FoldLayout } from '../src/ui/fold.js';
import { Panes } from '../src/ui/Panes.js';
import { glanceWarning } from '../src/screens/trade/TradeGlance.js';
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

describe('TradeGlance warning (round-2 review m1, m2)', () => {
  const ok = { phase: 'ready' as const, error: null, retryable: false, refusal: null };
  const buyer = { role: 'buyer' as const, counterparty: { displayName: 'mira.k' } };
  const seller = { role: 'seller' as const, counterparty: { displayName: 'mira.k' } };

  it('says nothing once this device is done, whatever refusal is left over', () => {
    for (const phase of ['done', 'settled-without-device'] as const) {
      expect(glanceWarning(buyer, { ...ok, phase, refusal: 'attempts-exhausted' })).toBeNull();
      expect(glanceWarning(seller, { ...ok, phase, refusal: 'attempts-exhausted' })).toBeNull();
    }
    expect(glanceWarning(buyer, ok)).toBeNull();
    expect(glanceWarning(seller, ok)).toBeNull();
  });

  it("uses each role's own sentences: the buyer is told not to send money, the seller never is", () => {
    expect(glanceWarning(buyer, { ...ok, refusal: 'view-mismatch' })).toContain("Don't send any money");
    expect(glanceWarning(buyer, { ...ok, phase: 'error', error: 'escrow-failed' as const })).toContain("Don't send any money");
    for (const refusal of ['view-mismatch', 'amount-changed', 'attempts-exhausted', 'paid-amount-refused'] as const) {
      const text = glanceWarning(seller, { ...ok, refusal });
      expect(text).not.toBeNull();
      expect(text).not.toMatch(/send any money|after you paid/);
    }
    expect(glanceWarning(seller, { ...ok, refusal: 'paid-amount-refused' })).toContain('mira.k');
    expect(glanceWarning(seller, { ...ok, phase: 'error', error: 'escrow-failed' as const })).not.toMatch(/send any money/);
  });

  it('is no live region: the screen\'s own notice is the one announcement', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/screens/trade/TradeGlance.tsx'), 'utf8');
    expect(src).not.toMatch(/role=["{]/);
    expect(src).not.toMatch(/aria-live/);
  });
});

// TRIPWIRE (round-2 review m5): the glance departs from the Fold boards, and Claude Design owns the
// looks. Fold-Tabletop.dc.html:25-27 has a status pill ("Waiting for your payment", "Paid ·
// waiting for …"); round 1 filled it with the API's escrow chip (review I1), so it is gone, and
// Fold-Cover.dc.html:43's "Open your phone to keep going." is wrong now that the room stays under
// the card. The design is asked (docs/coordination.md, Plan 3 Task 40 follow-ups) for a pill from
// `view.state` and the role, never the escrow chip, and for the cover's wording. The Fold boards are
// drafted on origin/wip/design-brief (docs/design-boards/Fold-*.dc.html) and not in the app canvas
// yet. This reads the local tree only and fails once a Fold board lands in design/x2f-app/: then
// build TradeGlance to it (pill and cover line, copy from the board wins), add parity, and delete
// this check.
describe('Task 40 still waits for its design', () => {
  it('NEEDS_DESIGN_FOLD_GLANCE: no Fold board in the app canvas yet', () => {
    const boards = join(dirname(fileURLToPath(import.meta.url)), '../../../design/x2f-app/');
    const canvas = JSON.parse(readFileSync(`${boards}canvas.json`, 'utf8')) as { boards: Record<string, unknown> };
    const landed = Object.keys(canvas.boards).some((b) => /^Fold/i.test(b)) || readdirSync(boards).some((f) => /^Fold/i.test(f));
    expect(landed, 'a Fold board landed: build the glance to it (see this test)').toBe(false);
  });
});
