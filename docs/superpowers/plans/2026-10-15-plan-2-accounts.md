# Plan 2: Accounts and login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested Fastify + PostgreSQL auth API and browser auth modules with which a person picks a username, logs in with PGP, a passkey, a security key or a password (plus TOTP and recovery codes as second factor or backup), confirms it's them with an action-bound confirmation before sensitive changes, and links payout wallets with an alert and an opt-in 24-hour wait; plus the auth primitives Plan 4 needs for staff and the owner.

**Architecture:** `packages/accounts` (`@x2f/accounts`) holds rules shared by browser and server: usernames, password policy, login-code format, PGP key inspection, confirm-action wording. `apps/api` (`@x2f/api`) is the Fastify server: raw SQL on `pg`, one numbered migration per task, one module per login method, sessions in Postgres behind an opaque `__Host-` cookie, a device cookie that shields known browsers from anonymous lockouts, per-method throttles, single-use confirm tokens bound to one action. `packages/auth-client` (`@x2f/auth-client`) is the typed browser client plus WebAuthn ceremony wrappers. No screens in this plan: Plan 3's task "Log in, confirm-it's-you and Security settings" (P3-C4) builds them on `createAuthApi` and `withConfirm`.

**Tech Stack:** Node 22.23.3, npm 11.21.0 (via `npx npm@11.21.0`), TypeScript 7.0.2 strict, vitest 5.0.3, fastify 5.12.5, @fastify/cookie 11.1.2, pg 8.23.1, @types/pg 8.23.1, openpgp 6.3.2, @simplewebauthn/server 14.0.3, @simplewebauthn/browser 14.0.0, argon2 0.45.1, otpauth 9.5.2, monero-ts (same exact version Plan 1 pins), PostgreSQL 17.11 in Docker for tests (`postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`), Semgrep 1.178.0.

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md` sections 4.1, 6.1–6.6, 8, 9. Review applied: `docs/superpowers/plans/2026-10-15-plans-2-3-review.md`. Builds on Plan 1 (`docs/superpowers/plans/2026-10-15-plan-1-escrow-core.md`): workspace, `tools/check.sh`, `@x2f/core` (`newTradeCode`, `normalizeTradeCode`). Note: `@x2f/core`'s `Role` (`buyer | seller | mod`) is a *trade* role; account kinds here are a separate type, `AccountKind`.

## Revision 2026-10-15

Applied every Plan 2 item and cross-plan reconciliation from the review. Authority: spec > review > previous plan.

- **P2-C1** Per-method throttles (`password`, `totp`, `recovery-code`) split by trusted device vs anonymous; PGP and WebAuthn never blocked by them; the 15-min lock is now a brief 30 s lock (spec 6.2 "slow down and then lock briefly"); device cookie `__Host-x2f_dev` (Task 4); flood tests in Tasks 4 and 14.
- **P2-C2** `FRESH_MS` dropped. Every sensitive change needs a single-use `confirmToken` bound to the session and the action (Task 5); PGP message names the action; onboarding exemption limited to the first wallet / first methods in the creating session within 30 min; Task 14 adds every wallet via `withConfirm`.
- **P2-C3** `encryptChallenge` uses `wildcard: true` (zero key IDs tested); unknown usernames get a decoy challenge; `key-in-use` reported only at `register/pgp/finish`; expired key at login answers `key-expired` with no date or fingerprint (Tasks 2, 7).
- **P2-I1** TOTP-alone backup login opens a recovery session under a 24 h hold before it may add a primary method; any full session can cancel; recovery codes skip the hold; TOTP backup capped at 5 tries/day; recovery sessions never become full (Task 9).
- **P2-I2** TOTP replay test rewritten in the right order (Task 9).
- **P2-I3** Up to 3 open login challenges, `start` limited to 5 per 5 min per account and device (slow-down only), earlier challenges invalidated only from the same device; binding tests added; `siteHost` taken from the checked `Origin` (Tasks 2, 7).
- **P2-I4** Seven WebAuthn security tests added (Task 8).
- **P2-I5** Staff/owner registration uses `attestationType: 'direct'` checked against a repo FIDO MDS snapshot and AAGUID allowlist; `ownerReady` counts attested keys only (Tasks 8, 10).
- **P2-I6** Session-fixation, cookie-attribute and replacement tests; other sessions end on password change and method removal; recovery never upgrades (Tasks 4, 10).
- **P2-I7** Dummy Argon2 verify; discoverable passkey login without username for traders; decoy options for unknown security-key usernames; same-shape tests per route (Tasks 6–8).
- **P2-I8** Argon2 semaphore (4 running, queue 32, else 503 `busy`), in-memory token buckets on register and start routes, armored keys ≤ 32 KiB and ≤ 8 subkeys, with tests (Tasks 2, 3, 6).
- **P2-I9** `requireSession` and every login finish refuse `disabled_at` with 403 `account-disabled`; live-session test (Tasks 4, 6–9).
- **P2-I10** Task 15 updates the roadmap with named owners for every deferred item and records the owner question about 6.3's wallet-era leftovers.
- **P2-M1** Reserved names by token/prefix/suffix rules; `badminton`, `Sadmina` tests (Task 1).
- **P2-M2** Each task adds its own migration, `001`–`009` (Plan 2 owns `0xx`).
- **P2-M3** Method list replaced by the naming rule plus the decision-carrying helpers (Task 14).
- **P2-M4** `purgeExpired` runs every 10 min from `main.ts` via one retention scheduler; removed wallets' addresses nulled after 90 days (Tasks 3, 4, 12).
- **P2-M5** `disableRequestLogging: true` plus log-capture test (Task 3); leaked list = HIBP entries with count ≥ 10, size recorded in `docs/dev-setup.md` (Task 6).
- **P2-M6** CSRF tests for `Origin: null`, prefix lookalike, and `text/plain` JSON → 415 (Tasks 3, 4).
- **P2-M7** TOTP enrolment secret encrypted in `challenges.payload` (Task 9).
- **P2-M8** Spec drift (6.2 "fingerprint becomes the account ID"; 6.3 email notifications) recorded as owner questions in Task 15; the plan follows 6.1 (username) and the no-email rule.
- **P2-M9** Kept `SameSite=Strict`: the web app's HTML shell needs no cookie and its same-origin `fetch` calls carry it, so deep links from outside still work; Plan 3's Playwright run must cover an external link into `/trade/:code`.
- **P2-M10** Integrated addresses refused with 400 `address-integrated` (Task 12).
- **X1** Names kept for Plan 3: `buildApi(deps: Deps)`, `deps.db`, `deps.clock`, npm script `migrate`, table `accounts`, `account_id` FKs, `req.auth.accountId`, 401 `not-authenticated`, `usableWallets`, `GET /v1/wallets` (`usableFrom`, `usable`), `WALLET_APPS`. Changed: `requireSession` loses `fresh` (use `requireConfirm`) and gains `kinds`; `/v1/account/me` field `nudges` renamed `suggestions` so `/v1/account/nudges` stays free for Plan 3.
- **X2** No default payout wallet: Plan 3 always asks (BuyQuote picker); the Wallet board's "· gets payouts" copy goes to the owner in Task 15.
- **X3** `requireSession` defaults to full sessions only and takes `kinds: ['trader']` (403 `wrong-account-kind`) for Plan 3's take/post/release routes; `disabled_at` enforced here.
- **X4** `confirmToken`/`requireConfirm`/`redeemConfirm` exported for Plan 3's add-wallet-during-take (Task 5).
- **X5** Account device signing key built as gated Task 13, only if the owner picks P3-C1 option (a).
- **X6** Deferred items get named plans in the roadmap (Task 15).
- **X7** Relay registration is Plan 3/Plan 1 work; nothing in Plan 2.
- **X8** `ApiErrorCode` is one union in `apps/api/src/errors.ts`; Plan 3 appends its codes there; `AuthApiError` uses the same type.
- **X9** One origin: auth client uses `credentials: 'same-origin'` and default `baseUrl: ''`.
- **X10** Migrations numbered per plan (Plan 2 `0xx`), one per task.
- **X11** One gate: `npm audit --omit=dev` (as Plan 1) and `npm test -- --project <name>` in every plan.
- **X12** One retention scheduler (`startRetention`) in Plan 2; Plan 3 registers `purgeChats` and the trade-address purge as jobs.

## Revision 2026-10-17

Owner decisions of 2026-10-17 applied before building. Authority: spec > this revision > earlier text.

- **R1 Owner and staff always log in with two factors** (owner: attested security key + PGP every login; staff: security key + PGP, two different PGP keys, or PGP + passkey). Login finishes go through `completeLogin` (Task 7); Task 10 adds `pairAllowed`, the `second-factor` step reusing Task 9's pending challenge, `ownerReady` = 2 attested keys + 1 PGP key, and `removeMethod` minimums; `assertCredentialAllowed` lets an unattested passkey through for staff only, as the partner of PGP (Task 8). Staff sessions 2 h idle / 12 h (Task 4, commit ad8b8c7).
- **R2 No reset for staff or the owner** (owner: no password, no reset): `POST /v1/account/recovery-codes` refuses staff and owner, and `/v1/login/backup` answers them like an unknown username; `recovery.ts` joins Task 10's Modify list.
- **R3 Staff accounts are separate from trading accounts:** wallet and payout-wait routes take `kinds: ['trader']` (Task 12).
- **R4 Moderator badge, moderator dashboard and training library** are named as Plan 4 work in Task 15's roadmap list.
- **R5 No IP logging at all, even in disputes:** wider column check, a request serializer that drops `remoteAddress`, `remotePort`, `hostname` and `url`, `trustProxy` never set, an error-log test for `127.0.0.1` (Task 3); Global Constraint says "including disputes and staff tools"; Plan 6 must turn off reverse-proxy and Tor access logs (Task 15).
- **R6 Disputes kept 30 days, anonymized training copies 6 months:** both purges named as Plan 4 jobs on `startRetention` (Task 15).
- **R7 PGP challenges are signed with the official X2F PGP key, fingerprint published on the site and FAQ:** `pgpSigningKeyPath` / `pgpSigningFingerprint` in `Config` with a startup check, `encryptChallenge` signs (`signingKeys`) and keeps wildcard recipients, `GET /v1/pgp/signing-key`, tests (Tasks 2, 3, 7).
- **R8 X2F never creates PGP keys for users:** Global Constraint "no endpoint generates, accepts or returns a private PGP key".
- **R9 Secrets come only from the OS CSPRNG:** TOTP secrets get a byte-frequency chi-square check (256 bins, threshold 345); the recovery-code per-position threshold is raised to 76 and the stated false-alarm rate corrected (Task 9).
- **R10 Terms of Service first in setup, again when they change:** `termsVersion` in `Config`; `accounts.terms_version`, `terms_accepted_at`; register finishes require `acceptedTerms`; `GET /v1/terms`, `me.termsCurrent`, `POST /v1/account/terms`; `requireSession` answers 403 `terms-required` to a trader with a stale version except on a short allowlist (Tasks 3, 4, 6, 7, 8, 11).
- **R11 A password is a primary method only, never a backup; a passkey counts as a backup:** new `hasBackup` rule and tests (Task 11); Task 14 checks a password does not count.
- **R12 First payout wallet in setup skips confirm, every later wallet confirms** (spec 6.4, commit 1a74dd2): unchanged P2-C2 behaviour, now stated in the Global Constraints. "No trading or ads without a wallet" and "no buyer deposits" are Plan 3 items in Task 15's roadmap list.
- **R13 Notes:** PGP codes are not throttled per guess, only `start` is limited (Global Constraints, spec 6.2); Plan 4's owner setup code goes to stderr outside the logger (Global Constraints).
- **R14 Plan 4 reconciliation:** Plan 2 now produces the helpers Plan 4 assumes (below).
- **R15 Review of Tasks 1–2 (2026-10-18):** no hand-rolled crypto, so `actionHash` is async on WebCrypto (`Promise<string>`); `encryptChallenge` takes `now` (server clock, passed to openpgp as `date`) and encrypts under a strict openpgp config built from explicit values (RSA ≥ 4096; only Ed25519/Ed448, ECDH-Curve25519, X25519, X448 otherwise), so a key whose only usable encryption subkey is weak fails closed instead of falling back to it; new `KeyRefusal` `key-not-yet-valid` for a key or subkey created after the server clock (Task 3's `ApiErrorCode` includes it via "every `KeyRefusal`"); raw input caps before NFC/code-point work (username > 64 code units → `length`, password > 1024 → `too-long`) (Tasks 2, 3, 7).

- **R16** PGP user IDs (owner, 2026-10-17): stripped where the key survives it (v6), otherwise stored only encrypted (`armored_enc`, `subkey('pgp-key')`); never shown, logged or used (Task 7).

- **R17** (Task 5 review, for Tasks 10 and 12): `requireConfirm` attaches the resolved `ConfirmAction` to `req.confirmedAction`; Task 12 stores exactly the address that was confirmed (hash computed once), and runs its own address checks (`address-integrated`, format) in schema validation BEFORE `requireConfirm` so a refused request never burns a token. Task 10's method removal takes `confirmToken` in a JSON body (a `DELETE` with a body, or `POST …/remove`).

## Plan 4 reconciliation

Plan 4 (`docs/superpowers/plans/2026-10-15-plan-4-staff.md`, "Assumed" block) builds on these Plan 2 exports; each is produced by the task named:

- `endAllSessions(deps, accountId)` — Task 4.
- `webauthnRegistrationOptions(deps, accountId, o?: { kind?: 'passkey' | 'security-key'; challenge?: Uint8Array })`, `verifyWebAuthnRegistration(deps, accountId, response, expectedChallenge)`, `webauthnAssertionOptions(deps, accountId, challenge)`, `verifyWebAuthnAssertion(deps, accountId, response, expectedChallenge)` — Task 8.
- `pgpLoginRoutes(app, { kinds, afterAuthenticate? })` — Task 7; `securityKeyLoginRoutes(app, { kinds, afterAuthenticate? })` — Task 8. `afterAuthenticate(accountId)` runs after each factor's credential check passes and may throw `ApiError` before any pending second factor or session is created. Both finish through `completeLogin`, so the two-factor rule of Task 10 applies on every mount.
- Not reconciled here (Plan 4's own task): the `cookieName` option Plan 4 assumes for `startSession` / `requireSession`.

## Global Constraints

- No email address or phone number is ever asked for, stored, or accepted by any endpoint or table.
- Usernames: 5–20 characters, ASCII letters, digits, `.`, `-`, `_`; stored and shown exactly as typed; unique case-insensitively.
- Passwords: at least 10 characters with an upper-case letter, a lower-case letter, a number and a symbol; refused if on the leaked list held on X2F's own server (no outside lookup); stored only as Argon2id (`memoryCost 65536`, `timeCost 3`, `parallelism 1`); at most 256 characters.
- PGP: login codes random, single-use, expire in 5 minutes; the decrypted message names the site, the purpose and the time; accepted keys RSA ≥ 4096, Ed25519, Ed448; expired or revoked keys refused with the reason; encrypted messages never reveal recipient key IDs; every challenge message is signed with the official X2F PGP key, whose fingerprint is published on the site and in the FAQ (owner, 2026-10-17). PGP login codes are not throttled per guess (60-bit, single-use); only `start` is rate-limited (Task 7).
- No endpoint generates, accepts or returns a private PGP key; X2F never creates PGP keys for users (owner, 2026-10-17).
- TOTP: 6 digits, 30-second period, SHA-1; never the only login method (a TOTP-only backup login is a held recovery session, never a full one).
- Backup login is optional; the API never requires one. A backup is TOTP, recovery codes, a security key, a passkey or a second PGP key; a password is a primary method only and never counts as a backup (owner, 2026-10-17).
- Terms of Service: a trader account is created only with `acceptedTerms` equal to the current `termsVersion`; when the version changes, the trader's session gets 403 `terms-required` on every route outside the allowlist until they accept again (owner, 2026-10-17). Staff and owner accounts carry no Terms version (Plan 4).
- Staff and the owner log in only with a hardware security key, PGP or a passkey, and ALWAYS with two factors (owner, 2026-10-17). Staff: security key + PGP, two different PGP keys, or PGP + passkey; a passkey (unattestable) is never one of the two alone with a security key, and two passkeys never count. Owner: an attested security key + PGP at every login, two attested keys registered plus a PGP key. A first-factor login for staff/owner returns `second-factor` with the methods still needed, never a session. (Tasks 7, 8 and 10 implement.)
- Repeated failures slow down and then lock briefly (≤ 30 s), per method; failures from unknown browsers never lock out a known browser, a passkey, a security key or PGP.
- Adding a payout wallet, adding or removing a login method, setting a password, new recovery codes, and switching the 24-hour wait off each need a confirm token bound to that exact action. The only exemption (P2-C2, spec 6.4): within 30 minutes of sign-up the creating session may add its first wallet and its first login methods without one; every later wallet needs a token.
- Every dependency pinned exactly, published at least 14 days before 2026-10-15 (`npm view <pkg> time --json`); install with `npx npm@11.21.0 install`; `.npmrc` keeps `ignore-scripts=true` (argon2 loads its shipped prebuilds, so no build script is needed).
- `npm audit --omit=dev` reports 0 vulnerabilities; every task ends with `npm run check` (typecheck, tests, audit, Semgrep) passing. Tests run as `npm test -- --project <package>`.
- No IP addresses or user agents are stored or logged, anywhere, including disputes and staff tools (owner, 2026-10-17). Fastify request logging is off, `trustProxy` is never set, and the request serializer drops `remoteAddress`, `remotePort`, `hostname` and `url`. Logs never contain passwords, codes, tokens, keys, wallet addresses, trade codes, URLs with identifiers or request bodies. The one exception is Plan 4's one-time owner setup code, written once to stderr outside the structured logger.
- The server clock is the only clock: every module takes `clock: () => Date`; tests inject a fixed clock.
- Migrations: Plan 2 owns `apps/api/migrations/0xx_*.sql`; each task adds its own.
- Code written by agy-delegated agents is accepted only after Semgrep, the Security Guidance hook and a code-review plugin have checked it.

## Review Focus

1. **A stolen session cookie tries to redirect money:** adding a payout wallet or switching the 24-hour wait off without a confirm token bound to that exact action (and that session) is refused, even seconds after a login or an unrelated confirm; switching the wait off takes effect only after 24 hours. Tests owned by Tasks 5 and 12.
2. **An anonymous attacker floods a public username with bad passwords:** the owner's security-key + PGP login, a trader's passkey or PGP login, a password login from a browser holding the device cookie, and a buyer's step-up confirm all still succeed. Tests owned by Tasks 4 and 14.
3. **Linking and enumeration:** an unknown username, a username without that method, and a real one give responses of the same shape on every `start` route and on `login/password`; PGP messages carry zero key IDs; a keyserver key cannot be tested for an X2F account. Tests owned by Tasks 6, 7 and 8.
4. **Look-alike and reserved usernames, without false positives:** `Alice` after `alice`, Cyrillic `а`, `X2F.Support` refused; `badminton` and `Sadmina` accepted. Tests owned by Tasks 1 and 6.
5. **Edges of time:** a PGP code at exactly 5:00 is refused; a TOTP code reused inside its 30-second window is refused; a waiting wallet is unusable at 23:59:59 and usable at 24:00:00; a TOTP-held recovery session cannot add a key at 23:59:59 and can at 24:00:00. Tests owned by Tasks 7, 9 and 12.

---

### Task 1: Shared account rules (`@x2f/accounts`)

**Files:**
- Create: `packages/accounts/package.json`, `packages/accounts/tsconfig.json`, `packages/accounts/src/index.ts`, `packages/accounts/src/username.ts`, `packages/accounts/src/password.ts`, `packages/accounts/src/loginCode.ts`
- Test: `packages/accounts/test/username.test.ts`, `packages/accounts/test/password.test.ts`, `packages/accounts/test/loginCode.test.ts`

**Interfaces:**
- Consumes: `newTradeCode`, `normalizeTradeCode` from `@x2f/core`.
- Produces:
  - `type AccountKind = 'trader' | 'staff' | 'owner'`
  - `checkUsername(input: string): { ok: true; username: string; key: string } | { ok: false; reason: 'length' | 'characters' | 'reserved' }` — `key` is the lower-cased form used for uniqueness. Regex `/^[A-Za-z0-9._-]{5,20}$/`. Reserved rule, with `tokens` = `key` split on `[._-]` and `flat` = `key` with `.`, `-`, `_` removed: any token in `{admin, administrator, moderator, mod, support, staff, owner, system, root, help, x2f, official}`; or `flat` starts with `admin`, `x2f` or `staff`; or `flat` contains `moderator`; or `flat` ends with `support`.
  - `checkPassword(pw: string): { ok: true } | { ok: false; missing: Array<'length' | 'upper' | 'lower' | 'number' | 'symbol' | 'too-long'> }` — counts code points after NFC; upper `\p{Lu}`, lower `\p{Ll}`, number `\p{Nd}`, symbol = any code point that is not a letter, number or whitespace; `too-long` above 256.
  - `normalizePassword(pw: string): string` — NFC.
  - `newLoginCode(): string` — 12 Crockford base32 characters from `crypto.getRandomValues`, grouped `XXXX-XXXX-XXXX`; `normalizeLoginCode(input: string): string | null` (same mapping rules as `normalizeTradeCode`, 12 characters).
  - `newRecoveryCode(): string` / `normalizeRecoveryCode(input: string): string | null` — delegate to `newTradeCode` / `normalizeTradeCode`.

- [ ] **Step 1: Failing tests.**
  - `checkUsername('Satoshi.N')` → `{ ok: true, username: 'Satoshi.N', key: 'satoshi.n' }`; `'abcd'` and 21 characters → `length`; `'bob smith'`, `'bób12'`, `'аlice'` (Cyrillic а) → `characters`.
  - Reserved: `'X2F.Support'`, `'the_admin'`, `'Moder-ator'`, `'adminbob'`, `'staff_42'`, `'livesupport'`, `'owner'` → `reserved`.
  - Not reserved: `'badminton'`, `'Sadmina'`, `'helper99'`, `'rootbeer'`, `'modular'` → `ok`.
  - `checkPassword('Correct-Horse-9')` ok; `'short1!A'` missing `['length']`; `'alllowercase1!'` missing `['upper']`; `'NoNumbers!!xx'` missing `['number']`; `'NoSymbols123x'` missing `['symbol']`; 257 characters → includes `too-long`; `'Ünïcödé-Pass1'` ok.
  - `newLoginCode()` matches `/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/`; `normalizeLoginCode(' k7m2 9qxa-4ftr ') === 'K7M2-9QXA-4FTR'`; 11 or 13 characters → `null`.
  - `normalizeRecoveryCode('k7m29qxa4ftr8wpn') === 'K7M2-9QXA-4FTR-8WPN'`.
- [ ] **Step 2:** `npm test -- --project @x2f/accounts`; expect FAIL (modules missing).
- [ ] **Step 3:** Implement; export from `src/index.ts`. Package mirrors `packages/core/package.json` (ESM, `exports` → `./src/index.ts`).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(accounts): username, password and login-code rules`.

