// TRIPWIRES for Task 37 (trader-to-trader block). The routes that let one trader reach another
// are not all on the main line yet: Task 5's take, Task 20's chat routes and Plan 5's profile.
// (Task 20's chat routes call assertNotBlocked since 2026-10-30: NEEDS_TASK_20_BLOCK is retired
// as a tripwire and kept below as a permanent guard; apps/api/test/chat.test.ts "blocks (Task 37)"
// tests the behaviour.)
// Each must refuse a blocked pair through src/traders/blocks.ts. These checks read the local tree
// only: each fails when its route lands without the block check, and passes once it is wired.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const BLOCK_CHECK = /\b(assertNotBlocked|blockedEitherWay|blockedEitherWaySql|hasBlocked)\b/;

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const unchecked = (files: string[]): string[] => files.filter((f) => !BLOCK_CHECK.test(readFileSync(f, 'utf8'))).map((f) => f.slice(SRC.length));

describe('Task 37: every route between two traders checks the block', () => {
  it('NEEDS_TASK_5_BLOCK: the take refuses a blocked pair (either way) with 404 not-found', () => {
    // Task 5 (origin/wip/lead-p3-task5) builds POST /v1/offers/:id/take in trades/take.ts. Wire:
    // `await assertNotBlocked(client, takerId, offer.account_id)` inside the take's transaction,
    // before any other refusal that would tell the taker the offer exists (lead default
    // 2026-10-29: the blocker's take of the blocked person's offer is refused too, same 404).
    const takes = ['trades/take.ts', 'offers/take.ts'].map((f) => SRC + f).filter((f) => existsSync(f));
    expect(unchecked(takes), 'the take must call assertNotBlocked (traders/blocks.ts)').toEqual([]);
  });

  it('the chat routes refuse a blocked pair (permanent guard, round-2 review m2)', () => {
    // Every file of apps/api/src/chat/ that defines routes must go through the block check
    // (roleInChat → assertNotBlocked, POST /v1/chats, GET /v1/chats, POST /v1/trades/:code/chat):
    // a later chat route file that forgets it fails here.
    const routes = sources(SRC + 'chat').filter((f) => /routes/.test(f));
    expect(routes.length, 'apps/api/src/chat has its routes').toBeGreaterThan(0);
    expect(unchecked(routes), 'chat routes must call assertNotBlocked').toEqual([]);
  });

  it("NEEDS_PROFILE_BLOCK: a trader's profile answers 404 to someone the trader blocked", () => {
    // Plan 5's GET /v1/traders/:name (lead default 2026-10-29): `hasBlocked(q, trader, viewer)`
    // → 404 not-found for the blocked person, as for an unknown name. The blocker still sees the blocked person's profile (that is
    // where the web's Unblock is).
    // Any quote style, template literals too (review M5).
    const profiles = sources(SRC).filter((f) => /['"`]\/v1\/traders\//.test(readFileSync(f, 'utf8')));
    expect(unchecked(profiles), 'the profile route must check the block').toEqual([]);
  });
});
