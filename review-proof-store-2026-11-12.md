# Review: proof storage (Plan 5 Task 14), wip/lead-proof-store

- Reviewed: `origin/wip/lead-proof-store` at `6bbadbbf`, base `6ebed537` (one commit).
- Scope: `apps/api/src/proofs/{routes,store}.ts`, `migrations/580_trade_proofs.sql`, `purgeProofs` and
  `retentionJobs.ts`, `test/proofs.test.ts`, the `staff.test.ts` tripwire, and the `hold.ts`, `frontDoor.ts`,
  `errors.ts`, `purge.test.ts` and `schema.test.ts` edits.
- Method: I read the code, then ran a throwaway probe test file in a detached worktree (deleted after,
  not committed) to try each attack listed below against the real app and a Docker Postgres.
- Reviewer: independent helper, 12 Nov 2026.

## Verdict

**Ready to land after the lead looks at M1 to M3. No blocking findings.** Wrong-party, wrong-state, the
cap, one-time ids, the unblurred copy, outsiders, team members, content type, caching, logs, and staff
or internal relays all held under every probe. The three minor findings are hardening or retention
gaps, and none of them leaks a proof today. M4 is an owner question.

## What I tried, and the result

| Attack | Result |
|---|---|
| Seller uploads `kind=proof` | 403 `wrong-party`, nothing stored (test) |
| `proof` in funding / released | 409 `wrong-state`. securing, secured and paid pass (test) |
| `evidence` with no dispute, or after it closes | 409 `wrong-state` (test) |
| `unblurred` with no request, from the wrong side, a second time, or on a closed dispute | 409 `not-requested` (test) |
| Sixth upload, sequential and 8 in parallel | 409 `too-many-proofs`, exactly 5 stored. `for update` on the trade row serialises them (test) |
| Same id again on the same trade, on another trade, and after its row is deleted | 409 `proof-exists`, stored bytes unchanged (test). Two parallel uploads with one id: the second waits on the `proof_id_tags` unique index, so only one is stored |
| `proof_id_tags` linkage | Columns are only `tag` (sha256 of a domain-separated id) and `used_at`. No trade, side or foreign key. `used_at` matches the proof's `created_at` to the millisecond (see M3) |
| Trader GETs an `unblurred` id | 404, same body as an unknown id (test) |
| Outsider GET or PUT, on an existing trade or an unknown code | 404 `not-found` for all four, same body. Mean timing 3.2 ms against 3.4 ms (noise) |
| Party GETs another trade's proof id, through either trade code | 404. `readableProof` filters on `trade_code` |
| Team member, with `proof-upload` / `proof-see-partner` granted | 403 `owner-only` before any trade lookup, so nothing can be probed (test) |
| Content types | `application/json`, `text/plain`, `multipart/form-data`, `application/octet-streamx`, `application/octet-stream+json` and no type all get 415. Upper case and `; charset=` are accepted as raw bytes. Nothing is parsed |
| Query smuggling | `?kind=proof&kind=evidence`, an extra parameter, or no kind: 400 |
| PUT without Origin | 403 (CSRF hook) |
| Caching | GET answers have `cache-control: no-store`, `nosniff` and `application/octet-stream`. 404s and 409s on `/v1` get `no-store` from the global hook. No ETag plugin. HEAD (Fastify's automatic one) has the same guard: 200 for a party, 404 for an outsider |
| Logs | Captured logger over a full flow: no id, code, size or bytes (test). In my probe app, refusals and 404s logged nothing at all |
| Staff or internal relay | No proof table, route or `readableProof` anywhere outside `src/proofs`. Grepped all of `apps/` and `packages/` |
| Retention | Kept 29 days after an undisputed close, gone after 31. Never while a dispute is open (checked at +400 days). Gone 90 days after the dispute closes, not 89. `on delete cascade` to `trades` |
| x2f_purge rights | Has `select, delete` on `trade_proofs` (580), `select` on `trades` (104) and `select (code, status)` on `disputes` (122). That is enough for the delete's re-check |

## Findings

### Minor

**M1. The proof upload buffers up to 4 MiB before it checks for a session (256 times the global limit).**
`bodyLimit: PROOF_MAX_CIPHERTEXT` and the content-type parser run before the `requireTrader` preHandler.
The only hook ahead of them is the Origin check, and a script can always send a matching Origin.
- Scenario: a client with no cookie sends `PUT /v1/trades/X/proofs/<any valid id>?kind=proof` with
  Origin set and a 4 MiB octet-stream body. The server reads all 4 MiB, then answers 401. Probe:
  `unauth4M` gave 401 and `unauth4Mplus` gave 413, while a 1 MiB JSON body on `POST /v1/trades/:code/chat`
  is cut off at 16 KiB with 413.
- Effect: unauthenticated memory and bandwidth amplification. Every caller with a session (any party,
  any number of retries) can do the same: no rate budget is applied, and 409 refusals also arrive only
  after the full body has been read.
- Fix (engineering): check the session in an `onRequest` hook on this route, before the body is read.
  Optionally also check that the caller is a party there. Add a `budgets` entry for PUT if the lead
  wants a per-account rate limit.

**M2. An outsider's PUT takes `FOR UPDATE` on the victim's trade row. `purgeProofs` takes no trade lock.**
1. **Outsider lock.** In `routes.ts:68-73`, the lock is taken before the party check. Any trader who knows
   a trade code can repeatedly row-lock someone else's trade. Each lock is brief (404 and rollback), but
   it queues behind, and delays, the real parties' transitions.
   - The lock also adds a timing side channel. My probe held the row lock in another session: the
     outsider's PUT blocked until it was released and only then answered 404. An unknown code answers at
     once, so the wait reveals that the trade exists and is busy.
   - Fix: put the party test in the locking query (`... where code = $1 and $2 in (buyer_account_id,
     seller_account_id) for update`), or read without a lock first and lock only for a party.
2. **Purge race.** The delete in `purgeProofs` re-checks open disputes, and the commit message and
   coordination.md say this keeps proofs when "a dispute opened since the scan". It only protects
   against a dispute that has already committed. `purgeChats` fixed exactly this gap (review M2) by
   locking the trades `for share` first. `purgeProofs` does not.
   - Probe: a closed trade, 40 days on, with a dispute open in an uncommitted transaction. `purgeProofs`
     did not wait, deleted the proof, and the dispute then committed with the proof gone.
   - It cannot happen today. A dispute can open after close only within `disputeAfterRefundHours` (48 h),
     while proofs need 30 days.
   - Fix: copy the chat purge's `select 1 from trades where code = any($1) order by code for share`
     before the role switch, and add a test. No current test exercises the delete's own re-check:
     removing both `not exists` clauses still passes `proofs.test.ts`.

**M3. `proof_id_tags.used_at` stores the exact upload time and is never purged.**
The tag is unlinkable, but its full-precision timestamp equals `trade_proofs.created_at`. Nothing reads
`used_at`.
- Scenario: a database reader sees a tag with `used_at = 2026-10-17T12:00:00.000Z`. They match it to
  trade events, the activity log or backups that hold that trade's mark-paid or dispute times. Long
  after the proof is purged, they learn that this trade had a proof upload, when, and how many.
- Fix (engineering, no behaviour change): store a date only (`used_on date`), or drop the column.

### Owner question

**M4 (owner question). The 5-per-side cap counts every kind, and nothing frees a slot.**
- Scenario: a buyer uploads 5 payment proofs while paid (retries or several screenshots). The seller
  disputes, and the moderator asks the buyer for the unblurred copy. Probe: the `unblurred` upload is
  409 `too-many-proofs`, and so is new `evidence`. The buyer cannot answer the moderator and has no way
  out. The moderator's only remedy is to rule without it.
- P5-A25 reads "PROOF_MAX_PER_SIDE = 5 per trade" and does not say whether evidence and unblurred count.
- Recommendation: leave the cap on `proof` and `evidence` together, and let `unblurred` (one per
  moderator request, already enforced) not count. Otherwise give `evidence` its own allowance in a
  dispute. This changes what users can do, so it is the owner's decision.

### Info

- **I1. The tripwire's last assertion is vacuous.** `expect(routes).toMatch(/kind in \('proof', 'evidence'\)|readableProof/)`
  matches `routes.ts`'s import of `readableProof`, so it would still pass with the kind filter gone. The
  real guard is the behavioural 404 test in `proofs.test.ts`. Suggest asserting on `store.ts` for
  `kind in ('proof', 'evidence')`.
- **I2. The tripwire covers less ground than its name says.** It scans `disputes/staffRoutes.ts` and
  `src/internal/` only. A proof relay added under `src/staff/*.ts` (16 files with `/staff/v1` routes),
  `trades/held.ts` or `disputes/moderationClient.ts` would not trip it. Suggest scanning all of
  `apps/api/src` except `proofs/` and `retentionJobs.ts` for `trade_proofs|readableProof`.
- **I3. Stale marker.** `staffRoutes.ts:493` still says `NEEDS_P5_PROOF_ENVELOPE`, and coordination.md:771
  still describes the old tripwire. Grepping the old name now finds source with no test, so suggest
  renaming the comment to `NEEDS_P4_CHAT_MEMBERSHIP` and pointing it at the OPEN (lead) item.
- **I4. The id-existence oracle is only theoretical.** `proof-exists` is global, so a party to any trade
  can ask whether a known id was ever stored anywhere, or pre-claim one.
  - Scenario: the partner learns an id before it is uploaded, for example if the client sends the sealed
    `proof.attached` before the PUT. With an open dispute on another of their trades, they upload garbage
    under that id there, and the victim's upload gets 409.
  - Ids are 128-bit random and the AAD binds the trade code, so this needs a leaked id. Client order
    (upload first, then announce) closes it. Worth a line in the Task 15 notes.
- **I5. Deliberate deviations from the plan, all documented in coordination.md.**
  - No `proof_requests` table: the request lives on `disputes`, one per request via `created_at >= proof_requested_at`.
  - No internal or moderator read, per the lead's 2026-11-08 ruling. So an `unblurred` upload is
    currently readable by nobody and still uses a cap slot (see M4).
  - Error code `proof-exists` instead of the plan's `exists`.
  - Purge is 30 / 90 days, per the owner revision.
- **I6. Cascade is fine.** Nothing deletes trades today, so `on delete cascade` is belt and braces. The
  test checks `confdeltype = 'c'`, which is enough.

## Matrix rows and tests

- **Team abilities.** `team/abilities.ts` rows 33 to 35 (`proof-upload`, `proof-see-partner`,
  `proof-blur-check`) are unchanged and stay `waits-member-chat-key`. The routes are owner-only
  (`requireSession` with no `member`), which matches.
- **Front door and hold.** `frontDoor.ts` lists the GET under OWN_DATA_READS and the PUT under
  OWN_DATA_WRITES. `hold.ts` lists the PUT in LIVE_SESSION_EXEMPT under R42 (finishing open trades). Both
  are participants-only and correct. HEAD is Fastify's automatic one and is covered by the GET's guard.
- **No test weakened.**
  - The `staff.test.ts` tripwire was a "no proof table yet" trigger. It is now a positive "table exists,
    no relay" check. That is a rewrite, not a weakening, apart from I1 and I2.
  - `purge.test.ts` and `schema.test.ts` only add `purgeProofsJob` and `580_trade_proofs.sql` to their
    expected lists.
  - Nothing was skipped, removed or loosened.
- **Tests I ran** (detached worktree at 6bbadbbf, fresh `npm ci`, serialised runner, single files):
  - `proofs.test.ts`: 18/18 pass.
  - My throwaway probe file: 6/6 ran; the results are in the table above. Deleted after.
  - `disputes/staff.test.ts`, `frontDoor.test.ts`, `purge.test.ts`, `coolingOff.test.ts`: see the report
    (filled in below).
  - `tsc -p apps/api --noEmit`: clean.
