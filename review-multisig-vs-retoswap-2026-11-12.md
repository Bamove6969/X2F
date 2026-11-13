# Review: X2F multisig setup, arbitrator identity and payouts vs the RetoSwap/Haveno 2026 exploits (12 Nov 2026)

**Reviewer:** independent helper, read-only. **Code:** main `4f0afa14`, read from a `git archive` export (no worktree touched, nothing committed, nothing pushed). **Tests:** none run. The sketches below are written out but not executed. The escrow suites need monerod, which the brief says to avoid.

**Sources read:**
- Halborn, "Explained: the RetoSwap hack (May 2026)". It gives few technical details. A spoofed ACK "designed to look like it originated from the platform's arbitrator" was accepted "without validation", and the protocol "registered the sender's address as the official arbitrator for the trade". The attacker already held one key as maker or taker, so this gave them 2 of 3.
- Haveno release notes, 1.8.0 to 1.12.0 (github.com/haveno-dex/haveno/releases). The items are mapped in section 3.
- The comms summary, research-monero-connect-broad-2026-11-12.md, section 4.

## Verdict

**X2F is not exposed to the RetoSwap attack class. I found no blocking finding.**

A trader cannot submit the moderator's multisig messages, have them relayed as the moderator's, or choose the moderator's key:
- Every escrow message is an Ed25519-signed envelope. The sender's role comes from the signature checked against a fixed participant list, never from the frame.
- That participant list is a moderation-signed attestation that every trader app checks against a key built into the app.
- The moderator's per-trade identity is created inside the moderation service. The API and the traders never supply it.

On top of that, each party derives the escrow address itself, all three must confirm the same address before anyone funds, equivocation is caught by digest echoes, and every co-signer checks the tx set against payouts it derived itself before it signs.

What remains:
1. **One major architectural point.** The whole RetoSwap defence rests on a single online signing key, which also does three other jobs (F1).
2. **One major gate for Plan 4.** The ruling path is disabled today, and it must not ship without the Haveno 1.8.0/1.9.0 dispute hardening (F2).
3. **Three minor items:** no explicit 2-of-3 shape check (F3), a fee ceiling that is absolute rather than relative to the trade (F4), and no key rotation or revocation (F5).
4. **Info items** in section 4.

## 1. Mapping the attack onto X2F

| RetoSwap/Haveno failure | X2F mechanism | Where |
|---|---|---|
| Unauthenticated ACK names the arbitrator | No message can assign a role. Roles and keys are fixed before setup by the moderation-signed attestation, verified with the key built into the app, and kept on the device once it verifies. | packages/trade/src/attestation.ts:260-313; apps/web/src/escrow/runtime.ts:565-635; apps/web/src/escrow/worker.ts:125 |
| Sender of setup messages not verified (fixed in 1.8.0: "Require verified sender for all trade setup messages") | `open()` checks the signature against `participants[from]`, refuses its own role, and checks replay last. The party uses only `opened.from`. | packages/protocol/src/envelope.ts:387-454; packages/escrow/src/party.ts:905-918 |
| Arbitrator chosen or registered by a trade party | The moderator identity is created in `attestTrade`. The API's work item supplies only the buyer and seller keys, and each needs a proof of possession bound to the trade code and role. | apps/moderation/src/attest.ts:46-98 |
| One party holds two roles | `assertDistinctKeys` on seal and open, distinct signing keys in the attestation's `wellFormed`, and `identity-conflict` in the API. Box key = conversion of the signing key, so the box keys are distinct too. | envelope.ts:179-198; attestation.ts:190-212; apps/api/src/trades/identity.ts:70-89 |
| The API (or relay) swaps a participant | Each app checks that its own slot holds both of its keys (`not-me`). The API stores an attestation only if the trader slots equal the registered keys (first write wins). The relay channel's keys are registered by a message the moderation key signs. | attestation.ts:281-289; apps/api/src/internal/routes.ts:611-646; apps/relay/src/server.ts:282 |
| Attestation re-minted with a different moderator after a crash | `prepare()` creates it once and commits signed_terms, the sealed party and the wallet password in one transaction. | apps/moderation/src/main.ts:272-295 |
| Different setup messages to different peers | Each step echoes the digests of the previous step from the other two. A mismatch is fatal `equivocation`. | party.ts:489-500, 946-950 |
| Parties end on different addresses | All three exchange `msig.addr` and confirm with `msig.ready`. `ready()` resolves only when both peers confirm the same address. The funding screen shows only the address this device derived, and it is cross-checked with the API's address. Check words over participants and address let users compare. | party.ts:538-565; apps/web/src/screens/trade/seams.ts:40-86; packages/trade/src/checkWords.ts |
| Replay across trades | Envelopes are signed over a per-trade `channelFor` channel, use fresh per-trade identities and a strictly increasing seq per sender. Release keys carry a 16-hex-character outcome tag. Tx sets only decode in their own wallet. | envelope.ts:396; packages/protocol/src/replay.ts:28-34; party.ts:254-258, 938-944 |

