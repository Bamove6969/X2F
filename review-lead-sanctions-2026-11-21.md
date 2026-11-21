# Review: wip/lead-sanctions 4c337e78 (owner 12 Nov sanctions ruling + payee-fields-2), 21 Nov 2026

**Verdict: APPROVE WITH MINORS.** What is removed is what the owner ruled: RUB, SBP, MIR and YooMoney, with IRR, KPW, CUP and CUC guarded. UAH, UKRAINE_CARD, KASPI and MMK stay. Migration 770 is idempotent and safe on real data. It does not touch trades, and a DB trigger means it cannot. The server refuses posts, listings and takes on removed methods and currencies, not just the UI. The chat engine merge keeps every signature, attest and purge check main has. The minors are two edge cases in the new "couldn't be shown" line, one doc gap for the owner (Pago Móvil), and some test gaps. None of them blocks landing.

Worktree: .claude/worktrees/rev-sanctions at 4c337e78 (detached). Diff: `git diff origin/main...4c337e78` (base 2da4f93d), 37 files, +648/-230.

## Tests run

- **vitest, nice -n 10, outside the lock:**
  - `@x2f/trade` payFields, payFieldsCoverage, giftCards: **50/50**.
  - `@x2f/web` chatEngine, chatPanel, postOffer: **171/171**.
  - `@x2f/web`, the other 17 chat and pay files (buyerPay, chatAck, chatAttacks, chatCrypto, chatNotice, chatPay, chatPrepare, chatProof, chatProofReceive, chatProofSend, chatServeKeys, chatStore, pay-tripwires, payDetailsFeed, payModel, payRoom, tradeRoomChatHash): **287/287**.
  - `@x2f/api` offerMigrations, offers, profiles, take, events-route, price, price-health, schema, flexOffers, offersBulk: **395/395**.
- **tsc --noEmit:** apps/api, apps/web and packages/trade are all clean.
- **Playwright under the lock, `--trace off`, workers=1:** post.spec, chat.spec and pay.spec: **49/49 passed** (52.6 s): post 23, chat 4, pay 22.
- **Reviewer scratch test (not committed, deleted):** a live SBP/RUB offer and a secured trade on it with locked `method_instructions`. I ran 770's SQL twice, each time in its own transaction. Result:
  - The trade row is byte-identical, and `GET /v1/trades/:code` still serves `paymentInstructions`.
  - mark-paid still works.
  - The offer is `removed` and its instructions are blanked.
  - The second run is a no-op.
  - **Pass.**
- **Not run:** the full `npm run check`, which this brief left out of scope. The 13 Nov reviewer rule asks for it before landing, so the lead should run it.

## 1. What is removed matches the ruling: OK

Ruling (owner-decisions-2026-11-06.md, "12 Nov 2026"): Russia-specific currencies and methods go (RUB, SBP, MIR, YooMoney "and every other Russia-specific"). Iran's go (IRR, Shetab). The rule is US OFAC, and comprehensive jurisdictions are removed. Ukrainian stays, and so does Cyrillic OCR.

- **Currencies.** `apps/api/src/price/currencies.ts:9` drops RUB (45 to 44) and nothing else. UAH and MMK are still listed. `BANNED_CURRENCIES` (:21) is RUB, IRR, KPW, CUP, CUC, and the module throws at load if any of them is on the list (:22-25).
- **Methods.** `data/payment-methods.json` loses exactly SBP, MIR and YOOMONEY (127 to 124; I diffed the id lists). `loadCatalog` refuses a banned id (`apps/api/src/methods/profiles.ts:106`).
  - I grepped all 124 names for other Russia- or Iran-specific methods (Qiwi, Tinkoff, Sber, Yandex, Shetab, etc.) and found none.
  - Volet (Advcash) is not Russia-specific.
  - UKRAINE_CARD and KASPI stay.
- **Gift cards.** RU, IR, KP and CU are refused (`packages/trade/src/giftCards.ts:154-164`), and the web picker drops them (`countries.ts`). This goes beyond the literal ruling, and the doc already lists it as a lead default and owner question.
- **Syria not removed.** This is correct: the comprehensive programme ended 1 Jul 2025. The doc gives its sources.
- **Proof OCR tables untouched.** This is correct.

## 2. Migration 770: safe and idempotent: OK

