# Plan 5: Reputation and safety extras — Implementation Plan (DRAFT for owner approval)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: DRAFT, 2026-10-24.** Nothing is built from this plan until the owner approves it and answers (or accepts the defaults of) the "Assumptions" below.

**Goal:** Traders rate each completed trade with blind reveal; profiles show honest stats and earned, privacy-safe badges the trader controls; traders can prove past standing on other sites with a PGP signature checked by a moderator; buyers attach payment proof that is stripped of metadata and blurred on their own device, sellers get a smart proof card, and moderators can ask for the unblurred copy, which only they can read.

**Architecture:**
- **`packages/reputation` (`@x2f/reputation`)**: pure rules shared by API and web: review validation, the reveal rule, weights, stats, the badge catalogue, earning rules and visibility.
- **`packages/proof` (`@x2f/proof`)**: pure, Node-testable proof logic: the sensitive-text detector over OCR words, irreversible redaction on raw RGBA pixels, PNG/JPEG metadata cleaners with an allowlist check, the smart-proof check, and proof encryption (libsodium, already pinned).
- **`apps/api`**: reviews, stats, profiles, badge settings, platform feedback, portable record, past-reputation claims and encrypted proof storage. The API stores **ciphertext only** for proofs and never sees an image.
- **`apps/web`**: the browser image pipeline (decode, OCR in a same-origin worker, redact, re-encode, clean, encrypt), the blur editor, review cards, profile and badge screens. Proof keys travel inside Plan 3's sealed chat envelopes.
- **`apps/moderation`** reads proofs sealed to the moderator; **`apps/staff-web`** (Plan 4) gets the past-reputation queue, a feedback list, and the proof card on ModCase.

**Tech Stack:** Node 24.22.1, npm 11.21.0 (`npx -y npm@11.21.0`), TypeScript 7.0.2 strict, vitest 5.0.3, fastify 5.12.x (R31), pg 8.23.1, openpgp 6.3.2, libsodium-wrappers 0.8.4, React 19.3.0, Vite (as pinned by Plan 3), @playwright/test 1.63.0, lucide-react 1.49.0, Semgrep 1.178.0. **New dependencies (three, all in `apps/web` only; openpgp 6.3.2 is also added to `apps/web`, but it is already pinned in the tree):**

| Package | Version | Published | Licence | Why |
|---|---|---|---|---|
| `tesseract.js` | 7.0.0 | 2025-12-15 | Apache-2.0 | On-device OCR for automatic blur (spec 4.2) and the smart proof card |
| `tesseract.js-core` | 7.0.0 | 2025-12-15 | Apache-2.0 | The WASM engine `tesseract.js` loads; pinned exactly and by `overrides` |
| `@tesseract.js-data/eng` | 1.0.0 | 2023-09-04 | MIT | The English model, self-hosted (never fetched from a CDN) |

All three pass the 14-day rule (checked 2026-10-24 with `npx -y npm@11.21.0 view <pkg> time --json`). `tesseract.js` has an install script (`opencollective-postinstall`); the repo's `.npmrc` has `ignore-scripts=true`, which stays. Re-check the dates and `npm audit --omit=dev` at Task 13 before installing.

**Transitive packages (review 2026-10-24).** "Three" is the direct count. `tesseract.js` 7.0.0 also pulls in nine packages through caret ranges, and each must pass the 14-day rule at the version the lockfile resolves to. Checked against the registry on 2026-10-24 (cutoff 2026-10-10), all pass:
- `node-fetch` 2.7.0 (2023-08-23), which brings `whatwg-url` 5.0.0 (2017), `tr46` 0.0.3 (2016) and `webidl-conversions` 3.0.1 (2016);
- `idb-keyval` 6.3.0 (2026-07-08);
- `wasm-feature-detect` 1.9.0 (2026-08-11);
- `regenerator-runtime` 0.13.11 (2022);
- `is-url` 1.2.4 (2018), `bmp-js` 0.1.0 (2018), `zlibjs` 0.3.1 (2017);
- `opencollective-postinstall` 2.0.3 (2020), whose script never runs.

Task 13 Step 3 lists the resolved tree (`npm ls --all tesseract.js`) in the commit message. If any resolved version is newer than 14 days, stop and report. `node-fetch` and `bmp-js` are only used by the Node build and never reach the browser bundle; Task 13's bundle check confirms this.

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md`: 1 (mission: share the bare minimum; principles 2 and 3), 2.2 step 7 (optional proof and its nudge) and step 11 (review), 2.3 (starter limits, New badge until Graduated; trading hold), 4.1 (data rules, retention, no IP logs, no email or phone), 4.2 (proof uploads), 5 (all), 6.2 (PGP key rules, R16), 6.5, 6.6 (unblurred proof request, activity log, training library), 7 screen 3, 9. **Boards:** Claude Design **X2F App**, mirrored in `design/x2f-app/`: `Review`, `Profile`, `BadgeSettings`, `SellOffers` (badges and `+N`), `BuyerPay` (proof slot), `SellerConfirm` (smart proof card), `DisputeOpen` (Add more evidence), `DisputeRoom` (unblurred request), `ModCase` (proof card). **Builds on:** Plans 1–3 (as built and as revised through 2026-10-24) and Plan 4 (interfaces below).

> **Lead note 2026-10-24:** the display-name / login-name split (spec 6.1) is owned by the Plan 2 follow-up FU-A (branch `wip/lead-p2-fua`, migration 009, renaming `username` to `display_name` and adding `login_name`). It merges before Plan 5 starts. Plans 3 and 4 then switch `username` to `display_name`.

## Revision 2026-11-09 (owner)

Source: owner-decisions-2026-11-06.md (page 11, answers 17-40) and the owner's answers register of 2026-11-09. Where this list differs from older text, this list wins.

- **Fast badge (owner p11-20):** earned after 30 payments sent in under half the time allowed to pay (replaces "usually pays or releases within 10 minutes" and the lead default "median of both lists"). Lead reading, to confirm: the clock stops at the "I've paid" tap.

## Global Constraints

- **Share the bare minimum (spec 1).** No route returns a login name, email, phone, IP, payout address, trade amount sum, or anything inside a PGP key other than its fingerprint. Profiles are keyed by the **display name** only (spec 6.1, owner 2026-10-23).
- **No volume badges, no volume stats (spec 5.4).** No badge, stat, record or route exposes how much money a trader has moved. Per-review USD values are used only inside the weight maths and are never returned.
- **Badges are earned, never set (spec 5.4).** Badges are computed from records on every read. No route, setting or row can grant one; the only badge write is visibility.
- **New is a warning, not an achievement (spec 2.3, 5.4).** It is shown while the account is not Graduated (`tradeCap(...).stage !== 'graduated'`), always Featured, and cannot be hidden or moved.
- **Blind reveal (spec 5.3).** Until a review is revealed, nothing derived from it changes anywhere a counterparty can see: not the review, not `positivePct`, not `reviewCount`, not a badge, not offer sorting.
- **Past reputation never adds to X2F numbers (spec 5.5).** It never changes completed trades, % positive, milestones, Trusted, Clean record or starter limits.
- **Proof images never leave the device unprocessed (spec 4.2).** Every proof byte the client encrypts has passed `cleanImage` and `assertClean` (only image-data chunks or segments survive) and has been re-encoded from decoded pixels. The original file name and type are never sent. The API stores only ciphertext and cannot decrypt it.
- **Blur is irreversible.** A blurred region's output pixels depend only on that region's mean colour and a fixed pattern, never on the original glyphs. The upload screen says plainly that automatic blur is best-effort (BuyerPay board copy).
- **The unblurred copy is sealed to the moderator only** (Plan 1 `seal` with `to: ['mod']`), is uploaded only after a logged moderator request (Plan 4), and its ciphertext is served only to `apps/moderation`, never to a trader.
- **OCR runs on the device, from this origin.** `tesseract.js` worker, core and model are served from `apps/web` with `workerBlobURL: false`; no request to any other origin. The Plan 3 page CSP is unchanged: images render as `data:` URLs, which `img-src 'self' data:` already allows.
  - **The worker's own CSP (review 2026-10-24).** A dedicated worker loaded from a URL takes its CSP from **its own response**, not from the page. `serve.ts` sends the CSP only on HTML, so without a change the OCR worker would run with no CSP at all, and a network fallback (`tesseract.js` has jsdelivr defaults built in) would not be blocked. Task 13 therefore sends `content-security-policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'` on every `/ocr/*` response.
  - **Integrity.** The OCR files are checked against SHA-256 values checked into the repo (Task 13), not only against `node_modules`.
- **PGP (spec 6.2, R16).** openpgp 6.3.2 with Plan 2's strict config. Anything inside a key other than its fingerprint is never shown, logged, searched or exported. Expired and revoked keys are refused with the reason.
- **Privacy (spec 4.1).** No IP stored or logged. Logs never contain trade codes, display names, review notes, feedback notes, fingerprints, URLs or proof ids. `disableRequestLogging: true`, `trustProxy` never set. Proofs follow chat retention (90 days after close; disputed: 30 days after the dispute closes, Plan 4 R6). Training copies never include proof images.
- Every dependency is pinned exactly and was published at least 14 days before it is installed. `npm audit --omit=dev` reports 0 (R31/R33 exceptions apply until their dates). `npm run check` passes at the end of every task (queued through `~/x2f-comms/run-check.sh`, R32). Tests run as `npm test -- --project <workspace>`.
- Migrations are numbered `3xx`, one per task that needs schema. Every module takes `clock: () => Date`; no `new Date()` in logic.
- Every new refusal code joins Plan 2's `ApiErrorCode` and is thrown as `ApiError`.
- **UI.** Copy verbatim from the boards; spec wording where no board exists; anything else is marked `// COPY-UNSIGNED` for the owner. Night theme first, exactly one `data-primary` per screen, teal badge pills (amber for New), no emoji, no exclamation marks, display names rendered exactly as set. `expectParity` at 390×844 (and 1280×800 for trade-room screens). Never run Playwright with `--update-snapshots`.
- Code from agy-delegated agents is merged only after Semgrep, the Security Guidance hook and a code-review plugin have checked it.

## Assumptions (owner has not decided yet; each is used only through the named constant or setting)

Each line is a default this plan builds so work can proceed; the owner confirms or changes it before Task 18.

**Reviews and stats**
- **P5-A1 What counts as positive.** 4–5 stars positive, 1–2 negative; 3 stars and **Neutral** count toward `reviewCount` but not toward % positive. `POSITIVE_MIN_STARS = 4`, `NEGATIVE_MAX_STARS = 2`.
- **P5-A2 "Larger trades carry more weight" (spec 5.3).** `reviewWeight(usdCents) = clamp(usdCents, REVIEW_WEIGHT_FLOOR_USD_CENTS = 1_000, REVIEW_WEIGHT_CAP_USD_CENTS = 100_000)`: a $500 trade counts 50 times a $10 trade; above $1,000 they count the same. % positive = Σweight(positive) / Σweight(positive + negative), rounded down to a whole percent.
- **P5-A3 Which trades get a review.** Reviewable: `released` trades, and disputed trades once the dispute is closed, whatever the outcome (spec 5.3). Not reviewable: mutual cancel, buyer cancel, no-show refund and lapse without a dispute ("real trades only"). `REVIEWABLE = ['released', 'dispute-closed']`.
- **P5-A4 "Cannot start their next trade" (spec 5.1).** Every reviewable trade without this trader's review blocks them from taking an offer and from being taken as a poster. Offers of a poster with a pending review are left out of `GET /v1/offers` until they rate (so takers are never stranded). Posting an offer is still allowed.
- **P5-A5 Reveal clock.** The 7 days (`REVEAL_AFTER_DAYS = 7`) start when the trade became reviewable: `closed_at` for a release, the dispute's close for a disputed trade.
- **P5-A6 Note.** One line, at most `REVIEW_NOTE_MAX = 120` characters, no line breaks. A note that `detectSensitiveText` flags (email, phone, card, IBAN, account number, Monero address) is refused with "Remove personal details from the note." `// COPY-UNSIGNED`. Reviews are final once submitted (no edit, no delete).
- **P5-A7 Phrase wording.** Spec 5.1 says "Fast payment"; the Review board says "Fast release". Default: the phrase follows the reviewer's counterparty role: "Fast payment" when rating a buyer, "Fast release" when rating a seller. The other seven phrases are as in spec 5.1.
- **P5-A8 Typical time (spec 5.4 "typical release time"; boards "typical payment time", "Pays in ~6 min").** `typicalMinutes` = the median of the trader's own action times over their last `TYPICAL_WINDOW = 20` completed trades: as buyer, `paidAt − securedAt` (0 when paid before secured); as seller, the `release-started` event time `− paidAt`. `null` below `TYPICAL_MIN_SAMPLES = 3`. Profile label follows the board ("typical payment time") for now; the owner picks the final words.
- **P5-A9 Cancel rate.** Trades this trader ended alone (buyer cancel) or by proposing an accepted mutual cancel, divided by their trades that reached `funding`. `null` below 5 such trades. Shown neutrally, never as a warning (spec 2.3).
- **P5-A10 Profile review list.** Latest `PROFILE_REVIEWS = 20` revealed reviews: stars or Neutral, phrases, note, method name and a coarse age (~~"2 days ago", "3 weeks ago", "Mar 2026"~~ *2026-10-29b lead default: month and year only, "Mar 2026"*), never the reviewer, amount or exact time.