**Payout binding.** The builder and co-signer of each settlement kind are fixed in code (`ROUTE`), not chosen by any message. The payouts come from attested addresses and the fee wallet built into the app (apps/web/src/escrow/policy.ts:94-198). The co-signer's `checkTxSet` requires all of the following (packages/escrow/src/verify.ts:43-68), and `signRelease` re-checks before it signs exactly the hex it checked (packages/escrow/src/monero.ts:331-358):
- exactly one tx;
- a full sweep, with inputs equal to the escrow balance;
- exact outputs, with only payout 0 short, by the fee;
- no change output;
- no unlock time;
- the fee within the cap.

The co-signer is the final signer and broadcasts. The builder cannot alter outputs after that, and the co-signer cannot alter them without invalidating the builder's partial signature.

**Moderator refunds.** The moderator co-signs only the two refunds it may sign alone. It derives them from its own signed_terms and its own shadow trade. An API that lies can only delay them (apps/moderation/src/autoRefund.ts:4-32, apps/moderation/src/desk.ts).

## 2. Findings

### F1. MAJOR (architectural, owner decision): the single online `MOD_SIGNING_SECRET` is the only thing between a trader and the RetoSwap condition, and it also does three other jobs

- **Where:**
  - apps/moderation/src/main.ts:279 and :401 (trade and chat attestations);
  - apps/moderation/src/link.ts:109 (every internal API request), :174 and :185 (relay close and register);
  - :768 (`envBytes(env, 'MOD_SIGNING_SECRET', 64)`);
  - apps/web/src/escrow/worker.ts:125 (`VITE_MOD_SIGNING_PUBLIC`, the only key the apps trust).
- **Why it matters:** anyone who can sign with this key can attest a moderator identity they hold. A trader working with them then holds 2 of 3 keys from setup onward, which is exactly the RetoSwap end state, and the check words cannot catch it because both apps see the same signed participants.
  - The key sits in the environment of a networked process. That process also runs every moderator wallet and signs routine traffic: one internal API request per call, plus relay admin messages.
  - review-p4-t11-t16-2026-11-08 already found that this environment can be read from /proc if the API and moderation share a uid.
  - The domains are separated (`x2f/attestation/v1`, `x2f/api-internal/v1`, `x2f/relay-register/v1`, `x2f/relay-close/v1`), so this is not a cross-protocol forgery. It is exposure: the key that gives 2 of 3 is used for low-value transport signatures thousands of times a day.
  - The same holds for the web bundle: whoever can change the served JavaScript can change `VITE_MOD_SIGNING_PUBLIC`. This is inherent in a web app, but it is the same root.
- **Fix (engineering part):**
  1. Split the keys. Add a dedicated attestation key, MOD_ATTEST_SECRET with a pinned VITE_MOD_ATTEST_PUBLIC, used only by `signAttestation` and `attestChat`. Keep MOD_SIGNING_SECRET for internal API and relay admin only. The API's attestation check at apps/api/src/internal/routes.ts:528 and :593 (line 165 is the internal-request check, which keeps the other key) then uses the attestation public key, and `internalAuth` keeps the other.
  2. Keep the attestation key out of the process environment. Use a separate signer process or HSM behind a Unix socket that signs only a well-formed `Attestation` it can parse.
- **Owner questions:**
  - Should a second, independent co-attestation be required, for example a staff hardware key or a separately operated notary, so that a single compromised key no longer yields 2 of 3?
  - How should the pinned key be published (a fingerprint on the site or in docs) so users can check the bundle?
- **Failing test sketch (key split).** Fails today because one key signs both.

```ts
// apps/moderation/test/key-separation.test.ts
it('the attestation key is not the key that signs internal requests', async () => {
  const env = testEnv(); // as main.test builds it
  const svc = await startModeration({ ...env, signingSecret: kInternal, attestSecret: kAttest });
  const { attestation, sig } = await attestOne(svc);
  expect(verify(sig, attestationBytes(attestation), pub(kAttest))).toBe(true);
  expect(verify(sig, attestationBytes(attestation), pub(kInternal))).toBe(false);
  expect(capturedInternalRequestSig(svc)).toVerifyWith(pub(kInternal));
});
```

