# Monero "connect" research, broad sweep (2026-11-12)

**Question from the owner:** "Is there any wallet or service that has talked about being a game changer and offering a connection service that includes Monero? Don't limit the search to Web3."

**Short answer:** No. No wallet or service has publicly shipped, or credibly announced, a general "connect your Monero wallet to a website" service. The phrase "game changer" turned up only for GameChanger Wallet, which is Cardano-only. What does exist falls into four groups:

1. Payment processors that watch an address with a view key. These are not connections.
2. Wallet-specific deep links: `monero:`, `cakewallet:` and `monerocom:`.
3. Early app-to-wallet "intent" work in the Logos ecosystem.
4. Multisig escrow DEXs (Haveno/RetoSwap), whose 2026 exploits are directly relevant to X2F.

The baseline findings in the brief are unchanged: WalletConnect and the other big wallets have no Monero connect, Spirobel's CCS is at 1 of 4 milestones, and `monero:` URI/QR codes work. One extra detail from the Spirobel proposal matters to X2F: its milestone 4 is a "Multisig companion app + escrow library" (100 XMR), and it is still not delivered. https://ccs.getmonero.org/proposals/spirobel_monero_browser_wallet.html

Legend:
- **Connect:** whether the site is truly linked to the user's own wallet.
- **Watcher:** a processor watching an address with a view key.
- **[unverified]:** a marketing claim or an unconfirmed third-party claim.

---

## 1. Wallet-to-site protocols, deep links, browser wallets

### Logos Monero Wallet `monero.wallet.send` intent (NEW, the closest thing to a "connect" found)
- **What it is:** Another app asks the wallet to pre-fill its Send tab with an address and amount (XMR as a string, at most 12 decimals). The user reviews and confirms, and the requesting app sends nothing itself. Error replies are `bad_request`, `view-only wallet` and `busy`. It runs inside Logos "Basecamp" (tested on 0.3.2).
- **Status:**
  - The wallet-side PR logos-co/logos-monero-wallet-ui#11 is **open, not merged** (Oct 23, 2026).
  - The consumer PR corpetty/muster#342 was **merged** on Oct 23, 2026.
  - The released wallet 0.1.1 does not support the intent, so Muster falls back to copy-and-paste.
  - The end-to-end flow has not been tested.
- **Connect?** Partly. It is a one-shot send request between apps on the same host, not a session. The PR says it is **not exposed to the web**: a `basecamp://` link cannot trigger it, and that is left to the maintainers.
- **X2F relevance:** None today, because X2F is a website. It is worth watching as a design pattern: the request carries address and amount, the user confirms in their own wallet, and the app never holds keys. Privacy cost is low, since the app already knows the address and amount.
- **Sources:** https://github.com/logos-co/logos-monero-wallet-ui/pull/11 , https://github.com/corpetty/muster/pull/342

### `monero:` URI and Cake Wallet app-specific schemes (live)
- **What it is:** Cake supports `monero:`/`monero-wallet:` (address in the path, `tx_amount`) and app-targeted `cakewallet:` and `monerocom:` (address in the `address` query field).
- **Callback:** Cake's docs describe no callback or return-to-site mechanism, so the site cannot learn the result except by checking the chain or asking for a tx proof.
- **Connect?** No. It is one-way.
- **X2F relevance:** Already in use. App-specific schemes could add a "Open in Cake" button. Privacy cost is none beyond the payment itself.
- **Source:** https://docs.cakewallet.com/faq/glossary/uri-scheme

### URI spec work (open proposals, not shipped)
- Issue #7731 proposes multiple destinations in `make_uri`/`parse_uri`.
- Issue #10168 proposes date and name parameters for the wallet URI.
- MoneroOne Android issue #40 reports that `recipient_name` is ignored. This shows wallets handle optional parameters unevenly, so X2F should not rely on them.
- Stack Wallet PR #1261 adds restore from a `monero_wallet` URI and notes the inconsistent scheme spellings across projects.
- **Sources:** https://github.com/monero-project/monero/wiki/URI-Formatting , https://github.com/monero-project/monero/issues/7731 , https://github.com/monero-project/monero/issues/10168 , https://github.com/bwgh0/MoneroOne.Android/issues/40 , https://github.com/cypherstack/stack_wallet/pull/1261

