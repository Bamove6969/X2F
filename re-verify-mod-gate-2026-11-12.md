# Re-verify: mod-gate (Plan 4 Task 13), 2026-11-12

This file is not committed. It checks the fixes against `review-mod-gate-2026-11-12.md`.

- **Re-verified:** `origin/wip/lead-mod-gate` = **23e36785** ("review P4 closed: owner registry taps carry a signed issuedAt"). It is rebased onto `wip/lead-rulings` **41f0021a** (the merge-base is 41f0021a). The fix commits are 4d12bf3b/fcfba839 (B1, B2, M1–M3, I1–I3), ea7255f3/013a94dd (evidenceSha256) and 31308fcd/23e36785 (issuedAt).
- **Threat model:** as in the first review. The API and its database are fully compromised. `gate.bin`, MOD_KEYSTORE_KEY and the owner's and honest staff's keys are not.

## Verdict

**Not ready.** One item is new and blocking, two are open owner questions, and the new issuedAt has its own hole.

- B2, M2, M3 and I3 are fixed.
- I2 is fixed for the parser. The remaining differences all fail closed.
- B1 is fixed for expired invites, invites the database later points at another account, and keys added after joining. A DB-only takeover of an open invite remains, and that is the owner question (`staffKeyAccepted`).
- P4 and P5 are closed as written. But the new signed `issuedAt` is stamped by the API, and **the gate puts no bound on it**. A compromised API can stamp a far-future issuedAt on any real owner tap. That tap then pins its subject: every later owner change to the limit, to someone's role, or to the gate's emergency stop is ignored. This survives recovery from the compromise, because the stamp lives in `gate.bin` (N1–N3b, blocking).
- A design gap I missed in round 1 also needs the lead and the owner: the staff site cannot check what a tap signs (X1).

## Item by item

| Item | Status | Evidence |
|---|---|---|
| B1 invite takeover | **Partly fixed** | Flipped P1 (expired invite) and P2 (key after joining) refuse; the branch's re-point test also passes. **Open:** an *unexpired* invite whose `account_id` the database fills first with its own account and attested key still gives the attacker the tapped role (the "B1 residual" PoC fails). This is the owner question already in the code (NEEDS_OWNER_STAFF_KEY_TAP, `staffKeyAccepted`); I recommend the `add-staff-key` owner tap. |
| B2 R37 | **Fixed** | `round1Id` is in the signed ruling intent (`tapChallenge` and `parseKeyTapIntent` enforce it). The gate requires round 1 in `rulingsSeen` with the same code and round 1, and the log can only add people. Flipped P3 refuses (`round1-unseen`, and `involved` with the real id). |
| M1 held-back taps (P4/P5) | **Fixed as written; see N1–N7** | Flipped P4 (switch-on withheld 30 min, no other tap by that key) and P5 refuse. The counter high-water marks work. |
| M2 concurrent saves | **Fixed** | `exclusive` wraps sync, authorize and save. `save` is serialised, uses unique `wx` temp files, and fsyncs the file and the directory. The branch's M2 test passes. One leftover: a sync that throws halfway leaves the in-memory state partly applied until the next save. Acceptable. |
| M3 settle tripwire | **Fixed** | Walks `gate/` and `cli/` recursively, strips comments, allows only type imports from escrow, and bans party/desk/watcher/main imports. Small gap: a dynamic `import('@x2f/escrow')` is not caught (its regex lists only party/desk/watcher/main). I grepped again: nothing in `gate/` or `cli/` calls `settle`. |
| I1 tapped remove / stop | **Fixed, but see N2** | `remove-staff` is applied in any order and latches `removedIds` (which also blocks re-invites). `emergency-stop` refuses every ruling (`stopped`). |
| I2 allowlist parity | **Fixed for the parser** | `parseGateAllowlist` and the API's `parseAllowlist` both normalise CRLF, and a parity test runs them on shared fixtures. Still different, all failing closed: the gate requires `fmt === 'packed'`, it does not check `nextUpdate`, and nothing ties `MOD_FIDO_MDS_DIR` to the API's snapshot. |
| I3 recordedTerms | **Fixed** | Refuses a poster mismatch or an amount below the attested take amount. |
| evidenceSha256 | **Fixed, one minor** | Every tap must agree with `evidenceSha256(dispute_rulings.evidence)`, hashed by the gate in JS; 211 grants `evidence`. **Minor (new, M-R1):** the reason's hash is still computed *by Postgres* (`encode(sha256(convert_to(reason,'UTF8')),'hex')`), so a compromised database returns whatever `h` the taps signed while storing another reason. Read `reason` (already granted) and hash it in JS, as evidence now is. |
| P6 / I4 missing gate.bin | **Open (info, not in fix list)** | Flipped P6 fails: a deleted `gate.bin` still opens as an empty gate that can be pinned again. Needs host access. |

## New findings

### X1 (blocking, design): the owner signs blind, so a compromised API can turn any owner tap into any registry intent
`KeyTapDialog.tsx` sends the intent to `POST /staff/v1/taps/start` and passes the returned `options` straight to `startAuthentication`. The client is never given the nonce or the server-stamped `issuedAt`, so it cannot check that `options.challenge == tapChallenge(intent, nonce)`; a security key shows nothing of what it signs.

