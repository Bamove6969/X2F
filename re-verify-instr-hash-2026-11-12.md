# Re-verify: instr-hash fixes (wip/lead-instr-hash 6370915e, red ddc9fec2)

Reviewer: the same independent helper who wrote review-instr-hash-2026-11-12.md. Not committed.
Range checked: 069c0d23..6370915e (ddc9fec2 RED tests, 6370915e fixes).

## Verdict

**M1, M2, I1 and I4 are fixed at their cause and no regression shows (227/227 web tests pass at
the head).** The red tests fail on the 069c0d23 sources (9 vitest failures, plus a tsc failure for I1). The hash cache cannot be
poisoned. Two minor points remain. **R1:** the new "secured" rule leaves a gap at the tap (confirmed
by a probe). **R2:** the cache has no size limit. Neither lets a lying API settle on, or be shown,
unattested text. R1 is the same kind of fail-open as M1, at a narrower door, so I would fix it
before merge. It is a two-line change. Neither needs an owner decision.

## Each fix

- **M1, fixed at its cause.** In adapters.ts, `parseTradeView` now sets `instructionsMalformed` for
  any value that is not a string and not null (a number, a boolean, an object, an array), instead
  of folding it into null. `securedSeen` is `typeof securedAt === 'string'`. In runtime.ts,
  `instructionsAttested` returns false and records `{text: null, ok: false}` (which sets
  `instructionsMismatch`) for malformed text, or for null text once `securedSeen` holds or the
  state is secured, paid or settling. The tick and the tap both go through it. Red test "review M1
  (the probe)": every lie (42, false, an object, null, a missing key) in secured and paid gives
  `view-mismatch` on both sides, the tap is refused with `paidSeen` false, and funds arriving
  settle nothing. escrowView.test.ts covers the parse.
