import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOKENS_CSS, TOKENS_JSON, tokensToCss, type Tokens } from '../../../tools/tokens-to-css.js';

const json = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as Tokens;

describe('tokens.css', () => {
  it('is fresh: matches `npm run tokens` output for tokens.json', () => {
    expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(tokensToCss(json));
  });

  it('has every colour under night (the default) and day', () => {
    const css = tokensToCss(json);
    const night = css.slice(css.indexOf(':root,\n:root[data-theme=night]'), css.indexOf(':root[data-theme=day]'));
    const day = css.slice(css.indexOf(':root[data-theme=day]'));
    expect(night.length).toBeGreaterThan(0);
    for (const t of json.color.tokens) {
      expect(night).toContain(`--x2f-${t.name}: ${t.value.night};`);
      expect(day).toContain(`--x2f-${t.name}: ${t.value.day};`);
    }
  });

  it('has the spacing, radius and type tokens', () => {
    const css = tokensToCss(json);
    for (const t of [...json.spacing.tokens, ...json.radius.tokens]) expect(css).toContain(`--x2f-${t.name}: ${t.value};`);
    for (const [name, family] of Object.entries(json.type.families)) expect(css).toContain(`--x2f-font-${name}: ${family};`);
    for (const g of json.type.groups) {
      for (const s of g.styles) {
        expect(css).toContain(`--x2f-${s.name}-family: var(--x2f-font-${g.family});`);
        expect(css).toContain(`--x2f-${s.name}-size: ${s.fontSize};`);
        expect(css).toContain(`--x2f-${s.name}-line: ${s.lineHeight};`);
        expect(css).toContain(`--x2f-${s.name}-weight: ${s.fontWeight};`);
      }
    }
    expect(css).toContain('--x2f-display-tracking: -0.02em;');
  });

  it('a changed token makes the file stale', () => {
    const changed = structuredClone(json);
    changed.color.tokens[0]!.value.night = '#000000';
    expect(tokensToCss(changed)).not.toBe(readFileSync(TOKENS_CSS, 'utf8'));
  });
});
