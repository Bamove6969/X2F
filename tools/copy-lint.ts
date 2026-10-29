// `npm run copy-lint` (part of `npm run check`): the app's copy has no exclamation marks and no
// emoji (design system: "No emoji, no exclamation marks").
//
// - "!" is refused in user-visible text: JSX text, string literals (JSX attribute values included)
//   and the text parts of template literals in JS/TS files (.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts)
//   under apps/web/src, with HTML entities decoded as React does in JSX (`Done&#33;`, `&excl;`).
//   Code operators (!x, !==, a!) are syntax, not text, so they never reach the check; comments
//   and regex literals are skipped too.
// - An emoji code point is refused anywhere in any file under apps/web/src, comments included:
//   written literally, as a string/template escape ("\u{1F600}"), as HTML entities (&#128512;, or
//   a run such as &#x2764;&#xFE0F; decoded as a whole), or in a CSS `content` value's unicode
//   escape ("\2705"). "Emoji" means a character that shows as an emoji by default
//   (Emoji_Presentation), any pictograph forced to emoji style with U+FE0F, a regional-indicator
//   flag letter or a keycap. Text-style marks the boards use
//   (★ · … – −) are not emoji. lintSource throws on a file extension it has no rule for.
// - The owner's own wording wins over the "!" rule where he gave a sentence exactly: OWNER_WORDING
//   lists each one (2026-10-29: the feedback form's thank-you), matched as the whole string.
// - Refusals go through `CantDoThat` (Plan 5 Task 21; owner, 2026-10-29). In JS/TS files, every
//   piece of user text that words a refusal (REFUSAL_WORDS: "can't", "unable", "too many",
//   "already have", ...) and every string literal equal to one of the API's refusal codes
//   (CANT_DO_CODES in apps/web/src/ui/cantDoCodes.ts) is judged on its own. It passes only when:
//     - it lives in the refusal text map itself (ui/cantDoCodes.ts) or in ui/CantDoThat.tsx;
//     - it is written straight into a `<CantDoThat title=... body=...>` attribute; or
//     - a real comment (not text inside a string) on the same line, or ending on the line above,
//       says `not-a-refusal: <why>` (an explanation, an input check, a fault, not a rule that
//       stops the user) or `cant-do-that-todo: <why>` (a refusal still shown inline). Tests count
//       both kinds of pragma, so neither can grow unnoticed.
//   Importing CantDoThat exempts nothing: each refusal must be routed or marked. Wording in a
//   sentence that asks the person to "try again" is a fault report and is not judged (TRY_AGAIN).
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { CANT_DO_CODES } from '../apps/web/src/ui/cantDoCodes.js';

export const WEB_SRC = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

export interface Finding {
  file: string;
  line: number;
  column: number;
  rule: 'exclamation' | 'emoji' | 'parse' | 'refusal';
  text: string;
}

/** Sentences the owner gave word for word, "!" included (whole string, after trimming). */
export const OWNER_WORDING: ReadonlySet<string> = new Set([
  // Plan 5 Task 21, spec 5.2 (owner, 2026-10-29): shown after the feedback form is sent.
  'Thank you! Each and every comment is appreciated and reviewed to help make this community a better place for us all.',
]);

/** Wording that tells the user they can't do something. */
export const REFUSAL_WORDS =
  /\b(?:can['’]t|cannot|can not|couldn['’]t|could not|unable|not able|not allowed|isn['’]t allowed|aren['’]t allowed|not permitted|you['’]re limited|limited to|sorry|no longer|too many|at most|maximum|only \d|once every|already have|(?:isn['’]t|is not|aren['’]t|are not|not) available|is blocked|you must|needs at least)\b/i;
/**
 * A sentence that reports a fault, not a rule: it asks the person to try again or reload, says
 * something could not load, or is the device's own safety check ("Your device can't ..."). A rule
 * refusal does not go away by retrying. Its wording is not judged; a refusal code literal still is.
 */
const TRY_AGAIN = /\b(?:try (?:it )?again|reload the page|could(?:n['’]t| not) (?:load|read|copy|reach)|your device)\b/i;
const CODES: ReadonlySet<string> = new Set(CANT_DO_CODES);
/** The two files that hold refusal wording by design: the text map and the popup. */
const CANT_DO_HOME = /(?:^|\/)apps\/web\/src\/ui\/(?:cantDoCodes\.ts|CantDoThat\.tsx)$|^(?:cantDoCodes\.ts|CantDoThat\.tsx)$/;
export const PRAGMA = 'not-a-refusal:';
/** A refusal still shown inline, waiting to move into CantDoThat (counted by a ratchet test). */
export const TODO_PRAGMA = 'cant-do-that-todo:';

const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}|⃣/u;
const EMOJI_ALL = new RegExp(EMOJI.source, 'gu');
const isEmoji = (s: string): boolean => new RegExp(EMOJI.source, 'u').test(s);
// Parsed for "!" in copy (every ECMAScript/TypeScript variant), scanned as plain text otherwise.
const JS_TS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const PLAIN = new Set(['.css', '.html', '.htm', '.md', '.json', '.svg']);

// The named entities React's JSX decodes that matter here ("!" and the common ones); others are
// left as written.
const NAMED: Record<string, string> = { excl: '!', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;
const ENTITY_RUN = /(?:&(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);)+/g;

/** `s` with numeric and the NAMED HTML entities decoded (an invalid code point is left as written). */
export function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name != null) return NAMED[name] ?? whole;
    try {
      return String.fromCodePoint(dec != null ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16));
    } catch {
      return whole;
    }
  });
}

