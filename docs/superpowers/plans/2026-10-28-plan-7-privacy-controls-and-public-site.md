# Plan 7: Privacy controls, off-app alerts and the public site — Implementation Plan (DRAFT for owner approval)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: DRAFT, 2026-10-28 (lead); rewritten 2026-10-29 from the owner's answers.** Written from the owner's decisions of 2026-10-27 (`HANDOFF.md`, "Decided 2026-10-27 (owner)") and the OpenMonero comparison (`research/openmonero-parity-2026-10-27.md`).

> **Revision 2026-10-29 (owner).** Q1 is answered (source: `~/x2f-comms/owner-answers-2026-10-28.md`; spec "Revision 2026-10-29 (owner)"). **An undisputed trade self-destructs 30 days after it ends; this is the advertised self-destruct. There are no user-chosen delete times and no early or manual delete for anyone. A disputed trade is kept 90 days from the moment the dispute button is pressed. No per-trade stub is kept.** So Part A is rewritten around that one rule: the per-side and whole-trade self-delete settings (old Tasks 1–4, P7-A1 to A6) are dropped. Part B is rewritten: phone push with an optional loud alarm, an optional unrestricted-battery opt-in in the Android app, and **OMEMO Jabber over Tor as the only extra channel; no email, no Nostr** (old Tasks 6–7 dropped). Delete my account (new Task 18) is added. I2P is undecided and the warrant canary waits for the lawyer. Text that still mentions self-delete settings, Nostr or email below this note is superseded by it.

**Goal:** Every finished trade self-destructs on a fixed, published clock (30 days after it ends; 90 days from the dispute button for a disputed trade), with no per-trade stub; traders can delete their account; alerts reach the phone reliably (push, an optional loud alarm, an optional battery opt-in) and, optionally, over OMEMO-encrypted Jabber through Tor; and anyone can learn what X2F is from a public site with a FAQ, a searchable support centre, guides and a published policy on lawful requests. The owner sees aggregate statistics collected from day one; publishing them is decided later.

**Architecture:**
- **`packages/trade` (`@x2f/trade`)** gains the pure retention rule (`tradeDeleteAt`), next to the merged chat retention rule (`chatPurgeDue`, `packages/trade/src/chat.ts`).
- **`apps/api`** gains the whole-trade purge job (on the one `startRetention` scheduler, `apps/api/src/retentionJobs.ts`), account deletion, the alert channels with a single fan-out `notify()`, the Jabber sender, and the daily statistics job.
- **`apps/web`** gains Settings → Privacy (what is kept and for how long, and Delete my account) and Settings → Notifications (push, alarm sound and volume, Jabber), and the public pages. Public pages are React components rendered to static HTML at build time (`react-dom/server`, already a dependency), so they work with JavaScript off (Tor Browser "Safest") and can be indexed. Content lives in typed TypeScript objects, not Markdown, so no renderer is added.
- **`apps/staff-web`** (Plan 4) gains an owner-only statistics panel on StaffOverview.