### Monero Payment Request Standard (community, lukeprofits)
- **What it is:** A `monero-request:` prefix encodes recurring or subscription payments. The wallet polls a `change_indicator_url` before paying. No signing was found.
- **Status:** A community spec with a reference "Subscriptions Wallet". I found no adoption by mainstream wallets.
- **Connect?** No. It is a richer one-way request.
- **X2F relevance:** Low, because X2F does one-off escrow funding.
- **Source:** https://github.com/lukeprofits/Monero_Payment_Request_Standard

### XMR20 Chrome extension with a "Connect wallet" button (live, experimental)
- **What it is:** An extension (0.1.128, Oct 31, 2026) plus a CLI. The xmr20.org site wallet has a **"Connect wallet"** button, and a background runner approves market sales while the extension is open.
- **Caveat:** It is built for **XMR20 tokens** on Monero, not plain XMR payments. The release says "Experimental" and "not had an independent security review". The connection's API and data flow are undocumented, so I could not tell whether the site gets a view key or only an address.
- **Connect?** Apparently yes, but for its own site only, with an undocumented protocol.
- **X2F relevance:** Not usable. It is a proprietary, unaudited token ecosystem. It does show that a Monero extension-to-site connection has been done in the wild.
- **Source:** https://github.com/xmr20project/xmr20-wallets/releases/tag/wallets-2026-10-31

### Other browser-extension efforts
- **CCS MR !636, "Open-source Monero browser extension wallet" (Jan 2026):** It aims at quick temporary wallets. Its funding status could not be checked because the GitLab page returned HTTP 521. https://repo.getmonero.org/monero-project/ccs-proposals/-/merge_requests/636
- **MyMonero:** It sunset its service, including the extension, on Jan 6, 2026, and handed its users to Cake. https://alternativeto.net/software/mymonero/about , https://www.coingabbar.com/en/crypto-press-release/mymonero-sunset-cake-wallet-takes-over-in-2026
- **Zelcore extension:** It does dApp connect for EVM and Solana. For XMR it is receive-only and sending is not possible, so there is no Monero connect. https://zelcore.io/browser-extension

### Other wallets
- **Exodus:** It ended XMR on Aug 18, 2025 (originally announced for Aug 10), so it is no longer relevant. https://www.exodus.com/support/en/articles/10862085-monero-xmr-sunset
- **Monerujo:** The latest release found is 4.1.7 (around June 2025). I found no 2026 release and no discontinuation notice, and it has no connect feature. https://github.com/m2049r/xmrwallet
- **Feather:** Desktop only, with hardware wallet support and a preliminary plugin system [release date unconfirmed]. I found no web connect and no multisig UI. https://featherwallet.org/download/
- **Stack Wallet:** Only URI handling work, with no connect. See the PR above.
- **OpenAlias:** No 2026 developments found. It remains DNS TXT name-to-address resolution, which the URI address field may carry. It is not a connection and it leaks DNS lookups. https://github.com/monero-project/monero/wiki/URI-Formatting
- **Skylight Wallet (MAGIC Grants, Nov 2025):** An Android light wallet that uses a self-hosted light-wallet server. It has no connect. https://www.privacyguides.org/news/2025/11/24/magic-grants-releases-monero-light-wallet-app-for-android/

---

## 2. Payment processors and gateways (all are watchers, none connects)

