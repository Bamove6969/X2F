---
name: feedback-no-important-calls
description: Owner rule (2026-10-30) — the lead must not make important product/security/money calls without the owner; ask first
metadata:
  node_type: memory
  type: feedback
  originSessionId: 1c68d0f9-46ef-4e45-93ef-068b0183c441
  modified: 2026-11-01T23:03:34.446Z
---

From 2026-10-30 the owner said: "From now on no more making calls that are important without me." Before this, the lead routinely took "lead decisions" (security trade-offs, user-facing rules, caps, copy) and told the owner afterwards; the owner had to keep catching up and reversing (e.g. surplus in escrow, watcher design).

**Why:** the owner wants to own every decision that changes what users can do, see, pay or risk. Several lead calls turned out to differ from what the owner wanted.

**How to apply:** ask the owner BEFORE deciding anything touching money/fees/payouts, security or account-takeover trade-offs, privacy/data kept, what users see or can do (rules, limits, caps, copy promises), staff pay/powers, or design of a feature. Give a recommendation, but hold the work that depends on it (or build it switchable) until answered. Purely technical calls (merge resolution, test fixes, code structure, which helper does what, landing order of approved work) the lead still makes. Reviewers' suggested fixes that only make code do what was already decided are fine; anything that picks between behaviours goes to the owner. See [[feedback-chain-of-command]].

2026-11-01 tightening: owner said "slow down on making claims on your own and bring them to me, and let's finish everything we started so far and then move forward." Even "least permissive meanwhile" defaults, abuse throttles and privacy-minimising storage choices count as calls: ask first. Don't hand workers NEW tasks while started work is unfinished; finish/land (or get owner to park) what's in flight first.

2026-11-01 later: owner repeated "just no more making decisions without me", clarified "at least function related and design related". So: anything about what the app DOES (behaviour, limits, rules, flows) or how it LOOKS/READS (layout, copy, defaults shown to users) goes to the owner, including telling Claude Design which answer "wins". Pure engineering (merge resolution, test fixes, code structure, landing already-approved work) is still the lead's.
