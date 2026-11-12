# "Connect your wallet" for Monero: what exists (research, 12 Nov 2026)

Prompted by the owner's note on the signup wallet-chip screen: "What are the methods of connecting wallets like Edge has and MetaMask… Can we not use that technology too?"

## Short answer

No Monero wallet offers a MetaMask- or WalletConnect-style connection for Monero, as of November 2026. I checked the wallets' current source code, not only their marketing pages.

- **WalletConnect.** Cake Wallet and Edge both support it, but only for other chains. Cake covers EVM chains, Solana and Tron. Edge covers EVM, Algorand, Bitcoin (proof of ownership only) and Cosmos. Neither lists Monero.
- **The standards layer is empty.** WalletConnect builds on the CAIP standards, and the CAIP "monero" namespace is a 2023 Draft. It defines no chain IDs, no account format and no RPC methods, so there is nothing for a wallet to implement.
- **No browser extension.** No maintained Monero browser extension exposes an API to websites. The one funded effort, Spirobel's CCS "Monero Browser Wallet", has finished only its prepayment milestone.
- **What works today is the Monero URI scheme** (`monero:<address>?tx_amount=…&tx_description=…`), carried as a tap-to-open link on a phone or as a QR code. This is exactly what X2F's funding screen already plans to use.
- **One small exception is Edge's `reqaddr:` "Request for Address" link.** A site can ask Edge for a receive address and gets it back in a redirect. For Monero, though, Edge returns only the wallet's primary address, never a fresh subaddress. The flow is also unspecified and marked "further refinement needed" in Edge's code.

So the owner is right that listing wallets by name implies a connection we don't offer. But there is no Monero connection system to adopt. The honest fix is to change what the screen promises (see the recommendation at the end), not to add WalletConnect.

## 1. Per-wallet findings

I read each wallet's source at its latest commit: Edge GUI (10 Nov 2026), edge-currency-accountbased (10 Nov 2026), Cake Wallet (11 Nov 2026), Stack Wallet (11 Nov 2026), Feather (7 Nov 2026) and Monerujo (master). Where I relied on a document instead, it is cited.

