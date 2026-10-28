# Plan 7: Privacy controls, off-app alerts and the public site — Implementation Plan (DRAFT for owner approval)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: DRAFT, 2026-10-28 (lead).** Written from the owner's decisions of 2026-10-27 (`HANDOFF.md`, "Decided 2026-10-27 (owner)") and the OpenMonero comparison (`research/openmonero-parity-2026-10-27.md`). Nothing is built from this plan until the owner answers Q1 below and approves the draft. Tasks 1–4 also wait for Q1, because it sets the deletion clocks.

**Goal:** Traders choose how soon their own messages and details disappear from a finished trade, and can agree to delete a whole trade; they can get encrypted trade alerts outside the app over Nostr or PGP-encrypted email; and anyone can learn what X2F is from a public site with a FAQ, a searchable support centre, guides and a published policy on lawful requests. The owner sees aggregate statistics collected from day one; publishing them is decided later.

**Architecture:**
- **`packages/trade` (`@x2f/trade`)** gains the pure self-delete rules (`selfDeleteSchedule`), next to the merged chat retention rule (`chatPurgeDue`, `packages/trade/src/chat.ts`).
- **`apps/api`** gains the privacy settings, the self-delete purge jobs (on the one `startRetention` scheduler, `apps/api/src/retentionJobs.ts`), the alert channels with a single fan-out `notify()`, the Nostr and email senders, and the daily statistics job.
- **`apps/web`** gains Settings → Privacy and Settings → Notifications, and the public pages. Public pages are React components rendered to static HTML at build time (`react-dom/server`, already a dependency), so they work with JavaScript off (Tor Browser "Safest") and can be indexed. Content lives in typed TypeScript objects, not Markdown, so no renderer is added.
- **`apps/staff-web`** (Plan 4) gains an owner-only statistics panel on StaffOverview.

