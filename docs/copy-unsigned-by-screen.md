# Unsigned copy by screen (8 Nov 2026)

Every visible line on the boards (canvas v132) that the owner has not signed, grouped by screen in the order a user meets them. Phone and wide variants are together; a variant is named only where its lines differ. Each bullet is the exact text as the board shows it, then a short note on where it sits. Lines the owner dictated himself are listed in place and marked as his. Boards marked "Draft copy" in their header are listed in full; other boards list only the lines their notes or the design reports flagged as unsigned. Example data (names, amounts, dates, trade codes) is shown as the board shows it.

Sources: the 133 boards, `docs/to-lead.md`, `docs/DESIGN-HANDOFF-2026-11-06.md`, `docs/design-craft-brief-2026-11-07.md`, the five `fixed-*.md` logs, `docs/design-build-gaps/*.md` (P4 wording lines), and `owner-decisions-2026-11-06.md` on `comms`.

Not listed: BlockQueued and Warn-IvePaid (superseded boards, kept for reference only), Fold-Notes (a notes board, not a screen), OwnerSetup, DeleteAccount, News, StaffList and StaffOverview (no unsigned lines flagged), and the Trade / Post offer / Wallets / Profile / Settings / Help nav labels, which repeat on every wide board.

---

## SetupTerms
- "Before you start" — context line over the title
- "Terms of Service" — screen title
- "Read to the end. The key points first." — lead
- "X2F never holds your coins." — key point 1
- "If you post an ad, you pay a 1% fee when the trade completes." — key point 2
- "Moderators can read your trade chat only if a dispute is opened." — key point 3
- "Dispute records are kept for 90 days, with private details blurred." — key point 4
- "No IP addresses are logged." — key point 5
- "We answer lawful warrants with the little we have." — key point 6
- "An account idle for 60 days is closed, to keep X2F safe for active traders." — key point 7, new 8 Nov (design's wording of the owner's p4-5/p4-6 rule; owner asked for it "more elegantly")
- "Final text to come." — first line of the terms scroll box (placeholder until the lawyer's text)
- "If police or a government sends us a lawful request for data backed by a warrant, we will provide what little information we hold. That is exactly why we don't log IP addresses or ask for your name, phone number or email address: we can't hand over what we never collect." — section 7 of the terms (owner's plain version, 17 Oct; lawyer to word)
- "Scroll to the end to continue" — hint on the scroll box
- "I have read and agree to the Terms of Service and Privacy Policy" — tick-box label
- "I accept" — button
- "Tick the box to continue." — helper under the button once scrolled
- "Scroll to the end, then tick the box." — helper under the button before scrolling

## SignupSecurity
- "Steps 1–3 of 5" — stepper label (this screen covers username, login and password)
- "Set up your account · Takes about 2 minutes." — setup context line (also on every Setup* screen)
- "Secure your account" — screen title
- "Pick how you'll prove it's you. The more ways you add, the harder your account is to break into." — lead
- "Your names" — heading
- "Username" / "You type this to log in. Only you see it. Nobody can work it out from your display name." — field label and helper
- "Display name" / "Other traders see this. It can't be used to log in." — field label and helper
- "Ways to log in" — group heading
- "Passkey" / "Your face, fingerprint or phone PIN." — option and helper
- "Security key" / "Tap a YubiKey or similar key." — option and helper
- "PGP key" / "Decrypt a short message in your PGP app." — option and helper
- "Authenticator app" / "A 6-digit code that changes every 30 s." — option and helper
- "Login only" — tag on the authenticator option
- "What an authenticator app can't do on its own" — heading
- "It's fine for logging in with your password. But some sensitive actions need a passkey, security key or PGP key instead:" — line
- "Ending a 24 h hold early" — list row
- "Logging in on a new device when your other devices aren't with you" — list row
- "Adding team members, changing their roles or switching them on and off" — list row
- "Switching to a vendor account" — list row
- "Add one of those too and you won't be limited." — line
- "Your password" — heading
- "Password" / "Something only you know. It has to be strong." — field label and helper
- "At least 10 characters, with upper and lower case letters, a number and a symbol." — password rule (spec version; rule itself OPEN)
- "Type a password." / "Too easy to guess. Make it longer." / "Getting there. Add upper and lower case, a number and a symbol." / "Getting there. Make it longer." / "Getting there. Make it longer or less predictable." / "Good to go." — strength hints
- "Use 14 or more characters. Any characters count. It has to reach strong." / "We score how hard it is to guess. It has to reach strong." — alternative rule sentences (tweak B and C)
- "How strong your login is" — heading
- "Armored vault" / "Sealed like a vault" / "· sealed 1 Nov 2026, 14:05 UTC" — top tier name, line and meta
- "Not allowed" / "Not allowed yet" — tier chips
- "A username alone can't prove it's you, and your display name can't be used to log in." — tier text
- "Pick at least one way to log in." — tier text
- "An authenticator app alone isn't enough." — tier text
- "Add at least a password, but we recommend the other options." — tier text
- "If your account is ever broken into, it's harder and slower to prove it's you." — tier text
- "While we check, a 24 h cooling-off applies to you too." — tier text
- "Harden it with a passkey, security key or PGP key." — tier text
- "This stops simple guessing, and you can act right away." — tier text
- "Add one more way above to reach Armored vault." / "Add another passkey, security key or PGP key, or a password, to reach Armored vault." / "Add a password and one more way to reach Armored vault." — next-step hints
- "Your password plus N more ways to prove it's you. This is the strongest setup we offer." / "N strong ways to prove it's you, without a password. This is the strongest setup we offer." — Armored vault message
- "Next you'll set up recovery. Everyone needs it. It isn't a way to log in: it's for when every other way is lost." — line above the button
- "Continue" — button
- "Choose a username to continue." / "Choose a display name to continue." / "Pick a way to log in to continue." / "Add a password or another way to log in to continue." / "Make your password strong to continue." / "Next: recovery." — footnotes under the button
- "Show password" / "Hide password" — field toggle

## SetupUsername
- "Pick a username" — screen title
- "You type this to log in. Only you see it. Nobody can work it out from your display name. Nothing else to give us, now or ever." — lead (build says "This is how traders see you. No email or phone number needed, now or ever.")
- "juniper.oak is available" — field status
- "5 to 20 characters: letters, numbers, dots, dashes and underscores. It shows exactly as you type it." — helper
- "Pick something that isn't your real name or used elsewhere." — helper

## SetupLogin
- "How do you want to log in?" — screen title
- "Choose one for now. You can add others later in Settings." — lead
- "Log in with a PGP key instead of a password. X2F stores only your public key, so there is no password for a hacker to compromise from us." — PGP option description (build says "…no password for anyone to steal from us.")
- "Each time you log in, X2F shows a message locked with your public key. Only your private key can unlock it, so you decrypt it in your PGP app and paste in the login code inside. Without your private key, nobody can get that code, and each one works only once." — PGP option, more line
- "Log in with your face, fingerprint or phone PIN. Apple or Google keep it synced across your devices." — passkey description
- "Log in by tapping a YubiKey or similar key plugged into your phone or computer." — security key description
- "Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol." — password description
- "New to PGP? See the FAQ for recommended PGP apps." — link
- "Continue with PGP key" / "Continue with passkey" / "Continue with security key" / "Continue with a password" — button

## SetupPassword
- "Choose a password" — screen title
- "At least 10 characters, with upper and lower case letters, a number and a symbol." — lead
- "Type it again" — second field label
- "10 characters or more" / "Upper and lower case letters" / "A number and a symbol" / "Not on the list of leaked passwords" / "Both match" — checklist rows
- "No reset without your help" — heading
- "X2F stores a scrambled version that can't be turned back into your password. We have no way to reset it for you, so keep it in a password manager or somewhere else safe." — body (build says "We have no email address to reset it with…")
- "Set password" — button

## SetupPgpKey
- "Add your PGP public key" — screen title
- "Paste the public key from your PGP app. X2F never asks for your private key, so don't paste it here." — lead
- "We accept RSA keys of 4096 bits or more, Ed25519 and Ed448. If a key has expired or been revoked, we'll tell you." — helper under the key box
- "Key accepted" — status chip
- "Fingerprint (your account ID)" — row label
- "If your key carries contact details, X2F never shows or uses them. For full privacy, use a key without any." — line (build says "If your key contains an email address…")
- "You cannot create your PGP key with X2F, because that would put your private key at risk." — line
- "Read the FAQ for more help." — link

## SetupPgpChallenge
- "Step 3 of 5 · part 2" — stepper label
- "Decrypt your first login code" — screen title
- "You'll do the same thing each time you log in." — lead
- "Copy the encrypted message below." / "Decrypt it in your PGP app (Kleopatra, GPG Suite or OpenKeychain)." / "Paste the code from inside the message." — steps (also on Login)
- "Expires in 4 min 12 s" — timer line
- "Code from the message" / "Paste the code" — field label and placeholder (also on Login)
- "Check the signature before you paste" — heading (also on Login)
- "Your PGP app should show a good signature from the official X2F key, and the message should name X2F and today's date and time. If not, stop. Someone may be trying to phish you." — callout body (also on Login)
- "Key verified" — status chip
- "Every login works this way from now on. X2F shows a message locked to your key, your PGP app unlocks it with your private key, and you paste in the code." — done line
- "Each code works once and expires after 5 min, so a fake site can't reuse one." — done line (build says "5 minutes")
- "Verify" — button

## SetupBackup
- "Add a backup way to log in" — screen title
- "We recommend it. X2F has no way to reach you, so if you lose your key or forget your password, we have no way to let you back in." — lead (build says "X2F has no email address or phone number for you…")
- "Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it, but you are never at risk of losing your funds." — second line (build drops the last clause)
- "Authenticator app" / "Six-digit codes from any authenticator app." — option
- "Security key" / "A YubiKey or similar that you keep somewhere safe." — option
- "Second PGP key" / "A spare PGP key stored separately from your main one." — option
- "Printed recovery codes" / "Ten one-time codes to print or write down." — option
- "Add authenticator app" (and so on per choice) — button
- "Skip for now" — tertiary link

## RecoveryCode
- "Your recovery code" / "Type it back" / "All set" / "Welcome back" — screen titles by step
- "This code gets you back in if every other way to log in is lost. It isn't a way to log in, so you should only ever need it in an emergency." — lead
- "Recovery code" — card heading
- "Recovery code, hidden" — hide button state
- "No 0, O, 1 or I, so it's hard to misread." — line under the code
- "Keep it apart from everything else" — heading
- "On paper, inside a fake rock by the door." / "Buried in the back yard. Draw yourself a map." / "In separate online storage that holds nothing else of yours." — suggestion rows
- "Not next to your password, not on the phone you log in with, and not with your PGP key. If one of those is stolen, this shouldn't go with it." — line
- "Using it logs everyone out and starts a 24 h hold. You'll see how the hold ends and how to end it sooner." — line
- "I've written it down" — tick-box label
- "Tick the box once it's written down." — hint
- "Type your recovery code from where you wrote it down. Dashes, spaces and capitals don't matter." — type-back lead
- "That matches." / "That doesn't match. Check each group against what you wrote down." / "The code has to match." / "Type the whole code to confirm." — field status lines
- "Lost it already?" / "Show the code again" — line and button
- "Your recovery code is set" / "Keep it hidden and apart from everything else." — done title and line
- "Write down your new recovery code" — reminder title (after a code is used)
- "You used your recovery code. Go to Security and write down your new one." — reminder body
- "Go to Security" / "Remind me later" — buttons (Remind me later is OPEN with the owner)

## SetupWallet
- "Where should we send your XMR?" — screen title
- "Choose the wallet you want to be paid to. X2F never holds your coins." — lead
- "For best privacy, turn on Full Sync in Edge's Monero settings. Otherwise Edge's servers can see payments coming in." — helper when Edge is picked (also on Wallet)
- "Receive address from Cake Wallet" / "4… or 8…" — field label and placeholder (also on Wallet)
- "Monero addresses never expire, so reusing one will never make you miss a payout. For extra privacy, you can paste a fresh address from your wallet for each trade." — helper
- "Adding wallets later" — heading
- "This first wallet works right away. Any wallet you add later asks you to confirm it's you, and we always show an alert. Want extra protection? In Security settings, you can make newly added addresses wait 24 h before they can be paid." — body (build has a longer version)
- "Finish setup" — button

## SetupWelcome
- "Account ready" — chip
- "Welcome to X2F, juniper.oak" — screen title
- "Your account is ready. Trade Monero for cash, bank transfers and payment apps, with every trade protected by escrow." — lead
- "Your setup" — heading
- "You log in with PGP key" / "Backup login Authenticator app" / "You get paid to Cake Wallet …k3Fz" — rows
- "You can change any of these later in Settings." — line, Settings is a link (build has no link and adds a fee sentence)
- "Start trading" — button

## Login
- "Log in with passkey" / "Log in with security key" — primary button by method (build says "Use a passkey" / "Use a security key")
- "Username" — field label (build says "Login name")
- "Logging in as nightowl_44" / "Change" — line and button
- "Code from the message" — field label (build has no visible label)
- "Get a new message" — button (build says "Send a new message")
- "Use your passkey" / "Your phone or computer will ask for your face, fingerprint or PIN." — heading and line
- "Have your security key ready" / "When asked, plug it in or hold it to the back of your phone, then touch it." — heading and line
- "Forgot it? Log in with a backup instead. X2F can't reset passwords, because we don't know who you are." — line under the password field
- "Enter the 6-digit code from your authenticator app" / "The code changes every 30 s." — field label and helper
- "Can't log in? Use a backup" — link
- "No account yet? Tap Trade or post an offer, and X2F sets one up on the way." — footer line
- "You're logged in" / "Welcome back, nightowl_44." — done chip and line

## Login-Backup
- "Log in with a backup" — screen title (build says "Use a backup")
- "Your recovery code is your only backup. Use it only if every other way to log in is lost." — lead
- "Username" / "Recovery code" — field labels (build says "Your login name" / "A recovery code")
- "A recovery code you wrote down when you set up your account." — helper
- "Using your recovery code starts a 24 h hold" — heading
- "Everyone on your account is logged out, you and your team members. Nobody can log in until the hold ends." — body
- "You'll see how the hold ends, and how to ask us to remove it sooner." — body
- "Have a security key, passkey or PGP key? Logging in with one, with or without a password, is Strong and has no wait. It isn't a backup, it's a normal login." — callout
- "Use the normal login" — link
- "Continue" — button
- "Hold started" — chip
- "Your account is now on a 24 h hold" — title, held step
- "Everyone on your account has been logged out, including you. Nobody can log in until the hold ends." — body
- "The hold ends 3 Nov 2026, 14:05 UTC at the latest." — body
- "Trades not yet paid into escrow are cancelled. Trades already paid into escrow are put on hold, and a moderator decides how to go on." — body (also on RecoveryHold)
- "Next: how the hold ends, and how to ask us to remove it sooner." — body
- "What happens now" — link
- "The 24 h hold is over. The recovery code you used no longer works. Replace it in Settings once you are back in." — ready step lead
- "Add a new way to log in" — heading
- "Recommended" — tag on PGP key
- "Then you'll log in again with it. Your reviews, offers and wallets are all still here." — line
- "Continue with PGP key" / "Continue with passkey" (and so on) — button

## LoginApprove
- "New login · owner account" — kicker on the approval sheet (build says "New login")
- "Someone is logging in on Chrome, Windows. Is this you?" — sheet title
- "Device" / "Time" / "Where" — row labels
- "Not shown. X2F doesn't log IP addresses, so we can't show where." — Where row value
- "If it's you, tap the number shown on the new device" — label over the two numbers
- "You're logged in on 3 devices, the most allowed. Next you'll choose one to log out." — line (build drops "3 devices")
- "One device at a time is on, so letting them in logs this device out." — line
- "Yes, let them in" / "No, block it" — buttons
- "If you do nothing, the request ends in 4 min 59 s and they stay out." — footnote
- "New login · Chrome, Windows" — kicker on the pick-a-device sheet
- "Choose a device to log out" — sheet title
- "You can be logged in on 3 devices at once. To let Chrome, Windows in, one of these has to be logged out." — body
- "This device · active now" / "Last active 3 days ago" / "Last active 12 days ago" — device rows
- "Log it out and let them in" — button
- "Chrome, Windows is logged in" — done title
- "This device is now logged out, because One device at a time is on." / "You chose this device, so it is now logged out." / "Firefox, Linux has been logged out." — done lines
- "You can see your devices and log any of them out in Devices" — line, Devices is a link
- "Login blocked" / "Wrong number, so we blocked it" — blocked titles
- "Chrome, Windows was not let in. It can't log in, and nothing else changes: you and your team stay logged in." — blocked body
- "The number you tapped didn't match the one on the new device, so that login was blocked to be safe. If it was you, start again on the new device. Nobody else is affected." — wrong-number body
- "Change your login method" — heading
- "If you didn't try to log in, someone else may have your login details. Change how you log in now so they can't try again." — body
- "Change login method" / "Not now" — buttons
- "Approve this login on a device you're already using" — new-device screen heading
- "Your number 47" / "On your other device, tap 47, then Yes, let them in." — number card
- "Waiting for approval. This ends in 4 min 59 s." — line
- "Where do I approve it?" — disclosure
- "Open X2F on a phone or computer where you're already logged in." / "A login request pops up. Check it says Chrome, Windows." / "Tap 47, then Yes, let them in." — steps (build says "Check it names this device.")
- "You're already logged in on 3 devices, the most allowed. To let this one in, one of them will need to be logged out. You'll choose which when you approve." — note
- "One device at a time is on. When you approve, your other device will be logged out." — note
- "You can be logged in on up to 3 devices at once. You're on 2 now, so there's room for this one." — note
- "Only the owner approves new devices. Until this one is approved, it can't log in. Nothing else changes: your other devices and your team carry on as usual." — note
- "No other device with you? Log in with your passkey, security key or PGP key instead. Any of those proves it's you without an approval." — callout
- "Use a passkey, security key or PGP key" — link
- "Only have your username and password? Then your recovery code is the way in, and it starts a 24 h hold." — callout
- "You're in" — approved title
- "Your other device approved this login. Chrome, Windows is now one of your devices." — approved body (build splits it in two)
- "The device you chose has been logged out, so you're still on 3 of 3." / "Your other device has been logged out, because One device at a time is on." — approved notes
- "This login was blocked" — blocked title
- "Your other device said no, or a different number was tapped." / "This device can't log in until it's approved. Nobody else on your account is affected." / "If it was you, try again. You'll get a new number." — blocked lines
- "Try again" — button

## SessionLength
- "You're logged in as mira.k." — identity row
- "How long should this session stay logged in?" — screen title
- "Stay logged in for" / "Choose a length" — drop-down label and empty state (build says "Stay logged in" / "Inactivity timeout")
- "2 h" / "4 h" / "8 h" / "12 h" (traders) and "2 h" / "6 h" / "12 h" / "24 h" (vendors) — options (build says "2 hours")
- "Longer sessions so you don't miss a trade while you sleep. Turn on alert sounds so a new trade wakes you." — helper (also on Devices)
- "When this time is up, we'll ask you to confirm it's you to stay logged in. If you don't, you're logged out." — helper (also on Devices)
- "You can change this any time in Devices and sessions" — line, link
- "Continue" — button
- "Pick a time to continue." — footnote
- "Staying logged in for 4 h" — done line

## SessionExtend
- "Stay logged in?" — screen title
- "Your 4 h session is up. Confirm it's you to stay logged in for another 4 h." — lead
- "Logging out in 1 min 58 s" — countdown line
- "Use my passkey" / "Use my security key" / "Use my password" — method buttons
- "Password" / "6-digit code from your authenticator app" — field labels
- "Stay logged in" / "Log out" — buttons
- "You're logged in for another 4 h." — done line
- "You're logged out" / "Your session time ran out. Log in again to keep trading." / "Log in" — logged-out title, line, button

## RecoveryHold
- "Shown when you log in" — kicker
- "Account on hold" / "Hold ended" — screen title by state
- "Hold ends in" / "23 h 12 min" / "Ends 3 Nov 2026, 13:58 UTC at the latest" — countdown block
- "Your recovery code was used to log in" — heading
- "So your account is on a 24 h hold. If someone stole your recovery code, this stops them from taking over your account." — body
- "Everyone is logged out" — heading
- "You and everyone on your team have been logged out. Nobody can log in until the hold ends, so you can't stay logged in now either." — body
- "Your open trades" — heading
- "Trades not yet paid into escrow are cancelled. Trades already paid into escrow are put on hold, and a moderator decides how to go on. Your trade partners are told there's a technical issue with your account." — body
- "Ask us to remove the hold" — heading
- "Message us on Matrix or Telegram. We'll ask you to confirm it's you over secure Jabber, through Tor. Once that's done, the hold can be removed." — body
- "Matrix @x2f-support:matrix.org" / "Telegram @x2f_support" — contact rows (addresses are examples; OPEN)
- "How the hold ends" — heading
- "You use a passkey, security key or PGP key you had before the hold" / "The owner can end it now with one of these:" / "Security key added 2 Sep 2026" / "Passkey added 14 Oct 2026" — row and sub-lines
- "Not possible for this account: it had no passkey, security key or PGP key before the hold." — row note
- "It ends on its own after 24 h" / "At 3 Nov 2026, 13:58 UTC. Then everyone can log in again." — row
- "A moderator steps in" / "You or anyone on your team can contact a moderator. They can help vet the owner back in, so they can change their login methods. A moderator can also make the hold longer." — row
- "End the hold early" / "Back to log in" — buttons
- "Prove it's you with a login method you had before the hold started." — sheet lead
- "Use my security key" / "Tap your YubiKey or similar key." and "Use my passkey" / "Your face, fingerprint or phone PIN." — sheet options
- "The hold is over" / "You proved it's you with your security key. You're logged in, and your team can log in again." — ended title and body

## Compromised
- "My account has been compromised" — screen title
- "Tell us which account it is. When you send this, we freeze the account straight away, so nobody can use it." — lead
- "Ways to log in you still have" — group heading
- "Tick every one you can still use. A moderator uses these to check it's really you." — helper
- "Password" / "Passkey" / "Security key" / "PGP key" / "Authenticator app" / "Recovery code" / "None of these" — tick boxes
- "Anything else we should know (optional)" / "For example: when you noticed, and what changed" — field label and placeholder
- "Freeze my account" — button
- "Enter your username first." / "Tick at least one box. Choose "None of these" if you have nothing left." — footnotes
- "Check before you freeze" — context line, confirm step
- "Full lockout" — chip
- "Freeze mira.k now?" — confirm title
- "Everyone is locked out at once, you included. Every device is logged out." / "If someone else has your login, they are locked out too." / "Your open trades are paused. Their timers stop, so nobody loses a trade while the account is frozen." / "To unfreeze it, you talk to a moderator, who checks it's really you." — list rows
- "What you told us" / "Still have" / "Comment" / "Nothing ticked" / "No comment" — summary block
- "Yes, freeze it now" / "Go back and edit" — buttons
- "Account frozen" — chip
- "Nobody can use mira.k now" — frozen title
- "We froze it on 1 Nov 2026, 14:05 UTC. Every device is logged out, including any the attacker used." — body
- "Your ticket number CT-20481" — block (format OPEN)
- "Open trades · 2 paused" — heading
- "Selling 0.500000 XMR ($165.00) to nightowl_44" / "Timer stopped with 41 min left" — row
- "Nobody loses a trade because of the freeze." — line
- "What happens next" — heading
- "Message a moderator on Matrix or Telegram and give them your ticket number." / "Message a moderator on Matrix or Telegram and tell them your username." — step 1 (with and without a ticket)
- "They check it's really you, using the ways to log in you still have." / "Together you remove anything the attacker added and set up new ways to log in." / "Then we unfreeze the account, and your paused trades carry on where they stopped." — steps 2 to 4
- "Reach a moderator" — heading
- "Message a moderator on Matrix @x2f-support:matrix.org" / "Or use Telegram @x2f_support" — rows (example addresses)
- "Secure Jabber" / "Not available yet" — row

## InviteInvalid
- "Join a team" — context line
- "This invite link doesn't work" — screen title
- "Link expired" / "Already used" / "Invite cancelled" / "Team full" / "Link incomplete" — chips
- "It ran out." / "Invite links work for 24 hours after the owner makes them. This one has passed that time." — headline and body
- "Someone already used it." / "Each invite link works once. This one was used to join satoshi_ghost's team." — headline and body
- "satoshi_ghost cancelled it." / "The owner cancelled this invite, so the link no longer works." — headline and body
- "satoshi_ghost's team is full." / "The account already has 3 members, the most allowed, so nobody else can join right now." — headline and body
- "We can't read this link." / "Part of it may be missing. Check that you copied all of it." — headline and body
- "Team account" / "Expired" / "Used" / "Cancelled" — row labels
- "satoshi_ghost's team 3 of 3 members" / "An account can have up to 3 members." — team block
- "Wasn't you? Tell satoshi_ghost now. They can switch that member off at once." — line (used case)
- "Ask satoshi_ghost for a new link" / "A new link works for another 24 hours. Open it soon after you get it." — what-to-do title and body
- "If you already joined, go to log in. If not, ask for a link of your own." / "If you still expect to join, check with them. Only the owner can make invite links." / "They need to remove a member first. Then they can make a new link for you." — what-to-do bodies
- "Ask the account owner for a new link" / "Ask them to send it again in one piece, for example in an encrypted chat." — incomplete case
- "Go to log in" — button

## MemberApproval
- "New team member" — chip
- "desk_ana wants to join your team" — sheet title
- "They used your invite link and are logging in for the first time. They can't get in until you approve them." — body
- "Starts with" / "Trade handler (9 of 34 allowed)" — row (was "of 31"; craft pass and p4-8 change it to 34)
- "Review what they can do" — link
- "Team members can never change payout wallets or start a 24-hour hold." — line (also on Team)
- "Approve" / "Refuse" — buttons
- "desk_ana is on your team" / "They're logged in now, starting as Trade handler (9 of 34 allowed)." — approved title and body
- "You can change what they can do or switch them off any time in Team" — line, link
- "Refused" / "desk_ana was removed from your team. Nobody else is affected." — refused title and body
- "Waiting for approval" — chip, member's side
- "Waiting for satoshi_ghost to approve you" — title
- "This is your first login on satoshi_ghost's team. They've been sent a request to let you in." — body
- "Your username" / "You start with" — row labels
- "Keep this screen open. You'll be let in as soon as they approve." — line
- "Approved" / "You're in" / "satoshi_ghost approved you. You start as Trade handler (9 of 34 allowed)." — approved chip, title, body
- "Not approved" / "satoshi_ghost didn't approve this login. Ask them for a new invite." — title and body

## Main
- "How do you want to get paid?" — screen title (Sell side)
- "Market price" / "Offers set their price from this, plus or minus their margin." — card label and line (also on BuyMain)
- "methods" / "buyers" / "best rate" — stat tile labels, new 7 Nov
- "Active trades" — section heading, new 7 Nov
- "Selling to mira.k" / "Waiting for payment · $412.50 · Zelle" — active trade row, new 7 Nov
- "Search 42 payment methods" — search placeholder
- "Most buyers" / "Best rate" / "All payment methods" — sort chips
- "Payment apps" / "Bank transfers" / "Cash & money orders" / "Gift cards & vouchers" — section titles (also on BuyMain)
- "12 buyers paying in USD" / "No USD buyers right now · post an offer" / "up to $331.20" — method row meta
- "No method called "cheque" yet" / "You can post an offer with a custom payment method." / "Post an offer" — empty search state (also on BuyMain, with "sellers")

## BuyMain
- "How do you want to pay?" — screen title (Buy side)
- "methods" / "sellers" / "best rate" — stat tile labels, new 7 Nov
- "Active trades" / "Buying from satoshi_ghost" / "Pay the seller · $412.50 · Zelle" — section and row, new 7 Nov
- "Most sellers" — sort chip
- "12 sellers taking USD" / "No USD sellers right now · post an offer" / "from $330.00" — method row meta

## BuyOffers
- "Buy XMR via Zelle" — screen title
- "Releases in about 8 min" — card line (build says "Releases in ~8 min")
- "Security key" — badge name (build says "Security key verified")
- "Trusted" / "200+ trades and 98%+ positive." — badge and meaning, as the owner set it (p5-3; build still says "100+ trades, 98%+ positive")
- "Clean record" / "No lost disputes in 100 trades." — badge and meaning
- "Veteran" / "Trading on X2F for over a year." — badge and meaning
- "Fast" / "Usually pays or releases within 10 min." — badge and meaning
- "New" / "Joined in the last 30 days." — badge and meaning (build says "new to X2F, still on starter limits")
- "3 more badges" — "+3" button label for screen readers
- "Sellers and prices are examples. You pay no X2F fee when you take an offer." — footer line (second sentence is the user-facing part)

## SellOffers
- "Sell XMR via Zelle" — screen title
- "Pays in about 6 min" — card line (build says "Pays in ~6 min")
- "New trader" — card line where the time line goes, for a trader with 0 trades
- "At market" — price line when the margin is 0

## Fold-Offers (also Fold-TriFold)
- "Sells $50 – $1,500 per trade. Releases in ~8 min." — detail pane line
- "In Cake Wallet, address ending …k3Fz · Change" — wallet line and link
- "Nothing changes after you tap Trade. satoshi_ghost then has 30 min to lock the XMR in escrow. You only pay once it is locked." — line (also on BuyQuote)
- "satoshi_ghost is offline right now. Send a message and trade when they are back." — offline line (Fold-Offers)
- "satoshi_ghost is offline right now. Message them in the chat and trade when they are back." — offline line (Fold-TriFold)
- "Message satoshi_ghost" — tertiary button
- "Taking an offer is free. No X2F fee is added." — footer (also on BuyQuote)
- "Chat with satoshi_ghost" / "Ask before you buy. Nothing is locked yet." — third pane heading and line (Fold-TriFold)
- "No messages with satoshi_ghost yet." — empty chat line (Fold-TriFold)

## FlexOffer-Quote
- "Buy XMR" — screen title
- "USD · market $329.90 / XMR" — context line
- "You pay USD" / "Pay with" — field labels
- "For $500.00 by Zelle. You have 3 completed trades; some offers ask for more on bigger trades." — line under the fields
- "Enter an amount to see each offer's price." — empty line
- "6 offers · best price first" — section heading
- "Band $500.01 – $1,500" / "No band for this amount" — card lines
- "Takes" — label before the method list
- "Releases in about 8 min" — card line
- "Not available to you. satoshi_ghost asks for at least 10 completed trades. You have 3." — unavailable line
- "Not available to you. Zelle: up to $500 only. Pick another way to pay or a smaller amount." — unavailable line
- "4 more offers aren't open to you." — hidden line
- "You pay no X2F fee when you take an offer." — footer
- "Trade with satoshi_ghost" — sheet title
- "You pay $500.00" / "Price $330.00 / XMR" / "0.6% above market · band $500.01 – $1,500" / "You get 1.515151 XMR" — sheet rows
- "satoshi_ghost · Zelle" — instructions title; then the vendor's own instruction text
- "Next you pick which wallet gets paid. Taking an offer is free." — sheet footer
- "Trader" / "Your price" / "You get" / "Band and methods" / "Action" — table headers (wide)
- "Not available" — table chip (wide)

## BuyQuote
- "Network fee" / "Paid by satoshi_ghost" — row (build says "about 0.0001 XMR, taken from the payout"; owner OD-4)
- "Deposit" / "None for this trade" — row (build omits it)
- "satoshi_ghost sells $50 to $1,500 per trade." / "Enter an amount between $50 and $1,500." / "Too low: the smallest trade is $50." / "Too high: the largest trade is $1,500." — amount helper and errors
- "Which wallet gets paid?" / "Add another wallet" — group label and link
- "Nothing changes after you tap Trade. satoshi_ghost then has 30 min to lock the XMR in escrow. You only pay once it's locked." — line above the button

## Badges
Trusted's meaning as the owner set it (p5-3): "200+ trades and 98%+ positive". The boards already carry it; the FAQ answer still says 100, see FAQ.
- "Trusted" / "200+ trades and 98%+ positive." / "Earned 12 Mar 2026" — seal, meaning, date
- "Clean record" / "No lost disputes in 100 trades." / "Earned 2 Jun 2026"
- "Veteran" / "Trading on X2F for over a year." / "Earned 1 Oct 2026"
- "Fast" / "Usually pays or releases within 10 min." / "Earned 20 Apr 2026"
- "PGP verified" / "Logs in with a verified PGP key." / "Since 4 Jan 2026"
- "Security key" / "Protects the account with a hardware key." / "Since 4 Jan 2026"
- "100 trades" / "Completed 100 trades." / "Earned 28 Feb 2026"
- "500 trades" / "Completed 500 trades." / "Not yet: 212 of 500"
- "New" / "Joined in the last 30 days." / "Shown for 30 days"
- "Reputation" / "Speed" / "Security" / "Milestones" / "Newcomer" — badge family labels
- "Online · replies in about 4 min" — trader block line (also on every trade screen)
- "trades" / "positive" / "XMR traded" — stat tile labels (also on OfferAd and trade screens)
- "+3" / "3 more badges" — chip and its spoken label
- "satoshi_ghost's badges" — sheet title on phone (also on OfferAd)
- "3 more badges" — hover card title on desktop (also on OfferAd-Wide)
- "Trade" — button on the card
(The rest of the Badges board is design's explanation, not product copy.)

## OfferAd
- "satoshi_ghost's offer" / "Offer OF-4QK7 · Example" — context lines
- "Vendor" — role tag (also everywhere a vendor is drawn)
- "Online · replies in about 4 min" — trader line ("replies in about" is new 7 Nov)
- "XMR traded" — third stat tile label (new 7 Nov)
- "Selling XMR" / "You buy, pay in USD" — hero chip and line
- "Buying XMR" / "You sell, paid in USD" — hero chip and line, buying side
- "0.1% above market · incl. Zelle" — line under the price
- "$330.00 / XMR" / "Market $329.90 · updates live" — hero number and line
- "Currency" — drop-down label
- "USD · US dollar" / "EUR · Euro" / "GBP · British pound" / "CAD · Canadian dollar" / "ARS · Argentine peso" — currency rows
- "Most used" / "Other currencies, A to Z" — list group labels
- "No rate right now" — tag on a greyed currency (design's pick for Q24/Q25)
- "Pay with" / "Receive by" — payment drop-down label, selling and buying side
- "Zelle · 90 min to pay" — closed payment field, new 7 Nov
- "PayPal · pays in 60 min" — closed payment field on the buying side, new 7 Nov
- "60 min to pay · up to $500" / "+1.5%" — payment row meta, new 7 Nov
- "Opened on your search: USD · Zelle" — line under the drop-downs
- "Price, limits and time updated for CAD · Interac e-Transfer" — line after a change ("Updated for CAD · Interac e-Transfer" on wide)
- "Your currency and payment method are locked in once the trade starts." — line
- "Per trade" / "$200 – $2,000" — limits row
- "Time to pay · 90 min" / "Pays you within · 60 min" — window row, selling and buying side
- "satoshi_ghost's terms" — heading
- "Pay only from an account in your own name. No third-party payments. Memo: the trade code." — vendor's terms (example text)
- "I pay from accounts in my own name, with the trade code in the memo. Release only when the money is in your account, not because of a screenshot." — vendor's terms, buying side (example)
- "Zelle: Send to the Zelle ID in the trade room. Trade code in the memo, nothing else." — method line under the terms (example; one per method)
- "Every trade is accepted by the vendor — never automatic. You send a request and satoshi_ghost accepts or declines it, usually in about 4 min." — info callout
- "2-of-3 escrow" / "X2F never holds your coins. Any two of you, satoshi_ghost and X2F can move them." — escrow row
- "Start a trade" — card heading
- "You send" / "You receive" — amount toggle labels
- "You receive 0.909090 XMR at $330.00" — conversion line
- "Enter an amount." / "This offer takes $200 – $2,000 per trade with PayPal." — field errors
- "No fee for you. The vendor pays the 1%." — line
- "Request to buy XMR" / "Request to sell XMR" — primary button
- "Enter an amount in the range above to send a request." — hint under the disabled button
- "Message satoshi_ghost" — tertiary
- "satoshi_ghost's badges" — badge sheet title

## PostOffer
- "Post an offer" — screen title (also FlexOffer-Post)
- "Step 1 of 4" / "Step 2 of 4" / "Step 3 of 4" / "Step 4 of 4" — step heads, new 7 Nov (also FlexOffer-Post)
- "What you trade" — step 1 heading, new 7 Nov (also FlexOffer-Post)
- "I want to" / "Sell XMR" / "Buy XMR" — side picker
- "Payment method" — drop-down label
- "Currencies" — group label (build says "Currency")
- "Pick up to 5. You set the smallest and largest trade for each one." — helper (also FlexOffer-Post)
- "More" — chip opening the rest of the currencies
- "Your price" — step 2 heading
- "0.8% above market" — margin readout
- "Market $329.90 / XMR right now. Your price follows the market, so it's always $332.54 / XMR at today's rate." — price line
- "Trade size and terms" — step 3 heading, new 7 Nov
- "Trade size in USD" / "Smallest" / "Largest" — labels (build says "Smallest trade" / "Largest trade")
- "Whole units only. Each currency has its own range; nothing is converted." — helper
- "Your terms (optional)" / "e.g. Zelle only from an account in your own name. Put the trade number in the memo." — field and placeholder
- "Who can trade with you" / "Minimum completed trades" / "Anyone" / "5+" / "10+" / "50+" — step 4 heading, label, options (also FlexOffer-Post)
- "How others will see it" / "Selling XMR via Zelle · USD, EUR · you" — preview heading and line
- "Post offer" — button

## FlexOffer-Post
- "2 of 3 selling offers used" — line under the title, new 7 Nov (F8)
- "Market $329.90 / XMR right now. Every band is market ± %; prices follow the market." — line under the currencies
- "Price bands" / "2 of 5 for USD" — step 2 heading and count
- "Set a different price for different trade sizes. Bands are whole units, in order, with no gaps: one ends at 500, the next starts at 501. Each currency has its own bands; nothing is converted." — bands sub-line
- "Band 1" / "From" / "To" — band legend and fields
- "Enter both amounts." / "The From amount must be lower than the To amount." / "Whole units only, no cents." / "This band overlaps band 1." / "This band leaves a gap after band 1." / "Bands must be contiguous: the next band starts at $501." — band errors
- "Price" / "Above market" / "Below market" — band price control, new 7 Nov (F1)
- "Percent" / "Up to 50%." / "Set 50% or less." / "Enter a percent." — percent field, helper and errors, new 7 Nov
- "$332.54 / XMR at 0.8% above market" — price line under the band, new 7 Nov
- "Buyer must have completed at least 10 trades" — band requirement row ("Buyer must have at least 10 completed trades" on wide)
- "Add a band" / "Remove band" — buttons
- "That's 5 bands, the most one currency can have." — limit line
- "Payment methods" / "2 picked" — step 3 heading and count
- "Pick every method you take. Each one has its own payment instructions and can change the price by a percent." — helper
- "Payment instructions for Zelle" / "What the other person needs to know to pay you or get paid." — field label and placeholder
- "For USD" / "Same for all currencies" — per-currency label and tick box
- "Leave it empty and buyers see: Payment method chosen: Zelle. Please post pertinent details in chat window." — empty-instructions helper, new 7 Nov; the quoted sentence is the owner's own words (F2, as sent). Design's lighter alternative, for the owner to take or leave: "Paying by Zelle. Ask the seller for the details in this chat."
- "Price with Zelle" / "Same as band" — per-method price control, new 7 Nov
- "With Zelle: $332.54 to $335.20 / XMR at today's rate." — line
- "Who can trade with you" / "This counts for the whole offer. A band can ask for more." — step 4 heading and helper
- "e.g. I reply within 10 minutes, 8am to 10pm US Eastern." — terms placeholder
- "How others will see it" / "Selling XMR · USD · you · follows the market" — preview heading and line
- "$501 – $1,500 $332.54 / XMR 10+ completed trades" / "Anyone" — preview rows
- "No payment method picked yet" — preview methods line
- "You pay the 1% X2F fee only when a trade on this offer completes." — line under the button
- "Fix the field marked in red to post this offer." / "Pick at least one payment method to post this offer." — block reasons under the button
- "Steps" / "1 What you trade" / "2 Price bands" / "3 Payment methods" / "4 Who can trade with you" — jump card (wide only), new 7 Nov

## GiftCardBrand
- "Gift card brand" — screen title
- "Pick one brand for this offer." — lead
- "Search brands" — search placeholder
- "Most used" / "All brands" / "Matches" / "Proposed" — group headings ("Matches" replaces "All brands" while searching)
- "Proposed" — tag on Home Hardware and Canadian Tire
- "Other" / "A brand that isn't in the list" — row and sub-line
- "Brand name" / "e.g. Chapters Indigo" / "Shown on your offer exactly as you type it." — field label, placeholder, helper
- "No brand matches "Chapters". Pick Other and type the name." — empty search line
- "Cards must be bought in the last 30 days and show their full value." — caution callout line 1
- "Range cards (e.g. a Visa 200–500) need video proof." — caution callout line 2
- "Use this brand" — button
- "Pick a brand first." — hint under the disabled button

## MyOffers
- "My offers" — screen title (design's vote, F5; the owner's other options were My listings, My ads, My posts)
- "3 of 5 on" — context line
- "on" / "selling" / "buying" — stat tile labels, new 7 Nov
- "Select all" / "2 selected" — bulk header and count
- "Selling XMR · USD · CAD" / "Zelle · PayPal +2.0% · 2 bands · follows the market" / "$50 – $2,000 per trade" — offer card lines
- "+0.4% to +0.8%" — price readout ("to" in body text)
- "no rate right now" — tag on a struck currency chip (F4)
- "No rate for ARS right now. Buyers can't pick it until it's back." — caution line under the chips, one currency off (F4)
- "Not live · no rate" — caution chip, every currency off (F4)
- "We can't get a rate for ARS, so this offer can't go live. It goes live by itself when the rate is back." — line, every currency off (F4)
- "On" / "Off" — status chips
- "Paused · trading hold" — chip during a moderator hold
- "Your offers are paused during a trading hold" / "Nobody can see or take them until the hold ends. A moderator wrote in your dispute what to do to get trading back. Trades already started carry on." — hold notice title and body (the owner's Q39 line, "A moderator froze trading on your account. Open your dispute to see what to do to get it back.", is the decided wording for the frozen state; the board still shows the 2 Nov version)
- "Turning an offer off hides it right away. Turned-off offers stay hidden until you turn them back on. Trades already started carry on as normal. You can have 3 buying and 3 selling offers. Each offer can cover several currencies." — footer (the limit sentence is the draft one)
- "Clear" / "Turn on" / "Turn off" — bulk bar
- "Edit" / "Post an offer" — row link and button
- "On" / "Price" / "Per trade" / "Status" / "Edit" — table headers (wide)
- "No offers yet" / "Post an offer to buy or sell XMR." — empty state (matches the build)

## Fold-MyOffers
- "Last edited 2 Nov 2026" — detail pane meta
- "Currencies" / "Price" / "Payment methods" — detail pane headings
- "Per trade" / "Who can trade" / "Time to pay" / "90 min" / "Open trades on it" — detail rows
- "Edit offer" — button
- "On · live for USD, CAD" — status sub-line

## BecomeVendor
- "Account type" — screen title
- "Traders take offers. Vendors post them. Switch when you're ready to post your own." — lead
- "Your account" / "Current" / "Trader account" / "Vendor account" — card
- "You take offers that vendors post. You pay no fee." / "You post offers and can add team members. You pay the 1% fee on completed trades." — card lines
- "1% fee" / "3 members" / "24 h session" — vendor chips
- "Trader vs vendor" / "What changes between a trader and a vendor account" — heading and table caption
- "Post offers" / "Team members (up to 3)" / "Session length" / "Fee on completed trades" — table rows
- "2, 4, 6 or 12 h" / "2, 6, 12 or 24 h" — session cells (the owner's G23 list is 2, 4, 8, 12 for traders; table still says 6)
- "Yours" — tag on the current column
- "For both: when this time is up, we ask you to confirm it's you to stay logged in." — line under the table
- "To become a vendor" — heading
- "A passkey, security key or PGP key" / "A passkey is set up for the owner." / "The owner needs one. A username and password alone isn't enough." — requirement title and status lines
- "Completed trades (example)" / "3 done, 10 needed." / "Not met" — second requirement (OPEN: owner G26 says no requirement beyond a strong key)
- "Add a passkey, security key or PGP key" — link
- "All requirements are met." / "Meet every requirement to switch." / "Passkey, security key or PGP key needed." — footnotes
- "Switching back" / "You can go back to a trader account. You'll stop posting offers." / "After you switch, you can go back to a trader account here." — heading and lines
- "Switch to a vendor account" / "Switch back to trader" / "Post an offer" — buttons
- "You're a vendor. You can post offers." / "You're a trader again." / "Your offers are listed under My offers." — result notes
- "Switch to a vendor account?" — sheet title
- "You can post offers and add team members." / "You pay the 1% fee on completed trades." / "Session length: 2, 6, 12 or 24 h." — sheet rows
- "Switch to vendor" / "Cancel" — sheet buttons
- "Switch back to trader?" / "Pause your offers first" — sheet titles
- "You have 2 live offers. Pause or remove them, then switch back." — sheet body (blocked case)
- "Your 2 live offers are paused." / "Your 2 live offers are removed." / "You can't post offers until you switch again." / "Session length: 2, 4, 6 or 12 h." — sheet rows
- "Go to my offers" — link

## TradeFund
- "Waiting for you to fund" — chip
- "Time to fund 28 min 42 s" / "You have 30 min to fund. If it runs out, the trade is cancelled." — timer and line
- "mira.k is in. Fund the escrow to lock the trade." — heading
- "Once funded, neither of you can take the XMR alone. It's released when you both agree, or by a moderator if there's a dispute." — line
- "You send to escrow" — heading
- "Rate (locked when you fund)" — row label (build says "locked when the trade started")
- "Network fee (fast) 0.000062 XMR" — row (build shows no value)
- "Escrow ready: 3 keys, any 2 release it" / "Yours, mira.k's and the moderator's. One key alone can't move anything." — heading and line
- "Trade completes · you and mira.k sign, XMR goes to mira.k" — row
- "Buyer cancels before paying · the XMR comes back to you" — row (build says "You both cancel: you and mira.k sign, XMR comes back to you")
- "Dispute · the moderator signs with whoever is in the right" — row
- "Open in Cake Wallet" / "Opens Cake Wallet with the escrow address and 1.250000 XMR filled in. You confirm there." — button and footer
- "Use another wallet (QR code or address)" — secondary

## BuyerPay
- "Securing escrow" / "Pay now" — hero chips (Pay now only once escrow is secured, Q12)
- "Confirmations 3 of 10 · about 14 min" / "10 of 10 · secured" — meter lines
- "The seller's XMR is already locked in the escrow. It's secured once the Monero network confirms it 10 times, about 20 min in total. For the safest trade, wait until this finishes before you pay. If you're comfortable with this seller, feel free to move the trade along now." — securing line
- "Time to pay 90 min" / "Clock starts when escrow settles, in 14 min" — timer and line
- "You get 90 min to send the money and tap I've paid. The clock starts once the escrow has settled, so waiting for it never costs you time. If time runs out without that tap, the seller can cancel and get a refund, or give you more time." — timer explanation
- "Payment details" / "They appear when the escrow is secured, in about 14 min." — heading and placeholder line
- "Pay from an account in your own name. Payments from someone else's account may be rejected or frozen. Use at your own risk." — caution line (also on Desktop and the Fold boards)
- "Send exactly" / "$412.50 USD for 1.250000 XMR" — heading and amount (build omits "for 1.250000 XMR")
- "Zelle to" / "Memo" — row labels
- "Our system does its best to blur out private, personal and confidential information automatically, but please double-check every detail yourself before you send it." — line under the own-name line (build lacks it)
- "Add payment proof" / "Private details are blurred for you to check next. Location and device info are removed." — upload row (also on Desktop and Fold-Trade)
- "I've paid" / "Opens once the escrow is secured." — button and hint (build has no hint)
- "Cancel trade" / "Open dispute" — footer
- "Mark this trade as paid?" / "I sent exactly $412.50 by Zelle with the memo K7M2-9QXA-4FTR-8WPN." / "After this you can't cancel the trade. If something goes wrong, open a dispute." / "Yes, mark as paid" / "Not yet" — confirm sheet (also on the Fold boards)

## Desktop
- "Pay now" — chip (escrow-secured state)
- "Escrow funded · 1.250000 XMR locked" — line
- "Time to pay 62 min of 90 min · ends 1 Nov 2026, 15:22 UTC" — timer line
- "(•••) •••-4821" — Zelle contact, masked (what this row shows is OPEN)
- "Online · releases in ~ 6 min" — vendor line
- "Encrypted. If a dispute is opened, a moderator can read this conversation." — chat header line (also on Fold-Trade, TeamChat)
- "Nudge satoshi_ghost with a sound" — nudge button label
- "Trade · Post offer · Wallets · Profile · Settings · Help" — nav rail (build says "Buy · Sell · My trades · Wallets")

## Fold-Cover
- "X2F · + 2 more trades" — header
- "Pay now" / "62 min left" / "Send by Zelle, then tap I've paid" — status, timer, line (build lacks the line)
- "You paid" / "1 h 58 min" / "Left for satoshi_ghost to check and release" — status, timer, line
- "Dispute open" / "Opened 12 min ago" / "A moderator usually replies within 4 h" — status, timer, line (Q38 replaced the 4 h line elsewhere with "A moderator steps in within 24 h at the most. Usually it's much sooner."; this cover still has the old line)
- "Open on main screen" / "Open your phone to keep going." — button and line

## ProofBlur
- "Check your payment proof" — screen title
- "You pay · Zelle" — context line
- "Automatic blur over recipient name. Tap to remove." / "Your blur over account digits. Tap to remove." — blur box labels for screen readers
- "Auto" / "Added" — tags on blur boxes
- "Pinch to zoom" / "Drag to draw a box" / "Tap a blur you added" / "Tap a blur to remove it" — hints over the image
- "This is exactly what satoshi_ghost will see." — preview hint
- "Amount and memo stay visible for the seller." — line under the image
- "Automatic blurs stay on. You can add more, or remove blurs you added." — info line
- "The amount or memo is hidden, so satoshi_ghost may not be able to check your payment." — caution line (owner's draft was "The amount is hidden, so the seller may not be able to check your payment."; build has two sentences)
- "Automatic blurring can miss things." / "Check names, account numbers and addresses before sending." — callout
- "We blur your private details automatically, and you check the result before it's sent. Hidden photo data (EXIF), like location and device, is removed too." — privacy row 1
- "We keep an encrypted unblurred copy that only a moderator can open, and only if there's a dispute. It's deleted automatically when the trade is over." — privacy row 2
- "Add blur" / "Remove blur" / "Undo" / "Preview as seller" — tools
- "We couldn't find a date" / "Neither the photo's data nor the screenshot shows when it was taken. You can still send it. The seller will see this too, so a screenshot with the date showing is better." — G16 callout, new 7 Nov (the owner's words were "we cannot independently confirm the date the image or proof was created, so please take some extra caution with this trade. But it also does not mean that it is not valid.")
- "Send to satoshi_ghost" / "Cancel" — buttons
- "Show this?" / "The seller will see it." / "Recipient name" / "Blurred by AutoX2F" / "Keep it blurred" / "Show it" — reveal sheet
- "Proof sent. satoshi_ghost sees the blurred version." — result line on the trade screen
- "Payment proof sent" / "4 details blurred · photo data removed" / "View" — proof row
- "Blurred details" / "4 on this image" / "Stays on" — keyboard list (wide)
- "What satoshi_ghost sees" / "Photo data Removed" / "Amount and memo Visible" — summary block (wide)
- Proof pop-ups built by the lead (items 63/64/65, not on a board): "Screenshot not current", "Amount not found", "Your explanation", "Redo proof", "Send proof", "Choose another screenshot", "Back", and design's suggested line "Your screenshot shows 2 Nov 2026; this trade started 1 Nov 2026." — all unsigned

## BuyerPaidWaiting
- "Paid" — hero chip
- "You marked this trade as paid at 14:05 UTC. satoshi_ghost has been told and has up to 2 h to check Zelle and release." — hero lead
- "satoshi_ghost's 2 h to check Zelle ended at 16:05 UTC. The XMR is still safe in escrow. You can open a dispute now, or keep waiting and nudge them." — hero lead, ended state (build says "Their … ended at 1 Nov 2026, 16:05 UTC")
- "Time left to confirm" / "1 h 58 min" / "Zelle gets 2 h · ends 1 Nov 2026, 16:05 UTC" — timer block
- "What happens next" — heading
- "satoshi_ghost checks their Zelle for $412.50 with the memo K7M2-9QXA-4FTR-8WPN." — step 1
- "When they release, 1.250000 XMR goes to your wallet once your app co-signs. Keep this page open until it arrives." — step 2 (G1)
- "If something goes wrong, you can open a dispute from 15:35 UTC, 90 min after you marked it as paid. A moderator checks the chat and proof, then decides." — step 3 (F9)
- "Message satoshi_ghost in chat" — link
- "Your payment $412.50 · Zelle" / "Sent to" / "Memo" / "For" / "Marked as paid" / "Payment proof" / "1 screenshot, blurred" / "Add payment proof · optional" — details block
- "Open dispute" / "Available from 15:35 UTC · in 88 min" — button and hint (build says "Open a dispute")
- "Nudge satoshi_ghost" / "Nudge sent. You can send another in 15 min." — button and status (F10)
- "You can't cancel after marking as paid. Tapped it by mistake? Explain in chat or open a dispute." — footer line

## SellerConfirm
- "Selling to mira.k" — screen title
- "Payment sent" — hero chip (build says "mira.k: Payment sent")
- "Check your bank account for $412.50 sent via Zelle." — hero lead
- "Time to confirm 1 h 52 min" / "Zelle gets 2 h · ends 1 Nov 2026, 16:05 UTC" — timer
- "Time you have to check your bank account and release, or report that the money didn't arrive. Instant apps like Zelle get 2 h; bank wires get up to 24 h. If time runs out, mira.k can ask a moderator to step in. Nothing is released without you or a moderator." — timer explanation
- "We checked mira.k's screenshot" — heading
- "Shows $412.50, the right amount" / "Note says K7M2-9QXA-4FTR-8WPN, this trade's code" / "Sender name hidden by mira.k" — check rows (also on Warn-Release)
- "No date found on this screenshot" — check row, G16
- "We can't confirm when this screenshot was taken. That doesn't mean it's fake: check your bank app before you release." — G16 callout
- "Was this proof blurred correctly?" / "Yes" / "No" — Q47 row
- "What was wrong?" / "Help us improve the blur. Your note goes to the X2F team, not to the buyer." / "Send" — Q47 after No
- "Thanks. This helps us improve the blur." — Q47 thank-you
- "Look for a $412.50 payment with the note K7M2-9QXA-4FTR-8WPN in your bank." — line
- "Screenshots can be faked, even a copy of X2F's own screen." / "Only your bank app shows whether the money arrived." — Q46 callout title and body (also on Warn-Release; build has the first sentence only)
- "I checked my bank account myself and the $412.50 from Zelle is there." — tick-box label
- "Hold to release 1.250000 XMR" / "Keep holding…" / "Released 1.250000 XMR to mira.k" — hold button states (build says "…to mira.k" / "1.250000 XMR is on its way to mira.k")
- "Press and hold for 1.5 s. Once released, the XMR can't be taken back." — line under the button (build says "1.5 seconds")
- "Tick the box above to unlock this release button." — line, locked
- "Both signatures sent. mira.k will be asked to rate the trade." — released line
- "See the buyer's view and review" — link
- "Payment not received" / "Open dispute" — footer

## Warn-Release
- "Check your bank account for $412.50 sent via Zelle" — heading
- "Screenshot checks catch mistakes, but only your bank proves the money arrived." — line
- "Payment received" / "Next: tick the box and hold to release" — button and hint
- "Before you release" / "Is the $412.50 really in your account?" — sheet chip and title
- "Only release once the money is really in your account." — sheet row
- "Screenshots can be faked, even a copy of X2F's own screen. Only your bank app shows whether the money arrived." — sheet row (Q46; build says "Check your own bank or Zelle app, not a screenshot. Screenshots can be faked.")
- "Once released, the 1.250000 XMR (about $412.50) goes to mira.k and can't be taken back." — sheet row
- "It's in my account" / "I'll check again" — sheet buttons

## SellerRefund
- "Payment window ended" — chip
- "mira.k didn't mark the payment in time" — heading
- "Your 1.250000 XMR is still safe in escrow. Nudge mira.k, or give them more time." — lead, locked (build says "Your 1.25 XMR is still safe in escrow. You can take it back, or give mira.k more time.")
- "Your 1.250000 XMR is still safe in escrow. You can take it back, or give mira.k more time." — lead, cancel available
- "Last seen 1 h ago" — trader line (offline)
- "If mira.k paid after all" — card title (build says "If you cancel")
- "Even after your refund, mira.k can still open a dispute if they sent the money anyway. A moderator can pause your account from trading until it's resolved, then reviews it fairly. If their payment reached you, you'll be asked to send mira.k the 1.250000 XMR as agreed. Refusing leads to an account suspension and a possible lifetime ban." — card body
- "Check your bank account first. If mira.k's Zelle payment did arrive, release instead of cancelling." — card line
- "Nudge mira.k" / "Give 30 more min" — buttons, locked
- "No word from mira.k? After 90 min and one nudge, you can cancel and get your 1.250000 XMR back." — line under the buttons, locked (G2, g66)
- "Cancel and get refund" / "Nudge again" — buttons, available (build says "Cancel & get refund")
- "You can cancel now. Your 1.250000 XMR goes straight back to your wallet." — line, available
- Seller-side cancel confirmation (design's proposal, p5-2; not yet drawn): sheet title "Cancel and get your XMR back"; body "mira.k hasn't marked the payment. It's been more than 90 min and you've nudged them once, so you can cancel. Your 1.250000 XMR goes straight back to your wallet and this trade closes. Check your bank first: if mira.k's money did arrive, release instead."; buttons "Cancel and get refund" / "Keep waiting"

## CancelRequest
- "Escrow secured" — chip on the trade behind the sheet
- "Time to pay 61 min of 90 min · ends 1 Nov 2026, 15:21 UTC" — timer line
- "Cancel trade" — footer link that opens the sheet
- Cancel confirmation (design's proposal, p5-2, as drawn on the board): sheet title "Cancelling is final"; body "The 1.250000 XMR goes back to satoshi_ghost and this trade closes. Don't send any money after you cancel. If you've already paid, don't cancel: tap I've paid instead." (owner's own words, G56); buttons "Cancel trade" / "Keep trading"
- "Returning XMR to the seller" — chip, returning step
- "Cancelling sends all 1.250000 XMR back to satoshi_ghost. The trade closes when the refund has all 10 confirmations." — returning lead (G2)
- "Refund confirmations 2 of 10 · about 16 min" — meter line
- "Cancelled at" / "1 Nov 2026, 14:20 UTC" / "Going back to" / "satoshi_ghost" / "Trade amount" / "1.250000 XMR · $412.50" / "Charged to you" / "Nothing" — rows
- "Cancelled" — chip, done step
- "What happened" / "You cancelled" / "Refund sent to satoshi_ghost" / "Refund confirmed" — timeline
- "Nothing to do on your side. If mira.k's Zelle payment did reach you, they can open a dispute and a moderator sorts it out. Your offer stays live." — seller's view of a buyer cancel (build adds a "Confirm the cancel" step; the board has no seller action)
- "Back to my trades" / "Find another offer" — footer links
- Note: Fold-Trade and Fold-Tabletop still show the older sheet, "Cancel this trade?" / "You haven't paid, so you can cancel on your own. The 1.250000 XMR in escrow goes back to satoshi_ghost. Don't send any money after this." / "Already sent the money? Don't cancel. Tap I've paid instead, so satoshi_ghost can release." / "Keep trading". Design will align them to G56 once this sheet is signed.
- Pre-escrow cancel line, ready but on no board yet: "Cancel now. Nothing has been sent yet, so nothing needs refunding."

## Refunded
- "You cancelled this trade" — headline, buyer cancelled
- "All 1.250000 XMR in escrow (about $412.50) went back to satoshi_ghost. X2F took nothing from you." — lead, buyer cancelled (G56 removed "If you already sent the payment, open a dispute below.")
- "Payment time ran out" — headline, time ran out
- "You didn't tap I've paid within the 90 minutes, so satoshi_ghost cancelled. Everything in escrow, 1.250000 XMR (about $412.50), went back to satoshi_ghost." — lead, time ran out
- "A moderator decided the dispute" / "Moderator sarah.v ruled for satoshi_ghost. The 1.250000 XMR in escrow (about $412.50) went back to satoshi_ghost." — moderator variant headline and lead
- "Trade amount" / "X2F fee" / "None" — hero rows
- "What happened" / "You cancelled" / "Refund sent to satoshi_ghost" / "Refund confirmed" / "Time to pay ended" / "satoshi_ghost cancelled" / "Your final alert ended" / "You opened a dispute" / "Moderator ruled" — timeline rows
- "Did you send the money anyway?" — dispute card title, time-ran-out variant only
- "Open a dispute and add your payment proof. If the money reached satoshi_ghost, a moderator can rule that they owe you the 1.250000 XMR. Until they pay it back, they can't trade." — dispute card body
- "The moderator's reason" / "Don't agree? You can request an appeal until 1 Nov 2026, 14:05 UTC." / "Read the ruling and appeal" — moderator variant card
- "Find another offer" / "Back to my trades" — footer

## Review
- "Released" / "1.237500 XMR is yours" — chip and headline
- "Released by you and satoshi_ghost. It's on its way to your external wallet ending …k3Fz." — lead
- "Trade amount" / "X2F fee (1%, your ad)" / "You receive" — rows
- "Confirmations 1 of 10" — meter
- "View on the Monero blockchain" / "Opens a public block explorer. It shows the transaction and its confirmations, never the amount or who received it." — link and line
- "4 of 5" — star readout (Q18 "of 5")
- "How was trading with satoshi_ghost?" / "Your review shows on satoshi_ghost's profile straight away." — heading and line (also on Reviews)
- "What stood out?" / "Tap any that fit." — heading and line (also on Reviews)
- "Fast release" / "Clear instructions" / "Smooth trade" / "Would trade again" / "Went quiet" / "Asked for ID" / "Payment didn't match" / "Needs work" — quick chips (also on Reviews)
- "Describe this trade" / "Pick up to 3 badges. They're counted on satoshi_ghost's profile." / "2 of 3 picked" — heading, line, count (also on Reviews)
- "Great communication" / "Patient with a newcomer" / "Exact amount and memo" / "Easy cash handover" / "Went the extra mile" — describe badges (also on Reviews)
- "In your own words (optional)" / "What should other traders know?" — field and placeholder (also on Reviews)
- "Submit review" / "Skip review" — buttons (also on Reviews)
- "Review saved." / "satoshi_ghost can see it right away." and "Review skipped." / "satoshi_ghost sees nothing from you." — result states (Reviews says "It's on satoshi_ghost's profile now." / "Nothing shows on satoshi_ghost's profile, and nobody sees that you skipped.")
- "How's X2F doing?" / "Optional. Your feedback helps shape this community." — heading and line
- "Anything we could do better?" / "Ideas, bugs, payment methods you want…" / "Sent without your username or trade details." — field, placeholder, footnote
- "Send feedback" / "Not now" — buttons

## TradeTechIssue
- "Cancelled" / "This trade was cancelled" — chip and headline, unfunded
- "satoshi_ghost's account has a temporary problem, so this trade can't go ahead. Nothing was paid into escrow, so nothing is lost." — lead, unfunded
- "Paused" / "This trade is paused" — chip and headline, funded
- "satoshi_ghost's account has a temporary problem. Your 1.250000 XMR is safe in escrow and nobody can move it." — lead, you sold
- "satoshi_ghost's account has a temporary problem. The 1.250000 XMR stays safe in escrow." — lead, you bought
- "Your XMR is on its way back" / "satoshi_ghost hadn't sent the payment, so we cancelled the trade and returned your 1.250000 XMR." — headline and lead, refund
- "Back on" / "Your trade is back on" / "satoshi_ghost is back and the trade can continue." — chip, headline, lead
- "You were buying" / "For" / "In escrow" / "Back to your wallet" / "Confirmations 3 of 10" — rows
- "What happens next" — heading
- "We're asking satoshi_ghost whether they already sent your $412.50." / "Not sent: we cancel the trade and return your XMR to your wallet." / "Already sent: the trade waits until satoshi_ghost is back, within 24 hours, so you can check your account and release." / "Don't release until you see the money in your account." — you sold
- "Haven't paid yet?" / "Don't pay now. We'll tell you when the trade can continue or if it's cancelled." — you bought
- "Already paid?" / "Keep your payment proof. The trade continues when satoshi_ghost is back, within 24 hours. A moderator can step in if needed." — you bought
- "If you need us: message the team on Matrix or Telegram with this ID." / "#K7M2Q9XA4FTR" / "Matrix #x2f-help:example.org" / "Telegram @x2f_help" — contact block (ID format and addresses OPEN)
- "We'll message you as soon as we know." — line
- "Find another offer" / "Go to the trade" / "Back to my trades" — buttons
- "Account on hold" / "Your trade is on hold" — held account's pop-up title and heading
- "Your account is on hold, so your trade with mira.k for 1.250000 XMR is on hold too." / "Contact the team on Matrix or Telegram with this incident ID:" / "A team member decides how to go on." — pop-up lines
- "OK" / "Show the incident ID again" — buttons

## SelfDestruct
- "Bought from satoshi_ghost" — screen title (wide)
- "This trade self-destructs on 28 Nov 2026" — heading
- "That's 30 days after it ended. Then the chat, payment proofs and trade details are deleted for both of you and for X2F." / "That's 90 days after the dispute button was pressed on 28 Oct 2026. Then the chat, proofs and dispute evidence are deleted for everyone, moderators included." — explanation lines
- "How deletion works" — button

## Block
- "You blocked nightowl_44. They can't see or take your offers, message you, or see when you're online." — blocked notice (build adds "while they're signed in")
- "Once blocked, nightowl_44 can't:" — sheet lead
- "To block someone, open their profile or your trade chat with them and tap More." — Blocked traders line ("…and choose More." on wide)
- "You blocked nightowl_44. This chat stays open until this trade ends, so you can both finish it." — chat notice
- "Unblocked. They can see your offers again." — undo toast

## CantDoThat
- "You can't do that yet" — sheet title (matches the build)
- "Sorry, you're limited to 2 offers per side (buying or selling) for each currency." — example explanation (out of date: the owner's limit is 3 buying and 3 selling offers, each covering several currencies)
- "If you feel this feature can be improved please leave feedback" — info line
- "Only the owner can do this" / "Needs a Strong login" — titles design asked the build to use in place of "This can't be done on the team"
- "Do this from a device where you logged in with a passkey, a security key or a PGP key." — line design asked the build to use (hold-v3 review P1)
- "This device can log in after 6 Nov 2026, 15:00 UTC. Your account is on a 24-hour hold." / "See the hold" — hold refusal, two sentences and link

## DisputeOpen
- "Opening a dispute" / "Open a dispute" — chip and screen title
- "The seller's time to confirm ran out. A moderator looks at what happened and decides where the 1.250000 XMR goes. It stays locked in escrow until then." — lead (build splits the first sentence into a chip)
- "You · buyer" / "Seller" / "Moderator" / "Not joined" — parties strip
- "A moderator steps in within 24 h at the most. Usually it's much sooner." — hourglass line (Q38; replaces "A moderator usually replies within 4 h")
- "What went wrong?" — group label
- "I paid, but the seller hasn't released" / "The seller isn't replying" / "The seller asked for more money or a different payment" / "Something else" — reasons
- "Tell the moderator what happened" / "When you paid, from which account, and anything the seller said" — field label and placeholder (build has the placeholder; board prefills example text)
- "412 / 1000" — character count
- "Evidence" / "Zelle screenshot" / "Already in this trade, blurred" / "Included" — heading and row
- "Add more evidence" / "Bank statement, receipt or messages. Private details are blurred for you to check. Location and device info are removed." — upload row and helper (build lacks the helper)
- "A moderator will read this trade's chat to decide" / "That includes your messages from before the trade started. They may also ask you for an unblurred copy of your proof." — callout
- "Talk to satoshi_ghost first" / "Go to the chat" — info callout and link (build; design asked for a plain info callout)
- "Open dispute" / "Not now" — buttons (build says "Not now, back to the trade")

## DisputeRoom
- "In dispute" — chip
- "Until a moderator steps in" / "23 h 12 min" — hourglass label and countdown (Q38)
- "A moderator steps in within 24 h at the most. Usually it's much sooner." — hourglass line
- "Taking longer than usual" / "A moderator will step in as soon as they can." — over-24 h state (built; design kept it)
- "You're number 3 in the queue" — meta line design asked the build to keep under the hourglass
- "1.250000 XMR locked in escrow" — amount block
- "Replied in 38 min" — line once the moderator joined
- "X2F Moderator" — role tag
- "Moderator sarah.v joined this dispute" / "She can read this whole chat, including messages from before the trade. Moderators only ever contact you here." — callout (build says "They can read…")
- "Evidence in this dispute" / "Your Zelle screenshot" / "Trade chat" / "Unblurred copy · moderator only" — heading and tiles
- "Chats are encrypted. If a dispute is opened, a moderator can read this conversation." — chat line
- "10:14 · You opened a dispute: I paid, but the seller hasn't released" / "10:52 · Moderator sarah.v joined this dispute" / "10:58 · You sent an unblurred proof to the moderator only" — system lines
- "sarah.v asked you for the unblurred proof. Only she will see it. satoshi_ghost won't." — request callout
- "Send unblurred proof to sarah.v" / "Sent to sarah.v at 10:58" — primary and sent state
- "Message satoshi_ghost and sarah.v" / "Message satoshi_ghost" — composer label

## DisputeRuling
- "Dispute decided" — chip
- "Release to the buyer" / "Refund to the seller" — kicker (build says "Ruling: release to the buyer")
- "The 1.250000 XMR goes to you" / "The 1.250000 XMR went back to satoshi_ghost" — headline (build says "1.250000 XMR goes to satoshi_ghost")
- "Sent to Cake Wallet, address ending …k3Fz." — line (build says "Goes to your wallet…"; pending payout API)
- "The XMR moved as soon as the decision was made. Coins are never held while an appeal is open." — line (also on Appeal-Notice)
- "sarah.v" / "X2F Moderator" / "29 Oct 2026, 14:05 UTC" — decided-by row
- "Fee: 1% paid by satoshi_ghost, as the offer poster." — fee row, trade completes (g63; build has a caution notice)
- "Fee: none. Everything went back, so X2F charges nothing." — fee row, full refund (g63)
- "Fee: waits until the appeal is decided." — fee row, appeal open (g63)
- "Reason" / "Evidence used" — headings
- "mira.k's Zelle screenshot, blurred and unblurred" / "satoshi_ghost's Zelle activity screenshot" / "The trade chat, 09:40 to 13:55" — evidence rows
- "Appeal" / "47 h 40 min left" — card title and countdown (build says "Appeal window")
- "Either of you can appeal until 31 Oct 2026, 14:05 UTC (48 h). An appeal goes to a senior moderator who hasn't seen this case." — appeal line
- "If an appeal overturns the ruling, you get a lien. You can't trade until you pay the XMR back." / "If your appeal wins, satoshi_ghost gets a lien. They can't trade until they pay you back." — appeal tail, release and refund (build ends "There is one appeal per dispute, and its decision is final.")
- "Why should it be looked at again?" / "What the moderator missed, and any new evidence" — field and placeholder
- "File appeal" / "Send appeal" / "Cancel" / "Back to my trades" — buttons (build says "Appeal this ruling")
- "Appeal sent. A senior moderator will look at it. The XMR has already moved; if they overturn the ruling, the other trader gets a lien until they pay it back." — sent line
- "This ruling and its evidence are kept with the trade." — footer line
- "It appears on your profile as a lost dispute." / "It appears on satoshi_ghost's profile as a lost dispute." — footer tail, refund and release
- "Prove you sent it" / "Your wallet shows the transaction ID and the transaction key once the XMR is sent." / "Send it by 2 Nov 2026, 14:05 UTC." / "satoshi_ghost has until 2 Nov 2026, 14:05 UTC to send it." / "TRANSACTION ID" / "TRANSACTION KEY" / "Send proof" — the build's proof form for a seller who must send XMR (no board)

## Appeal-Notice
- "Dispute decided" / "Refund to the seller" / "The 1.250000 XMR went back to satoshi_ghost" — chip, kicker, headline
- "Read the full ruling" — link
- "Appeal" / "47 h 40 min left" — card
- "Don't agree with the moderator's decision? Request an appeal. You have 48 hours (until 31 Oct 2026, 14:05 UTC)." — body
- "If your appeal wins, satoshi_ghost gets a lien. They can't trade until they pay you back." — line
- "An independent reviewer, a senior moderator who hasn't seen this case, reads this along with the chat and proofs. Their decision is final." — line under the field
- "Your appeal" / "Appeal filed" / "Waiting for an independent reviewer" / "Appeal decided" — status list
- "Your appeal is in and satoshi_ghost has been told. We're now finding an independent reviewer." / "Waiting for an independent reviewer. Nothing more is needed from you, but you can add new evidence in the trade chat." / "An independent reviewer has decided your appeal." — status lines
- "A senior moderator who hasn't seen this case looks at the chat, the proofs and your reasons again." / "You'll get an alert as soon as it's decided." — step details
- "Appeal open until 31 Oct 2026, 14:05 UTC" — chip
- "Appeal decided: overturned" / "satoshi_ghost must send you 1.250000 XMR" — chip and heading
- "Reviewer elena.t found that your $412.50 did reach satoshi_ghost. They must send you the 1.250000 XMR as agreed. They now have a lien and can't trade until they pay it back." / "You'll get an alert when it arrives. This decision is final." — body
- "The appeal window closed on 31 Oct 2026, 14:05 UTC. The moderator's decision is final." — closed line (build has the first sentence only)
- "Completed trades" / "Dispute: refunded to seller · 29 Oct 2026" — list screen title and row status

## Lien-Notice
- "Account notice" / "Trading paused" — context line and chip
- "Trading paused until you repay mira.k" — headline
- "An appeal decision on trade K7M2 went against you. The Monero network fee comes from your wallet." — lead
- "You owe" / "1.250000 XMR" / "$412.50" — amount block
- "This is a lien. You can't post offers or start new trades until you pay it back." / "Trades already running carry on as normal." / "Your coins are never touched. They stay in your own wallet." — what-this-means rows
- "The appeal decision" / "Trade" / "Decided by" / "elena.t, senior moderator" / "Decided" — card and rows
- "Fee: 1% paid by you, as the offer poster." — fee row (g63)
- "mira.k's $412.50 Zelle payment did reach your account, so the trade stands as agreed." / "The first ruling sent the XMR back to you as soon as it was made. mira.k appealed within the 48-hour window, and the appeal overturned it. That's why you now owe the XMR." — reason lines
- "Read the decision" — link
- "If you don't repay, your account can be banned." — line
- "Repay 1.250000 XMR" — button
- "Repayment trade started" / "Send 1.250000 XMR to mira.k from your wallet in the repayment trade. The app records a payment proof the senior moderator can check. Trading comes back as soon as it's confirmed." — started state
- "Go to the repayment trade" / "Questions? Ask the team" — links

## Ban-Notice
- "Account notice" — context line
- "Trade ban" / "Temporary ban" / "Account banned" — chips
- "You can't trade right now" — headline, trade ban
- "Your account has been banned" — headline, site ban
- "We're sorry. If you think this was a mistake, message a moderator on Matrix or Telegram and ask for the details." — lead, site ban (design's tightening of the owner's G39 words: "We're sorry, but your account has been banned. If you feel this has been done in error, please reach out to a moderator at [Matrix Channel] [Telegram Channel] and ask to speak to a moderator for further details.")
- "We're sorry. Your account can't start or join new trades. If you think this was a mistake, message a moderator on Matrix or Telegram and ask for the details." — lead, trade ban
- "Ends" / "14 Nov 2026, 14:05 UTC" / "Permanent · until a moderator lifts it" — row (timed vs permanent, Q15)
- "Reason" / "Three trades in a row were not paid." / "You sent the same seller a fake payment screenshot." — row and example reasons
- "Finish open business" / "You can still log in, but only to finish these." — heading and line
- "1 open trade" / "Buying 0.500000 XMR ($165.00) from nightowl_44" / "1 payout still arriving" / "0.800000 XMR ($264.00) to your wallet" — rows
- "What this means" — heading
- "You can still log in, look at offers and use your wallets." — row, trade ban
- "Once everything is finished, you won't be able to log in again until the ban ends." / "Once everything is finished, you won't be able to log in again." / "Nothing on your account is left open, so you can't log in while the ban lasts." — row, site ban
- "Your XMR isn't affected. Your wallet keys are on your device, so no one can freeze your coins." — row
- "Think this is a mistake?" — heading
- "Message a moderator on Matrix" / "#x2f-help:example.org" / "Or use Telegram" / "@x2f_help" — contact rows (addresses OPEN)
- "OK" / "Log out" — buttons

## HoldChange
- "4 changes waiting to take effect on 7 Nov 2026, 15:00 UTC" / "Review changes" / "Cancel these changes" — banner
- "Review your changes" / "Hold started" / "Security" — screen titles by step
- "4 changes · up to 20" — count line (G36)
- "Owner · logged in with just a username and password" / "Owner · logged in with a passkey" — who line
- "Weak login" — chip
- "Changes here will start a 24-hour hold" — warning title
- "You logged in with just your username and password, so changing your login methods, wallets or team starts a 24-hour hold." — warning body
- "Removals take effect now and become final after 24 h. Everything else applies after 24 h." — warning body (G5; contradicts g65, see the note at the end)
- "We strongly recommend adding a passkey, security key or PGP key now, so this doesn't happen again." — warning body
- "Want them sooner? A passkey, security key or PGP key you already had can approve them now, or message a moderator." — warning body (address OPEN)
- "Adding one is a change too, so it's part of this hold. Next time, log in with it and your changes won't start a hold." — warning body
- "Add stronger security" / "Continue anyway" — warning buttons
- "Login methods" / "Wallets" / "Team" — groups
- "Passkey on Pixel 8 · added 12 Jan 2026" / "Will be removed" / "Cake Wallet · …k3Fz" / "(new)" — change rows
- "Add a passkey, security key or PGP key" / "Add a wallet" — buttons
- "Security key" / "Tap a YubiKey or similar key." / "Passkey" / "Your face, fingerprint or phone PIN." / "PGP key" / "Decrypt a short message in your PGP app." — add-method options
- "Nothing changes until you submit. Submitting starts a 24-hour hold." / "Nothing changes until you confirm." — footer lines
- "24-hour hold" / "Strong login" — review chips
- "Before" / "After" — column labels
- "Applies after 24 h" / "Takes effect now · final in 24 h" / "Usable after 7 Nov 2026, 15:00 UTC" / "Access ends now · final in 24 h" / "Applies when you confirm" — change badges (review step)
- "Applies in 23 h 12 min" / "Removed now · final in 23 h 12 min" / "Logged out now · removed in 23 h 12 min" / "Usable in 23 h 12 min" / "Applies now" — effect lines (approve step, g65)
- "Ticked to apply" / "3 of 4" / "Won't apply" — tick count and unticked row label
- "Applies after a 24 h wait" / "You logged in with just a username and password. Removals take effect now and become final after 24 h. Everything else applies after 24 h. Anyone logged in can cancel during the wait." — callout
- "Add a passkey, security key or PGP key and changes like these go through at once." / "Add one" — encouragement and link
- "Before you submit" — heading
- "If you log in with a passkey, security key or PGP key you had before the hold, you see these changes waiting and can approve them now, make changes or cancel all changes." — row
- "We tell the account owner straight away on every channel you set up, like push and secure Jabber, with a list of these changes." — row
- "Your login is strong, so these apply as soon as you confirm." — strong-login line
- "Submit changes" / "Confirm changes" / "Review" / "Back to editing" — buttons
- "Changes waiting for you" — approve-step title (G58)
- "Submitted with just a username and password. Your login is strong, so you can decide now." — approve-step lead
- "Time left" / "23 h 12 min" / "They apply on their own when the time is up." — countdown block
- "When" / "Applies now" — strong-login variant
- "Submitted by" / "You · username and password" / "Apply on their own" / "7 Nov 2026, 15:00 UTC" — rows
- "Approve now" / "Apply changes" / "Make changes" / "Cancel all changes" — approve-step buttons
- "Changes submitted" / "Changes applied" — done titles
- "Removals have taken effect. Everything becomes final after 24 h." / "Your login is strong, so there was no wait." — done lines
- "Changes" / "Final on" / "6 Nov 2026, 15:00 UTC" — done rows
- "How the hold ends" — heading
- "It ends on its own after 24 h" / "Your changes then become final." — row
- "You log in with a passkey, security key or PGP key you had before" / "You see the changes waiting for you and choose: Approve now, Make changes or Cancel all changes." — row
- "A moderator steps in" / "If you or a team member contacts a moderator, they can make the hold longer, or verify you so your changes apply sooner." — row
- "Back to Security" — button
- "Cancel these 4 changes?" / "None of these changes will apply." / "Cancel changes" / "Keep them" — cancel sheet

## Maintenance
- "Trading paused" — chip on the offers header behind the notice
- "Emergency maintenance" / "Planned maintenance" — chips (G19: no "emergency" default; reason is internal)
- "We'll be back soon" — headline, unplanned (build says "X2F is down for maintenance")
- "Down for planned maintenance" — headline, planned
- "The system has been taken down for unscheduled but necessary maintenance. It will be back as soon as possible." / "From the X2F team 29 Oct 2026, 09:12 UTC" — message and signature
- "All trade timers are paused, so nobody loses a trade. They start again when we're back." — line (g62)
- "Start and end" / "Sat 7 Nov 2026, 02:00–04:00 UTC" — planned block
- "We announced this in News on 31 Oct 2026. New offers and new trades are off until it ends." — planned line
- "What still works" / "Trades already in escrow. You can release, refund or open a dispute as usual." / "Your XMR. Your wallet keys are on your device." — heading and rows (rule check with the owner: the build replaces the whole app)
- "Get updates" / "Check News or join our Matrix or Telegram" — heading and line
- "Check News" / "Join Matrix" / "Join Telegram" — buttons (build says "Check again")

## Settings
- "New password from 8 Nov 2026, 15:00 UTC" / "Your old password works until then. If you didn't make this change, log in with it and cancel." — result card, g64, new 8 Nov
- "Account" / "Security" / "Wallets" / "Team" / "Alerts" / "Privacy" / "About" — group headings
- "Display name" / "mira.k · public" — row
- "Username" / "Used to log in · private" — row
- "Account type" / "Trader · switch to Vendor to post offers" / "Vendor · posts offers and can have a team" — row
- "Badges" / "Which earned badges show, and where" — row
- "Profile visibility" / "What other traders can see" — row
- "Login methods" / "PGP key · Passkey · Password" — row
- "Devices in use" / "2 of 3" — row
- "Recovery code" / "Written down 14 Oct 2026" — row
- "Session length" / "asked at every login" / "4 h" — row (traders 2/4/6/12 in the notes; owner's G23 list is 2/4/8/12)
- "New payout wallets wait 24 h" / "A fresh address per trade also waits. Save a few in advance." — switch row
- "Require a security key to fund or release" / "A tap on your hardware key before coins move" — switch row
- "One device at a time" / "Approving a new device logs out the one you were using" — switch row
- "Your wallets" / "Cake Wallet ···k3Fz · Feather ···9pQa" — row
- "Team members" / "roles, invites, on or off" / "2 of 3" — row (vendor)
- "Team members" / "Vendor accounts only" — row (trader)
- "Nudges" / "Quiet hours 01:00–07:00" — switch row
- "Alerts and sounds" / "New trades, messages, logins" — row
- "What X2F keeps" / "No IP address, name or phone number" — row
- "Chats are deleted after 30 days" / "Disputes are kept 90 days" — row
- "Trade volume line on profile" / "Shows "X XMR traded to date"" — switch row
- "Help and FAQ" / "Trades, logins, wallets and privacy" — row
- "Terms" / "Version accepted 14 Oct 2026" — row
- "News" / "What changed in X2F" — row
- "Support" / "Ask a Helper or see your tickets" — row ("Helper" is the staff role name; see Support for the decided headline)
- "Log out" / "Delete account" — buttons

## Devices
- "Devices and sessions" — screen title
- "See where you're logged in, log devices out, and choose how long a session lasts." — lead
- "2 of 3 devices logged in" — meter line
- "You're at the limit. To let a new device in, you'll pick one to log out." / "One more device can log in." / "2 more devices can log in." / "One device at a time is on, so only this device stays logged in." — meter notes
- "Your devices" — heading
- "Firefox on Linux" / "This device" / "Active now" / "Chrome on Android" / "3 h ago" / "Safari on macOS" / "12 min ago" — device rows
- "Log out" / "Log out all other devices" — buttons
- "Log out Chrome on Android?" / "It's logged out right away. To use it again, approve it from a device you're still logged in on." — sheet
- "Log out 1 other device?" / "Log out 2 other devices?" / "2 devices logged out right away. Only this device stays logged in." — sheet and result
- "Chrome on Android was logged out." / "All other devices were logged out." — result notes
- "Team members logged in" — heading
- "These are your team members' logins, not yours." / "Team members' logins don't count toward your 3 devices." / "Switching a member off or on needs a two-factor method you've already set up: a passkey, security key or PGP key." — lines
- "desk_ana" / "Team member" / "Chrome on Windows · 4 min ago" / "Logged out · can't log in" / "Switched off" / "Can log in" — member rows and chips
- "No team members are logged in." — empty line
- "Log out all team members" / "Manage roles and invites in Team" — button and link
- "Switch off desk_ana?" / "desk_ana is logged out now and can't log in until you switch them back on. Their roles are kept." / "Switch off" / "Keep them on" — sheet
- "Log out desk_ana?" / "desk_ana's session on Chrome on Windows ends right away." — sheet
- "desk_ana is switched off and was logged out." / "desk_ana was logged out of Chrome on Windows." / "Every team member is logged out right away. They can log in again unless you switch them off." — result notes (build drops the second sentence of the last)
- "Options" — heading
- "One device at a time" / "When on, approving a new device logs out the one you were using." — switch row
- "Turning this on logs out your 2 other devices now. Only this device stays logged in." / "Turn on" / "Keep it off" — confirm
- "Stay logged in for" / "Choose a length" / "4 h" — drop-down (F18: this session only)
- "Saved." — note
- "How a new device gets in" / "Three ways in, from the usual one to the last resort." — heading and line
- "Usual way" / "Approve it on a logged-in device" / "Your other devices ask "Is this you?". Tap the 2-digit number the new device shows. Say no and the login is blocked." / "See the approval prompt" — row
- "No other device with you?" / "Log in with a passkey, security key or PGP key." / "Log in another way" — row
- "Last resort" / "Only have your username and password?" / "Use your recovery code. It starts a 24 h hold, and everyone on your account is logged out until it ends." / "How the hold works" — row
- "X2F doesn't log IP addresses, so devices are named only by browser and system." — footnote
- "Confirm it's you" / "Switching desk_ana off needs a passkey, security key or PGP key." / "Use my PGP key" / "Use my passkey" / "Use my security key" / "Cancel" — verify sheet
- "24 h wait" / "This change waits 24 h" — chip and sheet title
- "You logged in with just your username and password, so switching team members on or off takes effect after 24 h. Until then everything keeps working as it does now. Add a passkey, security key or PGP key to make changes like this straight away." — sheet body
- "Want it sooner? Message us on Matrix (@x2f-support:matrix.org) or Telegram (@x2f_support)." — sheet line (addresses OPEN)
- "Add stronger security" / "Submit and wait 24 h" — sheet buttons
- G46: the build's five Devices wording items are still to come from the lead; design writes them.

## Wallet
- "X2F never holds your coins. Link the Monero wallets you already use: you get paid to them and fund trades from them." — intro sentence
- "Linked wallets" / "Ready" / "Added today" / "· gets payouts" / "· for large trades" — heading, status, roles
- "Add a wallet" / "Which app is it in?" — heading and label
- "Saving asks you to confirm it's you. Want extra protection? In Security settings, you can make new wallets wait 24 hours before they can be paid." — helper (build has a different rule sentence)
- "1 escrow key on this device for trade K7M2-9QXA-4FTR-8WPN. It holds no coins, is backed up to your PGP key and is deleted when the trade closes." — escrow key line (build says "It holds no coins. It stays on this device and is deleted when the trade closes.")
- "Save wallet" — button

## Alerts
- "Recommended on phones without Google services." — line under the Android battery switch

## Profile
- "Trader profile" — context line
- "Online · member since Mar 2025" — line under the name
- "completed trades" / "positive (198 reviews)" / "typical payment time" / "trades cancelled" — stat labels
- "41.7 XMR traded to date" — opt-in volume row (Q63)
- "Badges" / "Choose badges" — heading and link
- "PGP verified" / "Logs in with a verified PGP key." / "Since 4 Jan 2026" (and the other seals as on Badges) — seal rows
- "Recent reviews" / "31 Oct 2026 · Zelle" / "Fast payment · Clear instructions" / "Paid in five minutes, memo exactly as asked." — heading and example review
- "Signed trade history available · Verify" — line and link
- "Account protected with PGP" — chip
- "Offers (3)" / "Message" / "More" / "More: block or report" — buttons

## ProfileVisibility
- "Profile visibility" / "Choose what other traders see on your profile and ads." — title and lead
- "Trade volume" / "Show my trade volume" — heading and switch
- "Shows "X XMR traded to date" on your profile and ads, rounded down to 0.1 XMR. Counts X2F trades only; imported volume shows on its own line." — switch helper (G54)
- "On your profile and ads" — preview heading
- "41.7 XMR traded to date" / "Imported from LocalMonero: 120.0 XMR" — preview lines (Q63, Q64; owner p4-1 now wants imported volume in US dollars, "$X+ on <site>, verified", so the imported line changes)
- "Nothing about your trade volume is shown." / "Shows once your total reaches 0.1 XMR." — preview states
- "Your X2F total so far" / "41.738201 XMR" / "Imported from LocalMonero" / "120.000000 XMR" / "Shown as" / "41.7 XMR" / "Only you can see this" — rows

## BadgeSettings
- "Your badges" — screen title
- "On your offers" / "Featured 2 of 2" — preview heading and count
- "Trusted moved to When tapped. Only 2 badges can be featured." — notice
- "Earned" — heading
- "When tapped: Shows behind +N on your offers. Buyers tap it (or point at it on a computer) to see it." — helper (design's name for the middle option, G38)
- "Featured" / "When tapped" / "Hidden" — visibility choices per badge
- "Next milestones" / "500 trades 212 / 500" / "Clean record 88 / 100" — heading and rows
- "The New badge always shows while you have it and can't be hidden." — footnote

## Feedback
- "Tell us what you think" — screen title
- "A complaint, feedback, a recommendation, anything at all. Every message is read." — lead
- "You've sent 10 today" / "To stop spam, you can send up to 10 messages a day. You can send more tomorrow." — Q67 limit callout
- "Your message" / "Write anything you like" / "1,204 of 2000 characters" — field, placeholder, count
- "Send anonymously" / "Your username isn't attached, so we can't follow up with you." / "Sent with your username, mira.k, so we can follow up if needed." — switch and hints (build says "…so X2F staff can message you for details.")
- "Send" — button
- "Thank you!" / "Each and every comment is appreciated and reviewed to help make this community a better place for us all." / "Sent anonymously." / "Sent as mira.k." — thank-you state
- "Done" / "Write another" — buttons

## Team
- "Team" — screen title
- "Let people you trust work your trades. Each member has their own login with a passkey, security key or PGP key. There are no shared passwords." — lead
- "Team members are for Vendor accounts only." — line
- "You, the owner" — tag on the owner row
- "members" / "logged in" / "invites open" — stat tile labels
- "Team members · 3 of 3" — heading
- "Team member" — role tag
- "Active 4 min ago" / "Last active yesterday" / "Member since 2 Sep 2026" / "Invite not used yet" / "Switched off" / "Logged in ·" / "Logged out ·" — member meta
- "Edit what they can do" / "9 of 34 allowed · Trade handler" — link and line (totals now "of 34", p4-8)
- "Starts from: Trade handler (9 of 34 allowed)" — invite row line
- "Switch off" / "Switch back on" / "Cancel invite" — row buttons
- "Switching a member off logs them out at once. Up to 3 members per account." — line
- "Adding a member or changing what they can do needs a passkey, security key or PGP key." / "You approve each new member's first login." / "Members' logins don't count toward your 3 devices." / "During a 24-hour hold, all team changes wait until the hold ends." — rows
- "What members can do" / "You choose for each member, switch by switch. Start from a preset, then fine-tune." — heading and line (MemberPermissions now uses member types, not presets; this line is out of date)
- "Chat only" / "See trades and reply in trade chat." / "Offers manager" / "Post, edit and pause offers, plus trade chat." / "Trade handler" / "Accept trades, confirm payment, cancel, disputes and chat." / "Everything allowed" / "Every permission." — preset names and descriptions ("Every permission." changed 7 Nov)
- "Sensitive permissions, like releasing XMR, warn you before they turn on." / "Trades are never accepted automatically." — lines
- "Only you can" — heading
- "Change payout wallets" / "Add or remove members and change what they can do" / "Change login methods and security settings" / "Manage sessions and devices" / "Change the account type" / "Delete the account" — rows
- "Members can never change payout wallets or start a 24-hour hold." — line
- "What trade partners see" / "Your username, with a Team member label on chat replies a member sends. Never which member. All reviews and reputation go to your account." — heading and line (build names the member; contradicts the board)
- "Every action is recorded" / "Everything a member does goes in an audit log for you, the owner. It can't be edited." / "Audit log" — heading, line, link
- "You have 3 members, the most allowed. Remove one to add another." — footer line
- "Add a member" — button
- "Pick a name for them. Only you and your team see it, never your trade partners." / "Member name" / "desk_lee" — sheet lead, label, placeholder
- "Start from" — label
- ""Everything allowed" turns on sensitive permissions: releasing XMR. They work as soon as you approve the first login." — sheet caution
- "You can fine-tune every permission after they join. This needs your passkey, security key or PGP key. During a 24-hour hold it waits until the hold ends." — sheet line
- "Create invite link" / "Cancel" — sheet buttons
- "Confirm it's you" / "Adding desk_lee to your team needs a passkey, security key or PGP key." / "Switching desk_sam off needs a passkey, security key or PGP key." / "Use my passkey" / "Use my security key" — verify sheet
- "Send desk_lee this link" — sheet title
- "Copy link" / "Link copied" — button
- "It works once and expires in 24 hours, at 2 Nov 2026, 14:05 UTC." / "Send it privately, for example in an encrypted chat. Anyone who has the link can use it." / "When they open it, they set up their own login with a passkey, security key or PGP key." / "You approve their first login. They start as Trade handler." — rows
- "Invite link made for desk_lee. It expires in 24 hours." — note
- "Done" — button
- "Remove desk_sam?" / "They are logged out now and their login stops working. What they did stays in the audit log." / "Remove desk_sam" — remove sheet
- "desk_sam was removed and logged out." / "desk_sam is switched off and was logged out." / "desk_sam is switched on again and can work after logging in." / "Invite for desk_lee cancelled. The link no longer works." — notes
- "Members can't use a stronger login than the team lead's." — footer line, new 8 Nov (p4-8)

## MemberPermissions
- "What desk_ana can do" — screen title
- "Settings · Team" / "Choose exactly what this member can do for you. Nothing changes until you save." — context line and lead (wide)
- "In 2 of 5 types · 9 of 34 things allowed" — summary line
- "Member types" — heading
- "Switch a type on, then tick what desk_ana can do in it. A member can be in one type, several or all five." — line
- "Chat" / "Offers" / "Trades" / "Records" / "Holds and waiting changes" — type names
- "5 of 7 allowed" / "Off · 2 of 7 ticked" — type counts
- "Switch on Records to use these. Your ticks are kept." — off hint
- "Without these, desk_ana only sees that a hold is on." — Holds type description
- Chat: "Read trade chats" / "Reply in trade chats" / "Send payment details in chat" / "Upload proof in chat" / "Nudge the other trader" / "See the trader's profile notes" / "Block a trader"
- Offers: "See all offers" / "Turn offers on or off" / "Edit prices" / "Edit amount bands" / "Edit payment types and instructions" / "Edit currencies" / "Post a new offer" / "Delete an offer"
- Trades: "Accept a trade" / "Decline a trade" / "Mark "I've paid"" / "Confirm payment received" / "Release XMR" / "Ask to cancel" / "Open a dispute" / "Reply in a dispute" / "Leave feedback"
- Records: "See trade history" / "Export trade history" / "See team activity log" / "See payout amounts" / "See reviews" / "Reply to reviews" / "See support tickets"
- Holds and waiting changes: "See waiting changes" / "Untick or cancel waiting changes" / "End a hold"
- "Sensitive" — chip on Release XMR
- "They can send XMR from your escrow. Only for someone you trust fully." — caution under Release XMR
- "Never available to members: wallets, security, sessions, team settings, account type and deleting the account." — line (design recommends adding "holds")
- "Saving needs your passkey, security key or PGP key. With just a username and password, the change waits 24 h." — line
- "Members can't use a stronger login than the team lead's." — line
- "Save permissions" / "Cancel" — buttons
- "Let desk_ana release XMR?" / "They can send XMR from your escrow to finish trades. Only for someone you trust fully." / "Allow releasing XMR" / "Keep it off" — sheet
- "Confirm it's you" / "Saving 9 of 34 permissions for desk_ana needs a passkey, security key or PGP key." / "Use my passkey" / "Use my security key" / "Use my PGP key" — verify sheet
- "Saved. desk_ana is in 2 of 5 types." — note

## TeamRefusal
- "Weak login" — chip
- "You logged in with just your username and password. Team changes need a passkey, security key or PGP key." — notice
- "Add another way to log in" — button
- "Team members · 2 of 3" / "9 of 34 allowed · Trade handler" — heading and row
- "You can still see your team here. Adding members and changing what they can do are locked on this device." — line
- "You can't add members from this device" / "You can't change what desk_ana can do from this device" — sheet titles
- "Passkey, security key or PGP key needed" — sheet chip
- "This device's login is weak: you logged in with just your username and password. Adding team members and changing what they can do need a passkey, security key or PGP key." — sheet body
- "Weak" / "Username and password" / "This device" and "Strong" / "Passkey, security key or PGP key" — tiles
- "Add a passkey, security key or PGP key. Then use it to log in on this device." / "A passkey, security key or PGP key also stops simple guessing and lets you act right away." — lines
- "Not now" — button
- "Next: Login methods, where you add a passkey, security key or PGP key." — note

## TeamChat
- "Chat with mira.k" / "Chat with satoshi_ghost" — screen titles (lead's and partner's view)
- "Zelle · $165.00" — context line
- "Encrypted. If a dispute is opened, a moderator can read this conversation." — line
- "Escrow funded. 0.500000 XMR is locked for this trade." — system line
- "Team member" / "Team member · satoshi_ghost's team" — role tags on a member's reply
- "desk_ana replied for you." / "mira.k sees "Team member", not the name." — lead's view notes
- "A team member from satoshi_ghost's team is replying." — partner's view note
- "Message mira.k" / "Message satoshi_ghost" — composer labels
- "Team replies in this chat" / "desk_ana" / "2 replies · last at 14:23 UTC" / "mira.k sees "Team member", never the name. Every reply is also in your audit log." — side card (wide)
- "You're selling" / "You're buying" / "mira.k: Payment sent" — summary label and chip (wide)

## ModQueue
- "Open disputes, closest deadline first. A moderator must reply within 4 h of a dispute opening." — lead
- "Take next case" — button
- "Open" / "Overdue" / "Unassigned" / "Need a second approval" — KPI labels
- "All open" / "Assigned to you" / "Needs approval" — filter chips
- "Trade" / "Amount" / "Method" / "Opened by" / "Waiting · deadline" / "Approval" / "Assigned to" / "Actions" — table headers
- "Overdue by 25 min" / "Reply due in 15 min" / "Replied in 38 min" / "Needs second approval" / "Ruling waiting for lumen.k" / "Not needed" — cells
- "Take" / "Open case" — row buttons
- "Nothing here right now." / "Pick another filter to see the rest of the queue." — empty filter state (second sentence new 7 Nov)
- "Rulings at or above the 1,000 USD large-trade limit need a second approval from a senior moderator or the owner. Opening a case's chat or asking for unblurred proof is written to the activity log." — footnote

## ModCase
- "Dispute · harbor_lin and quietfox" — screen title
- "Trade 7RWD-3MXE-KQ84-HN2T · Zelle · All disputes" — context line
- "Above the 1,000 USD limit" / "First reply due in 1 h 20 min" — chips
- "Zelle · 4.000000 XMR for $1,320.00 at $330.00 / XMR · opened by the buyer 2 h 40 min ago: paid, but the seller hasn't released · assigned to you" — summary line
- "Full chat" / "Opened by you at 11:40 UTC · logged" / "Before the trade" / "Trade" — chat heading, note, dividers
- "08:10 harbor_lin took the offer" / "08:16 quietfox funded the escrow with 4.000000 XMR" / "08:38 Escrow secured after 10 confirmations" / "08:51 harbor_lin tapped I've paid and added proof" / "10:51 quietfox's time to confirm ended" / "10:52 harbor_lin opened a dispute" — system lines
- "Message both traders" / "Your messages show the X2F Moderator badge to both traders." — composer and note
- "Your ruling" / "Release to buyer" / "4.000000 XMR goes to harbor_lin. quietfox gets a lost dispute on their profile." / "Refund to seller" / "4.000000 XMR goes back to quietfox. harbor_lin gets a lost dispute on their profile." — outcome tiles
- "Account action" / "Freeze the losing account" / "senior moderator or owner confirms" / "Ban the losing account" — options
- "Reason (required, both traders see it)" / "What the evidence shows and why it decides the case" / "At least 40 characters. 112 so far." — field, placeholder, hint
- "Above your limit: sent to a senior moderator or the owner for approval. $1,320.00 is over the 1,000 USD large-trade limit. Nothing is signed until they approve." — callout
- "Send ruling for approval" / "The traders see the ruling once it is approved." / "Write the reason to continue." / "Pick an outcome and write the reason." — button and hints
- "Waiting for approval from sarah.v or lumen.k. Proposed at 11:58 UTC and logged." — sent state
- "Traders" / "Buyer joined Mar 2026" / "Cancel rate 3% mod only" / "Last ratings: positive, positive, positive" — trader cards
- "Payment proof" / "Shows $1,320.00, the right amount" / "Note says 7RWD-3MXE-KQ84-HN2T" / "Sender name blurred by harbor_lin" — proof checks
- "Request unblurred proof" / "The request is written to the activity log. Only you will see the copy." / "Requested at 11:42 UTC and logged. Waiting for harbor_lin to send it." — button, note, sent state
- "Escrow" / "Secured · 10 of 10" / "4.000000 XMR locked" / "3 keys, any 2 release it: harbor_lin, quietfox and the moderator key. Your ruling signs with the winning side's key. Nothing has moved yet." — block
- "Freeze trading" / "Not part of the ruling. Use it only after someone ignores this dispute (about 48 h without a reply) or ignores the ruling. A freeze has no end time: you write in the dispute what they must do to get trading back, they do it and message the moderators, and you lift it." — heading and line
- "Freeze trading for harbor_lin" / "Freeze trading for quietfox" / "Both have replied in time, so neither button applies yet." — buttons and note

## StaffLog
- "All entries" / "Active disputes (2)" — filter default and group label
- "Today, 09:50 UTC" — date form
- "Created an invite link for a new moderator (Mon–Fri, 09:00–17:00 UTC)" / "Proposed a ruling: release 1.800000 XMR to the buyer (above the limit, waiting for your approval)" / "Funded the escrow with 1.250000 XMR" / "Dispute opened by the seller: payment not received; waiting for a moderator" / "Requested the unblurred payment proof" / "Ended dmitri_k's session at the end of their login hours" / "Changed the large-trade limit from 500 to 1,000 USD" — entry texts
- "K7M2-9QXA-4FTR-8WPN · Zelle · 1.800000 XMR · waiting for your approval" / "P9VC-6KE1-YB4M-2HJD · Revolut · 0.400000 XMR · waiting for a moderator" — filter labels
- "No entries for 3HW8-ZD2N-RT6K-Q9VB." / "Check the code and try again." — empty state
- "Showing everything, newest first." / "12 entries for trade K7M2-9QXA-4FTR-8WPN, newest first." — summary lines

## StaffPerformance
- "dmitri_k had 3 rulings overturned on appeal this month and replied within the 4 h deadline 82% of the time. Their overturned cases are a good place to start a coaching chat, and they earn no pay under the current rules." — coaching note
- "Typical means the middle value, so one slow case doesn't skew it." — footnote

## StaffSettings
- "6" / "4" / "300" — example pay values (Senior moderator per case, Moderator per case, Helper per month; real amounts OPEN)
- "Includes co-approving large rulings." / "A ruling overturned on appeal earns nothing." / "Flat rate, since questions don't come in cases." — field helpers
- "Paid in XMR at the end of each shift, when the staff member logs out. Amounts to be decided; check with the lawyer before the first payment." — callout
- "Hold the large-trade bonus until the appeal window closes (48 h). Recommended: these amounts are bigger, and XMR sent can't be pulled back if someone leaves." — tick-box label

## Support
- "Ask an X2F staff member" — headline, as the owner decided (p5-4). The board still shows "Ask a team member"; design updates it on sign-off of this page.
- "A team member will answer you here. Team members can't see dispute evidence or decide disputes, so for a problem with a live trade, open a dispute from the trade instead." — lead, still unsigned. Design's proposal to match the headline: "An X2F staff member will answer you here. Staff can't see dispute evidence or decide disputes, so for a problem with a live trade, open a dispute from the trade instead."
- "My tickets" / "Your ticket" — link and title
- "What's it about?" — heading
- "Trades and payments" / "Logging in and backups" / "Escrow and wallets" / "My offers" / "Disputes and appeals" / "Reviews and reputation" / "Something isn't working" / "Everything else" — topics
- "Trade code (if it's about a trade)" / "Your question" / "Tell us what happened and what you need." — fields and placeholder
- "Never send a password, recovery code, authenticator code or private key. A team member will never ask for them." — caution line ("team member" to follow the headline)
- "Send to the team" / "Send reply" / "Ask something new" / "Reply" / "Write a reply" — buttons and composer
- "Answered" / "Opened" / "X2F team" — ticket chip, row label, staff tag ("X2F team" tag: the craft pass reserves "team" for a vendor's team; design proposes "X2F staff")
- Example ticket text ("Only release once the money is in your own account, checked in your bank's app, not from a screenshot. Some bank payments take a few hours. If the payment timer runs out and nothing has arrived, you can open a dispute from the trade page." and "Yes. Once you release, the trade page asks for a review. Glad it worked out.") — staff replies, examples

## FAQ
Every question and answer is draft copy written from the spec.
- "Help" / "Short answers. Nothing here is legal advice." / "Search the help" — title, line, placeholder
- "Trading" — section
- "How does escrow work?" / "Each trade gets a fresh 2-of-3 escrow. You, the other trader and X2F each hold one key, and any two keys can move the coins." / "X2F holds only its one key, so it can never move the coins on its own." / "In the app you see three steps: Fund, I've paid, Release."
- "What does Trade do?" / "Trade takes an offer. The offer's poster is told you accepted, and if you're the buyer you pick which of your saved wallets gets paid." / "The seller then has 30 min to fund the escrow from their own wallet. The price locks at that moment."
- "Who pays the fee?" / "Only the person who posted the offer pays a fee: 1% of the trade, taken when the trade completes." / "Taking an offer costs nothing. Cancelled and refunded trades pay no fee."
- "What if the buyer never pays?" / "The buyer has 90 min to pay once the escrow is secured. If they never tap I've paid, the seller can tap Cancel & get refund after that window." / "The buyer gets a final 15 min alert. If they stay silent, the coins go back to the seller's saved wallet. No moderator is involved." (out of date against G2: the seller cancels after 90 min and one nudge; no 15 min alert)
- "Can I cancel?" / "A buyer can cancel alone at any time before tapping I've paid. The coins go back to the seller's saved wallet." / "Once the escrow is funded, the seller can't cancel alone. Once you've tapped I've paid, neither can you." (second sentence out of date against G2)
- "What is a dispute?" / "If the two of you can't agree, either side can open one. A moderator reads the chat and the proofs, then signs with the side that is right." / "Each dispute has a published deadline. If you disagree with the ruling, you can appeal to a senior moderator within 48 h."
- "Logging in" — section
- "Why PGP?" / "There is no password to remember and nothing to steal: X2F holds only your public key." / "Every login is the same three steps: copy the message, decrypt it in your PGP app, paste the code. Each code works once and expires in 5 min."
- "Which PGP apps?" / "Kleopatra on Windows and Linux, GPG Suite on Mac, OpenKeychain on Android." / "X2F never creates keys for you, because that would expose your private key. You need your PGP app at every login."
- "How do I check a login message is really from X2F?" / "Every login message is signed with the X2F key, so your PGP app shows who sent it. The message also names the site and the time." / "[X2F SIGNING KEY FINGERPRINT]" / "If the signature is missing or the fingerprint doesn't match, stop." (fingerprint OPEN, owner to supply)
- "What is a passkey?" / "A passkey is a login stored on your phone or computer and unlocked with your face, fingerprint or device code. There is nothing to type and nothing to phish." / "Apple or Google may sync it between your devices. X2F learns nothing from that."
- "What if I lose everything?" / "Use your recovery code. It starts a 24 h hold, and everyone on your account is logged out until it ends." / "X2F has no way to reach you, since it holds no email or phone number, so keep the code somewhere safe." / "Your coins are never at risk. They stay in your own wallet."
- "Wallets and privacy" — section
- "Does X2F hold my coins?" / "Never. You pay from and get paid to wallets you already use." / "The app makes one temporary escrow key per trade on your device. It holds no balance and is deleted once the trade closes."
- "Which wallets work?" / "Cake Wallet, Edge, Feather, Monerujo, Stack, and the Monero GUI or CLI. A Ledger or Trezor works through Feather." / "Any wallet that gives you a Monero address can get paid."
- "What does X2F keep?" / "No IP addresses, and no name, phone number or email address." / "Chats are deleted after 30 days and disputes after 90 days." / "During a trade X2F keeps an encrypted, unblurred copy of your payment proof that only a moderator can open, and only if there is a dispute. It is deleted when the trade is over."
- "What about payment proofs?" / "Before upload, your phone strips the photo's metadata and blurs private details such as account numbers and names." / "You check the result and can add more blur. You can't remove the automatic blur. The seller sees the blurred version."
- "Can the police get my data?" / "X2F answers a lawful request backed by a warrant with the little it holds." / "That is why X2F logs no IP addresses and asks for no name, phone number or email address." (lawyer to confirm)
- "Badges and reputation" — section
- "What do badges mean?" / "Badges are milestones you earn by trading. They can't be bought or claimed." / "New means fewer than 5 completed trades. Trusted means 100 or more trades with 98% or more positive reviews." / "There are no volume badges, so nobody can see how much money you move." (out of date: Trusted is 200+ trades and 98%+ positive, p5-3; New is "Joined in the last 30 days" on the Badges board; the volume line is opt-in, Q63)
- "What is Past reputation?" / "If you traded on LocalMonero or a similar site, you can prove it with the PGP key you used there. A moderator checks an archived copy of your old profile against a message you sign now." / "It becomes a separate badge. It is never added to your X2F trade count or rating."
- "Still stuck? Ask a team member" — footer link ("team member" to follow the Support headline, p5-4)

---

## Contradictions the owner should know about while signing
- Trusted: Badges, BadgeSettings, offer cards and every trade screen say "200+ trades and 98%+ positive" (p5-3); the FAQ still says 100 or more. `to-lead.md` and the handoff mention 500+ from the craft pass; the boards were since set to 200+.
- Cancel: CancelRequest carries G56; Fold-Trade and Fold-Tabletop still show the older "Cancel this trade?" sheet; the FAQ's cancel answers still describe the 15 min final alert.
- Hourglass: DisputeOpen and DisputeRoom say "A moderator steps in within 24 h at the most. Usually it's much sooner." (Q38); Fold-Cover's dispute glance still says "A moderator usually replies within 4 h".
- Sessions: SessionLength and SessionExtend list traders 2/4/8/12 h (G23); Settings' notes, BecomeVendor's table and Devices' notes still say 2/4/6/12.
- Team: Team's "What members can do" still describes presets; MemberPermissions uses member types (Q16). Totals are "of 34" on MemberApproval, TeamRefusal and MemberPermissions; Team's rows show the same count.
- Holds: G57 (removals take effect now, final after 24 h) against g65 (an unticked change never applies). On HoldChange a removal row reads "Removed now · final in …" yet can be unticked. Design recommends deferring removals like every other waiting change.
- Support and FAQ still say "team member" for X2F staff; the owner decided "Ask an X2F staff member" (p5-4).
- Imported volume: ProfileVisibility shows "Imported from LocalMonero: 120.0 XMR"; the owner's p4-1 wants US dollars, "$X+ on <site>, verified".
- CantDoThat's example explanation still says 2 offers per side per currency; the rule is 3 buying and 3 selling offers.

## Count
- Screens: 86 sections (66 phone boards, with their 50 wide variants folded in; 4 fold boards; 5 staff boards; 11 boards left out as superseded, notes-only or with nothing unsigned).
- Lines: about 1,180 quoted lines (one bullet may carry a label and its helper, or a sheet's title, body and buttons; counted as the separate quoted strings).
