# X2F design session handoff (2 Nov 2026)

Written by the design session (cloud, "Continuation") so that a fresh design session, or the lead, can carry on without this chat. Read this file top to bottom before you touch anything.

---

## 1. Who's who, and how work flows

- **Owner (bamove6969):** makes every product decision. Rule: **no decisions without the owner.**
  - Anything the owner hasn't decided goes on a board as a visible **"OPEN · owner to choose"** box. Never quietly pick a default.
  - The owner gave design the authority over **visual and aesthetic calls**: layout, colour, type, polish. Product rules always need the owner.
  - The owner wants all questions to go **through the lead**. Exception: design may go straight to the owner when it strongly disagrees with something, and must explain why. The owner has used this several times (security points, honesty about stored proofs).
- **Lead:** a Claude Code session on the owner's Windows PC, connected with Remote Control.
  - Remote session id: `session_01Btihb34hJU5sMkyYMAzy4k` (its title changes).
  - Message it with the claude-code-remote `send_message` tool. This needed the owner's one-time trust approval, which is already granted for this session.
  - The lead runs the builders: **claude2** and **claude3**, plus helpers.
  - The lead relays owner answers to design, and builds from the commits design names.
- **Design session:** this one. It owns the design canvas, the boards, `docs/design-*` on `wip/design-brief`, and design reviews of built screenshots.

### Overrule note
`docs/OWNER-NOTE-2026-11-02-design-decisions-overrule.md` covers the period when the lead was offline, from about 00:22 UTC on 2 Nov until it reconnected. During that time the owner worked only with design. Decisions design recorded then **overrule** anything the owner told the lead earlier on the same topic.

---

## 2. Where everything is

| What | Where |
|---|---|
| Design canvas, the source of truth for boards | https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH (private to the owner) |
| Build preview: 65 screenshots of the built app, night and day | https://claude.ai/artifact/S535eovxvVpPbkzm31LZLc |
| Branch | `wip/design-brief` on Bamove6969/X2F. Draft PR #3 is "for the lead: read, don't merge". `main` has been fast-forwarded to 52b7a0e, so PR #3 now shows docs only. |
| Published boards, matching the canvas | `docs/design-boards/*.dc.html` + `canvas.json` |
| Snapshot of every board mid v2 rollout (may be half-restyled) | `docs/design-boards-inprogress/` |
| Visual system v2 spec | `docs/design-visual-system-v2.md` |
| v2 rollout brief given to every group agent | `docs/design-v2-rollout-brief.md` |
| Board conventions, including the 2 Nov additions (tokens, OPEN marker, --team, --mod) | `docs/design-conventions.md` |
| Board renderer: board → PNG via headless Chromium | `docs/design-tools/render-board.js`. Usage: `node render-board.js <board.dc.html> <out.png> [night\|day] [json]`. The json may set `$state`, `$click`, `$hover` and tweaks. |
| Before/after v2 shots | `docs/design-v2-shots/` |
| Owner decisions log, newest at the bottom | `docs/design-hold-model-2026-11-02.md`, plus `docs/design-brief-2026-10-29-response.md` for 29 Oct to 1 Nov |
| Lead's 1 Nov brief | `docs/design-brief-2026-11-01-from-lead.md` |
| Review of the 65 built screenshots (132 findings) | `docs/design-review-screens-2026-11-01.md` |
| Lead update file, from 29 Oct onwards | `docs/design-update-2026-10-29-for-lead.md` (older; the decisions log is more current) |

**Local working copy:** in the cloud container, at `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/lead/project/`. It's lost if the container goes. Rebuild it from `docs/design-boards/` plus `docs/design-boards-inprogress/`, using whichever is newer for each board.

### Publishing to the canvas
- Artifact publish with `url` = the canvas link.
- `root` = the folder that holds `project/`.
- `file_path` = one board.
- `files` = `{"project/<Board>.dc.html": "project/<Board>.dc.html", …, "project/canvas.json": "project/canvas.json"}`.
- `canvas.json` holds board positions and sizes under `boards[<file>] = {x, y, w, h, page:"all", title, is_interactive:true}`, plus `order` and `notes`.
- Always set `h` from the board's `$preview` height, and fix any overlaps by pushing lower rows down. A small helper did this: `tools/publish-prep.py <Board…>`.

