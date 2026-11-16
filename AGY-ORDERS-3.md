# Orders for agy, batch 3 — 16 Nov 2026 (from claude3; long list so the crew stays busy while claude3 is out)

All Rules from AGY-ORDERS.md still apply (branches `wip/agy-<job>` from `origin/wip/third-demo-r3`, claim in to-lead.log
first, tests first, full checks, COPY-UNSIGNED, no secrets, never force-push, never push others' branches).
HARD LIMIT unchanged: no money, escrow, keys, login security, fees, liens, disputes or payout code.
Order: finish Batch 1 (Jobs 1-4), Batch 2 (Jobs 5-14), then these. 4 helpers at a time. Check to-agy.log every 30 min;
reviews (review-agy-*.md) come first. If a job turns out to need forbidden code, post BLOCKED with why and move on.

## Job 15 — `wip/agy-notes-finish`: close every PARTLY / NOT DONE note from your own Job 1 audit
docs/owner-notes-status-2026-11-16.md lists 12 PARTLY and 3 NOT DONE. Implement each one that is UI/copy only
(skip the ones Jobs 2, 3, 5, 6 already cover). For OWNER-QUESTION items write the question in plain words in
`docs/agy-owner-questions.md` (one question per note, with the options you see).

## Job 16 — `wip/agy-help-pages`: help content
The app has /help/:topic. Write plain-language help pages (COPY-UNSIGNED): Getting started, How a trade works
(buyer and seller), Escrow in plain words, Fees (the poster pays 1%; responding is free; each receiver pays the
network fee for its own payout), Disputes and appeals, Security (passkey, security key, PGP, authenticator,
recovery code), Gift card trades (owner rules G50-G53, G56 and p5-6 in owner-decisions-2026-11-06.md on comms),
Team accounts, Privacy (30/90-day purge, no tracking). Link them from the screens the owner asked (session-length
screen: FAQ, getting started, support, settings). Facts must match the code; list any doubt in the READY line.

## Job 17 — `wip/agy-error-copy`: every API error has friendly words
apps/web/src/ui/cantDoCodes.ts classifies API error codes. List every code the API can return
(grep apps/api/src for ApiError codes) and make sure each has clear, short user wording on the screens that can
receive it. Fix gaps (web only). Add a test that fails when a new API code has no wording.

## Job 18 — `wip/agy-web-tests`: test coverage for web screens
Find web screens/components with no or thin tests (apps/web/src/screens/**). Add meaningful vitest + testing-library
tests (rendering, states, empty/error/loading, accessibility roles). Target the 10 thinnest screens first. No
behaviour changes unless a test finds a real bug (then fix it and say so).

## Job 19 — `wip/agy-bundle-split`: the web bundle is over 500 kB
The build warns "Some chunks are larger than 500 kB". Code-split routes with dynamic import() (React.lazy) where it
doesn't break the security tripwires (bundle.test.ts, proof-render-tripwire) or offline/monero wallet loading.
Report before/after chunk sizes. Keep all tests green.

## Job 20 — `wip/agy-deps-check`: dependabot branches (review only, do NOT merge)
origin has dependabot branches (GitHub Actions bumps, npm minor/patch bumps). For each: check it out in a separate
worktree, run the full checks, and write `docs/agy-deps-report.md`: what changes, breaking notes, test results,
recommendation. No merging, no pushing to those branches.

## Job 21 — `wip/agy-nudge-sound`: an original nudge sound (owner F10, G-notes: "ICQ-style car horn")
The owner wants a nudge sound in the spirit of the old ICQ horn, but it must be ORIGINAL (no copied or licensed
audio). Synthesize it in code (Web Audio API: two short horn-like honks) or generate a WAV with a small script you
commit (tools/sounds/). Wire it to the existing nudge/alert sound setting if one exists (UI only), respect the
user's sound on/off setting, and add tests. Note: the nudge limit is one per 15 minutes (owner).

## Job 22 — `wip/agy-folding-phones`: folding phone research + layout (owner G47)
Research Pixel Fold, Samsung Z Fold/Flip, Surface Duo, Honor/Oppo folds: screen sizes folded/unfolded, hinge/
dual-screen APIs, whether Back differs. Write `docs/agy-folding-phones.md`. Then check every trader screen at those
sizes in Playwright and fix layout problems (UI only).

## Job 23 — `wip/agy-currency-research`: currencies (owner F12, Q9) — research only
Launch has 45 currencies; owner wants more: those quoted by BOTH Coinbase and BitPay exchange-rate APIs, never
sanctioned ones (owner 12 Nov: Russia, Iran removed; also IRR, KPW, CUP, CUC banned). Produce
`docs/agy-currency-candidates.md`: the candidate list, which source quotes each, any sanctions/legal concern per
currency with sources (OFAC, EU, UN, Canada), and a recommended add-list. No code changes.

## Job 24 — `wip/agy-price-source-research`: a 4th price source (owner F11) — research only
Current sources: Kraken, Bitfinex, CoinGecko (XMR) and Coinbase/BitPay/CoinGecko (FX). The owner wants a 4th XMR
source after it passes a Tor check. Research candidates (public, no key, XMR/USD at least, hourly or faster,
reachable over Tor without captchas), test their endpoints if you can, and write `docs/agy-price-source-4.md`
with a recommendation. No code changes.

## Job 25 — `wip/agy-staff-shots`: staff site screenshot pack (owner F19)
The owner wants screenshots of the staff menu. Run the staff web (apps/staff-web; see its README/docs and
tools/demo for how the demo serves it, if it does) and capture each role's menu and main screens (owner, senior,
moderator, helper) at desktop and phone, saved under docs/screenshots/staff/ with an index.md. If it can't run,
post BLOCKED with what's missing.

When the list is empty: post a summary in to-lead.log and keep checking to-agy.log every 30 minutes.
