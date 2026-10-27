// Board parity (Task 15, Global Constraints "Visual parity"): every screen task calls
// `expectParity(page, '<Board>')` at 390×844, and trade-room screens also at 1280×800 against the
// Desktop board.
//
// Blocking (the test fails):
//   - exactly one visible [data-primary] on the page (none with `primary: false`, for a board
//     with no primary action);
//   - no horizontal scroll;
//   - no text-transform on any [data-username];
//   - every text of the board present verbatim (see `boardTexts` and `missingTexts`).
// Reported, not blocking (P3-M6): a screenshot diff against design/x2f-app/refs/<Board>.png at
// MAX_DIFF_PIXEL_RATIO, with [data-mask] regions and `masks` blacked out in both the reference and
// the page before the pixels are counted. The result goes into the test's annotations
// ("parity-pixels") and is printed as a "parity-pixels <Board> <viewport>: …" line; on a difference
// the reference and the page are attached to the HTML report (playwright-report/) for a person to
// review. The references come only from tools/parity/capture-refs.ts; a missing one is
// reported, never written. The viewport defaults to the board's canvas.json size, so the staff and
// mod boards (1280x900–1600) are shot at their reference's size. Known artifact: refs/SetupBackup.png
// reads "Addauthenticator app" (the canvas runtime drops the space before a filled-in {{choice}});
// it only adds pixel noise to the reported diff, and the PNG is not hand-edited.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Locator, type Page } from '@playwright/test';

export const BOARDS_DIR = fileURLToPath(new URL('../../../design/x2f-app/', import.meta.url));

/** A viewport as "<width>x<height>" (CSS pixels): 390x844, 1280x800, or a staff board's 1280x900–1600. */
export type ParityViewport = `${number}x${number}`;

/** The board's size in `boardsDir`/canvas.json as a ParityViewport (the size its reference was shot at). */
export function boardViewport(board: string, boardsDir = BOARDS_DIR): ParityViewport {
  const canvas = JSON.parse(readFileSync(join(boardsDir, 'canvas.json'), 'utf8')) as { boards: Record<string, { w: number; h: number }> };
  const b = canvas.boards[`${board}.dc.html`];
  if (!b) throw new Error(`no board "${board}" in ${join(boardsDir, 'canvas.json')}`);
  return `${b.w}x${b.h}`;
}

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
 * Board-only markers, stripped so they are not treated as app copy. Only the two shapes the boards
 * actually use are removed (not every sentence that mentions an example, so real copy that happens
 * to say "example" is kept):
 *   - a trailing " · Example" (or "· examples/sample/samples") after a header line;
 *   - a sentence of the form "<subject> are examples." / "… are samples." (e.g. "Figures are
 *     examples."), and the one-off "This is an example key." note.
 */
export function withoutBoardMarkers(text: string): string {
  const unmarked = text.replace(/\s*·\s*(?:examples?|samples?)\s*$/i, '');
  return unmarked
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => {
      const s = sentence.trim();
      if (/\bare (?:examples?|samples?)\.?$/i.test(s)) return false;
      if (/^This is an example key\.?$/i.test(s)) return false;
      return true;
    })
    .join(' ')
    .trim();
}

/** The sentinel a template placeholder ({{…}}) or a masked page region collapses to. */
const MASK = '\u0000';
const MASK_ATTR = 'data-parity-mask';

/**
 * The texts on `board` (design/x2f-app/<board>.dc.html) in its default state, read from the
 * board's template: for every element that holds text of its own, that element's whole text
 * (textContent, whitespace collapsed), so "Trade <code> · <method>" stays one text even when the
 * app splits it into nodes. Left out: scripts, styles, <helmet>, SVG, <sc-if> branches that are off
 * by default, text the board hides visually (screen-reader-only labels), the board-only example
 * markers and the board's KNOWN_EXCEPTIONS. A template
 * placeholder ({{…}}, filled in by the canvas runtime) becomes the MASK sentinel, so the fixed copy
 * around it is still checked (as an anchored pattern in `missingTexts`); a text that is nothing but
 * placeholders is dropped. `within` narrows to one CSS selector's first match; `boardsDir` reads the
 * board from another folder (the tests use it). Parsing happens in
 * `page` with DOMParser, which runs nothing. Throws if a KNOWN_EXCEPTIONS entry is no longer on the
 * board (a stale exception to remove).
 */