### Task 2: PGP key inspection, challenge text and action wording (`@x2f/accounts`)

**Files:**
- Create: `packages/accounts/src/pgp.ts`, `packages/accounts/src/confirmAction.ts`
- Test: `packages/accounts/test/pgp.test.ts`, `packages/accounts/test/confirmAction.test.ts`, `packages/accounts/test/fixtures/keys.ts` (generates keys once per run)

**Interfaces:**
- Produces:
  - `type KeyRefusal = 'key-unreadable' | 'key-too-large' | 'key-private' | 'key-multiple' | 'key-weak' | 'key-expired' | 'key-revoked' | 'key-no-encryption' | 'key-not-yet-valid'`
  - `MAX_ARMORED_KEY_BYTES = 32 * 1024`; `MAX_SUBKEYS = 8`.
  - `inspectPublicKey(armored: string, now: Date): Promise<{ ok: true; fingerprint: string; algorithm: 'rsa' | 'ed25519' | 'ed448'; bits: number | null; expiresAt: Date | null } | { ok: false; reason: KeyRefusal; detail: string }>` — size checked on UTF-8 bytes *before* parsing; `fingerprint` lower-case hex. `detail` is a plain sentence, e.g. `"This key expired on 2026-03-01."`, `"RSA 2048-bit keys are too short; X2F needs 4096 or more."`, `"This is a private key. Paste your public key; never share the private one."`
  - `challengeText(a: { code: string; siteName: string; siteHost: string; issuedAt: Date; expiresAt: Date; purpose: string }): string` — `purpose` is already-worded text (see `describeAction`, `PGP_PURPOSE`). Exact lines:
    ```
    X2F login code: <code>
    Site: <siteName> (<siteHost>)
    Purpose: <purpose>
    Time: <issuedAt ISO, seconds, Z>
    Expires: <expiresAt ISO, seconds, Z>
    Only paste this code into <siteHost>. If you did not just ask for it, ignore it.
    ```
  - `PGP_PURPOSE = { register: 'create your account', login: 'log in', 'add-key': 'add this PGP key to your account' } as const`
  - `encryptChallenge(text: string, armoredKeys: string[], signingKey: openpgp.PrivateKey, now: Date): Promise<string>` — validity judged at `now` (passed to openpgp as `date`) under a strict config built from explicit values (R15), so it throws rather than fall back to a weak, expired or not-yet-valid encryption subkey; one armored message to every key, `encryptionKeys` with `wildcard: true` so every PKESK key ID is zero, signed inside the encryption with `signingKeys: signingKey` (the official X2F key, R7).
  - `type ConfirmAction = { kind: 'add-wallet'; addressHash: string; addressEnd: string } | { kind: 'payout-wait-off' } | { kind: 'add-method'; method: MethodType } | { kind: 'remove-method'; method: MethodType; id: string } | { kind: 'set-password' } | { kind: 'new-recovery-codes' } | { kind: 'add-device-key'; signPublicHash: string }` and `type MethodType = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-codes'` (both live here so browser and server share them).
  - `actionHash(a: ConfirmAction): Promise<string>` — SHA-256 hex (WebCrypto) of canonical JSON (keys sorted) (R15).
  - `describeAction(a: ConfirmAction): string` — exact copy: `add payout wallet ending …<addressEnd>`; `turn off the 24-hour wait for new payout wallets`; `add a login method (<method>)`; `remove a login method (<method>)`; `set a new password`; `make new recovery codes`; `add a trade signing key`.
  - `addressHash(address: string): Promise<string>` — SHA-256 hex (WebCrypto) of the trimmed address; `addressEnd(address: string): string` — last 6 characters.
