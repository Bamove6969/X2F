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

describe('stylesheets', () => {
  it('no two stylesheets define the same top-level class', () => {
    const where = new Map<string, string[]>();
    for (const f of cssFiles(SRC)) {
      for (const c of ownClasses(readFileSync(f, 'utf8'))) where.set(c, [...(where.get(c) ?? []), relative(SRC, f)]);
    }
    const twice = Object.fromEntries([...where].filter(([, files]) => files.length > 1).map(([c, files]) => [c, files.sort()]));
    expect(twice).toEqual(KNOWN);
  });
});
