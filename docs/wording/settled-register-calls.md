# Settled design calls from the owner-answers register (19 ids)

Design, 12 Nov 2026. The owner ruled (10 Nov) that design settles wording and design calls, and design's answers count as signed. These are the final answers for the 19 register rows the lead listed on 12 Nov (LEAD-MSGS item 3). Every new or changed string is **COPY-UNSIGNED** until the owner reads it. The owner's own words are kept as close as possible.

Checked against: the register rows and the rows they cite; design's J-34 rulings, the build specs (j31a, j31b, j33a, staff2, fix3), to-lead.md, the audit and the boards; the owner's raw answers on origin/comms; origin/main 6ebed537 and the open branches named below (`git grep`). This file agrees with docs/wording/settled-batch10-12.md (w10-31, w10-97, w10-98, w10-104, w11-54). Where it extends one of those rows, it says so.

**OWNER items: none.** None of these 19 calls changes what the app does, costs or risks beyond what the owner already ruled. Two notes go to the lead instead (S-111 mechanism, S-015 authenticator-only tier).

## One line per id

| id | final answer | board |
|---|---|---|
| O-021 | The Q25 pop-up is replaced. A currency with no rate stays in the list, greyed, with a "No rate right now" tag, and can't be picked. Tapping it shows one short explainer. | Main, BuyMain [currencyMenu no-rate-tapped] |
| O-022 | My offers: a single-currency offer with no rate gets a "Can't go live" chip and stays paused. On a multi-currency offer, that currency's chip is struck through and marked "Not available". | MyOffers, MyOffers-Wide, Fold-MyOffers [rate] |
| O-023 | The screen is called "My offers" (design's vote out of the owner's four). Already built. | MyOffers (+Wide) |
| O-035 | Every button that starts a trade reads "Request to buy XMR" or "Request to sell XMR". Three lines that say "tap Trade" follow it. | BuyQuote, SellQuote (+Wide), BuyOffers, SellOffers, OfferAd |
| D-020 | Ban notice. Site ban: "Your account has been banned" with the owner's apology. Trade ban: "You can't trade right now". Moderator contact on Matrix or Telegram. | Ban-Notice (+Wide) |
| D-046 | Staff first-login welcome, shown once after the Terms step. Three cards: role, pay (clock out), appeals and clawback. | StaffLogin [stage welcome] |
| D-071 | While a seller's cancel refunds, the dispute room says "The seller has cancelled this trade. The XMR has begun refunding back to their wallet." with "Network confirmations 3 of 10". | DisputeRoom [escrow refunding] |
| S-015 | Signup strength panel per tier (Weak / Strong / Armored vault!), plus a fake-rock recovery tip. A weak login confirms in a sheet before going on. | SignupSecurity (+Wide); **board needed** for the weak-login confirm sheet |
| S-025 | The recovery-hold message keeps the owner's words: a 24-hour hold, the security team reviews, Matrix or Telegram, and Jabber if set up. One wording everywhere. | RecoveryHold (+Wide) |
| S-111 | "Your old recovery code is burned", then "Make a new recovery code" (in Security settings). Same as w10-97/98. | RecoveryCode (+Wide) [reminder], Login-Backup (+Wide) [ready] |
| P-011 | Uploader: a "Before you send" box plus a "How proof is checked" link. Seller: "Screenshots can be faked" with one line under it. | ProofBlur (+Wide), SellerConfirm, Warn-Release |
| P-030 | Buyer paid less: the trade never changes on its own. The seller sees a "talk first, then release or dispute" note and a matching tick. | SellerConfirm [situation short], Warn-Release (+Wide) [amount short] |
| G-003 | Yes. The active Buy/Sell tab has a 2 px ink border on surface-raised. Already built as drawn. | Main, BuyMain |
| G-004 | Keep. Disabled = surface-raised fill, ink-muted text, no opacity, with a reason line. Sheet title = Familjen 24/30 700 with a grab handle. Already built. | every board |
| G-005 | Build all of these: market price card, method icon tiles, section counts, Site news link and the empty-search heading. The Deposit row is dropped. | Main, BuyMain, SellQuote |
| G-006 | Yes. The info note turns blue (escrow tint). Icon buttons are 44 px with radius 12, no border in headers, and a 1 px line border only next to a field. | BuyQuote, Main (notes); every header |
| G-008 | Detect the posture, not the model. Back arrow on every unfolded screen. One layout per posture. Mostly built. | Fold-Cover, Fold-Offers, Fold-Trade, Fold-MyOffers, Fold-Tabletop, Fold-TriFold |
| G-013 | The Support headline is "Ask an X2F staff member". | Support (+Wide) |
| G-025 | One page in the owner's order: Terms, terms tick, Site rules, rules tick, signature, then "Continue creating your account". | SetupTerms; StaffLogin [stage sign] (Terms only) |

