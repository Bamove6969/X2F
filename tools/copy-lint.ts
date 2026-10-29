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
// - Refusals go through `CantDoThat` (Plan 5 Task 21; owner, 2026-10-29): in JS/TS files, user
//   text that words a refusal ("can't", "cannot", "not allowed", "limited to", "Sorry", ...) or a
//   string literal equal to one of the API's refusal codes (CANT_DO_CODES in
//   apps/web/src/ui/cantDoCodes.ts) is refused unless the file imports `ui/CantDoThat` or
//   `ui/cantDoCodes`, or that line or the one above carries `not-a-refusal: <why>` in a comment
//   (an explanation, a fault such as a broken browser, not a rule that stops the user) or
//   `cant-do-that-todo: <why>` (a real refusal still shown inline; a test caps how many there are).
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
export const REFUSAL_WORDS = /\b(?:can['’]t|cannot|can not|not allowed|isn['’]t allowed|aren['’]t allowed|you['’]re limited|limited to|sorry)\b/i;
const CODES: ReadonlySet<string> = new Set(CANT_DO_CODES);
const CANT_DO_IMPORT = /(?:^|\/)(?:CantDoThat|cantDoCodes)(?:\.js|\.tsx?)?$/;
const PRAGMA = 'not-a-refusal:';
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

/** Every piece of text a user could see: string literals, template literal text and JSX text, with its offset. */
function textPieces(node: unknown, out: { text: string; start: number; literal: boolean }[]): void {
  if (Array.isArray(node)) {
    for (const n of node) textPieces(n, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const n = node as { type?: unknown; value?: unknown; start?: unknown; regex?: unknown };
  const start = typeof n.start === 'number' ? n.start : 0;
  if (n.type === 'Literal' && typeof n.value === 'string' && n.regex === undefined) out.push({ text: n.value, start, literal: true });
  else if (n.type === 'JSXText' && typeof n.value === 'string') out.push({ text: n.value, start, literal: false });
  else if (n.type === 'TemplateElement') {
    const v = n.value as { cooked?: unknown; raw?: unknown } | undefined;
    const text = typeof v?.cooked === 'string' ? v.cooked : typeof v?.raw === 'string' ? v.raw : '';
    out.push({ text, start, literal: false });
  }
  for (const [key, value] of Object.entries(n)) {
    if (key !== 'value' || n.type !== 'TemplateElement') textPieces(value, out);
  }
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
    const pieces: { text: string; start: number; literal: boolean }[] = [];
    textPieces(program, pieces);
    const body = (program as { body?: unknown }).body;
    const usesCantDo =
      CANT_DO_IMPORT.test(file.replace(/\.[^./]+$/, '')) ||
      (Array.isArray(body) &&
        body.some((n: { type?: unknown; source?: { value?: unknown } }) => n.type === 'ImportDeclaration' && typeof n.source?.value === 'string' && CANT_DO_IMPORT.test(n.source.value)));
    const lines = src.split('\n');
    const marked = (l: string) => l.includes(PRAGMA) || l.includes(TODO_PRAGMA);
    const excused = (line: number) => marked(lines[line - 1] ?? '') || marked(lines[line - 2] ?? '');
    for (const p of pieces) {
      if (!usesCantDo && (REFUSAL_WORDS.test(decodeEntities(p.text)) || (p.literal && CODES.has(p.text)))) {
        const at = position(src, p.start);
        if (!excused(at.line)) found.push({ file, ...at, rule: 'refusal', text: p.text.trim() });
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
