# Re-review: wip/lead-mod-chat @1abaa747 (tasks 3-10, N1-N11 fixes, chat key worker), 18 Nov 2026

Independent security re-review for the lead. Range read: 6695ff61..1abaa747 (11 commits: N1-N11, design task 10, the CSP call), against the t7-9 review (N1-N11) and the t3-6 review, and `docs/security/chat-membership-lead-decisions-2026-11-18.md` on the branch. Detached scratch worktree at 1abaa747. No code changed or committed; the probes below were run in the scratch worktree only and then removed.

## Verdict: CHANGES NEEDED

What is fixed:
- N1 to N11 are all fixed as described. Every guard I reverted (8 of them, one at a time) made its own test fail.
- The countersign, the notice re-post, the device counter order and the per-sender gaps are right.
- The page bundle carries no libsodium and no key code. The worker is its own chunk, served under STAFF_CSP.
- The CSP change is exactly the one directive.

What blocks:
- **B1.** Task 10 does not reach its own goal. Page script can still take the device's long-term secrets away. The device record and its non-extractable AES wrap key both live in IndexedDB, and IndexedDB is shared by the page and the worker (same origin). I proved this in a real browser under STAFF_CSP. So the N10 attack stands unchanged, and the residual in decision 11 is not true.
- **M1.** N4 is not closed for a security reset when the same browser key is certified again before the gate syncs. The result is a permanent dead end: the API says the device is live, the gate refuses it, and certifying again gives 409. Proved with a gate test.
- **M2.** The N5 fix revokes the devices that are already certified. It does not stop a certify tap that is still pending from before the switch-off. That device becomes live in the gate when the person is switched back on. Proved with a gate test.

## Tests run (scratch worktree at 1abaa747, `nice -n 10`)

| Suite | Files | Result |
|---|---|---|
| `@x2f/moderation`: internal, notices, gateDevices, grant, gateDeps, gate, shred, grants | 8 | 137 passed |
| `@x2f/protocol` (whole project, incl. chatV2, identity) | 8 | 249 passed |
| `@x2f/staff-web` vitest (whole project, incl. workerBoundary, keeper, modCaseChat, caseChat, deviceCard, buildEnv) | 18 | 143 passed |
| `@x2f/api`: staff/devices, disputes/staff, schema, staff/web, staff/members, staff/securityReset, chat, chatGrant | 8 | 232 passed |
| Playwright staff-web, under the lock (`-c apps/staff-web/e2e/playwright.config.ts --trace off`) | 2 specs | 7 passed (plus my probe, 8/8) |

Not run: the full `npm run check` (as briefed), regtest, and the trader web app suites.

### Guards reverted one at a time (each restored after)

| Guard | Reverted to | Failing test(s) |
|---|---|---|
| N7 | nonce dropped from `countersignBytes` (chatV2.ts) | chatV2 "binds the channel, seq, nonce …" |
| N6 | early `mod_countersign_requests` insert removed (server.ts) | internal: 2 tests, incl. "review N6 … refused as replayed" |
| N3 | a recorded notice is never re-posted (notices.ts) | notices: 2 tests, incl. "review N3 … posted again, identical" |
| N5 | switch-on `revokeDevicesOf` removed (registry.ts:402) | gateDevices "review N5 …" |
| N8 | `syncDevices` without the counter view (registry.ts) | gateDevices "review N8 … in counter order" |
| N2 | gap forced to 0 (reader.ts) | caseChat and modCaseChat: 4 tests |
| N1 | key forgotten on every `opened` change (ModCase.tsx) | modCaseChat "review N1: two messages in a row" |
| N4 | the `ended` cut in `liveDevices` disabled (devices.ts:83) | staff/devices: 2 tests |
| N11 (a) | migration 716 commented out | **nothing fails** (m1) |

## N1-N11 status

