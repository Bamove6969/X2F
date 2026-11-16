# Orders for agy (Antigravity CLI), from claude3 — 16 Nov 2026

You are a worker on X2F, a privacy-first peer-to-peer Monero (XMR) marketplace with 2-of-3 multisig escrow.
Repo: https://github.com/Bamove6969/X2F (your local clone, e.g. ~/x2f). Branch `comms` holds notes and logs (this file).
The owner (the person running you) decides product questions. claude3 (a Claude Code session in the cloud) gave you
these orders and has a Claude reviewer check every branch you push. The lead is away until Wednesday.

## Rules (read all before starting)
1. Spawn 3-4 helpers (sub-agents/parallel tasks) and give each ONE job below; one branch per job, cut from
   `origin/wip/third-demo-r3` (the owner's current demo) unless the job says otherwise:
   `git fetch origin && git checkout -b wip/agy-<job> origin/wip/third-demo-r3`.
2. Never push to `main`, `comms` (except appending one line to `to-lead.log`, see 7), or any `wip/lead-*`,
   `wip/second-*`, `wip/third-*` branch. Never force-push. Never rewrite history.
3. Setup: Node 24 (`nvm use`), `npm ci`. Docker is needed for API tests.
4. Checks before you call a job done: `npm run typecheck`, `npm run copy-lint`, `npm run separation-check`,
   `npx vitest run apps/web` (and `apps/api` if you touched it), and the Playwright specs you touched:
   `cd apps/web && npx playwright test -c e2e/playwright.config.ts --workers=1 --trace off <spec>`.
   Copy-lint: a refusal message must use CantDoThat or carry `// not-a-refusal: <why>` on the line before.
   New user-facing text gets a `COPY-UNSIGNED` comment (the owner signs wording later).
5. Do NOT touch money, escrow, keys, login security or payout code (packages/escrow, packages/trade money/payouts,
   apps/api/src/auth, apps/api/src/disputes, liens, fees). Claude owns those. UI layout, copy and research only.
6. Tests first where there's behaviour. Keep each commit small with a clear message. No secrets, ever.
7. When a job is done, push its branch, then append ONE line to `to-lead.log` on `comms`:
   `[<UTC time>] agy: READY wip/agy-<job> <short sha>: <one-line summary>; checks: <counts>`
   (`git checkout comms && git pull && echo ... >> to-lead.log && git commit -am "agy: <job> ready" && git push`).
   If blocked, the same with `BLOCKED:` and why.

## Jobs (owner's demo notes: `owner-demo-notes-2026-11-12.jsonl` and `owner-demo-notes-2026-11-13.jsonl` on
## `comms`; each note has `dataScreen`, `pathname` and `element.css` locating what it's about)

### Job 1 — `wip/agy-notes-audit`: which of the owner's 91 notes are still not done
Run the demo (`npm run demo`, http://localhost:4400; logins in docs/demo.md) and/or read the code. For every note in
both files, mark DONE / PARTLY / NOT DONE / OWNER-QUESTION with one line of evidence (file:line or screenshot).
Write it as `docs/owner-notes-status-2026-11-16.md` on your branch. No code changes in this job. This list drives
the others; finish it first and share it with your other helpers.

### Job 2 — `wip/agy-layout`: the owner's layout notes that are NOT DONE (UI only)
From the 12 Nov notes, at least: welcome screen as a checklist with green checkmarks (setup-welcome #34) and its
copy (#33, #35, #36), logo top-left with the screen name on every screen (#37), login screen moved down / less
empty and the PGP key box much taller (login #38, #39), PGP key box much wider on /setup/pgp-key (#26),
session-length screen moved down with links to FAQ/getting started/support/settings and bigger fonts (#42-#46),
/buy a little more spacing (#48). Skip anything Job 1 marks DONE. Match the existing design kit (apps/web/src/ui).

### Job 3 — `wip/agy-landing`: the first screen (owner note /sell #47)
The owner wants the first screen to welcome people to X2F with "Tour" or "Skip and get started", large logo in the
middle (read the full note text). Check what the demo already has (a welcome/tour landed on 12 Nov:
apps/web/src/tour, the welcome screen) and close the gap to the note. UI only.

### Job 4 — `wip/agy-wallet-research`: research only, no code
Owner notes setup-wallet #31-#32: "What are the methods of connecting wallets like Edge has and MetaMask… can we not
use that technology too?" Research which Monero wallets (Cake Wallet, Monerujo, Feather, Stack Wallet, Edge,
Monero GUI/CLI, others) support any connect protocol (WalletConnect-style, deep links, `monero:` URIs,
view-key/address sharing, payment requests), what each can and can't do for a P2P escrow site (fund an escrow
address with an exact amount, share a payout address, sign), privacy implications, and a recommendation.
Write `docs/research-monero-wallet-connect-agy-2026-11-16.md`. Check comms for earlier research first
(`research-wallet-connect-2026-11-12.md`, `research-monero-connect-broad-2026-11-12.md`) and add only what's new.

When all four are done, report the four READY lines and stop. Don't start other work without new orders.
