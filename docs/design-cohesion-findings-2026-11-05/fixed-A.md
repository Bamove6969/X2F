# Fixed A (resumed 5 Nov after the killed run)

## Boards changed
- SetupTerms: already done by the earlier run (placeholder moved to an OPEN box in the notes, "Final text to come." in the scroll box, "Draft copy" label, §11 confirm row, hint "Tick the box to continue." under the primary, lead shortened). Verified, check OK, rendered.
- SetupUsername: already done (username in body text, "Nothing else to give us, now or ever."). Verified.
- SetupLogin: already done (nested explainer is a §12 info callout). Verified.
- SetupPgpKey: already done (fingerprint is the third row of the inner block; contact-details wording). Verified.
- SetupPgpChallenge: already done ("Step 3 of 5 · part 2", 28h chip, "4 min 12 s", titled callout with Login's shorter text). Added: chip and copy button no longer wrap ("Copy message" -> "Copy" with aria-label, nowrap).
- SetupPassword: already done (spec rule sentence, titled caution callout, no email). Verified.
- SetupBackup: already done ("Authenticator app", "no way to reach you" wording). Verified.
- SetupWallet: already done ("wait 24 h", titled info callout). Verified.
- SetupWelcome: already done (stepper done colour = ink). Verified.
- Login: already done by the earlier run (muted "Change", wordmark, timer, titled callout). Added: timer line nowrap and the copy button label "Copy" (was wrapping onto two lines at 390).
- Login-Wide: wordmark plain ink; "Change" muted; "Expires in 4 min 12 s"; titled callout "Check the signature before you paste"; primary auto width (min 160) with "Get a new message" tertiary beside it; "6" mono; "30 s".
- Login-Backup: wordmark plain ink; "24 h hold" (callout title, hero headline, ready note) in mono; notes say "owner" not "account holder".
- Login-Backup-Wide: same as Login-Backup, plus primary auto width (min 160) left-aligned with the tertiary beside it.
- LoginApprove: "ends in 4 min 59 s" (both the ask and the waiting view); chip "New login · owner account"; "Only the owner approves new devices."; "24 h hold" mono.
- LoginApprove-Wide: same as LoginApprove, plus the six-item rail with icons (current: Trade).
- SessionExtend: wordmark plain ink; hero timer "1 min 58 s" (digits mono 40, units body 18/24 600 muted); "Your 4 h session is up … another 4 h."; note "1 min 58 s left". The ring already had the 20% track + arc (kept). "Decided · owner, 2 Nov" boxes kept.
- SessionExtend-Wide: same, plus Help appended to the rail (six items, current: Trade) and the logged-out wordmark.
- RecoveryHold: wordmark plain ink; hero timer "23 h 41 min" (seconds dropped, bar kept); "24 h hold" / "after 24 h" mono; "owner" instead of "team lead" (two places).
- RecoveryHold-Wide: same as RecoveryHold.
- RecoveryCode: wordmark plain ink; code card border 1px solid escrow 35% (no dash); storage-tip tiles neutral (raised bg, ink icon); info line now "Using it logs everyone out and starts a 24 h hold. You'll see how the hold ends and how to end it sooner."; hint was already under the primary.
- RecoveryCode-Wide: same, plus the Login-Backup-Wide pre-login header (centred wordmark, "Back" text link above the title in the 720 column), hint 13/18 muted under the primary, and the reminder view's rail now six items (current: Trade).
- SessionLength: native select replaced by the Devices tile group (2/4/6/12 h, vendor 2/6/12/24 h; "Not set" on the right, 2px ink selection); 56px clock tile removed (callout, then the 28/32 title); hint "Pick a time to continue." moved under the primary at 13/18; wordmark plain ink; new OPEN box "tiles or a drop-down" (the 2 Nov code comment said drop-down); root/preview height 1607.
- SessionLength-Wide: same tiles; dialog order is tiles, helper, link line, full-width primary with the hint under it; six-item rail (current: Trade); wordmark; height 1425.
- Devices: already done by the earlier run (every DECIDED/OPEN aside is under the Design notes heading below the app; "Team member" chips uppercase tinted `--team` 14%; device-meter segments `--escrow`, empty `--surface-raised`; switches ink/ground). Verified, check OK, rendered night + day.
- Devices-Wide: already done (DeleteAccount-Wide header: back 44 + "Settings" over the title; six-item rail with icons, current Settings; notes below the app; same chips and meter). Verified, check OK, rendered.
- SignupSecurity: already done by the earlier run (spec password rule sentence with the OPEN pwRule box kept; RECOMMENDED / LOGIN ONLY as §7 chips; "Strong" at 24/30 with the shield; session tiles kept). Added: "Ending a 24 h hold early" (was "24-hour", mono digits, nowrap); unfilled strength bars 1px solid `--line` and the armored seal divider 1px solid escrow 25% (no dashed borders outside upload rows and OPEN boxes).
- SignupSecurity-Wide: already done (Login-Backup-Wide pre-login header, single 720 column: names, methods, password, strength card, session length, then the primary with the hint under it). Added: the same "24 h hold" wording and solid bars/divider as the phone board.
- Compromised: hint was already under the primary (13/18 muted centred). Added per shared standards 15/17/18: `[address to come]` on the Matrix and Telegram rows now shows the example handles used on Devices (`@x2f-support:matrix.org`, `@x2f_support`); the in-app "Placeholders: …" caption and the ticket block's "Example only. Format to be decided." caption moved into a new OPEN "text to come" box in the notes; the Secure Jabber row is a 1px `--line` outline card (was dashed) reading "Not available yet"; frozen frame height 1396, notes 702, preview 1795.
- Compromised-Wide: pre-login pattern was already done (centred wordmark, centred 720 form column, hint under the auto-width primary). Added the same placeholder/caption/Jabber changes and OPEN box; notes 636, preview 1603.

## Findings skipped and why
- SignupSecurity P3 (add setup context + stepper, or supersede the board): needs a redesign; left as is.
- Devices-Wide/Compromised-Wide hint stays left-aligned under the auto-width primary (centring under a 160px button on a 720 column would float it); same as RecoveryCode-Wide.

## COPY-UNSIGNED (new or changed user-facing sentences, this run)
- SignupSecurity (+Wide), authenticator note: "Ending a 24 h hold early" (was "24-hour hold").
- Compromised (+Wide), Secure Jabber row: "Not available yet" (was "To be decided", a design note in the UI).
- Compromised (+Wide): example handles "@x2f-support:matrix.org" and "@x2f_support" shown in place of "[address to come]" (same examples as Devices; real addresses OPEN).

## Open questions for the owner
- Compromised: the Matrix and Telegram moderator addresses, whether Secure Jabber ships, and the ticket-number format (OPEN box added to both boards).
- SignupSecurity: password rule (OPEN pwRule box kept; spec sentence shown), Armored vault without a password, default session length (existing OPEN boxes).
