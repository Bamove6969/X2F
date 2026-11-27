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

### Round 2: the owner's answers of 17 Nov, and the review's minors

Owner answers to Q1-Q3 (below) and review `review-third-trade-wallet-2026-11-17.md` (claude3: approve
with minors) M2-M5. Hold and confirm-wait rules are unchanged from main.

7. **Three-level rating**: `accountRating` (`apps/api/src/auth/rating.ts:24`). It returns:
   - `high` for a PGP key, passkey or security key, with or without a password;
   - `medium` for a password with the authenticator app;
   - `weak` for anything less.

   It authorises nothing. Tests: `apps/api/test/rating.test.ts`; `account.test.ts` "rates the account
   weak, medium or high". The web side is `SecurityRating` in `packages/auth-client`.
8. **Default payout wallet** (overrides OD-11):
   - Migration `630_wallet_default.sql` adds `wallets.is_default`. A check stops a one-time wallet being
     the default, and a partial unique index allows one open default per account. 630 is free on every
     remote branch.
   - `effectiveDefault` (`wallets/routes.ts:72`) picks the chosen open wallet, else the only usable
     saved wallet, else none. `GET /v1/wallets` sends it as `isDefault`.
   - `PUT /v1/wallets/:id/default` (`defaultHandler`, `wallets/routes.ts`) is for the account owner
     only. It changes no address and no wait, but it does change which address the quote and the
     accepted sheet preselect, so (review 17 Nov (b), B1) it is a security change like a removal:
     - the session is re-checked live under the account lock (`requireLiveSessionInTx`);
     - a wallet still waiting is refused, 409 `wallet-not-ready`, and `effectiveDefault` only counts a
       chosen wallet once it is usable, so one chosen while it waited never outranks a usable one;
     - it applies at once from any login, never staged (owner Q12, 27 Nov 2026; `applyDefaultWallet`);
     - the hold blocks it (403 `recovery-hold`);
     - applied, it writes alert `wallet-default` (app, label, end of the address), once per change.
     It answers 404 for a wallet that is not open or not theirs, and 409 `wallet-one-time`.
   - Route classification: `SECURITY_CHANGE_ROUTES` and `HOLD_BLOCKED_ROUTES` (`hold.ts`); `frontDoor.ts:160`;
     Jabber change path; `ApiErrorCode` and `NOT_REFUSAL_CODES`; `setDefaultWallet` in auth-client
     (`Staged` on a 202). Settings offers "Make default" only on a usable saved wallet and shows the
     waiting-changes note when the choice is staged.
   - Quote: picks the default first (`Quote.tsx:204`) and marks it "Default" (`WalletPicker.tsx:132`).
     A wallet in the URL wins, and any usable wallet can still be picked. The take still sends only a
     `walletId`.
   - Settings: "Make default" on other saved wallets and a "Default" tag (`Wallets.tsx:193,442`).
   - AcceptedSheet (the poster's pick) is unchanged: it still has no default (Q9).
   - The list stays an accessible radio list: the owner left the display open ("whatever creative way",
     a dropdown "is pretty easy").
9. **Inline add for high accounts only** (`Quote.tsx:416-419`). Weak and medium accounts get a "?"
   button (`AddressTip`, `WalletPicker.tsx:30,117`):
   - it is a real `<button>` with `aria-expanded` and `aria-controls`, so tap, click, Enter and Space all
     work; it is not hover-only;
   - Escape closes it and gives focus back to the "?";
   - the explanation links to Your wallets and to Settings → Security.

   The text is `ADDRESS_TIP` in `quote/addressCopy.ts`, marked COPY-UNSIGNED.
10. **Review M2** (`apps/api/test/take.test.ts`, "one-time wallets under races and rollbacks"):
    - two takes at once with the same one-time wallet give 200 and 409 `wallet-not-ready`, with exactly
      one trade on the address;
    - a take racing the poster's wallet route has one winner and one 409;
    - a take that fails at commit (deferred trigger) answers 500 and the wallet stays open;
    - a refused poster route (`wrong-state`) leaves the wallet listed.
11. **Review M3**: the test now really posts `POST /v1/wallets` from a weak login (202 staged, no wallet
    row) and is retitled "staged, waiting, foreign or sent as an address".
12. **Review M4**: the waiting-changes summary carries `oneTime` per wallet (`holdChanges.ts:89`).
    Settings shows "(one trade only)" (`settings/holdCopy.ts:58`).
13. **Review M5**: the use-up comment now names the Jabber change notice (`wallets/routes.ts:397`).

### Round 3: the owner's answers to Q9-Q11

14. **Q9: the default is picked first on the "accepted your offer" sheet**
    (`apps/web/src/screens/AcceptedSheet.tsx:130`, and it is tagged "Default"). The poster can still
    pick another wallet. With no usable default, nothing is picked, as before. Tests:
    `apps/web/test/AcceptedSheet.test.tsx`.
15. **Q10: a one-time wallet comes back if its trade ends in setup with nothing funded.**
    - Migration `640_wallet_used_by_trade.sql` adds `wallets.used_by_trade`. A check allows it only on
      a removed one-time wallet. 640 is free on every remote branch.
    - `useUpOneTimeWallet` (`wallets/routes.ts:402`) records the trade's code.
    - `trades/store.ts:410` `applyEvent` calls `restoreOneTimeWallets` (`wallets/routes.ts:421`) only
      when all of these hold: the previous state was `setup`, the new state is `cancelled`, nothing was
      received and no funding was seen. It runs in the same transaction, before `countCancel`.
      This covers a buyer cancel, a seller walk-away, a system cancel, and expiry after `setup_by`.
    - The state machine, escrow and payouts are unchanged; this is wallet bookkeeping only.
    - Lock order (review 17 Nov (b), B2): when the trade in setup used up a one-time wallet,
      `applyEvent` locks both parties' accounts in id order right after the trade row and before the
      route's own check (`trades/store.ts`, the block after `rowToTrade`). The order is then "trade row,
      then both accounts in id order", so a take (which locks [taker, poster] in id order and holds no
      trade row) waits instead of deadlocking.
    - It never restores:
      - a wallet whose removal applied while the trade used it: `applyWalletRemoval` clears
        `used_by_trade` and sends the alert (`wallets/routes.ts:448`);
      - a purged address;
      - an address that is open again on the account.
    - It never touches `had_wallet` or any wait, and never creates an address.
    - Review 17 Nov (b), M1: while its trade is in setup, a used-up one-time wallet is listed by
      `GET /v1/wallets` with `inUseByTrade` (the trade's code), never usable and never the default.
      Settings shows it as "In use" by that trade; the quote and the accepted sheet leave it out.
      `DELETE /v1/wallets/:id` reaches it (staged from a username-and-password login as any removal);
      `applyWalletRemoval` clears `used_by_trade`, so it never comes back, and alerts `wallet-removed`.
      A wallet given back writes an in-app `wallet-restored` alert (app, label, end of the address).
    - Tests (`apps/api/test/take.test.ts:1279`, 9 cases):
      - buyer cancel, walk-away and expiry in setup each restore it;
      - the poster's one-time refund wallet comes back;
      - a restored wallet can be used again;
      - funding then cancel, and a funded trade, do not restore;
      - a removal that applied meanwhile wins;
      - an address added again meanwhile leaves one open row;
      - a cancel and a new take at once is consistent either way.
      - B2 (review 17 Nov (b)): the poster walking away while the taker, who owns the one-time wallet
        and sorts first, takes another of the poster's offers: both answer 200, five runs lined up the
        same way (it gave a deadlock and a 500 on every run before the lock-order fix).
16. **Q11: no change.** Offers stay live.

### Round 4 (lead, 17 Nov, on wip/lead-trade-wallet): the device checks the new address

17. **The API never swaps a new address the device did not show.** The quote's new-address sheet
    (`quote/NewAddressSheet.tsx`) refuses a `POST /v1/wallets` answer whose `address` is not the one
    typed: nothing is picked and it says so (`NEW_ADDRESS.mismatch`, COPY-UNSIGNED). The quote keeps the
    typed address for that wallet id (`Quote.tsx` `typedAddress`); if the list read again names another
    address for it, that row is not offered or picked and the quote says so. So the take's `walletId`,
    the wallet line and the device's `ownAddress` can only be the typed address. Tests:
    `apps/web/test/quoteAddress.test.tsx` (sheet), `apps/web/test/quoteScreen.test.tsx` "a new address
    added on the quote" (typed address picked and recorded; sheet answer swapped; re-read list swapped).
18. **One-time copy matches Q10** (review M1): the quote sheet's and Settings' one-time notes now say a
    trade cancelled before any XMR is sent gives the address back (COPY-UNSIGNED).
19. Stale OD-11 comment in `WalletPicker.tsx` updated; `AcceptedSheet.tsx` import order.

### Round 5 (17 Nov, on wip/lead-trade-wallet): review `review-lead-trade-wallet-2026-11-17.md` M1-M4

20. **A waiting wallet cannot be made the default** (review M1, security tightening). `PUT
    /v1/wallets/:id/default` answers 409 `wallet-not-ready` for a wallet still in its wait (the take's
    own `usable_from <= now` rule), so a stolen session cannot silently pre-arm an address before the
    wait meant to let the user notice it is over. Removed, used-up and staged (no wallet yet) answer 404
    as before; one-time stays 409 `wallet-one-time`. Your wallets offers Make default only on a wallet
    that works now. (Alert since review 17 Nov (b) B1; applied at once from any login, owner Q12 27 Nov.) Tests: `apps/api/test/wallets.test.ts`
    "the default payout wallet" (waiting refused until its wait is over; staged, removed, used up).
21. **Behavioural tests for the default route** (review M2): refused during an account hold (403
    `recovery-hold`, nothing written; `wallets.test.ts`) and for a team member, even one with
    See wallet names (403 `owner-only`; `team.test.ts`).
22. **One-time copy matches the restore as built** (review M3; extending the restore is OQ2, still
    open): Settings' and the quote sheet's notes now say the address comes back only if the trade is
    cancelled while it is still being set up (COPY-UNSIGNED). Supersedes item 18's wording.
23. **What the device checks against the API's list, across leaving the quote** (review M4, re-verify
    N1 and O3). This device keeps each address the user typed here (`screens/walletRecord.ts`,
    localStorage like the other device-held marks, memory when the store throws; never sent to the
    API): under the wallet id the API gave it, or by address alone for an add staged for review (202),
    which has no id yet. The quote (fresh, and from `?wallet=` after a trip away or a reload), the
    accepted sheet and Settings → Your wallets treat a listed wallet as swapped when its recorded id
    names another address, or when, under any id, its address ends in the same last 6 characters as
    an address typed here but differs from it. A swapped wallet is not offered, not picked (even as
    the default), gets no Make default, and the screen says so. Supersedes item 17's "within the
    visit". This does not stop every swap: a wallet with no record here (added on another device, or
    before this check) is trusted as before, and so is a listed address whose ending differs from
    every address typed here; the screen then shows that different ending (O1 stays open for the
    threat-model list). Two real addresses sharing the last 6 is about 1 in 3.8e10.

