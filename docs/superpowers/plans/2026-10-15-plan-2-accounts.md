# Plan 2: Accounts and login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested Fastify + PostgreSQL auth API and browser auth modules with which a person picks a username, logs in with PGP, a passkey, a security key or a password (plus TOTP and recovery codes as second factor or backup), confirms it's them before sensitive changes, and links payout wallets with an alert and an opt-in 24-hour wait; plus the auth primitives Plan 4 needs for staff and the owner.

**Architecture:** `packages/accounts` (`@x2f/accounts`) holds rules shared by browser and server: usernames, password policy, login-code format, PGP key inspection. `apps/api` (`@x2f/api`) is the Fastify server: raw SQL on `pg` with numbered migrations, one module per login method, sessions in Postgres behind an opaque `__Host-` cookie, one throttle shared by every way of proving identity. `packages/auth-client` (`@x2f/auth-client`) is the typed browser client plus WebAuthn ceremony wrappers that Plan 3's screens call. No screens in this plan.

**Tech Stack:** Node 22.23.3, npm 11.21.0 (via `npx npm@11.21.0`), TypeScript 7.0.2 strict, vitest 5.0.3, fastify 5.12.5, @fastify/cookie 11.1.2, pg 8.23.1, @types/pg 8.23.1, openpgp 6.3.2, @simplewebauthn/server 14.0.3, @simplewebauthn/browser 14.0.0, argon2 0.45.1, otpauth 9.5.2, monero-ts (same exact version Plan 1 pins), PostgreSQL 17.11 in Docker for tests (`postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`), Semgrep 1.178.0.

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md` sections 4.1, 6.1–6.6, 8, 9. Builds on Plan 1 (`docs/superpowers/plans/2026-10-15-plan-1-escrow-core.md`): workspace, `tools/check.sh`, `@x2f/core` (`newTradeCode`, `normalizeTradeCode`). Note: `@x2f/core`'s `Role` (`buyer | seller | mod`) is a *trade* role; account kinds here are a separate type, `AccountKind`.

## Global Constraints

- No email address or phone number is ever asked for, stored, or accepted by any endpoint or table.
- Usernames: 5–20 characters, ASCII letters, digits, `.`, `-`, `_`; stored and shown exactly as typed; unique case-insensitively.
- Passwords: at least 10 characters with an upper-case letter, a lower-case letter, a number and a symbol; refused if on the leaked list held on X2F's own server (no outside lookup); stored only as Argon2id (`memoryCost 65536`, `timeCost 3`, `parallelism 1`); at most 256 characters.
- PGP: login codes random, single-use, expire in 5 minutes; the decrypted message names the site and the time; accepted keys RSA ≥ 4096, Ed25519, Ed448; expired or revoked keys refused with the reason.
- TOTP: 6 digits, 30-second period, SHA-1; never the only login method.
- Backup login is optional; the API never requires one.
- Staff and the owner log in only with a hardware security key or PGP; the owner needs two hardware keys.
- Every dependency pinned exactly, published at least 14 days before 2026-10-15 (`npm view <pkg> time --json`); install with `npx npm@11.21.0 install`; `.npmrc` keeps `ignore-scripts=true` (argon2 loads its shipped prebuilds, so no build script is needed).
- `npm audit --omit=dev` reports 0 vulnerabilities; every task ends with `npm run check` (typecheck, tests, audit, Semgrep) passing.
- No IP addresses or user agents are stored or logged. Logs never contain passwords, codes, tokens, keys, wallet addresses or request bodies.
- The server clock is the only clock: every module takes `clock: () => Date`; tests inject a fixed clock.
- Code written by agy-delegated agents is accepted only after Semgrep, the Security Guidance hook and a code-review plugin have checked it.

## Review Focus

1. **A hijacked session tries to redirect money or lock the owner out:** adding a payout wallet, adding a login method, or switching the 24-hour wait off must each demand a fresh confirm-it's-you, and switching the wait off takes effect only after 24 hours. Tests owned by Tasks 9 and 11.
2. **A person pastes their private key, or their key has expired since sign-up:** a private key is refused with `key-private` and never stored or logged; an expired key at login is refused with the date, and the person can paste the refreshed public key (same fingerprint) to continue. Tests owned by Task 6.
3. **Look-alike usernames:** `Alice` after `alice`, Cyrillic `а`, and names like `X2F.Support` must be refused. Tests owned by Tasks 1 and 5.
4. **Guessing through a side door:** step-up checks, TOTP second factor and recovery codes count against the same throttle as login; two parallel requests with one code succeed at most once. Tests owned by Tasks 4, 6 and 8.
5. **Edges of time:** a PGP code at exactly 5:00 is refused; a TOTP code reused inside its 30-second window is refused; a waiting wallet is unusable at 23:59:59 and usable at 24:00:00. Tests owned by Tasks 6, 8 and 11.

---

### Task 1: Shared account rules (`@x2f/accounts`)

**Files:**
- Create: `packages/accounts/package.json`, `packages/accounts/tsconfig.json`, `packages/accounts/src/index.ts`, `packages/accounts/src/username.ts`, `packages/accounts/src/password.ts`, `packages/accounts/src/loginCode.ts`
- Test: `packages/accounts/test/username.test.ts`, `packages/accounts/test/password.test.ts`, `packages/accounts/test/loginCode.test.ts`

**Interfaces:**
- Consumes: `newTradeCode`, `normalizeTradeCode` from `@x2f/core`.
- Produces:
  - `type AccountKind = 'trader' | 'staff' | 'owner'`
  - `checkUsername(input: string): { ok: true; username: string; key: string } | { ok: false; reason: 'length' | 'characters' | 'reserved' }` — `key` is the lower-cased form used for uniqueness. Regex `/^[A-Za-z0-9._-]{5,20}$/`. Reserved when `key` is one of `admin, administrator, moderator, support, staff, owner, system, root, help, x2f` or contains `x2f`, `moderator` or `admin` after removing `.`, `-` and `_`.
  - `checkPassword(pw: string): { ok: true } | { ok: false; missing: Array<'length' | 'upper' | 'lower' | 'number' | 'symbol' | 'too-long'> }` — counts code points after NFC; upper `\p{Lu}`, lower `\p{Ll}`, number `\p{Nd}`, symbol = any code point that is not a letter, number or whitespace; `too-long` above 256.
  - `normalizePassword(pw: string): string` — NFC (used before hashing and leaked checks, client and server).
  - `newLoginCode(): string` — 12 Crockford base32 characters from `crypto.getRandomValues`, grouped `XXXX-XXXX-XXXX`; `normalizeLoginCode(input: string): string | null` (same mapping rules as `normalizeTradeCode`, 12 characters).
  - `newRecoveryCode(): string` / `normalizeRecoveryCode(input: string): string | null` — same format as trade codes; delegate to `newTradeCode` / `normalizeTradeCode`.

- [ ] **Step 1: Failing tests.**
  - `checkUsername('Satoshi.N')` → `{ ok: true, username: 'Satoshi.N', key: 'satoshi.n' }`; `'abcd'` and 21 characters → `length`; `'bob smith'`, `'bób12'`, `'аlice'` (Cyrillic а) → `characters`; `'X2F.Support'`, `'the_admin'`, `'Moder-ator'` → `reserved`.
  - `checkPassword('Correct-Horse-9')` ok; `'short1!A'` missing `['length']`; `'alllowercase1!'` missing `['upper']`; `'NoNumbers!!xx'` missing `['number']`; `'NoSymbols123x'` missing `['symbol']`; 257 characters → includes `too-long`; `'Ünïcödé-Pass1'` ok.
  - `newLoginCode()` matches `/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/`; `normalizeLoginCode(' k7m2 9qxa-4ftr ') === 'K7M2-9QXA-4FTR'`; 11 or 13 characters → `null`.
  - `normalizeRecoveryCode('k7m29qxa4ftr8wpn') === 'K7M2-9QXA-4FTR-8WPN'`.
- [ ] **Step 2:** `npm test -- --project @x2f/accounts`; expect FAIL (modules missing).
- [ ] **Step 3:** Implement; export from `src/index.ts`. Package mirrors `packages/core/package.json` (ESM, `exports` → `./src/index.ts`).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(accounts): username, password and login-code rules`.

