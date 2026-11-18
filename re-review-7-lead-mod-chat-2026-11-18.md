# Re-review 7 (confirm pass): wip/lead-mod-chat @d7d67632, 18 Nov 2026

This is an addendum to `re-review-6` (APPROVE at 197ccfeb). New since then:
- 88c66bc6: test only;
- 7a9b99d7: the merge of main f1244a22, train-2;
- d7d67632: the help library and crypto spec wording, and the role test.

I read it in a detached scratch worktree and changed no code.

## Verdict: APPROVE (two wording minors in the public spec, not blocking)

### The merge kept both sides

- **Mod-chat code is as approved.** Against 88c66bc6 the merge changed only `disputes/staffRoutes.ts`, `staff/app.ts` and `ModCase.tsx`, and only by adding train-2 content:
  - the comply-lapsed queue rows and `compliance` for seniors and the owner;
  - the log and training route registration;
  - the proof-check-failed hint.
- Untouched by the merge: decision 16 (`apps/api/src/chat/routes.ts`), the web engine and chatCrypto, the staff-web key worker and client, `moderation/src`, `packages/protocol`, `staff/devices.ts`, DeviceCard and the webauthnTripwire list. STAFF_CSP is unchanged, `worker-src 'self'` included.
- **Train-2 code is as on main.** Of the 106 files train-2 changed, 21 differ from main in the merge. In every one, the lines that differ from main are mod-chat's own code replacing the pre-mod-chat main code: the countersigned messages route instead of the plaintext one, the dispute grant retry, ModCase's chat card, the CSP comment and the `wasm-unsafe-eval` line, and `queryLog`'s role scope. Nothing of train-2 is dropped.
- Not changed at all from main: training curation (`staff/training.ts`: owner-only, tags fail closed), ruling compliance (`disputes/comply.ts`, `txProofCheck`, moderation `execute.ts`) and the watchdog.

### The log-role wiring

`apps/api/src/staff/activityLog.ts`, the `/staff/v1/log` route:
- `role` comes from `req.staff.role` (the server's session row, `requireStaff`), and only `senior`, `mod` and `helper` are passed. Anything else gets the narrowest view (`CHAT_READ_VISIBILITY[role ?? 'mod']`).
- The role changes only the `chat.read` predicate. The staff scope (disputed trades only, owner-only prefixes excluded) is unchanged.
- `all` (the owner's view) needs `log.read.all`, which is not in `GRANTABLE_PERMS`, so no grant widens it.
- The new route test fails without the wiring: I reverted it and the test went red.
- Nothing widens beyond the lead's settled p12-11 definition: a senior also sees `chat.read` on any trade they have another log entry on.

### The public wording (`docs/public/x2f-crypto-spec.md` 4.3/4.4, `helpLibrary.ts`)

Mostly accurate to the code:
- the moderation service needs a trader's grant;
- staff reads are logged, with the access record in moderation's own database;
- a device keeps receipts, never message text or TK, and is erased on a 410 purge;
- 4.4 is marked "Built".

The help sources point at the right lines: spec lines 163 and 166, `ModCase.tsx:95-96`, `engine.ts:51` and `engine.ts:191`.

Minors:
- **m1. Spec 4.3, first paragraph: "Once a chat has a key, the API takes no v1 chat message".** Under decision 16 the API takes exactly one v1 per open moderator request, from the side asked: the unblurred proof copy. Two bullets later the spec mentions that copy, but this sentence is false as written. Suggest: "… takes no v1 chat message except the unblurred proof copy a moderator asks for (below), and no trader's app opens one."
- **m2. Spec 4.3, same paragraph: TK is "stored only as wraps to the buyer and the seller".** After a grant there are also wraps to the moderation service and to each certified staff device that reads, as the next bullet and 4.4 say. Suggest "at first, only as wraps to …", or point to 4.4.

## Tests (nice, no lock)

| Suite | Files | Passed |
|---|---|---|
| staff-web (whole project) | 21 | 191 |
| web: helpLibrary, chatEngine, chatCrypto, disputeGrant, dispute, chatProofSend | 6 | 211 |
| moderation: internal, gateDevices, execute, watcher, grant | 5 | 102 |
| api: staff/activityLog, disputes/staff, disputes/comply, disputes/txProofCheck, disputes/rulings, chat, chatGrant, staff/web, staff/devices, schema, log | 11 | 310 |

Playwright was not re-run, since no Playwright spec or staff-web key code changed. The full suite is Runner I's job.
