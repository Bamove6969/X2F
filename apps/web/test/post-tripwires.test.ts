// TRIPWIRES for the API shapes PostOffer (Task 21) assumes before the API tasks are on the main
// line. (Task 3's GET /v1/methods and GET /v1/price are on the line since 2026-10-26 and were checked
// against src/screens/post/api.ts on 2026-10-27: same fields, string bigints, 503 price-unavailable,
// and the 39 two-decimal currencies of CURRENCY_EXPONENTS match the parsers; its tripwire is retired.)
// src/screens/post/api.ts parses each response strictly, so a renamed or missing field also fails
// loudly at run time. Each tripwire fails once the real module lands: then check the real shape
// against src/screens/post/{api,offerForm}.ts and the stubs in e2e/post.spec.ts, fix any
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
    // string; minTrades: 0|5|10|50; terms; country? } → 2xx (the body is not read). `country` (ISO
    // 3166-1 alpha-2, the same field name as POST /v1/method-suggestions) is sent only for a
    // gift-card method, which must name the card's country (Revision 2026-10-21; plan Task 4
    // Revision 2026-10-27: the API refuses a gift-card offer without it). Refusals shown as text:
    // trading-hold, trading-paused, method-unavailable; no-wallet goes to Add a wallet (client.ts);
    // 401 not-authenticated goes to setup.
    expect(has('apps/api/src/offers/routes.ts'), 'Task 4 offers landed: check validate() and the POST stubs against it').toBe(false);
  });

  it('NEEDS_TASK_28: logged out, PostOffer sends the user to /setup?returnTo=…', () => {
    // Task 28 (onboarding) must follow `returnTo` back to /post when setup finishes; the draft waits in
    // sessionStorage (x2f.post-draft) until then.
    expect(has('apps/web/src/screens/setup'), 'Task 28 setup landed: check it follows returnTo to /post').toBe(false);
  });
});
