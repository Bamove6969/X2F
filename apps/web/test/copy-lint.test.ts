import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEB_SRC, lintSource, lintTree } from '../../../tools/copy-lint.js';

const run = promisify(execFile);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = join(REPO, 'tools', 'copy-lint.ts');

describe('copy-lint', () => {
  it('flags a planted "Done!" in a string literal', () => {
    const found = lintSource('export const label = "Done!";\n', 'planted.ts');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'planted.ts', line: 1, rule: 'exclamation' });
  });

  it('flags "!" in JSX text, JSX attribute strings and template literal text', () => {
    const src = [
      'export const A = () => <p title="Hi!">Released!</p>;',
      'export const b = (n: number) => `Sent ${n}!`;',
    ].join('\n');
    const found = lintSource(src, 'planted.tsx');
    expect(found.map((f) => [f.line, f.rule])).toEqual([
      [1, 'exclamation'],
      [1, 'exclamation'],
      [2, 'exclamation'],
    ]);
  });

  it('ignores code operators, non-null assertions, regexes and comments', () => {
    const src = [
      '// Wow! a comment',
      '/* also! */',
      'const x = (a: string | null) => a !== null && !a.startsWith("x") && a! != "y";',
      'const re = /^!(.*)$/;',
      'export const ok = () => <p>{!x ? "Ready" : "Waiting"}</p>;',
    ].join('\n');
    expect(lintSource(src, 'clean.tsx')).toEqual([]);
  });

  it('flags any emoji code point, anywhere in the file', () => {
    const smile = String.fromCodePoint(0x1f600);
    const check = String.fromCodePoint(0x2705);
    expect(lintSource(`const a = "Paid ${smile}";\n`, 'a.ts').map((f) => f.rule)).toEqual(['emoji']);
    expect(lintSource(`// ${check} in a comment\nconst b = 1;\n`, 'b.ts').map((f) => f.rule)).toEqual(['emoji']);
    expect(lintSource(`.x::after { content: "${check}"; }\n`, 'c.css').map((f) => f.rule)).toEqual(['emoji']);
  });

  it('flags the FE0F, regional-indicator and keycap emoji branches', () => {
    // A pictograph forced to emoji style with U+FE0F (❤ U+2764 is text by default).
    const heart = `${String.fromCodePoint(0x2764)}${String.fromCodePoint(0xfe0f)}`;
    // A flag: two regional-indicator letters (US).
    const flag = `${String.fromCodePoint(0x1f1fa)}${String.fromCodePoint(0x1f1f8)}`;
    // A keycap: digit + U+FE0F + U+20E3.
    const keycap = `1${String.fromCodePoint(0xfe0f)}${String.fromCodePoint(0x20e3)}`;
    for (const [src, name] of [
      [`const a = "${heart}";\n`, 'a.ts'],
      [`const b = "${flag}";\n`, 'b.ts'],
      [`const c = "${keycap}";\n`, 'c.ts'],
    ] as const) {
      const rules = lintSource(src, name).map((f) => f.rule);
      expect(rules.length, name).toBeGreaterThan(0);
      expect(rules.every((r) => r === 'emoji'), name).toBe(true);
    }
  });

  it('flags emoji hidden in a string escape, an HTML entity and a CSS content escape', () => {
    // Escapes: the raw source is ASCII; only the cooked string / decoded value is an emoji.
    expect(lintSource('const a = "\\u{1F600}";\n', 'a.ts').map((f) => f.rule)).toEqual(['emoji']);
    expect(lintSource('<p>&#128512;</p>\n', 'a.html').map((f) => f.rule)).toEqual(['emoji']);
    expect(lintSource('.x::after { content: "\\2705"; }\n', 'a.css').map((f) => f.rule)).toEqual(['emoji']);
  });

  it('flags "!" written as an entity in JSX text and JSX attributes (React renders it as "!")', () => {
    for (const src of [
      'export const A = () => <p>Done&#33;</p>;',
      'export const A = () => <p>Done&#x21;</p>;',
      'export const A = () => <p>Done&excl;</p>;',
      'export const A = () => <p title="Hi&#33;">Ready</p>;',
      'export const A = () => <p title="Hi&excl;">Ready</p>;',
    ]) {
      expect(lintSource(`${src}\n`, 'planted.tsx').map((f) => f.rule), src).toEqual(['exclamation']);
    }
    // Other entities are fine.
    expect(lintSource('export const A = () => <p title="A &amp; B">1 &lt; 2&nbsp;min</p>;\n', 'ok.tsx')).toEqual([]);
  });

  it('flags an emoji written as a pair of entities', () => {
    expect(lintSource('<p>&#x2764;&#xFE0F;</p>\n', 'a.html').map((f) => f.rule)).toEqual(['emoji']);
    expect(lintSource('<p>&#10084;&#65039;</p>\n', 'a.html').map((f) => f.rule)).toEqual(['emoji']);
    // A flag: two regional indicators, each an entity.
    expect(lintSource('export const A = () => <p>&#x1F1FA;&#x1F1F8;</p>;\n', 'a.tsx').map((f) => f.rule)).toEqual(['emoji']);
    // ❤ alone (text style) is not an emoji.
    expect(lintSource('<p>&#x2764;</p>\n', 'a.html')).toEqual([]);
  });

  it('allows the typographic marks the boards use (★, ·, …, –, −)', () => {
    expect(lintSource('export const s = "★★★★★ · 1 h 2 min… A–Z −0.012500 XMR";\n', 'marks.ts')).toEqual([]);
  });

  it('reports a file it cannot parse instead of skipping it', () => {
    expect(lintSource('const = ;', 'broken.ts').map((f) => f.rule)).toEqual(['parse']);
  });

  it('lints the JS variants and throws on an extension it has no rule for', () => {
    expect(lintSource('export const a = "Done!";\n', 'a.mjs').map((f) => f.rule)).toEqual(['exclamation']);
    expect(lintSource('export const a = "Done!";\n', 'a.cts').map((f) => f.rule)).toEqual(['exclamation']);
    expect(() => lintSource('print("hi")', 'script.py')).toThrow(/no rule for \.py/);
    expect(() => lintSource('x', 'noext')).toThrow(/no rule/);
  });

  it('passes on apps/web/src as committed', () => {
    expect(lintTree(WEB_SRC)).toEqual([]);
  });

  describe('lintTree and the CLI over a planted temp folder', () => {
    let dir = '';
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'x2f-copylint-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('lintTree finds a planted problem and the clean tree has none', () => {
      writeFileSync(join(dir, 'clean.ts'), 'export const ok = "Ready";\n');
      expect(lintTree(dir)).toEqual([]);
      writeFileSync(join(dir, 'bad.tsx'), 'export const B = () => <p>Done!</p>;\n');
      expect(lintTree(dir).map((f) => f.rule)).toEqual(['exclamation']);
    });

    it('the CLI exits non-zero on a planted problem and zero on a clean folder', async () => {
      writeFileSync(join(dir, 'clean.ts'), 'export const ok = "Ready";\n');
      const clean = await run(process.execPath, [TSX, CLI, dir], { cwd: REPO });
      expect(clean.stdout).toMatch(/copy-lint:/);
      writeFileSync(join(dir, 'bad.ts'), 'export const label = "Done!";\n');
      await expect(run(process.execPath, [TSX, CLI, dir], { cwd: REPO })).rejects.toMatchObject({ code: 1 });
    });
  });

  it('runs as part of `npm run check`', () => {
    const pkg = JSON.parse(readFileSync(`${REPO}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['copy-lint']).toBe('tsx tools/copy-lint.ts');
    expect(readFileSync(`${REPO}tools/check.sh`, 'utf8')).toMatch(/^npm run copy-lint$/m);
  });
});