---

## O-021: the "no rate" pop-up (Q25, with O-020 / Q24)

**Already decided (design, J-32, spec-j31b "Main and BuyMain"):** tag the currency, don't hide it. Q24 replaced the Q25 pop-up: a currency with no rate can't be picked, so a buyer never reaches a Trade tap on it. Settled here, with one wording for the explainer (fixed choices: the board had two sentences saying the same thing).

Strings (COPY-UNSIGNED):
- Tag on the greyed row (browse currency menu): "No rate right now"
- Tag in the Post an offer picker: "CAD · no rate right now" (w10-31, unchanged)
- Explainer title (tap on the greyed row): "No rate for ARS right now"
- Explainer body, also used as the search hint line when a search matches only greyed currencies: "We can't get a market price for the Argentine peso right now, so it can't be picked. It comes back on its own as soon as a price does." (currency name from the list)
- Button: "Got it"
- Quote screen, when the rate drops while it is open (replaces "Price unavailable right now", quoteModel `price-unavailable` and takeErrors `price-unavailable`): "No rate for ARS right now. You can send your request once it's back."

Spec: the row is greyed (`--x2f-ink-muted`, `aria-disabled="true"`). The tag is a pill 12/16 600 on `--x2f-surface-raised`. The explainer is a box inside the open panel, under the list (`role="alertdialog"`): `--x2f-surface-raised`, 1 px `--x2f-line`, radius 12, padding 12 14 8. Title 15/20 600 with an 18 px clock icon in `--x2f-ink-muted`; body 14/20 `--x2f-ink`; "Got it" is a 44 px outline button, right-aligned, and closes only the box. The row comes back the moment a rate returns (O-020).

Board: Main, BuyMain [currencyMenu no-rate-tapped].
Code: apps/web/src/screens/browse/MethodList.tsx and browse/api.ts (the currency menu), browse/browse.css; apps/web/src/screens/post/offerForm.ts:356 (`noRate`); apps/web/src/screens/quote/Quote.tsx:263, quote/takeErrors.ts:51.

## O-022: My offers flags a currency with no price (F4)

**Already decided (spec-j31b "MyOffers"),** in the owner's F4 words ("can't go live", "not available"). Restated:

- Single-currency offer, no rate: caution chip "Can't go live" (signal-off icon, 28 px). The card is dimmed to 70% and the switch stays on (paused). Line under the chips: "We can't get a rate for ARS, so this offer can't go live. It goes live by itself when the rate is back."
- Multi-currency offer, one currency off: that chip shows the struck code, the signal-off icon, then "Not available" (12/16 600 `--x2f-caution`, visible, not screen-reader only). Line under the chips: "No rate for ARS right now. Buyers can't pick it until it's back."
- Fold-MyOffers: the same two changes in the list and the detail pane.

Board: MyOffers, MyOffers-Wide, Fold-MyOffers [rate all | one-missing | none].
Code: apps/web/src/screens/MyOffers.tsx, apps/web/src/screens/myoffers/MyOfferDetail.tsx, myoffers/model.ts. The rate per currency comes from `GET /v1/account/offers` ("its rate now", apps/api/src/offers/routes.ts:182).

## O-023: name the screen (F5)

**Final: "My offers".** Design's vote (to-lead 7 Nov, F5) beat the owner's other options (My listings, My ads, My posts). The rest of the app already says "offer": "Post an offer", "3 buying and 3 selling offers", and buyers browse offers. Already on main: apps/web/src/screens/MyOffers.tsx:193. Nothing to build.
Board: MyOffers (+Wide), with a Decided aside.

