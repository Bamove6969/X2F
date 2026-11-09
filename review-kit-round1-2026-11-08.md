# Review: kit round 1 (origin/wip/lead-job2-kit)

- Reviewed: e8a166ffb76290b251182a9cbb5066d1fb8e3373 against main 687ae82112fccef46c8a0548f6e4cb9ef7c81195 (read-only, throwaway worktree)
- Spec: origin/wip/design-brief:docs/design-kit-handoff.md (§1.5, §2-6, head designer's rulings 8 Nov)
- Reviewer: independent Opus reviewer for the lead

## Verdict: CHANGES REQUIRED

Finding 2 is a WCAG AA regression that this branch introduces on every trade screen in day theme. Finding 1 is a money-display bug on the funding screen. It is older than this branch (main has it too), but it is exactly what Priority 1 asked about, and the kit's "6 places everywhere" rule would lock it in. Finding 3 weakens a trust/safety test. The rest are minor.

---

## Priority 1: money display, caller by caller

The branch changes one function's behaviour: `refundUi.xmrText` (`apps/web/src/screens/trade/refundUi.tsx:11`) went from exact (12 places, trailing zeros trimmed) to `formatXmr` (6 places, truncated). `formatXmr` itself (`packages/trade/src/money.ts:82`) is unchanged; it already defaulted to 6 places and truncated on main. The new money tests (`packages/trade/test/money.test.ts:116-141`) are good: half-way, 9s, just-under-1, 1 atomic, and 2^64-1.

Amounts are not 6-place-aligned in practice. `atomicForFiat` (`money.ts:57`) floors to the atomic unit, and the fee is 1% of that, so almost every real trade has non-zero digits past the 6th. For example, $100 at $165.43 is 0.604485280783 XMR. Truncation is safe wherever the user only reads the amount. It is wrong wherever the user must send that amount.

| Caller | What it shows | Verdict |
|---|---|---|
| `screens/trade/refundUi.tsx:11` → `SellerRefund.tsx:120` (the only caller) | "your X XMR comes back to your wallet automatically" | Fine. Prose only, and it understates. |
| `screens/trade/FundFallback.tsx:82` | **"Send exactly this amount: X XMR"** / "Send the rest: X XMR" | **Wrong.** See finding 1. |
| `screens/trade/TradeFund.tsx:350` | "Received X of Y XMR, send the rest" | **Wrong** for the same reason (it can read "Received 0.604485 of 0.604485 XMR, send the rest"). See finding 1. |
| `screens/trade/TradeFund.tsx:158` | SellerQuote "You send to escrow" `<Amount>` | Questionable. This is the amount the seller sends, but `Amount` enforces exactly 6 places (`ui/Amount.tsx:3,9`). The owner needs to decide whether to allow it (finding 1). |
| `screens/trade/TradeFund.tsx:162` | "Includes X2F fee" | Fine. Display only; the check compares atomics (`feeCheck`). |
| `screens/trade/TradeFund.tsx:79`, `BuyerPay.tsx:462`, `PaidFlowSheet.tsx:168` | "Trade grew to X XMR" | Fine. Informational. |
| `screens/trade/TradeFund.tsx:402` | Buyer's receive amount | Fine. Understates what they receive. |
| `screens/trade/TradeGlance.tsx:198,225` | Escrow amount; "Send exactly $… for X XMR" | Fine. The user sends fiat; the XMR figure is context. |
| `screens/trade/release/view.ts:53` (amount, fee, buyerReceives, sellerSent) | Release summary | Fine. Display only; the release tx is built from the escrow, not from this string. |
| `screens/trade/CancelFinalSheet.tsx:20-22` | XMR held / returned | Fine. |
| `screens/dispute/DisputeRoom.tsx:148` | Hero amount | Fine. |
| `screens/dispute/rules.ts:150` `xmrInText` | "1.25 XMR goes to mira.k" (trims to at least 2 places) | Fine for money (it truncates). Inconsistent with the kit (finding 5). |
| `screens/AcceptedSheet.tsx:178` | "You sell X XMR at …" | Fine. |
| `screens/quote/quoteModel.ts:187` `amountText` (Max) | Fills the box with the XMR that buys at most the max | Fine. Floor then truncate never exceeds the max. |
| `screens/quote/quoteModel.ts:142` `xmrText` (12-place exception) | Quote headline and the unit-switch text box (`Quote.tsx:232,338`) | **Correct, keep it.** The box text becomes the traded amount, so truncation would silently change the trade on a unit switch. It shows 6 places by default and more only when the digits are non-zero. This is the right model for finding 1. |
| Copy amount / QR / wallet link (`FundFallback.tsx:71` → `fund.ts:31` `exactXmr`; `TradeFund.tsx:239` → `moneroUri.ts:9`) | | Fine. Exact to the atomic unit. Never goes through `formatXmr`. |

---

## Findings

### 1. [Required, money; older than this branch] "Send exactly this amount" shows a truncated figure that differs from what the QR and copy carry

- **Where:** `apps/web/src/screens/trade/FundFallback.tsx:82`; `apps/web/src/screens/trade/TradeFund.tsx:350` (and `:158`, which needs an owner call).
- **Scenario:** On a desktop, FundFallback is the primary path. Seller funds are 0.610529733574 XMR. The screen says "Send exactly this amount: 0.610529 XMR"; the copy button and QR carry 0.610529733574. The seller types what the screen says into a desktop wallet. The escrow receives 0.000000733574 less than it needs, so the trade is not funded. The screen then shows "Received 0.610529 of 0.610529 XMR, send the rest" and "Send the rest: 0.000000 XMR". The seller is stuck until the funding clock runs out, with the screen asking them to send zero.
- **Why it matters now:** Ruling/§1.5 says "every prose amount 6 places, truncated". That is right for amounts people read. It is wrong for an instruction to send an amount. The kit also asserts 6 places in `Amount`, so round 2's TradeFund swap would harden this.
- **Fix:** Reuse `quoteModel.xmrText`'s rule for "send" figures: 6 places, and all significant digits when they exist. Move it to `@x2f/trade`, for example as `formatXmrExact`. Use it at `FundFallback.tsx:82` and `TradeFund.tsx:350`, and add a test with a non-6-aligned amount and a remainder under 0.000001. For `TradeFund.tsx:158` ("You send to escrow", `Amount` enforces 6 places), ask the owner. This is a user-facing money rule (memory: no important calls without the owner). The existing tests use 1.25 / 0.25 XMR (`e2e/fund.spec.ts:179,269`, `test/tradeFund.test.tsx:499`), which hides the bug.

### 2. [Required, accessibility regression] Day-theme status chips drop below 4.5:1

- **Where:** `apps/web/src/ui/ui.css:98-141` (`.x2f-chip` now always uses the 14% tone wash); StatusChip's 18 callers, for example `TradeFund.tsx:303-321` on `.x2f-trade { background: ground }` (`trade.css:11`).
- **Scenario:** On main, chips had a flat surface-raised background with tone text, at 4.81-5.10:1 in day. Now chip text (13 px 600 caps, which is not large text, so it needs 4.5) sits on a 14% tone wash. Measured (WCAG relative luminance):

  | Day chip on | caution | escrow | danger | team | mod (16%) |
  |---|---|---|---|---|---|
  | ground #f5f6f8 | 4.51 | **4.27** | **4.22** | **4.47** | 4.60 |
  | surface #fff | 4.86 | 4.57 | 4.51 | 4.82 | 4.96 |
  | surface-raised | **4.22** | **3.99** | **3.94** | **4.19** | **4.30** |

  "Escrow funded", every danger/dispute chip and the team chip fail on the page background. Every tone fails on raised. Night is fine (4.5+ everywhere; danger on raised is 4.54).
- **Fix:** This is a design-system value, so it goes to the owner and the head designer. Options: darken the day tone text inside chips (for example `color-mix(in srgb, var(--x2f-escrow) 85%, var(--x2f-ink))`), use a lower wash in day, or use ink text with a tone icon. Add a contrast assertion to `kit-tokens.test.ts` for tint-on-ground in both themes. The same 14% rule applies to `.x2f-tag` (`kit.css:127-140`): it passes on surface, but fails if a tag is placed on raised or ground.

### 3. [Required, trust and safety] The moderator-tag scope test no longer covers the ways a screen can draw moderator violet

- **Where:** `apps/web/test/moderator-badge-scope.test.ts:13,28-34`.
- **Scenario:** Spec 6.6 limits the violet moderator mark to dispute screens, as an anti-impersonation rule. The new test excludes `ui/Avatar.tsx`, `ui/Identity.tsx` and `ui/kit.css`. It only looks for `role="mod"`, `data-role="mod"` or the words. A screen can now draw the full moderator look without matching any of these, and the test stays green:
  - `<IdentityRow person={p} mod />`: mod tile, violet name, and the X2F Moderator tag (`Identity.tsx:60-69`)
  - `<ModTile />`
  - `<RoleTag role={r} />` with a variable
  - `<StatusChip tone="mod" …>` or `<Hero tone="mod">`

  The test comment claims it also checks "its mod tone"; it does not.
- **Fix:** Also match `<ModTile\b`, `\bmod(=\{true\}|\s|\/>)` on IdentityRow, `tone=["']mod`, `role=\{` passed to RoleTag, and `--x2f-mod` in CSS. Allow-list `screens/dispute/**` and the chat files that already use `--x2f-mod` (`chat/chat.css:35,83`, `chat/ChatPanel.tsx`). Keep the kit's own files excluded.

### 4. [Minor, accessibility] The hold-button progress fill is barely visible

- **Where:** `apps/web/src/ui/ui.css:431-436` (`color-mix(on-monero 16%, transparent)` over `#ff6600`).
- **Measured:** The fill (#da5801) against the button (#ff6600) is 1.33:1. Under WCAG 1.4.11, a meaningful graphical change needs 3:1. Main's `monero-hold` was 1.63 night / 1.56 day, so main also failed, but this is lower. Text on the fill is 4.85:1, which passes. The fill is `aria-hidden`, and nothing else shows hold progress.
- **Fix:** This needs an owner/design choice; the README lists it as the lead's choice. A 30-35% on-monero overlay gives about 2-3:1. Or add a 2 px on-monero leading edge.

### 5. [Minor, consistency] One prose formatter still disagrees with the kit's 6-place rule

- **Where:** `apps/web/src/screens/dispute/rules.ts:146-155` `xmrInText` ("1.25 XMR", trimmed to at least 2 places) feeds the ruling card (`e2e/dispute.spec.ts:229`). §1.5 says "every prose amount must pass the same check".
- **Fix:** Use `formatXmr` there too, or record in the README that dispute prose is an exception. Money-safe either way: it truncates.

### 6. [Minor, accessibility] Number and unit run together in the accessible text

- **Where:** `ui/Hero.tsx:76-79` (HeroNumber amount) and `ui/Identity.tsx:184-187` (RecipientRow). The tests assert the run-together text: `kit-hero.test.tsx:95` `'1.250000XMR'`, `kit-identity.test.tsx:174` `'1.250000XMRabout $412.50'`.
- **Scenario:** The gap is CSS only, so the text a screen reader reads has no space ("1.250000XMR"). Some readers say it as one token, and copying the text loses the space. `TimeParts` handles this correctly (`Countdown.tsx:57` adds `' '`).
- **Fix:** Add `{' '}` between the value and unit spans (and before "about"), and update the two tests.

### 7. [Minor] A ticked card that is switched off loses its dashed "off" border

- **Where:** `ui/ui.css:1549-1559`. `[data-selected='true']` now sets `border: 2px solid` and comes after `[data-on='false']` (`1px dashed`) with the same specificity. On main, only `border-color` changed, so the dashed style stayed.
- **Fix:** Add `.x2f-select-card[data-on='false'][data-selected='true'] { border-style: dashed; }`, or decide that ticked always wins and say so.

### 8. [Note] Timers: no live-region problem

`role="timer"` defaults to `aria-live="off"`, and none of the timers set aria-live. I checked every `<Countdown>`, `HeroNumber` timer and hand-rolled `role="timer"` (`Countdown.tsx:97`, `Hero.tsx:70`, `LoginApprove.tsx:273`, `ApproveOnDevice.tsx:206`, `DisputeRoom.tsx:61`). None sits inside a `role=status/alert` or `aria-live` ancestor. FinalAlert's `role="alert"` (`FinalAlert.tsx:79`) is a sibling, not a parent. Nothing is announced every second. Small gaps against §1.5:
- The aria-label is "28 minutes 42 seconds" without the spec's "… left to fund" context. It is acceptable where visible text sits next to it.
- `DisputeRoom.tsx:61` has no word label (this file was not changed here).

### 9. [Note] Other checks that came out clean

- Orange contrast:
  - On-monero on #ff6600: 6.45:1 (main #f26822: 6.11).
  - #ff6600 as night text: 6.44 / 5.88 / 5.18 on ground / surface / raised.
  - #ff6600 on day backgrounds would be 2.72-2.94, but nothing uses `--x2f-monero` as a text colour. Day text uses `monero-ink` #b84a00: 4.83 / 5.23 on ground / surface.
  - #b84a00 on day surface-raised is 4.49986:1, a hair under 4.5. This is older than the branch, but `tokens.json:14` says "4.5:1+ on … surface-raised". If the XMR unit label (15 px 600) ever sits in a raised inner block (§1.4 "Amount (secondary)"), it fails. Tell the owner; #b34800 would clear it.
  - The day primary button (#ff6600) against white is 2.94:1 as a shape. The text label identifies it, so this is not a 1.4.11 failure (main's #f26822 was 3.10).
- Box-shadow removal: the only shadows left are the two nav inset lines (`ui.css:501,1575`), as §1.5 asks. The hold button never relied on box-shadow for focus; the global `button:focus-visible` ring (`theme/base.css:28`) still applies.
- `--x2f-moderator` rename (ruling 16): no leftovers in apps/, packages/, tools/ or design/. `kit-tokens.test.ts:45-48` guards it.
- Removed pieces still needed by screens: `ModeratorBadge` had one caller (ModeratorTag, now RoleTag mod). `.x2f-tag` had two callers and `.x2f-avatar` one, all in Devices, and all swapped to RoleTag/Avatar. Nothing else on main used them; the e2e locators were updated. `data-look="tint"` on `ApproveOnDevice.tsx:192` is now a no-op, which is harmless.
- Badges: the "+N" button has `aria-haspopup="dialog"`, `aria-expanded` and an aria-label in words. The card is `role="dialog"` with a name, and Esc returns focus (ruling 4). Fine.

---

## Checks run

- `flock ~/x2f-comms/check.lock npm test -- --project @x2f/web`: 91 files, 1315/1315 passed (stray ECONNREFUSED :3000 log noise, no failures)
- `flock ~/x2f-comms/check.lock npm test -- --project @x2f/trade`: 12 files, 338/338 passed
- `npm run typecheck` (all workspaces): clean, exit 0
- Playwright: not run. Findings 1-7 are proven from the code, the CSS and the contrast arithmetic. The 0.000000 scenario follows directly from `formatXmr` + `amountToSend` (`screens/trade/seams.ts:103-111`).
- Contrast: WCAG 2.x relative-luminance formula; `color-mix` composited in sRGB over the stated background.
