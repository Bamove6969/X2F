# Review: wip/lead-trade-copy (J-19 trade copy from design's build specs J-31/J-33), 9 Nov 2026

Reviewer: independent, read-only on the code. Worktree /home/user/X2F/.claude/worktrees/trade-copy, six commits on origin/main 22b379e8 (4d92024a, 09925090, 05a49c9d, ca67a247, b7978edf, acec2f20), 40 files.
Specs read: origin/wip/design-brief docs/build-specs/spec-j31a.md, spec-j31b.md, spec-j33a.md, plus spec-j33b.md section 7 (Devices, G-007). Boards checked: docs/design-boards/{BuyQuote,SellQuote,SellQuote-Wide,OfferAd,OfferAd-Wide,BuyerPay,CancelRequest,DisputeRoom,AccountFrozen,Devices,SetupTerms} at b5bb4faa.

## Verdict: APPROVED WITH CHANGES

The copy matches the boards word for word, every new string is marked, and the per-reader rules hold and are tested. Two things need fixing. M2 (Devices) is user-visible today and should be fixed before landing. M1 (AccountFrozen incident ID) is dormant until the frozen state is wired, but the shape is wrong and is cheap to fix now. Everything else is low or a note.

## Tests run

- Playwright, one run, from apps/web: `npx playwright test -c e2e/playwright.config.ts e2e/quote.spec.ts e2e/pay.spec.ts --workers=1 --trace off` with X2F_CHROMIUM_PATH=/opt/pw-browsers/chromium. **57 passed, 0 failed** (35 quote.spec, 22 pay.spec), 45.5 s. The pixel-parity notes on BuyQuote ("34.40% differ", "sizes differ") are report-only, not blocking.
- Vitest, @x2f/web: tradeTerms.test.ts, quoteScreen.test.tsx, cantDoThat-lint.test.ts. **3 files, 59 tests passed.**
- Not run: accountFrozen.test.tsx, devicesBoards.test.tsx, buyerPay.test.tsx, dispute.test.tsx, task28-units.test.tsx (the 3-file limit). I read them instead.

## Checks

### (1) Copy fidelity and markers: PASS, with three documented deviations
- **What applies to you.** I took the boards' `WA_DATA` from all five boards; it is byte-identical (same md5). I parsed it and compared it with the test's `BOARD` constant: **equal**. tradeTerms.test.ts then asserts `TRADE_TERMS` equals that data minus the lead's placeholder, in order. Subtitles match. The mono split uses the board's regex. One quirk: it also sets the "2" in "X2F" in mono, which the board does too.
- **Courtesy sheet.** The title, body, tick ("Don't show this again", unchecked) and "Got it" (the only action) match spec section 2.
- **CancelFinalSheet.** The title is "Cancelling is likely final". The body reads "The 1.250000 XMR in escrow is returned and this trade closes. Be sure before you cancel. Don't send any money after you cancel. Already paid? Don't cancel: tap I've paid instead." This matches the board, and so does the styling (mono amount, XMR 600 monero-ink, "I've paid" 600). The seller is no longer named. pay.spec asserts the full body.
- **SetupTerms.** The 60-day key point matches the board, with numbers in mono.
- **Devices (j33b section 7).** Matches: the over-limit count and note, the caution meter, the session-length line in both forms, the empty-team box and "No team members are logged in.".
- **AccountFrozen.** The chip, H1, lead, facts, both cards and both actions match the board.
- **Markers.** Every new string is COPY-UNSIGNED: in file headers (CourtesySheet, WhatApplies, tradeTerms, NoProofSheet, AccountFrozen), in `// COPY-UNSIGNED (all of DEVICES_COPY)` for Devices, and inline for termsText, DisputeRoom and CancelFinalSheet.
- No "!" and no emoji in any new copy.
- Usernames: they render inside `data-username` spans and are never altered (AccountFrozen counterparty).
- **"The seller" rule (owner 29 Oct).** CancelFinalSheet now names no one. AccountFrozen does name the counterparty ("Selling 0.500000 XMR to nightowl_44"), as the board does. It is an account notice, not a result or cancel screen, so I read the rule as not applying. The lead should confirm.
- **Deviations, all flagged by the builder and all owner questions (see below):**
  - The DisputeRoom line says "They may ask..." where the board says "She may ask...". This matches the line above it, which the web already words with "They".
  - NoProofSheet keeps the owner's sentence, "proof is usually what decides which side wins". **The BuyerPay board at b5bb4faa has exactly this sentence**, and design's to-lead.md (J-31 summary) says so too. The spec text's "can be what wins it for you" is the stale one. The builder is right.
  - The Devices team-card sentence "They stay logged in until their session ends or you switch them off." is left out (members have no switch yet).
  - The lead's placeholder "[lead writes the wording]" is left out, so the "What affects you" counts are one lower than the board's (correct per the spec: "Do not ship it as-is").

