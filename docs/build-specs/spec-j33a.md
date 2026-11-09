# Build spec: j33a (9 Nov 2026), signup, recovery and account notices

Every string below is verbatim as drawn on the board. Every new string is COPY-UNSIGNED. The boards are in canvas/project/. Colours use THEMES tokens only.

---

## 1. SetupTerms (phone 390). p11-24, S-043
Reached from: Log in → "Sign up" (Back goes to Login). Next: SignupSecurity.

Order on the page (new order): stepper → "Terms of Service" → intro → key points → terms scroll box → terms tick → **NEW: Site rules card → rules tick** → signature card → footer button.

- Intro (changed): "Read the terms to the end and tick to agree. Then read the site rules and tick those too, sign your name and continue. You agree once, here, never again on a trade."
- Key point 8 (changed, S-043): "X2F is built to last, for people who trade regularly, so an account not signed into for 60 days is closed." ("60" is set in mono.) Key points 4 and 5 are unchanged: "Completed trades are erased on day 30." and "Disputed trades are kept up to 90 days, cleaned by our privacy tool, to train our moderators."
- Terms tick label (changed: "the rules and" removed): "I have read and agree to the Terms of Service and Privacy Policy, and I understand X2F's role."
- **Site rules card (new).** Surface card, radius 16, padding 16/20, gap 10. It sits directly under the terms tick.
  - Title (18/24, 600): "Site rules"
  - Sub (13/18, muted): "The rules every trader keeps. Moderators hold everyone to them."
  - Numbered list (14/20; the number is mono 13 muted in a 16 px column; gap 8):
    1. "Trade honestly. A scam can mean a lifetime ban."
    2. "Opened a few trades to see who answers first? Close the ones you won’t use, so nobody is left waiting."
    3. "In a dispute, answer the moderator’s questions. Not taking part can cost you the ruling."
    4. "Only pay once the trade shows the escrow is secured."
    5. "No trades in sanctioned currencies."
  - Sources: T-039, D-069, terms §3 and §8. The lawyer's full rules list goes into terms §8, not into this card.
- **Rules tick (new).** Same style as the terms tick: surface-raised, radius 12, padding 14, 2 px ink border once ticked, muted and disabled until the terms are scrolled to the end. Label: "I've read the site rules and I'll keep to them."
- Footer button (renamed): "Continue creating your account" (was "Start creating my account"). It is enabled only when the terms are read, both boxes are ticked, and there is a signature or a typed name. It goes to SignupSecurity.
- Hint under the disabled button. It names what is missing, in page order:
  - Terms not read yet: "Scroll to the end of the terms, then tick both boxes and sign."
  - Otherwise it joins the missing parts and ends with " to continue.": "tick the terms", "tick the site rules", "sign in the white box" (or "type your name" in typed mode). Example: "Tick the terms, tick the site rules and sign in the white box to continue." / "Tick the site rules to continue."
- Store the rules acknowledgement with the signature: one flag plus the rules version.
- Heights: FRAME_H empty/drawn 1509 → 1923, typed 1413 → 1827. NOTES_H 897 → 1271. $preview 2406 → 3194.
- Notes: a new aside "Decided · owner, 9 Nov (p11-24, S-043)". The 8 Nov agreement aside and the Anticipated aside now name the new button. The 60-day aside mentions S-043.

## 2. SignupSecurity (390) + SignupSecurity-Wide (1280). S-015
Reached from: SetupTerms "Continue creating your account". Next: RecoveryCode.

"How strong your login is" panel, per tier (the lines are the paragraphs under the tier title):
- Weak (username + password only), title "Weak":
  1. "A username and password alone is weak by industry standards."
  2. "If someone ever breaks in, proving the account is yours is slower and harder."
  3. "Your changes wait through a 24 h cooling-off. That stops an intruder, but it applies to you too while we check."
  4. "Harden it with an authenticator app, passkey, security key or PGP key, and your changes take effect at once."
- Strong, title "Strong":
  1. "This stops simple username and password guessing."
  2. "You can take decisive actions right away, with no waiting."
  - The next-step hint is unchanged ("Add one more way above to reach Armored vault." etc.).
