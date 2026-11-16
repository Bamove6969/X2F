// Owner, 16 Nov 2026: on a laptop the demo's type looked jagged ("like Times New Roman"). A weight
// or style the CSS asks for with no @font-face behind it is drawn from the nearest face, and a bold
// or italic the browser has to fake (font-synthesis) is what looks jagged on Windows. So every
// (family, weight, style) the web CSS uses must have a face that src/theme/fonts.css loads, and no
// font stack may end in a serif.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const require = createRequire(import.meta.url);

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, '');

/** The faces fonts.css loads: "family|weight|style", read from the @fontsource files it imports. */
function loadedFaces(fontsCss: string): Set<string> {
  const faces = new Set<string>();
  for (const m of stripComments(fontsCss).matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const css = readFileSync(require.resolve(m[1]!), 'utf8');
    for (const f of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const body = f[1]!;
      const family = unquote(/font-family:\s*([^;]+);/.exec(body)![1]!);
      const weight = /font-weight:\s*([^;]+);/.exec(body)![1]!.trim();
      const style = /font-style:\s*([^;]+);/.exec(body)?.[1]!.trim() ?? 'normal';
      faces.add(`${family}|${weight}|${style}`);
    }
  }
  return faces;
}

/** The custom properties tokens.css defines (the :root blocks), name to raw value. */
function customProps(css: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const m of stripComments(css).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) props.set(m[1]!, m[2]!.trim());
  return props;
}

/** Resolves var(--x[, fallback]) chains against the tokens; null for inherit/unknown. */
function resolve(value: string, props: Map<string, string>, depth = 0): string | null {
  const v = value.trim();
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (m) {
    const own = props.get(m[1]!);
    if (own !== undefined && depth < 8) return resolve(own, props, depth + 1);
    return m[2] === undefined ? null : resolve(m[2], props, depth + 1);
  }
  if (/^(inherit|unset|initial|revert)$/.test(v)) return null;
  return v;
}

const firstFamily = (stack: string): string => unquote(stack.split(',')[0]!);
const WEIGHT_WORDS: Record<string, string> = { normal: '400', bold: '700' };

interface Use {
  file: string;
  selector: string;
  family: string;
  weight: string;
  style: string;
}

/** Every rule in the web CSS that sets a family, weight or style, resolved to the face it needs. */
function uses(props: Map<string, string>): Use[] {
  const body = firstFamily(resolve('var(--x2f-body-family)', props)!);
  interface Rule { file: string; selectors: string[]; family: string | null; weight: string | null; style: string | null }
  const rules: Rule[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css'));
  for (const file of files) {
    const css = stripComments(readFileSync(join(SRC, file), 'utf8'));
    // Innermost blocks only: the rules themselves, inside or outside @media.
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decl = (name: string): string | undefined => new RegExp(`(?:^|;|\\s)${name}:\\s*([^;]+)`).exec(r[2]!)?.[1]?.trim();
      const fam = decl('font-family');
      const wt = decl('font-weight');
      const st = decl('font-style');
      if (fam === undefined && wt === undefined && st === undefined) continue;
      const sel = r[1]!.trim().replace(/\s+/g, ' ');
      if (sel.startsWith('@') || sel.startsWith('--')) continue;
      const famV = fam === undefined ? null : resolve(fam, props);
      const wtV = wt === undefined ? null : resolve(wt, props);
      rules.push({
        file,
        selectors: sel.split(',').map((s) => s.trim()),
        family: famV === null ? null : firstFamily(famV),
        weight: wtV === null ? null : (WEIGHT_WORDS[wtV] ?? wtV),
        style: st === undefined ? null : resolve(st, props),
      });
    }
  }
  // The classes on the subject of a selector (its last compound), e.g. `.a .b.c > .d` -> [d].
  const subjectClasses = (s: string): string[] => [...(s.split(/[\s>+~]+/).at(-1) ?? '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
  // A rule that sets a weight but no family gets the family that another rule gives the same
  // class (`.x2f-num { font-family: mono }` + `.x2f-facts dd.x2f-num { font-weight: 500 }`), else
  // the body face, the one most text inherits.
  // Also by the selector without the subject's states (`.post-unit button[aria-checked='true']`
  // inherits the family of `.post-unit button`).
  const bare = (s: string): string => s.replace(/(\[[^\]]*\]|::?[\w-]+(\([^)]*\))?)+$/, '');
  const familyOf = new Map<string, Set<string>>();
  const add = (k: string, fam: string): void => void familyOf.set(k, (familyOf.get(k) ?? new Set()).add(fam));
  for (const r of rules) {
    if (r.family === null) continue;
    for (const s of r.selectors) {
      for (const c of subjectClasses(s)) add(c, r.family);
      add(`sel:${bare(s)}`, r.family);
    }
  }
  const out: Use[] = [];
  for (const r of rules) {
    for (const selector of r.selectors) {
      const keys = [...subjectClasses(selector), `sel:${bare(selector)}`];
      const families = r.family !== null ? [r.family] : [...new Set(keys.flatMap((k) => [...(familyOf.get(k) ?? [])]))];
      for (const family of families.length > 0 ? families : [body]) {
        out.push({ file: r.file, selector, family, weight: r.weight ?? '400', style: r.style ?? 'normal' });
      }
    }
  }
  return out;
}

