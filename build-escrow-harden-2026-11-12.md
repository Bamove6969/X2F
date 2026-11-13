# Build note: escrow hardening (review multisig-vs-RetoSwap F3, F4, F5), 12 Nov 2026

Branch `wip/lead-escrow-harden`, based on main `4f0afa14`. Rulings and disputes are untouched.
Commits: the red tests first (`45cdf9ab`), then the fix (`b1a364ce`, the branch head, pushed).

## F3: explicit 2-of-3 check (packages/escrow)
- `MoneroMultisigSession.make()` takes exactly two peers. Each peer message must be a round-1 kex
  message, and the three signer keys (both peers' and this wallet's own) must be distinct.
  Otherwise it throws `EscrowError('bad-multisig')` before the wallet becomes multisig. The signer
  key is read from the message with a small Monero base58 decoder (`kexSignerKey`). It is not the
  public spend key: wallet2 blinds it. This wallet's own key comes from its own `prepareMultisig()`,
  which is deterministic.
- `address()` refuses a ready wallet unless it is multisig, threshold 2, with 3 participants
  (`bad-multisig`). The address is never read in that case.
- In the party, either refusal is `PartyError('bad-state')`, raised before `msig.addr` or
  `msig.ready` is sent. The web shows it as the existing retryable `escrow-failed`.
- Finding: on the red run, wallet2 (monero-ts 0.11.16) accepted a wallet's own prepare message
  offered back as a peer's. The new check is the only thing that refuses it.
- Limit: monero-ts does not expose the finished wallet's signer keys. Distinctness is checked at
  make, and the shape is checked at address.

## F4: fee bound (packages/escrow/src/verify.ts, monero.ts)
- The co-signer's `checkRelease` (and so `signRelease`/`cosign`) reads monerod's json_rpc
  `get_fee_estimate` (grace 10) with a plain fetch. The node proxy already allows this. It then
  accepts `fee <= min(0.01 XMR, 4 x quantize(estimated weight x normal-priority fee per byte))`.
- Normal rate: `fees[1]`, or 4 x `fee` if the daemon gives no per-priority fees.
- Weight: wallet2's CLSAG/BP+ estimate with view tags, with generous room for extra. Inputs = the
  escrow's outputs. Outputs = max(2, payouts).
- Why 4 (`FEE_ESTIMATE_MULTIPLIER`):
  - The builder never sets a priority, so wallet2 pays the low rate or, with a pool backlog, the
    normal rate. These pass with 16x and 4x margins.
  - Priority 3 passes at about the bound. Priority 4 is refused.
  - On mainnet the most a builder can burn falls from 0.01 XMR to about 0.0005 XMR.
- Failure handling:
  - No usable estimate is `daemon-unavailable`, which is retried and never means "no bound".
  - A fee above the bound is `payout-mismatch`, which means a refused attempt.
- Unchanged: the builder's own check keeps only the 0.01 backstop, and so does `proveSweep` (party.ts).

## F5: attestation keys and issuedAt (packages/trade/src/attestation.ts, web)
- `verifyAttestation(a, sig, keys, me)`: `keys` is a list of `{ signPublic, notBefore, notAfter }`
  (ISO, inclusive, null = no bound). A bare key string is still accepted and treated as unbounded.
  The signature must verify with a key whose range holds `issuedAt`; otherwise `bad-signature`.
- `attestationKeys(VITE_MOD_SIGNING_PUBLIC)` gives exactly one key today, the same value, with no
  bounds, so behaviour is unchanged. The web's escrow runtime and chat engine use it.
- `issuedAt` must be a canonical ISO time (as moderation writes it); otherwise `bad-signature`.
- New code `bad-time`, checked after every other check, for an `issuedAt`:
  - more than `ATTESTATION_CLOCK_SKEW_MS` (10 min) after `me.now` (default: the device clock);
  - more than 10 min before `me.takenAt`, the trade view's `takenAt`, which the web passes when the
    view has it (an attestation older than its trade). A takenAt that is given but unreadable is
    also `bad-time`.
- There is no maximum age against "now", because a stored attestation is re-verified on every
  start and a disputed trade can run for months.
- Web: `bad-time` gives `escrow-failed`, which is retryable and not kept in the record, since it
  may just be the device clock. Every other refusal maps as before. `bad-time` is classified in
  cantDoCodes.ts with `wrong-terms`.

## Tests (all under ~/x2f-comms/check.lock, a timeout inside it)
- **Red on the test commit:**
  - escrow shape + fee-bound: 17 failed, 7 passed;
  - trade attestation: 8 failed, 35 passed;
  - web attestation-flow `-t issuedAt`: 3 failed, 1 passed.
- **Green on `b1a364ce` (after the container restart; the stale .regtest was deleted and monerod
  re-fetched and verified):**
  - @x2f/escrow, whole project with regtest: 127 passed, 1 failed. The failure was shape.test's
    own `isMultisig()` call, which monero-ts 0.11.16's WebAssembly lacks. After the test fix,
    shape.test passed 14/14.
  - regtest: 4/4. regtest-verify: 10/10.
  - @x2f/trade: 504/504.
  - @x2f/web: 2116/2116 (after classifying `bad-time` in cantDoCodes.ts).
  - moderation attest + chat: 12/12.
  - tsc: escrow, trade, web and moderation all clean.

## Owner questions
1. `bad-time` currently shows the generic retryable escrow error. Should it get its own copy
   ("check your device's clock")? Recommended: yes.
2. Clock skew of 10 min and fee multiplier of 4: confirm or pick other values.
3. Key validity dates for today's key are open. When should the first rotation be, and should a
   revocation list (review F5.2) follow?
