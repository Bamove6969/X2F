# Re-review (round 2): Plan 3 Task 28 "Getting started" (`origin/wip/t3-p3-task28` @8d6d455)

Reviewer: independent subagent (read-only), 2026-10-29. Scope: the fix round 651d84a (against round 1, `review-task28-2026-10-28.md`), the main merge 8839818 (5dd43e2), the CSS rename 749e450, the Task 29 merge 37a498a (a1d2181) and the wallets-model switch 8d6d455. Trial merge onto the main line 0e92cb6 in a detached worktree (`~/x2f-worktrees/rv-t28`, since removed).

**Verdict: APPROVED WITH MINOR** (0 Important, 3 Minor). Both Important findings and all nine Minor findings from round 1 are fixed and have tests. The merges are correct, and the CSS rename is complete. Nothing new is broken.

## Test runs (trial merge 0e92cb6 + 8d6d455, all under `flock ~/x2f-comms/check.lock`)
- The trial merge was clean, with no conflicts. package-lock.json is unchanged, and `npm ci` was run.
- `tsc --noEmit -p apps/web`: exit 0.
- `vitest run --project @x2f/web`: 53 files, **751/751 passed** (exit 0).
- Playwright `setup login parity-auth quote post parity shell wallets`: **178/178 passed** (4.6 min). This matches claude2's count: setup 32, login 18, parity-auth 4, quote 33, post 21, parity 50, shell 4, wallets 16.

## Round-1 findings: each one checked
| # | Status | Where (merged tree) |
|---|---|---|
| I1 key-in-use loop | Fixed | `register.ts` `setupError` maps `key-in-use` to `KEY_IN_USE` + `keyInUse`. `kit.tsx` `RegisterError` adds "Use a different key" (pgp-key, `replace`) and "Log in" (`/login?returnTo=` encoded). `PgpChallenge.tsx` hides "Send a new message" when `keyInUse`. `Backup.tsx` SecondPgpKey maps `key-in-use`, `challenge-expired` and `code-invalid` separately. e2e setup.spec:565 and :580. |
| I2 Back re-opens sign-up | Fixed | `SetupFlow.tsx` `before()` sends name/login/pgp-key/password to `backup` with `replace` once `state.registered`. Login, Password and pgp-continue use `go('backup', { replace: true })`. pgp-code stays on purpose: done, it shows only Continue. A reload with no flow state goes through SetupStart, which already handles a signed-in session. e2e :596 and :609 check that there is exactly one register call. |
| M1 dead detail branch | Fixed | PgpKey uses `setupError`, which goes to `refusalText`, which shows `detail` for an `AuthApiError`. Unit test task28-units "shows the server's sentence about a refused key from the typed client". |
| M2 waits / busy / missing | Fixed | `setupError`: 503 `busy` gives "Try again in N minutes"; 429 goes through Task 30's `waitSentence`; `password-weak` lists the rules from `missing`. The keys match `packages/accounts/src/password.ts` (length, upper, lower, number, symbol, too-long). Unit-tested. |
| M3 /terms retry loop | Fixed (see m2) | `Terms.tsx:88-94`: on `terms-not-accepted` it resets tick/read, scrolls to the top and reloads. e2e :707. |
| M4 version vs text | Fixed (see m1) | `termsText.ts` `TERMS_TEXT_VERSION = '2026-10-17'`. `Terms.tsx:79` `stale` turns off the tick box and I accept, and shows "Reload the page". e2e :729, and a unit test checks that the constant is a valid env value. |
| M5 passkey untested | Fixed | e2e :623 uses a CDP virtual authenticator. It checks both names and the kind on start, and `acceptedTerms` and a non-version `deviceLabel` on finish, so swapped arguments would fail. :665 checks the cancelled prompt. |
| M6 terms reset untested | Fixed | e2e :677: register returns `terms-not-accepted`, the person is sent back to the Terms, the names are kept, and the retry carries the version. |
| M7 integrated address | Fixed | `Wallet.tsx` regex accepts 95 or 106 characters. The server's `address-integrated` sentence is shown (e2e :740). |
| M8 a11y | Fixed | `kit.tsx` `radioProps`: roving tabindex, arrow keys with wrap, focus moves. It is used in Login, Backup and Wallet. Every group's initial value is non-null, so there is always one tab stop. The tick box has `aria-describedby` (the hint or the stale notice), and so do both name inputs. e2e :751. |
| M9 parity visible() | Resolved by Task 29 | 37a498a takes 29's round-2 `visible()`. `parity.spec.ts` on the merged tree is identical to the main line. It keeps the "inner scroll container still counts" test, the "off right edge" test and the "overflow:hidden" test (:210/:219/:226), so 73f7e70's own test is covered by 29's equivalent. |

