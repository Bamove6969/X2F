# Build spec, j33b (9 Nov 2026): team, holds, Jabber alerts, Devices wording

Owner ids: p11-21, p11-26, p11-27, p11-28, p11-31 (owner-answers-page11-2026-11-08.md) and G-007/G46 (Devices wording, given by the coordinator).
Note on numbering: in the owner's file, **p11-27** is "no first-login approval + notice + Jabber + Jabber settings page" and **p11-28** is "members get their own recovery codes". The brief swapped the two; the boards cite the owner's file.
All copy below is COPY-UNSIGNED (design draft). Colours are THEMES tokens only. Phone boards are 390 wide; wide boards are 1280.
Sample values used on the boards: lead satoshi_ghost, members desk_ana / desk_sam / desk_lee, device "Firefox, Linux", times "09:12 UTC", "3 Nov 2026, 14:05 UTC" (= link time + 24 h), Jabber "mira…@xmpp.example.org".

---

## 1. MemberApproval(+Wide): first login with no approval (p11-27, p11-14, p11-28)

Reached from: the member opens the lead's invite link (Team › Add a member › link) and logs in for the first time. The lead side is a sheet (phone) or centred dialog (wide, 520 px) over the lead's app as soon as the member has signed.
Tweaks: `side` lead | member (default lead); `state` sign | in (default sign; ignored on the lead side); `signed` empty | drawn. The old states waiting / approved / refused are **removed**.
Canvas title is now out of date: suggest "J3 · Member's first login (lead notice)".

### Lead: notice (state for side=lead)
- Title (h2, 24/30 Familjen 700): `desk_ana logged in for the first time`
- Body (16/24): `They're in now, with what you picked; nothing to approve. If you turned on this Jabber alert, we sent it there too.`
- Card (surface-raised, 12 radius): member row (avatar DA, `Team member` tag); rows `Starts with` → `Starting set (10 of 33 allowed)`; `Device` → `Firefox, Linux · 09:12 UTC` (time in mono).
- Link row (64 min-height, to MemberPermissions): `Review what they can do`.
- Primary button `OK` (phone: full width 56 px; wide: 48 px, right) closes.
- Muted line (15/22) `Didn't expect this? Switch them off in Team.` with "Team" linking to Team(-Wide).
- Removed from this sheet: the "New team member" chip, the Device row as a separate line, the payout-wallet lock note, Approve and Refuse buttons, the "desk_ana is on your team" and "Refused" result states.
- After OK: a bottom button `Show the notice again` (phone, 48 px) reopens it.
- Build: send the notice when the member finishes "Agree and sign"; also send the Jabber alert "A team member logs in for the first time" if the lead ticked it (JabberSetup events).
- Wide rail page name: `Team` (was "Approve member").

### Member: Agree and sign (state=sign)
- Unchanged pad, terms box and tick (p11-14), except: intro `Everyone with an X2F login signs once. Read to the end, tick the box and sign. Then you're in.`
- Button `Agree and continue` (was "Agree and ask to join"); hint when ready `All done. Tap to go in.`
- Tapping the button goes straight to state `in`.

### Member: You're in (state=in)
- Chip `Signed` (escrow); title `You're in` (32/36; wide 40/44).
- Body: `Welcome to satoshi_ghost's team. We've let them know you're in. You start with the starting set (10 of 33 allowed). From now on you log in without waiting, on any device.`
- Lead + member rows card (as before).
- New link card (64 min-height, 1px --line border, 12 radius, key icon tile 40 px in escrow 14 %): title `Save your own recovery code` (16/22 600), sub `It gets you back in if you lose your login. It's yours alone: satoshi_ghost never sees it.` (14/20 muted) → RecoveryCode(-Wide).
- Footer: `Continue` → Main.
- Removed member states: "Waiting for satoshi_ghost to approve you", "Keep this screen open…", "Not approved".

Heights (default variant): phone 1641 → **1917** (NOTES 797 → 1073; app frame 844 unchanged). Wide 1273 → **1407** (NOTES 473 → 607; frame 800).

---

## 2. Team(+Wide): invites from a weak login, change-only holds (p11-21, p11-26, p11-27, p11-28)

Reached from: Settings › Team. New tweaks: `login` strong | username-password (default strong); `sheet` none | add | link (default none; add/link open the sheet with sample desk_lee, starting set).