**Tech Stack:** as pinned on the main line (Node 24.22.1, npm 11.21.0, TypeScript 7.0.2, vitest 5.0.3, fastify 5.12.x per R31, pg 8.23.1, openpgp 6.3.2, React 19.3.0, Vite as pinned, @playwright/test 1.63.0, Semgrep 1.178.0). **New dependencies, chosen at task time under the 14-day rule** (`npx -y npm@11.21.0 view <pkg> time --json`; the version and its publish date go in the commit message; `npm audit --omit=dev` must stay at 0 apart from R31/R33 exceptions):
- **Task 6 (Jabber, NEW 2026-10-29):** an XMPP client and an OMEMO implementation, in `apps/api` only. The task first checks what exists and passes the 14-day rule; if no maintained OMEMO library does, it stops and reports to the lead (no hand-rolled Signal-protocol crypto).
- ~~Task 6 (Nostr)~~ and ~~Task 7 (email)~~: dropped 2026-10-29 (owner: no Nostr, no email).

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md`: 1 (principles: privacy, bare minimum), 2.3 (disputes, dispute after refund), 4.1 (data rules, retention, lawful requests, Tor), 6.2 (PGP rules, R16: nothing from inside a key but its fingerprint is shown or logged), 6.3–6.4 (alerts), 6.5, 6.6 (moderators read chats once a dispute opens; training library). **Owner decisions:** `HANDOFF.md` "Decided 2026-10-27" and "Decided 2026-10-29"; spec "Revision 2026-10-29 (owner)". **Boards:** none exist yet for Privacy, Notifications or the public pages; each screen task starts with a controller design step on the X2F App canvas (HANDOFF "Next steps" 6 already lists Settings and FAQ as still to design).

**Builds on:** Plan 3 Tasks 5, 6, 19, 20 and 30 (Task 20 must store each chat envelope's sender role; see the Plan 3 "Revision 2026-10-28" note), Plan 4 (StaffOverview, `appendLog`, dispute status, the R6 purges in its new Task 23), Plan 5 Task 14 (proof storage; its purge follows this plan's schedule), Plan 6 Task 2 and its new Task 28 (Tor egress for outbound calls).

## Global Constraints

- **Privacy (spec 4.1).** No IP is stored or logged. Logs never contain trade codes, display names, Jabber addresses, PGP fingerprints, alert text or search queries. `disableRequestLogging: true`, `trustProxy` never set.
- **Deletion is real.** A purge deletes rows (or nulls columns) with the `x2f_purge` role; nothing is "soft-deleted" with a flag and kept. Backups keep deleted data for up to D6 days (Plan 6 gap G1), and the Privacy screen and FAQ say so.
- **One retention rule, no exceptions** (owner 2026-10-29). An undisputed trade is deleted whole 30 days after `closed_at` (`TRADE_KEEP_DAYS = 30`). A disputed trade is deleted 90 days after `disputes.opened_at` (`DISPUTE_KEEP_DAYS = 90`, Plan 4 Task 23), and never while its dispute is still open. Nobody can choose another time or delete early, including staff.
- **No per-trade stub.** Before a trade is deleted its numbers are added to the account's running totals (Plan 5 Task 20) and the revenue ledger (Plan 4 Task 32). Reviews are permanent and stand alone (Plan 5).
- **Moderator reading rules are unchanged** (owner 2026-10-27, spec 6.6): chat stays readable by the moderator once a dispute opens; before that, rules and the activity log stop them, not encryption. This plan changes no chat key.
- **Alerts say nothing.** Every off-app alert body is exactly one of the fixed push texts ("Someone nudged you on X2F", "Something changed in a trade on X2F", and for the owner "Something needs your attention"), with no trade code, display name, amount or link beyond the site root.
- **Stored alert addresses are secrets.** A Jabber address (JID) is sealed with `SecretBox` (FU-C; async after Plan 6 Task 9) before it is stored, is never returned in full by any route (only a "Jabber · a…@…" style hint), is never shown to staff, and is deleted when the user turns the channel off.
- **Outbound calls go over Tor** once Plan 6 Task 28 exists (the Jabber servers then never see X2F's IP). Before that, the senders run only in development and tests.
- **Public pages are static and private.** No analytics, no third-party scripts, styles or fonts, no forms that post anywhere except the in-app support search, which never leaves the device. Every page works with JavaScript off.
- **Statistics are aggregates only.** No per-account row, no IP, no device data. Each stored figure is a daily count or sum over at least one dimension (currency, method), computed from records X2F already has, before the retention jobs remove them.
- Every dependency is pinned exactly and passes the 14-day rule. `npm run check` (queued through `~/x2f-comms/run-check.sh`, R32/R34) passes at the end of every task. Tests run as `npm test -- --project <workspace>`, wrapped in `flock ~/x2f-comms/check.lock`.
- Migrations are numbered `7xx`, one per task that needs schema. Every module takes `clock: () => Date`.
- Every new refusal code joins Plan 2's `ApiErrorCode` and is thrown as `ApiError`.
- **UI.** Copy from the boards once designed; spec wording where no board exists; anything else is `// COPY-UNSIGNED` for the owner (and the lawyer for the lawful-requests page). Night theme first, exactly one `data-primary` per screen, no emoji, no exclamation marks. `expectParity` at 390×844 for app screens and at 390×844 and 1280×800 for public pages. Never run Playwright with `--update-snapshots`.

