// TRIPWIRES for the API shapes the browse screens (Task 16) assume before the API tasks are on the
// line. (Task 3's /v1/methods, /v1/price and /v1/method-suggestions are on the line since
// 2026-10-26 and were checked against api.ts: same fields, sorts and 202; its tripwire is retired.) src/screens/browse/api.ts parses each response strictly, so a field that is renamed or
// missing fails loudly at run time too. Each tripwire below fails once the real module lands: then
// check the real shape against api.ts (and the Playwright stubs in e2e/browse-sell.spec.ts, which
// use the src/fixtures/boards.ts shapes), fix any difference, and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 16 guesses still stand in for missing API routes', () => {
  it('NEEDS_TASK_4: the OfferCard fields parseOffers reads are guessed', () => {
    // Guessed (plan Task 4 + Revision 2026-10-24): GET /v1/offers?side&method&currency&sort=best|online|trades
    // → OfferCard[] = { id; poster: TraderSummary; rate: string | null; pricing: { mode: 'market'; marginBps } |
    // { mode: 'fixed'; centsPerXmr: string }; minFiatCents: string; maxFiatCents: string; minTrades: number;
    // opensAt?: 'building' | 'graduated' }, `side` being the ads' own side.
    expect(has('apps/api/src/offers/routes.ts'), 'Task 4 offers landed: check OfferCard (opensAt, bigint strings, side) against parseOffers').toBe(false);
  });

  it("NEEDS_TASK_4: TraderSummary.stage (the New badge) is guessed", () => {
    // Guessed: TraderSummary = { displayName (FU-A); completedTrades; online; lastSeenAt: string | null;
    // typicalMinutes: number | null; positivePct: number | null; badges: string[];
    // stage: 'starter' | 'building' | 'graduated' }. The New badge shows while stage !== 'graduated'.
    expect(has('apps/api/src/traders/summary.ts'), "Task 4 summary landed: check the poster's stage field name and values against parsePoster").toBe(false);
  });

  it('NEEDS_PLAN_5: the badge ids on TraderSummary.badges are guessed', () => {
    // Guessed ids: trusted, fast, veteran, pgp, security-key, clean-record, trades-10/50/100/500/1000.
    // Unknown ids are left off the card.
    expect(has('apps/api/src/traders/badges.ts'), 'Plan 5 badges landed: check the ids in OfferCard BADGES').toBe(false);
  });
});
