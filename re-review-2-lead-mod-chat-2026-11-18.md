# Re-review 2: wip/lead-mod-chat @82c8d4de (B1, M1, M2, m1-m6 fixes), 18 Nov 2026

Second security re-review for the lead. Range: 1abaa747..82c8d4de (4 commits), against my round-2 file `re-review-lead-mod-chat-2026-11-18.md` and decisions 6, 10, 11 and 13-15 in `docs/security/chat-membership-lead-decisions-2026-11-18.md`. Detached scratch worktree. No branch code changed; every probe below was scratch only and has been removed.

## Verdict: APPROVE WITH MINORS

- **B1 is fixed.**
  - The device key is a pair of non-extractable WebCrypto keys (Ed25519 and X25519). In a real browser under STAFF_CSP, page script finds no secret byte. Every export or wrap route is refused, and every cross-origin channel I tried is closed.
  - The custom crypto is correct: `hsalsa20` matches the NaCl reference vectors, and `openSealedWith` behaves exactly like `crypto_box_seal_open` on every truncation, every bit flip, and low-order and foreign boxes.
- **M1 and M2 are fixed.** Both of my original probes now pass.
- **m1-m6 are done.** For m3 and m4 that means written down as residuals in the decisions note.
- **Five minors are new**, none blocking. m1 (a transient 401 permanently stops a dispute's notice) should be fixed before landing, because it brings back the N3 dead end in a new form.
- Not run, as briefed: the full `npm run check`. The standing reviewer rule still asks for it under the lock before the lead lands this.

## Tests run (scratch worktree at 82c8d4de, `nice -n 10`)

| Suite | Files | Result |
|---|---|---|
| `@x2f/moderation`: internal, notices, gateDevices, grant, gateDeps, gate, shred, grants (no lock) | 8 | 141 passed |
| `@x2f/protocol` (whole project, incl. sealedWebCrypto) | 9 | 254 passed |
| `@x2f/staff-web` vitest (whole project, incl. workerBoundary with its build, deviceKey, keeper) | 18 | 145 passed |
| `@x2f/api`: staff/devices, disputes/staff, schema, staff/web, members, securityReset, chat, chatGrant | 8 | 234 passed |
| Playwright staff-web, under the lock, `-c apps/staff-web/e2e/playwright.config.ts --trace off` | 2 specs | 8 passed (11 with my three probes) |

### Guards reverted one at a time (each restored after)

| Guard | Reverted to | Failing test(s) |
|---|---|---|
| M2 | the `before-revoke-person` check disabled (devices.ts) | gateDevices: the M2 and M1 tests |
| M1 | reset and switch-on revoke as of `ctx.now()` (registry.ts) | gateDevices: the N5, M2 and M1 tests |
| m5 | the stop on a 4xx disabled (notices.ts) | notices: 2 m5 tests |
| m1 (round 2) | migration 716 commented out | chatGrant "re-review m1, migration 716 … 23514" |
| m2 (round 2) | (not reverted) | the test builds staff-web and checks the built chunks; read and run |

## B1: the WebCrypto device key and the hand-written crypto

**hsalsa20** (`packages/protocol/src/sealed.ts`, `hsalsa20`):
- *State layout:* σ in words 0, 5, 10, 15; the key in words 1-4 and 11-14; the input in words 6-9.
- *Rounds:* the Salsa20 quarter-round (7, 9, 13, 18), column then row, 10 double rounds.
- *Output:* words 0, 5, 10, 15, 6, 7, 8, 9, with no feed-forward.
- *Wrapping:* 32-bit arithmetic wraps through `>>> 0` and the Uint32Array stores.
- *Reference vectors, in a scratch test:*
  - NaCl `tests/core1`: HSalsa20(shared `4a5d9d5b…1742`, 0^16) = firstkey `1b275564…8389`. Passes.
  - NaCl `tests/core2`: HSalsa20(firstkey, `69696ee9…73d6`) = secondkey `dc908dda…6ce4`. Passes. This one checks the input-word path that `crypto_box_beforenm` never uses.
- Constant time: fixed-size, branch-free, table-free arithmetic. Fine for JavaScript.

**openSealedWith** (`sealed.ts`):
- The nonce is `crypto_generichash(24, epk || pk, null)`, which is libsodium's `crypto_box_seal_nonce`. pk is the recipient's own validated `boxPublic`.
- k = HSalsa20(shared, 0^16), then `crypto_secretbox_open_easy`. The shared secret and k are zeroed.
- An all-zero shared secret is refused. WebCrypto's X25519 `deriveBits` also throws on an all-zero result, and that is caught as `not-for-me`.
- Parity against libsodium, in a scratch test against `openSealed` (`crypto_box_seal_open`) on the same inputs, where both answered alike:
  - every truncation from 0 to 79 bytes;
  - all 640 single-bit flips;
  - a box one byte too long;
  - four low-order ephemeral keys (always `not-for-me`);
  - a box sealed to another key;
  - empty input.
- The input checks match too: bad `boxPublic` hex is a `TypeError`; a box shorter than 48 bytes is `not-for-me`.

**Signer and countersign:** `makeModCountersign` with a `Signer` checks the WebCrypto signature by `signPublic` before returning it, so a mixed-up key never sends anything. `deviceKeysMatch` checks the stored keys by use: one signature, and one X25519 against a fresh ephemeral key.

**The browser probes** (Playwright, real build, STAFF_CSP):
- *IndexedDB, the fixer's kept test:* store keys `['key']`; fields `box, boxPublic, sign, signPublic, v`; v 3; 0 bytes. Both keys are non-extractable; `raw`, `pkcs8` and `jwk` exports are all refused. Passes.
- *Probe B (mine):*
  - `structuredClone(key)` stays non-extractable, and its `pkcs8` export is refused.
  - `wrapKey('pkcs8', key, AES-KW)` is refused.
  - `window.open` to another origin (127.0.0.1): the opener handle is `closed: true`, because COOP `same-origin` severs it, so a `postMessage(key)` goes nowhere.
  - A cross-origin iframe is blocked (no `frame-src`, so `default-src 'none'`), and its window is a `SecurityError`.
  - A `blob:` worker is refused (`worker-src 'self'`).
  - No channel carries a CryptoKey to another origin.
- *Probe D, a v1/v2 record:* planting `{v:2,…}` makes the worker replace it with a fresh key **made in the worker**, never the planted public keys. This is safe: the page learns nothing of the new key, which still needs a tap to be certified. Worst case is denial of service plus a re-confirm.
- *Probe C, a v3 record the page plants:* see m3. Page script can store **its own** key pair as a v3 record: extractable keys generated, the PKCS#8 bytes kept, then re-imported non-extractable. The worker accepts it (`deviceKeysMatch` passes), and DeviceCard offers exactly that key for "Confirm this device" (`plantedOffered: true`).

## M1, M2: `devicesRevokedAt`

- My original probes now pass:
  - P1 (M2): a certify tap pending from before a switch-off is not live after the off/on sync (`before-revoke-person`).
  - P2 (M1): the same key certified again after a reset, before the gate syncs it, is live.
- The watermark is raised by every whole-person revocation (`revokeDevicesOf`, now also on the not-standing sweep), and only ever forward.
- Signed-time marks (switch-on, reset) never exceed the API's own `ended`. The reset tap's issuedAt is at or before its `used_at`, and old-key taps no longer verify after the reset. So no new dead end comes from those.
- One new dead end, under clock skew (m2 below).

## m5 and m6

- **m5.** Migration 021 (`refused_status`, `alerted_at`) is correct, and 021 collides with nothing:
  - main, wip/lead-train-1 and wip/lead-ruling-compliance end at moderation 008;
  - this branch has 016-021.
- `chat-notice-stopped` is strictly validated: exact keys, a normalized trade code, seq ≥ 1, status 400-499. It raises one owner-only alert, `chat-notice-refused`, with COPY-UNSIGNED copy. That report is retried until 201, and the notice itself is never posted again.
- A compromised API could answer a 4xx to stop notices, but it could already refuse forever. See m1 for a 401.
- **m6.** STAFF_CSP is now `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. Only `worker-src` was added. The e2e now collects CSP violations and errors inside the worker too, and the `blob:` worker probe is refused.

## Findings

**m1. `apps/moderation/src/notices.ts` (the 4xx stop): a transient 401 stops a dispute's notice for good.** The API's internal listener answers 401 for transport authentication: `stale` (clock skew between moderation and the API over `INTERNAL_MAX_AGE_MS`), `replay`, and `bad-signature` (for example during an HMAC key rotation). See `apps/api/src/internal/routes.ts`, lines 164-180.
- Failure scenario: moderation's clock drifts, or the key is being rotated, while disputes open.
- Each candidate's notice gets 401 and is marked `refused_status = 401`. It is never posted again, even after the clocks agree.
- No moderator can then read those chats unless a trader grants (T1). The owner alert arrives later, but the owner has no way to re-trigger the notice.
- This is the N3 dead end again, for a transient cause.
- Fix: treat 401 (and 408) as retryable, like 409, 429 and 5xx. Add a test: 401, then 201, posts the same notice.

**m2. `apps/moderation/src/gate/devices.ts` (`before-revoke-person`): a mark set by the gate's clock has no skew allowance, unlike `before-off`.**
- The marks from switch-off and removal are the gate's sync time, while certifications are stamped by the API's clock.
- Failure scenario (scratch gate test P3), with the gate's clock 10 s ahead of the API's:
  1. The gate sees the switch-off.
  2. The owner switches the person on.
  3. The person confirms a fresh browser 5 s after the switch-on.
  4. The gate refuses it with `device-before-revoke-person`, though `before-off` (with its 2 minutes) would pass it.
  5. The API lists the device live (issuedAt > `last_switched_off_at`). The read is 403, and confirming again is 409 `device-exists`.
- It is narrow, because NTP-synced hosts differ by under a second, but it is the same dead-end class.
- Fix: for a mark set by the gate's own clock, use `min(gate now, the API row's switched-off time)` when the row carries it, or keep those marks in `offSeenAt` (which has the skew allowance) and leave `devicesRevokedAt` to signed times only.

**m3. Decision 11 overstates "it cannot carry them away": page script can plant its own key and get it certified with one routine-looking tap** (probe C; `apps/staff-web/src/keys/deviceKey.ts`, `staffDeviceKey`).
- Failure scenario:
  1. An XSS stores a v3 record holding a key pair whose PKCS#8 bytes it kept.
  2. The moderator's case page shows "Confirm this device" again, and they tap.
  3. The attacker now holds a certified device key's bytes elsewhere for 365 days. With a staff session, or a compromised API, it opens later re-wraps and countersigns.
- This is inherent: page script on the staff origin can always drive a certify tap with keys of its own, because the dialog is the page's. B1's storage cannot prevent it.
- Fix: state it in decision 11 ("one moderator tap on a planted key gives a long-lived device"). Optional hardening, owner's call:
  - an owner alert, or a line on the person's own sign-in page, for each `staff.device-certified`;
  - a list of certified devices, with their dates, in staff-web.

**m4. `sealed.ts` (`openSealedWith`): `shared.every((b) => b === 0)` stops early on a secret value.** It leaks, by timing, where the first non-zero byte of an X25519 output on an attacker-chosen point is. This is negligible in practice: it is local, noisy, and WebCrypto throws on all-zero anyway. Fix: OR-accumulate (`let z = 0; for (const b of shared) z |= b;`), as libsodium's `sodium_is_zero` does.

**m5. `packages/protocol/test/sealedWebCrypto.test.ts`: `hsalsa20` is checked only through `crypto_box_beforenm`**, which never exercises a non-zero input. A bug in the input words (6-9) would pass. Fix: add the NaCl core1 and core2 vectors above. I ran them, and they pass.

## Owner and lead questions

1. **m3:** add an owner-visible notice for every staff device certification? Recommend yes: it is the one signal against a planted key that does not depend on the page.
2. Before landing: the full `npm run check` under the lock (the standing reviewer rule).

## Scratch probes (not committed)

- Gate: `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/rr2-zzProbe.test.ts` (P1, P2, P3).
- Crypto: `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/rr2-zzRr2.test.ts` (the vectors and the parity sweep).
- Playwright probes B, C and D were appended to `moderator.spec.ts` for the run and then reverted. They are described above.
