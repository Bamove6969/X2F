# Review: wip/lead-escrow-harden b1a364ce (security), 16 Nov 2026

**Verdict: APPROVE WITH MINORS.** F3 is correct and complete within what monero-ts exposes. The F4 bound is correctly computed and fails closed, but it is only as honest as the co-signer's node (M2, M3). F5's key validity window does not stop a thief of a rotated-out key, who simply backdates `issuedAt` (M1, proven below). That is harmless today, because the single key has no bounds, but it must be fixed, and the comment corrected, before the first key gets a `notAfter`.

- **Scope:** `git log origin/main..b1a364ce`, with main at 4f0afa14. 45cdf9ab has the red tests and b1a364ce the fix. 15 files, +852/-38. I read every changed file in the diff.
- **Inputs:** review-multisig-vs-retoswap-2026-11-12.md (F3, F4, F5) and build-escrow-harden-2026-11-12.md.
- **Threat model:** the API and its DB are fully compromised, a trade counterparty may be malicious, and the monerod node may be untrusted. The web's node is `VITE_NODE_PROXY_URL`, the operator's node proxy, so "compromised operator" and "lying node" are the same adversary for web users.

## Findings

### M1. F5: a rotated-out key's thief backdates `issuedAt` into the old window. Only the API's `takenAt` stands in the way, and the API can omit it or choose it
- **Where:** packages/trade/src/attestation.ts:189-193 (the `AttestationKey` doc claims "an attestation the old key signs later (e.g. after a compromise) is refused") and :384-388. apps/web/src/escrow/runtime.ts:618 (`takenAt` is passed only when the API's view has one). packages/trade/test/attestation.test.ts ("what a thief of a rotated-out key would do").
- **What is wrong:** `issuedAt` is chosen by whoever holds the signing key. A thief of the old key mints a new attestation with `issuedAt` inside the old key's window, and `keyCovers` accepts it. The only lower bound is `me.takenAt`, which comes from the API's unsigned trade view. Under the threat model the API is the thief's ally (F1's scenario is exactly a moderation-key leak). It can drop `takenAt` from the view, and then the check is skipped, because `parseTradeView` turns a missing value into null and the runtime passes nothing. Or it can set `takenAt` to match the backdated time. Note the contrast: a missing `payWindowMin` or `methodId` fails closed (runtime.ts:603), but a missing `takenAt` silently disables the check.
- **Failure scenario:** the key is rotated with `notAfter = 2026-11-01`. On 16 Nov the attacker, holding the old key and the API, attests a fresh trade with attacker-chosen moderator keys and `issuedAt = 2026-10-23`. The API serves the trade view without `takenAt`. The victim's device accepts it, and the attacker holds 2 of 3 keys.
- **Proof (run in my worktree, not committed; 1 passed):**

```ts
it('a thief of the old key mints a NEW trade attestation after notAfter by backdating issuedAt', async () => {
  const t = await buildTrade(); // issuedAt 2026-10-23, inside the old key's window
  const next = sodium.crypto_sign_keypair();
  const keys = [
    { signPublic: t.modSign.public, notBefore: null, notAfter: '2026-11-01T00:00:00.000Z' },
    { signPublic: sodium.to_hex(next.publicKey), notBefore: '2026-11-01T00:00:00.000Z', notAfter: null },
  ];
  const now = Date.parse('2026-11-16T12:00:00.000Z');
  await expect(verifyAttestation(t.attestation, t.sig, keys, meOf(t, 'buyer', { now }))).resolves.toBeUndefined();
  await expect(verifyAttestation(t.attestation, t.sig, keys, meOf(t, 'buyer', { now, takenAt: '2026-10-22T23:59:00.000Z' }))).resolves.toBeUndefined();
});
```

- **Fix:** use a lower bound the device itself knows. The attestation must contain this device's fresh per-trade identity (runtime.ts:536-540 generates it and stores it "before the API ever sees it"), so it cannot legitimately predate it.
  - Store `identityCreatedAt` (device clock) in the escrow and chat records when the identity is generated.
  - Pass it as the lower bound, required, not optional: `issuedAt >= identityCreatedAt - skew`.
  - Keep the API's `takenAt` only as an extra check, or drop it.
  - Records created before the change have no time. Treat them as "no lower bound", which is acceptable only while every key is unbounded. Or refuse a bounded key for them.
  - Today, fix the `AttestationKey` comment and the test's wording so nobody relies on a guarantee that does not exist.
