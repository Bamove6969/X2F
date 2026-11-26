# Build spec: md3 boards, multi-device approval (10 Nov 2026), COPY-UNSIGNED

Row S-075 (owner p11-4). Gesture waits on owner p12-5 (Q-012). Source: comms/multi-device-2026-11-09.md sections 3.3–3.4, 4.3, 5. Review: audit/review-multi-device.md.
All colours are THEMES tokens. Numbers are in Atkinson Hyperlegible Mono. **Build nothing user-facing until p12-5 is answered.** The default tweak `approval: tiles` is today's board, unchanged (pixel-identical to the 9 Nov boards on every tweak combination checked).

Builder data (from the approval view, note 6.1): `method`, `strength` (new login), the approver's own session `strength`, `code` (6 digits, computed on each device from approvalId + devicePublic + nonce). `handover = newLogin.strength === 'strong' && approver.strength === 'strong'`.

---

## 1. LoginApprove.dc.html (phone 390) and LoginApprove-Wide.dc.html (1280)
Reached from: the live `login-approval` event / push on a logged-in device (existing side); Login → `approve-on-device` (new side, ApproveOnDevice.tsx).

New tweaks: `approval` = tiles (default) | code; `handover` = strong to strong (default) | weak new login | weak this device. `handover` only shows in code mode.

### Existing side, ask (code mode). Order inside the sheet/modal:
1. Pill and h2: unchanged.
2. Facts list: Device, Time, **new row** "Logged in with" (dt 14/20 muted · dd 15/22 600, right-aligned, row min-height 48, top border surface), then Where. Values (from `method`):
   passkey "A passkey" · security key "A security key" · PGP "A PGP key" · password "Username and password" · password+totp "Password and authenticator code" · password+passkey "Password and passkey" · password+security-key "Password and security key" · pgp+passkey "PGP key and passkey" · pgp+security-key "PGP key and security key". Never a login name.
3. **Chats box** (flex, gap 10, padding 12/14, radius 12; chat-bubble icon 18; h3 15/20 600 + p 14/20):
   - strong to strong (background escrow 10% on surface, border escrow 30%, icon escrow): "This device will get your chats" / "Chrome, Windows will be able to read and send your trade chats. Chats only move between devices that both logged in with strong security, like this one."
   - weak new login (background surface-raised, icon ink-muted): "It won't get your chats" / "It logged in with just a username and password, so it can trade but can't open your chats. To get them, log in there with a passkey, security key, PGP key, or password and authenticator code."
   - weak this device (same style; the new login is also weak, because a weak session can't answer a strong login, approval.ts:554): "It won't get your chats" / "This device logged in with just a username and password, so it can't pass your chats on. You can still let the new device in to trade."
4. **Code row**, replacing the radiogroup and the three tiles:
   - Label (16/24 600, `<label for>` the input): "If it's you, type the last two digits shown on the new device"
   - Row (gap 6): digits 1–3 cells, a 10 px spacer, digit 4 cell, then the input. Cell 44×64, radius 12, surface-raised, mono 28/32 500. The group has role img, aria-label "Code here starts 4 1 8 2". **Show only the first four digits on this device.**
   - Input 94×64, radius 12, 2 px ink border, surface bg, mono 28/32 500, letter-spacing 14, `inputmode=numeric`, `maxlength=2`, `autocomplete=off`, digits only.
   - Hint (14/20 muted): "The first four should match the new device too. If they don't, tap No, block it." ("tap No, block it." does not wrap)
5. The at-limit / one-at-a-time notes, the buttons and the countdown are unchanged. "Yes, let them in" is disabled until 2 digits are typed. Compare the digits **on this device** against its own code (and on the server). A mismatch blocks.
- Wrong digits: title "Those digits didn't match, so we blocked it" · text "The digits you typed didn't match the code on the new device, so that login was blocked to be safe. If it was you, start again on the new device. Nobody else is affected." The rest of the blocked state is unchanged.
- Approved (strong to strong only), after the h2: p 16/24 "Chrome, Windows can now read and send your trade chats."

### New side (code mode)
- Pill "Your number" → "Your code". Big number "47" (72/80) → "418 206" (56/80, letter-spacing 0.04em, nowrap). Same line height, so the waiting heights are unchanged.
- Caption: "On your other device, check the first four digits match, type the last two, then Yes, let them in."
- "Where do I approve it?" step 1 is unchanged and keeps the Jabber line: "Open X2F on a phone or computer where you're already logged in. If you turned on Jabber alerts, we've sent you a message there too." (already on both twins). Step 3: "Check the first four digits match, type the last two (06), then Yes, let them in." (the digits in mono).
- Approved, after "Your other device approved this login. …":
  strong to strong "Your trade chats came with it, so you can read and send messages here." · weak new login "You can trade here. To open your chats on this device too, log in with a passkey, security key, PGP key, or password and authenticator code." · weak this device "You can trade here. Your chats didn't come over, because the device that approved you can't pass them on."
- Blocked: "Your other device said no, or the digits typed didn't match." · "If it was you, try again. You'll get a new code."
- Design notes (code mode only, below the app frame): OPEN aside "OPEN · owner p12-5 (Q-012) · S-075, p11-4".

### Heights (night)
- Defaults unchanged: phone 844, wide 800. Tiles waiting (new side) 1123 / 1160 / 1120 (phone), 1166 / 1207 / 1187 (wide).
- Code mode (app frame + notes):
  - Phone: ask 984 (at limit / one at a time 1070); new waiting 1123 / 1160 / 1120; others 844; notes +385.
  - Wide: ask 855 (941 / 921); new waiting 1188 / 1229 / 1209; others 800; notes +247.
- Phone sheet: 693 → 932 (1018 at limit). Taller than an 844 screen, so the sheet scrolls; keep Yes / No in view.
- Wide modal: 572 → 791 (877 / 857).
- Board mechanics: code mode wraps the app in a frame (`appStyle`) and puts the notes below it. In tiles mode the frame is `display: contents`.

## 2. Devices.dc.html (390) and Devices-Wide.dc.html (1280)
Reached from: Settings → Devices and sessions; LoginApprove "Devices" link. New tweak: `approval` = tiles (default) | code.
- "How a new device gets in" → Usual way. The tile "47" (40×40) → "418 206" (height 40, padding 0 12, auto width, mono 16/20 500, nowrap).
- Text becomes two paragraphs (15/22 muted; the second has a 4 px top margin):
  "Your other devices ask "Is this you?" and show a 6-digit code. Type its last two digits as the new device shows them. Say no and the login is blocked."
  "Your chats move to the new device only when both devices logged in with a passkey, security key, PGP key, or password and authenticator code. A device you log out here can't read new chat messages."
- Log out one device sheet: "It's logged out right away and can't read new chat messages. To use it again, approve it from a device you're still logged in on."
- Log out all other devices sheet: "{names} is/are logged out right away and can't read new chat messages. Only this device stays logged in."
- (Both waiting on Q6 / p11-104: chat key rotation on remote log-out.)
- No "Has your chats" tag on device rows (section 5 does not ask for one; see the review).
- Design notes, code mode only: OPEN aside "OPEN · owner p12-5 (Q-012), p11-100..107 · S-075".
- Heights: default unchanged (phone 4486, wide 2658). Code mode adds a fixed +344 (phone) / +234 (wide) to `H`; checked with the vendor, idle-reminder, team-none and over-limit variants.
