# Review: wip/lead-release-settle-2 (P0 8 Nov, the seller's release never settled)

Reviewer: independent security review (Claude), 10 Nov 2026. I did not edit any code.
Branch: `wip/lead-release-settle-2` at 928878cc, on main 8cca6d77 (commits 457a795c, 0b8b6792, 5081420d, debfc49b, b9f70ef0, 928878cc).
Worktree: /home/user/X2F/.claude/worktrees/release-settle-2.

## Verdict

**APPROVE. Nothing must be fixed before merge.** I found no way for a daemon or node proxy to make a tx look settled, no case where daemon-unavailable becomes "none" or "done" in an unsafe place, no timeout around a nonce-bearing call, and no weakened release gate. All five requested test projects pass. Four Low findings and one Info finding below are hardening for a follow-up.

## Tests (serialised runner, this worktree, 10 Nov)

| Project | Files | Tests | Result |
|---|---|---|---|
| @x2f/escrow (incl. regtest suites, new tx-lookup and web-bundle-http) | 14 | 92 | all passed (1269 s) |
| regtest | 1 | 4 | all passed |
| regtest-verify | 1 | 10 | all passed |
| @x2f/moderation (incl. new releaseSettles) | 11 | 148 | all passed |
| @x2f/node-proxy (incl. changed wallet.test) | 3 | 34 | all passed |

- No tests were skipped.
- The workspace typecheck is clean for packages/escrow, apps/moderation and apps/web.
- Logs are in /tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/logs/rs2-{escrow-114949,regtest-121059,regtest-verify-121131,moderation-121150,nodeproxy-121203}.log.
- The author's own logs, rs2-red-relsettle-102933.log and rs2-red-shown-111627.log, show releaseSettles failing before each fix.

Semgrep (`--config auto`, 9 changed files, 210 rules) made one finding: `detect-insecure-websocket` at apps/moderation/src/main.ts:192, where the relayUrl check accepts `ws://`. That line was already on main and this branch does not touch it. Not a finding against this branch.

## Checks, one by one

1. **A lying daemon cannot get "block" out of `txStatusOf`** (packages/escrow/src/monero.ts:113-123). It returns `block` only when all of these hold:
   - `status === 'OK'`;
   - `txs` is an array (anything else throws daemon-unavailable);
   - an entry's `tx_hash` is the same string as the asked hash (strict `===`; the hash passed `TX_HASH` = 64 lower-case hex first);
   - `in_pool === false`, a strict boolean (a missing field is not enough);
   - `block_height` is a JS number, a safe integer and > 0.

   Type confusion fails closed: `'120'` gives none, a missing `in_pool` gives none, height 0 gives none, and non-objects or arrays inside `txs` are skipped. With several entries for the hash, the first match wins, and a pool or unconfirmed first entry is the conservative answer. Partial answers (other hashes, `missed_tx`) give none. It is stricter than the old monero-ts path (`getIsConfirmed() && !getInTxPool()`).

   Beyond parsing, a daemon that lies about everything can still claim "block". That is unchanged from main, and it is not the safety gate:
   - the builder also needs its own wallet's `spentBy` (outgoing, confirmed, that hash) and a zero balance;
   - the watcher needs both traders' sealed spend.info;
   - the watcher proves the payout with the tx key on the moderator's daemon.

2. **daemon-unavailable never becomes none or done unsafely.**
   - Network errors, abort, non-2xx, unparsable JSON, `status !== 'OK'` and a non-array `txs` all throw `EscrowError('daemon-unavailable')` (monero.ts:392-408 and 113-116).
   - In `runParty`, that error propagates to `advance()`, which logs it as ignored and retries (party.ts:958-961). It is never in `RETRYABLE`, so it never triggers `nextAttempt`.
   - `bounded` timeouts raise the same code.
   - `spentBy`'s new `timed` maps a timeout to `false` (not done), which is safe.
   - One soft spot remains: an OK reply that names neither the hash in `txs` nor in `missed_tx` reads as `none` (finding L1).

3. **The timeouts never wrap build, sign, export or import.**
   - `bounded` (party.ts:347-368) wraps only `sync`, `txStatus`, `txSeen`, `spentBy`, `submit` and `proveTx`.
   - `importPeer`, `buildRelease`, `checkRelease`, `signRelease`, `exportState`, `importState` and `prepare` still call `session.*` directly (party.ts:620-623, 668-670, 685, 797).
   - An abandoned sync or submit keeps running, but monero-ts serialises wallet calls, so a later import or build waits behind it rather than racing it.
   - Every retry path after such a timeout already existed through the engine's own `timed` (DAEMON_TIMEOUT_MS). The party bound is DAEMON_TIMEOUT_MS + 5 s, so on the Monero engine it is only a backstop. No new path re-runs a signing step on the same nonces (R26 holds).

4. **No double submit, double spend claim or nonce reuse.**
   - `submit` is re-sent with the same `signedHex`. A re-broadcast of the same tx is refused or ignored by monerod, and the catch then asks `txStatus`.
   - `superseded` is still reached only on `none` plus balance 0 (party.ts:705-712), which is unchanged.
   - spend.info is still sent once, from the `done` phase, and resent by `resend` until acked.
   - Moderation POST retries after a 15 s timeout (`/internal/v1/reports`, relay admin) were already possible after network errors. The API refuses a repeated report through the state machine (409), and the signature uses a fresh `at`.
   - Web `registerIdentity`: the identity is persisted before the POST, and a retry after a timeout gets 409 `identity-exists`, which counts as registered.