- **Severity:** minor today, because `attestationKeys()` returns one unbounded key and behaviour is unchanged. It becomes blocking the day a key gets a `notAfter`.

### M2. F4: a lying node controls the bound in both directions
- **Where:** packages/escrow/src/monero.ts:408-447, verify.ts:76-96.
- **Inflation.** The node returns a huge `fees[1]`, or a huge `quantization_mask` (any safe integer is accepted; 9e15 was tried). The bound then goes straight back to the 0.01 XMR backstop. So against the stated threat model (the node is the operator's), a malicious seller plus the operator can still burn up to 0.01 XMR of the buyer's payout. That is the pre-fix status: not a regression, but F4 is fixed only for honest nodes.
- **Deflation.** The node returns `fee: 1, fees: [1,1,1,1], quantization_mask: 1`. The bound becomes 4 × 1602 = 6 408 atomic units, far below any real fee (about 3e7). Every honest release is then refused as `payout-mismatch`. After 20 attempts (MAX_ATTEMPT) the outcome is `exhausted` (`bad-outcome`).
  - This is denial of payout, but not a new capability. The same node can already burn attempts by lying about the balance (`sweepableBalance` gives `not-ready`, which is also RETRYABLE), or by refusing to relay.
  - The moderator's own node gives the dispute route.
- **Proof (my PoC file, both pass):**
  - `feeCeiling(parseFeeEstimate({result:{status:'OK',fee:1,fees:[1,1,1,1],quantization_mask:1}}),1,2) === 6408n`
  - with `fees[1]=1e12` or `quantization_mask=9e15` it gives `10_000_000_000n`.
- **Fix (owner decision, see Q1):** add a deterministic floor and a payout-relative cap so the node cannot move the bound outside a sane band: `ceiling = min(MAX_NETWORK_FEE, max(FEE_FLOOR, 4 × estimate))`, with FEE_FLOOR around 0.0002 XMR. The floor removes the deflation refusal: an honest mainnet sweep at priority 2 is about 0.00013 XMR. Optionally also cap at `payouts[0] / 200` (with a floor) against inflation on small trades. I would also cap `quantization_mask` at something like 10^8: monerod's is 10^4.

### M3. F4: `signRelease` re-fetches the estimate after the co-signer committed, which adds a new daemon dependency and a non-deterministic refusal on the committed path
- **Where:** monero.ts:449-450 (`signRelease` calls `checkRelease`, so a second `get_fee_estimate`); party.ts:704-724 (phase `cosigning`, `committed = true`).
- **What is wrong:** before this change, a committed co-signer needed only its wallet to reach `signed`. Now a node that stops answering `get_fee_estimate` after the first check keeps the co-signer in `cosigning` and `committed`. It retries `daemon-unavailable` forever, and `settle()` to another outcome is refused ("already signed for another outcome").
- **Other effect:** an estimate that drops between the two calls turns a set that was just accepted into a refused attempt.
- **Severity:** liveness only. A node that refuses `send_raw_transaction` stalls the same party at `signed` anyway, so I rate this minor.
- **Fix:** persist the ceiling computed at the first check with `rel` (`rel.feeCeiling`), and have the re-check in `signRelease` use the stored value. Or give `checkRelease` an optional `maxFee` argument. The re-check then stays deterministic and offline, which is the point of the R26 "sign exactly what was checked" path.

### I1. F4 weight estimate: verified against wallet2, generous in the safe direction
- `estimateTxWeight` matches wallet2 v0.18 `estimate_rct_tx_size` plus the BP+ clawback in `estimate_tx_weight`, term by term: vin, vout plus view tag, BP+ `(2(6+log)+6)·32+3`, CLSAG `32·16+64`, pseudo outs, ecdh 8, outPk 32, fee 4, clawback `(base·2^p − 32·(6+2(6+p)))·4/5` with base 320.
- The extra field is over-estimated: it includes one additional pubkey per output and the dummy payment id. For 1 input and 2 outputs it gives 1602 bytes, against about 1540 real (the tests' own figure).
- Quantization `ceil(w·rate / mask)·mask` matches wallet2's `calculate_fee_from_weight`. The bigint maths is exact, and the mask is ≥ 1, so there is no division by zero.
- `grace_blocks: 10` matches FEE_ESTIMATE_GRACE_BLOCKS. The fallback without `fees` (4 × low) only matters for pre-HF15 daemons.
- **Inputs:** `getOutputs({accountIndex: 0}).length` counts spent outputs too. It can only raise the bound, and an escrow never spends before its release. Dust sent to the escrow raises both the real weight and the bound, so they stay consistent. Over 1000 inputs gives `payout-mismatch`, which was already unbuildable before.
- **Outputs:** taken from the builder-supplied `txs[0].destinations.length` before `checkTxSet` validates it. This is harmless, because `checkTxSet` then requires `destinations.length === expected.length`, and over 16 gives `payout-mismatch`. Cleaner: `Math.max(2, expected.length)` (nit).
- **Margin:** if wallet2 ever added a 0-amount change output, the real output count would be one higher, about 1.34× the weight for 2→3 outputs. That eats into the priority-2 margin (4× becomes about 3×), but it is still accepted. The regtest-verify suite (10/10 per the builder) covers the real shape.
- **Fetch path:** timeout via `timed` plus `AbortSignal.timeout`, `redirect: 'error'`, `credentials: 'omit'`. Non-200, bad JSON, `status !== 'OK'`, and non-positive or unsafe numbers all give `daemon-unavailable`, which the tick loop retries (party.ts:986) and which never means "no bound". The node proxy allowlists `get_fee_estimate` (apps/node-proxy/src/server.ts:64) and rebuilds the body.

### I2. F3: `kexSignerKey` is correct, and distinctness cannot be faked
- **Decoder:** Monero block sizes `DECODED = [0,-1,1,2,-1,3,4,5,-1,6,7,8]` invert `encoded_block_sizes`. Overflow is refused per block, as in `decode_block`. There is no checksum, which is correct: kex messages use plain `tools::base58::encode`. Exactly 128 bytes (16 full blocks) are required.
- **Bounds:** input length is capped upstream (64 KiB envelopes), and per-block BigInt work is trivial.
- **PoC (7/7 pass):**
  - 200 random 128-byte round-trips against a reference encoder;
  - all-0x00 and all-0xff blocks;
  - refusal of: one character short or long, one block short, 127 and 129 bytes, an overflowing `zzzzzzzzzzz` block, the non-alphabet characters `0`, `I` and `l`, the magic `MultisigxV2Rn`, wrong-case magic, a leading space, non-strings;
  - injectivity over every character of the signer-key blocks.
- **Can a crafted peer message name the same signer under a different key string?** No.
  - Decoding is a bijection (fixed-length blocks, overflow refused), so the same bytes always give the same hex.
  - wallet2 verifies the round-1 signature against those exact signer-key bytes, so a peer cannot present a different encoding of our key without our secret.
  - Ed25519 non-canonical encodings exist only for points with y < 19 or x = 0. These are never a real wallet's key, and the attacker cannot sign for our point anyway.
  - Offering our own message back, or one peer copying the other's, is caught: the builder's offline test shows wallet2 itself accepted the first.
- **`address()` shape check:** `getIsMultisig`, `getThreshold` and `getNumParticipants` come from wallet2's own state, and they exist in monero-ts 0.11.16 (`MoneroMultisigInfo.js`). With the final signer keys not exposed, this is the strongest check available. It is sufficient together with the make-time distinctness check, because wallet2 fixes the signer set at round 1 and later kex rounds are signed by members of that set.
- **Residual:** only round 1 is checked by X2F. Later rounds rely on wallet2, which is fine, but should be re-checked with FCMP++ multisig (same as review I6).
- **`make()`:** calls `prepareMultisig()` a second time for its own key. monero-ts throws "already multisig" if the wallet is already multisig; that is a plain Error, not mapped to `bad-state`, and the same as `makeMultisig` would throw before. No regression.

### I3. F5: other observations
- The API can set `takenAt` later than `issuedAt` + 10 min and stop a funded trade's runtime at every start (`bad-time`, retryable `escrow-failed`). This is not a new lever: the API can already withhold the trade view.
- A device clock more than 10 min slow delays acceptance until real time catches up (it self-heals). A clock set far into the past blocks the device until it is corrected. This is the builder's owner question 1 (copy).
- The canonical-ISO requirement for `issuedAt` matches moderation, which writes `issuedAt.toISOString()` (apps/moderation/src/attest.ts:70, :133).
- A malformed key-list entry is skipped (fail closed). Signature verification tries each covering key, so it is not constant-time across keys, but it handles only public data.

## Trial merge with origin/wip/third-netfee-split (e6f718c4)

I merged with `--no-commit` in a separate worktree, at b1a364ce. There were **3 textual conflicts, no semantic ones**:
1. **packages/escrow/src/index.ts:** export lines. Take the union: `FEE_ESTIMATE_MULTIPLIER, estimateTxWeight, feeCeiling, parseFeeEstimate, FeeEstimate, kexSignerKey` plus `feeBearers, feeSplitLayout, networkFeeShares`.
2. **packages/escrow/src/monero.ts:** the verify import line. Take the union: `feeBearers, feeCeiling, feeSplitLayout, parseFeeEstimate, FeeEstimate`.
3. **packages/escrow/src/verify.ts:** two hunks.
   - The `MAX_NETWORK_FEE` doc against netfee's `export { feeSplitLayout, networkFeeShares }`: keep both.
   - The `checkTxSet` doc comment: netfee's fee-bearer text plus harden's `maxFee` sentence.

The `checkTxSet` bodies auto-merge cleanly: harden adds the `maxFee` parameter and line, netfee adds `networkFeeShares` over `feeBearers`. Merge results are in the test section below.

Semantic notes after the merge:
- The fee bound is on the total fee, and netfee splits that fee among the bearers. The bound still applies unchanged, and the weight does not depend on `subtractFeeFrom`.
- The `FEE_ESTIMATE_MULTIPLIER` doc ("the payout-0 party pay[s]") and monero.ts's `checkRelease` comment go stale after the merge. Reword them to "the fee bearers".
- `proveSweep` in party.ts keeps the 0.01 backstop only, in both branches (consistent).

## Tests (my runs, Node 24.22.1, worktree at b1a364ce)

Unlike the brief's expectation, `tools/regtest/fetch-monerod.sh` downloaded and installed monerod v0.18.5.3 here. So the regtest-based escrow tests did run.

**Branch at b1a364ce:**

| Run | Lock | Result |
|---|---|---|
| `@x2f/escrow`, whole project, regtest included (fee-bound, shape and the regtest engine/party files) | yes | 18 files, **128 passed, 0 failed, 0 skipped**, 1469 s |
| `regtest` + `regtest-verify` projects | yes | 2 files, **14 passed** |
| `@x2f/trade`, whole project | yes | 19 files, **504 passed** |
| apps/web touched tests: attestation-flow, CantDoThat, cantDoThat-lint, chatEngine, teamCantDoTitle | no | 5 files, **181 passed** |
| apps/moderation `test/attest*` | no | **9 passed** |
| `tsc --noEmit` on escrow, trade and web | no | clean |
| My PoC files (not committed, deleted afterwards) | no | escrow PoC **7 passed** (`kexSignerKey` decoder and fee-bound tampering); trade PoC **1 passed** (M1) |

**Trial merge with third-netfee-split, after the 3 conflicts were resolved by union:**

| Run | Result |
|---|---|
| `tsc` on escrow, trade and core | clean |
| escrow `fee-bound.test.ts` + `verify.test.ts` | **38 passed** |

**Not run:**
- The full apps/web project (2116 tests per the builder). I ran only the touched tests.
- The API project, which this branch does not touch.
- Playwright, since no UI changed beyond the code map.
- The full test suite on the merge result. The 3-way merge needs a real resolution commit by the lead first.

## Questions for the owner (via the lead)
1. **Fee bound band (M2):** add a fixed floor (about 0.0002 XMR) and optionally a payout-relative cap, so a lying node can neither push the bound to 0.01 XMR nor refuse every release? Recommended: floor yes; relative cap `max(floor, payouts[0]/200)` as a second backstop.
2. **Attestation time lower bound (M1):** use the device's own identity-creation time, required, instead of the API's `takenAt`. Recommended: yes, before any key rotation.
3. The builder's open questions stand: `bad-time` copy, the skew of 10 min and the multiplier of 4, and the rotation date and revocation list. Recommended: the skew and multiplier are fine. Do the revocation list (review F5.2) together with M1, since the window alone is not revocation.