### Task 2: PGP key inspection and challenge text (`@x2f/accounts`)

**Files:**
- Create: `packages/accounts/src/pgp.ts`
- Test: `packages/accounts/test/pgp.test.ts`, `packages/accounts/test/fixtures/keys.ts` (generates keys once per run)

**Interfaces:**
- Produces:
  - `type KeyRefusal = 'key-unreadable' | 'key-private' | 'key-multiple' | 'key-weak' | 'key-expired' | 'key-revoked' | 'key-no-encryption'`
  - `inspectPublicKey(armored: string, now: Date): Promise<{ ok: true; fingerprint: string; algorithm: 'rsa' | 'ed25519' | 'ed448'; bits: number | null; expiresAt: Date | null } | { ok: false; reason: KeyRefusal; detail: string }>` — `fingerprint` lower-case hex. `detail` is a plain sentence, e.g. `"This key expired on 2026-03-01."`, `"RSA 2048-bit keys are too short; X2F needs 4096 or more."`, `"This is a private key. Paste your public key; never share the private one."`
  - `challengeText(a: { code: string; siteName: string; siteHost: string; issuedAt: Date; expiresAt: Date; purpose: 'register' | 'login' | 'confirm' | 'add-key' }): string` — exact lines:
    ```
    X2F login code: <code>
    Site: <siteName> (<siteHost>)
    Purpose: <purpose>
    Time: <issuedAt ISO, seconds, Z>
    Expires: <expiresAt ISO, seconds, Z>
    Only paste this code into <siteHost>. If you did not just ask for it, ignore it.
    ```
  - `encryptChallenge(text: string, armoredKeys: string[]): Promise<string>` — one armored message encrypted to every given key.
- Rules: read with `openpgp.readKeys`; more than one key → `key-multiple`; `isPrivate()` → `key-private`. Primary key: RSA with bits ≥ 4096, `eddsaLegacy` on `ed25519Legacy`, `ed25519`, or `ed448`; otherwise `key-weak`. `isRevoked()` → `key-revoked`; `getExpirationTime()` ≤ `now` → `key-expired`. `getEncryptionKey(undefined, now)` must exist and be RSA ≥ 4096, `ecdh` on `curve25519Legacy`, `x25519` or `x448`; otherwise `key-no-encryption` (or `key-weak` if present but weak).

