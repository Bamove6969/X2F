# Review of Plan 2 (accounts) and Plan 3 (trading)

Date: 2026-10-15. Reviewed against the spec (2026-10-14), the roadmap, Plan 1, the escrow threat research, the changes listed since Plan 1 was written, and the X2F App boards in `design/x2f-app/` (including commit d84b675, which added the Buy and Dispute boards).

**Dependency check (done, not a finding).** Every exact pin in both plans exists and was published at least 14 days before 2026-10-15 (`npm view <pkg> time`). Two are close to the limit: vite 8.3.2 (2026-10-01T10:17Z, exactly 14 days; `npm audit` is clean) and pg 8.23.1 / vitest 5.0.3 (2026-09-30). The postgres image digest in Plan 2 matches `17.11-alpine3.24`, pushed 2026-09-21. Semgrep 1.178.0 dates from 2026-09-23. Node 22.23.3, npm 11.21.0, `vitest.config.ts` projects, 16-character trade codes, the "Trade" button, the opt-in 24-hour wait, usernames of 5–20 characters, the password rule and the optional backup all match the listed changes, apart from the items below.

---

## Plan 2: Accounts and login

### Critical

**P2-C1 · Task 4 throttle and Review Focus 4: anyone can lock any account, including the owner.**
- *Problem.* The throttle key is `acct:<username_key>`, and usernames are public (offer cards, trade headers). Ten wrong passwords lock the account for 15 minutes, and "attempts during a wait or lock are refused without checking credentials". The plan routes every way of proving identity through this one key, so the lock also blocks PGP, passkeys, security keys and every step-up confirm.
- *Impact.* An attacker who knows nothing can, every 15 minutes:
  - keep a trader logged out;
  - stop a logged-in trader from confirming a wallet change;
  - keep the owner from logging in to press the emergency stop;
  - lock a buyer out during the 15-minute final alert, so the auto-refund fires against a buyer who has already paid.
- *Fix.*
  1. Give each guessable method its own counter (`password`, `totp`, `recovery-code`). Never block PGP or WebAuthn because of failures on another method; their secrets cannot be guessed.
  2. Keep the per-account counter for slowing down, but replace the hard 15-minute lock with capped backoff, for example 30 s at most.
  3. Add a device cookie (`__Host-x2f_dev`, random, stored hashed, set after each successful login). A request that carries a valid device cookie for that account uses its own counter and is never locked by anonymous failures. This is the OWASP device-cookie pattern and needs no IP address.
  4. Tests: 10 bad passwords from a cookie-less client must not stop a passkey or PGP login, or a password login from a browser that holds the device cookie. Staff and owner logins must stay possible during an anonymous flood.

**P2-C2 · Tasks 4, 11 and 12: adding a payout wallet does not ask the person to confirm it's them.**
- *Problem.* The spec (6.4) says adding a payout address "requires confirming it's you … so a hijacked session cannot change it". The Wallet and SetupWallet boards say "Saving asks you to confirm it's you" and "Whenever you add a payout wallet, we'll ask you to confirm it's you". The plan instead uses session freshness: any login or confirm within the last 5 minutes (`FRESH_MS`) authorises every wallet add, and Task 12 tests "add a wallet without a confirm prompt (fresh session)".
- *Impact.* A stolen cookie used within 5 minutes of login, or right after the victim confirms something unrelated (adding a passkey, say), can add the attacker's address without a prompt.
- *Fix.*
  1. For `POST /v1/wallets` and `PUT /v1/account/security/payout-wait` with `enabled:false`, require a single-use confirmation bound to the action. Each confirm route takes `{ action: 'add-wallet', addressHash }` and returns a `confirmToken`, which is valid for one call that matches it.
  2. The PGP confirm message names the action: `Purpose: add payout wallet ending …k3Fz`. For WebAuthn, put the action hash in the stored challenge payload.
  3. Keep `FRESH_MS` only for low-risk changes, or drop it entirely.
  4. Onboarding exemption: only the first wallet, and only within N minutes of account creation in the session that created the account.
  5. Rewrite the Task 12 test so that every wallet add goes through `withConfirm`.

**P2-C3 · Tasks 2 and 6: PGP flows let anyone link a username, or an outside identity, to a PGP key.**
- *Problem 1.* `encryptChallenge` puts the recipient key IDs in the message (PKESK packets). `POST /v1/login/pgp/start {username}` is unauthenticated, so anyone can map any public username to its PGP key ID. Many PGP keys are on keyservers with a real name and email address.
- *Problem 2.* `register/pgp/start` returns 409 `key-in-use`. That tells anyone whether a known public key (for example one from a keyserver) has an X2F account.
- *Problem 3.* `login/pgp/start` returns the stored key's refusal reason and expiry date to an unauthenticated caller.
- *Fix.*
  1. Encrypt with OpenPGP.js `wildcard: true` so key IDs are hidden. Test that the message's PKESK key IDs are all zero.
  2. For an unknown username, return a decoy challenge encrypted to a throwaway key, with the same shape and timing.
  3. Report a fingerprint clash only at `finish`, after the person has proved they hold the key.
  4. For an expired stored key, `login/pgp/start` answers `key-expired` with no date and no fingerprint. The person already knows their own key.

