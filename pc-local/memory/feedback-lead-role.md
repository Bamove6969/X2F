---
name: feedback-lead-role
description: Owner's job description for the lead (6 Nov 2026) - review, security, delegate, land; owner only answers questions
metadata:
  type: feedback
---

Lead's job: code review, catching security flaws, keeping claude2/claude3/design on task with explicit outlines, getting everything merged to main, delegating as much as possible. Owner's job: answering questions. Lead polls all three sessions for questions, brings them back as one list, then disperses the answers.

**Why:** owner said so on 6 Nov; wants confidence, quality and leadership, no sloppiness, and correct bold moves on calls the lead is confident in.
**How to apply:** don't build what can be delegated. Batch questions to the owner in one list, not a trickle. Pushing reviewed, green landings needs no extra ask. Rule/money/security/wording calls still go to the owner, see [[feedback-no-important-calls]] and [[feedback-chain-of-command]].

Comms decision (owner, 6 Nov): build our own private MCP message board for cross-account messaging. Don't reopen Discord, Telegram or rented-server options unless the board fails.

Cloud move (owner, 6 Nov): all X2F work runs in cloud sessions; the PC only ties loose ends and uploads data. Messaging across accounts is the Jetpost note X2F Team Room (id 9zodbbc8va), docs on the comms branch, start file CLOUD-START.md. This supersedes the MCP board plan.

Setup (owner, 6 Nov): the lead stays on the PC. claude2, claude3 and design run in the cloud; messages through the Jetpost note 9zodbbc8va; the lead nudges cloud sessions from the PC with claude -p --cloud under each account's CLAUDE_CONFIG_DIR. Don't propose moving the lead again.

Comms update (owner, 6 Nov): no more Jetpost. Cloud workers report by Remote MCP send_message to a local relay session per account (tmux x2f-claude2, x2f-claude3), which copies to to-lead.log; lead lines go in to-second.log and to-third.log. This replaces the Jetpost note above.

Questions (owner, 7 Nov): every question for the owner goes on the current question page artifact (append, keep ids stable), never only in chat. He said "If you have questions for me update the artifact". Secrets: check the 1Password vault (op CLI via the Windows desktop app; the owner unlocks it) before asking him for any token.

Update (owner, 8 Nov): the lead MOVES to a cloud session after the current batch lands (supersedes "lead stays on the PC"). One 1Password service account token is allowed in the cloud lead's environment (supersedes "vault token stays off cloud sessions"). The PC keeps the demo (Docker) and anything local.
