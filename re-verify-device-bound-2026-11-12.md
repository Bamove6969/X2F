# Re-verify: `wip/lead-device-bound` f2e037be against review-device-bound-2026-11-12 (MF1, MF2, S1, S2, S4, S5)

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. Read-only on code.
- Detached worktree `rv-dbv` at f2e037be (one commit on c73a1e69, 13 files, +872/-104), fresh `npm ci`, removed afterwards.
- dockerd was not restarted.
- One temporary probe test was added to the worktree and reverted, never committed.
- S3 is left for the owner, as the commit says.
- Migration 570 was edited in place. That's fine, since the branch is unmerged: `schema.test` passes, and `git grep proof_challenge` finds nothing left in `apps/`.

## Verdict: CHANGES REQUIRED before either flag is turned on. With both flags off, it is still safe to merge.

The items the review asked for are fixed at their cause: MF2, S1, S2, S4, S5, and the challenge half of MF1. The stateless challenge is sound. But the multi-tab renewal race is only half closed:
- **R1 (must-fix):** each renewal still replaces the shared bound cookie, and the previous one dies at once. A tab whose request or retry was sent with it gets `session-proof-required`, and a second one is a logout. This is MF1's failure mode one layer down, proved with a probe.
- **R2 (should-fix):** the new per-session budget is shared with whoever holds a copied session cookie. A cookie thief can keep the victim's renewals at 429. With MF2 that is no longer a logout, but the victim's session then fails like the network for as long as the thief keeps spending.

| Item | Fixed at cause | Red on c73a1e69 | Notes |
|---|---|---|---|
| MF1 challenge slot | yes (stateless HMAC + nonce table) | yes | the cookie-rotation half remains: R1 |
| MF1 web (lock, retry once) | yes | yes | but see R1 |
| MF2 retry-later | yes | yes | cannot mask a real logout (checked); R2 |
| S1 v2 message | yes | yes | origin and session checked server-side |
| S2 budget | yes | yes | R2 |
| S4 real login paths | tests only | already green on the old code (coverage) | all paths covered |
| S5 header first | yes (`onRequest` hook) | yes (password-route ordering test) | the recovery and approval "not spent" tests were already green on the old code (regression guards) |

## The stateless challenge (MF1, server): sound
- **Format:** `nonce(16) || until_ms(8, big-endian) || HMAC-SHA-256(32)`, base64url, exactly 75 characters, refused by regex and by length first.
  - The MAC is `HMAC(subkey(config, 'session-proof'), "x2f-proof-challenge-v1\0" || sessionId || "\0" || nonce || until)`.
  - The subkey is HKDF from `X2F_SERVER_KEY` with its own label, so it is separate from every other subkey.
  - It is compared with `timingSafeEqual` over equal 32-byte buffers.
- **Bound to the session id:** the session id is inside the MAC, and the proof route opens the challenge against `req.auth.sessionId` only. Tested: a challenge from session one, sent on session two or signed over session two's id, is refused.
- **Expiry:** `until` is inside the MAC, so it can't be changed. It is checked as `now < until` on the server's clock, with `PROOF_CHALLENGE_TTL_MS` of 2 min.
- **Single use, recorded before the signature is checked:** once the MAC and expiry pass, `insert into session_proof_nonces ... on conflict (nonce) do nothing` runs *before* the key is read and the signature verified. Zero rows means 401 `proof-invalid`.
  - So any answer, right or wrong, uses the challenge up, and two simultaneous answers to one challenge can't both pass: the primary key decides.
  - A thief can't spoil the victim's challenge, because they never see its nonce. Requesting their own challenges writes nothing.
  - Tested: several outstanding challenges, answered out of order, each once; and a thief's garbage leaves the victim's renewal working.
- **Cleanup:** each proof deletes this session's expired nonces, and the rows cascade with the session. That is bounded by the budget.

