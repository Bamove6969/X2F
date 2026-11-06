# Findings A

## Cross-board (same problem on several boards in this group)
- [P2] Countdown timers use clock notation ("4:12", "04:59", "1:58", "23:41:07") instead of §14 "digits mono, units body" — boards: SetupPgpChallenge, Login, Login-Wide, LoginApprove, LoginApprove-Wide, SessionExtend, SessionExtend-Wide, RecoveryHold, RecoveryHold-Wide — fix: one format everywhere: hero timers `<mono>23</mono> h <mono>41</mono> min` / `<mono>1</mono> min <mono>58</mono> s`; inline "Expires in <mono>4</mono> min <mono>12</mono> s", "ends in <mono>4</mono> min <mono>59</mono> s" (no leading zero).
- [P2] Wordmark "X2F" has an orange "2" (`<span style="color: var(--monero-ink);">2</span>`); the exemplar rail wordmark (Refunded-Wide, DeleteAccount-Wide, Devices-Wide) is plain ink, and monero-ink is reserved for the XMR unit — boards: Login, Login-Wide, Login-Backup, Login-Backup-Wide, RecoveryCode-Wide, RecoveryHold, RecoveryHold-Wide, SessionLength, SessionLength-Wide, SessionExtend, SessionExtend-Wide, SignupSecurity-Wide, Compromised-Wide — fix: remove the inner span; whole wordmark `color: var(--ink)`.
- [P2] Caution/info callouts with 3+ sentences and no title (§12: title when more than one sentence) — boards: SetupPgpChallenge ("The message is also signed…"), SetupPassword ("X2F stores a scrambled version…"), Login + Login-Wide ("Check before you paste…"), SetupWallet ("This first wallet works right away…") — fix: add a 15/20 600 title: "Check the signature before you paste", "No reset without your help", "Check before you paste", "Adding wallets later"; and cut SetupPgpChallenge's text to Login's shorter version so both boards say the same thing.
- [P2] Copy mentions email ("No email or phone number needed", "If your key contains an email address…", "We have no email address to reset it with", "X2F has no email address or phone number for you") — boards: SetupUsername, SetupPgpKey, SetupPassword, SetupBackup — fix: "Nothing else to give us, now or ever." / "If your key carries contact details, X2F never shows or uses them." / "We have no way to reset it for you, so keep it…" / "X2F has no way to reach you, so if you lose…".
- [P2] Wide nav rail items differ: Refunded-Wide/SessionLength-Wide 4 items (Trade, Post offer, Wallets, Profile); LoginApprove-Wide/SessionExtend-Wide add Settings; Devices-Wide/DeleteAccount-Wide add Settings + Help — boards: LoginApprove-Wide, SessionExtend-Wide, Devices-Wide, DeleteAccount-Wide, SessionLength-Wide — fix: one rail list on every wide board (Trade, Post offer, Wallets, Profile, Settings, Help; 44h rows); current = Settings on settings boards.
- [P2] Disabled-primary hint placement differs: SessionLength and Compromised put "Pick a time to continue." / "Enter your username first." ABOVE the button, RecoveryCode puts "Tick the box once it's written down." BELOW it, SetupTerms has none — boards: SessionLength, SessionLength-Wide, Compromised, Compromised-Wide, RecoveryCode, RecoveryCode-Wide, SetupTerms — fix: always below the primary, 13/18 muted centred (RecoveryCode pattern); SetupTerms adds "Tick the box to continue."
- [P2] Setup stepper "done" colour: SetupUsername…SetupWallet fill done bars with `var(--ink)`, SetupWelcome fills all five with `var(--escrow)` (SetupWelcome.dc.html line 65) — boards: SetupWelcome vs the other five — fix: `var(--escrow)` → `var(--ink)` on SetupWelcome (or switch all six to escrow; pick one).
- [P2] Three different pre-login wide layouts: Login-Backup-Wide (centred wordmark, centred 480 column, "Back to log in" link), RecoveryCode-Wide (centred wordmark, 720 column with back arrow + title), SignupSecurity-Wide / Compromised-Wide (top-left wordmark, column offset as if a rail existed) — fix: adopt Login-Backup-Wide's pattern for all pre-login wide boards (720 column max for forms).

## SetupTerms
- [P1] `[Placeholder: the final text comes from X2F's lawyer.]` is set in `color: var(--caution)` 13px inside the terms scroll box (line 39): a tinted, un-labelled placeholder in the app, and no "Draft copy" label although the words are unsigned — fix: move the note below the app as an OPEN-style dashed caution box; inside the scroll box use 14px `--ink-muted` "Final text to come."; add "Draft copy" top-right 12px mono muted.
- [P2] The "I have read and agree…" checkbox row is a flat `--surface` card; §11 confirm row is `--surface-raised`, radius 12, padding 14, 2px ink border when ticked, 22px box with accent ink — fix: restyle to the §11 confirm row.
- [P3] Lead "Please read to the end. The key points first:" — fix: "Read to the end. The key points first."

