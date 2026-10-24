# Plan 2 security review (accounts and login)

Date: 2026-10-23. Scope: everything Plan 2 built on `origin/claude/compassionate-johnson-k95ssr` @6fe1dfe: `packages/accounts`, `packages/auth-client`, `apps/api` (`src/auth`, `src/routes`, `src/wallets`, `src/static`, migrations, config, retention, throttle, logging), `tools/leaked`, dependency pins and `.npmrc`. Tasks 1–12 and 14 (Task 13 was skipped).

This is an in-house review. It does not replace the external code and cryptography audit and the penetration test the spec requires before launch (spec 6.5). It is meant as part of the starting brief for those auditors.

## How it was reviewed

1. **Claude Security scan: not run.** The `claude-security` orchestrator cannot scan from inside a subagent (its own instructions say so), and this review ran as one. In its place, a manual pass over the same classes (injection, authorization, crypto, timing and enumeration, secrets, logging, races), reading every file under `apps/api/src` (auth, routes, wallets, static, config, limits, retention, alerts), the migrations, `packages/accounts/src`, `packages/auth-client/src/api.ts` and `confirm.ts`, `tools/leaked`, `.npmrc`, every `package.json` and the lockfile. **Not read line by line:** `packages/auth-client/src/webauthn.ts` (browser ceremony wrappers), `apps/api/src/db/migrate.ts`, and the test files other than the ones named below. The lead should still run the plugin from the main session (`/claude-security` over the four paths) before calling Plan 2 closed.
2. **OWASP ASVS 4.0 Level 3, chapters V2, V3 and V4**, walked requirement by requirement (table below).
3. **The five Review Focus scenarios** and the **Task 10 owner/staff login**, checked against the code and the existing tests that own them (`pgp.test.ts` "binding", "login", "review fixes"; `methods.test.ts` two-factor, minimums and parallel-removal tests; `confirm.test.ts`; `wallets.test.ts`; `throttle.test.ts`; `sessions.test.ts`). I did not rewrite those proofs; I looked for gaps in them and tried to break the code. The full check (below) runs them all.
4. **Runnable proofs** for the new findings are in `apps/api/test/security-review.test.ts`.
5. **Dependencies:** `npm audit --omit=dev` (one LOW, the accepted fastify advisory, R31), exact pins, lockfile sources and integrity, `ignore-scripts`.

## Findings from this review and what was done

