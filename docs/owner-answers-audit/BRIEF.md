# Audit brief: owner answers vs design boards (read-only)

Goal: find every owner answer that changes a design board or its wording and is NOT yet drawn.

Sources (local copies of origin/comms): $S/comms/ (S=/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad)
- owner-decisions-2026-11-06.md is the master ruling list. The answer files hold the owner's own words.
- The question files (owner-questions-*.md) explain what each answer refers to.

Current design: $S/canvas/project/*.dc.html (~150 boards; *-Wide = desktop twin). Grep visible text and the design-note asides ("Decided · owner, <date> (<id>)" mark already-drawn decisions).
Also check /tmp/claude-0/-home-user-X2F/ef124731-52c6-41bb-ac1c-a482489088e9/scratchpad/design-brief/docs/to-lead.md: a decision reported there as drawn counts as drawn.

For each answer in YOUR files:
1. Skip if it is build-only (server logic, data, infra) with nothing a user sees. Skip if superseded by a later answer (say which).
2. Otherwise find the board(s) a user would see it on and check whether board text/visuals match the answer.
3. Classify: DRAWN (cite board + the matching text), PARTLY (what's missing), NOT DRAWN (no board shows it), CONFLICT (board says the opposite).

Output: write $S/audit/<your-name>.md with one row per PARTLY / NOT DRAWN / CONFLICT item:
`| id | owner's words (short quote) | board(s) | status | what to change (concrete: text to add/replace, element) | user-journey stage |`
User-journey stages, in order: 1 landing/signup, 2 login/devices/security, 3 browse offers/quote, 4 post offer, 5 trade (fund/pay/proof/confirm/release/cancel), 6 dispute/moderation, 7 after trade (reviews, badges, profile), 8 settings/team/alerts/support, 9 staff/owner.
At the end, list DRAWN item ids in one line, and anything ambiguous needing the head designer's call.
Do NOT edit any board, commit, publish or message anyone. Be precise; quote board text you rely on.