Scenario: a compromised API answers the owner's "approve ruling" (or any) tap with a challenge for `settings {largeTradeLimitUsd: 1000000}`, a `create-invite` for its own account, or a `switch-on`. The owner's key signs it, the gate verifies a genuine owner signature and applies it. Every owner-rooted rule in the gate (limit, roles, invites, switch-on, stop/resume, and half of `add-owner-key`) then rests on the API being honest at tap time, which is exactly what the gate assumes away.

This was already true at f4b486ab; I missed it in round 1. It is the root of N1–N3 too.

Fix (lead/owner call):
- `taps/start` returns `nonce` and `issuedAt`.
- The staff site recomputes `tapChallenge({...intent, issuedAt}, nonce)` and refuses on a mismatch, or on an `issuedAt` outside about ±2 min of its own clock.
- The staff site is served from an origin and build the API host cannot change (a pinned static bundle, or an SRI-pinned shell). Otherwise a compromised host also swaps the checking code.

### N1–N3b (blocking): no bound on `issuedAt` against the gate's clock
`inOrder` compares a tap's `issuedAt` only with the last tap applied to the same subject, and `switch-on` only with `offSeenAt − 2 min`. Nothing refuses an `issuedAt` in the future. The API stamps `issuedAt` (`stampIssuedAt` in `startKeyTap`), and under X1 the owner cannot see it.

Each PoC below fails, meaning the attack works:
- **N1:** a real owner settings tap (US$5,000) stamped `2030-01-01` is applied. After recovery, the owner's honest US$100 tap is ignored as "earlier", and the limit stays US$5,000 until 2030.
- **N2:** a `resume-trading` stamped 2030 is applied. Every later owner `emergency-stop` is ignored, so the gate's stop (I1) is dead.
- **N3:** a withheld switch-on stamped 2030 restores a mod who was switched off later. `issuedAt > offSeenAt − 2 min` holds trivially, and the counter does not help when the owner has not used that key since.
- **N3b:** a `set-role` to senior stamped 2030 makes every later demotion of that person ignored. Switch-off and remove-staff still work.

All of these persist in `gate.bin` (`applied[subject].issuedAt`) after the API is cleaned up.

Fix:
- At sync, refuse (spend and log) any registry tap whose `issuedAt` is after `ctx.now() + SWITCH_ON_SKEW_MS`.
- With X1's client check, a future stamp cannot be signed at all.

### N4 (minor): no staleness bound
A `set-role` first seen 30 days after its `issuedAt` is still applied when it is the first tap for its subject (PoC fails). The ordering only protects subjects that already have a newer applied tap.

Suggest refusing registry taps first seen more than N minutes after `issuedAt`, for example 15 min. The gate syncs every minute. After a gate outage the owner taps again; that is a lead/owner call.

### N5 (info): the 2-minute skew is a real window
A switch-on issued 90 s before the gate first saw the switch-off still restores the person (PoC fails, by design). A database that withholds a switch-on made just before an unsigned switch-off can use it. Keep the skew small, and document that the owner should switch off with a tap (`remove-staff`, or a future signed switch-off) when it matters.

### N6 (info): `add-owner-key` pairing ignores `issuedAt`
Two taps 60 days apart pair and pin the key (PoC fails). Only the counter check guards it, and that check does nothing for keys that report counter 0. Suggest that both taps fall within one window (for example 1 h) of each other and of the gate's clock.

### N7 (minor, fail-open): a legitimate registry tap is silently dropped by counter order across sync steps
Step 1 (invites) raises a key's counter mark before step 2 runs. So an owner settings tap followed within the same sync by a `create-invite` with the same key is "out of order" and dropped. In the PoC, a lowering to US$100 is lost and the limit stays US$1,000. The same happens to an `add-owner-key` (step 4) followed by any step-2 tap by that key, and that case fails closed.

Fix: process all fresh owner taps in one pass, in (key, counter) order, or apply the counter check before any step raises the mark.

### M-R2 (minor, owner question; missed in round 1): a lost or stolen owner key can never be removed from the gate
The gate ignores `remove-method`. `ownerCreds` only grows, and taps need no user verification (`requireUserVerification: false`, no PIN). A stolen owner key, together with a compromised API, can alone issue settings, create-invite, switch-on and resume. Suggest a `remove-owner-key` that needs the other pinned key(s), applied in any order, as `remove-staff` is.

## Tests run

All runs used the single lock with the timeout inside it (`flock ~/x2f-comms/check.lock timeout 900 npx vitest run …`), in a detached worktree on 23e36785 after a fresh `npm ci`. The worktree and node_modules were removed afterwards.

- **Moderation** (`gate.test.ts`, `buyerCancel.test.ts` and the re-verify PoC file `zz-review-poc.test.ts`, kept at `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/mod-gate-reverify-poc.test.ts`): **69 passed, 10 failed of 79**.
  - All 64 branch tests pass.
  - Of the 15 PoCs, which all expect refusal, 5 pass: P1, P2, P3, P4 and P5 are closed.
  - 10 fail, each an open item above: B1 residual, P6, N1, N2, N3, N3b, N4, N5, N6, N7.
- **API** (`staff/keyTap.test.ts`, `staff/members.test.ts`, `disputes/rulings.test.ts`): **80/80 passed**.
- **Staff** (`packages/staff/test/intent.test.ts`): **19/19 passed**.
- **Tests weakened:** none. I checked the branch's test changes (gate, buyerCancel, keyTap, members, rulings, intent): each one adds checks or tightens existing ones (for example the M3 tripwire).
- `npx tsc -p apps/moderation --noEmit`: clean.