### Important

**P2-I1 · Task 8 backup login and Tasks 6–7 `allowRecovery`: a TOTP code alone can take over an account.**
- *Problem.* `POST /v1/login/backup {kind:'totp'}` opens a recovery session from a 6-digit code. Recovery sessions may add a PGP key or a WebAuthn credential, and the person can then log in fully. With 10 tries per 15 minutes and a ±1-step window, about 3×10⁻⁵ succeed per window, roughly 65% within a year for one targeted account. Spec 6.2 says TOTP is "never the only login".
- *Fix.*
  1. A backup login by TOTP alone needs the username plus one more factor, or it opens a recovery session that can add a primary method only after a 24-hour hold. Any full session can cancel the hold, and an alert goes out at the start.
  2. Recovery codes, a second PGP key or a security key may skip the hold.
  3. Give the backup route its own daily cap, for example 5 tries per day.
  4. Define how a recovery session becomes full: log in with the newly added method, which creates a new session.

**P2-I2 · Task 8 Step 1: the TOTP replay test contradicts the rule.**
- *Problem.* After the current step S is accepted, `last_step = S`, and `where last_step < $step` then refuses S−1. The test says "the previous step's code (−30 s) → accepted once".
- *Fix.* Test the previous-step code first, on a fresh enrolment (accepted once, then refused). Then show that S is still accepted afterwards, and that S−1 is refused once S has been used.

**P2-I3 · Task 6: PGP challenge binding, replay tests and a denial-of-service path.**
- *Problem 1.* "Issuing a new challenge marks earlier unused ones … as used". Anyone can call `login/pgp/start` every few seconds and cancel the real user's challenge while they are decrypting it.
- *Fix 1.* Keep up to 3 open login challenges per account, limit `start` per account (for example 5 per 5 minutes, enforced by slowing down, not locking), and invalidate earlier challenges only from the same browser, identified by a pre-auth cookie.
- *Problem 2.* There are no tests that the challenge is bound to its purpose and session.
- *Fix 2.* Add tests:
  - a `login` code refused at `confirm` and at `register` finish;
  - a `confirm` challenge started by session A refused for session B;
  - an `add-key` challenge refused for another account;
  - a challenge refused after its session is logged out.
- *Problem 3.* `siteHost` comes from a single config value, so on the `.onion` origin the message names the clearnet host. That teaches users to ignore a mismatch.
- *Fix 3.* Use the request's `Origin` (already checked against `config.origins`) as `siteHost`.

**P2-I4 · Task 7: WebAuthn security tests are missing.**
- *Problem.* Only the login origin is tested.
- *Fix.* Add tests:
  - an `rpIdHash` for another RP ID → `webauthn-failed`;
  - registration with a bad origin → `webauthn-failed`;
  - an assertion from account A's credential used to finish account B's challenge → `webauthn-failed` (`credential_id` must belong to `challenge.account_id`);
  - UP flag clear → refused;
  - UV clear on a passkey login, not only at registration → refused;
  - a challenge used after 5 minutes → `challenge-expired`;
  - `type` other than `webauthn.get` → refused.

**P2-I5 · Tasks 7 and 9: the hardware-key rule for staff and the owner cannot be enforced.**
- *Problem.* With `attestationType: 'none'`, the `credentialDeviceType` and `backedUp` flags are claimed by the authenticator itself, so a software passkey can report `singleDevice` and `backedUp=false`. Spec 6.6 asks for hardware security keys.
- *Fix.* For staff and owner registration, use `attestationType: 'direct'` and check the attestation against an allowlist of AAGUIDs and roots (for example YubiKey 5 series, FIDO MDS3 snapshot stored in the repo). Keep `none` for traders. `ownerReady` counts only attested credentials.

**P2-I6 · Task 4: no session-fixation or cookie tests, and the recovery-to-full upgrade is undefined.**
- *Fix.* Add tests:
  - a request carrying an attacker-chosen `__Host-x2f_session` value before login gets a new token at login, and the old value stays unauthenticated;
  - a login made while another session cookie is present replaces it;
  - `Set-Cookie` has `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`;
  - after `removeMethod` or `PUT /v1/account/password`, other sessions are ended (or a decision is recorded).

  State that a recovery session never becomes full (see P2-I1).

