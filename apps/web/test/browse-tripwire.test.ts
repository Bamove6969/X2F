// TRIPWIRES for the API shapes the browse screens (Task 16) assume before the API tasks are on the
// line. (Task 3's /v1/methods, /v1/price and /v1/method-suggestions are on the line since
// 2026-10-26 and were checked against api.ts: same fields, sorts and 202; its tripwire is retired. Task 4's
// GET /v1/offers (apps/api/src/offers/routes.ts) and TraderSummary.stage (apps/api/src/traders/summary.ts)
// landed 2026-10-28 and were checked against parseOffers and parsePoster: same fields, `side` is the ads'
// own side, bigints as decimal strings, `opensAt` only for a signed-in trader, `country` only on
// gift-card offers (not read here); their tripwires are retired.) src/screens/browse/api.ts parses each response strictly, so a field that is renamed or
// missing fails loudly at run time too. Each tripwire below fails once the real module lands: then
// check the real shape against api.ts (and the Playwright stubs in e2e/browse-sell.spec.ts, which
// use the src/fixtures/boards.ts shapes), fix any difference, and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 16 guesses still stand in for missing API routes', () => {
  it('NEEDS_PLAN_5: the badge ids on TraderSummary.badges are guessed', () => {
    // Guessed ids: trusted, fast, veteran, pgp, security-key, clean-record, trades-10/50/100/500/1000.
    // Unknown ids are left off the card.
    expect(has('apps/api/src/traders/badges.ts'), 'Plan 5 badges landed: check the ids in OfferCard BADGES').toBe(false);
  });
});
