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

/** Every `from '<m>'` specifier in one staff source file. */
function importsOf(file: string): string[] {
  return [...readFileSync(join(SRC, file), 'utf8').matchAll(SPECIFIER)].map((m) => m[2]!);
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

/**
 * Design final call (10 Nov 2026): the staff News preview is the trader view, "As traders will see
 * it": the News page's own post component (apps/web screens/NewsPost.tsx), reached through the kit,
 * never a card of the staff app's own. The trader's News screen renders that same module, so the
 * two can never drift apart.
 */
describe('the News preview is the trader view, through the one door', () => {
  const WEB_SRC_DIR = fileURLToPath(new URL('../../web/src/', import.meta.url));

  it("the kit's door for NewsPost is apps/web's screens/NewsPost.tsx", () => {
    const kit = readFileSync(join(SRC, KIT), 'utf8');
    expect(kit).toMatch(/export \{[^}]*\bNewsPost\b[^}]*\} from '\.\.\/\.\.\/\.\.\/web\/src\/screens\/NewsPost\.js'/);
  });

  it('NewsEditor takes NewsPost from the kit and nothing from apps/web', () => {
    const editor = readFileSync(join(SRC, 'screens/NewsEditor.tsx'), 'utf8');
    expect(editor).toMatch(/import \{[^}]*\bNewsPost\b[^}]*\} from '\.\.\/ui\/kit\.js'/);
    expect(importsOf('screens/NewsEditor.tsx').filter((s) => WEB_SRC.test(s))).toEqual([]);
    // The preview is that component, under the trader-view heading.
    expect(editor).toContain('As traders will see it');
    expect(editor).toMatch(/data-part="news-preview"[\s\S]*?<NewsPost\b/);
  });

  it("the trader's News screen renders the same module", () => {
    const news = readFileSync(join(WEB_SRC_DIR, 'screens/News.tsx'), 'utf8');
    expect(news).toMatch(/import \{[^}]*\bNewsPost\b[^}]*\} from '\.\/NewsPost\.js'/);
    expect(news).toMatch(/<NewsPost\b/);
  });
});

/**
 * Primary button labels (ui.css `--x2f-primary-fit`): staff-web uses apps/web's Button and ui.css,
 * so main.tsx must install apps/web's fitPrimaryLabels observer through the one door (ui/kit.ts)
 * so long primary button labels scale down on narrow viewports instead of overflowing at 27 px.
 */
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

describe('primary button label fit is wired through the one door', () => {
  it("the kit's door for installPrimaryLabelFit is apps/web's ui/fitPrimaryLabels.ts", () => {
    const kit = stripComments(readFileSync(join(SRC, KIT), 'utf8'));
    expect(kit).toMatch(/export \{[^}]*\binstallPrimaryLabelFit\b[^}]*\} from '\.\.\/\.\.\/\.\.\/web\/src\/ui\/fitPrimaryLabels\.js'/);
  });

  it('main.tsx imports installPrimaryLabelFit from ui/kit.ts and calls it', () => {
    const main = stripComments(readFileSync(join(SRC, ENTRY), 'utf8'));
    expect(main).toMatch(/import \{[^}]*\binstallPrimaryLabelFit\b[^}]*\} from '\.\/ui\/kit\.js'/);
    expect(main).toMatch(/\binstallPrimaryLabelFit\s*\(\s*\)/);
  });

  it('stripComments drops line and block comments so commented-out calls do not match', () => {
    expect(stripComments('// installPrimaryLabelFit();\n/* installPrimaryLabelFit(); */')).not.toMatch(/\binstallPrimaryLabelFit\s*\(\s*\)/);
  });
});
