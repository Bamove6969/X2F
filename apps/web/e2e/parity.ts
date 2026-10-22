// Board parity (Task 15, Global Constraints "Visual parity"): every screen task calls
// `expectParity(page, '<Board>')` at 390×844, and trade-room screens also at 1280×800 against the
// Desktop board.
//
// Blocking (the test fails):
//   - exactly one [data-primary] on the page;
//   - no horizontal scroll;
//   - no text-transform on any [data-username];
//   - every text of the board present verbatim (see `boardTexts` and `missingTexts`).
// Reported, not blocking (P3-M6): a screenshot diff against design/x2f-app/refs/<Board>.png at
// maxDiffPixelRatio 0.03, with [data-mask] regions and `masks` blacked out. The result goes into
// the test's annotations ("parity-pixels") and, on a difference, Playwright attaches the expected,
// actual and diff images to the report for a person to review. Never run with --update-snapshots:
// the references come from tools/parity/capture-refs.ts only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

export const BOARDS_DIR = fileURLToPath(new URL('../../../design/x2f-app/', import.meta.url));

export type ParityViewport = '390x844' | '1280x800';

/** The ratio of differing pixels at which the (reported) screenshot comparison counts as a difference. */
export const MAX_DIFF_PIXEL_RATIO = 0.03;

/**
 * Board texts that are known to be out of date and are not required on the page. The phone boards
 * win over the Desktop board where they disagree (lead ruling; HANDOFF: the desktop view is still
 * to be brought up to date with the phone screens). Desktop-only parts with no phone counterpart
 * (the progress steps, the counterparty card, the chat) are not exceptions.
 */
export const KNOWN_EXCEPTIONS: Partial<Record<string, { text: string; why: string }[]>> = {
  Desktop: [
    {
      text: 'You pay · 62 min left',
      why: 'Countdown uses the phone boards\' minutes format ("1 h 2 min"); "62 min left" is out of date (lead ruling, UI kit README).',
    },
    {
      text: 'Encrypted. If a dispute is opened, a moderator can read this conversation.',
      why: 'The chat notice is the spec 6.6 text "Chats are encrypted. If a dispute is opened, a moderator can read this conversation." (DisputeRoom board, P3-M2); Task 20\'s controller step fixes the Desktop board.',
    },
    {
      text: 'Buying 1.250000 XMR from satoshi_ghost',
      why: 'The trade-room title on the BuyerPay phone board is "Buying from satoshi_ghost"; the phone board wins.',
    },
    {
      text: 'Drop payment proof here',
      why: 'The proof slot on the BuyerPay phone board reads "Add payment proof"; the phone board wins.',
    },
    {
      text: "Private details are blurred automatically for you to check next. It's best-effort, so please double-check before sending. Location and device info are removed.",
      why: 'The proof slot hint on the BuyerPay phone board reads "Private details are blurred for you to check next. Location and device info are removed."; the phone board wins.',
    },
  ],
};

/**
 * Board-only markers: " · Example" after a header line, and any sentence that says the board's
 * names, numbers or keys are examples or samples. They label the mock data and are not app copy.
 */
export function withoutBoardMarkers(text: string): string {
  const unmarked = text.replace(/\s*·\s*(?:examples?|samples?)\b/gi, '');
  return unmarked
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => !/\b(?:examples?|samples?)\b/i.test(sentence))
    .join(' ')
    .trim();
}

/**
 * The texts on `board` (design/x2f-app/<board>.dc.html) in its default state, read from the
 * board's template: for every element that holds text of its own, that element's whole text
 * (textContent, whitespace collapsed), so "Trade <code> · <method>" stays one text even when the
 * app splits it into nodes. Left out: scripts, styles, <helmet>, SVG, <sc-if> branches that are off
 * by default, any text with a template placeholder ({{…}}, filled in by the canvas runtime), the
 * board-only example markers and the board's KNOWN_EXCEPTIONS. `within` narrows to one CSS
 * selector's first match. Parsing happens in `page` with DOMParser, which runs nothing.
 */
export async function boardTexts(page: Page, board: string, o: { within?: string } = {}): Promise<string[]> {
  const html = readFileSync(`${BOARDS_DIR}${board}.dc.html`, 'utf8');
  const raw = await page.evaluate(
    ({ html, within }) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const root = doc.querySelector('x-dc') ?? doc.body;
      for (const el of Array.from(root.querySelectorAll('script, style, helmet, title, template, noscript, svg'))) el.remove();
      for (const el of Array.from(root.querySelectorAll('sc-if'))) {
        if (el.getAttribute('hint-placeholder-val') === '{{false}}') el.remove();
      }
      const scope = within ? root.querySelector(within) : root;
      if (!scope) throw new Error(`no ${within} on the board`);
      const out: string[] = [];
      for (const el of [scope, ...Array.from(scope.querySelectorAll('*'))]) {
        const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
        if (!own) continue;
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text !== '' && !text.includes('{{')) out.push(text);
      }
      return out;
    },
    { html, within: o.within ?? null },
  );
  const skip = new Set((KNOWN_EXCEPTIONS[board] ?? []).map((e) => e.text));
  const texts: string[] = [];
  for (const t of raw) {
    const text = withoutBoardMarkers(t);
    if (text !== '' && !skip.has(text) && !texts.includes(text)) texts.push(text);
  }
  return texts;
}

