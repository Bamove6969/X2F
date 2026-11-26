# Review: multi-device note (comms/multi-device-2026-11-09.md), design view · md3, 10 Nov

**Drawable? Yes.** Every screen in sections 3.3–3.4 fits the existing LoginApprove sheet/modal and the Devices "How a new device gets in" card. It is drawn as tweak `approval: tiles|code` (default tiles = today, pixel-identical) plus `handover` on LoginApprove(+W) and `approval` on Devices(+W). Spec: audit/spec-md3.md.
Two design calls made while drawing (please confirm):
- The approving device shows only the **first four** digits and asks for the last two. If it showed all six (as the note's table reads, 3.3), the person could copy the last two from their own screen. Then the typing step proves nothing, and that is the step that blocks blind "yes" taps (2.2).
- The approving device must check the typed digits against **its own** computed code, not only against the server (6.1 says "server-side code"). If only the server checks, a compromised API passes its own key, which defeats the SAS.

## Collisions: board text that changes in code mode (tiles keeps all of it)
LoginApprove + LoginApprove-Wide, approving side:
- "If it's you, tap the number shown on the new device" + the three tiles 92 / 47 / 18 → code row + "If it's you, type the last two digits shown on the new device".
- "Wrong number, so we blocked it" / "The number you tapped didn't match the one on the new device, …" → "Those digits didn't match, so we blocked it" / "The digits you typed didn't match the code on the new device, …".
- Facts list gains "Logged in with"; a chats box is added; the approved state gains "Chrome, Windows can now read and send your trade chats." (strong to strong only).
LoginApprove + LoginApprove-Wide, new device:
- "Your number" → "Your code". "47" (72px) → "418 206" (56px).
- "On your other device, tap 47, then Yes, let them in." → "…check the first four digits match, type the last two, then Yes, let them in."
- Step 3 "Tap 47, then Yes, let them in." → "Check the first four digits match, type the last two (06), then Yes, let them in."
- "Your other device said no, or a different number was tapped." → "…or the digits typed didn't match."
- "If it was you, try again. You'll get a new number." → "…a new code."
- The Jabber line ("If you turned on Jabber alerts, we've sent you a message there too.") is **already on both twins**, in step 1 of "Where do I approve it?". Nothing to add. It stays in code mode.
Devices + Devices-Wide:
- Tile "47" → "418 206". "Tap the 2-digit number the new device shows." → the 6-digit / last-two sentence, plus a chats-and-log-out paragraph.
- Log-out sheets add "…and can't read new chat messages" (rotation, Q6).
Not changed but in conflict (lead to rule):
- Devices "No other device with you?" says "…or your password with an authenticator code", and the Devices aside G34 says the same. On `wip/lead-hold-v3-port`, password + TOTP with nothing logged in is refused (`approval-unavailable`, note 1.5). LoginApprove's own card already leaves password + TOTP out. Owner G34 and the port disagree.
- Note 3.4's weak-approver copy ("…or let it in without them") conflicts with `approval.ts:554`: a weak session can't answer a strong login at all. So the weak-approver case is drawn only as weak approver + weak login.
- 3.4 also asks for "Log out devices you don't recognise" in the blocked state. Not drawn (outside this brief); it is a one-line add when the lead wants it.

## Risks to the user experience
- The phone sheet grows from 693 to 932 px (1018 px at the device limit), taller than an 844 screen. Yes / No go below the fold, so the builder needs a scrolling sheet with the buttons kept in view.
- "Strong security" is the owner's word but jargon. The two "won't get your chats" lines spell out the methods; the strong-to-strong line does not, to stay short.
- Nothing on Devices shows which device holds the chats. Q2's "gets the keys from a live strong device in Devices" (and 4.2's "Give <device> your chats") has no screen yet. Section 5 does not ask for a "Has your chats" tag, so none is drawn. That needs a lead call before that flow is built.
- A weakly approved device sees chats read-only ("This conversation is open on another device"). That ChatPanel line should say how to get them (stronger login), or users will think chat is broken.
- If Q5 (fatigue brake) passes, the new device needs a "paused for an hour" state, and none exists. The approving side also has no "too many requests" wording.
- Tor Browser: "Your trade chats came with it" is true only until the browser closes (Q8). That needs a line somewhere, not drawn.
- Phishing is unchanged ("is it 418 206? tap yes"). Showing four digits and typing two adds friction for blind taps only, not against a caller.

## Recommendations p11-100..107 (assumed = note section 5 items 2–9; no source names these ids)
- p11-100 (weak login approved: session, no chats): Yes. Both screens say so before and after (drawn).
- p11-101 (password session may approve a password login): Yes. Drawn as "weak this device", with no chats.
- p11-102 (two Jabber notices, on by default): Yes. The existing step-1 line already fits.
- p11-103 (two blocks → 1 h pause): Yes, but design owes the paused state on the new device first.
- p11-104 (chat key rotation on remote log-out, etc.): Yes. Drawn as "can't read new chat messages" on Devices.
- p11-105 (release/fund stay on the setting-up device): Yes. The trade room then needs a "release from the device that set this trade up" line (not drawn).
- p11-106 (losing your only device loses open chats): Accept, with a plain warning in setup/Devices and a Tor line.
- p11-107 (no chat keys for team members): Yes. Nothing changes on these boards.