| Item | Status | Model | Privacy cost | X2F relevance |
|---|---|---|---|---|
| **BTCPay Server Monero plugin** | Live and community-maintained since BTCPay 2.1.0 moved XMR to a plugin. Releases: v1.3.6 (Oct 1, 2026), v1.4.0 (Oct 12, 2026, removes view-only wallet password). The plugin directory also shows a "2.2.0.0, Oct 17" entry, so version numbering is inconsistent. | Self-hosted, view-only wallet, generates a subaddress per invoice | Low if self-hosted. The view key sits on X2F's server. | Possible for deposits or fees. It **cannot** do multisig escrow. |
| **MoneroPay** | Repo last updated Feb 11, 2026 (`view-only-init` branch). No versioned 2026 release found. | Self-hosted, wallet-rpc, view-only possible, webhooks | Low | A lightweight alternative to BTCPay for fee or deposit detection |
| **Pago, XMR-PAY, AcceptXMR, MonkStash Pay, monerowp** | Live per the community comparison (checked Oct 17, 2026). That list is maintained by MonkStash, so its self-listings are [unverified]. | Self-hosted, view-key based | Low | Same as above |
| **NOWPayments** | Live | Hosted. Claims "Non-custodial" [unverified]. Its own page says it "processes, converts and forwards" to the merchant's wallet. | High: a third party sees every payment, and it uses API keys and an account | Not suitable for privacy-first escrow |
| **CoinPayments** | **Unconfirmed**. I found no 2026 source confirming XMR support. | Hosted | High | Avoid |
| **MixPay, SHKeeper, Plisio, B2BinPay** | Vendor pages claim XMR [unverified]. MixPay added it in early 2026 [unverified]. | Hosted, except SHKeeper which is self-hosted | High for hosted ones | Low |
| **Stablecoins plugin for BTCPay** | PR, Nov 2026 | Swaps XMR to BTC through a third party | High | No |

**Sources:**
- https://github.com/btcpay-monero/btcpayserver-monero-plugin/releases
- https://plugin-builder.btcpayserver.org/public/plugins
- https://sethforprivacy.com/guides/accepting-monero-via-btcpay-server/
- https://github.com/moneropay
- https://github.com/90ssolo/awesome-monero-payments
- https://nowpayments.io/supported-coins/monero-payments
- https://mixpay.me/blog/mixpay-introduces-monero-xmr-payments-for-privacy-focused-crypto-transactions
- https://shkeeper.io/news/monero-xmr-is-now-available
- https://plisio.net/accept-monero
- https://github.com/astupidmoose/btcpayserver-plugin-stablecoins/pull/7

---

## 3. Hardware wallets

- **Ledger:** The Monero app runs on Nano S, S Plus and X. Ledger's own support page names only Monero GUI as the companion wallet, and Ledger Wallet (formerly Ledger Live) only installs the app. Feather and Cake also work with Ledger per third parties. **Security note:** LSB-022 was a Monero app bug that let a compromised host extract the view and spend keys, fixed in app v2.1.4 and later. There is no Ledger "connect" API for XMR to a website.
  - https://www.ledger.com/monero-gui
  - https://support.ledger.com/article/360026472413-zd
  - https://donjon.ledger.com/lsb/022/
- **Trezor:** Safe 3, Safe 5 and Safe 7 work with Monero CLI/GUI, Cake, Feather and MoneroOne. Trezor's page says Suite "doesn't natively support Monero". The page does not mention Trezor Connect for XMR, and no Trezor Connect XMR support was found.
  - https://trezor.io/coins/wallet/monero
- **FCMP++ impact:** Hardware wallets do **not** work yet in the FCMP++ test builds. Stressnet v3.0 adds hot-cold signing, which is the groundwork for hardware wallets. A draft plan targets hardware wallet and multisig support for early December 2026, but it is non-binding.
  - https://cryptoticker.io/en/monero-fcmp-stressnet-fork-october-2026/
  - https://cryptonews.com/news/is-monero-traceable-what-the-fcmp-upgrade-changes-and-when/ (this returned 403 on fetch, so the content comes from a search summary)
- **X2F relevance:** Indirect. Users with a hardware wallet can fund escrow with a `monero:` URI through GUI, Feather or Cake. Hardware wallets **cannot** take part in Monero multisig today, so they cannot hold an escrow key share.

---

## 4. Atomic swaps and multisig escrow DEXs (most relevant to X2F)

### Haveno / RetoSwap (live, 2-of-3 multisig escrow with an arbitrator, like X2F)
- **May 20–25, 2026 exploit:** About 7,000 XMR (around $2.7M) was drained. A **forged ACK message** during Tor-based multisig setup let the attacker register their own address as the trade's *arbitrator*. As maker or taker they already held one key, so they then held 2 of 3 keys and could take the honest party's deposit. The funds were not recovered and no reimbursement was confirmed.
  - https://www.halborn.com/blog/post/explained-the-retoswap-hack-may-2026
  - https://www.sambent.com/haveno-brought-back-the-arbitrator-multisig-and-attackers-just-hijacked-it/
  - https://kycnot.me/service/retoswap
