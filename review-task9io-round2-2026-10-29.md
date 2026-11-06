# Re-review (round 2): Plan 3 Task 9 I/O, wip/second-p3-task9-io @3dc2a58 (claude2), 2026-10-29

Reviewer: helper, read only. This round covers the fix round `dd55fcd..3dc2a58` (6bf8405 trade, c42f46c escrow, 89dc0ee api, e3d1dcf moderation, 3dc2a58 docs), measured against round 1 (`review-task9io-2026-10-29.md`) and claude2's report at to-lead.log 09:43:38. I trial-merged the main line at 4d75461 (first at 047b4f3; the lead's restart killed that run).

## Verdict: CHANGES REQUIRED

There are 2 Important and 3 Minor findings.

The fixes work as designed for what they target. The changes since round 1:
- **I2 is fixed.** The channels close only once the mod has shown a sweep, or when the API says closed and the escrow never received a coin.
- **M1 to M7 are addressed.**
- **I1 is greatly narrowed.** A forged attribution now has to point at a tx that provably pays the signed buyer address and the fee wallet.

Two new problems remain:
1. The proof does not tie the tx to THIS escrow, so another trade's legitimate release can be counted twice.
2. The tx-key format accepts only a single 64-hex key. Every honest release that pays a subaddress therefore fails the proof and ends in a dispute.

## Important

**R2-I1. The tx-key proof is not bound to this escrow: one release can be counted for two trades. A replayed old tx also closes the channels.**
Where: `apps/moderation/src/watcher.ts:187-214` (`spendEvidence`/`proven`), `packages/escrow/src/party.ts:1060-1077` (`proveSweep`), `packages/trade/src/watch.ts:336`.

