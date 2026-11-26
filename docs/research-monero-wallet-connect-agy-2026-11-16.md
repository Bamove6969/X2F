# Monero Wallet Connect Protocols & P2P Escrow Capabilities (16 Nov 2026)

**Branch:** `wip/agy-wallet-research`  
**Context:** Owner demo notes **#31** and **#32** on `/setup/wallet` (`origin/comms:owner-demo-notes-2026-11-12.jsonl`) and #34 on `/setup/welcome`:
- **#31:** *"What are the methods of connecting wallets like edge has and meta mask and some of the others use. Can we not use that technology too?"*
- **#32:** *"It really make no sense asking for these wallets by name of they are not offering a specific connection system so we need to offer the connection system for the monero wallets that have it and I suggest that we also have a list of suggested monero wallets like we have on the screen now but they shouldn't be buttons like they do something"*

**Prior Comms Research Referenced (Not Repeated Below):**
1. `origin/comms:research-wallet-connect-2026-11-12.md` — Verified source code of Cake Wallet, Edge, Feather, Monerujo, and Stack Wallet; confirmed WalletConnect v2 has no Monero implementation (CAIP `monero` namespace is an empty 2023 draft) and leaks IP/project metadata to Reown's relay; confirmed Exodus (sunset Aug 2025), MyMonero (shut down Jan 2026), and Trust Wallet have no XMR support; documented Edge's `reqaddr:` redirect and default light-wallet server (`monerolws1.edge.app`).
2. `origin/comms:research-monero-connect-broad-2026-11-12.md` — Surveyed Logos Basecamp `monero.wallet.send` intent (PR #11, desktop IPC only, not web-exposed), Spirobel's CCS Browser Wallet (only milestone 1 of 4 complete; milestone 4 multisig escrow library pending), `cakewallet:`/`monerocom:` deep links, XMR20 extension (proprietary token tool), view-key payment processors (BTCPay/MoneroPay), Haveno/RetoSwap 2026 multisig exploits, and FCMP++/Carrot multisig migration risks (~March 2027).

This document adds **only what is new**:
1. A direct technical comparison of **how MetaMask and Edge "connect" under the hood** and why Monero's cryptography prevents a drop-in equivalent.
2. **Missing wallets & protocols** not covered in the 12 Nov tables: **Official Monero GUI & CLI** (`monero-gui-cli` chip), **Browser WebHID / WebUSB / Trezor Connect** (`ledger-trezor` chip), and verified **Stack Wallet** subaddress behavior.
3. A complete **P2P Escrow Capability Matrix** across all 3 operations X2F needs: **(a) Fund escrow with an exact XMR amount**, **(b) Share a payout address without copy-paste**, and **(c) Sign (message signing & 2-of-3 multisig signing)**.
4. An **audit of X2F's current codebase** (`origin/wip/third-demo-r3`) showing where current wallet assumptions break (especially `TradeFund.tsx` on phones).

---

## 1. How MetaMask & Edge "Connect" Work — and Why Monero Differs

When users think of "connecting a wallet" in MetaMask or Edge, they are using one of four technical transports. Below is how each works and its exact status for Monero:

| Technology | How MetaMask / Edge Uses It | Can X2F Use It for Monero? | Technical Reason |
|---|---|---|---|
| **1. Injected Browser Provider (`EIP-1193` / `EIP-6963`)** | Desktop extensions (MetaMask, Rabby, Phantom) inject `window.ethereum` into the page DOM. The site calls `eth_requestAccounts` (gets address), `eth_sendTransaction` (prompts popup with exact amount/calldata), and `personal_sign` / `eth_signTypedData_v4` (signs messages). | **No.** | No maintained Monero browser extension injects a `window.monero` provider. Unlike EVM chains (where an extension just queries an Infura RPC node for account balance/nonce), a Monero wallet must scan every block's stealth outputs with the private view key to know which UTXOs it owns before it can build a ring-signature spend. |
| **2. WalletConnect v2 / Reown (`CAIP-25` JSON-RPC Relay)** | Site displays a `wc:...` QR code or mobile deep link. Wallet and site open a persistent WebSocket session through `relay.walletconnect.com` scoped by CAIP-2 chain namespace (e.g., `eip155:1`). Both Cake Wallet and Edge include WalletConnect v2 scanners. | **No.** | Neither Cake nor Edge registers a `monero` namespace in WalletConnect (`Cake`: EVM/Solana/Tron; `Edge`: `eip155`, `algorand`, `bip122`, `cosmos`). The CAIP `monero` standard has no chain IDs, account format, or RPC methods (`monero_sendTransaction`, `monero_signMessage`, etc. do not exist). |
| **3. Edge Proprietary Deep Links (`reqaddr://` / `edge://reqaddr` & Edge Login)** | Edge supports `edge://reqaddr?codes=XMR&redir=<url>&payer=X2F` to request a receive address via URL redirect/POST, and `edge://` / `airbitz://` deep links for partner widgets inside Edge's built-in Discover tab. | **Do not use.** | As found on 12 Nov, Edge's `reqaddr:` for XMR returns only the **primary `4…` address** (never a subaddress), leaks the address in redirect URLs/history, has an unfinished POST spec, and Edge does **not** register `monero:` payment links on iOS or Android. |
| **4. Browser Hardware Bridge (`WebHID` / `WebUSB` / `Trezor Connect`)** | MetaMask connects directly to Ledger and Trezor over USB in Chromium browsers using `@ledgerhq/hw-transport-webhid` and `@trezor/connect-web` to read addresses and sign transactions without installing a companion desktop app. | **Partial (Address Read Only on Desktop).** | See Section 2.2 below: a browser **can** ask a Trezor (`TrezorConnect.moneroGetAddress`) or Ledger (via WebHID APDU) for a hardware-verified Monero payout address, **cannot** fund an escrow from the browser without syncing a full Monero wallet first, and **cannot** run 2-of-3 multisig on hardware. |
| **5. URI Deep Links (`monero:` / `cakewallet:` / `monerocom:`) + Reverse QR** | One-way OS intent (`monero:<addr>?tx_amount=<xmr>`) or optical QR code to pre-fill a send, paired with scanning the wallet's Receive QR code via browser camera (`getUserMedia`) to import a payout address. | **Yes — works today.** | Supported across Monero wallets with zero third-party relay servers. |

---

## 2. Newly Verified Wallet & Protocol Findings

### 2.1 Official Monero GUI & CLI (`monero-wallet-gui` / `monero-wallet-cli`)
The 12 Nov per-wallet table omitted `monero-wallet-gui` and `monero-wallet-cli`, even though `monero-gui-cli` ("Monero GUI") is one of the 8 chips in X2F's `WALLET_APPS` (`apps/web/src/screens/wallets-model.ts`).
- **OS `monero:` URI Handler (Desktop):** **Yes** (unlike Feather).
  - **Linux:** `monero-gui.desktop` registers `MimeType=x-scheme-handler/monero;x-scheme-handler/moneroseed;` and passes `%u` to `monero-wallet-gui`.
  - **macOS:** `Info.plist` registers `CFBundleURLSchemes` for `monero` and `moneroseed`.
  - **Windows:** Installer registers `HKEY_CLASSES_ROOT\monero\shell\open\command`.
  - Clicking a `monero:<address>?tx_amount=<xmr>` link on a desktop where Monero GUI is installed opens the GUI and pre-fills the Transfer page once the wallet is unlocked.
- **Subaddresses:** **Yes.** Full account and `8…` subaddress creation and labeling on the Receive tab, with a built-in QR code that encodes `monero:<subaddress>`.
- **Message Signing (`Sign / Verify`):** **Yes.** Exposed in GUI under *Advanced → Sign/verify* (and `sign` / `verify` commands in CLI). Supports signing arbitrary messages with either the primary address (`4…`) or a specific subaddress (`8…`) to prove spend-key ownership.
- **2-of-3 Multisig:** **Yes (CLI native; GUI limited).** `monero-wallet-cli` is the reference implementation for Monero $M$-of-$N$ multisig (`prepare_multisig`, `make_multisig`, `exchange_multisig_keys`, `export_multisig_info`, `import_multisig_info`, `sign_multisig`, `submit_multisig`), but it has no web/browser connect interface unless driven via local `monero-wallet-rpc`.

### 2.2 Hardware Wallets (`ledger-trezor` chip): Direct Browser WebHID / Trezor Connect
Could X2F offer a "Connect Ledger / Trezor" button in the browser the way MetaMask does?
- **Trezor (Safe 3, Safe 5, Model T) via `@trezor/connect-web`:**
  - Trezor's official JS SDK includes native Monero methods: `TrezorConnect.moneroGetAddress({ path: "m/44'/128'/0'", networkType: 0, showOnTrezor: true })` and `TrezorConnect.moneroGetWatchKey(...)`.
  - **What it CAN do for X2F:** On desktop (and Android Chrome via WebUSB), a single click can prompt the user's Trezor to display and return their verified Monero primary address with zero copy-paste errors.
  - **What it CANNOT do for X2F:**
    1. *Subaddresses:* `moneroGetAddress` derives the account's primary address (`m/44'/128'/i'`); subaddress derivation requires view-key math in the host wallet (Cake, Feather, or Monero GUI).
    2. *Funding escrow (`moneroSignTransaction`):* A Trezor cannot construct a Monero transaction on its own. To call `moneroSignTransaction`, the host app must already possess the wallet's private view key, have scanned the Monero blockchain to find unspent outputs (`moneroKeyImageSync`), and selected decoy ring members from a `monerod` node.
    3. *Multisig:* Trezor firmware does not support Monero multisig key exchange or signing.
- **Ledger (Nano S Plus, Nano X, Stax, Flex) via `@ledgerhq/hw-transport-webhid`:**
  - Ledger's Monero app communicates via custom APDU frames (`CLA=0x00`, `INS_GET_KEY`, `INS_DISPLAY_ADDRESS`, etc.) over WebHID.
  - **What it CAN do:** Read the primary address or subaddress over WebHID in Chromium desktop browsers (Chrome/Brave/Edge, not Firefox or iOS Safari) if the user has the Monero app open on the device and no desktop wallet (Feather/Monero GUI/Ledger Live) holds the USB lock.
  - **What it CANNOT do:** Cannot fund escrow from the browser without a full client-side wallet sync, cannot run on iOS Safari (no WebHID), and cannot participate in 2-of-3 Monero multisig.
- **Verdict on Browser WebHID / Trezor Connect:** High support friction (WebHID fails on iOS, Firefox, Tor Browser, and Linux without `udev` rules) and returns primary addresses on Trezor rather than fresh subaddresses. Users with Ledger or Trezor already use **Feather**, **Cake Wallet**, or **Monero GUI** as their companion interface and can scan/paste a subaddress from there.

### 2.3 Stack Wallet (`stack` chip): Verified Subaddress & Signing Status
The 12 Nov doc listed Stack Wallet's subaddress support as *"Not verified"*.
- **Subaddresses:** **Yes (Verified).** Stack Wallet (`cypherstack/stack_wallet`, using `cw_monero` / `monero.dart` bindings) deterministically generates `8…` subaddresses per wallet, cycles to a fresh unused subaddress on the Receive screen, and displays a QR code for the active subaddress.
- **OS `monero:` URI Handler:** **No** (as found on 12 Nov, Android manifest only registers `http`/`content`/`file`; PR #1261 only added seed restore URIs).
- **Message Signing / Multisig:** **No** multisig UI; no web connect protocol.

### 2.4 Message Signing (`Sign / Verify`) Across Wallets
For a P2P escrow platform, cryptographic message signing (`SigV1`/`SigV2` using the wallet's private spend key or subaddress spend key) can prove that a user controls a payout address or authenticate an out-of-band instruction.
- **Supported in UI:**
  - **Monero GUI / CLI:** Full support (primary and `8…` subaddresses).
  - **Feather Wallet (Desktop):** Full support (*Tools → Sign/verify message*, supports subaddresses).
  - **Cake Wallet / Monero.com (iOS, Android, Desktop):** Full support (*Settings → Other → Sign / Verify*, supports choosing the specific address/subaddress; not supported for hardware-backed XMR wallets inside Cake).
- **Not Consistently Available:**
  - **Edge, Stack Wallet:** Do not expose a Monero message-signing screen to end users.
- **Implication for X2F:** Because message signing requires manual copy-pasting of 3 fields (message, address, `SigV2...` signature string) and is missing in several wallets, it **should not be required** during normal signup or trade setup. X2F's existing confirmation model (`withConfirm(walletsAction(addresses), ...)` via passkey, security key, or PGP in `Wallets.tsx`) is far smoother and works with every wallet.

---

## 3. Complete P2P Escrow Capability Matrix

How every wallet and mechanism in X2F's ecosystem performs across the **three P2P escrow requirements**:
- **Job A — Share Payout Address:** Get the user's `4…` or `8…` receive address into X2F without typos.
- **Job B — Fund Escrow (Exact XMR):** Open the wallet with `<escrowAddress>` and `<exactXmr>` pre-filled for the seller to confirm.
- **Job C — Sign (2-of-3 Multisig & Message Signing):** Participate in trade escrow release/refund signing or prove address ownership.

| Wallet (`WALLET_APPS` code) | Platforms | Job A: Share Payout Address into X2F | Job B: Fund Escrow with Exact XMR Amount | Job C: Signing (Message Sign vs. 2-of-3 Escrow Multisig) | Subaddress (`8…`) Support | Privacy & Security Notes |
|---|---|---|---|---|---|---|
| **Cake Wallet / Monero.com** (`cake`) | iOS, Android, macOS, Linux, Windows | **Reverse QR scan** (Receive screen shows QR of subaddress) or **Copy/Paste**. No web callback. | **Tap `monero:` link** (iOS/Android), **`cakewallet:` / `monerocom:` link**, or **Scan QR** (all platforms). Pre-fills exact `tx_amount`. | **Message Sign:** Yes (*Settings → Other → Sign/Verify*).<br>**Multisig UI:** No (single-sig only). | **Yes** (manual + optional auto-generate). | Local sync to user-chosen or Cake default `monerod` node; built-in Tor support. |
| **Monerujo** (`monerujo`) | Android | **Reverse QR scan** from Receive screen or **Copy/Paste**. | **Tap `monero:` link** on Android or **Scan QR**. Pre-fills exact `tx_amount`. | **Message Sign:** Limited.<br>**Multisig UI:** No. | **Yes** (auto-creates/selects subaddresses on Receive). | Local sync to `monerod` node; built-in Tor/Orbot support; Ledger USB/Sidekick support. |
| **Feather Wallet** (`feather`) | Linux, macOS, Windows | **Reverse QR scan** (show Feather Receive QR to phone/webcam) or **Copy/Paste**. | **Scan QR** (via built-in webcam QR scanner on Send tab) or **Paste `monero:` URI / address+amount**. *(Does not register OS `monero:` handler on Linux).* | **Message Sign:** Yes (*Tools → Sign/verify*).<br>**Multisig UI:** No. | **Yes** (Receive tab shows unused `8…` subaddresses and hides used ones). | Routes traffic over built-in Tor by default; strong coin control; supports Ledger & Trezor. |
| **Official Monero GUI / CLI** (`monero-gui-cli`) | Linux, macOS, Windows | **Reverse QR scan** from Receive tab or **Copy/Paste**. | **Click `monero:` link on Desktop** (registers `x-scheme-handler/monero` on Linux, `CFBundleURLSchemes` on macOS, Registry on Windows) or **Scan/Paste**. | **Message Sign:** Yes (Primary & Subaddress).<br>**Multisig:** Yes in CLI (no browser connect). | **Yes** (Receive tab creates/labels `8…` subaddresses). | Full node or remote node; highest native feature parity. |
| **Stack Wallet** (`stack`) | iOS, Android, Desktop | **Reverse QR scan** from Receive screen or **Copy/Paste**. | **Scan QR** inside Stack Wallet or **Copy/Paste**. *(Tapping a `monero:` link on a phone does NOT open Stack).* | **Message Sign:** No.<br>**Multisig UI:** No. | **Yes** (verified: generates and cycles `8…` subaddresses). | Local wallet sync; open-source multi-coin codebase. |
| **Edge** (`edge`) | iOS, Android | **Reverse QR scan** or **Copy/Paste**. *(Has `reqaddr:` deep link, but it leaks primary `4…` address in redirect URL and has no subaddress support).* | **Scan QR** inside Edge or **Copy/Paste**. *(Tapping a `monero:` link on iOS/Android does NOT open Edge).* | **Message Sign:** No.<br>**Multisig UI:** No. | **No** (`getFreshAddress` always returns the single primary `4…` address). | **High privacy caveat:** Sends private view key to `monerolws1.edge.app` by default unless user enables Full Sync (`monerod`) in settings. |
| **Ledger / Trezor** (`ledger-trezor`) | Hardware (via Feather, Cake, Monero GUI, or WebHID) | **Via companion app QR/Paste** (supports `8…` subaddresses), or **Trezor Connect / WebHID** on desktop (primary `4…` address on Trezor). | **Via companion app** (scan QR or tap `monero:` link in Cake/Monero GUI, then confirm on hardware screen). Cannot fund from browser alone. | **Message Sign:** Via Monero GUI/Feather.<br>**Multisig:** **Not supported** by Ledger/Trezor Monero firmware. | **Yes** (when managed through Feather, Cake, or Monero GUI). | Keys never leave hardware (Ensure Ledger Monero app $\ge$ v2.1.4 for LSB-022 fix). **Note:** Hardware wallets cannot hold X2F's 2-of-3 escrow key share. |
| **X2F Client-Side Escrow Engine** (`x2f-escrow` IndexedDB) | Browser (All devices) | N/A (receives payout address from user's linked wallet list). | Derives and verifies the 2-of-3 escrow deposit address + check words locally (`TradeFund.tsx`). | **Multisig:** **Yes.** Generates the user's 1-of-3 trade escrow key on-device (`x2f-escrow` IndexedDB) and co-signs release/refund without an external wallet connect. | N/A | Non-custodial: X2F holds 1 key, buyer holds 1 in browser, seller holds 1 in browser; deleted when trade closes. |

---

## 4. Audit of X2F's Current Codebase (`origin/wip/third-demo-r3`)

Inspecting the current implementation in `apps/web/src/screens/` reveals three concrete mismatches between what the UI implies and what Monero wallets actually do:

1. **Bug / UX Trap in `TradeFund.tsx` (`WalletFooter`, lines 178–235) and `fund.ts` (`WALLET_NAMES`, lines 6–14):**
   - Today, on any phone/tablet (`isPhoneDevice(navigator.userAgent, navigator.maxTouchPoints)`), `TradeFund.tsx` renders a primary 1.5-second hold button labeled `Open in ${wallet}` (e.g., **`Open in Edge`**, **`Open in Stack Wallet`**, **`Open in Feather`**, **`Open in Monero GUI`**, or **`Open in your hardware wallet`**) and hides the QR code behind a secondary `"Use another wallet (QR code or address)"` button.
   - When the seller holds and releases that button:
     1. It clicks `<a href="monero:<address>?tx_amount=<xmr>">`.
     2. For **Edge** and **Stack Wallet**, neither app registers the `monero:` scheme on iOS or Android, so **nothing opens** (or a different wallet opens). For **Feather** and **Monero GUI**, those are desktop apps, not phone apps.
     3. Worse, releasing the hold immediately calls `setFundMark(view.code, 'opened')` (persisted in `localStorage`) and posts `fund-started` to the API (`TradeFund.tsx` lines 11–15, 272–284), which permanently locks the seller into the trade (`"From then on the seller can never walk away"`) and permanently disables the button (`"Waiting for your payment…"`), even though no wallet ever opened.
   - **Fix required (for a future UI task):** Only show the `"Open in wallet"` hold button on phones when `walletApp` is `'cake'`, `'monerujo'`, or `'other'` (and label it `"Open in your wallet app"` or `"Open in Cake Wallet"` / `"Open in Monerujo"`), OR always show the QR code and copy buttons directly above/alongside the link whenever `walletApp` is `'edge'`, `'stack'`, `'feather'`, `'monero-gui-cli'`, or `'ledger-trezor'`.

2. **Clickable App Chips on `/setup/wallet` (`apps/web/src/screens/setup/Wallet.tsx`, lines 95–101) and `/wallets` (`Wallets.tsx`, lines 490–503):**
   - Both screens present 8 interactive radio buttons (`Cake Wallet`, `Edge`, `Feather`, `Monerujo`, `Stack`, `Monero GUI`, `Ledger or Trezor`, `Other`) at the top of the screen before the address input.
   - As the owner noted in **#32**, tapping these chips does not initiate any connection protocol — it only changes the label `"Receive address from <App>"` (and shows the Edge Full Sync privacy tip when `app === 'edge'`).

3. **Missing Reverse-QR Scanner on `/setup/wallet` and `/wallets` (`Wallets.tsx`, line 550):**
   - `Wallets.tsx` line 550 notes: `{/* The board's "Scan address QR code" button comes back with a scanner; a button that does nothing is not shown. */}`.
   - Adding a client-side camera QR scanner (that accepts both raw `4…`/`8…` addresses and `monero:<address>?...` URIs displayed by every wallet's Receive screen) is the single highest-impact "connect" feature X2F can ship.

---

## 5. Privacy Implications Summary

| Connection / Sharing Method | What Leaves the User's Device? | Third-Party Observer? | Address Reuse Risk | Verdict for X2F |
|---|---|---|---|---|
| **Reverse QR Scan (`getUserMedia` + local decode) or Paste** | Only the chosen payout address (`8…` or `4…`) is sent to X2F's API. Camera frames never leave the browser. | **None.** | **Low** if UI nudges user to generate a fresh `8…` subaddress (supported in Cake, Monerujo, Feather, Stack, Monero GUI). | **Best for Payout Address (Job A).** |
| **Standard `monero:` URI + Local SVG QR Code (`FundFallback.tsx`)** | Nothing. Built client-side in `TradeFund.tsx` from device-verified escrow address and amount (`qrcode-generator`). | **None.** | N/A (one-time trade escrow address). | **Best for Escrow Funding (Job B).** |
| **Cake App-Specific URI (`cakewallet:` / `monerocom:`)** | Same as `monero:` URI; handled by OS intent on iOS/Android. | **None.** | N/A. | **Safe optional helper** if user explicitly selected Cake Wallet. |
| **Edge `reqaddr:` Deep Link (`edge://reqaddr`)** | Appends `?XMR_XMR=4...` to redirect URL (leaks into browser history, server access logs, and potentially `Referer`). | **Edge LWS (`monerolws1.edge.app`)** holds the user's private view key by default and sees every incoming X2F payout unless Full Sync is enabled. | **High** (Edge only returns the wallet's single primary `4…` address, never a subaddress). | **Reject.** |
| **WalletConnect v2 / Reown Relay** | Connects to `relay.walletconnect.com` with X2F's `projectId`. Logs user IP address, country, client ID, connection timestamps, and user agent. | **Yes (Reown, Inc.).** Links user IP + timestamp to X2F usage. | N/A (no Monero support exists). | **Reject.** Violates Monero user threat model even if CAIP-Monero were ever finished. |
| **OpenAlias (`user@domain.tld`)** | Lookups query DNS TXT records (`oa1:xmr recipient_address=...`). | **Yes (DNS resolver / domain host)** unless resolved strictly over DoH/Tor, and can change between lookup and payout. | **High** (static DNS record). | **Do not use** for trade payouts. |

---

## 6. Actionable Recommendations for X2F

### 1. Answer to Owner Notes #31 & #32 (Why X2F Uses Scan/Paste + `monero:` Links)
- **Why not MetaMask / WalletConnect?** MetaMask relies on browser extensions injecting `window.ethereum` and WalletConnect's centralized relay servers. No Monero wallet supports WalletConnect for XMR, no standard `window.monero` browser extension exists, and WalletConnect's relay logs user IP addresses alongside the site's Project ID. Furthermore, X2F's 2-of-3 escrow keys are already generated and signed **automatically inside the user's browser** (`x2f-escrow` IndexedDB), so the user's external wallet only ever needs to (a) give X2F a receive address and (b) send the exact XMR funding amount.
- **Why not Edge's connect method?** Edge's `reqaddr:` link only works for Edge, forces address reuse by returning only the primary `4…` address (no subaddresses), puts the address in browser redirect URLs, and Edge does not even open standard `monero:` payment links on iOS or Android.

### 2. How to Redesign `/setup/wallet`, `/wallets`, and `/setup/welcome` (Notes #31, #32, #34)
1. **Replace the 8 clickable wallet radio buttons on `/setup/wallet` with two real connection actions:**
   - **Action 1: "Scan wallet QR code"** (`COPY-UNSIGNED`) — Opens the device camera (`getUserMedia` decoded locally in the browser) to scan the Receive QR code displayed in the user's wallet app. Must strip any `monero:` prefix and query string (`?tx_amount=...`) so scanning a wallet's Receive QR fills the 95-character `4…` or `8…` address cleanly.
   - **Action 2: "Paste receive address"** (`COPY-UNSIGNED`) — Existing validated input (`ADDRESS_RE`), with a clear tip: *"Tip: use a fresh subaddress (starts with 8…) from your wallet for extra privacy."* (`COPY-UNSIGNED`)
2. **Demote the wallet names to a non-interactive "Suggested Monero wallets" reference list (Note #32):**
   - Display **Suggested wallets** as plain, non-button text or an expandable info row (`COPY-UNSIGNED`):
     - **Phones:** Cake Wallet / Monero.com (iOS & Android), Monerujo (Android), Stack Wallet (iOS & Android)
     - **Computers:** Feather Wallet, Official Monero GUI
     - **Hardware:** Ledger or Trezor (used with Feather, Cake Wallet, or Monero GUI)
   - Keep the Edge privacy warning (`"For best privacy, turn on Full Sync in Edge's Monero settings"`) inside an expandable *"Using Edge?"* note (`COPY-UNSIGNED`), rather than featuring Edge as a primary chip.
3. **Update `/setup/welcome` checklist item #3 (Note #34):**
   - Show how they linked their payout wallet alongside the green checkmark, e.g. **"Payout wallet linked — Receive address …{last4} (Scanned QR / Pasted address)"** (`COPY-UNSIGNED`).

### 3. Fix Phone Funding Behavior in `TradeFund.tsx`
- On phones (`isPhoneDevice`), do **not** show `"Open in Edge"`, `"Open in Stack Wallet"`, `"Open in Feather"`, `"Open in Monero GUI"`, or `"Open in your hardware wallet"` as the primary hold-to-open `monero:` link — those apps do not handle `monero:` links on a phone, and releasing the hold prematurely locks `fund-started` on the trade.
- Instead:
  - Label the phone `monero:` hold button generically: **"Open in your wallet app"** (`COPY-UNSIGNED`) (or show it only when the user's wallet supports mobile `monero:` links, i.e., Cake Wallet / Monero.com / Monerujo).
  - Always make the **QR code and Copy Address / Copy Exact Amount buttons** immediately accessible without requiring the user to trigger a broken deep link first.