`apps/api/migrations/770_no_russia.sql`:
- It runs in one transaction per migration (`db/migrate.ts:30`), so `on commit drop` is fine.
- It sets `removed` on market-priced offers that name a banned currency or method, including mixed offers.
- It blanks `offer_methods.instructions` and `offer_method_currencies.instructions` for those offers, including ones already removed. This is the same as the owner's Remove (`offers/routes.ts:1086-1090`).
- **Idempotent:** every statement filters on the state it changes. My scratch test ran it twice.
- **Running trades keep their details:** the migration never touches `trades`. `trades.method_instructions` is locked at take (490). The `trades_deal_fixed` trigger (490_flex_offers.sql:152-174) raises "a trade's deal never changes" on any change to it. My guard-revert GR12 tried to blank it and was refused by that trigger.
- **Concurrency:** a take reads instructions only from a live offer, under the offer row lock. A take that waits on 770's row locks therefore sees `removed` and refuses.
- **Saved payment details:** none are kept server-side. The payee's boxes go only into E2E chat packages, which the migration cannot and does not touch.
- **Reviews, revenue ledger and proof rows:** untouched, as documented.

## 3. Chat engine merge: OK, with two minors

- **chatCrypto** (`apps/web/src/chat/chatCrypto.ts:467-476`). `refusedPackageFrom` is set only after `openChat`/`open` has verified the signature and replay guard. It is also only set after the mod check and the `payAllowed` check. A mod-signed or not-allowed package still throws plain `notChat()`. The guard is not persisted on any refusal, as on main.
- **engine.ts:696-713.** A refused package's receipt takes `from` from the verified signer, not the unverified header. It is also marked `refusedPay`.
- **engine.ts:400, 407, 416, 440.** `unshowable` holds only for a counterparty's (not own, not mod) `refused` + `refusedPay` receipt. Such a receipt passes `withheld` and the gap loop and becomes a line with empty text and `unreadablePay`. It never carries the package text, and the store holds none (the test asserts this).
- **Gap loop.** Away/carried gaps still move to the sender's next shown line. Refused receipts still never feed `lastSeq` (:608), so a later valid message from that sender is never skipped.
- **Unchanged checks.** `keep()`, the `chat-purged`/`forgetKey` path (:350-378), attestation and sender-mismatch checks have no diff lines.
- **ChatPanel.tsx:298** renders `UNREADABLE_PAY_LINE` (COPY-UNSIGNED) for it.

## 4. The server refuses, not just the UI: OK

- **POST /v1/offers:** RUB gets 400 because `currencyExponent` is null. SBP, MIR and YOOMONEY get 400 as unknown methods. RU gift cards get 400. Nothing is stored (`offers.test.ts:275-284`).
- **Take** of an old SBP offer row: 409 `method-unavailable` (`take.ts:310`; `take.test.ts:368-369`).
- **Lists:** `GET /v1/methods` and single-offer views hide them (`isAvailable` is false for unknown ids).
- **Trades in flight:** they finish, which is the lead default (`events-route.test.ts:144`).

## Findings

- **m-1 (engine, owner Q12 edge).** `engine.ts:643-644` with `chatCrypto.ts:468`. A package that cannot be shown and arrives **before the escrow is secured** shows the payer "Their payment details couldn't be shown. Ask them to send again." straight away. Before securing, a valid package is held with no line at all, and the payee cannot resend until the trade is secured. I reproduced it with a scratch engine test, which gave `[["",true,false],["later",false,true]]` with `paySecured=false`.
  - No details leak, and only a modified or newer client can send before securing.
  - Recommendation (engineering): when `!secured`, store the receipt as plain `refused`, or hold it like `heldPay`, so the line appears only once the trade is secured.
- **m-2 (engine, cosmetic).** The sender's next line after an unreadable package still gets `gapBefore: true`, because a refused seq never counts (:608, :660). The payer sees "couldn't be shown" and then a "message missing" marker right after it, for the same message. Scratch test: `[["hi",false,false],["",true,false],["did you get them?",false,true]]`. This is pre-existing logic, but it is now visible next to the new line.
  - Option: let a `refusedPay` receipt count for `lastSeq` in the gap computation only (not the guard).