5. **The release gates are not weakened.**
   - The builder's done check is still `sync().balance === 0n && spentBy(hash) && txSeen(hash)`.
   - The watcher is unchanged: `sweep-unproven`, R3-I1 needing both statements, the tx-key payout proof through `proveSweep` (`inBlock`, `spendsEscrow`, the minimums), `mod_sweeps`, the shadow veto and `armedRefundBlock`.
   - `proveTx` keeps the monero-ts daemon client (moderator, Node) and only gains the outer bound.
   - releaseSettles test 2 pins that nothing is counted on the buyer's word alone.

6. **The `shown` bigint/string round trip.**
   - Write: `o.spentAtomic.toString()` (party.ts:817). Read: `BigInt(o.spentAtomic)` (party.ts:822). The round trip is exact.
   - The state is AEAD-sealed under the keystore key, with AAD `x2f/mod/escrow/<trade>` (keystore.ts:165-178), so storage cannot be changed without the key.
   - On read, `BigInt()` would accept `''` (giving 0), whitespace and `0x`/`0o`/`0b` prefixes, and there is no shape check (finding L2). This is safe in practice: the watcher refuses `spentAtomic <= 0n` (watcher.ts:239), and a garbage string throws inside `funds()`, which fails closed as `watch-failed`.
   - No legacy saved state carries a bigint `shown`: every such save threw before this fix, so nothing was ever persisted in that shape.

7. **Fetch targets.**
   - `txStatus` posts to `${daemonUri}/get_transactions`. `daemonUri` is config (`VITE_NODE_PROXY_URL` in the web app, the service config for the moderator), and only a fixed path and JSON body are added. The node proxy already allowlists `/get_transactions`, re-serialises it and pins CORS.
   - The `fetch` does not set `redirect: 'error'` or `credentials: 'omit'` (finding L3). A proxy that redirects can already answer anything, so this is hardening, not an exploit.
   - Moderation `defaultFetch` only adds a signal. Its URLs come from config (`apiInternalUrl`, `relayAdminUrl`) plus fixed paths, so there is no new SSRF.
   - `httpEscrowApi` keeps `redirect: 'error'` and `same-origin` and adds the signal.

8. **No test was weakened.** The only change to an existing test is apps/node-proxy/test/wallet.test.ts:107, which now also accepts 204 in `refused`. The new preflight added in that same test needs it, but any 204 from a wallet call would also pass now (finding L4). Every other test file is new.

## Findings

| # | Severity | Where | Finding | Suggestion |
|---|---|---|---|---|
| L1 | Low | packages/escrow/src/monero.ts:120 | An OK reply that lists the hash neither in `txs` nor in `missed_tx` reads as `none`, not "no answer". It is safe in every caller today: `txSeen` stays false, and `superseded` also needs balance 0, which the wallet's own view gives. It is still the one place a non-answer becomes `none`. | Return `none` only when `missed_tx` contains the hash. Otherwise throw daemon-unavailable. Add a test. |
| L2 | Low | packages/escrow/src/party.ts:822 (and the type at 88-94) | `BigInt(o.spentAtomic)` accepts `''` (0n), whitespace and hex/octal/binary prefixes from storage. `txHash` and `height` in `shown` are not checked on load. The data is sealed, so tampering needs the keystore key, and a bad value fails closed. | Check `/^(0|[1-9]\d*)$/` and `TX_HASH` when reading `shown` back, and fail with `bad-state`. Add a test that saves to the sealed store, reloads into a new mod party, and asserts `funds().outgoing[].spentAtomic` is a bigint of the same value. releaseSettles today asserts only `txHash`. |
| L3 | Low | packages/escrow/src/monero.ts:395-400 | The `/get_transactions` fetch uses the default `redirect: 'follow'`, `credentials: 'same-origin'` and HTTP cache. | Add `redirect: 'error', credentials: 'omit', cache: 'no-store'`, as `httpEscrowApi` does for redirects. |
| L4 | Low (test) | apps/node-proxy/test/wallet.test.ts:107 | The `refused` filter now lets any 204 through, not just the preflight's. | Exclude the OPTIONS call by method or call name, or assert the 204 rows are exactly the one preflight. |
| I1 | Info, already on main | apps/moderation/src/main.ts:179-182 | `defaultFetch` follows redirects on signed internal and relay-admin calls. The targets are config, so this is not exploitable from outside. | Optional: `redirect: 'error'`. |

Notes, not findings:
- `funds()` still calls `incoming`, `chainHeight` and `outgoing` without a bound. These are local wallet reads, but after an abandoned sync they queue behind it in monero-ts. This affects liveness only.
- The author's own open items in docs/coordination.md go to the lead or owner, not into this review: a resumed regtest wallet runs in-process in the browser, and the R3-I1 liveness cost when the seller closes the page.

## Must-fix

None. L1-L4 are recommended as a small follow-up and do not block this P0 fix.
