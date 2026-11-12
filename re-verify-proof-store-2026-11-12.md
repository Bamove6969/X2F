# Re-verify: proof storage review fixes, wip/lead-proof-store

- Range: `origin/wip/lead-proof-store` from `6bbadbbf` to `1e2599dd` (6 commits: red + fix pairs
  `4ad39e0f`/`9280dcc8` securing, `60fd2b4e`/`bf2500d4` M1-M4 + I1-I3, `02a9ff7b`/`1e2599dd` PUT budget).
- Against: `review-proof-store-2026-11-12.md`.
- Method: I read the diff. Then, in a detached worktree at `1e2599dd` with a fresh `npm ci`, I ran the
  head tests, each red-test commit on its fix's parent, a mutation pass (each fix undone in turn, with
  the targeted test run), and a throwaway probe file against a real listening server, aimed at the new
  budget. All runs went through `~/x2f-comms/check.lock`, with the timeout inside the flock. The
  worktree and its node_modules were removed afterwards. Nothing was committed.
- Reviewer: independent helper, 12 Nov 2026.

## Verdict

**All items are fixed at their cause and pinned. No blocking or minor findings. Ready to land.**
Every fix's test is red on the code before it, or (I1, I2) it bites when the guarded code is broken.
No test was weakened, and the regression files are green. Three info notes are at the end.

## Per item

| Item | Fix at the cause | Pinned (red before / mutation) | Verdict |
|---|---|---|---|
| M1 session before body | `onRequest: [requireTraderFirst, proofBudget]` (`touch: false`), and the preHandler `requireTrader` is kept, so `runsWithSession` and the touch still apply | Red at `60fd2b4e`: `4194305: expected 413 to be 401`. Mutation (onRequest removed): M1 and budget tests red. Probe: a raw socket sending headers only (Content-Length 4 MiB, no body) gets `401` at once, also for 4 MiB + 1. The control with a live session and budget left gets no answer: the server is waiting for the body | Fixed |
| M2(a) party in the lock | `where code = $1 and $2 in (buyer_account_id, seller_account_id) for update`. An outsider matches no row | Red at `60fd2b4e` (`'blocked'`, not 404). Mutation (old lock, then party check): red | Fixed |
| M2(b) purge lock | `select 1 from trades where code = any($1) order by code for share`, before `set local role`, as in `purgeChats` | Red at `60fd2b4e`. Mutation (no `for share`): the uncommitted-dispute test goes red ("never waited"). Mutation (no trades `not exists`): the "trade in dispute, no row" case goes red. Mutation (no disputes `not exists`): the "open row, closed trade" case goes red. Each re-check is now caught on its own | Fixed |
| M3 date only | 580 edited in place: `used_on date not null`, written as `($2::timestamptz at time zone 'UTC')::date`. 580 is not on `origin/main`, so an in-place edit is safe. Nothing reads the old `used_at` | Red at `60fd2b4e` (column list). The test pins both the columns and the stored UTC day | Fixed |
| M4 separate caps | `countProofs` filters on `kind`. `CAP = { proof: 5, evidence: 5, unblurred: null }` | Red at `60fd2b4e`. Mutation (count all kinds): red | Fixed (see N1) |
| I1 vacuous assertion | Asserts `kind in ('proof', 'evidence')` inside `readableProof` in `store.ts` | Not red at `60fd2b4e` (the code was already right; this only strengthens the test). Mutation (filter removed from `readableProof`): the tripwire goes red | Fixed |
| I2 tripwire scope | Scans all of `apps/api/src` except `proofs/` and `retentionJobs.ts`, and checks that the scan reaches `staff/app.ts`, `trades/held.ts`, `disputes/moderationClient.ts` and `internal/` | Mutation (a `readableProof` line added to `trades/held.ts`): red | Fixed |
| I3 stale marker | `staffRoutes.ts` now says `NEEDS_P4_CHAT_MEMBERSHIP (was NEEDS_P5_PROOF_ENVELOPE)` with the OPEN (lead) note. coordination.md is updated | Comment and doc only | Fixed |
| Securing refused | `PROOF_STATES` no longer has `securing`: 409 `wrong-state`, nothing stored | Red at `4ad39e0f` (1 failed / 18). Mutation (`securing` added back): red. The old "securing passes" case became `secured`. That follows the ruling and is not a weakening | Fixed |
| PROOF_PUT_BUCKET 20 / 2 a minute | `KeyedBuckets` keyed by `req.auth.accountId`, taken in onRequest after the early session check | Red at `02a9ff7b` (1 failed / 27). Mutation (budget moved to the preHandler, after the body): red, because the over-cap body gets 413, not 429. Mutation (keyed by trade code): red, because the partner gets charged | Fixed |