### (2) A fee line can never reach a taker: PASS, proven
- The quote screen renders only taker roles: `copy.adSide === 'sell' ? 'buyer-taker' : 'seller-taker'`. The poster lists exist in tradeTerms.ts, but nothing renders them yet: there is no OfferAd or poster trade view in the web.
- tradeTerms.test.ts checks `/X2F fee|No fee on a full reversal/` against both taker lists (empty) and both poster lists (2 lines each). It also checks the courtesy line is in taker lists only and the nudge line is in all four, once each, under Your options.
- quoteScreen.test.tsx expands both taker cards on the real screen and asserts that no `/X2F fee|1%/` text is present.

### (3) Courtesy sheet cannot block or swallow the take: PASS, two low gaps
- The take completes first. `useTake` records it (`storeConfirmed`) and clears busy. Only then does it hand `go` to `beforeRoom`. A refused take shows no sheet (tested).
- Every way of closing the sheet goes to the room: "Got it", Escape, a backdrop tap and a handle swipe all call `onClose = done`, which saves the tick if set and then calls `go`. Nothing can leave the user on the quote with a live trade and no way on.
- **ON path:** tested in vitest only (quoteScreen.test.tsx, 4 tests). They cover the sheet showing after the take with Got it leading to `/trade/<code>` with the confirmed state, showing on every trade until ticked and then not again, SellQuote, and a refused take. quote.spec (e2e) turns the sheet off with a localStorage init script, which is fine for its scope. **No e2e covers the ON path.**
- **L1 (low):** Escape, backdrop and swipe going to the room is untested. A single vitest case (Escape, then expect the trade room) would lock it in.
- **L2 (low):** browser Back while the sheet is open unmounts the quote, so `toRoom` is lost. The trade exists on the server and in My trades, but the taker is not landed in the room and the poster's 60-minute answer clock runs. Nothing is swallowed server-side. If the lead wants it airtight, push the room onto history before showing the sheet (the sheet over the room), or navigate on unmount. This is a design/behaviour choice, so it is listed below for the lead, not the builder.
- The device-only storage stores no account data, and both read and write are guarded with try/catch. NEEDS_API_ACCOUNT_SETTING is marked.

### (4) AccountFrozen: the route is safe, the incident ID is WRONG (M1)
- **Route with no state:** `AccountFrozenRoute` reads `source?.() ?? null` and returns `<Navigate to="/" replace />`. Nothing installs a source. No data, title or flash of the notice renders before the redirect. Tested in accountFrozen.test.tsx. No leak.
- **M1, incident ID (medium, dormant).** `incidentId(code)` takes the first 8 characters of the trade code with the dashes removed. The board's caption says the same. But the owner's ruling G37 (owner-decisions-2026-11-06.md line 63) is "8 to 9 characters, **same as the dispute's**, shown to both people at the top of the trade and to the moderator". The API side of that already exists on wip/third-p4-task11 (ca356ce7, awaiting landing): migration 208 makes `disputes.incident_id` a 9-character random Crockford base32 ID with a Luhn mod 32 check character. It is deliberately not derived from anything ("an ID says nothing about how many disputes there are"), and `@x2f/staff normalizeIncidentId` validates it, so moderators look disputes up by it.
  - The effect: once wired, the frozen notice would show an ID the trade header and the moderator never show. A trader quoting it on Matrix or Telegram would fail `normalizeIncidentId` and be told it is wrong.
  - Fix: give `FrozenState.dispute` an `incidentId: string` field that the API supplies (disputes.incident_id), render that, and drop `incidentId()` and its test. Keep NEEDS_API_FROZEN_STATE. The board's "first 8 characters" caption is design's placeholder and should go back to design.
  - As a placeholder it is acceptable only while unwired. The derivation itself is wrong, not just early.
