# Build spec: fix3 (lead msgs 1–4 and 10, 10 Nov 2026). COPY-UNSIGNED.

Boards are in $S/canvas/project. Every quoted string is exactly what's on the board, with straight apostrophes ('). All new copy is COPY-UNSIGNED.

## 1. DisputeRoom: the moderator is "they" (lead msg 1)
Reached from: My trades, or a dispute being opened (BuyerPay / SellerRefund / AccountFrozen "Go to your dispute").
Every pronoun for the moderator now reads "they". The app can't know a moderator's gender. Changes:
- "Moderator joined" card (tweak `moderator: joined`):
  - "She can read this whole chat, including messages from before the trade. Moderators only ever contact you here." → "They can read this whole chat, including messages from before the trade. Moderators only ever contact you here."
  - "She may ask either of you questions. Please answer them here: if someone doesn't help, the ruling can go against them." → "They may ask either of you questions. Please answer them here: if someone doesn't help, the ruling can go against them."
- "Request from the moderator" card: "sarah.v asked you for the original copy. Only she will see it. satoshi_ghost won't." → "sarah.v asked you for the original copy. Only they will see it. satoshi_ghost won't."
- Incident ID row: the sample is now `#K7QM4T2X9` (was `#K7M2Q9XA`). The Copy button's label is "Copy the incident ID, K7QM4T2X9". This brings the board in line with lead msg 3 (see §2). The G37 note says the ID is "the dispute's own 9-character code from the API, G37 format".
- New aside: "Decided · lead, 10 Nov".
- No layout change. Notes height 817 → 987 (`NOTES`).

