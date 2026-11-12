# Security review: J-14 J6 sealing of ticket text, `wip/second-support-tickets` e9fecce2

Reviewer: independent security reviewer (cloud helper), 12 Nov 2026. Read-only on code.
Head e9fecce2 = merge 3a29e510 of main 6ebed537 onto 02369b53 (READY on main 8cca6d77). Earlier reviews: `review-j14-support-tickets-2026-11-09.md` (J1-J8 at 41751b28, and its re-verify R1-R8 at 3a438934).
New since the re-verify: 8320dc6a (red sealing tests), 53ad6096 (sealing, migration 451), 64d013df (timer test fix), f2fd4ec3 (jabber-paths classification), 02369b53 (READY), plus three main merges. The last merge (3a29e510) touches no J-14 file: `git diff 02369b53 e9fecce2` is empty for `apps/api/src/tickets/`, migrations 450/451, `trades/store.ts`, `config.ts` and both ticket test files.

Scope: J6 sealing (`ticket_messages` under `X2F_TICKET_KEYS`), the public compromised-account route as it now stands, migrations 450/451, and what the merges changed on the lock. MONEY/LOGINS: the lock and unlock decide who can log in and whether a trade's coins can move.

## Verdict: PASS for J6 sealing. J-14 as a whole is still HELD on the owner (J1-J3, p11-78..80, unchanged and still pending in the register)

Counts: 0 Major, 2 Minor (S1, S2), 4 Info (S3-S6). None of them blocks the sealing. S1 is a cross-feature edge for the lead or owner. S2 is a small hardening that is cheap to do before 450/451 land.

The sealing is done the way the codebase already does it, and it is done correctly:
- The text is stored only in `body_sealed`. It is format 1 of the shared key store (`auth/keystore.ts`): AES-256-GCM with a random 12-byte nonce. The associated data is the 3-byte header plus `x2f/ticket-message/<ticket>/<message>`, so neither the key id nor the row binding can be swapped.
- The message id is generated before sealing (`insertMessage`), so each blob is bound to its own row. A blob moved to another message or ticket does not open (tested).
- Every write path goes through `insertMessage`: the trader's open, the trader's reply, the staff reply and the compromised comment. `git grep ticket_messages` at e9fecce2 finds no other reader or writer outside `tickets/seal.ts`, apart from the staff-name join (`staffRoutes.ts:80`), which reads only `staff_id`. The old plaintext `ticketMessages` reader is gone.
- Every read path goes through `readThread`. It has exactly three callers:
  - `GET /staff/v1/tickets/:id` (`tickets.handle`)
  - `GET /staff/v1/compromised/:id` (`accounts.freeze`)
  - the trader's own `GET /v1/tickets/:id`, which filters `account_id` and `kind = 'support'`, so nobody, the thief included, can read a compromised comment through it.

  Both staff reads now write their `ticket.viewed` / `compromised.viewed` row in a committed transaction *before* opening the text (`staffRoutes.ts:86`, `:170`). No staff open happens without an audit row, and a failed log write fails the read. The support route filters `kind = 'support'`, so `tickets.handle` alone cannot open a compromised comment.
- The read fails closed. A blob that does not open makes the whole read a 500. The key store's error names a key id at most, and the UTF-8 decoder is `fatal`. Tests check that neither the response body nor either app's logs carry the text.
- The keys are kept apart. `X2F_TICKET_KEYS` (env or `_FILE`) is required, and it is added to `assertSeparate`, so its keys must differ from `X2F_SERVER_KEY` and every other ring (tested, and the error names the variable, never the key). The staff API runs in the same process with the same `config` (`main.ts:154`), so there is no second copy of the ring to forget.
- The schema backs it up. Migration 451 adds `ticket_messages_one_form` (exactly one of `body` or `body_sealed`) and a size check: 32..16031 bytes and first byte 0x01, which matches 31 bytes of overhead plus at most 4000 code points x 4 bytes. `TICKET_BODY_MAX = 4000` (packages/core). The empty compromised comment writes no row at all, so the 32-byte minimum can never be hit.
- Rotation and old rows:
  - `rewrapTicketSecrets` reseals only blobs not under the current key. It is compare-and-swap per row (`where body_sealed = $2`), counts blobs that do not open as `failed` without touching them, and returns counts only.
  - `sealPlaintextTickets` plus `assertTicketsSealed` in `main.ts` follow the FU-D login-name precedent.
  - `docs/dev-setup.md` documents the ring, the 451 steps (including `VACUUM FULL` and the warning about backups and WAL) and rotation.
