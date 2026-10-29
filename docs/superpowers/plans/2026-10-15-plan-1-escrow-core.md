# Plan 1: Foundation and escrow core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested TypeScript monorepo in which three independent parties (buyer, seller, moderator) set up a 2-of-3 Monero escrow, fund it, and settle it every way the spec allows, talking only through signed, encrypted messages over X2F's relay, with the 1% fee paid as a second output and every payout checked before anyone signs.

**Architecture:** npm workspaces. `packages/core` (trade codes, fees, roles), `packages/protocol` (identities, sealed and signed envelopes, replay guard), `packages/escrow` (the `EscrowEngine` interface, its monero-ts implementation, the per-party protocol runner, the moderator auto-refund guard), `apps/relay` (Fastify WebSocket relay that never reads message bodies), `tools/regtest` (signature-verified monerod download and a private regtest chain for tests). No UI in this plan.

**Tech Stack:** Node 20, TypeScript 7.0.2 (strict), vitest 5.0.3, monero-ts 0.11.16, libsodium-wrappers 0.8.4, fastify 5.12.5, @fastify/websocket 11.3.1, ws 8.22.0, tsx 4.23.15, monerod v0.18.5.3 (regtest only).

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md` (sections 1, 2.2, 2.3, 3, 6.4, 6.6 trade codes, 8, 9). Lessons from `spikes/escrow-multisig/` and `spikes/phase0-browser/RESULTS.md` apply.

## Global Constraints

- Non-custodial: X2F holds at most one key per trade (the moderator's). Never add a server key that could sign with another party.
- Every dependency is pinned to an exact version at least two weeks old (versions above). `.npmrc` has `save-exact=true` and `ignore-scripts=true`.
- `npm audit --omit=dev` must report zero vulnerabilities; fix with `overrides` in the root `package.json`, never by ignoring. (The spike flagged one high and one moderate advisory under monero-ts.)
- Every task ends with `npm run check` passing: typecheck, tests, audit, and Semgrep.
- Monero amounts are `bigint` atomic units (1 XMR = 1_000_000_000_000n) everywhere. Never `number` for money.
- monero-ts wallets on regtest use `networkType: MAINNET` (regtest uses mainnet address format) and `regtest: true`, or sync fails with "Exception in thread pool".
- Tests mine **12** blocks after funding before expecting unlocked funds (10 was one block short in Phase 0).
- Protocol messages carry no usernames, amounts in plain text, or anything readable by the relay.
- Code written by agy-delegated agents is accepted only after Semgrep, the Security Guidance hook and a code-review plugin have checked it.

## Review Focus

1. **A party disconnects or its page is paused mid-setup or mid-signing** (Phase 0 finding): it must resume from saved state and finish, without applying a round twice. Test owned by Task 8.
2. **A malicious builder swaps the payout address or amount** in a release: the co-signer must refuse before signing, and nothing is broadcast. Test owned by Task 5.
3. **A forged or replayed protocol message** (signed by a non-participant, copied from another trade, or re-sent with an old sequence number): rejected, and the run continues. Tests owned by Tasks 3 and 8.
4. **Tiny or odd amounts:** fee rounding on amounts under 100 atomic units, and a release where the network fee is taken from the payee, never from the X2F fee output. Tests owned by Tasks 2 and 5.
5. **The moderator auto-refund firing when it shouldn't** (clock or state edge cases) or paying anywhere except the recorded refund address. Test owned by Task 9.

---

### Task 1: Workspace, tooling and security gates

**Files:**
- Create: `package.json`, `.npmrc`, `tsconfig.base.json`, `vitest.workspace.ts`, `.semgrepignore`, `.gitignore` (add `node_modules/`, `dist/`, `.regtest/`), `tools/check.sh`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: root scripts `npm test`, `npm run typecheck`, `npm run audit`, `npm run semgrep`, `npm run check` (all four, stops on first failure). Workspace packages named `@x2f/core`, `@x2f/protocol`, `@x2f/escrow`, `@x2f/relay`.

- [ ] **Step 1:** Root `package.json` with `"private": true`, `"workspaces": ["packages/*", "apps/*"]`, devDependencies pinned exactly (typescript 7.0.2, vitest 5.0.3, tsx 4.23.15), and the scripts above. `.npmrc`: `save-exact=true`, `ignore-scripts=true`, `audit-level=low`.
- [ ] **Step 2:** `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `verbatimModuleSyntax`.
- [ ] **Step 3:** Install Semgrep without touching system Python: `python3 -m venv ~/.local/semgrep-venv && ~/.local/semgrep-venv/bin/pip install semgrep==<latest release at least two weeks old>`. `npm run semgrep` runs `~/.local/semgrep-venv/bin/semgrep scan --config p/typescript --config p/nodejs --config p/secrets --error --metrics=off packages apps tools`.
- [ ] **Step 4:** Write `packages/core/test/smoke.test.ts`: `expect(await import('@x2f/core')).toBeDefined()`. Run `npm test`; expect PASS.
- [ ] **Step 5:** Run `npm run check`. Expected: typecheck clean, 1 test passes, audit `found 0 vulnerabilities`, Semgrep `0 findings`.
- [ ] **Step 6:** Commit `chore: workspace with security gates`.

