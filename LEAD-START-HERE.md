# X2F LEAD: START HERE (written 8 Nov 2026, ~21:15 MT, by the lead on the PC, for the lead in the cloud)

You are the same lead, moved to a cloud session. The owner's words: "We were just moving you from the pc to the cloud to give us more power, freedom, and control." "You are the lead." "That's your position." You start blank, so this file is your memory. Read all of it before you act. Everything it names is on GitHub in `Bamove6969/X2F` (private): branch `comms` (working notes), branch `pc-archive-2026-11-08` (the PC's whole notes folder), and the `wip/*` code branches.

Then read, on `comms`: `pc-local/memory/*.md` (your standing rules, in the owner's words), `owner-decisions-2026-11-06.md` (every ruling he has made), `LEAD-HANDOFF-2026-11-07.md` (the running log; the newest lines are at the bottom and beat anything older, including this file where they differ).

---

## 1. What X2F is

A peer-to-peer marketplace where people trade Monero (XMR) for ordinary money (bank transfers, payment apps, gift cards, cash by mail). X2F never holds anyone's coins: each trade locks the seller's XMR in a 2-of-3 multisig escrow shared by buyer, seller and a moderation service; two of the three must sign to move it. Values that cannot be traded away: privacy, non-custodial, security first, no built-in wallet. The closest rival is OpenMonero; the owner wants every feature it has, done better and simpler.

Code: a TypeScript monorepo. `apps/api` (server, Fastify 5, Postgres), `apps/moderation` (the separate service that co-signs escrows and watches the chain; it must never share secrets or a process user with the API), `apps/web` (the trader app, React), `apps/staff-web` (staff app), relay and node proxy, `packages/trade` (the trade state machine: the source of truth for what may happen when), `packages/escrow`, `packages/protocol` (sealed message envelopes), `packages/proof`, `packages/reputation`, `packages/auth-client`. Plans live in `docs/superpowers/plans`, binding rules R1 to R44 in `docs/superpowers/rulings-and-lessons.md`.

Status: pre-launch. No real users, no real money. The owner wants a fast launch with security built in, revenue, then a paid audit.

## 2. People, and how you reach each one

- **The owner** (flem, bamove@gmail.com). Not a programmer. He answers questions and gives rulings; he does not do tasks for you. Write to him in plain language: outcome first, short sentences, no code names or internal labels, no jargon, and never hand him a job that is yours. He reads on his phone. He answers questions ONLY on question page artifacts (see section 7). He gets frustrated by slowness, by being asked to do your work, and by confident statements that turn out wrong. When you are wrong, say so in one line and fix it.
- **Design** ("Claude Design", cloud session `session_01XZAz2tn1YbpoyEtNYuAJim`, same account as you). Draws every screen ("boards") on a canvas, pushes READY commits on `wip/design-brief`, writes notes to you in `docs/to-lead.md` there. Reach it with the Remote MCP `send_message` tool using that session id. It cannot reply to you directly; its answers arrive as cross-session messages or in to-lead.md. It sometimes sits "waiting on a human" for a permission tap from the owner. Standing rule: every comment or answer the owner gives about how something looks or reads goes to design word for word, at once.
- **claude2** (account bnkxfers, cloud `session_01MytcQrnjJQN6u4zQJv1ciV` / `…HxBCXa7BmJYyP43w`) and **claude3** (account totalcarerx4u, cloud `session_015QmjHzzi8jS7CRJGhR7RVw`). Other paid accounts doing build work. They report by commits titled `READY: …` or `BLOCKED: …` on `wip/second-*` and `wip/third-*` and read your instructions from `to-second.log` / `to-third.log` on `comms`. You cannot wake them: the owner nudges them from his phone, or (his idea tonight) a scheduled routine on each account polls the comms branch every 30 minutes. **Both accounts close for good on 21 Nov 2026.** On 19-20 Nov make sure all their work is pushed, get a final handoff from each, and move their queues to your own helpers. Today I already took over most of claude3's queue (owner page 3, Plan 4 Tasks 11 and 16).
- **Your helpers.** Subagents you spawn. Opus for building, reviews, anything touching money, keys, logins, disputes, migrations. Sonnet for mechanical jobs. The owner wants many in parallel ("at least 8"; tonight "spawn 12"), but the machine has to cope: on the PC, 14 at once pushed the load to 22 and made a full check take over an hour with false failures. Give every helper: one worktree, one branch, the rule to run single test files only, and a complete brief (it knows nothing you don't write down). Keep a table of helper id to job: tonight I sent two follow-ups to the wrong helpers because I trusted my memory of the ids.

## 3. The rules (digest; the full text is in `pc-local/memory/`)

1. **You are the owner's single contact.** Workers report to you, never to him. You review, catch security flaws, keep everyone on task, land work on main, and delegate as much as possible.
2. **No important calls without the owner.** Anything about what the app does, shows, costs, risks, keeps or promises (rules, limits, caps, wording, privacy, money, security trade-offs, staff powers) goes to him first with your recommendation. Pure engineering is yours: merge resolution, test fixes, code structure, landing order, which helper does what. When two of his rulings collide, apply the later one and tell him; when a ruling does not cover a case, ask.
3. **Every question for him goes on a question page artifact**, appended to the current page with stable ids, never only in chat. Batch them. Each needs a plain explanation, 2 to 3 options, and your recommendation first.
4. **Every landing needs an independent review first.** Money, keys, logins, disputes: a security review, then a re-verify of the fixes by a reviewer. Tonight reviews caught three ways to lose money that builders missed, and two of those were introduced by the fix for the previous finding. Never skip the re-verify.
5. **Land only on green**: full check plus Playwright, read the counts not the exit code (section 5).
6. **Workers push every commit** (rule R30). "Merged" in git does not mean the code is present: check for reverts.
7. **Tell the truth about state.** If a check did not run, say so. If you guessed, say so. Tonight I told the owner a session had been silent for 45 minutes when it was 10, because I estimated the time instead of running `date`. Check the clock.

## 4. Where things stand right now

**Main = GitHub `main` = `claude/compassionate-johnson-k95ssr` = `0c6f3f16`.** Always push both refs together: `git push origin HEAD:claude/compassionate-johnson-k95ssr HEAD:main`.

Landed today (8 Nov), in order: Job 1 (no payment details or "I've paid" until the escrow has 10 of 10 confirmations; "Cancelling is final" sheet; nudge rules) · the chain watcher revival with its security fixes · the payment-method picker · exact send amounts · chat erase rule 30 days / 90 after a dispute · patch-keeping (Dependabot config, daily audit workflow, patch policy, advisory list) · Semgrep Cloud fixes · the shared screen kit round 1 · happy-dom 21.0.4 · old spike lockfile removed. Counts at the last landing: vitest 4941, Playwright 471, semgrep 0, audit 0.

GitHub settings done today with the owner's yes: Dependabot alerts and automatic security fixes on, label `dependencies`. The 9 alerts GitHub still shows should clear after the next push to main; check `security/dependabot`.

**The PC is still doing one thing for you:** finishing "batch 2" on `wip/lead-land` (see 6A). When its log `land-batch2b-1108.log` is green the PC lead lands it and writes the new main at the bottom of `LEAD-HANDOFF-2026-11-07.md`. If no such line appears within a couple of hours, the PC session died: take `origin/wip/lead-land` and finish it yourself.

## 5. How to land

1. Clean worktree off `origin/main`. Merge the approved branches one at a time. Resolve only mechanical conflicts yourself (migration lists in `apps/api/test/schema.test.ts`: union, sorted, every file on disk listed; import unions; `errors.ts` code unions; parity `KNOWN_EXCEPTIONS` unions; `docs/coordination.md` keep both). Anything that changes behaviour goes back to the branch's builder.
2. `npm ci`, then `npm run check` (typecheck, copy-lint, separation-check, every vitest project, semgrep, audit), then from `apps/web`: `npx playwright test -c e2e/playwright.config.ts --workers=1`. One Playwright run at a time (it owns port 4317; the staff e2e uses 4318).
3. Read the counts. Known load flakes, rerun alone before believing them: `attestation-flow.test.ts`, `push.test.ts`, `password.test.ts` (Argon2), `task30-refusals`, `identity.test`, fold "draft moves behind the Chat button", `news.spec`.
4. Push both refs. Append one line to `to-second.log` and `to-third.log` on `comms` ("LANDED … -> main = sha, counts. Merge main before your next push."). Tell the owner in one or two plain sentences.

**Migration numbers in use (API, `apps/api/migrations`) — check before any merge:** main has up to 113, 119, 122. On branches: trade-rules 120, 121 · chat-shred-2 **123_chat_shred** · launch-rules **123_pay_window** (CLASH: renumber one) · vendor 017, 198, 200, 210 · hold-v3 016 · sessions 307, 311, 313, 314 · offer-units 315, 324, 325 · terms-signature 316 · jabber 331 · Plan 4 Task 16 (and 6) 204 · Task 11 208. Moderation service (`apps/moderation/migrations`): main 001 to 006 · chat-shred-2 **007_chat_shred** · Task 11 **007_internal** (CLASH: renumber one).

## 6. The queue: every branch, its state, and what to do

### A. Batch 2 (being finished on the PC; skip unless the PC dies)
`wip/lead-land` f89233af = main + owner-page3 2213ae8a + sessions c8c84e7f + vendor bb7616e2 + wide-shell 057887a7 + watcher-flake c2b74539 + fold-quote 0efa7d38 + offer-units 225cfd5a + two chores (`.npmrc` min-release-age 14; "Trusted is 200+ trades" in three docs). All seven are reviewed and APPROVED. The first full check finished at 21:02: 5142 tests passed, 25 failed, Playwright not run. A fixer helper is on it on the PC. The causes, where branches meet: the vendor branch makes posting an offer vendor-only, so offer-units' and traderTrust's tests must make their posters vendors (`makeVendor`), not weaken the rule; plus `sessionLength.test.tsx`, `logout-tripwire.test.ts`, `moderator-badge-scope.test.ts`, and `serve-boards.test.ts` (the wide shell changed `design/x2f-app/Desktop.dc.html`, so `refs/manifest.json` is stale; design must recapture the image).

### B. Batch 3 (approved; land after batch 2)
- `wip/lead-trade-rules-p1` **1801ffb5**: the owner's trade rules. Either side waits the payment method's full time after "I've paid" before a dispute; no cancel after "I've paid"; nudges optional; NO 15-minute final alert (the seller's cancel after the time to pay refunds at once; the moderator co-signs only when the API shows the cancel and no "I've paid"); a buyer's dispute during a settling refund becomes an after-refund dispute only while no ruling exists, otherwise staff are alerted. Three review rounds; final verdict APPROVED (`review-trade-rules-p1`, `review-cancel-reversal`). Before deploy, migration 120's header says what to settle by hand.
- `wip/lead-design-results` **3e70488e**: result screens (paid waiting, refunded, released), built on trade-rules; 10 payment-method profiles with windows; gift cards 45 minutes (owner G50); heroes use the kit's Hero. APPROVED.
- `wip/third-p4-task11` **ca356ce7** + `wip/third-p4-task16` **169fa1d6**: moderator queue and case view; staff web app and owner setup. APPROVED after fixes. Land together; the merge recipe is in `review-p4-t11-t16-2026-11-08.md`. The paths that would send chat or proof plaintext through the API are removed and tripwired (`NEEDS_P4_CHAT_MEMBERSHIP`); moderator chat sending is dev-only until the key design is built. Deploy needs `MOD_INTERNAL_SOCKET_GID`.
- `wip/lead-quote-bands` **94360d55**: quote screen (6 decimals on what the buyer receives, exact on what the seller locks, focus ring, bands card). APPROVED.

### C. Needs a fix or a re-verify, then lands
- `wip/lead-hold-v3` **561af62c** (the 24-hour hold for username-and-password logins; migration 016). Second security review: **CHANGES REQUIRED, one new Critical (R-C1)**: `refuseHeldTradeEvent` in `apps/api/src/trades/held.ts` test-runs a buyer-cancel as 'buyer' whoever calls, so the SELLER can post the held buyer's cancel; it is recorded and carried out when the hold ends, returning the coins to the seller. Fix: use the caller's real side; record only when the caller is the buyer; test: buyer held, seller posts buyer-cancel, 409, nothing recorded. Then re-verify. Review file: `review-hold-v3-2026-11-08.md`.
- `wip/lead-chat-shred-2` **0d7e65f8** (moderation destroys its chat keys when a chat is purged; devices keep no readable copy; API migration 123, moderation 007). First review's three Important findings are fixed; needs the re-verify (`review-chat-shred-2026-11-08.md`).
- `wip/lead-launch-rules` **17eba0de** ($5,000 trade cap; time to pay per method; "can take up to N" lines; dispute-before-paid pop-up). Needs a security review. **Money gap to fix first:** the moderation service's own copy of a trade still assumes 90 minutes to pay; for longer methods a lying API could get the seller's refund co-signed after 90 minutes. Put `payWindowMin` into the attested terms. **Merge hazard:** this branch merged and then reverted `wip/lead-jabber-notices` (commits b28b6291, 967ac03c); before merging Jabber later, revert 967ac03c or Jabber's commits up to 96a1182d will not come back.
- `wip/lead-front-door` **6a5949a6** (Landing page at "/", signed-out visitors see nothing else, team members accept the Terms themselves, invites never name the vendor). Needs a security review. Hazard: it adds `apps/web/src/ui/Logo.tsx`; so does wide-shell. Keep one.
- `wip/lead-signup-team` **08d96d4d** (one private username with a live "available" tick; backup login by recovery code only). Playwright not run. Needs a security review and three owner answers (section 7).
- `wip/lead-jabber-notices` **4446e3c5** (a discreet Jabber message on every account change; migration 331). Needs a security review. At merge, `jabber-paths.test.ts` fails until every new account table or column from other branches is classified in `changePaths.ts`.
- `wip/lead-terms-signature` **909f87fb** (signature at signup; migration 316). Technical fixes done. HOLD until the owner's answers are applied: erase the signature when the account closes; everyone who gets a login signs, team members and staff included; the typed box wording comes from design ("tick the box if you agree to the rules and terms of X2F, sign your name, begin account creation"); then bump the Terms version and re-verify.

### D. Unfinished, lower priority
`wip/lead-proto` 0db797e3 (rebuild the owner's fake-data prototype on current main and republish it: section 9) · `wip/lead-nav-p1` 0fdf498e · `wip/lead-release-settle` 3efabc81 (WIP, unchecked) · `wip/lead-demo` 8855328c (the demo tool; the PC runs it) · older worker branches (`wip/second-api-cap-dispute`, `wip/second-price-feeds`, `wip/second-p3-task34` + `-web`, `wip/third-p5-proof-popups`, `wip/third-proof-owner-g16`, `wip/lead-p7-retention`): check each for reverts and staleness before spending time; several are superseded by what landed. `wip/third-semgrep-triage`: close, main has it.

### E. The big design work waiting on the owner's page 12
`design-chat-membership-keys-2026-11-08.md` (on `comms`): the answer to the owner's "can encryption work like Windows permissions": yes. One key per trade; buyer and seller are members; a dispute adds the moderator, who can then read the whole history; seniors and the owner are added per case; no master key; "only after a dispute" becomes enforced instead of promised. About 13 to 15 weeks for one builder, 5 to 7 across three. Build tasks 1 and 2 are the chat-shred-2 branch. Do not start the rest until he answers page 12.

## 7. The owner's questions

**How pages work.** A small HTML page published as an artifact with a tiny database; he taps an option or types; you read answers with ArtifactData (`collection: answers`, docs `p11-1`…). Sources: `pc-local/pages/page11/index.html`, `page12/index.html` on `comms`. To add a question, append to the `Q` array (never renumber) and republish to the same URL. Record every answer in `owner-decisions-2026-11-06.md` plus a verbatim file, then send design the ones about looks or wording word for word.

- **Page 11**: https://claude.ai/artifact/9pBDGqKsBqz6b5XWWaPxZX. Questions 1 to 16 answered and recorded. **Open: 17** (chat keys destroyed at 48 hours or 30 days: he wrote both) **18** (a late "I've paid" cannot stop the seller's refund: confirm) **19** (hardware-only passkeys for moderators) **20** (Fast badge: buyer's speed to the tap or to the seller's confirmation) **21** (team invite from a weak login: held 24 h or refused) **22** (members' hold rights over team changes) **23** (the combination of his hold rules).
- **Page 12**: https://claude.ai/artifact/CdnDQBU2XyANv9XEzyMuh6. 15 questions on chat keys, staff access and the audit log. All open.
- **New questions you must add (not yet on any page):**
  1. The signup "username available" tick lets someone test whether a username exists (limited to about 14,400 checks a day). We had hidden that on purpose. Keep the tick?
  2. Team chat hint: his 28 Oct ruling (R44) says chat shows "Team Calcium member: Aurora"; design's list says never name the member. Which?
  3. Password-only team members (his p7-9 says members may use any login): may a member's weak login put the team lead's account on the 24-hour hold; does a member's first login need approval; do members get recovery codes?
  4. Time-to-pay values per method (builder defaults: 90 minutes for apps and instant transfers, 3 hours for bank transfers, 24 hours for cash by mail).
  5. A fixed-price offer cannot be taken while the price feed is down (needed to enforce the $5,000 cap). OK?
  6. Jabber: an old note says "OMEMO only over Tor"; the board says OMEMO recommended. Which? And the builder's defaults for what counts as an account change.
  7. How long the server remembers that a chat was purged so an old device erases its keys (builder set 365 days).
  8. Hold: always let a correct recovery code through even when logins are throttled (closes a lock-out by a thief); and two limits of sharing a password with a thief (either can cancel the other's waiting change; a thief with the OLDER session can end the owner's newer logins).
  9. Where the working demo should live (section 9): it needs a machine that stays on.
  10. Whether to archive the raw chat transcripts to the private repo.
  11. Staff: should the 60-day inactivity close cover only trader accounts (asked as p12-15).
- **What he asked for tonight, in his words** (act on these):
  - "I want all my answers to every question moved and dispersed and disseminated amongst the team and worked on." → Build `owner-answers-register.md` on `comms`: one row per answer he has ever given (rule in one line, who owns it, status: landed with sha / on branch X / not started, next action). Assign every unstarted row. Tell him the counts. Design and claude2/3 were told to list their own gaps.
  - "We still have a shit ton of credits why don't you spawn 12 agents…" → He wants maximum parallel work. Do it, within what the machine can take.
  - "Frankly the previous demo was better." → He has not yet said why (asked twice). Design reviewed the real app and ranked 8 gaps (section 8). Ask once more, gently, on a page.
  - On registrars: he wants a domain registrar that keeps the buyer's identity confidential and takes Monero. I read four companies' terms: recommendation IncogNET (Wyoming; registers in its own name, lets you transfer out any time, Monero in-house, email only), then OrangeWebsite (Iceland; discloses only on an Icelandic court order; resells Internet.bs, whose terms I did not read), then 1984 Hosting (Iceland; holds your real name and phone). FlokiNET dropped (Seychelles entity for domains, real details required, can unmask at its own discretion). Njalla unread (its site blocks the fetcher). He has not chosen. The domain is permanent because passkeys are tied to it.
  - His security wishes relayed by design (he fears a zero-day and cannot afford a $20-60k audit now): keep chat crypto simple (done: libsodium); a 2 to 4 page public spec of the design for community review (NOT started); fuzz and attack tests (done, landed with chat retention); launch cap (he chose $5,000; built on launch-rules); freelance crypto review (he said no: a proper audit later from revenue); bug bounty after launch; apply to Monero CCS, OTF Red Team Lab, NLnet (drafts only, nothing sent without his yes); Dependabot, daily audit, patch policy, advisories (done, landed).

## 8. Design: what it owes and what it found

Real-app review, `docs/design-review-real-app-2026-11-08.md` on `wip/design-brief`, ranked: 1 Landing and "no free tours" (built: front-door) · 2 wide layout (built: wide-shell) · 3 logo D (built) · 4 quote screen (built: quote-bands) · 5 offer cards' trust row (built: offer-units) · 6 signup with one username (built: signup-team) · 7 the long dead sell list (built: offer-units) · 8 the demo's Comment pill covered the main button (moved top-right).

Owed by design: recapture Desktop reference images after the rail lands · Trusted boards still say 100+ (owner ruled 200+ trades and 98%+) · BuyQuote board's fee rows contradict his rulings (network fee comes off the buyer's payout; no deposits): the board changes, not the build · kit handoff line 677 (pre-login mark is logo D) · OwnerSetup step 4 says PGP optional, his rule A9 requires it · incident ID at the top of a trade (G37) · a Profile screen for the rail's link · words for the staff alert "refund landed after a ruling" · boards for his page 12 answers when they come (moderator-called banner, 6-digit device approval) · "Owner answers not yet on a board" list (requested tonight) · `docs/design-proto-review.md` (requested).

## 9. The two things the owner can open and tap

- **Prototype (fake data, a Claude page with comments):** https://claude.ai/artifact/JEZKgFnLH1EzhuDFh5qMJG. Built from `wip/lead-proto` with `npm run build:proto -w @x2f/web` → `apps/web/dist-proto/index.html`; republish to the same URL after rebuilding on current main (it predates the pay gate, so it still shows payment details too early).
- **Working demo (real app, fake Monero):** https://x2f-demo.tail8d8abc.ts.net, reachable only from his own devices through Tailscale. It runs on his PC from `wip/lead-demo` (`npm run demo`), in worktree `agent-aa3714ae6e2b78185`. Buyer login `ana-demo`, password and authenticator secrets in that worktree's `.demo/logins.txt` (also in the archive branch under `demo/`). It has a Comment button; his comments are written to `~/x2f-comms/demo-notes.jsonl` on the PC, which you cannot read from the cloud. None left so far. Restart steps after a PC reboot are in `CLOUD-LEAD-HANDOFF-2026-11-08.md` section 6. He asked why the demo cannot move to GitHub: the code is there; the running copy needs a machine that stays on. Offer him options on a page (a small rented server; or you run it in your session with a Tailscale key, which only lives while the session does).

## 10. What only the PC has
1Password through the Windows desktop app. You need the service account token he approved: `OP_SERVICE_ACCOUNT_TOKEN` in your environment, read-only, a dedicated vault (three steps were given to him; not done). SonarQube Cloud setup waits on it. Chrome with his logins. The demo. The local transcripts of older sessions (the PC session's chat after 16:00 on 8 Nov exists only on claude.ai: https://claude.ai/code/session_01Btihaz2ehRwstyRefFRga4).

## 11. Mistakes I made today, so you don't repeat them
- Pushed a branch to main before its full check had finished. Never.
- Committed message logs to main by mistake (removed). Logs belong on `comms`.
- Guessed elapsed time instead of checking the clock, and told the owner a wrong thing.
- Sent two follow-up messages to the wrong helpers. Keep an id-to-job table.
- Asked the owner to do things that were mine to solve ("open the session and approve"). He answered: "You are the lead."
- Ran 14 helpers on a 6 GB machine. Reviews are cheap; test runs are not.
- Let helpers run whole test projects. Brief them: single files only; one Playwright at a time.
- Gave him forum summaries when he wanted the companies' actual terms read. Do the real reading first.
- Trusted a builder's "READY" without checking that its own tests had run (a reviewer found the full API suite failing).
- A helper spawned before a reboot cannot be resumed. Start a fresh one in the same worktree and tell it what its predecessor left.

## 12. Your first ten actions
1. `git fetch origin`; read the files named at the top. Run `date`.
2. Append your acknowledgement line to `LEAD-HANDOFF-2026-11-07.md` on `comms` and push ("CLOUD LEAD <your session id> has read the handoff and taken over").
3. Tell the owner, in three plain sentences, that you are up and what you are doing first.
4. Start `owner-answers-register.md` (his order) with one helper; assign the unstarted rows.
5. Put the new questions from section 7 on page 11 and tell him the count.
6. Fix hold-v3's R-C1 and get it re-verified.
7. Re-verify chat-shred-2; security-review launch-rules (with the shadow gap fixed), front-door, signup-team, jabber-notices.
8. When the PC writes the new main (batch 2), build and land batch 3.
9. Read `docs/to-lead.md` on `wip/design-brief` and answer design.
10. Check his page answers and the Dependabot page; re-read the bottom of `LEAD-HANDOFF-2026-11-07.md`. Then keep the queue moving and keep him informed in plain words.