## S1, the v2 signed message: right
- The message is `x2f-session-proof-v2\n<origin>\n<session id>\n<challenge>`. The server builds it from **its own** values: `requestOrigin(req).origin`, which is the checked `Origin` header matched against the configured origins (403 otherwise), `req.auth.sessionId`, and the challenge.
- None of the fields can contain a newline (a URL origin, a UUID, base64url), so the encoding is unambiguous.
- The v1 context prefix differs, so a v1 signature never verifies as v2 (tested).
- The web signs only a 75-character challenge and a lower-case UUID session, and refuses an empty or `"null"` `location.origin`. Tested: a wrong origin, a wrong session id, or v1 bytes are refused.
- `new URL(x).origin` on the server and `location.origin` in the browser serialise the same way: no trailing slash, default port dropped. A browser on any configured origin (clearnet or onion) signs that origin.
- Info: the challenge route now tells the client its session row id. That's harmless, since the session list routes already expose session ids to their owner.

## MF2 and "retry-later can never mask a real logout": holds
- `renewOnce` gives `retry-later` for a thrown fetch, a 5xx, a 429, or an unreadable challenge body. `renewProof` maps a lock error to `retry-later` too.
- `api()` and `authFetch` then throw a network-style `TypeError` and do not call the gone listener or `goLogin` (tested for both).
- A real end can't hide behind it, because of `requireSession`'s order. A revoked or expired session, an app mismatch, and a dead member all get **401 `not-authenticated`** *before* the bound-cookie check (`sessions.ts`, the bound check comes after those). So a dead session never reaches renewal. It gets the ordinary 401 path, which ends the session as before.
- On the proof routes, the session preHandler runs before the budget, so a dead session gets 401 `not-authenticated` there (and `gone` on the web), never 429.
- `gone` is kept for `not-authenticated`, and a second `session-proof-required` after the one retry also ends the session (tested).
- Info: a bound session on a *disabled* account (for example a J-14 lock) gets `session-proof-required` before `account-disabled`. Its renewal then answers 403, which is `failed`, then a retry, then a second `session-proof-required`, then logout. So the person sees the login page rather than "account disabled". That's UX only; the order of the two checks in `requireSession` could swap.

## Web Lock and the fallback
- `withProofLock` uses `navigator.locks.request('x2f-proof', { mode: 'exclusive' }, fn)`. Where there is no `navigator.locks`, it runs `fn` directly. Within one tab, `inFlight` still shares one attempt.
- With stateless challenges, unserialised renewals no longer refuse each other, so the fallback is correct: it just isn't serialised. Every current browser has Web Locks; Safari since 15.4.
- Tested with an injected lock: two module instances ("tabs") give `[challenge, proof, challenge, proof]`, not interleaved.
- But each tab still renews in turn. Nothing skips a renewal that another tab has just done. That feeds R1.

## R1 (Must-fix before flag-on): every renewal kills the bound cookie other tabs are using
`issueBoundCookie` overwrites `bound_token_hash`. The previous bound cookie is refused from that moment, although its own `bound_until` is minutes away. The browser's cookie jar is shared by every tab, so:
- tab A's request (or tab A's one retry after its own renewal) sent with cookie X, and
- tab B's renewal (from its own 200 s timer, or from its turn under the lock right after A's) replacing X with Y,

leave A's request with 401 `session-proof-required`. On A's *retry*, that is the second one, so `api()` calls the gone listener and `authFetch` calls `goLogin()`, and the person is logged out of a live session. The lock makes this *more* likely right after a wake-up: B renews the moment A releases the lock, which is exactly when A sends its retry.

**Proved** with a temporary API test at f2e037be (`deviceBound.test.ts`, reverted afterwards):
1. log in bound;
2. advance 60 s;
3. tab A copies the jar, and its `me` succeeds;
4. tab B renews (`prove(jar, key)` → 200);
5. tab A's `me` with the cookie it holds gives **`401 session-proof-required`**.

The run printed `PROBE old-cookie-after-other-renew: 401 session-proof-required` and passed. The web tests can't see this: their fake proof server doesn't model the cookie being replaced.

Every rotation also makes other tabs' in-flight requests renew again, which spends the R2 budget faster. In steady state, N tabs rotate the cookie every 200/N s.