**Tech Stack:** as pinned on the main line (Node 24.22.1, npm 11.21.0, TypeScript 7.0.2, vitest 5.0.3, fastify 5.12.x per R31, pg 8.23.1, openpgp 6.3.2, React 19.3.0, Vite as pinned, @playwright/test 1.63.0, Semgrep 1.178.0). **New dependencies, chosen at task time under the 14-day rule** (`npx -y npm@11.21.0 view <pkg> time --json`; the version and its publish date go in the commit message; `npm audit --omit=dev` must stay at 0 apart from R31/R33 exceptions):
- **Task 6 (Nostr):** `nostr-tools` (NIP-17 private messages, NIP-44 encryption, NIP-59 gift wrap), in `apps/api` only. If its transitive tree is large, the task may instead pin only `@noble/curves`, `@noble/hashes` and `@noble/ciphers` and hand-write the three NIPs against their published test vectors. The task records which and why.
- **Task 7 (email):** an SMTP client (`nodemailer`, which has no dependencies), in `apps/api` only, unless Q-P7-A7 picks a mail route that needs none.

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md`: 1 (principles: privacy, bare minimum), 2.3 (disputes, dispute after refund), 4.1 (data rules, retention, lawful requests, Tor), 6.2 (PGP rules, R16: nothing from inside a key but its fingerprint is shown or logged), 6.3–6.4 (alerts), 6.5, 6.6 (moderators read chats once a dispute opens; training library). **Owner decisions:** `HANDOFF.md` "Decided 2026-10-27". **Boards:** none exist yet for Privacy, Notifications or the public pages; each screen task starts with a controller design step on the X2F App canvas (HANDOFF "Next steps" 6 already lists Settings and FAQ as still to design).

**Builds on:** Plan 3 Tasks 5, 6, 19, 20 and 30 (Task 20 must store each chat envelope's sender role; see the Plan 3 "Revision 2026-10-28" note), Plan 4 (StaffOverview, `appendLog`, dispute status, the R6 purges in its new Task 23), Plan 5 Task 14 (proof storage; its purge follows this plan's schedule), Plan 6 Task 2 and its new Task 28 (Tor egress for outbound calls).

## Global Constraints

- **Privacy (spec 4.1).** No IP is stored or logged. Logs never contain trade codes, display names, Nostr keys, email addresses, PGP fingerprints, alert text or search queries. `disableRequestLogging: true`, `trustProxy` never set.
- **Deletion is real.** A purge deletes rows (or nulls columns) with the `x2f_purge` role; nothing is "soft-deleted" with a flag and kept. Backups keep deleted data for up to D6 days (Plan 6 gap G1), and the Privacy screen and FAQ say so.
- **A dispute always keeps its evidence.** No self-delete job removes anything from a trade while a dispute on it is open (spec 2.3, owner 2026-10-27). What happens after the dispute closes follows the owner's answer to Q1.
- **Moderator reading rules are unchanged** (owner 2026-10-27, spec 6.6): chat stays readable by the moderator once a dispute opens; before that, rules and the activity log stop them, not encryption. This plan changes no chat key.
- **Alerts say nothing.** Every off-app alert body is exactly one of the fixed push texts ("Someone nudged you on X2F", "Something changed in a trade on X2F", and for the owner "Something needs your attention"), with no trade code, display name, amount or link beyond the site root. Email subjects are exactly "X2F alert".
- **Stored alert addresses are secrets.** A Nostr public key or an email address is sealed with `SecretBox` (FU-C; async after Plan 6 Task 9) before it is stored, is never returned in full by any route (only "Nostr · npub1…k3f9" or "Email · m…@…" style hints), is never shown to staff, and is deleted when the user turns the channel off.
- **Outbound calls go over Tor** once Plan 6 Task 28 exists (Nostr relays and the mail route then never see the server's IP). Before that, the senders run only in development and tests.
- **Public pages are static and private.** No analytics, no third-party scripts, styles or fonts, no forms that post anywhere except the in-app support search, which never leaves the device. Every page works with JavaScript off.
- **Statistics are aggregates only.** No per-account row, no IP, no device data. Each stored figure is a daily count or sum over at least one dimension (currency, method), computed from records X2F already has, before the retention jobs remove them.
- Every dependency is pinned exactly and passes the 14-day rule. `npm run check` (queued through `~/x2f-comms/run-check.sh`, R32/R34) passes at the end of every task. Tests run as `npm test -- --project <workspace>`, wrapped in `flock ~/x2f-comms/check.lock`.
- Migrations are numbered `7xx`, one per task that needs schema. Every module takes `clock: () => Date`.
- Every new refusal code joins Plan 2's `ApiErrorCode` and is thrown as `ApiError`.
- **UI.** Copy from the boards once designed; spec wording where no board exists; anything else is `// COPY-UNSIGNED` for the owner (and the lawyer for the lawful-requests page). Night theme first, exactly one `data-primary` per screen, no emoji, no exclamation marks. `expectParity` at 390×844 for app screens and at 390×844 and 1280×800 for public pages. Never run Playwright with `--update-snapshots`.

## Assumptions (owner has not decided yet; each is used only through the named constant or setting)