**P2-I7 · Tasks 5–7: method enumeration and timing are unspecified.**
- *Problem.* `login/password` for an unknown username skips Argon2, so the response time reveals whether the account has a password. `login/webauthn/start` returns `allowCredentials`, exposing which method the account uses plus credential IDs that can be tracked. No plan says what any `start` route returns for an unknown username.
- *Fix.*
  1. Verify against a dummy Argon2 hash when there is no password row.
  2. Make traders' passkey login discoverable: an empty `allowCredentials`, and the username is not needed.
  3. Security-key `start` for an unknown name returns decoy options.
  4. Add one test per route showing that unknown and known usernames give responses of the same shape.

  Usernames themselves are public, so `username-taken` at register is acceptable.

**P2-I8 · Tasks 2, 5 and 6: unauthenticated requests are expensive, and nothing caps them.**
- *Problem.*
  - Each password login allocates 64 MiB for Argon2 with no limit on how many run at once.
  - Account creation has no limit at all (spam accounts, username squatting).
  - The size of an armored PGP key is unbounded.
- *Fix.*
  - A process-wide semaphore for Argon2 (for example 4 at a time, 503 `busy` beyond that).
  - An in-memory, never-persisted global token bucket on the register and start routes.
  - Armored keys limited to 32 KiB and 8 subkeys.
  - Tests for each.

**P2-I9 · Task 4 and every login route: `accounts.disabled_at` is never checked.**
- *Problem.* Plan 4 needs "switch anyone off instantly" (6.6) and bans. Nothing refuses a disabled account.
- *Fix.* `requireSession` and every login `finish` refuse when `disabled_at` is set (403 `account-disabled`, added to `ApiErrorCode`). Add a test that a live session stops working on its next request.

**P2-I10 · Task 13 Step 3: items deferred elsewhere have no owner.**
- *Problem.*
  - "Security-key tap to fund or withdraw (Plan 3)": Plan 3 has no such task.
  - The escrow key backed up to the user's PGP key (6.4) appears in neither plan.
  - "Require a security key to log in" (6.3) is not listed.
  - The roadmap's Plan 6 row lists none of the deferred hardening.
- *Fix.* Assign each item to a plan in the roadmap. Ask the owner to delete the wallet-era leftovers in 6.3 ("withdraw", "daily spending limits", "PGP-signed withdrawal addresses"), since X2F holds no wallet.

### Minor

**P2-M1 · Task 1.** The "contains `admin`" rule refuses innocent names (`badminton`, `Sadmina`). Reserve whole tokens or prefixes instead (`admin*`, `*moderator*`, `x2f*`, `*support`, `staff*`), and add the false-positive cases as tests.

**P2-M2 · Task 3.** One `001_accounts.sql` fixes every table before the tasks that use them are reviewed, so review changes (device cookie, confirm tokens) will need patch migrations. Let each task add its own numbered migration.

**P2-M3 · Task 12.** The list of 37 method names transcribes code. Replace it with the rule "one method per route, named verb + noun" and list only the helpers that carry decisions (`withConfirm`, the ceremony wrappers, `AuthApiError`).

**P2-M4 · Task 4 and Task 11.**
- `purgeExpired` has no scheduler. Run it from `main.ts` every 10 minutes.
- Removed wallets keep their addresses forever. Null out `address` 90 days after `removed_at`.

**P2-M5 · Task 3.**
- Fastify's default request logs include URLs. Set `disableRequestLogging: true` and add a log-capture test.
- Record the leaked-list subset to use: the full HIBP SHA-1 list is roughly 20 GB at 20 bytes per record. For example, use only entries with count ≥ 10, and note the file size in `docs/dev-setup.md`.

**P2-M6 · Task 4 CSRF.** Add tests for `Origin: null`, a lookalike origin (`https://x2f.test.evil.com`) that only shares the prefix, and a JSON body sent as `text/plain` (must be 415).

**P2-M7 · Task 8.** During enrolment the TOTP secret sits in `challenges.payload` as plaintext. Encrypt it under `totpKey` there too.

**P2-M8 · Spec drift to record.**
- 6.2 says the PGP "fingerprint becomes the account ID", but the plan logs in by username.
- 6.3 mentions "PGP-encrypted notifications for users who opt into email", which conflicts with the no-email constraint.

The owner should settle both and the spec be updated.

**P2-M9 · Task 4.** `SameSite=Strict` means links into `/trade/:code` from outside (OS notifications, chat apps) arrive logged out. Either use `Lax` with the Origin check, or keep `Strict` and record the trade-off.

