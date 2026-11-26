# Full abilities on every strongly logged-in device (design note, 2026-11-09)

Job J-23, row S-075 (owner p11-4, 8 Nov 2026). Plan 2 Task 16 (new-device approval), Plan 3 Task 41 (LoginApprove and Devices). A written design check before anything is built, as the owner asked. Read-only: no code was changed. Code read on `wip/lead-multi-device` at batch 3 head `d7d00e8d`, plus `wip/lead-hold-v3-port` (`e708ef56`) and `wip/lead-jabber-notices` (`5d2b6e61`), and the two security-architect notes in the comms worktree (`research-chat-crypto-2026-11-08.md`, `design-chat-membership-keys-2026-11-08.md`).

**The owner's words (p11-4, `owner-answers-page11-2026-11-08.md:19`):** "Why would you not retain your abilities on additionally logged in devices. Full abilities if you can successfully login with strong security. Actually maybe we should consider click yes it's you trying to login on a new device when you respond to a notification on a device you're already logged in on, basically pretty good security, so no 24 hours without any abilities on the new device. If you can approve that notification you're golden. Also this would be certainly a secure Jabber-worthy notification as well."

**Verdict in one paragraph.** Most of what the owner describes already exists for *logging in*: a new device is approved from a notification on a logged-in device with no 24-hour wait, and the approved session has every ability the login's strength allows. What a second device does **not** have today is the **chat**: each trade chat's secret key lives on exactly one device, and a second device sees the chat read-only ("This conversation is open on another device"). The real work in J-23 is handing chat keys to the new device without the server ever seeing them, and that is also the part that makes the owner's p12-5 question (one 6-digit code on both screens) load-bearing: picking one of three server-chosen numbers is enough to approve a login, but not enough to hand over a key safely. **Recommendation: wait for p12-5 and land the two branches this depends on (hold v3 port, Jabber notices) before building; the API groundwork that does not depend on p12-5 (sections 6.1 and 6.2) can start now.**

---

## 1. What main and batch 3 do today for a new device

### 1.1 The login path

- Every trader login that passes its credentials ends in `traderLogin` (`apps/api/src/auth/approval.ts:206-343`): PGP and WebAuthn through `completeLogin`'s trader branch (`apps/api/src/auth/login.ts:80-87`), a password alone (`apps/api/src/auth/password.ts:268`, `factors: ['password']`), a password with its authenticator code (`apps/api/src/auth/totp.ts:353`, `factors: ['password', 'totp']`, `proven: { kind: 'password-totp' }`). A tripwire test says no other file starts a later full session (`apps/api/test/deviceApproval.test.ts:626-628`).
- The login's strength is `loginStrength(factors)` (`approval.ts:220`; `apps/api/src/auth/strength.ts:27-32`). Strong is exactly the owner's list `STRONG_COMBOS` (`strength.ts:17-25`): a passkey or security key alone, password + TOTP, password + passkey or security key, PGP + passkey or security key. On batch 3 a PGP key alone is `pgp-single` and waits; on `wip/lead-hold-v3-port` the owner's Q81 (6 Nov) makes PGP alone strong and drops `pgp-single` (port `strength.ts`, `STRONG_COMBOS` includes `['pgp']`; migration 016 rewrites stored rows).
- The device is a random 32-byte `__Host-x2f_dev` cookie, 400 days (`apps/api/src/auth/device.ts:10-11`), stored only as an HMAC under `subkey('device')` (`device.ts:28-32`). A device is **trusted** for an account after any successful login or sign-up (`trustDevice`, `device.ts:43-50`, called from `openSession` at `apps/api/src/auth/sessions.ts:258`) and stays trusted while used within 90 days (`device.ts:53-62`; table `trusted_devices`, `apps/api/migrations/002_sessions.sql:19-25`).

Inside one transaction with the approval and account locks (`approval.ts:231-232`), `traderLogin` decides:

| Case | What happens | Where |
|---|---|---|
| This browser already holds a live full non-member session of the account | session now | `approval.ts:260-266` |
| An account hold runs and this is the real owner's strong login (methods predate the hold) | session now, hold ends, room made even over strong sessions | `approval.ts:273-275` |
| An account hold runs and the login waits | 403 `recovery-hold`, no session, trusted device or not | `approval.ts:278` |
| **No open full non-member session anywhere** | session now; **if the login waits and the device is not trusted, the session starts a 24-hour hold** (reason `weak-new-device`) | `approval.ts:281-290`, `:242` |
| Trusted device and under the device limit | session now | `approval.ts:293` |
| Strong login with no strong (or onboarding) session open to answer it | session now; weak sessions logged out to make room at the limit | `approval.ts:296` |
| Otherwise (untrusted device, or at the limit, with a device logged in) | **approval**: no session, `{ status: 'approve-on-device', approvalId, number, expiresAt }` | `approval.ts:298-331` |

So **the 24-hour hold on a new device exists only in the no-device case** (`approval.ts:290`). When a device is logged in, approval already gives the new device a full session at once. The owner's "no 24 hours" is already the rule for the approval path; it is the chat (1.4) and, on the port, the no-device case (1.5) that differ.

### 1.2 The approval itself

