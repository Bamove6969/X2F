# Re-verify: wip/lead-trades-list (fec4515d, then 6004eebb), 12 Nov 2026

**Against:** review-trades-list-2026-11-12.md (B1, M1, m1, m2, I1), plus the lead's per-trade split.

**Commits checked:**

| Head | Commits | What they do |
|---|---|---|
| fec4515d | 423d84f5 (RED) and fec4515d | The review fixes |
| 6004eebb | df2eac20 (RED) and 6004eebb | The per-part boxes on attestation, confirmations, the dispute view, the review and the live stream |

**Method:**
- Throwaway detached worktree with `npm ci`, removed afterwards; nothing committed.
- Every run went under `flock ~/x2f-comms/check.lock`.
- Playwright used `X2F_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## Verdict

**Not ready to land yet: one blocking item (B2).** It is new in this pass, but it has been in the
branch since 10db6dc7. I missed it in my first review because I ran only a subset of the web tests.

Everything the review asked for is fixed at its cause, and each fix has a test that was red before
it. The per-trade split holds. Once B2 is fixed, I would approve.

**B2 (blocking; the moderator look outside the dispute screens).** My trades shows a disputed trade's
chip with `tone: 'mod'`, the moderator look (`trades/model.ts` `STATE_LABEL.disputed`), through
`<StatusChip tone={state.tone}>` in `screens/Trades.tsx`.

- `apps/web/test/moderator-badge-scope.test.ts` fails on both heads, "tone from a variable: only the
  dispute screens and the trade chat": `expected [ 'screens/Trades.tsx' ] to deeply equal []`.
- This is the only failure in the full apps/api and apps/web run.
- The rule it guards is spec 6.6: the moderator look appears only inside a disputed trade, on the
  dispute screens. A list row is not that place.
- **Fix (recommended):** give the disputed chip a non-moderator tone (for example `caution` with the
  `alert` icon). The text "In dispute" already says what it is.
- **Alternative (design call):** add `screens/Trades.tsx` to `TONE_VARIABLE_OK` with the reason
  recorded, as `Refunded.tsx` has.

## Red before, green after

| Run | Result |
|---|---|
| Tests at fec4515d with `apps/api/src` and `apps/web/src` from 8bf9adbf | **7 failed**, 91 passed. Covers B1 (frontDoor), M1 (the bad-cursor loop), I1 (the room by part), m1 (BottomNav, DesktopRail, `mayReadTrades`) and m2 (the parser). |
| team.test.ts at 6004eebb with `apps/api/src` from fec4515d | **7 of the 8 new tests failed.** They cover the bus, the trade publisher, attestation, confirmations, the dispute view, the history-only stream, and the stream ending on a box change. The eighth, "the review stays the account owner's", passed before and after; it is a pin, by design. |
| apps/api + apps/web full vitest at fec4515d | 233 files: 4518 passed, 1 todo, 2 failed. One is B2. The other is identity.test.ts "stores no attestation whose terms differ…", a load flake: it passes alone (18/18) and this branch does not touch the attestation code. |
| apps/api + apps/web full vitest at 6004eebb | 233 files: 4527 passed, 1 todo, **1 failed (B2)**. |
| `tsc --noEmit` apps/api, apps/web | clean on both heads |
| Playwright at fec4515d (trades.spec, shell.spec, on the production build served by `serveWeb`) | 22 passed |
| Playwright at 6004eebb (trades.spec, shell.spec, team.spec) | 48 passed |

**Weakened tests: none.**
- The e2e fixtures now use real-format trade codes, which m2's parser needs.
- `base()` gained an optional signed-in user.
- 6004eebb's change to take.test.ts is a single line.
- No assertion was removed or loosened.

## Item by item

### B1: fixed

`'GET /v1/trades'` is now in `OWN_DATA_READS`, with a reason that names the per-part boxes and the
public-name-only rule. The frontDoor tripwire passes.

### M1: fixed

`realInstant` rejects year 0000, and requires that the key's date and time, parsed as UTC, read back
to the same second. 30 February, month 13 and 25:61:61 are now 400. A real date in that shape
(28 February) still answers 200. All of this is in the test.

### m1: fixed

- `mayReadTrades(session)` decides whether My trades is shown:

  | Session | My trades tab |
  |---|---|
  | Account owner | shown |
  | Member with See active trades or See trade history (`/me`'s `member.abilities`, which `abilitiesView` sends) | shown |
  | Older API with roles only | shown with the Trades role |
  | Signed out | shown (as Post offer) |
  | Loading | not shown |

- BottomNav and DesktopRail both take a `trades` prop.
- Tested in unit tests, and in e2e at both phone sizes: an Offers-only member has no tab, a
  history-only member has it.

### m2: fixed

- The parser accepts a code only when `normalizeTradeCode(code) === code`, and the link uses
  `encodeURIComponent`.
- `../settings`, lower case, no dashes, short codes and `?x=1` are all refused.

### I1 and the per-trade split: fixed (lead's ruling), with one gap (m3)

**`tradePartAbility(closed_at)`:** See active trades for an open trade, See trade history for a
closed one. It is applied after the participant check, so a trade that is not the account's stays
404 and is never a 403. It covers:
- `GET /v1/trades/:code` (the room);
- `/attestation`;
- `/confirmations`;
- `/dispute` (on top of the disputes-answer box).

`GET /v1/trades/:code/review` stays owner-only (pinned).

**The live stream (`GET /v1/events`):**
- Either box opens it.
- The bus drops, for a member's sink, any event of a part they lack.
- Every trade-scoped publish now says its part: the trade publisher (`closedAt`), take (open), a
  trade chat line, the dispute store, and the staff dispute routes (moderator joined, chat,
  proof requested).
- Events of no part (login approval, nudge) need See active trades, as before.
- A change to a member's trades boxes ends their sessions' streams, so they reopen with the new
  parts.

**Accepted consequence (info).** An active-only member watching an open trade does not get its
closing event (released or refunded counts as "completed"). The room's next read is then a 403. That
is what the boxes say, but it means the member's screen loses the trade at the moment it ends.
Design may want a friendly line there; it is not a security issue.

**m3 (minor; per-part writes, lead's call).** Two writes still gate on "either box", not the trade's
part:
- `POST /v1/trades/:code/events` uses `assertMemberMay(req.auth, TRADE_READ)` plus the event's own
  box.
- `POST /v1/trades/:code/appeal` needs only `disputes-appeal`.

So a custom-set member with See trade history only, plus an action box such as mark-paid, can act on
an open trade they can no longer see. The reverse also holds: active-only plus the appeal box can
appeal a closed trade.

That breaks the 2026-11-09 m1 rule ("no acting on a trade one cannot see"), now that "see" is per
part. Fix: `assertMemberMay(req.auth, tradePartAbility(row.closed_at))` after the participant check
in both routes, plus a test each. Presets are not affected (they hold both boxes or neither); only
custom sets are.

## To land

1. **B2:** a non-moderator tone for the disputed chip (or a recorded allowlist entry, if design
   wants the moderator look there).
2. **m3:** apply the per-part box to the events and appeal writes (recommended).

---

## Addendum: 2c323dc7 (B2, m3, and the web live stream for either trades box)

**Commits:**
- d9c1245a (RED) and 62aa87b7: the web live stream;
- 263e6696 (RED) and 2c323dc7: B2 and m3.

**Method:** same as above (throwaway worktree, removed afterwards; every run under the lock).

### Verdict: APPROVE to land

B2 and m3 are fixed at their cause, the web stream now matches the API, and every new test was red
before its fix. The full apps/api and apps/web run is green, with no failures.

### Red before, green after

| Run | Result |
|---|---|
| Tests at 2c323dc7 with `apps/api/src` and `apps/web/src` from 6004eebb | **6 failed**, 141 passed: `mayOpenLiveEvents`, the moderator-scope tone test, "every trade state has words" (now asserts that no state is `mod`), the disputed-row chip, m3 events, m3 appeal |
| e2e trades.spec, same swap | **1 failed**: "a member with See trade history only gets live updates…". The other new e2e test, "a member with no trades box opens no live stream", passed before and after; it is a pin. |
| apps/api + apps/web full vitest at 2c323dc7 | 233 files, **4532 passed**, 1 todo, 0 failed |
| `tsc --noEmit` apps/api, apps/web; copy-lint | clean |
| Playwright trades.spec, shell.spec, team.spec (production build) | **50 passed** |

The earlier tests changed only by adding assertions (the disputed tone in "every trade state has
words"). Nothing was loosened.

### B2: fixed

- `STATE_LABEL.disputed` is now `caution` with the `alert` icon.
- `STATE_LABEL`'s tone type is `RowTone` (`caution | escrow | neutral`), so the compiler rejects a
  `mod` row tone.
- `Trades.tsx` draws the chip through `StateChip`, which passes each tone as a literal. The
  moderator-scope test therefore sees no tone taken from a variable, and Trades.tsx needs no
  allowlist entry.
- Tested: the rendered chip is `data-tone="caution"`, and no `data-tone="mod"` appears anywhere on
  the screen.

### m3: fixed

`assertMemberMay(req.auth, tradePartAbility(row.closed_at))` now runs, after the participant check
(so a stranger still gets 404), in:
- `POST /v1/trades/:code/events`, besides the event's own box and `TRADE_READ`;
- `POST /v1/trades/:code/appeal`, besides `disputes-appeal`.

Tested in both directions for custom sets.

### Web live stream: fixed

- `mayOpenLiveEvents(session)` replaces App.tsx's `isTrader`: a signed-in, full, current-Terms
  trader session, and then `mayReadTrades` (the owner, or a member with either trades box).
- The old check opened the stream for members with the Trades role only. A history-only member never
  got the updates the API now sends them.
- This now matches the API's `STREAM_ABILITY` (either box), and the bus still filters a member's
  events by part.
- Tested in e2e: a history-only member's stream opens and a completed trade's room reloads on its
  event; a member with no trades box opens none.

### What remains (no change asked)

- **Copy and design:** the row copy and tones are COPY-UNSIGNED and DESIGNER-REVIEW.
- **Info from the first pass:** an active-only member's room loses a trade when it closes.
- **NEEDS_APPEALS_MERGE:** the `rowAction` seam (in Trades.tsx) is still open.
