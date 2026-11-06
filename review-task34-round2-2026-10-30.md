# Review (round 2): Plan 3 Task 34 flexible offers API, wip/second-p3-task34 @b7a3563 (second), 2026-10-30

Reviewer: helper, read only. Round 1: `~/x2f-comms/review-task34-2026-10-30.md` (@6056e26, CHANGES REQUIRED, I1, I2, M1-M7). Fix commits: e8b58a4 (I1 WIP), 77bdd6d (I2, M1-M7), cc51fa8 (I1 finished: WebCrypto hash, trigger and test fixes, coordination notes), b7a3563 (merge of main 5c4d35b). Builder's report: to-lead.log 2026-10-30 07:07:43.

## Verdict: CHANGES REQUIRED (docs and comments only; the code is approvable as it stands)

There is 1 Important finding and 3 Minor ones. Nothing is Critical.

- Every round-1 item is fixed and tested: I2, M1, M2, M3, M4, M5, M6 (as the lead decided) and M7.
- The I1 mechanism is correct. However, it protects less than its comments, its test and coordination.md say.
  - The hash is computed by the API, which is the party it is meant to guard against.
  - So the hash proves only that the text the view shows is the text in the trade record. It does not prove that the trade record holds what the poster wrote.
- The fix needed now is to correct those claims and record the real anchor as a Task 35 / mainnet gate. No code change is needed for Task 34.

## Round-1 items: verified fixed

- **I1 mechanism (cc51fa8).**
  - **The deal carries the hash.** `AttestedTerms.deal.instructionsSha256` is part of the deal (`packages/trade/src/attestation.ts:38-46`). `isAttestedTerms` requires it, with exact keys and `^[0-9a-f]{64}$` (`:101-102`).
  - **The API sets it and enforces it.** `termsOf` sets it from `trades.method_instructions` (`apps/api/src/internal/routes.ts:87`). `sameTerms` compares it (`:107`), so the API stores only an attestation whose hash is the record's (409 `terms-mismatch`; test `apps/api/test/identity.test.ts:447`).
  - **The moderation service signs it unchanged.** It signs the whole terms under `x2f/attestation/v1\0` + canonical JSON.
- **Hash function and encoding.**
  - **Both sides compute the same hash.** The API uses Node `createHash('sha256').update(text, 'utf8')`. The device uses `crypto.subtle.digest('SHA-256', TextEncoder().encode(text))`.
    - Both are plain SHA-256 over the UTF-8 bytes. There is no normalization on either side, and both produce lower-case hex.
    - The text is the same JS string end to end: pg → JSON → `parseTradeView` → hash.
    - Postgres cannot hold lone surrogates, so both encoders see identical code points.
  - **The input is unambiguous.** It is one field, hashed alone, and the digest sits under its own exact key in the signed canonical JSON. No length prefix is needed.
  - **The builder used the right function.** The `sodium.crypto_hash_sha256` that the report mentions was the abandoned WIP (it is absent from the shipped libsodium). The final code uses the same WebCrypto SHA-256 as `checkWords.ts`. The attestation signature itself is Ed25519 over canonical JSON, and the hash is just one more signed field inside it.
  - **The empty text works.** Legacy and web-posted offers have empty instructions (`''`, hash `e3b0c442…b855`). They match and are shown as empty.
- **What the device does on a mismatch.**
  - **It never shows unattested text.** `EscrowStatus.paymentInstructions` is the view's text only when it hashes to the attested value. Otherwise it is null, `instructionsMismatch` is true and the refusal is `view-mismatch` (`apps/web/src/escrow/runtime.ts:899-909, 964-970`).
  - **It refuses "I've paid" and settles nothing.** The "I've paid" tap is refused (`:1167-1169`), and nothing is settled while the mismatch lasts.
  - **"Refuse to fund" does not apply.** The view carries no instructions before `securedAt` (`view.ts`), so funding always comes before any text is shown.
  - **There is no false alarm on restart.** `tick()` needs `this.party`, which exists only after `this.attested` is set (`:580`). So a restart cannot flash a mismatch before the attestation has been re-verified.
  - **Screens never read the view's text directly.** No shipped screen reads `TradeView.paymentInstructions` (only the type and a fixture name it).
  - Test: `apps/web/test/attestation-flow.test.ts:322`.