export async function boardTexts(page: Page, board: string, o: { within?: string; boardsDir?: string } = {}): Promise<string[]> {
  const html = readFileSync(join(o.boardsDir ?? BOARDS_DIR, `${board}.dc.html`), 'utf8');
  const raw = await page.evaluate(
    ({ html, within }) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const root = doc.querySelector('x-dc') ?? doc.body;
      for (const el of Array.from(root.querySelectorAll('script, style, helmet, title, template, noscript, svg'))) el.remove();
      for (const el of Array.from(root.querySelectorAll('sc-if'))) {
        if (el.getAttribute('hint-placeholder-val') === '{{false}}') el.remove();
      }
      // Text the board itself hides visually (the screen-reader-only pattern: a box of at most 1 px
      // with its overflow hidden or clipped) is not visible copy; the page may hide it the same way.
      // The style attribute is read as text: under the app's CSP (no inline styles) the parsed
      // board's CSSOM stays empty.
      const tiny = (v: string | undefined) => v === '0' || v === '0px' || v === '1px';
      for (const el of Array.from(root.querySelectorAll('[style]'))) {
        const st = new Map<string, string>();
        for (const decl of (el.getAttribute('style') ?? '').split(';')) {
          const i = decl.indexOf(':');
          if (i > 0) st.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim().toLowerCase());
        }
        if (tiny(st.get('width')) && tiny(st.get('height')) && (st.get('overflow') === 'hidden' || st.has('clip') || st.has('clip-path'))) el.remove();
      }
      const scope = within ? root.querySelector(within) : root;
      if (!scope) throw new Error(`no ${within} on the board`);
      const out: string[] = [];
      for (const el of [scope, ...Array.from(scope.querySelectorAll('*'))]) {
        const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
        if (!own) continue;
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text !== '') out.push(text);
      }
      return out;
    },
    { html, within: o.within ?? null },
  );
  const marked = raw.map(withoutBoardMarkers);
  const exceptions = KNOWN_EXCEPTIONS[board] ?? [];
  // A stale exception is caught on a full-board read; a `within` read only sees part of the board,
  // so an exception that lives elsewhere is expected to be absent there.
  if (!o.within) {
    for (const e of exceptions) {
      if (!marked.includes(e.text)) {
        throw new Error(`KNOWN_EXCEPTIONS[${board}] lists "${e.text}", which is not on the board any more — remove the stale exception.`);
      }
    }
  }
  const skip = new Set(exceptions.map((e) => e.text));
  const texts: string[] = [];
  for (const m of marked) {
    if (m === '' || skip.has(m)) continue;
    // A placeholder stands for runtime-filled text; the fixed copy around it must still be present.
    const pattern = m.replace(/\{\{.*?\}\}/g, MASK);
    if (pattern.replaceAll(MASK, '').trim() === '') continue; // nothing but placeholders
    if (!texts.includes(pattern)) texts.push(pattern);
  }
  return texts;
}

// The body of a value-shaped text (a lone timer, amount, count or trade code): digits and the few
// symbols/units such values use, or a code like K7M2-9QXA-4FTR-8WPN, nothing with words in it. A
// masked page region may only stand in for such a value, so a masked countdown can cover "28:12"
// on the board, but losing "1.237500 XMR is yours" or "· Zelle" cannot hide behind a mask.
const VALUE = String.raw`(?:[\d$.,:\s]+(?:XMR|USD|min|h|s|left)?|[A-Z0-9]{4}(?:-[A-Z0-9]{4})+)`;
const VALUE_SHAPED = new RegExp(`^${VALUE}$`);

/**
 * The kind of a value-shaped text, so a lone mask only stands in for a board value like the one it
 * hides: a masked countdown is not a missing amount. A code is a K7M2-9QXA-… trade code; money has a
 * currency sign or unit or a decimal point; a time has a colon or a time unit; anything else is a
 * count.
 */
export function valueKind(s: string): 'code' | 'money' | 'time' | 'count' {
  if (/^[A-Z0-9]{4}(?:-[A-Z0-9]{4})+$/.test(s)) return 'code';
  if (/[$]|XMR|USD|\d\.\d/.test(s)) return 'money';
  if (/\d:\d|\d\s*(?:h|min|s)\b|\bleft$/.test(s)) return 'time';
  return 'count';
}

