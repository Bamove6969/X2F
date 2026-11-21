# Review: wip/lead-p3t31-land 2fc7a452 (Plan 3 Task 31 regtest e2e suite), 21 Nov 2026

**Verdict: APPROVE WITH MINORS.** Test and harness only: 14 files on main 1f6e711b. Nothing reaches production. Money is checked on chain in every release and refund spec. The gap-3 marker is honest, and it fails for the gap-3 reason today. The minors below are about tightening; none blocks landing.

Worktree: .claude/worktrees/rev-p3t31 at 2fc7a452. Diff: `git diff origin/main...2fc7a452`.

## Tests run

- **vitest** `@x2f/web apps/web/test/chatPanel.test.tsx` (nice, outside the lock): 36/36.
- **Mutant** at ChatPanel.tsx:149 (`again.current = true` removed): 1 failed, 35 passed. The new test fails with "expected vi.fn() to be called 2 times, but got 1 times". Restored afterwards.
- **`tsc -p apps/web --noEmit`:** clean. This config includes e2e/.
- **`npm run separation-check`:** ok.
- **Normal Playwright config, `--list`:** 656 tests in 46 files. There are 48 spec files, and the 2 `*.e2e.spec.ts` files are not listed.
- **Regtest e2e under the lock, `--trace off`, phone:** 2 passed (8.1 min).
  - Mutual cancel ran as an expected failure (5.9 min). Both rooms were dumped: the seller's showed "State: settling" and the buyer's "Returning the XMR…". That is the gap-3 symptom.
  - Buyer cancel ignored (48 h close): passed.
  - Afterwards no `x2f-e2e` container and no stack process was left.
- **Not run:** the full `npm run check`, which the brief left out of scope. The builder reports the full suite at 33/33 as expected. My count of the specs agrees: 1 + 14×2 + 2×2 = 33.

## 1. Nothing reaches production: OK

- **No production import.** Nothing in `apps/*/src` or `packages/*/src` imports `tools/regtest/e2e/*`, `regtestKit`, `tradeFlow`, `stack*.ts`, `fixed-prices`, `modState` or `foreignIdentity` (grep is empty).
- **The build can't include it.** vite builds from index.html and src. The apps/web tsconfig includes `e2e` for typecheck only.
- **The stack builds its own web copy** into `.regtest/e2e-*/web` (stack.ts:261). The repo's dist is never touched.
- **Secrets are random per run** (`makeSecrets`, stack.ts:156-194), including modKeystoreKey, the signing keys, VAPID, PGP, the peppers and the pg password.
  - They are written only to `.regtest/e2e-*/secrets` (mode 600), to the child processes' environment, and to `X2F_E2E_STACK` in the runner.
  - `stack-up.ts` writes them to a stack.json path the user chooses. That is a by-hand tool and is documented.
  - The stack logs from my run hold no connection URL or key names.

## 2. The suite proves what it claims: OK, with minors

Every release spec checks the chain as well as the screen:
- `untilState` reads the API, then `txFee` reads the node.
- `receivedIn(wallet, txHash)` reads the receiving wallet itself.
- The fee wallet is restored from its seed and checked for exactly 1% or 0.
- Taker seller (trade.e2e.spec.ts:97-101), taker buyer (:128-132), surplus at funding (:176-180), buyer cancel (:246-250), and the three no-show specs through `refundLanded` (:58-70) all assert exact atomic amounts.
- The reload spec (:154-155) proves exactly one new tx reached the buyer, and that it is the trade's tx.
- `fund` (tradeFlow.ts:361-373) checks that the copied address and amount equal the API's `funding`, then pays from a real wallet.

Minors:

- **m-1, buyer cancel ignored (trade.e2e.spec.ts:275-287): coins not checked.** The spec checks only `cancelConfirmedAt`. It never checks where the refund went or that the fee wallet got nothing. The same path is covered at :237, but this spec's own refund is unverified.
  - The title says "closes as cancelled". The machine keeps the trade `refunded` and records `cancelConfirmedAt` (packages/trade/src/machine.ts:684-692), so the assertion matches the code. The wording does not.
  - Suggest adding `receivedIn(seller.wallet, v.txHash)` = funds − network fee, and fee wallet = 0, as at :246-250.
- **m-2, surplus after secured (:186-207): fee wallet not checked.** It checks the buyer's payout (grown − 1% − network fee) but not that the fee wallet got exactly grown/100. The surplus-at-funding spec does check this (:177-182).
- **m-3, swapped participants (:415-419): the check-words assertion can be vacuous.** It runs only when both pages show words. If the words never render, the "no check words match" claim is never tested.
  - The real guard still holds: "Security check failed" is shown, and the seller has no Copy address for 60 s.
  - Suggest also asserting that the API never gives the trade an escrow address: `tradeView(...).funding?.escrowAddress` stays null.
