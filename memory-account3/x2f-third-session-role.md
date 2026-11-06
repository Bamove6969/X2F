---
name: x2f-third-session-role
description: I am claude3 on X2F; orders come from the lead via ~/x2f-comms/to-third.log and LETTER-TO-THIRD.md; report only in to-lead.log
metadata:
  node_type: memory
  type: project
  originSessionId: 8908ab70-3a04-4f59-aef3-97349b6d60ba
  modified: 2026-11-06T06:57:40.509Z
---

I am claude3 (third session) on X2F (~/x2f). Orders: newest lines of ~/x2f-comms/to-third.log + ~/x2f-comms/LETTER-TO-THIRD.md (my own Update log at its bottom is the resume point). Report one dated line per finished item to ~/x2f-comms/to-lead.log (branch, pushed SHA, tests + counts, open items). Never report to the owner. Helpers get ~/x2f-comms/helper-common.md; max 5 at once (lead 2026-11-06; was 2-3); helper MODEL RULE (lead 2026-11-05 23:57): Agent model 'sonnet' only for mechanical jobs (rerun checks/tests, reshoots, conflict-free merges, renumbering, already-worded copy edits), 'opus' for all reviews, keys/money/auth/disputes/migrations, conflict resolution, feature building; unsure -> opus; a sonnet helper needing judgment stops and the step restarts on opus; all tests under flock ~/x2f-comms/check.lock; push every commit (R30). Main line = origin/claude/compassionate-johnson-k95ssr, lead lands everything.

**Why:** multi-session setup; context gets cleared often.
**How to apply:** after a clear, read to-third.log tail and LETTER-TO-THIRD.md (Update log at bottom) first, ack in to-lead.log, re-arm a Monitor on to-third.log.

CHANNEL (2026-11-06 03:46): the to-third/to-lead log relay is RETIRED. Team messages go in the Jetpost note 'X2F Team Room' (jetpost.com/notes/9zodbbc8va, workspace jesse-fleming); start each message 'claude3 to lead: ...'. Work moved to the cloud; the LOCAL PC claude3 session is stopped (owner 03:30) and does no more work.

ROLES (owner, 2026-11-06 00:39): owner only answers questions; lead reviews, lands, delegates; I build/fix/review ONLY what the lead's queue lists, in order — anything else, ask the lead. Owner questions live in ~/x2f-comms/owner-questions-claude3-<date>.md (number, plain sentence, options, rec, BLOCKING/LATER).

Owner rules (binding): since 2026-10-30 07:44 no important product/privacy/security/copy/limits call without the owner: stop that part, ask the lead in to-lead.log with options + recommendation. Since 2026-11-01 11:57 finish what's started before anything new, and settle NOTHING yourself (not even "least permissive"); after finishing, STOP until the lead gives a new task.

State 2026-11-05 (pre-clear): full handoff in ~/x2f-comms/HANDOFF-claude3-2026-11-05.md (supersedes the 11-02 one). Read it first after a clear, then to-third.log tail. Owner answered directly 11-02/03 (lead away): owner-answers-2026-11-01-claude3.md Session 3. When helpers stop on a usage limit nothing wakes me: set a CronCreate check-in.