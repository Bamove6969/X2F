# Build spec: staff2 boards (9 Nov 2026), COPY-UNSIGNED

Owner ids: D-046, D-041/D-045 (clock-out), D-044 (no hold), p11-19, Q51/G3, F16/F17/Q58/Q63/Q64, G4/Q55/Q59.
All colours are THEMES tokens. Fonts: Familjen Grotesk (h1 28/32 700), Atkinson Hyperlegible Next (body), Atkinson Hyperlegible Mono (every number). Wide boards are 1280 wide; staff boards have the 240 px staff rail copied from StaffList (Overview, Disputes, Staff, Performance, Training library, Activity log, Feedback, Settings; the page name sits under the logo).

---

## 1. StaffLogin.dc.html (NEW, 1280 × 1585 default)
Staff site, before login. Logo D 78×32 centred alone (padding 56 top), no rail. Column 480 wide (welcome: 640), gap 16, starts 32 below the logo. Reached from: the staff site address (staff.x2f…); the trader Login's "Use the staff site" refusal; StaffList's invite link and "See their first login".

Tweaks: `stage` = known-device (default) | new-device | welcome; `account` = key (default) | no-key.

Common header (all stages):
- Chip (mod tint, shield 12): "Staff site"
- h1: "Staff log in" (welcome: "Welcome to the team, dmitri_k")
- Sub: "This is the X2F staff site. Traders log in on the main X2F site." (welcome: "You're logged in. Before your first case, here's how the job works.")

### known-device
- Card "Logging in as" / "dmitri_k" with "Change" (64 high, mod shield tile 40).
- Note (surface-raised, neutral): "This device is known" / "One of your login methods is enough here."
- Card (padding 24, radius 16): legend "Log in with"; radio rows 56 high (selected = 2 px ink ring, filled dot):
  - account key: "Security key", "PGP key", "Passkey"
  - account no-key: "Username and password", "PGP key", "Passkey"
- Method panel under the list:
  - Security key: "Have your security key ready" / "When asked, plug it in or hold it to the back of your phone, then touch it."
  - PGP key: "Copy the encrypted message, decrypt it in your PGP app, then paste the code from inside it." + message strip with "Copy" + label "Code from the message", placeholder "Paste the code".
  - Passkey: "Use your passkey" / "Your phone or computer will ask for your face, fingerprint or PIN."
  - Username and password: label "Password" (the username is the "Logging in as" row).
- Button (full width, 48, monero): "Log in".
- Foot (13/18 muted): key: "You set up a security key, a PGP key and a passkey when you joined." / no-key: "You set up a username and password, a PGP key and a passkey when you joined, instead of a security key."

### new-device
- Note (caution tint): "New device" / "Use two of your login methods. After that, this device is known and asks for one."
- Done row (escrow tint, 56): "Method 1 of 2" / "Security key" (no-key: "Username and password") / "Done".
- Legend "Pick your second method"; rows "PGP key", "Passkey" (PGP selected by default; same panels as above). Button "Log in".
- Build: after the second method succeeds, mark the device known.

### welcome (D-046; shown once, after the first successful login; then Overview)
Three cards (padding 20, radius 16, 40 tile):
1. "Your role: Moderator" / "You settle disputes between traders. You rule on your own when a trade is under 1,000 USD; bigger rulings also need a senior moderator or the owner." / muted: "Your login hours: Mon–Fri, 09:00–17:00 UTC."
2. "How you're paid" / "You earn 4 USD in XMR for each case you complete. Your pay is worked out and sent at the end of your shift, when you clock out." + caution box: bold "Closing the app doesn't clock you out." then "Tap Clock out at the end of every shift. Until you do, your pay waits."
3. "Traders can appeal" / "A trader who's unhappy with your ruling can appeal within 48 hours. A senior moderator or the owner looks at it again, never you." / muted: "If your ruling is overturned, that case earns nothing: its pay comes off your next payouts."
- Button (link to Overview): "Got it, start working" + "You can read this again any time in the Training library."
- Data: role name/description, limit (Settings large-trade limit), per-case rate (Settings, by role; helper: per month), login hours (StaffList row), appeal window (Settings) are live values; the board shows examples.