Ranked. No Critical findings. "Test" is a case in `apps/api/test/security-review.test.ts` unless stated.

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | **Important** (proven) | **One anonymous client can stop every login and sign-up.** `START_BUCKET` (120 a minute) and `REGISTER_BUCKET` (20 a minute) in `apps/api/src/limits.ts:65-84` are per process. Every login `start` and `finish` (PGP, WebAuthn, password, TOTP second factor, backup), every `register/*/start` and `register/*/finish` takes one (`password.ts:117,152`, `pgp.ts:547,557,675,695`, `webauthn.ts:464,513,585,604`, `totp.ts:267`, `recovery.ts:91`). A script posting 2 junk requests a second to `POST /v1/login/webauthn/start` empties the bucket, and every real login, including the owner's security-key start, answers 503 `busy`. This breaks Review Focus 2 ("the owner's login still succeeds") at the availability level. The bucket exists to protect Argon2 and RSA work, and it cannot tell a flooder from anyone else because the API stores no IPs (R5). The same shape as Plan 1 finding 2. | **Not fixed in code; residual.** Needs a per-source limit in the front proxy / onion service (Plan 6, now on the roadmap), which is where IPs may be seen and dropped. Test `F1` (named "KNOWN DoS, not intended") only records the in-process behaviour; the proof that F1 is fixed belongs in a test that goes through the proxy, not in this app's tests. Owner question 1 asks whether to also change the budget design. |
| F5 | **Important** (reasoned from code and the existing test "challenge DoS", not re-run) | **Anyone can lock PGP login from a browser the account does not know.** `assertStartAllowed` (`pgp.ts`, `START_WINDOW_MS`, `STARTS_PER_WINDOW = 5`) counts every untrusted browser of a username as one group, `anon`. Five starts for a public username in 5 minutes make the 6th, from the real person on a new browser, answer 429 `slow-down`; and `issuePgpChallenge` keeps at most 3 open `anon` challenges per account, so three more starts push the real person's open challenge out. A browser already trusted for the account is unaffected, and so are passkeys and security keys. People whose browser forgets cookies on every visit (Tor Browser, Tails, private windows) are always "new". For the owner, whose login is a security key plus PGP, the PGP leg from a fresh browser can be held shut by one request a minute. It is a deliberate trade-off (P2-I3 "slow-down only", I1: made-up cookies must not dodge the limit), so it is not a bug against the plan. | **Accepted for now; owner question 2.** No code change: any fix either lets cookie-less floods past the limit or gives up the limit. |
| F2 | Minor (proven) | **`GET /v1/account/me` showed the 24-hour wait as on after a scheduled switch-off had taken effect.** It returned the raw columns (`payout_wait`, `payout_wait_off_at`) while the wallet routes use `payoutWaitActive`. After the 24 hours the person was told the wait still applied while new wallets were usable at once. A false sense of protection. | **Fixed** (`routes/account.ts`, `me.payoutWait` is `payoutWaitState(row, now)`, the function Task 12 wrote for this). Test `F2`. |
| F3 | Minor (proven) | **No `Cache-Control` on API answers.** Confirm tokens, recovery codes, the TOTP secret, login challenges and account lists went out with no instruction against storing them (ASVS V3 / 8.2 hygiene). | **Fixed** (`app.ts` `onRequest` hook: `cache-control: no-store` on every answer to a `/v1/` path, whether spelled plainly or with percent-escapes such as `/%761/`, and on every matched `/v1/` route; early replies such as a wrong Origin or malformed JSON, and 204 answers, are covered). Test `F3`. |
| F4 | Minor (proven) | **Look-alike names the rules do not catch.** `adm1n.team`, `Moderat0r`, `supp0rt` pass the reserved-word rule; `Ilya.k` and `llya.k`, `Alice.b` and `A1ice.b` are different accounts that read alike. Case, non-ASCII and the listed words are covered (Review Focus 4 as written); digits and I/l are not. Folding them trades scam protection against refusing real names (`m0nero`, `Jo1`), and the moderator badge (Plan 4, R4) will mark real staff. | **Not changed; owner question 3.** Test `F4` pins today's rule. |
| F6 | Minor (reasoned) | **A payout wallet can be removed with no confirm and no alert** (`wallets/routes.ts` `removeHandler`; `AlertKind` has no `wallet-removed`). The reasoning is sound that removal cannot redirect money, but a stolen session can silently empty the wallet list before the person trades. | **Not changed; owner question 4** (a product choice about alerts and the Plan 3 wording). |
| F7 | Minor (reasoned) | **A signed-in session can start unlimited confirm / add-key PGP challenges** (`/v1/confirm/pgp/start`, `/v1/account/pgp/start`: RSA-capable encryption plus a row each, not behind a budget or throttle). Only the session's holder can do it; rows go after an hour. A stolen session can use CPU and rows, nothing more. | **Accepted.** Revisit with the per-source limit (F1). |
| F8 | Minor (reasoned) | **A device that completes a TOTP-only backup login becomes "trusted" for the account** (`startSession` calls `trustDevice` for every level), so it gets its own password-throttle streak. The holder already passed a TOTP check, so the gain is small. | **Accepted.** |
| F9 | Minor (noted by the lead) | `hasBackup` counts every stored PGP key, including expired or revoked ones (`routes/account.ts`). A person can be told they have a backup when that key can no longer log in. | **Left for Plan 3's Security screen**, which decides the wording; consider counting only usable keys. |
| F10 | Minor | Doc nit: the `retryAfterSeconds` comment in `packages/auth-client/src/api.ts` says "kept within 1 to 30 seconds"; the code caps at one day, as it must for the TOTP-backup daily cap. | **Fixed** (comment). |
| F11 | Minor (known) | Task 10: an account already below its minimum (for example a staff account with one dead PGP key and a passkey) cannot remove the dead key (`409 last-login-method`). Such an account cannot log in anyway; it recovers by adding a usable key from a live session, after which the dead one can go. | **Accepted** (the lead asked for a decision): nothing is lost by refusing. |