- [ ] **Step 1: Failing tests** (fixtures from `openpgp.generateKey`; RSA keys generated once in `beforeAll`):
  - Ed25519 (`curve: 'ed25519Legacy'`), v6 `curve25519`, `curve448` and RSA 4096 keys → `ok`, correct algorithm, 40- or 64-hex fingerprint.
  - RSA 2048 → `key-weak`, `detail` contains `2048`; NIST P-256 → `key-weak`.
  - Key generated with `date` 2 days ago and `keyExpirationTime: 86400` → `key-expired`, `detail` contains the ISO date.
  - Key passed through `openpgp.revokeKey` → `key-revoked`.
  - Armored private key → `key-private`; two keys concatenated → `key-multiple`; `'hello'` → `key-unreadable`.
  - `challengeText` with fixed dates equals the exact six-line string above; `encryptChallenge` to two keys decrypts with either private key to that text.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with openpgp 6.3.2 (dependency of `@x2f/accounts`).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(accounts): PGP key checks and challenge message`.

### Task 3: API skeleton, schema and Postgres test harness (`apps/api`)

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/app.ts`, `apps/api/src/config.ts`, `apps/api/src/errors.ts`, `apps/api/src/db/pool.ts`, `apps/api/src/db/migrate.ts`, `apps/api/migrations/001_accounts.sql`, `apps/api/src/main.ts`
- Create: `apps/api/test/setup/postgres.ts` (vitest `globalSetup`), `apps/api/test/helpers/db.ts`, `apps/api/test/helpers/app.ts`
- Modify: `vitest.config.ts` (projects include `apps/*` if Plan 1 has not already added it)
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { siteName: string; siteHost: string; origins: string[]; rpId: string; databaseUrl: string; leakedListPath: string; totpKey: Uint8Array /* 32 bytes */; moneroNetwork: 'mainnet' | 'stagenet' | 'testnet' }`; `loadConfig(env: NodeJS.ProcessEnv): Config` reading `X2F_SITE_NAME` (default `X2F`), `X2F_SITE_HOST`, `X2F_ORIGINS` (comma list), `X2F_RP_ID`, `DATABASE_URL`, `X2F_LEAKED_LIST_PATH`, `X2F_TOTP_KEY` (base64), `X2F_MONERO_NETWORK`; throws naming the first missing or malformed variable.
  - `interface Deps { config: Config; db: pg.Pool; clock: () => Date; leaked: LeakedList; addresses: AddressValidator }` (the two interfaces are defined in Tasks 5 and 11; until then `app.ts` declares them as type-only imports from their future files, created here as interface-only stubs).
  - `buildApi(deps: Deps): Promise<FastifyInstance>` — logger with `redact` covering `req.body`, `req.headers.cookie`, `res.headers["set-cookie"]`; no request-body logging; `GET /healthz` → `200 {"ok":true}`.
  - `class ApiError extends Error { constructor(status: number, code: ApiErrorCode, extra?: Record<string, unknown>) }`; error handler replies `{ "error": code, ...extra }`. `type ApiErrorCode` lists every code used in this plan (`bad-request`, `not-found`, `username-*`, `password-weak`, `password-leaked`, every `KeyRefusal`, `key-in-use`, `challenge-expired`, `code-invalid`, `credentials-invalid`, `slow-down`, `locked`, `not-authenticated`, `confirm-required`, `recovery-session`, `method-not-allowed`, `last-login-method`, `webauthn-failed`, `origin-refused`, `address-invalid`, `wallet-exists`).
  - `migrate(db: pg.Pool): Promise<string[]>` — applies `migrations/NNN_*.sql` in order inside one transaction each, recorded in `schema_migrations(name text primary key, applied_at timestamptz)`; returns names applied.
  - `001_accounts.sql` creates every table this plan uses (columns are decisions; later tasks only use them):
    - `accounts(id uuid pk default gen_random_uuid(), username text not null, username_key text unique not null, kind text not null check (kind in ('trader','staff','owner')), webauthn_user_id bytea unique not null, payout_wait boolean not null default false, payout_wait_off_at timestamptz, had_wallet boolean not null default false, created_at timestamptz not null, disabled_at timestamptz)`; `create unique index one_owner on accounts(kind) where kind = 'owner'`
    - `pgp_keys(id uuid pk, account_id uuid fk, fingerprint text unique not null, armored text not null, created_at, last_used_at)`
    - `webauthn_credentials(id uuid pk, account_id uuid fk, credential_id bytea unique not null, public_key bytea not null, counter bigint not null, kind text check (kind in ('passkey','security-key')), transports text[], backed_up boolean not null, device_type text not null, label text not null, created_at, last_used_at)`
    - `passwords(account_id uuid pk fk, hash text not null, updated_at)`
    - `totp(account_id uuid pk fk, secret_enc bytea not null, last_step bigint not null default 0, created_at)`
    - `recovery_codes(id uuid pk, account_id uuid fk, code_hash bytea unique not null, used_at timestamptz)`
    - `challenges(id uuid pk, account_id uuid, session_id uuid, purpose text not null, method text not null, secret_hash bytea, webauthn_challenge text, payload jsonb not null default '{}', expires_at timestamptz not null, used_at timestamptz)`
    - `sessions(id uuid pk, account_id uuid fk, token_hash bytea unique not null, level text check (level in ('full','recovery')), device_label text not null, created_at, last_seen_at, confirmed_at, expires_at, revoked_at)`
    - `login_throttle(key text pk, failures int not null, last_failure_at timestamptz not null, locked_until timestamptz)`
    - `wallets(id uuid pk, account_id uuid fk, app text not null, label text not null, address text not null, created_at, usable_from timestamptz not null, removed_at timestamptz)`; unique `(account_id, address) where removed_at is null`
    - `alerts(id uuid pk, account_id uuid fk, kind text not null, detail jsonb not null, created_at, seen_at)`
  - Test harness: `globalSetup` runs `docker run -d --rm --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=<random> -p 127.0.0.1::5432 <pinned image>`, waits for `pg_isready`, migrates database `x2f_template`, `provide('pgUrl', url)`; teardown stops the container. If Docker is unavailable it fails with `"api tests need Docker (see docs/dev-setup.md)"`, never skips. `testDb(): Promise<pg.Pool>` creates a fresh database from the template per test file. `testApp(overrides?: Partial<Deps>): Promise<{ app: FastifyInstance; deps: Deps; setNow(d: Date): void }>`.

- [ ] **Step 1: Failing tests:** `migrate` on an empty database applies `['001_accounts.sql']` and a second run applies `[]`; `GET /healthz` returns `{ ok: true }`; no column in `information_schema.columns` matches `/email|phone|ip_addr|user_agent/`; inserting a second `kind='owner'` account fails; `loadConfig({})` throws naming `X2F_SITE_HOST`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Add the Docker image line to `docs/dev-setup.md`.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): skeleton, schema and Postgres test harness`.

### Task 4: Sessions, origin check, throttle and alerts

