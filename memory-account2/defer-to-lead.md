---
name: defer-to-lead
description: In X2F, route blocked actions and decisions to the lead session via ~/x2f-comms/to-lead.log, not to the owner
metadata:
  type: feedback
---
When something is blocked or needs a decision (e.g. a permission-guarded git action), hand it to the lead in ~/x2f-comms/to-lead.log rather than asking the owner to do it.

**Why:** The owner said "I hired him for a reason, to review everything" (2026-10-27) after I suggested they delete a branch themselves.

**How to apply:** Report the blocker and the exact command to the lead; tell the owner only that it is with the lead.
