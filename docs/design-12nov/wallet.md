# Wallet step, Wallets settings and funding (T4, 12 Nov)

Sources: brief item 6 and its "Wallet step: research is in" section; `research-wallet-connect-2026-11-12.md`; owner comments #31, #32, #34 (and #37, #43 as they apply). The build facts come from `origin/main` (`setup/Wallet.tsx`, `trade/TradeFund.tsx`, `FundFallback.tsx`, `fund.ts`). Every new string is **COPY-UNSIGNED**. Labels have no colons.

## Boards

| Board | Status | Default height (root) | Sits next to | Tweaks |
|---|---|---|---|---|
| SetupWallet | changed | 2032 (canvas.json says 897: update it) | SetupBackup → SetupWelcome | theme, state (7), invalid (5), addr |
| **SetupWallet-Wide** | new, 1280 | 1369 | right of SetupWallet (or with SignupSecurity-Wide) | same |
| Wallet | changed | 1918 (was 1292) | Settings | theme, state, invalid, addr |
| **Wallet-Wide** | new, 1280 | 1477 | right of Wallet (Settings-Wide already links `Wallet-Wide`) | same |
| TradeFund | changed | 4572 (was 3389) | as before | adds `pay`: full, opened, rest |
| **TradeFund-Wide** | new, 1280 | 1375 | right of TradeFund | theme, side, pay (full, rest) |

The heights change with each state. The boards switch the root height per state (Compromised pattern), and every height is measured, with `before.root == root` in each state. Backups are in `S/bak-w13-wallet/`. The generators are in `S/w13/t4/`.

---

## (a) /setup/wallet: READY

**What it answers:** owner #31 asked for a MetaMask- or Edge-style connect, and #32 said the names shouldn't be buttons. No Monero wallet has a connect system (WalletConnect covers other chains only, and its relay sees IPs). The honest "connect" is reverse QR: scan the wallet's Receive QR, or paste the address. It works with every Monero wallet and involves no third party. The wallet chips are removed everywhere.

