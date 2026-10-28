// TRIPWIRES for the API shapes PostOffer (Task 21) assumes before the API tasks are on the main
// line. (Task 3's GET /v1/methods and GET /v1/price are on the line since 2026-10-26 and were checked
// against src/screens/post/api.ts on 2026-10-27: same fields, string bigints, 503 price-unavailable,
// and the 39 two-decimal currencies of CURRENCY_EXPONENTS match the parsers; its tripwire is retired.
// Task 4's POST /v1/offers landed 2026-10-28 and was checked against validate() and the e2e stubs: the
// same body, 201 { id }, `country` required on gift-card methods and refused on others (400), terms up
// to 4000 characters, amounts up to 14 digits of minor units, margins up to ±50% (the form keeps ±10%),
// refusals 409 trading-hold, trading-paused, method-unavailable, no-wallet; its tripwire is retired.)
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
  it('NEEDS_TASK_28: logged out, PostOffer sends the user to /setup?returnTo=…', () => {
    // Task 28 (onboarding) must follow `returnTo` back to /post when setup finishes; the draft waits in
    // sessionStorage (x2f.post-draft) until then.
    expect(has('apps/web/src/screens/setup'), 'Task 28 setup landed: check it follows returnTo to /post').toBe(false);
  });
});