const escapeRe = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A board text with MASKs (runtime-filled {{…}} placeholders): each MASK matches any text. */
function boardPattern(s: string): RegExp {
  return new RegExp(`^${s.split(MASK).map(escapeRe).join('.+?')}$`);
}

/**
 * A shown page text with MASKs (masked regions inline in a sentence): each MASK matches only a
 * value-shaped piece (VALUE), so the mask never absorbs words of the board text around it.
 */
function pagePattern(s: string): RegExp {
  return new RegExp(`^${s.split(MASK).map(escapeRe).join(VALUE)}$`);
}

/** One visible element's whole text, with the ids of the masked elements it contains. */
interface Shown {
  text: string;
  masks: number[];
}

/**
 * The `texts` (from `boardTexts`) that no visible element on the page shows. A text matches when:
 *   - some visible element's whole text equals it (whitespace collapsed); or
 *   - the text has a MASK (a {{…}} placeholder) and its pattern matches some shown text; or
 *   - a shown text has masked elements (inside [data-mask] or one of `masks`) inline where the
 *     text's changing part is, and every piece they stand for is value-shaped, e.g.
 *     "You pay · <Countdown/> left" covers "You pay · 62 min left" but not "You get · …"; or
 *   - the text is value-shaped and a masked element of the same kind (`valueKind`: time, money,
 *     code, count) stands on its own for it (a lone timer).
 * Use is tied to the masked ELEMENT: each masked element covers at most one board text, however
 * many wrapper elements repeat its sentence, and a {{…}} board text consumes the shown text (and
 * the masks in it) it matched.
 */
