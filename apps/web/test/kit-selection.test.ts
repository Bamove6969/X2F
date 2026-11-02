// The kit's selection and tab-bar rules (design review 1 Nov 2026, X1 and shots 31-35; conventions
// 2 Nov 2026): selection is drawn in ink, never orange; the tab bar is pinned to the bottom and a
// list screen's action bar stays above it; a hold notice is caution. Read from ui.css (node, not DOM).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('ui.css', () => {
  it('the kit draws selection in ink, never orange (conventions 2 Nov 2026), and pins the tab bar', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/ui/ui.css', import.meta.url)), 'utf8');
    const rule = (sel: string) => {
      const at = css.indexOf(`${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    for (const sel of [".x2f-bottom-nav__tab[aria-current='page']", ".x2f-select-card[data-selected='true']", '.x2f-tickbox input', ".x2f-switch[data-on='true'] .x2f-switch__track"]) {
      expect(rule(sel)).not.toMatch(/monero/);
      expect(rule(sel)).toMatch(/--x2f-ink\b/);
    }
    expect(rule("[data-shell='phone']:has(> .x2f-bottom-nav) > [data-shell-body] > main")).toContain('100dvh - var(--x2f-tab-bar-height)');
    expect(rule("[data-shell='phone']:has(> .x2f-bottom-nav) .x2f-action-bar")).toContain('bottom: var(--x2f-tab-bar-height)');
    expect(rule(".x2f-outcome[data-tone='caution']")).toContain('--x2f-caution');
    // Design session 2 Nov 2026: the current tab is ink on the raised surface with a 2 px ink inset line.
    expect(rule(".x2f-bottom-nav__tab[aria-current='page']")).toContain('background: var(--x2f-surface-raised)');
    // Review N4: the tab bar's offset is derived from the tab height and includes the safe area.
    expect(rule(':root')).toMatch(/--x2f-tab-bar-height: calc\(var\(--x2f-tab-height\) \+ 1px \+ env\(safe-area-inset-bottom/);
    expect(rule('.x2f-bottom-nav__tab')).toContain('height: var(--x2f-tab-height)');
    expect(rule('.x2f-bottom-nav')).toContain('padding-bottom: env(safe-area-inset-bottom');
  });
});