---

## 2. StaffImportVerify.dc.html (NEW, 1280 × 1599 default)
Staff rail, Disputes selected; rail page name "Verify claim". Column max 760. Reached from Disputes: claims are rows in the Disputes queue ("Reputation claim"); breadcrumb "Disputes / Reputation claims / RC-7Q2K" (Disputes is a link).

Tweaks: `state` = pending (default) | sig-failed | over-cap | verified; `viewer` = senior-or-owner (default) | moderator (rail foot shows dmitri_k / Moderator).

- h1 "Verify past reputation"; sub "A trader says they traded on another site. Check their signed message and the archived copy of their old profile, then enter the amount it proves. Only a senior moderator or the owner can enter it."
- Card "The claim", status chip right: pending/over-cap "Waiting for you" (caution), sig-failed "Signature failed" (danger), verified "Verified" (escrow). Rows (200 px label column): "Trader on X2F" nightowl_44; "Site" LocalMonero; "Username there" night_owl (mono); "Archived profile" link "Open the archived copy"; "Sent" 8 Nov 2026, 21:14 UTC; "Signed-message check": good (escrow, tick) "Good: signed by the same PGP key as the old profile." / failed (danger, cross) "Failed: the signature doesn't match the PGP key on the old profile." Then "Signed message" block (mono 12/17).
- sig-failed only, danger-tint card: "The signature didn't check out" / "nightowl_44 sees these four checks every time a claim fails, and can send a new one. You can't enter an amount until a signature checks out." Numbered:
  1. "Key format." "Check the dashes and spacing of your public key: the BEGIN and END lines should look alike."
  2. "Computer clock." "Check that the date and time on your computer are right, then sign again."
  3. "Sign, don't encrypt." "In your PGP app, choose Sign, not Encrypt."
  4. "Up-to-date PGP app." "Update Kleopatra, GPG Suite or OpenKeychain, then sign again."
  The trader's claim screen shows the same four after every failed claim (F16).
- Card "Verified amount": label "Traded on LocalMonero, proven"; input 200 wide, mono, then "USD", then live "≈ {xmr} XMR" (4 decimals). Help: "Enter only what the archived profile proves. The most you can enter is 100,000 USD, about 625.0000 XMR at today's rate. The profile shows the XMR figure."
  - over-cap: input 2 px danger border, aria-invalid; error (danger, 14/20 600): "That's over the cap. Enter 100,000 USD (625.0000 XMR) or less." Verify button disabled.
  - sig-failed: input disabled (opacity 0.6), verify disabled.
  - Buttons: "Tap key and verify" (monero, key icon; security key tap) and "Deny claim" (outline).
  - viewer moderator: field and buttons replaced by locked note "Only a senior moderator or the owner can enter the verified amount. You can read the claim and add a note to the case."
- verified: green banner above the claim: "Verified" / "nightowl_44's profile now shows "Imported from LocalMonero: 112.5 XMR". This is recorded in the activity log." Field read-only, buttons hidden.
- Build: cap is server-side 100,000 USD (MAX_VERIFIED_USD_CENTS); XMR shown at the live rate; the profile line stores XMR (assumed: converted at the moment of verifying; confirm with lead). Example rate on the board: 160 USD per XMR.

---

## 3. OwnerKeys.dc.html (NEW, 1280 × 1162 default)
Staff rail, Settings selected; rail page name "Owner keys". Owner only. Column max 720. Reached from StaffSettings intro link "Owner keys"; breadcrumb "Settings / Owner keys".

Tweak: `stage` = overview (default) | tap-1 | tap-2 | done.

- h1 "Owner keys"; sub "You log in with a security key and your PGP key together. Replacing or adding a key is a big change, so it needs a tap of both your security keys."
- Card "Your keys", rows 72 high, each with "Replace" (44 outline):
  - "Main key" · "Security key · added 2 Nov 2026 · last used 12 min ago"
  - "Backup key" · "Security key · added 2 Nov 2026 · last used 3 Nov 2026" (done: "added 9 Nov 2026 · last used just now" + "New" tag, escrow)
  - "PGP key" · "Required for login · added 2 Nov 2026 · last used 12 min ago" + fingerprint (mono 13).
  - Button "Add a security key" (outline, plus icon).