## O-035: "Request to buy XMR" (30OCT-lw, 2 Nov 01:50)

**Already decided and drawn (spec-j31a, spec-fix3; copy-unsigned-by-screen).** Main still says "Trade". Final strings:
- Quote primary: "Request to buy XMR" (BuyQuote) / "Request to sell XMR" (SellQuote).
- Offer card button: "Request to buy XMR" / "Request to sell XMR". Accessible names: "Request to buy XMR from satoshi_ghost" / "Request to sell XMR to satoshi_ghost".
- These follow the new button name (carry forward):
  - BuyQuote info line: "Nothing changes until you tap Request to buy XMR. Then satoshi_ghost has 30 min to lock the XMR in escrow. You only pay once it's locked."
  - SellQuote info line: "Nothing changes until you tap Request to sell XMR. Then you have 30 min to lock the XMR in escrow from your wallet. satoshi_ghost only pays once it's locked." (The 30 is `TIMERS.fundMin`.)
  - Back after login: "You're back. Check the total, then send your request."
  - Price moved: "The price moved. Check the new total and send your request again."
- The "Trade" tab in the bottom nav and the rail stays "Trade". It is a place, not an action.

Board: BuyQuote, SellQuote (+Wide), BuyOffers, SellOffers, OfferAd (+Wide).
Code: apps/web/src/screens/quote/Quote.tsx:486 and :454; quote/BuyQuote.tsx:34; quote/SellQuote.tsx:34; quote/takeErrors.ts:55; apps/web/src/screens/browse/OfferCard.tsx:264 (needs the side, so it can pick buy or sell).

## D-020: ban notice (G39)

**Already decided and drawn (to-lead 7 Nov v127; spec-j33a §7).** This is design's tightening of the owner's G39 words, which he passed to design ("Please refer to Design for the best wording here"). The lead's build on `wip/lead-bans` (AccountBanned.tsx) uses the owner's raw draft and its own headlines. Change it to these:

| | site ban | trade ban |
|---|---|---|
| chip | "Account banned" (permanent) / "Temporary ban" (timed) | "Trade ban" |
| headline | "Your account has been banned" | "You can't trade right now" |
| lead | "We're sorry. If you think this was a mistake, message a moderator on Matrix or Telegram and ask for the details." | "We're sorry. Your account can't start or join new trades. If you think this was a mistake, message a moderator on Matrix or Telegram and ask for the details." |

- Facts block: "Ends" with "14 Nov 2026, 14:05 UTC" (mono, UTC) or "Permanent · until a moderator lifts it". "Reason" with the general reason (D-019, `BAN_REASON_TEXT`).
- Open business, site ban only: "Finish open business" / "You can still log in, but only to finish these."
- "What this means": "You can still log in, look at offers and use your wallets." (trade ban). Then one of:
  - "Once everything is finished, you won't be able to log in again until the ban ends." (timed, open business)
  - "Once everything is finished, you won't be able to log in again." (permanent, open business)
  - "Nothing on your account is left open, so you can't log in while the ban lasts." (nothing open)
- Always: "Your XMR isn't affected. Your wallet keys are on your device, so no one can freeze your coins."
- Contact card: "Think this is a mistake?" / "Message a moderator on Matrix" + handle / "Or use Telegram" + handle. Placeholders until W-015: #x2f-help:example.org, @x2f_help. No email.
- Buttons: "OK" (primary), "Log out".
- Drop the lead build's "Your account will be fully working again on {date}." The Ends fact already says it.

Spec: layout as AccountFrozen, with a `--x2f-danger` hero. Phone primary 56 px full width in the footer; Wide 48 px under the hero.
Board: Ban-Notice, Ban-Notice-Wide.
Code: apps/web/src/screens/account/AccountBanned.tsx (on `wip/lead-bans`), apps/web/src/ui/cantDoCodes.ts (trade-ban popup).

## D-046: first staff login explains position, pay and the appeal risk (28OCT 13:07)

**Already drawn (spec-staff2 §1 "welcome"; spec-fix3 §8 adds the Terms step first).** Not built anywhere: `wip/lead-staff-pay` has the clock-out sheet but no welcome. Order at a staff member's first login: log in → Terms + signature (p11-14) → welcome → Overview. Shown once. Later it lives in the Training library.