- **Binding.** The approval is bound to the new browser's device hash and to a fresh 32-byte `__Host-x2f_approval` cookie whose SHA-256 is stored (`approval.ts:13-15`, `:60`, `:323-328`, `:338`). Polling with anything else is 404 `not-found` (`approval.ts:377-388`).
- **Number matching.** `drawNumbers` (`approval.ts:71-81`) draws the right number (10-99) and two other distinct numbers from `crypto.randomInt`, shuffled. The new device shows `number`; the logged-in device is offered the three `choices` and never told which is right. Schema: `login_approvals.number`, `choices` (`apps/api/migrations/013_device_approval.sql`, the `number`/`choices` columns with their checks); `strength` was added by migration 014 (`014_account_hold.sql:12`).
- **Limits.** 5 minutes to decide, another 5 to collect (`APPROVAL_TTL_MS`, `approval.ts:53`); at most 3 open per account (`approval.ts:55`, `:313-318`); at most 10 started per account per hour, then 429 `slow-down` (`approval.ts:57`, `:298-307`); a new approval from the same browser supersedes its earlier one (`approval.ts:309-312`).
- **What the logged-in devices are told.** A live event `{ type: 'login-approval', id }` (`approval.ts:340`; `apps/api/src/events/bus.ts:11`) and the fixed push "Someone is logging in. Is this you?" (`approval.ts:341`; `apps/api/src/push/send.ts:25`). Then the device fetches the approval over its own session: `GET /v1/account/approvals` → `ApprovalView { id, deviceLabel, choices, createdAt, expiresAt, atLimit, oneDevice }` (`approval.ts:485-509`). The label is coarse, "Firefox on Linux" or "A new device", from fixed lists and never the client's free text (`coarseDeviceLabel`, `approval.ts:109-116`; the column refuses digits, `013_device_approval.sql`). No IP address exists anywhere (R5).
- **Deciding** (`POST /v1/account/approvals/:id`, `approval.ts:530-596`): needs a full trader session (`requireSession({ kinds: ['trader'] })`, `approval.ts:608`; so not a recovery session, `sessions.ts:416`, and not a team member, `sessions.ts:413`), re-checked live under the locks (`approval.ts:541`, `hold.ts:381-393`), from a different device than the one logging in (`approval.ts:548`). A **weak session may not answer a strong login** (`approval.ts:554`; `weakOf`, `apps/api/src/auth/hold.ts:363-368`; `WEAK_LIMITED_ROUTES`, `hold.ts:567-574`), but it may approve or block a weak one. The right number approves; a wrong number or "No, block it" blocks and writes alert `login-blocked` (`approval.ts:555-561`). **An account on its 24-hour hold approves nothing** (`approval.ts:564`; `HOLD_BLOCKED_ROUTES`, `hold.ts:582-603`). Decisions are throttled per session, 10 then 5 a minute (`approval.ts:618-619`; `apps/api/src/limits.ts:84`).
- **Collecting** (`POST /v1/login/approval/:id/poll`, `approval.ts:390-443`): the session starts only if the approving session is still live (`approval.ts:421-427`), under the same locks, and not while a hold runs for a login that waits (`approval.ts:418`). The session gets the approval's stored `strength` (`approval.ts:431-433`). `openSession` then trusts the device, writes alert `new-login` and pushes the fixed "New login to your account" to the account's other devices (`sessions.ts:258`, `:268`, `:275`; `push/send.ts:26`).

### 1.3 The screens

- **New device** (`apps/web/src/screens/auth/ApproveOnDevice.tsx`): shows the 2-digit number large (`:190-201`), polls every 2 s (`POLL_MS`, `:28`), a countdown, "Where do I approve it?" and a "No other device with you? Log in with a backup instead." card (`:221-229`). Blocked copy: "Your other device said no, or a different number was tapped." (`:163`). The Login screen hands every `approve-on-device` result here (`apps/web/src/screens/auth/Login.tsx:176`, `:227`, `:314`, `:351`, `:396`, `:419`).
- **Logged-in device** (`apps/web/src/screens/auth/LoginApprove.tsx`), opened by the live event (`apps/web/src/App.tsx:121-135`): "Someone is logging in on <label>. Is this you?" with a facts list of **Device**, **Time** (UTC) and **Where: "Not shown. X2F doesn't log IP addresses, so we can't show where."** (`LoginApprove.tsx:228-248`), the three number tiles (`:252-259`), **Yes, let them in**, **No, block it** (`:104-108`, `:267-270`) and the countdown (`:271-277`). After a block it offers "Change login method" (`:158-189`). At the limit it asks which device to log out (`:200-226`).
- **Devices** (`apps/web/src/screens/settings/Devices.tsx`): the session list with remote log-out, the count against the limit (full sessions, members included, `:219`), "One device at a time", and the explanation "Tap the 2-digit number the new device shows." and "X2F doesn't log IP addresses, so devices are named only by browser and system." (`:64-68`).

### 1.4 How a second device gets the chat keys today: it does not