- Rules: size limit first (`key-too-large`); read with `openpgp.readKeys`; more than one key → `key-multiple`; more than `MAX_SUBKEYS` subkeys → `key-too-large`; `isPrivate()` → `key-private`. Primary or any subkey created after `now` → `key-not-yet-valid` with detail "This key's creation time (<ISO>) is ahead of X2F's clock. Check your computer's clock, or try again after that time." (R15). Primary key: RSA with bits ≥ 4096, `eddsaLegacy` on `ed25519Legacy`, `ed25519`, or `ed448`; otherwise `key-weak`. `isRevoked()` → `key-revoked`; `getExpirationTime()` ≤ `now` → `key-expired`. `getEncryptionKey(undefined, now)` must exist and be RSA ≥ 4096, `ecdh` on `curve25519Legacy`, `x25519` or `x448`; otherwise `key-no-encryption` (or `key-weak` if present but weak).

- [ ] **Step 1: Failing tests** (fixtures from `openpgp.generateKey`; RSA keys generated once in `beforeAll`):
  - Ed25519 (`curve: 'ed25519Legacy'`), v6 `curve25519`, `curve448` and RSA 4096 keys → `ok`, correct algorithm, 40- or 64-hex fingerprint.
  - RSA 2048 → `key-weak`, `detail` contains `2048`; NIST P-256 → `key-weak`.
  - Key generated with `date` 2 days ago and `keyExpirationTime: 86400` → `key-expired`, `detail` contains the ISO date.
  - Key passed through `openpgp.revokeKey` → `key-revoked`.
  - Armored private key → `key-private`; two keys concatenated → `key-multiple`; `'hello'` → `key-unreadable`; a 33 KiB armored string → `key-too-large` without calling `readKeys` (spy); a key with 9 encryption subkeys → `key-too-large`.
  - `challengeText` with fixed dates and `purpose: 'log in'` equals the exact six-line string above.
  - `encryptChallenge` to two keys decrypts with either private key to that text; `openpgp.readMessage(...).packets` filtered to PKESK all have `publicKeyID.isWildcard() === true`.
  - Signature (R7): decrypting with `verificationKeys: <signing public key>, expectSigned: true` succeeds and the signature's key ID equals the signing key's; the same with another Ed25519 public key as `verificationKeys` throws.
  - `describeAction({ kind: 'add-wallet', addressHash: 'ab…', addressEnd: 'q2k3Fz' }) === 'add payout wallet ending …q2k3Fz'`; `actionHash` is the same for `{ kind, addressEnd, addressHash }` in either key order and differs when `addressHash` changes.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with openpgp 6.3.2 (dependency of `@x2f/accounts`).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(accounts): PGP key checks, challenge message and confirm actions`.

### Task 3: API skeleton, config, request budgets, retention scheduler and Postgres harness (`apps/api`)

**Files:**
- Create: `apps/api/package.json` (scripts `migrate`, `start`), `apps/api/tsconfig.json`, `apps/api/src/app.ts`, `apps/api/src/config.ts`, `apps/api/src/errors.ts`, `apps/api/src/db/pool.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/limits.ts`, `apps/api/src/retention.ts`, `apps/api/migrations/001_accounts.sql`, `apps/api/src/main.ts`
- Create: `apps/api/test/setup/postgres.ts` (vitest `globalSetup`), `apps/api/test/helpers/db.ts`, `apps/api/test/helpers/app.ts`, `apps/api/test/helpers/logs.ts`
- Modify: `vitest.config.ts` (projects include `apps/*` if Plan 1 has not already), `docs/dev-setup.md`
- Test: `apps/api/test/schema.test.ts`, `apps/api/test/limits.test.ts`, `apps/api/test/retention.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { siteName: string; origins: string[]; rpId: string; databaseUrl: string; leakedListPath: string; serverKey: Uint8Array /* 32 bytes */; attestationDir: string; moneroNetwork: 'mainnet' | 'stagenet' | 'testnet'; termsVersion: string; pgpSigningKeyPath: string; pgpSigningFingerprint: string }`; `loadConfig(env): Config` reading `X2F_SITE_NAME` (default `X2F`), `X2F_ORIGINS` (comma list of exact origins), `X2F_RP_ID`, `DATABASE_URL`, `X2F_LEAKED_LIST_PATH`, `X2F_SERVER_KEY` (base64), `X2F_ATTESTATION_DIR` (default `apps/api/data/fido-mds`), `X2F_MONERO_NETWORK`, `X2F_TERMS_VERSION` (non-empty, at most 32 characters), `X2F_PGP_SIGNING_KEY_PATH` (an unencrypted armored private key file readable only by the API's user), `X2F_PGP_SIGNING_FINGERPRINT` (lower-case hex, 40 or 64 characters); throws naming the first missing or malformed variable.
  - `subkey(config: Config, label: 'totp' | 'decoy' | 'device'): Uint8Array` — HKDF-SHA-256 of `serverKey`, info `x2f/<label>`, 32 bytes.
  - `interface Deps { config: Config; db: pg.Pool; clock: () => Date; leaked: LeakedList; addresses: AddressValidator; attestation: AttestationPolicy; pgpSigner: PgpSigner }` (the four interfaces are defined in Tasks 6, 12, 8 and 7; created here as interface-only stubs).
  - `buildApi(deps: Deps): Promise<FastifyInstance>` — `disableRequestLogging: true`; `trustProxy` never set; logger `serializers.req` returns only `{ method, route }` (route pattern, never the URL), so `remoteAddress`, `remotePort`, `hostname` and `url` never reach a log line (R5); logger `redact` covering `req.body`, `req.headers.cookie`, `res.headers["set-cookie"]`; content-type parsers: only `application/json` (the built-in `text/plain` parser removed), anything else → 415 `unsupported-media-type`; default `bodyLimit` 16 KiB; `GET /healthz` → `200 {"ok":true}`.
  - `class ApiError extends Error { constructor(status: number, code: ApiErrorCode, extra?: Record<string, unknown>) }`; the error handler replies `{ "error": code, ...extra }`. `type ApiErrorCode` is the single union for all plans (Plan 3 appends its codes here); Plan 2's members: `bad-request`, `not-found`, `unsupported-media-type`, `busy`, `username-invalid`, `username-reserved`, `username-taken`, `password-weak`, `password-leaked`, every `KeyRefusal`, `key-in-use`, `challenge-expired`, `code-invalid`, `credentials-invalid`, `slow-down`, `locked`, `not-authenticated`, `account-disabled`, `wrong-account-kind`, `confirm-required`, `confirm-invalid`, `recovery-session`, `recovery-hold`, `method-not-allowed`, `last-login-method`, `webauthn-failed`, `origin-refused`, `address-invalid`, `address-integrated`, `wallet-exists`, `terms-not-accepted`, `terms-required`.
  - `limits.ts`: `class Semaphore { constructor(running: number, queue: number); run<T>(fn: () => Promise<T>): Promise<T> }` — throws 503 `busy` when `running` are busy and `queue` are waiting; `ARGON2_SLOTS = new Semaphore(4, 32)`. `class TokenBucket { constructor(capacity: number, perMinute: number, clock); take(): void }` — throws 503 `busy` with `retryAfterSeconds`; in memory only, never persisted. Buckets: `REGISTER_BUCKET` capacity 20, refill 20/min; `START_BUCKET` capacity 120, refill 120/min (all `/v1/login/*` and `/v1/register/*/start` routes and `login/password`).
  - `migrate(db): Promise<string[]>` — applies `migrations/NNN_*.sql` in order, one transaction each, recorded in `schema_migrations(name text primary key, applied_at timestamptz)`; returns names applied. npm script `migrate` runs it against `DATABASE_URL`.
  - `001_accounts.sql`: `accounts(id uuid pk default gen_random_uuid(), username text not null, username_key text unique not null, kind text not null check (kind in ('trader','staff','owner')), webauthn_user_id bytea unique not null, payout_wait boolean not null default false, payout_wait_off_at timestamptz, had_wallet boolean not null default false, terms_version text, terms_accepted_at timestamptz, created_at timestamptz not null, disabled_at timestamptz)` (`terms_version` null for staff and owner); `create unique index one_owner on accounts(kind) where kind = 'owner'`.
  - `retention.ts`: `type RetentionJob = { name: string; run(db: pg.Pool, now: Date): Promise<number> }`; `startRetention(deps: Deps, jobs: RetentionJob[], everyMs = 600_000): () => void` — runs every job in order each tick, logs only `{ job, rows }`, one job's failure does not stop the others; returns a stop function. `main.ts` starts it with Plan 2's jobs (Tasks 4, 12); Plan 3 adds its jobs to the same array.
  - Test harness: `globalSetup` runs `docker run -d --rm --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=<random> -p 127.0.0.1::5432 <pinned image>`, waits for `pg_isready`, migrates database `x2f_template`, `provide('pgUrl', url)`; teardown stops the container. Without Docker it fails with `"api tests need Docker (see docs/dev-setup.md)"`, never skips. `testDb(): Promise<pg.Pool>` creates a fresh database from the template per test file. `testApp(overrides?: Partial<Deps>): Promise<{ app: FastifyInstance; deps: Deps; setNow(d: Date): void; logs: string[] }>` — `logs` captures every logger line.

- [ ] **Step 1: Failing tests:**
  - `migrate` on an empty database applies `['001_accounts.sql']`; a second run applies `[]`. `GET /healthz` → `{ ok: true }`.
  - No column in `information_schema.columns` matches `/(^|_)ip($|_)|ip_?addr|remote_?addr|user_agent|email|phone/` (this test re-runs after every later migration because it reads the live template).
  - A test-only route that throws, so the error handler logs with `req`, leaves no line in `logs` containing `127.0.0.1`, `remoteAddress`, `remotePort` or `hostname` (R5); `app.initialConfig.trustProxy` is falsy.
  - A second `kind='owner'` account fails. `loadConfig({})` throws naming `X2F_ORIGINS`; a full env with `X2F_PGP_SIGNING_FINGERPRINT=xyz` throws naming it.
  - `GET /healthz?trade=K7M2-9QXA-4FTR-8WPN` leaves no line in `logs` containing `K7M2`.
  - `POST /healthz-echo` (test-only route) with `Content-Type: text/plain` and a JSON body → 415 `unsupported-media-type`.
  - `Semaphore(1, 1)`: three concurrent `run` calls → two resolve, one rejects `busy`. `TokenBucket(2, 2)`: third `take` within a second → `busy` with `retryAfterSeconds: 30`; after 30 s on the fake clock it passes.
  - `startRetention` with a failing job and a counting job → the counting job still runs each tick; the stop function stops it.
- [ ] **Step 2:** `npm test -- --project @x2f/api`; expect FAIL.
- [ ] **Step 3:** Implement. Add the Docker image line and `npm run migrate -w @x2f/api` to `docs/dev-setup.md`.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): skeleton, request budgets, retention and Postgres harness`.

### Task 4: Sessions, device cookie, origin check, throttle and alerts

**Files:**
- Create: `apps/api/migrations/002_sessions.sql`, `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/device.ts`, `apps/api/src/auth/origin.ts`, `apps/api/src/auth/throttle.ts`, `apps/api/src/auth/challenges.ts`, `apps/api/src/alerts.ts`
- Test: `apps/api/test/sessions.test.ts`, `apps/api/test/throttle.test.ts`, `apps/api/test/origin.test.ts`

