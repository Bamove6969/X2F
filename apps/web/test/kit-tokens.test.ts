// Design kit handoff (8 Nov 2026) §1.5 token fixes and §19.2 acceptance for "Tokens", "XMR amounts"
// and "Timers". The boards themselves (design/x2f-app/*.dc.html) are design's files and keep their
// own copies of the old orange until design re-exports them; only the build and the token file are
// checked here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { xmrText } from '../src/screens/trade/refundUi.js';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(WEB, 'src');
const DESIGN_SYSTEM = fileURLToPath(new URL('../../../design/design-system/', import.meta.url));

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
  });
}

const css = files(SRC, /\.css$/).map((p) => ({ file: relative(SRC, p), text: readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));

describe('kit 1.5: tokens', () => {
  it('the old oranges are gone from the build and the token file', () => {
    const hits = [...files(SRC, /\.(css|tsx?)$/), ...files(DESIGN_SYSTEM, /\.json$/)].filter((p) =>
      /#ff7a1a|#f26822/i.test(readFileSync(p, 'utf8')),
    );
    expect(hits).toEqual([]);
  });

  it('box-shadow is only the two nav-current inset lines', () => {
    const shadows = css.flatMap((f) => [...f.text.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!.trim()));
    expect(shadows.length).toBeGreaterThan(0);
    for (const s of shadows) expect(['inset 0 2px 0 var(--x2f-ink)', 'inset 2px 0 0 var(--x2f-ink)']).toContain(s);
  });

  it('the hold button has no lift and no glow', () => {
    const hold = css.find((f) => f.file === 'ui/ui.css')!.text;
    for (const m of hold.matchAll(/([^{}]*\.x2f-hold[^{}]*)\{([^{}]*)\}/g)) {
      expect(m[2], m[1]).not.toMatch(/translateY|box-shadow/);
    }
  });

  it('no retired tokens are used: title, monero-hold, moderator (renamed mod)', () => {
    const used = css.filter((f) => f.file !== 'theme/tokens.css' && /--x2f-(title-|monero-hold|moderator\b)/.test(f.text));
    expect(used.map((f) => f.file)).toEqual([]);
    const tsx = files(SRC, /\.tsx?$/).filter((p) => /--x2f-(title-|monero-hold|moderator\b)/.test(readFileSync(p, 'utf8')));
    expect(tsx).toEqual([]);
  });

  it('screen titles use the screen-title token (28/32 700 -0.01em)', () => {
    const all = css.map((f) => f.text).join('\n');
    for (const sel of ['.x2f-screen__title', '.x2f-trade-header__title', '.x2f-trade-title', '.x2f-flow__title', '.dispute-title']) {
      const body = new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(all)?.[1] ?? '';
      expect(body, sel).toContain('var(--x2f-screen-title-size)');
      expect(body, sel).toContain('var(--x2f-screen-title-weight)');
      expect(body, sel).toContain('var(--x2f-screen-title-tracking)');
    }
  });

  it('the sheet backdrop is the scrim', () => {
    const ui = css.find((f) => f.file === 'ui/ui.css')!.text;
    expect(/\.x2f-sheet-backdrop\s*\{([^}]*)\}/.exec(ui)?.[1]).toContain('var(--x2f-scrim)');
  });
});

describe('kit 1.5: XMR amounts in prose', () => {
  it('always 6 places, trailing zeros kept (SellerRefund reads "1.250000 XMR")', () => {
    expect(xmrText('1250000000000')).toBe('1.250000');
    expect(xmrText(1_262_500_000_000n)).toBe('1.262500');
    expect(xmrText(9_990_000_000_000n)).toBe('9.990000');
    expect(xmrText('0')).toBe('0.000000');
  });

  it('cuts, never rounds up: the figure never shows more than exists', () => {
    expect(xmrText(1_250_000_999_999n)).toBe('1.250000');
    expect(xmrText(999_999_999_999n)).toBe('0.999999');
    expect(xmrText(1n)).toBe('0.000000');
  });

  it('large amounts stay exact', () => {
    expect(xmrText('18446744073709551615')).toBe('18446744.073709');
  });

  it('matches /^\\d+\\.\\d{6}$/ for any amount', () => {
    for (let a = 1n; a < 10n ** 20n; a *= 7n) expect(xmrText(a)).toMatch(/^\d+\.\d{6}$/);
  });
});