## Assumptions (owner has not decided yet; each is used only through the named constant or setting)

- ~~P7-A1 to P7-A6 (self-delete settings)~~: dropped 2026-10-29. The owner chose one fixed rule (Global Constraints).
- ~~P7-A7 (mail route)~~: dropped 2026-10-29 (no email).
- **P7-A8 Which events alert** (kept, for Jabber): two switches, "Trade changes" (default on) and "Nudges" (default off). The final alert (Plan 3 Task 25) always goes to every channel that is on.
- **P7-A11 Loud alarm (NEW 2026-10-29).** Default sound `alarm-default.ogg`, default volume 80%; a custom sound file at most `ALARM_MAX_BYTES = 1 MiB`, audio types only, kept **on the device**, never uploaded. Which events ring the alarm: the final alert and "payment marked" by default; the user can add trade changes and nudges.
- **P7-A12 Account deletion (NEW 2026-10-29).** Refused while a trade or a dispute is open (owner). *Lead default (2026-10-29), owner may change:* also refused during an appeal window, a lien or the dispute-after-refund window. Deletes the login methods, wallets, settings, offers and alert channels; reviews by and about the account stay and show "Deleted user"; the running totals go with the account.
- **P7-A9 Public site address.** The public pages live under `/about`, `/faq`, `/help`, `/guides/<slug>`, `/download`, `/legal/requests` and `/security` (Plan 6 Task 24) on the app's own origin (clearnet, onion, and I2P if the owner approves it after research). The app's home screen stays at `/` with a "New to X2F?" link to `/about`. Option: make `/about` the home for visitors. Owner to choose.
- **P7-A10 Statistics kept.** Daily, per currency and method: offers live at midnight UTC, trades started, trades completed, trades refunded or cancelled, disputes opened and closed, completed XMR volume; and new accounts per day (site-wide only). Kept indefinitely (they hold no personal data). Owner-only view. Any later publication hides every figure built from fewer than `STATS_PUBLISH_MIN_COUNT = 5` trades.

## Interfaces assumed from Plans 2–6 (reconcile here only)

- Plan 2: `requireSession`, `requireTrader`, `ApiError`, `SecretBox` (`seal`/`open`; async after Plan 6 Task 9), openpgp 6.3.2 strict config and the key checks from Plan 2 Task 7 (`readPublicKey`, encrypt-capable subkey check, R16 fingerprint-only rule).
- Plan 3: `trades` row (`code`, `state`, `closed_at`, `buyer_payout`, `seller_refund`, roles), Task 5 take transaction, Task 6 `applyEvent` and `toTradeView`, Task 19 `publish` and `sendPush(accountId, kind)`, Task 20 chat envelope storage (with `sender_role`, Revision 2026-10-28) and `purgeChats`, `RETENTION_JOBS`, `owner_settings`.
- Plan 4: dispute status per trade (`openDisputeFor(code)`), `appendLog`, StaffOverview, Perm list (adds `stats.read`, owner only), and Task 23's R6 purges.
- Plan 5: `trade_proofs` with `uploader_role`, `purgeProofs`.
- Plan 6: Task 24 `/security` page, Task 28 `torFetch` and Tor socket egress (Jabber), Task 27 I2P site profile (on hold until the owner decides I2P), D6 backup retention, Task 20 Capacitor apps (alarm and battery).

## Review Focus

1. **A dispute is never stripped of evidence.** A dispute opened at day 29 of a refunded trade keeps everything until 90 days after the button, and nothing is deleted while the dispute is open.
2. **Deleted means deleted.** After the purge no route, table or log holds the trade's chat, proofs, addresses, events or row; only the running totals, the revenue ledger and the reviews changed.
3. **No early delete.** No route, setting or staff action deletes a trade before its time.
4. **Alerts leak nothing.** Each sender's output, captured in tests, holds only the fixed text; no log line holds a Jabber address or fingerprint.
5. **Public pages work with JavaScript off** and load nothing from another origin.

---

## Part A — The 30-day self-destruct and account deletion (owner 2026-10-29)

Rewritten 2026-10-29. Old Tasks 1–4 (per-side and whole-trade self-delete settings) are dropped. Task numbers are kept so the dependencies below stay readable.