### Task 2: Trade codes and fee maths (`@x2f/core`)

**Files:**
- Create: `packages/core/src/tradeCode.ts`, `packages/core/src/fees.ts`, `packages/core/src/roles.ts`
- Test: `packages/core/test/tradeCode.test.ts`, `packages/core/test/fees.test.ts`

**Interfaces:**
- Produces:
  - `type Role = 'buyer' | 'seller' | 'mod'`; `const ROLES: readonly Role[]`
  - `newTradeCode(): string` — 16 Crockford base32 characters (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`) from `crypto.getRandomValues`, grouped `XXXX-XXXX-XXXX-XXXX`
  - `normalizeTradeCode(input: string): string | null` — uppercases, strips spaces and dashes, maps `O→0`, `I→1`, `L→1`, returns the grouped form, or `null` if not exactly 16 valid characters (`U` is invalid)
  - `X2F_FEE_BPS = 100n`; `feeFor(amountAtomic: bigint): bigint` — floor of amount × 1%, throws `RangeError` on negative

- [ ] **Step 1: Failing tests.**
  - `newTradeCode()` matches `/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/`; 10,000 calls give 10,000 distinct codes.
  - `normalizeTradeCode('k7m2 9qxa-4ftr8wpn') === 'K7M2-9QXA-4FTR-8WPN'`; `normalizeTradeCode('O1L0-0000-0000-0000') === '0110-0000-0000-0000'`; returns `null` for `'K7M2-9QXA-4FTR'`, for 17 characters, and for any input containing `U`.
  - `feeFor(1_250_000_000_000n) === 12_500_000_000n`; `feeFor(99n) === 0n`; `feeFor(0n) === 0n`; `feeFor(-1n)` throws `RangeError`.
- [ ] **Step 2:** `npm test -w @x2f/core`; expect FAIL (modules missing).
- [ ] **Step 3:** Implement the three files; export them from `src/index.ts`.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(core): trade codes and 1% fee`.

### Task 3: Signed, encrypted protocol envelopes (`@x2f/protocol`)

**Files:**
- Create: `packages/protocol/src/identity.ts`, `packages/protocol/src/envelope.ts`, `packages/protocol/src/replay.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/envelope.test.ts`

**Interfaces:**
- Consumes: `Role` from `@x2f/core`.
- Produces:
  - `interface Identity { signPublic: string; boxPublic: string; signSecret: Uint8Array; boxSecret: Uint8Array }` (hex public keys; Ed25519 signing; X25519 box keys derived with `crypto_sign_ed25519_*_to_curve25519`)
  - `generateIdentity(): Promise<Identity>`
  - `type Participants = Record<Role, { signPublic: string; boxPublic: string }>`
  - `interface Envelope { v: 1; trade: string; from: Role; seq: number; type: string; boxes: Partial<Record<Role, string>>; nonce: string; sig: string }`
  - `seal(a: { trade: string; from: Role; seq: number; type: string; payload: unknown; to: Role[]; me: Identity; participants: Participants }): Promise<Envelope>` — JSON payload, `crypto_box_easy` once per recipient with one random nonce, Ed25519 signature over the canonical JSON of every field except `sig`
  - `open(e: Envelope, a: { me: Identity; myRole: Role; participants: Participants; trade: string; guard: ReplayGuard }): Promise<unknown>` — throws `ProtocolError` with code `'bad-signature' | 'not-participant' | 'wrong-trade' | 'replay' | 'not-for-me'`
  - `class ReplayGuard { accept(from: Role, seq: number): boolean }` — accepts only a strictly increasing `seq` per sender; serialisable via `toJSON()` / `ReplayGuard.from(json)`

- [ ] **Step 1: Failing tests.** Round trip buyer→seller and buyer→{seller, mod}. Then each must throw the named code: one byte of a box flipped (`bad-signature`); signed by an identity not in `participants` (`not-participant`); opened with a different `trade` (`wrong-trade`); the same envelope opened twice (`replay`); opened by a role not in `to` (`not-for-me`). `ReplayGuard` round-trips through JSON and still rejects an old `seq`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with `libsodium-wrappers` 0.8.4 (await `sodium.ready`). Canonical JSON: keys sorted, no whitespace.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(protocol): signed, encrypted envelopes with replay guard`.

### Task 4: Regtest harness (`tools/regtest`)

**Files:**
- Create: `tools/regtest/fetch-monerod.sh`, `tools/regtest/regtest.ts`
- Test: `tools/regtest/regtest.test.ts`

**Interfaces:**
- Produces:
  - `fetch-monerod.sh`: downloads `monero-linux-x64-v0.18.5.3.tar.bz2` and `hashes.txt` into `.regtest/bin`, imports binaryFate's key from the monero repo, refuses unless the key fingerprint is exactly `81AC 591F E9C4 B65C 5806 AFC3 F0AF 4D46 2A0B DF92`, the signature on `hashes.txt` is good, and the tarball's SHA-256 matches the line in it. Idempotent.
  - `startRegtest(): Promise<{ rpcUri: string; stop(): Promise<void> }>` — fresh data dir under `.regtest/`, `--regtest --offline --fixed-difficulty 1`, a free port, waits for `/get_info`
  - `mine(rpcUri: string, blocks: number, address: string): Promise<void>`
  - `newTestWallet(rpcUri: string): Promise<MoneroWalletFull>` (MAINNET, `regtest: true`, in-memory)
  - `fundedWallet(rpcUri: string): Promise<MoneroWalletFull>` — new wallet, mines 80 blocks to it, syncs, unlocked balance > 0

- [ ] **Step 1: Failing test:** `fundedWallet()` has `getUnlockedBalance() > 0n`; a second `startRegtest()` runs alongside on a different port.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Vitest `globalSetup` runs `fetch-monerod.sh` once.
- [ ] **Step 4:** `npm run check`; expect PASS. Semgrep must accept the shell script (no `curl | sh`, quoted variables).
- [ ] **Step 5:** Commit `test: signature-verified regtest harness`.

### Task 5: `EscrowEngine` and the monero-ts implementation (`@x2f/escrow`)

**Files:**
- Create: `packages/escrow/src/engine.ts` (interface), `packages/escrow/src/monero.ts` (implementation), `packages/escrow/src/index.ts`
- Test: `packages/escrow/test/engine.test.ts`

**Interfaces:**
- Consumes: `Role`, `feeFor` from `@x2f/core`; regtest helpers from Task 4 (tests only).
- Produces:
  - `interface Payout { address: string; amountAtomic: bigint }`
  - `interface EscrowEngine { create(o: { daemonUri: string; password: string }): Promise<EscrowSession> }`
  - `interface EscrowSession { prepare(): Promise<string>; make(peers: string[]): Promise<string>; exchange(peers: string[]): Promise<{ hex: string; ready: boolean }>; address(): Promise<string>; sync(): Promise<{ balance: bigint; unlocked: bigint }>; exportState(): Promise<string>; importState(peers: string[]): Promise<void>; buildRelease(payouts: Payout[]): Promise<{ txSet: string; payouts: Payout[] }>; cosign(txSet: string, expected: Payout[]): Promise<string>; close(): Promise<void> }`
  - `class MoneroMultisigEngine implements EscrowEngine`
  - `buildRelease`: one `createTx` with the payouts in order and `subtractFeeFrom: [0]`, so the network fee always comes off the first payout (the trader), never the X2F fee output; `relay: false`; returns the multisig tx hex and the payouts as decoded by `describeMultisigTxSet`
  - `cosign`: decodes with `describeMultisigTxSet`, throws `EscrowError('payout-mismatch')` unless every destination address matches `expected` exactly, every amount except index 0 matches exactly, and index 0 is within 0.01 XMR below its expected amount (network fee); only then signs and submits, returning the tx hash
- Test fixture: build all three sessions in one process; rounds repeat `exchange` until every session reports `ready` (expect 4 message rounds total, as Phase 0 measured).

- [ ] **Step 1: Failing tests** (regtest):
  - Setup: three sessions agree on one address; `exchange` reports `ready` after the expected rounds.
  - Release with fee: escrow funded with 1.25 XMR; seller builds `[ {buyer, 1.2375 XMR}, {feeWallet, 0.0125 XMR} ]`; buyer cosigns; after 12 blocks the fee wallet has received exactly `12_500_000_000n` and the buyer between `1.2375 XMR − 0.01 XMR` and `1.2375 XMR`.
  - Taker-pays-nothing case: payouts `[ {buyer, 1.25 XMR} ]` only; buyer receives within 0.01 XMR of 1.25.
  - Swapped address: seller builds paying an attacker; buyer's `cosign` with the real expected payouts throws `payout-mismatch`; the attacker wallet receives nothing after 12 blocks.
  - Skimmed fee: builder raises the fee output by 1 atomic unit; `cosign` throws `payout-mismatch`.
  - One key alone: a session that submits its own unsigned tx set is rejected by the daemon.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** First confirm `describeMultisigTxSet` returns each destination's address and amount for an unsigned multisig release. If it does not, **stop and report**: the payout check is a security requirement and must not be skipped or weakened. Then implement on monero-ts 0.11.16 (`createWalletFull`, `prepareMultisig`, `makeMultisig`, `exchangeMultisigKeys`, `exportMultisigHex`, `importMultisigHex`, `createTx`, `describeMultisigTxSet`, `signMultisigTxHex`, `submitMultisigTxHex`).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(escrow): EscrowEngine with fee output and payout checks`.

### Task 6: Save and resume a session

**Files:**
- Modify: `packages/escrow/src/engine.ts`, `packages/escrow/src/monero.ts`
- Test: `packages/escrow/test/resume.test.ts`

**Interfaces:**
- Produces:
  - `interface SavedSession { v: 1; keys: string; cache: string }` (base64 of monero-ts `getData()` keys and cache; the wallet password encrypts the keys)
  - `EscrowSession.save(): Promise<SavedSession>`
  - `EscrowEngine.resume(saved: SavedSession, o: { daemonUri: string; password: string }): Promise<EscrowSession>` (`openWalletFull` with `keysData` and `cacheData`)

- [ ] **Step 1: Failing tests:** save the buyer's session after setup, close it, resume it: same address; it can co-sign a release built by the seller. Save after funding and resume: `sync()` shows the same unlocked balance. Resuming with the wrong password throws.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(escrow): save and resume sessions`.

### Task 7: The relay (`apps/relay`)

**Files:**
- Create: `apps/relay/package.json`, `apps/relay/src/server.ts`, `apps/relay/src/mailbox.ts`, `apps/relay/src/main.ts`
- Test: `apps/relay/test/relay.test.ts`

**Interfaces:**
- Consumes: `Envelope` type from `@x2f/protocol` (shape only; the relay never opens envelopes); `normalizeTradeCode` from `@x2f/core`.
- Produces:
  - `buildRelay(o: { maxEnvelopeBytes: number; maxQueuedPerTrade: number }): FastifyInstance`, defaults `262_144`, `1000`; `closeTrade(code: string): void` deletes that trade's queue
  - WebSocket route `GET /v1/trade/:code` with a `role` query. The relay forwards every envelope to the other connected parties of that trade, queues it for any that aren't connected, and delivers the queue in order on reconnect. It rejects (closes with code 4400) any envelope whose `trade` field differs from the path code, larger than the limit, or not valid JSON with the `Envelope` keys. Queues never expire on a timer: they are kept until the trade closes (completed, cancelled, refunded, or ended by a moderator's ruling), when `closeTrade` deletes them. Plan 3 calls `closeTrade` from the trade state machine.
  - `GET /healthz` → `200 {"ok":true}`
