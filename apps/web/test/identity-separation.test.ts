// Lead answer 2026-10-24 (3): the ban on naming the protocol's identity maker covers apps/api and
// everything in apps/web EXCEPT the escrow worker, the one place a trader's trade identity is
// made. Same file rules as Task 8's tools/separation-check.ts (wip/t3-p3-task8), which must exempt
// exactly the worker.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.vite', 'coverage']);
const SCANNED = /\.(?:[cm]?[jt]sx?|json|html)$/;
// `[I]` keeps this literal from matching its own source text.
const NAME = /\bgenerate[I]dentity\b/;
const WORKER = 'apps/web/src/escrow/worker.ts';

function files(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out = out.concat(files(p));
    } else if (e.isFile() && SCANNED.test(e.name)) out.push(p);
  }
  return out;
}

const naming = (app: string): string[] =>
  files(join(ROOT, app))
    .filter((f) => NAME.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f).split('\\').join('/'));

describe('who may make trade identities', () => {
  it('in apps/web, only the escrow worker names the identity maker', () => {
    expect(naming('apps/web')).toEqual([WORKER]);
  });

  it('the worker imports it from @x2f/protocol (so the check sees a real use, not a comment)', () => {
    expect(readFileSync(join(ROOT, WORKER), 'utf8')).toMatch(/import\s*\{[^}]*\bgenerate[I]dentity\b[^}]*\}\s*from\s*'@x2f\/protocol'/);
  });

  it('apps/api never names it', () => {
    expect(naming('apps/api')).toEqual([]);
  });
});
