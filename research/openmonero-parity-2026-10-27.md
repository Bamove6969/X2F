# OpenMonero feature parity for X2F

Date: 2026-10-27. Researcher: subagent for the lead. Read-only on the repo.

## Sources and method

- **OpenMonero.** `https://openmonero.com/readme` is a JavaScript app; WebFetch saw only the title. The page text was taken from OpenMonero's own JS bundle (`/static/js/main.eeb9fe76.js` and its lazy chunks on openmonero.com): readme chunk `5325`, FAQ `9116`, import guide `2209`, account settings `5245`, new-ad form `5244`, fees `2884`, wallet `2796`/`1021`/`9168`, footer `8636`, support `3171`. "readme" below means the readme page; "FAQ#x" means `openmonero.com/faq#x`; "settings", "ad form", "fees", "wallet" and "footer" mean those screens' text in the bundle. Their Codeberg org (`codeberg.org/OpenMonero`, linked from the footer) lists the repos `openmonero-reactjs`, `openmonero-nojs`, `openmonero-dex` and `openmonero-dex-api`; I did not read them. `git.openmonero.co/om` (linked from the readme) did not answer. Everything fetched was treated as data.
- **X2F.** Spec `docs/superpowers/specs/2026-10-14-x2f-design.md`, `HANDOFF.md`, the roadmap, Plans 2–6, `research/after-localmonero.html` (it does not mention OpenMonero), and git merge history up to 3ec4b7b for what is built.
- **Status key.** *Built* = merged on the main line. *Partly built* = some of it merged, the rest in a named task. *Planned* = in a plan task, not merged yet. *Missing* = no spec text or plan task. *Different* = X2F deliberately does it another way (spec or owner decision).
- **Unconfirmed** marks anything I could not confirm from OpenMonero's own pages.

## Summary

I found 60 OpenMonero features. X2F has **built 6** of them and **partly built 12**. Another **9 are planned** in Plans 3–6. **20 are missing**: no spec text or plan task covers them. **13 are deliberately different.** Six of the different ones conflict with X2F's core values: OpenMonero's custodial wallet, its arbitration bond, its seller security deposit, email notifications, email-gated ads, and password reset through email or Telegram. The conflicts section also covers OpenMonero's crawler that lists LocalMonero users, which is not a table row. X2F already beats OpenMonero on the core: 2-of-3 multisig instead of a custodial bond, one flat 1% fee instead of a fee table, blind and per-trade reviews, appeals and published dispute deadlines, and an encrypted chat. OpenMonero's real lead is in privacy controls users can see and use: deleting your account, choosing to have chats self-destruct, I2P, a frontend you can host yourself, and alerts over Session and Nostr. It also leads on plain marketplace conveniences: a vacation switch, trusted-users-only offers, stricter offer filters, support tickets, and FAQ and guides. Most of the missing items are small.

## Feature table