- **One chat identity per chat per role, made on one device.** The escrow worker makes an Ed25519/X25519 identity (`packages/protocol/src/identity.ts:11-20`; in `apps/web` only the worker may call it, `apps/web/src/escrow/worker.ts:11`, `:136`, `:156`) and registers its public keys with `POST /v1/chats/:chat/identity` (`apps/api/src/chat/routes.ts:335-352`), **one row per role** (`on conflict (chat, role) do nothing` → 409 `identity-exists`, `routes.ts:348-351`; table `chat_identities`, `apps/api/migrations/106_chat.sql:27`). The API stores public keys and the proof only (`routes.ts:1-3`).
- **The secret keys live only in that device's IndexedDB** (`apps/web/src/chat/store.ts:1-17`, record field `identity` with `signSecret`/`boxSecret`, `store.ts:49`), wrapped by a non-extractable AES-GCM key kept in the same database. Nothing ever uploads them.
- **A second device is read-only.** `ChatView.mySignPublic` tells a device whether the key the API holds for its role is its own (`routes.ts:65-68`). The engine's `ensureIdentity` returns null when another key holds the role (`apps/web/src/chat/engine.ts:190-226`, `:6-9`), the phase is `other-device` and nothing is sealed; the panel shows "This conversation is open on another device" (`apps/web/src/chat/ChatPanel.tsx:46`; test `apps/web/test/chatEngine.test.ts:149`).
- **Messages are sealed to buyer, seller and the chat's mod identity**, one `crypto_secretbox` ciphertext with the key wrapped per role by `crypto_box` (`apps/web/src/chat/chatCrypto.ts:3-14`, `:172-181`; the protocol's envelope, `packages/protocol/src/envelope.ts`, reviewed in Plan 1 Task 3). Ordering is a per-device `seq` counter and ReplayGuard (`chatCrypto.ts:15-18`, `:60-66`).
- **The escrow party keys are bound the same way**: one trade identity per trade per role per device (`apps/web/src/escrow/store.ts:2-4`; `apps/web/src/escrow/runtime.ts:154`; `apps/api/src/trades/identity.ts:60-89`, 409 `identity-conflict`). "Full abilities" in the sense of releasing or funding on a second device is Plan 3 Task 42's OPEN key question (R44: X2F holds at most one key per trade) and is **out of scope** here; this note is about chat.

### 1.5 What `wip/lead-hold-v3-port` changes (the branch this will land on top of)

Hold model v3 (owner 1-2 Nov; port `hold.ts:1-37` header):

- Weak-session changes are **staged** 24 h (`holdChanges.ts`), nobody is logged out, trading goes on. An **account hold** exists only for a **recovery-code login**: every session ends, no login opens a session while it runs except the owner's passkey, security key or PGP key, and the account's trusted devices are forgotten (review `review-hold-v3-2026-11-08.md`, prior C1: `recovery.ts:226`).
- `traderLogin` on the port (diff hunk `@@ -285,15 +300,20 @@`): **the no-device case no longer starts a hold.** With nothing logged in to approve it, a trusted device gets in; a new device gets in only with a passkey, security key or PGP key; a password, with or without an authenticator code, is refused with 403 `approval-unavailable` and nothing is held. During an account hold **nobody** logs in and no approved login is collected (`poll`, "during an account hold no approved login is collected").
- A strong login no longer discards a weak session's waiting changes; it sees and may approve, untick or cancel them (owner G58).

So after the port, the phrase "24-hour hold on a new device" has no code behind it: a new device either is approved from a logged-in device, logs in with a strong key, or uses the recovery code. The owner's "no 24 hours" is satisfied; what remains is **chat keys** and the **approval mechanism** that can carry them.

### 1.6 Jabber (`wip/lead-jabber-notices`, not landed)

The sender renders only fixed sentences (`apps/api/src/jabber/sender.ts:8-39`): `account-change` ("An account change was made on your X2F account."), `trade-attention`, and the six-digit set-up test code. Notices are queued by row triggers on the account-change tables (`apps/api/src/jabber/changePaths.ts:1-9`, migration 331) and sent by an outbox worker after commit (`apps/api/src/jabber/outbox.ts:1-7`). There is **no login or approval notice kind yet**, and no trigger on `login_approvals` or `sessions`. OMEMO and Tor are mandatory (owner p11-31, row W-007). Per p11-27 the owner also wants a Jabber settings page where the person picks which events notify.

---

## 2. Threat model of "no 24 hours" with chat on every approved device

The 24-hour hold was never the thing protecting the approval path (1.1). What changes with J-23 is that an approved device becomes able to **read every open chat and speak as the account to counterparties**. Chat is where a thief does damage on a no-custody site: "send the money to this other account instead" (R16, the sender-can-omit-the-moderator weakness, is already noted in `design-chat-membership-keys-2026-11-08.md` section 9). So the threat model is about **who can get a device approved, and what an approved device can then hand on.**

### 2.1 Stolen password + phished approval

A thief with the username and password logs in on his own device. The real owner's phone shows "Someone is logging in on Chrome on Windows. Is this you?" with three numbers. Today the thief must get the owner to tap *his* number: he must contact the owner out of band ("X2F support here, tap 47 to secure your account"). The push carries no number and no detail (`push/send.ts:19-27`), so there is no in-band channel for it.

- **With number matching kept**, the attack surface is unchanged: a phone call or a chat message from a scammer. A random tap is blocked 2 times in 3 and ends the attempt (`approval.ts:555-561`).
- **With one 6-digit code on both screens (p12-5)**, the same phish works the same way ("read me the code on your screen" is not even needed: "is it 418 206? tap yes"). The code's job is different: it binds the **new device's key** to what the owner approves, so a compromised API cannot swap in its own key (section 3.3). It does not make phishing harder or easier.
- **What the approved thief gets.** A password-only login is `weak-single` (`strength.ts:27-32`): the session can trade and read alerts but every security change is staged 24 h on the port (hold v3). **Under the owner's rule the new device gets chat keys only if its own login was strong** (section 3.1), so a password thief approved by a phished owner still gets **no chat keys**. That is the main reason to tie the handover to the new login's strength and not to the approval alone.
- **Residual:** a thief who also holds the second factor (a cloned TOTP seed, a stolen passkey device) logs in strong, and a phished approval then hands over the chat keys. Mitigations: the approving screen names the method and says plainly that approving gives this device the chats (3.4); the `new-login` push and alert to every other device (`sessions.ts:268`, `:275`); the Jabber notice (3.5); the Devices list with remote log-out, which must **rotate the chat key** (4.3).