- **The lapse spec checks state and copy only.** That is correct, because no coins ever move.
- **The reputation specs check the DB and the profiles**, not coins. That fits their scope.
  - The proof spec checks gap 5 in the DB: the seller's chat identity is registered and the chat attested (reputation.e2e.spec.ts:40-44).
  - The feedback card checks the `platform_feedback` columns and the row count (:77-79).

## 3. Gap-3 marker: honest, with one tightening

- **It is the only marker.** trade.e2e.spec.ts:214 is the one `test.fail`, and it gives a reason. There is no `skip`, `fixme` or `only` anywhere in the suite, its helpers or its configs. Both configs set `forbidOnly: true`.
- **It fails today for the gap-3 cause.** My run ended with the trade `settling`, both rooms waiting, as the 20 Nov review saw: "is settling, not refunded/cancelled".
- **It would flip.** If the gap were fixed and the money checks held, the spec would pass, and Playwright would report the unexpected pass as a failure.
- **m-4: the marker covers the whole body.** `test.fail(true, …)` is set before `openTrade`. A break anywhere earlier in this spec would still count as the expected failure: in setup, in `fund`, in the API `propose-cancel`, or in the buyer's Accept button going missing. So would a money assertion that fails after a fix.
  - Setup and funding are covered by the other specs. The propose-cancel and Accept steps are not.
  - Suggest calling `test.fail(...)` just before `untilState` (Playwright honours it mid-body), after first asserting the trade reached `settling`. Then only "stuck in settling" is excused, and anything else is red.

## 4. Stack safety: OK, with minors

- **Local hosts only.**
  - Postgres is published on `127.0.0.1::5432` with data on tmpfs (stack.ts:221-222).
  - monerod runs `--regtest --offline`, with every bind on 127.0.0.1 (tools/regtest/regtest.ts).
  - The relay, its admin listener, the node proxy, the API and its internal listener all take `HOST = 127.0.0.1`.
  - The children start with a clean environment: PATH, HOME and their own variables (stack.ts:118).
- **Prices.** `fixed-prices.mjs` answers kraken, bitfinex, coingecko, coinbase and bitpay. `PRICE_SOURCES` and `FX_SOURCES` are pinned to those.
- **Writes.** Everything goes under `.regtest/` (gitignored), which holds the work dir, the logs and the results, plus the throwaway docker container.
- **Cleanup.** Normal teardown and the exit, SIGINT and SIGTERM paths kill the process groups and run `docker rm -f`. My run left nothing behind.
- **m-5: fixed-prices.mjs:29 lets other hosts through.** Any other host falls through to the real `fetch`, so "never depends on the network" is a convention, not a guard. Suggest refusing every host that is not loopback in the default branch. The API's only other fetches go to 127.0.0.1.
- **m-6: no cleanup after SIGKILL.** A crash by SIGKILL, or an OOM kill of the runner, leaves the detached process groups and the `x2f-e2e-<pid>` container. The container is labelled, but nothing sweeps stale ones at start.
  - The exit and signal paths also do not remove `.regtest/e2e-*/`, which holds the throwaway secrets and the web build. They are harmless and gitignored.
  - Suggest that `startStack` first removes containers labelled `x2f-e2e` whose pid is gone.

## 5. Wiring: OK

- **Excluded from the normal Playwright config.** playwright.config.ts sets `testIgnore: '*.e2e.spec.ts'`, confirmed with `--list`.
- **Runnable only through the regtest config.** playwright.regtest.config.ts sets `testMatch: '*.e2e.spec.ts'`, one worker, and its globalSetup starts the stack. `stack()` throws without `X2F_E2E_STACK`.
- **Not in `npm run check`.** tools/check.sh runs vitest only. Every vitest project includes only `*.test.ts(x)`. The e2e files are typechecked but never run.

## 6. chatPanel queue test: OK

- **It pins the whole queue.** One sync while one is in flight. Two live events coalesce into exactly one follow-up sync. The follow-up's result is rendered.
- **The mutant fails it.** With `again.current = true` removed at ChatPanel.tsx:149, the test fails. This closes m-1 of the rev-small-fu review.

## Nits

- `received()` (regtestKit.ts:172) is unused.
- tradeFlow.ts:286 is debug output on a disabled Trade button. Harmless.
- **Design note for the lead, not a defect: moderation code reaches the e2e specs through tools/.** modState.ts loads `apps/moderation/src/keystore`, and stack.ts names `MOD_KEYSTORE_KEY`. They sit in tools/ so that the lexical separation-check over apps/web passes, yet apps/web/e2e/trade.e2e.spec.ts loads them transitively.
  - This is a test harness and nothing in production reaches it, so the check's purpose holds.
  - Still, the separation check covers apps/web tests too, and this suite steps around that by design. It is worth a line in the lead log so nobody copies the pattern into src.

## Owner questions

None. These are test-only changes.
