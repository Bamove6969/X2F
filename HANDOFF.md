# X2F handoff

Last updated: 2026-10-14, about 21:15 PDT, at the end of the first working session.

## What X2F is

X2F is a phone-first, peer-to-peer marketplace for trading **Monero (XMR) for fiat** (cash, bank transfers, payment apps), with escrow. It replaces LocalMonero, which shut down in 2024. "X" means XMR today and any coin later. The tagline idea is "Fiat to believe it".

**Core values**, set by the owner and non-negotiable:
- **Privacy is a right.** No platform identity checks, no email or phone required, no tracking. All metadata is stripped from uploads.
- **Non-custodial.** X2F never holds enough keys to move a user's coins.
- **Security first.** "We cannot get hacked." Use mature, audited libraries only; nothing experimental in production. An external audit and penetration test happen before launch.
- **Slick and simple.** Multisig, Tor and key exchange stay hidden. Users see Fund, I've paid and Release.

## Where everything is

| What | Where |
|---|---|
| **Design spec (source of truth)** | `docs/superpowers/specs/2026-10-14-x2f-design.md` |
| **All screens, one canvas (use this)** | Claude Design **X2F App**: https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH |
| Canvas source files (backup) | `design/x2f-app/` (`canvas.json` plus one `.dc.html` per screen) |
| **Design system** | Claude Design **X2F**: https://claude.ai/artifact/Bywqtsd4FKmYPHta6wQNPM; source in `design/design-system/` |
| Payment method catalog | `data/payment-methods.json` (78 methods plus Custom, all `verified: false`) |
| Escrow feasibility test | `spikes/escrow-multisig/spike.mjs` |
| Competitor research | https://claude.ai/artifact/3QFL5yy61UXqvvFFQ4jWRH; copy in `research/after-localmonero.html` |
| Decision log snapshot | `research/decisions-memory-snapshot.md` |
| Superseded canvases (don't edit) | Trade Room `ChhV9QxqXKjTf7JsDGMQkt`, Browse & Take `JL3SWeMcxwcAwYoYdtpk2h` |

Editing the canvas: publish changed `.dc.html` files to the X2F App URL with the Artifact tool, using `root` = a folder whose `project/` holds them. Copy from `design/x2f-app/` into `<scratch>/x2f-app/project/` first. Keep `design/x2f-app/` in sync afterwards and commit.

## Key decisions (details in the spec)

### Platform and architecture
- **One codebase:** a website (installable web app) wrapped as iOS and Android apps with Capacitor. It's built with TypeScript and React.
- **No built-in wallet (decided 2026-10-14).** The owner wants X2F to be purely a facilitator, never a "money man". Users link the Monero wallets they already use under **Your wallets** (Cake Wallet, Edge, Feather, Monerujo, Stack, Monero GUI/CLI, Ledger/Trezor, Other): payouts go there, and sellers fund via "Open in Cake Wallet" (a `monero:` payment link with address and amount) or QR. No balances, no recovery phrase. The app still creates **one temporary escrow key per trade** (monero-ts), because no Monero wallet can join a multisig or has a MetaMask-style connect for Monero (WalletConnect in Cake/Edge covers other chains). Seller funding window is now **30 minutes**.
- **Escrow:** each trade gets a fresh **2-of-3 multisig** between buyer, seller and moderator. X2F holds at most one key, the moderator's. There is no automatic third key.
- **Backend:** Fastify and PostgreSQL for offers, login challenges, reputation and disputes. It holds no funds. An end-to-end encrypted relay carries chat and escrow messages.
- **Building on Haveno was rejected.** Its Java engine can't run in a browser, so a web app would have to become custodial.

### Trade flow (all approved)
1. **Browse.** Pick a payment method, then see offers. Anyone can chat with as many traders as they like before committing.
2. The buyer taps **"I'm in"** and picks a payout: their X2F wallet or an external wallet. External is recommended for larger amounts.
3. The seller **funds**. This is the key turn and the commitment. The seller has a 10-minute funding window.
4. **"Securing escrow"** shows in amber with a confirmations bar (for example 3 of 10, about 20 min). At 10 confirmations it turns teal: **"Escrow secured"**.
5. The buyer's **90-minute payment timer starts once the escrow is settled**. The buyer pays, uploads optional proof and taps **I've paid**. A confirmation step follows: "I sent exactly $X via Y with memo Z". The seller is alerted automatically.
6. The seller checks their **bank account**, not "Zelle", ticks the checkbox, then **presses and holds for 1.5 s to release**. The release can't be undone.
7. The **released screen** shows the destination, live confirmations and an optional explorer link. Explorers never show the amount or the recipient.
8. **Review:** a required trader rating (stars plus phrases, blind reveal), then optional "How's X2F doing?" feedback.

### Edge cases (approved)
- **Mutual cancel:** both sides co-sign a refund, with no penalty. Profiles show a neutral cancel rate.
- **Buyer no-show:** the seller can **extend the timer** (+30 min, at most twice) or **Cancel & get refund**. The buyer gets a 15-minute final alert. If they stay silent, the **moderator key signs the refund automatically**, and only to the seller's refund address.
- **Dispute after refund:** if the buyer paid anyway, they can dispute. The moderator can place a **trading hold** (it blocks new ads and trades, never coins). If the payment arrived, the seller must **send the XMR as agreed**, not a fiat refund, with an in-app payment proof. Refusing means suspension and a possible lifetime ban. Only if the seller provably can't send the XMR may the moderator order the fiat returned.
- **Disputes:** human moderators, a published deadline, appeal to a second moderator, and two-moderator approval above a threshold.
- **Nudge:** an ICQ-style "buzz" that wakes a dozing counterparty. It's on by default, with quiet hours, rate limits and privacy-safe push text.

### Proof uploads
- Metadata is stripped on the device.
- **Automatic best-effort blur** of private details, then the buyer double-checks. The screen says plainly that blurring isn't guaranteed.
- The seller sees the blurred version. The moderator can request the unblurred one.
- Proof is **optional**, as it was on LocalMonero and Haveno. Without it the app shows a nudge: "makes disputes harder".
- A smart proof card reads the amount, memo and name, and always reminds the seller that "only your bank proves the money arrived".

### Payment methods
- **No risk ratings.** X2F can't know the real risk of every method in every country.
- **Currency matching comes from live offers, not a hand-made list.** Lists show "Buyers paying in USD" (from real offers), then "All payment methods" A–Z.
- Sorting options are Most buyers, Best rate and A–Z, plus search.
- The catalog was seeded from **Haveno's open-source list** (names only, no code copied). Five were dropped: three dead services and two crypto-only entries.

### Badges (milestones)
- **New** (under 5 trades) is a safety badge: always shown, can't be hidden.
- **Milestones:** 10, 50, 100, 500 and 1,000 trades; Veteran at 1, 3 and 5 years; Trusted (100+ trades, 98%+ positive); Fast; Clean record.
- **Security honours:** PGP verified and Security key verified.
- **No volume badges**, for privacy.
- Each badge can be set to **Featured** (at most 2 on offer cards), **On hover** (shown in a "+N" popup) or **Hidden**, in Profile → Badges.
- Every badge is a teal pill with a small line icon. New is amber.

### Accounts and security
- No sign-up form at the door. Login setup happens on the first "I'm in" or ad post; no wallet is created.
- **PGP login is recommended and shown first.** The user pastes a public key, decrypts a challenge and pastes back the phrase. The phrase is single-use, expires after 5 minutes and names the site and time.
- Accepted keys: **RSA 4096+, Ed25519, Ed448**.
- Passkeys, security keys (FIDO2) and **TOTP** (6 digits, 30 s; a second factor or backup, never the only login).
- **A backup login is optional but strongly recommended** (decided 2026-10-14; owner: LocalMonero only had passwords, and X2F holds no coins). **Passwords are allowed** for users who want a simple one (10+ chars with upper, lower, number and symbol; Argon2id; leaked-list check). Usernames 5–20 characters.
- Adding a payout wallet asks the user to confirm it's them and always shows an alert. Optional hardening: a 24-hour wait for new payout wallets (opt-in, so fresh addresses per trade stay easy), spending limits, PGP-signed addresses, a device list, and an escrow-key backup encrypted to the user's own PGP key.

### Design system
- Night-first.
- **Monero orange is used only for the one primary action per screen.**
- State colours: amber for waiting, teal for escrow and done, rose for danger. Always paired with a word.
- Fonts: Familjen Grotesk for display, Atkinson Hyperlegible Next for body text, Atkinson Hyperlegible Mono for numbers and addresses.
- No emoji, no exclamation marks.
- Usernames show exactly as set.

## Proven technically

The **escrow feasibility test passed** on 2026-10-14 (`spikes/escrow-multisig/`).
- Versions: monero-ts 0.11.16, monerod v0.18.5.3, private regtest chain, run in Node.
- Results:
  - Normal release, mutual cancel and both dispute outcomes all paid out 0.998 XMR (fees made up the difference).
  - One key alone was rejected with "Not enough signers".
- Timing: setup takes 3 message rounds (about 24 s, all in one process), funding under 2 s, release about 3 s.
- **Gotcha:** monero-ts wallets need `regtest: true` on a regtest chain, or sync fails with "Exception in thread pool".
- To rerun:
  1. Download and checksum-verify the Monero CLI.
  2. Start `monerod --regtest --offline --fixed-difficulty 1 --rpc-bind-port 18081`.
  3. Run `npm i monero-ts@0.11.16 --ignore-scripts && node spike.mjs`.
- `npm audit` flagged one high and one moderate advisory in monero-ts's transitive dependencies. They must be resolved before production.

## Moderators (agreed 2026-10-15, to be written into the spec)

- **Roles:** Owner (creates and removes moderators, sets the large-trade limit, sees every log, co-approves every ruling above the limit) and Moderator (rules alone below the limit). Later the owner can tick "Can co-approve large rulings" on trusted moderators. Helpers (questions only, no evidence) come with the community room.
- **Chats are encrypted but moderators can read them** when a dispute is opened on that trade; every read is logged; users are told in every chat.
- **Dispute records are kept and logged; training uses anonymized copies** (Buyer/Seller, personal details masked). Confirm with owner if unsure.
- Proposed, awaiting owner approval: owner login by hardware security keys only, staff accounts separate from trading accounts, a violet shield "X2F Moderator" badge shown only in disputed trade rooms, a moderator dashboard (queue, case view, ruling tools, training library).
- Community room ideas are parked in `docs/community-room-plan.md`.

## Open decisions (owner's call)

1. **Fees: decided 2026-10-14.** 1% per completed trade, paid only by the ad poster. Takers never see a fee line.
2. **Legal and jurisdiction.** Get a crypto lawyer before mainnet. Even non-custodial platforms have been hit (Tornado Cash, the UK FCA warning about LocalCoinSwap).
3. **Moderators:** who they are, how they're paid, deadlines and thresholds.
4. **Buyer deposit thresholds.**
5. **Sanctioned rails** (SBP, Mir, YooMoney). They need a lawyer's sign-off.
6. **Gift cards:** allowed or not.
7. **Price feed sources.**
8. Post an offer: add a fixed-price option, and badge requirements behind "More options"? (Asked, not yet answered.)
9. A seller bond for disputes after refunds? (Deferred.)

## Next steps, in order

1. **Getting started screens: done 2026-10-14** (canvas row "Getting started"): username, login method, PGP key + challenge, password alternative, optional backup, link a wallet. Owner to review screen by screen.
2. Buy side (mirrors Sell), then the moderator dashboard.
3. Bring the desktop view up to date with the phone screens (popups, badge icons) when convenient.
4. **Phase 0 passed (GO), 2026-10-14:** escrow ran in desktop Chrome plus Firefox on Android over Wi-Fi; see `spikes/phase0-browser/RESULTS.md`. Left: iPhone Safari, open internet and Tor, stagenet, and resume-after-background.
5. Once the spec is reviewed and approved, use the **writing-plans** skill for the implementation plan.
6. Verify each payment method against the provider's website, and grow the catalog.

## Working with the owner

- Keep updates short. Lead with the decision needed and use few bullets.
- The owner reviews one screen at a time with screenshots and wants precise, honest wording. They push back on anything confusing or over-claimed.
- Do design work **in Claude Design**: X2F App canvas and X2F design system.
- Commit spec changes with the author set: `git -c user.name="flem" -c user.email="bamove@gmail.com" commit`. No global git identity is configured.
- **Security scans run during coding, not just before launch** (owner's instruction): scan every code change with Claude Security and Semgrep, and fix Security Guidance warnings as they appear.
- Security plugins are installed: Claude Security, Security Guidance, and Semgrep (logged in as Bamove6969; the CLI isn't installed yet).
- A **duplicate session** of this conversation was running and watching the canvases. Close extras under `/tasks`.

## Unrelated loose ends from this session

- **The owner's Claude account is still signed in on a friend's iPad.** Sign it out under claude.ai → Settings → devices.
- `~/agy-repro` (a throwaway folder) still needs deleting by the owner.
- The cause of the unexplained move of `~/claude-workspace` to `~/Public/claude-workspace` was never found.
- Claude Code was downgraded from 2.1.300 to 2.1.292 by `/restart`, then the update channel was set to "latest". `/upgrade` showed "Login interrupted".