- Lesser notes:
  - `formatXmr(BigInt(amountAtomic))` throws on a malformed value. Guard it when the API source lands.
  - The phone header has Close and "Account frozen" but not logo D; the board has "logo D – Account frozen". Minor.

### (5) Devices team card and GET /v1/team: no leak; M2 for traders
- **No leak to a member session.** `GET /v1/team` has `preHandler: owner = requireSession({ kinds: ['trader'] })`, and its comment reads "members get `owner-only`". In a member session the call is refused, the `.then(..., () => undefined)` leaves `teamSize` null, and the card behaves as before: it shows only from the session list the API already scopes. The web reads only `members.length` and `max` from the response, and only for the account owner's own team.
- **M2 (medium, user-visible now).** For every plain **trader** (not a vendor) owner session, `GET /v1/team` returns 200 `{ members: [], max: 3 }`. The route is not vendor-gated, and only invites carry `requireVendor`. So every trader now sees "No team members yet / Add up to 3 people to help with your trades. You choose what each one can do. / Add a team member" in Devices. The owner's rule (accountType.ts, 2 Nov) is that only vendor accounts have team members. A trader following the link gets `not-vendor` after the confirm step.
  - The commit message says "An account without a team (the call refused) is as before". That is true for members and staff, not for traders. devicesBoards.test.tsx stubs "no team" as a 403, which hides this.
  - Fix: show the team card's empty or none-logged-in states only when `me().accountType === 'vendor'` (Devices already calls `me()`), and add a test with a trader `me` and a 200 empty team.

### (6) Ratchet and allowlist: JUSTIFIED
- **not-a-refusal 52 → 53.** Two pragmas in tradeTerms.ts, each covering a shared constant that four lists use:
  - The nudge pace, "at most once every 15 minutes". The owner encourages nudging (p6-1); this is the pace stated up front, not a refusal of an attempt.
  - The moderator response time, "within 24 hours at most". This describes a service level.
  - Measured total 53, test green. Neither line tells the reader they cannot do something they just tried, so CantDoThat does not apply.
  - Nit: the comment labels it "J-19"; the board ids are J-31.
- **Orange allowlist:**
  - `.x2f-wa__toggle`: the BuyQuote board's "Show all N" button is `color: var(--monero-ink)`. It is a text button, an existing allowed category.
  - `.x2f-warn__xmr`: the CancelRequest board sets the XMR unit at 600 `--monero-ink`, the existing "XMR unit label" category.
  - Both are board-backed.

### (7) e2e: 57/57 passed (see Tests run)