const MASK = '\u0000';
const MASK_ATTR = 'data-parity-mask';

/**
 * The `texts` that no visible element on the page shows verbatim (its whole textContent,
 * whitespace collapsed). Inside a [data-mask] element, or one of `masks`, any text matches, so
 * "You pay · <Countdown/> left" matches "You pay · 62 min left". A masked element that stands on its
 * own (its parent has no text of its own beside it) may also stand in for one board text, and only
 * a text with a digit in it (a lone timer or amount on the board).
 */
export async function missingTexts(page: Page, texts: string[], masks: Locator[] = []): Promise<string[]> {
  for (const m of masks) await m.evaluateAll((els, attr) => els.forEach((e) => e.setAttribute(attr, '')), MASK_ATTR);
  const { shown, regions } = await page.evaluate(
    ({ sel, mask }) => {
      const shown: string[] = [];
      const read = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node as Element;
        if (el.matches('script, style, template')) return '';
        if (el.matches(sel)) return mask;
        return Array.from(el.childNodes).map(read).join('');
      };
      let regions = 0;
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el.matches('script, style, template') || !el.checkVisibility()) continue;
        // A masked element standing on its own (not inline in a sentence) may stand in for a board text.
        const inline = Array.from(el.parentElement?.childNodes ?? []).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        if (el.matches(sel) && !el.parentElement?.closest(sel) && !inline) regions += 1;
        if (el.closest(sel)) continue;
        const text = read(el).replace(/\s+/g, ' ').trim();
        if (text !== '') shown.push(text);
      }
      return { shown, regions };
    },
    { sel: `[data-mask], [${MASK_ATTR}]`, mask: MASK },
  );
  for (const m of masks) await m.evaluateAll((els, attr) => els.forEach((e) => e.removeAttribute(attr)), MASK_ATTR);

  const exact = new Set(shown.filter((s) => !s.includes(MASK)));
  const patterns: RegExp[] = [];
  for (const s of new Set(shown.filter((x) => x.includes(MASK) && x.replaceAll(MASK, '').trim() !== ''))) {
    const parts = s.split(MASK).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    patterns.push(new RegExp(`^${parts.join('.+?')}$`));
  }
  let wildcards = regions;
  const missing: string[] = [];
  for (const t of texts) {
    if (exact.has(t) || patterns.some((p) => p.test(t))) continue;
    if (wildcards > 0 && /\d/.test(t)) {
      wildcards -= 1;
      continue;
    }
    missing.push(t);
  }
  return missing;
}

/** Board parity for the page as it is now; see the top of this file. Throws on a blocking failure. */
export async function expectParity(
  page: Page,
  board: string,
  o: { masks?: Locator[]; viewport?: ParityViewport } = {},
): Promise<void> {
  const viewport = o.viewport ?? '390x844';
  const [width, height] = viewport.split('x').map(Number) as [number, number];
  const now = page.viewportSize();
  if (now?.width !== width || now.height !== height) await page.setViewportSize({ width, height });
  const masks = o.masks ?? [];
  const failures: string[] = [];

  const primaries = await page.locator('[data-primary]').count();
  if (primaries !== 1) failures.push(`exactly one [data-primary], found ${primaries}`);

  const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  if (scroll.wide > scroll.view) failures.push(`horizontal scroll: ${scroll.wide} px wide in a ${scroll.view} px viewport`);

  const transformed = await page
    .locator('[data-username]')
    .evaluateAll((els) =>
      els.map((e) => ({ name: e.textContent ?? '', t: getComputedStyle(e).textTransform })).filter((x) => x.t !== 'none'),
    );
  for (const x of transformed) failures.push(`text-transform ${x.t} on [data-username] "${x.name}"`);

  for (const t of await missingTexts(page, await boardTexts(page, board), masks)) failures.push(`board copy missing: "${t}"`);

  await reportPixels(page, board, viewport, masks);

  if (failures.length > 0) throw new Error(`parity with board ${board} at ${viewport}:\n  - ${failures.join('\n  - ')}`);
}

/** The reported, non-blocking screenshot comparison. */
async function reportPixels(page: Page, board: string, viewport: ParityViewport, masks: Locator[]): Promise<void> {
  let result: string;
  try {
    await expect(page).toHaveScreenshot(`${board}.png`, {
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      mask: [page.locator('[data-mask]'), ...masks],
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      timeout: 2_000,
    });
    result = `within ${MAX_DIFF_PIXEL_RATIO * 100}% of refs/${board}.png`;
  } catch (e) {
    const lines = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim());
    const why = lines.find((l) => /pixels|snapshot doesn't exist|sizes differ/i.test(l)) ?? lines.find((l) => l !== '') ?? 'differs';
    result = `reported, not blocking: ${why}`;
  }
  test.info().annotations.push({ type: 'parity-pixels', description: `${board} ${viewport}: ${result}` });
}