**P2-M10 · Task 11.** Integrated addresses are accepted, but Plan 1's structural `cosign` check refuses unexpected payment-ID extras (research §1). Either refuse integrated addresses (`address-integrated`) or confirm that Plan 1 accepts them, and test it.

---

## Plan 3: Offers and the trade flow

### Critical

**P3-C1 · "Known gap" (Global Constraints) and Tasks 5–7: the API can take control of two of the three keys.**
- *Problem.* The API hands out every trade identity, and it also runs the moderator party in-process. A compromised API can give the seller a fake buyer key, which together with the moderator key it already holds makes two of three.
- *Why it blocks.* This breaks spec 1 ("No single breach of X2F's servers can move user funds") and 3.1 ("X2F holds at most one key per trade"). Research §2 item 4 treats it as the Haveno root cause. A note deferred to Plan 6 is not enough, because the fix changes Plan 2's schema and Plan 3's protocol.
- *Fix (owner decision before Plan 3 starts).* Options, smallest first:
  - **(a)** Each trader's trade identity is signed by an account-level device signing key from Plan 2, whose public key the counterparty pins on first sight (trust on first use) and shows as a short fingerprint on the profile. The trade room shows a 4-word "escrow check" derived from the participants and the escrow address, which both sides can compare outside X2F.
  - **(b)** Add an append-only, publicly mirrored log of identity registrations that clients cross-check.
  - **(c)** Run the moderator party in a separate process (`apps/moderation`) with no public HTTP surface, and cap trade size until (a) or (b) ships.

  Whichever is chosen, add a test: a participant list swapped by the server makes setup abort.

**P3-C2 · Task 13 `POST /v1/trades/:code/events {type}` and Task 2 `apply`: clients can send system events.**
- *Problem.* The Task 2 rules never say that `chain`, `setup-done`, `settled` and `tick` require `by === 'system'`.
- *Impact.* A seller can post `{type:'chain', receivedAtomic:…, confirmations:10}`, the trade shows "Escrow secured", and the buyer pays fiat into an escrow that was never funded.
- *Fix.*
  1. `apply` throws `wrong-party` for these four events unless `by === 'system'`.
  2. The route accepts only a whitelist: `mark-paid`, `extend`, `request-refund`, `propose-cancel`, `accept-cancel`, `withdraw-cancel`, `release-started`, `open-dispute`.
  3. `by` is derived from the session's role in the trade, never taken from the body.
  4. Tests for each forbidden type.

**P3-C3 · Task 1 `payoutsFor` and Task 7 `cosignPolicy`: a buyer can be paid a deposit they never sent.**
- *Problem.* Mutual cancel pays `seller: balance − deposit, buyer: deposit` using the deposit *due*. If the buyer has not yet funded the deposit, a cancel pays them the due deposit out of the seller's coins. The seller's `cosignPolicy` accepts this, because both sides compute the same wrong figure. Release has the same problem: in `securing` it throws `underfunded`.
- *Example.* The seller funded 1.2625 XMR and a 0.1875 XMR deposit is due but unpaid. The buyer proposes a cancel and receives 0.1875 XMR.
- *Fix.*
  1. Define `depositReceived = min(depositAtomic, max(0, balance − sellerFundsAtomic))`.
  2. Every payout uses `depositReceived`; any excess goes to whoever overpaid. Overpayment can come from either side once deposits exist, so record each funding tx's sender role from the watcher.
  3. Tests: cancel with the deposit unpaid (seller gets everything), partly paid, and fully paid.

**P3-C4 · Plan 2 "No screens" plus Plan 3 Task 16: no task builds login or security settings screens.**
- *Problem.* Task 16 builds only onboarding and Your wallets. Neither plan builds:
  - login for a returning user (PGP challenge, passkey, security key, password plus TOTP, backup login);
  - the confirm-it's-you sheet for each method, which Task 16 relies on;
  - Settings → Security: list, add and remove login methods, TOTP enrolment with QR, recovery codes, the 24-hour wait toggle (spec 7 item 4), the device list with remote log-out, and the alerts list ("the app always shows an alert", 6.4).
- *Impact.* A user whose session expires cannot get back in.
- *Fix.* Add a task, "Log in, confirm-it's-you and Security settings", built from the design system (no boards exist except SetupLogin and SetupBackup, which can be reused). It consumes Plan 2's `createAuthApi` and `withConfirm`, with e2e tests for each login method against the soft authenticator.

### Important

**P3-I1 · The "Assumed Plan 2 interface" block is stale.**
- *Problem.* Nearly every assumed name differs from Plan 2: `buildApi(o: ApiOptions)`, `app.db`, `users`, `requireUser` / `req.user` / `login-required`, `listWallets`, `isDefaultPayout`, `usableAt`, the `WalletApp` values, and `useSession`.
- *Fix.* Replace the block using the cross-plan list below and delete the "if Plan 2 builds them, delete Task 16" clause (Plan 2 builds no screens).