- **A swap after attestation is caught.**
  - The deal-fixed trigger (117) refuses any change to `trades.method_instructions` after insert.
  - Even an actor who bypasses the trigger (a DB superuser) is caught, because the text no longer matches the signed hash and the device refuses.
- **I2.**
  - A post with more than one tier gets 409 `tiers-not-yet` unless `Deps.multiTierOffers` is set (`apps/api/src/offers/routes.ts:615`).
  - Production never sets the flag. Only `flexOffers.test.ts` and `offersBulk.test.ts` do, and `flexOffers.test.ts:227` tests the refusal.
  - There is no offer-edit route, so a single-tier offer cannot later gain tiers. The legacy shape is always one tier.
  - The `not-enough-trades` refusal now carries `{ minTrades: tier.minTrades }` (`take.ts:280`), and the web prefers it (`takeErrors.ts`, bounds-checked 0-1000).
- **M1.** The migration list is no longer pinned after 117.
- **M2.** Both child tables now reference the offer `on delete cascade`, and write-once triggers guard them.
  - `offer_tiers` refuses every update.
  - `offer_methods` allows only the blanking of `instructions` with every other column equal. The two functions are separate because plpgsql does not short-circuit.
  - The test helper `renameOfferMethod` disables the trigger inside one transaction (transactional DDL, so it is safe).
- **M3.** PATCH `removed` blanks the instructions in the same transaction (`routes.ts:700-707`).
  - The offer row lock orders it against a take.
  - The take copies the instructions into `trades.method_instructions` while the offer is live.
- **M4.** The `too-many-offers` refusal carries `{ perMarket, total }`, from POST and PATCH relist. Bulk turn-on answers `caps`. The Post-offer copy interpolates the numbers, with a number-free fallback.
- **M5.** Without an amount, the headline rate and the sort use the best tier the viewer qualifies for, always including the tier with the lowest rule.
  - The JS rule `viewerTiers` equals the SQL `t.min_trades <= greatest($8, min(min_trades))`.
  - A signed-out viewer counts as 0 trades. The poster's own views price every tier.
- **M6 (lead: no grandfathering).** The cap counts paused offers, and relist (PATCH) and bulk turn-on go through it. So an account that was over the cap before 117 cannot turn a paused offer back on until it removes others. Both CantDoThat texts say that paused offers count.
- **M7.** The stale comment is fixed.
- **Cap races.** These are unchanged since round 1 and still sound.
  - `assertMayPost` locks `accounts … for update` before it counts. POST, PATCH relist and bulk turn-on all take that lock first.
  - Removal lowers the count without the lock, which can only make a concurrent count conservative.
  - The real-Postgres race test still passes: 6 concurrent posts → 2.
- **Migration 117 on existing offers.** The data path is unchanged since round 1 (one tier, one method with `''` instructions, for removed offers too). The triggers are created before the inserts, and they fire on update only. The migrated-database test passes.

## Important

**I1-r2. The instructions hash is anchored only by the API. A compromised API still chooses which payment details the buyer sees, and the comments claim otherwise.**

- Where:
  - `packages/trade/src/attestation.ts:30-35`: "a compromised API that serves other payment details is caught".
  - `apps/web/test/attestation-flow.test.ts:333`: "A compromised API serves other payment details from the start".
  - `docs/coordination.md:340`: the I1 note.
  - `apps/api/src/internal/routes.ts:87`: the hash comes from the API's own row.
  - `apps/moderation/src/attest.ts:53`: moderation checks only the terms' form, `isAttestedTerms`, and signs what the work list hands it (lead answer 4).