- **P7-A1 Defaults.** Both self-delete settings start **off**: a trade then follows the standard retention (90 days after close, spec 4.1). "1 month" means 30 days.
- **P7-A2 When a setting applies.** Each side's settings are copied onto the trade when it starts (the Trade tap). Changing a setting affects later trades only, so the counterparty always knows the rule before trading. The trade room shows it: "<name>'s messages in this trade disappear 1 day after it ends." `// COPY-UNSIGNED`
- **P7-A3 What "your part" is.** The messages that side sent in the trade's chat (including the pre-trade chat that became the trade), the proofs and evidence that side uploaded (Plan 5), and that side's address on the trade (`buyer_payout` or `seller_refund`).
- **P7-A4 Refunded trades and short times.** On a released trade nothing can be disputed any more, so "your part" is deleted at the chosen time. On a refunded or cancelled trade the buyer can still dispute (spec 2.3, OD-8), so at the chosen time "your part" is hidden from the other trader, but X2F keeps the sealed copy until **7 days after the trade ended** (`SELF_DELETE_DISPUTE_HOLD_DAYS = 7`, the owner's "1-week mark"), then destroys it unless a dispute was opened. The Privacy screen says so.
- **P7-A5 Different whole-trade choices.** If both sides have "delete the whole trade" on with different times, the longer one applies (both agreed to at least that).
- **P7-A6 What stays after a whole-trade delete.** A bare record: the trade code, state, outcome, close date, the USD-equivalent band used by starter limits, and the fee. Starter limits (spec 2.3), reviews (Plan 5), earnings (Plan 4) and the append-only activity log (which never holds chat text or addresses) need it. Method, amounts, chat, proofs and addresses go. The Privacy screen says so.
- **P7-A7 Mail route for PGP email alerts.** Options: (a) a small mail host X2F runs (Postfix, DKIM, SPF), sending over Tor where the receiving server accepts it; (b) a paid SMTP relay service, which then sees every recipient address and send time; (c) defer email and ship Nostr first. Rec.: (c) then (a). Email headers (To, time) are never encrypted by PGP; the screen says so.
- **P7-A8 Which events alert.** Per channel, two switches: "Trade changes" (default on) and "Nudges" (default off). The final alert (Plan 3 Task 25) always goes to every channel that is on, whatever the switches say.
- **P7-A9 Public site address.** The public pages live under `/about`, `/faq`, `/help`, `/guides/<slug>`, `/download`, `/legal/requests` and `/security` (Plan 6 Task 24) on the app's own origin (clearnet, onion, I2P). The app's home screen stays at `/` with a "New to X2F?" link to `/about`. Option: make `/about` the home for visitors. Owner to choose.
- **P7-A10 Statistics kept.** Daily, per currency and method: offers live at midnight UTC, trades started, trades completed, trades refunded or cancelled, disputes opened and closed, completed XMR volume; and new accounts per day (site-wide only). Kept indefinitely (they hold no personal data). Owner-only view. Any later publication hides every figure built from fewer than `STATS_PUBLISH_MIN_COUNT = 5` trades.

## Interfaces assumed from Plans 2–6 (reconcile here only)

- Plan 2: `requireSession`, `requireTrader`, `ApiError`, `SecretBox` (`seal`/`open`; async after Plan 6 Task 9), openpgp 6.3.2 strict config and the key checks from Plan 2 Task 7 (`readPublicKey`, encrypt-capable subkey check, R16 fingerprint-only rule).
- Plan 3: `trades` row (`code`, `state`, `closed_at`, `buyer_payout`, `seller_refund`, roles), Task 5 take transaction, Task 6 `applyEvent` and `toTradeView`, Task 19 `publish` and `sendPush(accountId, kind)`, Task 20 chat envelope storage (with `sender_role`, Revision 2026-10-28) and `purgeChats`, `RETENTION_JOBS`, `owner_settings`.
- Plan 4: dispute status per trade (`openDisputeFor(code)`), `appendLog`, StaffOverview, Perm list (adds `stats.read`, owner only), and Task 23's R6 purges.
- Plan 5: `trade_proofs` with `uploader_role`, `purgeProofs`.
- Plan 6: Task 24 `/security` page, Task 28 `torFetch` and Tor SMTP/WebSocket egress, Task 27 I2P site profile, D6 backup retention.

## Review Focus

1. **A dispute is never stripped of evidence.** Open a dispute at every point of each schedule (before the hide time, between hide and destroy, one second before destroy) and check the moderator still reads every message and proof.
2. **Hidden means hidden.** After the hide time, no trader route (`GET …/envelopes`, proof `GET`, trade view) returns the hidden part, on any device of either account.
3. **The whole-trade delete needs both.** One side on and the other off deletes nothing beyond each side's own part.
4. **Alerts leak nothing.** Each sender's output, captured in tests, holds only the fixed text; no log line holds a Nostr key, email or fingerprint.
5. **Public pages work with JavaScript off** and load nothing from another origin.

---

## Part A — Self-delete (owner 2026-10-27)

### Task 1: Self-delete schedule (`@x2f/trade`)

**Files:**
- Create: `packages/trade/src/selfDelete.ts`
- Modify: `packages/trade/src/index.ts`
- Test: `packages/trade/test/selfDelete.test.ts`

**Interfaces:**
- Produces:
  - `type OwnLifetime = '1h' | '1d' | '1w' | '1m' | null`; `type TradeLifetime = '1w' | '1m' | null`.
  - `interface SelfDeleteFacts { closedAt: Date | null; outcome: 'released' | 'refunded' | 'cancelled' | null; own: { buyer: OwnLifetime; seller: OwnLifetime }; whole: { buyer: TradeLifetime; seller: TradeLifetime }; disputeOpen: boolean; disputeClosedAt: Date | null }`
  - `selfDeleteSchedule(f: SelfDeleteFacts): { hideAt: Record<'buyer'|'seller', Date | null>; destroyAt: Record<'buyer'|'seller', Date | null>; wholeAt: Date | null }`, applying P7-A1, A4 and A5 and the Q1 answer (`POST_DISPUTE_KEEP_DAYS`, a constant set from Q1).
  - `selfDeleteDue(f, now): { hide: Role[]; destroy: Role[]; whole: boolean }`. While `disputeOpen` every list is empty and `whole` is false.
- [ ] **Step 1: Write the failing tests:**
  - Released trade, buyer `1h`: buyer hide and destroy at close + 1 h; seller unaffected.
  - Refunded trade, seller `1h`: hide at close + 1 h, destroy at close + 7 days (P7-A4).
  - Whole-trade `1w` on one side only → `wholeAt` null; `1w` and `1m` → close + 30 days (P7-A5).
  - A dispute open at any instant → nothing due; after it closes, the Q1 rule applies.
  - An open trade (`closedAt` null) → nothing due.
- [ ] **Step 2:** Run `flock ~/x2f-comms/check.lock npm test -- --project @x2f/trade`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(trade): self-delete schedule`.

### Task 2: Privacy settings and the per-trade snapshot (`apps/api`)

**Files:**
- Create: `apps/api/migrations/701_privacy_settings.sql`, `apps/api/src/privacy/routes.ts`
- Modify: the Plan 3 Task 5 take transaction (`apps/api/src/trades/take*.ts` or as built), `apps/api/src/trades/view.ts`
- Test: `apps/api/test/privacy.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Table `privacy_settings(account_id pk, own_lifetime text null, whole_lifetime text null, updated_at)`; trade columns `buyer_own_lifetime`, `seller_own_lifetime`, `buyer_whole_lifetime`, `seller_whole_lifetime`, written once, in the take transaction (P7-A2).
  - `GET /v1/account/privacy` → `{ ownLifetime, wholeLifetime }`; `PUT` the same (`requireTrader`; values outside the unions → 400).
  - `TradeView.selfDelete = { mine: {...}, theirs: {...}, wholeAt: string | null }` so the trade room can show the notice.
- [ ] **Step 1: Write the failing tests:** a setting changed after the take does not change that trade; the counterparty sees the other side's lifetimes in the trade view and nobody else does (404 for a third account); bad values → 400; staff and owner kinds get 403 `wrong-account-kind`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): privacy settings copied onto each trade`.

### Task 3: Self-delete purge job (`apps/api`)

**Files:**
- Create: `apps/api/src/privacy/purge.ts`, `apps/api/migrations/702_self_delete.sql` (`hidden_at` on chat envelopes and proofs, readable only through the trader routes' filter; `trade_tombstones` if the whole-trade delete needs one)
- Modify: `apps/api/src/retentionJobs.ts` (append `purgeSelfDelete`), the Plan 3 Task 20 envelope `GET` route and the Plan 5 Task 14 proof `GET` route (filter hidden rows for traders)
- Test: `apps/api/test/selfDeletePurge.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; Plan 3 Task 20 `sender_role`; Plan 5 `trade_proofs.uploader_role` (if Plan 5 is not built yet, the proof part is a no-op with a TODO test that turns on when the table exists); Plan 4 `openDisputeFor`.
- Produces:
  - `purgeSelfDelete(db, now)`, running as `x2f_purge`: for each closed trade with a non-null schedule, sets `hidden_at`, deletes rows due for destruction, nulls that side's address, and for a whole-trade delete removes method, amounts, chat, proofs, addresses and `trade_events` details, keeping the bare record (P7-A6).
  - The moderation process can still read hidden rows until they are destroyed (a dispute opened in the hold window sees everything).
- [ ] **Step 1: Write the failing tests:** Review Focus 1–3 as database tests on a fixed clock; the app role cannot UPDATE `hidden_at` or DELETE; a captured logger holds no trade code; the job is idempotent when run twice.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): self-delete purge, never during a dispute`.

### Task 4: Settings → Privacy and the trade-room notice (`apps/web`)

**Files:**
- Create: `apps/web/src/screens/settings/Privacy.tsx`, `apps/web/src/chat/localPurge.ts`
- Modify: the Settings menu, `ChatPanel` (Plan 3 Task 20), the trade header (notice line)
- Test: `apps/web/e2e/privacy.spec.ts`, `apps/web/test/localPurge.test.ts`

**Interfaces:**
- **Controller step (design):** add a Privacy board and the trade-room notice to the X2F App canvas and `design/x2f-app/`; owner signs off the copy.
- Produces: two choices ("My messages and details", "The whole trade, if the other trader agrees"), each with "Off" first; the plain statement of P7-A4 and P7-A6; "Deleted from X2F's servers and from this app. The other trader may still have taken a screenshot. Backups are cleared within <D6> days." `// COPY-UNSIGNED`. `localPurge` deletes cached messages, proofs and closed-trade escrow state from IndexedDB once the trade view says they are past their time.
- [ ] **Step 1: Write the failing tests:** saving a choice round-trips; the notice shows the counterparty's choice; after the hide time (fake clock) the other side's messages vanish from the panel and IndexedDB; parity at 390×844.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): privacy settings and self-delete notice`.

## Part B — Encrypted alerts outside the app (owner 2026-10-27)

### Task 5: Alert channels and one fan-out (`apps/api`)

**Files:**
- Create: `apps/api/migrations/703_alert_channels.sql`, `apps/api/src/alerts/{channels,notify,routes}.ts`
- Modify: every caller of `sendPush` (Plan 3 Tasks 19, 25, 26; owner alerts) to call `notify` instead
- Test: `apps/api/test/alerts.test.ts`

**Interfaces:**
- Produces:
  - Table `alert_channels(id, account_id, kind 'nostr'|'email', sealed_target bytea, hint text, verified_at, trade_changes bool, nudges bool, created_at)`; at most one per kind per account.
  - `notify(deps, accountId, kind: 'trade' | 'nudge' | 'final-alert' | 'owner-alert')` sends Web Push (as today) and queues one job per matching verified channel; sending is asynchronous and never delays the request.
  - `GET /v1/account/alerts` → `{ kind, hint, verified, tradeChanges, nudges }[]`; `PUT /v1/account/alerts/:kind/toggles`; `DELETE /v1/account/alerts/:kind` (deletes the row).
- [ ] **Step 1: Write the failing tests:** the fan-out respects toggles and P7-A8; an unverified channel gets nothing; no route returns `sealed_target`; delete removes the row; a captured logger holds no target.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with stub senders.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): alert channels and a single notify fan-out`.

### Task 6: Nostr alerts (NIP-17)

**Files:**
- Create: `apps/api/src/alerts/nostr.ts`, `apps/api/test/fixtures/nostr-relay.ts` (an in-process relay stub)
- Modify: `apps/api/src/config.ts` (`X2F_NOSTR_RELAYS`, the bot key from the key ring/vault), `apps/api/src/alerts/routes.ts`
- Test: `apps/api/test/nostr.test.ts`

**Interfaces:**
- Produces:
  - `POST /v1/account/alerts/nostr { npub }`: validates the key, seals it, and sends a gift-wrapped (NIP-59) NIP-17 message holding a 6-digit code; `POST …/nostr/verify { code }` marks it verified (5 tries, 15 min).
  - `sendNostr(target, text)`: NIP-44 encrypted, gift-wrapped with a random ephemeral key and a randomised `created_at` (NIP-59), published to `X2F_NOSTR_RELAYS` through Plan 6 Task 28's Tor egress.
- [ ] **Step 1: Write the failing tests:** the published event decrypts with the recipient's key to exactly the fixed text and to nothing with any other key; the outer event's author is not the bot key; NIP-44 matches the published test vectors; verify with a wrong code 5 times locks it.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement (dependency per the Tech Stack note).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): Nostr alerts over NIP-17`.

### Task 7: PGP-encrypted email alerts (waits for P7-A7)

**Files:**
- Create: `apps/api/src/alerts/email.ts`, `apps/api/test/fixtures/smtp-sink.ts`
- Modify: `apps/api/src/config.ts` (`X2F_MAIL_ROUTE`), `apps/api/src/alerts/routes.ts`
- Test: `apps/api/test/emailAlerts.test.ts`

**Interfaces:**
- Produces:
  - `POST /v1/account/alerts/email { address, publicKey }`: the key must pass Plan 2's checks and have an encryption-capable subkey; the address and key are sealed together; a code is sent PGP-encrypted, and `POST …/email/verify { code }` proves the user holds both the mailbox and the key.
  - `sendEmail(target, text)`: body encrypted to the user's key (PGP/MIME), subject "X2F alert", no other headers beyond the minimum (no `X-Mailer`, no message ID naming the host).
- [ ] **Step 1: Write the failing tests:** the captured message body decrypts with the test key to exactly the fixed text; the subject is exactly "X2F alert"; a key without an encryption subkey → 400 `bad-key`; R16: nothing from the key but its fingerprint is ever logged or returned.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): PGP-encrypted email alerts`.

