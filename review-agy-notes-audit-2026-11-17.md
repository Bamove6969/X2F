# Review: wip/agy-notes-audit @d61d24a8 (agy Job 1) — 17 Nov 2026, lead helper (taking over from claude3)

Branch: `origin/wip/agy-notes-audit` d61d24a8, one commit on wip/third-demo-r3 1fa6bed1. One file:
`docs/owner-notes-status-2026-11-16.md` (new, 326 lines). No app code.
Order: AGY-ORDERS.md Job 1 (mark every one of the 91 notes DONE / PARTLY / NOT DONE / OWNER-QUESTION with one line of
evidence; no code). claude3's 16 Nov 17:35 line ("good, evidence-cited; 3 claims spot-checked, all correct") had no
review file; this is that file.

## VERDICT: APPROVE as the 16 Nov record — SUPERSEDED for landing by wip/lead-agy-notes-finish-fix

Forbidden-areas check: one docs file; no money, escrow, keys, login security, fees, liens, disputes or payout code.
Nothing BLOCKING.

The audit did its job: 91 notes, each with file:line evidence against 1fa6bed1 (77 DONE, 9 PARTLY, 1 NOT DONE,
4 OWNER-QUESTION), and it drove Jobs 2, 3 and 15. It also found a real login-security gap for Claude (13 Nov #24/#29:
an account could enrol the authenticator app without a password, but the server asks for the code only on password
login), which led to the owner's 16 Nov 17:38 ruling.

Spot-checked on 1fa6bed1 (all correct): 12 Nov #24 (`Login.tsx:107` warning sentence), #28/#41
(`loginCode.ts:20,23` LOGIN_CODE_LENGTH 48, RECOVERY_CODE_LENGTH 64), #39 (`auth/Login.tsx` key box `rows={18}`,
`x2f-textarea--tall`), #43 PARTLY (`tokens.json` body 17px), 13 Nov #32 PARTLY (`ScreenHeader.tsx:21` maps every
`/setup` route to "Create account").

## Why it should not land on its own

`wip/agy-notes-finish` (Job 15) re-creates the same path, `docs/owner-notes-status-2026-11-16.md`, on base 94337781
(which does not contain this commit). Landing both gives an add/add conflict on that file, and the later version is
the one that is up to date. `wip/lead-agy-notes-finish-fix` (the fix of review-agy-notes-finish B1-B3) is the version
to land. This branch can then be deleted.

## Minors (already handled in the notes-finish fix, listed for the record)
- M1. 12 Nov #17 (`26d861d0`) is marked OWNER-QUESTION; it is the owner's standing rule, not a question.
- M2. 12 Nov #31 is OWNER-QUESTION here; the owner answered it on 16 Nov #7 (after this audit was written).

## Checks
See the "Full check" line at the end of this file.

- Full check: queued on the shared lock (detached chain lead-agy-chain.sh); not finished at handback. Verdict stands only once it is green.
