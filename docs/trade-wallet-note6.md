# Owner demo note #6 (16 Nov 2026): a payout address per trade, and weak vs secure accounts

Source: comms `owner-demo-notes-2026-11-16b.jsonl` line 6 (id c632aab1), assigned to Claude (lead/claude3)
in `to-lead.log` 2026-11-16 23:12:25. Branch `wip/third-trade-wallet`, from main 4f0afa14.

The owner's words, in short: on the screen where the amount is entered (after tapping to trade) show
"what wallet address should those funds be transferred to", with smaller text explaining the rule. A
**secure** account (login name + display name + password **and at least one other method**) picks from a
dropdown of approved addresses or adds a new one right there, one-time or saved for future trades. A
**weak** account (only login name + display name + password) gets the dropdown only and adds new
addresses in Settings, where they take 24 hours before they work. Both can name a wallet.

## Step 1: the map (main 4f0afa14)

### Where payout addresses live and are checked

| What | Where |
|---|---|
| Table `wallets` (id, account, app, **label 1-40**, address, `usable_from`, `removed_at`) | `apps/api/migrations/008_wallets.sql:4-15`; unique open address per account `:17` |
| Monero address validator (monero-ts: checksum, keys, network byte; integrated refused) | `apps/api/src/wallets/address.ts:33-50` |
| Routes `GET /v1/wallets`, `GET /v1/wallets/rule`, `POST /v1/wallets` (one or a batch), `DELETE /v1/wallets/:id` | `apps/api/src/wallets/routes.ts:404-438` |
| Body checks (app, label trimmed 1-40 code points, no control/format chars, address via the validator, not already listed) | `apps/api/src/wallets/routes.ts:118-174` |
| Confirm-it's-you per add (token bound to the exact address list; onboarding first wallet exempt) | `apps/api/src/wallets/routes.ts:190-198`, `:252-262` |
| The wait by confirm method: PGP / passkey / security key → usable at once; password (with or without TOTP) → `usable_from` + 24 h; first wallet ever → at once | `apps/api/src/wallets/routes.ts:271-282`; `STRONG_CONFIRM_METHODS` `apps/api/src/auth/confirm.ts:36`; password+TOTP confirm records `password` `apps/api/src/auth/password.ts:316-319` |
| "Usable" = open and `usable_from <= now` | `apps/api/src/wallets/routes.ts:64-73` |
| Settings screen "Your wallets" (`/wallets`) | `apps/web/src/screens/Wallets.tsx:243-623`, rule texts `apps/web/src/screens/wallets-model.ts:62-112`, route `apps/web/src/App.tsx:253` |

**Wallet name already exists**: every wallet has a user label (1-40 characters), shown with the last 6
characters of the address in Settings (`Wallets.tsx:178-186`) and on the quote (`quote/WalletPicker.tsx:42-56`).
Note item 2 ("give the wallet a name") is therefore already built; nothing new was needed for it.

### Hold model v3 and the 24 h waits

- `gateChange` (`apps/api/src/auth/hold.ts:514-533`): a session whose **login** waits (a username and
  password alone, `strength.ts:21-36`; outside the sign-up's first 30 minutes) has its change **staged**
  (`hold_changes`, migration `016_hold_v3.sql:2-34`), submitted, then applied 24 h after submission.
  Strong logins may approve early, any login may cancel (`holdRoutes.ts:93-102`).
- **Adding a wallet is already a held change**: `POST /v1/wallets` is in `SECURITY_CHANGE_ROUTES`
  (`hold.ts:553`), the add calls `gateChange` with `{ kind: 'wallets', items, method }`
  (`wallets/routes.ts:271`), and the staged wallets are inserted by `applyWallets` when the change
  applies (`wallets/routes.ts:243-246`, `hold.ts:283-284`), usable at once then (they have waited).
- So today the rule is by **login strength of the session** and the **confirm method**, not by the
  account's methods: a weak account (password only) can only ever log in weak, so every add it makes in
  Settings is staged for 24 h (except the onboarding first wallet, see Q4). A secure account logged in
  strongly adds at once when it confirms with PGP / passkey / security key, and waits 24 h
  (`usable_from`) when it confirms with its password (+TOTP).

### The amount screen and how the trade's payout address is chosen

- Quote screen (the screen after tapping an offer, where the amount is entered):
  `apps/web/src/screens/quote/Quote.tsx:132-507`; BuyQuote/SellQuote copy `BuyQuote.tsx`, `SellQuote.tsx`.
- Wallet picker: radio list of usable wallets, waiting ones counted, "Add another wallet" link to
  Settings → Your wallets (`quote/WalletPicker.tsx:24-69`). **No default**: nothing is picked until the
  person picks (OD-11 / X-2, `docs/superpowers/plans/2026-10-15-plan-3-trading.md:160,210`), except on
  return from Add a wallet with exactly one usable wallet (`Quote.tsx:229-244`).
- The take sends `walletId` only, never an address (`apps/api/src/trades/take.ts:90-113`, unknown keys
  refused). The server takes the address from the taker's own **usable** wallet (`pickWallet`,
  `take.ts:127-133`, 409 `wallet-not-ready` / `no-wallet`) and writes it once into
  `trades.buyer_payout` / `seller_refund` (`take.ts:414-419`; poster side `take.ts:448-496`).