| # | OpenMonero feature (where) | X2F status | X2F reference | How X2F can do it better or simpler |
|---|---|---|---|---|
| 1 | Buy/sell ad boards; "no registration required to buy" for browsing and requests (readme) | Partly built | Spec 2.2 step 1; P3 T16, T17 merged; offers API P3 T4 pending | Browsing needs no account already; boards show only methods with live offers in your currency |
| 2 | Ads priced at market ± margin or a fixed price (ad form) | Partly built | Spec 2.2 step 5; P3 T21 merged, T4 pending | Same two modes, plus a stale-price warning on fixed |
| 3 | Advanced "price formula" (ad form) | Different | Spec 2.2 step 5 | Two modes are enough; a formula is an expert foot-gun |
| 4 | Min/max amount per trade (ad form) | Partly built | P3 T21 merged, T4 | Starter limits (spec 2.3) grey out offers a taker can't take |
| 5 | Limit trades to listed amounts, e.g. "20,50,100", "handy for gift cards" (ad form) | Missing | — | Fits the owner's gift-card decision (spec 11.8); chips on the quote screen |
| 6 | 60+ payment methods, plus "Other" (FAQ#what-is, ad form) | Built | Spec 2.6; P3 T3; `data/payment-methods.json` | Method profiles drive all copy; users can suggest methods; no risk ratings |
| 7 | Short payment detail on the ad (64 chars) and payment info shown during the trade (ad form) | Planned | Spec 2.6 matching fields; P3 T23 BuyerPay | Structured fields (IBAN, Zelle ID) instead of free text; smart proof card checks them (Plan 5 T16) |
| 8 | Ad terms up to 4,096 chars with Markdown (ad form) | Partly built | P3 T4 `terms` | Keep plain text with line breaks: Markdown adds a rendering surface for little gain |
| 9 | ~150 fiat currencies, plus crypto and metals as ad currencies (ad form) | Built (fiat) | Spec 11.6; P3 T3 | Every fiat priced from the XMR/USD median × FX with a fixed trust order; crypto/metals see #49 |
| 10 | Prices refreshed every 10 minutes (FAQ#price-updates) | Built | Spec 11.6; P3 T3 | Median of 3 sources polled every minute; market offers pause on stale prices |
| 11 | Local (cash in person) ads next to online ads; local trades have "no arbitration bond protection by default" (FAQ#protection, ad form) | Partly built | Catalog has "Cash in person"; no meeting-area field | Every X2F trade is in escrow, cash in person too. An optional coarse "area" field would be the only addition |
| 12 | Floating price for local cash: XMR amount set at close (FAQ#floating-price) | Different | Spec 2.2 step 5 (price locks at funding) | Multisig escrow needs a fixed amount; the trade-grows rule (spec 11.1) covers small top-ups |
| 13 | Country on every ad (ad form) | Different | P3 T4 (country only on gift-card offers) | Filter by currency and method instead: less location data |
| 14 | Payment window per method, "I have paid" button (FAQ#havent-confirmed-payment) | Partly built | Spec 2.2 steps 6–8; P3 T2, T25 merged; T23, T24 pending | Timer starts only once escrow is secured; confirm step stops accidental taps; extend twice |
| 15 | Cancel a trade (FAQ) | Partly built | Spec 2.3; P3 T25 merged | Mutual cancel and buyer-alone cancel are co-signed refunds with no penalty |
| 16 | Disputes: "an admin steps into the trade chat", "usually resolved within 24–48 hours" (FAQ#dispute-flow, #seller-didnt-release) | Planned | Spec 2.3, 6.6; P3 T27; Plan 4 T10–T15 | Published deadline, live status, appeal, two-moderator approval above a limit, evidence on record |
| 17 | Online/last-seen on profiles and ads (bundle) | Partly built | P3 T4 `TraderSummary.online/lastSeenAt`; T16 cards | Same |
| 18 | Feedback Positive/Neutral/Negative, one per user pair, "confirmed" only after $100 traded between the pair (FAQ#feedback, #feedback-status) | Planned | Spec 5; Plan 5 T1–T3 | One review per escrow trade, blind reveal, weighted by size: harder to farm, no $100 rule needed |
| 19 | Trade settles to the buyer's own wallet ("self-custodial trade settlement", readme) | Built | Spec 6.4; Plan 1; Plan 2 T12 | Address book, confirm-it's-you, 24-hour wait for weak confirms |
| 20 | Import a LocalMonero profile: import key in LM profile, crawler cache, archive.org, banned accounts with a notice (readme, `/guides/import`) | Planned (different method) | Spec 5.5; Plan 5 T10–T11 | PGP proof against an archived profile; a separate badge that never adds to X2F counts |
| 21 | Import reputation from Localcoinswap, Hodlhodl, Bitvalve, Bitpapa, Paxful, Noones, Agoradesk: trades, score, volume, sign-up date (readme) | Planned (PGP only) | Spec 5.5 "PGP proof only, at first"; Plan 5 T10 | No volume import (spec 5.4 bans volume badges). How OpenMonero verifies these imports: **unconfirmed** |
| 22 | Two-factor TOTP, backup code (FAQ#2fa, settings) | Built | Spec 6.2; Plan 2 T9 | Plus PGP, passkey and security-key login (Plan 2 T7, T8) |
| 23 | Password reset by email, Telegram or PGP signature (settings) | Different | Spec 6.1 step 4, 6.2 backup methods | Optional backup login methods; no reset channel exists to attack |
| 24 | "Security score" in settings: email, Session ID, Telegram, PGP, 2FA, each 0% if missing (settings) | Missing | — (P3 T30 Security settings merged) | A checklist ("Add a backup login") without email/Telegram items and without a gamified score |
| 25 | Delete account: "delete and anonymize all your account data … cannot be undone" (readme intro, settings) | **Missing** | — | Block deletion while a trade or dispute is open; reviews stay anonymized as "Deleted user" |
| 26 | Self-destructing messages: "delete right after the trade" or after 7 days, run at midnight (readme, settings) | **Missing** | Spec 4.1 fixed 90 days; P3 T6, T20 | Let the user choose: right after close, 7 days or 90 days. Keep during disputes and the dispute-after-refund window |
| 27 | Chat kept encrypted on servers, deleted after 180 days (FAQ#kyc-traders) | Partly built | Spec 4.1, 6.5; P3 T20 parts merged | End-to-end encrypted (buyer, seller, moderator key); 90 days |
| 28 | Watermark on photos sent in chat "to prevent misuse" (FAQ#kyc-traders) | Missing | Plan 5 T13 image pipeline | Add a faint "X2F trade <code> only" stamp in the on-device pipeline, after blur |
| 29 | Browser web notifications (FAQ#web-notifications) | Planned | Spec 1, 2.4; P3 T19 Web Push | Push text is generic ("Something changed in a trade on X2F") |
| 30 | Session bot and Nostr bot for trade alerts (E2EE) (readme "New notification updates") | Missing | — | Optional, off by default. Needs a stored Session ID/Nostr key (an identifier): owner decision |
| 31 | Per-event email notification toggles (new trade, payment, release, message, support) (settings) | Missing (per event) | P3 T19 | Per-event toggles on push and in-app alerts, no email |
| 32 | Android app, direct `.apk` download (readme, FAQ#telegram-notifications) | Planned | Spec 1; Plan 6 T20, T22 | Reproducible, signed APK and F-Droid |
| 33 | Tor hidden service (readme, FAQ#onion) | Planned | Spec 4.1; Plan 6 T3, T4 | WebAuthn on the onion origin too; Tor built into native apps |
| 34 | I2P sites: `openmonero.i2p` and a b32 address (readme, FAQ#i2p) | Missing | — | Mirror the onion setup (Plan 6 T3) |
| 35 | No-JS version (footer link; `openmonero-nojs` repo) | Different | Plan 6 T13 noscript notice | In-browser escrow signing needs JS. A no-JS read-only board is possible later |
| 36 | Self-hostable frontend, "wget …/Dockerfile", visit localhost, optional via Tor (readme) | Missing | Plan 6 T14 (reproducible build, signed manifest) | Ship the signed web build as a local bundle. It defends against tampered server code (spec 6.5's main risk). Passkeys are origin-bound, so PGP login there |
| 37 | "No analytics. period." and no Cloudflare (readme) | Built (no analytics); Planned (own proxy) | Spec 4.1, 6.5; P3 T13 CSP; Plan 6 T2 | Enforced by CSP and no third-party scripts. **Note:** openmonero.com's own HTML loads `umami.openmonero.co/script.js` (self-hosted Umami analytics), which contradicts its claim |
| 38 | "LE requests are automatically sent to our spam folder" (readme) | Different | Spec 4.1 | Lawful warrants answered with the little X2F holds; storing little is the protection (lawyer) |
| 39 | Ad restriction: trusted users only (ad form) | Missing | — | Private trust list per trader; never shown publicly |
| 40 | Ad restriction: minimum feedback score 0–100 (ad form) | Missing | P3 T4 has only `minTrades` | Add a minimum % positive once Plan 5 scores exist |
| 41 | Ad restriction: cap for users you haven't traded with (ad form) | Missing (per ad) | Spec 2.3 starter limits are site-wide | A per-offer "first trade with me up to $X" |
| 42 | Ad restriction: verified email only (ad form) | Different (conflict) | Spec 4.1 | Use minimum completed trades or badges instead |
| 43 | Buying and selling vacation: hides all your ads (settings) | Partly built | P3 T4 per-offer pause | One "Pause all my offers" switch |
| 44 | Block user (bundle) | Partly built | P3 T26 `POST /v1/account/blocks` (blocks nudges only) | Extend a block to hide your offers from them and refuse their takes and chats |
| 45 | Public profile intro (Markdown, 64k chars), Telegram/PGP shown (settings) | Missing (intro) | Plan 5 T5, T12 profiles | A short plain-text intro, with a warning not to post contact details |
| 46 | Support tickets, live support chat, email, XMPP, Session, Nostr contacts (readme, support page) | Missing | Spec 6.6 Helper role; no Plan 4 task | An in-app ticket thread worked by Helpers, logged like disputes |
| 47 | Community Session group and Telegram group (readme) | Missing (parked) | `docs/community-room-plan.md` | Keep parked until after launch |
| 48 | Security bug bounty (footer) | Planned | Spec 6.5; Plan 6 T24 | Plus `security.txt` |
| 49 | XMR traded against BTC, LTC and other coins; metal ounces (ad form, BTC wallet) | Different | Spec 1 ("X" = XMR today, any coin later) | Out of scope until launch |
| 50 | Fees: maker 0.1–1.6%, taker 0.5–5.5%, plus a $0.5–$39 buyer service fee (fees page) | Different | Spec 11.1 | Flat 1% from the ad poster only; takers pay nothing |
| 51 | Sponsored ads, cheaper maker fee (fees page, footer) | Missing (not recommended) | — | Paid placement undercuts reputation-based ranking |
| 52 | Market statistics page `/markets` (footer) | Missing | — | Only aggregate, delayed counts per method/currency, if at all |
| 53 | Warrant canary `canary.txt` (footer) | Missing | — | Signed with the X2F PGP key; wording by the lawyer |
| 54 | Published PGP keys `pgp_keys.asc` (footer) | Partly built | Spec 6.2; Plan 2 T7 signs login messages | Publish the fingerprint on site and in the FAQ (spec 6.2) |
| 55 | FAQ and guides: how to buy and sell, cash-by-mail safety, buying anonymously, 2FA, encrypted email (footer, guides) | Missing | HANDOFF next steps: FAQ design pending; no plan task | Short in-app help next to each step; PGP-apps guide (spec 6.2) |
| 56 | Open-source code on Codeberg (footer) | Missing (owner decision) | Plan 6 T14, T22 (reproducible builds) | Reproducible builds are worth most if the source is public |
| 57 | Custodial OpenMonero wallet: deposit, send, receive, free transfers between users; BTC wallet too (FAQ#how-to-receive, wallet) | Different (conflict) | Spec 1 principle 1, 6.4 | No wallet; `monero:` links into the user's own wallet |
| 58 | Arbitration bond reserved from the seller's OpenMonero wallet (FAQ#protection) | Different (conflict) | Spec 3.1; Plan 1 | 2-of-3 multisig per trade; X2F holds one key |
| 59 | "Self-custodial trade funding": a 0.35 XMR seller security deposit, bonds "from completely separate wallets" (readme) | Different (conflict) | Spec 2.5, 3 | Seller funds the escrow per trade from any wallet; no standing deposit |
| 60 | PGP-encrypted email notifications and an option to strip sensitive details (readme, settings) | Different (conflict) | Spec 4.1, 6.3 | Generic push and in-app alerts, with no email stored |

Not counted above: OpenMonero's "openmonero-dex" and "-dex-api" repos (what they do is **unconfirmed**), and the "Switch to non-custodial wallet" link on its wallet page (what it does is **unconfirmed**). Its FAQ says traders may ask for ID; X2F only lets reviewers tag "Asked for ID" (spec 5.1), which is a choice about trader conduct, not a platform feature.

## Conflicts with X2F's core values (do not adopt)

1. **Custodial wallet and free transfers between users (#57).** OpenMonero holds user XMR (and BTC) and moves it between accounts. That breaks *non-custodial* and *no built-in wallet*: a server breach could move funds. **Closest acceptable alternative:** X2F's address book plus `monero:` links that open the user's own wallet (spec 6.4).
2. **Arbitration bond held by the platform (#58).** OpenMonero reserves the trade amount from the seller's OpenMonero wallet, so OpenMonero alone can "direct" it. That is custody. **Alternative:** the per-trade 2-of-3 multisig escrow X2F already has, where the moderator key alone cannot spend (spec 3.1).
3. **Standing seller security deposit (#59).** The 0.35 XMR minimum deposit sits with the platform to cut spam offers. That is custody too. **Alternative:** stop offer spam with starter limits, per-account offer caps and rate limits (spec 2.3), not money held by X2F.
4. **Email notifications, email-gated ads and email reset (#60, #42, #23).** Each needs an email address, which X2F never stores (spec 4.1, 6.3). Even PGP-encrypted, an email address identifies a person and leaks who trades when. **Alternative:** generic Web Push and in-app alerts (P3 T19), backup login methods, and minimum-trades or badge requirements on offers.
5. **Telegram for reset or alerts (#23; dropped by OpenMonero itself).** Telegram ties to a phone number, which X2F never wants. **Alternative:** if the owner wants off-app alerts, optional Session or Nostr bots (#30). They need only a pseudonymous identifier, but X2F would still store it, so it is the owner's call.
6. **Crawler-cached list of LocalMonero users (`/guides/import#cachedUserList`).** OpenMonero publishes usernames and "last seen" of people who never joined it. That breaks *share only the bare minimum* and *no tracking*. **Alternative:** the Plan 5 PGP-proof claim, started by the user, checked by a moderator, with no scraping.
7. **Analytics despite the claim (#37).** openmonero.com loads a self-hosted Umami script while saying "No analytics. period." X2F must stay with zero analytics, enforced by CSP (P3 T13). This is a warning not to copy, not a feature.

Not values conflicts, but rejected on other grounds: "LE requests to spam" (#38) is a legal risk the lawyer owns, and the floating price (#12) and price formula (#3) don't fit fixed-amount multisig or the "simple on the surface" rule.

## Missing items ranked by user value

All 20 missing rows, plus two gaps in partly built rows (ranks 5 and 6).

| Rank | Item (row) | Fits plan | Size | Suggestion |
|---|---|---|---|---|
| 1 | Delete account and anonymize data (#25) | 5 (touches reviews and profiles) | M | Refuse while a trade or dispute is open; reviews show as "Deleted user"; retention jobs still run |
| 2 | User-chosen chat self-destruct (#26) | 5 (with proof retention, T14) | S–M | Right after close, 7 days or 90 days; held while a dispute or the after-refund dispute window is open |
| 3 | FAQ and guides (#55) | 3 (screen) or 6 (launch content, T25) | M | PGP apps, funding from each wallet, cash-by-mail safety, what moderators can see |
| 4 | Support tickets for Helpers (#46) | 4 | M | Ticket thread in the staff app, logged; no evidence access (spec 6.6) |
| 5 | Full block: hide offers, refuse takes and chats (#44) | 3 (extends T26 blocks) | S | Silent, like nudge drops (P3-M5) |
| 6 | Pause all my offers / vacation (#43) | 3 (T4 follow-up) | S | One switch in Settings |
| 7 | Offer filters: minimum % positive, first-trade cap, listed amounts (#40, #41, #5) | 5 (score), 3 (amounts) | S each | Listed amounts help the gift-card launch |
| 8 | Trusted-users-only offers (#39) | 5 | S–M | Private trust list per trader |
| 9 | Self-hostable, verifiable frontend (#36) | 6 (with T14) | M | Signed local bundle; PGP login; docs for Tor |
| 10 | I2P access (#34) | 6 (next to T3) | M | Same app, I2P origin |
| 11 | Warrant canary (#53) | 6 | S | Signed, dated, lawyer-worded |
| 12 | Watermark on uploaded images (#28) | 5 (T13) | S | Stamp after blur, on the device |
| 13 | Security checklist (#24) | 3 (T30 follow-up) | S | No score, no email or Telegram items |
| 14 | Per-event alert toggles (#31) | 3 (T19) | S | Push stays generic |
| 15 | Session/Nostr alerts (#30) | 6 | M | Owner decision first (stored identifier) |
| 16 | Profile intro text (#45) | 5 (T12) | S | Plain text, length-capped |
| 17 | Public source code (#56) | 6 | S (decision) | Owner decision; pairs with reproducible builds |
| 18 | Aggregate market stats (#52) | after launch | S–M | Delayed, coarse, no per-user volume |
| 19 | Community room (#47) | after launch | M | Already parked |
| 20 | Sponsored offers (#51) | — | — | Recommend not adopting |
