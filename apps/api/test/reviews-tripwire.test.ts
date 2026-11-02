// TRIPWIRE (Plan 5 Task 3 / Task 7): review notes are checked for personal details with
// `detectSensitiveText` from `@x2f/proof` (Task 7, built in parallel on another branch). Until it is
// on this tree, apps/api/src/reviews/sensitive.ts holds a small local stand-in. Checks the local
// tree only: it fails once `@x2f/proof` exports `detectSensitiveText` here while the stand-in is
// still in place; then make `hasPersonalDetails` call `detectSensitiveText(s).length > 0` (add
// `@x2f/proof` to apps/api/package.json), keep the note cases in reviews.test.ts passing, and
// delete this file.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : '');

function proofExportsDetector(): boolean {
  const dir = join(ROOT, 'packages/proof/src');
  if (!existsSync(dir)) return false;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .some((f) => /export\s+(?:async\s+)?function\s+detectSensitiveText\b/.test(readFileSync(join(dir, f), 'utf8')));
}

describe('review notes use Task 7 once it lands', () => {
  it('NEEDS_TASK_7_SENSITIVE_TEXT: the local stand-in goes once @x2f/proof exports detectSensitiveText', () => {
    const sensitive = read('apps/api/src/reviews/sensitive.ts');
    const usesProof = /from '@x2f\/proof'/.test(sensitive) && /detectSensitiveText\(/.test(sensitive);
    expect(!proofExportsDetector() || usesProof, 'Task 7 landed: call detectSensitiveText from @x2f/proof in reviews/sensitive.ts').toBe(true);
  });
});

// TRIPWIRE (Plan 5 Task 3 / Plan 7 Task 2 / Plan 5 Task 20): reviews have NO foreign key to trades
// (they are permanent, 301_reviews.sql), so the whole-trade purge cannot be reminded by a foreign
// key. Checks the local tree only: once apps/api/src/retention/tradePurge.ts exists, it must call
// `detachReviews` (apps/api/src/reviews/store.ts) as x2f_purge before it deletes the trade row, so
// no review keeps its trade code or reviewer id after the trade is gone (Revision 2026-10-29b).
describe('the whole-trade purge forgets which trade and reviewer a review came from', () => {
  it('NEEDS_PLAN_7_DETACH_REVIEWS: tradePurge.ts calls detachReviews once it exists', () => {
    const purge = read('apps/api/src/retention/tradePurge.ts');
    expect(purge === '' || /detachReviews\(/.test(purge), 'Plan 7 purge landed: call detachReviews(client, code) before deleting the trade').toBe(true);
  });
});

// TRIPWIRE (C12, owner 2026-11-02: "if the trade is OVERTURNED like it never happened, then the
// feedback is ERASED"): Plan 4 writes the trader-facing rulings (`dispute_rulings`, 108) and so
// records an overturn (an appeal's round 2 differing from round 1); nothing on this tree writes them
// yet. Checks the local tree only: once any source file under apps/*/src or packages/*/src inserts
// into dispute_rulings, some source file must call `eraseOverturnedReviews` (apps/api/src/reviews/
// store.ts) in the same transaction as the round-2 write, so an overturned trade's reviews and skips
// are deleted (the gate already leaves an overturned trade out: reviewableSinceSql).
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('an overturned trade loses its reviews once Plan 4 records overturns', () => {
  it('NEEDS_PLAN_4_OVERTURN_ERASES_REVIEWS: whoever writes dispute_rulings also calls eraseOverturnedReviews', () => {
    const roots = ['apps', 'packages'].flatMap((top) =>
      existsSync(join(ROOT, top)) ? readdirSync(join(ROOT, top)).map((name) => join(ROOT, top, name, 'src')) : [],
    );
    const files = roots.flatMap(sourceFiles).map((f) => readFileSync(f, 'utf8'));
    const writesRulings = files.some((s) => /insert\s+into\s+dispute_rulings\b/i.test(s));
    const callsErase = files.some((s) => /\beraseOverturnedReviews\(/.test(s) && !/export\s+async\s+function\s+eraseOverturnedReviews\b/.test(s));
    expect(!writesRulings || callsErase, 'Plan 4 rulings landed: call eraseOverturnedReviews(client, code) in the transaction that writes an overturning round 2').toBe(true);
  });
});
