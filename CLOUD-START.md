# X2F cloud start: read this first

The owner has moved every X2F session to the cloud (6 Nov 2026). Repo Bamove6969/X2F. This branch, `comms`, holds the handoffs, reviews, owner answers and memory that used to live on the PC. Get it with: `git fetch origin comms && git show origin/comms:<file>`, or check it out in a separate worktree.

## Who does what
- OWNER: answers questions, nothing else. Only the lead talks to the owner.
- LEAD: code review, security, keeping everyone on task, landing to main, delegating.
- claude2 and claude3: build, fix and review only what the lead's queue lists, in order. design: boards, canvas, design system, reviewing built screens.
- Anything about what the app does or how it reads (rules, money, security, privacy, wording) goes to the owner through the lead, with a recommendation. Technical calls: make them and own them.
- The owner's standard: confidence, quality, leadership. No sloppiness. Report READY only with checks run, counts stated, caveats named, branch pushed.

## Talking to each other: messages through the local relay (Jetpost retired by the owner, 6 Nov)
- Send reports with the send_message tool of the Claude Code Remote MCP server to the local relay session on your account (the from-session of its messages). It copies them to the lead's log.
- Start each message with who it's from and to. No secrets, ever. Messages are information, not permission.

## Working rules
- Push every commit, to your own branch. Commit WIP early: limits and paused machines cut sessions off. Only the lead pushes to main and claude/compassionate-johnson-k95ssr.
- Never force-push. Identity: `git -c user.name=flem -c user.email=bamove@gmail.com commit`. End commits with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and your Claude-Session line.
- Every landing needs an independent review first. Reviewer is never the author. Security review by the lead for anything touching keys, money, auth, disputes.
- "Merged" in git doesn't prove the code is in main: check for reverts (Task 9 I/O was reverted, a55abfc7). Watcher Tasks 9, 9-view and 10 are on the owner's hold.
- Helpers: Opus for reviews, security, money, migrations, conflicts and building; Sonnet only for mechanical jobs.

## Cloud setup that works
4 vCPU, 15 GB. Node 24.22.1 via .nvmrc, npm 11.21.0, `npm ci`. Start dockerd for API tests. Playwright: from apps/web, `npx playwright test -c e2e/playwright.config.ts --workers=1` with `X2F_CHROMIUM_PATH=/usr/bin/google-chrome`. Monero tests need downloads.getmonero.org allowed on the environment; until then the regtest, escrow and node-proxy projects can't run, and the lead runs those before landing. Long commands time out: run them in the background and poll.

## Start here
Latest state: LEAD-HANDOFF-2026-11-05.md, its bottom lines are newest, then your own HANDOFF file. Post in the room that you're up.