**Interfaces:**
- Consumes: Task 3 (`Deps`, `ApiError`, `subkey`, `RetentionJob`), `AccountKind` from `@x2f/accounts`.
- Produces:
  - `002_sessions.sql`:
    - `sessions(id uuid pk, account_id uuid fk, token_hash bytea unique not null, level text check (level in ('full','recovery')), device_label text not null, onboarding_until timestamptz, created_at, last_seen_at, expires_at, revoked_at)`
    - `trusted_devices(account_id uuid fk, device_hash bytea, created_at, last_used_at, primary key (account_id, device_hash))`
    - `login_throttle(key text pk, failures int not null, last_failure_at timestamptz not null, alerted boolean not null default false)`
    - `daily_counts(key text, day date, count int not null, primary key (key, day))`
    - `challenges(id uuid pk, account_id uuid, session_id uuid, device_hash bytea, purpose text not null, method text not null, secret_hash bytea, webauthn_challenge text, payload jsonb not null default '{}', created_at timestamptz not null, expires_at timestamptz not null, used_at timestamptz)`
    - `alerts(id uuid pk, account_id uuid fk, kind text not null, detail jsonb not null, created_at, seen_at)`
  - `SESSION_COOKIE = '__Host-x2f_session'` (HttpOnly, Secure, SameSite=Strict, Path=/, no Domain); token 32 random bytes base64url; only its SHA-256 is stored.
  - `DEVICE_COOKIE = '__Host-x2f_dev'` (same attributes, Max-Age 400 days): `deviceHash(req): Buffer | null` = HMAC-SHA-256 under `subkey('device')` of the cookie value; `ensureDeviceCookie(req, reply)` sets a fresh random value when absent (called by every `/v1/register/*` and `/v1/login/*` route); `trustDevice(deps, accountId, hash)` upserts after each successful login or register; `isTrusted(deps, accountId, hash): Promise<boolean>`.
  - `sessionPolicy(kind: AccountKind, level: 'full' | 'recovery'): { idleMs: number; absoluteMs: number }` — trader full `7 d` / `30 d`; staff and owner full `2 h` / `12 h` (owner, 2026-10-17); any recovery session `25 h` / `48 h`.
  - `type LoginMethod = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-code'`
  - `startSession(deps, req, reply, a: { accountId: string; level: 'full' | 'recovery'; deviceLabel: string; method: LoginMethod; firstSession: boolean; holdUntil?: Date }): Promise<string /* sessionId */>` — always mints a new token (never reuses a presented cookie); if the request carried a valid session cookie, that session is revoked; sets `onboarding_until = now + 30 min` only when `firstSession`; trusts the device; adds alert `new-login` (or `recovery-login` with `{ holdUntil }`) with `{ method, deviceLabel }` unless `firstSession`. `deviceLabel` trimmed to 60 characters, from the client, never from headers.
  - `requireSession(opts?: { allowRecovery?: boolean; kinds?: AccountKind[]; allowStaleTerms?: boolean }): preHandler` — sets `req.auth = { sessionId, accountId, kind, level, onboardingUntil }`; 401 `not-authenticated` when missing, revoked, idle- or absolute-expired; 403 `account-disabled` when `accounts.disabled_at` is set (checked on every request, so a live session stops at once); 403 `recovery-session` when `level='recovery'` and not allowed; 403 `wrong-account-kind` when `kinds` is given and does not include the account's kind; 403 `terms-required` with `{ version: config.termsVersion }` when the account is a trader, its `terms_version` ≠ `config.termsVersion`, and `allowStaleTerms` is not set (R10). Default: full sessions of any kind. Touches `last_seen_at`. `allowStaleTerms: true` is used only by `POST /v1/logout`, `GET /v1/account/me`, `POST /v1/account/terms`, `GET /v1/account/methods` and `GET /v1/account/sessions`.
  - `assertNotDisabled(db, accountId)` — called by every login `finish` before `startSession`; 403 `account-disabled`.
  - `endSession(deps, sessionId)`; `endOtherSessions(deps, accountId, keepSessionId)`; `endAllSessions(deps, accountId)` (Plan 4 uses it when switching staff off); route `POST /v1/logout`.
  - Origin hook: every non-GET/HEAD request whose `Origin` header is absent, `null`, or not exactly equal to one entry of `config.origins` → 403 `origin-refused`. `requestOrigin(req): URL` returns the checked origin (Task 7 uses its host as `siteHost`).
  - Throttle (P2-C1). Only guessable secrets are throttled: `type ThrottledMethod = 'password' | 'totp' | 'recovery-code'`. Key: `<method>:<accountId | 'name:'+username_key>:<'dev:'+hex(deviceHash) when that device is trusted for the account, else 'anon'>`. `throttleKey(deps, req, method, account: { id: string } | { usernameKey: string }): Promise<string>`; `throttleCheck(deps, key)` throws 429 `slow-down` or `locked` with `retryAfterSeconds`; `throttleFail(deps, key, accountId: string | null)`; `throttleReset(deps, key)`. Values: failures 1–3 no wait; failures 4–9 wait `min(2^(n−3), 30)` s after the last failure (`slow-down`); from the 10th failure every check within 30 s of the last failure → `locked` (`retryAfterSeconds` ≤ 30) and one `login-locked` alert per streak; the count restarts 15 min after the last failure or on success. Checks during a wait are refused without checking credentials and add no failure. PGP codes and WebAuthn are never subject to these keys.
  - `dailyCap(deps, key: string, limit: number)` — increments `daily_counts` for the UTC day; above `limit` → 429 `slow-down` with `retryAfterSeconds` until 00:00 UTC.
  - `addAlert(db, accountId, kind: AlertKind, detail: object)`; `type AlertKind = 'new-login' | 'recovery-login' | 'recovery-hold-cancelled' | 'login-locked' | 'login-method-added' | 'login-method-removed' | 'sessions-ended' | 'wallet-added' | 'payout-wait-off-scheduled' | 'device-key-added'`.
  - `consumeChallenge(db, id, now): Promise<ChallengeRow | null>` — `update challenges set used_at = now where id = $1 and used_at is null and expires_at > now returning *`; the only way any code reads a challenge.
  - `purgeExpired: RetentionJob` — deletes challenges expired over 1 hour, sessions past `expires_at` or revoked over 1 hour ago, throttle rows idle over 1 hour, `daily_counts` older than 2 days, trusted devices unused 90 days, alerts older than 90 days (Task 5 extends it with confirm tokens). Registered in `main.ts`.
- Test fixture: `seedAccount(deps, { username, kind?, disabled? }): Promise<string>` inserts an account directly (tests only).

- [ ] **Step 1: Failing tests** (throwaway routes behind `requireSession`, fake clock):
  - A started session authenticates; after `endSession` → `not-authenticated`; trader after 7 days idle → `not-authenticated`; staff at 2 h idle → `not-authenticated`, at 1 h 59 min → still authenticated; a recovery session after 48 h → `not-authenticated`.
  - A recovery session on a route without `allowRecovery` → `recovery-session`; `kinds: ['trader']` with a staff session → `wrong-account-kind`.
  - Setting `disabled_at` on a logged-in account → its next request → 403 `account-disabled`.
  - Terms (R10): a trader whose `terms_version` is older than `config.termsVersion` → 403 `terms-required` with `version` on a plain route and passes a route with `allowStaleTerms`; a staff session with `terms_version` null passes. `endAllSessions` ends every session of the account.
  - Session fixation: a request carrying an attacker-chosen `__Host-x2f_session` value that then logs in receives a different token; the attacker's value stays `not-authenticated`. A login made while another valid session cookie is present revokes that session and replaces the cookie.
  - `Set-Cookie` for both cookies contains `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, and no `Domain`.
  - The stored row holds no raw token: `token_hash` ≠ cookie value and equals its SHA-256.
  - Origin: `https://evil.test` → 403; no `Origin` → 403; `Origin: null` → 403; `https://x2f.test.evil.com` (shares the prefix of `https://x2f.test`) → 403; `https://x2f.test` passes.
  - Throttle: 3 failures, 4th check passes; after the 4th failure a check within 2 s → `slow-down` with `retryAfterSeconds: 2`; after the 10th failure → `locked` with `retryAfterSeconds` ≤ 30 and exactly one `login-locked` alert; 31 s later a check passes; 15 minutes later the count is 0; works for a `name:` key with no account.
  - Device isolation: 10 `anon` failures for an account; a key built from a request with a trusted device cookie for that account → check passes, count 0; a device cookie trusted for *another* account counts as `anon`.
  - `dailyCap(key, 5)`: sixth call → `slow-down` with seconds until midnight UTC; the next UTC day it passes.
  - `consumeChallenge` called twice in parallel (`Promise.all`) returns one row and one `null`; an expired challenge returns `null`.
  - `purgeExpired` removes a 2-hour-expired challenge and a 91-day-old alert, keeps a fresh one.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with @fastify/cookie 11.1.2.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): sessions, device cookie, origin check, per-method throttle`.

### Task 5: Action-bound confirm-it's-you tokens

**Files:**
- Create: `apps/api/migrations/003_confirm.sql`, `apps/api/src/auth/confirm.ts`
- Modify: `apps/api/src/auth/challenges.ts` (`purgeExpired` also deletes confirm tokens expired over 1 hour)
- Test: `apps/api/test/confirm.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ConfirmAction`, `actionHash`), Task 4.
- Produces:
  - `003_confirm.sql`: `confirm_tokens(id uuid pk, session_id uuid fk, account_id uuid fk, token_hash bytea unique not null, action_hash text not null, created_at, expires_at timestamptz not null, used_at timestamptz)`.
  - `CONFIRM_TTL_MS = 5 * 60_000`.
  - `issueConfirmToken(deps, a: { sessionId: string; accountId: string; action: ConfirmAction }): Promise<string>` — 32 random bytes base64url; stores SHA-256 and `actionHash(action)`. Called only by the confirm `finish` routes (Tasks 6–8) after the person has proved it's them.
  - `redeemConfirm(deps, req, action: ConfirmAction, token: string | undefined): Promise<void>` — no token → 403 `confirm-required` with `{ action: action.kind }`; otherwise `update confirm_tokens set used_at = now where token_hash = $1 and session_id = $2 and action_hash = $3 and used_at is null and expires_at > now returning id`; no row → 403 `confirm-invalid`.
  - `requireConfirm(action: ConfirmAction | ((req) => ConfirmAction | Promise<ConfirmAction>), opts?: { onboarding?: boolean | ((req) => Promise<boolean>); recovery?: boolean }): preHandler` — reads `confirmToken` from the JSON body. `onboarding: true` lets the token be omitted while the session's `onboarding_until > now`; a function adds the route's own predicate on top (Task 12: first wallet only). `recovery: true` lets a recovery session through without a token (used only by the add-method routes; Task 9 adds the hold check there). Confirm routes themselves require a full session; recovery sessions cannot confirm.
  - The confirm routes themselves live with each method: `POST /v1/confirm/password` (Task 6), `/v1/confirm/pgp/start|finish` (Task 7), `/v1/confirm/webauthn/start|finish` (Task 8); each takes `action: ConfirmAction` and ends with `{ confirmToken }`.

- [ ] **Step 1: Failing tests** (issue tokens directly with `issueConfirmToken`; a throwaway route `POST /t/add-wallet` behind `requireConfirm(req => ({ kind: 'add-wallet', addressHash: sha(req.body.address), addressEnd: end(req.body.address) }))`):
  - No token → 403 `confirm-required`.
  - A token for address A used on address B → `confirm-invalid`; then the same token on A still works (a mismatch does not consume it); used twice → second `confirm-invalid`.
  - A token issued to session S used from session T of the same account → `confirm-invalid`.
  - A token at exactly 5:00 after issue → `confirm-invalid`; at 4:59 → ok.
  - A token for `{ kind: 'add-method', method: 'passkey' }` on the add-wallet route → `confirm-invalid`.
  - Two parallel redemptions of one token → one success, one `confirm-invalid`.
  - A login 10 seconds ago does not exempt a non-onboarding route (no `FRESH_MS` remains).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): action-bound confirm tokens`.

### Task 6: Password sign-up, login and confirm