### Task 8: Settings → Notifications (`apps/web`)

**Files:**
- Create: `apps/web/src/screens/settings/Notifications.tsx`
- Test: `apps/web/e2e/notifications.spec.ts`

**Interfaces:**
- **Controller step (design):** a Notifications board (phone push, Nostr, email; each with its two switches).
- Produces: add, verify, toggle and remove each channel; plain statements of what each channel's operators can see (Nostr relays see when an alert is sent; mail servers see the address and the time) `// COPY-UNSIGNED`.
- [ ] **Step 1: Write the failing tests:** add and verify a Nostr key against the relay stub; remove it; parity at 390×844.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): notification settings`.

## Part C — Public site (owner 2026-10-27: "very important")

### Task 9: Public page shell, static rendering and the content model

**Files:**
- Create: `apps/web/src/public/{Layout,Page,content.ts,render.tsx}`, `apps/web/scripts/prerender.ts`, `apps/web/public/robots.txt`
- Modify: `apps/web/vite.config.ts` (prerender after build), `apps/api/src/static/serve.ts` (serve the prerendered `*.html` for the P7-A9 paths)
- Test: `apps/web/test/prerender.test.ts`, `apps/web/e2e/public.spec.ts`

**Interfaces:**
- **Controller step (design):** public boards on the canvas: About (home for visitors), FAQ, Help (support centre), Guide, Download, Policy. Desktop and phone.
- Produces: `type Block = { h2: string } | { p: string } | { ul: string[] } | { note: string } | { link: { to: string; label: string } }`; `interface PublicPage { slug; title; summary; blocks: Block[]; updated: string }`. `render.tsx` turns a page into static HTML with the same CSP and self-hosted fonts. `/about` introduces X2F (what it is, escrow in three steps, no wallet held, no ID, the 1% fee from ad posters only, Tor and I2P addresses, download links).
- [ ] **Step 1: Write the failing tests:** each path returns 200 HTML with no `<script>` needed to read it (Playwright with JavaScript disabled sees the headings); no request leaves the origin; the CSP header is present; parity at both sizes.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): static public pages`.

