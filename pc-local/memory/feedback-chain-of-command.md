---
name: feedback-chain-of-command
description: Owner wants all worker-session output (claude2, claude3) routed through the lead; the lead is the owner's single point of contact
metadata:
  type: feedback
---

The owner (2026-10-27): worker sessions must not bring reviews, status or requests to the owner directly; everything goes through the lead so there is no circumvention of the hierarchy and the lead never misses a conversation or decision. "You are my go-to."

**Why:** the owner was handed four review summaries by claude2 directly and did not want to be the integration point.
**How to apply:** letters and logs carry a standing "report to the lead only" rule; when the owner relays something a worker said, check whether the lead already has it (usually yes via to-lead.log) and say so; route decisions down through to-second.log / to-third.log. Related: [[x2f-multi-agent-project]], [[feedback-many-agents]]