- Top tier (the armored hero): the eyebrow is now "Top tier" (was "Armored vault") and the big title is now **"Armored vault!"** (was "Sealed like a vault"; the owner's phrase). The bar label under the chart stays "Armored vault". The message and seal footer are unchanged.
- Not allowed / authenticator only: unchanged.
- The recovery note above the footer (all tiers) now has one more sentence: "Next you'll set up recovery. Everyone needs it. It isn't a way to log in: it's for when every other way is lost. Keep your recovery code apart from everything else, somewhere only you'd look, like under a fake rock in the garden."
- Kept: the G34 aside and the authenticator note ("Strong enough for trading": password + authenticator code counts as strong for traders).
- Phone heights: P.notes 715 → 1003; P.tier none/totp 1588 → 1628, weak 1668 → 1804, strong 1629 → 1721, strongNoPw 1623 → 1715, armored 1683 → 1723, armoredNoPw 1701 → 1741. $preview 2666 → 3046 (default `strong`).
  - Root height per variant: not-allowed and authenticator-only 2701, weak 3129, strong 3046, password-authenticator 3216, passwordless 2814, armored 3048.
- Wide (content-sized): P.notes 615 → 797, $preview 2443 → 2695.
  - Root height per variant: 2402 / 2402 / 2754 / 2695 / 2825 / 2473 / 2721.
- Notes: a new aside "Decided · owner, 1 Nov, drawn 9 Nov (S-015)".

## 3. RecoveryHold (390) + RecoveryHold-Wide (1280). S-025
Reached from: Login-Backup "held" → "What happens now", and from any login during the hold.

- "Your recovery code was used to log in" card:
  - Body (changed): "So your account is on a 24 h hold while our security team reviews it. If someone stole your recovery code, this stops them from taking over your account."
  - New second paragraph (15/22, muted, same card): "If you turned on Jabber alerts, we've sent you one about this too."
- "Ask us to remove the hold" card body (changed): "Message our security team on Matrix or Telegram. They'll ask you to confirm it's you over secure Jabber, through Tor. Once that's done, the hold can be removed." The Matrix and Telegram rows are unchanged. The handles are placeholders (@x2f-support:matrix.org, @x2f_support).
- Build: when the recovery code is used, send an OMEMO Jabber alert over Tor, only if alerts are on. The Jabber line shows to everyone, because it is conditional by wording.
- Heights (content-sized): phone $preview 2635 → 2891 (wait 2686, ended 1619). Wide $preview 1479 → 1597 (wait 1584, ended 1311).
- Notes: a new aside "Decided · owner, N50, drawn 9 Nov (S-025)".

## 4. RecoveryCode (390) + RecoveryCode-Wide (1280), step `reminder`. p11-36
Reached from: the first successful login after a recovery code was used (sheet over the home screen).

- Sheet title (changed): "Your old recovery code is burned" (was "Write down your new recovery code").
- Sheet body (changed): "You used it to get back in, so it won't work again. Make a new one in Security settings and keep it somewhere only you'd look."
- Primary button (renamed): "Make a new recovery code". It opens Settings → Security → recovery code (generate). It was "Go to Security".
- "Remind me later" is unchanged. It is still OPEN for the owner, and that aside's option now reads "No, the only way on is Make a new recovery code".
- Heights (content-sized, notes only): phone $preview 1824 → 1976. Wide 1737 → 1835.
- Notes: a new aside "Decided · owner, 9 Nov (p11-36)".

## 5. Login-Backup (390) + Login-Backup-Wide (1280), view `ready`. p11-36
Reached from: Log in → "Use a backup" → after the 24 h hold ends.

- The status line in the escrow box (changed): "The 24 h hold is over. The recovery code you used is now burned: it won't work again. Once you're back in, make a new one in Security settings."
- New link under it, in the same box: "Make a new recovery code". Style: monero-ink, 15 px 600, underlined, min-height 44, left-aligned. It goes to Settings (Security). The text and the link are stacked in a column next to the check icon.
- Heights (content-sized): phone $preview 1172 → 1324 (ready 1258). Wide 1189 → 1287 (ready 1263).
- Notes: a new aside "Decided · owner, 9 Nov (p11-36)".

## 6. AccountFrozen (NEW, 390 × 1952) + AccountFrozen-Wide (NEW, 1280 × 1251). D-016
Reached from: the next login after a moderator freezes trading on the account. It also opens when a frozen user tries to start or join a trade or post an offer. Close and "Not now" go to home. Layout mirrors Ban-Notice; the hero uses caution, not danger. Only tweak: theme.

- Phone header: Close (×) · logo D "–" "Account frozen" · "Draft copy".
- Wide: trader rail with "Account frozen" under the logo, and Trade active. Top row: Close, "Account notice", "Draft copy".
- Hero (caution gradient and border):
  - Chip: snowflake icon + "Trading frozen".
  - H1 (32/36 phone, 40/44 wide): "A moderator froze trading on your account"
  - Lead: "Open your dispute to see what you need to do to get it back."
  - Facts block:
    - "Frozen since": "9 Nov 2026, 10:12 UTC" (mono)
    - "Ends": "When a moderator lifts it"
    - "Dispute": "#7F3A9C21 · Selling 0.500000 XMR to nightowl_44" (the incident ID is the first 8 characters of the trade code)
- "What still works" card (escrow-tinted icons):
  - "You can log in and use your wallets."
  - "You can chat in your dispute. When you've done what the moderator asks, tell them there and they'll check and lift the freeze."
  - "Trades you already started carry on."
  - "Your XMR isn't affected. Your wallet keys are on your device, so no one can freeze your coins."
- "Paused until it's lifted" card (caution pause icons):
  - "Starting or joining new trades."
  - "Posting offers. Your offers are hidden for now."
- Actions:
  - Primary "Go to your dispute": opens DisputeRoom on the dispute the freeze came from. Phone: 56 px full width in the footer. Wide: 48 px under the hero.
  - Secondary "Not now".
- The wording matches the MyOffers hold notice ("A moderator froze trading on your account" / "Your offers are hidden for now…").
- Build:
  - No end date. The moderator lifts the freeze from staff tools (D-013, D-014, D-015).
  - Send a Jabber alert if alerts are on.
- Canvas title: "Account frozen: moderator froze trading (D-016)". Band: next to Ban-Notice / Ban-Notice-Wide.

## 7. Confirmed, no redraw
- Ban-Notice(+W), D-020: the site-ban headline is "Your account has been banned". The lead is "We're sorry. If you think this was a mistake, message a moderator on Matrix or Telegram and ask for the details." The contact card "Think this is a mistake?" has Matrix #x2f-help:example.org and Telegram @x2f_help (placeholders). This already matches G39.
- Support(+W), G-013: the headline is "Ask an X2F staff member" (the thread view shows "Your ticket"). It is already drawn, with a Decided aside (p5-4).