| | Status | Note |
|---|---|---|
| N1 | Fixed | The key is wiped on unmount only (a ref). The component test sends twice and checks the wipe on unmount. |
| N2 | Fixed | The last seq is kept per sender over verified envelopes only; a gap on an envelope that is not a line is carried to the next line. Tests cover a dropped middle line and a dropped first line. |
| N3 | Fixed | Migration 020. The same signed notice is re-posted until 201, and no second notice is ever signed. A pre-020 row is never signed again. See m5. |
| N4 | Fixed for switch-off and removal; **not for a reset** | See M1. ModCase routes `device-not-certified` back to DeviceCard. |
| N5 | Fixed for applied devices; **not for pending taps** | See M2. |
| N6 | Fixed for what reaches moderation | The requestId is burned once the countersign verifies. See m3 for the variant the API alone can play. |
| N7 | Fixed | The nonce is in the signed body, and the strict key set has `nonce`. |
| N8 | Fixed | The pre-sync mark, the counters taken by the registry this sync, and counter order. The device-tap `out-of-order` test was added. |
| N9 | Unchanged (INFO, accepted) | |
| N10 | **Not achieved** | See B1. |
| N11 (a) | Fixed, untested | The commit says "a staff row with a statement is 23514"; there is no such test. See m1. |
| N11 (b)-(f) | Fixed | (b) `attestationKeys()` with a rotation test. (c) The tkh is compared before every seal. (d) `identityKeysMatch`, including X25519. (e) `retireStaffCopies` on revoke, switch-off, removal and reset. (f) The newest 5000 envelopes and `olderNotShown`, believed only when exactly 5000 come back. |

## The fixer's security decisions

- **N4, no clock skew in `liveDevices`: agree.** The API compares its own times against `issuedAt`, which is also stamped by the API's clock, so a strict comparison is right. A skew would list a device the gate has already revoked, which is the N4 dead end again. The gap that remains is on the gate's side, not here (M1).
- **N5, revoke as of the switch-on's signed issuedAt: agree.** With `now`, a device certified after the switch-on but before the sync would be refused `before-revoke` while the API lists it live. The fixer's own reasoning is correct. But revoking only the existing devices leaves the pending-tap hole (M2).
- **N6, burn the requestId before the freshness and seq checks: agree.** A verified countersign is single use whatever comes after it. The only thing this costs is that a transient failure after the burn needs a re-seal, and staff-web always seals a retry with a new requestId. It does not stop the API from holding an un-forwarded countersign (m3), but nothing on moderation's side could.
- **N11 (e), rows marked removed but reads not refused on that basis: agree.**
  - Moderation's device check is the security boundary. An API-side refusal adds nothing against a compromised API.
  - Keyed by person, it would wrongly lock out a newly certified device. Keyed by device, it duplicates `liveDevices`.
  - Optional defence in depth: check the API's own `liveDevices(me, deviceKeyId)` before logging `chat.read`. That would also stop an honest API from relaying M2's device.
- **N11 (f), the 5000-envelope cap: agree.**
  - The API cannot forge envelopes. To set `olderNotShown` it must return exactly 5000 genuine ones.
  - Inside the window, gaps after each sender's first shown line are still detected.
  - What the API can still hide, only in chats over 5000 envelopes: each sender's lines between the window start and their first shown line, plus the tail (already a residual). That is the inherent price of a cap. Chats that long are not expected.
- **Task 10, a 10-minute worker seal clock: agree with the number, not with the stated residual.**
  - The worker accepts `issuedAt` within ±10 minutes of its own clock. Moderation accepts it from 5 minutes back to 1 minute ahead.
  - So a page script can mint a countersign dated now+10 minutes, which is usable from about +9 to +15 minutes, after the page is closed.
  - A tighter bound would break moderators whose local clock is off, because staff-web seals at the server-corrected time. Ten minutes is a fair trade.
  - Decision 11 should say "up to about 15 minutes after the page closes", not "cannot countersign after the page closes" (m4). B1 makes this bound moot until it is fixed.