- Logging: connection counts and rejections only, never envelope contents, IPs or trade codes.

- [ ] **Step 1: Failing tests:** two clients exchange envelopes both ways; a client that connects late receives queued envelopes in order; wrong-trade, oversized and malformed envelopes close the socket with 4400; a queue survives 30 days offline (fake timers) and is deleted by `closeTrade`; the relay passes `boxes` through byte for byte.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement on fastify 5.12.5 with @fastify/websocket 11.3.1.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(relay): blind WebSocket relay`.

### Task 8: Party runner — the full protocol over the relay

**Files:**
- Create: `packages/escrow/src/party.ts`, `packages/escrow/src/transport.ts`
- Test: `packages/escrow/test/party.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6 and 7.
- Produces:
  - `interface Transport { send(e: Envelope): Promise<void>; next(): Promise<Envelope> }` plus `wsTransport(url: string): Promise<Transport>` (reconnects on drop)
  - `type Outcome = { kind: 'release'; to: Payout[]; builder: Role; cosigner: Role }`
  - `runParty(a: { role: Role; trade: string; me: Identity; participants: Participants; transport: Transport; engine: EscrowEngine; daemonUri: string; password: string; store: { load(): Promise<PartyState | null>; save(s: PartyState): Promise<void> } }): PartyHandle`
  - `PartyHandle`: `ready(): Promise<string>` (escrow address once setup completes); `settle(o: Outcome): Promise<string | null>` (tx hash for the co-signer, `null` for others); `stop(): Promise<void>`
  - `PartyState` records the stage, the saved session, the replay guard and the last round applied, so a restarted party never re-applies a round. Saved after every step.
  - Message types: `msig.prepare`, `msig.make`, `msig.kex.<n>`, `msig.addr`, `state.export`, `release.txset`, `release.done`.