function position(src: string, offset: number): { line: number; column: number } {
  const before = src.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

/**
 * Every emoji in `src`: a literal emoji code point anywhere (comments included), one written as a
 * run of HTML entities (`&#128512;`, `&#x2764;&#xFE0F;`), and one hidden in a CSS `content` value's unicode escape
 * (`content: "\2705"`). Emoji inside a string/template escape (`"\u{1F600}"`) are caught from the
 * cooked pieces in `lintSource`. A literal emoji is reported once, at its real position.
 */
function emojiFindings(src: string, file: string): { out: Finding[]; literal: Set<string> } {
  const out: Finding[] = [];
  const literal = new Set<string>();
  for (const m of src.matchAll(EMOJI_ALL)) {
    literal.add(m[0]);
    out.push({ file, ...position(src, m.index), rule: 'emoji', text: m[0] });
  }
  // A run of entities is decoded as a whole, so an emoji written as an entity pair
  // (`&#x2764;&#xFE0F;`, or a flag's two regional indicators) is caught; one finding per run.
  for (const m of src.matchAll(ENTITY_RUN)) {
    const decoded = decodeEntities(m[0]);
    if (decoded !== m[0] && isEmoji(decoded)) out.push({ file, ...position(src, m.index), rule: 'emoji', text: m[0] });
  }
  for (const m of src.matchAll(/content\s*:\s*(['"])((?:\\.|(?!\1)[^])*)\1/gi)) {
    const decoded = m[2]!.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(h, 16));
      } catch {
        return '';
      }
    });
    for (const e of decoded.matchAll(EMOJI_ALL)) if (!literal.has(e[0])) out.push({ file, ...position(src, m.index), rule: 'emoji', text: e[0] });
  }
  return { out, literal };
}

interface Piece {
  text: string;
  start: number;
  end: number;
  /** A string literal (so it can be an API code), as opposed to JSX text or template text. */
  literal: boolean;
  /** Written straight into `<CantDoThat title=... body=...>`. */
  toCantDo: boolean;
}

/** Every piece of text a user could see: string literals, template literal text and JSX text, with its offset. */
function textPieces(node: unknown, out: Piece[], ranges: [number, number][], toCantDo = false): void {
  if (Array.isArray(node)) {
    for (const n of node) textPieces(n, out, ranges, toCantDo);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  // A literal type (`{ result: 'too-soon' }`) is never shown to anyone.
  if ((node as { type?: unknown }).type === 'TSLiteralType') return;
  const n = node as { type?: unknown; value?: unknown; start?: unknown; end?: unknown; regex?: unknown; name?: unknown; attributes?: unknown };
  const start = typeof n.start === 'number' ? n.start : 0;
  const end = typeof n.end === 'number' ? n.end : start;
  if (n.type === 'Literal' && typeof n.value === 'string' && n.regex === undefined) out.push({ text: n.value, start, end, literal: true, toCantDo });
  else if (n.type === 'JSXText' && typeof n.value === 'string') out.push({ text: n.value, start, end, literal: false, toCantDo });
  else if (n.type === 'TemplateElement') {
    const v = n.value as { cooked?: unknown; raw?: unknown } | undefined;
    const text = typeof v?.cooked === 'string' ? v.cooked : typeof v?.raw === 'string' ? v.raw : '';
    out.push({ text, start, end, literal: false, toCantDo });
  }
  // Strings, template text, JSX text and regexes: a "//" inside them is not a comment.
  if ((n.type === 'Literal' && (typeof n.value === 'string' || n.regex !== undefined)) || n.type === 'TemplateElement' || n.type === 'JSXText') ranges.push([start, end]);
  if (n.type === 'JSXOpeningElement' && Array.isArray(n.attributes)) {
    const name = (n.name as { name?: unknown } | undefined)?.name;
    for (const a of n.attributes as { type?: unknown; name?: { name?: unknown } }[]) {
      const routed = name === 'CantDoThat' && a.type === 'JSXAttribute' && (a.name?.name === 'title' || a.name?.name === 'body');
      textPieces(a, out, ranges, toCantDo || routed);
    }
    textPieces(n.name, out, ranges, toCantDo);
    return;
  }
  for (const [key, value] of Object.entries(n)) {
    if (key !== 'value' || n.type !== 'TemplateElement') textPieces(value, out, ranges, toCantDo);
  }
}

/** Real comments (outside strings, template text, JSX text and regexes): [start, end, text]. */
function comments(src: string, ranges: [number, number][]): { start: number; end: number; text: string }[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const inside = (i: number) => sorted.some(([a, b]) => i >= a && i < b);
  const out: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== '/' || (src[i + 1] !== '/' && src[i + 1] !== '*') || inside(i)) continue;
    const close = src[i + 1] === '/' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
    const end = close === -1 ? src.length : src[i + 1] === '/' ? close : close + 2;
    out.push({ start: i, end, text: src.slice(i, end) });
    i = end - 1;
  }
  return out;
}