`proven` accepts any in-block tx T that the mod's wallet attributes to the escrow, provided the sender's tx key shows T pays at least `sweepMinimums`. The attribution itself can still be forged (wallet2 adds the peer's partial key images unchecked; withdrawn argument, coordination.md). Two more facts matter:
- the target key image K* can be any input key image on chain (they are public);
- the tx key of a past release is known to its builder (who keeps it) and to its submitter (whose wallet stores it).

Concrete scenario. Seller S and buyer B run two trades at the same time, trade 2 and trade 3. B uses the same payout address for both (Task 29's saved wallets make that normal), and amount3 ≥ amount2.
1. Trade 3 releases normally in tx T3, mined after escrow 2's coins are 10 blocks deep. S built or submitted T3, so S holds T3's tx key.
2. In trade 2, S starts the release and receives B's export. That export gives S the mod's part of each escrow-2 key image.
3. S sends `spend.info { hex: forged, txHash: T3, txKey: k3 }`. The forged partial key images make the mod's wallet attribute T3 to escrow 2.
4. `proveSweep`: T3 is in a block and pays B's signed address at least toBuyer2 and the fee wallet at least fee2, so it is proven. `sweptBy` takes all of escrow 2's coins (`spentAtomic` comes from the mod's own transfers), so no late funds are reported.
5. The watcher reports `settled`, the API marks trade 2 `released`, and both relay channels close. B paid fiat for trade 2 and received nothing. `open-dispute` from `released` is `wrong-state`. Escrow 2's coins stay locked: this is griefing, but the core guarantee is broken.

Replay of an older tx (mined before escrow 2 was funded) is different. `sweptBy` returns nothing, so every coin is late and late-funds escalates to `disputed`, which is good. But `watch.ts:336` still closes both channels on that same step, because `settledTx` is set. The dispute that follows then has no relay channel.

Required, either or both:
- **(a) Bind the proof to the escrow.** For the input whose key image the wallet matched, check through the daemon (`get_transactions` key offsets, `get_o_indexes` of the escrow outputs) that the ring contains the escrow output. A pre-existing legitimate tx such as T3 never has escrow-2 outputs in its rings. A forger would then have to craft a fresh tx that pays B in full from its own money, which is harmless.
- **(b) Never count a tx for more than one trade.** Add a unique sweep-tx record across trades in the moderation DB. A duplicate is logged and not proven.

Also: close the channels only when the shown sweep took every coin. If `late.length > 0` on the settle step, keep the channels open for the dispute.

Tests to add (hermetic): the same proven tx offered for two trades (the second is not counted), and a sweep at a height below the funding height (no channel close).

**R2-I2. Releases that pay a subaddress can never be proven, so every honest one escalates.**
Where: `packages/escrow/src/party.ts:205` (`KEY_HEX = /^[0-9a-f]{64}$/`), `party.ts:700`, `packages/escrow/src/monero.ts:53` (`isScalar`: 64 hex only), `monero.ts:161-168` (`txKey()` returns null unless the key is 64 hex), `monero.ts:235`.

The API accepts subaddresses as payout and refund addresses (`apps/api/src/wallets/address.ts:11`), and most wallets (Cake, Feather, the GUI) hand out subaddresses by default. A release pays the buyer, the fee wallet and possibly the seller's surplus, so it has two or more destinations. With a subaddress among them and either a standard address or another subaddress, wallet2 uses additional tx keys (`need_additional_txkeys`). `get_tx_key` then returns the main key plus one 64-hex key per output, concatenated, and `check_tx_key` needs that whole string.

So in an honest seller–buyer release to a subaddress:
- the co-signer's `txKey()` fails `TX_HASH`, returns null, and sends `''`;
- the builder's `getKey()` fails the same test, so no key is kept;
- the mod finds no proof and logs `sweep-unproven`;
- the claim keeps the trade `settling`, and after 6 h `spend-unshown` sends it to `disputed`.

The regtest test only pays one primary address (`spend-info.test.ts:91,219`), so it never meets this case. (My assumption: the regtest wallet does not add additional keys for a single primary destination; please confirm.)

Required:
- Accept a key of 64·(1+n) hex, with every 32-byte chunk a reduced scalar (`isScalar` on each chunk, to keep the WASM-abort guard), and pass the whole string to `checkTxKey`.
- Add a regtest test of a release paying a buyer subaddress plus the fee wallet (the realistic 2- or 3-output shape).

## Minor

**R2-M1. The kind comes from the API's `settleKind`, so a compromised API working with one trade party can still close a funded escrow.** Where: `apps/api/src/internal/routes.ts:296`, `watcher.ts:200-208`.

The doc says "nothing new for a compromised API". That holds only for the API's own records. Scenario: the API reports `mutual-cancel` during a release. The seller sends itself the escrow's amount from its own funds (cost: one network fee), forges the attribution, and sends that tx's key. The minimum (`sellerRefund ≥ sweptAtomic`) is met, so the mod reports `settled`, treats the coins as swept (no late-funds escalation) and closes both channels.

The fix of R2-I1(a) (ring binding) also closes this. Otherwise, take the kind from moderation's own shadow trade once Task 10 builds it, and note this as owed.

**R2-M2. Accepted residuals: please record them in the plan revision, not only in to-lead.log.**
- Release minimums use the take-time amount, so a grown trade's buyer can be shorted by the growth.
- The allowance on payout 0 lets the buyer be short by up to `MAX_NETWORK_FEE`.
- After I2, a closed escrow with no shown sweep keeps its relay channels registered past the 30-day watch. The relay keeps those registrations forever: a relay-side expiry is owed (Plan 4 or the relay task).

**R2-M3. `ownTxs` includes `rel.txHash` in phase `superseded`** (`party.ts`, the `funds()` mod branch). A superseded attempt's own tx can be in `outgoing` only if it actually landed, so this is harmless. But a comment should say why `superseded` counts as "the mod signed it", or `superseded` should be dropped from the list.

## Round-1 items: status
- I1: partly fixed (independent check built); see R2-I1 and R2-I2.
- I2: fixed (`watch.ts:336`, tests for the refused and allowed paths). Leftover: the late-coins-at-settle close in R2-I1.
- M1: fixed (`watch.ts:286`, only while settling).
- M2: fixed. One import per sender, refused retries at most every 30 s, and `PartyState.shown` keeps shown sweeps, so a later import cannot hide one.
- M3: fixed (paused restarts the anchor, `watch.ts:292`; 30-minute grace after a restart).
- M4: documented as once per trade.
- M5: documented.
- M6: fixed (unlisted but closed here, so it runs out the watcher's own 30 days; `watcher.ts:379`).
- M7: fixed (`003_watch.sql`; Task 10's signals migration becomes 004, which claude2 is doing).

## Landing and conflict notes (trial merge of 4d75461)
- `apps/api/test/schema.test.ts` conflicts (3 lists). Resolution: the main-line lists plus `'113_release_claim.sql'` between 111 and 115. The main line now has 102, 108, 110 and 115, so 113 is still free.
- `docs/coordination.md` conflicts. Resolution: keep both sections (Task 9 I/O, then Task 28 / Task 4 / Task 27).
- No other conflicts. The lockfile did not change. 047b4f3..4d75461 touches only web files.
- Task 27 (disputes) is now on the main line, and nothing in tsc or the tests clashes with escalate-from-settling. Task 27 should read M5 (the settling fields stay set on the disputed trade).

## Tests (own worktree ~/x2f-worktrees/rv-t9b, 3dc2a58 + the merge, under check.lock; removed afterwards)
- npm ci: ok.
- tsc --noEmit escrow, trade, api, moderation: exit 0 (against the 047b4f3 merge; 047b4f3..4d75461 is web-only). tsc web: exit 0 on the 4d75461 merge.
- vitest @x2f/trade + @x2f/moderation: 13 files, 366/366 passed.
- vitest @x2f/api watchReports, timers, schema, events, events-route, purge: 6 files, 126/126 passed (schema includes the hand-resolved list).
- vitest @x2f/auth-client: 5 files, 70/70 passed. The first run had 3 failures, with Postgres terminated (57P01) when the lead's session restarted; the rerun was clean.
- vitest @x2f/escrow spend-info.test.ts (regtest, Docker): 2/2 passed.
- No test covers R2-I1 (a proven tx counted for two trades, or a channel close with late coins at settle) or R2-I2 (a release to a subaddress).