**Fix (cause first):**
1. **Server:** keep the previous bound token valid for a short overlap after a renewal. Keep `bound_prev_hash` until `min(its own bound_until, now + 30-60 s)`, which is the same idea as the session token's `prev_token_hash`. A copied cookie still dies within `BOUND_TTL_MS`.
2. **Web, also worth doing:** inside the lock, skip the renewal when another tab renewed recently. Share `boundUntil` through `localStorage` or a `BroadcastChannel`, renew only when less than a third is left, and let the waiting tabs just retry their request.
3. **Test:** the probe above, flipped to expect 200 for the previous cookie within the overlap and 401 after it. Plus a web test where the retry meets a cookie rotated by another tab.

## R2 (Should-fix before flag-on): a cookie thief can drain the victim's proof budget
`budgets.sessionProof` is keyed by `req.auth.sessionId`, and both proof routes are `allowUnproven`. So anyone holding a copied **session** cookie, with no key and no bound cookie, which is exactly the attacker device binding is for, can spend the bucket (20, then 10 a minute). The victim's renewals then get 429, which is `retry-later`. MF2 correctly stops that being a logout. But for as long as the thief keeps spending, every request the victim makes after the bound cookie expires fails like the network, and nothing tells the victim to log in again (which would give a new session and a new budget).
- Before the fix the same thief could force a logout. Now they can keep the session unusable, which is arguably worse because it is silent.

**Fix:** never let a valid proof be refused by the budget.
- Charge the strict budget only to **refused** proofs (bad signature, used or foreign challenge).
- Give the challenge route a generous separate cap. It writes nothing now, so it's cheap.
- A thief can't make a valid signature, so the victim's valid proof always goes through.
- **Test:** the budget is spent by refused proofs, and a valid proof still renews.

## S2, S4, S5 as fixed
- **S2:** `SESSION_PROOF_BUCKET` is `{ capacity: 20, perMinute: 10 }`, taken after the session check on both routes. 429 `slow-down` is tested, and another session has its own bucket (tested). See R2 for who shares it.
- **S4:** `deviceBoundLogins.test.ts` binds through password sign-up, password plus code, team member (PGP pair), device-approval poll, recovery code, PGP, and passkey sign-up and login. `staff/deviceBound.test.ts` shows that staff ignore the header, valid or malformed.
- **S5:** `sessionKeyHook` is an `onRequest` hook on the trader API, after `originHook` and before maintenance, body parsing or any route. A present, malformed `X2F-Session-Key` is 400 before any factor is checked; flag off, it is not read. The staff API doesn't register it.
  - The red pin is `deviceBound.test.ts` "S5": a bad header on `/v1/login/password` gave 401 (the factor was checked) on the old code and gives 400 now.
  - The recovery-code and approval-poll "nothing spent" tests already passed on the old code. Those paths roll back in one transaction, so my S5 worry was theoretical for them. They are good regression guards, not red pins.

## Tests run (serialised runner)

| Run | Result |
|---|---|
| At f2e037be, `apps/api`: `deviceBound`, `deviceBoundLogins`, `staff/deviceBound`, `team`, `frontDoor`, `coolingOff`, `schema` | 289/289 passed (7 files), the R1 probe included |
| At f2e037be, `apps/web`: `deviceKey` | 21/21 passed |
| At f2e037be, `tsc --noEmit` for `apps/api` and `apps/web` | clean |
| RED: f2e037be's tests on c73a1e69's code, `apps/api` | `deviceBound` 8 failed (MF1 ×3, S1, S2, S5, plus two existing tests now signing v2); `deviceBoundLogins` and `staff/deviceBound` passed (coverage of existing behaviour); 8 failed, 17 passed overall |
| RED: f2e037be's tests on c73a1e69's code, `apps/web` | `deviceKey`: most fail on the missing `setProofLock`, plus v1-vs-v2, failed-vs-retry-later, and the gone-after-retry counts |

Not run: the rest of the suites, Playwright, `npm run check`.