**P3-I2 · Task 5 relay tickets conflict with Plan 1's signed join challenge.**
- *Problem.* Plan 1's relay now requires a signed join challenge from a trade identity key, so it must know the three `signPublic` keys. Task 5 adds HMAC tickets instead and never tells the relay those keys. The ticket also puts the trade code in the WebSocket URL query, where reverse-proxy logs pick it up.
- *Fix.*
  1. Drop HMAC tickets, or keep them only as an anti-abuse pre-check.
  2. Add `POST <relay>/v1/admin/trades {channel, signPublics}`, called by the API over a private network with a shared secret, once participants are complete.
  3. Use the join challenge for the actual access check.
  4. Address the channel by a derived ID (HKDF of the trade code), not the code (research §5).
  5. Update Plan 1's relay tests accordingly.

**P3-I3 · Tasks 6 and 15: the pre-built auto-refund versus the strict party runner and multisig nonces.**
- *Problem 1.* The seller sends `release.txset` when tapping Cancel & get refund, but the moderator party only calls `settle` 15 or more minutes later. A strict in-order runner drops a `release.txset` it did not expect.
- *Problem 2.* If the buyer then marks paid, the abandoned partly-signed tx set must not be followed by another build from the same multisig info (research 1.8 and 1.9, nonce reuse).
- *Problem 3.* `proposed` passed to `autoRefundDecision` must come from the decoded tx set, not from `payoutsFor`.
- *Fix.*
  1. Plan 1's runner buffers one `release.txset` per outcome until the local `settle` call.
  2. After any abandoned tx set, every party runs a fresh `state.export` / import round before the next build.
  3. `proposed = describeMultisigTxSet(txSet).payouts`.
  4. Regtest test: refund requested → buyer marks paid in the final alert → seller releases. Exactly one tx is broadcast and it pays the buyer.

**P3-I4 · Task 2 and Task 17: the coins are still locked when the plan lets the seller release.**
- *Problem.* Monero outputs unlock after 10 blocks, Plan 1 found 12 blocks necessary in practice, and the multisig info has to be re-exported after funding. Yet `secured` triggers at 10 confirmations, `release-started` is allowed in `securing`, and Task 17 mines only 10 blocks. Spec 7's "Releasable in N min" chip is not built.
- *Fix.*
  - `secured` = `sync().unlocked ≥ sellerFunds + depositReceived` after the post-funding export/import round, not a confirmation count.
  - `release-started` and `accept-cancel` are allowed only once the funds are unlocked; before that the UI shows "Releasable in N min".
  - Task 17 mines 12 blocks.

**P3-I5 · Task 2: trades can get stuck in two states.**
- *`settling`.* There is no timeout and no dispute path. A seller who triggers `release-started` and never signs leaves the buyer with no recourse; a cancel that is accepted but never signed has the same problem.
- *`setup`.* There is no deadline. A poster who is offline never completes key exchange, and the taker is held by `already-waiting`.
- *Fix.*
  - Add `settleBy = now + 15 min`; on a tick it returns to the previous state, and `open-dispute` is allowed from `settling` after `settleBy`.
  - Add `setupBy = takenAt + 15 min`; a tick in `setup` past it → `cancelled`, with no penalty.
  - One test each.

**P3-I6 · Task 6: when funding lapses or arrives late, the refund needs the buyer, who has usually left.**
- *Problem.* A lapse refund needs the buyer's app to co-sign, but a buyer released "with no penalty" has no reason to stay. Funds sent after `lapsed`, or after the trade has settled, are stranded.
- *Fix (owner decision; spec 3.3 lists only one automatic exception).*
  - **Option A:** extend `autoRefundDecision` with a `lapse` case that pays the whole balance to the recorded refund address once `fundBy` has passed and the buyer has never marked paid, and update spec 3.3.
  - **Option B:** route it to a human moderator.

  Either way, the watcher keeps watching closed escrows for 30 days.

**P3-I7 · The buyer deposit has no funding task, and the threshold rule is ambiguous.**
- *Problem 1.* No screen or flow lets the buyer fund the deposit: no `moneroUri` for the buyer, no deposit chip, no copy for a missed `depositBy`.
- *Problem 2.* Spec 2.5 says "larger trades, *and* buyers without a track record" pay a deposit. 11.4 and `depositFor` apply it only to buyers with fewer than 3 trades. Also, `fiatUsdCents` needs a USD conversion for trades in other currencies.
- *Fix.* Add the buyer deposit-funding step to Task 12 (or a new task), with a test, and get the owner to choose the threshold.

