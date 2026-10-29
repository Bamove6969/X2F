// TRIPWIRES for Task 37 (trader-to-trader block). The routes that let one trader reach another
// are not all on the main line yet: Task 5's take, Task 20's chat routes and Plan 5's profile.
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

  it('NEEDS_TASK_20_BLOCK: the chat routes refuse a blocked pair', () => {
    // Task 20's apps/api/src/chat/: opening a chat with someone (POST /v1/chats { offerId })
    // and posting to an existing one are refused with 404 not-found while either has blocked the
    // other (spec 2.4: "can't message you"). Proposed (Task 37 builder, the lead decides): the chat
    // of a trade already open stays usable, since the trade must finish (spec: open trades continue
    // to the end) and a moderator may need it; offer chats and new chats are stopped. Presence in the chat goes through traderSummaries.
    expect(unchecked(sources(SRC + 'chat')).filter((f) => /routes/.test(f)), 'chat routes must call assertNotBlocked').toEqual([]);
  });

  it("NEEDS_PROFILE_BLOCK: a trader's profile answers 404 to someone the trader blocked", () => {
    // Plan 5's GET /v1/traders/:name (lead default 2026-10-29): `hasBlocked(q, trader, viewer)`
    // → 404 not-found for the blocked person, as for an unknown name. The blocker still sees the blocked person's profile (that is
    // where the web's Unblock is).
    const profiles = sources(SRC).filter((f) => readFileSync(f, 'utf8').includes("'/v1/traders/"));
    expect(unchecked(profiles), 'the profile route must check the block').toEqual([]);
  });
});