## SetupUsername
- [P2] "juniper.oak is available" sets the username in mono (line 41); exemplars (Refunded, Login row) show usernames in body text — fix: drop the mono span, keep the name at 600 weight.
- OK otherwise.

## SetupLogin
- [P2] "RECOMMENDED" is an uppercase escrow chip here but a title-case outline pill "Recommended" on SignupSecurity for the same meaning — fix: SignupSecurity matches this one (§7 chip).
- [P3] The nested explainer in the PGP card is a bare 14px `--surface-raised` block — fix: make it a §12 info callout (18px info icon, radius 12) so it reads as the same component as the callouts on SetupUsername/SetupPgpKey.

## SetupPgpKey
- [P2] "KEY ACCEPTED" block mixes a §8 inner block (Type/Expires rows) with a loose "Fingerprint (your account ID)" line — fix: make Fingerprint a third row of the inner block, full-width value below the label, mono 15 500.
- OK otherwise.

## SetupPgpChallenge
- [P2] Header reads "Step 3 of 5" with three bars filled, identical to SetupPgpKey which precedes it — fix: step 4 of 6 here (SetupBackup 5, SetupWallet 6), or label it "Step 3 of 5 · part 2".
- [P2] "Expires in 4:12" chip is ~32h; §7 chip is 28h padding 0 10 — fix: height 28; and the timer format per cross-board.

## SetupPassword
- OK beyond the cross-board callout-title and email items.

## SetupBackup
- [P2] Option name "Authenticator App (TOTP)" (SetupBackup.dc.html line 79) vs "Authenticator app" on SignupSecurity, Compromised, SetupWelcome — fix: `name: 'Authenticator app'`; drop "(TOTP)".
- OK otherwise.

## SetupWallet
- [P3] "wait 24 hours" in the info callout — fix: "wait <mono>24</mono> h".
- OK otherwise (wallet chips use the 2px ink selection correctly).

## SetupWelcome
- [P2] Stepper done colour differs from the other setup boards (cross-board).
- OK otherwise: hero chip + 32 headline + inner block matches Refunded.