**Badges**
- **P5-A11 New and the 2 Featured slots.** New takes one of the 2 Featured slots, so a New account can feature one more badge.
- **P5-A12 Families.** Only the highest trade milestone (10, 50, 100, 500, 1,000) and the highest Veteran step (1, 3, 5 years) are earned at once. Labels: "10 trades" … "1,000 trades" (board), "Veteran", "Veteran · 3 years", "Veteran · 5 years" `// COPY-UNSIGNED`.
- **P5-A13 Thresholds not in the spec.** Fast: ~~`typicalMinutes ≤ 10` with at least `FAST_MIN_SAMPLES = 5`~~ *(replaced 2026-11-09, owner p11-20: 30 payments sent in under half the time allowed to pay; lead reading, to confirm: measured to the "I've paid" tap)*. Clean record: ≥ 100 completed trades and **zero** lost disputes ever. Milestones and Trusted count `completedTrades` = released trades (the spec's stat), not the starter-limit count.
- **P5-A14 Security key verified.** Earned with any `webauthn_credentials.kind = 'security-key'`. Trader keys are registered with `attestationType: 'none'` (Plan 2), so X2F cannot prove the key is hardware. Requiring attestation would tell X2F the key's make and model (a privacy cost). Owner to choose.
- **P5-A15 After the first choice.** Once a trader has saved badge choices, newly earned badges start On hover. A Featured badge that is lost frees its slot; nothing is promoted automatically.
- **P5-A16 Icons not named by the spec.** Milestones `Trophy`, Clean record `BadgeCheck`, Past reputation `History` (lucide). Spec icons: New `Sprout`, Trusted `ShieldCheck`, Fast `Zap`, Veteran `Star`, PGP `KeyRound`, Security key `Usb`.
- **P5-A17 PGP line on the profile.** The board's "Account protected with PGP" line shows only when the PGP badge is not Hidden, so hiding the badge hides the fact.

**Portable reputation and feedback**
- **P5-A18 Record contents and signer.** X2F cannot sign with the user's key, so the record is an OpenPGP cleartext message signed with **X2F's official PGP key** (Plan 2 R7), listing: display name, member-since month, issue date, completed trades, % positive and review count, the account's PGP fingerprints, and one line per completed trade with month, role, stars and phrases (no amounts, methods, counterparties or notes). PGP users are told how to add their own signature in their PGP app. Private by default; "Show on my profile" (`portable_public`) exposes it at `/u/:name/record`.
- **P5-A19 Feedback.** Shown after the 1st completed trade and when `completedTrades % FEEDBACK_EVERY === 0` (`FEEDBACK_EVERY = 10`). Stored as `{ mood, note ≤ 500, created_on: date }` with no account id; at most 3 per account per day (in memory only). Only the owner reads it (new perm `feedback.read`). Deleted after `FEEDBACK_RETENTION_DAYS = 365`.

**Past reputation (spec 5.5)**
- **P5-A20 Evidence links.** Must be `https` on `PAST_REP_ARCHIVE_HOSTS = ['web.archive.org', 'archive.ph', 'archive.today', 'archive.is']`, for a profile or a forum post alike. X2F's servers never fetch the link; the moderator opens it in their own browser.
- **P5-A21 Sites.** `PAST_REP_SITES = ['LocalMonero', 'AgoraDesk', 'LocalBitcoins', 'Paxful', 'Hodl Hodl', 'Bisq', 'Other']`; at most one approved claim per site per account.
- **P5-A22 Old keys.** Accept RSA ≥ `PAST_REP_MIN_RSA_BITS = 2048` (login needs 4096; many 2017–2024 keys are 2048), Ed25519 and Ed448; refuse DSA, ElGamal-only and others. Expired keys must be extended by their owner first; revoked keys are refused.
- **P5-A23 Full fingerprint.** The moderator approves only when the archive shows the **full** fingerprint (a 16-hex key ID can be forged). `PAST_REP_REQUIRE_FULL_FINGERPRINT = true`.
- **P5-A24 Approval.** Any moderator, senior moderator or owner (new perm `reputation.review`), logged, no key tap. The moderator records the trade count they saw; the badge shows that number. A fingerprint can back one account only. The trader can remove the badge; a senior or owner can revoke it (logged). Rejected claims are deleted after 30 days.

**Proofs (spec 4.2)**
- **P5-A25 Limits.** Input ≤ `PROOF_MAX_INPUT_BYTES = 20 MiB`; decoded size ≤ `PROOF_MAX_DECODED_PIXELS = 40_000_000`; output scaled to longest side ≤ `PROOF_MAX_SIDE = 2600` px; ciphertext ≤ `PROOF_MAX_CIPHERTEXT = 4 MiB` (PNG, falling back to JPEG quality 0.85 when PNG is too big); `PROOF_MAX_PER_SIDE = 5` per trade. Accepted inputs: PNG, JPEG, WebP, and HEIC only where the browser decodes it.
- **P5-A26 Blur look.** A blurred region is drawn as a frosted solid patch (mean colour plus a fixed texture), not a see-through blur, because a light blur or pixelation can be undone. Owner/design to approve the look.
- **P5-A27 OCR languages.** `PROOF_OCR_LANGS = ['eng']` at launch (Latin script; digits, emails and IBANs work in any Latin-script language).
- **P5-A28 Name check (spec 4.2 "a name that doesn't match the buyer").** X2F holds no real names, so there is nothing to match against. The card says only whether a sender name is hidden ("Sender name hidden by <buyer>", board) or visible ("Shows a sender name. Check it matches the sender in your bank." `// COPY-UNSIGNED`).
- **P5-A29 Keeping the original for an unblurred request.** The buyer's app keeps the metadata-stripped, **unblurred** image in its own IndexedDB until the trade closes with no dispute possible (or 90 days after a refund, P3 `disputeAfterRefundDays`), then deletes it. If it is gone (other device, cleared storage), the buyer picks the screenshot again; it goes through the same stripping.
- **P5-A30 Dispute evidence.** "Add more evidence" (DisputeOpen) is available to both sides while a dispute is open, through the same pipeline, sealed to buyer, seller and moderator like the proof.

**Added by the plan review (2026-10-24): owner questions. These are not decided; each default below keeps the draft as written.**
- **P5-A31 Late reviews after the 7-day reveal (revenge reviews).** Under P5-A4/A5, a trader who stays silent sees the other side's review on day 7. The pending-review gate then makes them rate before their next trade, so they rate *after* reading it. That is the revenge review spec 5.3 is meant to stop. Options:
  - (a) after the reveal, a late reviewer may only submit Neutral, which clears the gate;
  - (b) the review window closes at reveal and the trade stops blocking;
  - (c) keep as drafted.

  Default: (c), until the owner picks. Task 3 reads the choice from `LATE_REVIEW = 'any' | 'neutral-only' | 'closed'`.
- **P5-A32 Weighted % positive can reveal trade sizes.** With weights proportional to USD (P5-A2), the change in a profile's % positive after one reveal reveals that review's weight relative to the others. Anyone who knows one of the trades (the counterparty, or someone watching a trader with few reviews) can then work out the approximate size of other trades. That conflicts with "no volume stats" (spec 5.4). Options:
  - (a) a few weight steps (for example 1× under $100, 2× to $500, 3× above);
  - (b) show % positive only from `PCT_MIN_REVIEWS = 5` reviews;
  - (c) both;
  - (d) keep as drafted.

  Default: (d), until the owner picks. Each option is a constant in Task 1.
- **P5-A33 Repeated reviews from one counterparty.** Two colluding accounts (or one person's two accounts) can trade back and forth so that one of them collects many 5-star reviews. Option: only the latest review from each distinct counterparty counts toward % positive and Trusted (`REVIEWS_PER_COUNTERPARTY = 1`). Default: count every review, as spec 5.3 says.
- **P5-A34 Who sees `online` and `lastSeenAt`.** `GET /v1/traders/:name` needs no session and works for **any** display name, including accounts that have never posted an offer. Anyone can poll it to track when a named person is active. Options:
  - (a) profiles only for accounts with at least one live offer or one completed trade;
  - (b) `lastSeenAt` rounded to the hour (or "today" / "this week");
  - (c) both;
  - (d) keep as drafted.

  Default: (d), until the owner picks. Per-source rate limits in front of the API are Plan 6.
- **P5-A35 PGP fingerprints in the portable record.** P5-A18 lists the account's PGP fingerprints. Once the record is public (`portable_public`), anyone can link the X2F name to that key, and from the key to its user IDs and email on keyservers. It also reveals that the fingerprint logs in to X2F, which spec 6.2 deliberately hides. Default: list the fingerprints only when the trader ticks "Include my PGP fingerprint" at export (off by default), and never on the public `/record` copy. **Owner to confirm.**
- **P5-A36 Proof card on ModCase needs WebAssembly on the staff origin.** Plan 4 gives staff-web Plan 3's CSP minus `'wasm-unsafe-eval'`, and Tesseract cannot run under that. Options:
  - (a) add `'wasm-unsafe-eval'` and `worker-src 'self'` to the staff-web CSP, and serve `/ocr/*` from staff-web too;
  - (b) ModCase shows the blurred image with no automatic check.

  Default: (b), until the owner (or lead) picks, because (a) widens the staff app's attack surface.

## Interfaces assumed from Plans 2–4 (reconcile here only)

**Plan 2 (as built):** `requireSession`, `ApiError`, `Deps { config; db; clock }`, `pgp_keys(account_id, fingerprint, …)`, `webauthn_credentials(kind, attested, …)`, `inspectPublicKey(armored, now)` (Plan 5 adds an optional third argument `{ minRsaBits?: number; requireEncryption?: boolean }`, defaults 4096 and true, so login is unchanged), `storableKey(armored, now)`, `sealKey` / `openKey`, `PgpSigner` from `loadPgpSigner` (X2F's official key), `GET /v1/pgp/signing-key`.

**Plan 3:**
- `trades` row with `closedAt`, `securedAt`, `paidAt`, `state`, `sellerId`, `buyerId`, `methodId`, `poster`; `trade_events` (`release-started`, `buyer-cancel`, `accept-cancel` with `by`); `usdCentsOf(trade): bigint`.
  - **Review 2026-10-24:** Plan 3 does not define `usdCentsOf`. Its starter-limit revision computes "the USD equivalent at the locked rate" at take, but does not say it is stored.
  - If no stored USD value exists when Task 3 starts, Task 3 adds `trades.usd_cents bigint` and fills it in the take transaction, from the same value the cap check used. Trades taken before the migration get `null` and weight `REVIEW_WEIGHT_FLOOR_USD_CENTS`.
  - Plan 5 never converts using today's rate.
- `TraderSummary.username` (Plan 3) becomes `displayName` when the spec 6.1 split lands (see "Spec 6.1 display name" below); Plan 5 never adds a login name to it.
- `tradeCap(deps, accountId, now) → { stage: 'starter'|'building'|'graduated'; capUsd; maxOpen }` (Revision 2026-10-24).
- `POST /v1/offers/:id/take`, `POST /v1/trades/:code/wallet`, `GET /v1/offers` in `apps/api/src/offers/routes.ts`; `traderSummary` in `apps/api/src/traders/summary.ts`, whose `TraderSummary.badges: string[]` **becomes** `{ featured: BadgeView[]; more: BadgeView[] }` and whose `positivePct`, `typicalMinutes` Plan 5 fills.
- Chat: `chats`, `chat_envelopes`, `POST /v1/chats/:chat/envelopes` (≤ 16 KiB), the chat for a trade (`chatOf(code)`), `seal`/`open` with `to: Role[]`, `ChatPanel` system cards.
- Internal listener `/internal/v1/*`, requests signed by the moderation key (Task 8); `startRetention` / `purgeChats`; SSE `publish`.
- Web: `api()`, UI kit (`BadgePill`, `Sheet`, `Button`, `ExternalLink`), `OfferCard`, `AcceptedSheet`, `BuyerPay`, `PaidConfirmSheet`, `SellerConfirm`, `Released`, `TradeRoom`, `expectParity`, `apps/web/e2e/stack.ts`, `VITE_FIXTURES`.

**Plan 4:**
- `@x2f/staff` `Perm` / `can` and the privilege-matrix test: Plan 5 adds `reputation.review` (owner, senior, mod) and `feedback.read` (owner).
- `appendLog(client, { at, actor, tradeCode: string | null, action, detail })` (Plan 4 Task 3's signature; `at` comes from `clock()`).
  - `LogAction` is a closed union with a detail schema per action, in `apps/api/src/log/actions.ts`. `assertDetail` refuses unknown keys and any string over 64 characters.
  - Plan 5 adds `pastrep.approved`, `pastrep.rejected`, `pastrep.revoked` and `proof.opened` to that file, with their detail schemas, in the tasks that first use them (11 and 14).
  - `proof.unblurred-requested` and `proof.unblurred-opened` already exist in Plan 4.
- `buildStaffApi`, staff route `Perm` declaration, `apps/staff-web` shell (Task 16), ModCase (Task 18).
- Dispute records: `disputes.state.status` (closed or not, closed time) and final `rulings` outcomes. Plan 5 consumes `lostDisputeCount(db, accountId): Promise<number>` in `apps/api/src/disputes/lost.ts` (the Plan 3 starter limits no longer use it: owner 2026-10-29, a lost dispute still counts as a completed trade and drops no stage; Plan 5 owns it).
- `proof-requested { username }` SSE to the uploader (Task 11); moderation `/internal/proof/read` (Task 11) uses Plan 5's `readProof`.
  - **Review 2026-10-24: three mismatches.**
    - Plan 4's moderation internal API listens on a Unix socket with an HMAC header. `/internal/proof/read {code, logEntryId}` takes **no proof id**, accepts only log action `proof.unblurred-opened`, and returns the unblurred image.
    - Plan 5 Task 14 therefore changes it to `{code, proofId, logEntryId}`. It accepts `proof.opened` for `proof`/`evidence` kinds and `proof.unblurred-opened` for `unblurred`, and the log entry's detail must name that `proofId`.
    - Plan 4 has **no `proof_requests` table**. Task 14 adds it, and makes Plan 4's `POST /staff/v1/disputes/:code/proof-request` write it.
- Plan 4 A10: "Add more evidence" hidden until Plan 5; Plan 5 un-hides it.
- **Plan 4 Task 15 `reencodeImage` and its `proof.unblurred` envelope (review 2026-10-24).**
  - Plan 4 seals the whole unblurred image inside a chat envelope. Plan 3 caps envelopes at 16 KiB, so that cannot work for a real screenshot.
  - Plan 5 replaces it: the image goes up as ciphertext (Task 14), the envelope carries only the key (Task 8), and the re-encode is `stripOnly` (Task 13).
  - Task 15 deletes `apps/web/src/proof/reencode.ts` and its test, or turns it into a re-export of `stripOnly`, whichever Plan 4 as built allows.
- **Dispute screen paths.** Plan 3 creates `apps/web/src/screens/dispute/{DisputeOpen,DisputeRoom,DisputeRuling}.tsx`; Plan 4 Task 15 names `apps/web/src/screens/{DisputeOpen,DisputeRoom,DisputeRuling}.tsx`. Plan 5 edits whichever exists on main; the paths below follow Plan 3.
- **Staff-web CSP.** Plan 4 serves staff-web with Plan 3's CSP minus `'wasm-unsafe-eval'`; see P5-A36 for the ModCase proof check.
- **`NAV` test.** Plan 4's roles test asserts `NAV.mod` deep-equals `['disputes','training','log']`. Task 11 updates that expectation when it adds `'past-reputation'`, and Task 4 adds `'feedback'` to `NAV.owner`.

**Spec 6.1 display name (owner 2026-10-23):** Plan 5 assumes `accounts.display_name` and its normalised `display_key` exist. **If the split has not landed when Task 5 starts, stop and report**: profiles must never be keyed by the login name.
- **Review 2026-10-24: no plan owns the split yet.**
  - Neither Plan 2 as built (`apps/api/migrations/001_accounts.sql`), Plan 3 nor Plan 4 adds `display_name`.
  - Plans 3 and 4 still say `username` in `TraderSummary`, SSE payloads (`accepted {by}`, `proof-requested {username}`, `moderator-joined {username}`) and staff views.
  - **Lead decision needed before Plan 5 starts:** which plan adds the column and renames those fields. This blocks Tasks 3, 5, 6, 11 and 12, not only Task 5.

## Review Focus

1. **Blind reveal leaking through numbers.** A trader watches their own % positive, review count, a badge (Trusted, Fast) or offer sort order right after the counterparty rates them. Expected: nothing moves until reveal. Tests owned by Tasks 3 and 5 (stats and summaries are byte-identical before and after an unrevealed review is stored).
2. **Odd images.** A sideways phone photo with EXIF rotation, a 12,000 × 12,000 PNG, an animated WebP, HEIC on Chrome, a PNG with transparency, a zero-byte file. Expected: upright output, a clear refusal ("This image can't be used. Try a screenshot." `// COPY-UNSIGNED`) for anything undecodable or too large, never a metadata-bearing or sideways upload. Tests owned by Task 13.
3. **OCR unavailable or finds nothing** (slow phone, Tor, model fails to load, a photo in another script). Expected: the editor still opens with manual blur, says no details were found automatically, and never claims anything was blurred. Tests owned by Tasks 13 and 15.
4. **The moderator asks for the unblurred copy and the original isn't on this device.** Expected: the buyer is asked to pick the screenshot again; it is stripped (not blurred) and sealed to the moderator only; the seller can neither decrypt nor download it. Tests owned by Tasks 14 and 15.
5. **A poster with an unrated trade is taken.** Expected: their offers are not listed while a review is pending, and a take that races the listing gets `review-pending`; the taker never waits on a poster who cannot proceed. Tests owned by Task 3.

**Execution order** (tasks are numbered by subsystem; build them in this order because of their Interfaces): 1, 2, 7, 8, 9, 3, 4, 10, 5, 11, 6, 12, 13, 14, 15, 16, 17, 18. Tasks 4, 11, 14 (moderation read), 16 (ModCase) and 17 (moderator context) need Plan 4 Tasks 1, 3, 4, 11, 16 and 18 merged.
- **Review 2026-10-24:** Task 3 also needs Plan 4 Task 10 (the dispute store that says when a dispute is closed) for P5-A3/A5.
- Task 5 also needs `lostDisputeCount`, which Plan 4 does not define. Whoever lands first owns it, as noted under Interfaces, and it in turn needs Plan 4's rulings.
- Until those land, Tasks 3 and 5 may treat every disputed trade as not yet reviewable and `lostDisputes` as 0, but only behind a failing `it.todo` that blocks Task 18.
- Everything else needs only Plans 2–3.

---

### Task 1: Review rules and stats maths (`@x2f/reputation`)

**Files:**
- Create: `packages/reputation/{package.json,tsconfig.json}`, `packages/reputation/src/{index,reviews,stats}.ts`
- Test: `packages/reputation/test/{reviews,stats}.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no dependencies). The personal-details check on notes is passed in, so this package does not depend on `@x2f/proof`; Task 3 passes `s => detectSensitiveText(s).length > 0` (Task 7).
- Produces:
  - `GOOD_PHRASES(rated: 'buyer'|'seller')` → `['Fast payment' | 'Fast release', 'Friendly', 'Clear instructions', 'Would trade again']` (P5-A7); `BAD_PHRASES = ['Slow', 'Went quiet', 'Asked for ID', 'Payment didn’t match']` (board apostrophe).
  - `type ReviewInput = { neutral: true } | { neutral: false; stars: 1|2|3|4|5; phrases: string[]; note?: string }`; `validateReview(i: unknown, rated: 'buyer'|'seller', hasPersonalDetails: (note: string) => boolean): ReviewInput` throws `ReviewError('bad-stars'|'bad-phrase'|'duplicate-phrase'|'note-too-long'|'note-multiline'|'note-personal-details'|'neutral-with-details')`.
  - `REVEAL_AFTER_DAYS = 7`; `revealAt(a: { reviewableSince: Date; submitted: { buyer: Date | null; seller: Date | null } }): Date` = the later submission when both exist, else `reviewableSince + 7 d`; `isRevealed(a, now) = now >= revealAt(a)`.
  - `classify(r): 'positive'|'negative'|'neutral'` (P5-A1); `reviewWeight(usdCents: bigint): bigint` (P5-A2).
  - `positivePct(rs: { kind; usdCents }[]): number | null` (null with no positive or negative review).
  - `median(xs: number[]): number | null`; `typicalMinutes(samples: number[]): number | null` (last 20, null below 3, P5-A8); `cancelRatePct(a: { cancelledByMe: number; reachedFunding: number }): number | null` (P5-A9).
  - `shouldAskFeedback(completedTrades: number): boolean` (P5-A19).

- [ ] **Step 1: Write the failing tests.**
  - `validateReview({neutral:false, stars:5, phrases:['Fast release'], note:'Smooth'}, 'seller')` passes; `'Fast payment'` rating a seller → `bad-phrase`; rating a buyer passes.
  - `stars: 0`, `6`, `4.5` → `bad-stars`; a 121-character note → `note-too-long`; a note with `\n` → `note-multiline`; with a checker that returns true → `note-personal-details`; `{neutral:true, stars:3}` → `neutral-with-details`.
  - `revealAt` with only the buyer at day 2 → `reviewableSince + 7 d`; both at day 2 and day 3 → day 3; `isRevealed` is false 1 ms before and true at the instant.
  - Weights: `reviewWeight(500n) === 1000n`, `reviewWeight(50_000n) === 50_000n`, `reviewWeight(10_000_000n) === 100_000n`. `positivePct` of one positive $10 and one negative $1,000 → `0` (floor of 0.99%); of 3-star and Neutral only → `null`.
  - `median([3,1,2]) === 2`, `median([1,2,3,4]) === 2` (floor of 2.5), `typicalMinutes([5,7])` → `null`.
  - `shouldAskFeedback`: 1 → true, 2 → false, 10 → true, 20 → true, 21 → false.
- [ ] **Step 2:** `npm test -- --project @x2f/reputation`; expect FAIL (modules missing).
- [ ] **Step 3:** Implement. Money stays `bigint`; percentages are whole numbers rounded down.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(reputation): review rules, blind reveal, weights and stats`.

### Task 2: Badge catalogue, earning rules and visibility (`@x2f/reputation`)

**Files:**
- Create: `packages/reputation/src/badges.ts`
- Test: `packages/reputation/test/badges.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type BadgeId = 'new' | 'trades-10' | 'trades-50' | 'trades-100' | 'trades-500' | 'trades-1000' | 'veteran-1' | 'veteran-3' | 'veteran-5' | 'trusted' | 'fast' | 'clean-record' | 'pgp' | 'security-key' | \`past-rep:${string}\``.
  - `BADGES: Record<Exclude<BadgeId, \`past-rep:${string}\`>, { label; meaning; icon; tone: 'escrow' | 'caution' }>` with the board meanings ("200+ trades and 98%+ positive", "Usually pays or releases within 10 min", "Trading on X2F for 1+ year", "Signs in with a verified PGP key", "Protects the account with a hardware key", "Completed 100 trades"); New is `tone: 'caution'`, the rest `escrow`.
  - `interface BadgeFacts { stage: 'starter'|'building'|'graduated'; completedTrades: number; positivePct: number | null; typicalMinutes: number | null; typicalSamples: number; lostDisputes: number; accountCreatedAt: Date; hasPgp: boolean; hasSecurityKey: boolean; pastRep: { id: string; site: string; trades: number }[] }`
  - `earnedBadges(f: BadgeFacts, now: Date): BadgeId[]` (P5-A12, P5-A13; Trusted = ≥ 200 trades and `positivePct ≥ 98`).
  - `type Visibility = 'featured' | 'hover' | 'hidden'`; `interface BadgePrefs { chosen: boolean; levels: Partial<Record<BadgeId, Visibility>>; order: BadgeId[] }`.
  - `resolveVisibility(earned: BadgeId[], prefs: BadgePrefs): { featured: BadgeId[]; more: BadgeId[] }`: New first in `featured` when earned (P5-A11); with `chosen = false` the defaults are Trusted, the highest trade milestone, Fast, Veteran (spec 5.4) filling the remaining slots, the rest `more`; with `chosen = true` the saved levels apply and unsaved earned badges go to `more` (P5-A15); Hidden badges appear in neither list.
  - `applyChoice(earned, prefs, id, level): { prefs; notice: string | null }`: featuring a third badge moves the oldest featured one to On hover with the board notice "<name> moved to On hover. Only 2 badges can be featured."; any change to `new` throws `BadgeError('new-is-fixed')`; an unearned id throws `BadgeError('not-earned')`.
  - `nextMilestones(f): { label: string; have: number; need: number }[]`: the next trade milestone and, while `lostDisputes === 0` and it is not earned, Clean record (board "500 trades 212 / 500", "Clean record 88 / 100").
  - `pastRepLabel(site, trades)` → `"Verified: 1,240 trades on LocalMonero (PGP proof)"` (spec 5.5).

- [ ] **Step 1: Write the failing tests.**
  - Stage `building` with 7 trades → `new` earned; `graduated` with 20 trades → no `new`; 4 trades `graduated` is impossible input and still yields no `new` (the stage decides, spec 2.3).
  - 212 trades, 99%, 6 min over 20 samples, 0 lost, 2 years, PGP → `['trades-100','veteran-1','trusted','fast','clean-record','pgp']` (order-insensitive); 1,000 trades → `trades-1000` only from the family.
  - 150 trades, 97% → no `trusted`; 150 trades, 1 lost dispute → no `clean-record`; ~~Fast with 4 samples → none~~ (2026-11-09, owner p11-20: Fast needs 30 qualifying payments, so 29 → none).
  - **No volume badge:** the `BADGES` keys and every `label`/`meaning` match none of `/\$|usd|xmr|volume|traded/i`.
  - Defaults with no choices: earned `trusted, trades-100, fast, veteran-1, pgp` → `featured ['trusted','trades-100']`, `more ['fast','veteran-1','pgp']`; with `new` earned → `featured ['new','trusted']`.
  - Hidden `pgp` appears in neither list; `applyChoice(.., 'new', 'hidden')` throws `new-is-fixed`; featuring a third shows the exact notice.
  - Past reputation never changes `earnedBadges`' milestone, Trusted or Clean record results (property test over random `pastRep`).
- [ ] **Step 2:** `npm test -- --project @x2f/reputation`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(reputation): badge catalogue, earning rules and visibility`.

### Task 3: Reviews API, reveal and the pending-review gate (`apps/api`)

**Files:**
- Create: `apps/api/migrations/301_reviews.sql`, `apps/api/src/reviews/{store,routes,gate}.ts`
- Modify: `apps/api/src/offers/routes.ts` (listing filter), `apps/api/src/trades/take.ts` and the poster wallet route (gate)
- Test: `apps/api/test/reviews.test.ts`, `apps/api/test/reviews-gate.test.ts`

**Interfaces:**
- Consumes: Task 1; Task 7 `detectSensitiveText`; Plan 3 `trades`, `usdCentsOf`, take and wallet routes; Plan 4 dispute status.
- Produces:
  - Table `reviews(trade_code text references trades, reviewer_id uuid, subject_id uuid, reviewer_role text check (in ('buyer','seller')), neutral boolean not null, stars smallint, phrases text[] not null default '{}', note text, usd_cents bigint not null, created_at timestamptz not null, primary key (trade_code, reviewer_id))` with a check that Neutral rows have no stars, phrases or note. UPDATE and DELETE are refused by trigger (reviews are final, P5-A6), except DELETE by role `x2f_purge`.
  - `reviewableSince(db, code): Promise<Date | null>` (P5-A3, P5-A5).
    - A trade that has **ever** had a dispute is reviewable only once that dispute is closed, whatever its final state.
    - This includes a `refunded` trade disputed within `disputeAfterRefundDays`: it becomes reviewable when the dispute closes.
    - `usd_cents` comes from the stored take-time value (Interfaces, `usdCentsOf`).
  - `GET /v1/reviews/pending` (`requireTrader`) → `{ trades: { code; counterparty: string /* display name */; reviewableSince: string }[] }`.
  - `GET /v1/trades/:code/review` (participant) → `{ reviewable: boolean; mine: PublicReview | null; theirs: PublicReview | null /* only once revealed */; revealAt: string | null }`.
  - `POST /v1/trades/:code/review` (participant, `requireTrader`) body `ReviewInput` → 201. Refusals: 409 `not-reviewable`, 409 `review-exists`, 400 with the `ReviewError` code.
  - `assertNoPendingReview(db, accountId)` → 409 `review-pending`; called inside the take transaction for **both** taker and poster, and in `POST /v1/trades/:code/wallet`.
  - `GET /v1/offers` leaves out offers whose poster has a pending review (P5-A4).
  - `PublicReview = { neutral; stars: number | null; phrases: string[]; note: string | null; method: string; age: string }` (P5-A10; `age` is month and year only, "Mar 2026", Revision 2026-10-29b). Never a reviewer id, amount or timestamp.

- [ ] **Step 1: Write the failing tests** (real Postgres):
  - A released trade: both sides can review; a third account gets 404; a second POST → `review-exists`; UPDATE on `reviews` by the app role fails.
  - A mutual-cancelled, buyer-cancelled or auto-refunded trade with no dispute → `not-reviewable`; a disputed trade → `not-reviewable` while open, reviewable after close.
  - **Blind reveal:** the seller reviews at day 1 → the buyer's `GET …/review` has `theirs: null`; after the buyer reviews, both see both; with only one review, `theirs` appears at `reviewableSince + 7 d` exactly and not 1 ms earlier.
  - **Gate:** a buyer with an unrated released trade → take refused `review-pending`; after a Neutral review the same take succeeds. Two pending reviews need two submissions.
  - **Review Focus 5:** the poster has a pending review → their offer is absent from `GET /v1/offers`; a take of its id anyway → `review-pending`, and no trade row exists; their `POST …/wallet` on an earlier `setup` trade → `review-pending`.
  - `usd_cents` is stored and never appears in any response body (grep the JSON).
  - A buyer-refunded trade (no-show) is `not-reviewable`; after a dispute-after-refund is opened and closed, it becomes reviewable with `reviewableSince` = the dispute's close.
  - `LATE_REVIEW` (P5-A31): with `'neutral-only'`, a star review submitted after `revealAt` → 400 `late-review-neutral-only`, and Neutral passes; with `'closed'`, the trade no longer blocks after `revealAt`.
- [ ] **Step 2:** `npm test -- --project @x2f/api`; expect FAIL.
- [ ] **Step 3:** Implement. `reviewer_role` and `subject_id` come from the trade row and the session, never the body.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): reviews with blind reveal and the pending-review gate`.

### Task 4: Platform feedback ("How's X2F doing?")

**Files:**
- Create: `apps/api/migrations/302_feedback.sql`, `apps/api/src/feedback/routes.ts`, `apps/api/src/staff/feedback.ts`, `apps/staff-web/src/screens/Feedback.tsx`
- Modify: `packages/staff/src/roles.ts` (perm `feedback.read`, owner only; `NAV.owner` gains `'feedback'`), `apps/api/src/retention/scheduler.ts`
- Test: `apps/api/test/feedback.test.ts`, `packages/staff/test/roles.test.ts` (matrix row)

**Interfaces:**
- Consumes: Task 1 `shouldAskFeedback`; Plan 4 staff API, perms and staff-web shell.
- Produces:
  - Table `platform_feedback(id uuid pk, mood text check (in ('great','ok','needs-work')), note text check (length ≤ 500), created_on date not null)`: **no account column, no time of day**.
  - `POST /v1/feedback { mood, note? }` (`requireTrader`) → 202. The session is used only for an in-memory limit of 3 per account per day; nothing about the sender is stored or logged.
  - `GET /staff/v1/feedback?before` (perm `feedback.read`) → `{ items: { mood; note; createdOn }[] }`, newest first, 50 per page.
  - `purgeFeedback(db, now)` deletes rows older than 365 days (P5-A19), run by `startRetention`.
  - Staff-web **Feedback** page (no board, `// COPY-UNSIGNED`): counts of Great / OK / Needs work for 30 days and the notes list, built from StaffLog's table styles.

- [ ] **Step 1: Write the failing tests:** a submitted row has no column holding an account id, session id, username or timestamp more precise than a date (schema introspection); a captured logger shows no note text; the 4th POST in a day still returns 202 and stores nothing; a mod gets `forbidden` and the owner reads the list (matrix); purge removes a 366-day-old row.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: unlinkable platform feedback with an owner-only list`.

### Task 5: Stats, profiles and badge settings (`apps/api`)

**Files:**
- Create: `apps/api/migrations/303_badge_prefs.sql`, `apps/api/src/reputation/{facts,profile,badgeRoutes}.ts`
- Modify: `apps/api/src/traders/summary.ts` (fill `positivePct`, `typicalMinutes`, `badges`)
- Test: `apps/api/test/{profile,badges,summary-blind}.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 and 10 (`past_reputation`); Plan 3 `tradeCap`, `trade_events`; Plan 2 `pgp_keys`, `webauthn_credentials`; Plan 4 `lostDisputeCount`.
- Produces:
  - Table `badge_prefs(account_id uuid pk references accounts, chosen boolean not null default false, levels jsonb not null default '{}', featured_order text[] not null default '{}', portable_public boolean not null default false, updated_at)`.
  - `badgeFactsMany(db, accountIds: string[], now): Promise<Map<string, BadgeFacts & { reviewCount: number; cancelRatePct: number | null }>>`: one batched query set for a whole offer list (no per-card queries). Only **revealed** reviews count.
  - `TraderSummary` (Plan 3) now carries `positivePct`, `typicalMinutes` and `badges: { featured: BadgeView[]; more: BadgeView[] }`, `BadgeView = { id: BadgeId; label; meaning; icon; tone; href?: string /* past-rep evidence link */ }`.
  - `GET /v1/traders/:name` (no session) → `TraderProfile = { displayName; memberSince: 'YYYY-MM'; online; lastSeenAt; stats: { completedTrades; positivePct; reviewCount; typicalMinutes; cancelRatePct }; badges; pgpProtected: boolean /* P5-A17 */; recordPublic: boolean; reviews: PublicReview[]; offers: number }`. Unknown name → 404 with the same body shape for every unknown name. `:name` is matched on `display_key`; a login name never matches.
  - `GET /v1/account/badges` (`requireTrader`) → `{ earned: (BadgeView & { level: Visibility })[]; featured: BadgeId[]; nextMilestones }`; `PUT /v1/account/badges { id: BadgeId; level: Visibility }` → the resolved lists plus `notice`; refusals 400 `new-is-fixed`, `not-earned`.

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 1:** store a review that is not yet revealed; `GET /v1/traders/:name`, `GET /v1/offers` and `traderSummary` for the subject are byte-identical before and after; after reveal `positivePct` and `reviewCount` change.
  - A Hidden badge is absent from the profile, the offer card summary and the `+N` list; New stays featured for a `building` account whatever `badge_prefs` says (a row forced to `levels: {new:'hidden'}` by SQL still shows New).
  - The profile JSON contains no `username`, login name, email, `usd`, `amount`, fingerprint, `account_id` or exact timestamps other than `lastSeenAt` (grep).
  - `GET /v1/traders/<login name of an account whose display name differs>` → 404.
  - 50 offers from 50 posters cost a constant number of queries (query counter).
  - `PUT` featuring a third badge returns the board notice; a badge not earned → `not-earned`.
  - `typicalMinutes` uses `release-started` time for sellers and `paidAt − securedAt` (floored at 0) for buyers.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. If `accounts.display_name` does not exist yet, stop and report (Interfaces).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): stats, public profiles and badge visibility`.

### Task 6: Review and feedback screens, and the rate-first gate (`apps/web`)

**Boards:** `Review.dc.html` (the rating and "How's X2F doing?" cards; Plan 3 built the released part).

**Files:**
- Create: `apps/web/src/screens/review/{ReviewCard,FeedbackCard,RateFirstSheet,usePendingReviews}.tsx`
- Modify: `apps/web/src/screens/trade/Released.tsx`, `apps/web/src/screens/dispute/DisputeRuling.tsx` (card after close), `apps/web/src/screens/quote/useTake.tsx` (Plan 3 Task 18's name), `apps/web/src/screens/AcceptedSheet.tsx`
- Test: `apps/web/e2e/review.spec.ts`

**Interfaces:**
- Consumes: Task 3 routes, Task 4 route, Task 1 `GOOD_PHRASES`, `BAD_PHRASES`, `shouldAskFeedback`.
- Produces:
  - `ReviewCard({ code, counterparty, rated })`: "How was trading with <name>?", "Shown to them only after they rate you too.", five stars ("1 star" … "5 stars" labels), phrase chips (good teal, bad rose), "One-line note (optional)", primary **Submit rating**, and **Neutral, skip details**. After submit: "Rating saved. <name> sees it once they've rated you too."
  - `FeedbackCard`: shown only after the rating is saved and only when `shouldAskFeedback` (never stacked with the required rating, spec 5.2): Great / OK / Needs work, "Anything we could do better?", "Sent without your username or trade details.", **Send feedback** / **Not now**. The request body has only `mood` and `note`.
  - `RateFirstSheet`: when `take` or the accepted sheet meets `review-pending` (or `usePendingReviews` already knows), the sheet shows the `ReviewCard` for the oldest pending trade, then resumes the take or the wallet pick.

- [ ] **Step 1: Write the failing tests:** parity `Review` at 390×844 (released part from Plan 3 fixtures, rating cards now unmasked); Submit is disabled with no stars; Neutral sends `{neutral:true}` only; a seller rating a buyer sees "Fast payment" and a buyer rating a seller sees "Fast release" (P5-A7); the feedback card does not appear before the rating is saved, and appears on the 1st and 10th trade only; the feedback request body has exactly the keys `mood` and `note` (network capture); tapping Trade with a pending review shows the rating card, and after Neutral the take continues to `/trade/<code>`.
- [ ] **Step 2:** Run `npx playwright test -c apps/web/e2e/playwright.config.ts review`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): review prompt, platform feedback and rate-first gate`.

### Task 7: Sensitive-text detection, redaction and image cleaners (`@x2f/proof`)

**Files:**
- Create: `packages/proof/{package.json,tsconfig.json}`, `packages/proof/src/{index,detect,redact,clean,amounts}.ts`
- Test: `packages/proof/test/{detect,redact,clean,amounts}.test.ts`, fixtures `packages/proof/test/fixtures/*.{png,jpg,webp}` (built by a script in the test file, checked in)

**Interfaces:**
- Consumes: `normalizeTradeCode` from `@x2f/core`.
- Produces:
  - `interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; line: number; conf: number }`
  - `type HiddenKind = 'name' | 'account' | 'card' | 'iban' | 'address' | 'phone' | 'email' | 'handle' | 'manual'`; `interface Region { x0; y0; x1; y1; kind: HiddenKind }`
  - `detectSensitive(words: OcrWord[], keep: { tradeCode: string; fiatCents: bigint; exponent: number }): Region[]`, covering spec 4.2's classes: 13–19-digit card numbers (spaces or dashes allowed; Luhn-valid → `card`, otherwise still masked as `account`); IBAN-shaped strings (mod-97 valid → `iban`, otherwise still masked as `account`); account numbers (digit runs ≥ 6, and masked tails like `••••1234` / `****1234`); emails; phone numbers (≥ 7 digits, `+` or separators); `@handles` and `$cashtags`; names (the rest of the line after a label `From`, `To`, `Sender`, `Recipient`, `Name`, `Paid to`, `Sent to`, `Payee`, `Payer`, `Beneficiary`, `Account holder`, or the next line when the label stands alone); addresses (a line with a house number and a street word, or a postcode pattern for US, UK, CA, DE, FR, NL, ES, IT). It **never** returns a region over the trade code (with or without dashes, after `normalizeTradeCode`), the trade's amount or a date, which the smart card needs.
  - `detectSensitiveText(s: string): HiddenKind[]` (the same classifiers over plain text, used for review notes, Task 1).
  - `padAndMerge(rs: Region[], w: number, h: number, keepClear: readonly Box[], padPx = 4): Region[]` (padding covers anti-aliased glyph edges; overlapping regions merge; clamped to the image). Revision (review RV4-M1, 2026-11-06): `keepClear` is required; pass `amountBoxes(words, keep)` so padding and merging never cover the trade amount (see docs/coordination.md, Plan 5 Task 7 notes).
  - `redact(rgba: Uint8ClampedArray, width: number, height: number, rs: Region[]): void`: each region becomes its mean colour plus a fixed texture that depends only on (x, y) (P5-A26).
  - `cleanImage(bytes: Uint8Array): Uint8Array`: PNG keeps only `IHDR`, `PLTE`, `IDAT`, `IEND` (CRCs re-checked); JPEG keeps only `SOI`, `DQT`, `DHT`, `SOF0`–`SOF2`, `DRI`, `SOS` + scan data, `EOI`. Anything else throws `CleanError('unsupported')`.
  - `assertClean(bytes: Uint8Array): void`: throws `CleanError('metadata')` unless every chunk or segment is on that allowlist.
  - `parseAmounts(words: OcrWord[], currency: string, exponent: number): bigint[]` (handles `$412.50`, `412,50 €`, `USD 412.50`, `1,234.56`, `1.234,56`, `1 234,56`).

- [ ] **Step 1: Write the failing tests:**
  - Each class on synthetic OCR words: card `4111 1111 1111 1111` masked as `card`. The Luhn-invalid `4111 1111 1111 1112` (one OCR misread) is **still masked**, as `account`.
    - **Fail-safe (review 2026-10-24):** the Luhn and mod-97 checks only choose the label, never whether to mask. One misread digit must not leave a real card or IBAN visible.
    - An IBAN with one wrong character is still masked as `account`. Space- or dash-separated digit groups are joined before the ≥ 6-digit account rule applies.
  - Beyond the trade code, amount and date, no "keep" rule exists, so a long transaction ID is masked too (harmless: the seller checks the amount and memo). `DE89 3704 0044 0532 0130 00` masked; `jane.doe@example.com`, `+1 (415) 555-0134`, `$janedoe`, `@jane-doe` masked; `From: Jane Doe` masks `Jane Doe` and not `From:`; `Sent to` alone on a line masks the next line; `221B Baker Street` and `SW1A 1AA` masked.
  - Kept: `K7M2-9QXA-4FTR-8WPN` and `K7M29QXA4FTR8WPN` with the trade code `K7M2-9QXA-4FTR-8WPN`; `$412.50` when the trade is 41250 cents; `Oct 16, 2026`.
  - `redact` irreversibility: two images that differ only inside a region and share its mean produce byte-identical output; pixels outside every region are unchanged.
  - `cleanImage` on a PNG carrying `tEXt`, `iTXt`, `zTXt`, `eXIf`, `iCCP`, `tIME`, `pHYs` keeps only the allowed chunks and still decodes (Node `zlib` inflate of `IDAT` succeeds); on a JPEG with `APP1` Exif GPS, `APP13`, `COM` → none survive and the bytes `Exif`, `GPS`, `Photoshop` are absent; `assertClean` rejects the inputs and accepts the outputs. A truncated file and a GIF → `unsupported`.
  - `parseAmounts` finds `41250n` in each format above for USD (exponent 2) and `1234n` cents is not confused with `123456n`.
- [ ] **Step 2:** `npm test -- --project @x2f/proof`; expect FAIL.
- [ ] **Step 3:** Implement. No image library: the PNG and JPEG walkers read chunk and marker lengths with bounds checks and refuse anything malformed.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(proof): sensitive-detail detection, irreversible redaction, metadata cleaners`.

### Task 8: Proof encryption and envelope payloads (`@x2f/proof`)

**Files:**
- Create: `packages/proof/src/{seal,payloads}.ts`
- Test: `packages/proof/test/seal.test.ts`

**Interfaces:**
- Consumes: libsodium-wrappers 0.8.4 (already pinned in `@x2f/protocol`); Plan 1 `seal`/`open`.
- Produces:
  - `type ProofKind = 'proof' | 'evidence' | 'unblurred'`.
  - `encryptProof(plain: Uint8Array, a: { code: string; proofId: string; kind: ProofKind }): Promise<{ ciphertext: Uint8Array; key: Uint8Array; sha256: string }>`: XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf_*`), a fresh random 32-byte key and 24-byte nonce per image, AAD = `x2f/proof/v1\0` + normalized code + `\0` + proofId + `\0` + kind. `decryptProof(ciphertext, key, a)` throws `ProofError('bad-ciphertext')` on any mismatch, then checks `sha256`.
  - `newProofId(): string` (16 random bytes, base32).
  - Envelope payloads (inside Plan 3 chat envelopes): `{ type: 'proof.attached'; payload: { proofId; kind: 'proof' | 'evidence'; key: string /* base64 */; sha256; width; height; mime: 'image/png' | 'image/jpeg'; hidden: HiddenKind[] } }` sealed `to: ['buyer','seller','mod']`, and `{ type: 'proof.unblurred'; payload: { proofId; key; sha256; width; height; mime } }` sealed `to: ['mod']` only. `parseProofPayload(type, payload)` validates shape and sizes (refuses keys that are not 32 bytes and any extra field).

- [ ] **Step 1: Write the failing tests:** round trip; a ciphertext moved to another trade code, proof id or kind → `bad-ciphertext`; one flipped byte → `bad-ciphertext`; two encryptions of the same image use different keys and nonces; a `proof.unblurred` envelope sealed by the buyer opens for the mod identity and throws `not-for-me` for the seller (Plan 1 `open`); `parseProofPayload` refuses an extra `filename` field.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(proof): per-image encryption and sealed key payloads`.

### Task 9: Smart proof check (`@x2f/proof`)

**Files:**
- Create: `packages/proof/src/check.ts`
- Test: `packages/proof/test/check.test.ts`

**Interfaces:**
- Consumes: Task 7 `parseAmounts`, `OcrWord`, `HiddenKind`.
- Produces:
  - `checkProof(words: OcrWord[], expected: { fiatCents: bigint; currency: string; exponent: number; tradeCode: string; earliest: Date; latest: Date }, hidden: HiddenKind[]): ProofCheck`, where `ProofCheck = { readable: boolean; amount: { status: 'match' | 'mismatch' | 'not-found'; seen: bigint | null }; reference: 'match' | 'not-found'; date: 'in-range' | 'out-of-range' | 'not-found'; name: 'hidden' | 'visible' | 'not-found' }` (spec 4.2: amount, date, reference, payer name; P5-A28). `readable` is false when OCR returned fewer than 3 words with `conf ≥ 60`. `earliest` = the day before `securedAt`; `latest` = now. A reference matches with or without dashes and with Crockford look-alikes (O/0, I/L/1).
  - `proofCardLines(c: ProofCheck, t: { buyer: string; total: string; code: string }): { tone: 'escrow' | 'caution'; text: string }[]`: board lines "Shows $412.50, the right amount", "Note says K7M2-9QXA-4FTR-8WPN, this trade's code", "Sender name hidden by mira.k"; mismatch and not-found lines `// COPY-UNSIGNED` ("Shows $400.00, not $412.50", "This trade's code isn't in the note", "We couldn't read this screenshot"). The closing line is always the board's "Look for a $412.50 payment with the note K7M2-9QXA-4FTR-8WPN in your bank. Screenshot checks catch mistakes, but only your bank proves the money arrived."

- [ ] **Step 1: Write the failing tests:** the board example yields exactly the three board lines plus the closing line; `$400.00` → mismatch line in `caution`; no code → not-found; a date two weeks before `securedAt` → `out-of-range`; `hidden` containing `name` → `hidden` even when a name label is present; unreadable OCR → one "couldn't read" line plus the closing line; the closing line is present in every case (property test).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(proof): smart proof check`.

### Task 10: Past reputation claims and PGP proof (`apps/api`)

**Files:**
- Create: `apps/api/migrations/304_past_reputation.sql`, `apps/api/src/pastrep/{challenge,verify,routes}.ts`
- Modify: `packages/accounts/src/pgp.ts` (`inspectPublicKey` third argument `{ minRsaBits?: number; requireEncryption?: boolean }`, defaults 4096 and true, so login is unchanged; a past-reputation key only needs to sign; export `PAST_REP_VERIFY_CONFIG`), `apps/api/src/auth/pgp.ts` (`storableKey` gets the same optional third argument; `sealKey`/`openKey` take an AAD label, defaulting to today's `x2f/pgp-key/`), new `tools/semgrep/pastrep-no-fetch.yml` added to the root `semgrep` script with `--config tools/semgrep` (the repo has no local rules directory yet)
- Test: `apps/api/test/pastrep.test.ts`, `packages/accounts/test/pgp.test.ts` (new case)

**Interfaces:**
- Consumes: Plan 2 `inspectPublicKey`, `storableKey`, `sealKey`/`openKey`, openpgp 6.3.2 strict config; Task 2 `pastRepLabel`.
- Produces:
  - Table `past_reputation(id uuid pk, account_id uuid references accounts, site text not null, evidence_url text not null, claimed_trades int not null check (> 0), fingerprint text not null, key_enc bytea not null, challenge_text text not null, signature text not null, status text check (in ('signed','approved','rejected','removed','revoked')), verified_trades int, reviewer_id uuid, decided_at, reason text, created_at)`; partial unique indexes: one `fingerprint` among `signed|approved` rows (P5-A24); one `(account_id, site)` among `signed|approved` rows (P5-A21).
  - `pastRepChallenge(a: { origin; displayName; site; url; fingerprint; nonce; issuedAt }): string` — exact text:
    ```
    X2F past reputation proof
    Site: <origin>
    X2F name: <display name>
    Old site: <site>
    Old profile: <url>
    Key: <fingerprint, uppercase, groups of 4>
    Nonce: <16 Crockford base32>
    Issued: <ISO 8601 UTC>
    ```
  - `POST /v1/account/past-rep/start { site, url, claimedTrades, publicKey }` (`requireTrader`) → `{ challengeId, text, expiresAt }` (60 min). Refusals: 400 `bad-site`, `bad-url` (not https or host not in `PAST_REP_ARCHIVE_HOSTS`, userinfo or a port present, P5-A20), the `KeyRefusal` codes from `inspectPublicKey(key, now, { minRsaBits: 2048, requireEncryption: false })` (P5-A22; DSA and ElGamal-only keys → `key-weak`), 409 `site-claimed`.
  - `POST /v1/account/past-rep/finish { challengeId, signed }` → 201 `{ id, status: 'signed' }`. `verifyPastRepSignature(signed, text, armoredKey, now)` accepts an armored cleartext-signed message or a detached signature; the signed text must equal the issued text after `\r\n`→`\n` and trailing-whitespace trimming; the signature must verify (`expectSigned: true`, `date: now`) by the primary key or one of its signing subkeys; refusals 400 `bad-signature`, `wrong-text`, `wrong-key`, `challenge-expired`; a used challenge → 409 `challenge-used`; a fingerprint already in a `signed` or `approved` claim of another account → 409 `fingerprint-claimed` (checked only here, so `start` never reveals another account's claim). The key is stored only through `storableKey` + `sealKey` (R16); the response and logs carry no key material or user ID.
  - **Verification rules (review 2026-10-24):**
    - **Challenge belongs to the caller.** The challenge row stores `account_id`, `site`, `url`, `claimed_trades`, the inspected fingerprint and the exact text. `finish` refuses `challenge-expired` (the same answer as an unknown id) unless the session's account is the one that started it, so a challenge cannot be finished by another account. It is marked used in the same transaction that inserts the claim.
    - **Compare what was verified.** For a cleartext message, compare the text that `openpgp.verify` returns as `data`, never text parsed from the paste separately. Refuse with `wrong-text` if the paste holds anything outside the one signed block. That blocks the classic cleartext tricks: text before or after the block, or a second block.
    - **Exactly one signature.** It must be made by the claimed key (its primary key, or a subkey with the sign flag and a valid, unrevoked, unexpired binding at `now`). Signatures from any other key → `wrong-key`. Await `verified` on every signature.
    - **Its own openpgp config.** `PAST_REP_VERIFY_CONFIG` is `BASE_CONFIG` (Plan 2, `packages/accounts/src/pgp.ts`) with `minRSABits: PAST_REP_MIN_RSA_BITS` and the same rejected algorithms as login. Plan 2's `STRICT_CONFIG` refuses RSA below 4096 during verification too, so it would reject every 2048-bit key that P5-A22 accepts.
    - **Signature time.** The signature's creation time must lie in `[issuedAt − 5 min, now + 5 min]`.
    - **No user IDs kept.** `storableKey` gains the same optional third argument as `inspectPublicKey`; Task 10 passes `{ minRsaBits: 2048, requireEncryption: false }`. Without it, a signing-only v6 key fails the default inspection inside `storableKey` and is kept with its user IDs.
    - **Separate encryption domain.** Past-reputation keys are sealed with their own AAD (`x2f/pastrep-key/<fingerprint>`; `sealKey` takes the AAD label as a parameter) so a sealed past-rep key cannot be swapped into `pgp_keys`.
    - **No lookups.** `bad-url` validation is purely syntactic: `new URL()`, `https:` only, `hostname` (lower-case, no trailing dot) exactly in the list, no userinfo, no port. There is no DNS lookup and no fetch.
  - `GET /v1/account/past-rep` → own claims `{ id, site, url, claimedTrades, verifiedTrades, status, reason }`; `DELETE /v1/account/past-rep/:id` sets `removed`.
  - Past reputation never feeds Task 5's counts; Task 5 reads only `approved` rows into `BadgeFacts.pastRep` with `trades = verified_trades` and `href = evidence_url`.

- [ ] **Step 1: Write the failing tests** (fixtures from `openpgp.generateKey`; RSA keys made once in `beforeAll`):
  - An Ed25519 key signs the issued text (cleartext) → `signed`; a detached signature also works.
  - The text with a different nonce, display name or site → `wrong-text`; a valid signature by another key → `wrong-key`; a signature by a signing subkey of the claimed key passes.
  - RSA 2048 accepted here, RSA 1024 refused `key-weak`; a signing-only Ed25519 key accepted here; RSA 2048 and a signing-only key still refused by login's `inspectPublicKey` defaults.
  - A revoked key → `key-revoked`; an expired key → `key-expired`; the same key re-signed to a later expiry passes.
  - `http://web.archive.org/…`, `https://evil.example/…`, `https://user@web.archive.org/…`, `https://web.archive.org:8443/…`, `https://web.archive.org./…`, `https://web.archive.org.evil.example/…` and `https://evil.example\@web.archive.org/…` → `bad-url`.
  - **Replay and binding:** account B finishing account A's `challengeId` with A's valid signature → `challenge-expired`, and no row is created. A second `finish` of a used challenge → `challenge-used`.
  - **Cleartext tricks:** a valid cleartext block with extra lines outside it → `wrong-text`. A message carrying two signatures, one by the claimed key and one by another key → `wrong-key`. A signature dated 2 h before `issuedAt` → `wrong-text`.
  - An RSA 2048 signing key verifies under `PAST_REP_VERIFY_CONFIG`. The same signature checked with Plan 2's `STRICT_CONFIG` fails, which proves the test uses the right config.
  - A v6 signing-only Ed25519 key carrying a user ID is stored with no user ID packet (decrypt `key_enc` in the test and parse it).
  - The same fingerprint claimed by a second account: `start` succeeds, `finish` → 409 `fingerprint-claimed`.
  - A v4 key with `Name <a@b.c>`: no row, response or captured log contains `a@b.c`.
  - **Screenshots alone never count:** no route creates a claim without a verified signature (route table scan: only `finish` inserts).
  - No server code path fetches `evidence_url` or resolves its host. **Both** checks are required (review 2026-10-24); a `fetch` stub alone misses `node:http(s)`, `undici`, `node:net` and `node:dns`:
    - a Semgrep rule that fails on any import of `node:http`, `node:https`, `node:net`, `node:dns`, `undici` or `fetch(` under `apps/api/src/pastrep/**` and `apps/api/src/staff/pastrep.ts`;
    - a test that stubs global `fetch`, `dns.lookup` and `http(s).request`, then asserts no call during the whole flow.
- [ ] **Step 2:** `npm test -- --project @x2f/api --project @x2f/accounts`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): past reputation claims proven by PGP signature`.

### Task 11: Past reputation review by moderators (staff API and staff-web)

**Files:**
- Create: `apps/api/src/staff/pastrep.ts`, `apps/staff-web/src/screens/PastRep.tsx`
- Modify: `packages/staff/src/roles.ts` (perm `reputation.review`: owner, senior, mod; `NAV` gains `'past-reputation'` for those roles), `packages/staff/test/roles.test.ts` (Plan 4's `NAV.mod` expectation), `apps/api/src/log/actions.ts` (`pastrep.*` actions; detail `{ claimId, site, trades }`, no URL or fingerprint)
- Test: `apps/api/test/staff/pastrep.test.ts`, `apps/staff-web/e2e/pastrep.spec.ts`

**Interfaces:**
- Consumes: Task 10; Plan 4 `buildStaffApi`, `appendLog`, staff-web shell, `ExternalLink`.
- Produces:
  - `GET /staff/v1/past-rep?status=signed` → `{ id; site; url; claimedTrades; fingerprint /* grouped */; keyId /* last 16 hex */; signatureValid: true; displayName; createdAt }[]` (fingerprint is the one thing staff need to compare; no user ID or key text).
  - `POST /staff/v1/past-rep/:id/approve { fingerprintSeen: true; tradesSeen: number }`: refused 400 `confirm-fingerprint` unless `fingerprintSeen` (P5-A23); sets `approved`, `verified_trades = tradesSeen`; appends `pastrep.approved` (detail: site and count only). `POST …/reject { reason ≥ 10 }` → `rejected`, `pastrep.rejected`. `POST …/revoke { reason }` (senior or owner only) → `revoked`, `pastrep.revoked`.
  - **PastRep page** (no board, `// COPY-UNSIGNED`): one claim at a time; the evidence link opens in a new tab with `rel="noreferrer noopener"` and the line "Opens the archive in your browser. X2F never fetches it."; the fingerprint in large mono groups of 4; the tick box "The archived page shows this exact full fingerprint"; "Trades shown on the archived page" number field; **Approve** (`data-primary`) and **Reject** with a reason.

- [ ] **Step 1: Write the failing tests:** a helper gets `forbidden` (matrix); approve without `fingerprintSeen` → `confirm-fingerprint`; after approval the trader's profile shows "Verified: 1,240 trades on LocalMonero (PGP proof)" linking to the URL, and `completedTrades`, `positivePct` and every milestone are unchanged; a mod's revoke → `forbidden`, a senior's → `revoked` and the badge disappears; each decision writes exactly one log entry with no URL or fingerprint in `detail`; the page's evidence link has `noreferrer`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: moderator review of past reputation claims`.

### Task 12: Profile, badge settings, past reputation and portable record screens (`apps/web` + API record route)

**Boards:** `Profile.dc.html`, `BadgeSettings.dc.html`, badges on `SellOffers.dc.html`.

**Files:**
- Create: `apps/web/src/screens/profile/{Profile,BadgeSettings,PastRepClaim,RecordExport,VerifyRecord}.tsx`, `apps/web/src/ui/BadgeMore.tsx`, `apps/api/src/reputation/record.ts`
- Modify: `apps/web/src/screens/browse/OfferCard.tsx` (badges from `TraderSummary.badges`)
- Test: `apps/web/e2e/profile.spec.ts`, `apps/api/test/record.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 10; Plan 2 `PgpSigner`, `GET /v1/pgp/signing-key`; openpgp 6.3.2 in the browser (already pinned in the repo by `@x2f/accounts` and `apps/api`; added to `apps/web` at the same exact version, so no new package enters the tree; loaded lazily only on `/verify`).
- Produces:
  - Routes `/u/:name` (Profile), `/settings/badges` (BadgeSettings), `/settings/past-reputation` (PastRepClaim), `/settings/record` (RecordExport), `/verify` (VerifyRecord, no session).
  - **Profile**: the board's stats ("completed trades", "positive (N reviews)", "typical payment time", "trades cancelled", "member since Mon YYYY"), featured and On-hover badges, recent reviews, "Account protected with PGP" (P5-A17), "Signed trade history available · Verify" only when `recordPublic`, Offers (n), Message. Fixture reviews are masked; the board's "Reviews are examples." is not rendered.
  - **BadgeSettings**: the board's preview ("On your offers"), "Featured N of 2", the notice, the Earned list with Featured / On hover / Hidden for each, "Next milestones", and "The New badge always shows while you have it and can't be hidden." New's row has no controls.
  - **BadgeMore** (`+N`): the popover lists On-hover badges, each with its one-line meaning (SellOffers board).
  - **PastRepClaim** (`// COPY-UNSIGNED`): pick the site, paste the archive link, claimed trade count and the old public key; copy the challenge text; paste the signed message; status list (signed / approved / rejected with reason / removed). The screen says "Screenshots don't count. Sign with the key shown on your old profile."
  - `GET /v1/account/record` (`requireTrader`, 1 per minute per account in memory) → `{ text }`: P5-A18 contents, cleartext-signed with X2F's official key. `PUT /v1/account/record/public { on }`; `GET /v1/traders/:name/record` → the same text only when public, else 404.
    - **Review 2026-10-24: keep record signatures apart from other X2F signatures.** The same key signs login challenges (Plan 2), so the record's first line is the fixed header `X2F portable reputation record v1`. VerifyRecord refuses any X2F-signed text that does not start with it; a signed login challenge pasted there gets the "changed or not signed" answer.
    - The display name is the only trader-chosen field, and it cannot hold a line break (spec 6.1 charset), so a record cannot imitate the header.
    - An unknown name and a private record give byte-identical 404s.
    - The public copy never includes PGP fingerprints (P5-A35).
  - **RecordExport** (`// COPY-UNSIGNED`): Download (`x2f-reputation-<date>.txt`, a `data:` link), the "Show on my profile" toggle, and for PGP users the hint to add their own signature with their PGP app.
  - **VerifyRecord**: paste a record; verifies the X2F signature in the browser against the key from `GET /v1/pgp/signing-key` **and** the fingerprint pinned in the bundle at build time (`VITE_X2F_PGP_FINGERPRINT`); shows "Signed by X2F" with the fields, or "This record was changed or not signed by X2F." (`// COPY-UNSIGNED`).

- [ ] **Step 1: Write the failing tests:** parity Profile and BadgeSettings (fixture data, review texts masked); setting a third Featured shows the board notice; New has no controls; a Hidden badge is gone from `/u/:name` and the offer card for a logged-out viewer; the record text verifies with `gpg --verify`-equivalent openpgp verify against the test signing key and contains no amount, method, counterparty or note; one changed character fails VerifyRecord; a record signed by another key with the right-looking text fails (pinned fingerprint); a genuine X2F-signed login challenge pasted into VerifyRecord fails (header); `/record` for an unknown name and for a private record return identical bodies; the public record contains no 40- or 64-hex fingerprint; `GET /v1/traders/:name/record` is 404 until public; the past-rep flow from start to "Waiting for a moderator" with a test key.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): profiles, badge settings, past reputation and the signed record`.

### Task 13: On-device image pipeline and OCR (`apps/web`)

**Files:**
- Create: `apps/web/src/proof/{pipeline,ocrWorker,ocr,localOriginals,imageHeader}.ts`, `tools/copy-ocr-assets.ts`, `tools/ocr-assets.sha256`, `apps/web/src/fixtures/ProofLab.tsx` (`VITE_FIXTURES` only)
- Modify: `apps/web/package.json` (the three pinned dependencies), root `package.json` (`overrides: { "tesseract.js-core": "7.0.0" }`; `build` runs `copy-ocr-assets`), `apps/api/src/static/serve.ts` (worker CSP on `/ocr/*`), `apps/api/test/headers.test.ts`
- Test: `apps/web/e2e/proof-pipeline.spec.ts`, `apps/web/e2e/fixtures/proofs/*` (synthetic receipts with ground-truth JSON)

**Interfaces:**
- Consumes: Task 7 (`detectSensitive`, `padAndMerge`, `redact`, `cleanImage`, `assertClean`), Task 8 `encryptProof`.
- Produces:
  - `copy-ocr-assets.ts` copies these files into `apps/web/public/ocr/` (git-ignored, rebuilt):
    - `tesseract.js/dist/worker.min.js`;
    - from `tesseract.js-core`: `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js` and `tesseract-core-relaxedsimd-lstm.wasm.js`;
    - from `@tesseract.js-data/eng`: `4.0.0_best_int/eng.traineddata.gz`, copied as `eng.traineddata.gz`.
  - **Why this file list (review 2026-10-24, checked against the 7.0.0 tarballs).**
    - With `corePath` set to a directory, `tesseract.js` 7 picks the core file itself: `relaxedsimd`, then `simd`, then plain, each with an `-lstm` suffix for the default LSTM-only engine.
    - The `.wasm.js` files have the WASM inlined, so the separate `.wasm` files are not needed.
    - Copying only the "SIMD and non-SIMD" files would 404 on every Chromium browser, which supports relaxed SIMD, and OCR would silently never work.
    - The LSTM-only engine uses the `4.0.0_best_int` model (2.9 MB, against 10.9 MB for `4.0.0`). There is no top-level `eng.traineddata.gz` in the package.
  - **Integrity.** `tools/ocr-assets.sha256` is checked in: one SHA-256 per copied file, computed from the pinned 7.0.0 / 1.0.0 tarballs.
    - `copy-ocr-assets` fails the build when any copied file differs. The test compares against this manifest, not against `node_modules`, which proves nothing about `node_modules` itself.
    - Changing a pin means regenerating the manifest in the same commit.
  - **Serving.** `apps/api/src/static/serve.ts` `setHeaders` adds the worker CSP from Global Constraints to every path under `ocr/`, so the worker cannot reach another origin even if a CDN default is ever used.
    - `eng.traineddata.gz` is served as `application/gzip` with no `Content-Encoding`. `tesseract.js` checks the gzip magic itself.
    - Add a `serve.ts` test for both headers.
  - `ocr(bitmap: ImageBitmap): Promise<OcrWord[] | null>`: lazily creates one worker and returns `null` (never throws) when loading fails or takes longer than `OCR_TIMEOUT_MS = 30_000` (Review Focus 3).
    - Call: `createWorker(PROOF_OCR_LANGS, OEM.LSTM_ONLY, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr/', workerBlobURL: false, gzip: true, cacheMethod: 'none', legacyCore: false, legacyLang: false })`.
    - On timeout it terminates the worker.
  - `decodeProof(file: File): Promise<ImageBitmap>`: errors are `ProofInputError('too-large' | 'unsupported' | 'undecodable')`.
    - Check the size (P5-A25).
    - Sniff the magic bytes (PNG, JPEG, WebP, HEIC) instead of trusting `file.type`.
    - **Before any decode**, read the width and height from the header (PNG `IHDR`, JPEG `SOFn`, WebP `VP8 `/`VP8L`/`VP8X`, HEIC `ispe`), with bounds-checked walkers like Task 7's. Refuse `too-large` over `PROOF_MAX_DECODED_PIXELS`, and refuse `unsupported` for animation (PNG `acTL`, WebP `ANIM`/`ANMF`, HEIC image sequences).
    - Then `createImageBitmap(file, { imageOrientation: 'from-image' })`.
    - A header that cannot be read is `undecodable`. `createImageBitmap` alone would decode a 144-megapixel image before any check could run.
  - `prepareProof(bitmap, keep): Promise<{ rgba; width; height; regions: Region[]; ocrOk: boolean }>`: scale to `PROOF_MAX_SIDE`, flatten transparency onto white, OCR, `detectSensitive`, `padAndMerge`.
  - `finishProof(p, regions: Region[]): Promise<{ bytes: Uint8Array; mime; width; height; hidden: HiddenKind[] }>`: `redact` on a copy, encode with `OffscreenCanvas.convertToBlob` (PNG, JPEG 0.85 fallback over the cap), `cleanImage`, then `assertClean`. A failure here never falls back to the uncleaned bytes.
  - `stripOnly(bitmap)`: the same without redaction (for the unblurred copy). `localOriginals.put(code, proofId, bytes)` / `get` / `purge(now)` in IndexedDB (P5-A29).

- [ ] **Step 1: Write the failing tests** (Playwright, Chromium and WebKit, on the `ProofLab` fixture page):
  - A JPEG with EXIF GPS, camera model and DateTimeOriginal → output bytes contain none of `Exif`, `GPS`, the model string or the date string; `assertClean` passes; a PNG with `tEXt`/`eXIf`/`iCCP` → only allowed chunks.
  - An EXIF orientation-6 photo comes out upright (pixel probe on a known corner colour).
  - A 12,000 × 12,000 PNG → `too-large` before decoding; an animated WebP → `unsupported`; a 0-byte file → `undecodable`; a transparent PNG → white background.
  - On the synthetic receipt set, every ground-truth card, IBAN, email and phone box is covered by a region, names after labels are covered in at least 90 % of fixtures (`DETECT_MIN_RECALL_NAMES = 0.9`), and the trade code and amount are never covered.
    - **Review 2026-10-24:** fixtures built by the same author as the detector prove little about real receipts.
    - The set must include layouts where the name is **not** after a label: a large recipient name at the top as in Zelle, Cash App, Revolut and Wise, and an avatar caption. The measured recall for those is recorded in `docs/security/plan-5-review.md` as a number, not just pass or fail.
    - No real person's receipt is ever committed.
  - With `/ocr/eng.traineddata.gz` blocked by `page.route`, `prepareProof` returns `ocrOk: false` and no regions within 31 s, and no error escapes.
  - The whole run makes zero requests to other origins, page and worker alike (`context.on('request')`, which includes worker requests), and logs zero CSP violations (Plan 3's CSP unchanged); no `blob:` worker is created.
    - The bundled `worker.min.js` contains two `Function(...)` fallbacks (regenerator-runtime and a `globalThis` shim) inside `try` blocks. If either reports a violation under the worker CSP, record it as expected in the test, by exact `violatedDirective` and source file, rather than loosening the CSP.
  - With `/ocr/tesseract-core-relaxedsimd-lstm.wasm.js` returning 404, OCR still fails closed (`ocrOk: false`). With it present, Chromium loads exactly that file (request log). This catches a wrong asset list.
  - Every `/ocr/*` response carries the worker CSP. A tampered `eng.traineddata.gz` (one byte flipped in `public/ocr/`) fails `copy-ocr-assets`' manifest check.
  - A PNG whose `IHDR` says 12,000 × 12,000 but whose body is tiny → `too-large`, and `createImageBitmap` is never called (spy).
  - `npm audit --omit=dev` is 0 after adding the dependencies (R31/R33 exceptions only). If not, stop and report.
- [ ] **Step 2:** Run `npx playwright test -c apps/web/e2e/playwright.config.ts proof-pipeline`; expect FAIL.
- [ ] **Step 3:** Re-check the three publish dates, install with `npx -y npm@11.21.0 install --save-exact --ignore-scripts`, then implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): on-device proof pipeline with self-hosted OCR`.

### Task 14: Proof storage, moderator read and retention (`apps/api`, `apps/moderation`)

**Files:**
- Create: `apps/api/migrations/305_proofs.sql`, `apps/api/src/proofs/{routes,store,purge}.ts`, `apps/moderation/src/proofs.ts`
- Modify: `apps/api/src/internal/routes.ts` (internal proof read), `apps/api/src/retention/scheduler.ts`, `apps/moderation/src/internal/server.ts` and `apps/api/src/disputes/moderationClient.ts` (Plan 4: `/internal/proof/read {code, proofId, logEntryId}`, accepting `proof.opened` or `proof.unblurred-opened` by kind), `apps/api/src/disputes/staffRoutes.ts` (Plan 4's proof-request route writes `proof_requests`; `POST …/proof` takes `proofId`), `apps/api/src/log/actions.ts` (`proof.opened`; `proof.*` details carry `proofId`)
- Test: `apps/api/test/proofs.test.ts`, `apps/moderation/test/proofs.test.ts`

**Interfaces:**
- Consumes: Task 8; Plan 3 internal listener and moderation chat identity; Plan 4 dispute status, `proof-requested` record, `appendLog`.
- Produces:
  - Table `trade_proofs(id text pk /* newProofId */, trade_code text references trades, uploader_role text, kind text check (in ('proof','evidence','unblurred')), ciphertext bytea not null, created_at)`; `proof_requests(trade_code, uploader_role, requested_at, fulfilled_at)`. Plan 4 defines no such table, so this migration adds it, and Task 14 makes Plan 4's request route insert it in the same transaction as the `proof.unblurred-requested` log entry.
  - `PUT /v1/trades/:code/proofs/:id?kind=` (participant, `requireTrader`, `Content-Type: application/octet-stream`, route `bodyLimit` = `PROOF_MAX_CIPHERTEXT`): `proof` only by the buyer in `securing|secured|paid|refund_requested|disputed`; `evidence` by either side while a dispute is open (P5-A30); `unblurred` only by the side named in an unfulfilled `proof_requests` row (409 `not-requested`). Over `PROOF_MAX_PER_SIDE` → 409 `too-many-proofs`; an existing id → 409 `exists`. The body is stored as is; the server never parses it.
  - `GET /v1/trades/:code/proofs/:id` (participant) → the ciphertext for `proof` and `evidence`; **404 for `unblurred`** whoever asks.
  - `GET /internal/v1/proofs/:id` (signed by the moderation key) → any kind's ciphertext.
  - `readProof(code, proofId): Promise<{ bytes: Uint8Array; mime }>` in `apps/moderation`: finds the `proof.attached` or `proof.unblurred` envelope for that id in the trade's chat, opens it with the mod chat identity, fetches the ciphertext, decrypts and checks `sha256`. Plan 4's `/internal/proof/read` calls it, and its staff route appends `proof.opened` (blurred) or `proof.unblurred-opened` before returning bytes.
  - `purgeProofs(db, now)`: the same rules as `purgeChats` (90 days after close; never while a dispute is open; Plan 4 R6 for closed disputes), run by `startRetention`.

- [ ] **Step 1: Write the failing tests:**
  - The seller uploading `kind=proof` → `wrong-party`; a 4 MiB + 1 byte body → 413; a sixth proof → `too-many-proofs`.
  - Moderation internal read: a fresh `proof.opened` entry for proof A cannot open proof B, and cannot open an `unblurred` proof; a `proof.unblurred-opened` entry is needed for that.
  - `unblurred` with no request → `not-requested`; after a request, the named side uploads; the seller's and the buyer's `GET` of that id → 404; the internal route (signed) returns it; unsigned → 401.
  - **Review Focus 4:** the seller decrypting an `unblurred` ciphertext with any key from envelopes it can open fails (`readProof` path test in moderation: the seller identity cannot open `proof.unblurred`).
  - A captured logger over the full flow contains no proof id, trade code or byte count.
  - Purge deletes proofs at close + 90 days, keeps them while disputed, and deletes them 30 days after the dispute closes.
- [ ] **Step 2:** Run `npm test -- --project @x2f/api --project @x2f/moderation`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: encrypted proof storage, moderator-only unblurred copies, retention`.

