// The one-door rule (src/ui/kit.ts): the staff app reaches apps/web only through the kit, so the
// kit can move to a shared package by changing one file. The one exception is stylesheets, and only
// in main.tsx, next to the trader app's tokens and faces, where a search for the rule's imports
// finds them (security review 2026-11-09, the staff invite's Terms, finding 1).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
/** The kit: every component and constant from apps/web comes through it. */
const KIT = 'ui/kit.ts';
/** The entry: the trader app's stylesheets, and nothing else from apps/web. */
const ENTRY = 'main.tsx';
/** `from '<m>'`, `import '<m>'`, `import('<m>')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;
/** A specifier that reaches into apps/web (`../../web/src/...`, `../../../web/src/...`). */
const WEB_SRC = /(^|\/)web\/src\//;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) yield path;
  }
}

/** Every `web/src` import in the staff app's sources, as `<file>: <specifier>`. */
function webImports(): Array<{ file: string; specifier: string }> {
  const found: Array<{ file: string; specifier: string }> = [];
  for (const path of sources(SRC)) {
    const file = relative(SRC, path).split('\\').join('/');
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(SPECIFIER)) {
      const specifier = m[2]!;
      if (WEB_SRC.test(specifier)) found.push({ file, specifier });
    }
  }
  return found;
}

describe('the one-door rule: apps/web is imported through ui/kit.ts alone', () => {
  it('the scan sees the kit\'s own doors', () => {
    expect(webImports().filter((i) => i.file === KIT).length).toBeGreaterThan(0);
  });

  it('no other file imports from apps/web, except main.tsx for its stylesheets', () => {
    const outside = webImports()
      .filter((i) => i.file !== KIT)
      .filter((i) => !(i.file === ENTRY && i.specifier.endsWith('.css')))
      .map((i) => `${i.file}: ${i.specifier}`);
    expect(outside, 'import it through src/ui/kit.ts (a stylesheet: from main.tsx)').toEqual([]);
  });
});