## SignupSecurity
- [P1] Password rule copy contradicts SetupPassword: here "Use 12 or more characters with 3 of these: small letters, capitals, numbers, symbols. Or use 16 or more with 2 of them." vs SetupPassword "At least 10 characters, with upper and lower case letters, a number and a symbol." — fix: pick one (the OPEN pwRule box's option A = 12+/3 of 4 or 16+/2) and use the identical sentence on both boards.
- [P2] "Recommended" and "Login only" are title-case outline pills, not §7 chips — fix: uppercase 13/16 600, `color-mix(TONE 14%, transparent)` bg, no border; "Login only" neutral (ink text).
- [P2] "HOW STRONG YOUR LOGIN IS" card carries a 32px "Strong" display word under the 28px screen title (two display-size words on one screen) — fix: "Strong" at 24/30 Familjen with the shield; the chart already names the tier.
- [P2] Session-length picker is four 48h tiles here, a native `<select>` on SessionLength — fix: SessionLength adopts the tiles (see SessionLength).
- [P3] Board bundles SetupUsername + SetupLogin + SetupPassword + SessionLength into one screen and lacks the "Set up your account · Takes about 2 minutes" context line and step bar the other setup boards carry — fix: either add the setup context + stepper, or mark it superseded with the dashed `--line` banner.

## SignupSecurity-Wide
- [P2] Form laid out as a 490+310 two-column grid; §18 keeps forms in a single 720 column — fix: single 720 column, strength card below the login methods, session length below that.
- Same chip / "Strong" headline / password-copy items as SignupSecurity; pre-login layout per cross-board.

## Login
- [P2] "Change" is orange 15/600 with no underline, styled like a button rather than a link — fix: underline it like the other links, or make it a 44h tertiary in `--ink-muted`.
- [P3] Step 2 "Decrypt it in your PGP app (Kleopatra, GPG Suite or OpenKeychain)." vs SetupPgpChallenge "Open your PGP app (…) and decrypt it." — fix: use the Login wording on both.

## Login-Wide
- [P2] Primary "Log in" is full width inside the card; wide primary is 48h, min-width 160, auto width (§10) — fix: `width: auto; min-width: 160px; padding: 0 24px`, left-aligned, with "Get a new message" as the tertiary beside it.
- Timer / wordmark per cross-board.

## Login-Backup
- [P3] "24-hour hold" (callout title and body) — fix: "<mono>24</mono> h hold".
- OK otherwise; this board's hold wording ("Everyone on your account is logged out, you and your team members…") is the one RecoveryCode should match.

## Login-Backup-Wide
- [P2] Primary "Continue" full width in a 480 column — fix: auto width, min 160, left-aligned (same as Login-Wide).
- OK otherwise.

## LoginApprove
- [P2] "If you do nothing, the request ends in 04:59" (line 74) — fix: "ends in <mono>4</mono> min <mono>59</mono> s".
- OK otherwise (neutral number tiles, danger confirm per §10, sheet over scrim).

## LoginApprove-Wide
- Same timer item (line 78). OK otherwise (centred dialog, dimmed app, rail inset).

## RecoveryCode
- [P1] Info callout "Using it starts a 24-hour hold on changes to your account while our security team checks it's really you." (line 72) over-claims a security-team check and contradicts Login-Backup / RecoveryHold / Devices (everyone is logged out; the hold ends on its own or when the team lead uses a passkey, security key or PGP key) — fix: "Using it logs everyone out and starts a <mono>24</mono> h hold. You'll see how the hold ends and how to end it sooner."
- [P2] Code card border is `1.5px dashed color-mix(in srgb, var(--escrow) 50%, transparent)` (line 41); dashed is reserved for upload rows (`--line`) and OPEN boxes (`--caution`) — fix: `border: 1px solid color-mix(in srgb, var(--escrow) 35%, transparent)` like every other hero block.
- [P2] The three storage-tip icon tiles are escrow-tinted for neutral content — fix: neutral tiles (`--surface-raised` bg, `--ink` icon) so escrow stays a state colour.

## RecoveryCode-Wide
- Same P1 copy (line 73), dashed border and tile-tone items; pre-login layout per cross-board.

## RecoveryHold
- [P2] Hero timer "23:41:07" — fix: "<mono>23</mono> h <mono>41</mono> min" (drop seconds), keep the progress bar.
- [P3] "on a 24-hour hold" / "after 24 hours" — fix: "<mono>24</mono> h".
- OK otherwise: caution chip + wash, mono dates, `--mod` tile, footer primary + tertiary.

## RecoveryHold-Wide
- OK beyond the cross-board timer / wordmark items.

## SessionLength
- [P2] Native `<select>` "Choose a time" (line 43) while SignupSecurity and Devices present the same choice as four 48h tiles with 2px ink selection — fix: replace with the tile group (2 h / 4 h / 6 h / 12 h; vendor 2/6/12/24) and "Not set" on the right as on Devices.
- [P2] A 56px clock icon tile sits above the screen title; that is the empty-state pattern and appears nowhere else over a title — fix: remove it; escrow "You're logged in as mira.k." callout, then the 28/32 title.
- [P3] ~200px of empty ground between the card and the footer — resolves once the tiles and the "You can change this…" line sit together under the title.

## SessionLength-Wide
- [P2] Inside the dialog, "Pick a time to continue." + Continue are right-aligned and the "You can change this…" line comes after the actions — fix: tiles, helper, link line, then the primary (full width is allowed in a dialog) with the hint under it.
- Same select → tiles item.

## SessionExtend
- [P2] Timer "1:58" (line 47) — fix: "<mono>1</mono> min <mono>58</mono> s"; and the ring shows a full caution circle with no progress arc — fix: 20%-opacity track + arc per §14.
- [P2] "Your 4-hour session is up. Confirm it's you to stay logged in for another 4 hours." — fix: "Your <mono>4</mono> h session is up. Confirm it's you to stay logged in for another <mono>4</mono> h."
- OK otherwise.

## SessionExtend-Wide
- Same timer (line 47) and copy items. OK otherwise.

## Devices
- [P1] Design notes are rendered INSIDE the app root: two DECIDED asides between "Manage roles and invites in Team" and "Options", and one OPEN + three DECIDED asides between "Stay logged in for" and "How a new device gets in" (Devices.dc.html lines 108–190) — fix: move every DECIDED/OPEN `<aside>` below the app under a "DESIGN NOTES" heading like every other board.
- [P2] "Team member" chips are title-case outline pills; §7 team chip is uppercase tinted (`--team` 14%) — fix: uppercase 13/16 600, tinted bg, no border.
- [P2] "2 of 3 devices logged in" segments are filled with `--ink`; segmented progress elsewhere is TONE (escrow when fine) — fix: filled `var(--escrow)`, empty `--surface-raised`.

## Devices-Wide
- [P1] Same: DECIDED/OPEN asides inside both content columns — fix: move below the app.
- [P2] "Settings" breadcrumb is an underlined muted link above the title; DeleteAccount-Wide uses back 44 + two-line context (13px "Settings" over the title) — fix: use the DeleteAccount-Wide header here.
- Same team-chip and segment-colour items.

## Compromised
- OK (28/32 title, 48h checkbox rows, textarea min 96, disabled primary, notes below the app). Hint placement per cross-board only.

## Compromised-Wide
- [P2] Pre-login layout per cross-board (top-left wordmark, 720 column offset as if under a rail). OK otherwise.

## DeleteAccount
- OK. Ship-ready as is.

## DeleteAccount-Wide
- OK. Ship-ready as is.
