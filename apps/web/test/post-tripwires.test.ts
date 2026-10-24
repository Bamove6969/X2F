// TRIPWIRES for the API shapes PostOffer (Task 21) assumes before the API tasks are on the main
// line. src/screens/post/api.ts parses each response strictly, so a renamed or missing field also
// fails loudly at run time. Each tripwire fails once the real module lands: then check the real
// shape against src/screens/post/{api,offerForm}.ts and the stubs in e2e/post.spec.ts, fix any
// difference, and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 21 guesses still stand in for missing API routes', () => {
  it('NEEDS_TASK_4: the POST /v1/offers body and answer are guessed from the plan', () => {
    // Guessed (plan Task 4): POST /v1/offers { side; methodId; currency; pricing: { mode: 'market';
    // marginBps } | { mode: 'fixed'; centsPerXmr: string }; minFiatCents: string; maxFiatCents:
    // string; minTrades: 0|5|10|50; terms } → 2xx (the body is not read). Refusals shown as text:
    // trading-hold, trading-paused, method-unavailable; no-wallet goes to Add a wallet (client.ts);
    // 401 not-authenticated goes to setup. Also open: a gift-card offer must name the card's country
    // and currency (Revision 2026-10-21), and the body has no field for the country yet.
    expect(has('apps/api/src/offers/routes.ts'), 'Task 4 offers landed: check validate() and the POST stubs against it').toBe(false);
  });

  it('NEEDS_TASK_3: /v1/methods and /v1/price are taken from the unmerged Task 3 branch', () => {
    // From wip/second-p3-t3: GET /v1/methods?side&currency → { live; all: MethodRow[] }, MethodRow =
    // { id; name; group; giftCard; offers; bestRate } (unavailable methods already left out);
    // GET /v1/price?currency → { currency; centsPerXmr: string; exponent; at; usdCentsPerXmr: string },
    // 503 price-unavailable. POST_CURRENCIES copies the two-decimal codes of its CURRENCY_EXPONENTS.
    expect(has('apps/api/src/price/routes.ts'), 'Task 3 price landed: check parsePrice, parseMethods and POST_CURRENCIES').toBe(false);
  });

  it('NEEDS_TASK_28: logged out, PostOffer sends the user to /setup?returnTo=…', () => {
    // Task 28 (onboarding) must follow `returnTo` back to /post when setup finishes; the draft waits in
    // sessionStorage (x2f.post-draft) until then.
    expect(has('apps/web/src/screens/setup'), 'Task 28 setup landed: check it follows returnTo to /post').toBe(false);
  });
});
