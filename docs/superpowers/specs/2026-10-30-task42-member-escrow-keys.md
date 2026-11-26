# Plan 3 Task 42: member escrow keys (design, 2026-10-30)

Status: **DESIGN, for the lead and the owner.** Nothing here is built. It answers the OPEN item in spec 6.7, R44 and Plan 3 Task 42 ("a per-member key scheme must be designed and reviewed against spec 3.1 before a member can release"). It also answers the Task 18 review's I2 (`~/x2f-comms/review-task18-2026-10-30.md`): today a member's take is refused (`member-cannot-sign`) because the escrow can only run on the account owner's device.

**Revision 2026-10-30b** (after claude2's review, `~/x2f-comms/review-task42-design-2026-10-30.md`, CHANGES REQUIRED, 4 Important + 6 Minor). What changed, by finding, is in section 6 ("Review response"). In short:
- The "team key" is now the **account key**. It binds **every** account slot, the owner's trades too, not only members' (I1).
- The attestation now names each slot's account, and the counterparty's app checks it. Without that, I1's fix could be dodged by mislabelling the slot's account (found while fixing I1).
- The account key is pinned only after a 72 h hold. Every owner device checks a moderation-signed key status on each open, and can veto during the hold (I2).
- Device and member approvals use a 6-digit comparison code that the server cannot fake (found while fixing I2).
- The cross-device nonce rule no longer depends on the holder lease (I3).
- Owner questions Q2 and Q6 now say what the design really delivers (I4).
- Minors M1 to M6 are folded in where they belong.
- Section 1.1 assesses the gap I1 says is already open on the main line.

Authority: spec 3.1 and 3.3 (X2F holds at most one key per trade; no automatic third key; every protocol message is signed by a trade identity and checked against the attested participant list) > R26, R44 > this note.

## 1. The question, restated

The goal is for a Trades member to take a trade and finish it without the owner's device being online:
- take or accept,
- secure the escrow,
- mark paid,
- release as seller,
- co-sign refunds and cancels.

The 2-of-3 guarantees must not weaken.

**There is no long-lived "owner escrow key" to share.** The code shows why:
- Every trade gets fresh keys on the device that sets it up (`apps/web/src/escrow/runtime.ts` `run()` → `deps.newIdentity()`). The trade identity is Ed25519/X25519. The Monero multisig party secret lives in `PartyState`, and a random wallet password sits beside it.
- These are stored wrapped in IndexedDB `x2f-escrow` (`store.ts`) and never leave the device.
- Monero multisig setup is interactive (several message rounds through the relay). So the party key exists only on the device that ran those rounds, at the moment they ran.
- Monero has no threshold-within-a-party and no nested multisig. The owner therefore cannot hold "half" of a seller key, and cannot pre-generate a trade's key while offline.

So the real question is not "how does the owner's key reach the member". It is: **how does X2F let a member's device be the account's party in a trade, and prove that the owner allowed it, so that a compromised API cannot use the same door?** A second question follows: what does the owner keep, so that a member who leaves or loses a phone does not strand the coins?

### What protects a trade today (and must still protect it)

1. **The moderation service's attestation** (`packages/trade/src/attestation.ts`, `apps/moderation/src/attest.ts`):
   - It signs the three participant keys, the channels and the terms (deal, buyer payout, seller refund).
   - It checks both traders' proofs of possession itself (`identityProofValid`). It does not take the API's word.
   - It does **not** check which account a slot belongs to. `checkWork` (`attest.ts:46-54`) checks only that each key proves possession for its code and role. Nothing ties the key to an account.
2. **Each trader app checks the attestation** (`verifyAttestation`):
   - Its own slot must hold its own keys (`not-me`).
   - The deal must equal what its user confirmed, and its own address must be the one in the terms (`wrong-terms`).
   - This catches a **swap**: an API that puts its own key into a slot where a real party's device is also in the trade. That device notices.
   - It does **not** catch an **impersonation**: an API that makes a trade "by account X" when X's device is not in the trade at all. Nobody on X's side is there to check `not-me`. Section 1.1 covers this.
3. **X2F holds only the moderator key**, in a separate process (`apps/moderation`, P3-C1). The automatic moderator signatures (no-show refund, buyer cancel) can only pay the seller's refund address recorded at setup.

**What a member scheme must not open:** if a member's device can fill the account's slot, then the owner's device is not in the trade, and nobody on the account's side checks `not-me`. That is exactly the impersonation case of section 1.1. Suppose the API alone could decide "this key belongs to a member of account X". A compromised API could then trade as a real account under a "member" label, and no device of that account would ever see it. The original draft said this gives X2F "two keys". That overstated it (section 1.1): an API-only breach still gets one key, because the moderator key is in another process. But it would make an accepted residual risk (impersonation) the normal way team trades work, with nothing to tell it apart. So every option below is judged first on how it closes this hole **for owner and member slots alike**.

### 1.1 Assessment: is the I1 gap open on the main line today?

**Yes, it is a real gap in what has landed. But it is an accepted residual that is already written down, and it is not a 2-of-3 custody break.**

**What is open.** On the main line (origin/claude/compassionate-johnson-k95ssr @5c4d35b), a compromised API can do the following:
- Create a trade "by account X" (any account, including a reputable one) against a real counterparty.
- Register a trade identity it generated into X's slot. `checkWork` attests it, because the proof of possession is valid and nothing binds a slot to an account.
- The counterparty then sees a normally attested trade with X's name and reputation, and X's device never sees it.

**Why it is not a custody break.** The moderator key is in `apps/moderation`, which has no inbound surface and its own database (P3-C1). An API-only breach therefore holds **one** key in the trade, which matches spec 1 ("No single breach of X2F's servers can move user funds"). What the attacker can actually do:
- **As X selling:** it must fund the escrow with its own XMR. If it never releases, the buyer wins the dispute and takes the attacker's coins.
- **As X buying:** the real seller releases only when fiat arrives. The attacker can take coins only by winning a dispute before a **human** moderator with forged payment proof, borrowing X's reputation to look credible.
- **Otherwise:** grief the counterparty (wasted setups, timeouts), and send phishing chat as X (for example "pay to this account").

**Where it is written down.**
- Plan 3 OD-1 and X-5: "Account device keys with trust on first use are Plan 6 hardening".
- Plan 3 Task 33 Step 3: the residual-risk entry "the API can register a fake identity, but that holds one key at most".
- Plan 6 D20: device-key TOFU, with the recommendation to defer it until the auditors weigh in.
- So it is an assumption the plans accepted, not a bug in Tasks 8-12.
- But spec 3.3 does not state it as a known limit, and the escrow check words do not help: they detect a man in the middle between two real parties, not a party that is fake from the start.

**Severity: Medium.** It allows impersonation and dispute fraud with stolen reputation, and it needs a full API compromise. There is no direct theft, and it does not break 2-of-3. It is acceptable on the test network, but it should be closed before mainnet: impersonating trusted traders is exactly how P2P scams scale.

**Smallest fix.** The account key and slot bindings of section 2.1, owner slots only (no delegations):
1. Each account has an account key, pinned at the moderation service with the hold and the owner-device check of 2.1.1.
2. Every identity registration from an owner device carries a slot binding signed by that key.
3. The moderation service refuses an unbound slot for an account whose key is pinned.
4. The attestation names each slot's account (Trade Tag), and the counterparty's app checks it against the trade it confirmed.

That is roughly the first half of 42a. It also replaces Plan 6 D20: the counterparty needs no TOFU, because the moderation service checks the binding.

**Owner.** Plan 3 **Task 42a**, built as its first slice ("42a-0: account key and bound slots") so it can land before member signing. Until then, record it in `docs/security/plan-3-review.md` and in spec 3.3 as a known limit (section 5).

## 2. Options

Three serious options follow, plus two I reject outright (section 2.4).

### 2.1 Option A: per-member signing keys with an owner-signed delegation, checked by the moderation service (plus an encrypted handover copy to the owner), on top of an account key that binds every account slot

In one line: every device that fills an account's slot proves that the account allowed it. An owner device proves it with the account key. A member's device proves it with its member key plus a delegation that the account key signed (scope, caps, expiry). The moderation service checks this before it attests, and it names the account in the attestation. X2F can revoke a delegation but can never create one, and it cannot put a key of its own into an account whose key is pinned.

**Key custody**
- **Account key (owner):**
  - One Ed25519 + X25519 key pair per account.
  - It is made on an owner device: on the first open after the update for existing accounts (section 2.1.1), or at sign-up for new ones.
  - It is stored like the escrow records: a separate IndexedDB store `x2f-account-key`, wrapped by a non-extractable AES-GCM key, opened only in the escrow worker.
  - **Every approved owner device holds a copy.** A new owner device gets it from an already-approved one: the existing device seals the key to the new device's X25519 key. This is gated by the 6-digit comparison code of 2.1.1 and done at the new-device approval that already exists (spec 6.3, "New-device approval"). As a result, any owner device can renew, approve members, open handover copies and veto a key change, and losing one owner device loses nothing.
  - The moderation service **pins** the public half: after a 72 h hold and only if not vetoed (2.1.1). Changing it is covered in 2.1.7.
- **Member key (member):**
  - One Ed25519 key pair per member per device, made at join (Task 18's `MemberInvite`, after the two-factor setup) and stored the same way.
  - A member who logs in on a new device gets a new member key, which needs a new delegation.
- **Per-trade keys:**
  - Unchanged. The device that takes the trade makes the trade identity and the multisig party key, exactly as `runtime.ts` does today.
  - For a member's trade, that device is the member's.
- **X2F** holds the moderator key (unchanged), the public keys above, and the handover copies: ciphertext it cannot open (2.1.4, and section 5 for the spec 8 and 4.1 edits). It never holds a buyer or seller key in any form it can use.

#### 2.1.1 Pinning the account key, and checking it (I2)

The review's point is right: "the first registration sticks", reached through the API, is trust on first use **through the attacker**. A confirm-it's-you does not fix that on its own. The API verifies the WebAuthn or PGP assertion and supplies the credential's public key, so a compromised API can fake it. The fix is therefore a hold plus a check that the API cannot forge, run by every owner device:

- **Registration.**
  - The owner's device signs `AccountKeyRegistration {account, tradeTag, accountKey, at}` with the new key.
  - The API forwards it to the moderation service, which stores it as **pending**. It becomes the pin `ACCOUNT_KEY_HOLD_H = 72` hours later, unless it is vetoed or contested.
  - While a key is pending, owner slots stay unbound (as today), and member slots are refused.
  - The 72 h hold (not 24 h like R42) is meant to cover a weekend away. Owner question Q10.
- **The key-status check, on every app open, on every owner device and every member device.**
  - The device sends a fresh random nonce. The moderation service answers, through the API, with a statement it signs: `KeyStatus {account, nonce, pinned: K | none, pending: [{K', since, kind: 'first' | 'reset'}], contested, lastSeenByKey}`.
  - The device checks the statement against the pinned moderation key (as for attestations). Because the nonce is fresh, the API cannot replay an old "all fine" answer.
  - An **owner device** that holds K raises a security alert when it sees a pinned or pending key other than its own K. The alert says "Someone is setting up a signing key for your account that is not from your devices", with a one-tap **"This wasn't me"** (plus confirm-it's-you).
    - A pending key is vetoed by a statement signed with the current pinned K. With no pin yet (first registration), the tap marks the account **contested**, as described below.
  - An owner device that holds no K yet (its first open after the update) registers one if nothing is pending. If a key is already pending, it shows the alert instead of registering a second one. A second registration would only make the account contested.
  - A **member device** checks that the K which signed its own delegation is still the pinned one. If not, it shows "Your approval was replaced", and the owner is told on next open.
  - If the API withholds the statement (no answer within 30 s), the device shows "Can't check your account key right now". An owner device then refuses to approve members or devices, and a member device refuses to take trades, until a check passes. A compromised API can already deny service, so failing closed costs nothing new.
  - The signed request (owner devices sign the nonce with K) also gives the moderation service `lastSeenByKey`, the last time any owner device was alive. M2 uses it (2.1.6).
- **Contested.**
  - Two different registrations for one account during a hold, or a "This wasn't me" with no pin to sign it, void every pending key and set the account to contested.
  - A contested account gets no bound slots: owner slots run unbound as today, and member slots are refused. The owner's app says "Your account key needs support", and staff clear it from the moderation console (Plan 4 tooling, two moderators, as for large rulings).
  - Contesting is a denial of service at worst, and a compromised API can already deny service.
- **Migration for existing accounts.**
  - Nothing changes until the owner's first open after the update. That open registers K (the 72 h hold starts) with a notice: "Your account now has a signing key on this device. Team trading can start in 72 h."
  - Members' slots are refused until the pin is in force. The owner's own trades work throughout: unbound while pending, bound after.
- **What stays open (stated plainly):**
  - An account whose owner opens no owner device during the 72 h hold can have a hostile key pinned. The owner then finds out on their next open, sees the alert, and must go through support.
  - An account that never opens the app after the update stays in today's residual (1.1), because it never gets a pin.
  - Both are much better than today, where no owner ever finds out.
- **Comparison code, so the API cannot slip in its own key at approval.**
  - Approving a new owner device, and approving a member device, both carry a public key through the API. A compromised API could replace it with its own key: the approver would then copy K to the API, or sign a delegation for the API's member key.
  - So both approvals show a **6-digit comparison code**: commit-then-reveal, so a server cannot grind a match.
    1. The new device first sends `H(key ‖ r)`.
    2. The approver answers with a random `n`.
    3. The new device reveals `key, r`.
    4. Both screens show `code = H(key ‖ r ‖ n)` mod 10^6.
  - The owner compares the two codes:
    - for their own new device, side by side;
    - for a member's device, by asking the member, in person or over a call outside X2F.
  - This replaces the 2-digit number matching of spec 6.3 for logins that will hold K, because two digits can be ground. Number matching for ordinary logins is unchanged.

#### 2.1.2 What the owner's device signs, and when

- **Once per account:** `AccountKeyRegistration` (2.1.1).
- **Once per new owner device:** nothing new is signed. Approving the device (with the comparison code) seals K to it.
- **Once per member (and per member device), after the member joins:**
  - The owner gets a push: "Aurora joined. Approve her to run trades from her phone."
  - The owner opens the app, compares the 6-digit code with Aurora, and checks the caps. One tap plus confirm-it's-you then signs a **delegation** with K:
    ```
    x2f/member-delegation/v1\0 + canonicalJson({
      v: 1, account, memberId, seq,            // seq: strictly increasing per account
      memberKey: <Ed25519 public, hex>,
      roles: ['trades'],                        // the delegation covers trades only
      sides: ['buyer','seller'],                // owner may narrow (buyer only, seller only)
      caps: { perTradeAtomic, per24hAtomic, openTrades },
      wallets: [<sha256(address) hex>, ...],    // sorted, unique; at most the account's wallet limit (M1)
      notBefore, notAfter                       // expiry, see owner question Q3
    })
    ```
  - `wallets` is the list itself, not a hash of it (M1). The moderation service checks membership by hashing the attested address. Addresses never reach the moderation service through the delegation, only their hashes.
- **When the owner changes a member's caps, sides or wallets, or adds a payout wallet the member should use:** a new delegation with a higher `seq` replaces the old one. A wallet the owner adds is not usable by members until the next delegation; the owner's own trades are not affected.
- **Renewal (M4):**
  - On every app open, if a delegation is within 7 days of `notAfter`, the owner's device re-signs it silently, with no confirm-it's-you: same content, new dates, `seq + 1`.
  - Renewal **never widens scope**. The device re-signs exactly the stored delegation's caps, sides and wallets, minus any wallet the owner has since removed.
  - It does **not** run for a member who is removed, being removed (a `DELETE` queued or in flight), or revoked. The device reads the member list first, and the moderation service refuses any delegation for a revoked `memberId`, whatever its `seq` (a re-added member gets a new `memberId`).
  - If the owner stays away until `notAfter`, the member can no longer *start* trades. Trades already in flight are unaffected.
- **Nothing per trade**, except a trade above the member's cap (Option B path). The owner can be offline for every step of every trade inside the caps.

#### 2.1.3 Slot bindings (every account slot, I1)

Every device that registers a trade identity for an account whose key is pinned also sends a **slot binding**:
```
x2f/slot-binding/v1\0 + account + \0 + code + \0 + role + \0 + signPublic + boxPublic + \0 + by
```
Here `by` is `owner` (the binding is signed with the account key K) or `member:<memberId>:<delegationSeq>` (signed with that member key).

- `POST /v1/trades/:code/identity` sends the normal `{signPublic, boxPublic, proof}` plus `{binding}`, and for a member `{delegation}`. The API checks them (an early `CantDoThat`), and the moderation service checks them again (below).
- For a member's trade, from then on the runtime runs unchanged on the member's device: securing, funding display, "I've paid", release, co-signing a mutual cancel, the buyer's standing release co-sign, and the auto-refund and lapse paths.

**The attestation names each slot's account.**
- The terms gain `buyerAccount` and `sellerAccount` (public Trade Tags; spec 6.1: Trade Tags are public and burned forever, never reused).
- Each trader app's `verifyAttestation` checks that:
  - its own slot names its own account;
  - the other slot names the counterpart it confirmed at take or accept, from `ConfirmedTrade`, never from the attestation. A failure is `wrong-terms`.
- Without this, a compromised API could tell the moderation service the slot belongs to some unpinned account Y while showing the counterparty "X", and the binding check would never run. With it, the API must name X to the moderation service, and X's pin then demands a binding.
- This is a format change. The terms' exact key set grows, which needs a version bump or a deploy order where moderation and both apps update together. Section 5 notes it. The review's "attestation format unchanged" no longer holds (section 6).

#### 2.1.4 What the moderation service checks (new, in `checkWork`)

For each trader slot, the moderation service resolves the slot's account by the Trade Tag in the work item:
- **Account without a pin in force** (none, pending or contested): the slot is attested unbound, as today (the 1.1 residual). But if the work item says the slot is a member's, it is refused.
- **Account with a pin in force:** the slot is attested only if:
  1. a binding is present and verifies, under K for `by: owner`, or under the delegation's member key for `by: member`, for this account, code, role and these trade keys.

  And for `by: member`, also:

  2. the account's **pinned** K verifies the delegation;
  3. the delegation is the newest `seq` the service has seen for that member, and its `seq` equals the binding's;
  4. `notBefore ≤ now < notAfter`;
  5. the `memberId` is not on the revocation list;
  6. the role is in `sides`;
  7. `takeAmountAtomic ≤ perTradeAtomic`;
  8. the member's counted amount in the last 24 h, plus this one, stays at or under `per24hAtomic` (M3);
  9. the member's open trades stay under `openTrades` (M3);
  10. `sha256` of the account's own address in the terms (`buyerPayout` for a buyer slot, `sellerRefund` for a seller slot) is in the delegation's `wallets` (M1);
  11. the owner's `lastSeenByKey` is less than `notAfter − notBefore` old (M2: 30 days by default). A member cannot keep starting trades whose handover copies no owner device has proven it can open.

Any failure is a final `AttestRefused('bad-binding')` or `AttestRefused('bad-delegation')`. The trade then never funds, and the API cancels it at setup timeout, as for any refusal today.

**Counters (M3).**
- The service keeps its own `member_attested(account, member_id, code, amount, at, ended_at, funded)`.
- **Open trades:** a trade counts from attestation until the API reports it ended (closed, cancelled or setup timeout).
- **24 h total:** every attested trade counts, **except** one the API reports cancelled before the escrow was funded (setup timeout or a walk-away before funding). So a counterparty who abandons setups cannot lock a member out.
- The service takes the API's word only for "ended" and "never funded". A compromised API that lies here can only let a member go over the caps, which also needs a malicious member. It cannot add a member, add a wallet or move coins.
- The revocation list is the service's own. **The API can only add revocations.**

#### 2.1.5 What the counterparty sees and checks

- **One new check, no new data about members.** The counterparty's app also checks the other slot's account name (2.1.3). Otherwise the attestation is as before: three participant slots, terms and channels.
- The account's slot holds per-trade keys, which are fresh each trade. So the counterparty cannot link two trades to the same member, or tell a member's trade from the owner's by the keys.
- The counterparty's guarantee is still "the moderation service vouches for the other slot". The service now checks, before vouching, that the account itself allowed this key.
- The only member-visible data is the spec 6.7 chat label "Message from Team <account Trade Tag> member: <member name>". The delegation, the member's key, its id, its login name and its caps never leave the API and the moderation service.

#### 2.1.6 Revocation, handover and takeover

**Revocation (member removed, role or caps cut, device lost)**
- **New trades:** `DELETE /v1/team/members/:id` (Task 18) also:
  - posts a revocation to the moderation service (`{account, memberId, at}`). It needs no owner signature, because revoking can only take power away;
  - drops the member's live sessions (exists).
  - From that moment, any slot not yet attested for that member is refused.

**Trades in flight: the handover copy (I4: X2F's server keeps it)**
- After every persist of a member trade's `EscrowRecord` (trade identity secrets, `PartyState`, the wallet password and the resume fields), the member's escrow worker seals the record to the account key's X25519 half (`crypto_box_seal`). It uploads it with `PUT /v1/trades/:code/handover` and `{epoch, blob}`.
  - The member's device learns K's public half from its own delegation's signer, and checks it against the moderation-signed `KeyStatus`. A compromised API therefore cannot get copies sealed to a key of its own.
- The upload happens before any signing step goes out (write-ahead). If it fails, signing waits.
- **The copy lives on X2F's server, not on the owner's phone.** X2F stores ciphertext it cannot open: only an owner device (any of them, since all hold K) can open it. It is deleted when the trade closes and its settle transaction has 10 confirmations, and never later than the R36 purge.
- This is new key material held by X2F, as ciphertext only. Spec 8's "keys never leave the device" and the 4.1 / R36 retention list must say so (section 5).
- **A member's device never downloads or imports a handover copy.** Only an owner device does.

**Takeover**
- When the owner removes a member, the ConfirmSheet lists that member's open trades: "These 2 trades move to your device." The same applies when the owner taps "Move Aurora's trades to this device" (for a lost phone).
- The owner's device downloads each blob, opens it with K, checks that it is for that trade, and checks that its identity matches the attested slot (`verifyAttestation` with the record's own keys and the account name). It imports the copy **only if it has no local record for that trade** (a local record always wins).
- **The nonce rule for an imported copy (I3, extends R26 across devices).** It is enforced on the importing device itself, **not** by the lease:
  1. On import, the device **discards** the copy's exported multisig state (the nonces), any built tx set, and any half-done co-sign (`cosigning`). It keeps the identity, the multisig party key, the password and the trade facts.
  2. The only signed thing it may keep is a **fully signed** transaction (`signed`). It may resubmit that unchanged, which signs nothing new.
  3. Before any co-sign, the device runs a **fresh** `exportState`/`importState` round as attempt `n+1` (the party protocol's attempt numbers already make the counterpart follow the higher attempt and re-export, rulings Task 6 notes). So the owner's device only ever signs with nonces it made itself.
  4. Because the member's device never imports anything (above), each nonce set lives on exactly one device. Two devices signing at once can then produce two transactions, of which at most one confirms, but never two signatures from the same nonces. So the key share cannot leak, whatever the API does with the lease.
- The device then calls `POST /v1/trades/:code/holder {to: 'owner'}`. That moves the trade's **holder lease** (`trades.escrow_holder`, `holder_epoch + 1`).
- The member's device, on seeing a higher `holder_epoch` (from the API, or because the counterpart has moved to an attempt it did not start), **stops that trade for good**: it marks the local record `handedOver` and never signs for it again, even if the lease later appears to move back.
- The trade continues on the owner's device with the same per-trade keys. The counterparty sees no change, except one fresh attempt round.

**The holder lease** is now an **availability** tool only. It makes two honest devices take turns, so they don't race and waste attempts.
- The runtime fetches it before each signing round and does not start a round unless it is the holder at the current epoch.
- **What a lease move can do:** stall a trade, or (an honest move during a takeover while the member's phone is online mid-round) let both devices run a round. **What it cannot do:** make any device sign twice from the same nonces. The import rule and the never-import rule guarantee that on the devices themselves.
- A malicious member's device ignores the lease, of course. That is covered under "What revocation cannot do" below.

**What revocation cannot do**
- A removed *malicious* member still has a copy of the per-trade keys for trades that were in flight. No multisig key can be rotated without moving the funds.
- That member can therefore still co-sign, with the counterparty, any outcome the counterparty also signs. For a seller-side trade, that means releasing to the counterparty early.
- This exposure is bounded by `perTradeAtomic × openTrades`, and is limited to trades in flight at removal.
- It is the same power the member had the minute before removal, and the caps exist for it.

#### 2.1.7 Limits (caps)

- `perTradeAtomic`, `per24hAtomic` and `openTrades`, per member, are set by the owner. The API checks them at take (an early `CantDoThat`), and the moderation service enforces them (the real check, 2.1.4). See owner question Q4 for the defaults.
- **`sides` is the release control (I4).**
  - A member who may act as seller holds the seller key, and can release with the buyer alone. A normal release is seller + buyer, so the moderation service never sees it, and no toggle can stop a modified client.
  - The owner's real choice is therefore which sides a member may take: buyer only, seller only, or both. That is enforced at attestation (check 6).
  - The earlier "Can release coins as seller" toggle is **dropped**. Kept as an app-side setting, it would have looked like a control while not being one.
- **Above the cap: per-trade owner approval** (option B as an opt-in path).
  - The member can still take a trade above their cap. It then waits for an owner device to sign a one-trade delegation for it (`caps.perTradeAtomic` = that amount, `notAfter` = take + setup window).
  - It may ship after launch (M5): the smallest launch slice refuses above-cap takes.
- The account-wide limits that already exist (R42 hold, bans, liens, Plan 5 limits) apply to members first, as in Task 18.

#### 2.1.8 Audit log entries

Entries go in `team_audit`, in the same transaction, under new action names. Owner rows have `member_id null`. Task 18 logs no owner actions, but these key events are security events, so this is a new lead default (Q8):
- `account-key-registered` (owner), `account-key-device-added` (owner; device label), `account-key-vetoed` (owner), `account-key-reset` (owner; 2.1.10), `account-key-contested` (system)
- `delegation-signed` (owner; detail: memberId, seq, caps, sides, wallet count, notAfter), `delegation-renewed` (owner; seq only), `delegation-revoked` (owner, or `system` when expiry ends it)
- `member-identity-registered` (member; trade code, role)
- `escrow-funded-seen` (member; trade code), `release-signed` (member), `refund-cosigned` (member; kind: mutual-cancel, buyer-cancel or lapse-refund)
- `handover-stale` (system; the member's blob is older than the last relay activity by more than N minutes, a sign that something is wrong; shown to the owner)
- `trade-taken-over` (owner; trade code, from memberId)
- `member-cap-refused` (member; trade code, which cap): the attempt that the API or moderation refused

The detail holds ids, amounts and caps only. Never keys, blobs or addresses (as in Task 18). Trade codes are cleared at the R36 purge (Task 18 M5).

#### 2.1.9 Failure modes

| Case | What happens |
|---|---|
| Member's phone lost or broken | The owner taps "Move Aurora's trades to this device". Each blob is opened and imported under the nonce rule (2.1.6), the lease moves, and the trades continue. A blob that is stale by one round is fine: the import discards the round anyway and starts a fresh attempt. If there is no blob at all (setup never finished), the trade has not funded and is cancelled at setup timeout. |
| Member's phone stolen | Same as lost. The thief also needs the member's two-factor login to reach the API, and the escrow store is wrapped by a non-extractable key. The owner removes the member, which revokes new trades and lets the owner take over the open ones. |
| Malicious member | Possible: releasing early as seller to a colluding buyer (only with the seller side), co-signing a mutual cancel as buyer after the owner paid fiat, marking paid without paying, leaking chats. Bounded by the caps and `sides`. Every step the member's device reports is in the audit log; a modified client can skip reporting, but cannot get past the attestation checks. |
| Compromised API (I1) | **Cannot trade as an account with a pinned key**, as owner or member: every slot of a pinned account needs a binding under K, or under a member key that K delegated, checked at the moderation service, and the attestation names the account. **Cannot add a member key:** it would need a delegation under K. **Cannot slip its key in at approval:** the 6-digit comparison. **Cannot raise caps or add a payout wallet:** both are inside the signed delegation. **Cannot read handover blobs:** they are sealed to K, and the member checks K against `KeyStatus`. **Cannot swap the account's address:** `wallets`. **Can:** refuse service, revoke members (fail closed), move the lease (which stalls a trade, 2.1.6), misreport "ended" or "never funded" (caps only, 2.1.4), falsify its own audit log (an existing limitation), and **trade as an account that has no pin in force** (today's residual, 1.1; it shrinks as owners open the app after the update). |
| Compromised API at key registration (I2) | It can register a hostile K for an account. That K is pending for 72 h, and any owner device that opens in that time sees it in the moderation-signed `KeyStatus` and vetoes it, or contests it if there is no pin. If no owner device opens during the hold, the hostile pin takes effect, and the owner finds out on the next open and goes through support (contested). Stated as a residual in 2.1.1. |
| Compromised moderation service | As today: it can already attest anything. This design adds nothing an attacker could use against it, and moves nothing into it that it does not see already (wallet hashes, not addresses). |
| One owner device lost | Nothing is lost: every approved owner device holds K. Remove the lost device (Devices list, which exists); K stays, because the thief would also need the login. If the owner fears K itself is exposed, rotate (2.1.10). |
| Every owner device lost (M2) | Members keep starting trades only while `lastSeenByKey` is under 30 days old (check 11), then stop. Trades already in flight continue on the members' devices. New handover blobs are sealed to a K no device holds, so a member who also loses a phone strands that trade until the dispute path. The owner's Team page (once restored) and each member's Active-trades row show "Owner backup can't be opened" when `lastSeenByKey` is over 7 days old. The owner restores with a reset (2.1.10), which voids every delegation. |

#### 2.1.10 Account-key change

- **Rotation from a live owner device:** the new key is signed by the old one. It takes effect at once, with a push to every owner device. Delegations stay valid only if re-signed by the new key: the rotating device re-signs them in the same step.
- **Reset with every copy of the old key lost:**
  - It is an R42 *security change*: a strong login or the 24 h hold, a push to every device, and confirm-it's-you.
  - The moderation service accepts the new pin only `ACCOUNT_KEY_HOLD_H = 72` hours after the request (the same hold as a first registration), and only if no veto signed by the old key cancels it. Any surviving owner device that opens sees the pending reset in `KeyStatus` (2.1.1).
  - While the reset is pending, the old pin stays in force. Owner slots therefore need a binding the owner can no longer make, so **the owner cannot trade for up to 72 h** (Q10). Members keep their delegations until the reset takes effect.
  - Every delegation under the old key dies at the reset, and members must be re-approved.
  - Blobs sealed to the old key are lost. That only matters if a member also loses a phone in the same window; the fallback is the dispute path (2.1.12).

#### 2.1.11 UX steps

Every refusal uses Task 21's CantDoThat, and all copy is `// COPY-UNSIGNED`.
1. **Every owner, after the update (existing accounts) or at sign-up (new):** silently, on the first full login: "Your account now has a signing key on this device. Team trading can start in 72 h." There is no extra step. A second owner device gets the key at its new-device approval, with the 6-digit code shown on both screens.
2. **Owner, first member:**
   - Settings → Team → Invite (Task 18).
   - "Your members' trades are backed up to your devices through X2F's server, encrypted so only your devices can open them."
3. **Member joins** (Task 18 flow). The last step makes the member key and shows a 6-digit code: "Tell <owner name> this code when they approve you."
4. **Owner approves:**
   - The push opens the sheet "Approve Aurora for trades": "Does Aurora see 482 913?" Then the caps (prefilled), the sides ("Buy", "Sell", or both: "Selling means Aurora can release your coins"), and the payout wallets (all of the owner's by default).
   - One tap plus confirm-it's-you.
5. **Member trades:** the normal take/accept sheet. The room is the same as the owner's. Above the cap, refused at launch ("This trade is above your limit"); with above-cap approval later: "<owner name> must approve it." The owner gets a push, and one tap on an owner device signs a one-trade delegation.
6. **Owner watches:** each row in Active trades shows "Aurora · backup up to date" (or "backup N min old").
7. **Remove or lost device:**
   - Team → Aurora → Remove (or "Move her trades to this phone").
   - The sheet lists open trades and amounts, then: confirm-it's-you, import, done.
   - Copy for the malicious case: "Aurora's phone still has a copy of the keys for these trades until they finish."
8. **Security alert** (2.1.1): "Someone is setting up a signing key for your account that is not from your devices." Buttons: "This wasn't me" (veto or contest) and "Details".

#### 2.1.12 Without the handover copy ("A-lite")

A-lite is possible, but I do not recommend it. If a member's device is lost, the coins in their trades can then only move with the moderator:
- If the counterparty paid: the dispute path, moderator + counterparty.
- **If the account is the seller and the buyer never paid, the only way back to the seller's refund address is the buyer's signature (with the moderator's).** An unpaid buyer has no reason to give it.

The handover copy closes that gap. It costs one sealed upload per state change.

#### 2.1.13 Build size (Option A)

Four build tasks, about 3,800 lines with tests (Task 18 was about 3,000).
- **42a-0: account key and bound slots** (closes 1.1 for owner trades; can land before members):
  - `packages/trade/src/accountKey.ts`: registration, `KeyStatus`, slot binding, the comparison code, canonical bytes, and their tests. `attestation.ts`: `buyerAccount`/`sellerAccount` in the terms, and the checks in `verifyAttestation`.
  - `apps/moderation`: a new `keys.ts` (pending/pinned/contested, 72 h hold, veto, status statements) and the binding check in `checkWork` for owner slots.
  - API migration (next free number): `account_keys`, `key_status_requests`. Routes `POST /v1/account/key`, `POST /v1/account/key/status`, `POST /v1/account/key/veto`.
  - Web: `apps/web/src/account/key.ts` (worker side, `x2f-account-key` store), the status check on open and the alert, the key copy at new-device approval with the comparison code, and the owner's binding in `runtime.ts`.
- **42a: delegation and member signing** (lifts `member-cannot-sign` and I2(a)):
  - `packages/trade/src/delegation.ts`: types, canonical bytes, `delegationValid`, wallet membership, and their tests.
  - `apps/moderation`: delegations, revocations, counters (`member_attested`) and checks 2-11.
  - API: `member_delegations`, `member_revocations`, `trade_identities.member_id`, `trades.escrow_holder`/`holder_epoch`. Routes `PUT /v1/team/members/:id/delegation` and `GET /v1/team/delegation` (member). `apps/api/src/trades/identity.ts`: the member path. `take.ts`: the cap pre-check, refusal removed.
  - Web: member key, the comparison code at join and approval, the owner's Approve sheet, silent renewal (2.1.2 rules), and the member's binding.
  - Push to a member device for the trades it holds. This completes Task 18 I1: member push subscriptions, owner-only for everything else.
- **42b: handover, lease and takeover:**
  - `runtime.ts` and `worker.ts`: the write-ahead sealed upload, the lease check before each round, the **import nonce rule** (2.1.6), and the member's `handedOver` stop.
  - API: `PUT|GET /v1/trades/:code/handover`, `POST /v1/trades/:code/holder`, and the blob purge in the R36 jobs.
  - Web: the takeover screen, the remove sheet listing trades, the Active-trades backup age, and "Owner backup can't be opened".
  - The account-key reset with the hold.
  - **Tests:** an imported copy never signs from its exported nonces (a fake engine records nonce ids; the import plus a co-sign must show a fresh export); a member device that sees a higher epoch never signs again; two devices running at once never sign twice from one nonce set.
- **42c: limits, audit and e2e:**
  - Caps UI, above-cap approval (may come after launch), the audit actions above, the copy.
  - `apps/web/e2e/teamTrade.spec.ts`:
    - a member takes, secures and releases as seller with the owner's context closed;
    - a member is removed mid-trade, and the owner takes over and releases;
    - a delegation forged by the API → attestation refused;
    - an owner slot without a binding for a pinned account → refused;
    - a slot labelled as another account → the counterparty's `wrong-terms`.
  - Tripwire `NEEDS_PLAN3_TASK42_MEMBER_KEY` retired.
- **Review:** a security review of 42a-0, 42a and 42b against spec 3.1, 3.3 and R26, separate from the code review (R44 asks for it). Its checklist must include:
  - the account-slot binding and the account name in the attestation (I1);
  - the pin bootstrap, the hold, the veto, contested accounts and the comparison code (I2);
  - the import nonce rule and the never-import rule (I3).

### 2.2 Option B: per-trade owner approval (the member works the trade, the owner's device authorises each one)

In one line: the same per-trade keys on the member's device as in A, but the delegation is for one trade only. The owner's device signs it when the member takes, so the owner must be reachable at every take.

- **Key custody:**
  - Per-trade keys on the member's device, the account key on the owner's devices, and member keys, all as in A (including 2.1.1's pin, check and comparison code).
  - There is no standing delegation. Each trade carries `TradeAuthorisation {code, memberId, memberKey, role, takeAmountAtomic, wallets, notAfter = take + setup window}`, signed by K.
- **Owner's device:**
  - Online within the setup window (minutes) of every member take: a push, then "Aurora wants to take MX-4F2Q: sell 0.8 XMR for 120 EUR. Allow?", then one tap.
  - After that, the owner can be offline for the rest of the trade (paid, release, cancels).
- **Revocation:** there is nothing standing to revoke. Removal cancels pending approvals. In-flight trades work as in A (handover copy and takeover), or A-lite.
- **Counterparty and moderation service:** the counterparty checks the account name, as in A. The moderation service checks the authorisation instead of a delegation, which is simpler: no counters, because each trade is approved by hand.
- **Limits:** the owner decides each trade, so caps are unnecessary but can still apply.
- **Audit:** `trade-authorised` (owner) and `trade-authorisation-expired` replace the delegation rows. The rest is as in A.
- **Failure modes:**
  - An owner who is asleep makes the member's take time out. The counterparty sees a setup timeout, which is a cancelled trade on the account's record.
  - Malicious member: bounded to the trades the owner approved.
  - Compromised API: as in A.
- **UX:** the member's take shows "Waiting for <owner name> to allow this trade (up to N min)". This is poor for the taker on the other side, who waits too.
- **Build size:** about 70% of A. No counters or renewal, but the same account key, handover and lease work.
- **Verdict:** it does **not** meet the brief ("without the owner's device being online"). It is the right path for **trades above a member's cap**, so A includes it.

### 2.3 Option C: owner-held keys, the member as operator only ("team signer")

In one line: every escrow key lives on an owner device that stays online (a desktop tab or a phone on a charger, "Team signer mode"). The member's app only drives the UI and sends signed requests to it over the relay. The signer acts within policy.

- **Key custody:** the per-trade keys are on the owner's signer device only. The member holds a member key, used only to sign requests. Members never hold an escrow key.
- **Owner's device:** must be **always online** (the signer). Policy is set once: caps, sides, and "auto-release when the member asks".
- **Revocation:** instant and complete. The signer stops obeying the member's key. There are no copies of keys to worry about.
- **Counterparty and moderation service:** nothing new. The owner's device is the party, exactly as today. The moderation service needs no change (but 1.1's residual stays unless 42a-0 is built anyway).
- **Limits:** the signer enforces caps, and they are local.
- **Audit:** the signer writes the rows, from member requests (`release-requested`, `release-signed`).
- **Failure modes:**
  - The signer is a single hot point holding every open trade's keys.
  - If the signer is offline (a sleeping phone, a browser that suspends background tabs: Phase 0's first lesson), every member trade stalls. Releases miss their window, and trades drift into disputes.
  - A malicious member is bounded by the policy. But "release when the member asks" is the same power as in A, because the signer cannot see whether fiat arrived.
  - Compromised API: cannot do more than today.
- **UX:** the member's taps wait on the signer. The owner must keep a device awake. iOS Safari and Android background limits make "always online" unreliable on a phone.
- **Build size:** about 60% of A. There is no delegation crypto in the moderation service, but there is a request protocol over the relay and a signer mode in the web app. Its runtime reliability is the hard part, and it cannot be fully fixed in a PWA.
- **Verdict:** it keeps the cleanest custody, but **fails the brief** (an owner device must be online) and is fragile on phones. A possible later "business desktop" mode, not for launch.

### 2.4 Rejected outright

- **Split the account's key between owner and member** (owner + member must both sign for the seller side). Monero multisig has no threshold inside one party. 2-of-4 would let owner + member move funds with no counterparty (one party holding two keys). 3-of-4 would make every release need owner, member and counterparty, so the owner is online again. Both break 3.1's table.
- **An X2F-held member key, or a server-side signer for teams.** X2F would hold two keys: custodial, and forbidden by 3.1 ("No automatic third key").

## 3. Recommendation: Option A, with B for trades above the cap

**Choose Option A: an account key that binds every account slot, owner-signed delegations for members, both checked by the moderation service, plus the sealed handover copy. Use Option B's per-trade approval only for a take above the member's cap.**

Why:
1. **It meets the brief.** The owner's device is needed once per member, and again only to change caps or approve an above-cap trade. Renewal happens silently on any open. It is never needed per step.
2. **3.1 holds, and the account's slot is protected against a compromised API, for members and for the owner.**
   - X2F still holds only the moderator key.
   - **Covered:** for an account whose key is pinned, the API cannot put a key of its own into that account's slot, whether labelled owner or member. Every slot needs a binding under K, or under a member key that K delegated, and the moderation service checks it. The attestation names the account, so the API cannot dodge the check by mislabelling the slot. The scope of a member (caps, sides, payout wallets) is inside K's signature.
   - **Covered with a stated residual:** pinning K needs a 72 h hold that any owner device can veto. An owner who opens no device during the hold can have a hostile key pinned, and finds out on the next open.
   - **Not covered:** accounts with no pin in force (owners who have not opened the app since the update) stay in today's residual (1.1). The client bundle served by a compromised server is Plan 6's tamper defence, as before.
   - Today's defence was "the real party's device notices a swap". It becomes "the account's own key says who may be the party, and the moderation service, not the API, checks it".
3. **The counterparty's view and privacy barely change.** There is one new check: the account name, which it already knows. The per-trade keys are fresh, so members cannot be linked across trades. Only the spec's chat label shows.
4. **Members leaving or losing a phone does not strand coins.** The handover copy lets any owner device continue any member trade, and X2F cannot open it. A-lite would leave "seller, buyer never paid, member phone gone" stuck on the counterparty's goodwill.
5. **The residual risk is the one the owner is choosing:** a member can do with a trade what the owner could, on the sides and within the caps the owner sets. It is visible in the audit log, and it cannot be fixed cryptographically, because "member completes trades" means exactly that.

**Smallest launch slice, if time is short:** 42a-0, 42a, and the takeover part of 42b, with its nonce rule. Defaults: no above-cap approval (above-cap takes are refused), and `sides` both.

## 4. Owner questions this raises

1. **Q1. Approve each member's phone?** Each member device needs your one-time approval before it can trade. You compare a 6-digit code with the member (in person or by a call), then tap Approve. A member who changes phones waits for you again. *Lead recommends yes:* it is the only thing that stops a compromised server adding a "member".
2. **Q2. Which sides may a member trade?** May a member SELL for your account, or buy only? A member who sells holds the seller's key, so they can release your coins to the buyer. X2F can enforce "buy only" or "sell only", but not "sell, but never release": a seller must be able to release. *Lead default:* both sides, with limits.
3. **Q3. How long does an approval last** without the owner opening the app? *Lead default:* 30 days, renewed silently whenever any of the owner's devices opens X2F. After that, members can finish open trades but not start new ones.
4. **Q4. Default limits per member:**
   - per-trade maximum,
   - per-24-hour total,
   - open trades at once.

   *Lead proposal:* 2 XMR per trade, 5 XMR per 24 h, 3 open trades (the owner can raise or lower each). Should a member be able to ask for a one-off approval above the limit (owner taps Allow), or should it be refused? *Lead default:* yes, but that part may come after launch; until then, trades above the limit are refused.
5. **Q5. Funding as seller: whose coins?** When the account sells, the escrow must be funded from a Monero wallet. Does the member fund from a wallet the owner gives them (outside X2F), or does the app send the funding request (QR or link) to the owner? Funding needs no escrow key, so either works. *Lead default:* the member sees the QR as today, plus a "Send to <owner>" share. X2F never holds or moves the owner's coins.
6. **Q6. Backup copy of member trades.** X2F's server keeps an encrypted copy of each member trade's keys. Only your devices can open it, and X2F cannot. It is deleted when the trade ends. This lets you finish a trade when a member leaves or loses a phone. Is that acceptable? *Lead recommends yes:* without it, a lost member phone can leave coins waiting on the other trader's goodwill or a moderator.
7. **Q7. A removed member keeps a copy.** A removed member's phone keeps the keys of trades open at removal until those trades finish, and a dishonest member could still co-sign with the counterparty on them. This cannot be prevented, only capped. Is the copy for the confirm sheet acceptable ("Aurora's phone still has a copy of the keys for these trades until they finish")?
8. **Q8. Log the owner's key actions?** The owner's own security actions (account key set up, member approved or renewed, trades taken over) would appear in the team audit log. Today the log has member actions only. *Lead default:* yes.
9. **Q9. Can members get pushes?** Members need push notifications for the trades they run; today pushes are owner-only. *Lead default:* a member's device gets pushes only for trades it holds, and the owner still gets every one.
10. **Q10. Your account's signing key.** Every account gets a signing key on the owner's devices. It is what stops a hacked X2F server from trading in your name.
    - Setting it up, or replacing it after losing every device, takes effect only after **72 hours**. During that time, any of your devices that opens X2F can block it.
    - A new device of yours gets the key when you approve it from a device you already have, comparing a 6-digit code.
    - If you lose every device, you cannot trade for up to 72 h, and your members need re-approval.

    Is 72 h right (a weekend away)? *Lead default:* yes, 72 h.

## 5. Notes for the plan

- Plan 3 Task 42's "Release and signing: refused for members" and the lead default "funding as seller is refused the same way" are replaced by 42a-0 and 42a–42c once the owner answers Q1–Q6 and Q10.
- Until then, Task 18's I2(a) refusal and `NEEDS_PLAN3_TASK42_MEMBER_KEY` stay.
- **1.1's residual, recorded now:**
  - Add it to `docs/security/plan-3-review.md` (Task 33 Step 3): "a compromised API can trade as any account in a slot that account's devices never see: one key only, no custody break; closed for pinned accounts by Task 42a-0".
  - Add to spec 3.3: "Known limit until Task 42a-0: the moderation service does not yet check which account a slot belongs to."
  - Plan 6 D20 (device-key TOFU) is superseded by 42a-0, so mark it there.
- **Spec 6.7 and R44:** the OPEN line and R44's "until a per-member escrow key scheme is designed and reviewed" become "designed (`docs/superpowers/specs/2026-10-30-task42-member-escrow-keys.md`); built in Task 42a-0 and 42a–c; security review required". R44's text then reads:

  > R44 (owner, 2026-10-29c; scheme 2026-10-30): team members, at most 3 per account, act only within their roles (Offers, Trades); every member action with an effect is written to the account owner's audit log in the same transaction; a member's chat messages carry the label "Message from Team <account Trade Tag> member: <member name>". X2F still holds at most one key per trade (spec 3.1): a member's device may fill the account's slot only under a delegation signed by the account key and checked by the moderation service (Task 42); the API can revoke but never grant. Payout wallets, members and account deletion stay owner-only; members always log in with two factors.
- **Spec 3.3** gains one bullet: "Every account slot is bound to the account: the moderation service attests a slot of an account whose key is pinned only with a binding under the account key, or under a member key that the account key delegated. The attestation names each slot's account, and each app checks it. The account key is pinned after a 72 h hold that any owner device can veto. The API can revoke but never grant."
- **Spec 8**, the "Escrow keys" row: "keys never leave the device" becomes "keys never leave the device unencrypted; a member trade's keys are also kept on X2F's server, sealed to the account key, until the trade ends (Task 42)".
- **Spec 4.1 and R36:** add the handover copies to the retention list: deleted at close plus 10 confirmations, never later than the R36 purge.
- **R26** gains: "Across devices (Task 42): a device that imports another device's saved trade never signs from its saved nonces. It discards the export and any half-done co-sign, keeps only a fully signed tx to resubmit, and runs a fresh export round first. The device that saved it never imports anything back."
- **Spec 6.3, new-device approval:** for a device that will receive the account key, the 2-digit number matching becomes the 6-digit commit-then-reveal comparison code.
- **The attestation format change** (terms gain `buyerAccount`, `sellerAccount`) needs a deploy order (moderation and web together) or a terms version. 42a-0's plan must name which.
- **42a-0's and 42a's security review** covers I1 (account-slot binding, account name in the attestation) and I2 (pin bootstrap, hold, veto, contested, comparison code). **42b's** covers I3 (import nonce rule, never-import, `handedOver`).
- The fee-for-team-members idea (owner 13:58, open) is independent of this design.

## 6. Review response (claude2, 2026-10-30, CHANGES REQUIRED)

- **I1 (account slots unbound): accepted, fixed with the review's option (a).**
  - Every account slot is bound by the account key (2.1.3, 2.1.4), and the "Compromised API" row and recommendation point 2 now say what is and is not covered.
  - Two corrections to the framing, which both the draft and the review shared:
    - (1) The gap on the main line gives an API-only breach **one** key, not two: the moderator key is in a separate process. So it is an impersonation residual, accepted in Plan 3 OD-1/X-5 and Plan 6 D20, not a 3.1 custody break (assessment in 1.1).
    - (2) Binding slots in the moderation service is not enough on its own. The API also tells the moderation service which account a slot belongs to, so it could label the slot as an unpinned account and skip the check. The attestation therefore now names each slot's account, and each app checks it. So the review's "attestation format unchanged" no longer holds.
- **I2 (team-key pin is trust on first use): accepted.**
  - The fix is the 72 h hold, the nonce-bound moderation-signed `KeyStatus` check on every owner and member device, the veto, and a contested state that fails closed (2.1.1).
  - The residual is stated, and so is the migration.
  - "Confirm-it's-you" alone was not used, because the API verifies it and supplies the credential's key.
  - Found while fixing: approval of a member device (and of a new owner device) carried the new key through the API, so a compromised API could get its own key delegated. Approvals now use a 6-digit commit-then-reveal comparison code.
- **I3 (lease as the only nonce guard): accepted.**
  - Fixed on the devices: an imported copy discards its nonces and runs a fresh attempt, a member device never imports, and it stops for good at a higher epoch (2.1.6).
  - The lease is now described as availability only.
  - R26's cross-device text is in section 5, and 42b's tests and review checklist name it.
- **I4 (q14 b and f overpromise): accepted.**
  - The "release as seller" toggle is dropped. `sides` is the enforced control (2.1.7), and Q2 is reworded.
  - Q6 now says that X2F's server keeps the encrypted copy.
  - The spec 8 and 4.1 edits are in section 5.
- **M1:** `wallets` is the sorted list of hashes, checked by membership (2.1.2, check 10).
- **M2:** every owner device holds K, so one lost device loses nothing. With every device lost, members stop at 30 days through `lastSeenByKey` (check 11), and the app shows "Owner backup can't be opened" after 7 days (failure table).
- **M3:** the open count frees at end. The 24 h total excludes setups cancelled before funding. The API's word is taken only for those, and the bound on lying is stated (2.1.4).
- **M4:** renewal never widens scope, and skips removed, being-removed and revoked members. The moderation service refuses delegations for a revoked `memberId` (2.1.2).
- **M5:** Q4 and 2.1.7 say that above-limit approval may come after launch.
- **M6:** section 5 has the R44 text, the spec 8, 4.1, 3.3 and 6.3 edits, the R26 extension, and the review scope for I1, I2 and I3.
- **No finding rejected.**