### Task 1: Retention rule (`@x2f/trade`) — rewritten 2026-10-29

**Files:**
- Create: `packages/trade/src/retention.ts`
- Modify: `packages/trade/src/index.ts`, `packages/trade/src/chat.ts` (`chatPurgeDue` uses the same rule)
- Test: `packages/trade/test/retention.test.ts`

**Interfaces:**
- Produces:
  - `TRADE_KEEP_DAYS = 30`, `DISPUTE_KEEP_DAYS = 90`.
  - `interface RetentionFacts { closedAt: Date | null; disputeOpenedAt: Date | null; disputeClosed: boolean; refundDisputeWindowEndsAt: Date | null }`
  - `tradeDeleteAt(f): Date | null`: `null` while the trade is open; `closedAt + 30 d` with no dispute; `disputeOpenedAt + 90 d` with a dispute; never before the dispute is closed; **OPEN pending the owner's answer to question A:** never before `refundDisputeWindowEndsAt` (the dispute-after-refund window; the lead recommends 30 days; open point in Plan 3 Revision 2026-10-29).
  - `tradeDeleteDue(f, now): boolean`.
- [ ] **Step 1: Write the failing tests:** a released trade is due at close + 30 d and not 1 ms before; a dispute opened at day 29 moves it to the button + 90 d; a dispute still open at day 90 is not due; an open trade is never due.
- [ ] **Step 2:** Run `flock ~/x2f-comms/check.lock npm test -- --project @x2f/trade`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(trade): one retention rule, 30 days or 90 from a dispute`.

### Task 2: Whole-trade purge job (`apps/api`) — rewritten 2026-10-29

**Files:**
- Create: `apps/api/src/retention/tradePurge.ts`, `apps/api/migrations/701_trade_purge.sql` (`on delete cascade` on every foreign key to `trades(code)`, or an explicit delete order)
- Modify: `apps/api/src/retentionJobs.ts` (append `purgeTrades`; Plan 3 `purgeTradeAddresses` and `purgeChats` stay as early, smaller steps)
- Test: `apps/api/test/tradePurge.test.ts`

**Interfaces:**
- Consumes: Task 1; Plan 4 dispute records; Plan 5 Task 20 `addToTotals`; Plan 4 Task 32 revenue ledger; Plan 5 Task 14 `trade_proofs`; Task 14 `collectDailyStats`.
- Produces: `purgeTrades(db, now)`, running as `x2f_purge`: for each trade with `tradeDeleteDue`, in one transaction, it makes sure the totals, the ledger and the daily statistics already hold the trade (else it adds them), nulls the trade code on its reviews, then deletes the trade row and everything hanging from it: events, identities, attestations, refusals, chat envelopes, proofs, dispute messages and evidence references. Nothing is kept per trade. The activity log is untouched (it holds no chat text or addresses; Plan 4).
- [ ] **Step 1: Write the failing tests:** Review Focus 1–3 as database tests on a fixed clock; a profile, starter-limit stage and revenue figure are the same before and after the purge; the app role cannot delete; a captured logger holds no trade code; the job is idempotent.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): trades self-destruct 30 days after they end`.

### Task 3: The self-destruct date in the trade room and on the device (`apps/web`, `apps/api`) — rewritten 2026-10-29

**Files:**
- Create: `apps/web/src/chat/localPurge.ts`
- Modify: `apps/api/src/trades/view.ts` (`TradeView.deleteAt`), the trade header and the completed-trades list (Plan 3)
- Test: `apps/web/test/localPurge.test.ts`, `apps/web/e2e/selfDestruct.spec.ts`

**Interfaces:**
- **Controller step (design):** the trade-room notice line on the canvas; owner signs off the copy.
- Produces: `TradeView.deleteAt` (ISO, or null while open). The trade room shows "This trade self-destructs on <date>." `// COPY-UNSIGNED`, and "Kept until <date> because a dispute was opened." for a disputed trade. `localPurge` deletes cached messages, proofs and closed-trade escrow state from IndexedDB once `deleteAt` has passed (and on next start if the app was closed).
- [ ] **Step 1: Write the failing tests:** the notice shows the server's date; a dispute changes it; after `deleteAt` (fake clock) the trade is gone from the panel and IndexedDB; parity at 390×844.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): self-destruct date in the trade room and local purge`.