**Files:**
- Create: `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/origin.ts`, `apps/api/src/auth/throttle.ts`, `apps/api/src/alerts.ts`
- Test: `apps/api/test/sessions.test.ts`, `apps/api/test/throttle.test.ts`

**Interfaces:**
- Consumes: Task 3 (`Deps`, `ApiError`, tables), `AccountKind` from `@x2f/accounts`.
- Produces:
  - `SESSION_COOKIE = '__Host-x2f_session'` (HttpOnly, Secure, SameSite=Strict, Path=/); token is 32 random bytes base64url; only its SHA-256 is stored.
  - `sessionPolicy(kind: AccountKind): { idleMs: number; absoluteMs: number }` — trader `7 d` / `30 d`; staff and owner `30 min` / `12 h`.
  - `FRESH_MS = 5 * 60_000`
  - `startSession(deps: Deps, reply: FastifyReply, a: { accountId: string; level: 'full' | 'recovery'; deviceLabel: string; method: LoginMethod; firstSession: boolean }): Promise<void>` — sets the cookie; `confirmed_at = now`; adds alert `new-login` (or `recovery-login` when `level = 'recovery'`) with `{ method, deviceLabel }` unless `firstSession`. `deviceLabel` trimmed to 60 characters, supplied by the client; never derived from headers.
  - `type LoginMethod = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-code'`
  - Fastify decorator `requireSession(opts?: { allowRecovery?: boolean; fresh?: boolean }): preHandler` — sets `req.auth = { sessionId, accountId, kind, level, confirmedAt }`; `not-authenticated` (401) when missing, revoked, idle- or absolute-expired; `recovery-session` (403) when `level='recovery'` and not allowed; `confirm-required` (403) when `fresh` and `now - confirmedAt > FRESH_MS`. Touches `last_seen_at`.
  - `markConfirmed(deps: Deps, sessionId: string): Promise<void>`; `endSession(deps, sessionId)`; route `POST /v1/logout`.
  - Origin hook: every non-GET/HEAD request whose `Origin` header is absent or not in `config.origins` → 403 `origin-refused`.
  - Throttle (key = `acct:<username_key>`, applies to unknown usernames too): `throttleCheck(deps, key): Promise<void>` throws 429 `slow-down` or `locked` with `retryAfterSeconds`; `throttleFail(deps, key, accountId: string | null)`; `throttleReset(deps, key)`. Values: failures 1–3 no wait; failures 4–9 wait `min(2^(n−3), 30)` seconds after the last failure; the 10th failure locks for 15 minutes and adds alert `login-locked`; the count restarts 15 minutes after the last failure or on success. Attempts during a wait or lock are refused without checking credentials and add no failure.
  - `addAlert(db, accountId, kind: AlertKind, detail: object)`; `type AlertKind = 'new-login' | 'recovery-login' | 'login-locked' | 'login-method-added' | 'login-method-removed' | 'wallet-added' | 'payout-wait-off-scheduled'`.
  - `consumeChallenge(db, id: string, now: Date): Promise<ChallengeRow | null>` — `update challenges set used_at = now where id = $1 and used_at is null and expires_at > now returning *`; the only way any code reads a challenge. `purgeExpired(db, now)` deletes challenges expired over 1 hour, sessions past `expires_at`, throttle rows idle over 1 hour, alerts older than 90 days.
- Test fixture: `seedAccount(deps, { username, kind? }): Promise<string>` inserts an account directly (tests only).

- [ ] **Step 1: Failing tests** (use a throwaway route behind `requireSession` and fake clock):
  - A started session authenticates; after `endSession` → `not-authenticated`; after 7 days idle (trader) → `not-authenticated`; staff after 31 minutes idle → `not-authenticated`.
  - `fresh: true` passes at 4:59 after login, fails `confirm-required` at 5:01, passes again after `markConfirmed`.
  - A recovery session on a route without `allowRecovery` → `recovery-session`.
  - The stored row holds no raw token: `token_hash` ≠ cookie value and equals its SHA-256.
  - `POST` with `Origin: https://evil.test` → 403 `origin-refused`; with no `Origin` → 403.
  - Throttle: 3 failures, 4th check passes; after the 4th failure a check within 2 s → `slow-down` with `retryAfterSeconds: 2`; 10th failure → `locked` for 900 s and one `login-locked` alert; 15 minutes later checks pass and the count is 0; works for a key with no account.
  - `consumeChallenge` called twice in parallel (`Promise.all`) returns one row and one `null`; an expired challenge returns `null`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with @fastify/cookie 11.1.2.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): sessions, origin check, throttle and alerts`.

### Task 5: Password sign-up, login and confirm

**Files:**
- Create: `apps/api/src/auth/leaked.ts`, `apps/api/src/auth/password.ts`, `apps/api/src/accounts.ts`, `tools/leaked/build-leaked-list.ts`
- Test: `apps/api/test/password.test.ts`, `apps/api/test/leaked.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces:
  - Leaked list file: sorted, fixed-width 20-byte SHA-1 records, no header. `buildLeakedList(lines: AsyncIterable<string>, out: string): Promise<number>` reads Have I Been Pwned "SHA1HEX:COUNT" lines (from the official Pwned Passwords downloader, run by the operator, never by the server), refuses unsorted input, returns records written. CLI: `tsx tools/leaked/build-leaked-list.ts <in.txt> <out.bin>`.
  - `interface LeakedList { has(password: string): Promise<boolean> }`; `openLeakedList(path: string): Promise<LeakedList>` — SHA-1 of `normalizePassword(pw)` as UTF-8, binary search with positioned reads; throws at startup if the file is missing or its size is not a multiple of 20.
  - `createAccount(db: pg.PoolClient, a: { username: string; key: string; kind: AccountKind; now: Date }): Promise<string>` — maps a unique violation on `username_key` to 409 `username-taken`; random 32-byte `webauthn_user_id`. Plan 4 uses this for staff and the owner.
  - `assertUsername(input: string): { username: string; key: string }` — throws 400 `username-invalid` / `username-reserved`.
  - `hashPassword(pw): Promise<string>`, `verifyPassword(hash, pw): Promise<boolean>` — argon2 `argon2id` with the Global Constraints parameters, on `normalizePassword(pw)`.
  - `assertNewPassword(deps, pw)` — 400 `password-weak` with `missing` from `checkPassword`, then 400 `password-leaked`.
  - Routes: `POST /v1/register/password { username, password, deviceLabel }` → 201 `{ username }` (first session); `POST /v1/login/password { username, password, deviceLabel }` → 200 `{ status: 'ok' }` or `{ status: 'second-factor', pendingId }` (the second branch is wired in Task 8); `POST /v1/confirm/password { password, totp? }` (session required) → 204 and `markConfirmed`. Wrong username or wrong password both → 401 `credentials-invalid` and `throttleFail`. Bodies over 4 KiB → 413 before hashing.
