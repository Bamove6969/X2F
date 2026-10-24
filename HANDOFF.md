# X2F handoff

Last updated: 2026-10-21. Brought up to date with the owner's decisions of 2026-10-17 to 2026-10-20, the build progress, the two-session setup and the toolchain; no new decisions. (Spec approved by the owner 2026-10-15 01:56 PDT.)

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
2. Whoever takes an offer taps **Trade** (decided 2026-10-15; replaces "I'm in"); the poster sees "<username> accepted your offer". The buyer picks which of their own wallets gets paid.
3. The seller **funds**. This is the key turn and the commitment. The seller has a 30-minute funding window (spec 2.2).
4. **"Securing escrow"** shows in amber with a confirmations bar (for example 3 of 10, about 20 min). At 10 confirmations it turns teal: **"Escrow secured"**.
5. The buyer's **90-minute payment timer starts once the escrow is settled**. The buyer pays, uploads optional proof and taps **I've paid**. A confirmation step follows: "I sent exactly $X via Y with memo Z". The seller is alerted automatically.
6. The seller checks their **bank account**, not "Zelle", ticks the checkbox, then **presses and holds for 1.5 s to release**. The release can't be undone.
7. The **released screen** shows the destination, live confirmations and an optional explorer link. Explorers never show the amount or the recipient.
8. **Review:** a required trader rating (stars plus phrases, blind reveal), then optional "How's X2F doing?" feedback.

### Edge cases (approved)
- **Mutual cancel:** both sides co-sign a refund, with no penalty. Profiles show a neutral cancel rate.
- **Buyer cancels alone** (owner, 2026-10-17; spec 2.3): any buyer can cancel after funding without the seller and without a dispute. The refund always goes to the seller's recorded refund address (the moderator key signs automatically, only to that address). A strong warning shows first if they already tapped I've paid. **A seller never cancels alone** after funding.
- **Buyer no-show:** the seller can **extend the timer** (+30 min, at most twice) or **Cancel & get refund**. The buyer gets a 15-minute final alert. If they stay silent, the **moderator key signs the refund automatically**, and only to the seller's refund address.
- **Dispute after refund:** if the buyer paid anyway, they can dispute. The moderator can place a **trading hold** (it blocks new ads and trades, never coins). If the payment arrived, the seller must **send the XMR as agreed**, not a fiat refund, with an in-app payment proof. Refusing means suspension and a possible lifetime ban. Only if the seller provably can't send the XMR may the moderator order the fiat returned.
- **Disputes:** human moderators, a published deadline, appeal to a second moderator, and two-moderator approval above a threshold.
- **Starter limits for new accounts** (owner, 2026-10-24; spec 2.3; replaces the 2026-10-17 "no limits" decision). New accounts graduate from $200 to $1,000 to no platform cap per trade (see Badges); ad posters can still require a minimum number of completed trades.
- **No buyer deposits** (owner, 2026-10-17; spec 2.5). Only the seller funds the escrow.
- **Extra XMR in an escrow:** see "Decided 2026-10-20" below. **Late extra XMR** waits until every coin has 10 confirmations (about 20 minutes), then everything is paid out; no separate time cap (owner, 2026-10-17; spec 11.1).
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
- **New** is a safety badge: always shown, can't be hidden, until the account graduates from starter limits.
- **Starter limits** (owner, 2026-10-24; spec 2.3): $200 per trade for 0–4 trades; $1,000 for 5–19 trades and 7+ days; no platform cap from 20 trades and 30 days. Owner can change the numbers. Replaces "no limits for new accounts" (2026-10-17).
- **Milestones:** 10, 50, 100, 500 and 1,000 trades; Veteran at 1, 3 and 5 years; Trusted (100+ trades, 98%+ positive); Fast; Clean record.
- **Security honours:** PGP verified and Security key verified.
- **Past reputation** (owner, 2026-10-17; spec 5.5, Plan 5): a separate badge for trades on other sites, proven by signing with the PGP key shown on an archived old profile, approved by a moderator. Screenshots alone don't count. It never adds to the X2F trade count, rating or milestones.
- **No volume badges**, for privacy.
- Each badge can be set to **Featured** (at most 2 on offer cards), **On hover** (shown in a "+N" popup) or **Hidden**, in Profile → Badges.
- Every badge is a teal pill with a small line icon. New is amber.