### Task 4: Settings → Privacy (`apps/web`) — rewritten 2026-10-29

**Files:**
- Create: `apps/web/src/screens/settings/Privacy.tsx`
- Test: `apps/web/e2e/privacy.spec.ts`

**Interfaces:**
- **Controller step (design):** a Privacy board.
- Produces: no choices, only plain statements: "Every trade self-destructs 30 days after it ends. If a dispute is opened, the trade is kept 90 days from that moment, for moderator training, then deleted. Nobody can delete a trade early or keep it longer, not even X2F. [OPEN: this line waits for the owner's answer on the dispute-after-refund window (question A); it may need to name that exception.] Your reviews and your trade count stay on your profile. Backups are cleared within <D6> days." `// COPY-UNSIGNED`. A link to the lawful-requests page (Task 12) and to Delete my account (Task 18).
- [ ] **Step 1: Write the failing tests:** the page shows the numbers from the shared constants (not typed copies); parity at 390×844.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): privacy page`.

### Task 18: Delete my account (`apps/api`, `apps/web`) — NEW 2026-10-29

**Scope:** owner Q7, yes. Placed in Part A because it is a privacy control (Plan 7's gap table had suggested Plan 5).

**Files:**
- Create: `apps/api/src/account/delete.ts`, `apps/web/src/screens/settings/DeleteAccount.tsx`
- Modify: Plan 5 profile and review readers ("Deleted user")
- Test: `apps/api/test/deleteAccount.test.ts`, `apps/web/e2e/deleteAccount.spec.ts`

**Interfaces:**
- Produces: `POST /v1/account/delete { tapId | confirm }` (confirm-it's-you, Plan 2). Refusals (409, through `CantDoThat`): `trade-open`, `dispute-open`, `appeal-window`, `lien`, `refund-dispute-window` (P7-A12). On success, in one transaction: delete login methods, sessions, devices, wallets, settings, offers, alert channels, badge prefs and running totals; keep reviews by and about the account (*2026-10-29b:* reviews never show their author, so only reviews about it show "Deleted user"); ~~the display name and login name are freed after `NAME_REUSE_DAYS` (owner to decide; default 90) so nobody can take over a known name at once.~~ *2026-10-29b (owner): both names are burned forever (`burned_names`); see Revision 2026-10-29b.*
- [ ] **Step 1: Write the failing tests:** each refusal; after deletion no login works and no row holds the account's names or keys; a review about the account shows "Deleted user"; the old display name can't be registered before the reuse time.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: delete my account`.

## Part B — Alerts that are never missed (owner 2026-10-29)

Rewritten 2026-10-29. Phone push with an optional loud alarm and an optional battery opt-in; one extra channel only, OMEMO Jabber over Tor. Old Tasks 6 (Nostr) and 7 (email) are dropped.

### Task 5: Alert channels and one fan-out (`apps/api`)

**Files:**
- Create: `apps/api/migrations/703_alert_channels.sql`, `apps/api/src/alerts/{channels,notify,routes}.ts`
- Modify: every caller of `sendPush` (Plan 3 Tasks 19, 25, 26; owner alerts) to call `notify` instead
- Test: `apps/api/test/alerts.test.ts`

**Interfaces:**
- Produces:
  - Table `alert_channels(id, account_id, kind 'xmpp', sealed_target bytea, hint text, verified_at, trade_changes bool, nudges bool, created_at)`; at most one per account.
  - `notify(deps, accountId, kind: 'trade' | 'nudge' | 'final-alert' | 'owner-alert')` sends Web Push (as today; its payload says which alarm events ring) and queues one Jabber job when a verified channel matches; sending is asynchronous and never delays the request.
  - `GET /v1/account/alerts` → `{ kind, hint, verified, tradeChanges, nudges }[]`; `PUT /v1/account/alerts/xmpp/toggles`; `DELETE /v1/account/alerts/xmpp` (deletes the row).
