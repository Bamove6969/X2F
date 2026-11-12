# Front screens, header rule, type and spacing (T3 "front", 12 Nov)

Brief items 1, 3, 4 and 5 from `to-design-2026-11-12.md`, plus a wording review of "Being built now". All new strings are **COPY-UNSIGNED** unless they are marked as the owner's.
Boards are in `S/canvas/project/`. Backups of the boards I changed are in `S/bak-w13-front/`. Renders are in `S/t3front/png/`.

## Boards

| Board | State | Phone / wide | Root height (default) | Sits next to |
|---|---|---|---|---|
| FirstScreen | NEW | 390 | 2387 (screen 844 + notes 1543) | Landing |
| FirstScreen-Wide | NEW | 1280 | 1793 (screen 800 + notes 993) | Landing-Wide |
| SetupWelcome | redrawn | 390 | 2389 (logins tweak: 2389 / 2301 / 2351) | as today |
| Login | changed | 390 | 2421 (passkey 1927, password 1917, staff-refused 1729) | as today |
| Login-Wide | changed | 1280 | 1654 | as today |
| SessionLength | changed | 390 | 2883 (done 2409) | as today |
| SessionLength-Wide | changed | 1280 | 1623 | as today |
| BuyMain | changed | 390 | 7613 (was 6900) | as today |

- canvas.json still needs updating, which is the head designer's job. Set the new heights above and add the two FirstScreen entries. Suggested titles: "B · First screen after the first login" and "B · First screen after the first login (wide)".
- Every board prints OK in check-board. In MEASURE, `before.root` equals `root` for every variant I touched. I rendered and looked at every board in night and day.
- New token **`--ok`** (green): night `4fd18b` (8.9:1 on surface), day `157347` (5.4:1 on ground). It goes in THEMES on SetupWelcome and FirstScreen and is used for done ticks. SetupLogin should use the same token for "Strong".

## 1. First screen after login: READY (FirstScreen, FirstScreen-Wide)

**When it appears (decision).** The rule is "nothing visible before login", so this screen sits **behind** the front door and does not replace Landing. Logged-out visitors still get Landing (Create account, Log in, recovery).

The order is:
1. Signup ends on /setup/welcome.
2. "Continue to log in" ends the signup session.
3. /login.
4. /session-length.
5. **/welcome**, this screen. It is shown once per account, on the first full login. It replaces the old landing on /sell.
6. Then returnTo, or /sell.

Either choice marks the screen as seen. The tour can be reopened later from Getting started (Help) and from "Take the tour again" (Settings). A team member never sees this screen.