| Wallet | WalletConnect for XMR | Opens `monero:` links from other apps (OS handler) | Reads `monero:` from QR/paste | Gives out fresh subaddresses | Other "connect" path |
|---|---|---|---|---|---|
| **Cake Wallet** (also Monero.com) | **No.** WalletConnect chains are Ethereum, Polygon, Base, Arbitrum, BSC, Robinhood, Solana and Tron (`lib/reactions/wallet_connect.dart`, `walletConnectCompatibleChains`). | **Yes**, on Android (`AndroidManifestBase.xml`: `monero`, `monero-wallet`) and iOS (`InfoBase.plist`: `monero`, `monero-wallet`). | Yes. Reads `tx_amount` and `tx_description` (`lib/utils/payment_request.dart`). | Yes. Accounts and subaddresses, with an optional auto-generate setting (Cake docs; `auto_generate_subaddress_status`). | None for Monero. A `callback` parameter is parsed but not used for XMR. |
| **Edge** | **No.** Namespaces are `eip155`, `algorand`, `bip122` and `cosmos` (`src/hooks/useWalletConnect.tsx`, `getSupportedNamespaces`). | **No.** The Android "Payment Links" filter lists bitcoin, bitcoincash, ethereum, dash, litecoin and zcash, and the iOS `Info.plist` has the same list plus `reqaddr`. Monero is missing from both. A `monero:` link tapped on a phone will not open Edge. | Yes, inside the app (`MoneroTools.parseUri`, which reads `tx_amount`). | **No.** `getFreshAddress` returns the wallet's single primary address (`src/common/CurrencyEngine.ts`, used by the Monero engine). | `reqaddr:` / `edge://reqaddr?codes=XMR&redir=…&payer=…` (`src/util/DeepLinkParser.ts`, `src/actions/ScanActions.tsx`). Edge asks the user, they pick a wallet, and Edge opens `redir` with `?XMR_XMR=<address>` appended or POSTs JSON to `post`. Edge's own comments call it unfinished: "Further refinement will be needed when the specs for the POST endpoint come out." |
| **Feather** (desktop) | No (no WalletConnect code). | **No.** `feather.desktop` has no `MimeType=x-scheme-handler/monero`. | Yes. Pasted text and the webcam QR scanner go through `parse_uri` (`src/SendWidget.cpp`). Its Payment Request dialog creates URIs (`make_uri`). | Yes. Subaddress accounts, address re-use mitigation, built-in Tor ([Feather feature comparison](https://docs.featherwallet.org/guides/features)). | None. |
| **Monerujo** (Android) | No. | **Yes.** `AndroidManifest.xml` has an intent filter for `scheme="monero"` (and `bitcoin`). | Yes. Built-in QR scanner ([monerujo.app](https://monerujo.app/index.html)). | Yes. Subaddresses on the receive screen (release notes, for example v1.5.9). | None. |
| **Stack Wallet** | **No.** No WalletConnect code in `lib/`, which agrees with [CryptoSlate's review](https://cryptoslate.com/crypto-wallets/stack-wallet-review/). | **No.** The Android manifest template handles only http, content and file. | Yes. `lib/utilities/address_utils.dart` reads `tx_amount` "For Monero/Wownero". | Not verified. | None. |
| **Exodus** | n/a. **Exodus dropped Monero on 18 Aug 2025** ([Exodus: Monero (XMR) sunset](https://www.exodus.com/support/en/articles/10862085-monero-xmr-sunset); [Cake migration post](https://blog.cakewallet.com/exodus-phasing-out-monero-how-to-seamlessly-migrate-your-monero-from-exodus-to-cake-wallet/)). | n/a | n/a | n/a | Remove it from any list. |
| **Trust Wallet** | n/a. No Monero support found. Trust's supported assets and WalletConnect are EVM/Solana-oriented ([Trust community thread](https://community.trustwallet.com/t/does-the-trust-wallet-support-monroe-horizon-and-verge/500184)). | n/a | n/a | n/a | Do not list. |
| **MyMonero** | n/a. **Shut down 6 Jan 2026.** Server data was destroyed by 6 Feb 2026 and users were moved to Cake ([Cake announcement](https://blog.cakewallet.com/announcing-mymoneros-sunset-and-stewardship-transition-to-cake-wallet/); [Edge migration guide](https://edge.app/blog/tips-and-tutorials/how-to-migrate-from-mymonero-to-edge-before-the-shutdown/)). | n/a | n/a | n/a | Do not list. |

**Edge privacy note.** By default Edge's Monero wallets sync through Edge's own light-wallet server, `https://monerolws1.edge.app` (`edge-currency-accountbased/src/monero/moneroTypes.ts`). A light-wallet server holds the wallet's view key, so it sees every incoming payment, including X2F payouts. Edge also offers a `monerod` (full-node) backend in settings (`WalletAndCurrencyConstants.ts`). X2F can't change this. It is one more reason not to "feature" Edge.

## 2. The mechanisms

### 2.1 WalletConnect / Reown
- **What it is.** A dApp shows a `wc:` pairing URI as a QR code or deep link, and the wallet joins an end-to-end encrypted session through Reown's relay (`relay.walletconnect.com`/`.org`). Sessions are scoped by CAIP-2/CAIP-25 namespaces.
- **Monero status.** The CAIP `monero` namespace is a Draft from 27 Apr 2023 with no chain IDs, no CAIP-10 account format and no methods ([namespaces.chainagnostic.org/monero](https://namespaces.chainagnostic.org/monero/README); [namespace index](https://namespaces.chainagnostic.org/)). No wallet implements it (see the table). X2F could not use WalletConnect for Monero even if it wanted to.
- **Privacy.**
  - **Project ID.** Every dApp needs a Reown project ID, which is "consumed through URL parameters" on the relay connection ([Reown relay docs](https://docs.reown.com/cloud/relay)). It labels every X2F user's connection as X2F's to Reown.
  - **What Reown says it processes.** Reown's privacy policy lists "IP address", "Full wallet address", "Country and region", "Randomly generated client ID", encrypted payloads, protocol metadata, and the SDK's user agent and version ([Reown privacy policy](https://reown.com/privacy-policy)).
  - **Retention and sharing.** There is no relay-specific retention period, and data may be disclosed to affiliates, service providers and law enforcement. The WalletConnect explorer's policy adds that the relay may temporarily log IP addresses to prevent DDoS attacks and may store encrypted payloads ([WalletConnect explorer privacy](https://explorer.walletconnect.com/privacy)).
  - **For a Monero P2P app**, a US-company relay would learn the user's IP address, the fact that they use X2F, connection timing and, for chains that share accounts, the wallet address. That is a metadata trail Monero users pick Monero to avoid. Even if Monero support appeared, I would not adopt it without a self-hosted relay.

### 2.2 The `monero:` payment URI, as a link or a QR code
- **Spec.** `docs/URI_SCHEME.md` in the monero repo ([GitHub](https://github.com/monero-project/monero/blob/master/docs/URI_SCHEME.md); [wiki mirror](https://librejo.monerodevs.org/monero-project/monero/wiki/URI-Formatting)) defines the following. Units for `tx_amount` are "decimal units", meaning XMR, not piconero.
  - `monero:<address>`, where `;` separates several recipients;
  - `tx_amount`, the amount in decimal units;
  - `recipient_name`;
  - `tx_description`;
  - `tx_payment_id`, which is deprecated and must not be used.

  The scheme also defines a separate `monero-wallet:` URI for restoring a wallet. **It must never be generated or accepted anywhere in X2F**, because it carries seeds and keys.
- **Use for job 2 (pay an exact amount to escrow).** Works today.
  - **Phone, tap to open.** Cake opens it on both iOS and Android, and Monerujo on Android. **Edge, Stack and Feather do not register the scheme**, so tapping the link either opens a different wallet or does nothing.
  - **QR code.** Every wallet in the table reads `monero:` QR codes, including Edge, Stack and Feather.
  - **The link cannot pick an app.** On iOS, when two apps claim `monero:`, which one opens is undefined. On Android the user gets a chooser. So a button labelled "Open in Cake Wallet" can open something else, and for an Edge user it fails.
- **Use for job 1 (get the user's receive address).** The URI does not help in this direction: a website cannot ask a wallet for an address with it. What does work without any third party is **reverse QR**. The user opens their wallet's Receive screen, which in Cake, Feather, Monerujo and Edge shows a QR code of the address (often a `monero:` URI, sometimes a fresh subaddress). X2F then scans that code with the camera, or the user pastes it. X2F parses and checks the address, and that removes copy-paste errors.
- **Privacy.** Nothing passes through a third party. A same-device link goes OS-to-app, and a QR code is optical. The only exposure is the operating system's own URL handling.

### 2.3 Wallet-specific deep links
- **Edge `reqaddr:`** (see the table). It is the only "send me your address" link I found in any Monero-capable wallet.
  - For XMR it returns the primary address, which is reused across trades, and never a subaddress.
  - It returns the address in a browser redirect query string. That puts the address in browser history and server logs, and possibly in Referer headers unless X2F strips them.
  - There is no public spec (a search found none), and Edge's code calls the POST part unfinished.
  - Verdict: not worth building for a single wallet. If built at all, only as a `redir` back to an X2F page that immediately moves the address out of the URL.
- **Cake's `cakewallet://`** scheme is used only for quick actions, Trezor Connect and WalletConnect returns. There is no documented Monero send or receive API.

### 2.4 Browser extensions
- **No maintained Monero browser extension wallet exposes a dApp provider.** There is no `window.monero` standard.
- The old "Monero Wallet for Chrome" is only a front end to a local `monero-wallet-cli` running in RPC mode ([GitHub](https://github.com/Monero-Monitor/monero-wallet-chrome)).
- Spirobel's CCS "Monero Browser Wallet" plans "Monero Payment Links", a browser wallet and a "Multisig companion app + escrow library". Only the 20 XMR prepayment milestone is done, and the rest have no dates ([CCS proposal](https://ccs.getmonero.org/proposals/spirobel_monero_browser_wallet.html)). **The escrow-library milestone is worth watching for X2F.**

### 2.5 Wallet RPC (`monero-wallet-rpc`)
- This means the user runs a wallet daemon and X2F talks to it. A site would need the user to expose an RPC port, with credentials, to the website. That suits power users at best, and it is a large attack surface (the RPC can spend).
- None of the mobile wallets expose it.
- Verdict: not a user-facing connect method. It stays server-side for X2F's own multisig and escrow watching.

### 2.6 Other proposals
- **Monero Payment Request Standard** (`monero-request:`, for recurring payments) is a community proposal with no adoption in the wallets above ([repo mirror](https://uithub.com/lukeprofits/Monero_Payment_Request_Standard)).
- **tevador's Jamtis proposal** includes an `xmrpay:` scheme for future addresses ([gist](https://gist.github.com/tevador/500d5d32d5ecc73b56997e12a9d2b20e)). It is not shipped, and it is tied to the FCMP++/Jamtis upgrades.

## 3. What X2F needs, mapped to what exists

| Need | Best available today | Third parties involved |
|---|---|---|
| 1. The user's receive address, ideally a fresh subaddress, with no copy-paste errors | Scan the wallet's Receive QR code (reverse QR) or paste it. Then check the address strictly: network, checksum, and type (a primary `4…` or a subaddress `8…`; reject integrated addresses and `monero-wallet:` URIs). Show it back in grouped chunks so the user can compare the first and last characters. Nudge the user to "use a new subaddress for X2F" (Cake, Feather and Monerujo can generate one). | None |
| 2. Pay an exact amount to the escrow address | `monero:<escrow>?tx_amount=<XMR>&tx_description=X2F%20trade%20…` as a QR code (all wallets) and as a tap-to-open link on phones (works in Cake and Monerujo; Edge, Stack and Feather users must scan or paste). Keep copy buttons for the address and the exact amount. | None |

Both match what spec section 2.2 / Phase 0 already says ("Monero has no MetaMask-style connect standard… 'connecting' a wallet means saving its address and opening it to pay"). This research confirms that and adds three corrections:

1. **Edge does not handle `monero:` links on iOS or Android.** The spec's Phase 0 item "Cake Wallet and Edge open `monero:` links" will fail for Edge. Don't show "Open in Edge".
2. **Edge never provides a subaddress for XMR**, and by default it shares the view key with Edge's light-wallet server.
3. **Exodus (since Aug 2025) and MyMonero (since Jan 2026) no longer handle Monero**, and Trust Wallet never did. None of them should appear anywhere.

## 4. Recommendation

**Build:**
1. **Receive address: "Scan or paste your wallet's receive address."** Use the camera QR scanner (`getUserMedia`, decoded on the device, no upload) plus paste, with strict validation and a chunked read-back. Copy: "Tip: create a new subaddress in your wallet just for X2F." This is the honest "connect" for Monero and needs no third party.
2. **Funding: a `monero:` link and a QR code.**
   - The phone button should read **"Open in your wallet app"**, not "Open in Cake Wallet". The OS chooses which app opens, and the label can't promise one.
   - Show the button only on iOS/Android, as the spec already does.
   - Always show the QR code and the copy fields for address and exact amount.
   - If the user's saved wallet is Edge, Stack or Feather, lead with the QR code and copy fields, not the link.
3. **Do not build WalletConnect, Edge `reqaddr`, or wallet RPC connections.** WalletConnect has no Monero support and leaks metadata to Reown. `reqaddr` works for one wallet, returns a reused primary address and has no spec. RPC is unsafe for end users.
4. **Watch:** the CAIP `monero` namespace, Spirobel's CCS browser wallet and escrow library, and Cake's release notes. If any wallet ships a Monero connect method that supports multisig, revisit spec item "Future goal".

**Show on the signup screen:**
- Replace the clickable wallet-name chips with **"Works with any Monero wallet"** and a plain, non-interactive **"Suggested wallets"** line: Cake Wallet (iOS/Android/desktop), Monerujo (Android), Feather (desktop), plus "hardware: Ledger or Trezor via Feather or Cake".
- Leave Edge and Stack out of "suggested". They work by scan or paste, but can't open payment links, and Edge gives no subaddresses and shares the view key by default.
- Never list Exodus, MyMonero or Trust Wallet.
- If X2F still wants to know the user's wallet in order to tailor the funding screen, ask it as an optional **"Which wallet will you pay from?"** question with neutral wording. Don't present it as a connection step. Store it only to choose between the link and the QR code.

## Sources

**Primary code** (read at the latest commit on each repo's default branch, 7–11 Nov 2026):
- [EdgeApp/edge-react-gui](https://github.com/EdgeApp/edge-react-gui): `android/app/src/main/AndroidManifest.xml`, `ios/edge/Info.plist`, `src/hooks/useWalletConnect.tsx`, `src/util/DeepLinkParser.ts`, `src/actions/ScanActions.tsx`, `src/types/DeepLinkTypes.ts`
- [EdgeApp/edge-currency-accountbased](https://github.com/EdgeApp/edge-currency-accountbased): `src/monero/moneroTypes.ts`, `src/monero/MoneroTools.ts`, `src/common/CurrencyEngine.ts`
- [cake-tech/cake_wallet](https://github.com/cake-tech/cake_wallet): `lib/reactions/wallet_connect.dart`, `android/app/src/main/AndroidManifestBase.xml`, `ios/Runner/InfoBase.plist`, `lib/utils/payment_request.dart`, `cw_core/lib/payment_uris.dart`
- [cypherstack/stack_wallet](https://github.com/cypherstack/stack_wallet): `lib/utilities/address_utils.dart`, `scripts/app_config/templates/android/app/src/main/AndroidManifest.xml`
- [feather-wallet/feather](https://github.com/feather-wallet/feather): `src/assets/feather.desktop`, `src/SendWidget.cpp`, `src/dialog/PaymentRequestDialog.cpp`
- [m2049r/xmrwallet (Monerujo)](https://github.com/m2049r/xmrwallet): `app/src/main/AndroidManifest.xml`

**Specs and documents:**
- Monero URI scheme: [monero/docs/URI_SCHEME.md](https://github.com/monero-project/monero/blob/master/docs/URI_SCHEME.md)
- CAIP Monero namespace: [namespaces.chainagnostic.org/monero](https://namespaces.chainagnostic.org/monero/README)
- Reown relay: [docs.reown.com/cloud/relay](https://docs.reown.com/cloud/relay)
- Reown privacy: [reown.com/privacy-policy](https://reown.com/privacy-policy)
- WalletConnect explorer privacy: [explorer.walletconnect.com/privacy](https://explorer.walletconnect.com/privacy)
- Cake docs: [docs.cakewallet.com](https://docs.cakewallet.com/llms-full.txt)
- Cake 6.2 release notes: [WalletConnect redesign](https://docs.cakewallet.com/release-notes/cake-wallet-6.2)
- Feather: [feature comparison](https://docs.featherwallet.org/guides/features)
- Exodus: [Monero (XMR) sunset](https://www.exodus.com/support/en/articles/10862085-monero-xmr-sunset)
- MyMonero: [sunset announcement](https://blog.cakewallet.com/announcing-mymoneros-sunset-and-stewardship-transition-to-cake-wallet/)
- Spirobel: [CCS Monero Browser Wallet](https://ccs.getmonero.org/proposals/spirobel_monero_browser_wallet.html)
- [Monero Wallet for Chrome](https://github.com/Monero-Monitor/monero-wallet-chrome)
