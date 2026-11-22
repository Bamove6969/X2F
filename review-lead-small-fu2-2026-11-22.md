# Review: wip/lead-small-fu2 4cef9af4 (sanctions review follow-ups m-1, m-2, n-3, n-1, m-3; R37 ordering), 22 Nov 2026

**Verdict: APPROVE WITH MINORS.** m-1 and m-2 do what the brief says for the counterparty's lines. The replay guard is untouched: the refused path still never assigns `state`, so a refused seq is never taken. Nothing of a held package, or the fact that one exists, reaches the snapshot before the escrow is secured. keep(), attest and purge are not touched. One real gap regression slipped in, on this device's **own** lines (M-1 below). It is a two-token fix, it is rare, and it does not block landing if it is fixed in the next small follow-up.

Worktree: .claude/worktrees/rev-small-fu2 at 4cef9af4 (detached). Diff: `git diff origin/main...4cef9af4` (base b7fb9969), 10 files, +195/-15.

## Tests run

- **vitest, nice -n 10, outside the lock:**
  - `@x2f/web`, all 14 chat files (chatAck, chatAttacks, chatCrypto, chatEngine, chatNotice, chatPanel, chatPay, chatPrepare, chatProof, chatProofReceive, chatProofSend, chatServeKeys, chatStore, tradeRoomChatHash): **305/305**. chatEngine alone: 103/103.
  - `@x2f/api` offerMigrations: **4/4**.
  - `@x2f/moderation` gate.test: **62/62**.
  - `@x2f/staff-web` logTraining: **14/14**.
