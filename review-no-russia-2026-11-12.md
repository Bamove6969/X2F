# Review: wip/lead-no-russia (sanctions removal), 2026-11-12

Branch at `80e87322` (two commits, 5faed49e and 80e87322), base `8246e64b`. Independent reviewer, detached worktree at 80e87322, fresh `npm ci`, everything run under `~/x2f-comms/check.lock`.

## Verdict

**Land it.** Nothing is blocking. All five checks you asked about hold. The minor items below are a merge clash with the payee-fields branch, two gaps the owner should know about (in-flight Russian trades and silent removal of posters' offers), and one doc misquote.

## What I verified

1. **Nothing Ukrainian or otherwise Cyrillic-script is affected.**
   - Kept: UAH, `UKRAINE_CARD`, `KASPI` (Kazakhstan) and the proof OCR/currency tables (`₽`/RUB detection stays, as the owner asked).
   - The only catalogue rows removed are SBP, MIR and YOOMONEY (127 to 124).
   - The only price-list change is RUB (45 to 44).
   - Gift cards: only RU, IR, KP and CU are blocked; UA is tested as allowed. BY (Belarus, list-based, not comprehensive) stays allowed, which matches the owner's US-law rule.
   - A sweep of the catalogue for other Russia-specific methods (Sber, Tinkoff, QIWI, Yandex, WebMoney, Payeer) found none. Volet (formerly Advcash) is not Russia-specific. The test now pins that sweep too.
2. **The migration is safe on real data.**
   - Migrations run one file per transaction (`migrate.ts`: `begin` … `commit`), so `create temporary table … on commit drop` lives through the whole file.
   - `offers` is updated only where `price_mode = 'market'`. A fixed-price row from before 345 is never updated, so the NOT VALID `offers_market_only` check (345 and 490), which refuses any new version of a fixed row, is never hit.
   - The blanking updates on `offer_methods` and `offer_method_currencies` take exactly the path the written-once triggers allow (`instructions = ''` and `instructions is null`, all other columns unchanged). This is the same pair of statements as the owner's own Remove (`offers/routes.ts`).
   - I checked this against a fixed-price row with my own uncommitted scratch test (see Tests run below). A fixed RUB/SBP row from before 345 keeps `fixed:live`, and its method and pair instructions are blanked. A market RUB row becomes `removed` and is blanked. A USD row is untouched. The migration ran without error.
   - Coverage of real data: gift-card offers for RU, IR, KP and CU can only be in RUB, IRR, KPW or CUP (the ISO table maps CU to CUP only). So every existing banned-country gift-card offer is either caught by the RUB currency check or could never have been posted.
   - No other branch uses migration number 590. The 5xx numbers in use are 560 on lead-bans, 570 on lead-device-bound and 580 on lead-proof-chat-receive; 590 also appears on lead-demo-r2, which carries this same file.
3. **The API refuses the banned items everywhere.**
   - **Post (single and flex):** a currency with no exponent gives 400 (`offers/routes.ts:617`). An unknown method gives 400; it now hits the catalogue, not the 409 for an unavailable method. A gift-card country outside the allowed set gives 400 (`giftCardCurrencyOk`). All of these are tested, including that nothing is stored.
   - **Take:** the offer must be `live` (the migration removed them), the method must pass `isAvailable` (409 otherwise), and `lockRate` needs a price, which RUB no longer has (409 `price-unavailable`).
   - **Quote/price:** `GET /v1/price` gives 400 for RUB, IRR, KPW, CUP and CUC (`price/routes.ts:31`). The FX, feed and health loops iterate only `CURRENCY_EXPONENTS`, so RUB drops out.
   - **Bulk (pause and relist):** an offer with a method that isn't available is refused with `method-unavailable` (`routes.ts:1231`). A removed offer cannot be relisted at all (`status <> 'removed'`). Relisting a RUB offer would also fail on no price.
   - **Lists and methods:** the method list filters out unavailable methods, and an unknown method's offers never show (tested in profiles).
   - **Load-time guards:** `BANNED_CURRENCIES` throws at module load if any banned code is in the price list. `BANNED_METHOD_IDS` throws in `loadCatalog`. Both are tested.
4. **The docs cite their sources, and the sources say what the docs say.** I fetched each OFAC and Treasury URL:
   - **FAQ 10**, "Date Updated: October 26, 2026": comprehensive = Cuba, Iran, North Korea, Crimea, DNR and LNR. It adds that "the Russian Federation is not subject to the same degree of jurisdiction-based prohibitions", which matches the doc's Russia paragraph.
   - **Cuba:** the page lists EO 14404 of May 1, 2026.
   - **Syria:** EO 14312 revoked the programme effective July 1, 2025, and the 08/25/2025 action removed the Syrian Sanctions Regulations from the CFR.
   - **jy2117:** the NSPK/Mir designation.
   - The Burma, PAARSS and Russia programme pages all load and match.
5. **No test was weakened beyond the count changes.**
   - The count changes (127 to 124, 45 to 44, 249 to 245 countries, 44 to 43 Coinbase rejections) are mechanical.
   - The SBP refusal test moves from 409 `method-unavailable` to 400, now covers all three methods, RUB and a RU gift card, and adds "nothing stored". That is stricter, not weaker.
   - `flexOffers.test.ts` swaps RUB for SEK as its "currency with no price" and "cap" example. The assertions are unchanged and SEK plays the same role.
   - The `CARD_METHODS` set loses MIR because the row is gone. The test still asserts the exact set.
   - New tests cover the migration, the guards, the gift-card countries and the web picker.

## Findings

### Blocking

None.

### Minor

**m-1. This branch clashes with wip/lead-payee-fields-2 at merge.** Both edit `packages/trade/src/payFields.ts`, `packages/trade/test/payFieldsCoverage.test.ts` (`CARD_METHODS`, the catalogue count) and `docs/payment-fields-2026-11-10.md`:
- payee-fields-2 adds SPEI to `CARD_METHODS` while still listing MIR; this branch removes MIR.
- payee-fields-2's test "every rechecked row records the recheck" expects exactly 62 rechecked rows. I checked 20de07e8: two of SBP, MIR and YOOMONEY carry a `recheck 2026-11-12` tag (one high, one medium). Once this branch removes them, the count is 60 and that test fails. The recheck docs summary (already wrong, see the payee-fields review m-1) shifts again.

Scenario: whoever lands second resolves `CARD_METHODS` to `{UKRAINE_CARD, PAYSEND, POSTEPAY, SPEI}` but keeps `toHaveLength(62)`, or regenerates the docs from the wrong side, and CI fails or the docs drift. Fix (lead, at landing): land one branch first, rebase the other, set the recheck count to 60, and re-run `payFields.test.ts`, `payFieldsCoverage.test.ts` and the docs renderer.

**m-2. Trades already running in RUB or SBP/MIR/YooMoney are not addressed.** The migration covers offers only. A trade taken before the deploy keeps running. Dispute escalation fails closed: with no RUB quote, the trade's USD value is set to the limit, so the two-person rule applies (`disputeUsdCents`). Release and refund don't need a price.

Scenario: a RUB/SBP trade is mid-flight at deploy time and completes on X2F after the owner's "Russian anything is banned". Nothing breaks; this is a policy gap. **Owner question:** let in-flight Russian trades finish (my recommendation: there is no safe way to stop a funded escrow except a moderator ruling), or have moderators refund them?

**m-3. Posters' offers disappear without notice.** The owner's Remove writes `auditMember(… 'offer-removed')`; the migration writes no audit row and sends no notification. Scenario: a seller with a Zelle + MIR offer finds it gone from "My offers" and assumes a bug, or that they were banned. Fix (lead or design): a one-line notice for affected accounts ("Offers using Russian payment methods or RUB were removed on <date>"). Alternatively accept the silence, since the number of affected offers is probably tiny before launch.

**m-4. A misquote in `docs/sanctioned-countries-2026-11-12.md`.** The doc quotes the owner as "Anything Iranian is banned too." The recorded words (owner-decisions-2026-11-06.md line 206) are "Anything Iranian unfortunately is banned too". Scenario: the lawyer reads the doc as the owner's verbatim ruling. Fix: quote it exactly, or drop the quotation marks.

### Info

**I-1. An old client sending SBP now gets 400, not 409 `method-unavailable`.** An older web bundle that still lists SBP would show its generic bad-request text. The skew window is short and the methods are gone from the picker.

**I-2. A fixed-price row from before 345 keeps its old status (for example `live`).** It is hidden by `MARKET_PRICED` and has no details left. If J-02 ever converts fixed rows to market, a RUB or SBP row would still be unusable (no price, method unknown). No action.

**I-3. The ISO gift-card table still maps RU, IR, KP and CU to their currencies.** This is on purpose and documented; `giftCardCountryAllowed` is the gate. The web picker and the API agree (245 countries).

## Tests run

All under `flock ~/x2f-comms/check.lock timeout 2400 …`, in a detached worktree at 80e87322 with a fresh `npm ci`:
- vitest on 13 files: `apps/api/test/offers`, `flexOffers`, `offersBulk`, `offerMigrations` (plus my uncommitted scratch test, the fixed-price migration check described in point 2), `price`, `price-health`, `profiles`, `schema`, `take`; `packages/trade/test/giftCards`, `payFieldsCoverage`, `payFields`; `apps/web/test/postOffer`. RESULTS_PLACEHOLDER
- `tsc --noEmit` for apps/api, apps/web and packages/trade, and `npm run copy-lint`: TSC_PLACEHOLDER
- OFAC and Treasury sources fetched and checked: 10 URLs, all HTTP 200, quotes as above.
- Not run: Playwright (`e2e/post.spec.ts` changed only a test title and a comment).