- Why it matters:
  - Every other deal field has an independent anchor on a device: the confirmed deal the user saw (`sameDeal`), or the address each device signed itself.
  - `instructionsSha256` has none. `sameDeal` skips it on purpose (`attestation.ts:109`), because the taker never sees the text before the take.
  - So the hash is exactly as trustworthy as the API that computes it.
- Scenario:
  - An attacker controls the API process. The internal work list is served by the same app and the same DB.
  - At take, the attacker writes `method_instructions = 'IBAN <attacker>'` into the new trade, or later hands moderation terms whose `instructionsSha256` is the hash of that text.
  - The moderation service signs it, and both devices verify the attestation.
  - After `secured`, the view serves the attacker's IBAN. It hashes to the attested value, so `EscrowStatus.paymentInstructions` shows it as verified.
  - The buyer pays the attacker. The seller truthfully says "not received". The XMR is safe, but the buyer's fiat is lost.
  - The protection that did land covers only a read path that diverges from the trade record, such as a cache, a proxy, a replica or a bug, or an edit after attestation.
- Exposure today: none.
  - The shipped web posts only the legacy shape, so every offer's instructions are `''`.
  - No screen shows instructions until Task 35.
  - So this is a Task 35 / mainnet gate, not a live hole.
- Fix now (docs only):
  - (a) Reword the attestation.ts comment, the test comment and the coordination.md I1 note to the true property: "the text shown equals the trade record's locked text; it does not protect against an API that falsifies the record before attestation".
  - (b) Add an **Open, Task 35 + mainnet gate** item to coordination.md (and the Plan 6 gate list). It should say that the instructions need an anchor outside the API. Concretely:
    - The poster's device keeps the hash (or the text) of each of its offer methods' instructions when it posts.
    - When the poster's device verifies the attestation, it compares `terms.deal.instructionsSha256` with its own copy for `methodId`.
    - A sell-ad poster (the seller) refuses to fund on a mismatch, so the escrow is never secured and the buyer is never shown the text.
    - A buy-ad poster: the lead must decide whose details the instructions are. If they are the buyer's own payment notes, they are not a destination and the risk is low. Otherwise the seller's receiving details need the same seller-device anchor, sent over the authenticated party channel (`trade.terms` with the hash, as the addresses are).
  - Alternatively, the lead records an explicit acceptance of the residual risk.

## Minor

**m1. There is no deploy note for trades that are open across 117.**
- Pre-117 attestations and `signed_terms` rows have no `methodId` or `instructionsSha256`. `isAttestedTerms` uses exact keys, so all of these refuse them:
  - the device's re-verification on resume, which ends in `participants-mismatch`/`deal-mismatch`;
  - `modPartyArgs` (`packages/trade/src/modParty.ts:49`), so the moderator party cannot start;
  - the Task 9 I/O watcher, which reads `signed_terms`.
- Scenario: a testnet trade that is open at the 117 deploy is stuck. Its moderator party cannot start, so a dispute cannot be settled 2-of-3 with the mod.
- Fix: add a deploy line to the Task 34 coordination section, as the Task 8 note does: no open trades at the deploy, and wipe the dev moderation `signed_terms` and device stores.

**m2. M3's blanking lives only in the PATCH route.**
- Where: `apps/api/src/offers/routes.ts:700-707`.
- Any later path that sets `offers.status = 'removed'` keeps the payment details at rest: a Plan 4 staff removal, a Plan 7 retention sweep, or an account hold that removes offers.
- Fix: note this in coordination.md for Plans 4 and 7, or move the blanking into an `after update of status on offers` trigger, which the write-once trigger already allows.

**m3. `internal/routes.ts` hashes the instructions inline.**
- Where: `:87`. The same file already has `sha256Hex` (`:39`).
- This is cosmetic. Use the helper, or better, import `instructionsSha256`'s definition so the API and the device hash cannot drift. The device version is async (WebCrypto), so a shared sync helper in `@x2f/trade` using `node:crypto` is not possible. A one-line comment pointing at the device function is enough.

