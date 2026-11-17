# Review: wip/third-trade-wallet @ d3dc3c4f (owner demo note #6, per-trade payout wallet)

Reviewer: claude3 (independent security review), 2026-11-17. Base: origin/main 4f0afa14.
Worktree: fresh detached `/home/user/rv-tradewallet`, `npm ci`, Node 24. Branch not modified.

## VERDICT: APPROVE WITH MINORS

No security (S) or blocking (B) findings. Nothing in the branch lets a weak or freshly stolen session
(password only, or password + TOTP) make a new address receive a payout sooner than main allows. The
server-side change is small (migration 620, `useUpOneTimeWallet`, an optional `oneTime` field, a read-only
`securityRating` on `/v1/account/me`) and every path that decides *when* an address becomes usable is
byte-for-byte unchanged.

## What was verified (attacker view)

1. **No faster path for a new address.** `git diff origin/main` is empty for `auth/hold.ts`,
   `auth/confirm.ts`, `auth/strength.ts`, `wallets/address.ts`, `trades/store.ts`, `internal/`,
   `migrations/112_take.sql`. In `wallets/routes.ts` only the item shape (`oneTime` boolean or absent,
   400 before the token is redeemed), the insert column and `useUpOneTimeWallet` changed; `walletConfirm`,
   `redeemConfirm`, `gateChange`, the `had_wallet` onboarding rule and the `STRONG_CONFIRM_METHODS` wait
   (`wallets/routes.ts:285-312`) are untouched. The inline "Add a new address" sheet on the quote
   (`apps/web/src/screens/quote/NewAddressSheet.tsx`) posts to the same `POST /v1/wallets` + confirm-it's-you,
   so a weak login is still staged 24 h (202) and a password(+TOTP) confirm still waits 24 h; only a
   PGP/passkey/security-key confirm from a strong login is usable at once, exactly as on main.
   - Use-up does **not** reopen the onboarding exemption: it sets `wallets.removed_at` only;
     `accounts.had_wallet` is sticky (`wallets/routes.ts:190-195`, `:252`), so an account emptied by a
     one-time use-up re-adds with a token and the normal wait.
   - Take still accepts only `walletId` (exact key set, `take.ts:101-104`); `pickWallet`
     (`take.ts:127-133`) requires the taker's own open wallet with `usable_from <= now`; address in body = 400.
2. **Rating is server-only and advisory.** `accountRating` (`auth/rating.ts:20-24`) reads `methodCounts`
   (`routes/account.ts:178-191`, DB rows only; no client input). Secure = PGP/passkey/security key, or
   password+TOTP; TOTP without password, recovery codes, nothing = weak (fails closed). Null for team
   members, staff and owner (`routes/account.ts:318`). It is used **only** for display: `grep accountRating`
   finds no authorization use, so a lying client that shows itself the inline sheet gains nothing (the
   server rules above still apply). Consistent with the 16 Nov rules on wip/second-signup-r3-fixes
   (TOTP only with password, password never alone).
3. **One-time wallets.** Use-up runs inside the take's transaction after `insertTrade`, under
   `select ... from accounts ... for update` of both parties (`take.ts:304`, use-up `:427`), and inside the
   poster route's transaction under the poster's account lock + wallet `for share` (`take.ts:470-496`).
   Probes (below) show: two concurrent takes with the same one-time wallet -> one 200, one 409
   `wallet-not-ready`, exactly one trade carries the address; a take racing the poster wallet route with
   the same one-time wallet -> 204 + 409 `wallet-not-ready`; a take that fails at commit after the use-up
   (deferred trigger) -> 500 and the wallet is still open. A staged one-time add keeps `oneTime` in
   `hold_changes` and `applyWallets` inserts it (tested); a staged removal of a wallet that a trade used up
   meanwhile hits `applyWalletRemoval` 404, which the apply loop already drops (`hold.ts:225-239`).
4. **Trade address/escrow unchanged.** `trades.buyer_payout` / `seller_refund` are written exactly as on
   main from `wallet.address` (`take.ts:414-419`, `:484-493`); the trade keeps its own copy, the
   `trades_deal_fixed` trigger and the attested terms (`internal/routes.ts`) are unchanged; the device's
   `ownAddress` is captured at take/accept (`Quote.tsx:317`, `AcceptedSheet.tsx:145`) and never re-read
   from the wallet list, so removing the wallet row cannot break or redirect escrow.
5. **Migration 620.** `alter table wallets add column one_time boolean not null default false`:
   existing rows become saved wallets; no rewrite risk beyond a constant default. Number check over all
   236 remote branches: only 600 (`600_revenue_network_fee.sql`, netfee branches) and 610
   (`610_display_name_unicode.sql`, many) exist in the 6xx range; **620 is unique**. The runner applies
   by name set (`db/migrate.ts:17-39`), so 600/610 landing later is fine. Jabber: `one_time` classified
   as a change (`jabber/changePaths.ts:78-80`); `jabber-paths.test.ts` 27/27.
