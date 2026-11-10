// Every screen's stylesheet is in the one bundle, so a class two files both define at the top level
// styles both screens with whichever rule loads last. The Task 22 landing found two: Task 18's
// `.x2f-quote` (min-height: 100dvh, the quote screen) stretched TradeFund's quote card past the
// fold, and Task 30's `.x2f-qr` sized TradeFund's QR code. Each task names its own classes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * Collisions on the line before this test, owned by other tasks (reported to the lead 2026-10-28):
 * Task 16's browse.css and Task 30's screens.css both define `.x2f-input`.
 */
const KNOWN: Record<string, string[]> = {
  'x2f-input': ['screens/browse/browse.css', 'screens/screens.css'],
};

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : n.endsWith('.css') ? [p] : [];
  });
}

/** The classes a stylesheet defines in a rule of its own (a selector that starts with the class, at the start of a line). */
function ownClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/^\s*\.([a-zA-Z0-9_-]+)/gm)) out.add(m[1]!);
  return out;
}

/**
 * The stylesheet's structural faults: an unbalanced brace, or a style rule with a rule inside it.
 * The sources use no CSS nesting (only at-rules such as @media hold rules), so a nested rule means a
 * rule lost its body: a merge once kept `.x2f-timer__label {` with no declarations and no `}`, and
 * every later rule in ui.css silently became `.x2f-timer__label …` and stopped applying.
 */
function structuralFaults(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/'[^'\n]*'|"[^"\n]*"/g, (q) => q.replace(/[{}]/g, ' '));
  const faults: string[] = [];
  const open: { atRule: boolean; line: number; head: string }[] = [];
  let start = 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;
    else if (ch === '{') {
      const head = text.slice(start, i).trim().replace(/\s+/g, ' ');
      const parent = open.at(-1);
      if (parent && !parent.atRule) faults.push(`line ${line}: "${head}" is nested inside "${parent.head}" (line ${parent.line})`);
      open.push({ atRule: head.startsWith('@'), line, head });
      start = i + 1;
    } else if (ch === '}') {
      if (open.pop() === undefined) faults.push(`line ${line}: a } with no rule open`);
      start = i + 1;
    } else if (ch === ';') start = i + 1;
  }
  for (const o of open) faults.push(`line ${o.line}: "${o.head}" is never closed`);
  return faults;
}

describe('stylesheets', () => {
  it('every stylesheet has balanced braces and no rule nested inside a style rule', () => {
    const faults = Object.fromEntries(
      cssFiles(SRC)
        .map((f) => [relative(SRC, f), structuralFaults(readFileSync(f, 'utf8')).slice(0, 3)] as const)
        .filter(([, list]) => list.length > 0),
    );
    expect(faults).toEqual({});
  });

  it('no two stylesheets define the same top-level class', () => {
    const where = new Map<string, string[]>();
    for (const f of cssFiles(SRC)) {
      for (const c of ownClasses(readFileSync(f, 'utf8'))) where.set(c, [...(where.get(c) ?? []), relative(SRC, f)]);
    }
    const twice = Object.fromEntries([...where].filter(([, files]) => files.length > 1).map(([c, files]) => [c, files.sort()]));
    expect(twice).toEqual(KNOWN);
  });
});