**Revision 2026-10-29 (owner):** `purgeProofs` follows the new retention: proofs go with the trade 30 days after it ends, or 90 days after ~~the dispute button~~ the dispute closing (owner p11-11, 2026-11-09) for a disputed trade (Plan 7 Task 2, Plan 4 Task 23). See "Revision 2026-10-29 (owner)" at the end.

### Task 15: Proof screens — upload, blur editor, paid card, evidence and the unblurred copy (`apps/web`)

**Boards:** `BuyerPay.dc.html` (proof slot), `DisputeOpen.dc.html` (Add more evidence), `DisputeRoom.dc.html` (unblurred request). The blur editor has **no board**: controller step first: ask the owner to add a "Check your proof" board to the X2F App canvas (photo with frosted regions, "Add blur" / tap a region to remove, the best-effort line, **Send proof** primary, Choose another). If the owner prefers, build it from design-system parts with `// COPY-UNSIGNED` copy and add the board afterwards.

**Files:**
- Create: `apps/web/src/screens/proof/{AddProof,BlurEditor,ProofThumb,SendUnblurred}.tsx`, `apps/web/src/proof/useProofs.ts`
- Modify: `apps/web/src/screens/trade/{BuyerPay,PaidConfirmSheet}.tsx`, `apps/web/src/chat/ChatPanel.tsx`, `apps/web/src/screens/dispute/{DisputeOpen,DisputeRoom}.tsx` (or Plan 4's `apps/web/src/screens/{DisputeOpen,DisputeRoom}.tsx`, whichever exists)
- Delete or replace: Plan 4's `apps/web/src/proof/reencode.ts` and its whole-image `proof.unblurred` envelope (see Interfaces). `SendUnblurred` replaces Plan 4's file picker, and Plan 4's `reencodeImage` EXIF test moves to Task 13's `stripOnly`.
- Test: `apps/web/e2e/proof.spec.ts`

**Interfaces:**
- Consumes: Tasks 8, 13, 14; Plan 3 chat envelopes and `useEscrow`; Plan 4 `proof-requested` SSE.
- Produces:
  - BuyerPay: "Add payment proof" with the board lines ("Private details are blurred for you to check next. Location and device info are removed." and "Our system does its best to blur out private, personal and confidential information automatically, but please double-check every detail yourself before you send it."), then `BlurEditor`.
  - `BlurEditor`: shows the redacted preview; drag to add a region (`kind: 'manual'`), tap a region to remove it; when `ocrOk` is false it says "We couldn't check this image automatically. Blur anything private yourself." (`// COPY-UNSIGNED`) and starts with no regions; **Send proof** runs `finishProof`, `encryptProof`, `PUT`, then posts the `proof.attached` envelope; on success it stores the unblurred stripped copy with `localOriginals.put`.
  - `PaidConfirmSheet`: "Sending without proof makes disputes harder." shows only when this buyer has attached no proof (spec 2.2 step 7; Plan 3 showed it always).
  - `ChatPanel`: a `proof.attached` envelope renders as a `ProofThumb` (decrypted in the browser, shown as a `data:` URL) inside the paid system card or as its own card.
  - DisputeOpen: "Add more evidence" is shown (Plan 4 A10 lifted) and uses the same editor with `kind: 'evidence'`.
  - `SendUnblurred` on DisputeRoom: on `proof-requested`, the board line "<mod> asked you for the unblurred proof. Only she will see it. <seller> won't." with **Send unblurred proof to <mod>**; uses `localOriginals.get`, or asks to pick the file again (Review Focus 4) and runs `stripOnly`; uploads `kind=unblurred` and posts `proof.unblurred` sealed to `['mod']`; then the board's "Sent to <mod> at 10:58" and the system line "You sent an unblurred proof to the moderator only".

- [ ] **Step 1: Write the failing tests:** parity BuyerPay (proof slot unmasked), DisputeOpen, DisputeRoom; a fixture receipt: the editor shows regions over the card number and email; removing one and adding one changes the sent image (the seller's decrypted thumb differs exactly there); the uploaded request body is ciphertext (no PNG or JPEG magic, no filename in headers); the seller's chat shows the thumb in the paid card; the "without proof" line shows with no proof and not after one; OCR blocked → the no-check message and an empty region list; after `proof-requested`, the buyer on a fresh browser context (no local original) is asked to pick the file, and the seller's page never receives a `proof.unblurred` it can open; the seller's room has no unblurred button.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): proof upload with blur editor, evidence and moderator-only unblurred copy`.

### Task 16: Smart proof card on SellerConfirm and ModCase

**Boards:** `SellerConfirm.dc.html` (card), `ModCase.dc.html` ("Payment proof").

**Files:**
- Create: `apps/web/src/screens/proof/SmartProofCard.tsx`, `apps/staff-web/src/ui/ProofCard.tsx`
- Modify: `apps/web/src/screens/trade/SellerConfirm.tsx`, `apps/staff-web/src/screens/ModCase.tsx`, `apps/api/src/disputes/staffRoutes.ts` (blurred proof read via `readProof`, logged `proof.opened`)
- Test: `apps/web/e2e/proof-card.spec.ts`, `apps/staff-web/e2e/proof-card.spec.ts`

**Interfaces:**
- Consumes: Task 9 `checkProof`, `proofCardLines`; Task 13 `ocr`; Task 14 `readProof`.
- Produces:
  - `SmartProofCard({ trade, proofs })`: the **seller's own app** runs `ocr` on the blurred image it decrypted (never trusting values from the buyer) and renders `proofCardLines` under "We checked <buyer>'s screenshot", with the board's "Screenshots can be faked" caution and the closing bank line. With no proof the card is absent and the bank check line from Plan 3 stays.
  - ModCase "Payment proof": Plan 4's "Request unblurred proof" button is now live. The automatic check follows P5-A36:
    - **(b), the default:** ModCase shows the blurred image and the amount and code to look for, with no OCR, and no OCR assets are served on the staff origin.
    - **(a):** staff-web runs the same check in the moderator's browser. This needs `'wasm-unsafe-eval'` and `worker-src 'self'` in the staff-web CSP, `/ocr/*` with the worker CSP served from staff-web, and a staff-web CSP test.
    - Under Plan 4's CSP as written, Tesseract cannot run on the staff origin.

- [ ] **Step 1: Write the failing tests:** parity SellerConfirm (card unmasked) with the board fixture → the three board lines; a $400 fixture → the mismatch line in caution; an unreadable image → the couldn't-read line; the closing line is present in every variant; the card never enables the release button by itself (release still needs the checkbox and `releasable`); ModCase parity at 1280 with the card; opening the proof writes one `proof.opened` entry before bytes are returned.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: smart proof card for sellers and moderators`.

### Task 17: End-to-end reputation and proof flows (Playwright and regtest)

**Files:**
- Create: `apps/web/e2e/reputation.e2e.spec.ts`
- Modify: `apps/web/e2e/stack.ts` (OCR assets served; staff-web from Plan 4's stack when present)

**Interfaces:**
- Consumes: everything above; Plan 3 and Plan 4 stacks.

- [ ] **Step 1: Write the failing e2e tests** at 390×844 and 1280×800, two trader contexts plus a moderator context:
  - **Proof to review:** fund → 12 blocks → the buyer adds a proof (fixture receipt), checks the blur, sends, taps I've paid → the seller sees the thumb and the smart card with "the right amount" → hold to release → both see the rating card. The seller rates 5 stars; the buyer's profile shows no change; the buyer rates Neutral; both reviews appear on both profiles and % positive updates.
  - **7-day reveal:** only one side rates; the clock moves 7 days; the review appears; the silent side's Trade tap shows the rating card first.
  - **Starter + New:** a fresh account shows New featured on its offer card, cannot hide it, and keeps it at 19 trades (seeded) until graduated (spec 2.3).
  - **Unblurred request:** a dispute opens; the moderator requests the unblurred copy; the buyer sends it; the moderator's case shows it; the seller's network log never contains a successful fetch of that proof id.
  - **Past reputation:** a trader proves an Ed25519 key, the moderator approves with 1,240 trades seen, and the profile shows "Verified: 1,240 trades on LocalMonero (PGP proof)" linking to the archive URL; completed trades unchanged.
  - **Feedback:** after the first completed trade the How's X2F card appears; the stored row has no account link.
- [ ] **Step 2:** Run `npx playwright test -c apps/web/e2e/playwright.config.ts reputation.e2e`; the expected first failure is the stack not serving `/ocr/*` until `copy-ocr-assets` runs in the stack build.
- [ ] **Step 3:** Fix each failure in the owning task's files with a unit test there, and name the task in the commit (`fix(task-N): …`).
- [ ] **Step 4:** Run the e2e suite and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `test: end-to-end reviews, badges, proofs and past reputation`.

### Task 18: Security review of Plan 5, roadmap and owner answers

**Files:**
- Create: `docs/security/plan-5-review.md`
- Modify: `docs/superpowers/plans/2026-10-15-roadmap.md`

- [ ] **Step 1:** Run the Claude Security scan over `packages/reputation`, `packages/proof`, `apps/api/src/{reviews,reputation,feedback,pastrep,proofs,staff}`, `apps/moderation/src/proofs.ts`, `apps/web/src/{proof,screens/proof,screens/review,screens/profile}` and `apps/staff-web/src/screens/{PastRep,Feedback}.tsx`; run Semgrep 1.178.0 and `npm audit --omit=dev`. Ask it specifically about:
  - **Metadata and blur guarantees:** any path where bytes reach `encryptProof` without `cleanImage` + `assertClean`; any chunk or segment the allowlist lets through; whether `redact` output can leak glyph shape (edges, anti-aliasing outside the padding, JPEG ringing across region borders); a manual "remove blur" that silently drops an automatic region the buyer did not see.
  - **Unblurred copy:** any route, envelope or cache by which a trader (or the API alone) can read it; whether the server can tell from sizes or timing more than "an unblurred copy was sent".
  - **OCR supply chain:** that `tesseract.js`, its core and model load only from this origin, with no `blob:` worker, `eval` or network fallback; the size of what was added; the result of `npm audit`.
  - **Review manipulation and sybils under starter limits:** wash trades between one person's accounts (cost: the 1 % fee, paid only by the ad poster, plus network fees, the $200 Starter cap, 3 open trades, and 5–20 trades over 7–30 days before larger caps; the weight floor makes tiny trades count little);
    - **Review bombing:** a fresh account that *takes* a victim's offer pays no X2F fee, only network fees, and as the seller it gets its XMR back on release. A 1-star review costs the attacker one real fiat round trip, and the victim pays the 1 %. Record whether P5-A33 or a per-counterparty rule is needed.
    - Weight leaks through % positive (P5-A32).
    - Late reviews after the reveal (P5-A31). reviews from one counterparty repeated many times; blind-reveal leaks through aggregates, sort order, badge changes or response timing; revenge reviews after reveal; aged dormant accounts farming Veteran. Record which are accepted residuals and which need an owner decision (see "Owner questions" below).
  - **Past reputation:** the signed text binds the X2F name, site, URL, fingerprint, nonce and time; subkey handling; expired, revoked and weak keys; the one-fingerprint-one-account rule; that the server never fetches the URL (SSRF and IP leaks); that no user ID or email inside a key is stored readable, logged or shown (R16); key-ID-only archives are refused (P5-A23).
  - **Privacy of profiles and records:** no login name, amount, volume or exact time; hidden badges truly absent; the record contents; the feedback table's unlinkability.
- [ ] **Step 2:** Fix every confirmed finding in the owning task's files with a test that would have caught it, then re-run `npm run check`.
- [ ] **Step 3:** Record in `docs/security/plan-5-review.md`: the findings and fixes; the accepted residuals with reasons, at least: automatic blur is best-effort (the buyer is told, and reviews the result); the guarantee rests on an honest client bundle (SRI and native builds are Plan 6); OCR cannot read names in non-Latin scripts at launch; collusive review rings between real, separately funded accounts are not detectable from trade data alone; Security key verified is self-reported unless the owner chooses attestation (P5-A14); feedback is unlinkable in storage but the API process sees the session at request time; ciphertext sizes reveal approximate image size. List every P5-A assumption with the owner's answer.
- [ ] **Step 4:** Update the roadmap row for Plan 5 to "Built" with the review file, and add any deferred item (for example non-Latin OCR models, review reporting) to "Deferred items and their owners".
- [ ] **Step 5:** Commit `docs: plan 5 security review and roadmap`.

## Owner questions (plain language, for approval of this draft)

1. **What counts as a positive review?** Default: 4–5 stars positive, 1–2 negative, 3 stars and Neutral don't count either way (P5-A1).
2. **How much more should a big trade's review weigh?** Default: in proportion to its dollar value, from $10 up to $1,000, then flat (P5-A2).
3. **Which trades get rated?** Default: completed releases, and disputed trades once settled. Not cancels or refunds without a dispute (P5-A3).
4. **Should the New badge use one of the two Featured spots?** Default: yes (P5-A11).
5. **"Security key verified": prove it's real hardware?** That means X2F learns the key's make and model. Default: no, any key registered as a security key counts (P5-A14).
6. **Should milestones and Trusted count only trades with different people?** Someone could trade with their own second account to farm "10 trades". Default: count every completed trade, as the spec says; the Starter cap and fees make farming slow and costly.
7. **Old PGP keys:** accept 2048-bit RSA keys for past reputation (login needs 4096)? Default: yes (P5-A22). Require the archive to show the full fingerprint? Default: yes (P5-A23). Only archive.org / archive.today links? Default: yes (P5-A20).
8. **Portable record:** signed by X2F's key, private until the trader chooses to show it, listing month, role, stars and phrases per trade (no amounts or names). OK? (P5-A18)
9. **Blur look:** a frosted solid patch rather than a see-through blur, because light blur can be undone. OK? (P5-A26)
10. **Name check on the proof card:** X2F knows no real names, so the card can only say whether a name is hidden or visible. OK to drop "name doesn't match the buyer"? (P5-A28)
11. **Review notes:** refuse notes with personal details (emails, phone numbers, account numbers)? Default: yes (P5-A6). Should traders be able to report an abusive review to a moderator? Not in the spec; not built. *Answered 2026-10-29 (owner): yes, the rated person can dispute a review (new Task 19).*
12. **Feedback:** who reads it? Default: the owner only, kept one year (P5-A19).
13. **Blur editor screen:** please add a "Check your proof" board to the canvas, or approve building it from design-system parts (Task 15).

*Added by the plan review, 2026-10-24:*

14. **Rating after the other review is already visible.** If someone stays silent for 7 days, they see the other person's review, and then have to rate before their next trade. That is a revenge review. Should a late rating be Neutral only, should the window just close, or keep it as is? (P5-A31)
15. **Big-trade weighting can reveal trade sizes.** When one new review moves a trader's % positive, the size of the jump hints at how big that trade was. Use a few weight steps instead of exact dollars, hide % positive until 5 reviews, or both? (P5-A32)
16. **The same partner rating someone over and over.** Should only each partner's latest review count? (P5-A33)
17. **Profiles show "online" and "last seen" to anyone, for any name.** Limit profiles to people with an offer or a completed trade, round "last seen", or both? (P5-A34)
18. **PGP fingerprint in the exported record.** It links the X2F name to the PGP key, and through it often to an email address. Make it opt-in at export and never in the public copy? (P5-A35)
19. **Automatic proof check on the moderator's screen.** It needs WebAssembly allowed on the staff site, which widens that site's attack surface. Allow it, or show moderators the blurred image without the check? (P5-A36)
20. **(For the lead) Who adds display names?** No plan yet adds the display name / login name split (spec 6.1). Plan 5 cannot start its profile and review screens without it.

## Revision 2026-10-28 (lead, from the owner's decisions of 2026-10-27)

Authority: spec > `rulings-and-lessons.md` > earlier revisions > this note.
- **Proofs follow the self-delete schedule.** Task 14's `purgeProofs` keeps its 90-day and dispute rules, and Plan 7 Task 3 additionally hides and destroys a side's own proofs and evidence on that side's self-delete schedule (`trade_proofs.uploader_role` is the key, so keep that column exactly as drafted). A proof is never removed while a dispute is open.
- **P5-A29 (the buyer keeps the unblurred original on the device)** shortens with self-delete: the copy is deleted from IndexedDB at the buyer's own destroy time (Plan 7 Task 4 `localPurge`), but never while a dispute is open.
- **Whole-trade delete keeps reviews working.** A review references the bare trade record that Plan 7 keeps (P7-A6); Task 3 must not join reviews to anything a whole-trade delete removes (method, amounts).
- **"Delete my own account"** is an undecided comparison gap (Plan 7 "Owner questions"); if approved, it is a new task here after Task 12 (reviews then show "Deleted user").


## Revision 2026-10-29 (owner)

Authority: spec (Revision 2026-10-29) > `rulings-and-lessons.md` > earlier revisions > this note. Source: the owner's answers of 2026-10-29 (`~/x2f-comms/owner-answers-2026-10-28.md`), recorded in the spec and `HANDOFF.md` "Decided 2026-10-29 (owner)".

- **All feedback is permanent** (owner, "like Amazon or Uber"). Reviews survive the 30-day trade delete (Plan 7 Task 2). So Task 3's `reviews` table must **not** reference `trades(code)`: it holds everything it needs itself (reviewer, subject, role, stars, phrases, note, trade badges, the weight, method name, the review date). The trade code is kept only until the trade is purged, then nulled. New Task 20 does this. This supersedes the 2026-10-28 line "a review references the bare trade record": there is no per-trade stub any more.
- **What a review holds** (owner): a custom comment (the note), templated comments (the phrases), **badges that describe the trade** (new: a short owner-approved list, for example "Smooth trade", "Great communication"; `// COPY-UNSIGNED` until the owner gives the list), and a star rating. ~~**1–5 or 1–10 is not decided:** Task 1 reads `STAR_MAX` (default 5) and P5-A1's thresholds scale with it.~~ *2026-10-29b: 1–5 only (design reports the owner's answer).*
- **Review disputes** (owner): the person rated can dispute a review and have it moderated (retaliation, a competitor, doxxing and similar). This answers owner question 11 ("not built") with yes: new Task 19.
- **Lost disputes still count** (owner). P5-A13: `completedTrades` = released trades **plus settled disputes, whoever won**. Clean record still needs zero lost disputes, from the running total. No stage drop (Plan 3 Revision 2026-10-29).
- **Running totals instead of per-trade rows.** After the 30-day delete, stats can't be computed from `trades`. New Task 20 keeps per-account running totals (completed trades, lost disputes, cancels, trades reaching funding) updated when each trade or dispute ends. **Decided (lead call, 2026-10-29):** P5-A8 `typicalMinutes` (median of the last 20 action times) and P5-A9 cancel rate need more than a count, so each account keeps its last 20 action durations, in minutes, with no trade code or date. The owner still has to confirm the running-totals approach (answers, Q3 "pending confirmation").
- **Feedback link on every "can't do that" popup** (owner): new Task 21 adds the feedback form (complaint, feedback or recommendation; named or anonymous) and the shared `CantDoThat` popup. Task 4's "How's X2F doing?" card stays as it is.
- **P5-A29** (the buyer keeps the unblurred original on the device until no dispute is possible) follows the dispute-after-refund window, which is open (Plan 3 Revision 2026-10-29).
- **The self-delete lines of Revision 2026-10-28 are superseded.** There are no per-side self-delete times. Proofs are deleted with the trade, 30 days after it ends, or 90 days after ~~the dispute button~~ the dispute closing (owner p11-11, 2026-11-09) for a disputed trade (Task 14's `purgeProofs` takes both numbers).
- **Delete my account** is decided (yes) and planned in Plan 7 (new Task 18). Reviews by and about a deleted account stay (they are permanent) and show "Deleted user".

### Task 19: Review disputes — NEW 2026-10-29

**Scope:** the rated person can dispute a review; a moderator decides to keep it, remove it, or remove only the note.

**Files:**
- Create: `apps/api/migrations/3xx_review_disputes.sql`, `apps/api/src/reviews/disputes.ts`, `apps/staff-web/src/screens/ReviewDisputes.tsx`, `apps/web/src/screens/review/DisputeReview.tsx`
- Test: `apps/api/test/reviewDisputes.test.ts`, `apps/staff-web/e2e/reviewDisputes.spec.ts`, `apps/web/e2e/disputeReview.spec.ts`

**Interfaces:**
- Produces:
  - `review_disputes(id, review_id, reason 'retaliation'|'competitor'|'doxxing'|'other', note ≤ 1000, status 'open'|'kept'|'removed'|'note-removed', decided_by, decided_at)`; one open dispute per review. *2026-10-29b (owner): statuses `open | stands | comments-removed | removed`, and an open dispute shows "Under review" at once; see Revision 2026-10-29b.*
  - `POST /v1/reviews/:id/dispute` (the subject only, once the review is revealed). Staff: `GET /staff/v1/review-disputes`, `POST …/:id/decide { outcome, reason ≥ 20 }` (perm `reputation.review`). Each step is logged without the note text.
  - A removed review no longer counts anywhere (stats, badges, profile); its row is kept with `removed_at` so the decision can be checked.
  - The moderator sees the review and the reason. If the trade is already purged (older than 30 days), there is no chat to read; the decision rests on the review text and the reason. (See the open point in the final report.)
- [ ] **Step 1: Write the failing tests:** only the subject can dispute; a second open dispute → 409; `removed` drops the review from `positivePct` and the profile; `note-removed` keeps the stars; a helper gets `forbidden`; parity for both screens.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: review disputes moderated by staff`.

### Task 20: Permanent reviews and running totals — NEW 2026-10-29

**Scope:** make reputation survive the 30-day trade delete with no per-trade stub.

**Files:**
- Create: `apps/api/migrations/3xx_permanent_reputation.sql`, `apps/api/src/reputation/totals.ts`
- Modify: Task 3 `reviews` (drop the foreign key to `trades`, add the columns it needs), Task 5 `badgeFactsMany` and `TraderSummary` (read totals, not `trades`), Plan 3 `tradeCap` (completed count from totals), Plan 7 Task 2 (calls `addToTotals` before deleting a trade)
- Test: `apps/api/test/reputationTotals.test.ts`

**Interfaces:**
- Produces:
  - `account_totals(account_id pk, completed int, lost_disputes int, funded int, cancels int, recent_action_minutes int[] /* last 20, no codes or dates */, updated_at)`.
  - `addToTotals(client, trade)`: runs once per trade when it closes (released, refunded, cancelled) or its dispute settles; idempotent (a flag on the trade until it is purged).
  - Stats, starter-limit stages and badges read `account_totals` and `reviews`, never `trades`, so nothing changes when a trade is purged.
- [ ] **Step 1: Write the failing tests:** a profile and `tradeCap` give the same answer before and after the trade is purged; a settled dispute counts as completed and a lost one also adds to `lost_disputes`; running the hook twice adds once; a review survives its trade's purge and still shows its method name and age.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): permanent reviews and running reputation totals`.