- [ ] **Step 1: Write the failing tests:** the fan-out respects toggles and P7-A8; an unverified channel gets nothing; no route returns `sealed_target`; delete removes the row; a captured logger holds no target.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with a stub sender.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): alert channels and a single notify fan-out`.

### Task 6: OMEMO Jabber alerts over Tor — rewritten 2026-10-29 (replaces Nostr)

**Files:**
- Create: `apps/api/src/alerts/xmpp.ts`, `apps/api/test/fixtures/xmpp-server.ts` (a local Prosody in Docker, or an in-process stub)
- Modify: `apps/api/src/config.ts` (`X2F_XMPP_JID`, the bot's credentials and OMEMO identity from the key ring/vault), `apps/api/src/alerts/routes.ts`
- Test: `apps/api/test/xmpp.test.ts`

**Interfaces:**
- Produces:
  - `POST /v1/account/alerts/xmpp { jid }`: validates and seals the JID, sends an OMEMO-encrypted message with a 6-digit code; `POST …/xmpp/verify { code }` marks it verified (5 tries, 15 min). The screen shows the bot's OMEMO fingerprint so the user can check it.
  - `sendXmpp(target, text)`: OMEMO-encrypted to the user's devices, sent from X2F's bot account over Plan 6 Task 28's Tor egress. If the user has no OMEMO device, nothing is sent in plain text; the channel shows "Needs OMEMO".
  - **Setup guide** (Task 11 content): one detailed guide per recommended Jabber app (owner: "we must write detailed setup instructions for each").
- [ ] **Step 1: Write the failing tests:** the message received by the test client decrypts to exactly the fixed text; a recipient without OMEMO gets nothing; five wrong codes lock it; the captured network shows the connection going through the SOCKS stub.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement (dependency per the Tech Stack note; stop and report if none qualifies).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): OMEMO Jabber alerts over Tor`.

### ~~Task 7: PGP-encrypted email alerts~~ — dropped 2026-10-29 (owner: no email system)

### Task 8: Settings → Notifications (`apps/web`) — rewritten 2026-10-29

**Files:**
- Create: `apps/web/src/screens/settings/Notifications.tsx`
- Test: `apps/web/e2e/notifications.spec.ts`

**Interfaces:**
- **Controller step (design):** a Notifications board: phone push, the loud alarm (Task 16), the battery opt-in (Task 17, Android app only), Jabber with its two switches.
- Produces: turn push on and test it; add, verify, toggle and remove Jabber; plain statements of what each channel's operators can see (the Jabber servers see that a message was sent and when, not what it says) `// COPY-UNSIGNED`.
- [ ] **Step 1: Write the failing tests:** add and verify a JID against the test server; remove it; parity at 390×844.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): notification settings`.

### Task 16: Loud alarm — default sound, custom sound and volume (`apps/web`, native) — NEW 2026-10-29

**Scope:** phone push with an optional loud alarm (owner). Default sound and volume; the user can upload their own sound file and set the volume.

**Files:**
- Create: `apps/web/src/alerts/alarm.ts`, `apps/web/public/sounds/alarm-default.ogg`
- Modify: the service worker push handler (Plan 3 Task 19), Task 8 screen, the Capacitor Android notification channel (Plan 6 Task 20)
- Test: `apps/web/test/alarm.test.ts`, `apps/web/e2e/alarm.spec.ts`

**Interfaces:**
- Produces: alarm on/off, which events ring it (P7-A11), volume slider, "Choose sound" (stored in IndexedDB on the device, never uploaded; type and size checked), "Test alarm". Web: plays while a tab is open, otherwise a normal notification. Android app: an alarm-style notification channel with the chosen sound that sounds even on silent, as the Nudge already does (spec 2.4). iPhone app: follows the ring and silent switch (spec 2.4).
- [ ] **Step 1: Write the failing tests:** a file over 1 MiB or not audio is refused; the chosen sound and volume survive reload; no request carries the sound file; the test button plays at the set volume (audio mock); parity.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: loud alarm with a custom sound and volume`.

### Task 17: Unrestricted battery opt-in (Android app) — NEW 2026-10-29

**Scope:** let users opt in to Android "unrestricted battery" for X2F so alerts are never delayed or missed (owner). Optional, the user's choice, explained in setup. Needs Plan 6 Task 20 (Capacitor apps).

