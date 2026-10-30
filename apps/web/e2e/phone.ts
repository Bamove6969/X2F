// Phone sizes every screen's e2e and parity tests run at (spec "Mobile ready at launch", owner
// 2026-10-25): the boards' 390x844 and a small Android phone, 360x800. `expectPhoneLayout` is the
// layout half of that rule: no horizontal scroll, nothing cut off at the sides, and every control
// big enough to tap.
import { type Page } from '@playwright/test';
import type { ParityViewport } from './parity.js';

export const PHONE_VIEWPORTS: readonly ParityViewport[] = ['390x844', '360x800'];

/**
 * Foldable sizes (Plan 3 Task 40; PHONE_VIEWPORTS stays the phone standard): a flip phone's cover
 * screen (360x380, the Fold-Cover board), the two-pane edge (600), a book fold's inner screen
 * (840x900, Fold-Trade's 840 wide), the last two-pane width (999) and the wide edge (1000x840,
 * Fold-Tabletop's size). Width-only: segments and the folded posture (which alone turns on the
 * cover layout, review I2) are emulated in e2e/fold.spec.ts.
 */
export const FOLD_VIEWPORTS: readonly ParityViewport[] = ['360x380', '600x900', '840x900', '999x900', '1000x840'];

/**
 * The smallest tap target, in CSS pixels, on each side. WCAG 2.2's 2.5.8 floor is 24; the board's
 * buttons are 44–48 and its chips 32, so 32 keeps every control comfortably tappable without
 * forcing the chips taller than the board draws them.
 */
export const MIN_TAP = 32;

export async function setPhone(page: Page, viewport: ParityViewport): Promise<void> {
  const [width, height] = viewport.split('x').map(Number) as [number, number];
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/**
 * Throws when the page scrolls sideways, a visible element sticks out past the viewport's sides,
 * or a visible control (link, button, input, radio, tab) is smaller than MIN_TAP on a side.
 * Inline text links inside a sentence are measured by their line box, so they are held to 24. A
 * checkbox or radio inside a label of at least 44 px by MIN_TAP passes: the label is the target.
 */
export async function expectPhoneLayout(page: Page): Promise<void> {
  const problems = await page.evaluate((minTap) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) out.push(`horizontal scroll: ${doc.scrollWidth} px wide in a ${doc.clientWidth} px viewport`);
    const visible = (el: Element) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -0.5 || r.right > doc.clientWidth + 0.5) {
        // A child of a sideways scroll strip (overflow-x auto/scroll) may run past the edge on purpose.
        let p = el.parentElement;
        let scrolls = false;
        while (p) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') {
            scrolls = true;
            break;
          }
          p = p.parentElement;
        }
        if (!scrolls) out.push(`${label(el)} runs past the side (${Math.round(r.left)}..${Math.round(r.right)} of ${doc.clientWidth})`);
      }
    }
    const controls = document.body.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="radio"], [role="tab"]');
    for (const el of Array.from(controls)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      // A checkbox or radio inside a label that is itself a big enough target (at least 44 px tall
      // and MIN_TAP wide) is tapped through its label (lead's ruling 2026-10-28: SellerConfirm's
      // 22 px box in its 44 px label row).
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        const box = el.closest('label')?.getBoundingClientRect();
        if (box && box.height >= 44 - 0.5 && box.width >= minTap) continue;
      }
      const inline = getComputedStyle(el).display === 'inline';
      const min = inline ? 24 : minTap;
      if (r.width < min || r.height < min) out.push(`${label(el)} is ${Math.round(r.width)}x${Math.round(r.height)}, under ${min}x${min}`);
    }
    return out;
  }, MIN_TAP);
  if (problems.length > 0) throw new Error(`phone layout at ${page.viewportSize()?.width}x${page.viewportSize()?.height}:\n  - ${problems.join('\n  - ')}`);
}