/** How many pragmas of each kind a source holds, in real comments only (the ratchet tests count them). */
export function countPragmas(src: string, file: string): { notARefusal: number; todo: number } {
  const ext = extname(file);
  const lang = ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.js' || ext === '.mjs' || ext === '.cjs' ? 'js' : 'ts';
  const ranges: [number, number][] = [];
  textPieces(parseAst(src, { lang }, file), [], ranges);
  const cs = comments(src, ranges);
  return { notARefusal: cs.filter((c) => c.text.includes(PRAGMA)).length, todo: cs.filter((c) => c.text.includes(TODO_PRAGMA)).length };
}

/**
 * Lints one file's source; `file` decides the language by its extension and labels the findings.
 * Throws on an extension the linter does not know, so a new kind of source file is never skipped
 * silently.
 */
export function lintSource(src: string, file: string): Finding[] {
  const ext = extname(file);
  if (!JS_TS.has(ext) && !PLAIN.has(ext)) throw new Error(`copy-lint: no rule for ${ext || '(no extension)'} (${file})`);
  const { out: found, literal } = emojiFindings(src, file);
  if (JS_TS.has(ext)) {
    const lang = ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.js' || ext === '.mjs' || ext === '.cjs' ? 'js' : 'ts';
    let program: unknown;
    try {
      program = parseAst(src, { lang }, file);
    } catch (e) {
      found.push({ file, line: 1, column: 1, rule: 'parse', text: e instanceof Error ? e.message.split('\n')[0]! : String(e) });
      return found;
    }
    const pieces: Piece[] = [];
    const ranges: [number, number][] = [];
    textPieces(program, pieces, ranges);
    const home = CANT_DO_HOME.test(file);
    // A pragma counts only in a real comment; it covers its own line(s) and the line after it.
    const pragmaLines = new Set<number>();
    for (const c of comments(src, ranges)) {
      if (!c.text.includes(PRAGMA) && !c.text.includes(TODO_PRAGMA)) continue;
      const first = position(src, c.start).line;
      const last = position(src, c.end).line;
      for (let l = first; l <= last + 1; l++) pragmaLines.add(l);
    }
    for (const p of pieces) {
      if (!home && !p.toCantDo && ((REFUSAL_WORDS.test(decodeEntities(p.text)) && !TRY_AGAIN.test(p.text)) || (p.literal && CODES.has(p.text)))) {
        const at = position(src, p.start);
        if (!pragmaLines.has(at.line)) found.push({ file, ...at, rule: 'refusal', text: p.text.trim() });
      }
      // JSX text and attribute strings are entity-decoded by React (`Done&#33;` shows "Done!"), so
      // every piece is checked decoded; a plain string literal holding an entity is rare enough
      // that being stricter there costs nothing.
      if (decodeEntities(p.text).includes('!') && !OWNER_WORDING.has(p.text.trim())) found.push({ file, ...position(src, p.start), rule: 'exclamation', text: p.text.trim() });
      // Emoji written as a string/template escape (`"\u{1F600}"`) only shows in the cooked text.
      for (const e of p.text.matchAll(EMOJI_ALL)) if (!literal.has(e[0])) found.push({ file, ...position(src, p.start), rule: 'emoji', text: e[0] });
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Lints every source file under `root` the linter knows (JS/TS and the plain text kinds). */
export function lintTree(root: string): Finding[] {
  const found: Finding[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name);
    if (!JS_TS.has(ext) && !PLAIN.has(ext)) continue;
    const path = join(entry.parentPath, entry.name);
    found.push(...lintSource(readFileSync(path, 'utf8'), relative(REPO, path)));
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : WEB_SRC;
  const found = lintTree(root);
  for (const f of found) {
    const what =
      f.rule === 'exclamation'
        ? 'no "!" in copy'
        : f.rule === 'emoji'
          ? 'no emoji'
          : f.rule === 'refusal'
            ? 'a refusal must be shown with CantDoThat (or mark the line `// not-a-refusal: <why>`)'
            : 'cannot parse';
    console.error(`${f.file}:${f.line}:${f.column}  ${what}: ${JSON.stringify(f.text)}`);
  }
  if (found.length > 0) {
    console.error(`copy-lint: ${found.length} problem${found.length === 1 ? '' : 's'}`);
    process.exit(1);
  }
  console.log(`copy-lint: ${relative(REPO, root) || root} is clean`);
}