## Merges
- **App.tsx (37a498a)**: compared with 0e92cb6, the only change is `/setup/*` → `SetupFlow` and `/terms` → `Terms`, plus their two imports. `/wallets` → `Wallets` appears once. Nothing is duplicated or dropped, and the `app-routes` test is green.
- **Tests not lost**: the merged tree has the same number of tests as the main line in quote.spec (18 blocks), post.spec (20) and quoteScreen (22).
  - parity-auth was rewritten into a 2×2 loop (42e4703, reviewed in round 1), and it still runs 4 tests.
  - The only tests removed are the retired tripwires `NEEDS_TASK_28` in quote-tripwires and post-tripwires. Real walks through Welcome replace them, in quote.spec ("You're back") and post.spec (the draft is restored).
  - quote.spec keeps 29's wallet stubs and adds `methods` to the `me` stub.
- **parity.ts**: the Setup exception lists (SetupTerms, SetupPgpKey, SetupPgpChallenge, SetupUsername, SetupWallet) sit next to the main line's lists, unchanged from round 1.
- **CSS rename (749e450)**:
  - `x2f-setup` remains only in `screens/trade/SetupStatus.tsx` and `trade.css`, which are Task 22's own.
  - Every one of the 52 `x2f-start*` classes used in `screens/setup/*.ts(x)` is defined in `setup.css`, and every class defined there is used.
  - No other file uses `x2f-start`. Tests select by `data-part`/`data-screen`, so none needed to change.
  - The setup.css selectors that do not start with `x2f-start` are `.x2f-check`, `.x2f-terms*`, `.x2f-welcome*`, `#addr` and `[data-username]`. These were already in round 1. None of them collides with a Task 22 class.
- **wallets-model switch (8d6d455)**:
  - `APP_LABELS`, `WALLET_APPS` (same order and labels as 28's copy), `appPromptName` (same "your wallet" for Other) and `nextWalletName(0)` = "Wallet 1".
  - No importers of the removed `Wallet.tsx` exports remain.
  - e2e checks the POST body `label: 'Wallet 1'`.

## Minor

**m1. Deploy and dev docs do not say `X2F_TERMS_VERSION` must equal `TERMS_TEXT_VERSION`. With any other value, nobody can sign up.**
Files: `apps/web/src/screens/setup/termsText.ts:14`, `docs/dev-setup.md:11`.
- The coupling is recorded only in termsText.ts's comment and in coordination.md. dev-setup.md lists `X2F_TERMS_VERSION` with only "(≤ 32 characters)".
- Failure scenario: someone sets up a dev or staging stack from dev-setup.md with `X2F_TERMS_VERSION=v1` (the value the api tests use). Every /setup and /terms screen shows "The Terms have been updated. Reload the page", and the tick box and I accept never turn on. Reloading does not help, so no account can be created.
- Fix: add "must equal `TERMS_TEXT_VERSION` in apps/web/src/screens/setup/termsText.ts (currently 2026-10-17)" to dev-setup.md, and to the deploy checklist when there is one.

**m2. M3's retry path, in its realistic form, shows two contradictory messages, and the test covers only a scenario that cannot happen.**
Files: `Terms.tsx:88-94` and `:156-158`; `e2e/setup.spec.ts:707-727`.
- In practice `terms-not-accepted` at accept means the server's version moved from N to N+1. After `load()`, the version is N+1, which is not `TERMS_TEXT_VERSION`, so `stale` is true.
- Failure scenario: the screen shows both "The Terms changed while you were reading. Read them to the end again, then accept." and "The Terms have been updated. Reload the page…", with the tick box disabled. The first sentence asks for something the person cannot do.
- The e2e stub answers `terms-not-accepted` with the same `TERMS_VERSION`, so the stale path never comes up in the test.
- Fix: skip the "read again" error when the reloaded version is stale, or only set it after `load()` resolves to a version the bundle carries. Add a test where the reload returns a different version.

**m3. Comment drift after landing.**
File: `apps/web/test/quote-tripwires.test.ts:8`. It says "Task 28's setup is on the branch since 2026-10-28". Once merged, it should read "on the line since <merge date>", as the Task 29 sentence next to it does. Cosmetic.

## Carried over (already noted by the builder, not counted)
- The `registerWithWebAuthn` adjacent-string arguments are an API-shape risk. M5's e2e now catches a swap.
- The SetupUsername "lumen.k is available" exception and the stale 24-hour wording on the SetupWallet board remain open with the lead.
