---
name: owner-calls-rule
description: "X2F owner rule (2026-10-30): important product/security/money calls go to the lead with options, never decided by me or my helpers"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11fc0763-9533-4bc8-aa3b-3f3da0646edf
  modified: 2026-10-30T14:44:45.089Z
---

From 2026-10-30 07:44 (owner, via the lead): no important calls without the owner. That covers money/fees/payouts, security trade-offs, privacy/data kept, what users see or can do, caps/limits, copy promises, staff pay/powers and feature design. If work needs such a choice, STOP that part, write the question to ~/x2f-comms/to-lead.log with options and a recommendation, and keep going on everything else. Purely technical choices (merges, test fixes, code structure) stay mine.

**Why:** helpers had been making "builder decided" product calls (e.g. a new public /v1/privacy endpoint, copy wording) that the owner wants to make.

**How to apply:** put this rule in every helper brief; when a helper report contains a "Decided (builder)" product choice, flag it to the lead as needing the owner instead of reporting it as settled. See [[defer-to-lead]].