"How team members work" list (default view):
1. `You can add a member or change what they can do from any login. From a username-and-password login, it starts 24 h after you save it.` (was "…needs a passkey, security key or PGP key.")
2. `There's nothing to approve when a member first logs in. We tell you, and send a Jabber alert if you picked that one.` (was "You approve each member's first login, once…")
3. `Members can use any login, even a stronger one than yours. A change waits 24 h only when the person making it logged in with just a username and password.` (was "…If you log in with just a username and password, team changes still wait 24 h, even when a member with a strong login makes them.")
4. unchanged (`Members' logins don't count toward your 3 devices.`)
5. `A 24-hour hold holds only the changes waiting in it. Everything else keeps working.` (was "During a 24-hour hold, all team changes wait until the hold ends.")

Add sheet (step name):
- Note under the presets: strong `You can fine-tune every permission after they join.`; weak `You can fine-tune every permission after they join. You're logged in with just a username and password, so what you set starts 24 h after you save it.`
- Create invite link: strong → "Confirm it's you" (unchanged); weak → **skips the key check** and goes straight to the link sheet.

Link sheet:
- List line 3: `When they open it, they set up their own login and get their own recovery code.`
- List line 4: `They sign the terms and go straight in. We tell you when they first log in. They start with the starting set (10 of 33).`
- Weak only, new caution note under the list (12 radius, caution 8 % on surface-raised, 1 px caution 35 % border, clock icon in caution, 14/20): `You're logged in with just a username and password. desk_lee can accept now, but what you set for them starts in 24 h, at 3 Nov 2026, 14:05 UTC. Log in with a passkey, security key or PGP key and it starts at once.`
- Build: invite goes out and the member can accept and log in at once; the member's permissions (the ticked set) take effect 24 h after the lead saved them when the lead's session is username+password. Notice + Jabber (if ticked) when the member first logs in.

Not changed (flag): the intro still says "Each member has their own login with a passkey, security key or PGP key. There are no shared passwords." This contradicts p7-9 (members may use any login); left for the lead to confirm.

Heights: phone 4352 → **4774** (H base 3869 → 4291). Wide 2344 → **2532** (right-column floor 2344 → 2532).

---

## 3. MemberPermissions(+Wide): weak-login save, member's own recovery code (p11-21, p11-28)

Reached from: Team › member row › "Edit what they can do", and from the MemberApproval notice. New tweak `login` strong | username-password (default strong).
- Under the member's status pill (identity section), new muted line (14/20, key icon 18 px): `desk_ana has their own recovery code. Only they can see it.`
- Footer line: strong `Saving needs your passkey, security key or PGP key, and the new settings start at once. From just a username and password they start 24 h after you save.`; weak `You're logged in with just a username and password. You can save, but desk_ana's new settings start 24 h after you save. With a passkey, security key or PGP key they start at once.`
- Save: strong → "Confirm it's you" (unchanged, then `Saved. desk_ana can now do N of 33 things.`); weak → no key check, status note `Saved. desk_ana's new settings start in 24 h, at 3 Nov 2026, 14:05 UTC. Until then they keep their current ones.`
- Build: on a weak session, store the new permission set as pending with apply_at = now + 24 h; the member keeps the old set until then.

Heights: phone 5858 → **6282** (H base 4392 → 4816, +18 when login=username-password). Wide 4175 → **4435** (H base 3339 → 3599).

---

## 4. HoldMember(+Wide): the hold holds only the change (p11-26)

Reached from: a team member's Team screen while the lead has changes waiting. Tweak `rights` unchanged.
- Hero title `Some changes are on hold` (was "A hold is on").
- Hero line 1: `Some of satoshi_ghost's changes wait 24 h before they apply. Only those changes wait; everything else works as normal.`
- Hero line 2: `satoshi_ghost made them from a username-and-password login, so they wait 24 h. Changes made from a passkey, security key or PGP key apply at once.` (was "…team changes wait 24 h, even when a member with a stronger login makes them.")
- Rights none: `What you can see: that some changes are waiting. Ask satoshi_ghost if you need to know more.`
- Hold ended result: `Every ticked change applied just now.` (dropped "The team is back to normal.")
- "End the hold", "Cancel all changes", list rows: unchanged.
- Build rule: whether a change waits depends on the session of the person who makes it, not on the lead's login.

Heights (content-fit board, `$preview` only): phone 2231 → **2533**; wide 1595 → **1771**.

---

## 5. Alerts(+Wide): Jabber section (p11-27, p11-31)

Reached from: Settings › Alerts. Tweaks unchanged.
- Section "Secure Jabber (XMPP)": row label `Jabber alerts` (was "Account change alerts"); description `Short, encrypted messages for the events you pick. Always OMEMO and Tor; neither can be turned off.`
- New row under Address (only when set up, `jabber=on`; 1 px --surface divider, 48 min-height, same style as Address): `Events` · `7 of 7 on` (digits mono) → JabberSetup step events.
- Flag for the lead: Alerts still has a second, older section "Jabber over Tor" (trade alerts with its own address, fingerprint and steps). With p11-27 there should be one Jabber setup and one events list; I did not merge them (needs a call on where the fingerprint/Tor steps live).

