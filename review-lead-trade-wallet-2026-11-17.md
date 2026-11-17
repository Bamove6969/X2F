# Review: wip/lead-trade-wallet @ 3eec9d0b (owner note #6: per-trade payout wallet, rating, default, one-time)

Reviewer: independent security review for the lead, 2026-11-17. Base: main 4f0afa14. Branch = claude3's
`wip/third-trade-wallet` d5651819 + lead commits 1d374e99, 3f35e055, 3eec9d0b. Earlier review of the
first round: `review-third-trade-wallet-2026-11-17.md` (fd2497ba, approve with minors; M1-M6 since closed).
Worktree: fresh detached `/home/user/X2F/.claude/worktrees/review-trade-wallet`. Branch not modified.

## VERDICT: APPROVE WITH MINORS

No S (security) or B (blocking) finding. I found no path by which a compromised API, a stolen session
or the other trader makes the escrow pay an address the device did not show, shortens the 24 h wait,
or reuses a one-time wallet across two live trades. The minors are a silent default change that can
pre-arm a still-waiting wallet (M1, extends the lead's Q12), test gaps on the new route (M2), copy that
promises more than Q10 restores (M3), and the round-4 device check being per-screen only (M4).

## What was checked (attacker view)

1. **The address the escrow pays is the device's own, end to end.** Neither `apps/web/src/escrow/`,
   `packages/escrow`, `apps/api/src/internal/` (attested terms) nor `migrations/112_take.sql`
   (`trades_deal_fixed`, write-once in `setup`) changes. The quote builds `confirmed.ownAddress` and the
   take's `walletId` from the same `pickedWallet` in one render (`Quote.tsx:212`, `:325-329`, `:529`).
   The poster's sheet does the same (`AcceptedSheet.tsx`). The device escrow builds payout and refund
   from `rec.ownAddress` and the other side's signed and attested address (`escrow/runtime.ts:745-752`,
   `:886`). The server writes `buyer_payout`/`seller_refund` only from `pickWallet`: the caller's own open
   wallet with `usable_from <= now`, under the account lock (`take.ts:127-133`, `:304`, `:470-479`). The
   take body is an exact key set with `walletId` only; an address in it is 400. A server that writes
   another address into the trade still fails the device's terms check against `ownAddress`, as on main.
2. **Round 4: the device checks the new address.** `NewAddressSheet.tsx` refuses a `POST /v1/wallets`
   answer whose `address` is not the trimmed address typed (the server trims the same way,
   `wallets/routes.ts` `checkItemShape`). The check runs before the usable/waiting branch, so a swapped
   waiting answer is refused too. `Quote.tsx` keeps `typedAddress` for the new id. A re-read list that
   names another address for that id hides the row and shows `NEW_ADDRESS.mismatch`. Because `picked`
   is then set, the default fallback does not apply (`picked === null` only), so a swapped list that also
   moves `isDefault` to an attacker's row preselects nothing. A staged or omitted answer picks nothing.
   Tests: `quoteAddress.test.tsx` (sheet refuses another address) and `quoteScreen.test.tsx` "a new address
   added on the quote" (picked and recorded, sheet answer swapped, re-read list swapped).
3. **No shorter wait.** `walletConfirm`, `redeemConfirm`, `gateChange`, `STRONG_CONFIRM_METHODS`, the
   `had_wallet` onboarding rule, `auth/confirm.ts`, `auth/strength.ts` and `wallets/address.ts` are
   unchanged. The inline add on the quote uses the same `POST /v1/wallets` + confirm-it's-you:
   - a weak login is staged 24 h (202);
   - a password (+TOTP) confirm waits 24 h;
   - only a PGP, passkey or security-key confirm from a strong login is usable at once, as on main.

   The other new paths keep the wait too:
   - `restoreOneTimeWallets` reopens a wallet with its old `usable_from` and never touches `had_wallet`;
   - `PUT /v1/wallets/:id/default` writes only `is_default`.
4. **Rating is display only.** `accountRating` (`auth/rating.ts`) is read in one place,
   `GET /v1/account/me` (`routes/account.ts:318`), and authorises nothing (grep). Its inputs are DB rows
   only (`methodCounts`). A client that lies about its rating and opens the inline sheet gains nothing,
   because the server rules in 3 still apply. **Expired or revoked PGP keys** do count toward `high` (Q7/Q13), but
   that only changes what the quote shows. A PGP *confirm* uses only keys `inspectPublicKey` accepts now
   (`auth/pgp.ts:244-252`), so an expired key cannot make a new wallet usable at once. Recovery codes
   never count (weak), which is stricter than the note.