## Clash seams (Task 34 lands last)

I trial-merged the local main line `36e728a` into `b7a3563`: Task 9 I/O landed on the main line locally, and is not pushed yet. I resolved the two conflicts by hand and ran tsc. Results:

| Where | What | Fix when merging |
|---|---|---|
| `packages/trade/src/index.ts` | Textual conflict: Task 34's flexOffer exports vs Task 9 I/O's `sweepMinimums` in the payouts export line | Keep both |
| `apps/api/test/schema.test.ts` (3 lists) | Textual conflict: `113_release_claim.sql` vs `117_flex_offers.sql` | `…112, 113_release_claim, 115, 116_fund_started, 117_flex_offers, 306` |
| `packages/trade/test/payouts.test.ts:173` | tsc TS2739: the deal literal has no `methodId`/`instructionsSha256` | Add both (empty text hash `e3b0c442…b855`) |
| `apps/moderation/test/watcher.test.ts:27` (`TERMS`) | tsc TS2739, same cause | Same |
| `apps/moderation/test/party.test.ts:46` | tsc TS2739. Without it, `isAttestedTerms` would also fail at runtime | Same |
| Task 9 I/O runtime (`apps/moderation/src/main.ts:134,284`, `watcher.ts`) | `signed_terms` rows from before 117 fail `isAttestedTerms`/`modPartyArgs` | m1 deploy note |
| `wip/second-p3-task9-view`, `wip/second-p3-task10` (incl. `apps/moderation/test/harness.ts`) | Same deal-literal break as round 1, now with 2 keys | Add `methodId` + `instructionsSha256` |
| `wip/lead-p2-task17` `apps/api/test/coolingOff.test.ts`; `wip/second-p3-task20-rest` `chat.test.ts`, `nudge.test.ts` | Raw `insert into offers (… method_id … margin_bps …)` refers to dropped columns | Post through the API, or insert `offer_tiers`/`offer_methods` rows. Any raw `update offer_methods` must use `renameOfferMethod`, because the trigger refuses it |
| `wip/second-p3-task20-rest` `take.test.ts`; `wip/lead-p2-task18` `team.test.ts:114` | Take bodies have no `methodId` → 400 | Add `methodId` |
| `wip/lead-p7-retention`, `wip/third-p4-staff-core` | Migration-list conflicts (701, 201) in `schema.test.ts`. Any offer removal or purge they add must blank or delete the instructions (m2) | Lists, plus m2 |

No branch redefines `trades_deal_fixed`, so 117's `create or replace` is still the final one.

## Tests

Run in my own worktree `~/x2f-worktrees/rv-t34r2` (detached at `b7a3563`, `npm ci`), with every run under `check.lock`, one at a time. The worktree has been removed.

- tsc (`npm run typecheck`): packages/trade, apps/api, apps/web, apps/moderation. All exit 0.
- vitest @x2f/trade: 12 files, 339 passed.
- vitest @x2f/moderation `attest.test.ts`: 9 passed.
- vitest @x2f/api, 6 files, 198 passed: flexOffers, offers, take, offersBulk, schema, identity.
- vitest @x2f/api, 3 files, 34 passed: identity, attestation, view.
- vitest @x2f/web, 12 files, 369 passed: attestation-flow, quoteScreen, AcceptedSheet, confirmed, escrow-store, policy, buyerPay, tradeFund, tradeRoomEscrow, postOffer, quote, app-routes.
- vitest @x2f/web, 6 files, 84 passed: cantDoThat-lint, quote-tripwires, myOffers, myOffers-tripwires, postOffer, quote.
- vitest @x2f/web `attestation-flow.test.ts` 3 more times: 99/99 each time. I did not reproduce the builder's single flake at `:283`.
- Trial merge with main line `36e728a`: tsc fails only at the 3 deal literals in the table above (trade 1, moderation 2). api and web are clean.
- Not run: Playwright, full run-check.
