# Re-verify: wip/lead-trade-wallet 3eec9d0b..7561f995 (answers review-lead-trade-wallet-2026-11-17.md M1-M4)

Reviewer: independent security re-verify for the lead, 2026-11-17. Head 7561f995 = fix commits
4bab00c7..fd252c53 on 3eec9d0b, then a merge of main b6f9cf0e. Worktree: fresh detached
`scratchpad/rv-tw-r2`. The branch was not modified; the probes below were added for one run and reverted.

## VERDICT: CHANGES NEEDED (one minor, N1; engineering only, no owner choice)

M1, M2 and M3 are fixed as asked. M4 is fixed for the case the review named: the quote coming back
with `?wallet=<id>` after a trip away or a reload. But the device record is keyed by wallet **id**, and
the API chooses the ids. A compromised API that drops the recorded wallet and lists the same address
change under a **new id** still gets it preselected and paid out, on a fresh quote and in the
accepted sheet (N1, probe below). This is not worse than main: it is the O1 class. But it means the
lead's check "a compromised API can no longer get a swapped address preselected or paid out through
any of these flows" does not hold yet, and the code comment in `Quote.tsx` claims it does. A small
tightening closes the lookalike case without changing anything a real user sees.

Nothing else blocks. The merge is clean, no test was weakened, and the full `npm run check` is green.

## M1: a waiting wallet cannot be made the default (fixed)

- `defaultHandler` (`apps/api/src/wallets/routes.ts`) now reads `usable_from` under the account
  row lock. It answers 409 `wallet-not-ready` when `usable_from > deps.clock()`, which is the same rule
  as the take's `pickWallet`. This runs after the 404 (foreign, removed, malformed) and the 409
  one-time checks, and before any write.
- Test: `wallets.test.ts` "refuses a wallet that is not usable yet". A waiting wallet is refused with
  the exact body, nothing is written (`is_default` rows `[]`, the effective default is unchanged), and
  the wallet becomes choosable once its own wait is over. A second test covers staged, removed and
  used-up wallets (404) with nothing written.
- Web: `Wallets.tsx` shows Make default only when `w.usable && matches`. Test: `wallets.test.tsx`
  "a waiting wallet offers no Make default".
- I found no other way to pre-arm a waiting wallet. `effectiveDefault` keeps the "only usable saved
  wallet" rule, and no route other than the one above sets `is_default`. The alert stays Q12 (owner).

## M2: behavioural tests for the hold and the team member (fixed)

- Hold: `wallets.test.ts` inserts a real `account_holds` row. It checks for 403 `recovery-hold` with
  nothing written, then that the same call gives 204 once the hold is gone. If the preHandler is
  dropped, this test goes red.
- Team: `team.test.ts` uses two members, one with `offers`/`trades` and one with `wallets-see`. Both
  get 403 `owner-only` and `is_default` stays false. If `member` is added to the route's
  `requireSession`, this test goes red.

## M3: one-time copy (fixed)

`KEEP_FOR.oneTimeNote` and `NEW_ADDRESS.oneTimeNote` now say the address comes back "only if the
trade is cancelled while it is still being set up". That matches `applyEvent`'s
`prev.state === 'setup'` restore. Both strings are marked COPY-UNSIGNED, and copy-lint is clean. A
pinning test checks that the old "before any XMR is sent" wording is gone. OQ2 (extend the restore to
`funding`) stays with the owner.

## M4: device record of typed addresses (fixed for the same id; see N1)

`apps/web/src/screens/walletRecord.ts` holds a map from id to the address typed on this device. It
lives in localStorage under `x2f.wallet-typed.<id>`, with a memory Map as the fallback; every storage
access is wrapped in try/catch.

Writers. The record is written in four places, and each records the trimmed address the user typed:

| Flow | File | What it does |
|---|---|---|
| New-address sheet | `NewAddressSheet.tsx` | Records `trimmed`. |
| Settings add | `Wallets.tsx` | Records `drafts[i].address` (already trimmed in `current()`). It records before checking the answer, then refuses a wrong count or any address that differs from the one typed (`ADD_SWAPPED`). |
| Setup first wallet | `setup/Wallet.tsx` | Records `trimmed`, then refuses a list that is not exactly one wallet with the typed address. |
| Staged add (202) | none | Records nothing, because no id exists yet (see O3). |

Readers. Three places check the record:

| Screen | File | What it does |
|---|---|---|
| Quote | `Quote.tsx` | `swapped = !matchesRecord(w)` filters the list before `usable`, `pickedWallet` and `confirmed.ownAddress` are built. A `?wallet=` id whose listed address does not match the record picks nothing. |
| Accepted sheet | `AcceptedSheet.tsx` | `offered` excludes mismatches before the default preselect and before `ownAddress: wallet.address`. |
| Your wallets | `Wallets.tsx` | A row that does not match is marked `NOT_MATCHING` and gets no Make default. |

The escrow path is unchanged. `confirmed.ownAddress` is still built from the same filtered
`pickedWallet` that the take's `walletId` names, and the device's terms check against `ownAddress`
is as on main.

**Can the API poison the record?** No, with one harmless exception.
- Every write stores the address the user typed. No code path stores an address that came from the
  API. The API only chooses the key (the id).
- The worst a hostile answer can do is bind a typed address to some other id, for example the id of
  an existing good wallet. That wallet is then hidden or flagged as not matching. This fails closed:
  it can deny service, but it cannot redirect money.
