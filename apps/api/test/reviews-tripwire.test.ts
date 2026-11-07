import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : '');

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

// TRIPWIRE NEEDS_P4_OVERTURN_ERASES_REVIEWS (C12, owner 2026-11-02, review I2: "if the trade is
// OVERTURNED like it never happened, then the feedback is ERASED; if all ends well and finishes like
// a normal trade after the dispute, the feedback remains"). Plan 4's ruling executor is not built:
// no API code moves a dispute to `final`, writes the trader-facing rulings (`dispute_rulings`, 108),
// records `overturned` or logs `ruling.final`. Checks the local tree only: once any file under
// apps/api/src does one of those, that same file must call `eraseReviewsOfTrade(client, code)` (or
// `eraseOverturnedReviews`, which calls it only for an overturned trade), apps/api/src/reviews/
// store.ts, in the transaction that records the overturning ruling. A ruling that is not overturned
// keeps the reviews (reviews.test.ts "late funds escalate").
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Does this API source write a final or overturned ruling? (The log action catalogue only names it.) */
function writesFinalRuling(path: string, src: string): boolean {
  if (/[\\/]log[\\/]actions\.ts$/.test(path)) return false;
  return (
    /insert\s+into\s+dispute_rulings\b/i.test(src) ||
    /update\s+disputes\b[^;`]*\b(status\s*=\s*'final'|overturned\s*=)/i.test(src) ||
    /['"`]ruling\.final['"`]/.test(src)
  );
}

// `withDispute` / `saveDispute` (disputes/store.ts) erase an overturned trade's reviews in the
// same transaction (checked below), so a file that writes rulings through them is covered.
const callsErase = (src: string): boolean =>
  /\b(eraseReviewsOfTrade|eraseOverturnedReviews|withDispute|saveDispute)\(/.test(
    src.replace(/export\s+async\s+function\s+(eraseReviewsOfTrade|eraseOverturnedReviews|withDispute|saveDispute)\(/g, ''),
  );

describe('an overturned trade loses its reviews once Plan 4 records final rulings', () => {
  it('NEEDS_P4_OVERTURN_ERASES_REVIEWS: API code that writes a final/overturned ruling also calls eraseReviewsOfTrade', () => {
    const offenders = sourceFiles(join(ROOT, 'apps/api/src'))
      .map((f) => ({ f, src: readFileSync(f, 'utf8') }))
      .filter(({ f, src }) => writesFinalRuling(f, src) && !callsErase(src))
      .map(({ f }) => f.slice(ROOT.length));
    expect(offenders, 'Plan 4 rulings landed: call eraseReviewsOfTrade(client, code) in the transaction that records an overturning ruling').toEqual([]);
  });

  it('saveDispute erases the reviews of an overturned dispute (the seam the detector trusts)', () => {
    const store = readFileSync(join(ROOT, 'apps/api/src/disputes/store.ts'), 'utf8');
    const save = store.slice(store.indexOf('export async function saveDispute('));
    const body = save.slice(0, save.indexOf('\n}\n'));
    expect(body).toMatch(/if \(d\.overturned === true\) await eraseReviewsOfTrade\(client, d\.code\)/);
    expect(store).toMatch(/await saveDispute\(client, next, now\)/);
  });

  it('the detector sees the writes it is meant to see (and not the log catalogue)', () => {
    expect(writesFinalRuling('apps/api/src/x.ts', "insert into dispute_rulings (code) values ($1)")).toBe(true);
    expect(writesFinalRuling('apps/api/src/x.ts', "update disputes set status = 'final' where code = $1")).toBe(true);
    expect(writesFinalRuling('apps/api/src/x.ts', 'update disputes set overturned = $2 where code = $1')).toBe(true);
    expect(writesFinalRuling('apps/api/src/x.ts', "appendLog(c, { action: 'ruling.final', detail })")).toBe(true);
    expect(writesFinalRuling('apps/api/src/log/actions.ts', "'ruling.final': { overturned: 'bool' }")).toBe(false);
    expect(writesFinalRuling('apps/api/src/x.ts', "select * from dispute_rulings where code = $1")).toBe(false);
    expect(callsErase('await eraseReviewsOfTrade(client, code);')).toBe(true);
    expect(callsErase('export async function eraseReviewsOfTrade(q, code) {}')).toBe(false);
  });
});
