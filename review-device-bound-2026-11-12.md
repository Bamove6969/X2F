# Review: `wip/lead-device-bound` c73a1e69 (S-085, device-bound sessions), security

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. I made no code edits and did not touch dockerd. Detached worktree `rv-devbound` at c73a1e69 (removed afterwards); base main 6ebed537. Two commits, 18 files, +1007/-11.

## Verdict: safe to merge with both flags off; CHANGES REQUIRED before either flag is turned on (2 must-fix)

With `X2F_DEVICE_BOUND_SESSIONS` off (the default), I found no path where the branch changes behaviour: the header is ignored, nothing is bound, `requireSession` checks nothing new, and both proof routes answer 404 before any session lookup.

With the flag on, the cryptography and the server-side binding are sound:
- binding happens only at session creation and is never changed;
- the challenge is single-use, short-lived and tied to the session row;
- the signature format is strict;
- the cookie flags are right.

The two must-fixes are both about the renewal logging a legitimate person out, not about a thief getting in:
- **MF1:** one challenge per session, so concurrent renewals (several tabs, or a thief) make the loser fail and the web treats that as a dead session.
- **MF2:** the web treats a network failure during renewal as a dead session.

Counts: 2 Must-fix, 5 Should-fix (S1-S5), 7 Info.

## Tests run (serialised runner, single files, at c73a1e69)

All passed:

| File | Tests |
|---|---|
| api `deviceBound.test.ts` | 9/9 |
| api `team.test.ts` | 70/70 |
| api `frontDoor.test.ts` | 21/21 |
| api `coolingOff.test.ts` | 95/95 |
| api `schema.test.ts` | 77/77 |
| web `deviceKey.test.ts` | 13/13 |

`tsc --noEmit` is clean for `apps/api` and `apps/web`.

Semgrep (p/typescript, p/javascript, p/security-audit; `--metrics=off`) ran on the 16 added or modified .ts files: **0 findings**. There were two engine errors, both on the test file `apps/api/test/team.test.ts`: a timeout of rule `raw-html-format`, and a partial parse at line 43. Nothing else was skipped.

What the tests do not cover: concurrent renewals (MF1), network failures during renewal (MF2), and real login paths (S4).

## Must-fix (before either flag is on)

### MF1. One outstanding challenge per session: concurrent renewals fail, and the web then logs the person out

`POST /v1/account/session/proof/challenge` overwrites `proof_challenge_hash` ("one at a time; a new one replaces the old"). `renewProof` de-duplicates only inside one tab (`inFlight` is module state). So with two tabs open:

1. tab A gets challenge cA;
2. tab B gets cB, which replaces cA;
3. A posts its signature over cA and gets 401 `proof-invalid`, so its result is `failed`;
4. in `api()` (client.ts), any result other than `renewed` calls `sessionGoneListener()`, and `authFetch` calls `goLogin()`. Tab A shows the login page although the session is alive and tab B just renewed the shared cookie.

This is not a rare race. After a laptop sleeps or a phone suspends for more than 10 minutes, every tab wakes with an expired bound cookie. Each tab's next request gets 401 `session-proof-required`, so they all renew at the same moment. If the person then logs in again from the losing tab, `openSession` revokes the presented session, and the other tabs drop too.

A thief who holds only a copied session cookie can cause the same thing on purpose. Both proof routes are `allowUnproven`, so one challenge request (or one garbage proof, which clears the challenge) makes the victim's next renewal fail, and that logs the victim out. They gain nothing else, but it is a free remote logout of the legitimate person.

Fix (both halves recommended):
- **Server:** stop being stateful on a single slot. Either keep a small set of outstanding challenges per session (for example the last 4, each single-use), or make the challenge stateless: `HMAC(server key, sessionId || expiry || nonce)`, with single-use enforced by a short used-nonce table.
- **Web:** serialise renewal across tabs with `navigator.locks.request('x2f-proof', ...)`, where available. When renewal comes back `failed`, retry the original request once, because another tab may have renewed the shared cookie meanwhile. Only a second `session-proof-required` should count as a gone session.
- **Tests:**
  - API: two challenges, then both proofs; both succeed, or the first stays valid.
  - Web: two concurrent `renewProof` across "tabs", where one is refused; `api()` must not call `sessionGoneListener` when a retry succeeds.

### MF2. A network failure during renewal is treated as a dead session

`renewOnce` maps every thrown error, and any non-OK status other than 401/404/409 (including 5xx and 429), to `failed`. The callers then treat `failed` as gone:
- `api()` calls `sessionGoneListener()`;
- `authFetch` calls `goLogin()`.

So one dropped request, a 502 during a deploy, or a rate limit on the challenge route signs the person out of a session that is still valid. That runs against the spec (§6), which reserves "gone" for `proof-invalid` and a persistent `session-proof-required`.