**Files:**
- Create: `apps/api/migrations/004_passwords.sql`, `apps/api/src/auth/leaked.ts`, `apps/api/src/auth/password.ts`, `apps/api/src/accounts.ts`, `tools/leaked/build-leaked-list.ts`
- Modify: `docs/dev-setup.md` (leaked-list subset and measured file size)
- Test: `apps/api/test/password.test.ts`, `apps/api/test/leaked.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5.
- Produces:
  - `004_passwords.sql`: `passwords(account_id uuid pk fk, hash text not null, updated_at)`.
  - Leaked list file: sorted, fixed-width 20-byte SHA-1 records, no header. `buildLeakedList(lines: AsyncIterable<string>, out: string, minCount = 10): Promise<number>` reads Have I Been Pwned `SHA1HEX:COUNT` lines (official downloader, run by the operator, never by the server), keeps only `COUNT ≥ minCount`, refuses unsorted input, returns records written. CLI: `tsx tools/leaked/build-leaked-list.ts <in.txt> <out.bin> [--min-count 10]`. The operator records the output size in `docs/dev-setup.md`.
  - `interface LeakedList { has(password: string): Promise<boolean> }`; `openLeakedList(path): Promise<LeakedList>` — SHA-1 of `normalizePassword(pw)` as UTF-8, binary search with positioned reads; throws at startup if the file is missing or its size is not a multiple of 20.
  - `createAccount(db: pg.PoolClient, a: { username: string; key: string; kind: AccountKind; termsVersion: string | null; now: Date }): Promise<string>` — unique violation on `username_key` → 409 `username-taken`; random 32-byte `webauthn_user_id`; stores `terms_version` and `terms_accepted_at = now` (both null when `termsVersion` is null). Plan 4 uses this for staff and the owner with `termsVersion: null`.
  - `assertTermsAccepted(deps, acceptedTerms: unknown): string` (R10) — returns the version when it equals `config.termsVersion`, else 400 `terms-not-accepted` with `{ version: config.termsVersion }`. Called by every register finish (`/v1/register/password`, `/v1/register/pgp/finish`, `/v1/register/webauthn/finish`) before any hashing or account creation.
  - `assertUsername(input): { username: string; key: string }` — 400 `username-invalid` / `username-reserved`.
  - `hashPassword(pw): Promise<string>`, `verifyPassword(hash, pw): Promise<boolean>` — argon2id with the Global Constraints parameters on `normalizePassword(pw)`, both run inside `ARGON2_SLOTS`. `DUMMY_HASH` — computed once at startup from a random password; verified when the account is unknown, has no password, or its kind may not use passwords, so timing does not reveal any of these.
  - `assertNewPassword(deps, pw)` — 400 `password-weak` with `missing`, then 400 `password-leaked`.
  - Routes (all set the device cookie; `register` takes from `REGISTER_BUCKET`, `login` from `START_BUCKET`; body limit 4 KiB → 413 before hashing):
    - `POST /v1/register/password { username, password, deviceLabel, acceptedTerms }` → 201 `{ username }` (first session).
    - `POST /v1/login/password { username, password, deviceLabel }` → `{ status: 'ok' }` or `{ status: 'second-factor', pendingId }` (wired in Task 9). Wrong username, wrong password, or no password → 401 `credentials-invalid` and `throttleFail` on the `password` key.
    - `POST /v1/confirm/password { password, totp?, action }` (full session) → `{ confirmToken }` for `action`. Wrong password → `credentials-invalid` counted on the account's `password` key (with the device scoping of Task 4).
- `passwordAllowed(kind)` is defined in Task 10; until then, password routes create and accept only `kind='trader'`.

- [ ] **Step 1: Failing tests** (fixture list built by `buildLeakedList` from `Password123!:50`, `Summer2024!x:12`, `Tr0ub4dor&3x:11`, `Rare-Pass-77x:3`):
  - `has('Password123!')` true; `has('Rare-Pass-77x')` false (count < 10); `has('Correct-Horse-9')` false; unsorted input → throws.
  - Terms (R10): register without `acceptedTerms`, or with an older version → 400 `terms-not-accepted` with `version`, no `accounts` row, `argon2.hash` not called; with the current version → 201 and the row's `terms_version` equals it.
  - Register `Satoshi.N` / `Correct-Horse-9` → 201, cookie set, `passwords.hash` starts with `$argon2id$v=19$m=65536,t=3,p=1$`, no `new-login` alert.
  - Register `satoshi.n` afterwards → 409 `username-taken`; `X2F.Support` → `username-reserved`; `badminton` → 201.
  - `Password123!` → 400 `password-leaked`; `password` → 400 `password-weak` with `missing` containing `upper`, `number`, `symbol`, `length`.
  - Login with the right password → `{ status: 'ok' }` and one `new-login` alert; wrong password → `credentials-invalid`; the 4th wrong attempt within 2 s → 429 `slow-down`.
  - Same shape (P2-I7): unknown username, a PGP-only account and a wrong password all give 401 `{ error: 'credentials-invalid' }` with identical keys, and a spy shows `argon2.verify` called exactly once in each case.
  - `POST /v1/confirm/password` with the right password and `action: { kind: 'set-password' }` → `confirmToken` that redeems for that action only; a wrong password counts on the same `password` key as login.
  - Budgets: with `ARGON2_SLOTS` replaced by `Semaphore(1, 0)` and a slow verify stub, two concurrent logins → one 401, one 503 `busy`; the 21st register within a minute → 503 `busy`.
  - The captured `logs` during register and login contain neither the password nor the cookie value nor the username.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with argon2 0.45.1.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): password accounts with leaked-list check and budgets`.

### Task 7: PGP sign-up, login, confirm and adding a key

**Files:**
- Create: `apps/api/migrations/005_pgp.sql`, `apps/api/src/auth/pgp.ts`, `apps/api/src/auth/login.ts`
- Modify: `apps/api/src/main.ts` (load the signing key at startup), `apps/api/test/helpers/app.ts` (a test signing key generated once per run)
- Test: `apps/api/test/pgp.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6 (`createAccount`, `assertUsername`), `newLoginCode`, `normalizeLoginCode`.
- Produces:
  - `005_pgp.sql`: `pgp_keys(id uuid pk, account_id uuid fk, fingerprint text unique not null, armored_enc bytea not null, created_at, last_used_at)` (R16).
  - R16 (owner, 2026-10-17: email in keys is never recorded or used): before storing, `storableKey(armored)` removes every user ID packet and its certifications when the key stays usable without them (v6 keys); otherwise (v4) the key is kept whole. Either way the armored text is stored only as `armored_enc` = AES-256-GCM under `subkey('pgp-key')` (Task 3's `subkey` label union gains `'pgp-key'`), random 12-byte nonce prepended, and decrypted only in memory to encrypt a challenge. User IDs are never returned by any route, logged, searched or compared. Tests: a v6 key with `name <a@b.c>` is stored with no user ID and still receives a challenge it can decrypt; a v4 key with an email is stored whole; neither `pgp_keys` row nor any log line contains `a@b.c` or `-----BEGIN`; `GET` routes never include a user ID.
  - `interface PgpSigner { key: openpgp.PrivateKey; fingerprint: string; publicArmored: string }`; `loadPgpSigner(path: string, expectedFingerprint: string): Promise<PgpSigner>` (R7) — reads the file, refuses a public-only or passphrase-protected key, and throws naming `X2F_PGP_SIGNING_FINGERPRINT` when the key's fingerprint differs; `main.ts` calls it before listening and exits on error. Every message from `issuePgpChallenge` and `decoyPgpChallenge` is signed with `deps.pgpSigner.key`.
  - `GET /v1/pgp/signing-key` (no session) → `{ fingerprint, publicKey }` — the public half only, for the site and the FAQ.
  - `completeLogin(deps, req, reply, a: { account: { id: string; kind: AccountKind }; factor: LoginFactor; pendingId?: string; deviceLabel: string; afterAuthenticate?: (accountId: string) => Promise<void> }): Promise<{ status: 'ok' } | { status: 'second-factor'; pendingId: string; needs: MethodType[] }>` in `login.ts`, with `type LoginFactor = { method: 'pgp'; fingerprint: string } | { method: 'passkey' | 'security-key'; credentialId: string; attested: boolean }` — the one way every PGP and WebAuthn login finish ends: runs `afterAuthenticate`, `assertNotDisabled`, then for a trader `startSession`. For staff and the owner it answers 403 `method-not-allowed` until Task 10 replaces that branch with the two-factor flow (R1).
  - `pgpLoginRoutes(app, opts: { kinds: AccountKind[]; afterAuthenticate?: (accountId: string) => Promise<void> })` — registers the login `start` and `finish` routes below under the plugin's prefix; an account whose kind is not in `kinds` is treated as an unknown username (decoy). `buildApi` mounts it at `/v1/login/pgp` with `kinds: ['trader', 'staff', 'owner']`; Plan 4 mounts it on the staff app.  - `issuePgpChallenge(deps, req, a: { accountId: string | null; sessionId: string | null; purpose: 'register' | 'login' | 'confirm' | 'add-key'; purposeText: string; armoredKeys: string[]; payload: object }): Promise<{ challengeId: string; encryptedMessage: string; expiresAt: string }>` — `siteHost` = host of `requestOrigin(req)`; stores SHA-256 of the normalized code, `device_hash`, `expires_at = now + 5 min`. Login challenges: a new one marks earlier unused login challenges for the same account *and the same device hash* as used; at most 3 unused login challenges per account (the oldest is marked used beyond that); more than 5 login challenges per account and device in 5 minutes → 429 `slow-down` (never `locked`).
  - `decoyPgpChallenge(deps, req): Promise<same shape>` — a real code encrypted (wildcard) to a throwaway Ed25519 key generated per process start, stored as a challenge with `account_id = null` so `finish` fails exactly like a wrong code; same 5-minute expiry.
  - `checkPgpCode(deps, challengeId, code, expected: { purpose; accountId?: string; sessionId?: string }): Promise<ChallengeRow>` — `consumeChallenge`; purpose, account and session must match the row (mismatch → 400 `challenge-expired`); for `confirm` and `add-key` the row's session must still be live; code compared with `crypto.timingSafeEqual`; wrong code → 401 `code-invalid` (the challenge stays consumed); unknown, used or expired → 400 `challenge-expired`. PGP codes are not throttled (60-bit, single-use).
  - Routes:
    - `POST /v1/register/pgp/start { username, publicKey }` → `{ challengeId, encryptedMessage, expiresAt, fingerprint }`; key refusals → 400 with `KeyRefusal` and `detail` (the person's own pasted key, so the date is fine here); `username-taken` checked here; fingerprint clashes are *not* checked here.
    - `POST /v1/register/pgp/finish { challengeId, code, deviceLabel, acceptedTerms }` → 201 (`assertTermsAccepted` first); creates account and key in one transaction; a fingerprint already on any account → 409 `key-in-use` (only after the code proves the key).
    - `POST /v1/login/pgp/start { username, refreshedKey?, pendingId? }` → encrypts to every stored key of the account that `inspectPublicKey` accepts now; with `pendingId` (the second step of a staff or owner login, Task 10) it leaves out the key whose fingerprint the first factor used, and an unknown, used or other-account `pendingId` gets a decoy. Unknown username, account with no PGP key, or a `refreshedKey` whose fingerprint matches no stored key → decoy (same shape). Every stored key expired → 400 `{ error: 'key-expired' }` with no date, no fingerprint, no `detail`; revoked → `key-revoked` likewise. `refreshedKey` must pass inspection and replaces the stored armor only after `finish`. If `encryptChallenge` throws for a key that `inspectPublicKey` accepted (e.g. its only strong encryption subkey has expired while the primary has not, leaving a weak or no usable subkey; R15), treat that key as not usable now: if no stored key is usable the answer is 400 `{ error: 'key-expired' }` with no other field (the same wording as an expired key, even though the cause may be a subkey); never fall back to a weaker subkey.
    - `POST /v1/login/pgp/finish { challengeId, code, deviceLabel, pendingId? }` → `completeLogin` with `{ method: 'pgp', fingerprint }`.
    - `POST /v1/confirm/pgp/start { action }` (full session) → challenge with `purposeText = describeAction(action)`, `payload = { actionHash }`; `/finish { challengeId, code }` → `{ confirmToken }` for exactly that action.
    - `POST /v1/account/pgp/start { publicKey, confirmToken? }` and `/finish { challengeId, code }` — guarded at `start` by `requireConfirm({ kind: 'add-method', method: 'pgp' }, { onboarding: true, recovery: true })` (Task 9 adds the hold check for recovery sessions); adds the key, alert `login-method-added` `{ method: 'pgp', fingerprint }`; fingerprint clash → `key-in-use` at `finish`.

- [ ] **Step 1: Failing tests** (fixed clock `2026-10-15T12:00:00Z`, `Origin: https://x2f.test`, second origin `http://x2fexample.onion`):
  - Register with an Ed25519 key: the decrypted text contains `X2F login code: `, `Site: X2F (x2f.test)`, `Purpose: create your account`, `Time: 2026-10-15T12:00:00Z`, `Expires: 2026-10-15T12:05:00Z`; the code in lower case without dashes → 201. The same flow with `Origin: http://x2fexample.onion` → `Site: X2F (x2fexample.onion)`.
  - The message's PKESK packets all have wildcard key IDs.
  - Signing (R7): register, login, confirm, add-key and decoy messages each decrypt with `expectSigned: true` against the test signing key's public half; `GET /v1/pgp/signing-key` returns `config.pgpSigningFingerprint` and a public key containing no `PRIVATE KEY`; `loadPgpSigner` with a different expected fingerprint throws naming `X2F_PGP_SIGNING_FINGERPRINT`; with a public-only key file it throws.
  - Login: the code works once; again → `challenge-expired`; at exactly `12:05:00` → `challenge-expired`; at `12:04:59` → ok.
  - A wrong code → `code-invalid`; 20 wrong codes do not stop a correct login on a fresh challenge (no throttle on PGP).
  - Challenge DoS (P2-I3): browser A starts a login; browser B (no device cookie) calls `start` 5 times → A's challenge still finishes; B's 6th start within 5 minutes → `slow-down`; A's second `start` invalidates A's first.
  - Binding: a `login` code submitted to `/v1/confirm/pgp/finish` and to `/v1/register/pgp/finish` → `challenge-expired`; a `confirm` challenge started by session A finished by session B → `challenge-expired`; an `add-key` challenge of account X finished by account Y → `challenge-expired`; a `confirm` challenge after its session logged out → `challenge-expired`.
  - Two parallel `finish` calls with the right code → one 200, one `challenge-expired`.
  - Enumeration (P2-C3, P2-I7): `login/pgp/start` for an unknown username, for a password-only account and for a real PGP account return 200 with the same keys (`challengeId`, `encryptedMessage`, `expiresAt`); the decoy's `finish` with its own decrypted code → 401 `code-invalid`.
  - A private key at sign-up → 400 `key-private`; nothing stored in `pgp_keys` or `challenges.payload`; `logs` contain no `PRIVATE KEY`.
  - A key expired after sign-up: login start → 400 `{ error: 'key-expired' }` with no other field; with the same key re-signed to a later expiry as `refreshedKey` → challenge issued; after `finish` the stored armor is the refreshed one. A `refreshedKey` with a different fingerprint → decoy.
  - Key reuse: `register/pgp/start` with a fingerprint already on another account → 200 challenge; `finish` with the right code → 409 `key-in-use`; `start` alone never reveals it.
  - Adding a second key without a confirm token outside onboarding → 403 `confirm-required`; with a token from `confirm/pgp` for `{ kind: 'add-method', method: 'pgp' }` → added, alert written, and a login challenge decrypts with either key. The confirm message's `Purpose:` line reads `add a login method (pgp)`.
  - A disabled account with the right code → 403 `account-disabled`.
  - A 40 KiB `publicKey` → 400 `key-too-large`.
  - Until Task 10: a staff account's correct code → 403 `method-not-allowed` and no session; `afterAuthenticate` throwing `ApiError(403, 'account-disabled')` on a test mount stops a trader login before any session.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): PGP challenge sign-up, login and confirm`.