export async function missingTexts(page: Page, texts: string[], masks: Locator[] = []): Promise<string[]> {
  for (const m of masks) await m.evaluateAll((els, attr) => els.forEach((e) => e.setAttribute(attr, '')), MASK_ATTR);
  const { shown, standalone } = await page.evaluate(
    ({ sel, mask }) => {
      // Shown to a sighted person: rendered, and at least 2x2 px inside the document, so screen-reader
      // only text (1 px clip), a 0x0 box or text moved off the page does not count.
      const visible = (el: Element) => {
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const doc = document.documentElement;
        const left = r.left + window.scrollX;
        const top = r.top + window.scrollY;
        return left + r.width > 0 && top + r.height > 0 && left < doc.scrollWidth && top < doc.scrollHeight;
      };
      // The outermost visible masked elements, each with an id.
      const ids = new Map<Element, number>();
      const standalone: { id: number; text: string }[] = [];
      for (const el of Array.from(document.body.querySelectorAll(sel))) {
        if (el.parentElement?.closest(sel) || !visible(el)) continue;
        const id = ids.size;
        ids.set(el, id);
        // Standing on its own: no text of the parent's own beside it (not inline in a sentence).
        const inline = Array.from(el.parentElement?.childNodes ?? []).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        if (!inline) standalone.push({ id, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() });
      }
      const read = (node: Node, found: number[]): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node as Element;
        if (el.matches('script, style, template')) return '';
        if (el.matches(sel)) {
          const id = ids.get(el);
          if (id !== undefined) found.push(id);
          return mask;
        }
        return Array.from(el.childNodes)
          .map((n) => read(n, found))
          .join('');
      };
      const shown: { text: string; masks: number[] }[] = [];
      const seen = new Set<string>();
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el.matches('script, style, template') || el.closest(sel) || !visible(el)) continue;
        const found: number[] = [];
        const text = read(el, found).replace(/\s+/g, ' ').trim();
        if (text === '') continue;
        // Wrapper elements repeat their only child's text: one copy per (text, masks).
        const key = `${text}\u0001${found.join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        shown.push({ text, masks: found });
      }
      return { shown, standalone };
    },
    { sel: `[data-mask], [${MASK_ATTR}]`, mask: MASK },
  );
  for (const m of masks) await m.evaluateAll((els, attr) => els.forEach((e) => e.removeAttribute(attr)), MASK_ATTR);

  // Exact matches go first and take their shown text, so a {{…}} pattern ("Add …") cannot be
  // satisfied by a sentence another board text already accounts for ("Add a backup login?").
  const exact = new Set<string>();
  const usedMask = new Set<number>();
  const usedShown = new Set<Shown>();
  const free = (s: Shown) => !usedShown.has(s) && s.masks.every((id) => !usedMask.has(id));
  const take = (s: Shown) => {
    usedShown.add(s);
    for (const id of s.masks) usedMask.add(id);
  };
  // The best free shown text `ok` accepts: the fewest masks, then the shortest, so an ancestor that
  // joins several sentences never takes masks a single sentence could have used.
  const pick = (from: Shown[], ok: (s: Shown) => boolean): Shown | undefined =>
    from
      .filter((s) => free(s) && ok(s))
      .sort((x, y) => x.masks.length - y.masks.length || x.text.length - y.text.length)[0];
  // Shown sentences with masks inline in them, and real copy beside the masks.
  const masked = shown.filter((s) => s.text.includes(MASK) && s.text.replaceAll(MASK, '').trim() !== '');

  for (const t of texts) {
    if (t.includes(MASK)) continue;
    const hit = shown.find((s) => s.masks.length === 0 && s.text === t);
    if (hit) {
      exact.add(t);
      usedShown.add(hit);
    }
  }

  const missing: string[] = [];
  for (const t of texts) {
    if (t.includes(MASK)) {
      // A board placeholder text: present if its fixed copy is on the page around anything. It takes
      // the shown text it matched (the fewest masks first), so that one cannot cover another text.
      const re = boardPattern(t);
      const hit = pick(shown, (s) => re.test(s.text));
      if (hit) take(hit);
      else missing.push(t);
      continue;
    }
    if (exact.has(t)) continue;
    const hit = pick(masked, (s) => pagePattern(s.text).test(t));
    if (hit) {
      take(hit);
      continue;
    }
    const kind = VALUE_SHAPED.test(t) ? valueKind(t) : null;
    const lone = kind === null ? undefined : standalone.find((m) => !usedMask.has(m.id) && valueKind(m.text) === kind);
    if (lone !== undefined) {
      usedMask.add(lone.id);
      continue;
    }
    missing.push(t);
  }
  return missing;
}

/**
 * Board parity for the page as it is now; see the top of this file. Throws on a blocking failure.
 * `primary: false` is for a board with no primary action (Main, BuyMain: only the tab bar), where
 * the page must have no [data-primary] at all. It first sets the page's viewport to `o.viewport`
 * (default: the board's canvas.json size) and
 * leaves it there, so a test that goes on after it runs at that size.
 */
export async function expectParity(
  page: Page,
  board: string,
  o: { masks?: Locator[]; viewport?: ParityViewport; refsDir?: string; boardsDir?: string; primary?: boolean } = {},
): Promise<void> {
  // The board's own canvas.json size by default (390x844 for the phone boards, 1280x800 for
  // Desktop, 1280x900–1600 for the staff and mod boards), so the page is shot at the reference's size.
  const viewport = o.viewport ?? boardViewport(board, o.boardsDir);
  const [width, height] = viewport.split('x').map(Number) as [number, number];
  const now = page.viewportSize();
  if (now?.width !== width || now.height !== height) {
    await page.setViewportSize({ width, height });
    // Let the responsive shell re-render at the new width before anything is measured or shot.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }
  const masks = o.masks ?? [];
  const refsDir = o.refsDir ?? `${BOARDS_DIR}refs`;
  const failures: string[] = [];

  const primaries = await page
    .locator('[data-primary]')
    .evaluateAll((els) => els.filter((e) => e.checkVisibility({ visibilityProperty: true, opacityProperty: true })).length);
  if (o.primary === false) {
    if (primaries !== 0) failures.push(`no [data-primary] on a board without a primary action, found ${primaries}`);
  } else if (primaries !== 1) {
    failures.push(`exactly one [data-primary], found ${primaries}`);
  }

  const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  if (scroll.wide > scroll.view) failures.push(`horizontal scroll: ${scroll.wide} px wide in a ${scroll.view} px viewport`);

  const transformed = await page
    .locator('[data-username]')
    .evaluateAll((els) =>
      els.map((e) => ({ name: e.textContent ?? '', t: getComputedStyle(e).textTransform })).filter((x) => x.t !== 'none'),
    );
  for (const x of transformed) failures.push(`text-transform ${x.t} on [data-username] "${x.name}"`);

  const texts = await boardTexts(page, board, o.boardsDir ? { boardsDir: o.boardsDir } : {});
  if (texts.length === 0) failures.push(`no board texts read for ${board}`);
  for (const t of await missingTexts(page, texts, masks)) failures.push(`board copy missing: "${t.replaceAll(MASK, '…')}"`);

  await reportPixels(page, board, viewport, masks, refsDir);

  if (failures.length > 0) throw new Error(`parity with board ${board} at ${viewport}:\n  - ${failures.join('\n  - ')}`);
}

/**
 * The reported, non-blocking screenshot comparison: the page against `refsDir`/<board>.png at
 * MAX_DIFF_PIXEL_RATIO, with [data-mask] regions and `masks` blacked out in both before the pixels
 * are counted. A missing or differently-sized reference, and a difference over the ratio, are
 * reported in the returned string (and pushed as a "parity-pixels" annotation); on a difference the
 * reference and the page are attached to the report. Never writes a reference. Returns the result.
 */
export async function reportPixels(
  page: Page,
  board: string,
  viewport: ParityViewport,
  masks: Locator[],
  refsDir: string,
): Promise<string> {
  const refPath = `${refsDir.replace(/\/$/, '')}/${board}.png`;
  let result: string;
  let actual: Buffer | undefined;
  let reference: Buffer | undefined;
  try {
    if (!existsSync(refPath)) throw new Error(`no reference refs/${board}.png (capture it with tools/parity/capture-refs.ts)`);
    reference = readFileSync(refPath);
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (const loc of [page.locator('[data-mask]'), ...masks]) {
      for (const r of await loc.evaluateAll((els) =>
        els.map((e) => {
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        }),
      )) {
        rects.push(r);
      }
    }
    actual = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    const diff = await page.evaluate(
      async ({ refB64, actB64, rects }) => {
        const load = (b64: string) =>
          new Promise<HTMLImageElement>((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => rej(new Error('cannot decode a PNG'));
            img.src = `data:image/png;base64,${b64}`;
          });
        const [ref, act] = await Promise.all([load(refB64), load(actB64)]);
        if (ref.width !== act.width || ref.height !== act.height) {
          return { sizes: [ref.width, ref.height, act.width, act.height] as const };
        }
        const w = ref.width;
        const h = ref.height;
        const pixels = (img: HTMLImageElement): Uint8ClampedArray => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const cx = c.getContext('2d')!;
          cx.drawImage(img, 0, 0);
          cx.fillStyle = '#000';
          for (const r of rects) cx.fillRect(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w), Math.ceil(r.h));
          return cx.getImageData(0, 0, w, h).data;
        };
        const a = pixels(ref);
        const b = pixels(act);
        let differing = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i]! - b[i]!) > 12 || Math.abs(a[i + 1]! - b[i + 1]!) > 12 || Math.abs(a[i + 2]! - b[i + 2]!) > 12 || Math.abs(a[i + 3]! - b[i + 3]!) > 12) {
            differing += 1;
          }
        }
        return { ratio: differing / (w * h) };
      },
      { refB64: reference.toString('base64'), actB64: actual.toString('base64'), rects },
    );
    if ('sizes' in diff) {
      result = `reported, not blocking: sizes differ (reference ${diff.sizes[0]}x${diff.sizes[1]}, page ${diff.sizes[2]}x${diff.sizes[3]})`;
    } else if (diff.ratio <= MAX_DIFF_PIXEL_RATIO) {
      result = `within ${MAX_DIFF_PIXEL_RATIO * 100}% of refs/${board}.png (${(diff.ratio * 100).toFixed(2)}% of pixels differ)`;
    } else {
      result = `reported, not blocking: ${(diff.ratio * 100).toFixed(2)}% of pixels differ from refs/${board}.png`;
    }
  } catch (e) {
    result = `reported, not blocking: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (result.startsWith('reported') && !result.includes('no reference')) {
    try {
      if (reference) await test.info().attach(`${board}-reference`, { body: reference, contentType: 'image/png' });
      if (actual) await test.info().attach(`${board}-page`, { body: actual, contentType: 'image/png' });
    } catch {
      // Attaching is best-effort (no running test info, say); the result still stands.
    }
  }
  test.info().annotations.push({ type: 'parity-pixels', description: `${board} ${viewport}: ${result}` });
  // The list reporter prints neither annotations nor attachments for a passing test: print the line
  // so a person sees it (the HTML report in playwright-report/ keeps the attached images).
  console.log(`parity-pixels ${board} ${viewport}: ${result}`);
  return result;
}
