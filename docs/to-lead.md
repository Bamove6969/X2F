# Design → lead

Messages from the design session to the lead. Newest at the bottom, each entry dated. The lead reads this file on `wip/design-brief`.

## 2 Nov 2026, ~15:10 UTC

Received your four decisions. Logged in `docs/design-hold-model-2026-11-02.md` (last section) and applied to the boards; canvas v112, this commit.

**Boards changed**
- MyOffers, MyOffers-Wide: hold notice now "Nobody can see or take them until the hold ends. A moderator wrote in your dispute what to do to get trading back. Trades already started carry on." No date. Sample "Cash by mail · Fixed price" offer now follows the market (no fixed-price offers exist).
- Fold-MyOffers: same sample fix.
- ModCase: account action "Freeze trading on the losing side · only if they ignore the dispute or the ruling · no end time · write what they must do to get it back". Full freeze tooling is Plan 4; this is a placeholder for the rule.
- No other board shows a hold "during a dispute". Lien-Notice and Appeal-Notice describe liens and appeals, not trading freezes; unchanged.

**OPEN list (§5 of the handoff): what blocks design**
Nothing blocks. Boards exist for every item with an OPEN box. The ones whose answer changes a board, in priority order:
1. §5 #1 member-permission presets (MemberPermissions shows a draft mapping).
2. §5 #9 and #10 ProofBlur: can the buyer remove an automatic blur; warn when amount or memo is blurred; blank code, amount and time on templates.
3. §5 #12 SetupTerms: step "of 5" or "of 6".
4. §5 #2 "Stay logged in?" wait (draft 2 min).
5. §5 #7 incident-ID format.
The rest (#3, #4, #5, #6, #8, #11, #13) change copy only or are moot.

**New question for the owner, from today's rule**
- ModCase: should the freeze be a ruling-time option at all, or only a separate action taken later when someone ignores the dispute or ruling? Design drew it as an option on the ruling card for now, with the note above.

**Nothing else waiting.** Send the screenshot pack when ready; I'll review against v2 and reply here.

## 2 Nov 2026, ~19:40 UTC

Applied the three answers (freeze as a separate later action, add-only blur with amount/memo warning, 2 min prompt). Canvas v113. Boards: ModCase, ProofBlur (+Wide), SessionExtend (+Wide). Logged in the decisions file.

Also in this commit: `--mod`/`--team` tokens added to the THEMES of 10 boards that lacked them (no visual change).

**Cohesion pass under way.** All 126 boards rendered night and day and reviewed against v2: 41 P1, 168 P2, 65 P3 findings. Fixes are being applied now; expect a larger board commit and a new canvas version by 3 Nov. Two new owner questions came out of it (bans with an end date or not; "On hover" vs "On tap" for badge visibility). A progress page for the owner is published separately.

## 6 Nov 2026, ~01:30 UTC

**Cohesion pass pushed.** Canvas v117. 124 boards changed, 4 new (Settings, Settings-Wide, FAQ, FAQ-Wide; new canvas row at the bottom, draft copy). Findings and per-board fix logs in `docs/design-cohesion-findings-2026-11-05/`; the shared standards in `docs/design-fix-standards-2026-11-05.md`. Handoff: `docs/DESIGN-HANDOFF-2026-11-06.md` (state, P1/P2/P3 table, the big board changes to re-read before copying, OPEN list, what waits on you).

**Build review** of the four packs on main: `docs/design-review-build-2026-11-05.md` (pushed earlier today).

**Boards the build team should re-read before copying** (changed shape, not just copy): Review, BuyerPaidWaiting (+Wide), SellerConfirm, DisputeRuling, DisputeRoom, Lien-Notice (+Wide), Team (+Wide), TeamRefusal, MemberPermissions (+Wide), OfferAd (+Wide), FlexOffer-Quote (+Wide), TradeFund, SessionLength (+Wide), Devices (+Wide), StaffSettings, StaffOverview, ModCase, Fold-Tabletop, Fold-Trade.

**COPY-UNSIGNED:** every sentence listed under "COPY-UNSIGNED" in the five `fixed-*.md` files, plus all of Settings and FAQ.

**Not reviewed by design yet:** the proof pop-ups (your items 63/64/65). Send them in the next pack.

**Owner questions still open:** presets; template blanking; SetupTerms step count; incident ID; bans with an end date; "On hover" vs "On tap". Also: Matrix/Telegram addresses, password-only changes applying on their own after 24 h, PostOffer vs FlexOffer-Post, SessionLength tiles vs drop-down.

Nothing in the design window needs the owner.

READY TO CLEAR

## 6 Nov 2026, final

Handoff section 6 added: two jobs (three last board redesigns; design system artifact to v2) were started and stopped for the clear before touching any file. Branch and canvas v117 match. Next design session starts there.

READY TO CLEAR

## 6 Nov 2026, ~evening UTC

**Handoff §6 job 1 pushed: the last three board redesigns.** Canvas v118.
- **Ban-Notice (+Wide):** now a full-screen account notice built like Lien-Notice: close + "Account notice", danger hero (chip, headline, lead) with the Ends / Reason block inside it, "What this means" card, "Think this is a mistake?" with Matrix / Telegram rows (neutral icons, no moderator purple), pinned OK (site ban with open business adds "Log out" under it). `ends` tweak: dated "14 Nov 2026, 14:05 UTC" vs "Permanent · until a moderator lifts it". Both OPEN boxes kept (timed bans; Matrix/Telegram addresses). No more bottom sheet / centred dialog. Wide site ban keeps the logged-out header (no rail).
- **SignupSecurity (+Wide):** setup context line "Set up your account · Takes about 2 minutes." and the five-bar stepper (done = ink) as on SetupUsername. This one screen covers steps 1 to 3 (username, login, password), so it reads "Steps 1–3 of 5" with three bars ink.
- **FlexOffer-Quote (+Wide):** app in its own `position: relative` block (the CancelRequest-Wide wrapper) so the sheet / dialog scrim covers only the app; "Sellers and prices are examples." and the market line's "· Example" moved to Design notes below the app; the in-app line is now "You pay no X2F fee when you take an offer."; digits in every trader stats line are mono ("340 trades", "Seen 40 min ago").

**COPY-UNSIGNED (Ban-Notice):** "Your account can't start or join new trades." · "You can use your account again when the ban ends." · "There is no end date." · "Account banned" (chip, permanent site ban) · "You can appeal. Message a moderator if you don't agree with this decision or feel it was made in error." · "Message a moderator on Matrix" · "Permanent · until a moderator lifts it".

Next: job 2, the X2F design system artifact to v2.

## Owner questions 6 Nov

Every open owner question design holds, as of canvas v118. Nothing on this list has been answered yet. Each has an OPEN box on its board. BLOCKING means a board can't be final, or the build can't copy it, until the owner answers.

**1. Member-permission presets: BLOCKING**
- Question: what does each of the four team presets switch on?
- Options: the draft mapping on MemberPermissions (Chat only = chat; Offers manager = chat + offers; Trade handler = chat + accept trades + mark paid; Everything allowed = all, including Release XMR), or the owner's own mapping.
- Recommendation: the draft mapping. Keep Release XMR only in Everything allowed, with its warning.
- Blocks: MemberPermissions (+Wide) and building team permissions.

**2. Blur templates: also blank the trade code, amount and time? LATER**
- Question: should the stored blur templates also blank the trade code, amount and time, as well as names and account numbers?
- Options: yes, blank all three; or blank names and account numbers only.
- Recommendation: yes. A template should hold no detail from any real trade.
- Blocks: the ProofBlur template note and the template database. Nothing on screen changes.

**3. SetupTerms step count: BLOCKING**
- Question: does agreeing to the Terms count as an onboarding step?
- Options: "of 5" (Terms is a gate before step 1) or "of 6" (Terms is step 1).
- Recommendation: "of 5". Terms is a yes/no gate, not setup work.
- Blocks: the step label on every Setup* board, SignupSecurity and SetupPgpChallenge ("3 of 5 · part 2").

**4. Incident ID: LATER**
- Question: what does an incident ID look like, and does the held account also see the incident pop-up?
- Options: format, a short code like `INC-7Q4K` (drawn) or a date-based one like `2026-11-06-014`. Pop-up, partners only (drawn) or partners and the held account.
- Recommendation: the short code; partners only. The held account already gets the hold notice.
- Blocks: TradeTechIssue copy only.

**5. Bans with an end date: BLOCKING**
- Question: does a ban end on a date, or last until a moderator lifts it?
- Options: timed ("Ends 14 Nov 2026, 14:05 UTC", the current default); or not timed ("Permanent · until a moderator lifts it"); or both, chosen per ban by the moderator.
- Recommendation: both, per ban. A moderator picks timed or permanent when banning. Ban-Notice already draws both (`ends` tweak).
- Blocks: Ban-Notice (+Wide) and the moderator ban tool.

**6. Badge visibility middle option: LATER**
- Question: what is the middle choice between always showing and hiding a badge?
- Options: "On hover" (the spec's word), "On tap" (phones can't hover), or drop the middle option.
- Recommendation: drop it. Hover and tap behave differently, and two choices are clearer.
- Blocks: BadgeSettings only.

**7. Matrix and Telegram addresses: LATER**
- Question: what are X2F's real Matrix and Telegram addresses?
- Options: none. The owner supplies them. `#x2f-help:example.org` and `@x2f_help` are examples.
- Recommendation: none. We need the real ones before launch.
- Blocks: Ban-Notice, HoldChange, TradeTechIssue and Maintenance copy, at launch.

**8. Password-only changes after 24 h: BLOCKING**
- Question: after the 24 h wait, do password-only changes to login methods, wallets or team apply on their own?
- Options: apply on their own; or need a moderator or the recovery code to confirm.
- Recommendation: apply on their own, as HoldChange shows. Anyone logged in can cancel during the 24 h, and the owner is alerted on every channel.
- Blocks: HoldChange (+Wide) and the hold logic in the build.

**9. Which "Post an offer" ships: BLOCKING**
- Question: which offer form do we build?
- Options: PostOffer (one price ± % per currency, simpler) or FlexOffer-Post (bands per currency, each with its own ± %).
- Recommendation: FlexOffer-Post. The owner's band rules (whole units, next band +1, up to 5 currencies) only fit there.
- Blocks: building offer posting; question 11 depends on it.

**10. Session length: tiles or drop-down: LATER**
- Question: the owner said "drop-down, nothing pre-selected". Design drew four tiles instead. Which one?
- Options: tiles (one tap, choices visible), or a drop-down (the owner's word).
- Recommendation: tiles, still with nothing pre-selected. This is a visual call, but it changes the owner's word, so we're asking.
- Blocks: SessionLength (+Wide), SignupSecurity, Devices. The build can start with either one.

**11. New: pairing payment methods with currencies: BLOCKING (with 9)**
- Question: when a vendor posts an offer, do they pick payment methods first and then the currencies each one takes, or currencies first and then the methods for each?
- Options: method-first (a card per method, the currencies it takes ticked inside, instructions per currency only where they differ); or currency-first (a USD | EUR switch, with methods and instructions under each currency, as FlexOffer-Post draws now).
- Recommendation: method-first, the same as claude2. Instructions belong to the method and differ by currency only sometimes (bank transfer: USD routing vs EUR IBAN). Bands stay per currency in their own section with the USD | EUR switch.
- Blocks: FlexOffer-Post (+Wide) redraw (design, about 1 day after the answer) and the offer form build.

**12. New: the glance says "Pay now" while the trade room says wait for escrow: BLOCKING (build fix, rule check)**
- Question: may a trade glance (Desktop list, Fold cover, notifications) ever say "Pay now" before escrow is secured?
- Options: no, the glance always shows the trade room's own state ("Securing escrow" first, "Pay now" only once escrow is secured); or keep a separate, earlier glance.
- Recommendation: no. The glance must mirror the trade room. Telling a buyer to pay before the coins are locked is the one mistake that loses them money. The boards already draw it this way: "Pay now" is the escrow-secured state on Desktop and the Fold boards. This is a build bug to fix, and the owner only needs to confirm the rule.
- Blocks: the glance in the build. No board change is needed.

**Still COPY-UNSIGNED** (unchanged until signed): every COPY-UNSIGNED line in the five `fixed-*.md` files, all of Settings and FAQ, and the Ban-Notice lines listed above (6 Nov evening).

## 6 Nov 2026, late

**Handoff §6 job 2 done: X2F design system is at v2** (https://claude.ai/artifact/Bywqtsd4FKmYPHta6wQNPM, version 6).
- `tokens.json` v2: added colours `mod`, `team`, `scrim`; type styles `screen-title`, `result-headline`, `sheet-title`, `hero-number`, `meta`; spacing `space-3`, `space-5`, `space-8`; `radius-lg`. Usage notes were rewritten to match v2 (selection in ink, orange only for the primary, the XMR unit and links).
- `README.md` rewritten to v2: no shadows and surface steps, one hero, ink selection, state shown three ways, key-mark placements, the wide rail and grid, dates and durations, the terms table, no email, Draft copy and OPEN, design notes below the app.
- 15 live components, each with a guideline and a night + day preview whose styles are copied from the boards: KeyMark, StatusChip, HeroBlock, Button, Switch, Callout, OpenBox, Stepper, Timer, Amount, ListRow, FormField, Card, EmptyState, NavRail. The Cover is unchanged.
- Not done: no React bundle. The cards are static HTML and boards copy their inline styles, as before. The cover still draws the v1 palette, which is unchanged in v2.

Section 6 of the handoff is complete. Next: the proof pop-ups (63/64/65) when you send them.

## 6 Nov 2026: design review, proof pop-ups 63/64/65

Reviewed from code: `origin/wip/third-p5-proof-popups` @ `e5780990`. Files: `apps/web/src/screens/proof/ProofPrompts.tsx` (PP below), `apps/web/src/proof/uploaderChecks.ts`, and the kit pieces they use (`ui/Sheet.tsx`, `ui/Notice.tsx`, `ui/Button.tsx`, `ui/ui.css`, `screens/screens.css`). The boards are ProofBlur (+Wide), SellerConfirm, Warn-Release and CantDoThat.

**Verdict:** the structure is right. Each pop-up is the CantDoThat sheet pattern (a phone sheet, a centred dialog on Desktop, no X, closing it goes back), each has one primary, the own-blur warning is a caution callout announced as a status, and nothing blocks a send that the owner said to allow. One P1 (the warning must not depend on the text box styling being wrong), five P2, three P3. Nothing here is a wording or rule call by design; those are listed separately as owner questions.

**P1**
- **P1-1 · the text box on 64 is invisible against the sheet.** File and line: PP:91 uses `.x2f-input` (screens.css:56): `background: var(--x2f-surface)`, the same colour as the sheet (ui.css:305). So the box is only a 1px line on an identical ground, and its focus ring is orange (`monero-ink`, offset 1). Fix (v2 §11, also build-review X4): `.x2f-input { background: var(--x2f-surface-raised); padding: 0 14px; min-height: 48px; border-radius: var(--x2f-radius-sm); }` and `textarea.x2f-input { padding: 12px 14px; min-height: 96px; }`. `.x2f-input:focus-visible { outline: 2px solid var(--x2f-ink); outline-offset: 2px; }`. This is kit-wide, so every form gets it.

**P2**
- **P2-1 · the tile doesn't say anything is wrong.** PP:33-39 InfoTile is the neutral raised tile with an info icon, which on CantDoThat means "X2F rule, nothing wrong with you". Here the app found a problem with the screenshot. Fix: a toned tile for both 63 and 64: `.x2f-icon-tile[data-tone='caution'] { background: color-mix(in srgb, var(--x2f-caution) 14%, transparent); color: var(--x2f-caution); }`. Use `<Icon name="clock">` for 63 (wrong date) and `<Icon name="alert">` for 64 (no amount). Pass `data-tone="caution"` from PP:35.
- **P2-2 · backdrop colour.** ui.css:298-303 uses `ground` at 0.8 opacity. v2 uses `--scrim` (night `rgba(0,0,0,0.6)`, day `rgba(18,22,28,0.45)`). Fix: `.x2f-sheet-backdrop { background: var(--x2f-scrim); opacity: 1; }`, with `--x2f-scrim` added to the theme tokens. Kit-wide.
- **P2-3 · 64 has no way back except a gesture.** PP:82 `closeButton={false}`. The handle is hidden on Desktop (ui.css:697), so leaving without sending takes Escape or a backdrop click, and "Choose another screenshot" leaves the editor. Fix: a third button under the two, `<Button variant="tertiary" onClick={onClose}>Back</Button>`. Its word is COPY-UNSIGNED.
- **P2-4 · 64's buttons on Desktop.** PP:93-98 stacks both full width inside the 520 dialog. v2 §18: wide actions sit inline. Fix: on `[data-wide='dialog']` at ≥1000px, wrap the buttons in `.x2f-sheet__actions { display: flex; flex-direction: row-reverse; justify-content: flex-start; gap: 12px; }`, primary 48h min-width 160. Phone stays stacked, primary first. The same applies to 63's single button (right-aligned, 48h).
- **P2-5 · the item 65 disclaimer is a loose muted line.** PP:116-121 uses `.x2f-note` (13px muted, screens.css:106). v2: warnings go in a callout. Fix: on the seller's proof card (Task 16), put it in the existing caution callout under "Screenshots can be faked." (SellerConfirm), as its second sentence. Don't add a separate `<p>`. Placement only; the sentence itself is COPY-UNSIGNED.

**P3**
- **P3-1 · dialog width.** ui.css:697 sets 520px. CantDoThat-Wide and the v2 design system use 480. Fix: `width: 480px` (it also affects LoginApprove-Wide).
- **P3-2 · no character count on 64.** PP:91 caps at 500 silently. Fix: a helper under the box, `<span class="x2f-help"><mono>{n}</mono> of <mono>500</mono></span>` (13/18 muted, digits mono).
- **P3-3 · the disabled Send proof gives no reason.** PP:93 is disabled until text is typed. Fix: `aria-describedby` from the button to the helper in P3-2, so a screen reader hears why it is disabled.

**For the owner (wording and rules; design's recommendation beside each, nothing changed in code)**
- 63, block or allow? `uploaderChecks.ts:6` OWNER-Q. Recommendation: block, as the owner's "redo proof and resubmit" reads. Blocks: Task 15 wiring.
- 63, show the dates? Recommendation: add one line under the owner's sentence, "Your screenshot shows <date>; this trade started <date>." (dates in mono). It tells people what to fix. It's new wording, so it's the owner's call.
- 64, required, and who reads it? PP:61-62 OWNER-Q. Recommendation: required (the owner's "leave an explanation"). It goes to the seller with the proof, and to a moderator if there's a dispute. Not to detector feedback.
- Hidden-by-you text, PP:107: when both are hidden, two sentences each ending "the seller may not be able to…". The ProofBlur board's draft is one sentence: "The amount or memo is hidden, so satoshi_ghost may not be able to check your payment." Recommendation: one sentence that names the seller, using "memo" (the board's word, not "the note with this trade's code"). This is wording, so it's the owner's call.
- All five strings (PP:18-28), the titles "Screenshot not current" and "Amount not found", the label "Your explanation", and the buttons "Redo proof", "Send proof" and "Choose another screenshot" are COPY-UNSIGNED.

## 7 Nov 2026: owner answers 6-7 Nov applied (canvas v119)

All COPY-UNSIGNED. Each line is for the owner to sign or change, and design's recommendation is the wording shown.

**Boards updated in v119:** DisputeRoom, DisputeOpen, OfferAd (+Wide), FlexOffer-Post (+Wide), PostOffer, Profile, ProfileVisibility, Settings (+Wide), SellerConfirm, Warn-Release (+Wide), ProofBlur (+Wide), Feedback (+Wide), BuyerPaidWaiting (+Wide), Refunded (+Wide), BuyerPay, Desktop, Ban-Notice (+Wide), HoldChange (+Wide), MemberPermissions (+Wide), Devices (+Wide), SessionExtend (+Wide). Answered OPEN boxes are now DECIDED asides that name the Q number.

### Final wording, for the owner to sign
- **Q38, dispute hourglass** (DisputeRoom; also DisputeOpen before filing): label "Until a moderator steps in". Countdown "23 h 12 min" with an hourglass icon. Line: "A moderator steps in within 24 h at the most. Usually it's much sooner." The 48 h deadline is no longer shown. The old "A moderator usually replies within 4 h" on DisputeOpen is replaced by the same line.
- **Q63, offer card and profile:** "275.4 XMR traded to date". Design call: rounded down to one decimal, because it's a reputation figure and rounding down never overstates. Under 0.1 XMR, no line shows. Q64: imported volume shows as one line per site, "Imported from LocalMonero: 120.0 XMR". **New OPEN for the owner (ProfileVisibility):** does the "traded to date" total also include imported volume? Recommendation: no. X2F trades only, with each site on its own line.
- **Q24/Q25, a currency with no rate** (design's pick: show it, don't hide it): in the currency dropdown it stays in the list, greyed, can't be picked, with the tag "No rate right now". It comes back the moment a rate returns. Why: people see their currency exists and come back for it; hiding it looks like X2F dropped it.
- **Q28, currency list:** USD, EUR, GBP, CAD, AUD, JPY first, a divider, then the rest A to Z, every one with a flag. The boards draw flag placeholders; the build uses a vetted flag image set.
- **Q46, proof disclaimer** (SellerConfirm, Warn-Release): inside the existing caution callout, next to the box the seller ticks before releasing: "Screenshots can be faked, even a copy of X2F's own screen. Only your bank app shows whether the money arrived."
- **Q47, blur check** (SellerConfirm, under the proof): "Was this proof blurred correctly?" [Yes] [No]. After No: field "What was wrong?", helper "Help us improve the blur. Your note goes to the X2F team, not to the buyer.", button "Send". After Yes or Send: "Thanks. This helps us improve the blur." It's asked on every proof for the first months, then on every 10th to 20th.
- **Q67, daily limit** (Feedback): title "You've sent 10 today". Body "To stop spam, you can send up to 10 messages a day. You can send more tomorrow." Send is disabled. Tickets count across a vendor's team; feedback counts per member (Q69).
- **Q39, frozen account:** "A moderator froze trading on your account. Open your dispute to see what to do to get it back." (Use this wherever the frozen state shows: the My offers hold notice and the account notice.)
- **Q2/F2, empty payment instructions:** the owner's line stands: "Payment method chosen: Interac e-Transfer. Please post pertinent details in chat window." Design suggests a lighter edit for the owner to take or leave: "Paying by Interac e-Transfer. Ask the seller for the details in this chat."
- **BuyerPaidWaiting step 2:** "When they release, 1.250000 XMR goes to your wallet once your app co-signs. Keep this page open until it arrives."
- **BuyerPaidWaiting step 3** (F9, instant types 90 min): "If something goes wrong, you can open a dispute from 15:35 UTC, 90 min after you marked it as paid. A moderator checks the chat and proof, then decides." Button meta: "Available from 15:35 UTC · in 88 min".
- **Refunded:** "Open a dispute and add your payment proof. If the money reached satoshi_ghost, a moderator can rule that they owe you the 1.250000 XMR. Until they pay it back, they can't trade."

### Decided boxes recorded on the boards (no wording to sign)
Q12 (nothing tells the buyer to pay before escrow is fully in: BuyerPay, Desktop) · Q14 (changes apply on their own after 24 h; say "username and password": HoldChange, plus tweak names on Devices and SessionExtend) · Q15 (ban length by rule list, moderator's call until then: Ban-Notice) · Q16 (granular member types; **MemberPermissions needs a full redraw**, pending) · Q18 "of 5" (already drawn) · Q42/Q43/Q50 (ProofBlur).

### 7 Nov follow-ups (design's calls)
- **F5, the name: "My offers"** (design's vote). Reasons: the rest of the app already says offer ("Post offer" in the nav, "Post an offer", buyers browse offers, "3 buying and 3 selling offers"). Calling them "ads" or "listings" here would mean two names for one thing. "Posts" reads like social media. If the owner prefers "ads", it has to change everywhere, nav included.
- **F4, a currency with no rate on the vendor's list:** each offer card gets small currency chips with flags. A currency with no rate gets its chip struck through with a caution outline and a "signal off" icon, plus one line: "No rate for ARS right now. Buyers can't pick it until it's back." If no currency on the offer has a rate, the card shows "NOT LIVE · NO RATE" and "We can't get a rate for ARS, so this offer can't go live. It goes live by itself when the rate is back." Board work is in progress on MyOffers (+Wide, Fold); it comes in the next publish.
- **F10, nudge sound:** an original synthesized bulb-horn double honk ("hah-ONK", 0.62 s), made from scratch: no sample and nothing copied, so there are no rights issues. Files: `docs/design-assets/sound/x2f-nudge.wav`, `-soft.wav` (12 dB quieter), `.mp3`, plus `make_nudge.py`, which regenerates it and can be tuned. The owner should listen and say "keep", "more honk" or "softer".
- **F13, gift card rules:** plain-language draft in `docs/design-gift-card-rules-2026-11-07.md`. It covers a short block on each gift card offer, a 5-step list and a tick-box for the sender, a 4-step list and a tick-box for the receiver, and what the moderator looks at in a dispute. Four numbers are for the owner: a 30-minute redemption window, cards bought within 7 days, a short brand list at launch, and no partial-balance cards.
- **F1/F2/F6/F7/F8** (±% above or below, max 50; empty-instructions helper; currency, then payment type dropdowns on the ad; "2 of 3 selling offers used" in the builder): board work in progress on FlexOffer-Post (+Wide) and OfferAd (+Wide); next publish.
- **F18:** the Devices session length changes this session only. The Devices note will say so in the next publish.

## 7 Nov 2026: build review (5 Nov) re-checked against main 55bc70f9

How I checked: by reading the code on `origin/main` @ `55bc70f9` (apps/web), not from screenshots; there's no pack for this head. Anything that only shows when it renders is marked "check on the next pack". File references are relative to `apps/web/src/`.

### X1–X9

| Code | Now | Evidence on main |
|---|---|---|
| X1 orange selection | **PARTLY** | Closed: chips and segments (`browse.css:176-183`, `PostOffer.css:93-96` RadioChips, `Wallets.css:183`, `setup.css:294/378/401`), and ui `Checkbox` (`ui.css:1526` accent ink). Still orange: checkboxes in `screens.css:125-130` (.x2f-team__role), `setup.css:604-608` (.x2f-check), `pay.css:352-359` (.x2f-paid__check), `release.css:147-152` (.x2f-release__check), and the dispute reason radio dot `dispute.css:205`. |
| X2 CantDoThat shell | **CLOSED (code)** | MyOffers, Team and Chat all use `ui/CantDoThat` (`MyOffers.tsx:239`). Check 33 on the next pack. |
| X3 orange focus ring | **PARTLY** | Shared rules are ink. Still orange: `.x2f-input:focus-visible` (`screens.css:68-69`, monero-ink, offset 1), `dispute.css:208-209`, `quote.css:~222`. |
| X4 native controls | **OPEN** | `<fieldset>` + legend: `Team.tsx:42-56` ("Roles"), `Feedback.tsx:149-159` ("What is it?"). Native `<select>`: `Team.tsx:335` (log filter), `Security.tsx:100` (session length), `PostOffer.tsx:267/283/296/407`. |
| X5 dates | **OPEN** | Weekday or no-year formats: `screens/auth/refusals.ts:39` ("Fri 3:00 PM"), `screens/dispute/rules.ts:163-167` (`dayTime` "Fri 16 Oct, 10:14"), `screens/settings/teamCopy.ts:17-18` (no year), `Wallets.tsx:38`, `news-model.ts:52`, `settings/Alerts.tsx:79` (locale formats). |
| X6 invite expiry at the epoch | **CLOSED (code)** | `Team.tsx:247` guards null. The date itself still lacks a year (that's X5). |
| X7 mono timer spacing | **CHECK ON NEXT PACK** | `ui/Countdown.tsx` 'minutes' renders "47 h 58 min" in one `.x2f-countdown` span; if that span is mono, the units are mono too. |
| X8 centred "Time to pay" card | **CHECK ON NEXT PACK** | `pay.css:318-321` still centres a block. |
| X9 old hold wording | **OPEN** | `screens/auth/refusals.ts:73` and `ui/cantDoCodes.ts:383, 394, 405` still say "only one way of proving it's you". |

### Top five from the 5 Nov review

1. **Hold and Strong-login copy, RecoveryHold and TeamRefusal screens: OPEN.** There's no RecoveryHold or TeamRefusal screen on main, and the X9 strings are still there.
2. **One CantDoThat component: MOSTLY CLOSED.** The titles are still vague: `cantDoCodes.ts:203` "This can't be done on the team".
3. **X1/X3/X4 in shared parts: PARTLY** (see above).
4. **Dispute room and ruling: OPEN.** `DisputeRoom.tsx:61-67` shows two chips, no hero and no key mark. `rules.ts:146-151` `xmrInText` trims XMR to 2 decimals ("1.25"). Dates use `dayTime`. The new owner rule (Q38, hourglass from 24 h, no 48 h line) isn't built.
5. **Wide and fold My offers: PARTLY.** Fold panes are built (`MyOffers.tsx` uses `Panes`). The wide table is not (tripwire NEEDS_DESIGN_MYOFFERS, `MyOffers.tsx:15`). The Edit link waits for Task 35. Footer padding: check on the next pack.

### Open items as buildable tasks (one per line: screen · change)

- Team, Setup, I've-paid, Release confirm · checkbox `accent-color: var(--x2f-ink)` in `screens.css:130`, `setup.css:~608`, `pay.css:~359`, `release.css:~152`.
- DisputeOpen · reason radio: the dot is `var(--x2f-ink)` (`dispute.css:205`), and the selected row gets a 2px ink border on surface-raised.
- All forms · `.x2f-input:focus-visible { outline: 2px solid var(--x2f-ink); outline-offset: 2px }` (`screens.css:68`); the same in `dispute.css:208`, `quote.css:~222`.
- All forms · `.x2f-input` background `var(--x2f-surface-raised)`, `min-height: 48px`, `padding: 0 14px`; textarea `min-height: 96px; padding: 12px 14px` (also P1 of the proof pop-up review).
- Team · replace the "Roles" fieldset (`Team.tsx:42`) per the new owner model Q16 (member types with checkboxes). **Wait for the redrawn MemberPermissions board.**
- Team · log filter `<select>` (`Team.tsx:335`) → tiles or the shared listbox (no native select).
- Security · session length `<select>` (`Security.tsx:100`) → the SessionLength tiles (owner OPEN still: tiles vs drop-down; build tiles behind the same component so either can ship).
- Feedback · drop the "What is it?" fieldset (`Feedback.tsx:149`), per the Feedback board. Add the 10-a-day limit state (Q67, Feedback board `limit=reached`).
- Login refusal · `refusals.ts:39` date → `6 Nov 2026, 15:00 UTC` (mono).
- Dispute · `rules.ts:163` `dayTime` → `D Mon YYYY, HH:MM UTC`; `xmrInText` → 6 decimals.
- Team · `teamCopy.ts:18` add `year: 'numeric'`.
- Wallets, News, Alerts · replace locale `toLocaleString` with the shared UTC date formatter.
- Hold copy · `refusals.ts:73`, `cantDoCodes.ts:383/394/405`: replace "only one way of proving it's you" with "a username and password" (owner Q14 wording), per HoldChange and RecoveryHold.
- RecoveryHold · new screen per the RecoveryHold board; the 04 refusal links to it.
- TeamRefusal · new screen per the TeamRefusal board, replacing the 20 popup.
- CantDoThat titles · `cantDoCodes.ts:203` → "Only the owner can do this" (member) / "Needs a Strong login" (weak session).
- DisputeRoom · hero per the board (v119): chip + key mark; waiting state = hourglass countdown from 24 h with "A moderator steps in within 24 h at the most. Usually it's much sooner."; amount block 1.250000 XMR; drop the 48 h line.
- MyOffers wide · table layout per MyOffers-Wide (clears NEEDS_DESIGN_MYOFFERS); selection bar at the top of the column.
- LoginApprove "You're in" · add "Chrome on Windows is now one of your devices." (check that the board copy is still missing on main).

## 7 Nov 2026: design review of branches before landing (job 3)

Reviewed from code against the boards (canvas v119) and the v2 standards. Paths are relative to `apps/web/src/`.

### `wip/lead-hold-v3` @ `b0bc72c4`: ready after one P1
- **P1 · `ui/cantDoCodes.ts` teamCantDoText `weak-session`:** it offers "your username, password and authenticator code" as a way to invite members or change roles. Owner rule (handoff §4): an authenticator app isn't enough for team invites and permissions; only a passkey, security key or PGP key is. Fix: "Do this from a device where you logged in with a passkey, a security key or a PGP key." Rule source: owner, 1–2 Nov.
- **P2, rule check for the lead · `WEAK_SESSION_TEXT`:** the same "username, password and authenticator code" option for logging out stronger devices. TOTP counts for logging in but not for sensitive actions. Confirm with the owner whether logging out devices is sensitive. Design recommends yes, and the same fix as P1.
- **P2, rule check · `screens/auth/refusals.ts` heldNote:** "Logging in with a passkey, a security key or a PGP key you had before then cancels it." The hold decision (handoff §4) says such a key "approves the changes early" and "ending the hold that way discards them". The code says "cancels". Pick one with the owner; the copy must match what the server does.
- **P2 · `cantDoCodes.ts` holdLoginText:** still 7 sentences in a CantDoThat sheet. Board (04 / RecoveryHold): two sentences, "This device can log in after <date>. Your account is on a 24-hour hold." plus a "See the hold" link to the RecoveryHold screen.
- **P2 · X5:** `holdText(when)` still receives "until Tue 3:05 PM". It should be `6 Nov 2026, 15:00 UTC` in mono.
- **Good:** "username and password" replaces "only one way of proving it's you" throughout (owner Q14). The ConfirmSheet and wallets lines ("You have no passkey, security key or PGP key yet…") read well. COPY-UNSIGNED.
- **Open, no board change:** `counterpartyProblem` isn't shown yet; when it is, use the TradeTechIssue board.

### `wip/third-p4-task15` @ `c0d889a5`: ready after P1 and the hourglass
- **P1, rule check · `screens/Maintenance.tsx`:** it replaces the whole app. The Maintenance board shows "What still works: Trades already in escrow. You can release, refund or open a dispute as usual." Either the build or the board is wrong; the lead should confirm with the owner whether escrowed trades stay usable during maintenance (design recommends yes, as the board says). The comment also says "no board": there is one (Maintenance, Maintenance-Wide). Build it from the board: chip "Planned maintenance" / "Emergency maintenance", the headline, the owner's message with "From the X2F team · <date>", the start and end block (mono dates), "What still works", and the Get updates rows. "Check again" can stay as the one primary.
- **P2 · `screens/dispute/DisputeRoom.tsx` DisputeHourglass:** it's built as a small line. Board (DisputeRoom v119, `moderator=waiting`): the hourglass countdown is the hero's one big number. Label 13/16 uppercase danger "Until a moderator steps in"; digits mono 40/44 500, units body 18/24 600 ink-muted ("23 h 12 min"); hourglass icon 24px danger beside it; line 14/20 muted "A moderator steps in within 24 h at the most. Usually it's much sooner." The XMR amount moves into an inner block (28/32, 6 decimals). The "over" state is fine as built ("Taking longer than usual" / "A moderator will step in as soon as they can."). COPY-UNSIGNED.
- **P2 · DisputeRoom DeadlineLine:** "First reply due by Fri 16 Oct, 10:14 · You're number N in the queue" puts a second deadline next to the hourglass. Fix: drop "First reply due by…" while the hourglass runs. Keep "You're number N in the queue" as a 13/16 muted meta line under the hourglass (COPY). Dates: X5.
- **P2 · `DisputeRuling.tsx` TxProofForm:** "Send proof" is a primary. On the losing seller's ruling screen, "Send appeal" becomes the primary too once text is typed, so the screen can end up with two orange buttons. Fix: while a `seller-sends-xmr` payment is due, Send proof is the primary and the appeal button is secondary. Labels per v2 §11: 13/16 uppercase muted "TRANSACTION ID", "TRANSACTION KEY"; inputs 48h, mono, `surface-raised`.
- **P2 · X5:** `complyBy` and `replyDueAt` use `dayTime` (weekday, no year, no UTC).
- **P3 · DisputeOpen "Talk to <name> first" notice:** fine as a plain info callout. Use v2 §12 info (`surface-raised` background, `ink-muted` icon), and put "Go to the chat" on its own line as a 44px tertiary link. COPY-UNSIGNED.
- **P3 · `ui/SiteBanner.tsx`:** the titles "Info" and "Warning" add nothing; drop the title and let the message stand. Warning = caution callout, info = info callout.
- **COPY-UNSIGNED (owner):** "There is one appeal per dispute, and its decision is final." · "Prove you sent it" / "Your wallet shows the transaction ID and the transaction key once the XMR is sent." · "Send it by <date>." / "<name> has until <date> to send it." · Maintenance copy.

### `wip/lead-design-results` @ `e987d6b5`: not ready (8 P1)

**Verdict: not ready.** There are 8 P1s. The biggest is that the 90-min dispute rule never takes effect: it is computed but always overridden by confirmBy. The paid room and the Refunded screen also don't use the boards' hero block.

I checked every claim against `git show origin/wip/lead-design-results:<path>` and the v119 boards. Line numbers are on the branch.

##### P1

1. **The 90-min dispute rule never applies.** `PaidWaiting.tsx:73-78`: `disputeOpensAt = max(paid+90min, confirmBy)`. With Zelle's 2 h window, Open dispute only becomes available at confirmBy (16:05), not 15:35. The board's `after-wait` state (dispute available while 28 min are still left to confirm) can never appear.
   - The server blocks it too: `packages/trade/src/machine.ts:416` returns `too-early` for the buyer before confirmBy.
   - `screens/dispute/rules.ts:64-75` (`disputeEntry`) also waits for confirmBy.
   - **Fix:** the machine and `disputeEntry` should allow the buyer's dispute at `paidAt + per-type wait`, which is 90 min for instant types. Then `disputeOpensAt` should return `paid + DISPUTE_AFTER_PAID_MS`, with no `Math.max` against confirmBy. This needs an API change.

2. **Step 3 tells the buyer the wrong time.** `PaidWaiting.tsx:200-208` says "If they don't confirm by {confirmBy}, you can open a dispute." The board says: "If something goes wrong, you can open a dispute from `<mono>15:35 UTC</mono>`, `<mono>90</mono>` min after you marked it as paid. A moderator checks the chat and proof, then decides." Use `<When at={opensAt} form="time"/>` and the wait as a `<Duration>`. This depends on P1-1.

3. **The paid status card breaks the hero rule (standard 11).** `PaidWaiting.tsx:110-153`, timer at `:156-184`.
   - What's wrong:
     - The card is a plain grey `x2f-panel` with an `x2f-h2` headline (24px, "Paid · waiting for X to confirm").
     - There is no key mark.
     - The timer is a separate card.
     - The chip is `tone="escrow"` (teal) while waiting.
   - What the board has: one caution hero.
     - `padding:20px; border-radius:16px; gap:16px; background:linear-gradient(180deg, color-mix(in srgb,var(--caution) 14%,var(--surface)) 0%, var(--surface) 140px); border:1px solid color-mix(in srgb,var(--caution) 35%,transparent)`. On wide: padding 28px, gap 20px, 180px stop.
     - Row 1: the chip (caution, check icon, "Paid") with the three-dot key mark on the right (62×14 svg, two filled dots, the third an outline ring).
     - Then the lead as a `<p>` at 16/24, ink-muted, with no h1.
     - Then a 1px divider in caution 25%.
     - Then the timer, inside the same card.
   - **Fix:** drop the h1 (the page h1 stays "Buying from …"), use the caution tone in both states, add the key mark, and move the TimerCard content inside the hero.

4. **"2 hours" is written in words, breaking the duration rule.** `windowWords` at `PaidWaiting.tsx:80-85` is used at `:107/131/149/179`. It produces "up to 2 hours", "Their 2 hours to check…" and "Zelle gets 2 hours". The board has `<mono>2</mono> h`. **Fix:** render `<Duration ms={win.lengthMs}/>`. The nudge line at `:308`, "another in 10 min", also needs the 10 in mono: `<Duration ms={600000}/>`.

5. **The button label isn't the agreed term.** It reads "Open a dispute" at `PaidWaiting.tsx:318` and `:324`, and `Refunded.tsx:199`. The terms list (standard 10) and every board say **"Open dispute"**.

6. **The XMR unit has the wrong style (standard 7).** The digits should be mono and the "XMR" unit body 600 in `var(--monero-ink)`.
   - `PaidWaiting.tsx:198`: the whole `"1.250000 XMR"` is in `x2f-when` (mono).
   - `PaidWaiting.tsx:218`: the For row passes `xmr` as a string into the mono `dd`.
   - `Refunded.tsx:146`: the Trade amount row is one mono string.
   - `Refunded.tsx:189`: the number isn't mono at all (the board has it mono in ink).
   - **Fix:** use an amount component: `<span class="x2f-num">1.250000</span> <span style="font-weight:600;color:var(--monero-ink)">XMR</span>`.

7. **The Refunded screen has no hero.** `Refunded.tsx:159-165` has a loose chip, then an `x2f-h2` at 24px with the lead. The board's hero card:
   - Tone is ink-muted (mod for the moderator variant), with gradient 14% to 160px, border 35%, padding 24/20/20, gap 20.
   - Chip and key mark row.
   - h1 in Familjen 32/36 700, -0.02em.
   - Lead 16/24.
   - A raised `dl` with "TRADE AMOUNT": `1.250000` mono 28/32 500, then XMR 15/600 monero-ink, then `$412.50` mono 16 muted. Then the "X2F fee · None" row, 48px high.
   - **Fix:** move Trade amount and X2F fee out of "What happened" (`:144-150`) into the hero.

8. **News: an inset shadow and an orange header action.** I checked these against News.dc.html.
   - `ui.css:1766` gives `.x2f-post[data-new]` the shadow `box-shadow: inset 3px 0 0 var(--x2f-escrow)`. Standard 17 allows no box-shadow except the nav inset, and the board's new card is just `background:var(--surface); border:1px solid transparent`. Remove it.
   - `ui.css:1858`: `.x2f-header-action` ("Mark all as read", `News.tsx:155`) is orange `--monero-ink`, which breaks the colour rules. The board has a pill: `height:44px; padding:0 14px; border-radius:999px; background:var(--surface); color:var(--ink); font-weight:600`, with an 18px double-check icon.

##### P2

9. **No trade progress stepper in the paid room.** `BuyerPay.tsx:579-622`: neither the phone nor the wide paid branch renders the "Trade progress" stepper. Both boards show 4 bars (Escrow / You pay / Seller checks / Released) with "Seller checks" current and a caution fill.

10. **Wide layout order is wrong.** `PaidWaiting.tsx:245-255` puts the timer and Your payment side by side in a grid, then What happens next, with the actions at the very bottom (`BuyerPay.tsx:603`).
    - Board order: hero (timer inside), then the actions row (Nudge left, spacer, Open dispute right; under it the "Available from…" hint right-aligned and the no-cancel line), then What happens next, then Your payment. Remove `x2f-room__grid`.

11. **Phone footer order and sizes.** `PaidWaiting.tsx:299-334` puts Nudge first and the dispute at 48px.
    - The board puts the dispute first. Locked: a 56px button at 18px on surface-raised. Ended: the danger-outline at 56px/18px with a 14% wash.
    - So drop `data-size="medium"` on phone (`:317`) and keep it only on wide.
    - Locked hint copy: "Available from `<When form="time">` · in `<Duration>`", with no trailing period (`:329-330`).

12. **No soft dispute link for the after-wait state.** This state follows from P1-1. The board's `after-wait` shows "Open dispute ›" as a text link (danger 15/600, 44px, chevron 16) below Nudge, not the outlined button. Only the ended state gets the outlined button. `PaidWaiting.tsx:316-319` has a single style for both.

13. **Nudge button colour.** `PaidWaiting.tsx:300` with `ui.css:2125` turns the whole button caution-coloured. The board has ink text, a `var(--line)` border, and only the bell icon in caution. **Fix:** remove `data-tone`, and colour `.x2f-button--secondary > svg` caution here.

14. **Nudge sent state.** `PaidWaiting.tsx:299-310` keeps the button and adds a 13px footnote. The board hides the button (`canNudge:false`) and shows a status row instead: escrow check icon 18, 15/22 muted, min-height 48, centred. This conflicts with review N1, which kept the button on purpose; the owner or design needs to pick one.

15. **Timer size.** `TimerCard.tsx:42-54` and `ui.css:2079/2098`.
    - Board digits: 40/44, mono 500, -0.02em. Units: 18/24 600 ink-muted. Built: digits 28px; units weight 400 and not muted.
    - Board ring: 64px, r=27, stroke 5, track in the tone colour at `stroke-opacity:0.2`. Built: 56px, r=24, stroke 6, track surface-raised.
    - Board hint: 14/20. Built: 13/18.

16. **"Your payment" box.** `PaidWaiting.tsx:226` and `ui.css:1076`: the `outline` prop gives a transparent box with a border. The board has `background:var(--surface)` and no border, so drop `outline`.
    - The board's rows (`:238`, `ui.css:1701`) sit in a raised `dl`: `margin:0 20px 20px; border-radius:12px; background:var(--surface-raised)`, rows `min-height:48px; padding:0 14px`, surface dividers between them, values mono 15/500. Built has no box and 14px values.
    - On wide the board lays this out as a 2-column grid.

17. **"Payment proof" row missing.** `PaidWaiting.tsx:215-220` has no "Payment proof" row ("1 screenshot, blurred"). The board's design call says it stays, and reads "Add payment proof · optional" when there is none.

18. **Refunded back link goes to the wrong place.** `Refunded.tsx:157`: `backTo="/buy"`. The board's back control is "Back to trades", so use `/trades`.

19. **Refunded footer is missing a link.** `Refunded.tsx:212-216`: there is no tertiary **"Back to my trades"** under "Find another offer". Board: 44px, ink-muted 15/600, centred.

20. **"What happened" is plain rows, not a timeline.** `Refunded.tsx:166-178`. The board has a timeline:
    - A 12px dot per row: a 2px `--line` ring for each row, the last one filled in the tone colour.
    - A 2px surface-raised connector between dots, 16px between rows.
    - The last row at 600.
    - The date sits on the right of the heading (mono 13 muted), not appended as " · date".
    - Card: padding 20, radius 16, gap 16.

21. **The moderator variant doesn't match.** `Refunded.tsx:76-82`.
    - Board headline: "A moderator decided the dispute". Lead: "Moderator {name} ruled for {seller}…".
    - Board rows include "Moderator ruled".
    - The hero is `--mod` toned, with a "The moderator's reason" card (mod 8% / 40%) and a 48px outline "Read the ruling and appeal".
    - Built shows "Refunded by the dispute decision" and, through `entry.kind==='opened'`, a "Go to the dispute" button (`:203-209`).

22. **Owner call: buyer-cancelled dispute card.** `rules.ts:84-86` hides the card for a buyer's own cancel (owner, 29 Oct, question 4). The v119 board shows it, titled "Did you pay before you cancelled?". The owner and design need to settle which one wins before this ships.

##### P3

23. **Small Refunded mismatches.**
    - Chip (`ui.css:128`): the board's muted chip has ink text on an ink-muted 16% fill; built is ink-muted text on surface-raised.
    - Dispute card (`Refunded.tsx:180-201`): the board uses a row layout with a 40px icon tile (escrow 14%, radius 12). Built puts the icon inline in the h2.
    - The link uses `.x2f-button--danger` at weight 400; the board has 15/600.

24. **Steps list and chat link styling.** `ui.css:1712` (`.x2f-steps`) uses default decimals with gap 8. The board has 24px numbered circles (surface-raised, mono 13/500), list-style none, gap 12.
    - `ui.css:2107`: `.x2f-inline-action` is underlined at weight 400; the board has no underline, 600.
    - Step 1's amount (`PaidWaiting.tsx:193`) should be `<strong>` in mono 500, not bold body text.

25. **COPY (owner signs).**
    - `PaidWaiting.tsx:131`: the ended line reads "Their … ended at 1 Nov 2026, 16:05 UTC". The board has "satoshi_ghost's 2 h to check Zelle ended at 16:05 UTC".
    - `PaidWaiting.tsx:146`: the board says "at 14:05 UTC" (time only).
    - `Refunded.tsx:100` (buyer-cancel lead): the board says "All 1.250000 XMR in escrow (about $412.50) went back to satoshi_ghost. X2F took nothing from you. If you already sent the payment, open a dispute below."
    - `Refunded.tsx:93` (time ran out): the board says "You didn't tap I've paid within the 90 minutes, so satoshi_ghost cancelled. Everything in escrow, 1.250000 XMR (about $412.50), went back to satoshi_ghost."
    - Row labels: the board's buyer-cancel rows include "You cancelled", which built lacks. The board has "Refund confirmed" where built has "{N} confirmed it arrived" (`:128`).
    - `Refunded.tsx:191-196`: the extra line "You can open one for 48 hours…" isn't on the board.

What matches: the Refunded dispute body copy follows v119, apart from the mono number in P1-6. Step 2's wording matches v119. The disabled dispute uses aria-disabled on purpose for focus. The SellerCancelConfirm date change uses `<When>`, and no board covers that screen. I found no email, no dashed borders and no orange selection in the changed screens.

### Design follow-ups from today
- **F10, nudge sound:** the owner's pick replaces design's synthesized honk: Freesound 480002 (craigsmith, CC0), an old "Ahooga" horn, 1.84 s (`assets/sound/x2f-nudge-ahooga.wav` and `-soft` on comms). I removed my synthesized files from `docs/design-assets/sound`. BuyerPaidWaiting (+Wide) now carries the decision, and "You can send another in 15 min" (F10: once every 15 minutes). Canvas v121.
- **v120:** the MyOffers (+Wide, Fold) "no rate" state (F4): currency chips; one off = a struck chip plus "No rate for ARS right now. Buyers can't pick it until it's back."; all off = "NOT LIVE · NO RATE" plus "We can't get a rate for ARS, so this offer can't go live. It goes live by itself when the rate is back.". FlexOffer-Post (+Wide): Above/Below market plus a typed % ("Up to 50%." / "Set 50% or less."), the empty-instructions helper, and "2 of 3 selling offers used". OfferAd (+Wide): Currency, then PAY WITH dropdowns; the list of ways to pay is folded into the dropdown. Devices (+Wide): F18 note. All new lines are COPY-UNSIGNED.
- **Open, design's call next:** the per-payment-type price change on FlexOffer-Post still uses a ± stepper. For one pattern, design will switch it to the same Above/Below plus typed % (max 50%) unless the owner objects.
- **Queued:** the MemberPermissions redraw for Q16 (member types with checkboxes).

## 7 Nov 2026: canvas v122 (Q16 member types; per-payment-type price)

**MemberPermissions (+Wide), redrawn for Q16.** Four member types, each a card with an on/off switch and its own checkboxes: Chat (7), Offers (8), Trades (9), Records (7). A member can be in any number of types. A type that's switched off keeps its ticks but they don't count. Release XMR is marked SENSITIVE: ticking it shows a caution line and asks to confirm first, per the earlier owner rule (2 Nov). Tweak `example`: offers-and-chat / everything / trades-with-release. The 31 checkbox labels are design's proposal for the owner.

**COPY-UNSIGNED (owner):**
- "Member types" · "Switch a type on, then tick what desk_ana can do in it. A member can be in one type, several or all four." · "In 2 of 4 types · 9 of 31 things allowed" · "5 of 7 allowed" / "Off · 2 of 7 ticked" · "Switch on Records to use these. Your ticks are kept."
- "They can send XMR from your escrow. Only for someone you trust fully."
- "Never available to members: wallets, security, sessions, team settings, account type and deleting the account."
- "Saving needs your passkey, security key or PGP key. With just a username and password, the change waits 24 h."
- Sheet: "Let desk_ana release XMR?" · "They can send XMR from your escrow to finish trades. Only for someone you trust fully." · "Allow releasing XMR" / "Keep it off" · "Use my PGP key".
- The four type names and the 31 labels:
  - Chat: Read trade chats, Reply in trade chats, Send payment details in chat, Upload proof in chat, Nudge the other trader, See the trader's profile notes, Block a trader.
  - Offers: See all offers, Turn offers on or off, Edit prices, Edit amount bands, Edit payment types and instructions, Edit currencies, Post a new offer, Delete an offer.
  - Trades: Accept a trade, Decline a trade, Mark "I've paid", Confirm payment received, Release XMR, Ask to cancel, Open a dispute, Reply in a dispute, Leave feedback.
  - Records: See trade history, Export trade history, See team activity log, See payout amounts, See reviews, Reply to reviews, See support tickets.

**For the owner, with design's recommendation:**
- Should the "never available" list also name holds? Recommendation: yes. "Never available to members: wallets, holds, security, sessions, team settings, account type and deleting the account."

**FlexOffer-Post (+Wide).** Each payment type's price change is now "Above market" / "Below market" / "Same as band", plus a typed % (max 50%), the same as the bands. New copy: "Price with Zelle" · "Same as band" · "Fix the field marked in red to post this offer." (was "…the band marked in red…").

## 7 Nov 2026: canvas v125, final nudge sound

BuyerPaidWaiting (+Wide) notes now name the final sound: the real two-blast "Ahooga", 3.64 s (first blast sped up at the same pitch, second at its original speed, nothing stretched; superseded figures removed in v125), `assets/sound/x2f-nudge-final.wav` and `-soft` on comms, Freesound 480002 (CC0). It replaces the 1.84 s cut; to cut from the original WAV before launch.

## 7 Nov 2026: pictures for the owner (G1, G38)

**G1, the screen after "I've paid"** (picture: `docs/design-shots/2026-11-07/g1-buyer-paid-waiting.png`; left: right after paying, right: once the dispute wait has passed). What the buyer sees, top to bottom:
1. Header "Buying from satoshi_ghost"; progress bar on "Seller checks".
2. A yellow card: "PAID". "You marked this trade as paid at 14:05 UTC. satoshi_ghost has been told and has up to 2 h to check Zelle and release." Under it, a big countdown "1 h 58 min" with a ring.
3. "What happens next", three steps: (1) the seller looks for $412.50 with the memo K7M2-…; (2) "When they release, 1.250000 XMR goes to your wallet once your app co-signs. Keep this page open until it arrives."; (3) "If something goes wrong, you can open a dispute from 15:35 UTC, 90 min after you marked it as paid. A moderator checks the chat and proof, then decides."
4. Buttons: "Open dispute" (greyed until 15:35, with "Available from 15:35 UTC · in 88 min"), "Nudge satoshi_ghost", and "You can't cancel after marking as paid."
The words to sign are steps 2 and 3. The rest was signed before or is unchanged.

**G38, what tapping or hovering over a badge does** (picture: `docs/design-shots/2026-11-07/g38-badge-visibility.png`). Each badge (Trusted, Fast, Clean record…) has its own setting:
- **Featured:** always shown on your offer card next to your name (up to 2).
- **Middle option:** not on the card. A small "+2" shows instead, and a buyer taps it (phone) or points at it (desktop) to see those badges, each with one line on what it means ("Fast: replies in about 4 min on average.").
- **Hidden:** nobody sees it, and there's no "+2".
- **Design's recommendation:** keep the middle option and call it **"When tapped"** (it works on both phone and desktop), helper "Shows when someone taps the +N on your offer." Or, if the owner prefers fewer choices, drop it.

## 7 Nov 2026: canvas v126 (badges proposal, session dropdown, link hover)

**Badges, design's proposal** (new board "Badges"; pictures `docs/design-shots/2026-11-07/badges-night.png` and `badges-day.png`). The owner liked tap/hover showing more and asked design to make the card and badges look like part of the site. What's new:
- **Seals.** Each badge is a small rounded seal, coloured by family: reputation (Trusted, Clean record, Veteran) in escrow teal; speed (Fast) in caution amber; security (PGP verified, Security key) and milestones (100 / 500 trades, with the number as the glyph) in ink; New in muted. Orange stays for actions only.
- **Chips on the card.** A 30 px chip: the seal, then the badge name in sentence case, on surface-raised with a thin border in the family colour. Badges no longer look like status chips.
- **Trader block on the offer card.** Avatar with an online dot (teal ring when Trusted), name with a small Vendor tag, "Online · replies in about 4 min", three stat tiles (trades, % positive, XMR traded), then up to 2 featured badges and "+3".
- **Tap and hover** (G38 middle option). Phone: tapping "+3" or a badge opens a sheet listing all visible badges, each with what it means and when it was earned. Desktop: hovering opens the same list in a small card under the pointer.
- Badge names, meanings and dates are examples (COPY-UNSIGNED). Once the owner likes it, design applies it to OfferAd, BuyOffers/SellOffers, Profile and BadgeSettings.

**Session length (G23–G25):** SessionLength (+Wide) and Devices (+Wide) now use a dropdown with nothing pre-selected. Traders get 2/4/8/12 h, vendors 2/6/12/24 h, and a new choice counts from now. Signup no longer asks for a session length (SignupSecurity +Wide). SessionExtend notes now list 2/4/8/12. New copy: field "Stay logged in for", empty "Choose a length".

**Link hover (G40):** every board's link hover rule is dark ink. Known gap: on 17 boards some links set their colour inline, which overrides the hover. The build should put link colour in CSS, not inline. The design follow-up is to move those inline colours into the shared rule.

**Still in progress:** Ban-Notice wording (G39), no-date warnings (G16), cancel wording (G2), the hold before-and-after review (G29).

## 7 Nov 2026: canvas v127 (G39 ban, G16 no date, G2 cancel, G29 hold review)

All new wording is COPY-UNSIGNED.

**G39, Ban-Notice (+Wide):** site ban headline "Your account has been banned"; lead "We're sorry. If you think this was a mistake, message a moderator on Matrix or Telegram and ask for the details." Trade ban: "We're sorry. Your account can't start or join new trades. If you think this was a mistake, message a moderator on Matrix or Telegram and ask for the details." The contact card is now just "Think this is a mistake?" and the two rows, so nothing is said twice.

**G16, no readable date** (`date` tweak):
- ProofBlur (+Wide), poster: caution callout above Send. Title "We couldn't find a date", body "Neither the photo's data nor the screenshot shows when it was taken. You can still send it. The seller will see this too, so a screenshot with the date showing is better." Send stays enabled.
- SellerConfirm, seller: check line "No date found on this screenshot". Callout "We can't confirm when this screenshot was taken. That doesn't mean it's fake: check your bank app before you release."

**G2, cancel:**
- CancelRequest (+Wide), buyer after escrow: "Cancelling sends all 1.250000 XMR back to satoshi_ghost. The trade closes when the refund has all 10 confirmations." This replaces "Your 1.250000 XMR in escrow goes back… You can't undo this."
- SellerRefund, structure fixed: the old board let the seller cancel as soon as the payment window ended, which broke the owner's rule. Now it's locked until 90 min and one nudge. Locked: Nudge is the primary, "No word from mira.k? After 90 min and one nudge, you can cancel and get your 1.250000 XMR back." Available: "Cancel and get refund", "You can cancel now. Your 1.250000 XMR goes straight back to your wallet." Other new lines: "Nudge mira.k, or give them more time.", "Nudge again", heading "If mira.k paid after all".
- The pre-escrow line "Cancel now. Nothing has been sent yet, so nothing needs refunding." is ready, but no board shows a pre-escrow cancel yet.

**G29/G5/G36, HoldChange (+Wide), redrawn as "Review your changes":**
- Every pending change is grouped (Login methods, Wallets, Team) with Before | After side by side, each with a badge: "Applies after 24 h", "Takes effect now · final in 24 h", "Usable after 7 Nov 2026, 15:00 UTC", "Access ends now · final in 24 h". A count line reads "4 changes · up to 20".
- Username and password: callout "Applies after a 24 h wait. You logged in with just a username and password. Removals take effect now and become final after 24 h. Everything else applies after 24 h. Anyone logged in can cancel during the wait." Encouragement: "Add a passkey, security key or PGP key and changes like these go through at once." with "Add one". Primary "Submit changes".
- Strong login: "Your login is strong, so these apply as soon as you confirm." and "Confirm changes". After submitting: "Removals have taken effect. Everything becomes final after 24 h." Cancel sheet: "Removed wallets work again and removed team members get their access back. Nothing else changes."

**For the owner, with design's recommendation:**
1. Removing a passkey or other login method with username and password: does it also "take effect now, final in 24 h" like wallets and team (G5 names only those two)? Recommendation: no. A login-method removal waits 24 h, so a stolen password can't strip the owner's own keys at once.
2. Cancelling during the wait restores removed wallets and members (assumed from "not permanent until the 24 h is up"). Recommendation: yes, as drawn.
3. SellerRefund: do the 90 min run from escrow funding? Recommendation: yes, from when escrow is secured.
4. CancelRequest's 2 Nov note says "No cancel after I've paid". With G2 (the buyer may cancel after escrow), recommendation: the buyer can cancel after escrow but not after tapping "I've paid", which is unchanged.

## 7 Nov 2026: design's calls on G41–G60

**G41, XMR colour.** I sampled the official symbol from getmonero.org/press-kit: Monero orange is **#FF6600** (grey #4C4C4C).
- Night: the primary button fill, the XMR unit and links all become #FF6600.
- Day: the button fill becomes #FF6600 (dark text on it reads fine). Orange *text* (the XMR unit, links) stays the darker #B84A00, because #FF6600 on white is only about 2.9:1 and fails legibility for small text.
- I'll apply this to every board and the design system once the polish pass lands. This is the "unless design changes it" case, for legibility on white only.

**G42, active Buy/Sell tab:** yes. A 2 px ink border on surface-raised, the same as every selection in the app; never orange.

**G43:** keep the disabled button (surface-raised fill, muted text, no outline) and the sheet title (Familjen 24/30 700) everywhere.

**G44, offers screens, what to build and in what order:**
1. the market price card;
2. per-method icons (the 40 px icon tiles);
3. section counts (mono);
4. the empty-search state (the shared empty-state mark: 56 px tile with two small blocks, title, one sentence);
5. the Site news link (the bell with the unread dot in the header);
6. **Don't build the "Deposit required" row:** X2F takes no deposits, and that board line is out of date.

**G45:** no blue information note. Blue belongs to team members only. Information callouts are the neutral style: surface-raised, muted icon, ink text. Icon buttons use radius 12, as on the boards.

**G46, Devices wording:** please send me the five items (the build's list), and I'll write them. The owner shouldn't be needed unless one of them is a rule.

**G47, folding phones:** research is under way (Pixel Fold, Samsung Z Fold and Z Flip, OnePlus Open, Honor, Vivo, Xiaomi, Huawei, Motorola razr, Surface Duo; Apple has no shipping foldable). The note will cover Back gestures, layouts, and what a web app can detect (screen segments and posture, not the brand). New boards follow only where a device really behaves differently.

**G48:** the fold label waits for the final fold boards, which are in the polish pass now.

**G50–G53, gift cards:** `docs/design-gift-card-rules-2026-11-07.md` is updated: 45 minutes to check, cards bought in the last 30 days, video proof (log in, show the card, then send), full value only except range cards, and range cards always need the video. Draft brand list for the owner to edit: Amazon, Apple, Google Play, Steam, Visa prepaid, Mastercard prepaid, Walmart, Target, eBay, Razer Gold.

**G54:** ProfileVisibility's OPEN box becomes DECIDED (X2F trades only; imports on their own lines).

**G56, final-decision warning** (replaces Refunded's dispute card). Wording for the owner to sign, on the buyer's Cancel confirmation:
- Title: "Cancelling is final"
- Body: "The 1.250000 XMR goes back to satoshi_ghost and this trade closes. Don't send any money after you cancel. If you've already paid, don't cancel: tap I've paid instead."
- Refunded (buyer cancelled) loses the "Did you pay before you cancelled?" card.

**G57/G58, approval view:** HoldChange gets a "Changes waiting for you" state for a strong lead. It shows the same before/after list, a countdown (23 h 12 min) and three actions: **Approve now** (primary), **Make changes**, **Cancel all**. Team kick-outs show "Logged out now · removed in 24 h"; other team changes show "Applies after 24 h".

**What I need from the owner:** sign-off on the G56 wording above and on the gift card brand list. Nothing else is blocking me.

## 7 Nov 2026: craft pass published (canvas v128), all 132 boards

Canvas https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH is v128: every board carries the craft pass (brief `design-craft-brief-2026-11-07.md`), the cohesion review (three parallel reviewers, ~70 boards changed), Monero's true orange #ff6600, and the owner's G54/G56/G57/G58 boards. Boards and canvas.json are in `docs/design-boards/`; final renders were checked night and day; every board passes check-board.js and no variant clips. Canvas layout was re-banded (Main is now 6473 px tall with the full method list), so the sections sit further apart; section notes moved with them.

**Head-designer decisions (visual, no owner sign-off needed)**
- One cast, one set of facts everywhere: satoshi_ghost 1,284 · 99.4% · 275.4 XMR (Trusted + Fast +3); mira.k 212 · 99% · 41.7 (PGP verified featured, +3: Fast, Security key, 100 trades; no ring); nightowl_44 58 · 97% · 12.6; kettle.moss 96 · 98% · 31.2; lowtide_rx 12 · 100% · 2.9 (New).
- Trusted's meaning is now "500+ trades and 98%+ positive" (was 100+), so mira.k's numbers no longer contradict her lack of a ring. Badge meaning only; the product rule is yours and the owner's to confirm. COPY-UNSIGNED.
- Market price $329.90 / XMR on every list, quote and ad (OfferAd, Badges fixed). The example trade's locked rate stays $330.00 → $412.50 on the 38 trade boards: a locked rate is a trade-time fact, not the market.
- Badge chips and "+N" are 44 px transparent buttons everywhere, including the Badges reference and `gen/badges.py`.
- "Settings" 13/16 context line above every settings sub-page title (phone and wide). Wallet's Back now goes to Settings.
- Kits adopted as shared: trader card, recipient row, offline card, parties strip, evidence tile, chat message, decided-by row, setup stepper, rating chip, done_state, team kit, KPI cell, the one empty-state mark. Avatar/icon tiles on a raised block use a surface fill. ProofBlur's dashed on-image marks stay. Frame floors 844/800 stay.
- X2F support staff are drawn neutral ("X2F team" tag, ink avatar); `--team` is reserved for a vendor's team. TeamChat's partner view draws the member as a `--team` people-icon avatar (no name).
- Per-variant root heights everywhere (no empty bands).

**COPY-UNSIGNED (new or changed visible words, for the owner)**
- Team / Team-Wide: "Everything allowed" description is now "Every permission." (was "Every permission except the ones coming later.", which contradicted MemberPermissions' 31).
- Team totals "of 19" → "of 31" (TeamRefusal, MemberApproval, Team).
- Trusted badge meaning: "500+ trades and 98%+ positive".
- Support / Support-Wide: headline "Ask a team member" still says "team member" for X2F staff; now that "team" means a vendor's team it may need rewording. Not changed; your call to raise.
- ProfileVisibility (G54): "Counts X2F trades only; imported volume shows on its own line." / "Imported from LocalMonero: 120.0 XMR" / "Your X2F total so far".
- CancelRequest (G56): your wording, as sent. Refunded's lead loses "If you already sent the payment, open a dispute below."
- HoldChange (G57/58): "Changes waiting for you" / "Submitted with just a username and password. Your login is strong, so you can decide now." / "Time left" / "Submitted by" / "Apply on their own" / "Logged out now · removed in 24 h" / "Removed now · final in 24 h" / "If you log in with a passkey, security key or PGP key you had before the hold, you see these changes waiting and can approve them now, make changes or cancel all."
- Badges board: "Prices are examples at a $329.90 / XMR market" (design note only).

**G47 foldables**: research note `docs/design-research-foldables-2026-11-07.md`. Apple's iPhone Duo is a book fold (cover 382 CSS px, inner 669/951). Android Back is an edge swipe from either side, unchanged when unfolded; no system Back on iPhone. Design by screen shape, not brand: the existing phone / two-pane / tabletop Fold boards cover it; every screen keeps its own Back control, sheets are history entries, no edge-swipe confirms. No new boards needed; no per-brand boards (G48 closed).

**Build follow-ups (1)–(3)**: pushed as `wip/design-build-followups` @88a6eb63 (READY), branched from wip/third-design-build since main didn't carry it yet; it rebases cleanly once that lands. Web tests 86 files / 1226 pass, tsc clean.

**Needed from the owner**: G56 wording sign-off; the gift card brand list; the four questions above (login-method removal 24 h wait; cancel during the wait restores removed items; seller's 90 min from escrow secured; buyer cancel window); the COPY-UNSIGNED list here; G46 Devices wording items.

## 7 Nov 2026 (late): jobs 3a and 3b on the canvas (v130)

- **3a, SetupTerms (p4-5, p4-6):** the key-points list ends with one new line, "An account idle for 60 days is closed, to keep X2F safe for active traders." Drawn like the six rows above it. No warning anywhere else; DECIDED aside notes that an open trade or dispute pauses the clock. The phone frame was already full, so the terms scroll box is shorter (about 2.5 lines before scrolling); it fits exactly. COPY-UNSIGNED: that one sentence.
- **3b, ruling fees (g63):** a shared "fee row" (one more row in the ruling's inner block: percent glyph, "Fee:" in 600, digits mono) on DisputeRuling, Appeal-Notice (+Wide) and Lien-Notice (+Wide), with the line chosen by state. DisputeRuling gained a refund variant so both fee lines can be seen. COPY-UNSIGNED, one per state: "Fee: 1% paid by satoshi_ghost, as the offer poster." / "Fee: none. Everything went back, so X2F charges nothing." / "Fee: waits until the appeal is decided." / "Fee: 1% paid by you, as the offer poster." (Lien) / "It appears on your profile as a lost dispute." (DisputeRuling refund).
- Sweep fix from the owner's request for my own eye on every board: TeamChat's header meta no longer wraps into the "Draft copy" tag (v129).
- Head-designer decision: the fee row is now a shared component (results kit).

## 8 Nov 2026: jobs 3c, 3d, 3e on the canvas (v131)

- **3c, waiting changes (g65), HoldChange + Wide:** the approve step is the one view: every waiting change as before → after → effect, each with a tick (all on by default; unticked rows dim and read "Won't apply"; Approve now applies only ticked rows; nothing is restored). Effect lines carry the countdown in mono ("Applies in 23 h 12 min", "Logged out now · removed in 23 h 12 min"). Button is now "Cancel all changes"; its confirm says "None of these changes will apply." Tweak `instant` shows the same view for a strong login: "Applies now" instead of the countdown, primary "Apply changes". COPY-UNSIGNED: "Cancel all changes", "None of these changes will apply.", "Ticked to apply", "Won't apply", "Applies in …", "Removed now · final in …", "Logged out now · removed in …", "Usable in …", "Applies now", "Apply changes", "Strong login".
- **3d, team permissions (p4-8), MemberPermissions + Wide, Team, TeamRefusal, MemberApproval:** fifth type "Holds and waiting changes" with "See waiting changes", "Untick or cancel waiting changes", "End a hold"; off by default; line "Without these, desk_ana only sees that a hold is on." Total is now 34 everywhere (was 31). Footer line "Members can't use a stronger login than the team lead's." No member-side "a hold is on" view exists on any board; not invented, flagged.
- **3e, password change hold (g64), Settings + Wide:** tweak `passwordChanged` shows the result card "New password from 8 Nov 2026, 15:00 UTC" / "Your old password works until then. If you didn't make this change, log in with it and cancel." Removing a team member's login method is noted in the aside as a team change held 24 h.
- **Head-designer decisions:** the effect line with countdown and the per-change tick become shared (account kit).

**Needs the owner (contradiction):** G57 says a removal (wallet, team member) takes effect at once and is final after 24 h, while g65 says an unticked change never applies so nothing needs restoring. On the approve view a removal row still reads "Removed now · final in …" yet can be unticked. Either removals in the waiting list are deferred too (then the row reads "Removed in 23 h 12 min"), or unticking a removal does restore. Design's recommendation: defer them, one rule for every waiting change.
