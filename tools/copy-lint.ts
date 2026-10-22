// `npm run copy-lint` (part of `npm run check`): the app's copy has no exclamation marks and no
// emoji (design system: "No emoji, no exclamation marks").
//
// - "!" is refused in user-visible text: JSX text, string literals (JSX attribute values included)
//   and the text parts of template literals in .ts/.tsx files under apps/web/src. Code operators
//   (!x, !==, a!) are syntax, not text, so they never reach the check; comments and regex literals
//   are skipped too.
// - An emoji code point is refused anywhere in any file under apps/web/src, comments included.
//   "Emoji" means a character that shows as an emoji by default (Emoji_Presentation), any
//   pictograph forced to emoji style with U+FE0F, a regional-indicator flag letter or a keycap.
//   Text-style marks the boards use (★ · … – −) are not emoji.
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

export const WEB_SRC = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

export interface Finding {
  file: string;
  line: number;
  column: number;
  rule: 'exclamation' | 'emoji' | 'parse';
  text: string;
}

const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}|⃣/u;
const EMOJI_ALL = new RegExp(EMOJI.source, 'gu');
const CODE = new Set(['.ts', '.tsx']);
const TEXT = new Set(['.ts', '.tsx', '.css', '.html', '.md', '.json', '.svg']);

function position(src: string, offset: number): { line: number; column: number } {
  const before = src.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

/** Every piece of text a user could see: string literals, template literal text and JSX text, with its offset. */
function textPieces(node: unknown, out: { text: string; start: number }[]): void {
  if (Array.isArray(node)) {
    for (const n of node) textPieces(n, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const n = node as { type?: unknown; value?: unknown; start?: unknown; regex?: unknown };
  const start = typeof n.start === 'number' ? n.start : 0;
  if (n.type === 'Literal' && typeof n.value === 'string' && n.regex === undefined) out.push({ text: n.value, start });
  else if (n.type === 'JSXText' && typeof n.value === 'string') out.push({ text: n.value, start });
  else if (n.type === 'TemplateElement') {
    const v = n.value as { cooked?: unknown; raw?: unknown } | undefined;
    const text = typeof v?.cooked === 'string' ? v.cooked : typeof v?.raw === 'string' ? v.raw : '';
    out.push({ text, start });
  }
  for (const [key, value] of Object.entries(n)) {
    if (key !== 'value' || n.type !== 'TemplateElement') textPieces(value, out);
  }
}

/** Lints one file's source; `file` decides the language by its extension and labels the findings. */
export function lintSource(src: string, file: string): Finding[] {
  const found: Finding[] = [];
  for (const m of src.matchAll(EMOJI_ALL)) {
    found.push({ file, ...position(src, m.index), rule: 'emoji', text: m[0] });
  }
  const ext = extname(file);
  if (CODE.has(ext)) {
    let program: unknown;
    try {
      program = parseAst(src, { lang: ext === '.tsx' ? 'tsx' : 'ts' }, file);
    } catch (e) {
      found.push({ file, line: 1, column: 1, rule: 'parse', text: e instanceof Error ? e.message.split('\n')[0]! : String(e) });
      return found;
    }
    const pieces: { text: string; start: number }[] = [];
    textPieces(program, pieces);
    for (const p of pieces) {
      if (p.text.includes('!')) found.push({ file, ...position(src, p.start), rule: 'exclamation', text: p.text.trim() });
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Lints every text file under `root`. */
export function lintTree(root: string): Finding[] {
  const found: Finding[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !TEXT.has(extname(entry.name))) continue;
    const path = join(entry.parentPath, entry.name);
    found.push(...lintSource(readFileSync(path, 'utf8'), relative(REPO, path)));
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = lintTree(WEB_SRC);
  for (const f of found) {
    const what = f.rule === 'exclamation' ? 'no "!" in copy' : f.rule === 'emoji' ? 'no emoji' : 'cannot parse';
    console.error(`${f.file}:${f.line}:${f.column}  ${what}: ${JSON.stringify(f.text)}`);
  }
  if (found.length > 0) {
    console.error(`copy-lint: ${found.length} problem${found.length === 1 ? '' : 's'}`);
    process.exit(1);
  }
  console.log('copy-lint: apps/web/src is clean');
}