Review minors, final state: M1 built as Q10 (restore) plus copy (item 18); M2-M5 fixed (items 10-13);
M6 kept as is on the owner's answer (Q11).

Checks (round 3 head):
- typecheck: 19 workspaces clean.
- copy-lint: clean.
- separation-check: ok.
- vitest: api 116 files / 2723 passed (1 todo); web 138 / 2129; auth-client 6 / 77; tools 2 / 7.
- Playwright: quote, wallets, accepted-phone, fold, block, browse-buy, browse-sell, setup, offer-units,
  team, security, design-shots, parity and shell: 293 passed, 53 skipped. The skips were not added by
  this work; where they come from was not checked.

Round 2 checks, for the record:
- typecheck: 19 workspaces clean.
- copy-lint: clean, with no new pragma.
- separation-check: ok.
- vitest: api 116 files / 2714 passed (1 todo); web 138 / 2127; auth-client 6 / 77; tools 2 / 7.
- Playwright: quote + wallets 62 passed. fold, block, browse-buy, browse-sell, setup, offer-units, team,
  accepted-phone, security, design-shots and parity: 223 passed, 52 skipped. The skips were not added
  by this work; where they come from was not checked.

## Owner questions

- **Q1 (default address). ANSWERED 17 Nov:** "If they only have one wallet saved then that's the
  default. If they have multiple they can choose to have one as the default that will automatically be
  selected for the trade but they can change to a different using whatever creative way we wish to
  display them. A drop-down menu is pretty easy." Built: item 8 (overrides OD-11).
