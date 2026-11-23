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

  it('has the scrim under night and day (kit 1.1: the only non-hex colour)', () => {
    const css = tokensToCss(json);
    const night = css.slice(0, css.indexOf(':root[data-theme=day]'));
    const day = css.slice(css.indexOf(':root[data-theme=day]'), css.indexOf(':root {'));
    expect(night).toContain('--x2f-scrim: rgba(0,0,0,0.6);');
    expect(day).toContain('--x2f-scrim: rgba(18,22,28,0.45);');
  });

  it('accepts rgba only as a scrim, and only in its plain shape', () => {
    const rgbaColour = structuredClone(json);
    rgbaColour.color.tokens[0]!.value.night = 'rgba(0,0,0,0.6)';
    expect(() => tokensToCss(rgbaColour)).toThrow(/colour value/);
    for (const bad of ['rgba(0,0,0,0.6);x:y', 'rgba(256,0,0,0.5)', 'rgba(0,0,0,2)', 'red']) {
      const t = structuredClone(json);
      t.color.scrims![0]!.value.day = bad;
      expect(() => tokensToCss(t), bad).toThrow(/scrim value/);
    }
  });

  // Owner #43 (12 Nov): the type scale one step up; hero-number and result-headline in proportion.
  // Owner 16 Nov fonts D + sizing: result-headline 38/44 (was 34/38).
  it('kit 1.5 token fixes: monero #ff6600, mod, radius 10, hero-number, result-headline, no title or monero-hold', () => {
    const colour = Object.fromEntries(json.color.tokens.map((t) => [t.name, t.value]));
    expect(colour['monero']).toEqual({ night: '#ff6600', day: '#ff6600' });
    expect(colour['monero-ink']).toEqual({ night: '#ff6600', day: '#b34800' });
    expect(colour['mod']).toEqual({ night: '#b69cff', day: '#623ece' });
    expect(colour['moderator']).toBeUndefined();
    expect(colour['monero-hold']).toBeUndefined();
    const css = tokensToCss(json);
    expect(css).toContain('--x2f-radius-tile: 10px;');
    for (const d of [
      '--x2f-hero-number-family: var(--x2f-font-mono);',
      '--x2f-hero-number-size: 42px;',
      '--x2f-hero-number-line: 47px;',
      '--x2f-hero-number-weight: 500;',
      '--x2f-hero-number-tracking: -0.02em;',
      '--x2f-result-headline-family: var(--x2f-font-display);',
      '--x2f-result-headline-size: 38px;',
      '--x2f-result-headline-line: 44px;',
      '--x2f-result-headline-weight: 700;',
      '--x2f-result-headline-tracking: -0.02em;',
    ]) {
      expect(css).toContain(d);
    }
    expect(css).not.toMatch(/--x2f-title-/);
  });

  it('a changed token makes the file stale', () => {
    const changed = structuredClone(json);
    changed.color.tokens[0]!.value.night = '#000000';
    expect(tokensToCss(changed)).not.toBe(readFileSync(TOKENS_CSS, 'utf8'));
  });
});
