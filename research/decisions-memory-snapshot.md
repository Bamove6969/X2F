---
name: monero-p2p-project
description: "New project (started 2026-10-14) - phone-first P2P app for selling/buying Monero for fiat with escrow, replacing LocalMonero; decisions so far"
metadata:
  node_type: memory
  type: project
  originSessionId: a2681ce3-d76d-4e53-8c01-be38a47dc971
  modified: 2026-10-14T21:31:36.866Z
---

The user is starting a new project (named X2F, ~/projects/x2f): a slick, phone-first P2P Monero <-> fiat marketplace with escrow, to fill the gap left by LocalMonero (closed 2024). Research report: https://claude.ai/artifact/3QFL5yy61UXqvvFFQ4jWRH

Decisions agreed 2026-10-14:
- Web app first (installable PWA), native wrappers later.
- Buy/sell boards, filtered by fiat payment method.
- Escrow is 2-of-3 Monero multisig: buyer, seller and moderator each hold one key. The platform never holds 2 keys. Leaning toward building on Haveno's network/protocol (not yet confirmed).
- Unlimited free pre-trade chats. The buyer taps "I'm ready", then the seller "turns the key" (funds escrow) = committed.
- The buyer has 90 min (from escrow confirmation) to pay and mark paid. The seller's confirm window varies by payment method.
- Proof screenshots are visible to the seller. The buyer blurs them with an in-app tool, and an unblurred copy goes to the moderator on request.
- Buyer deposit scales with trust: none for small first trades.

**Why:** Privacy is a core value for the user ("this is about people's privacy and the right to it"). All sensitive EXIF/metadata must be stripped from every upload.

**How to apply:** Treat privacy as a hard requirement in every design choice, and keep the platform non-custodial.

Added 2026-10-14 (later):
- Platform: one codebase that runs as a website and is wrapped as iOS/Android apps (like LocalMonero's site + app). Non-custodial; keys stay on the device. Option B: our own escrow engine on monero-ts (feasibility test on testnet proposed, not yet approved).
- Security is top priority ("we cannot get hacked"; "no untested stuff"): mature libraries only, OWASP ASVS L3, strict CSP, an external audit and pentest before launch. Security plugins installed: claude-security, security-guidance, semgrep.
- Feedback/reputation is core: a review prompt right after every trade (1-5 stars plus tap-phrases), required before the next trade, blind reveal, only from completed escrow trades, portable reputation.
- 2026-10-14: the escrow feasibility test PASSED (monero-ts 0.11.16 + monerod v0.18.5.3 regtest, in Node). 2-of-3 setup took 3 message rounds (~24s with all wallets in one process); release, mutual cancel, both dispute outcomes and the one-key-cannot-spend check all verified. Gotcha: monero-ts wallets need `regtest: true` on a regtest chain, or sync fails with "Exception in thread pool". Escrow funds stay locked 10 blocks (~20 min) after funding before they can be released. Not yet tested in a browser or on a phone.
- Design order agreed: trade room → browse/take → reviews/profiles → wallet → getting started (wallet created on device only when the user first taps "I'm in"; no email or phone) → moderator dashboard.
- Optional security tiers wanted ("people can make their accounts as secure as they want"): passkey/PIN by default; optional hardware keys (FIDO2/WebAuthn, tap to fund or withdraw), TOTP, PGP (signed profile = portable reputation, decrypt-challenge login, encrypted notifications, signed withdrawal addresses via OpenPGP.js), address allowlist plus 24h delay, spending limits, device management, profile security badges.
- PGP-only login wanted as an option: paste a public key (fingerprint = account), decrypt a challenge (single-use, 5-min expiry, includes site name and time against phishing), rate-limited, accepted keys: RSA 4096+, Ed25519, Ed448. A backup login method is MANDATORY at setup. PGP login is shown first as the strongly recommended option; passkey and security-key login remain available. Wallet and escrow-key backup encrypted to the user's own PGP key and stored server-side (still non-custodial).
- TOTP (6-digit, 30s, any authenticator app) wanted: usable as a second factor and as the mandatory backup method; never the sole login.
- Name: X2F (X = XMR now, any coin later). Tagline idea: "fiat to believe it". Folder: ~/projects/x2f (git repo, created 2026-10-14). Deliberately not ~/Public, which is the folder Linux shares over the network.
- The user wants design work done directly in Claude Design (Artifact Design System + Design types), not just text: design doc → X2F Design System → screens on a Design canvas.
- X2F Design System (Claude Design): https://claude.ai/artifact/Bywqtsd4FKmYPHta6wQNPM - night-first, Monero orange only for the one primary action, state colours caution/escrow/danger, Familjen Grotesk + Atkinson Hyperlegible Next/Mono. Spec committed at ~/projects/x2f/docs/superpowers/specs/2026-10-14-x2f-design.md.
- Trade room canvas (Claude Design): https://claude.ai/artifact/ChhV9QxqXKjTf7JsDGMQkt - 4 phone screens (fund, buyer pays, seller confirms, released + review) + desktop. Next: browse & take screens.
- Browse & Take canvas (Claude Design): https://claude.ai/artifact/JL3SWeMcxwcAwYoYdtpk2h - Sell method picker (every method worldwide, sortable: Most buyers default with Popular-for-currency + groups, Best rate, A-Z, search) and Sell-via-Zelle buyer list. Trade room review largely done 2026-10-14.
- 2026-10-14 evening: user APPROVED trade room phone screens (1-4 + missed deadline), Sell method picker, buyers list (badge system with icons, +N hover, featured/on-hover/hidden), and Post an offer (market-following price, min/max, terms, min trades). Next proposed: merge canvases into one "X2F App" canvas with pages + Play links, then Getting started (login/PGP/backup).
- MERGED canvas (use this one going forward): X2F App https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH - pages Browse & offers / Trade room / Profile & wallet; Play links: Sell to mira.k → fund → buyer pays → seller confirm → review; home has bottom nav (Trade, Post offer, Wallet, Profile). Old Trade Room and Browse & Take canvases are superseded. Local source: scratchpad/x2f-app/project.