- `passwordAllowed(kind)` is defined in Task 9; until then, password routes create and accept only `kind='trader'`.

- [ ] **Step 1: Failing tests** (fixture list built by `buildLeakedList` from `Password123!`, `Summer2024!x`, `Tr0ub4dor&3x`):
  - `has('Password123!')` true, `has('Correct-Horse-9')` false; unsorted input → throws.
  - Register `Satoshi.N` / `Correct-Horse-9` → 201, cookie set, `passwords.hash` starts with `$argon2id$v=19$m=65536,t=3,p=1$`, no `new-login` alert.
  - Register `satoshi.n` afterwards → 409 `username-taken`; `X2F.Support` → `username-reserved`.
  - `Password123!` → 400 `password-leaked`; `password` → 400 `password-weak` with `missing` containing `upper`, `number`, `symbol`, `length`.
  - Login with the right password → `{ status: 'ok' }` and one `new-login` alert; wrong password and unknown username → `credentials-invalid`; the 4th wrong attempt within 2 s → 429 `slow-down`.
  - `POST /v1/confirm/password` with a wrong password counts against the same throttle key as login.
  - A captured log stream during register and login contains neither the password nor the cookie value.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with argon2 0.45.1.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): password accounts with leaked-list check`.

### Task 6: PGP sign-up, login, confirm and adding a key

**Files:**
- Create: `apps/api/src/auth/pgp.ts`
- Test: `apps/api/test/pgp.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5 (`createAccount`, `assertUsername`), `newLoginCode`, `normalizeLoginCode`.
- Produces:
  - `issuePgpChallenge(deps, a: { accountId: string | null; sessionId: string | null; purpose: 'register' | 'login' | 'confirm' | 'add-key'; armoredKeys: string[]; payload: object }): Promise<{ challengeId: string; encryptedMessage: string; expiresAt: string }>` — stores SHA-256 of the normalized code, `expires_at = now + 5 min`; issuing a new challenge marks earlier unused ones for the same account and purpose as used.
  - `checkPgpCode(deps, challengeId: string, code: string, purpose): Promise<ChallengeRow>` — `consumeChallenge`, compare with `crypto.timingSafeEqual`; wrong code → 401 `code-invalid` (the challenge stays consumed; the person asks for a new one) plus `throttleFail`; unknown, used or expired → 400 `challenge-expired`.
  - Routes:
    - `POST /v1/register/pgp/start { username, publicKey }` → `{ challengeId, encryptedMessage, expiresAt, fingerprint }`; refuses with the `KeyRefusal` code and `detail` (400), or 409 `key-in-use` when the fingerprint belongs to any account.
    - `POST /v1/register/pgp/finish { challengeId, code, deviceLabel }` → 201; creates the account and key in one transaction.
    - `POST /v1/login/pgp/start { username, refreshedKey? }` → encrypts to every stored key of the account that `inspectPublicKey` accepts *now*; if none, refuses with the first key's reason and `detail`. `refreshedKey` must have the same fingerprint as a stored key and pass inspection; it replaces the stored armor only after `finish` succeeds.
    - `POST /v1/login/pgp/finish { challengeId, code, deviceLabel }`.
    - `POST /v1/confirm/pgp/start` and `/finish { challengeId, code }` (session required; recovery allowed) → `markConfirmed`.
    - `POST /v1/account/pgp/start { publicKey }` and `/finish { challengeId, code }` (session `fresh`, recovery allowed) → adds the key, alert `login-method-added` `{ method: 'pgp', fingerprint }`.

