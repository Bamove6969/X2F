# Lead brief, 1 Nov 2026 (owner decisions relayed by the lead; newer than 29 Oct and they win)

Common rules for all boards:
- Follow /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/CONVENTIONS.md.
- Copy the skeleton from lead/project/CantDoThat.dc.html: THEMES verbatim, a night/day `theme` tweak, var(--…) colours only, orange fill only on the one primary action, 44px hit areas, no email.
- Phone only: 390 wide, height = content, at least 844.
- Write NEW files in /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/lead/project/.
  - Don't publish. Don't touch git. Don't edit existing boards.
- All copy is a DRAFT for the owner. Show a small mono label "Draft copy" at the top-right of each board, in var(--ink-muted), 12px.
  - Report every sentence you wrote in a "COPY-UNSIGNED" list.
- Look at for style: lead/project/Login-Backup.dc.html, LoginApprove.dc.html, Devices.dc.html, Team.dc.html, Ban-Notice.dc.html.
- Each board has state for real interactions and a `step`/`variant` enum tweak where there are several screens.
- Checks:
  - data-props JSON parses.
  - Tags are balanced.
  - The dc-script passes `node --check` (temp files in your own temp dir, deleted after).
  - Holes are plain dotted lookups.

## Login strength (owner, 1 Nov)

Every account needs a username, a Trade Tag, and at least one real login method. A recovery code is required for everyone.

Tiers:
- **Weak:** username + password.
- **Strong:**
  - username + password + one of (passkey | security key | PGP | authenticator);
  - or username + (passkey | security key | PGP), without a password;
  - or username + PGP + passkey/security key.
- **Armored vault:** username + password + 2 or more second factors.
- **Not allowed:**
  - username + authenticator alone. Message: "add at least a password, but we recommend the other options".
  - username only.
  - Trade Tag as a login.

Passwords must reach "strong" on a live meter (weak → medium → strong; the levels and wording are ours).

Tier messages:
- **Weak:** harder and longer to prove it's you after a breach; a mandatory 24 h cooling-off applies to you too while we check; harden with modern methods.
- **Strong:** stops simple guessing, lets you act right away, suggests more options.
- **Armored vault:** a certificate / "Fort Knox" feel.

## Recovery code

- It is not a login method. Use it only when all other methods are lost.
- Store it apart from everything else. The owner suggests humour: "buried in the back yard, in a fake rock, separate online storage".
- Required at signup:
  - The user ticks "I've written it down".
  - The next screen makes them type it back.

## Recovery hold

- Logging in with the recovery code starts a 24 h hold.
- Strong methods that existed before the hold can end it early.
- During the hold, the user is "offline to everyone": offers are hidden.
- Contact is via Matrix, Telegram or secure Jabber. The Matrix/Telegram addresses are placeholders.
- The message reads roughly: "a 24 h hold has been placed on changes to your account while our security team reviews everything; please be patient and reach out on Matrix/Telegram; we'll also try to reach you on the secure Jabber account you set up".

## Session length

Traders pick a 2–12 h idle logout. The absolute maximum is 24 h.

## Compromised-account ticket ("My account has been compromised")

- The user enters their username, then any login methods they still have, plus a free comment box.
- Submitting freezes the account at once: full lockout, and open trades are PAUSED.
- Then show links to reach a moderator on Matrix/Telegram. Jabber is to be decided.

## Boards

1. **SignupSecurity.dc.html: signup security chooser.**
   - As the user picks methods, a live chart shows where they stand: Weak / Strong / Armored vault, plus the not-allowed refusals.
   - Each tier shows the owner's message for it.
   - Include the strong-password meter.
   - Armored vault gets a certificate / Fort Knox feel, done tastefully: a badge or seal, not clip-art.
   - Also a session-length picker: idle logout 2–12 h (max 24 h).
2. **RecoveryCode.dc.html: recovery code.**
   - Show-and-tick screen.
   - Then the type-it-back check screen.
3. **RecoveryHold.dc.html: recovery-hold notice.**
   - The "offline to everyone" state, with a countdown.
   - The contact links.
   - "End the hold early with a login method you had before" when available.
4. **BlockQueued.dc.html: "Block queued change" on the owner's OTHER devices.**
   - An alert listing each change queued during a hold (e.g. new login method added, payout wallet changed), each with a Block button.
   - Blocking may also log that session out. The owner is still deciding, so show it as a checkbox "Also log that device out" or note it as undecided.
5. **Compromised.dc.html: compromised-account ticket flow plus the frozen-account screen.**
   - Use a `step` tweak: form → confirm freeze → frozen.
6. **TeamRefusal.dc.html: Team screen refusal.**
   - Draft: "This device logged in with only one way of proving it's you, so it can't invite team members or change their roles…"
   - Rework the wording using the new tier names.
   - Offer "Add another way to log in" as the action.