### 2.2 Approval fatigue

A thief with the password can start up to 10 approvals an hour (`approval.ts:298-307`), each a push "Someone is logging in. Is this you?", until the owner taps Yes to make it stop, or taps a number at random.

- Already in place: a wrong number blocks (1/3 odds, one try, `approval.ts:19`, `:555-561`); at most 3 open approvals (`:308-313`); the per-hour cap; "No, block it" leads to "Change login method" (`LoginApprove.tsx:168-184`).
- **Gap:** nothing slows the thief down after a block. He starts a new approval at once (a new number, a new push). Ten pushes an hour, all night, is a real fatigue attack.
- **Proposed:** after **two blocks within an hour** for an account, refuse new approvals for that account for one hour (429 `slow-down` with the reason, like the per-hour cap) and write one alert `approvals-paused`. The owner's real new device can still get in with a strong key when no device is logged in, or wait an hour. This changes what a user can do, so it is **owner question 5**.
- With the 6-digit code, "tap to make it stop" is Yes/No, with no 1/3 chance of a wrong number blocking. That is one more reason to require an active step (3.3: typing the code's last two digits) rather than a bare Yes.

### 2.3 A thief on an already-approved device approving his own second device

If the thief holds a live session (an unlocked stolen phone, a copied session cookie), he can approve further devices of his own. Today:

- a weak session may approve a **weak** login (`approval.ts:554` refuses only strong targets), so a password thief with one session can grow to the device limit (3, `approval.ts:59`) and keep a foothold after the owner logs one out;
- the owner learns of each through `new-login` push and alert (`sessions.ts:268`, `:275`) and the Devices list;
- a recovery-code login ends every session and forgets every trusted device (port: `recovery.ts:226`); the owner's strong proof ends a hold and the waiting sessions (`hold.ts:266-294`).

With chat keys the question is **who may hand the key on**. Rule proposed in 3.1: only a device whose **current session is strong** may hand over the key, and only to a login that is itself strong. A password thief's session never holds a key handover right, whatever device it sits on. A thief with a strong foothold (2.1 residual) can hand the key on; the countermeasure is **key rotation on every removal** (4.3), so logging his devices out from Devices, or a recovery-code login, makes what he holds useless for new messages.

**Should weak sessions approve weak logins at all?** Keeping it (as today) lets a username-and-password trader use two phones; refusing it would send every new device of such a trader to the "no other device" path, which on the port refuses passwords (`approval-unavailable`). That is a product trade-off: **owner question 3**. Recommendation: keep it, with no key handover.

### 2.4 The recovery hold (hold v3) and the approval

- During an account hold no approval is decided (`approval.ts:564`; `HOLD_BLOCKED_ROUTES`) and no approved login is collected (port `poll`). A key handover posted during a hold must be refused the same way (the handover route joins `HOLD_BLOCKED_ROUTES` and `LIVE_SESSION_ROUTES`, 6.2).
- The recovery-code login ends every session and forgets trusted devices. The thief's device may still hold the **account chat key** in its IndexedDB. So the recovery-code login and the owner's proof that ends a hold must also **mark the current chat key epoch as revoked** so that the next device to log in strongly makes a new one (4.3). Otherwise "log everyone out" does not log the thief out of the chats.
- A recovery session is never a logged-in device for approvals (`approval.ts:281-286` counts full sessions only; `requireSession` refuses recovery on the approval routes) and must never receive or hand over chat keys.
- The owner's one-way-only account (username and password) with nothing logged in: on the port it is refused (`approval-unavailable`) and uses the recovery code. The recovery session is held 24 h and cannot chat; after the hold its device has no chat keys for the chats made before (nobody can hand them over). **That trader loses the chat history of open trades for good** when they lose their only device. The counterparty's copy and the ciphertext on the server remain; a dispute still works through the moderator. **Owner question 8.**

### 2.5 Team members vs the lead

- A member's login is always two factors and is marked `strong` (`login.ts:118-122`); it starts a session **of the team account** tagged with the member (`sessions.ts:211-228`). Member sessions are never logged-in devices for the owner's approvals and never approve (`approval.ts:281-286`, `member_id is null`; the routes are owner-only, `sessions.ts:413`); a member's own login never waits for an approval (`deviceApproval.test.ts:554`). The owner is alerted on each member login (`sessions.ts:261`) and, per p11-27, wants a Jabber notice too, with no first-login approval.
- Members have **no chat identity at all** today: chat is the owner's device's (Plan 3 Task 42 OPEN; R44). A member on a second device changes nothing for chat until Task 42's member-key scheme is designed. The lead's chat key must **not** be handed to member sessions by this design; member access to chats, when it comes, is a wrap of the chat key to the member's own key, added by the lead's device and logged (design note section 8). **Owner question 9** (confirm: lead's devices only, for now).
- p11-26: a member's weak login holds only that member's own changes. Nothing here changes that.

---

## 3. The proposed design

### 3.1 The rule

1. **A new device's login is approved from a logged-in device, as today** (1.1-1.2), with no hold. The approval row already stores the new login's `strength` (`approval.ts:323-328`).
2. **The new device gets the account's chat keys at approval only when both sessions are strong**: the new login's `strength === 'strong'` (`strength.ts`, the owner's list; PGP alone included on the port, Q81) **and** the approving session's stored `strength === 'strong'`. Not `!weakOf(...)`: `weakOf` treats a sign-up's first 30 minutes as not weak (`hold.ts:363-368`), which is right for logging out but wrong for handing over keys.
3. A weak new login that is approved gets a session as today and **no chat keys**: its chats stay `other-device` read-only, exactly as now. The approving screen says so before the tap (3.4).
4. Nothing is handed over during an account hold, to or from a recovery session, or to or from a team member's session.
5. The server is a courier only: it stores the new device's public key, a sealed blob it cannot open, and the code's inputs; it never holds a chat secret (section 4).

### 3.2 What "strong" means, per the existing code

- `sessions.strength` is written at every login from `loginStrength(factors)` (`approval.ts:220`, `:239-241`; `sessions.ts:193-194`) and carried onto an approved login from the approval row (`approval.ts:431-433`). It never changes for the life of the session, and "Stay logged in" rotates the token without touching it (`sessions.ts:127-136`).
- Strong today (`strength.ts:17-25`): `['passkey']`, `['security-key']`, `['password','totp']`, `['password','passkey']`, `['password','security-key']`, `['pgp','passkey']`, `['pgp','security-key']`; on the port also `['pgp']`. Changing the list is an owner decision (`strength.ts:16`).
- The check must read the session row under the account lock (`requireLiveSessionInTx`, `hold.ts:381-393`, returns `strength`), as `decide` already does (`approval.ts:541`).

### 3.3 Code matching and the key handover (depends on owner p12-5)

Today's number matching proves that the person approving can see the new device's screen. It does **not** bind what they approve to the new device's key: the server chooses the number (`drawNumbers`, `approval.ts:71-81`), so a compromised API could attach its own public key to the approval and the owner would approve it just the same. For a **login** that does not matter (the server already decides who is logged in). For a **key handover** it does: the sealed chat key would go to the API's key. The fix is the standard short-authentication-string pattern (design note section 8):

1. The new device makes a fresh X25519 device key in the worker and sends `commit = generichash(devicePublic)` with its login (`traderLogin` stores it on the approval).
2. The approving device fetches the approval and the server hands it a random 32-byte `nonce` made at that moment (stored once).
3. The new device's poll reveals `devicePublic`; the server checks it against `commit` and stores it.
4. **Both devices compute and show the same 6-digit code** `code = generichash("x2f/device-sas/v1\0" + approvalId + devicePublic + nonce) mod 10^6`. The commit-then-reveal order means a server cannot search for a key whose code matches the one already shown.
5. The approving device seals the chat key to `devicePublic` (`crypto_box_seal`) and posts it with its decision; the new device's poll returns the blob, which only its device key opens.

**What depends on p12-5:**

| Owner says | Login approval gesture | Key handover | Schema and screens |
|---|---|---|---|
| **Yes, one 6-digit code on both screens** (recommended) | The approving device shows the code and asks the person to **type its last two digits** as read from the new device (keeps today's "you must look at the new device" property and the 1-in-100 odds against a blind tap), then Yes / No, block it | The same code is the SAS; the sealed key rides on the decision | `login_approvals` loses `number`/`choices` for new rows, gains `commit`, `device_public`, `nonce`; ApproveOnDevice, LoginApprove, Devices copy and the LoginApprove boards change (design owes the board) |
| **No, keep the 2-digit tiles** | As today | Still needs the SAS: a **second** 6-digit code shown on both screens after the tile, only when a key is handed over (strong + strong) | Two codes on screen for strong logins; weak logins unchanged. More to explain; not recommended |
| **No key handover at approval at all** | As today | No chat on a second device (status quo), or a different channel (QR scan between devices: no server at all, but needs a camera and both devices in one place) | Nothing changes until he decides |

A pure "compare and tap Yes" (no typing) is weaker against fatigue (2.2) and against a user who taps without comparing; the two-digit typing step costs one extra second. **Recommendation: Yes to p12-5, with the typed last two digits.** The exact words are design's (COPY-UNSIGNED).

### 3.4 What the approving device must show

Today: Device (coarse label), Time (UTC), Where ("Not shown...") (`LoginApprove.tsx:232-248`). Add, all from the approval row and nothing else:

- **How they logged in**: "with a passkey", "with a security key", "with a PGP key", "with a username and password", "with a username, password and authenticator code" (from `method` and `strength`; `login_approvals.method`, `013_device_approval.sql`). Never a login name.
- **What approving gives**: for strong + strong, "This device will be able to read and send your trade chats." For a weak login, "This device will be able to trade, but not to open your chats until it logs in more securely." For a weak approving session, "This device can't hand over your chats; approve from a device that logged in with a passkey, security key or PGP key, or let it in without them." (COPY-UNSIGNED; design's words.)
- **The code** (3.3) and the input for its last two digits; the countdown as today.
- **No change to what is not shown**: no IP, no place, no free-text label (review M5, `approval.ts:10`, `:330`), nothing about the account's other devices to the new device before it is approved.
- The blocked and ended states stay as built. After a block, the advice "Change your login method" (`LoginApprove.tsx:168-174`) should also say "Log out devices you don't recognise" with the Devices link, because that is what rotates the chat key (4.3).

### 3.5 The Jabber notice

- Two fixed sentences, one per event, as `NoticeKind`s in `sender.ts` (`'login-approval'`: "Someone is trying to log in to your X2F account."; `'new-login'`: "A new device logged in to your X2F account." COPY-UNSIGNED), nothing else in the message, as the rule p5-7 requires (`sender.ts:1-6`). Queued through the outbox (`outbox.ts`) when the approval row is inserted (`approval.ts:323-329`) and when the approved session starts (`sessions.ts:268`), by a trigger on `login_approvals` insert and on `sessions` insert with `level = 'full'` and `member_id is null` (the member's login already alerts the owner; whether members' logins also go to the lead's Jabber is p11-27's settings page).
- Both are **off by default** until the owner's Jabber settings page (p11-27) lets the person turn them on, or on by default: **owner question 4**. Recommendation: on by default for everyone who set Jabber up, since the owner called this "certainly Jabber-worthy".
- Jabber is an alert, never an approval channel: no code and no link ever goes over it (the sender refuses anything but the fixed text, `sender.ts:33-39`).

---

## 4. How chat keys reach the new device safely

Principles: the server never sees a chat secret; secrets never cross `postMessage` out of the escrow worker (`store.ts:16`); nothing new in cryptography (libsodium primitives already in use; `crypto_box_seal` is in the same build but not yet exported by `@x2f/protocol`, so adding it is a protocol change that needs the Plan 1 Task 3 reviewer's eye).

### 4.1 The per-device key options

| | A. Account chat key (ACK) handed over at approval | B. Per-device chat identities in the envelope | C. Re-wrap each chat identity device-to-device, no shared key |
|---|---|---|---|
| **Shape** | One random 32-byte ACK per account, held by every strongly approved device. Each chat identity record (`signSecret`, `boxSecret`) is sealed under ACK with AAD `(accountId, chat, role)` and stored on the API (`chat_identity_records`). A new device opens them all with ACK. | Envelope v2: the per-role wrap slot becomes a list per device; attestation lists device keys per role; every sender seals to every device. | The approving device seals each chat's identity to the new device's key and posts the blobs; later, any device that creates a chat identity seals it to every other approved device's public key (a signed device list per account). |
| **Counterparty and moderator see** | One identity per role, as today. No device graph anywhere. | How many devices each side has, and when one is added (attestation re-issue). | One identity per role, as today. |
| **History** | The new device reads every chat from the first message (the identity is the same). | A new device cannot read messages sealed before it existed unless an old device re-wraps them. | Same as A for chats shared; a chat whose identity was never shared (device offline at the time) stays unreadable until it is. |
| **Removal / theft** | Rotate: a new ACK, every record re-sealed by a live strong device; the removed device keeps the old ACK and can open old ciphertext it already fetched, but the API stops serving it anything (its session is gone). | Stop listing the device; old messages it already held stay readable to it. Nothing to rotate. | Nothing to rotate; the removed device keeps what it had. |
| **Server holds** | Sealed secrets it cannot open (ciphertext under ACK). A DB leak plus one device's ACK opens that account's identities. | Public keys only, as today. | Sealed secrets per (chat, device). |
| **Work** | Smallest: a store record, a sealed blob on the approval, `ensureIdentity` opens the record instead of returning `other-device`. Fits the design note's section 8 and either envelope v1 or the planned per-trade TK model. | Largest: protocol v2, moderation attestation, every reader, R16 re-review. | Medium; a device-list and sync protocol of its own, which needs its own review. |
| **Tor Browser** | Clears IndexedDB on close, so a Tor-only trader's ACK dies with the session unless another device holds it (the escrow store has the same problem today). | Same for device keys. | Same. |

### 4.2 Recommendation: A, with these rules

1. **ACK is handed over only strong-to-strong** (3.1), sealed with `crypto_box_seal(ACK, devicePublic)` after the SAS (3.3), inside the decision transaction; the poll returns it with the session. The blob is deleted when collected or when the approval expires.
2. **Every chat identity record is sealed under ACK and posted** when a device makes a chat identity (`ensureIdentity`, `engine.ts:191-226`): `PUT /v1/chats/:chat/identity-record { sealed }` (one per role, owner sessions only). `ensureIdentity` on a device that has ACK but not the identity fetches and opens the record instead of returning `other-device`. A device without ACK (weak login, or none handed over) behaves exactly as today.
3. **Two devices sending as one identity.** `seq` is a per-device counter (`chatCrypto.ts:15-18`); the API refuses a seq not above the sender's last (`routes.ts:18`, `:390`, 409 `stale-seq`), and the engine opens every pending envelope before sealing (`chatCrypto.ts:159-161`), so the second device learns the first's latest seq from the server. Each device keeps its own ReplayGuard and receipts (`store.ts:27-42`); nothing is shared but the identity. The `ChatState` contract already says a seq is never reused (`chatCrypto.ts:169-170`). A test must pin two devices alternating without a `stale-seq` loop.
4. **ACK has an epoch.** `accounts.chat_key_epoch` (an integer) and each record's `epoch`. A device whose ACK epoch is behind cannot open newer records and asks another live device to re-seal by posting its device public key (the "Devices" screen on a live strong device shows "Give <device> your chats" with the same SAS). Simpler for v1: when the epoch moves, the device that moved it re-seals every record it can open at once.
5. **Exported from the worker only**: ACK, device keys and records live in `x2f-chat` (or a sibling store) under the same non-extractable wrap; the page sees phases and lines, never keys.

### 4.3 When ACK rotates (new epoch)

- A device is logged out from Devices or by "One device at a time" (`approval.ts:445-468`), or the owner's strong proof ends a hold (`hold.ts:266-294`), or a recovery-code login runs (port `recovery.ts`): the server bumps `chat_key_epoch` in that transaction and alerts `chat-key-rotated`. The next strong device that syncs makes a new ACK, re-seals every record it can open, and posts them. The removed device's old ACK opens nothing new and its session is gone, so it cannot fetch new ciphertext.
- Not rotated on the ordinary end of a session (expiry, logout from the device itself): the person still owns that device.
- A removed device keeps what it already read; no scheme undoes that (design note section 7).

### 4.4 What this does not cover

- The per-trade `TK` model and "only after a dispute becomes a lock" (`design-chat-membership-keys-2026-11-08.md` sections 2-3) are a separate redesign waiting on the owner's page-12 answers (Q-009 to Q-021). ACK layers under either: it protects the device-side identity records, not the message format.
- Escrow party keys on a second device (release, fund): Task 42's OPEN design, spec 3.1. The same ACK could seal trade identities, but that touches the "one key per trade" rule and needs its own review. **Owner question 7.**
- Members' chat access: Task 42 (R44).

---

## 5. What stays blocked on the owner

Each numbered, with a recommendation.

1. **p12-5 (Q-012): one 6-digit code shown on both screens, replacing the three number tiles?** It is what makes a safe key handover possible (3.3). *Recommend: yes, and the approving device types the code's last two digits as read from the new device, then Yes / No, block it.* Without it, the build stops at the login part (6.1) and chat stays single-device.
2. **A username-and-password login approved from your other device: a session as today, but no chat keys?** The owner said "full abilities if you can successfully login with strong security"; this reads that literally. *Recommend: yes. The new device chats only after it logs in with a passkey, security key, PGP key or password + authenticator code (and is approved again, or is now trusted and gets the keys from a live strong device in Devices).*
3. **May a username-and-password session still approve another username-and-password login** (as today), with no keys handed over? *Recommend: yes, keep it; refusing it would send every new device of such a trader to the recovery code.*
4. **Jabber: two notices ("Someone is trying to log in...", "A new device logged in..."), on by default for everyone who set Jabber up, until the p11-27 settings page lets them switch each off?** *Recommend: yes, on by default.*
5. **Approval fatigue brake: after two blocked approvals within an hour, no new approval for that account for one hour (the real owner can still get in with a strong key when nothing is logged in).** *Recommend: yes.*
6. **Chat key rotation: logging a device out remotely, "One device at a time", a recovery-code login and the owner's proof that ends a hold all make the next strong device issue a new chat key; the removed device keeps what it already read.** *Recommend: yes, as described; say so in the Devices copy.*
7. **Escrow keys (release, fund) on a second device are not in this build**; a second device chats and trades but releasing stays on the device that set the trade up (Task 42's OPEN question covers members and devices together). *Recommend: yes, chat first; one design for members and devices later.*
8. **A trader who loses their only device**: the chats of their open trades cannot be read on the new device (nobody is left to hand the key over); the server's ciphertext and the counterparty's copy remain, disputes work through the moderator, new chats work. Accept? *Recommend: accept; it is what makes the encryption real. Tor Browser users should be told their chats live only while the browser is open unless another device holds the key.*
9. **Team members' devices get no chat keys from this build**; the lead's devices only, until Task 42's member-key scheme. *Recommend: yes.*
10. **Design owes the LoginApprove boards for the code, the method line and the "this device will get your chats" line, plus the Jabber line on the wide twin** (register S-075, "design adds Jabber line to wide twin"). Not an owner question, but blocking for the web part.

---

## 6. Build plan

**Order:** land `wip/lead-hold-v3-port` first (it rewrites `traderLogin`'s no-device case and the hold checks this builds on) and `wip/lead-jabber-notices` (for 6.3). Then 6.1 and 6.2 can start before p12-5 is answered; 6.3 to 6.5 wait for it.

### 6.1 API: strength gate and handover plumbing (no owner dependency)

Files:
- `apps/api/migrations/3xx_device_handover.sql`: `login_approvals` gains `commit bytea`, `device_public bytea`, `nonce bytea`, `handover bytea` (the sealed ACK), `handover_epoch int`; `accounts.chat_key_epoch int not null default 0`; table `chat_identity_records (account_id, chat, role, epoch, sealed bytea, created_at, primary key (account_id, chat, role))`, cascade with `chats`, granted to `x2f_purge` like `chat_identities` (`106_chat.sql:78-79`).
- `apps/api/src/auth/approval.ts`: `traderLogin` accepts an optional `deviceCommit` and stores it; `views` returns `method`, `strength`, `handoverPossible` (both strong), `nonce` (made on first view), `code` inputs; `decide` accepts `{ code2: string, handover?: string }`, checks the typed digits against the server-side code, refuses a handover unless `row.strength === 'strong'` and the caller's live row `strength === 'strong'` (`requireLiveSessionInTx`), unless a hold runs (`holdInTx`), stores the blob; `poll` returns `{ status: 'ok', loggedOut, handover: string | null, epoch }` and deletes the blob. Keep `drawNumbers` behind a flag until p12-5 decides.
- `apps/api/src/auth/hold.ts`: the new route(s) join `LIVE_SESSION_ROUTES`, `HOLD_BLOCKED_ROUTES` and `WEAK_LIMITED_ROUTES` (`hold.ts:487-516`, `:567-574`, `:582-603`); bump `chat_key_epoch` in `endHoldIfOwner` (`hold.ts:266-294`) and in the port's recovery-code login; `routes/account.ts` session delete and `approval.ts` `endForNewDevice` (`:452-475`) bump it too.
- `apps/api/src/chat/routes.ts`: `PUT`/`GET /v1/chats/:chat/identity-record` (owner trader session, the caller's role, ciphertext only, 16 KiB cap); `ChatView` gains `identityRecord: boolean` and `chatKeyEpoch`.
- `apps/api/src/alerts.ts`: `approvals-paused`, `chat-key-rotated`; `limits.ts`: the two-blocks brake (if owner question 5 is yes).
- `packages/auth-client/src/api.ts`: `ApprovalView`, `ApprovalDecision`, `ApprovalPoll` types and the new calls.
- `packages/protocol/src/`: export `sealTo(publicHex, bytes)` / `openSealed(identityOrDeviceKey, blob)` (libsodium `crypto_box_seal`), with test vectors; review as a Task 3 change.

Tests (`apps/api/test/deviceApproval.test.ts`, new describes; `holdV3.test.ts`; `chat.test.ts`):
- a strong login approved by a strong session: the poll returns the handover blob once, then never again; the blob is bound to the approval and the device cookie (another browser gets `not-found`);
- a weak login approved by a strong session, and a strong login approved by a weak session: no handover accepted (403 `weak-session` / `handover-not-allowed`), the session still starts;
- a handover during an account hold is refused and the approval stays uncollected (as `poll` does today);
- a recovery session and a member session can neither view nor decide (as today) nor post a handover;
- remote log-out, "One device at a time", the owner's proof and a recovery-code login each bump `chat_key_epoch` exactly once, in the same transaction, with the alert;
- the identity record: one per (chat, role), owner only, ciphertext only, purged with the chat, 410 after purge;
- the brake: a third approval within an hour after two blocks is 429 with `reason: 'approvals'`, a strong login with nothing logged in still gets in;
- the coolingOff tripwire (`apps/api/test/coolingOff.test.ts`, "every route other than GET ... is classified") passes with the new routes classified.

### 6.2 Web worker: ACK store and `ensureIdentity` (no owner dependency)

Files: `apps/web/src/chat/store.ts` (an `account` record: ACK, epoch, device key pair, under the existing wrap), `apps/web/src/chat/engine.ts` (`ensureIdentity`: with ACK, open the record instead of `other-device`; after making an identity, seal and post the record; `sync` handles a 409 `stale-seq` by re-reading and sealing once more), `apps/web/src/escrow/worker.ts` (new messages `device-key`, `handover-open`, `handover-seal`; keys never leave the worker), `apps/web/src/chat/chatCrypto.ts` unchanged.

Tests (`apps/web/test/chatEngine.test.ts`, `chatCrypto.test.ts`): a second engine with the same ACK and a posted record is `ready`, not `other-device`, and reads the whole chat; two engines alternate sends with no `stale-seq` loop and both guards accept every line; an engine with an older epoch cannot open a newer record and reports it; a device without ACK is `other-device` exactly as today (the existing test at `:149` must still pass).

### 6.3 Jabber notices (after `wip/lead-jabber-notices` lands)

`apps/api/src/jabber/sender.ts` (`NOTICE_KINDS` + `'login-approval'`, `'new-login'`, COPY-UNSIGNED texts), `changePaths.ts` or an explicit enqueue in `traderLogin` (`approval.ts:323-329`) and `openSession` (`sessions.ts:268`) inside their transactions, migration for the outbox `kind` check, the settings-page toggles when p11-27's page exists. Tests: `jabber.test.ts` (one notice per approval and per new full login of the owner, none for a member's login unless the toggle says so, none during the owner's first session), `jabber-paths.test.ts` classification.

### 6.4 Web screens (after p12-5 and the boards)

`apps/web/src/screens/auth/ApproveOnDevice.tsx` (device key commit at login, the 6-digit code, the "You're in" state says whether the chats came along), `LoginApprove.tsx` (method line, what-approving-gives line, the code with two typed digits, blocked-state Devices advice), `apps/web/src/screens/settings/Devices.tsx` and `devicesCopy.ts` ("How a new device gets in" rewritten; "Give <device> your chats"; the rotation sentence), `apps/web/src/ui/cantDoCodes.ts` (`handover-not-allowed`, `approvals-paused`), `apps/web/src/screens/auth/Login.tsx` (the commit rides on every login call). All new strings COPY-UNSIGNED.

Tests: `apps/web/test/loginApprove.test.tsx` / `loginApproveV2.test.tsx` (the code equals the one the new device shows for the same inputs; wrong digits block; the method and chats lines for the four strength combinations; weak approver sees the "can't hand over" line and no code input), `devicesBoards.test.tsx`, `devices-tripwire.test.ts`; e2e `apps/web/e2e/loginApprove.spec.ts` (Plan 3 Task 41 step 1 rows plus: second device reads and sends in an open chat after approval; logging it out from Devices rotates the key and the third device gets the new one).

### 6.5 Security review items for the builder's note

The SAS derivation and commit order (3.3), the handover blob's binding and single collection, the epoch bump being in the same transaction as every removal, the worker boundary (no key in a `postMessage`), the `stale-seq` two-device loop, and that nothing about the account's devices reaches the new device before approval (review M5).

---

## 7. Recommendation on building now or waiting

**Wait for p12-5 before building the user-facing part; start the API and worker groundwork now.** Reasons: (1) the approval gesture, the schema columns and three screens all turn on the owner's answer; (2) the two branches this lands on (`wip/lead-hold-v3-port`, `wip/lead-jabber-notices`) are not on the batch 3 line yet, and the no-device case changes meaning with the port; (3) the key handover is new cryptographic plumbing (a short-authentication-string flow plus `crypto_box_seal` in the protocol package) and should go through the Plan 1 Task 3 reviewer before any screen is drawn around it. The groundwork in 6.1 and 6.2 is independent of the gesture and can be reviewed on its own.