- Rule: a party never acts on a message that fails `open`; it records the failure and keeps waiting.

- [ ] **Step 1: Failing tests** (regtest plus a real relay; three parties, each with its own engine and transport):
  - Normal release (seller builds, buyer co-signs, buyer paid, fee output present).
  - Mutual cancel (buyer builds, seller co-signs, refund to seller).
  - Dispute won by buyer (mod builds, buyer co-signs).
  - Dispute won by seller (mod builds, seller co-signs).
  - A fourth identity injects a validly shaped `msig.make` envelope: ignored, setup still completes.
  - A captured `msig.kex.3` envelope is replayed: rejected as `replay`, setup still completes.
  - The buyer is killed after round 2, restarted from its store with a new transport, and setup completes with the same address the others hold.
  - The seller is killed after `release.txset` is sent and restarted: the trade still settles exactly once.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(escrow): party runner over the relay with resume`.

### Task 9: Moderator auto-refund guard

**Files:**
- Create: `packages/escrow/src/autoRefund.ts`
- Test: `packages/escrow/test/autoRefund.test.ts`

**Interfaces:**
- Produces: `autoRefundDecision(t: { paymentDeadline: Date; markedPaidAt: Date | null; finalAlertAt: Date | null; now: Date; recordedRefundAddress: string; proposed: Payout[] }): { ok: true } | { ok: false; reason: 'window-open' | 'buyer-marked-paid' | 'final-alert-pending' | 'wrong-destination' }`. Allowed only when `now > paymentDeadline`, `markedPaidAt === null`, `finalAlertAt !== null` and `now ≥ finalAlertAt + 15 minutes`, and `proposed` is exactly one payout to `recordedRefundAddress`. `now` comes from the server clock only, never from a client.

Executing the refund (moderator service plus seller co-signing to the recorded address) is wired up in plan 3 with the trade timers; this task only decides.

- [ ] **Step 1: Failing tests:** one test per refusal reason, including `now` exactly at the deadline (refused) and 1 ms after 15 minutes from the alert (allowed); a second payout or a different address is `wrong-destination`; the allowed case returns `{ ok: true }`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(escrow): moderator auto-refund guard`.

### Task 10: Security review of the plan's code

**Files:**
- Create: `docs/security/plan-1-review.md`

- [ ] **Step 1:** Run the Claude Security scan over `packages/`, `apps/` and `tools/`.
- [ ] **Step 2:** Fix every confirmed finding in the task that owns the code, with a test that would have caught it; re-run `npm run check`.
- [ ] **Step 3:** Record the findings, fixes and anything accepted (with the reason) in `docs/security/plan-1-review.md`.
- [ ] **Step 4:** Commit `docs: plan 1 security review`.