- Binding: the trigger `trades_deal_fixed` makes the addresses write-once, only in `setup`
  (`112_take.sql:24-87`); the attested terms carry `buyerPayout`/`sellerRefund` from the trade row
  (`apps/api/src/internal/routes.ts:96-127`) and each device checks them against what it confirmed
  (`quote/confirmed.ts`, `ownAddress` in `Quote.tsx:296-303`). **None of this was changed.** A one-time
  wallet only changes what the wallet list shows after the take; the trade keeps its own copy of the
  address exactly as before.

### Is there a "security rating" today?

No. `grep -i "rating|secure|weak"` finds only login **session** strength (`auth/strength.ts`,
`hold.ts:454 weakOf`), password strength (`password.ts:93 password-weak`), reviews' star ratings and
`hasBackup` (`routes/account.ts:195-200`, R11). Nothing rates the **account** by the methods it holds.
Method counts for an account already exist: `methodCounts` (`routes/account.ts:166-179`).

### Conflicts found (listed as owner questions below, not decided)

1. **OD-11 "no default payout wallet; always ask"** vs the note's "use the default address" and the
   brief's "defaulting to the default one". There is no default-wallet concept in the data.
2. **"Dropdown"** vs the built picker: a radio list (board BuyQuote/SellQuote; e2e and parity tests
   select radios).
3. **Secure + inline add "right then and there"** vs the confirm-method rule (owner 2026-10-23/24): a
   wallet confirmed with a password (+ TOTP) waits 24 h even from a strong login. A secure account whose
   only extra method is TOTP therefore gets a new address that does **not** work for the trade it is
   starting. Making it work at once would loosen an owner rule.
4. **Onboarding first wallet** (owner 2026-10-23/24): the first wallet ever is usable at once however it
   is confirmed, including for a weak account in its first 30 minutes. The note says a weak account's new
   address waits 24 h.
5. **Owner decision 16 Nov 17:50 (to-lead.log:426)**: "Password does NOT stand alone: it needs TOTP (or
   another method)". If that ships (it is on `wip/second-signup-r3-fixes`, not main), a new account is
   never weak; "weak" would only describe accounts made before it.
6. **Recovery code as "another possibility"**: the note says weak = only the three, secure = the three
   "and a minimum of one of the other possibilities". A recovery code is a backup way in, itself a weak
   single way (spec, 24 h hold) and never a second factor (`STRONG_COMBOS`, `strength.ts:21-30`).
7. **Removing an address**: the note is silent; removals from a weak login already wait 24 h (owner p5-7).

## Step 2: what was built

1. **Account rating, one server function**: `accountRating` (`apps/api/src/auth/rating.ts:20-24`).
   `secure` = a PGP key, passkey or security key, or a password with an authenticator app, on top of the
   login name and display name every account has; `weak` = anything less (a password alone, a password
   with recovery codes (Q6), an authenticator app with no password, no method). Exposed as
   `securityRating` on `GET /v1/account/me` (`apps/api/src/routes/account.ts:72,318`; null for team
   members, staff and owner). Tests: `apps/api/test/rating.test.ts` (14 combinations),
   `apps/api/test/account.test.ts` "rates the account weak or secure".
2. **Wallet name**: already built (label 1-40, `wallets/routes.ts:131-141`); the quote and the new
   sheet show it with the last 6 characters of the address.
