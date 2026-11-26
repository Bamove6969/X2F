import { expect, test, type Page } from '@playwright/test';
import { signedIn, signedOut } from './session.js';

// Owner, 16 Nov 2026: on a laptop the type looked jagged ("like Times New Roman"). At desktop size
// every face the home screens draw text in is a real, loaded face (no fallback, no synthesised
// weight or style), and every font file is served as font/woff2.

interface FontReport {
  status: string;
  errored: string[];
  /** Text drawn in a (family, weight, style) with no loaded face of that family, weight and style. */
  unmatched: string[];
  /** Families text is drawn in that no loaded face has. */
  unloadedFamilies: string[];
  checked: number;
  smoothing: string;
  synthesis: string;
}

async function fontReport(page: Page): Promise<FontReport> {
  await page.waitForLoadState('networkidle');
  return page.evaluate(async () => {
    await document.fonts.ready;
    const faces = [...document.fonts];
    const loaded = faces.filter((f) => f.status === 'loaded');
    const first = (stack: string): string => stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    const unmatched = new Set<string>();
    const families = new Set<string>();
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if ((t.textContent ?? '').trim() === '') continue;
      const el = t.parentElement!;
      if (el.getClientRects().length === 0) continue;
      const cs = getComputedStyle(el);
      const family = first(cs.fontFamily);
      families.add(family);
      checked++;
      const match = loaded.some((f) => f.family.replace(/["']/g, '') === family && f.weight === cs.fontWeight && f.style === cs.fontStyle);
      if (!match) unmatched.add(`${family} ${cs.fontWeight} ${cs.fontStyle}: "${(t.textContent ?? '').trim().slice(0, 24)}" <${el.tagName.toLowerCase()} class="${el.className}">`);
    }
    const root = getComputedStyle(document.documentElement);
    return {
      status: document.fonts.status,
      errored: faces.filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight} ${f.style}`),
      unmatched: [...unmatched],
      unloadedFamilies: [...families].filter((fam) => !loaded.some((f) => f.family.replace(/["']/g, '') === fam)),
      checked,
      smoothing: root.getPropertyValue('-webkit-font-smoothing'),
      synthesis: root.getPropertyValue('font-synthesis-weight'),
    };
  });
}

const SCREENS: { name: string; path: string; signed: boolean }[] = [
  { name: 'the trade home', path: '/sell', signed: true },
  { name: 'the landing page', path: '/', signed: false },
  { name: 'Post offer', path: '/post', signed: true },
];

for (const s of SCREENS) {
  test(`at 1366x768 ${s.name} draws all its text in loaded faces, none faked`, async ({ page }) => {
    if (s.signed) await signedIn(page);
    else await signedOut(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    const types: string[] = [];
    page.on('response', (r) => {
      if (/\.woff2(\?|$)/.test(new URL(r.url()).pathname)) types.push(`${r.status()} ${r.headers()['content-type']}`);
    });
    await page.goto(s.path);
    await expect(page.locator('#root > *').first()).toBeAttached();
    const report = await fontReport(page);
    expect(report.checked).toBeGreaterThan(5);
    expect(report.status).toBe('loaded');
    expect(report.errored).toEqual([]);
    expect(report.unloadedFamilies).toEqual([]);
    expect(report.unmatched).toEqual([]);
    expect(report.smoothing).toBe('antialiased');
    expect(report.synthesis).toBe('none');
    expect(types.length).toBeGreaterThan(0);
    expect([...new Set(types)]).toEqual(['200 font/woff2']);
  });
}

// Owner 16 Nov fonts D + sizing: the orange buttons keep their size; the label is bigger and bold,
// on one line, and clear of the button's top and sides, down to a 360 px phone.
// Owner 17 Nov button labels: "as much font as possible... never touch the top or the sides": 27 px
// on the 56 px button (cap height about half of it), stepped down only when a long label would reach
// the 16 px sides. Clearance above and below is measured on the label's ink (canvas text metrics),
// which is what the eye sees touching the edge.
for (const width of [360, 390, 1366]) {
  test(`at ${width} px every orange button keeps its size and its label stays on one line, clear of the edges`, async ({ page }) => {
    await signedOut(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    // The label fit (ui/fitPrimaryLabels.ts) runs on the frame after the fonts load.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.x2f-button--primary')].filter((b) => b.getClientRects().length > 0).map((b) => {
        const box = b.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(b);
        const text = range.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const g = document.createElement('canvas').getContext('2d')!;
        g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = g.measureText((b.textContent ?? '').trim());
        const ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        const cap = g.measureText('H').actualBoundingBoxAscent;
        return {
          landingWay: b.classList.contains('x2f-landing__way'),
          fitted: b.style.getPropertyValue('--x2f-primary-fit') !== '',
          inkClear: (box.height - ink) / 2,
          capShare: cap / box.height,
          label: (b.textContent ?? '').trim(),
          height: Math.round(box.height),
          fontSize: parseFloat(cs.fontSize),
          fontWeight: cs.fontWeight,
          lines: range.getClientRects().length > 0 ? Math.round(text.height / parseFloat(cs.lineHeight)) : 0,
          left: text.left - box.left,
          right: box.right - text.right,
          top: text.top - box.top,
          bottom: box.bottom - text.bottom,
          overflow: b.scrollWidth > b.clientWidth,
        };
      }),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      if (b.landingWay) {
        // Owner demo notes #172/#173 (25 Nov): the landing's Create account is much bigger and bolder,
        // still clear of the edges (checked below with every other button).
        expect(b.height, b.label).toBe(68);
        expect(b.fontSize, b.label).toBe(26);
      } else {
        expect(b.height, b.label).toBe(56);
        expect(b.fontSize, b.label).toBeGreaterThanOrEqual(17);
        expect(b.fontSize, b.label).toBeLessThanOrEqual(27);
        // owner 17 Nov: full size unless the label had to be stepped down to fit the sides.
        if (!b.fitted) expect(b.fontSize, b.label).toBe(27);
        if (!b.fitted) expect(b.capShare, b.label).toBeGreaterThanOrEqual(0.33);
      }
      expect(b.fontWeight, b.label).toBe('700');
      expect(b.lines, b.label).toBe(1);
      expect(b.overflow, b.label).toBe(false);
      expect(Math.min(b.left, b.right), b.label).toBeGreaterThanOrEqual(16);
      expect(b.inkClear, b.label).toBeGreaterThanOrEqual(12);
    }
  });
}