### Accounts and security
- No sign-up form at the door. Login setup happens on the first Trade tap or ad post; no wallet is created.
- **The Terms screen comes first in setup** (owner, 2026-10-17; spec 6.1): scroll to the end, tick, I accept; shown again when the Terms change. It includes a section saying X2F answers lawful warrant requests with the little it holds, which is why it logs no IPs and asks for no name, phone or email (spec 4.1).
- **PGP login is recommended and shown first.** The user pastes a public key, decrypts a challenge and pastes back the phrase. The phrase is single-use, expires after 5 minutes and names the site and time.
- Accepted keys: **RSA 4096+, Ed25519, Ed448**.
- **Emails inside PGP keys are never recorded or shown** (owner, 2026-10-18 00:31; spec 6.2). Removed from newer (v6) keys before storing; older (v4) keys are stored encrypted. Login messages are signed with the official X2F PGP key, and X2F never creates PGP keys (spec 6.2).
- Passkeys, security keys (FIDO2) and **TOTP** (6 digits, 30 s; a second factor or backup, never the only login).
- **A passkey counts as a backup; a password never does** (owner, 2026-10-17; spec 6.2).
- **A backup login is optional but strongly recommended** (decided 2026-10-14; owner: LocalMonero only had passwords, and X2F holds no coins). **Passwords are allowed** for users who want a simple one (10+ chars with upper, lower, number and symbol; Argon2id; leaked-list check). Usernames 5–20 characters.
- **The first wallet, added during setup, skips confirm-it's-you**; every later wallet needs it. **No trading or ads until a wallet is added** (owner, 2026-10-17; spec 6.4).
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
- Versions: monero-ts 0.11.16, monerod v0.18.5.3, private regtest chain, run in Node (the project now uses Node 24.22.1).
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
- **Dispute records are kept 30 days after the dispute closes, for training, then deleted** (owner, 2026-10-17). Training uses anonymized copies (Buyer/Seller, personal details masked), kept 6 months, then deleted; trainees never see real details. **No IP addresses are logged, even in disputes** (owner, 2026-10-17).
- **Staff log in with two factors** (owner, 2026-10-17; spec 6.6): security key + PGP, two different PGP keys, or PGP + passkey. Idle timeout **2 hours**; a session also ends after **12 hours** at most (Plan 2 Task 4, unchanged by the owner, conversation 2026-10-18 03:19) and when login hours end.
- **Approved by owner 2026-10-17:** owner logs in with a hardware security key and a PGP key, both on every login (the key must be a YubiKey 5 on firmware 5.7 or newer, see below); staff accounts separate from trading accounts; a violet shield "X2F Moderator" badge shown only in disputed trade rooms, with a hard-to-copy look such as a holographic shimmer (to design on the canvas); the moderator dashboard (queue, case view, ruling tools, training library).
- Community room ideas are parked in `docs/community-room-plan.md`.

## Decided 2026-10-20 (owner)
- **Security keys:** the owner logs in only with YubiKey 5 keys on firmware 5.7 or newer (owner has ordered two 5.8 keys). Staff may use certified YubiKey 5 (any firmware), the Yubico Security Key series or Google Titan. Applied at the FIDO metadata refresh, due before 2026-11-01.
- **Extra XMR in an escrow (replaces "extra goes to the ad poster"):** before the buyer marks paid and within the offer's limits, the trade grows to the funded amount at the same rate and both sides are shown the new total; a buyer who can't pay cancels and they redo it. Above the offer's maximum, or arriving after "I've paid", the extra goes back to the seller. Every refund returns everything to the seller.

## Open decisions (owner's call)