## Task 10 and the worker boundary

What holds:
- The page's import graph reaches no `src/keys/`, no `@x2f/protocol` and no libsodium. The built `index-*.js` has no libsodium (0 hits). `chatWorker-*.js` is a separate chunk, started with `new Worker(new URL(...), { type: 'module' })`.
- The protocol has five ops. Errors return a code only. Replies are the device's public halves, the `ChatView` (lines, counts, an opaque 128-bit handle), and a `SealedModMessage` (ciphertext and countersign). No op returns TK, a wrap opened or a secret.
- `seal` validates the handle (32 hex, and it must be held), `issuedAt` (ISO with milliseconds, within ±10 minutes) and `seq` (a safe integer ≥ 0). The text rule is re-checked in `sealModMessage`.
- `open` re-verifies everything: the attestation against the worker's own pinned keys, the trader-signed record's tkh, the wrap to this device's box key, and every envelope. A page cannot craft an answer that opens. It can wrap a key of its own to the public `boxPublic`, but it cannot get a trader-signed record with that tkh. `open` does no shape validation of `answer`, but a malformed one only throws `fault` (harmless).
- Pinned keys: `attestationKeys(import.meta.env.VITE_MOD_SIGNING_PUBLIC)` inside the worker chunk, fixed at build time, with `checkBuildEnv` failing a production build that lacks the key. The page has no way to supply them.
- Zeroing: TK is a `Uint8Array` filled on `forget` (screen unmount) and on `forget-all` (`pagehide`). The opened identity and the decrypted `plain` are zeroed after each use. Not zeroed: libsodium's own WebAssembly heap copies (m4) and anything left when the browser kills the worker (already stated).

What fails:
- **B1, below.** Because the IndexedDB record is reachable from the page, the real boundary is only as strong as same-origin storage, which is none.
- **workerBoundary.test is real but incomplete (m2).** It walks relative imports and checks only the page's **direct** package imports. A package the page does import (`@x2f/trade`, through apps/web's `cantDoCodes`) could pull in `@x2f/protocol` and libsodium transitively, and the test would still pass. Only tree-shaking keeps them out today.

## CSP