const tokensCss = readFileSync(join(SRC, 'theme/tokens.css'), 'utf8');
const fontsCss = readFileSync(join(SRC, 'theme/fonts.css'), 'utf8');
const baseCss = readFileSync(join(SRC, 'theme/base.css'), 'utf8');
const props = customProps(tokensCss);

describe('fonts', () => {
  it('loads a face for every family, weight and style the web CSS uses (no faux bold or italic)', () => {
    const faces = loadedFaces(fontsCss);
    expect(faces.size).toBeGreaterThan(0);
    const all = uses(props);
    expect(all.length).toBeGreaterThan(100);
    const missing = [...new Set(all.filter((u) => !faces.has(`${u.family}|${u.weight}|${u.style}`)).map((u) => `${u.family} ${u.weight} ${u.style} (${u.file}: ${u.selector})`))];
    expect(missing).toEqual([]);
  });

  it('loads a face for every type token (family with its weight)', () => {
    const faces = loadedFaces(fontsCss);
    const missing: string[] = [];
    for (const [name, value] of props) {
      const m = /^--x2f-([a-z-]+)-family$/.exec(name);
      if (!m || name.startsWith('--x2f-font-')) continue;
      const weight = props.get(`--x2f-${m[1]}-weight`);
      if (weight === undefined) continue;
      const family = firstFamily(resolve(value, props)!);
      if (!faces.has(`${family}|${weight}|normal`)) missing.push(`${m[1]}: ${family} ${weight}`);
    }
    expect(missing).toEqual([]);
  });

  it('ends every font stack in a generic sans-serif or monospace, never a serif', () => {
    const stacks = [...props].filter(([n]) => n.startsWith('--x2f-font-'));
    expect(stacks.length).toBe(3);
    for (const [name, stack] of stacks) {
      const last = stack.split(',').at(-1)!.trim();
      expect([name, last]).toEqual([name, name === '--x2f-font-mono' ? 'monospace' : 'sans-serif']);
      expect(stack).not.toMatch(/(^|,)\s*serif\s*(,|$)|Times|Georgia/);
    }
  });

  it('turns off synthesised weights and smooths type on the root', () => {
    const root = stripComments(baseCss);
    expect(root).toMatch(/html\s*\{[^}]*font-synthesis:\s*none;/);
    expect(root).toMatch(/html\s*\{[^}]*-webkit-font-smoothing:\s*antialiased;/);
    expect(root).toMatch(/html\s*\{[^}]*-moz-osx-font-smoothing:\s*grayscale;/);
    expect(root).toMatch(/html\s*\{[^}]*text-rendering:\s*optimizeLegibility;/);
  });
});