- **Q2 (dropdown). ANSWERED 17 Nov:** same words as Q1 ("whatever creative way ... A drop-down menu is
  pretty easy"). Built: the accessible radio list stays, with the default picked first.
- **Q3 (inline add for TOTP accounts). ANSWERED 17 Nov:** "User/pass/display name/otp is kinda like
  medium security but they still wouldn't qualify to avoid the 24 hour hold since stronger security is
  so easy to achieve. They will not have the option at the time of trade to change the wallet." And:
  "on a lot of sites having no password is considered high security... as long as they have a username,
  a display name, and either a passkey, PGP key, or security key, then their account is rated as highly
  secure." On the "?" tip: "Maybe we should make some sort of a ? Mark or just something that they can
  click on or mouse over for more info that says if you are wondering why you cannot add a new wallet
  to send funds to at this time, it is because of the security rating their account has. Their options
  are either to go to settings and add a new wallet and wait 24 hours for it to become active, or
  increase the security on their account and not have to wait at all and be able to add new wallets
  right at the moment of the trade." Built: items 7 and 9; the confirm-wait rule is unchanged.
- **Q4 (first wallet).** A brand-new account's first address works at once, however it is confirmed
  (your rule of 23-24 Oct), weak accounts included. Should a weak account's first address wait 24 hours
  too? Built: unchanged.
- **Q5 (password alone after 16 Nov).** Your 16 Nov decision says a password never stands alone (it
  needs TOTP or another method). Once that ships, every new account is at least medium. Is "weak" then only for
  accounts made before it, and should they be asked to add a method? Built: the rating works either way.
- **Q6 (recovery code).** Does a recovery code count as "one of the other possibilities"? It is a backup
  way in, not a second factor. Built: it does **not** count (stricter); a password + recovery code
  account is rated weak.
- **Q7 (expired PGP key).** A PGP key that has expired or been revoked still counts toward "high" as
  built (the account holds it). Should only a working key count?
- **Q8 (wording).** All new text is COPY-UNSIGNED and needs your wording sign-off (the note asked for
  "procure (or buy or purchase, whichever)"; built with "buy").
- **Q9 (default on the accepted sheet). ANSWERED 17 Nov:** yes. The default "will automatically be
  selected for the trade". Built: item 14.
- **Q10 (review M1: a one-time address spent on a trade that never happens). ANSWERED 17 Nov:**
  "Monero wallets can be used over and over again, and the fact that they're saving them in the program
  means they intend on reusing them. So yes, they have the option of reusing the wallet over again, but
  by no means do they have to." Built: item 15.
- **Q12 (changing the default, lead 17 Nov).** `PUT /v1/wallets/:id/default` is blocked during a hold
  but needs no confirm-it's-you and raises no in-app alert. A stolen session can only point it at a
  wallet already on the account (each of which passed its own wait and alert), and the quote always
  shows the picked wallet's name and address ending before Trade. Should a default change also send the
  usual in-app alert? **Owner answer (27 Nov 2026): apply at once from any login, with an alert.**
  Built: alert `wallet-default`, the live-session check under the account lock; never staged.
- **Q13 (Q7 follow-up).** Main's G13 counts only a usable PGP key (`usablePgp`, review-vendor M3).
  Recommended: rate the account the same way (an expired or revoked key does not make it high). Built:
  unchanged, pending Q7.
- **Q11 (review M6: a vendor whose last usable wallet was one-time). ANSWERED 17 Nov:** owner: no
  preference; the current behaviour is kept (the offers stay live, and a take that the vendor cannot set
  up runs out at its setup deadline).