### Task 8: Passkeys and security keys (WebAuthn), with attestation for staff and owner

**Files:**
- Create: `apps/api/migrations/006_webauthn.sql`, `apps/api/src/auth/webauthn.ts`, `apps/api/src/auth/attestation.ts`, `apps/api/data/fido-mds/README.md` (source URL, snapshot date, AAGUID allowlist), `apps/api/data/fido-mds/*.json` (MDS3 statements for the allowlisted YubiKey 5 series AAGUIDs), `apps/api/test/helpers/softAuthenticator.ts`, `apps/api/test/helpers/cbor.ts`
- Test: `apps/api/test/webauthn.test.ts`, `apps/api/test/attestation.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 6; @simplewebauthn/server 14.0.3 (`MetadataService`, `verifyRegistrationResponse`, `verifyAuthenticationResponse`).
- Produces:
  - `006_webauthn.sql`: `webauthn_credentials(id uuid pk, account_id uuid fk, credential_id bytea unique not null, public_key bytea not null, counter bigint not null, kind text check (kind in ('passkey','security-key')), transports text[], backed_up boolean not null, device_type text not null, attested boolean not null default false, aaguid uuid, label text not null, created_at, last_used_at)`.
  - `interface AttestationPolicy { init(): Promise<void>; isAllowed(aaguid: string, fmt: string): boolean }`; `fileAttestationPolicy(dir: string): AttestationPolicy` — `init` calls `MetadataService.initialize({ verificationMode: 'strict', statements })` with the repo snapshot (no network fetch); `isAllowed` = `fmt !== 'none'` and `aaguid` in the README's allowlist. Tests inject a policy built from a test statement whose root is the soft authenticator's test CA.
  - `registrationOptionsFor(kind: 'passkey' | 'security-key', accountKind: AccountKind)` — passkey: `residentKey: 'required'`, `userVerification: 'required'`; security key: `residentKey: 'discouraged'`, `userVerification: 'preferred'`, `authenticatorAttachment: 'cross-platform'`. `attestationType: 'none'` for traders, `'direct'` for staff and owner. `supportedAlgorithmIDs: [-8, -7, -257]`, `userID` = `accounts.webauthn_user_id` (never the username), `excludeCredentials` = the account's credentials. Timeout 5 minutes; challenge in `challenges.webauthn_challenge`, with `payload.actionHash` for confirms.
  - `assertCredentialAllowed(accountKind, info: { kind: string; attested: boolean }): void` — owner: only `kind='security-key'` with `attested=true`; staff: `kind='security-key'` with `attested=true`, or `kind='passkey'` (unattested), which Task 10's `pairAllowed` accepts only as the partner of PGP (R1); device-type and backup flags are self-reported and never trusted for this; otherwise 403 `method-not-allowed`. Staff passkey registration uses `attestationType: 'none'`.
  - Exported for Plan 4 (wrapping the internals above): `webauthnRegistrationOptions(deps, accountId, o?: { kind?: 'passkey' | 'security-key'; challenge?: Uint8Array })` (default `security-key`), `verifyWebAuthnRegistration(deps, accountId, response, expectedChallenge): Promise<{ credentialId: string; kind: 'passkey' | 'security-key'; attested: boolean; aaguid: string | null }>` (stores the credential after `assertCredentialAllowed`), `webauthnAssertionOptions(deps, accountId, challenge: Uint8Array)`, `verifyWebAuthnAssertion(deps, accountId, response, expectedChallenge): Promise<{ credentialId: string; kind: 'passkey' | 'security-key'; attested: boolean }>`.
  - `securityKeyLoginRoutes(app, opts: { kinds: AccountKind[]; afterAuthenticate?: (accountId: string) => Promise<void> })` — the username-based WebAuthn login `start` and `finish` below; an account whose kind is not in `kinds` gets decoy options. `buildApi` mounts it at `/v1/login/webauthn` alongside the discoverable route, with `kinds: ['trader', 'staff', 'owner']`; Plan 4 mounts it on the staff app.
  - Routes:
    - `POST /v1/register/webauthn/start { username, kind }` → `{ challengeId, options }`; `/finish { challengeId, response, deviceLabel, label?, acceptedTerms }` → 201 (`assertTermsAccepted` first).
    - `POST /v1/login/webauthn/start {}` (no username: discoverable passkey login, traders) → options with `allowCredentials: []`, `userVerification: 'required'`. `finish` finds the credential by ID; the assertion's `userHandle` must equal that account's `webauthn_user_id`.
    - `POST /v1/login/webauthn/start { username, pendingId? }` (security keys; staff and owner use this) → `allowCredentials` = the account's `security-key` credentials, plus its passkeys when the account is staff and `pendingId` names a pending login whose first factor was PGP; unknown username or no security keys → decoy options whose credential IDs are HMAC-SHA-256(`subkey('decoy')`, `username_key` ‖ i) for i < 1 + (first HMAC byte mod 2), so repeated calls are identical. `finish` requires the credential to belong to `challenge.account_id`.
    - `/v1/login/webauthn/finish { challengeId, response, deviceLabel, pendingId? }` → `assertCredentialAllowed`, then `completeLogin` with `{ method: credential.kind, credentialId, attested }`.
    - `POST /v1/confirm/webauthn/start { action }` / `finish { challengeId, response }` (full session) → `{ confirmToken }`; the challenge is bound to the session and `actionHash`.
    - `POST /v1/account/webauthn/start { kind, confirmToken? }` / `finish { challengeId, response, label }` — `requireConfirm(req => ({ kind: 'add-method', method: req.body.kind }), { onboarding: true, recovery: true })` (Task 9 adds the hold check) → alert `login-method-added`.
  - Verification: `expectedOrigin: config.origins`, `expectedRPID: config.rpId`, `expectedType: 'webauthn.create' | 'webauthn.get'`, user presence always required, `requireUserVerification` true for passkey registration *and* passkey login; any verification error → 401 `webauthn-failed` (no throttle: WebAuthn cannot be guessed). Counter: store `newCounter`; a non-zero counter that does not increase → `webauthn-failed`. Expired challenge → `challenge-expired`.
- Test helper: `createSoftAuthenticator(o: { backedUp: boolean; userVerified: boolean; userPresent?: boolean; attestation?: 'none' | { aaguid: string; ca: TestCa } }): { register(options, origin: string, o?: { rpId?: string }): RegistrationResponseJSON; authenticate(options, origin: string, o?: { rpId?: string; type?: string }): AuthenticationResponseJSON; setCounter(n: number): void; credentialId: string }` — ES256 key from `node:crypto`; `none` or `packed` (x5c leaf signed by `TestCa`) attestation; encode-only CBOR helper (maps, byte and text strings, integers) in `cbor.ts`; flags UP, UV, AT, BE/BS set from the options.

- [ ] **Step 1: Failing tests:**
  - Register a passkey, then log in with no username (discoverable); `last_used_at` updated; a `new-login` alert written.
  - Origin `https://evil.test` at login → `webauthn-failed`; at registration → `webauthn-failed`.
  - `rpIdHash` for `other.test` → `webauthn-failed`.
  - A replayed login response (same challenge) → `challenge-expired`; a challenge used after 5:00 → `challenge-expired`.
  - `setCounter` below the stored counter → `webauthn-failed`.
  - UP flag clear → `webauthn-failed`; UV clear at passkey registration → `webauthn-failed`; UV clear at passkey login → `webauthn-failed`.
  - `clientDataJSON.type` `webauthn.create` on a login → `webauthn-failed`.
  - Account A's security-key assertion submitted to account B's username challenge → `webauthn-failed`.
  - `userID` in the options decodes to 32 bytes that do not contain the username.
  - Same shape (P2-I7): `login/webauthn/start { username }` for an unknown name and for a passkey-only account return options with the same keys as a real security-key account, and two calls for the same unknown name return identical `allowCredentials`.
  - Attestation (P2-I5): a staff registration with `none` attestation and flags `singleDevice`/not backed up → `method-not-allowed`; `packed` from the test CA with an allowlisted AAGUID → stored with `attested = true`; `packed` with an unlisted AAGUID → `method-not-allowed`; a trader passkey with `none` → accepted.
  - Owner login with a passkey credential inserted directly (`attested = false`) → `method-not-allowed`; a staff passkey passes `assertCredentialAllowed` (the pair rule is tested in Task 10).
  - `verifyWebAuthnRegistration` for a staff account with `packed` attestation and an allowlisted AAGUID returns `attested: true` and stores the row; `verifyWebAuthnAssertion` with another account's credential → `webauthn-failed`.
  - Adding a second security key with a confirm token from `confirm/webauthn` → two credentials; the username login options list both. A confirm token from a WebAuthn confirm for `add-method:passkey` does not redeem for `add-wallet`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Fetch the MDS3 blob once by hand, extract the YubiKey 5 series statements, and record source URL, date and SHA-256 in `apps/api/data/fido-mds/README.md`.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): passkeys and attested security keys`.

### Task 9: TOTP, recovery codes and the backup login hold

**Files:**
- Create: `apps/api/migrations/007_totp_recovery.sql`, `apps/api/src/auth/totp.ts`, `apps/api/src/auth/recovery.ts`
- Modify: `apps/api/src/auth/password.ts` (second-factor branch; `confirm/password` requires `totp` when enrolled), `apps/api/src/auth/pgp.ts` and `apps/api/src/auth/webauthn.ts` (call `assertHoldPassed` in the add-method `start` routes)
- Test: `apps/api/test/totp.test.ts`, `apps/api/test/recovery.test.ts`

**Interfaces:**
- Consumes: Tasks 4–8; otpauth 9.5.2; `newRecoveryCode`, `normalizeRecoveryCode`.
- Produces:
  - `007_totp_recovery.sql`: `totp(account_id uuid pk fk, secret_enc bytea not null, last_step bigint not null default 0, created_at)`; `recovery_codes(id uuid pk, account_id uuid fk, code_hash bytea unique not null, used_at timestamptz)`; `alter table sessions add column hold_until timestamptz`.
  - No patterns (owner, spec 6.2): the TOTP secret is 20 bytes from `crypto.randomBytes` per enrolment, never derived from the username, account ID, time, a counter, `serverKey` or any shared seed; recovery codes come only from `newRecoveryCode()` (80 bits from `getRandomValues`, bias-free). No other source of randomness is allowed for either.
  - TOTP: 20-byte secret, `issuer: 'X2F'`, `label: <username>`, SHA1, 6 digits, period 30, window ±1 step. `sealSecret(deps, secret) / openSecret(deps, sealed)` — AES-256-GCM under `subkey('totp')`, random 12-byte nonce prepended; used both in `totp.secret_enc` and in the enrolment challenge's `payload` (never plaintext). `verifyTotp(deps, accountId, code): Promise<boolean>` accepts only a matching step greater than `last_step` and sets it in the same statement (`… where last_step < $step`).
  - `RECOVERY_HOLD_MS = 24 * 3_600_000`; `TOTP_BACKUP_DAILY = 5`.
  - Routes:
    - `POST /v1/account/totp/start { confirmToken? }` (`requireConfirm({ kind: 'add-method', method: 'totp' }, { onboarding: true })`) → `{ challengeId, otpauthUri, secret }`; `/finish { challengeId, code }` → enrolls, alert `login-method-added`.
    - `POST /v1/login/second-factor { pendingId, code }` → completes the password login (`pendingId` is a `challenges` row, purpose `second-factor`, 5 minutes); failures on the account's `totp` throttle key.
    - `POST /v1/account/recovery-codes { confirmToken? }` (`requireConfirm({ kind: 'new-recovery-codes' }, { onboarding: true })`) → `{ codes: string[] }`, 10 new codes replacing old ones; stored as SHA-256 of the normalized code.
    - `POST /v1/login/backup { username, kind: 'totp' | 'recovery-code', code, deviceLabel }` → starts a `level='recovery'` session. `recovery-code`: consumed with `update … set used_at = now where code_hash = $1 and used_at is null returning`, no hold, failures on the `recovery-code` key. `totp`: `dailyCap('backup-totp:<accountId|name>', 5)` then the `totp` key; on success `hold_until = now + 24 h`, alert `recovery-login` `{ method: 'totp', holdUntil }` at once. Unknown usernames take the same path and fail the same way.
    - `DELETE /v1/account/recovery-sessions/:id` (any full session of the account) → ends that recovery session, alert `recovery-hold-cancelled`.
  - `assertHoldPassed(req)` — hold rule for the add-method routes of Tasks 7, 8 and 10 (and `PUT /v1/account/password`): a recovery session may add a primary method only when `hold_until` is null or `now ≥ hold_until`; otherwise 403 `recovery-hold` with `{ holdUntil }`. A recovery session never becomes full; the person logs in with the newly added method, which creates a new full session.
  - Password login when TOTP is enrolled returns `{ status: 'second-factor', pendingId }` and no session until the code is accepted.

- [ ] **Step 1: Failing tests** (clock-driven, codes computed with otpauth in the test):
  - Enroll TOTP; `otpauthUri` starts with `otpauth://totp/X2F:` and contains `digits=6&period=30`; neither `totp.secret_enc` nor the enrolment challenge's `payload` contains the raw secret bytes or its base32 form.
  - Replay order (P2-I2), on a fresh enrolment at step S: the S−1 code → accepted; the same S−1 code again → refused; the S code → accepted; S again → refused; then S−1 → refused; a code from S−2 (−60 s) on a new enrolment → refused.
  - Wrong codes at `login/second-factor` reach `slow-down` on the 4th failure; a correct passkey login for the same account still succeeds meanwhile.
  - `confirm/password` without `totp` once enrolled → 401 `credentials-invalid`.
  - No patterns: 1,000 TOTP enrolments (across accounts, and re-enrolling one account) give 1,000 distinct secrets, and a chi-square test of the 256 byte-value counts over their 20,000 bytes stays below 345 (255 degrees of freedom); two accounts with the same username at different times, or the same account re-enrolled, never share a secret; 10,000 recovery codes are all distinct and, for each of the 16 positions, a chi-square test of the 32 symbol counts stays below 76 (31 degrees of freedom). Together the 17 checks raise a false alarm about once in 3,000 runs (R9); a bias check, not a proof.
  - Recovery codes: 10 returned, matching the trade-code format, all distinct; one logs in once (`level='recovery'`, `hold_until` null, `recovery-login` alert); its second use fails; regenerating invalidates the old set.
  - TOTP backup (P2-I1): a correct code → recovery session with `hold_until = now + 24 h` and a `recovery-login` alert written at once; `POST /v1/account/pgp/start` at +23:59:59 → `recovery-hold`; at +24:00:00 → allowed. A full session calling `DELETE /v1/account/recovery-sessions/:id` ends it (next request `not-authenticated`). The 6th backup TOTP attempt in one UTC day → `slow-down`, even with a correct code.
  - A recovery session on a full-only route → `recovery-session`; it cannot obtain a confirm token (`confirm/password` → `recovery-session`).
  - A disabled account's correct recovery code → `account-disabled` and the code stays unused.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): TOTP, recovery codes and held backup login`.