### Task 21: Feedback form and the "can't do that" popup — NEW 2026-10-29

**Scope:** every popup that tells a user they can't do something carries a feedback link; the form takes a complaint, feedback or recommendation, named or anonymous.

**Files:**
- Create: `apps/web/src/ui/CantDoThat.tsx`, `apps/web/src/screens/Feedback.tsx`, `apps/api/migrations/3xx_feedback_form.sql`
- Modify: `apps/api/src/feedback/routes.ts`, the staff Feedback page (Task 4), every existing refusal popup (Plan 3 caps, starter limit, trading hold, review pending, lien, ban, and later ones)
- Test: `apps/web/test/CantDoThat.test.tsx`, `apps/api/test/feedbackForm.test.ts`, `apps/web/e2e/feedback.spec.ts`, a copy-lint rule

**Interfaces:**
- Produces:
  - `CantDoThat({ title, body })` always renders "If you feel this feature can be improved please leave feedback" with a link to `/feedback?from=<refusal code>`.
  - The form: kind (Complaint, Feedback, Recommendation), text, and a **"Send anonymously"** checkbox. Anonymous rows hold no account id (as Task 4); named rows hold the account id so staff can reach out for details (P5-A19 changes for named rows only).
  - After sending: "Thank you! Each and every comment is appreciated and reviewed to help make this community a better place for us all." (owner wording).
  - `POST /v1/feedback/form { kind, text ≤ 2000, anonymous, from? }` → 202; the staff Feedback page lists both kinds.
  - **Copy-lint rule:** a component that shows a refusal without `CantDoThat` fails the check (local tree only).