- [ ] **Step 1: Failing tests** (fixed clock `2026-10-15T12:00:00Z`, `siteHost` `x2f.test`):
  - Register with an Ed25519 key: decrypting `encryptedMessage` with the private key gives text containing `X2F login code: `, `Site: X2F (x2f.test)`, `Time: 2026-10-15T12:00:00Z` and `Expires: 2026-10-15T12:05:00Z`; sending the code with lower case and no dashes → 201.
  - Login: the code works once; the same code again → `challenge-expired`; at exactly `12:05:00` → `challenge-expired`; at `12:04:59` → ok.
  - A wrong code → `code-invalid` and counts toward the throttle; a new `start` invalidates the previous challenge.
  - Two parallel `finish` calls with the right code → one 200, one `challenge-expired`.
  - A private key at sign-up → 400 `key-private`; nothing stored in `pgp_keys` or `challenges.payload`, and the log contains no `PRIVATE KEY` text.
  - A key that expires after sign-up: login start → 400 `key-expired` with the date in `detail`; login start with the same key re-signed with a later expiry as `refreshedKey` → challenge issued; after `finish` the stored armor is the refreshed one.
  - A fingerprint already on another account → 409 `key-in-use`.
  - Adding a second key from a session older than 5 minutes → 403 `confirm-required`; after `confirm/pgp` → added, alert written, and a login challenge decrypts with either key.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): PGP challenge sign-up, login and confirm`.

### Task 7: Passkeys and security keys (WebAuthn)

**Files:**
- Create: `apps/api/src/auth/webauthn.ts`, `apps/api/test/helpers/softAuthenticator.ts`, `apps/api/test/helpers/cbor.ts`
- Test: `apps/api/test/webauthn.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5; @simplewebauthn/server 14.0.3.
- Produces:
  - `registrationOptionsFor(kind: 'passkey' | 'security-key', accountKind: AccountKind)` — passkey: `residentKey: 'required'`, `userVerification: 'required'`, `authenticatorAttachment` unset; security key: `residentKey: 'discouraged'`, `userVerification: 'preferred'`, `authenticatorAttachment: 'cross-platform'`. Always `attestationType: 'none'`, `supportedAlgorithmIDs: [-8, -7, -257]`, `userID` = `accounts.webauthn_user_id` (never the username), `excludeCredentials` = the account's credentials. Timeout 5 minutes; challenge stored in `challenges.webauthn_challenge`.
  - `assertCredentialAllowed(accountKind: AccountKind, info: { credentialDeviceType: string; credentialBackedUp: boolean; kind: string }): void` — for `staff` and `owner` only `kind='security-key'` with `credentialDeviceType='singleDevice'` and `credentialBackedUp=false`; otherwise 403 `method-not-allowed`.
  - Routes (same shape as PGP): `POST /v1/register/webauthn/start { username, kind }` → `{ challengeId, options }`; `/finish { challengeId, response, deviceLabel, label? }` → 201. `POST /v1/login/webauthn/start { username }` → options with `allowCredentials` from the account; `/finish { challengeId, response, deviceLabel }`. `POST /v1/confirm/webauthn/start|finish`. `POST /v1/account/webauthn/start { kind }` and `/finish { challengeId, response, label }` (session `fresh`, recovery allowed) → alert `login-method-added`.
  - Verification: `expectedOrigin: config.origins`, `expectedRPID: config.rpId`, `requireUserVerification` true for passkeys; any verification error → 401 `webauthn-failed` plus `throttleFail`. Counter: store `newCounter`; a non-zero counter that does not increase → `webauthn-failed`.
- Test helper: `createSoftAuthenticator(o: { backedUp: boolean; userVerified: boolean }): { register(options, origin: string): RegistrationResponseJSON; authenticate(options, origin: string): AuthenticationResponseJSON; setCounter(n: number): void }` — ES256 key from `node:crypto`, `none` attestation, encoded by an encode-only CBOR helper (maps, byte and text strings, integers) in `cbor.ts`; sets flags UP, UV, AT, BE/BS per `backedUp`.

- [ ] **Step 1: Failing tests:**
  - Register a passkey and log in with it; `last_used_at` updated; a `new-login` alert written.
  - Login response signed for origin `https://evil.test` → `webauthn-failed`; a replayed login response (same challenge) → `challenge-expired`.
  - `setCounter` below the stored counter → `webauthn-failed`.
  - Passkey registration without user verification → `webauthn-failed`.
  - `userID` in the options decodes to 32 bytes that do not contain the username.
  - `assertCredentialAllowed('staff', { kind: 'passkey', … })` and `('owner', { kind: 'security-key', credentialDeviceType: 'multiDevice', credentialBackedUp: true })` → `method-not-allowed`; `('owner', { kind: 'security-key', credentialDeviceType: 'singleDevice', credentialBackedUp: false })` passes.
  - Adding a second security key from a fresh session → two credentials; the login options list both.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): passkeys and security keys`.

### Task 8: TOTP and recovery codes (second factor and backup)

**Files:**
- Create: `apps/api/src/auth/totp.ts`, `apps/api/src/auth/recovery.ts`
- Modify: `apps/api/src/auth/password.ts` (second-factor branch; `confirm/password` requires `totp` when enrolled)
- Test: `apps/api/test/totp.test.ts`, `apps/api/test/recovery.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5; otpauth 9.5.2; `newRecoveryCode`, `normalizeRecoveryCode`.
- Produces:
  - TOTP: 20-byte secret, `issuer: 'X2F'`, `label: <username>`, SHA1, 6 digits, period 30, window ±1 step. Secret stored as AES-256-GCM under `config.totpKey` (random 12-byte nonce prepended). `verifyTotp(deps, accountId, code): Promise<boolean>` accepts only a step greater than `last_step` and updates it in the same statement (`… where last_step < $step`).
  - Routes: `POST /v1/account/totp/start` (session `fresh`) → `{ challengeId, otpauthUri, secret }`; `/finish { challengeId, code }` → enrolls, alert `login-method-added`. `POST /v1/login/second-factor { pendingId, code }` → completes the password login (`pendingId` is a `challenges` row, purpose `second-factor`, 5 minutes). `POST /v1/account/recovery-codes` (session `fresh`) → `{ codes: string[] }` with 10 new codes, replacing any old ones; stored as SHA-256 of the normalized code.
  - Backup login: `POST /v1/login/backup { username, kind: 'totp' | 'recovery-code', code, deviceLabel }` → starts a `level='recovery'` session (alert `recovery-login`); a recovery code is consumed with `update … set used_at = now where code_hash = $1 and used_at is null returning`.
  - Password login when TOTP is enrolled returns `{ status: 'second-factor', pendingId }` and no session until the code is accepted.
  - All TOTP and recovery failures go through `throttleFail` on the account's key.

