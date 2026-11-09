---
name: feedback-many-agents
description: "Owner wants the lead to run 8 agents in parallel (cap of 8 since 2026-10-29), and to produce merged work rather than wait"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 476e1095-fd6c-47c7-9ca5-5166af75dcd8
  modified: 2026-10-26T18:46:46.800Z
---

The owner wants heavy parallelism from the lead: "I wanna see you with at least 8 agents" (2026-10-26), "just be within reason and accomplish some work". 2026-10-29: "Can you limit yourself to 8 shells" — at most 8 lead helper agents at once (claude2/claude3 not counted; they run on their own accounts). Same instruction as 2026-10-21 ("use as many agents as make sense", roadmap: "Many agents").

**Why:** three subscriptions are paid for; usage limits, not caution, are the ceiling. With claude2 out, the lead must absorb its work.
**How to apply:** keep exactly up to 8 helpers busy; start the next only when one finishes; fan out independent reviews/surveys as read-only agents (cheap on the 3.7 GB machine); serialise only jobs that run tests (check.lock / run-check.sh). Keep each agent on non-overlapping files. Report outcomes, merge what is approved, don't idle waiting for one result. Related: [[x2f-multi-agent-project]]