- **M2, fixed at its cause for the trade room** (the lead's call). `EscrowStatus.methodId` is the
  attested `terms.deal.methodId`. `ReadyRoom` wraps the API view in
  `attestedMethodView(apiView, escrow.methodId)`: when the ids differ, the screens get the attested
  id and `profile: null`. `methodOf` takes the name only from the bundled catalog
  (`data/payment-methods.json`, the same file the API reads) and never from `profile.name`. Every
  screen, the glance and the chat (`TradeChatButton`, the chat pane in the room, PayBoxes) take
  `view` from the room, so they get the attested id. Note for the lead: **screens now show catalog
  names ("Zelle", "Amazon gift card") instead of raw ids**. An id the catalog does not have is
  still shown as the id itself. Red tests are in tradeRoomEscrow and attestation-flow ("the status
  carries the attested method id").
- **I1, fixed.** `paymentInstructions` is gone from the screens' `TradeView` type. The tripwire test
  now allows exactly this one field on purpose and asserts that the API type still has it.
  escrowView.test.ts has a `@ts-expect-error`. That check is red under `tsc` on the old sources
  (TS2578 "Unused '@ts-expect-error'"), not under vitest, which does not typecheck; `tsc -p apps/web`
  includes `test/`, so CI's typecheck catches it. A grep finds no `paymentInstructions` read in
  apps/web/src outside escrow/, nor anywhere in apps/staff-web/src.
- **I4, fixed.** The comment in moderation/src/shadow.ts now names the two new keys and the
  device's `participants-mismatch`. It is a comment-only change.

## The hash cache (`instructionsHashOk`)

There is no poisoning:
- It is a `Map<string, boolean>` keyed by the exact JS string (SameValueZero), with no trimming,
  normalising or truncation. Two different texts never share an entry.
- The only writer is `instructionsMatch(text, terms).then(ok => set(text, ok))`, so each entry is
  that text's own hash result.
- The method is not cached: `methodOk` is recomputed on every call and combined with the cached
  hash result. A cached `true` therefore cannot excuse a changed method (the existing method test
  covers this after the text has been cached).
- It is per `TradeRun`. `retry()` builds a new run, and `this.attested` is set once per run, with
  `clear()` right there. No result can carry over from other terms.

Probe PROBE-CACHE (temporary, since deleted) passed. Over three rounds it alternated the attested
text with near copies: a trailing space, an NFD form or a zero-width space, uppercase, and a
trailing NUL. Each near copy was `view-mismatch` with no text and a refused tap, and the attested
text showed again every time. `paidSeen` stayed false.

## The new "secured" rule

Instructions are due when `securedAt` is a string, or the state is secured, paid or settling.
**The rule has gaps.** A lying view can leave out `securedAt` and report:
- (a) a state before securing (setup, funding, securing);
- (b) a state after it that is not in the list (disputed, lapsed).

In those states a null or missing text is still read as "none yet".

## Remaining findings

### R1 (minor, confirmed by a probe): the "I've paid" tap does not need the device's own view to be secured

`act('paid')` checks `viewMatches` and `instructionsAttested` against the runtime's own fresh view,
but never checks that view's state. The screen's "I've paid" button is enabled by the screen's own
fetch (`payBlock` -> `paySecured(view)`), which is a different request.

Scenario: a lying API tells the screen "secured" and the worker "securing", with no `securedAt` and
null text. The button is live, the runtime sees nothing due, and the tap is taken. Probe PROBE-GAP
passed: refusal null, mismatch false, `act(paid)` resolves, `paidSeen` true. A view that drops
`securedAt` and reports disputed or lapsed with null text is also not a mismatch (PROBE-GAP2
passed). That case is harmless for money, because no tap or payment happens in those states.

The impact matches the original M1: no text is shown and no unattested text is shown, but the tap
is accepted with nothing verified.

Fix (engineering):
1. In `act('paid')`, require the runtime's own `v.state === 'secured'`. The machine allows paid only
   from secured, and the API already refuses it elsewhere, so an honest trade loses nothing.
2. Optionally, latch "secured seen" in the record, so a later view cannot un-secure the trade for
   this check.

### R2 (minor): the cache has no size limit

`parseTradeView` puts no length cap on `paymentInstructions`. A malicious API can serve a new large
text on every poll, and each one stays in `instructionsHashOk` for the life of the run. Example: a
1 MB string every few seconds grows the escrow worker by hundreds of MB an hour, until the tab
dies. Only one text can ever match, so a cache of the matched text plus the last mismatched one
gives the same no-await fast path.

Fix: keep at most one or two entries, or reject texts over the 1000-character column limit as
malformed (migration 490 `char_length <= 1000`). The second is also an M1-style tightening.

### R3 (info): residual unsigned method display outside the trade room

- `/trade/:code/dispute` (DisputeScreen) is a separate route outside `ReadyRoom`. It names the
  method through `fetchMethodName(trade.methodId)` from `/v1/methods`, which is both an API id and
  an API name. The buyer has already paid by then, so the risk is low.
- Before the attestation (`escrow.methodId` null) and on escrow error, screens show the API's id,
  now named from the catalog. "I've paid" is blocked in both cases (`not-secured` or
  `escrow-stopped`).
- When the ids match, the API's `profile` is kept, so `whatItIs`, `giftCard` (which drives
  `GIFT_CARD_WARNING`) and the pay `fields` labels are still unsigned. They could come from the
  catalog by id as well.

### R4 (info): the I3 race is unchanged

The async `.then(done)` can write `this.instructions` after a newer synchronous call, so the
mismatch flag can briefly be stale. Any text shown has still passed the hash, so this stays
cosmetic.

## Tests changed by the fix (checked for weakening)

None weakened:
- **attestation-flow, the securing step:** the status predicate now also waits for
  `paymentInstructions === null`, which is stricter. It was needed because the default
  `tradeView()` now carries the instructions.
- **tradeRoom-tripwires:** "same fields as the API" now leaves out exactly `paymentInstructions`
  and asserts that the API type still has it.
- **useEscrow, buyerPay and tradeRoomEscrow fixtures:** add `methodId: null` only.
- **escrow-helpers:** `tradeView()` now carries `INSTRUCTIONS` by default, so every older
  runtime test now runs with the instructions check active and matching. That widens the coverage.

## Tests run (detached worktree at 6370915e, fresh npm ci, each under flock ~/x2f-comms/check.lock; worktree and node_modules removed afterwards)

- **Head, plus three temporary probes:** 6 files, 227/227 passed. The files were attestation-flow,
  escrowView, tradeRoomEscrow, tradeRoom-tripwires, useEscrow and buyerPay. The probes were
  PROBE-GAP, PROBE-GAP2 and PROBE-CACHE; I deleted them afterwards.
- **Typecheck at head:** `tsc -p apps/web` and `tsc -p apps/moderation` exit 0.
- **Red check:** the head's tests against the sources of 069c0d23 (apps/web/src, apps/web
  tsconfig, apps/moderation/src): 3 files, 9 failed / 114 passed. Five failures are the new tests: M1 (the probe), M2 (status methodId), the escrowView parse, and the tradeRoomEscrow pair for M2 (screen gets Zelle, catalog name). The other four are older settling tests: the starter-cap refusal, propose-cancel then paid, the mutual-cancel fallback, and "paid whose save fails". They fail only because the head's `tradeView()` now always carries the instructions, so every tick on the old code awaits a SHA-256. That is the tick-versus-cancel/tap window the builder describes. They pass at the head, so the per-text cache closes it, and the four act as its regression tests. `tsc -p apps/web` fails there with
  TS2578 for I1 and TS2339/TS2353 for `methodId`.