- Keys are prefixed and the store is a `Map`, so there is no prototype or key-collision issue.
- Nothing reads the record into a request. The quote and setup tests assert that the only request
  carrying the typed address is `POST /v1/wallets`.

**A missing record (new device, cleared storage, private mode).** It fails safe in the sense the brief
asks for:
- With no record, `matchesRecord` returns true, so the screens judge the wallet as main does. There is
  no false refusal.
- The escrow still pays exactly the address the device showed. My probe 3 cleared storage and the
  in-memory map, then listed a swapped address for the same id. The quote showed that address's own
  ending and took it, and `ownAddress` equals the listed address, which is the one shown.
- So a missing record never pays something the screen did not show. It only falls back to main's
  trust in `GET /v1/wallets` (O1).
- With localStorage blocked, the memory fallback keeps the check for the page's lifetime.

## N1 (minor, CHANGES NEEDED): the record is bypassed by a new id

`matchesRecord` returns true for any id with no record. So a compromised API can still swap a
recorded address:
1. It omits the recorded wallet W1.
2. It lists the same label under a new id W1′, with an address ground to the same last 6 characters
   (about 3.8e10 tries, offline), `usable: true` and `isDefault: true`.

Reviewer probe 1 (appended to `quoteScreen.test.tsx` "a new address added on the quote", run, then
reverted): add TYPED (`…TYPED1`) on the quote, unmount, then have the list return W1′ = `w-evil` with
`4ZZZ…TYPED1` as the default. A fresh quote (no `?wallet=`) results in:
- `w-evil` is checked;
- no swapped notice is shown;
- Trade takes `w-evil`;
- `readConfirmed().ownAddress` is the ground address.

The test passed, so the gap is confirmed. `AcceptedSheet` preselects `offered.find(isDefault)` the
same way. Probe 2: the same list with `?wallet=w-new` picks nothing, so the path M4 named is closed.

Why this matters: within the original visit, `picked` was already set, so a new default was never
preselected. The record carries the same-id check across reloads, but a grinding attacker just
changes the id. The round-5 comment in `Quote.tsx` ("the API never swaps an address the device did
not show") and doc item 23 overstate the guarantee.

Recommended fix (pure tightening; no owner choice, because no real user can hit it):
- Also refuse a listed wallet whose address ends in the same 6 characters as an address recorded on
  this device, but whose full address differs.
- Treat it like a same-id mismatch: not offered, not preselected, swapped notice shown, no Make
  default.
- The record already holds every typed address. Add `recordedAddresses()` (or index by ending) and
  extend `matchesRecord`.
- Two genuine user addresses colliding on the last 6 is about 1 in 3.8e10.
- A re-id with a *different* ending is visibly different on screen, which is main's model.
- Add red tests for the quote (fresh visit) and the accepted sheet.
- Correct the `Quote.tsx` comment and doc item 23 to say what is still trusted.

## Observations (no change asked)

- **O1 (pre-existing, unchanged).** A wallet added on another device, or before round 5, has no
  record and is trusted as on main. The N1 fix narrows this only for lookalikes of addresses typed here.
- **O3.** A staged add (202, weak login) records nothing, because there is no id yet. When it is
  later applied under Account changes, the wallet is unrecorded. The N1 fix could record the typed
  address at stage time (by address, not id) so the ending check covers it too. Optional.
- **O4.** The Settings add records before it checks the answer. That is intended: a swapped answer
  leaves a record that flags the swap later. The record grows by one small key per add, which is
  harmless.

## Merge with main b6f9cf0e

- The only conflict was `apps/api/test/schema.test.ts`.
- A script compared each `migrate()` list in it against `ls apps/api/migrations` from that list's
  first file onward. All three lists match the directory exactly: 99, 91 and 90 entries, with main's
  211/212/400/401 and this branch's 620/630/640, in file order.
- Excluding `schema.test.ts`, `git diff b6f9cf0e 7561f995` equals the branch's own diff from the merge
  base. The only differences are blob hashes and hunk offsets, so the merge added nothing.
- Migrations 620/630/640 appear only under these names across all origin branches.

## No test weakened

`git diff 3eec9d0b fd252c53` over test files removes **no** lines. The tests only gain:
- `localStorage.clear()` and `forgetTypedAddresses()` in `beforeEach`;
- new `it` blocks.

There is no `.skip`, `.only`, `.todo` or loosened matcher. The merge's test changes are main's, plus
the migration lists above.

## Checks run (head 7561f995, Node 24.22.1, under `flock ~/x2f-comms/check.lock`, `timeout` inside the lock)

- API vitest: `wallets`, `team` and `take`. 3 files, 233/233 passed.
- Web vitest: `wallets`, `quoteScreen`, `quoteAddress`, `quote`, `AcceptedSheet` and `setupWallet`.
  6 files, 148/148 passed.
- Reviewer probes, 3 tests appended to `quoteScreen.test.tsx`, run and reverted (not committed):
  - re-id preselected and paid (N1): passed, so the gap is confirmed;
  - re-id via `?wallet=` picks nothing: passed;
  - a missing record means the swap is trusted as on main and `ownAddress` is the shown address: passed.
- Full `npm run check`: exit 0.
  - typecheck clean;
  - copy-lint clean;
  - separation-check ok;
  - vitest 384 files, 7211 passed, 1 todo;
  - semgrep 0 findings;
  - npm audit 0 vulnerabilities.
- Not run: Playwright and the escrow/regtest suites.