5. **One-time wallets cannot be reused across two live trades.** The use-up runs in the take's
   transaction under both account locks, and in the poster route under the trade row lock, then the
   account lock, then the wallet row `for share`. Tests from the M2 fix (`take.test.ts`, "one-time wallets
   under races and rollbacks") cover:
   - two takes at once: one 200, one 409;
   - a take against the poster route;
   - a failure at commit: the wallet stays open;
   - a refused poster route: the wallet stays listed.
6. **Restore (Q10) and take against cancel.** `applyEvent` restores only when all of these hold:
   `prev.state === 'setup'`, `next.state === 'cancelled'`, `receivedAtomic === 0n` and
   `fundingSeenAt === null`. It runs in the trade row's transaction, after the trade lock, and locks only
   the owning accounts in id order: the same trade-then-account order as the poster route. The restore
   SQL skips:
   - a wallet whose removal applied meanwhile (`applyWalletRemoval` clears `used_by_trade` first);
   - a purged address;
   - an address that is open again on the account.

   A take using the same wallet either finds it still removed (409) or finds it restored and uses it up
   again for the new trade. Either way exactly one live trade carries it. The restore never touches the
   cancelled trade's own address copy. The residual deadlock (500, full rollback) that the doc records
   loses nothing. The other trader can only *cause* a restore (by cancelling in setup), which gives the
   victim their own address back; it cannot use up or redirect it.
7. **Default wallet.** The route is owner-only: `requireSession({ kinds: ['trader'] })` with no `member`
   lets no team member through. It is hold-blocked (`HOLD_BLOCKED_ROUTES`, `requireNotHeld`). It refuses
   a recovery session, and gives 404 for a wallet that is foreign, removed or malformed and 409 for a
   one-time wallet. It runs under the account lock with a partial unique index. Only an open wallet of
   the same account can be the default. The quote and the accepted sheet offer and preselect only
   *usable* wallets, so the default can only point at one of the user's own wallets that has passed its
   own wait. Its name and address ending are on screen before Trade.
8. **Migrations 620/630/640.** These are additive columns with constant defaults, plus checks
   (`not (is_default and one_time)`; `used_by_trade` only on a removed one-time wallet) and a partial
   unique index. A scan of every origin branch at review time finds each of 620, 630 and 640 once, under
   these names only.
9. **No test weakened.** Every removed test line in the diff is one of these:
   - a migration list extended (`schema.test.ts`);
   - the `WalletOut` key list extended;
   - the e2e POST capture widened to the single-wallet shape, with an exact `toEqual` added on it;
   - the OD-11 "pre-selects no wallet" test, replaced by the owner's Q9 override. Three tests replace
     it: the default is picked and can be changed; a waiting default is not picked; with no default
     nothing is picked (`AcceptedSheet.test.tsx`).

   No skip, todo or loosened matcher was added.

## Findings

S: none. B: none.

**M1. A stolen session can silently pre-arm a still-waiting wallet as the default (extends Q12).**
`defaultHandler` (`apps/api/src/wallets/routes.ts`, `PUT /v1/wallets/:id/default`) accepts any *open*
wallet, waiting ones included, and raises no alert. `effectiveDefault` keeps the chosen wallet even
while it waits, and then also stops the sole usable saved wallet being the automatic default. A strong
stolen session (password + TOTP) can do this:
1. add its own address with a password confirm (`usable_from` + 24 h; the add alert fires);
2. make that address the default at once, with no alert and no confirm;
3. 24 h later, every quote and every "accepted your offer" sheet preselects the thief's address.

The victim still sees the name and the last 6 characters before Trade. The add alert went out a day
earlier, so this is not a wait bypass. But the 24 h wait exists so the user notices a new address
*before* it can be paid, and here a silent second step decides that it *will* be paid by default. My
probe confirms that a waiting wallet can be made the default (204, listed with `isDefault: true`); see
Checks. Fix (owner choice, see OQ1): one or both of these:
- refuse `PUT default` for a wallet that is not usable yet (409 `wallet-not-ready`; pure tightening);
- add the in-app alert for a default change, as the lead's Q12 recommends.

I recommend both. Neither changes what a take accepts.

**M2. Test gaps on `PUT /v1/wallets/:id/default`.** No behavioural test that the route is refused
during an account hold (403 `recovery-hold`), and none that a team member's session is refused (403).
Both hold by construction (`requireNotHeld` preHandler; `requireSession` without `member`), but the
source-shape test in `coolingOff.test.ts:1695` pins only `DELETE /v1/wallets/:id`'s preHandlers, so a
later refactor could drop either without a red. My hold probe passes (see Checks). Fix: add the two
cases to `wallets.test.ts` "the default payout wallet", or add the PUT line to the `coolingOff.test.ts`
source check.

**M3. The one-time copy promises a restore the code does not do in `funding`.**
`ONE_TIME_NOTE`/`NEW_ADDRESS.oneTimeNote` (`apps/web/src/screens/walletsCopy.ts:11`,
`quote/addressCopy.ts:64`) say a trade "cancelled before any XMR is sent" gives the address back. The
restore runs only for `prev.state === 'setup'` (`trades/store.ts`). The state machine also cancels from
`funding` with nothing received (`packages/trade/src/machine.ts`):
- system cancel `:543`;
- buyer cancel `:631`;
- accepted mutual cancel `:643`;
- seller walk-away before tapping Fund `:662`.

Those keep the wallet used up. This fails safe (the address is not given back, nothing is paid), but the copy is wrong for
those cases. Fix: either reword the copy to match ("cancelled while it is still being set up", still
COPY-UNSIGNED), or extend the restore to `funding` with `receivedAtomic === 0n && fundingSeenAt === null`
(OQ2). Extending is also wallet bookkeeping only, but it is the owner's call.

**M4. The round-4 device check covers one quote screen visit only.** `typedAddress` is React state
in `Quote.tsx`. After any trip away (Terms, Settings, setup, a reload), the quote comes back with
`?wallet=<id>` from the URL. It then trusts the re-read list's address for that id, so the guarantee
falls back to main's: the device shows the label and the last 6 characters of whatever the API lists.
The doc's item 17 ("can only be the typed address") is true within the visit. Fix (engineering, small):
keep the typed `{ id, address }` in `sessionStorage` for the quote's lifetime, or say "on this screen"
in item 17. The same echo check is also missing from Settings → Your wallets' add
(`apps/web/src/screens/Wallets.tsx`, pre-existing on main), and the inline sheet now has it. Worth
porting for consistency (no behaviour choice: a mismatched echo is refused).

**O1 (observation, pre-existing, not this branch). A compromised API can still swap a saved wallet's
address in `GET /v1/wallets`.** The device has no record of the full addresses its user saved, and it
shows only the name and the last 6 characters. An attacker who controls the API and can grind a Monero
address with the same last 6 characters (about 58^6 ≈ 3.8e10 tries, feasible offline) could make the
device record that address as `ownAddress`. The escrow would then pay it. This is main's trust model (the
API is trusted for the wallet list), and round 4 narrows it only for a just-typed address. For the
lead's threat-model list, not for this branch: a device-side store of address hashes the user typed or
confirmed (per device), checked before an address becomes `ownAddress`, would close it.

