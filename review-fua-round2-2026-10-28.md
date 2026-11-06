# Re-review round 2: wip/lead-p2-fua @32880eb (FU-A, after 8865781): APPROVED (Minors only), 2026-10-28

Scope: f0248a0 (crossing names; login-name route behind a confirm), 25e411f (docs), cb7bee6 (merge of main line a3a7d7f), 32880eb (username sweep). Read-only. I checked against `~/x2f-comms/review-fua-2026-10-27.md`, `docs/superpowers/reviews/2026-10-27-p2-fua.md` (lead decisions) and the round-2 item list in `LEAD-HANDOFF.md` item 2.

Checks run at 32880eb (worktree `~/x2f-worktrees/lead-fua`, under flock):
- `tsc --noEmit` passes for apps/api, apps/web and packages/auth-client.
- `vitest run` on schema, account, password, events, nudge and view tests (apps/api): 6 files, 226 tests passed.
- A probe against a throwaway postgres container, using the test's own crossing loop on a minimal accounts/name_keys schema:
  - Old trigger (display key first): 28 of 50 rounds ended `40P01`. Each run of 5 rounds hit at least one deadlock 3 times out of 3.
  - New sorted trigger: 50 of 50 rounds ended `ok` + `23505:name_keys_pkey`.
  - So the new race test does catch the old bug: with a per-round deadlock rate of about 0.56, five rounds would all miss it only about 2% of the time.

## Round-2 items: all fixed

1. **Crossing-names deadlock.** Fixed. `009_login_names.sql:55-61` inserts an account's keys least key first. Both transactions wait on the same minimum key, and the loser gets `23505 name_keys_pkey`, which is `names-unavailable`. The comparison uses the database's one collation, so the order is the same in every transaction. I checked UPDATE-vs-INSERT interleavings through the login-name route. A sign-up whose keys cross a legacy account's keys waits first on `accounts_login_key_key` or `accounts_display_key_key`, because the legacy login key equals its display key. It therefore holds no `name_keys` entry while waiting, and no cycle forms. The race test (`schema.test.ts:255-284`) covers both key orders and is effective (see the probe above).
2. **`POST /v1/account/login-name` behind requireConfirm, plus an alert.** Fixed. The preHandlers are `[requireSession(), requireConfirm({ kind: 'set-login-name' })]` (`account.ts:176`), with no onboarding or recovery exemption. The `set-login-name` kind was added to `ConfirmAction`, `describeAction` and the `actionInput.ts` SHAPES table. The update and `addAlert(client, …, 'login-name-set', {})` share one transaction on one client, with rollback on any error and release in `finally`. The alert detail carries no name. The tests cover `confirm-required`, `confirm-invalid` for another action's token, and exactly one alert with `detail: {}`. Web alert words and the auth-client type were updated.
3. **plan-2-review.md:176 rewrite and residual.** Done. Line 176 now describes the backfill, `legacy_login_name`, `needsLoginName`, the confirm-gated route and the sorted trigger. Residual (e) is recorded at line 198.
4. **Coordination notes.** Done (`coordination.md:70-71`): the `needsLoginName` / `setLoginName` web prompt must exist before any real deployment, and Plan 4 must take the account row lock around `verifyWebAuthnRegistration`.

## Merge cb7bee6: nothing lost

I compared every path changed since the merge base b98effe:
- Every FU-A-only path is identical to 25e411f.
- Every main-only path is identical to a3a7d7f, except deliberate `username` → `displayName` adaptations: `events/publicName.ts` (now `'display_name'`), the seedAccount calls in events, nudge-delivery and push tests, and the web quote, refund, fixture and e2e-stub files.
- The new web copy in `refusals.ts` for `security-key-limit` and `login-name-set` has its tests.
- Every path changed on both sides keeps both sets of hunks. The diff line counts match each side's own change.
- `package-lock.json`: FU-A's 9 lines are already in main's version.

The conflicts were resolved correctly:
- `nudge/names.ts`: main's `PUBLIC_NAME = PUBLIC_NAME_COLUMN` is kept, with FU-A's `display_key` and `checkDisplayName`.
- `schema.test.ts`: both import sets are kept, and 009 and 105 appear in both migration lists.
- `view.test.ts`: `displayName` plus `finalAlertSeenAt`.

`nudge.test.ts:617` pins `['display_name','display_key']`. The events tripwire was correctly turned into a pin that the column is not `/login/`. No API source still reads `username`. The remaining web hits are the `data-username` styling hook and `autoComplete="username"`, both of which are fine. 32880eb is comment and test-variable renames only.

## Important

None.

## Minor

1. **Crossing legacy renames deadlock** (`apps/api/src/routes/account.ts:190-214`). Two pre-009 accounts, A (display `la`) and B (display `lb`), each set the other's display name as their login name at the same moment. Each UPDATE waits on the other's old `login_key` in `accounts_login_key_key`, because legacy rows have login key = display key. Postgres raises `40P01`, the catch only maps `23505`, and the victim gets a 500 instead of `names-unavailable`. My probe hit this in 7 of 10 rounds. Impact is small. It needs two legacy accounts, both confirmed, at the same moment, and both names are public display names, so nothing leaks. It is still an unhandled 500 on a security route. Fix: map `40P01` in that catch to 409 `names-unavailable`, or retry once. Optionally add a two-legacy-swap case to the account or schema test.
2. **The round-2 re-review is not recorded in the repo** (`docs/superpowers/reviews/2026-10-27-p2-fua.md`). The commits cite "FU-A re-review 1, 2, 3", but the review record ends at the round-1 lead decisions. A future reader cannot see why the trigger sorts its keys, why the route is confirm-gated, or why residual (e) exists. Fix: before the merge, append the round-2 findings, their resolutions and this approval to that file.
3. **Residual list nits** (`docs/security/plan-2-review.md:196-199`):
   - The residuals run (a), (b), (e), (d), and there is no (c). Reorder or reletter them.
   - Residual (b) says the login-name route "costs the same token per try". Since f0248a0, each try also uses up a fresh `set-login-name` confirm token: `requireConfirm` redeems it in the preHandler, before name validation. So an invalid, same or taken name also burns the proof. That makes the oracle dearer than stated, which is good, and it is worth saying. The web prompt (coordination note) should then expect to re-confirm after a `names-unavailable`.

Verdict: **APPROVED**. Minor 1 is worth a one-line fix in the merge commit or a follow-up. Minor 2 should be done before the merge.