- tap-1 / tap-2 panel (mod tint, role dialog): eyebrow "Step 1 of 2" / "Step 2 of 2"; title "Replace your backup key: tap both keys"; body "The new key is read and waiting. To make the change, tap your main key, then your backup key. Nothing changes until both are tapped." Two tiles: "Main key" / "Backup key" with state "Tap now" (2 px ink ring), "Next", or "Tapped" (escrow tick). Prompt box: "Tap your main key" / "Now tap your backup key" + "Plug it in or hold it to the back of your phone, then touch it." Buttons: "Tap main key" / "Tap backup key and replace" (monero) + "Cancel".
- done: banner (escrow) "Backup key replaced" / "The old backup key no longer works. Keep the new one somewhere safe, away from your main key. This is recorded in the activity log."
- Flow: Replace → browser registers the new key (touch the new key) → step 1 of 2 → step 2 of 2 → done. Adding a key and replacing the PGP key use the same two taps.

---

## 4. StaffList.dc.html (changed; default 2138 → 2174)
- Invite line before the link (all roles): was "They set up a security key, a PGP key and a passkey. A new device asks for two of them, a known device for one. Staff can't use passwords." → "They set up a PGP key, a passkey, and either a security key or a username and password. A new device asks for two of their three, a known device for one."
- Invite line with the link: "Invite link for a new {role}. Send it to them privately. It works once and expires in 24 h. They set up a PGP key, a passkey, and either a security key or a username and password. Their first login then explains their role, how pay works, and that traders can appeal a ruling. " + link "See their first login" → StaffLogin (welcome).
- Decided aside updated (Q51 · G3 · p11-19); first-login aside points to StaffLogin.

## 5. StaffSettings.dc.html (changed; default 3080 → 3504)
- Intro ends with link "Owner keys" → OwnerKeys.
- Staff pay sub: "…when the staff member logs out." → "…when the staff member clocks out."
- Payout paragraph: "When a staff member clocks out, X2F adds up every case they completed since they last clocked out. They see the total and a thank-you, confirm their payout address or pick another approved one, and the pay is sent right away. Closing the app is not a clock-out: their pay waits until they clock out, and a session that ends on its own is only noted in the activity log ("Logged out automatically at …")."
- Preview "What they see when they clock out" = the clock-out sheet (surface card, radius 16, padding 20):
  - Title "Clock out and get paid"
  - "0.054600 XMR for 3 cases since you last clocked out" (amount mono 22/28)
  - "Thank you. X2F couldn't do this without you."
  - "Send to 84Fq…7hQa" + link "Use another approved address"
  - "Adding a new address needs the same strong login you used today."
  - Caution box: bold "Closing the app doesn't clock you out." + "Always clock out here. Until you do, your pay waits."
  - Buttons: "Clock out and send my pay" (monero) and "Keep working" (outline).
  - Under it: "Opened from Clock out at the foot of the staff rail (staff who are paid by the case or month; the owner's rail has none)."
- "Hold the large-trade bonus … 48 h" option: confirmed gone (only named in the Decided aside as removed).
- New Decided aside: "Paid only on a real clock-out" (28 Oct 13:07 · 30 Oct, D-041, D-045).

## 6. StaffPerformance.dc.html: unchanged (default 1417). Its coaching line already says overturned pay "comes off their next payouts" (no hold).

## Open questions (not drawn)
1. p11-19 says "a moderator". Read as all staff (as Q51 used "moderator"). Confirm it covers senior moderators and helpers.
2. A no-security-key member on a known device: may the password alone be the one method? The board allows it by the 1-of-3 rule; the owner has not said.
3. Lost owner security key: both taps are impossible with one key (Open box on OwnerKeys).
4. Imported XMR figure: fixed at verification time, or re-converted? Board assumes fixed.
5. The "Clock out" button in the staff rail foot is not drawn (all rail boards are signed in as the owner); a staff-member rail variant is needed on StaffOverview/StaffLog etc.
6. p11-14 (everyone who gets a login signs): the staff first login should run the sign step before the welcome; not drawn here (MemberApproval has the pattern).