**P3-I8 · Task 4 and Review Focus 4 versus spec 2.2 step 4.**
- *Problem 1.* The buyer must pick which wallet gets paid. The BuyQuote board ("Which wallet gets paid?") now exists, but Task 4 uses a "default payout wallet", which Plan 2 does not have.
- *Problem 2.* The spec's case is five *sellers* taking one *buy* ad. Task 4 only tests one buyer taking twice.
- *Problem 3.* Review Focus 4 says "two takers race for one offer, exactly one wins", but a sell ad is a standing offer that many people can take at once.
- *Fix.*
  1. `take` requires `walletId` from the buyer every time. When a seller takes a buy ad, the trade waits in `setup` until the poster picks a wallet on "<username> accepted your offer".
  2. Enforce at most one trade awaiting funding per buy ad and amount.
  3. Test five concurrent seller takes on one buy ad.
  4. Reword Review Focus 4.

**P3-I9 · Dependent tasks D1 and D2: their boards have landed.**
- *Problem.* BuyMain, BuyOffers, BuyQuote, DisputeOpen, DisputeRoom and DisputeRuling arrived in commit d84b675.
- *Fix.*
  - Promote D1 into Task 9 and Task 4 (wallet picker).
  - Build Task 13's `DisputeSheet` from DisputeOpen: reasons, note, the "moderator will read this chat" notice; evidence upload stays masked for Plan 5.
  - Move the trader-side DisputeRoom and DisputeRuling into Plan 3 or Plan 4 explicitly.

**P3-I10 · Who pays the release network fee: the boards and the plans disagree.**
- *Problem.* BuyQuote says "Network fee: Paid by satoshi_ghost" (the seller) and "You receive 1.25 XMR". Plan 1 takes the fee from payout index 0 (the buyer), and Task 17 asserts that the buyer receives less.
- *Fix.* The owner chooses:
  - (a) change the board copy, or
  - (b) have the seller fund a fixed release-fee reserve. Add it in `escrowPlan`, and Plan 1 `cosign` then expects index 0 to receive exactly its amount and the leftover reserve to go back as change.

**P3-I11 · Tasks 2 and 12: the rate locks at funding, but the board promises nothing changes after the tap.**
- *Problem.* The rate locks at funding (`lockedRate = rateNow`), so the fiat total can differ from the quote. Spec 2.2 step 3 and the BuyQuote board say "Nothing changes after you tap Trade". Spec step 5 ("The price locks at this moment") points the other way.
- *Fix.* The owner picks one. Recommended: lock the rate and fiat total at `take` and change the spec 2.2 step 5 wording. Add a test that the fiat total shown at fund time equals the quote.

**P3-I12 · Task 4 `trade_events` versus retention.**
- *Problem.* An insert-only table whose trigger also rejects DELETE, plus `trades` keeping payout and refund addresses forever, conflicts with spec 1 principle 2, spec 4.1 and spec 6.6 ("original follows the normal deletion schedule").
- *Fix.*
  - Keep events append-only but free of addresses (store `addressEnd` only).
  - Purge `trades.buyer_payout` and `seller_refund` 90 days after close, never while a dispute is open, through a single purge role that the trigger allows.
  - Test the purge.

**P3-I13 · Task 15: the final alert reaches only an open tab.**
- *Problem.* With Web Push deferred to Plan 6, a buyer who paid and closed the tab never sees "The seller is cancelling", and the auto-refund fires against them. "<username> accepted your offer" never reaches an offline poster either.
- *Fix.* Add Web Push to Plan 3 with generic payloads only ("Something changed in a trade on X2F"). If not, get the owner's written acceptance and stop the auto-refund for buyers with no open session or push subscription.

**P3-I14 · Task 16: the Wallet board copy would be false.**
- *Problem.* The board says the escrow key "is backed up to your PGP key". No task implements the backup (spec 6.4), and the "lost device" escrow test (spec 9) is absent.
- *Fix.* Either implement the PGP-encrypted backup of `escrowStore` records in Plan 3 (OpenPGP.js is already in Plan 2), or change the copy and assign the backup to a named plan.

**P3-I15 · Global Constraints and Task 8: missing headers and a log leak.**
- *Problem.* Trade codes reach logs and third parties:
  - The trade URL `/trade/<code>` leaks to the block explorer through `Referer`.
  - Fastify's default request logs record `/v1/trades/<code>`, which breaks the plan's own "logs never contain trade codes".
- *Fix.*
  - Add `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin` and HSTS, and `rel="noreferrer noopener"` on the explorer link.
  - Turn off request logging (P2-M5).
  - Add a test grepping the captured log for a trade code.