3. **One-time vs saved**: migration `apps/api/migrations/620_wallet_one_time.sql` (`wallets.one_time`,
   default false; 620 is free on main and every remote branch). `POST /v1/wallets` takes `oneTime` per
   wallet (`wallets/routes.ts:136`, 400 before the confirm token otherwise; stored `:235-237`); staged
   adds keep it through the hold and an older staged change applies as saved. `useUpOneTimeWallet`
   (`wallets/routes.ts:379`) marks it removed in the trade's own transaction, under the account lock:
   the take (`apps/api/src/trades/take.ts:427`) and the poster's wallet route (`take.ts:496`). The
   trade's address copy, `trades_deal_fixed`, the attested terms and escrow are untouched. Jabber change
   paths classify the new column (`apps/api/src/jabber/changePaths.ts`).
4. **Amount screen (quote)**: the owner's question and the rule for the account's rating above the
   wallet list (`quote/WalletPicker.tsx:60-65`, words in `quote/addressCopy.ts`). A secure account gets
   "Add a new address" (`WalletPicker.tsx:88`, `Quote.tsx:414-419`) opening `quote/NewAddressSheet.tsx`:
   name, address, "This trade only" (default) / "Future trades too", saved through the same
   `POST /v1/wallets` + confirm-it's-you as Settings (`NewAddressSheet.tsx:57`). Usable at once → picked
   for this trade; waiting (password confirm) → says when it works; staged (username-and-password login)
   → the waiting-changes note. Weak (or unknown rating) → no inline add, the rule points to Settings and
   the existing "Add another wallet" link stays. One-time wallets are tagged "One trade only".
5. **Settings → Your wallets**: the add form's "Use it for: Future trades / One trade only" choice
   (`apps/web/src/screens/Wallets.tsx:324,570`), tag on the row. The existing rule is kept for everyone
   (weak logins staged 24 h, password confirms wait 24 h, strong confirms at once). Nothing loosened.
6. **Server enforcement**: the take accepts only a `walletId` of the taker's own usable wallet; an
   address in the body is 400; a staged, waiting, foreign or used one-time wallet is 409
   `wallet-not-ready` (`apps/api/test/take.test.ts`, "one-time wallets and the per-trade address").

Checks on the branch head: typecheck (19 workspaces) clean; copy-lint clean (no new `not-a-refusal`
pragma); separation-check ok; vitest api 116 files / 2703 passed (1 todo), web 138 / 2121,
auth-client 6 / 77, tools 2 / 7; Playwright quote + wallets 60 passed, fold, block, browse-buy,
browse-sell, setup, offer-units, team, accepted-phone 150 passed (1 skipped, existing),
design-shots + parity 50 passed (52 skipped, existing).

## Owner questions

- **Q1 (default address).** OD-11 says "no default payout wallet; always ask". Your note says secure
  accounts are "asked to use the default address or enter a new one". Should there be a default address
  (which one: the first saved, or one you mark)? Built: no default; with one usable address it is the
  only choice in the list.
- **Q2 (dropdown).** The quote shows the addresses as a list to tap (the approved board). Do you want
  it changed to a dropdown? Built: the list, unchanged.
- **Q3 (inline add for TOTP-secure accounts).** Today a new address confirmed with a password (and
  authenticator code) works 24 hours later, even from a strong login; with a passkey, security key or
  PGP key it works at once. So a secure account whose extra method is the authenticator app cannot use
  a brand-new address on the trade it is starting. Should a password + authenticator confirm make a new
  address work at once? Built: unchanged (it waits), and the screen says so.
- **Q4 (first wallet).** A brand-new account's first address works at once, however it is confirmed
  (your rule of 23-24 Oct), weak accounts included. Should a weak account's first address wait 24 hours
  too? Built: unchanged.
- **Q5 (password alone after 16 Nov).** Your 16 Nov decision says a password never stands alone (it
  needs TOTP or another method). Once that ships, every new account is secure. Is "weak" then only for
  accounts made before it, and should they be asked to add a method? Built: the rating works either way.
- **Q6 (recovery code).** Does a recovery code count as "one of the other possibilities"? It is a backup
  way in, not a second factor. Built: it does **not** count (stricter); a password + recovery code
  account is rated weak.
- **Q7 (expired PGP key).** A PGP key that has expired or been revoked still counts toward "secure" as
  built (the account holds it). Should only a working key count?
- **Q8 (wording).** All new text is COPY-UNSIGNED and needs your wording sign-off (the note asked for
  "procure (or buy or purchase, whichever)"; built with "buy").