- **tsc --noEmit apps/web:** clean.
- **Playwright chat.spec: not run.** I waited 30 minutes for `~/x2f-comms/check.lock` (08:03 to 08:33 UTC) and another run held it the whole time. The cloud runner's full set covers it.
- **Not run:** the full `npm run check` (out of this brief's scope; a cloud runner does the full set).

## Findings

### M-1 (engine, gap hidden on this device's own lines). New in e36a557a.

`apps/web/src/chat/engine.ts:625` and `:732` count a `refusedPay` seq for the gap markers whatever its sender. The snapshot (`:400`, `:421-425`) only ever shows, or carries a gap from, a refused package of the **other** side (`refusedPkg` keeps the GR18 own-role filter). So a package this device's own identity signed, refused for its contents (the GR18 case: another bundle of its own app), now:

- takes its seq for the next own line, so that line gets no gap of its own, and
- drops its own `gapBefore`, because it is never shown and never carried.

A real missing own message before it is then marked nowhere.

Reviewer scratch test (not committed, deleted): buyer's own seq 0 "zero", seq 1 never sent to the reader, own refused package at seq 2, own seq 3 "three".
- At 4cef9af4: `[["zero",false],["three",false]]`, on the first sync and on a reopen. The gap at seq 1 is hidden.
- At b7fb9969 (parent): `[["zero",false],["three",true]]`.

Suggested fix (pure engineering, restores main's behaviour for own lines): count the seq only for the counterparty, at both places.
- `:625`: `m.refused !== true || (m.refusedPay === true && m.from !== rec.role)`
- `:732`: `if (pkgFrom !== undefined && pkgFrom !== rec.role) lastSeq.set(...)`

With that change and the scratch test added as a real test, chatEngine is 104/104 and the probe passes. Carrying the own package's gap in the snapshot would also work, but then the next own line's gap depends on the snapshot alone. I recommend the lastSeq form. The GR18 test (`chatEngine.test.ts:1089`) asserts receipts and lines but not gaps, which is why it did not catch this. Add the gap assertion there.

Severity: minor. It needs an own package this device's table cannot show, plus a dropped own message before it. It is still a real missing message that stops being marked, which is hunt item 1.

### n-1 (data from older builds, informational)

A `refusedPay` receipt stored by a build between payee-fields-2 m-4 and this commit has `gapBefore: false` even when a real gap came before it, and stored receipts are never recomputed. After upgrade, `:625` counts its seq, so a line that arrives **after** the upgrade gets no gap. The gap before that old package is then marked nowhere. Lines already stored keep their old (true) gap, so only lines that arrive later are affected. This is pre-launch data only, so there is nothing to do unless such builds shipped to real devices.

### n-2 (GR20 test: sound, with one hole)

The getter on `from` (`chatEngine.test.ts:1101-1119`) is sound:
- It is a real discriminator. Reverting to `h.from` fails it, because the receipt goes under 'buyer' and the line disappears.
- Both counters are asserted (> 0), so the test proves that both reads happened.
- It fails safe. If `openChatMessage` were renamed, or the stack changed, the getter would always answer 'buyer'. The signature would then fail and the test would go red, not pass silently.
- V8's async stack frames keep `openChatMessage` on the stack for reads after an await.

The hole: `from = e.senderRole` (the server's claim) **survives** (GR-R9 below), because the test posts with `api.add('seller', …)`. Suggested: a second case that posts the seller-signed package with senderRole 'buyer' and asserts it is stored under 'seller'. Or decide that a senderRole that disagrees with the signer refuses a refusedPay outright, as the valid path does at `:667` ("sender mismatch"). Today a mismatched refusedPay still becomes a neutral line. That is harmless, since it carries no content and the receipt is the signer's, but it is inconsistent with the valid path. This is pre-existing (m-4) and a lead call, not a blocker.

### n-3 (gap marker with no line after it, informational)

A gap before a held package (heldPay, held evidence, or a refusedPay before securing) is carried onto the sender's next **shown** line. If no such line ever comes, for example the trade is never secured and the sender says nothing more, the gap is marked nowhere. This matches the `away` handling (review I1) and is no worse than main, where the held package hid the gap outright.

### Hunt items, checked

1. **Real gap still marked.**
   - Counterparty lines: OK in every case I traced.
     - Reorder: a higher refusedPay seq before lower valid ones only produces extra (false) gaps, never hidden ones, because valid lines reset `lastSeq` (`:680`).
     - Replay: a replayed refusedPay with an old seq cannot raise `lastSeq` (Math.max).
     - Held package never released: see n-3.
     - Purge: `erase` removes the whole record and session, so nothing is carried.
     - forgetKey: only wipes the key in memory.
     - Reload: `:625` reads the same seqs from stored receipts.
     - Secure after hold: the package's own `gapBefore` takes over and the carry goes.
   - Own lines: M-1.
   - Old data: n-1.
2. **Replay guard: not weakened.** `refusedPackageFrom` is set only after `openChat` verified the signature and the guard accepted the seq (`chatCrypto.ts:468`), and that guard state is thrown away. The refused branch never assigns `state`. `lastSeq` is display-only and separate from `ChatState.guard`. A relay cannot forge a refusedPay to fill a gap, because it needs the sender's signature on that channel, under that chat key.
3. **No leak before securing.**
   - `unshowable` needs `tradeSecuredAt`.
   - A held refusedPay adds a marker only when it had a real gap before it, which the reader would have seen anyway.
   - It no longer gives the next line a spurious "missing" marker, which was a small existence hint on main.
   - `modOnlySentAt`, `more` and `paySecured` do not read refused receipts.
   - The device stores no contents (m-1 test, `:1028`).
4. **keep(), attest, purge:** not in the diff. The only engine hunks are the snapshot (`:397-440`), the `lastSeq` seed (`:622-625`) and the refused-package receipt (`:714-735`).

### Other commits

- **2bbacb89 (770 seeds a running SBP/RUB trade): OK.** The guard-revert (appending `update trades set method_instructions = ''` to 770) fails the test. Note that it fails on the DB trigger ("a trade's deal never changes"), before the new `toEqual`. So the assertion is a second layer behind the trigger, which is fine.
- **0eec3abc (R37 `order by activity_log.id`): OK.** The diagnosis is right: in Postgres, `ORDER BY id` resolves to the output alias `id::text`. The guard-revert fails the new gate test. I grepped the other `id::text as id` queries: `log/query.ts:128` and `team/audit.ts:254` already order by the qualified `l.id`, and `disputes/routes.ts:387` has no ORDER BY, with `involvedIn` being order-independent. No other instance.
- **4cef9af4 (docs): OK.** PAGO_MOVIL is in `data/payment-methods.json` and `packages/trade/src/payFields.ts`, as the table says. `deleteDisputeRecords`, `purgeTradesJob` and the 750 cascade exist as the training.ts comment says. The staff-web copy is unchanged (comment only), and its test still passes.

## Guard-revert table (chatEngine.test.ts, 103 tests)

| # | Revert | Result |
|---|---|---|
| R1 | `unshowable` without `tradeSecuredAt` (m-1) | 2 fail (m-1, m-2 held-gap) |
| R2 | drop the carry for a held refusedPkg (`:423`) | 1 fails (m-2 held unshowable) |
| R3 | drop the carry for `withheld` (`:430-434`) | 1 fails (m-2 heldPay never hidden) |
| R4 | `lastSeq` seed back to `m.refused !== true` (`:625`) | 1 fails (m-2 later sync) |
| R5 | drop the in-read `lastSeq.set` for a package (`:732`) | 4 fail (m-4, m-1, m-2 x2) |
| R6 | refusedPay `gapBefore: false` (`:727`) | 2 fail (m-2 x2) |
| R7 | receipt `from = h.from` (GR20) | 1 fails (n-3 GR20) |
| R8 | `refusedPkg` without own-role filter (GR18) | 1 fails (n-3 GR18) |
| R9 | receipt `from = e.senderRole` (server's claim) | **survives** 103/103 (n-2) |
| R10 | registry `order by id` (0eec3abc) | 1 fails (gate.test R37 digit boundary) |
| R11 | 770 also blanks `trades.method_instructions` (2bbacb89) | 1 fails (offerMigrations 770) |
| probe | M-1 scratch test at the head | **fails** (gap hidden); passes at b7fb9969 and with the suggested fix |

## For the lead

- Fix M-1 (two conditions at `:625` and `:732`) with a gap assertion in the GR18 test. Optionally add the senderRole case for GR20 (n-2).
- No owner questions.