## Review Focus results

- **RF1, stolen session cookie redirecting money.** Held. Wallet add and wait-off need a token for exactly the address hash (`wallets/routes.ts`, R17) or the `payout-wait-off` action, redeemed in the add transaction (`redeemConfirm` with the request's own session, account and action hash, `used_at is null and expires_at > now`, single `update ... returning`). A token for one wallet cannot add another; a token from session A is refused on session B; there is no "fresh login" exemption; the only tokenless wallet is the first one inside the creating session's 30 minutes with `had_wallet = false`, re-checked under the account row lock. Wait-off takes effect after 24 hours (`PAYOUT_WAIT_MS`), `enabled: true` cancels it with no token (safe direction). F2 and F6 are the only gaps found.
- **RF2, anonymous flood of a public username.** Held per method, **not** as a whole system: password throttles split by trusted device, so a known browser and a buyer's step-up confirm are untouched; PGP and WebAuthn have no per-guess throttle; the owner's security-key step has no limit of its own. Two exceptions, both findings: the global budgets (F1) and the untrusted-browser PGP start (F5). Recovery codes and every primary method are unaffected by the TOTP-backup daily cap.
- **RF3, linking and enumeration.** Held. `login/password` runs exactly one Argon2 verify on every path (dummy hash for unknown, malformed, passwordless and staff/owner names); PGP, WebAuthn and backup `start`/login answer unknown, wrong-kind and real names with the same shape (decoys with fixed profiles per name; a `refreshedKey` that matches nothing gets a decoy encrypted to the submitted key, a match gets the merged stored key, so a keyserver key tells the sender nothing); messages are encrypted with `wildcard: true`; `key-in-use` appears only after the code proves the key. Registration answers `username-taken` by design.
- **RF4, look-alike and reserved names.** Held as specified; F4 for what the specification does not cover.
- **RF5, edges of time.** Held: every expiry is `expires_at > now` (refused at exactly 5:00); a session passes the recovery hold at `now >= hold_until`; a wallet is usable at `usable_from <= now`; TOTP accepts only a step above `last_step`, set in the same statement.
- **Task 10, owner and staff.** No single factor starts a staff or owner session: the only `startSession` calls are the trader paths, the recovery paths (which treat staff/owner as unknown usernames) and `completeLogin`, whose staff/owner branch stores a pending row first and starts a session only after `pairAllowed`. The pending row is bound to account and device and is consumed by one atomic update; a mismatched request does not consume it; a wrong second factor never reaches the update; a second step is bound to the `pendingId` its `start` was given. Owner = PGP + attested security key; staff pairs as allowed; the PGP set of the first factor is excluded from the second challenge and `pairAllowed` compares key sets. Staff and owner never get password, TOTP or recovery codes (`allowedMethods`, `passwordAllowed`, backup path). Minimums count usable PGP keys only and run under `select ... for update` on the account row, so concurrent removals cannot both pass. F11 is the known Minor.

## Confirmed sound (tried and held up)

- **Sessions.** 256-bit opaque tokens, stored only as SHA-256; a new token on every login (a presented one is revoked, so fixation fails); `__Host-` cookies, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`; idle and absolute limits (traders 7 d / 30 d, staff and owner 2 h / 12 h, recovery 25 h / 48 h) enforced on every request together with `disabled_at`; other sessions end on password change and method removal; logout always revokes and clears.
- **CSRF.** Every non-GET needs an `Origin` exactly equal to a configured origin (`null`, prefixes and case games refused); the `text/plain` parser is removed, so a cross-site form cannot post JSON (415); cookies are `Strict`.
- **Confirm tokens.** 256-bit, stored as SHA-256, bound to session, account and the canonical action hash, single use, 5 minutes, issued only by the three confirm `finish` routes after a proof; `parseConfirmAction` takes only exact action shapes.
- **Passwords.** Argon2id (64 MiB, 3 passes), NFC, bounded input, one verify on every path, a semaphore and 503 `busy` rather than unbounded work, leaked-list lookup on the server (HIBP count ≥ 10).
- **TOTP.** Secrets from `randomBytes`, sealed with AES-256-GCM under a purpose key with the account as AAD (a sealed secret copied to another account does not open); constant-time comparison over the whole window; replay-proof in parallel; enrolment secret sealed in the challenge payload.
- **Recovery codes.** 80 bits from the CSPRNG, stored as SHA-256, throttled per account, shown once; a TOTP-only backup login is a recovery session under a 24-hour hold enforced in `requireSession` for every route that does not opt out.
- **PGP.** Codes 60-bit from `getRandomValues` (no modulo bias), stored as SHA-256, compared in constant time, single use (a wrong guess uses the challenge up, so there is one guess per challenge), 5 minutes, bound to purpose, account, session and the Origin's host; messages signed by the X2F key; strict key policy (RSA ≥ 4096, Ed25519/Ed448/X25519/X448, no fallback to a weak subkey); armored keys ≤ 32 KiB, ≤ 8 subkeys; stored only encrypted with the fingerprint as AAD; user IDs stripped where the key allows (R16); a merge can never drop a revocation.
- **WebAuthn.** Origin and RP ID checked against config, user presence always, user verification for passkeys, counter checked and updated in one compare-and-set, credential must be on the challenge's list, challenge single use and 5 minutes; staff/owner security keys count as attested only with a real certificate chain verified by `MetadataService` in strict mode against the repo snapshot and an AAGUID allowlist (self attestation is refused, `hasCertificateChain`).
- **Access control.** Every route is either public (listed: terms, signing key, register/login/backup/second-factor, logout, healthz) or behind `requireSession`; `kinds` and `terms-required` enforced centrally; ids from the URL are always combined with `account_id`; method, session, alert and wallet routes cannot reach another account's rows.
- **Privacy.** No IP, user agent, email or phone anywhere in the schema or code (`grep` for remote address, forwarded headers and user agent finds only comments); `trustProxy` unset; request and error serializers keep only method, route pattern and error class; no `console` use; alert details hold no secrets; device and wallet labels are stripped of control and format characters; the throttle and daily-count tables hold only account ids and normalized or hashed names, purged within an hour and two days.
- **Browser client.** Uses `credentials: 'same-origin'` and `redirect: 'error'`; `baseUrl` must be empty or an exact http(s) origin; no `localStorage`, `sessionStorage`, IndexedDB or `document.cookie` anywhere in the package; `withConfirm` runs `prove` at most once, only when the API names the same action, and never loops; `acceptedTerms` is always an argument, never defaulted.
- **Supply chain.** Every dependency in every `package.json` is an exact version; overrides are exact; all 357 registry entries in the lockfile carry an integrity hash and every `resolved` is the npm registry or a workspace; `ignore-scripts=true`; `npm audit --omit=dev` finds only the fastify LOW (below).

## ASVS 4.0 Level 3, chapters V2, V3 and V4

Met = implemented and, where it says so, tested; Partial = implemented with a gap; Not met = deviates; N/A = out of scope here. Paths are in `apps/api/src` unless marked.

### V2 Authentication

| Req | Result | Where / note |
|---|---|---|
| 2.1.1 passwords ≥ 12 characters | **Not met** | Minimum is 10 (`packages/accounts/src/password.ts:7`), the owner-approved policy; owner question 5 |
| 2.1.2 – 2.1.4 long passwords, no truncation, any Unicode | Met | max 256, NFC, hashed whole |
| 2.1.5 – 2.1.6 change password with current + new | Partial | `PUT /v1/account/password` requires a confirm token (proof of any method) rather than the current password; ends other sessions |
| 2.1.7 breached-password check | Met | `auth/leaked.ts`, HIBP count ≥ 10, local file |
| 2.1.8 strength meter, 2.1.11 – 2.1.12 paste / show | N/A | browser UI (Plan 3) |
| 2.1.9 no composition rules | **Not met** | upper/lower/number/symbol required (`password.ts`), spec 6.1; owner question 5 |
| 2.1.10 no periodic rotation | Met | none |
| 2.2.1 anti-automation | Met, with F1 / F5 | per-method throttles, budgets (`throttle.ts`, `limits.ts`) |
| 2.2.2 weak authenticators not sole | Met | no SMS / email; TOTP never alone; backup login is a recovery session |
| 2.2.3 notify on credential updates | Partial | in-app alerts only (`alerts.ts`); no email by rule |
| 2.2.4 phishing-resistant MFA (L3) | Met for WebAuthn, Partial overall | WebAuthn is origin-bound; PGP and TOTP codes can be typed into a fake site, mitigated by the host named in the PGP message |
| 2.2.5 – 2.2.7 TLS-authenticated channel, replay resistance, intent | Met / N/A | codes single-use; WebAuthn presence; TLS at the proxy |
| 2.3.1 system-generated secrets random, short-lived | Met | login codes 5 min; recovery codes 80 bit |
| 2.3.2 user-provided authenticators | Met | PGP, WebAuthn, TOTP |
| 2.3.3 renewal | N/A | |
| 2.4.1 – 2.4.2 approved hash, salt ≥ 32 bit | Met | Argon2id, library salt |
| 2.4.3 – 2.4.4 PBKDF2 / bcrypt parameters | N/A | |
| 2.4.5 secret-salt extra iteration (pepper) | **Not met** | none; `serverKey` exists, so an HMAC step before Argon2 would add it; owner question 6 |
| 2.5.1 – 2.5.3 recovery secrets, hints, no password recovery | Met | no hints, no reset, codes shown once |
| 2.5.4 no default accounts | Met | owner account is Plan 4's one-time setup |
| 2.5.5 notify on factor change | Partial | alerts, no email |
| 2.5.6 secure forgotten-credential recovery | Met | recovery codes / held TOTP session; no reset (staff / owner by owner decision R2) |
| 2.5.7 lost MFA needs identity proofing (L3) | Not met by design | X2F has no identity data; recovery is codes or a 24-hour hold, which the owner chose |
| 2.6.1 look-up secrets single use | Met | `recovery.ts` atomic update |
| 2.6.2 look-up secrets ≥ 112 bit or salted hash | Partial | 80-bit codes, unsalted SHA-256, throttled to ≈ 2900 tries a day; not reachable offline or online in practice; owner question 6 |
| 2.6.3 CSPRNG | Met | `getRandomValues` |
| 2.7.1 – 2.7.6 out-of-band (PGP) codes | Met | 5 min (limit 10), single use, only to the key owner, stored hashed, 60 bits |
| 2.8.1, 2.8.3, 2.8.4 TOTP lifetime, algorithms, single use | Met | 30 s ± 1 step, `last_step` compare-and-set |
| 2.8.2 OTP keys in an HSM / OS key store | Partial | AES-GCM under a key from `X2F_SERVER_KEY` in the environment; owner question 6 |
| 2.8.5 reused TOTP is logged and the holder notified | Partial | rejected; not logged (by the logging rules) or alerted |
| 2.8.6 – 2.8.7 | N/A | |
| 2.9.1 – 2.9.3 crypto verifiers | Met | WebAuthn public keys; 32-byte challenges; approved algorithms only (-8, -7, -257) |
| 2.10.1 – 2.10.4 service authentication, secrets in source | Met | env config, no secrets in code, Semgrep `p/secrets` clean |

### V3 Session management

| Req | Result | Where / note |
|---|---|---|
| 3.1.1 no token in URLs | Met | cookie only |
| 3.2.1 new token on authentication | Met | `startSession` |
| 3.2.2 ≥ 64 bits entropy | Met | 256 bits |
| 3.2.3 token stored safely in the browser | Met | `__Host-`, HttpOnly |
| 3.2.4 approved generation | Met | `randomBytes` |
| 3.3.1 logout invalidates | Met | `logoutRoute`, server-side revoke |
| 3.3.2 re-authentication timeouts (L3: 12 h or 15 min idle, with 2FA) | **Not met** | traders 7 d idle / 30 d; staff / owner 2 h idle / 12 h absolute (absolute met, idle not); sensitive changes re-prove through confirm tokens; owner question 7 |
| 3.3.3 end other sessions after credential change | Met | password set and method removal |
| 3.3.4 view and end sessions | Met | `/v1/account/sessions` |
| 3.4.1 – 3.4.5 cookie attributes | Met | `COOKIE_ATTRS`, `__Host-`; `SameSite=Strict` (decision below) |
| 3.5.1 – 3.5.3 token-based sessions | N/A / Met | opaque server sessions, no static API secrets |
| 3.6.1 – 3.6.2 federated | N/A | |
| 3.7.1 re-authentication for sensitive transactions | Met | confirm tokens (RF1) |

### V4 Access control

| Req | Result | Where / note |
|---|---|---|
| 4.1.1 enforced on a trusted server layer | Met | `requireSession` in every protected route's preHandler |
| 4.1.2 users cannot change their own access attributes | Met | `kind`, `disabled_at`, `terms_version` only change server-side (`POST /account/terms` is `kind = 'trader'` only) |
| 4.1.3 least privilege | Met | `kinds`, `allowedMethods`, recovery vs full, held recovery |
| 4.1.4 deny by default | Met | public routes are an explicit short list |
| 4.1.5 fail securely | Met | a throwing hook ends the request; unknown ids are 404 |
| 4.2.1 no IDOR | Met | every id lookup also filters on `account_id` |
| 4.2.2 CSRF defence | Met | exact `Origin`, `SameSite=Strict`, JSON only |
| 4.3.1 MFA for administrative interfaces (L3) | Met by design | staff / owner always two factors (R1); the interface itself is Plan 4 |
| 4.3.2 no directory listing or metadata files | Met | `serveDotFiles: false`, `index: false`, file rule for the catch-all |
| 4.3.3 step-up for high-value transactions (L3) | Met | confirm tokens |

## Decisions and accepted risks recorded here (Task 15 Step 3)

- **`SameSite=Strict` (P2-M9).** Kept. The web app's HTML shell needs no cookie, and its same-origin `fetch` calls carry it, so a deep link from outside (`/trade/:code`) still opens the app and then signs in. Plan 3's Playwright run must include an external link into `/trade/:code`. Cost: a top-level navigation from another site never carries the session, which is the point.
- **TOTP backup daily cap.** An anonymous attacker can spend a username's 5 TOTP-backup tries a day (`TOTP_BACKUP_DAILY`, counted right or wrong, per account) and so block that backup route until 00:00 UTC. Recovery codes, every primary method and a logged-in session are unaffected, and 5 tries a day makes guessing a 6-digit code (about 1 in 333,000 per try) hopeless. Accepted.
- **The X2F PGP signing key is a live key on the API server (R7).** It is read at start from `X2F_PGP_SIGNING_KEY_PATH` (mode 600 enforced), held unencrypted in memory, and signs every challenge. Anyone who reads the file or the process memory can sign messages that look like official X2F login or confirm messages, which is a phishing tool, not a way into an account (codes still have to be pasted into the site). It must be a key used for nothing else, backed up offline, and revocable: publish the fingerprint and a revocation procedure with the FAQ.
- **TOTP secrets and PGP keys are sealed under `X2F_SERVER_KEY`**, which is one environment value. A leak of the database alone reveals neither; a leak of the database and the key reveals both. Plan 6 should keep the key outside the app's normal config (and consider a key store).
- **Per-guess limits on PGP codes are deliberately absent** (60-bit, single use, one guess per challenge), so the only limits on that path are `start` limits (F5) and the budgets (F1).
- **Password login with TOTP**: guessing the TOTP after learning a password is limited by the per-account TOTP throttle, which after 10 failures allows one try per 30 seconds from unknown browsers: about 2,900 tries a day, roughly 0.9% a day to hit a 6-digit code in a three-step window. The password must already be known; the account also gets a `login-locked` alert. Accepted as the "brief lock" rule (spec 6.2); a longer lock after repeated streaks would close it (owner question 8).
- **Fastify LOW advisory (R31).** `fastify` 5.12.2 – 5.12.5, GHSA-389g-gv7q-r4x8 (header validation bypass via case-sensitive property names in schemas). The API declares no header schemas, so it is not reachable. Bump to 5.12.7 is due 2026-10-27.
- **Slow-connection exhaustion** (slowloris) is not handled in the API process; request and header timeouts belong in the front proxy (roadmap, Plan 6).

## Open items for Plan 3, Plan 4, Plan 6 and the external audit

- F1: per-source limits in front of the API and the relay (Plan 6).
- F5 and owner question 2 before the login screens are built.
- Audit: the strict `MetadataService` is process-wide, so a trader signing up with an authenticator that sends a packed attestation from outside the snapshot is refused with `webauthn-failed` (staff / owner get `method-not-allowed`). Browsers send `none` when asked for `none`, so this should not occur; confirm with real devices in Plan 3's Playwright run.
- Audit: confirm that the FIDO snapshot is refreshed before its `nextUpdate` (the API warns at start when it is past).
- Audit: `openpgp` 6.3.2 behaviour for `Key.update` (revocation merge) and `wildcard` encryption, relied on by RF3.
- The leaked-list production size is still to be recorded in `docs/dev-setup.md` (operator).

## For the owner

Questions only; nothing here has been decided.

1. **Global request budgets (F1).** The API cannot tell one visitor from another, so one script can stop all logins and sign-ups. The real fix is a per-source limit in the proxy / onion service in front (Plan 6). Do you also want the in-app design changed, for example no shared budget on the `finish` routes (so a person who already holds a challenge can finish during a flood), or bigger budgets? Neither stops a determined flood.
2. **Logging in from a new browser (F5).** Anyone who knows a username can, with one request a minute, keep that person from starting a PGP login on a browser the account has not seen, and the same for the owner's PGP step on a fresh Tor browser. Passkeys, security keys and known browsers are not affected. Options: accept it (today); or allow more starts per five minutes for the untrusted group (a bigger number is a weaker limit on that route, but PGP codes are single-guess anyway). Which?
3. **Look-alike usernames (F4).** Should `0`/`o`, `1`/`l`/`i` and `rn`/`m` be treated as the same when checking for taken and reserved names? That stops `adm1n` and `Ilya`/`llya` but also refuses some real names.
4. **Wallet removal (F6).** Should removing a payout wallet need a confirm, or at least leave an alert in the account's alert list?
5. **Password policy against ASVS.** ASVS asks for 12 or more characters and no composition rules; X2F asks for 10 with upper, lower, number and symbol (spec 6.1). Keep, or move to 12 characters with no composition rules and the leaked-list check?
6. **Stored-secret hardening.** (a) Add a secret "pepper" to password hashes (ASVS 2.4.5); (b) hash recovery codes with a key (ASVS 2.6.2 asks for 112 bits or a salt; ours are 80 bits); (c) keep TOTP secrets in an HSM or key store (ASVS 2.8.2). Each is small to build now and awkward to add after launch. Do them before launch?
7. **Session lifetimes against ASVS 3.3.2.** Level 3 wants re-login after 12 hours, or 15 minutes of idle time, with a second factor. Traders get 7 days idle / 30 days; staff and the owner 2 hours idle / 12 hours. Keep (sensitive changes already re-prove who you are), or shorten?
8. **Longer lock after repeated streaks (TOTP and password).** Today the lock is at most 30 seconds, forever. Add a longer lock after several streaks in a day, accepting that an attacker can lock a victim's unknown-browser logins for longer?
9. **Spec 6.3, wallet-era leftovers.** Delete the items "withdraw", "daily spending limits" and "PGP-signed withdrawal addresses" from section 6.3: they belong to a custodial wallet X2F does not have.
10. **Spec 6.2, "fingerprint becomes the account ID" (P2-M8).** Plan 2 logs in by username (6.1). Update 6.2 to say the fingerprint is a login method, not the ID?
11. **Spec 6.3, "PGP-encrypted notifications for users who opt into email" (P2-M8).** X2F stores no email address anywhere. Drop the sentence, or decide how a person would be reached without one (in-app alerts are the only channel today)?
12. **Wallet board copy "· gets payouts" (X2).** There is no default payout wallet; Plan 3 always asks. Remove the phrase from the Wallet board design?
13. **P3-C1 and Task 13 (device signing key).** Task 13 was skipped. Which P3-C1 option was chosen? If it is not option (a), Task 13 stays skipped and the plan's `add-device-key` confirm action is unused.
14. **Production size of the leaked-password list** (operator task): record it in `docs/dev-setup.md` when the list is first built.
15. **Fastify bump (R31).** Bump `fastify` to 5.12.7 on 2026-10-27 as planned, or sooner?

## Follow-up FU-A (owner decisions 2026-10-23, spec 6.1, 6.2 and the "Decided 2026-10-23" block)

What changed in code, for the auditors:

- **Private login name and public display name** (migration `009_login_names.sql`). `username` became `display_name` / `display_key`; `login_name` / `login_key` are new, unique, and must differ from the display key (check constraint). **Existing rows get no login name (null)**: copying the public name into it would have left every existing account loggable by a name anyone can read. Such accounts still log in by PGP key and discoverable passkey; name-based logins find nothing for them, and `GET /v1/account/me` says `loginNameSet: false` (there are no production accounts yet). The login name is never returned by any route (sign-ups answer `{ displayName }`; `me` sends only the display name), never logged, never put in WebAuthn options or the TOTP label (both use the display name), and an unknown typed login name is stored in throttle keys only as an HMAC tag (`loginNameLookup`, `subkey('name')`). Password login, security-key login by name and the backup login take `loginName`.
- **Login-name uniqueness** is checked only by the final, credential-bound create (after the Argon2 hash, the PGP code or the authenticator ceremony) and answered with the generic `names-unavailable`, so no start route can test whether a login name exists. Residual: password sign-up is a single request, so a scripted sign-up can still learn "unavailable" at the cost of one Argon2 hash and one register-budget token (20 a minute, process-wide) per try.
- **PGP login by key, no name.** `POST /v1/login/pgp/start { key, pendingId? }` takes the whole armored public key; a fingerprint or anything else is `key-unreadable`, the same for every key. The pasted key is inspected before any lookup (its refusals depend on the key alone). Known and unknown keys then get the same answer: a challenge encrypted to the pasted key (a known key: the stored copy merged with it), with the same merge, inspect and seal work on both paths. A known key that cannot get a real challenge (stored copy revoked or unusable, kind not served, a mismatched pending step) gets the decoy. Supersede (same key, same device) and the 3-open-anonymous cap are applied per key start tag to real and decoy challenges alike. The start limit is 5 per key fingerprint and group per 5 minutes, real and decoy alike. This replaces F5: a stranger can no longer hold PGP login shut by a public name.
- **Password login failures.** One answer for every failure, 401 `credentials-invalid` ("That login name and password don't match"), with `misses`, this browser's misses in a row (counted on the device-cookie hash, any names, reset by a success, streak ends 15 minutes after the last miss). No 429, `retryAfterSeconds` or `Retry-After` on this route. The server counts each try on the `password-login` key **before** checking (atomic claim, so a parallel burst gets at most 10 checks); after **10 tries in a row** the name is not checked for **15 minutes** from the 10th (tries in that time are not counted and do not extend it), and those tries still run one dummy Argon2 verify. The 10th miss adds one `login-locked` alert. Keys stay split by trusted device, so the person's own browser is unaffected. `POST /v1/confirm/password` keeps its own `password` key and the old short waits. The auth-client exposes `PASSWORD_LOGIN_MISMATCH`, `MISSES_BEFORE_SENDING_AWAY` (10) and `shouldSendAway(error)`; the redirect is Plan 3.
- **F1, busy logins.** A login finish (PGP, WebAuthn) or the TOTP second step skips the start budget only when it names an open challenge of that purpose and method started from the same device, and only once per challenge (claimed atomically in `payload.budgetFree`); every other finish takes a token as before. Per-source limits for starts remain Plan 6.
- **F4, look-alikes.** 0/o, 1/l/i and rn/m fold (`lookAlikeKey`) only for reserved words and against staff and owner display names; two traders' look-alike names are both allowed.
