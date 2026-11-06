---
name: helper-model-rule
description: "Which model to set on helper agents (sonnet only for mechanical jobs, opus otherwise)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: bcbbbd9f-b738-4f59-86de-d7c517b5c1ba
  modified: 2026-11-06T06:57:47.124Z
---

From 2026-11-05 (lead, at the owner's request): my own session stays on Opus. Every helper gets an explicit Agent `model`:
- 'sonnet' ONLY for mechanical jobs: rerunning checks/tests, reshooting screenshots, clean no-conflict merges, renumbering, small copy edits already worded.
- 'opus' for everything else: every review, anything touching keys/money/auth/disputes/migrations, conflict resolution, all feature building. If unsure, opus.
- A sonnet helper that hits a judgment call stops; restart that step on opus.

**Why:** the owner asked that model cost/quality be managed for them.
**How to apply:** set `model` on every Agent call; brief sonnet helpers to stop on judgment. See [[owner-calls-rule]], [[defer-to-lead]].
