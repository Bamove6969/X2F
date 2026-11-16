# Orders for agy, batch 2 — 16 Nov 2026 (from claude3, who is about to run out of usage)

Same Rules as AGY-ORDERS.md (read them again; they all still apply): one branch per job `wip/agy-<job>` cut from
`origin/wip/third-demo-r3`; never push to main/comms(except one line in to-lead.log)/wip/lead-*/wip/second-*/wip/third-*;
never force-push; tests first; full checks before READY; COPY-UNSIGNED on new text; copy-lint pragmas; no secrets.
HARD LIMIT unchanged: do NOT touch money, escrow, keys, login security, fees, liens, disputes or payout code
(packages/escrow, packages/trade money/payouts/attestation, apps/api/src/auth, apps/api/src/disputes, apps/api/src/staff/revenue*).
Those are parked for Claude and the lead: wip/third-lien-recovery and wip/third-netfee-split are PAUSED mid-work; leave them alone.

Run your crew: 4 helpers at a time. When a helper finishes a job, give it the next unclaimed job from this list.
Claim a job by appending `agy: CLAIM <job>` to to-lead.log first, so other sessions (claude2) don't duplicate it.
Every 30 min: fetch, read to-agy.log and review-agy-*.md, fix CHANGES NEEDED first, then continue.
Work through Batch 1 (AGY-ORDERS.md Jobs 1-4) first, then these, top to bottom.

## Job 5 — `wip/agy-setup-flow`: sign-up method checklist (owner notes 12 Nov setup-backup #27, #30)
"Check all the security options they want to set up and it will take them to the next one of their selected options
after they set up the first one, and the recovery code screen will be after they set up all the ones they chose."
The sign-up login step already has checkboxes (signup round 3); make the flow walk through every ticked method in
order, then the recovery code. Web flow only (apps/web/src/screens/setup); no server changes. Playwright for the flow.

## Job 6 — `wip/agy-recovery-copy`: recovery code wording only (#28, #29 wording parts)
Say "recovery code" (singular) everywhere a single code is meant. Do NOT change the code's length or how it's made
(that is security code, Claude's). Write the owner's two asks (4x longer code; test-after-writing-down flow) as an
owner/lead question file `docs/agy-questions-recovery-code.md` with what they would change.

## Job 7 — `wip/agy-unsigned-copy`: every COPY-UNSIGNED line, grouped by screen (owner p5-1)
Generate `docs/copy-unsigned-by-screen.md`: for each screen/route, every user-facing string marked COPY-UNSIGNED
(file:line, the text), so the owner can sign wording screen by screen. Script it (tools/copy-inventory.ts) so it can be
re-run; add a vitest that the script finds a known line. No wording changes.

## Job 8 — `wip/agy-a11y`: accessibility and readability pass (owner keeps asking for bigger fonts)
Check every trader screen at 360x800 and 1280x800: tap targets >= 44 px, body text >= the kit's body size, contrast AA,
no horizontal scroll, every input labelled, focus visible. Fix what's UI-only; list the rest in
`docs/agy-a11y-findings.md`. Add Playwright checks where cheap (axe if already a dependency; don't add new deps
without saying why in the READY line).

## Job 9 — `wip/agy-flakes`: test flakes
Known: team.spec.ts strict-mode "Trade" nav link matched 2 elements (intermittent); tour/folded-phone timing. Run the
full Playwright suite 3 times, list every test that fails at least once, fix each at its cause (never skip a test,
never loosen a security assertion). Report the before/after counts.

## Job 10 — `wip/agy-terms-questions`: the owner's six Terms questions as a decision page
The Terms (apps/web/src/screens/setup/termsText.ts, v2026-11-14) keep six owner sentences that don't match the code
(listed in comms review-third-demo-r3-and-terms-r3b-2026-11-16.md and in claude3's notes): who cancels on timeout,
"funds recovered" after release, "help you get your money back" when paid late, 90 days after completion vs after
the dispute closes, appeals by senior moderator vs owner, "we don't get paid unless you both do". Write
`docs/agy-terms-decisions.md`: each sentence, what the code does today (file:line), and two options (change words /
change product) in plain language for the owner. No code changes.

## Job 11 — `wip/agy-giftcards`: gift card brand list (owner p5-6, in owner-decisions-2026-11-06.md on comms)
Top 30 + Home Hardware + Canadian Tire + Other (the exact list is in that file; Razer Gold dropped). Find where gift
card brands are listed (grep apps/web/src and packages for AMAZON_GIFT_CARD / giftCard) and make the list match,
UI/data only, with tests. If the list lives in money/escrow code, STOP and report BLOCKED instead.

## Job 12 — `wip/agy-demo-docs`: demo docs
Update docs/demo.md for the owner: how to start/stop the demo on his PC from wip/third-demo-r3, logins, the codes page,
how to leave notes and push them (`cp ~/x2f-comms/demo-notes.jsonl owner-demo-notes-<date>.jsonl` on comms), the
security-key note (open the page in its own tab; DEMO_ADOPT_HOST). Plain language. No code.

## Job 13 — `wip/agy-screens-check`: owner screenshot pack
Run the demo, take screenshots (deviceScaleFactor 2) of every trader screen at phone (390x844) and desktop (1440x900),
including sign-up steps, Terms, welcome/tour, buy/sell lists, an offer, a trade in each state the demo can reach,
settings, devices, alerts, news, profile. Save under docs/screenshots/demo-r3/ with an index.md listing each file and
the route. Commit them (PNG). This lets the owner and design review without running the demo.

When everything is done: post one summary line per job in to-lead.log, then keep checking to-agy.log every 30 minutes.