- **m-3 (doc, owner/lawyer).** `docs/sanctioned-countries-2026-11-12.md:44` says Venezuela has "Nothing to remove", but the catalog lists **PAGO_MOVIL** (Pago Móvil, Venezuela-only, VES; `data/payment-methods.json:675`, `payFields.ts:385`). research/payment-methods/latam-africa-me.md:13 flags it for US sanctions exposure.
  - Keeping it is right under the ruling, since Venezuela is list-based, not comprehensive. But the ruling sends borderline programmes to the owner/lawyer, so Pago Móvil should be in the borderline table with a recommendation.
- **n-1 (tests).** The 770 migration test seeds no trade, so a migration that touched `trades` would pass the committed suite (GR12). Only the 490 trigger stops it. Add one SBP/RUB trade row to `offerMigrations.test.ts` and assert it is unchanged after `migrate`.
- **n-2 (tests).** No API test covers the gift-card country ban on its own. RU, IR, KP and CU map only to banned currencies, so `offers.test.ts:282` would 400 on RUB anyway. The trade-level test (`giftCards.test.ts`) covers it, and the API path is defence in depth.
- **n-3 (tests).** Two guard-reverts survive:
  - `m.from !== view.role` in `unshowable` (engine.ts:400), GR18. An own refused package is unlikely, since the sender's table produced it.
  - `pkgFrom ?? h.from` reverted to `h.from` (engine.ts:702), GR20. These are equal for an honest header.
  - Each could take a one-line test.

## Guard-revert table

Each change was applied alone, the named suite run, then the file restored with `git checkout`.

| # | Revert | Suite | Result |
|---|---|---|---|
| GR1 | RUB back on `CURRENCY_EXPONENTS` (guard kept) | api price | caught: module refuses to load (suite fails) |
| GR1b | RUB back and `BANNED_CURRENCIES` emptied | api offers + price | caught: 2 failed / 89 |
| GR2 | `loadCatalog` banned-id check removed | api profiles | caught: 1 failed / 47 |
| GR3 | SBP row back in catalog (guard kept) | api profiles | caught: catalog refuses to load |
| GR3b | SBP back, guard removed, gift-card country check removed | api offers + profiles + take | caught: 5 failed / 179 (post, list, single-offer, take) |
| GR4 | `giftCardCurrencyOk` without country check | trade giftCards | caught: 1 failed / 11 |
| GR5 | web `isCountryCode` without the ban | web postOffer | caught: 1 failed / 35 |
| GR6 | 770: offer_methods blanking dropped | api offerMigrations | caught: 1 failed / 4 |
| GR7 | 770: pair blanking dropped | api offerMigrations | caught: 1 failed / 4 |
| GR8 | 770: status not set to removed | api offerMigrations | caught: 1 failed / 4 |
| GR9 | 770: RUB not matched | api offerMigrations | caught: 1 failed / 4 |
| GR10 | 770: only all-banned offers (mixed kept) | api offerMigrations | caught: 1 failed / 4 |
| GR11 | 770: over-broad (USD too) | api offerMigrations | caught: 1 failed / 4 |
| GR12 | 770: also blanks `trades.method_instructions` | api offerMigrations + events-route | **survives** 13/13 (n-1); the scratch test fails on the 490 trigger "a trade's deal never changes" |
| GR13 | chatCrypto: unshowable back to plain `notChat()` | web chatEngine + chatPanel | caught: 2 failed / 136 |
| GR14 | engine: `refusedPay` not stored | same | caught: 2 failed / 136 |
| GR15 | snapshot gap loop skips all refused | same | caught: 2 failed / 136 |
| GR16 | snapshot `withheld` hides all refused | same | caught: 2 failed / 136 |
| GR17 | ChatPanel `unreadablePay` branch off | same | caught: 1 failed / 136 |
| GR18 | `unshowable` without own-role filter | same | **survives** 136/136 (n-3) |
| GR19 | mod-signed package given `refusedPackageFrom` | same | caught: 1 failed / 136 |
| GR20 | receipt `from` = header, not signer | same | **survives** 136/136 (n-3) |
| GR21 | unreadable line carries a stored text | same | survives: equivalent mutant (no text is ever stored for a refused receipt) |

## Owner questions (already in the doc as lead defaults; no new decisions taken here)

- Existing offers removed whole, with no notice. Running trades finish. Gift cards from RU, IR, KP and CU are refused. MMK is kept.
- New: **Pago Móvil** (Venezuela). Keep it until the lawyer rules (m-3).