Heights: phone HEIGHTS off-android 2373 → **2355**, off-other 2031 → 2013, on-android 2417 → 2430, on-other 2075 → 2088 (default = off-android, 2355). Wide off-android 1364 → 1346, off-other 1046 → **1034** (default, computer), on-android 1390 → 1421, on-other 1072 → 1103.

---

## 6. JabberSetup(+Wide): the Jabber settings page (p11-27, p11-31)

Reached from: Alerts › Secure Jabber › Address (setup) or Events. Tweak `step` address | verify | **events** | done (default address).
Flow: address → Send a test message → verify → Turn on → **events** → Save → done; done › `Change which events` → events.
- Header lead line: `Short, encrypted messages to your Jabber address for the events you pick.`
- Address step help: `Any XMPP server works. Your Jabber app must support OMEMO and connect through Tor.`
- Events step (new):
  - Card (surface, 16 radius, 20 padding): h2 `Which events send an alert` (18/24 600) with right-aligned mono label `Sample list` (12/16 muted); sub `Tick what's worth a Jabber message. You can change this any time.`
  - Group `Trades` (13/16 uppercase muted): `A new trade starts` · `The buyer marks the payment as sent` · `XMR is released` · `A dispute is opened or a moderator joins`
  - Group `Account`: `A new login or a new device` · `A team member logs in for the first time` · `Login methods, wallets, team or settings change`
  - Each row: label 48 min-height, checkbox 22 px accent --ink, 1 px surface-raised divider; all ticked by default.
  - Count line: `7 of 7 events send an alert` (numbers mono, live).
  - Security box (surface-raised, 12 radius, lock icon in escrow): `Always OMEMO, always Tor. Every alert is end-to-end encrypted with OMEMO and sent over Tor. There's no switch for either: an alert sent in the clear could show someone that you trade on X2F.` (wide: right column).
  - Footer primary `Save` (phone 56 px full width; wide 48 px).
  - The events list is a SAMPLE; the owner picks the final list on page 13 (p11-32). Remove the "Sample list" label then.
- Done step: `The events you picked now send a short, encrypted message to mira…@xmpp.example.org.`; preview bubble `A new device logged in to your X2F account.`; footer `Done`, new secondary `Change which events` (48 px, 1 px --line border), `Turn off` (danger tertiary).
- Build: no OMEMO or Tor toggle anywhere; refuse to send if the recipient has no OMEMO device. Send one alert per ticked event.
- Open for the lead: p5-7 said a message names nothing; with chosen events the sample names the kind of event (never amounts, names or wallets). Confirm with the owner.

Heights: phone 1841 → **2415** (NOTES_H 997 → 1571; frame events 1048, others 844). Wide 1401 → **1687** (NOTES_H 601 → 887; frame events 882, others 800).

---

## 7. Devices(+Wide): G-007 wording + p11-26

Reached from: Settings › Devices and sessions. New tweaks: `team` members | none (default members); `devices` normal | over-limit (default normal).
1. Empty team card (team=none): inside the "Team members logged in" card, box (surface-raised, 12 radius, 16 padding): `No team members yet` (16/22 600) · `Add up to 3 people to help with your trades. You choose what each one can do.` (15/22 muted) · link `Add a team member` (monero-ink, 44 min-height) → Team(-Wide). "Log out all team members" is hidden in this state. (When members exist but none is logged in, the old line `No team members are logged in.` stays.)
2. Team card first line: `These are your team members' logins, not yours. They stay logged in until their session ends or you switch them off.` The log-out-all-team pop-up keeps "They can log in again unless you switch them off." (it's about logging back in, not the session; tell me if you want it changed too).
3. Over the limit (devices=over-limit: One device at a time on, 2 logged in): count reads `2 logged in · your limit is 1`; note `Log one out to keep going.`; meter bars past the limit turn --caution.
4. `Back to log in`: kept as is.
5. Session length line: `You stay logged in for {hours} h. Then we ask you to confirm it's you.` ({hours} = picked length, e.g. 8). With no length picked: `You stay logged in for the length you pick. Then we ask you to confirm it's you.`
6. p11-26, hold pop-up (switching a member back on from a weak login): adds `Only this change waits; everything else works as normal.` after "Until then they stay logged out."
- Not changed: "Last resort … recovery code starts a 24 h hold: everyone else is logged out…" is the recovery hold (G32/p11-35), a different thing from p11-26.

Heights: phone 4072 → **4486** (H base; team=none delta −215 → −163; the One-device +20 no longer applies when over the limit). Wide 2496 → **2658** (H base; −20 when a session length is picked).