- Lists, logs and the audit log never carry the text. The four list routes return metadata only, and a test greps lists, both apps' logs and `activity_log` for every marker, refusals included.
- The compromised route's timing (J4) is unaffected. The comment is sealed inside the same transaction whether the name matched or not, so sealing adds no difference between a matched and an unmatched name.

## Findings

### S1 (Minor, lead or owner): when a recovery hold ends during a compromised-account lock, the partner's recorded buyer-cancel is dropped silently
02369b53 added a refusal in `applyEvent` (`store.ts:379-381`): `if (by !== 'system' || e.type === 'resume')`, then 409 `trade-held` while either party is locked. This correctly stops main's hold-v3 sync from resuming a trade the lock also holds.

But `syncHeldTrades` (`trades/held.ts:135-153`) does three things when a hold ends:
1. It tries `resume`, which is now refused and caught. That is fine: the timer loop's `decide` resumes the trade after the unlock, because a paused trade with no held row and no maintenance gets `resume`.
2. It carries out the partner's recorded `buyer-cancel` (owner G7, lead review 8 Nov I5) as a `'buyer'` event. That is also refused with `trade-held` and caught.
3. It then **deletes the held_trades row**, and with it the recorded `cancel_requested_at`.

So if a recovery-code hold ends while a compromised lock is on the same trade, the buyer's cancel request is lost without anyone being told. After staff unlock, the trade resumes as if the buyer had never asked. No coins move wrongly, because the lock blocks everything, but a request G7 says is "carried out" is silently dropped.

There is also no test for the hold-ends-while-locked path at all. Neither the resume refusal nor the cancel loss is pinned (`grep` finds no test that combines `held_trades` with `account_locks`).

Recommendation (engineering, behaviour for the lead to confirm): when the trade is lock-held, keep the released row, or carry its `cancel_requested_at` forward, so that the cancel is applied after the unlock. Add a test with a hold and a lock on the same trade (hold ends first, then unlock) that pins both the resume and what happens to the recorded cancel. If the owner would rather drop the cancel, the buyer should be told.

### S2 (Minor, hardening): migration 451 leaves a plaintext `body` column that is still writable while the API runs
`ticket_messages.body` stays as a nullable `text` column, and `ticket_messages_one_form` allows a row with only `body`. Today no code writes it. But any future code that inserts with `body` would store plaintext and succeed at runtime. Only the next restart's `assertTicketsSealed` would notice, and refusing to start is then an outage.

Migrations 450 and 451 have never been on main: main has nothing in 450-459, and the register shows J-14 in flight. So no production deployment has plaintext rows, which `dev-setup.md` also says ("Before launch there should be no rows to seal"). Options, recommendation first:
- (a) Fold 451 into 450 before landing. `ticket_messages` is created with `body_sealed bytea not null` and the size check, and has no `body`. `sealPlaintextTickets`, `assertTicketsSealed` and `seal-tickets` become unnecessary. Only dev databases that ran the branch's 450 would need recreating.
- (b) Keep the two-step design, and add a trigger or check so that new rows (`insert`) may not set `body`. Only the one-time tool's `update` then touches it, and step 2 drops it.

Either way the plaintext path cannot come back silently. This is the lead's call. It does not block, because the startup check does catch it eventually.

### S3 (Info): what at-rest sealing does and does not protect
The ring lives in the API process next to the database credentials. Sealing protects against a database dump or backup, a replica, someone with access to the database host, and SQL-level reads by staff tooling. It does not protect against a compromised API process, which is the same model as TOTP and Jabber addresses (Plan 6 moves to an HSM or KMS behind `SecretBox`).

The binding covers confidentiality and which row a blob belongs to. It does not cover the `author`, `member_id`, `staff_id` or `at` columns, or the message order. A database writer could relabel a trader message as a staff reply, or delete messages. That is out of scope for J6, and noted only so that nobody reads "sealed" as "tamper-evident thread".