Fix: add a separate `retry-later` result for network errors, 5xx and 429.
- On `retry-later`, `api()` raises the original 401 as a normal error, or a network error, and does **not** end the session.
- The timer's next tick, or the person's next action, renews again.
- Keep `gone` for `not-authenticated`, and for `proof-invalid` only after the MF1 retry.

Add a web test for each case.

## Should-fix

**S1. The signed message does not name the session.** It is the UTF-8 of `x2f-session-proof-v1:` + challenge. A cross-session replay is not possible today, because the challenge is 32 random bytes whose hash lives only on that session's row. But one device key signs for every session the profile ever opens, and the wire format is hard to change once deployed. Recommendation: before flag-on, sign `x2f-session-proof-v1\n<origin>\n<sessionId or its public id>\n<challenge>`, with the challenge route returning what to sign. This is cheap defence in depth, and it protects the format against a future change that makes challenges stateless (MF1).

**S2. No rate limit on the proof routes.** The challenge route is a row write per call, and both routes are reachable by anyone holding a session cookie, bound or not. A verify runs only when the challenge hash matches, so CPU cost is bounded. Add a small per-session budget, such as the existing `budgets` pattern. Make sure that hitting it maps to `retry-later` on the web (MF2), not to a logout.

**S3. Sessions that existed before the flag is turned on stay unbound for the rest of their life.** `requireSession` only checks `bound_key is not null`, and no route binds later (correctly so). Every session opened before flag-on therefore keeps today's bearer-only protection until it expires, which can be longer than 12 h with "Stay logged in". This is the same exposure as owner question §8.1 (a browser with no key), but it is not mentioned there. Decide and document it: either accept it, or revoke the unbound trader sessions at flag-on, which logs everyone out once.

**S4. Real login paths are not tested.** `deviceBound.test.ts` binds through the test helper route `/t/login`. Nothing exercises the header through password, PGP, WebAuthn, recovery-code, team-member, team-join or device-approval-poll logins. These all reach `openSession`, so they should work, but the approval poll in particular (approval.ts:256/456) opens the session in a later request from the new device. Add one test per path, at least approval poll and team member. Also add a test that a staff login's header is ignored (`sessionKeyOf(req, 'staff')`).