**P3-I16 · Tasks 4, 6, 8 and 16 are too large to review.** Split them:
- **Task 4:** offers / take with guards / view and store.
- **Task 6:** `incoming()` and the watcher / moderator party and keystore / timer loop and auto-refund / lapse refund.
- **Task 8:** shell, tokens, fonts and CSP / UI kit / parity harness and reference capture / copy-lint.
- **Task 16:** onboarding (9 boards) / Your wallets.

**P3-I17 · Tech Stack: several dependencies are used but not pinned.**
- *Missing:*
  - `fake-indexeddb` (Task 7);
  - a DOM test environment: `happy-dom` or `jsdom`, plus `@testing-library/react` (Task 14 `HoldButton.test.tsx`);
  - `@types/react`, `@types/react-dom`, `@types/qrcode`;
  - `@fastify/static` (the API's static handler, Task 8).
- *Fix.* Pin each exactly at a version at least 14 days old.
- *Other notes.*
  - Plan 3 runs `npm audit` across all dependencies while Plan 2 uses `--omit=dev`. Use one gate.
  - vite 8.3.2 is exactly 14 days old today (published 2026-10-01T10:17Z), so fix the cutoff time rule or pin 8.3.1.

**P3-I18 · Task 6 and Task 17: scale and the test network are unproven.**
- *Problem.* The moderation service keeps a monero-ts wallet open in the API process for every open trade and syncs each one every 15 s. Spec 3.2 lists "stagenet with real block times, many trades at once" as still to prove, and spec 10 says the MVP runs on the test network only.
- *Fix.* Add a stagenet smoke run and a load check (for example 25 concurrent trades), recording memory and sync lag, before Plan 3 is called done.

**P3-I19 · Task 2: maintenance mode cannot pause the timers.**
- *Problem.* Spec 6.6 says "escrow timers pause until it is switched off". Plan 4 owns the switch, but the deadlines live here, and adding a pause later touches every deadline.
- *Fix.* Add `pausedMs` (or a `site_flags.maintenance_since`) to `apply` and `nextDeadline` now: deadlines move by the paused time, and the timer loop does not tick during maintenance. Add a test.

**P3-I20 · Task 4 / Task 11: sanctioned payment methods can be posted.**
- *Problem.* The catalog marks SBP, Mir and YooMoney with `legalReview: "sanctions: …"`, and spec 11.7 requires lawyer sign-off before any of them go live. Nothing blocks them.
- *Fix.* `POST /v1/offers` refuses methods that have `legalReview` (409 `method-unavailable`), and PostOffer hides them. Add a test.

**P3-I21 · Task 10: chat identities are undefined, and chat does not go through the relay as the spec says.**
- *Problem 1.* Pre-trade chats use identities that no endpoint registers. Task 5 covers trades only.
- *Problem 2.* `ReplayGuard` requires a strictly increasing `seq` per sender, which breaks when one user chats from two devices.
- *Problem 3.* Spec 8 says chat goes through the relay; the plan stores it in the API instead.
- *Fix.*
  - Add `POST /v1/chats/:chat/identity` with the same one-per-role rule.
  - Use `seq` = per-device counter + device ID, or persist the guard per chat.
  - Cap envelope bytes on the chat route.
  - Record the API-storage decision in spec 8. It is reasonable, since the relay is memory-only and kept for 24 h.

### Minor

**P3-M1 · Test commands.** Tasks 1–2 use `npm test -w @x2f/trade`. With root `vitest.config.ts` projects, use `npm test -- --project @x2f/trade`, as Plan 2 does.

**P3-M2 · Task 10.** The chat notice uses the Desktop board's "Encrypted. If a dispute is opened…", while spec 6.6 and the DisputeRoom board say "Chats are encrypted. If a dispute is opened, a moderator can read this conversation." Use the spec text and fix the Desktop board.

**P3-M3 · Spec items with no task.**
- The quote's "fiat total in both parties' currencies" (2.2 step 3).
- The "What is this?" explainer from the method name in a trade header (2.6).
- "Suggest a missing method" (2.6).
- "Point the wallet at your own Monero node" (4.1).

Add each, or list it as deferred with an owning plan.

**P3-M4 · Task 11.** The fee sentence on PostOffer is not on the board, which goes against "copy from boards verbatim". Spec 11.1 also says the poster learns of the fee "at sign-up", and no setup screen says so. Get the owner to sign off the sentence and place it in onboarding.

**P3-M5 · Task 15.** The nudge refusals `blocked`, `quiet-hours` and `nudges-off` tell the sender about the recipient's settings, time zone and blocks. Return the same 202 for every silent drop, and keep the distinct codes only for the sender's own limits (`too-soon`, `no-shared-context`).

**P3-M6 · Task 8 `capture-refs.ts`.**
- It calls "the Artifact tool", which a script cannot do. Make it a controller step that saves `support.js`.
- A 3% pixel tolerance against canvas renders is fragile across font rasterisers. Keep the structural checks blocking (one `data-primary`, copy, no horizontal scroll), and treat pixel diffs as reported artifacts reviewed by a person.

**P3-M7 · Task 17.** Steps 2–3 ("expect FAIL until wiring gaps are fixed", "Fix what the runs expose") decide nothing. Instead, list the expected first failure and require each fix to name its owning task.

**P3-M8 · Builds on.**
- "One additive change" actually lists two.
- The research doc (§3) asks for `net` and `tls` to be aliased to empty modules in the browser bundle; Task 8's Vite config should say so.

**P3-M9 · Access rules.**
- State and test that `GET /v1/methods`, `/v1/offers` and `/v1/price` need no session (2.2 step 1).
- `GET /v1/trades/:code/participants` requires a participant session.
- SSE delivers only the viewer's own events.

**P3-M10 · Task 2.**
- `disputeAfterRefundDays: 90` is a new decision; get the owner to confirm it.
- `open-dispute` is not allowed in `secured`, yet the DisputeOpen reasons include "The seller asked for more money or a different payment". Decide whether a buyer can dispute before paying.

**P3-M11 · Roadmap.** Nudge is listed under Plan 5 but built in Plan 3 Task 15. Update the roadmap.

**P3-M12 · Task 12.**
- A `monero:` URI cannot set fee priority, so "always fast" applies only to X2F-built releases. Fix the copy.
- Add the manual check still open in spec 6.4: Cake Wallet and Edge `monero:` links on iOS.

---

## Cross-plan reconciliations

1. **Plan 3's assumed block, rewritten to Plan 2's names:**
   - `buildApi(deps: Deps)`; use `deps.db` and `deps.clock`.
   - Plan 2 Task 3 adds an npm script `migrate`.
   - Table `accounts` (`id`, `username`, `username_key`, `kind`); foreign keys are `account_id`, including `trading_holds.account_id`.
   - `requireSession({ fresh?, allowRecovery? })` → `req.auth.accountId`; 401 `not-authenticated`.
   - `usableWallets(db, accountId, now)` and `GET /v1/wallets` (`usableFrom`, `usable`).
   - `WalletApp` = Plan 2 `WALLET_APPS`.
   - The web `useSession` is a thin hook in Plan 3 over `createAuthApi().me()`.
   - Plan 3's nudge settings route moves to `/v1/account/nudges`.
2. **Default payout wallet.** The Wallet board shows "· gets payouts". Either Plan 2 adds `wallets.is_default_payout` (one per account), or Plan 3 drops "default" and always asks (BuyQuote picker). Pick one.
3. **Who may trade.** Plan 3 routes that take, post or release require `kind = 'trader'` and a full session (no recovery level), and `disabled_at` is enforced by Plan 2's `requireSession` (P2-I9).
4. **Confirm-it's-you.** Plan 2's action-bound `confirmToken` (P2-C2) is what Plan 3 calls when a buyer adds a wallet during a take. Plan 3's confirm sheet (P3-C4) is the only UI for it.
5. **Identity binding.** If the owner picks option (a) for P3-C1, the account-level device signing key, its registration and its fingerprint are Plan 2 work, and Plan 3 consumes them.
6. **Deferred items** (P2-I10): a security-key tap to fund, escrow-key PGP backup (P3-I14), "require a security key to log in", and Web Push (P3-I13). Each needs a named plan in the roadmap.
7. **Relay** (P3-I2): Plan 1's join challenge needs participant keys from the API. Define the API→relay registration call in Plan 3 and amend Plan 1's relay interface.
8. **Error codes.** Plan 3's refusals (`own-offer`, `already-waiting`, `wallet-not-ready`, `trading-hold`, `trading-paused`, `price-unavailable`, `method-unavailable`, nudge codes) join Plan 2's `ApiErrorCode` union, and both use `ApiError`.
9. **One origin.** The web app and the API share an origin (the `__Host-` cookie and `connect-src 'self'` both depend on it). Plan 2's auth client uses `credentials: 'include'` and Plan 3's `api()` uses `'same-origin'`; pick one.
10. **Migrations.** Number them by plan: Plan 2 `0xx`, Plan 3 `1xx`, Plan 4 `2xx`. Each task adds its own migration (P2-M2).
11. **Gates.** Use the same `npm audit` scope and the same vitest `--project` commands in every plan.
12. **Retention.** One scheduler runs Plan 2's `purgeExpired`, Plan 3's `purgeChats` and the trade address purge (P3-I12).