6. **Tests.** Red-first confirmed: at 58ef15ae (tests only) wallets/take/account/rating fail with
   10 failed / 152 passed plus `rating.test.ts` failing to import. Existing tests: only additions, the
   `WalletOut` key list gained `oneTime`, and `schema.test.ts` lists gained `620_wallet_one_time.sql`;
   nothing removed or loosened.

## Findings

S: none. B: none.

**M1. A one-time wallet is spent even when its trade never happens; re-adding it waits 24 h.**
`apps/api/src/trades/take.ts:427` and `:496` mark it removed at take/setup; a trade cancelled in setup
(poster never sets up, `setup_by` passes, either side cancels before funding) leaves the person without
the address, and because `had_wallet` is set the re-add needs a token and waits 24 h (password confirm)
or is staged (weak login). The quote sheet defaults to "This trade only"
(`apps/web/src/screens/quote/NewAddressSheet.tsx:28`). Safe direction (fails closed), but a likely
surprise. Fix: do NOT restore the wallet automatically (that would need its own review); add one line to
the one-time copy ("if this trade is cancelled you will need to add it again") and raise it as an owner
question next to Q1-Q8.

**M2. Concurrency and rollback of the use-up are untested.** `apps/api/test/take.test.ts:1096-1174`
has no race or post-use-up rollback case. Fix: add (a) two takes on two offers with the same one-time
wallet via `allAtOnce([accounts lock on the taker], 2, ...)` expecting `[200, 409 wallet-not-ready]` and
one trade with the address; (b) take vs `POST /v1/trades/:code/wallet` with the same one-time wallet;
(c) a take failing at commit (deferred constraint trigger on `trades`) leaving the wallet open; (d) the
poster route refused (e.g. wrong-state) leaving it listed. My local probes for (a)-(c) pass (not committed).

**M3. Test title overclaims "staged".** `apps/api/test/take.test.ts:1158` says "staged, waiting or
sent as an address" but only inserts a waiting row directly (`addWallet(weak.id, false)`); no add goes
through `POST /v1/wallets` from the weak-single session, and that test passes on main too (guard, not
red). Fix: either rename to "waiting, foreign or sent as an address", or add a real
`POST /v1/wallets` from the weak session expecting 202 and assert no new usable wallet / take still 409.

**M4. A waiting one-time add is not marked one-time in the waiting-changes summary.**
`apps/api/src/auth/holdChanges.ts:84-85` returns count and address ends only, so Settings' pending
change list cannot show "One trade only" for a staged one-time add. Cosmetic. Fix: include
`oneTime: c.items.map((w) => w.oneTime === true)` and render the tag.

**M5. Comment says "no alert" but the use-up does send a Jabber change notice.**
`apps/api/src/wallets/routes.ts:373-378`: true for the in-app alert, but the `wallets` row trigger
queues a Jabber notice for `removed_at` (as `changePaths.ts:79` itself says). Fine behaviour; reword the
comment to "no in-app alert; the Jabber change notice still goes out" so a later reader does not
"fix" the trigger.

**M6. A vendor whose last usable wallet was one-time keeps live offers it cannot set up.**
Posting requires a usable wallet (`apps/api/src/offers/routes.ts:740`) but the take's `poster_ok`
(`take.ts:146-148`) does not; after the use-up a later take on another of their offers starts a trade
the poster cannot set up (409 `no-wallet`) and it times out at `setup_by`. Pre-existing for manual
removal; one-time wallets make it routine. Fix (small): note it for the owner, or hide/refuse such
offers via an open-usable-wallet check in `poster_ok` (separate change).

## Checks run (fresh worktree at d3dc3c4f)

- `npm ci` ok; `npm run typecheck` (all workspaces) exit 0.
- API vitest: account 35/35, holdV3 45/45, jabber-paths 27/27, rating 14/14, schema 77/77,
  take 62/62, wallets 65/65 = 7 files, 325/325 passed.
- Web vitest: quoteAddress + wallets 2 files, 21/21 passed.
- Red-first: tests-only commit 58ef15ae on main code: 4 files failed, 10 failed / 152 passed + rating
  import failure.
- Local probes (appended to take.test.ts, reverted, not committed): 3/3 passed (concurrent one-time
  takes -> [200, 409 wallet-not-ready]; take vs poster route -> [204, 409]; commit-time failure leaves
  the wallet open).
- Migration number scan over 236 remote branches: 620 unique.
- Playwright not run (as instructed).
