// TRIPWIRE (C12b, owner 2026-11-02 via the lead): the opt-in "traded to date" line must include
// PROVEN volume imported from other sites: only moderator-verified past-reputation claims, never
// unverified ones. Past reputation is Plan 5 Task 10 (migration 304_past_reputation.sql, not on
// this tree), and as built it stores trade COUNTS, not a dollar figure, so the imported part is 0
// (account_traded_totals.imported_verified_usd_cents, never written yet). Checks the local tree
// only: it fails once 304 is here WITH a USD figure while apps/api/src/traders/tradedTotal.ts does
// not read past reputation; then add the verified figure to imported_verified_usd_cents when a
// moderator approves a claim (status approved only) and delete this file.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : '');

describe('the traded total includes verified imported volume once Task 10/11 provide it', () => {
  it('NEEDS_P5_T10_VERIFIED_VOLUME: tradedTotal.ts reads past reputation once 304 has a USD figure', () => {
    const pastRep = read('apps/api/migrations/304_past_reputation.sql');
    const hasUsd = /usd|cents|volume/i.test(pastRep);
    const totals = read('apps/api/src/traders/tradedTotal.ts');
    expect(totals).toMatch(/imported_verified_usd_cents/);
    expect(!hasUsd || /past_rep/.test(totals), 'Task 10/11 landed a verified USD figure: feed it into imported_verified_usd_cents').toBe(true);
  });
});