- [ ] **Step 1: Failing tests** (clock-driven, codes computed with otpauth in the test):
  - Enroll TOTP; `otpauthUri` starts with `otpauth://totp/X2F:` and contains `digits=6&period=30`; `totp.secret_enc` does not contain the raw secret bytes.
  - Password login → `second-factor`; the current code → session; the same code again within its 30 s step → refused; the previous step's code (−30 s) → accepted once; −60 s → refused.
  - Wrong codes at `login/second-factor` reach `slow-down` on the 4th failure.
  - `confirm/password` without `totp` once enrolled → 401 `credentials-invalid`.
  - Recovery codes: 10 returned, all matching the trade-code format, all distinct; one logs in once (`level='recovery'`, `recovery-login` alert), the second use fails; regenerating invalidates the old set.
  - A recovery session can call `POST /v1/account/pgp/start` but gets `recovery-session` on a full-only test route.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): TOTP and recovery codes`.

### Task 9: Login-method policy, listing and removal; staff and owner primitives

**Files:**
- Create: `apps/api/src/auth/methods.ts`
- Modify: `apps/api/src/auth/password.ts`, `pgp.ts`, `webauthn.ts`, `totp.ts` (call `assertMethodAllowed` before adding)
- Test: `apps/api/test/methods.test.ts`

**Interfaces:**
- Consumes: Tasks 5–8.
- Produces:
  - `type MethodType = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-codes'`; `PRIMARY: MethodType[] = ['pgp', 'passkey', 'security-key', 'password']`.
  - `allowedMethods(kind: AccountKind): MethodType[]` — trader: all six; staff and owner: `['pgp', 'security-key']`.
  - `assertMethodAllowed(kind, method)` → 403 `method-not-allowed`.
  - `listMethods(db, accountId): Promise<Array<{ type: MethodType; id: string; label: string; createdAt: string; lastUsedAt: string | null }>>` (PGP label = last 16 hex of the fingerprint; recovery codes as one entry with `label: '<n> left'`).
  - `removeMethod(deps, accountId, type, id)` — refuses 409 `last-login-method` when it would leave no primary method; alert `login-method-removed`.
  - `ownerReady(db, ownerId: string): Promise<boolean>` — true when the owner has at least 2 `security-key` credentials with `backed_up = false`. Plan 4's owner setup calls it before locking the setup page.
  - Routes: `GET /v1/account/methods` (recovery allowed); `PUT /v1/account/password { password }` (session `fresh`; sets or replaces; alert `login-method-added`); `DELETE /v1/account/methods/:type/:id` (session `fresh`, full only).

- [ ] **Step 1: Failing tests:**
  - A PGP-only trader removing their key → `last-login-method`; after adding a passkey, removing the key succeeds and writes an alert.
  - A trader with only TOTP and recovery codes besides one password cannot remove the password.
  - Staff account (`seedAccount({ kind: 'staff' })`): `PUT /v1/account/password` and `POST /v1/account/totp/start` → `method-not-allowed`; adding PGP works.
  - `POST /v1/login/password` for a staff username with a password row inserted directly → `credentials-invalid` (password login refused for staff and owner).
  - `ownerReady` false with one hardware key, false with two where one is backed up, true with two hardware keys.
  - A session 6 minutes old: `PUT /v1/account/password` → `confirm-required` (Review Focus 1).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): login-method policy and staff primitives`.

### Task 10: Account overview, devices and alerts

**Files:**
- Create: `apps/api/src/routes/account.ts`
- Test: `apps/api/test/account.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 9.
- Produces:
  - `GET /v1/account/me` (recovery allowed) → `{ username, kind, level, methods: MethodType[], hasBackup: boolean, nudges: Array<'add-authenticator' | 'add-backup'>, payoutWait: { enabled: boolean; offAt: string | null } }`. `hasBackup` = at least two primary methods, or TOTP, or unused recovery codes. `add-authenticator` when the account has a password and no TOTP; `add-backup` when `hasBackup` is false. This feeds the onboarding Welcome screen (6.1 step 6).
  - `GET /v1/account/sessions` → `[{ id, deviceLabel, createdAt, lastSeenAt, current: boolean }]` (open sessions only); `DELETE /v1/account/sessions/:id` (full only) → 204, the session stops working immediately.
  - `GET /v1/account/alerts` → newest first, at most 50; `POST /v1/account/alerts/:id/seen` → 204.
  - Every `:id` route checks ownership; another account's id → 404 `not-found`.

- [ ] **Step 1: Failing tests:** password-only account → `nudges` `['add-authenticator', 'add-backup']`; after TOTP → `[]`; two sessions listed with one `current`; deleting the other ends it (its next request → `not-authenticated`); deleting another account's session → 404; alerts appear newest first and `seen` sets `seen_at`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): account overview, devices and alerts`.

### Task 11: Your wallets (confirm-it's-you, alert, opt-in 24-hour wait)

**Files:**
- Create: `apps/api/src/wallets/address.ts`, `apps/api/src/wallets/routes.ts`
- Test: `apps/api/test/wallets.test.ts`, `apps/api/test/address.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 10; monero-ts (Plan 1's pinned version).
- Produces:
  - `interface AddressValidator { isValid(address: string): boolean }`; `moneroAddressValidator(network: Config['moneroNetwork']): Promise<AddressValidator>` — `MoneroUtils.isValidAddress` with the matching `MoneroNetworkType`; standard, sub- and integrated addresses accepted.
  - `WALLET_APPS = ['cake', 'edge', 'feather', 'monerujo', 'stack', 'monero-gui-cli', 'ledger-trezor', 'other'] as const`
  - `PAYOUT_WAIT_MS = 24 * 3_600_000`
  - `GET /v1/wallets` → `[{ id, app, label, address, addressEnd /* last 6 */, usableFrom, usable: boolean }]`, never a balance.
  - `POST /v1/wallets { app, label, address }` (session `fresh`, full only) → 201. `address` trimmed; invalid or wrong network → 400 `address-invalid`; already listed → 409 `wallet-exists`; label 1–40 characters. `usable_from` = now if the account has never had a wallet (`had_wallet = false`) or the wait is off, else now + 24 h. Sets `had_wallet = true`. Always adds alert `wallet-added` `{ app, label, addressEnd, usableFrom }`.
  - `DELETE /v1/wallets/:id` (full only, no confirm needed: removal cannot redirect money) → sets `removed_at`; cancels a waiting wallet too.
  - `PUT /v1/account/security/payout-wait { enabled }` (session `fresh`, full only): turning on applies at once and clears `payout_wait_off_at`; turning off sets `payout_wait_off_at = now + 24 h` and adds alert `payout-wait-off-scheduled`. `payoutWaitActive(row, now)` = `payout_wait && (payout_wait_off_at is null || now < payout_wait_off_at)`.
  - `usableWallets(db, accountId, now): Promise<Wallet[]>` — Plan 3 calls this when a buyer picks a payout wallet.

- [ ] **Step 1: Failing tests** (validator tests use real addresses of the configured network generated with monero-ts; route tests use a fake validator):
  - `address.test.ts`: a valid stagenet address passes on stagenet and fails on mainnet; a one-character change fails; a subaddress passes.
  - First wallet with the wait on (set directly in the row) → `usable: true` immediately (6.1 step 5).
  - Session 6 minutes old → 403 `confirm-required`; recovery session → `recovery-session`.
  - Every add writes one `wallet-added` alert containing `addressEnd`, not the full address.
  - Wait on, second wallet: `usable` false at +23:59:59, true at +24:00:00; deleting it while waiting removes it.
  - Turning the wait off: wallets added in the next 24 hours still wait; after `payout_wait_off_at` new wallets are immediate; the alert is written.
  - Remove every wallet, then add one with the wait on → it waits (the first-wallet exemption is once per account).
  - The same address twice → `wallet-exists`; after removal it can be added again.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): payout wallets with confirm, alert and opt-in wait`.