### Task 10: Login-method policy, listing and removal; staff and owner primitives

**Files:**
- Create: `apps/api/src/auth/methods.ts`
- Modify: `apps/api/src/auth/password.ts`, `pgp.ts`, `webauthn.ts`, `totp.ts`, `recovery.ts` (call `assertMethodAllowed` before adding; R2), `login.ts` (two-factor branch of `completeLogin`; R1)
- Test: `apps/api/test/methods.test.ts`

**Interfaces:**
- Consumes: Tasks 4–9; `MethodType` from `@x2f/accounts`.
- Produces:
  - `PRIMARY: MethodType[] = ['pgp', 'passkey', 'security-key', 'password']`.
  - `allowedMethods(kind: AccountKind): MethodType[]` — trader: all six; staff: `['pgp', 'security-key', 'passkey']`; owner: `['pgp', 'security-key']`. `passwordAllowed(kind)` = `allowedMethods(kind).includes('password')`. Recovery codes are therefore refused for staff and owner (R2): `POST /v1/account/recovery-codes` → 403 `method-not-allowed`, and `/v1/login/backup` for a staff or owner username takes the unknown-username path and gives the same response.
  - Two factors for staff and owner (R1): `pairAllowed(kind, a: LoginFactor, b: LoginFactor): boolean` — owner: one `pgp` and one `security-key` with `attested`; staff: `pgp` + attested `security-key`, `pgp` + `pgp` with different fingerprints, or `pgp` + `passkey`; `passkey` + `security-key` and two WebAuthn factors are never a pair. `needsAfter(kind, first: LoginFactor): MethodType[]` — owner after `pgp` → `['security-key']`, after `security-key` → `['pgp']`; staff after `pgp` → `['pgp', 'security-key', 'passkey']`, after `security-key` or `passkey` → `['pgp']`.
  - `completeLogin`, staff and owner branch: without `pendingId` it stores a `challenges` row (purpose `second-factor`, method `pair`, the account, the device hash, `payload = { first: LoginFactor }`, 5 minutes, the same table and lifetime as Task 9's password second factor) and returns `{ status: 'second-factor', pendingId, needs: needsAfter(kind, factor) }` with no session; with `pendingId` it calls `consumeChallenge`, requires purpose `second-factor`, the same account and the same device hash (else 400 `challenge-expired`), then `pairAllowed(kind, payload.first, factor)` (else 403 `method-not-allowed`; the pending row stays consumed) and only then `startSession` with `method` = the second factor.
  - `assertMethodAllowed(kind, method)` → 403 `method-not-allowed`.
  - `listMethods(db, accountId): Promise<Array<{ type: MethodType; id: string; label: string; createdAt: string; lastUsedAt: string | null }>>` (PGP label = last 16 hex of the fingerprint; recovery codes as one entry with `label: '<n> left'`).
  - `removeMethod(deps, req, type, id)` — 409 `last-login-method` when it would leave no primary method, when an owner would keep fewer than 2 attested security keys or no PGP key, or when a staff account would keep no valid pair (at least one PGP key plus a second PGP key, an attested security key or a passkey); alert `login-method-removed`; then `endOtherSessions` and alert `sessions-ended`.
  - `ownerReady(db, ownerId): Promise<boolean>` — true when the owner has at least 2 `security-key` credentials with `attested = true` and at least 1 PGP key (R1). Plan 4's owner setup calls it before locking the setup page.
  - Routes: `GET /v1/account/methods` (recovery allowed, `allowStaleTerms`); `PUT /v1/account/password { password, confirmToken? }` (`requireConfirm({ kind: 'set-password' }, { onboarding: true, recovery: true })` plus `assertHoldPassed`; sets or replaces; alert `login-method-added`; ends other sessions); `DELETE /v1/account/methods/:type/:id { confirmToken }` (`requireConfirm({ kind: 'remove-method', method: type, id })`, full only).

- [ ] **Step 1: Failing tests:**
  - A PGP-only trader removing their key → `last-login-method`; after adding a passkey, removing the key with a matching confirm token succeeds, writes an alert, and a second session of that account → `not-authenticated` (P2-I6).
  - `PUT /v1/account/password` ends every other session; the calling session continues.
  - A trader whose only primary method is a password (plus TOTP and recovery codes) cannot remove the password.
  - Staff (`seedAccount({ kind: 'staff' })`): `PUT /v1/account/password`, `POST /v1/account/totp/start` and `POST /v1/account/recovery-codes` → `method-not-allowed`; adding PGP and a passkey works. Recovery-code rows inserted directly for a staff account: `/v1/login/backup` with a correct code gives the same response as an unknown username and starts no session (R2).
  - Two factors (R1): owner security key → `{ status: 'second-factor', needs: ['pgp'] }` and no `Set-Cookie` for the session; then PGP with that `pendingId` → full session. Owner PGP then security key → session. Staff PGP + passkey → session; staff PGP + second PGP key (different fingerprint) → session; the same PGP key twice → it is left out of the second challenge, and forcing it → `method-not-allowed`; staff security key then passkey → `method-not-allowed`; the `pendingId` from another device or account → `challenge-expired`; a `pendingId` at 5:00 → `challenge-expired`.
  - Minimums: an owner with 2 attested keys and 1 PGP key removing either key or the PGP key → `last-login-method`; a staff account with PGP + passkey removing the passkey → `last-login-method`.
  - `POST /v1/login/password` for a staff username with a password row inserted directly → `credentials-invalid`, and `argon2.verify` ran once (dummy hash).
  - `ownerReady` false with one attested key; false with two where one has `attested = false`; false with two attested keys and no PGP key; true with two attested keys and a PGP key.
  - Outside onboarding, `PUT /v1/account/password` without a token → `confirm-required` (Review Focus 1); in the creating session within 30 minutes → allowed without a token; at minute 31 → `confirm-required`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): login-method policy and staff primitives`.

### Task 11: Account overview, devices and alerts

**Files:**
- Create: `apps/api/src/routes/account.ts`
- Test: `apps/api/test/account.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 9, 10.
- Produces:
  - `GET /v1/account/me` (recovery allowed, `allowStaleTerms`) → `{ username, kind, level, holdUntil: string | null, methods: MethodType[], hasBackup: boolean, suggestions: Array<'add-authenticator' | 'add-backup'>, payoutWait: { enabled: boolean; offAt: string | null }, termsCurrent: boolean }`. `hasBackup` (R11) = TOTP, or unused recovery codes, or two or more PGP keys, or at least one security key or passkey while the account has at least two primary credentials in all (each PGP key, security key and passkey counts once, a password once); a password never counts as the backup itself. `termsCurrent` = `terms_version = config.termsVersion` (always true for staff and owner).
  - `GET /v1/terms` (no session) → `{ version: config.termsVersion }`; `POST /v1/account/terms { version }` (recovery allowed, `allowStaleTerms`) → 204 and sets `terms_version`, `terms_accepted_at = now`; any other version → 400 `terms-not-accepted` with `{ version }` (R10). `add-authenticator` when the account has a password and no TOTP; `add-backup` when `hasBackup` is false. Feeds the onboarding Welcome screen (6.1 step 6). (Named `suggestions`, not `nudges`, so Plan 3's Nudge feature keeps `/v1/account/nudges`.)
  - `GET /v1/account/sessions` (`allowStaleTerms`) → `[{ id, deviceLabel, level, createdAt, lastSeenAt, current: boolean }]` (open sessions only); `DELETE /v1/account/sessions/:id` (full only) → 204, the session stops working immediately.
  - `GET /v1/account/alerts` → newest first, at most 50; `POST /v1/account/alerts/:id/seen` → 204.
  - Every `:id` route checks ownership; another account's id → 404 `not-found`.

- [ ] **Step 1: Failing tests:** password-only account → `suggestions` `['add-authenticator', 'add-backup']`; after TOTP → `[]`; two sessions listed with one `current`; deleting the other ends it (its next request → `not-authenticated`); deleting another account's session → 404; a held recovery session shows `level: 'recovery'` and `holdUntil`; alerts newest first and `seen` sets `seen_at`.
  - `hasBackup` (R11): password only → false; PGP + password → false with `add-backup`; one passkey only → false; password + passkey → true; PGP + security key → true; two PGP keys → true; PGP + TOTP → true; PGP + unused recovery codes → true.
  - Terms (R10): with `config.termsVersion` raised after sign-up, `GET /v1/account/alerts` → 403 `terms-required`, `me` → 200 with `termsCurrent: false`, `POST /v1/account/terms` with the old version → 400 `terms-not-accepted`, with the new one → 204, then alerts → 200; a staff session is unaffected by the change.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): account overview, devices and alerts`.

### Task 12: Your wallets (action-bound confirm, alert, opt-in 24-hour wait)

**Files:**
- Create: `apps/api/migrations/008_wallets.sql`, `apps/api/src/wallets/address.ts`, `apps/api/src/wallets/routes.ts`
- Modify: `apps/api/src/main.ts` (register `purgeRemovedWalletAddresses`)
- Test: `apps/api/test/wallets.test.ts`, `apps/api/test/address.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 11; monero-ts (Plan 1's pinned version); `addressHash`, `addressEnd` from `@x2f/accounts`.
- Produces:
  - `008_wallets.sql`: `wallets(id uuid pk, account_id uuid fk, app text not null, label text not null, address text /* nulled 90 days after removal */, created_at, usable_from timestamptz not null, removed_at timestamptz)`; unique `(account_id, address) where removed_at is null`.
  - `interface AddressValidator { check(address: string): 'ok' | 'invalid' | 'integrated' }`; `moneroAddressValidator(network): Promise<AddressValidator>` — `MoneroUtils.isValidAddress` with the matching `MoneroNetworkType`; a valid 106-character address is `integrated` (standard and subaddresses are 95). Integrated addresses are refused because Plan 1's `cosign` refuses payment-ID extras.
  - `WALLET_APPS = ['cake', 'edge', 'feather', 'monerujo', 'stack', 'monero-gui-cli', 'ledger-trezor', 'other'] as const`; `type WalletApp = typeof WALLET_APPS[number]`.
  - `PAYOUT_WAIT_MS = 24 * 3_600_000`
  - Every route in this task uses `requireSession({ kinds: ['trader'] })` (R3): staff and owner accounts never hold payout wallets.
  - `GET /v1/wallets` → `[{ id, app, label, address, addressEnd, usableFrom, usable: boolean }]`, never a balance. No default payout wallet: Plan 3 always asks which wallet gets paid.
  - `POST /v1/wallets { app, label, address, confirmToken? }` (full only) → 201. `requireConfirm(req => ({ kind: 'add-wallet', addressHash: addressHash(address), addressEnd: addressEnd(address) }), { onboarding: firstWalletOnly })`; `firstWalletOnly(req)` = account `had_wallet = false` (on top of the session's `onboarding_until > now`). `address` trimmed; `invalid` or wrong network → 400 `address-invalid`; `integrated` → 400 `address-integrated`; already listed → 409 `wallet-exists`; label 1–40 characters. `usable_from` = now if `had_wallet = false` or the wait is not active, else now + 24 h. Sets `had_wallet = true`. Always adds alert `wallet-added` `{ app, label, addressEnd, usableFrom }`.
  - `DELETE /v1/wallets/:id` (full only, no confirm: removal cannot redirect money) → sets `removed_at`; cancels a waiting wallet too.
  - `PUT /v1/account/security/payout-wait { enabled, confirmToken? }` (full only): turning on applies at once, clears `payout_wait_off_at`, needs no confirm; turning off needs `requireConfirm({ kind: 'payout-wait-off' })` (no onboarding exemption), sets `payout_wait_off_at = now + 24 h` and adds alert `payout-wait-off-scheduled`. `payoutWaitActive(row, now)` = `payout_wait && (payout_wait_off_at is null || now < payout_wait_off_at)`.
  - `usableWallets(db, accountId, now): Promise<Wallet[]>` — Plan 3 calls this when a buyer picks a payout wallet.
  - `purgeRemovedWalletAddresses: RetentionJob` — `update wallets set address = null where removed_at < now - interval '90 days' and address is not null`.

- [ ] **Step 1: Failing tests** (validator tests use real addresses generated with monero-ts; route tests use a fake validator and confirm tokens issued through `confirm/password`):
  - `address.test.ts`: a valid stagenet address → `ok` on stagenet and `invalid` on mainnet; a one-character change → `invalid`; a subaddress → `ok`; an integrated address → `integrated`.
  - Onboarding: the creating session adds the first wallet without a token (wait on, set directly) → `usable: true` immediately (6.1 step 5); a second wallet in the same session → `confirm-required`; a first wallet from a later session → `confirm-required`.
  - A login 10 seconds ago, then `POST /v1/wallets` without a token → `confirm-required` (P2-C2); a token for a different address → `confirm-invalid`; a token for the right address → 201. A recovery session → `recovery-session`.
  - Integrated address → 400 `address-integrated`.
  - A staff session on `GET /v1/wallets`, `POST /v1/wallets` and `PUT /v1/account/security/payout-wait` → 403 `wrong-account-kind` (R3).
  - Every add writes one `wallet-added` alert containing `addressEnd` and not the full address.
  - Wait on, second wallet: `usable` false at +23:59:59, true at +24:00:00; deleting it while waiting removes it.
  - Turning the wait off without a token → `confirm-required`; with a `payout-wait-off` token → scheduled; wallets added in the next 24 hours still wait; after `payout_wait_off_at` new wallets are immediate; the alert is written.
  - Remove every wallet, then add one with the wait on → it waits (the first-wallet exemption is once per account).
  - The same address twice → `wallet-exists`; after removal it can be added again.
  - `purgeRemovedWalletAddresses` nulls the address of a wallet removed 91 days ago and keeps one removed 89 days ago.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): payout wallets with action-bound confirm, alert and opt-in wait`.

### Task 13 (gated): Account device signing keys for trade identities

**Build only if the owner chose option (a) for P3-C1 in the review. Otherwise skip this task and note "skipped: owner chose (b)/(c)" in `docs/security/plan-2-review.md`.**

**Files:**
- Create: `apps/api/migrations/009_device_keys.sql`, `apps/api/src/auth/deviceKeys.ts`, `packages/accounts/src/deviceKey.ts`
- Test: `apps/api/test/deviceKeys.test.ts`, `packages/accounts/test/deviceKey.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5.
- Produces:
  - `009_device_keys.sql`: `device_keys(id uuid pk, account_id uuid fk, sign_public bytea unique not null /* Ed25519, 32 bytes */, label text not null, created_at, revoked_at)`.
  - `deviceKeyFingerprint(signPublic: Uint8Array): string` (`@x2f/accounts`) — SHA-256, first 10 bytes as 16 Crockford base32 characters grouped like a trade code.
  - `POST /v1/account/device-keys { signPublic, label, confirmToken? }` (full, `kinds: ['trader']`, `requireConfirm(req => ({ kind: 'add-device-key', signPublicHash: sha256hex(signPublic) }), { onboarding: true })`) → 201 `{ id, fingerprint }`, alert `device-key-added`. `DELETE /v1/account/device-keys/:id` → sets `revoked_at`.
  - `GET /v1/users/:username/device-keys` (no session) → `[{ signPublic, fingerprint, createdAt, revokedAt }]`; unknown username → `[]`. Plan 3 verifies trade identities against these and pins them on first sight.

- [ ] **Step 1: Failing tests:** fingerprint of a fixed 32-byte key equals a fixed 19-character string; a non-32-byte key → 400 `bad-request`; adding without a token outside onboarding → `confirm-required`; the public listing shows the key and later its `revokedAt`; staff → `wrong-account-kind`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement (Ed25519 length check only; signatures are verified by Plan 3's clients).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): account device signing keys`.

### Task 14: Browser auth modules (`@x2f/auth-client`) and end-to-end flows

**Files:**
- Create: `packages/auth-client/package.json`, `packages/auth-client/tsconfig.json`, `packages/auth-client/src/index.ts`, `packages/auth-client/src/api.ts`, `packages/auth-client/src/webauthn.ts`, `packages/auth-client/src/confirm.ts`
- Test: `packages/auth-client/test/flows.test.ts` (against a real `buildApi` on `127.0.0.1:0`, Postgres from Task 3's harness, the soft authenticator from Task 8)

**Interfaces:**
- Consumes: every route above; `@x2f/accounts`; @simplewebauthn/browser 14.0.0; `ApiErrorCode` (type-only import from `@x2f/api`).
- Produces:
  - `createAuthApi(o?: { baseUrl?: string /* default '' (same origin) */; fetch?: typeof fetch }): AuthApi` — one method per route, named verb + noun from the path (`loginPgpStart`, `addWallet`, `setPayoutWait`, …); requests send `credentials: 'same-origin'` and JSON only. Non-2xx → throws `AuthApiError { status: number; code: ApiErrorCode; detail?: string; retryAfterSeconds?: number; missing?: string[]; holdUntil?: string }`.
  - Ceremony wrappers (ceremony functions injectable so tests pass the soft authenticator): `registerWithWebAuthn(api, username, kind, deviceLabel, ceremony = { startRegistration })`; `loginWithPasskey(api, deviceLabel, ceremony = { startAuthentication })` (no username); `loginWithSecurityKey(api, username, deviceLabel, ceremony)`; `confirmWithWebAuthn(api, action: ConfirmAction, ceremony): Promise<string /* confirmToken */>`.
  - `withConfirm<T>(action: ConfirmAction, run: (confirmToken?: string) => Promise<T>, prove: (action: ConfirmAction) => Promise<string>): Promise<T>` — calls `run()`; on `confirm-required` calls `prove(action)` once and retries `run(token)` once; any other error propagates. Plan 3's confirm sheet supplies `prove`.
  - `walletAction(address: string): Promise<ConfirmAction>` — builds `{ kind: 'add-wallet', addressHash, addressEnd }`.
  - `defaultDeviceLabel(nav: { userAgentData?: { platform?: string } }): string` — e.g. `"Browser on Linux"`; coarse by design.
  - Re-exports `checkUsername`, `checkPassword`, `inspectPublicKey`, `normalizeLoginCode`, `normalizeRecoveryCode`, `describeAction`.

- [ ] **Step 1: Failing tests** (a cookie-jar `fetch` wrapper sending `Origin: https://x2f.test`):
  - Onboarding, PGP: register with a generated Ed25519 key, decrypt in the test, finish; add a passkey as backup (onboarding, no prompt); add the first wallet (onboarding, no prompt); `me()` shows `methods` `['pgp', 'passkey']`, `hasBackup: true`, `suggestions: []`.
  - Every later wallet add goes through `withConfirm` (P2-C2): 10 seconds after a fresh login, `withConfirm(walletAction(addr), t => api.addWallet({ …, confirmToken: t }), a => confirmWithWebAuthn(api, a, soft))` calls `prove` exactly once and succeeds; reusing the token on another address → `AuthApiError` `confirm-invalid`.
  - Onboarding, password: register, `me().suggestions` equals `['add-authenticator', 'add-backup']`. A PGP-registered account that adds a password still shows `hasBackup: false` (R11). Every register call sends `acceptedTerms` from `GET /v1/terms`.
  - Flood (Review Focus 2, P2-C1): a second cookie jar with no device cookie sends 12 wrong passwords for the user; then the user's own jar logs in with the password (device cookie trusted) at once; a third fresh jar logs in with the passkey (discoverable) and with PGP at once; a staff account seeded with an attested security key and a PGP key completes security key then PGP (`second-factor`, then a session) at once after 12 anonymous wrong passwords for its username; the user's live session obtains a confirm token by passkey during the flood.
  - A leaked password surfaces as `AuthApiError` with `code: 'password-leaked'`; a throttled anonymous login carries `retryAfterSeconds` ≤ 30.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(auth-client): browser auth modules`.

### Task 15: Security review, roadmap owners and owner questions

**Files:**
- Create: `docs/security/plan-2-review.md`
- Modify: `docs/superpowers/plans/2026-10-15-roadmap.md`

- [ ] **Step 1:** Run the Claude Security scan over `packages/accounts`, `packages/auth-client`, `apps/api` and `tools/leaked`, and check the code against OWASP ASVS 4 chapters V2 (authentication), V3 (sessions) and V4 (access control) at Level 3.
- [ ] **Step 2:** Fix every confirmed finding in the task that owns the code, with a test that would have caught it; re-run `npm run check`; expect PASS.
- [ ] **Step 3:** Record findings, fixes, and anything accepted with its reason in `docs/security/plan-2-review.md`, including the `SameSite=Strict` decision (P2-M9) and the TOTP-backup daily cap trade-off (an anonymous attacker can spend the 5 daily TOTP-backup tries; recovery codes and every primary method stay unaffected).
- [ ] **Step 4:** Update the roadmap (P2-I10, X6): Plan 2 row → "Written"; name an owner for each deferred item — security-key tap to fund escrow (Plan 6), "require a security key to log in" (Plan 6), escrow-key backup encrypted to the user's PGP key and the lost-device test (Plan 3, P3-I14), Web Push (Plan 3, P3-I13), staff invites and login hours (Plan 4), passkeys inside Capacitor and WebAuthn on the `.onion` origin (Plan 6), nudge (Plan 3, P3-M11), the violet moderator badge, the moderator dashboard and the training library (Plan 4, R4), the 30-day purge of closed disputes and the 6-month purge of anonymized training copies as jobs on `startRetention` (Plan 4, R6), reverse-proxy and Tor access logs switched off in deployment (Plan 6, R5), no trading or ads until the account has a payout wallet (Plan 3, spec 6.4) and no buyer deposits (Plan 3, owner 2026-10-17), the Terms screen with scroll-to-end, tick box and "I accept" on `GET /v1/terms` / `POST /v1/account/terms` (Plan 3, R10), the leaked-list production size recorded in `docs/dev-setup.md` once the operator first builds it (owner/operator, Task 6). Add the deferred hardening to the Plan 6 row. Note in `docs/security/plan-2-review.md` that the X2F PGP signing key is a live key on the API server (R7).
- [ ] **Step 5:** List owner questions in `docs/security/plan-2-review.md` under "For the owner": delete 6.3's wallet-era items ("withdraw", "daily spending limits", "PGP-signed withdrawal addresses"); 6.2 "fingerprint becomes the account ID" vs. login by username (P2-M8); 6.3 "PGP-encrypted notifications for users who opt into email" vs. no email (P2-M8); the Wallet board's "· gets payouts" copy now that there is no default payout wallet (X2); and, if Task 13 was skipped, which P3-C1 option was chosen.
- [ ] **Step 6:** Commit `docs: plan 2 security review and roadmap owners`.