## Other findings (low / notes)
- **L3 (pre-existing, not from this branch).** SetupTerms KEY_POINTS still has "Dispute records are kept for 30 days." The board, which spec j33a says is unchanged there, has two lines instead: "Completed trades are erased on day 30." and "Disputed trades are kept up to 90 days, cleaned by our privacy tool, to train our moderators.". The web's line also contradicts the owner's 90-day dispute retention. The rest of p11-24 (site-rules card and tick, new intro, renamed button, rules flag) is not built here, as the commit says. Probably the signup-rules branch; the lead should make sure someone owns it.
- **NoProofSheet is off** until a proof source says 'none' (`paySeams.setProofSource`; nothing installs one until Plan 5's proof slot). Today I've paid behaves as before. That is fine. `buyerPay.test.tsx` covers the ON path by installing a source.
- **Devices.** With members but none logged in, "Log out all team members" is shown disabled. The spec only hides it in the empty state, so disabled is a reasonable reading.
- **OfferAd** (where spec j31a puts the lists and the sheet too) has no web screen, so nothing is missing here. When it is built, it must pick the poster role for the ad owner and the taker role otherwise, and reuse CourtesySheet for takers only.

## Required before landing
1. M2: vendor-gate the Devices empty/none team states, and add a trader test.
2. M1: carry `incidentId` in `FrozenState` from the API (disputes.incident_id, G37) instead of deriving it from the trade code.
3. (Recommended) L1: a vitest case where Escape on the courtesy sheet lands in the trade room.

## The builder's six questions, with a recommendation each (for the lead to take to the owner)
I did not find the builder's report text in the comms worktree or the scratchpad. These six are the open points the branch itself flags (commit messages and code comments). Two of them are already on page 11 as p11-86 and p11-87. The lead should map them onto the builder's own list.

1. **Courtesy "Don't show this again": account or device? (p11-86)** Built on the device (NEEDS_API_ACCOUNT_SETTING). **Recommend: on the account.** The spec calls it per-account, and someone trading from phone and laptop would otherwise see it again. The API addition is small.
2. **Where can a taker turn the courtesy sheet back on?** There is no Settings entry; the spec says the owner has not decided. **Recommend:** a switch next to the other confirmation pop-ups in Settings (the same place as the p7-2 "I've paid" confirm switch), built once (1) lands on the account.
3. **No-proof body: the owner's sentence or design's redraft?** Spec section 4 says "proof can be what wins it for you"; the BuyerPay board and design's to-lead.md say "proof is usually what decides which side wins". **Recommend: keep the owner's words, as built.** The board and design's own summary agree; the spec text is stale. Ask design to fix the spec.
4. **DisputeRoom: "She may ask..." (board) or "They may ask..." (built)?** **Recommend: "They".** The app cannot know a moderator's gender, and the line above already says "They can read this whole chat". Ask design to redraw with "They".
5. **Devices team card: add "They stay logged in until their session ends or you switch them off."?** Left out because members have no "Can log in" switch yet. **Recommend: leave it out until the switch exists**, then add it word for word. Today it would promise a control that isn't there.
6. **The 60-day inactivity close: every account, or vendors only? (p11-87)** The new key point says any account. The owner's 6 Nov answer was about vendors. **Recommend:** ask the owner before this line ships to signup. If it is vendors only, the line must change (for example "a vendor account not signed into for 60 days is closed"), and the API's inactivity job must match.

Also for the lead, not the builder:
- The "[lead writes the wording]" first-month privacy-tool line (p9-8 / Q47) is still owed by the lead. Once written, it goes after the "privacy tool hides..." line in all four lists, and the counts go up by one.
- L2: should Back during the courtesy sheet still land the taker in the trade room? **Recommend yes:** show the sheet over the trade room instead of before it. That needs design's nod, because the boards draw it over the quote.
- M1's board caption ("first 8 characters of the trade code") goes back to design, with G37 and the P4 Task 11 format.

## Re-verify e47e8e43 (9 Nov 2026, independent, read-only on code)

Branch wip/lead-trade-copy at e47e8e43: four fix commits on acec2f20 (2e8b8f85 M2, 5ce7500d M1, 6dba2940 L1, e47e8e43 nit). Six files, +91/-24, all under apps/web.

### Verdict: APPROVED. M1 and M2 are closed as asked; L1 and the nit are done. No assertion weakened.

### Tests run (serialised runner, @x2f/web)
- apps/web/test/devicesBoards.test.tsx: **38 passed, 0 failed** (36 before + 2 new M2 cases).
- apps/web/test/accountFrozen.test.tsx: **5 passed, 0 failed** (the derived-ID unit test replaced by a render test, same count).
- apps/web/test/quoteScreen.test.tsx: **42 passed, 0 failed** (40 before + 2 new L1 cases).
- `npm run typecheck -w @x2f/web`: **exit 0, 0 errors**.
- Not run: e2e, cantDoThat-lint.test.ts (e47e8e43 changes a comment only, no code or threshold).

### M2 (Devices team card, vendors only): CLOSED
- Devices.tsx keeps the raw `GET /v1/team` reply in `teamReply` and sets `teamSize = vendor ? teamReply : null`, with `vendor` from `isVendor(m)` on the `me()` reply. `isVendor` is the shared helper in packages/auth-client/src/api.ts (`me?.accountType === 'vendor'`, exported from the package index, the same one AccountType.tsx uses). Not a local re-implementation.
- Every empty/none-logged-in branch keys off `teamSize` (lines 255, 368, 377, 407), so a trader with a 200 `{ members: [], max: 3 }` reply gets no card, no "Add a team member", no "No team members are logged in.". Members logged in still show from the session list (`team.length > 0`), as the review asked.
- An older API without `accountType` gives `isVendor` false, so no card either (tested). A `me()` failure (staff/owner) leaves `vendor` false; those get 403 on /v1/team anyway.
- Tests: the two G-007 vendor cases now stub `accountType: 'vendor'`; new: a trader with a 200 empty team (asserts the call was made and no card, no copy) and a `me()` without accountType. The stub's `kind: 'vendor'` became `kind: 'trader'`: `AccountKind` is `'trader' | 'staff' | 'owner' | 'member'`, so 'vendor' was never a valid kind. That is a corrected stub, not a weakened one. The pre-existing 403 "no team" case is still there.

### M1 (AccountFrozen incident ID from the API): CLOSED
- `incidentId()` and its test are gone. `FrozenState.dispute.incidentId: string | null` is supplied by the caller (API), rendered as `#<id>` only when non-null; null renders "Selling 0.500000 XMR to nightowl_44" with no "#". NEEDS_API_FROZEN_STATE and the COPY-UNSIGNED header remain. No wording changed.
- The shape (`string | null`) matches what wip/third-p4-task11 gives the web's dispute API type (apps/web/src/screens/dispute/api.ts `incidentId?: string | null`), so wiring later is a straight pass-through.
- Grep of apps/web/src for incident IDs: only AccountFrozen.tsx mentions them, and it derives nothing. The remaining `replace(/-/g, '')` sites are trade-code normalisers (chat/live.ts, trade/seams.ts) and DesktopShell.tsx's 4-character trade chip under the logo, none of them presented as an incident ID. Nothing else derives one client-side.
- **Fixture K7QM4T2X9 is a valid incident ID.** Recomputed with the Task 11 algorithm (origin/wip/third-p4-task11 packages/staff/src/incident.ts `incidentCheckChar`, the same Luhn mod 32 over the Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` as migration 208's `x2f_incident_id()`): payload K7QM4T2X, all 8 characters in the alphabet, computed check character **9** = the fixture's 9th character. For contrast the old derived "7F3A9C21" is 8 characters and would need check Z, so it would have failed `isIncidentId`, as the review said.
- The test asserts the rendered mono span is exactly `#K7QM4T2X9` and that "7F3A" (the trade code) does not appear in the Dispute fact.

### L1: DONE
- Two new quoteScreen cases: Escape on the dialog and a click on `[data-part="backdrop"]` both close the sheet, land on `/trade/K7M2-9QXA-4FTR-8WPN` and carry `confirmed: { role: 'buyer' }`. Same assertions as the Got it case. (Swipe remains untested; it calls the same `onClose`, acceptable.)

### Nit: DONE
- cantDoThat-lint.test.ts comment now reads J-31. Comment only, ratchet still 53.

### Assertions: none weakened
- The only removed assertions are the obsolete `incidentId('7F3A-9C21-4FTR-8WPN') === '7F3A9C21'` test, which the review asked to drop, replaced by a stricter render test. Every other change adds a case or tightens a stub.

### Still open (unchanged from the review, for the lead/owner, not blocking)
- L2 (Back during the courtesy sheet), the six builder questions, L3 (SetupTerms 30-day line), the board caption "first 8 characters" back to design, and `formatXmr(BigInt(...))` guarding when the API source lands.
- The review file edit is uncommitted in the comms worktree.