**Header (owner #37, logo rule):** 56 px row. Back (44 px), the X2F logo at 24 px (BrandKit), "–" and **"Your wallet"** (18/24 600), with "Step 5 of 5" on the right (digits mono). Below it come the 5-step stepper, the context line "Set up your account · Takes about 2 minutes." and the title "Where should we send your XMR?" (28/32).

**Lead (17/26):** "**Works with any Monero wallet.** This is where X2F sends your XMR when you buy or get a refund. X2F never holds your coins."

**Type:** one step up for owner #43. Body is 17/26, card text 16/24, helper 14/20, labels 14/18 uppercase, and buttons 17 to 18. If the type-scale owner settles on other values, use theirs.

### States (tweak `state`)
1. **empty.** Card "Your receive address" with the lead "Open your wallet's Receive screen. Scan its QR code, or copy the address and paste it here."
   - A secondary button, 52 h, full width, with a QR icon: **"Scan your wallet's Receive QR"**.
   - An "or" rule.
   - The label "Paste the address", then the input (mono, placeholder "4… or 8…") and a **Paste** button (48 h).
   - Helper: "We check it on this phone before you save. Nothing is sent until you do."
   - Footer: "Save wallet", disabled.
2. **scanning.** A 278 px camera frame (corner brackets, nothing loops) with the status line "Looking for a QR code…".
   - Text: "Open Receive in your wallet and hold its QR code inside the frame. It's read on this phone and never uploaded."
   - Tertiary buttons "Stop scanning" and "Paste instead".
3. **scanned** (also reached by Paste). The chip **ADDRESS FOUND** and the method: "Scanned from your wallet's QR" or "Pasted from your clipboard".
   - The first and last groups at 24/30 mono, e.g. "8Bz4Q … Xk3Fz".
   - An inner block: Type "Subaddress (starts with 8)" or "Main address (starts with 4)", Network "Monero main network", Checksum "Correct".
   - A tertiary "Scan again". The footer primary is **"Compare with your wallet"**.
   - When `addr=primary`, add the callout **"Tip: use a new subaddress"**: "This is your wallet's main address. It works, but a new subaddress just for X2F keeps these payouts apart from everything else in your wallet. Make one on your wallet's Receive screen, then scan again." This is advice, not a block.
4. **compare.** Title "Check it matches your wallet". Lead: "Compare each group of 5 with the address your wallet shows. The first and last groups (outlined) matter most: an address swapped by malware changes them."
   - 19 cells, 4 columns on the phone and 7 on wide. Each cell is 52 h, radius 6, on surface-raised, with an 11 px mono index above 17 px mono text. Cells 01 and 19 get a 2 px ink border.
   - A tick row "Every group matches my wallet" (2 px ink border when ticked).
   - The primary "Save wallet" is enabled only once the row is ticked.
   - Compare is required for both scan and paste, because clipboard malware swaps addresses.
5. **saved.** A 56 px escrow tile with a check, **"Wallet saved"** (24/30), and "X2F sends your XMR to the address ending Xk3Fz when you buy or get a refund."
   - Rows: Address, Added by ("Scanned your wallet's QR" or "Pasted address") and Type.
   - A tertiary "Use a different address". The primary **"Finish setup"** goes to SetupWelcome.
6. **invalid** (tweak `invalid`). The input gets a 2 px danger border and a danger line with an icon (`role="alert"`). The messages:
   - typo: "This isn't a valid Monero address. A character may be missing or changed. Copy it again, or scan the QR instead."
   - integrated: "This is an integrated address (it has a payment ID built in). Use a normal address or a subaddress from your wallet's Receive screen."
   - network: "This is a testnet or stagenet address. Use an address from the main Monero network."
   - keys: "This QR code holds wallet keys, not an address. Don't show it to anyone. X2F didn't keep it. Scan the QR on your wallet's Receive screen instead." The input stays empty.
   - other-coin: "That's not a Monero address. X2F pays out in XMR only."
7. **camera-denied.** A caution callout, **"The camera is blocked"**: "To scan, allow the camera for this site in your browser settings, then try again. Or paste the address below." The scan button becomes "Try the camera again".

### Below the card
These show in the entry and scanning states. "Adding wallets later" shows in every state.
- Info callout **"Tip: make a subaddress just for X2F"**: "In your wallet, open Receive and add a new subaddress (it starts with 8). It keeps your X2F payouts apart from the rest of your wallet."
- **Suggested wallets.** This is plain text: a bulleted list with no border, pill, icon, chevron or hover, and it is not focusable.
  - **Cake Wallet** · iPhone, Android and desktop
  - **Monerujo** · Android
  - **Feather** · desktop
  - **Ledger or Trezor** · hardware, used through Feather or Cake Wallet
  - Footnote: "Only suggestions: any Monero wallet works, and X2F isn't tied to any of them."
  - Never list Exodus, MyMonero or Trust Wallet. Edge and Stack work but are not suggested: they don't open payment links, and Edge gives no subaddress.
- "Adding wallets later" keeps its existing text.

**Wide:** a header with the logo at 32 px, "–" and "Your wallet" (22/28), then a 720 column.
- The entry state is two columns: on the left "Scan it" ("Wallet on your phone? Hold its Receive QR up to this computer's camera.") with "Scan with this camera"; on the right the paste field.
- Scanning uses a 360×270 webcam frame next to the text.
- The tip and Suggested wallets sit side by side. The actions are inline (48 h primary).

**Motion:**
- Moving between states cross-fades the card over 200 ms ease-out, with the new content rising 8 px.
- When a code is found, the frame brackets go to `--escrow` over 150 ms, then the scanned state appears after 300 ms.
- The tick border takes 150 ms.
- With reduced motion, states swap instantly.

**Build notes:**
- Camera: `getUserMedia` and an on-device decoder, with no frame uploaded. Stop the stream when the user leaves the state.
- Accept `monero:<addr>?…` and keep only the address.
- Refuse `monero-wallet:` and wipe it from memory and the field.
- Check base58, length 95 (106 is integrated: refuse it), network prefix and checksum on the device. The server still re-checks.
- `walletApp` is null for new wallets. The first label stays "Wallet 1".
- The Welcome checklist item 3 (owner #34) shows **"Scanned your wallet's Receive QR"** or **"Pasted your wallet's address"**, plus "…Xk3Fz".

## Wallets settings (Wallet, Wallet-Wide): READY
- The header is logo – "Wallets", with the title "Your wallets".
- Lead: "**Works with any Monero wallet.** Add the wallets you want to be paid to. X2F never holds your coins."
- "Add a wallet" uses the same card and states.
  - The compare state adds the optional field "Name it (optional)" (placeholder "Wallet 4"), with the helper "Only you see this name. Saving asks you to confirm it's you."
  - Saved: "Wallet added" / "Saved as Wallet 4. It shows in the list above, and we sent you an alert about it." The new row shows "Added just now". The primary is "Done" and goes to Settings.
- List rows show the user's name, never an unverifiable app. The example list is Cake Wallet, Ledger (via Feather) and Wallet 3.
- The Edge privacy callout is removed, because we no longer know the app. Suggestion: move it to the FAQ.
- Wide uses the rail (Wallets current, logo at the top of the rail) and a 720 column.

## (b) Funding (TradeFund, TradeFund-Wide): READY

**Order (phone):** hero (unchanged), then the new **send card**, then the trader card, the quote breakdown and "Escrow ready".

**Send card:** "Send from your wallet" / "Open Send in any Monero wallet and scan this code. It fills in the escrow address and the exact amount."
- **QR**, 232 px on the phone and 216 px on wide. It is always dark on light: in night mode, `--ground` modules on an `--ink` panel; in day mode, ink on surface. 12 px padding, radius 12. It encodes `monero:<escrow>?tx_amount=1.2625&tx_description=X2F%20trade%20K7M2` (trimmed decimals, as `exactXmr`).
- **Copy fields**, always shown, in an inner block:
  - "Escrow address", in 5-character groups (mono 15/22), with **Copy**.
  - "Exact amount" "1.262500 XMR" (22/28), with **Copy**.
  - Buttons change to "Copied", and the status line reads "Address copied." or "Amount copied."
- Line: "Send exactly this amount. Your wallet adds the network fee on top."
- `pay=rest`: the caution callout **"Send the rest"**, "We've seen 1.000000 XMR arrive. The code and the amount below now carry only the rest." The amount label becomes "Send the rest" (0.262500). The QR and the link carry only the remainder (built rule I1).

**Phone footer (secondary, lead with the QR):**
- An outline hold button, 60 h: **"Open in your wallet app"** with an external-link icon, and the caption "Press and hold".
- After it opens: "Waiting for your payment…" / "Opened your wallet app", with a caution tint.
- Below it: "Works with Cake Wallet and Monerujo. If nothing opens, scan the code or copy the details above."
- Then "Cancel trade".
- There is no orange fill while funding. "Open in Cake Wallet" and "Use another wallet (QR code or address)" are removed. The label never names an app, because the phone picks it.
- The button shows only on phones (`isPhoneDevice`). The 1.5 s hold, the once-per-trade open and "copy counts as fund-started" all stay as built.
- Hold motion: an ink 12% fill sweeps left to right over 1.5 s linear and resets on release in 150 ms. With reduced motion, it shows a "Hold… 1.5 s" text countdown instead.

**Wide:** the rail (Trade current), back with "Selling to mira.k", and a 560 + 360 grid.
- Left column:
  - the hero
  - the send card (QR beside the fee line)
  - "Wallet on your phone? Scan the code with it. Desktop wallets such as Feather read it from your webcam, or copy the details below."
  - **Copy address** as the one orange primary (as built)
  - the copy block underneath
  - "Cancel trade"
- Right column: the trader card and "The deal".
- There is no wallet link on desktop.

**Everywhere:** any screen where a user sends XMR uses this send card, including the Lien-Notice repayment trade, which runs through TradeFund. The rule is QR first, copy fields always, and the wallet link on phones only as a secondary action.

## (c) Owner comment check

| # | Screen | Comment | Answer |
|---|---|---|---|
| 31 | /setup/wallet | Connect like Edge / MetaMask? | None exists for Monero. WalletConnect is not for XMR and leaks IPs, and Edge's `reqaddr` returns only a reused main address with no spec. The real connect is scanning the Receive QR or pasting, drawn on SetupWallet. |
| 32 | /setup/wallet | Names shouldn't be buttons; offer a real connect; keep a suggested list | Chips removed. Scan or paste is the connect. "Suggested wallets" is a plain non-interactive list, also on Wallets. |
| 34 (item 3) | /setup/welcome | "Connected your wallet" plus the method | The method string and address end are defined above for the Welcome board. |
| 37 | all | Logo top-left with the screen name | Done on all six boards (phone: logo – name; wide: logo – name, or logo in the rail plus the title). |
| 43 | all | Fonts a bit bigger | Applied one step up on these boards. |
| 4, 6 | /setup (Terms) | "transferred to buyer's external wallet", "returned to their wallet" | Terms wording, owned by the Terms draft. It matches this flow: payouts go to the saved address. Nothing to change here. |
| 3 | /setup (Terms) | Multisig "methods or features?" | Not a wallet-screen item (Terms, Q bucket). |

None of the owner's comments was on funding or on the Wallets settings page.

## For the owner
Nothing blocking. One optional check: should the Wallets page let a user rename a wallet after saving? Today the name is set only when the wallet is added.

## Head designer ruling (12 Nov)
- A saved wallet can be renamed at any time. The name is a private label, so renaming needs no confirmation and no 24-hour wait. The address itself can never be edited: to change it, add a new wallet and remove the old one.
