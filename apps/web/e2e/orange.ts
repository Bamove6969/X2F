// The black+orange check (owner 17 Nov black+orange rule) shared by apps/web/e2e/orange.spec.ts and
// apps/staff-web/e2e/orange.spec.ts: counts the brand orange's pixels in a viewport screenshot.
//
// Lead, 17 Nov: the logo's orange dot does NOT count; every screen needs an orange accent on the
// screen itself. So the screenshot that is counted has every brand mark painted over in black
// first (Playwright's element mask, BRAND_MARK below), and the report skips orange inside them.
import type { Browser, Page } from '@playwright/test';

/** A few pixels of anti-aliasing are not orange on the page: an accent is more than 12 px. */
export const MIN_ORANGE = 12;

/**
 * The brand marks, masked before counting: the small logo (ui/Logo.tsx, every header, the rail
 * head, the trade glance), the Landing board's large logo, and the Welcome screen's animated mark.
 */
export const BRAND_MARK = '.x2f-logo, [data-part="logo"], [data-part="welcome-mark"]';

/** The viewport, with every brand mark masked in black (the counted shot). */
export function maskedShot(page: Page): Promise<Buffer> {
  return page.screenshot({ animations: 'disabled', caret: 'hide', mask: [page.locator(BRAND_MARK)], maskColor: '#000000' });
}

/** Counts brand-orange pixels in a PNG: the #ff6600 hue at any brightness from mid up, the dimmed disabled primary included (anti-aliasing included). */
export async function countOrange(browser: Browser, png: Buffer): Promise<number> {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const out = await p.evaluate(
    async ({ b64 }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let all = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]!;
        const gr = d[i + 1]!;
        const b = d[i + 2]!;
        // r from 110: owner demo note #191 (25 Nov) keeps a primary that cannot be pressed yet "our
        // standard orange", dimmed (opacity 0.45 over the night ground: about rgb(122, 55, 12)); it counts.
        if (r < 110 || b > r * 0.2 || gr < r * 0.28 || gr > r * 0.52) continue;
        all += 1;
      }
      return all;
    },
    { b64: png.toString('base64') },
  );
  await ctx.close();
  return out;
}


/** What the orange is: the visible elements above the fold, outside the brand marks, drawn in the brand orange (fill, text, border, icon). */
export function orangeThings(page: Page): Promise<string[]> {
  return page.evaluate((brand) => {
    const isOrange = (c: string) => {
      const m = c.match(/\d+(\.\d+)?/g);
      if (!m || m.length < 3) return false;
      const [r, g, b] = m.map(Number) as [number, number, number];
      const a = m.length > 3 ? Number(m[3]) : 1;
      return a > 0.5 && r >= 150 && b <= r * 0.2 && g >= r * 0.28 && g <= r * 0.52;
    };
    const out: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const h = el as HTMLElement;
      if (!h.checkVisibility?.() || el.closest(brand)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.top >= innerHeight || r.bottom <= 0) continue;
      const cs = getComputedStyle(el);
      const svg = el instanceof SVGElement;
      const hit =
        isOrange(cs.backgroundColor) ||
        (svg && (isOrange(cs.fill) || isOrange(cs.stroke))) ||
        (!svg && el.childNodes.length > 0 && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim() !== '') && isOrange(cs.color)) ||
        (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0 && isOrange(cs.borderTopColor));
      if (!hit) continue;
      const host = svg ? (el.closest('svg')?.parentElement ?? el) : el;
      const cls = (host.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      const text = (host.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
      const d = `${svg ? 'icon in ' : ''}${host.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
      if (!out.includes(d)) out.push(d);
      if (out.length >= 4) break;
    }
    return out;
  }, BRAND_MARK);
}