1. **Fees: decided 2026-10-14.** 1% per completed trade, paid only by the ad poster. Takers never see a fee line.
2. **Legal and jurisdiction.** Get a crypto lawyer before mainnet. The Terms of Service text will come from that lawyer (owner, 2026-10-17: none yet). Designed on the canvas (Getting started, screen 0, placeholder text): a Terms screen at the start of setup that must be scrolled to the bottom before "I accept" works, shown again when the terms change. It has a "Police and government requests" section (lawful warrants answered with the little X2F holds; spec 4.1), to be worded by the lawyer. A jurisdictions brief for the lawyer is in `research/jurisdictions-2026-10.md`. Even non-custodial platforms have been hit (Tornado Cash, the UK FCA warning about LocalCoinSwap).
3. **Moderators:** who they are, how they're paid, deadlines and thresholds.
4. **Buyer deposits: decided 2026-10-17, none.** Plan 3 must drop the deposit (P3-C3/P3-I7 parts, Task 22's DepositFund, `depositFor`, subaddress 1). Done in the Plan 3 text (bf8ce0f, 2026-10-18).
5. **Sanctioned rails** (SBP, Mir, YooMoney). They need a lawyer's sign-off.
6. **Gift cards: decided 2026-10-21, allowed** (Amazon, Uber, Visa/Mastercard prepaid and the most popular others, ~15, research pending). Cash in person and by mail stay; cover what LocalMonero had, minus removals still to be decided.
7. **Price feed sources.**
8. Post an offer: badge requirements are **shown openly** on the form (owner, 2026-10-17). Pricing: market ± % (default) or a fixed price per XMR, with a stale-price warning (owner, 2026-10-17).
9. A seller bond for disputes after refunds? (Deferred.)
10. **Superseded 2026-10-20** by the extra-XMR rule under "Decided 2026-10-20" above (spec 11.1); the 10-confirmation wait for late extra XMR still applies. History: **Extra XMR sent to an escrow goes to the ad poster** at the end of the trade, like a tip (owner, 2026-10-17). The X2F fee stays exact. The exact-amount funding link and QR keep overpaying rare. Late extra XMR: the payout waits until every coin has 10 confirmations (about 20 minutes), then pays everything; no separate time cap (owner, 2026-10-17).

## Next steps, in order

Build status, checked against git on 2026-10-21 (main line: `claude/compassionate-johnson-k95ssr`). The roadmap is `docs/superpowers/plans/2026-10-15-roadmap.md`.

1. **Plan 1 (escrow core): done**, reviewed and approved 2026-10-17 (security review 841f563, `docs/security/plan-1-review.md`).
2. **Plan 2 (accounts and login):**
   - Tasks 1–7: merged.
   - Task 8 (passkeys and security keys): review fixes done, second review pending, on `wip/task8`.
   - Task 9 (TOTP, recovery codes, backup hold): approved and merged (8b82231); review follow-ups on `wip/p2-task9-followups`.
   - Tasks 10, 11, 12, 14, 15: not started. Task 13: skipped (not needed by Plan 3).
3. **Plan 3 (offers and trade flow):**
   - In progress on wip/ branches: Tasks 1–2 (`wip/p3-t1-2`), Task 7 (`wip/p3-t7`), Task 13 (`wip/p3-t13`, half-applied review fixes).
   - Task 11 (node proxy): being built by the second session (`wip/p3-task11`).
   - The rest: not started.
4. **Plans 4–6:** not started.
5. **FIDO metadata refresh before 2026-11-01**, applying the 2026-10-20 security-key rules (depends on Plan 2 Task 8).
6. Design still to do on the canvas: Settings (with Security settings) and FAQ pages; Buy side (mirrors Sell), then the moderator dashboard; bring the desktop view up to date with the phone screens when convenient.
   - **Getting started screens: done 2026-10-14** (canvas row "Getting started"): username, login method, PGP key + challenge, password alternative, optional backup, link a wallet. **Approved by owner 2026-10-17** after these edits: "See the FAQ for recommended PGP apps" link; "no password for a hacker to compromise from us"; X2F never creates PGP keys (FAQ link); login messages signed with the official X2F PGP key; backup screen says funds are never at risk; "Authenticator App (TOTP)"; "newly added wallet addresses" wait 24 h; Settings link on the welcome screen.
7. **Phase 0 passed (GO), 2026-10-14** (`spikes/phase0-browser/RESULTS.md`). Left: iPhone Safari, open internet and Tor, stagenet, and resume-after-background.
8. Verify each payment method against the provider's website, and grow the catalog (second session, `wip/payment-methods-verify`).

## Two sessions

Since 2026-10-21 two Claude sessions work on X2F; see `docs/coordination.md` for assignments and status.
- **Lead:** in the CLI on the owner's machine, in `~/x2f`. It plans, reviews and merges.
- **Second session:** Claude Desktop on the owner's second subscription. It works in its own worktrees under `~/x2f-worktrees/<task>`.
- **Rule R30** (`docs/superpowers/rulings-and-lessons.md`): every agent commits and pushes to its own `wip/<plan>-<task>` branch at each commit and whenever it stops.

## Working with the owner

- Keep updates short. Lead with the decision needed and use few bullets.
- The owner reviews one screen at a time with screenshots and wants precise, honest wording. They push back on anything confusing or over-claimed.
- Do design work **in Claude Design**: X2F App canvas and X2F design system.
- Commit spec changes with the author set: `git -c user.name="flem" -c user.email="bamove@gmail.com" commit`. No global git identity is configured.
- **Security scans run during coding, not just before launch** (owner's instruction): scan every code change with Claude Security and Semgrep, and fix Security Guidance warnings as they appear.
- Plugins installed (user scope in `~/.claude`): superpowers, semgrep (Guardian, account Bamove6969), security-guidance, claude-security, playwright.
- Toolchain on the owner's machine: **Node 24.22.1** (moved from 22 on 2026-10-21), Docker, and Semgrep 1.178.0 (venv at `~/.local/semgrep-venv`). Details in `docs/superpowers/rulings-and-lessons.md` and `docs/dev-setup.md`.

## Unrelated loose ends from this session

- **The owner's Claude account is still signed in on a friend's iPad.** Sign it out under claude.ai → Settings → devices.
- `~/agy-repro` (a throwaway folder) still needs deleting by the owner.
- The cause of the unexplained move of `~/claude-workspace` to `~/Public/claude-workspace` was never found.
- Claude Code was downgraded from 2.1.300 to 2.1.292 by `/restart`, then the update channel was set to "latest". `/upgrade` showed "Login interrupted".

## Decided 2026-10-23 (owner)
- Price feed: the lead picks 3 public XMR price sources that need no account and are reachable over Tor, and the server uses their median. Sources are kept in config and can be changed later. Trading on market offers pauses when the price is stale (> 5 min) or the sources disagree (Plan 3 Task 3). **Every currency gets a market price** (owner, 2026-10-24; spec 11.6): the XMR/USD median times free dollar exchange rates from two keyless sources; screens show the local price and its US-dollar value.