### S4 (Info): staff audit rows come before the open, but nothing records that an open failed
If `readThread` throws after `ticket.viewed` was written, the audit says "viewed" although nothing was shown. This is harmless and is the right order (fail closed, over-record). A key-ring problem shows up only as a 500 in the logs, plus `failed` counts from `rewrap-tickets`.

### S5 (Info): the open owner question on the Jabber notice at lock time (raised in 02369b53) is real
A lock sets `accounts.disabled_at`, which is a Jabber change path, so the locked account's Jabber address gets a notice. When the thief also controls that address, the notice tells the thief that the real owner has reported the account, before staff have talked to anyone. When the real owner controls it, the notice is the only sign they get that the lock worked (or that a griefer locked them, J1).

I agree with routing it to the owner. My recommendation: send the notice, but word it as "your account is locked pending a support check; contact staff on Matrix/Jabber", not as "someone reported your account compromised". It should reveal nothing beyond what a refused login already shows (`account-disabled`).

### S6 (Info): J1-J3 unchanged; the earlier re-verify still holds
Since 3a438934, `traderRoutes.ts` changed only by the `insertMessage` call and comments. `lock.ts`, `held.ts`, the unlock route and the form's validation are byte-identical.
- J1 (an anonymous instant freeze with no proof, mass griefing), J2 (the counterparty cannot open a dispute on a held trade; the appeal and the moderator freeze refuse a held trade too, R7) and J3 (unlock restores every method, the thief's included) are exactly as built and still need the owner (p11-78..80, pending in `owner-answers-register.md`).
- R2-R6 still hold: the 202 goes out before `afterLock`, the form has its own `COMPROMISED_BUCKET`, the staff reads are audited, there are real password and recovery-code refusal tests, and there is one `PUBLIC_ROUTES` entry.
- Permissions are unchanged: `tickets.handle` for support, `accounts.freeze` plus a bound `unlock-account` key tap for compromised. `tapPermOf('unlock-account')` returns `accounts.freeze`, and the intent parser takes exactly `{kind, accountId}`.
- f2fd4ec3 classifies `tickets.account_id`, `ticket_messages.staff_id` and `account_locks.*` as silent in `NOT_ACCOUNT_CHANGES`. That is right: the lock and unlock notify through `disabled_at` (see S5).

## Tests run (serialised runner, throwaway worktree `rv-j14c` at e9fecce2, fresh `npm ci`)
- `apps/api/test/ticketSealing.test.ts`: 11/11 passed (the J6 sealing suite).
- `apps/api/test/tickets.test.ts`: 20/20 passed.
- `apps/api/test/schema.test.ts`: 78/78 passed (451 is in the migration lists).
- `apps/api/test/holdV3.test.ts`: 45/45 passed (main's hold sync, which is next to S1; none of its tests combines a hold with a lock).
- `npx tsc -p apps/api --noEmit`: clean (exit 0).

Not run (capacity rule): `disputes/trader.test.ts`, `disputes/staff.test.ts`, `timerLoop.test.ts`, the web and staff-web unit tests, the Playwright specs, and anything Monero. The READY commit reports a full run (6587 passed, 1 known moderation flake), which I did not repeat.

Environment note: dockerd was not running on the box when this review started. The scratchpad `restart-dockerd.sh` brought it up, but dockerd inherited the runner's test-lock file descriptor and held the lock, so every helper's queued run stalled. I restarted dockerd with fd 9 closed. I also changed the script's `nohup dockerd` line to add `9>&- < /dev/null`, so the same thing cannot happen on a later restart.

## Questions (with recommendations)
1. **S1 (lead, then the owner if he wants it):** when a recovery hold ends during a compromised-account lock, should the partner's recorded buyer-cancel wait for the unlock? Recommend yes: keep it, carry it out after the unlock, and add the hold-plus-lock test.
2. **S2 (lead):** fold migration 451 into 450 before landing (no plaintext column, no seal tool), or keep the two steps with an insert guard? Recommend folding, since 450 has never shipped.
3. **S5 (owner, already raised by claude2):** a Jabber notice on lock. Recommend yes, with neutral wording that does not say "reported compromised".
4. J1-J3 (p11-78..80) are still the blockers for landing J-14. Nothing in this round changes them.