### Task 12: Browser auth modules (`@x2f/auth-client`) and end-to-end flows

**Files:**
- Create: `packages/auth-client/package.json`, `packages/auth-client/tsconfig.json`, `packages/auth-client/src/index.ts`, `packages/auth-client/src/api.ts`, `packages/auth-client/src/webauthn.ts`, `packages/auth-client/src/onboarding.ts`
- Test: `packages/auth-client/test/flows.test.ts` (against a real `buildApi` listening on `127.0.0.1:0`, Postgres from Task 3's harness, the soft authenticator from Task 7)

**Interfaces:**
- Consumes: every route above; `@x2f/accounts`; @simplewebauthn/browser 14.0.0.
- Produces:
  - `createAuthApi(o: { baseUrl: string; fetch?: typeof fetch }): AuthApi` — one typed method per route (`registerPassword`, `registerPgpStart`, `registerPgpFinish`, `registerWebAuthnStart`, `registerWebAuthnFinish`, `loginPassword`, `loginSecondFactor`, `loginPgpStart`, `loginPgpFinish`, `loginWebAuthnStart`, `loginWebAuthnFinish`, `loginBackup`, `confirmPassword`, `confirmPgpStart`, `confirmPgpFinish`, `confirmWebAuthnStart`, `confirmWebAuthnFinish`, `addPgpStart`, `addPgpFinish`, `addWebAuthnStart`, `addWebAuthnFinish`, `totpStart`, `totpFinish`, `newRecoveryCodes`, `setPassword`, `listMethods`, `removeMethod`, `me`, `sessions`, `endSession`, `alerts`, `markAlertSeen`, `wallets`, `addWallet`, `removeWallet`, `setPayoutWait`, `logout`). `credentials: 'include'`. Non-2xx → throws `AuthApiError { status: number; code: ApiErrorCode; detail?: string; retryAfterSeconds?: number; missing?: string[] }`.
  - `registerWithWebAuthn(api, username, kind, deviceLabel, ceremony = { startRegistration })` and `loginWithWebAuthn(api, username, deviceLabel, ceremony = { startAuthentication })` — the ceremony functions are injectable so tests pass the soft authenticator.
  - `withConfirm<T>(api, action: () => Promise<T>, prove: (method) => Promise<void>): Promise<T>` — runs `action`; on `confirm-required` calls `prove` once, then retries once.
  - `defaultDeviceLabel(nav: { userAgentData?: { platform?: string } }): string` — e.g. `"Browser on Linux"`; coarse by design.
  - Re-exports `checkUsername`, `checkPassword`, `inspectPublicKey`, `normalizeLoginCode`, `normalizeRecoveryCode` for live form feedback.

- [ ] **Step 1: Failing tests** (a cookie-jar `fetch` wrapper with the right `Origin`):
  - Onboarding, PGP: register with a generated Ed25519 key, decrypt the message in the test, finish; add a passkey as backup; add a wallet without a confirm prompt (fresh session); `me()` shows `methods` `['pgp', 'passkey']`, `hasBackup: true`, `nudges: []`.
  - Onboarding, password: register, `me().nudges` equals `['add-authenticator', 'add-backup']`.
  - `withConfirm`: after advancing the server clock 6 minutes, `addWallet` triggers `prove` exactly once and then succeeds.
  - A leaked password surfaces as `AuthApiError` with `code: 'password-leaked'`; a throttled login carries `retryAfterSeconds`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(auth-client): browser auth modules`.

### Task 13: Security review of the plan's code

**Files:**
- Create: `docs/security/plan-2-review.md`

- [ ] **Step 1:** Run the Claude Security scan over `packages/accounts`, `packages/auth-client`, `apps/api` and `tools/leaked`, and check the code against OWASP ASVS 4 chapters V2 (authentication), V3 (sessions) and V4 (access control) at Level 3.
- [ ] **Step 2:** Fix every confirmed finding in the task that owns the code, with a test that would have caught it; re-run `npm run check`.
- [ ] **Step 3:** Record findings, fixes, and anything accepted with its reason in `docs/security/plan-2-review.md`. Also list what this plan deliberately leaves to later plans: a security-key tap to fund or withdraw (Plan 3), staff invites and login hours (Plan 4), PGP-signed withdrawal addresses, daily limits and encrypted email notifications (Plan 6), passkeys inside Capacitor (Plan 6), WebAuthn on the `.onion` origin (Plan 6).
- [ ] **Step 4:** Commit `docs: plan 2 security review`.