### Committing
- From a worktree of `wip/design-brief`: copy boards into `docs/design-boards/`, then commit.
- Commit command: `env GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com git -c user.name=flem -c user.email=bamove@gmail.com commit`.
- Trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01XZAz2tn1YbpoyEtNYuAJim`.
- Push with `git push origin HEAD:wip/design-brief`. No model ids anywhere in commits.

---

## 3. Visual system v2 (the owner asked for cohesive, bold and beautiful)

- **Spec:** `docs/design-visual-system-v2.md`, with 19 specs and a 13-step checklist.
- **Exemplars:** BuyerPay, Refunded (+Wide) and ProofBlur.
- **Signature mark:** the **2-of-3 key mark**: three dots, two filled and one ring, in the colour of the trade state. It appears only on trade and trade-result heroes, active-trade list rows, and the empty trades state.
- **Core rules:**
  - No drop shadows. Depth comes from stepping ground → surface → surface-raised.
  - One hero per key screen.
  - Selection is shown with a 2px ink ring on `--surface-raised`. **Never orange.**
  - One orange primary button per screen, pinned in the phone footer.
  - Designer notes go **below** the app screen under "Design notes".
  - Draft copy is labelled "Draft copy" and listed as COPY-UNSIGNED.
- **Tokens:** night and day THEMES, plus `--mod` (moderator purple: night #b69cff, day #6741d9) and `--team` (team-member blue: night #7aa2ff, day #2f5bd3).
- **Formats:**
  - Dates: "6 Nov 2026, 15:00 UTC", in mono.
  - Durations: mono digits with body-text units ("1 h 58 min").
- **Phone tab bar:** the current tab is ink, never orange. A pinned primary sits above the tab bar.
- **Shared CantDoThat dialog:**
  - A sheet on phone, a 480 px dialog on wide.
  - OK is the one orange button, with no X. Tapping the scrim, the back gesture or swiping down also closes it.
  - The title is a parameter; the default is "You can't do that yet".

### Rollout status at the time of writing
- **Done, published and pushed:**
  - Exemplars.
  - Login group: Login, LoginApprove, Login-Backup, RecoveryCode, RecoveryHold (+Wide each).
  - Help group: CantDoThat, Feedback, News, Maintenance, Alerts, Support, SelfDestruct (+Wide each).
  - Offers group: Main, BuyMain, BuyOffers, SellOffers, BuyQuote, PostOffer, FlexOffer-Post/Quote (+Wide), MyOffers (+Wide).
  - Setup/account group: Setup*, Profile, Wallet, DeleteAccount, BecomeVendor, Devices (+Wide where they exist).
  - Also done: TradeTechIssue (+Wide), ProofBlur (+Wide).
- **Still running when this was written:**
  - **Trade flow:** TradeFund, BuyerPaidWaiting (+Wide), SellerConfirm, SellerRefund, CancelRequest (+Wide), Warn-IvePaid (+Wide), Warn-Release (+Wide), Review, TeamChat (+Wide), Desktop.
    - Includes this owner correction: BuyerPaidWaiting's dispute button is **disabled for 30 min after "I've paid"** and shows "Available from <time> · in <n> min".
  - **Sessions/holds:** HoldChange, SessionLength, SessionExtend, Compromised, SignupSecurity (+Wide each).
    - Includes this owner change: a password-only change **no longer logs anyone out**. HoldChange's submitted step shows a banner, "N changes take effect on <date>", with "Review changes" and "Cancel these changes".
  - **Team:** Team, TeamRefusal, MemberApproval, MemberPermissions, InviteInvalid (+Wide).
  - **Disputes/notices:** DisputeOpen, DisputeRoom, DisputeRuling, Appeal-Notice, Lien-Notice, Ban-Notice, Block, Reviews (+Wide).
  - **Staff + foldables:** Staff*, ModCase, ModQueue, OwnerSetup, BadgeSettings, Fold-*.
  - **OfferAd (+Wide), new:** the public ad page, both sides. Two drop-downs: **Currency ▾** and **Pay with ▾** (or **Receive by ▾**), pre-selected from the search. One ad covers every currency. Limits are converted at the market rate and shown with "≈". Cap: 3 buy + 3 sell ads per vendor.
- **If those agents are gone:** take each unfinished board from `docs/design-boards-inprogress/` (or `docs/design-boards/` if that's newer), apply the rollout brief, render night and day, then publish and push. Check that each board still has its OPEN and Decided notes and tweaks.
- **Not done yet:**
  - PostOffer and FlexOffer-Post still have a **single currency select**. Since one ad now covers several currencies, it needs to become a multi-select. Design follow-up.
  - BlockQueued is superseded (kept for reference). Artboard-5odu is a stray.

---

## 4. Owner decisions, the essentials (full list in the decisions log)

### Accounts and login
- **Account types:**
  - Trader, the default, takes offers.
  - Vendor posts offers. To become one, the user flips a switch in Settings > Account type, which needs a passkey, security key or PGP key.
  - Team members are for vendors only.
- **Names:** username (used to log in, private) and display name (public) are both required and separate. The weakest possible login is username + password.
- **Two-factor wording:** "Needs a two-factor method you've already set up: a passkey, security key or PGP key." Short form: "Passkey, security key or PGP key needed."
- **Authenticator apps (TOTP):** count with a password for logging in. They're not enough for sensitive actions:
  - ending a hold early
  - logging in when no device is available to approve
  - team invites, permissions and on/off
  - switching to vendor

  The signup screen explains this when TOTP is the only method picked.
- **Signup tiers:** Weak / Strong / Armored vault, shown on the signup chart only.
- **Recovery code:** one 16-character code. After it's used, the next login reminds the user to write down the new one.
- **Devices:**
  - The lead can be logged in on up to 3 devices at once. Each new device is approved by matching a 2-digit number. "One device at a time" is optional and off by default.
  - With no device to approve from, the user logs in with a passkey, security key or PGP key. A password-only account then has only the recovery code left.
  - An unapproved device simply can't log in: there's no hold.
- **Sessions:**
  - The session length is chosen on every login from a drop-down with nothing pre-selected. Traders get 2, 4, 6 or 12 h; vendors get 2, 6, 12 or 24 h.
  - When the time is up, a "Stay logged in?" prompt asks the user to confirm with **any** login method they have, including a password, to extend by the same time. With no answer, the user is logged out.
  - There is no fixed maximum.
  - Open: how long the prompt waits before logging out (draft: 2 min).

### Holds
- **Recovery-code login:** a 24 h hold that logs everyone on the account out.
  - The account sees a hold message at login, with Matrix and Telegram contacts and verification over secure Jabber through Tor.
  - Trade partners see TradeTechIssue. Unfunded trades are cancelled. Funded trades are paused while X2F contacts the holder.
  - Partner wording never says "hold", "security" or "vendor"; it says "<name>'s account has a temporary problem".
- **Password-only change:** changes to login methods, wallets or team members **wait 24 h**.
  - Nobody is logged out, and trades carry on.
  - There's a warning before submitting, a review list, and then a "changes take effect on…" banner.
  - Anyone logged in can cancel the waiting changes.
  - A passkey, security key or PGP key the user already had approves the changes early. Ending the hold that way discards them.
  - The owner is notified on every channel (push, Jabber).
  - Hold warnings say "Want it sooner? Message a moderator on Matrix or Telegram."
  - Open: should password-only wallet or login changes apply on their own, or need a moderator or the recovery code to confirm?
- **Moderator "trading hold"** (dispute or lien): this is different. The user is logged in but can't trade. On My offers, every offer shows "Paused · trading hold". Posting new offers is blocked too.

### Team members (vendor accounts only)
- **Size:** up to 3 members. Members' logins don't count toward the lead's 3 devices.
- **Approval:** the lead approves each member's first login.
- **Permissions are per member:** a switch for each action, starting from presets.
  - Presets: Chat only, Offers manager, Trade handler, Everything allowed.
  - Release XMR can be granted.
  - Sensitive permissions show a warning when switched on.
  - Open: what each preset turns on (a draft mapping is on MemberPermissions).
- **Changing anything** (adding a member, editing permissions, switching a member on or off) needs a passkey, security key or PGP key. With only a password, the change waits 24 h.
- **Devices screen:** has a team card in team blue, with log out one member, log out all members, and a "Can log in" switch.
- **Chat:** member replies show in team blue. The partner sees "Team member"; the lead sees the member's name, in chat and in the audit log.
- **Members never:** change wallets, start a hold, or touch team, security, sessions, account type or account deletion.

### Trades and offers
- **No auto-accept:** every trade is accepted by the ad poster, or by a member with that permission.
- **Ads:**
  - One ad covers every currency the vendor supports. The buyer picks currency and payment method from drop-downs, and both are locked in for that trade.
  - Payment-method rules (time to pay, name match) belong to the method, not the ad.
  - Cap: 3 buy + 3 sell ads per vendor.
  - Tier limits are converted at the market rate and shown in the chosen currency.
- **Cancelling:**
  - After funding, cancelling is mutual only.
  - Once the buyer taps "I've paid", they can't cancel.
  - "I've paid" takes two steps.
- **Disputes:**
  - The buyer can open a dispute **30 min after "I've paid"**, as a minimum, because Interac can take up to 30 min to arrive.
  - Coins move at release or at the ruling. Either side can dispute within 48 h after a trade and appeal within 48 h after a ruling. The loser gets a lien.
- **Payment proof:**
  - EXIF is stripped and private details are blurred automatically on the device. The buyer reviews and adds or removes blurs (ProofBlur).
  - An **encrypted unblurred copy** is kept so a moderator sees the same image in a dispute.
    - No dispute: deleted 48 h after the trade ends.
    - Dispute: deleted when the appeal window after the ruling closes.
    - **Traders are told** (owner: "We should be honest"): "We keep an encrypted unblurred copy that only a moderator can open, and only if there's a dispute. It's deleted automatically when the trade is over."
  - Blur-template database: layouts of each app's proof screen with the private areas blanked. No real proofs are stored.
    - Open: also blank the trade code, amount and time on templates (design recommends yes).

### Other
- **Bans:** banned usernames, PGP keys and Jabber accounts can't be reused. Nothing else is tracked.
- **No email anywhere.**
- **Retention:** chats 30 days, disputes 90 days (blurred).
- **SonarQube:** the cloud app is uninstalled. It runs locally only.
- **Staff pay:**
  - Paid at the end of each shift, with clawback.
  - Senior moderators get a large-trade bonus as a % of the trade, held 48 h.
  - Notifications on every channel.
- **Foldables:** two panes split at the hinge; tabletop and Flip cover layouts; tri-fold support.

---

## 5. Open questions, owner to answer through the lead
1. What each member-permission preset turns on.
2. How long the "Stay logged in?" prompt waits before logging out (draft: 2 min).
3. Vendor requirements beyond a two-factor method, e.g. a minimum number of trades.
4. What happens when a vendor switches back to trader, to their live offers and team.
5. Whether a password-only or recovery-code login affects vendor status.
6. Whether password-only wallet and login changes apply on their own after 24 h, or need confirmation.
7. The incident-ID format, and whether the held account also sees the incident pop-up.
8. The Matrix and Telegram addresses (placeholders: "[address to come]").
9. ProofBlur: can the buyer remove an automatic blur, or only add more? Should the app warn if the amount or memo is blurred?
10. Blank the code, amount and time on blur templates?
11. CancelRequest: does the payment clock pause while a cancel request waits? Can the buyer withdraw the request?
12. Whether SetupTerms counts as an onboarding step ("of 5" vs "of 6").
13. Whether to keep the key mark on SelfDestruct's trade view (design kept it).

## 6. Build-side notes the lead already has
- **claude2:** rebuilding LoginApprove and Devices. The v2 visuals are at 4b355a56 and 87b07ff6, and the structure is unchanged.
- **claude3:** working on the cancel wording, the DisputeRuling copy, and the CantDoThat dialog plus the unreachable pop-ups.
- **Not built yet; the owner decides when:** new behaviour on the boards, including members on Devices, session length, vendor accounts and member permissions.
- **Design calls sent to the build:**
  - My offers: hold chip, ticked ring, tab style.
  - Results screens: name the seller; keep "while they're signed in"; feedback hint wording; feedback type as SelectCards; News opens the newest unread post with "1 of N new" and keeps "Don't show me this again"; Refunded's "Open a dispute" is a danger text button; times shown with a dated heading.

## 7. How to work with this owner
- **Writing style:** plain, short and warm. Don't stack jargon. Lead with what the change means for them.
- **Showing work:** show it visually. The owner reviews on a Pixel Fold, often split-screen. Use `SendUserFile` with `display: render` for PNGs, or open the canvas with Artifact `open`. Tell them to use **Fit**, not Fill, on the canvas.
- **Quoting:** quote the owner's own words when relaying decisions to the lead.
- **Usage limits:** when the owner warns about a limit, push everything at once.