### Task 10: FAQ and the searchable support centre

**Files:**
- Create: `apps/web/src/public/faq.ts`, `apps/web/src/public/help/{articles.ts,search.ts,Help.tsx}`
- Test: `apps/web/test/helpSearch.test.ts`, `apps/web/e2e/help.spec.ts`

**Interfaces:**
- Produces:
  - FAQ and support articles as `PublicPage`s, seeded from real questions: the OpenMonero FAQ topics (research table rows 14–16, 18, 22, 29, 33, 34), LocalMonero-era questions, and every `// COPY-UNSIGNED` question raised in Plans 3–6 (backups keep deleted data, G1; IPs in proxy memory, G2; passkeys per address, G3; what moderators can read, spec 6.6; why X2F holds no wallet).
  - `search(query, index)`: a token index built at build time and shipped as a static JSON file; the query never leaves the device. With JavaScript off, `/help` lists every article by topic.
- [ ] **Step 1: Write the failing tests:** "release", "released", "Release" find the same articles; a query with no match shows "No answer yet" and the topic list; a Playwright network log shows no request when typing.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. **Content step:** a writer agent drafts the articles in plain language; the lead reviews; each is marked `// COPY-UNSIGNED` until the owner signs it off.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): FAQ and on-device support search`.

### Task 11: Guides

**Files:**
- Create: `apps/web/src/public/guides/*.ts`
- Test: `apps/web/test/guides.test.ts`

**Interfaces:**
- Produces: guides for: buying XMR; selling XMR; funding from each wallet in `WALLET_APPS`; recommended PGP apps and making a key (spec 6.2: X2F never makes PGP keys); cash by mail and cash in person safely; spotting scams (cancel after "I've paid", spec 2.3); using X2F over Tor and I2P; verifying the Android APK's signature and hash (Plan 6 Task 22).
- [ ] **Step 1: Write the failing tests:** every guide has a title, a summary under 160 characters and at least one block; every internal link resolves to a real path; no guide names an external service X2F has not reviewed (a small allowlist of PGP and wallet apps).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with the same content step as Task 10.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): guides`.

### Task 12: Lawful-requests policy and the data inventory

**Files:**
- Create: `docs/privacy/data-inventory.json`, `apps/web/src/public/legal/requests.ts`, `apps/api/test/dataInventory.test.ts`

**Interfaces:**
- Produces:
  - `data-inventory.json`: one entry per table and column family the API stores, with what it is, whether it is sealed, and how long it is kept (from the spec 4.1 rules, Q1 and this plan).
  - `/legal/requests`: "X2F answers a lawful request backed by a warrant with the little it holds, and can't hand over what it never collects." Then the table of what X2F holds, generated from the inventory, and what it never collects (names, email unless the user added an email alert, phone, IP addresses, identity documents). Final wording by the lawyer (spec 4.1). `// COPY-UNSIGNED`
  - **Tripwire (local tree only):** the test parses every `apps/*/migrations/*.sql` and fails when a table is missing from the inventory, so the published page cannot fall behind the schema.
- [ ] **Step 1: Write the failing tests:** the tripwire against a fixture migration; the page lists every inventory row.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: lawful-requests policy page and data inventory`.

### Task 13: Download page (web app, APK, F-Droid repository)

**Files:**
- Create: `apps/web/src/public/download.ts`
- Test: `apps/web/test/download.test.ts`

**Interfaces:**
- Consumes: Plan 6 Task 22 (signed APK, its sha256 and the signed release manifest) and the F-Droid repository decision (Plan 6 Revision 2026-10-28).
- Produces: `/download`: "Use X2F in your browser" (install the web app) first, since Google plans to restrict sideloading (owner 2026-10-27); then the direct APK with its sha256 and signing-key fingerprint, and the X2F F-Droid repository address and fingerprint; a link to the verification guide. The hash and fingerprints are read from the release manifest at build time, never typed by hand.
- [ ] **Step 1: Write the failing tests:** the page's hash equals the manifest's; a missing manifest fails the build, not the page.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): download page`.

## Part D — Statistics (collected now, published later)

### Task 14: Daily aggregate statistics and the owner's panel

**Files:**
- Create: `apps/api/migrations/704_daily_stats.sql`, `apps/api/src/stats/{collect,routes}.ts`, `apps/staff-web/src/screens/StatsPanel.tsx`
- Modify: `apps/api/src/retentionJobs.ts` (collect runs before every purge job), StaffOverview (Plan 4 Task 17)
- Test: `apps/api/test/stats.test.ts`, `apps/staff-web/e2e/stats.spec.ts`

**Interfaces:**
- Produces:
  - Table `daily_stats(day date, metric text, currency text null, method text null, value numeric, primary key (day, metric, currency, method))`, the P7-A10 metrics.
  - `collectDailyStats(db, now)`: for each finished UTC day not yet collected, computes the figures from `trades`, `offers` and `accounts` and inserts them in one transaction; it runs before the purges so nothing is counted after it is deleted.
  - `GET /staff/v1/stats?from&to` (perm `stats.read`, owner only) → the rows; StatsPanel shows a table and a hand-written SVG bar chart (Plan 4's chart style).
  - `publishable(rows)`: drops every row built from fewer than `STATS_PUBLISH_MIN_COUNT` trades; not wired to any public route (publication is the owner's later call).
- [ ] **Step 1: Write the failing tests:** a day is collected once even when the job runs twice; a trade purged after collection is still counted; no row holds an account id; a moderator gets `forbidden` (privilege matrix); `publishable` drops a 4-trade cell.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: daily aggregate statistics for the owner`.

### Task 15: Plan 7 security review, roadmap and owner answers

- [ ] **Step 1:** Run Claude Security on the plan's whole diff and Semgrep on every task; fix or record each finding in `docs/security/plan-7-review.md`.
- [ ] **Step 2:** Check Review Focus 1–5 against the tests by name.
- [ ] **Step 3:** Update `docs/superpowers/plans/2026-10-15-roadmap.md` (Plan 7 row) and the spec (4.1 self-delete and alert rules; 6.3 alerts) with the owner's answers.
- [ ] **Step 4:** Commit `docs: Plan 7 security review and spec update`.

## Dependencies and order

- Tasks 1, 5, 9, 12 can start now (pure or self-contained), but Tasks 1–4 take their post-dispute constant from Q1.
- Task 2 needs Plan 3 Task 5 (merged) and Task 6 (merged). Task 3 needs Plan 3 Task 20 (with `sender_role`) and Plan 4's dispute status; its proof part needs Plan 5 Task 14.
- Tasks 6–7 need Plan 6 Task 28 (Tor egress) before production; they can be built and tested against stubs first. Task 7 waits for P7-A7.
- Task 13 needs Plan 6 Task 22. Task 14's panel needs Plan 4 Task 17; the collector does not.
- Every screen task waits for its board on the canvas.

## Owner questions

**Q1 (blocks Tasks 1–4; the conflict between "90 days for training" and spec 4.1):**

> How long should X2F keep a finished trade's records, and what may be kept for training?
> - **A. Keep today's rules.** Chats, proofs and addresses are deleted 90 days after a trade ends (sooner if both users' self-delete settings say so). A disputed trade is kept until the dispute is settled, then 30 more days. Only disputes you mark as training cases are copied, anonymized; the copy is kept 6 months.
> - **B. Like A, but self-delete also cuts the 30 days** (lead's recommendation). When the traders chose self-delete and their time has passed, a disputed trade is deleted as soon as the dispute is settled (after the appeal window). You mark training cases before that; anonymized copies are still kept 6 months.
> - **C. One 90-day rule for everything (your note read literally).** Every trade, disputed or not, is kept 90 days after it ends and then deleted; during those 90 days X2F keeps an anonymized copy of every trade for training, and training copies are also deleted at 90 days (the 6 months goes). Self-delete would then only hide things from the traders, not delete them from X2F, which breaks the promise the setting makes.

Recommendation **B**: it keeps your new rule ("a dispute keeps the trade's information until it is resolved"), honours a self-delete choice as soon as no dispute needs the data, and keeps the training library you approved on 2026-10-17.

**Comparison gaps still waiting for the owner (not in any task yet):**

| Gap | Recommendation | Cost | Where it would go |
|---|---|---|---|
| Delete my own account | **Yes.** Refused while a trade, dispute or dispute-after-refund window is open; reviews then show "Deleted user"; the bare trade records (P7-A6) stay for the counterparty's history | M: 2 tasks (API + screen), touches reviews and profiles | Plan 5 (new task after Task 12) |
| Full block (hide my offers from them, refuse their takes and chats) | **Yes.** Silent, like nudge drops (P3-M5) | S: 1 task extending Plan 3 Task 26's `blocks` table | Plan 3 follow-up |
| Helper support tickets | **Yes, after the support centre ships.** In-app ticket thread worked by Helpers, logged, no access to dispute evidence (spec 6.6) | M: 2 tasks (API + staff-web page), plus a Helper to staff it | Plan 4 (new tasks after Task 19) |
| Pause all my offers | **Yes.** One switch in Settings, shown on the offer list as "Paused" | S: 1 small task on Plan 3 Task 4's per-offer pause | Plan 3 follow-up |
| Warrant canary | **Ask the lawyer first; build only if they agree.** A canary that must later be dropped tells the world something by itself | S to build (a signed, dated text file and a monthly signing chore for you); the cost is legal risk and the monthly chore | Plan 6 (next to Task 24) |