- [ ] **Step 1: Write the failing tests:** an anonymous row has no account id (schema check); a named row has it; the thank-you text is exact; every refusal popup in `apps/web` uses `CantDoThat` (the lint); parity.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: feedback form linked from every can't-do popup`.

## Revision 2026-10-29b (owner + design)

Authority: spec (Revision 2026-10-29b) > `rulings-and-lessons.md` > earlier revisions > this note. Sources: the owner's words of 2026-10-29 08:03 (`~/x2f-comms/owner-answers-2026-10-28.md`, item c), the lead's calls of 2026-10-29 (`~/x2f-comms/owner-answers-2026-10-29-lead-calls.md`) and Claude Design's update (`origin/wip/design-brief`, Reviews board). The owner's words win over the design's summary.

- **Reviews are very public but anonymous** (owner). Nothing on a review can link it to whoever left it: **no username, no account number, no order or trade number**. This changes Tasks 3, 5, 6, 12 and 20:
  - Every public review reader (profile, offer card popups, the portable record of Task 12) returns only the subject, stars, phrases, note, trade badges, method name and a coarse date. It never returns the reviewer's name or id, the trade code or anything derived from them. *Lead default (2026-10-29b), owner may change:* the date is shown as month and year only, so the exact time can't be matched to a trade.
  - *Lead default (2026-10-29b), owner may change:* the stored link to the reviewer (Task 3's `reviewer_id`) is kept only as long as the rules need it (blind reveal, one review per trade, the rate-first gate), and is nulled together with the trade code when the trade self-destructs (Task 20, Plan 7 Task 2). The role (buyer or seller) and the weight stay.
  - A new test in Task 20: after the trade is purged, no column of `reviews` holds the reviewer's id or the trade code; a public profile response contains neither the reviewer's name nor any trade code at any time.
- **A disputed review immediately shows "Under review"** (owner: the benefit of the doubt goes to the person reviewed), from the moment the dispute is filed until a moderator decides. Task 19's outcomes become the owner's three: **remove some comments** (`comments-removed`: the moderator removes the note, chosen phrases or badges, and the stars stay), **let it stand** (`stands`), or **remove the review entirely** (`removed`). They replace `kept` / `removed` / `note-removed`.
  - *Lead default (2026-10-29b), owner may change:* while "Under review", the review is shown with its label but does not count in `positivePct`, Trusted or the other badges; it counts again if it stands. That is the benefit of the doubt.
  - **Reasons (design reports the owner's answer, 2026-10-29b):** no reason list for now. Disputing is a "Dispute" button and a required free-text reason; Task 19's `reason` enum becomes `reason_text` (≤ 1000, required), and the `note` column goes. Pickable reasons may come later from common answers.
- **Stars are 1–5 only** (design reports the owner's answer, 2026-10-29b; the 1–10 variant is dropped). `STAR_MAX` is the constant 5, not a setting; P5-A1's thresholds stay as written. Stars are amber everywhere (design).
- **Task 21 (feedback):**
  - **Replies to named feedback are in the app only,** never by email: staff reply through a ticket thread and an alert (Plan 4 Revision 2026-10-29b, Tasks 30–31). Anonymous feedback has no reply.
  - *Lead call 2026-10-29:* sending feedback anonymously does not update "last seen" (the request does not touch `sessions.last_seen_at`), and the anonymous copy promises only **"We don't record who sent it."** Tests: an anonymous send leaves `last_seen_at` unchanged; the copy is exact.
- **Completed trades (R38, lead call):** released trades plus refunded trades that had a dispute; a settled dispute counts whoever won (P5-A13 as revised on 2026-10-29).

## Revision 2026-10-29c (owner)

Authority: spec (Revision 2026-10-29c, 5.4) > `rulings-and-lessons.md` (R38) > earlier revisions > this note. Source: the owner's words of 2026-10-29 (`~/x2f-comms/owner-answers-2026-10-28.md`, "Profile: owner leans to showing 'Disputes: N won, M lost'", confirmed in the lead's brief of 2026-10-29c).

- **Profiles show "Disputes: N won, M lost"** (Tasks 5, 12, 20). Task 20's `account_totals` gains `won_disputes int` beside `lost_disputes`; `addToTotals` adds one to the winner's `won_disputes` and the loser's `lost_disputes` when a dispute settles. Task 5's `TraderProfile.stats` gains `disputesWon` and `disputesLost`; Task 12's profile screen shows "Disputes: 3 won, 1 lost" `// COPY-UNSIGNED` (with none: "Disputes: none"). Plan 4 Task 25's record fix after an overturned ruling swaps the two counts for round 1. Tests: a settled dispute adds one won and one lost, once; the counts survive the trade purge; an overturned ruling swaps them.
- **A lost dispute still counts as a completed trade** (R38, unchanged), and Clean record still needs zero lost disputes.
- **The dispute screen's footer "It appears on your profile as a lost dispute" stays** (Plan 3 Task 27, owner).
- **Task 21 (`CantDoThat`):** the lien refusal (`lien`, Plan 4 Task 25) and the 24-hour hold refusal (`recovery-hold`, Plan 2 Task 17) use the popup.