**Files:**
- Create: `apps/native/android/.../BatteryOptimization.kt` (or a pinned Capacitor plugin passing the 14-day rule), `apps/web/src/alerts/battery.ts`
- Modify: Getting started (a skippable step in the Android app only), Task 8 screen
- Test: `apps/web/test/battery.test.ts`, a manual check recorded in `docs/manual-checks.md` (a de-Googled phone and one aggressive brand)

**Interfaces:**
- Produces: `batteryStatus(): 'unrestricted' | 'optimized' | 'n/a'`; "Allow X2F to run in the background" opens the system screen (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` or the app's battery settings page, whichever the store rules allow). The setup step explains why in two plain sentences and has "Not now". Nothing changes on the web or iPhone.
- [ ] **Step 1: Write the failing tests:** the step shows only in the Android app; "Not now" never asks again unless the user opens Settings; the status reads back after the system screen.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; then the manual check; expect PASS.
- [ ] **Step 5:** Commit `feat(android): optional unrestricted battery for reliable alerts`.

## Part C — Public site (owner 2026-10-27: "very important")

### Task 9: Public page shell, static rendering and the content model

**Files:**
- Create: `apps/web/src/public/{Layout,Page,content.ts,render.tsx}`, `apps/web/scripts/prerender.ts`, `apps/web/public/robots.txt`
- Modify: `apps/web/vite.config.ts` (prerender after build), `apps/api/src/static/serve.ts` (serve the prerendered `*.html` for the P7-A9 paths)
- Test: `apps/web/test/prerender.test.ts`, `apps/web/e2e/public.spec.ts`

**Interfaces:**
- **Controller step (design):** public boards on the canvas: About (home for visitors), FAQ, Help (support centre), Guide, Download, Policy. Desktop and phone.
- Produces: `type Block = { h2: string } | { p: string } | { ul: string[] } | { note: string } | { link: { to: string; label: string } }`; `interface PublicPage { slug; title; summary; blocks: Block[]; updated: string }`. `render.tsx` turns a page into static HTML with the same CSP and self-hosted fonts. `/about` introduces X2F (what it is, escrow in three steps, no wallet held, no ID, the 1% fee from ad posters only, the Tor address (and the I2P address if the owner approves I2P), download links).
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
  - `/legal/requests`: "X2F answers a lawful request backed by a warrant with the little it holds, and can't hand over what it never collects." Then the table of what X2F holds, generated from the inventory, and what it never collects (names, email, phone, IP addresses, identity documents), and the retention rule (30 days after a trade ends; 90 days from the dispute button). Final wording by the lawyer (spec 4.1). `// COPY-UNSIGNED`
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
- Consumes: Plan 6 Task 22 (signed APK, its sha256 and the signed release manifest) and X2F's own F-Droid repository (owner confirmed 2026-10-29).
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
- [ ] **Step 3:** Update `docs/superpowers/plans/2026-10-15-roadmap.md` (Plan 7 row) and check the spec (4.1 retention, 6.3 alerts; Revision 2026-10-29) still matches what was built.
- [ ] **Step 4:** Commit `docs: Plan 7 security review and spec update`.

## Dependencies and order

- Tasks 1, 5, 9, 12 can start now (pure or self-contained).
- Task 2 needs Plan 3 Tasks 5, 6 and 20, Plan 4's dispute records and Task 23, Plan 5 Task 20 (running totals) and Plan 4 Task 32 (revenue ledger); its proof part needs Plan 5 Task 14. It must not go live before those, or a purge would lose counts.
- Task 3 needs Task 1's `tradeDeleteAt` (Task 3 exposes it as `TradeView.deleteAt`). Task 18 needs Plan 4 Task 25 (liens) for its lien refusal.
- Task 6 needs Plan 6 Task 28 (Tor egress) before production; it can be built and tested against a local server first.
- Task 16's Android part and Task 17 need Plan 6 Task 20.
- Task 13 needs Plan 6 Task 22. Task 14's panel needs Plan 4 Task 17; the collector does not.
- Every screen task waits for its board on the canvas.

## Owner questions

**Q1: answered 2026-10-29 (owner).** None of A, B or C: an undisputed trade self-destructs 30 days after it ends (the advertised self-destruct); no user-chosen times and no early delete; a disputed trade is kept 90 days from the dispute button; no per-trade stub. Part A is rewritten to match. (The old question text is in git history, commit 0e92cb6.)

**Still open:**
- ~~**Anonymized training copies** (6 months, 2026-10-17) were not mentioned on 2026-10-29.~~ *Dropped 2026-10-29b (design reports the owner's answer); Plan 4 Revision 2026-10-29b.*
- **Dispute after refund** (90 days in Plan 3) is longer than the 30-day delete; Task 1 keeps a refunded trade until that window closes until the lead or owner decides.
- **I2P** waits for research and in-house testing (Plan 6 Task 27 on hold).
- ~~**News "don't show again"** checkbox (Plan 4 Task 28) is undecided.~~ *Settled 2026-10-29b: it exists, and a Site news bell always shows.*

**Comparison gaps, decided 2026-10-29:**

| Gap | Owner's answer | Where it is planned |
|---|---|---|
| Delete my own account | **Yes**, blocked while a trade or dispute is open | Plan 7 Task 18 |
| Full block | **Yes, strongly.** The blocked person can't see your offers, take them, message you, or see that you're online | Plan 3 Task 37 |
| Helper support tickets | **Yes**, in categories plus "Everything else"; the owner picks who gets access | Plan 4 Tasks 30–31 |
| Pause all my offers | **Yes**: a list of my offers, each with an on/off toggle, plus "Select all" | Plan 3 Task 36 |
| Warrant canary | **Waits for the lawyer** (`~/x2f-comms/lawyer-questions.md`, item 1) | Plan 6, next to Task 24, if the lawyer agrees |

## Revision 2026-10-29b (owner + design)

Authority: spec (Revision 2026-10-29b) > `rulings-and-lessons.md` > earlier revisions > this note. Source: the owner's words of 2026-10-29 08:03 (`~/x2f-comms/owner-answers-2026-10-28.md`, items d and f) and Claude Design's update (`origin/wip/design-brief`).
- **Task 18 (delete my account): deleted usernames are burned forever** (owner). The display name and the login name of a deleted account are **never reused**, and no way to bring them back is planned. `NAME_REUSE_DAYS` is dropped: Task 18 writes both names' normalized keys (Plan 2's `username_key`) to `burned_names(name_hash primary key, kind 'display'|'login')`, as a keyed hash (HMAC under a server subkey) so the list never shows an old login name; it holds no account id and no date, and registration refuses a burned name with `username-taken`. Test: a deleted account's display name and login name can never be registered again, even years later (fake clock).
- **Task 18 (design reports the owner's answer, 2026-10-29b):** a deleted account's trade and dispute records stay until their normal auto-delete date (30 days after the trade ends, 90 days from the dispute button). Delete removes the account, not those records; they no longer name it. Test: a trade of a deleted account is still purged on its own date, not earlier.
- **Task 8 (Settings → Notifications) and News:** turning off the News popup at login ("don't show again", Plan 4 Task 28) does not belong in Notifications; the Site news bell always shows (Plan 4 Revision 2026-10-29b).
- **Tasks 6 and 8, Jabber (design reports the owner's answer, 2026-10-29b):** OMEMO only, never unencrypted Jabber; alerts are sent over Tor to and from X2F's Jabber server through its onion address. The Alerts screen shows the X2F alert account's OMEMO fingerprint with "check this matches". The setup guide suggests Conversations (Android), Monal (iPhone) and Gajim (computer). The battery-saver tip shows on Android only (Task 17).
- **Tasks 1–4 and 12 (retention text), design reports the owner's answer:** the 6-month anonymized training copy is dropped. Trade chats auto-delete 30 days after the trade ends; dispute records are kept 90 days for moderator training, with as much private detail auto-blurred as possible. The privacy page (Task 4), the lawful-requests data inventory (Task 12) and the Terms key points say exactly that and never mention a 6-month copy.
- **OPEN conflict (dispute after refund, Task 1):** the design reports the owner said a dispute can be opened for 48 hours after a trade ends; the lead's question A recommends 30 days. Task 1's rule for a refunded trade stays until the owner settles it.
- **Owner questions, settled:** the News "don't show again" checkbox exists (owner, 2026-10-29b); remove it from "Still open".
