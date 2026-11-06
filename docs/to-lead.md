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