- **June 17–20, 2026 exploit:** A second vulnerability abused the dispute or forced-arbitration flow to release XMR. It was fixed in Haveno/RetoSwap 1.8.0 on June 20, which added verification of arbitrator signatures on dispute payout fields and checks on the senders of setup messages.
- **Hardening releases:**
  - v1.9.0 (Oct 6): broad security hardening, an API password, localhost-only binding, and a restored CLI API with an API guide and haveno-ts.
  - v1.10.0 (Oct 10).
  - v1.11.0 (Oct 17): Tor high-severity fixes.
  - v1.12.0 (Oct 29): verifies peer data for offers, arbitrators and support messages, blocks replayed account data, and accepts chat only from the trading peer.
  - Sources: https://github.com/haveno-dex/haveno/releases , https://kycnot.me/service/retoswap
- **No independent audit** was reported as of July 2026 (https://haveno.nokycme.com/). Trading has resumed per the 1.8.0 notes. I did not check RetoSwap's official channels for the live status.
- **Connect?** No. It is a desktop or Android app with its own built-in wallet, and the user funds the multisig from that app. Its daemon API is for local or onion use, not for websites to connect.
- **X2F relevance: HIGH, as a lesson.** X2F's 2-of-3 design shares this exact attack surface. Lessons, mostly from Halborn's analysis:
  1. Authenticate every message that assigns a role or a key. Arbitrator identity must be fixed or signed out of band, never accepted from a trade party.
  2. Before showing a funding address, check that the key set has one key per role and that no party controls 2 of 3.
  3. Sign dispute payout fields and check them against the trade.
  4. Audit the business logic, not just the code.

### Bisq (Bisq 1 live, Bisq 2 has no XMR)
- **Bisq 1:** XMR is a payment method in BTC trades, with trades capped at 0.25 BTC per third parties. A May 1, 2026 Bisq 1 exploit took 11.59 BTC from 10 users, who were reimbursed by June 16, 2026. XMR auto-confirm stays disabled until an audit [unconfirmed on Bisq's own site].
- **Bisq 2 / Bisq Easy:** No XMR. It is on the roadmap with no date.
- Bisq does not use Monero multisig. The BTC side is the escrow.
- **X2F relevance:** Low.
- **Sources:** https://ghostswap.io/how-to-sell-monero/ , https://neverkyc.io/blog/haveno-vs-bisq-monero-dex-comparison-2026 , https://bisq.network/getting-started/

### eigenwallet (formerly UnstoppableSwap) (live)
- **What it is:** A desktop BTC-to-XMR atomic swap wallet and DEX with a peer-to-peer maker network.
- **Releases:**
  - 5.0.1 (Oct 30, 2026): breaking protocol changes. Takers must prove ownership of their BTC lock inputs, and the cancel timelock moved from 24 to 30 blocks.
  - 5.0.2 (Oct 31).
  - 5.0.3 (Nov 10): adds an "Apollo" encrypted on-chain backup.
  - 4.15.0 (Sep 22) is reported to fix Monero double-spend attempts [third-party claim].
- **Escrow model:** Adaptor-signature atomic swaps, with a shared XMR key, rather than an arbiter.
- **Interfaces:** No website API. ZETO (Oct 13, 2026) is a third-party browser front end for the protocol with a 0.7% coordinator fee; its press release is [unverified].
- **X2F relevance:** Medium-low. It shows trustless BTC-to-XMR without an arbiter, but it is not fiat P2P.
- **Sources:**
  - https://docs.eigenwallet.org/
  - https://github.com/eigenwallet/core/releases
  - https://www.manilatimes.net/2026/10/13/tmt-newswire/plentisoft/zeto-brings-browser-based-access-to-peer-to-peer-bitcoin-to-monero-atomic-swaps/2444211
  - https://kycnot.me/service/eigenwallet

### Serai (not launched)
- **What it is:** A DEX with threshold-multisig, FROST-style wallets.
- **Status:** The docs say "mainnet has yet to launch". Its Tendermint consensus was released about 100 days ago.
- **Relevance:** The monero-serai and monero-oxide libraries, including FROST multisig, are a possible future multisig base for X2F. They are not a connect service.
- **Sources:** https://docs.serai.exchange/ , https://x.com/monero/status/1859680256040501631

---

## 5. Upcoming protocol work (FCMP++, Carrot/Jamtis)

- **FCMP++:** Not on mainnet. Sites that claim it activated in 2026 are wrong.
  - Stressnet v3.0 (v0.19.0.0-beta.3.0, Sep 25) forked at height 3102800 on Oct 5, 2026.
  - Stressnet v3.1 was released Oct 26 [per news].
  - A non-binding draft plan targets a full-featured release in early December 2026 and activation around the **first week of March 2027**. No official fork date has been set.
  - Sources: https://cryptoticker.io/en/monero-fcmp-stressnet-fork-october-2026/ , https://cryptonews.com/news/is-monero-traceable-what-the-fcmp-upgrade-changes-and-when/
- **Multisig under FCMP++:** It does not work yet in test builds.
  - Tech meeting #185 (Sep 14, 2026) discussed koe's multisig PR versus FROST-based schemes, such as monero-oxide's "FROSTLASS" over FFI.
  - Participants noted that existing multisig wallets may not migrate as a drop-in, and called multisig "niche".
  - **This is the biggest dependency risk for X2F:** escrow wallets created before the fork may need migration or a new protocol, and the multisig scheme may change.
  - https://github.com/monero-project/meta/issues/1456
- **Carrot (Jamtis-compatible addressing):** Ships with FCMP++ and is backward-compatible with existing addresses. I found **no** payment-request or wallet-connection feature in Carrot or Jamtis material. Carrot's view-key tiers may later make view-only watchers (the processors in section 2) leak less.

---

## 6. 2025–2026 "Monero connect" / "pay with Monero" / SDK announcements

- **No official "Monero Connect" or "Monero SDK" announcement was found in 2025–2026.**
- **"Game changer":** It matched only GameChanger Wallet, a Cardano wallet and dApp connector with no Monero. https://gamechanger.finance/
- **"Pay with Monero Wallet" button:** The only one found is Muster PR #342 in the Logos ecosystem, covered in section 1.
- **Ghostly PR #4665 (Nov 2, 2026):** A chat app shows `monero:` links as payment cards that open the user's own wallet. This is a URI handler, not a connect. https://github.com/MiguelMedeiros/ghostly/pull/4665
- **Cake Wallet 2025–2026:** Payjoin v2 for BTC (May 2025), Zcash shielded by default and NEAR Intents (Jan 2026), and the MyMonero handover. None of it is a Monero connect. https://www.theblock.co/post/385852/cake-wallet-zcash-support-expands-beyond-monero-roots , https://www.nobsbitcoin.com/cake-wallet-v4-28/
- **Generic WalletConnect:** Reported at about 400 wallets and 10k dApps in Feb 2026 [unverified]. None of them are Monero. https://www.mtpelerin.com/blog/how-to-use-walletconnect

---

## Recommendation for X2F

1. **Keep `monero:` URI and QR codes** as the funding path. Add `cakewallet:` and `monerocom:` "open in app" buttons, and verify funding on-chain through the escrow multisig itself or by asking for a tx proof.
2. **Do not adopt a hosted processor** (NOWPayments, CoinPayments and similar) for escrow. They add a third-party observer and cannot handle multisig. A self-hosted BTCPay plugin or MoneroPay is fine for collecting fees only.
3. **Treat the Haveno exploits as a checklist for X2F's own multisig setup:** signed arbitrator identity, key-set checks, and signed payout fields. This matters more than any connect feature.
4. **Watch:**
   - the Logos `monero.wallet.send` intent (PR #11);
   - Spirobel CCS milestones 2 and 4 (payment links, and the multisig escrow library);
   - the FCMP++ multisig decision (meta issue #1456, around December 2026 to March 2027).
5. **Plan for FCMP++ migration of escrow multisig before roughly March 2027.**

## Fetch notes
- These pages returned errors: cryptotimes (403), cryptonews (403), the CCS GitLab MR !636 (521), Feather docs (redirect loop) and the Ledger article 360006352934 (empty).
- For those, the content comes from search-result summaries and is marked as such where it matters.
- GitHub release pages show day and month only; I inferred the year from context and the cross-reference on kycnot.me.