**Phone layout (390 × 844)**, top to bottom:
- Intro slot: 358 × 300, radius 20. On short phones it shrinks to `clamp(240px, 100dvh − 544px, 300px)` (the owner's 443 × 794 gets 250). It currently holds a placeholder still of isometric blocks in token colours. Another worker builds the real scene.
- Hero, 188 px tall:
  - "Welcome to" in Familjen 36/40 700, rotated 17° from the top left.
  - Logo D (display cut), 240 wide, centred.
  - The whole hero is an `h1` labelled "Welcome to X2F".
- **Take the tour**: primary, 56 high, 20/600, with a play icon. It opens the tour (TourShell).
- **Skip and get started**: secondary, 52 high, 18/600, with an arrow. It goes to returnTo or /sell.
- Links: a 2 × 2 grid of 48-high pills (17/600, 20 px icon). They are FAQ, Getting started, Support and Settings.
- Tab bar: Trade, Post offer, Wallets and Profile. No tab is current. Labels are 13.

**Wide layout.**
- The rail has none of its items marked current. The rail lockup is the logo with "Welcome" under it.
- The slot is 520 × 420.
- The welcome column is 432 wide:
  - "Welcome to" in 44/48, with the logo at 292.
  - The two buttons.
  - A 2 × 2 grid of link tiles, each with one line:
    - "Answers to common questions"
    - "How a trade works, step by step"
    - "Ask X2F staff"
    - "Logins, alerts, sessions"

**Motion.**
- "Welcome to" slides in along its own diagonal, from (−24, −9) px and opacity 0. Duration 420 ms, `cubic-bezier(.2,.8,.2,1)`, delay 150.
- Logo: opacity 0 and scale 0.96 → 1, 360 ms, ease-out, delay 350.
- Buttons and links: rise 8 px and fade in, 240 ms, delay 600.
- With reduced motion, everything appears at once and the slot shows its still frame. Nothing loops.

**Copy.** "Take the tour" and "Skip and get started" are the owner's words. The link names come from his list. The tile lines are COPY-UNSIGNED.

## 2. Signup welcome (/setup/welcome): READY (SetupWelcome)

There is no wide board for this screen. Setup screens only have phone boards, and the build centres the column at 520.

**Header.** "logo – Welcome", with "Draft copy" on the right. The 5-bar stepper is removed because the checklist now says the same thing.

**Hero card.**
- Styling: radius 20, `--ok` radial tint, 1 px `--ok` border at 40%.
- A 56 px ✓ disc in `--ok`, with the check drawn in ground colour.
- "Welcome to X2F, juniper.oak" in Familjen 34/40.
- Lead, 18/26: **"Your account is ready. Trade Monero for cash, bank transfers, gift cards or any payment method you choose, with every trade protected by escrow."**
- Then a hairline, followed by this in 16/22 muted: **"Missing a payment method? [Leave feedback] and we'll add it quickly. Include any details you have, or a link with information about it."**

**Checklist.**
- Heading: "Your setup is complete", with "3 of 3" in mono `--ok` beside it.
- The list sits on surface-raised at radius 16.
- Each row has three parts:
  - a 44 px `--ok`-tinted icon tile;
  - the text: title 19/26 600, sub-line 16/22 muted;
  - a **40 px green ✓ disc on the right**.
- The rows:
  1. **"Set up your secure ways to log in to X2F."** Under it, the chosen methods are listed strongest first, each on a 32-high chip with a strength word: Strong in `--ok`, Medium in `--caution`, Weak in `--danger`. Example: PGP key (Strong), Security key (Strong), Password + OTP code (Medium). The group gets **one** tick.
  2. **"Emergency login method"**, with "Recovery code written down and checked".
  3. **"Connected your wallet"**, with "Cake Wallet, scanned from its Receive QR …k3Fz", or "…, address pasted".
- Tweaks: `logins` (3 sets) and `wallet` (scanned / pasted).

**Bigger paragraph (20/30 600):** **"Anything above can be changed later in Settings. Next, you'll log in for the first time and test the security methods you've set up. Then we'll welcome you to the X2F experience."**

**Fee callout** (surface, tag icon, 17/24): **"Remember, you only pay a fee if you post an ad."** (in bold) "Opening an ad and starting a trade is always free."

**Footer.** "Continue to log in" (primary, 56). This replaces "Start trading", because the next step is the first login. FEE_SENTENCE in Welcome.tsx is replaced by the callout above.

## 3. Logo top-left with the screen name: rule, audit, fixes

**Rule (all screens):**
- **Phone:** the header row reads `[back 44, sub-pages only] logo 24 – Page name`.
  - The page name is 20/26 600 with an ellipsis. The en dash is muted, with 8 px on each side.
  - The screen title (h1) sits below the header.
  - **The 8 Nov exception for pre-login screens is dropped.** Log in, setup, recovery, compromised and invite screens all get the lockup top left.
- **Wide:** the app rail lockup (logo with the page name under it) counts as meeting the rule. Pre-login wide screens with no rail get the lockup top left at 24 px, with padding 24 32.
- **Staff:** logo, then STAFF, then "– page name".
- **Overlays and sheets** keep the name of the page underneath.
- **Exceptions:** only Landing and FirstScreen. On those, the big centred logo is the screen's logo, as the owner drew it.
- Page names come from the LogoDirections table. One correction: SessionLength said "Find a trade" by mistake and now says "Session length".

**Fixed here:** SetupWelcome, Login, Login-Wide and SessionLength.

**Still breaking the rule (for the build, or the next board pass):**
- **Phone, no logo at all:** Alerts, Appeal-Notice, BadgeSettings, BecomeVendor, Block, BlockQueued, BuyOffers, BuyQuote, BuyerPaidWaiting, BuyerPay, CancelRequest, CantDoThat (popup: keeps the page), DeleteAccount, Devices, DisputeOpen, DisputeRoom, DisputeRuling, FAQ, Feedback, FlexOffer-Post, FlexOffer-Quote, HoldChange, HoldMember, JabberEvents, JabberSetup, Lien-Notice, Maintenance, MemberPermissions, MyOffers, OfferAd, PaymentDetails, PostOffer, Profile, ProfileVisibility, ProofBlur, Refunded, Review, Reviews, SelfDestruct, SellOffers, SellQuote, SellerConfirm, SellerRefund, Settings, SetupBackup, SetupLogin, SetupPassword, SetupPgpChallenge, SetupPgpKey, SetupTerms, SetupUsername, SetupWallet, SignupSecurity, Support, Team, TeamChat, TeamRefusal (popup), TradeFund, TradeTechIssue, Wallet, Warn-IvePaid, Warn-Release, Badges.
- **Phone, logo centred with no name (pre-login):** Compromised, InviteInvalid, Login-Backup, RecoveryCode, RecoveryHold.
- **Wide, no logo:** HoldChange-Wide, Refunded-Wide. SessionExtend-Wide is an overlay and keeps the page name underneath.
- **Wide pre-login, logo centred:** Compromised-Wide, InviteInvalid-Wide, Login-Backup-Wide, RecoveryCode-Wide, RecoveryHold-Wide, SignupSecurity-Wide, Maintenance-Wide, OwnerSetup.
- **Staff (logo + STAFF, no page name):** ModCase, ModQueue, OwnerKeys, StaffImportVerify, StaffList, StaffLog, StaffLogin, StaffOverview, StaffPerformance, StaffSettings.
- **Fold boards** (Fold-Cover, Fold-MyOffers, Fold-Offers, Fold-Tabletop, Fold-Trade, Fold-TriFold): put the lockup in the left pane's header.
- **Build:** one shared `<ScreenHeader name back?>` used on every route. A test should check that every `data-screen` renders `[data-part=page-name]`.

## 4. Type scale and spacing: READY

The bump is about +2 px at body size and +1 px at the small sizes, with a minimum of 13 px anywhere. Titles grow only a little.

| Token | Old | New |
|---|---|---|
| display | 40/44 | 42/46 |
| result-headline | 32/36 | 34/40 |
| screen-title | 28/32 | 30/36 |
| sheet-title | 24/30 | 26/32 |
| heading | 18/24 | 20/26 |
| header page name | 18/24 | 20/26 |
| body | 16/24 | 18/26 |
| body-s (rows, list text) *new token* | 15/22 | 17/24 |
| help (fine print, hints, callouts) *new token* | 14/20 | 16/22 |
| meta | 13/16 (13/18) | 14/20 |
| label (uppercase) | 13/16 | 14/18 |
| micro (tabs, stepper, "Draft copy") | 12/16 | 13/16 |
| hero-number | 40/44 | 42/46 |
| amount | 28/32 | 30/34 |
| address | 14/20 | 15/22 |
| button primary / secondary / tertiary | 18 / 16 / 15 | 20 / 18 / 17 (heights unchanged: 56 / 52 / 44) |
| input text | 16/24 | 18/26 (height 48 → 52) |

- The 11, 9.5 and 8 px sizes in ui.css go up to 13.
- Login, SessionLength, SetupWelcome and FirstScreen are drawn at the new scale as the reference.

**/login (Login, Login-Wide).**
- Header lockup "logo – Log in".
- Title changes to "Log in to your account".
- Main padding-top: phone 24 → 40, wide 32 → 56. Gaps 16 → 20. Wide column 480 → 520.
- The **"Need help?"** links all work before login:
  - "Can't log in? Use a backup" / "Your recovery code, or another login method you set up"
  - "Account compromised?" / "Freeze it now so nobody can use it"
  - "Create an account" / the existing line
  - "Read the Terms of Service" / "What you agree to when you use X2F"
- FAQ and Support are behind login, so they are not on this screen.

**/session-length (SessionLength, SessionLength-Wide).**
- Header: "logo – Session length".
- Main padding-top 8 → 28, gaps 16 → 20.
- Phone: a "Helpful links" card under the two "how it works" rows, with rows of 64:
  - Getting started / "How a trade works, step by step"
  - FAQ / "Answers to common questions"
  - Support / "Ask X2F staff"
  - Settings / "Logins, alerts, wallets"
- Wide: the dialog is 520 wide and ends with one row of text links.
- Following a link counts as making no choice: the session keeps the shortest time (2 h).

**/buy (BuyMain), spacing only:**
- Header bottom 16 → 24. Tabs margin-top 8 → 12. Title margin-top 12 → 20.
- Section gap 16 → 28. Heading-to-content 12 → 16. Main bottom padding 16 → 24.
- Market card padding 20 → 24/20, gap 12 → 16.
- Method rows: min-height 64 → 72, vertical padding 12 → 14.
- The drop-down is unchanged.

## 5. Final words for "Being built now": READY (COPY-UNSIGNED)

**Signup login choices (/setup/login).**
- Intro: "Pick every way you want to log in. We'll set them up one by one, then give you a recovery code."
- Badges: **Recommended** plus **Strong** (in `--ok`) on PGP key and on Security key.
- Authenticator app (OTP): **Medium**. "A 6-digit code from an app on your phone, used with your password. Good, but a phished code can still be used."
- Password: **Weak**. "It is strongly recommended you do not choose this as the only security method you use." (the owner's words)
- Android help line: "On Android, we recommend a PGP key (with OpenKeychain) or a security key."

**Recovery code.**
- Screen A heading: "Your recovery code".
  - Body: "Write it down and keep it somewhere safe and offline. It's your emergency way back in if you lose your other logins."
  - Tick: "I've written it down". Button: "Next".
- Screen B heading: "Type your recovery code".
  - Body: "Type it from what you wrote down. Dashes are added for you."
  - States: the field is red until the code matches, then green with "That's a match".
  - "Back" shows the same code again.

**PGP.**
- Key box label: "Your public PGP key". The box is about 4× taller (≥ 280 px).
- Challenge: "Decrypt this message with your PGP app and paste the code inside."
- Signature note: "It's signed by the official X2F key. Check your app shows a good signature from X2F before you paste."

**/setup/name.**
- Heading: "Pick a unique username".
- Replace "nothing else to give us" with: "It's how other traders see you. Don't use your real name."

**/session-length:** use the three lines given in section 4 above.
- "Longer sessions mean you won't miss a trade while you sleep. Turn on alert sounds ("Nudges") so a new trade wakes you."
- "When this time is up, we'll ask you to confirm it's you. If you can't confirm it then, you'll be logged out for your security."
- "You can change this any time in Settings under Devices and sessions."

**Welcome lead line:** use the two paragraphs given in section 2 above.

## Questions for the owner

None blocking. Two items are flagged as design decisions that he may overrule:
- When the first screen appears: once, after the first login.
- The logo exception on Landing and FirstScreen.