### F2. MAJOR (gate for Plan 4): the ruling path is safe only because it is disabled; when Plan 4 turns it on it must carry Haveno's 1.8.0/1.9.0 dispute hardening

- **Where:**
  - apps/moderation/src/rulings.ts:7 (`verifyRuling` returns false, so the moderator never builds a ruling set today);
  - apps/web/src/escrow/policy.ts:170 and :176 (a trader co-signs a moderator-built `dispute-buyer` / `dispute-seller` set whenever the API's unsigned view says `disputed`);
  - apps/web/src/screens/dispute/rules.ts:392-408 (`rulingAllowsCosign` reads `d.ruling` from the unsigned DisputeView).
- **Why it matters:** the trader side is sound today. A side co-signs only the set that pays itself at its own attested address, so a lying API cannot move that side's share to the other party. All the risk sits in what makes the moderator build a set, which is the June 2026 Haveno hole ("Verify arbitrator signature of structured dispute payout fields", "Verify dispute agent and sender against trade", and in 1.9.0 "Prevent replayed dispute messages from reverting state and apply revised rulings by their signed timestamps").
- **Fix (requirements for Plan 4 Task 13-15, to write into the plan):**
  1. The ruling is a structured, signed object: `{ v, trade, escrowAddress, round, outcome kind, payouts[] (address, amount), issuedAt, prevRulingHash }`. It is signed by a certified staff hardware key and verified inside the moderation service, never in the API.
  2. The moderator derives the payouts again from its own signed_terms and the balance its party reads, and builds only if they equal the signed `payouts[]`.
  3. The ruling is bound to this trade code, this escrow address and this dispute round. Keep a monotonic (round, issuedAt) per trade and refuse an older or equal one (no replay, no reverting to an earlier ruling).
  4. The staff key must be one the moderation records show assigned to this case (the 1.8.0 "dispute agent against trade" check).
  5. Optional: the trader apps also verify the ruling signature before co-signing. This is not needed for funds safety because of the self-pay rule, but it keeps a lying API from showing a fake ruling card.
- **Tripwire test sketch.** Fails once someone makes `verifyRuling` return true without these checks.

```ts
it('a ruling is accepted only when staff-signed, bound to trade+escrow+round, and newer than the last', () => {
  const r = signedRuling(staffKey, { trade: 'T1', escrowAddress: A, round: 1, issuedAt: t1, payouts: P });
  expect(verifyRuling(r, ctx({ trade: 'T2' }))).toBe(false); // other trade
  expect(verifyRuling(r, ctx({ escrowAddress: B }))).toBe(false); // other escrow
  expect(verifyRuling({ ...r, payouts: P2 }, ctx())).toBe(false); // field changed after signing
  expect(verifyRuling(r, ctx({ lastRound: 1, lastIssuedAt: t1 }))).toBe(false); // replay
  expect(verifyRuling(r, ctx({ caseStaff: otherKey }))).toBe(false); // not this case's moderator
});
```

### F3. MINOR: no explicit check that the finished wallet is 2-of-3

- **Where:** packages/escrow/src/monero.ts:144-157 (`make` passes THRESHOLD = 2, `address()` checks only `getIsReady()`); packages/escrow/src/party.ts:519-523.
- **Why it matters:** the 2-of-3 shape is implied by wallet2, given the two peer infos and threshold 2. Three distinct keys are implied by wallet2's signer checks plus the envelope binding. Nothing in X2F asserts either. With a future monero-ts or FCMP++ multisig change (the research notes multisig "may not migrate as a drop-in"), a wallet that reports ready with another shape would be accepted silently. Haveno's lesson 2 ("before showing a funding address, check one key per role") calls for an explicit check.
- **Fix:** in `MoneroMultisigSession.address()`:

```ts
const info = await this.wallet.getMultisigInfo();
if (!info.getIsReady() || info.getIsMultisig() !== true || info.getThreshold() !== 2 || info.getNumParticipants() !== 3) throw new EscrowError('not-ready', 'not a 2-of-3 multisig wallet');
```

  In the party, treat a refused address after `ready: true` as `PartyError('bad-state')`, so that party never sends `msig.addr` or `msig.ready`.
- **Failing test sketch.** Needs no daemon: the constructor takes the wallet.

```ts
// packages/escrow/test/shape.test.ts
it('refuses an address from a ready wallet that is not 2-of-3', async () => {
  const wallet = { getMultisigInfo: async () => ({ getIsReady: () => true, getIsMultisig: () => true, getThreshold: () => 2, getNumParticipants: () => 2 }),
                   getPrimaryAddress: async () => '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge' };
  const s = new MoneroMultisigSession(wallet as never, 'http://x', 'pw');
  await expect(s.address()).rejects.toMatchObject({ code: 'not-ready' }); // resolves today
});
```

### F4. MINOR: the fee ceiling is absolute (0.01 XMR), so a builder can burn up to 0.01 XMR of the co-signer's payout

- **Where:** packages/escrow/src/verify.ts:4 and :48-49; packages/escrow/src/party.ts:1159-1162 (the same cap in `proveSweep`).
- **Why it matters:** payout 0 bears the fee. In a release the seller builds and the buyer's payout is payout 0, so a seller who builds with a high priority (or an edited wallet) makes the buyer pay up to 0.01 XMR to miners.
  - A normal 2-3-output sweep pays about 0.00003-0.0001 XMR.
  - On a small trade (0.05 XMR) the cap is 20 % of the payout. The builder gains nothing, so this is griefing.
  - Haveno 1.9.0: "Strengthen payout address and transaction fee validation".
- **Fix:** bound the fee relative to the network as well. Accept `fee ≤ min(MAX_NETWORK_FEE, k × daemon fee estimate × tx weight)` with k ≈ 4. Or, simpler and deterministic: `fee ≤ min(MAX_NETWORK_FEE, max(FLOOR, payouts[0] / 200))`. Pass the ceiling into `checkTxSet` from `checkRelease` (the engine can read `getFeeEstimate()`).
- **Owner question:** which bound? I recommend the estimate-based one, with the 0.01 XMR absolute cap kept as a backstop.
- **Failing test sketch:**

```ts
// packages/escrow/test/verify.test.ts
it('refuses a fee far above the network rate even under the absolute cap', () => {
  const expected = [{ address: BUYER, amountAtomic: 50_000_000_000n }, { address: FEE, amountAtomic: 500_000_000n }];
  const fee = 9_000_000_000n; // 0.009 XMR
  const tx = described({ fee, dests: [[BUYER, 50_000_000_000n - fee], [FEE, 500_000_000n]] });
  expect(() => checkTxSet([tx], expected, 50_500_000_000n, { feeCeiling: 400_000_000n })).toThrow('network fee too high'); // passes the check today
});
```

### F5. MINOR: no rotation or revocation for the pinned moderation key, and `issuedAt` is never checked

- **Where:** packages/trade/src/attestation.ts:260-279 (one `modSigningPublic`, `issuedAt` only type-checked at :193); apps/web/src/escrow/worker.ts:125.
- **Why it matters:** after a suspected key compromise (F1) the only remedy is a new build, and every attestation the old key ever signed stays valid. Replay is not the issue, since attestations are bound to the trade code and per-trade keys. Haveno 1.12.0 ("verify arbitrators … from peers before using them") also checks peer data against a current registry.
- **Fix:**
  1. Accept a small set of pinned keys, each with a `notAfter`, and refuse an attestation whose `issuedAt` is outside its key's validity.
  2. Have the API serve a revocation list signed by an offline root, checked in `verifyAttestation`.
  3. Refuse an `issuedAt` more than N days before the trade's take time.
- **Test sketch:** `verifyAttestation(a, sig, { keys: [{ pub, notAfter: '2026-10-01' }] }, me)` with `a.issuedAt = '2026-11-01'` rejects with `bad-signature`. This is an API change, so the test is written against the new signature.

## 3. Haveno 1.8.0-1.12.0 hardening items, one by one

| Haveno item | X2F status |
|---|---|
| 1.8.0 Verify arbitrator signature of structured dispute payout fields | Not applicable yet (rulings disabled). Required for Plan 4 (F2). |
| 1.8.0 Verify dispute agent and sender against trade | Plan 4 (F2, point 4). Dispute chat from the moderator is dev-only today: `/internal/chat/send` seals whatever the API names, which is NEEDS_P4_MOD_COUNTERSIGN and refused in production (apps/moderation/src/internal/server.ts:26-31). |
| 1.8.0 Require verified sender for all trade setup messages | Done: envelope signature and attested participants (section 1). |
| 1.8.0 Verify deposit response / NACK sender as arbitrator | Done in substance. There is no deposit exchange: the seller funds the address its own party derived, after all three confirm. A refusal arrives through the API unsigned (409 `attestation-refused`), so a lying API can stop a trade but cannot make it unsafe (info). |
| 1.8.0 Verify deposits unpublished before deleting wallet on init error | Done for the main path: a failed run keeps its record, and the 30-day forget requires the escrow empty and in a block (apps/web/src/escrow/runtime.ts:1155-1201). Coins sent after both traders' records are forgotten can only ever be spent with the moderator's key, so they are lost (info I4). |
| 1.9.0 Verification of trade participants, arbitrator authorization | Done (attestation). Single-key root (F1). |
| 1.9.0 Replayed dispute messages / revised rulings by signed timestamps | Plan 4 (F2, point 3). |
| 1.9.0 Payout address and tx fee validation | Addresses: done (attested, re-derived on each side). Fee: absolute cap only (F4). |
| 1.9.0 Oversized messages, request limits, wrong network | Envelopes are padded to at most 64 KiB, spend info is capped at 60 000 hex characters, and malformed messages are ignored. The wallet network comes from config (monero.ts:86-94). I did not review the relay's rate limits. |
| 1.9.0 API password, localhost binding, throttled logins | The moderation service has no TCP listener (Unix socket, HMAC, a single-use log entry). The API's internal routes need a request signed by the moderation key. Covered (key exposure: F1). |
| 1.9.0 Reject trade chat after completion and between arbitrators and traders | Chat is a separate attestation with its own domain. I did not re-review it here. |
| 1.12.0 Verify offers, arbitrators, support messages from peers | Arbitrator: done. Support messages: Plan 4 (see the 1.8.0 dispute-agent row). |
| 1.12.0 Fake or replayed account data raising limits | Out of scope here (limits are server-side). |
| 1.12.0 Only accept chat from the trading peer | Chat envelopes are signed and attested. |
| 1.12.0 Random password for the local wallet process | Done: per-trade wallet password (R27) on the moderator side and per-trade on the web (`createPassword`). |
| 1.12.0 Fix dispute payouts when a trader's wallet data is out of date | Done in substance: every attempt runs a fresh export/import round and refuses to rebuild from stale data (party.ts:569-589, 626-632). |
| 1.12.0 Messages shown undelivered without confirmation | The signals channel has acks (desk `sealAck`). Whether the buyer's "I've paid" waits for the moderator's ack is relevant to I3 below. I did not verify it. |

## 4. Info

- **I1.** Mod-slot box key. `checkWork` for a trade does not check that the two box keys differ; the chat version does (apps/moderation/src/attest.ts:49 vs :104). This is safe, because `identityProofValid` forces box = conversion of the signing key. Add the same check for symmetry.
- **I2.** Check words. They are 44 bits, and comparing them is voluntary. They catch a one-sided participant or address swap (for example one tampered bundle), not a compromise of the moderation key (F1). Consider prompting both users to compare them in chat before the seller funds above a threshold.
- **I3.** Seller's cancel refund. This guard is sound against a lying API alone, and against a lying relay alone. If the API and relay are the same operator and both lie, the buyer's `trade.paid` could be dropped while the API shows `auto-refund`. That is documented as the trust model (autoRefund.ts:10-17). The buyer's protection is a dispute.
- **I4.** Late funds after the 30-day forget (runtime.ts:1197). After both trader devices delete their wallets, only the moderator's share is left, so coins sent later can never move. The `late-funds` report sends earlier ones to a person. This needs a sentence in user copy and an owner decision on whether to keep wallet keys longer (or export them for the user).
- **I5.** The moderator imports post-release spend info supplied by a trader. Forged partial key images were already handled in reviews I1, R2 and R3 (both parties must name the hash, plus a tx-key payout proof, party.ts:1148-1167 and monero.ts:254-288). I found nothing new.
- **I6.** `describeMultisigTxSet` reports the builder's construction data. The guarantee that what was checked is what gets signed relies on monero v0.18's re-check during signing (monero.ts:343-345). monero-ts is pinned at 0.11.16. Keep it pinned, and re-check this assumption when moving to FCMP++ multisig.

## 5. Owner questions (from F1, F2, F4, I4)

1. **Attestation key.** Split it out of MOD_SIGNING_SECRET and move it to a separate signer or HSM (recommended: yes). Also require a second independent co-attestation? I recommend it for trades above a threshold.
2. **Plan 4 rulings.** Adopt the F2 requirements, a signed structured ruling with monotonic rounds verified inside the moderation service, as binding before any moderator-built ruling set ships? I recommend yes.
3. **Fee bound.** Relative to the daemon's estimate, with 0.01 XMR as the backstop? I recommend yes.
4. **Wallet keys after the 30 days.** Keep them longer, or offer an export, so late coins can still be recovered?