## Trying to break the rate limit (probe, real listening server)

| Attack | Result |
|---|---|
| Body read before the 429 | Drained buyer, headers only, 4 MiB announced, no body sent: `429` at once. Same with a bad `?kind=`: the 429 comes before the 400, so every try counts |
| Body read before the 401 | No cookie, or a revoked session: `401` at once, no body read. Ten unauthenticated tries add no key to the bucket map (4 keys before, 4 after) |
| Charging the wrong account | Buyer drained, then the seller's evidence on the same trade: 204. A member of a fresh owner tries 25 times, all 403 `owner-only`, and the owner then has a full bucket (no 429 within 20). The drained buyer on another trade: 429, because the key is the account, not the trade |
| Race | 30 parallel PUTs from a fresh buyer: exactly 20 pass the budget (5 × 204, 15 × 409 too-many-proofs) and 10 × 429. `take` is synchronous, so there is no overshoot |
| HEAD | Fastify's HEAD is the GET's (party read). It is not charged and parses no body. A drained buyer gets the GET's normal answer (404 for an unknown id) |
| POST / PATCH / DELETE / OPTIONS on the proof path, 4 MiB announced | `404` at once, no body read (no route; the root 404 does not wait for the body) |
| Path variants | A trailing slash gives `404` at once (no route). A lower-case code reaches the route and is charged (`429`). No variant reaches the handler without the onRequest hooks |

## Tests run (`1e2599dd` unless stated; single files, serialised)

- `proofs.test.ts`: 27/27 pass.
- `disputes/staff.test.ts`: 27 pass, plus 1 todo that was already on the base.
- `frontDoor.test.ts`: 21/21. `purge.test.ts`: 8/8. `schema.test.ts`: 77/77. `coolingOff.test.ts`: 95/95.
  `limits.test.ts`: 9/9.
- `tsc -p apps/api --noEmit`: clean.
- Red checks: `4ad39e0f` proofs 1 failed / 19. `60fd2b4e` proofs 7 failed / 26 (M1, M2a, M2b ×3, M3,
  M4), and staff 27 pass + 1 todo (I1 and I2 strengthen the test only, see the table). `02a9ff7b`
  proofs 1 failed / 27.
- Mutations: 12 run (targeted `-t` on proofs or staff). 11 went red. The 12th (`unblurred: null` →
  `PROOF_MAX_PER_SIDE`) stays green, and that is expected: the count is per kind, so it only caps
  unblurred copies at 5. See N1.
- Throwaway probe: 2/2 ran. The results are in the table above. Deleted with the worktree.

## Info notes (none blocking)

- **N1. The M4 test covers one order only.** It fills 5 proofs and 5 evidence, then uploads an
  unblurred copy. With per-kind counting, nothing pins the reverse: an unblurred copy uploaded first
  must not take an evidence slot. The "count all kinds" mutation is caught, so this is a thin gap.
  An optional line: unblurred first, then 5 evidence all 204.
- **N2. The `routes.ts` comment overstates the web.** It says the server refuses `securing` "as the
  web's chat engine refuses its `proof.attached` (`not-ready`)". At this head, `apps/web/src/chat/engine.ts`
  has no `proof.attached` send at all. That gate belongs to the proof-upload branch (proof-upload
  review M4). This is a comment only; the server side is correct on its own.
- **N3. The new purge test can leak a transaction if it fails.** In "a dispute not yet committed…",
  the `finally` calls `dispute.release()` without a `rollback`. If the poll throws, an open
  transaction holding the trade's row lock goes back to the pool, and later tests can hang instead of
  failing. Suggest `await dispute.query('rollback').catch(() => {})` before the release.
- Residual by design: an account with budget left can still make the server buffer up to 4 MiB on
  each of 20 tries at once, then 2 a minute. Refusals other than 401/429 (400, 409, 415) still come
  after the body. That matches the lead's sizing. The bucket is per process, as every `Budgets` entry is.