## 2. AccountFrozen (+Wide): the incident ID is the dispute's own code (lead msg 3)
Reached from: the next login after a moderator freezes trading. It opens again on any try to start a trade or post an offer.
- Facts block, row "Dispute": "#7F3A9C21 · Selling 0.500000 XMR to nightowl_44" → "#K7QM4T2X9 · Selling 0.500000 XMR to nightowl_44". The ID is in mono, 500.
- The ID is the dispute's own 9-character code from the API (G37 format). It is **not** taken from the trade code. It is the same ID as the Incident ID row in that dispute's DisputeRoom.
- New aside: "Decided · owner, 7 Nov (G37) · lead, 10 Nov". It says "The ID in the Dispute row is the dispute's own 9-character code from the API, e.g. #K7QM4T2X9."
- spec-j33a.md line 98 still says "(the incident ID is the first 8 characters of the trade code)". Read it as: "Dispute": "#K7QM4T2X9 · Selling 0.500000 XMR to nightowl_44" (the incident ID is the dispute's own 9-character code from the API). That spec isn't mine, so I didn't edit it.

## 3. spec-j31a.md fixed (lead msg 2)
- The no-proof sheet body is the owner's wording, the same as on BuyerPay: "You haven't added a payment screenshot. If this trade ever goes to a dispute, proof is usually what decides which side wins. It's your choice." The "proof can be what wins it for you" redraft is withdrawn. The board was already right and is unchanged.
- spec-j31a §2 (courtesy sheet after Request) is marked SUPERSEDED and points to §4 below.

## 4. Courtesy sheet moves into the trade room (lead msg 4)
### Removed from BuyQuote, SellQuote and SellQuote-Wide
- The `opening` tweak, the overlay and its JS are gone.
- The Request primary is a plain link again. It is 56 high, radius 12, `--monero` / `--on-monero`, 18 px 600:
  - BuyQuote "Request to buy XMR" → BuyerPay.
  - SellQuote and SellQuote-Wide "Request to sell XMR" → TradeFund.
- The "courtesy sheet" aside now reads "Decided · owner, 8 Nov (p9-3, T-039) · moved 10 Nov (lead)". It says Request goes straight to the room.

### Added to BuyerPay (taker buying) and TradeFund (taker selling = escrower)
- Trigger: the room of a new trade opens for the first time and the viewer is the **taker**. It shows on every trade a taker opens, until they tick "Don't show this again", which is a per-account setting with no Settings entry yet. Posters never see it. There is no penalty for opening several trades (T-038).
  - BuyerPay: it shows on the first view, while the escrow is securing (`escrow: securing`).
  - TradeFund: it shows only with `side: taker` and `fund: open`. With `side: poster`, or once the trade has ended, the tweak shows nothing.
  - The same applies after OfferAd's request button: the sheet shows in whichever room that request opens.
- Why it moved: the room is already open underneath, so browser Back can't skip the step.
- Tweak `courtesy`: `off` (default) | `on`.
- Copy (unchanged from the quote boards):
  - Title: "Trading with more than one person?"
  - Body: "If you opened trades with several people to see who answers first, close the others once you've picked one. That way nobody is left waiting on you."
  - Tick: "Don't show this again" (unchecked by default)
  - Button: "Got it" is the only action. It closes the sheet and leaves the person in the room. If ticked, it saves the setting.
- Phone layout: a bottom sheet, the same as BuyerPay's no-proof sheet.
  - Scrim `--scrim` over the whole app screen (absolute, inset 0).
  - Sheet: full width, padding 12/16/16, radius 16 16 0 0, `--surface`, top border 1px `--surface-raised`, gap 16. Drag handle 36×4 `--line`.
  - Title: Familjen Grotesk 24/30 700, margin-top 4. Body: 16/24 `--ink`.
  - Tick row: min-height 44, padding 10×14, radius 12, `--surface-raised`, a 22 px checkbox (accent `--ink`) and 15/22 text.
  - Button: 56 high, radius 12, `--monero` / `--on-monero`, 18 px 600.
  - It is an overlay, so it adds no height. Dialog role: `dialog`, aria-modal, labelledby the title, describedby the body.
- Wide twins (BuyerPay-Wide / TradeFund-Wide) aren't on the canvas. If they're built, use the SellQuote-Wide dialog spec from spec-j31a §2: a centred 480 px dialog with padding 32, radius 16, `--surface`, a 1px `--surface-raised` border, gap 16 and no handle, over a full-width scrim.

## 5. Alerts (+Wide): one Jabber setting (lead msg 10)
Reached from: Settings → Alerts.
- The old "Jabber over Tor" section is deleted. That covers the "Encrypted Jabber alerts" switch, the OMEMO/Tor bullets, the "Set it up in 4 steps" list, the "name@server.onion" field, the fingerprint, "Send test" and "Test sent to …". Its JS state (jabber switch, jid, testSent) is gone too.
- What stays is the single section "Secure Jabber (XMPP)", with:
  - Row title "Jabber alerts"
  - Sub-line "Short, encrypted messages for the events you pick. Always OMEMO and Tor; neither can be turned off."
  - Switch, shown only once set up
  - "Address" row: "Not set up" or "mira…@xmpp.example.org"
  - "Events" row: "7 of 7 on", shown only once set up
  - "Last message 7 Nov 2026, 15:00 UTC"
- Both rows open JabberSetup. On the wide board they now open **JabberSetup-Wide**; before, they wrongly opened the phone board.
- Wide layout: the Jabber section moves to the right column, at the top. The left column keeps phone alerts, the loud alarm and the Android section.
- These boards have no design-notes block. The decision is recorded on JabberSetup (+Wide).

## 6. JabberSetup (+Wide): Tor steps and fingerprint, and what messages say (lead msg 10)
Reached from: the "Jabber alerts" Address and Events rows on Alerts.
- Address step: a new card "How it's sent", under the address card. On wide it sits in the right column, under the "X2F's address is …" callout. It shows only on the address step.
  - Card: padding 20, radius 16, `--surface`, gap 16.
  - Heading: "How it's sent", 18/24 600.
  - Lead: "Every alert is end-to-end encrypted with OMEMO and sent over Tor. Apps without OMEMO won't work." 14/20 `--ink-muted`.
  - Numbered list (`<ol aria-label="Set it up">`, gap 12, 15/22). Each number is a 24 px circle, `--surface-raised`, mono 13 500:
    1. "Install a Jabber app with OMEMO: Conversations (Android), Monal (iPhone) or Gajim (computer)."
    2. "Connect the app through Tor, for example with Orbot."
    3. "Type your address in the box and tap Send a test message."
    4. "Accept the message from X2F. Trust its OMEMO key only if the fingerprint matches the one below."
  - Fingerprint block: padding 14, radius 12, `--surface-raised`, gap 6.
    - Label: "X2F alert account's OMEMO fingerprint" (13/16 600, uppercase, 0.04em, muted)
    - Value: "5c1a9e07 d3b24f18 7a60c2e9 41bd8f35 0e6a72c4 93f1d058 b27e4a16 c8093d5f" (mono 14/22 500, break-word, example value)
    - Note: "Check this matches before you trust a message from X2F." (13/18 muted)
- What a message says: only the kind of event, never an amount, a name, a wallet or a trade code, and no link. The done-step preview already reads "A new device logged in to your X2F account.", so it is unchanged.
- Notes updated:
  - New aside "Decided · lead, 10 Nov (head-designer flag calls)".
  - The "Open for the lead" bullet is closed.
  - The p5-7 "No details" bullet is reworded to the event-kind rule.
  - "Why no details" is now "Why only the kind of event", with: "So the message names only the kind of event ("A new device logged in to your X2F account."), never an amount, a name, a wallet or a trade code. It tells you to go and look; the details stay in X2F, behind your login."
- Heights:
  - Phone: address screen 844 → 1171 (`HEIGHTS.address`); notes 1571 → 1941 (`NOTES_H`).
  - Wide: address app 800 → 845; notes 887 → 1079.

## 7. Team (+Wide): intro line (lead msg 10, p7-9)
Reached from: Settings → Team.
- Intro, old: "Let people you trust work your trades. Each member has their own login with a passkey, security key or PGP key. There are no shared passwords."
- Intro, new: "Let people you trust work your trades. Each member has their own login and can use any login method. Logins are never shared."
- The p7-9 aside now quotes the new line.

## 8. StaffLogin: new `stage: sign`, Terms at a staff member's first login (lead msg 10, p11-14)
Reached from: "Log in" on the known-device or new-device stage at a staff member's **first** login, after an invite. "Continue" goes on to `welcome`. Later logins skip it. A new Terms version shows it again, as for traders.
- Tweaks:
  - `stage`: known-device | new-device | **sign** | welcome
  - New `signed`: empty (default) | drawn | typed. It is used on the sign stage only.
- Layout: the staff-site frame, unchanged.
  - Centred logo D at the top, no rail.
  - Then a 640 px column (the same width as welcome), gap 16.
  - "Staff site" chip (`--mod` tint, uppercase 12/16 600).
  - H1 "Terms of Service" (Familjen 28/32 700).
  - Sub "Everyone who gets an X2F login signs the terms, staff too." (14/20 muted)
- Then, top to bottom (SetupTerms' pattern; no key-points card, no site-rules list):
  1. Intro, 16/24 muted: "Read the terms to the end and tick to agree. Then sign your name and continue. You do this once, before your first case."
  2. Scroll box (`role="region"`, aria-label "Full Terms of Service"): **320 px** high, padding 16, radius 12, `--surface-raised`, 14/21.
     - It holds the same draft text as SetupTerms, sections 1–9 verbatim.
     - Then a new section "10. Working for X2F as staff" with "[Lawyer: what staff agree to, such as keeping trade data private and following the moderator rules.]". This is a placeholder: do not ship the bracketed text.
     - Then "End of Terms. Version [DATE]."
  3. While not scrolled to the end: "Scroll to the end to continue" (13/16 muted, with the down-arrow icon).
  4. Tick row (raised, radius 12, padding 14, 2px `--ink` border once ticked, disabled until scrolled): "I have read and agree to the Terms of Service and Privacy Policy, and I understand X2F's role." "Terms of Service" and "Privacy Policy" are links.
  5. Signature card (`--surface`, radius 16, padding 14/8):
     - Heading "Your signature" (or "Your typed name"), with "Required" under it and "Clear" when drawn.
     - White pad **592 × 180** (`--pad` #ffffff, ink `--pad-ink`, added to both THEMES), border 1px `--line`, radius 12.
     - Placeholder "Sign your name here with your finger or mouse. A scribble or an X is fine."
     - Type mode: label "Your name or initials, as you'd sign them" and a 56 px input.
     - Note: "We keep your signature with your account. We don't record your IP address or device."
     - Swap link: "Type your name instead" / "Draw instead".
  6. "Continue" (48 high, min-width 160, radius 12, `--monero`) is enabled only when the box is scrolled to the end, the tick is on and there is a signature or typed name. Disabled, it is `--surface-raised` / `--ink-muted`, with a hint beside it:
     - Before scrolling: "Scroll to the end of the terms, then tick and sign."
     - After: "Tick the terms and sign in the white box to continue." It names only what's missing, e.g. "Sign in the white box to continue." or "Type your name to continue."
- Storage: the same as traders. The signature is kept with the account; no IP address or device is stored.
- New aside: "Decided · owner, 8 Nov (p11-14) · lead, 10 Nov".
- The StaffLogin root is sized to its content. Default (known-device) $preview 1585 → 1849 (notes). Sign stage, night: empty 1993, drawn and ticked 1961, typed 1865.

## Heights (default variant, night; canvas.json not touched)
| Board | Old | New |
|---|---|---|
| DisputeRoom | 1892 | 2062 |
| AccountFrozen | 1952 | 2120 |
| AccountFrozen-Wide | 1251 | 1423 |
| Team | 4774 | 4822 |
| Team-Wide | 2532 | 2568 |
| Alerts | 2355 | 1424 |
| Alerts-Wide | 1034 | 832 |
| JabberSetup | 2415 | 3112 |
| JabberSetup-Wide | 1687 | 1924 |
| StaffLogin | 1585 | 1849 |
| BuyQuote | 4042 | 3948 |
| SellQuote | 4792 | 4698 |
| SellQuote-Wide | 2947 | 2909 |
| BuyerPay | 3317 | 3561 |
| TradeFund | 3145 | 3389 |
