// TRIPWIRE (local tree only): no Claude Design board yet for the dispute screen or the moderators'
// Review disputes page (Plan 5 Task 19 asks parity for both). Both are built from the kit with no
// styling of their own and have no parity entry. When a board lands, match the screens to it, add
// expectParity to apps/web/e2e/disputeReview.spec.ts and apps/staff-web/e2e/reviewDisputes.spec.ts,
// and delete this tripwire.
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BOARDS = fileURLToPath(new URL('../../../design/x2f-app/', import.meta.url));

describe('Task 19 waits for its Claude Design boards', () => {
  it('NEEDS_DESIGN_REVIEW_DISPUTES: no board for DisputeReview or ReviewDisputes yet', () => {
    expect(existsSync(BOARDS)).toBe(true);
    const names = readdirSync(BOARDS, { recursive: true }).map(String);
    expect(names.filter((n) => /dispute-?review|review-?dispute/i.test(n)), 'a review-dispute board landed: match the screens to it').toEqual([]);
  });
});
