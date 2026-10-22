import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WEB_SRC, lintSource, lintTree } from '../../../tools/copy-lint.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

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

  it('allows the typographic marks the boards use (★, ·, …, –, −)', () => {
    expect(lintSource('export const s = "★★★★★ · 1 h 2 min… A–Z −0.012500 XMR";\n', 'marks.ts')).toEqual([]);
  });

  it('reports a file it cannot parse instead of skipping it', () => {
    expect(lintSource('const = ;', 'broken.ts').map((f) => f.rule)).toEqual(['parse']);
  });

  it('passes on apps/web/src as committed', () => {
    expect(lintTree(WEB_SRC)).toEqual([]);
  });

  it('runs as part of `npm run check`', () => {
    const pkg = JSON.parse(readFileSync(`${REPO}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['copy-lint']).toBe('tsx tools/copy-lint.ts');
    expect(readFileSync(`${REPO}tools/check.sh`, 'utf8')).toMatch(/^npm run copy-lint$/m);
  });
});