- STAFF_CSP at 1abaa747 is `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. The diff 6695ff61..1abaa747 changes `script-src` only. Every other directive is unchanged and still strict: no `unsafe-inline` anywhere, no other origins.
- `web.test` pins `script-src` to exactly the two sources and forbids `'unsafe-eval'` and `'unsafe-inline'` anywhere.
- The worker: there is no `worker-src`, so it falls back to `child-src`, then `script-src`, which is `'self'` only (no `blob:`, no `data:`). The worker script is served by `serveStaffWeb` under the same hooks, so the worker's own response carries STAFF_CSP (`e2e/serve.ts` sets it on every answer), and its WebAssembly compiles under `'wasm-unsafe-eval'`.
- The e2e reports no CSP violation, but it listens on `document` only. A violation inside the worker would show only as a functional failure, which the e2e would catch (m6). Optional: add an explicit `worker-src 'self'`, as the trader app's policy has (m6).

## Replays (countersigns and notices)

- **Countersign.**
  - Replaying the same countersign: refused (`replayed`), now including one that was refused once.
  - Reordering: impossible, because seq is signed and must be exactly next under `for update`.
  - Swapping the nonce: `bad-countersign` (N7).
  - Seq forgery: the seq is in the device signature and in moderation's own envelope signature.
  - Staleness: 5 minutes back, 1 ahead.
- **The API's own stale-seq (m3).** A compromised API can still withhold a countersign and fake a 409 `stale-seq`. staff-web then re-seals the same text at the API's `nextSeq` with a new requestId. The API forwards both, and the traders see the moderator's message twice, in seq order, within 5 minutes. Impact: a duplicate only, no forged content. This is the N6 scenario played entirely by the API.
- **Notices (N3 re-post).**
  - The re-post is byte-identical: the stored jsonb is the signed notice. It happens only while the API lists that exact `(chat, disputeSeq)` and `posted_at` is null.
  - A notice for an earlier dispute seq is never re-posted for a later one, because the row is keyed by seq.
  - A replayed notice gives an attacker nothing: the API files a notice only when it names the current open dispute exactly, and the device verifies it itself.
  - The race between two passes resolves to the one recorded notice (`insert … on conflict do nothing` then select).
  - See m5 for re-posting forever after a permanent 4xx.

## Migrations

- API 715 (`last_switched_off_at`, backfilled from `switched_off_at`, never cleared) and 716 (`check (member_kind = 'mod' or statement is null)`) are correct. Existing staff rows carry no statement, so 716 applies cleanly.
- `greatest()` in `devicesEndedAt` ignores NULLs, as needed.
- On removal, `last_switched_off_at = coalesce(switched_off_at, now)` keeps the original off time, and `removed_at` is in the `greatest()` anyway.
- Moderation 020 is two nullable columns, correct.
- No number collides:
  - main (merge base 75f7b5b4, and origin/main now) ends at API 701 and moderation 008.
  - wip/lead-train-1 has 701 and 702.
  - wip/lead-ruling-compliance has 740.
  - This branch has API 710-716 and moderation 016-020. The 009-015 gap was already there at t3-6.
- The schema test lists 715 and 716 in all three lists.

## Findings

**B1. HIGH: page script can decrypt the device record from IndexedDB, so task 10 does not keep the device secrets from the page.**

`apps/staff-web/src/keys/deviceKey.ts:66` (the wrap key: `generateKey(..., false, ['encrypt','decrypt'])`), `:50` (the constant AAD), `:116` (`indexedDbDeviceBackend`, database `x2f-staff-device`, store `device`). The residual claim is at `docs/security/chat-membership-lead-decisions-2026-11-18.md:150`.

A dedicated worker has the page's origin, so the page sees the same IndexedDB. "Non-extractable" stops `exportKey`; it does not stop `decrypt`.

Proof: a probe added to the staff-web Playwright spec, under STAFF_CSP and in the real build. After DeviceCard loaded, `page.evaluate` opened `x2f-staff-device`, read `wrap` and `key`, and ran `crypto.subtle.decrypt({name:'AES-GCM', iv, additionalData: 'x2f-staff-device/v2'}, wrap, ct)`. Output: `PROBE {"len":96,"match":true}`. That is the 64-byte Ed25519 secret and the 32-byte X25519 secret, and bytes 32-64 equal the stored `signPublic`.

Failure scenario: one XSS or malicious extension on the staff origin, once.
1. It reads the 96 secret bytes and sends them out.
2. With the moderator's staff session (or a later one, since the device stays certified), it calls `POST /staff/v1/disputes/:code/chat` itself. The answer carries `wrap`, so with the box secret it opens TK for every case the moderator is on, now and for up to 365 days.
3. It countersigns as the device for 365 days, until the device is revoked.

This is exactly N10, and the reason the t7-9 review said not to go to production before task 10.

Fix (the trade-off is the lead's or the owner's):
- Keep the device keys as **non-extractable WebCrypto Ed25519 and X25519 `CryptoKey`s** in IndexedDB. Chromium, Firefox and Safari all ship both now.
- The countersign becomes `subtle.sign('Ed25519', …)`, with the same bytes and a byte-compatible signature.
- Opening the re-wrap becomes `subtle.deriveBits({name:'X25519', public: ephemeral}, boxKey, 256)`, then libsodium's `crypto_box_beforenm` steps (HSalsa20) and XSalsa20-Poly1305 in the worker, the same as `crypto_box_seal_open`.
- Page script can then still use the keys while it runs (the stated residual), but it can no longer carry them away.
- `generateIdentity` for staff devices moves to WebCrypto `generateKey(..., false, ...)`. Record v3; v2 never landed.
- Test: a Playwright check that page script cannot recover any secret bytes. Both `exportKey` and `decrypt` must fail, and the stored record must hold only `CryptoKey`s.

If the lead accepts the risk for now instead, decision 11 must be rewritten. It currently says the secrets cannot be taken away, and that is false.

**M1. MEDIUM-LOW (liveness): after a security reset, the same browser key certified again before the gate syncs the reset is a permanent dead end.**

`apps/moderation/src/gate/registry.ts:308` (the reset revokes as of `ctx.now()`, the gate's sync time), `apps/moderation/src/gate/devices.ts:165` (`before-revoke`), `apps/api/src/staff/devices.ts:48` and `:83`.

The API ends devices at the reset tap's `used_at`. The gate revokes at its own sync, which can be later. Staff-web keeps the same device key in IndexedDB across a reset.

Failure scenario:
1. The owner taps a reset at T.
2. The person re-enrolls and confirms the same browser at T+60 s.
3. Moderation's next sync is later, for example after a restart or downtime, or just the 60-second timer.
4. In that one sync the reset revokes the old record at S > T+60 s, and step 5 then refuses the new certification (`device-before-revoke`).
5. The API lists the device live (issuedAt > `used_at`). The read gets 403 `device-not-certified`. DeviceCard asks to confirm again. `POST /staff/v1/devices` answers 409 `device-exists`.
6. There is no revoke screen, so this browser can never read a chat again.

Proved with a gate test: `gate.refused.device-before-revoke`, and the device is not live.

Fix:
- Revoke on reset as of `min(reset tap's signed issuedAt, now)`, as N5 does. The person is disabled from the reset tap onward, and old-key taps no longer verify (`s.creds = []`), so nothing legitimate falls between.
- Test: reset, then the same key certified before the sync, and it is live in both views.

**M2. LOW-MEDIUM (security): a certify tap made before a switch-off, not yet synced, is certified live by the sync that applies the switch-on.**

`apps/moderation/src/gate/registry.ts:402`, `apps/moderation/src/gate/devices.ts:156`.

`revokeDevicesOf` touches only devices already in `g.devices`. `before-off` works only when the gate saw the switch-off (`offSeenAt`). Off and on between two syncs leaves nothing to compare against.

Failure scenario:
1. An attacker briefly has the person's session and key and taps `certify-device` for an attacker device.
2. The owner notices and switches the person off at +30 s, then back on at +60 s, all before the gate's next sync.
3. At that sync, step 2 applies the switch-on, which revokes only the old devices. Step 5 then certifies the attacker's pending tap (issued before the off, within 24 hours): live in the gate.
4. The API does not list it (`issuedAt` < `last_switched_off_at`), but the gate is the judge.
5. A compromised API, or this API's read route, which does not check its own device view, can have TK re-wrapped to that device.

This is the exact case N5 was raised for ("a device that was the reason for the switch-off survives"), one step earlier. Proved with a gate test: `deviceLive` is not null after the off/on sync.

Fix:
- Keep a per-person watermark, `s.devicesRevokedAt`, set by every `revokeDevicesOf` (switch-on, reset, switch-off seen, removal).
- Refuse a `certify-device` whose `issuedAt` is not after it (`before-revoke-person`).
- Test: the probe above.

**m1. `apps/api/migrations/716_chat_members_statement_mod.sql:6`: N11 (a) has no test.** With 716 commented out, schema.test and the whole API run still pass. The commit message names a 23514 test that does not exist. Failure scenario: someone drops or loosens the constraint later and nothing fails, so a staff row's statement could leak through the 714 column grant. Fix: insert a `staff` row with a statement and expect 23514.

**m2. `apps/staff-web/test/workerBoundary.test.ts:65`: the boundary test does not follow packages transitively.** Failure scenario: `@x2f/trade` (which the page imports) starts to import `@x2f/protocol` at module top with side effects. libsodium then lands in the page bundle and the test stays green. Fix: also assert on the built bundle, either in the Playwright run, which already builds, or in a build test. `index-*.js` must contain no libsodium marker (for example `crypto_box_seal` or `libsodium`), and the worker chunk must.

**m3. `apps/staff-web/src/screens/ModCase.tsx:369`: the API alone can double a moderator message.** Failure scenario: the API holds countersign A (seq s) and answers a fake 409 `stale-seq` with `nextSeq: s+1`. staff-web re-seals A′ at s+1. The API forwards A, then A′, and both traders see the message twice. Fix, if wanted: sign `supersedes: <previous requestId>` into the retry's countersign, and have moderation burn that id too, so the held A is then `replayed`. Or accept it as a duplicate-only residual and write that in decision 6.

**m4. `apps/staff-web/src/keys/keeper.ts:26` and `:89`, and decision 11: the residual is stated too narrowly.** A page script can mint countersigns usable up to about 15 minutes after the page closes (the worker allows +10 minutes, moderation allows +1 and −5). libsodium's WebAssembly heap keeps copies of TK and the secrets, which `fill(0)` does not reach. Fix: state both in decision 11. Optionally call `sodium.memzero` where the API allows it.

**m5. `apps/moderation/src/notices.ts:108`: a notice the API refuses for good (a 4xx) is re-posted on every pass, forever, while the candidate is listed.** Failure scenario: a bug or a millisecond mismatch in the API's `openedAt` for the same seq. The re-post is refused every pass and logs `chat-notice-report-refused-4xx` each time, and that dispute never gets a notice anyway. Liveness and log noise only. Fix: re-post on 5xx and network errors only, and on a 4xx log once and stop. Or cap the attempts and raise an owner alert.

**m6. STAFF_CSP has no explicit `worker-src`, and the e2e CSP watcher listens on `document` only** (`apps/api/src/staff/app.ts:83`, `apps/staff-web/e2e/moderator.spec.ts:389`). It is correct today, because the fallback is `script-src 'self'`. Add `worker-src 'self'` as the trader app's policy has, so that a later `script-src` change cannot silently widen workers (for example to `blob:`). Optionally, have the worker report its own `securitypolicyviolation` events.

## Exact fixes, in order

1. B1: device keys as non-extractable WebCrypto Ed25519 and X25519 keys; the re-wrap opened through X25519 `deriveBits` in the worker; a Playwright test that page script recovers nothing. Or, if the lead accepts the risk for now, an explicit written acceptance with decision 11 corrected, and the feature kept off in production.
2. M1: the reset revokes as of `min(issuedAt, now)`, plus a test.
3. M2: the per-person device watermark, plus a test.
4. m1 and m2 tests; m4 wording in decision 11; m3, m5 and m6 at the builder's or lead's choice.
5. Before APPROVE: the full `npm run check` under the lock, and the staff-web Playwright run again.

## Owner and lead questions

1. **B1:** fix it now with WebCrypto keys (recommended, because it is what task 10 was for), or land with the page-memory and IndexedDB risk accepted, and the feature off in production until it is fixed?
2. **m3:** is a moderator message that the API can duplicate (never forge) an acceptable residual? Recommend: yes for now, recorded in decision 6.

## Probes used (scratch only, not committed)

- `rerev-zzProbe.test.ts` (moderation, beside gateDevices.test). P1: certify pending, then switch-on issued at +60 s, then sync at +2 minutes: the device is live (M2). P2: certify and sync, reset, then the same key certified at +60 s, then sync at +3 minutes: `device-before-revoke` (M1).
- A Playwright test appended to `moderator.spec.ts`: page script decrypts the IndexedDB record and prints `{"len":96,"match":true}` (B1).