**S5. A malformed header after the login factor was spent.** `sessionKeyOf` runs inside `openSession`, after the login proof was checked. Where the login runs in one transaction, the 400 rolls the spend back, which is fine. Where a flow commits part of its work before refusing (approval.ts commits a `refused` outcome's earlier work, by design), a client bug could burn a code or an approval. Validate `X2F-Session-Key` at the top of each login route, before any factor is consumed. A shared `preValidation` hook would do it.

## Answers to the brief

1. **Bind first, rebind, unbind.**
   - **Bind first:** not possible. `bound_key` is written only by the `insert into sessions` in `openSession`, which is the only session insert in `src`, and it comes from the same request that proved the login. Nobody can attach a key to someone else's session.
   - **Rebind and unbind:** no route updates `bound_key`. `rotateSessionToken` keeps the row, so the binding survives "Stay logged in", and so does the `prev_token_hash` window, because the check is on the row.
   - A login that presents an old cookie revokes that session and starts a new one bound to the new header, which is correct.
   - The only way to get an unbound session with the flag on is to log in without the header. That is a fresh login, so it needs the login factors, apart from S3.
   - Residual, out of scope by the spec: code running in the page *at login* could send its own extractable public key and so own the session from anywhere. Worth one line in §2.
2. **Challenge replay or unbound challenge.**
   - It cannot be replayed. The proof reads and clears the challenge in one statement under `for update`, so any answer, right or wrong, uses it up (tested). It expires after 2 minutes, with `now < until` checked.
   - It is tied to the session: the hash lives on `req.auth.sessionId`'s row, and the proof route reads only that row.
   - The weaknesses are MF1 (one slot) and S1 (the session is not in the signed bytes).
3. **Signature format: strict.**
   - The key must be SPKI DER, 26-200 bytes, that Node parses as EC with `namedCurve === 'prime256v1'`. P-384 is refused at login (tested). It is re-exported canonically before it is stored, and checked again at verify time.
   - The signature must be exactly 86 base64url characters, which is 64 bytes, and is verified as `dsaEncoding: 'ieee-p1363'`. A DER signature (70-72 bytes) fails the regex with 400.
   - The hash is SHA-256, and the message is the exact UTF-8 bytes of the context string plus the challenge string as issued.
   - ECDSA's (r, n-s) malleability and non-canonical trailing base64 bits are harmless, because the challenge is single-use.
   - The session id is **not** in the message (S1).
4. **Cookie flags: correct.** `__Host-x2f_bound` uses `COOKIE_ATTRS`: `httpOnly`, `secure`, `sameSite: 'strict'`, `path: '/'`, no `Domain`. That meets the `__Host-` prefix rules. `maxAge` is 600 s, equal to `BOUND_TTL_MS`. The value is 32 random bytes; only its SHA-256 is stored, and it is compared with `timingSafeEqual` after a strict 43-character format check. Logout clears the session cookie but leaves the bound cookie (Info). It is useless without the row, and dies in 10 minutes.
5. **Clocks and expiry: safe.**
   - All deadlines are the server's own (`deps.clock`), both written and checked. The browser's clock plays no part, because the cookie uses a relative `maxAge`.
   - The comparisons are `now >= bound_until` → refuse and `now < challenge_until` → accept, both tested at the boundary.
   - The refresh timer runs at a third of the TTL (200 s), which leaves two retries' margin. Background-tab throttling and suspension are covered by the 401 → renew → retry path, apart from MF1 and MF2.
   - Renewal uses `touch: false` and never moves `expires_at` or `last_seen_at`, so the timer cannot keep an idle session alive. Good.
6. **`allowUnproven`.** Exactly one place: the `requireSession(...)` built in `deviceBoundRoutes`, used only by the two proof routes. I grepped all of `apps/api/src`: the option is read once, in `sessions.ts:441`. Every other check still applies on those routes: expiry, idle, member liveness, `app`, disabled.
7. **Logout and staff.**
   - `logoutRoute` reads only the session cookie and does not use `requireSession`, so a browser that lost its key can always log out (tested). A thief with a copied cookie can also log the victim out, but that is true today too.
   - Staff: `sessionKeyOf` returns null for `realm.app === 'staff'`, so staff rows are never bound, and the trader API refuses a staff session on `app` before the bound check. The proof routes exist only on the trader API.
8. **Flag off disables everything new.** `sessionKeyOf` returns null before reading the header, so no 400 for a bad header either. The `requireSession` check is `row.bound && boundSessionsOn(...)`, so sessions bound while the flag was on work again with only the session cookie (tested: the kill switch). `flagGate` answers 404 on both routes before the session preHandler. The only leftover is data: bound columns stay filled, and turning the flag back on enforces them again. That is fine while the web flag is on and the key still exists. The flag is read from config at start, so the kill switch needs a restart or redeploy (Info).
9. **The team.test exemptions are correct, not a weakening.** They are entries in the "audit log covers every member action" map. Both routes act only on `req.auth.sessionId`'s row: they write the challenge hash, or the bound-cookie hash and end. They change nothing of the team account, so there is nothing to audit. The parallel entries in `OWN_DATA_WRITES` (frontDoor.ts) and `LIVE_SESSION_EXEMPT` (hold.ts) are accurate as well; "never extends the session" is true because of `touch: false`. `member: 'any'`, `allowRecovery`, `allowHeld` and `allowStaleTerms` are all needed, because without them those sessions would hit `session-proof-required` on the routes they are allowed and could never renew. The `schema.test` change only appends `570_device_bound_sessions.sql` to the three migration lists.
10. **Web renew-and-retry.**
    - **No loop.** `api()` and `authFetch` each renew at most once and retry at most once. `renewProof` uses raw `fetch`, not `api()`, so it cannot recurse. `/v1/account/me` is spared the gone-listener, which avoids a bounce loop with `useSession`. `goLogin` is a no-op on `/login`. `/v1/events` reconnects with its existing 1 s → 60 s backoff, and does not renew.
    - **Retrying the request is safe:** the first attempt was refused in `requireSession`, before any handler ran.
    - **Leaks:** the header carries only the public SPKI, on same-origin auth-client POSTs. No secret is logged or stored outside IndexedDB, and the private key is non-extractable (tested).
    - **Privacy (Info):** the public key is one stable value per browser profile, sent with every login and stored raw in `sessions.bound_key`. A database reader can link the different accounts used from one browser. That is the same linkage the device cookie already allows, and session rows are deleted once they expire, or an hour after they are revoked (challenges.ts:86). Mention it in the spec's §4.
    - **Defects:** MF1 and MF2.

## Info

- Logout does not clear `__Host-x2f_bound` (harmless; clear it for tidiness).
- An already-open `GET /v1/events` stream is not cut when its bound cookie expires, so it lives up to `MAX_STREAM_MS` (10 min). For a thief who copied both cookies, that is at most about 20 minutes in total, which is within the spec's intent.
- The challenge route's 409 `not-bound` versus a challenge tells a cookie holder whether the session is bound. That is negligible.
- The web: every tab runs its own 200 s timer against the shared cookie, which is wasteful with many tabs. The MF1 lock fixes that too.
- `api()` and the auth client retry with the same `init`. Bodies are strings, so they are reusable. A future streamed body would not be.
- Spec §2 could add the "page code at login can bind its own key" residual (answer 1).
- The migration's `octet_length` check (26-200) matches `sessionKeyOf`.