Strings:
- h1: "Welcome to the team, dmitri_k" / sub: "You're logged in. Before your first case, here's how the job works."
- Card 1: "You're a moderator" / "You settle disputes between traders. You rule on your own when a trade is under 1,000 USD; bigger rulings also need a senior moderator or the owner." / muted: "Your login hours are Mon–Fri, 09:00–17:00 UTC." (The board's title "Your role: Moderator" is changed because labels may not contain a colon.)
- Card 2: "How you're paid" / "You earn 4 USD in XMR for each case you complete. Your pay is worked out and sent at the end of your shift, when you clock out." Caution box: **"Closing the app doesn't clock you out."** "Tap Clock out at the end of every shift. Until you do, your pay waits."
- Card 3: "Traders can appeal" / "A trader who's unhappy with your ruling can appeal within 48 hours. A senior moderator or the owner looks at it again, never you." / muted: "If your ruling is overturned, that case earns nothing: its pay comes off your next payouts. If you leave before then, you still owe it." (The last sentence is new. It carries D-044 option A: owed if they leave.)
- Button: "Got it, start working" / "You can read this again any time in the Training library."

Live values, never hard-coded: role name and description, the large-trade limit, the per-case rate (D-043: the owner sets the numbers later), login hours and the appeal window (48 h, D-004/D-010). The board's figures are examples. Senior moderators get their own card-2 line once D-043's numbers exist.
Spec: 640 column, gap 16, three cards with padding 20, radius 16, 40 tile. h1 Familjen 28/32 700.
Board: StaffLogin [stage welcome] (and [stage sign] before it).
Code: new apps/staff-web/src/screens/Welcome.tsx; apps/staff-web/src/screens/Login.tsx (route after the first login); apps/staff-web/src/App.tsx; it reuses apps/staff-web/src/ui/TermsStep.tsx; the clock-out words must match apps/staff-web/src/ui/ClockOut.tsx (`wip/lead-staff-pay`).

## D-071: dispute room while a seller's cancel refunds (p11-37)

**Drawn (spec-j31b "p11-37"). The words change here to the owner's** ("the seller has canceled this trade. XMR has begun refunding back to their wallet, and then ... the amount of confirmations of 10"). They also follow the standing rule that cancel and refund results say "the seller", never a name (settled-batch10-12, w11-54). The app spells it "cancelled".

Strings:
- Amount-row label, replacing "Locked in escrow": "Refunding to the seller"
- Line under the amount (buyer): "The seller has cancelled this trade. The XMR has begun refunding back to their wallet."
- Line under the amount (seller's own view): "You cancelled this trade. Your XMR has begun refunding back to your wallet."
- Meter label row: "Network confirmations", with "3 of 10" on the right. Accessible label: "Refund confirmations, 3 of 10".

Spec: the label is 15/20 600 `--x2f-caution` with a 16 px return-arrow icon. The line is 14/20 `--x2f-ink`. The meter has a 6 px top margin; its bar is 6 px tall, radius 999, track `color-mix(in srgb, var(--x2f-ink) 12%, transparent)`, fill `--x2f-caution` at n/10. The label row is 13/16 `--x2f-ink-muted`; the numbers are mono. At 10 of 10 the trade moves to its refunded end screen.
Board: DisputeRoom [escrow refunding]. The board sample still names the seller; the build follows this file.
Code: apps/web/src/screens/dispute/DisputeRoom.tsx:144-148, dispute/dispute.css; confirmations from the refund transaction (apps/web/src/escrow/runtime.ts, as trade/SellerRefund.tsx `Refunding` reads them).

## S-015: signup strength chart (30OCT-lw 09:10, 10:30 table)

**Drawn (spec-j33a §2),** worded from the owner's per-row drafts. The tiers follow his latest table (1 Nov 10:30, which supersedes 09:10): "Armored vault" needs a password plus two or more other ways. A strong setup with no password is "Strong". That answers the board's OPEN `vaultRule` aside.

Panel "How strong your login is":
- **Weak** (username + password only):
  1. "A username and password alone is weak by industry standards."
  2. "If someone ever breaks in, proving the account is yours is slower and harder."
  3. "Your changes wait through a 24 h cooling-off. That stops an intruder, but it applies to you too while we check."
  4. "Harden it with an authenticator app, passkey, security key or PGP key, and your changes take effect at once."
- **Strong:** "This stops simple username and password guessing." / "You can take decisive actions right away, with no waiting." / next-step hint "Add a password and one more way to reach Armored vault."
- **Top tier:** eyebrow "Top tier", title "Armored vault!" (the owner's phrase), bar label "Armored vault".
- Not allowed: "A username alone can't prove it's you, and your Trade Tag can't be used to log in." / "Pick at least one way to log in."
- Recovery note above the footer (every tier): "Next you'll set up recovery. Everyone needs it. It isn't a way to log in: it's for when every other way is lost. Keep your recovery code apart from everything else, somewhere only you'd look, like under a fake rock in the garden."
- Footer: "Continue". Its disabled reasons: "Pick a way to log in to continue." / "Make your password strong to continue."
- **New, the owner's "confirms they wish to continue"** for the Weak tier only. "Continue" opens a confirm sheet (ConfirmSheet pattern):
  - Title: "Keep a weak login?"
  - Body: "Your changes will wait 24 h each time, and getting your account back is harder. You can add a stronger way later in Security settings."
  - Primary (safe): "Add a stronger way". Secondary: "Continue with a weak login".
  - The Strong and Top tiers go straight on.

Spec: as the board. Tier title 13/16 600 uppercase in the tier tone (Weak `--x2f-caution`, Strong and Top `--x2f-escrow`). Four bars at heights 28/52/80/112. The sheet uses `.x2f-sheet__title` (G-004).
Note to the lead (not OWNER): the owner's row 11 (authenticator code only = Medium) can't happen at signup, because main offers four signup methods and the authenticator is added after them. Nothing changes.
Board: SignupSecurity (+Wide). **Board needed:** the weak-login confirm sheet.
Code: new step apps/web/src/screens/setup/SignupSecurity.tsx after the method steps and before `backup`; apps/web/src/screens/setup/SetupFlow.tsx (route); setup/Login.tsx (method choice); setup/setup.css.

## S-025: message when a recovery session tries a change (30OCT-lw N50)

The owner's own message is kept: "a 24 h hold has been placed on changes to your account while our security team reviews everything; please be patient and reach out on Matrix/Telegram; we will also try to contact you via the secure Jabber account". It is merged with the S-026 contact line (`wip/lead-s026-d056`). **This supersedes w10-104 for `holdText`.** Use the same lines everywhere the hold is explained, in this order:
1. "Your recovery code was used to log in, so a 24-hour hold has been placed on changes to your account while our security team reviews everything."
2. "New trades, wallet changes and login changes wait until 6 Nov 2026, 15:05 UTC. Your open trades are paused until the hold ends or a moderator decides."
3. "Please be patient. If you need us, message us on Matrix or Telegram. While the hold is on, we contact you only there or on the secure Jabber account you set up before the hold."
4. "Log in with a passkey, security key or PGP key you had before the hold to end it now."

RecoveryHold screen (spec-j33a §3), in the same words:
- Card "Your recovery code was used to log in": line 1. Then "If you turned on Jabber alerts, we've sent you one about this too."
- Card "Ask us to remove the hold": "Message our security team on Matrix or Telegram. They'll ask you to confirm it's you over secure Jabber, through Tor. Once that's done, the hold can be removed." Matrix and Telegram rows (placeholders until W-015).

The login-screen refusal (w10-105) is unchanged. Dates are always UTC (W-017).
Board: RecoveryHold (+Wide). The change attempt uses the existing CantDoThat pop-up, so no new board.
Code: apps/web/src/ui/cantDoCodes.ts:496 (`holdText`) and the S-026 line on `wip/lead-s026-d056`; apps/web/src/screens/auth/BackupLogin.tsx (hold note); apps/web/src/screens/auth/refusals.ts:53.

## S-111: tell the person the used code is burned (p11-36)

The owner: "tell them that this recovery code is now burned and in the security settings, they should go and generate a new recovery code." These are the same strings as settled-batch10-12 w10-97 and w10-98 (one wording everywhere):
- Reminder sheet (first login after a recovery code was used): title "Your old recovery code is burned" / body "You used it to get back in, so it won't work again. Make a new one in Security settings and keep it somewhere only you'd look." / primary "Make a new recovery code" (opens Settings → Security → recovery code) / "Remind me later".
- Login-Backup, after the 24 h hold: "The 24 h hold is over. The recovery code you used is now burned: it won't work again. Once you're back in, make a new one in Security settings." Link: "Make a new recovery code".
- Banner and alert: "Your old recovery code is burned. Make a new one in Security settings." / alert name "Your recovery code is burned".
- The `wip/lead-recovery` build's BURNED_CODE_COPY changes to these: title "Your old recovery code is burned", link "Make a new recovery code".

"Remind me later" stays, and the reminder comes back at each login until a new code exists (S-018). Design calls this; it is not an owner question.
Note to the lead (not OWNER): main makes the new code automatically and only shows it. The owner said the person makes it. The words work either way, because the tap on "Make a new recovery code" is what the person sees. The lead confirms the mechanism, as the register row asks.
Board: RecoveryCode (+Wide) [step reminder], Login-Backup (+Wide) [view ready].
Code: apps/web/src/screens/settings/holdCopy.ts (`NEW_CODE_COPY`, `BURNED_CODE_COPY` on `wip/lead-recovery`); settings/NewRecoveryCode.tsx; auth/BackupLogin.tsx; settings/Alerts.tsx.

## P-011: proof disclaimer wording, placement and button (Q46)

**Drawn (spec-j31b "ProofBlur").** Two places: the person sending proof, and the seller reading it.

Uploader (photo editor, every review step, not on the sent screen). This uses the existing grey box above "How your proof is protected"; there is no new callout.
- Title: "Before you send"
- "Our privacy tool can miss things. Check names, account numbers and addresses."
- "Send only a real record of your payment. Moderators check proof closely and can ask you for a video of it."
- Text button: "How proof is checked" (opens the FAQ proofs entry; hide it until the FAQ exists).

Seller (SellerConfirm "Before you release"):
- Title: "Screenshots can be faked" (as built)
- New line under it: "Someone can even fake X2F's own screen. Only your bank app shows whether the money arrived." This replaces `PROOF_FAKE_DISCLAIMER`.
- Warn-Release keeps w11-51.

Spec: the title is 15/20 600, the lines 14/20 `--x2f-ink` with a 4 px gap. The link is 14/20 600 `--x2f-ink`, underlined, with a 44 px hit area.
Board: ProofBlur (+Wide), SellerConfirm, Warn-Release (+Wide).
Code: the blur editor (claude3's P-012 work; not on main); apps/web/src/screens/proof/ProofPrompts.tsx:28; apps/web/src/screens/trade/SellerConfirm.tsx:285-303.

## P-030: buyer paid less (C3 Q20, item 62)

The owner: nothing prompts or changes the trade ("we can't see inside their accounts"). The seller decides, and is encouraged to talk first. **Drawn earlier (SellerConfirm [situation short]).** Restated:
- It shows only when the proof check reads a lower amount than the trade. The buyer sees nothing new.
- Proof check line: "Shows $380.00, not $412.50"
- Info note (G-006 blue): title "mira.k may have paid less" / "Talk to mira.k in the chat first. Then release, or open a dispute. It's your call."
- The release tick changes to: "I checked my bank account myself and I'm OK with what arrived."
- Warn-Release opens with: "mira.k may have paid less. Talk to them in the chat first. Then release, or open a dispute."
- Release stays possible, and nothing blocks or pauses.

Board: SellerConfirm [situation short], Warn-Release (+Wide) [amount short].
Code: apps/web/src/screens/trade/SellerConfirm.tsx:285-303, trade/ReleaseWarning.tsx:44-52; the amount read comes from the proof check (packages/proof; claude3's P-0xx work).

## G-003: active Buy/Sell tab, 2 px dark border (G42)

**Settled: yes** (J-34). The final spec is the board and main, which agree. This corrects the sizes in the J-34 note:
- Track: `--x2f-surface`, radius pill, padding 4, gap 4.
- Each tab: 44 px tap target over a 36 px pill. Text 15 px 600 in both states, so the width never jumps.
- Active: `border: 2px solid var(--x2f-ink)`, `background: var(--x2f-surface-raised)`, text `--x2f-ink`. Never orange.
- Inactive: transparent 2 px border, text `--x2f-ink-muted`.

Board: Main, BuyMain. Code: already built in apps/web/src/screens/browse/browse.css:58-102. Nothing to change.

## G-004: disabled button and sheet title (G43)

**Settled: keep everywhere** (J-34). Restated:
- Disabled: `background: var(--x2f-surface-raised)`, `color: var(--x2f-ink-muted)`, no border, no opacity, `cursor: not-allowed`, same height as enabled (56 in a phone footer, 48 inline). It always comes with a one-line reason under it, 13/18 `--x2f-ink-muted`.
- Sheet title: Familjen 24/30 700, −0.01em, `text-wrap: balance`. Grab handle 36×4 `--x2f-line`, radius pill.

Board: every board. Code: built in apps/web/src/ui/ui.css:59-64 (disabled), :388 (title), :790 (handle). Remaining build work: give each disabled primary its reason line, screen by screen.

## G-005: unbuilt offer-screen items (G44)

**Settled: build all, in this order** (J-34), Main/BuyMain top to bottom:
1. Header with the Site news link: bell + "Site news" 15/20. (Main's NewsBell is the icon only; add the word.)
2. Buy/Sell tabs (G-003).
3. Market price card: label "Market price" 13/16 caps `--x2f-ink-muted`; price mono 24; the currency menu on the right; under it "Market rate · updated 14:05 UTC".
4. Search.
5. Sort chips.
6. Section heading with its count, right-aligned, mono 13, `--x2f-ink-muted`.
7. Method rows with a 40×40 icon tile, radius 12, `--x2f-surface-raised`.

- Empty search, merging J-34 with the Suggest action main already has:
  - Heading: `No payment methods match "{query}"`
  - Line: "Try another word. You can still post an offer with a custom payment method."
  - Button: "Suggest it".
  - The method picker's own empty line stays: `No method with buyers matches "{query}".` / `No method with sellers matches "{query}".`
- **The Deposit row is dropped:** there are no buyer deposits (T-021). It is already gone from SellQuote.

Board: Main, BuyMain, SellQuote. Code: apps/web/src/screens/browse/MethodList.tsx:114 and :226-232, browse/browse.css, apps/web/src/ui/NewsBell.tsx.

## G-006: blue info note and rounder icon buttons (G45)

**Settled: yes** (J-34), with one correction to match the boards:
- Info note: `background: color-mix(in srgb, var(--x2f-escrow) 10%, var(--x2f-surface))`, `border: 1px solid color-mix(in srgb, var(--x2f-escrow) 30%, transparent)`, radius 12, padding 12×14. 18 px info icon in `--x2f-escrow`; text 14/20 `--x2f-ink`. Use it for neutral facts only. Caution is for "check this"; danger is for "stop". Main's info note is still grey: change it.
- Icon buttons: 44×44, radius 12 (built). In headers (Back, Close, Site news) they have **no border**, as on every board. A 1 px `--x2f-line` border, 48×48, is only for a standalone tool button next to a 48 field (Copy, Paste). Glyphs 20–24 at stroke 1.75.

Board: BuyQuote, Main and every header. Code: apps/web/src/ui/ui.css:1077-1086 (`.x2f-outcome[data-tone='info']`), ui/Notice.tsx (tone `info`), ui.css:276 (`.x2f-icon-button`; add an outlined modifier for the field case).

## G-008: folding phones (G47)

**Settled** (J-34 research; docs/design-research-foldables-2026-11-07.md):
- In scope: Pixel Fold and Pixel 9–10 Pro Fold; Samsung Z Fold and Z Flip; OnePlus Open, Honor Magic V, Vivo X Fold, Oppo Find N; Surface Duo. The owner's "iPhone Duo" is most likely the Surface Duo.
- Detect the **posture, not the model:**
  - viewport-segment media queries and `env(viewport-segment-*)`;
  - the Device Posture API (`device-posture: folded`);
  - width as the fallback.
- One layout per posture:
  - cover screen = Fold-Cover;
  - unfolded = Fold-Offers / Trade / MyOffers / Notes;
  - tabletop = Fold-Tabletop;
  - two segments = Fold-TriFold pattern, never across the hinge;
  - a flip's main screen = the phone boards.
- **Every unfolded screen keeps the in-app Back arrow.** Samsung users may use the 3-button bar, not gestures.

Board: Fold-Cover, Fold-Offers, Fold-Trade, Fold-MyOffers, Fold-Tabletop, Fold-TriFold (Back drawn on all the unfolded ones).
Code: built in apps/web/src/ui/fold.ts and apps/web/src/styles/fold.css. Remaining: check that every unfolded layout shows Back, including the tabletop rule that hides the main pane's header (fold.css:172) when the glance pane shows it (apps/web/e2e/fold.spec.ts). G-009 ("Pay now" on fold) still waits, as the owner said.

## G-013: Support headline (p5-4)

**Final, in the owner's words:** headline "Ask an X2F staff member". Drawn already (spec-j33a §7). It is not on main; `wip/second-support-tickets` has the title "Support".
- Nav/page name: "Support". h1: "Ask an X2F staff member". Thread view h1: "Your ticket".
- Lead: "An X2F staff member will answer you here. X2F staff can't see dispute evidence or decide disputes, so for a problem with a live trade, open a dispute from the trade instead."
- Shown only to team accounts: "Your team shares these tickets. Every member sees them."
- Caution: "Never send a password, recovery code, authenticator code or private key. X2F staff will never ask for them."
- The tag on staff replies is "X2F staff" (as on the branch), not "X2F team". This avoids a clash with a vendor's team. The board's tag follows on the next pass.

Board: Support (+Wide). Code: apps/web/src/screens/support/Support.tsx `SUPPORT_COPY` (`wip/second-support-tickets`): add `headline`, keep `title: 'Support'` for the nav, split `lead`.

## G-025: signup order (p11-24)

The owner: "disclaimer, terms of service, and rules ... maybe separate pages ... acknowledge ... a little box where they sign ... any signature ... continue creating your account". **Drawn (spec-j33a §1).** Design's call is one page with two separate ticks, so each part is acknowledged on its own and the order is his. One page keeps the phone flow short.

Order: Terms of Service (scroll box) → terms tick → Site rules card → rules tick → signature → "Continue creating your account".
- Intro: "Read the terms to the end and tick to agree. Then read the site rules and tick those too, sign your name and continue. You agree once, here, never again on a trade."
- Terms tick: "I have read and agree to the Terms of Service and Privacy Policy, and I understand X2F's role."
- Site rules card: "Site rules" / "The rules every trader keeps. Moderators hold everyone to them." Then:
  1. "Trade honestly. A scam can mean a lifetime ban."
  2. "Opened a few trades to see who answers first? Close the ones you won't use, so nobody is left waiting."
  3. "In a dispute, answer the moderator's questions. Not taking part can cost you the ruling."
  4. "Only pay once the trade shows the escrow is secured."
  5. "No trades in sanctioned currencies."
- Rules tick: "I've read the site rules and I'll keep to them."
- Signature placeholder: "Sign your name here with your finger or mouse. A scribble or an X is fine."
- Button: "Continue creating your account" (replaces "Start creating my account").
- Hint under the disabled button: "Scroll to the end of the terms, then tick both boxes and sign." Once scrolled, it names only what's missing, for example "Tick the site rules to continue."
- Store the rules acknowledgement with the signature: one flag plus the rules version.

Staff sign the Terms only, with no site-rules list (StaffLogin [stage sign]). Team members trade, so their first-login sign step (MemberApproval) gets the same Site rules card and tick: **board needed** for that addition.
Spec: the Site rules card is `--x2f-surface`, radius 16, padding 16/20, gap 10. Title 18/24 600. List 14/20 with mono 13 muted numbers in a 16 px column. The ticks are surface-raised, radius 12, padding 14, with a 2 px ink border once ticked.
Board: SetupTerms; StaffLogin [stage sign]; MemberApproval (rules card: board needed).
Code: apps/web/src/screens/setup/Terms.tsx:251 (button), :265-268 (the rules note); setup/termsText.ts; setup/SetupFlow.tsx:67 (remove `NEEDS_OWNER_SITE_RULES`, so the rules live on the Terms page); setup/signature.ts (store the rules version); apps/web/src/screens/auth/MemberInvite.tsx (member sign step).