**O2 (informational).** The confirm-it's-you token binds the address list only, not `label` or
`oneTime` (as on main for `label`). The server is the only party that could flip `oneTime`, and either
value pays the same address, so this has no money impact.

## Owner questions

- **OQ1 (M1, with the lead's Q12).** Should choosing a default wallet (a) be allowed only for a wallet
  that already works, and (b) send the usual in-app alert? Recommended: yes to both, with no extra
  confirm-it's-you.
- **OQ2 (M3).** A trade cancelled after setup but before any XMR was seen (funding, nothing sent):
  should its one-time wallet come back too? Recommended: yes. It is wallet bookkeeping only, and it
  makes the copy true as written. Otherwise reword the copy to "cancelled while it is still being set up".
- Q7/Q13 (expired or revoked PGP key and the rating) stay open as the doc says. Display only. Recommend
  rating with `usablePgp` as G13 does.

## Checks run (worktree at 3eec9d0b, Node 24, under `flock ~/x2f-comms/check.lock`, timeout inside)

- API vitest: `wallets`, `rating`, `account` and `take` (the race, rollback and restore suites). 4 files,
  198/198 passed. That is 196 branch tests plus the 2 reviewer probes below.
- Web vitest: `quoteAddress`, `quoteScreen`, `AcceptedSheet` and `wallets`. 4 files, 105/105 passed.

- Reviewer probes, appended to `apps/api/test/wallets.test.ts` for the run, then reverted (not
  committed):
  - a still-waiting wallet can be made the default: 204, listed `isDefault: true`;
  - `PUT default` during an account hold: 403.
- Migration-number scan over all origin branches: 620, 630 and 640 unique.
- Not run: the full `npm run check` (the builder ran it green at this head; the brief asked for targeted
  tests only), Playwright, and the escrow/regtest suites.
