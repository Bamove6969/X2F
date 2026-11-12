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

---

# Round 3: re-verify at 595c0137 (red tests 6957e33e), 2026-11-12

- **Re-verified:** `origin/wip/lead-mod-gate` = **595c0137** ("READY: mod-gate - re-verify 2026-11-12 fixes"), parent 6957e33e (RED). These are two commits on top of round 2's 23e36785.
- **Changed since round 2:**
  - `gate/registry.ts`: a new step 0, the add-owner-key pairing, and the reason hashed in JS.
  - `gate/store.ts`: a missing gate.bin is an error, and `initGate` is added.
  - The new `cli/init-gate.ts`.
  - `main.ts`: the process exits when gate.bin does not open.
  - `staff/keyTap.ts`: `taps/start` now returns `nonce` and `issuedAt`.
  - staff-web `KeyTapDialog.tsx`: `checkTapChallenge`, and the intent is shown.
  - Tests, and the docs (`coordination.md`, `dev-setup.md`).

## Verdict

**Not ready: 1 blocking.**
- Every fix asked for this round holds in the gate. N1, N2, N3, N3b, N4, N6, N7, P6, M-R1 and M3 are closed, and my flipped PoCs pass.
- X1 is fixed for the tap dialog, but the staff site's **login** still lets a compromised API get any owner tap signed (X2, blocking).
- B1 residual and M-R2 stay owner questions. N5 is accepted as designed (lead call).

## Item by item

| Item | Status | How checked |
|---|---|---|
| X1 tap dialog | **Fixed for `KeyTapDialog`; tests adequate for the dialog, not for its use (see X2, X3)** | `taps/start` returns `nonce` and `issuedAt`. `checkTapChallenge` rebuilds `tapChallenge(intent + issuedAt, nonce)` and refuses a mismatch, an issuedAt more than ±2 min from the device clock, an issuedAt on a kind without one, or a malformed nonce; it refuses before `startAuthentication`. The whole intent is shown. The shell tests cover a lying server (other intent), skew both ways, a missing issuedAt, an issuedAt on a ruling, and "not asked on failure". A server-side normaliser that differs from the client's (for example an upper-case `round1Id` lower-cased by `parseKeyTapIntent`) only fails closed. |
| N1–N3b future issuedAt | **Fixed** | Step 0 spends any tap issued after gate-now + 2 min (`issued-in-future`). Flipped N1, N2, N3 and N3b pass. The client's ±2 min check means an honest staff site never signs such a stamp. |
| N4 stale | **Fixed** | `MAX_TAP_AGE_MS` = 24 h, spent as `issued-too-long-ago`. N4 passes. A tap the database holds back for less than 24 h is still covered by per-subject ordering and `offSeenAt`. |
| N7 cross-step counter | **Fixed** | Step 0 checks every fresh owner tap once, in (key, counter) order, before any step acts; create-invite is spent at once. N7 passes: settings and then create-invite in one sync both apply. Fail-closed leftover (info): a tap that passes step 0 but is not applied (a set-role for someone the gate does not yet know, or an unpaired add-owner-key) is refused as out-of-order on a later sync once the same key has made a newer accepted tap. The owner taps again. |
| N6 add-owner-key pairing | **Fixed** | Pairs only taps by two different keys issued within 10 min. N6 passes; the 60-day-old half is also stale under N4. But see X2: a login by each key within 10 min is enough. |
| M-R1 reason hash | **Fixed** | `dispute_rulings.reason` is read and hashed in JS, as evidence is. |
| P6 missing gate.bin | **Fixed** | `openGateStore` throws on a missing file unless `init: true`, which only `initGate` passes, after `yes` and only where no file exists. `main.ts` exits 1. `pin-owner` opens without `init`. My flipped P6 passes: it checks declined, created, `exists` (never overwrites a pinned gate), and wrong key throws. Tiny check-then-create race (info): `initGate`'s check and create are not atomic, so a gate.bin appearing between them would be replaced. It needs the operator running init-gate at that same moment. |
| M3 dynamic import | **Fixed** | The tripwire now also catches `import('@x2f/escrow…')`. |
| N5 skew | Accepted (lead) | The PoC still fails by design. |
| B1 residual, M-R2 | Owner questions | The B1 residual PoC still fails (attack works). `remove-owner-key` still does not exist. |

## X2 (blocking, new): the staff login signs a server-chosen challenge, so a compromised API turns any owner login into any owner tap

`apps/staff-web/src/screens/Login.tsx` `tapKey` passes the server's login `options` straight to `startAuthentication`. The server makes them with `generateAuthenticationOptions` (`apps/api/src/auth/webauthn.ts`, about line 650). A login assertion and a tap assertion are the same WebAuthn `get` on the same RP id and origin. The gate checks only `type`, origin, RP id and `challenge == tapChallenge(intent, nonce)`.

Scenario:
1. The compromised API picks an intent and a nonce, and sends `tapChallenge({...evil, issuedAt: now}, nonce)` as the owner's **login** challenge. Possible intents: `settings {largeTradeLimitUsd: 1000000}`, `create-invite` for its own account, `switch-on`, `resume-trading`.
2. The owner logs in as usual. Nothing on screen differs: a login challenge is random by nature, so the client cannot check it.
3. The API writes a `key_taps` row with that intent, nonce and assertion, and the gate accepts it as a genuine owner tap.
4. The owner's login can be two-step (a second key after the first). And `add-owner-key` needs both keys within 10 min. So a login with key 1 followed by one with key 2 within 10 min can also pin an **attacker owner key**, which is the root of trust.

`checkTapChallenge` closes the tap dialog, not this path. The same holds for any other staff-site `get` on that origin that a future change adds.

Fix (lead call):
- Domain-separate login from taps. The server sends a login nonce; the staff site itself sets `challenge = sha256("x2f-staff-login-v1\n" + nonce)` (any prefix other than `x2f-keytap-v1`); the server verifies that derivation. A login assertion can then never be a valid tap.
- Add a tripwire test that every `startAuthentication` call in `apps/staff-web/src` is either `KeyTapDialog` (checked) or the login with the derived challenge.

Another layout also fixes it: taps on a separate RP id and origin that the gate alone accepts, but that is heavier.

## X3 (minor, for the wiring): the dialog's check is only as good as the intent its caller passes

The lead notes that nothing in staff-web opens `KeyTapDialog` yet. So the X1 check has no caller in effect, and no owner registry tap can come from the staff site today.

Once callers are wired:
- Each must build its intent from values the person typed or can see, not values copied from the API. Hashes (`tokenHash`, `reasonSha256`, `evidenceSha256`, `publicKeySha256`) the client should compute itself: from the invite token it shows, the reason and evidence text it shows, the key's public key.
- An `accountId` UUID means nothing to the owner, and the name-to-id mapping comes from the API. That is an inherent limit; show the name and the id.

Suggest that every new `KeyTapDialog` caller gets a test asserting its intent's hashes are computed client-side. Add a source tripwire too: `tapStart` called only from `KeyTapDialog`, and no `startAuthentication` outside it and login. The current tests are enough for the dialog itself and say nothing about future callers.

## Tests run (round 3)

All runs used `flock ~/x2f-comms/check.lock timeout 900 npx vitest run …`, in a detached worktree on 595c0137 after a fresh `npm ci`. The worktree and node_modules were removed afterwards.
- **Moderation** (`gate.test.ts`, `buyerCancel.test.ts` and the PoC file, all PoCs expecting refusal; saved at `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/mod-gate-reverify-poc.test.ts`): **86 passed, 2 failed of 88**.
  - All 73 branch tests pass.
  - 13 of 15 PoCs pass: P1–P6, N1, N2, N3, N3b, N4, N6 and N7.
  - The 2 failures are the expected open items: the B1 residual (an owner question) and N5 (accepted by design).
- **API** `staff/keyTap.test.ts`: **30/30 passed**.
- **staff-web** `shell.test.tsx`: **16/16 passed**.
- `tsc` for `apps/moderation` and `apps/staff-web`: clean.
- **Tests weakened:** none. The branch's test changes add cases or swap a fake challenge for a real one.
- X2 has no PoC test: it is a client-side flow I traced by reading `Login.tsx` and `webauthn.ts`. At the gate, a login assertion over a tap challenge is indistinguishable from a tap, so a gate PoC would just repeat `tapBy`.

---

# Round 4: re-verify at db2ba92f (red tests 85d0eabf), 2026-11-12

- **Re-verified:** `origin/wip/lead-mod-gate` = **db2ba92f** ("re-verify round 3: X2 domain-separated staff ceremonies, X3 tripwire, init-gate O_EXCL"), parent 85d0eabf (RED). These are two commits on top of round 3's 595c0137.
- **Changed since round 3:**
  - `@x2f/staff`: new `staffLoginChallenge`, `ownerSetupChallenge` and `inviteTokenHash`.
  - API `auth/webauthn.ts` (the staff login) and `staff/ownerSetup.ts`.
  - The new staff-web `challenges.ts`, used by `Login.tsx`, `OwnerSetup.tsx` and `Invite.tsx`.
  - The new staff-web `test/webauthnTripwire.test.ts`.
  - The gate's `initGate` (O_EXCL).
  - Tests, and `docs/coordination.md`.

## X2: domain-separated staff ceremonies: fixed

- **The derivation:**
  - Every WebAuthn ceremony on the staff site now signs a challenge the staff site computes itself from a server nonce:
    - login: `sha256("x2f-staff-login-v1\n" + nonce)`;
    - owner setup: `sha256("x2f-owner-setup-v1\n" + nonce)`;
    - invite: `sha256("x2f-invite-v1\n" + sha256(token from the link))`.
  - `challenges.ts` replaces the server's `options.challenge` with that value before `startAuthentication` or `startRegistration`.
  - A tap's challenge is `sha256("x2f-keytap-v1\n" + intent + "\n" + nonce)`, and `KeyTapDialog` checks it.
  - So a login assertion can be a tap only through a SHA-256 collision.
  - Registrations are `webauthn.create`, and the gate requires `webauthn.get`.
- **API refusal:** on finish, the API refuses a stored challenge that is not the derivation of its stored nonce (`challenge-expired`), for both the staff login and owner setup. `login.test` and `ownerSetup.test` swap the row and get 400. Under the threat model this check is consistency only: the protection is the client's derivation, since a compromised API skips its own check.
- **The other options fields stay the server's** (`rpId`, `allowCredentials`, `userVerification`, extensions). None of them can turn a login into a tap:
  - The gate binds the challenge, `type`, origin and rpIdHash.
  - A different `rpId` gives a different rpIdHash and is refused.
- **My attempts (all refused):**
  - X2a: owner login assertions from **both** keys, each stored as a tap for settings US$1M, `add-owner-key` (attacker key), `switch-on` (a switched-off mod) and `resume-trading`, with the login nonce and a shortened nonce. All are refused: the limit stays US$1,000, no owner key is added, and the mod stays revoked.
  - X2b: a registration response (`webauthn.create`) stored as a tap is refused.
  - The branch's own X2 test (login assertion as a settings tap, and as a ruling approval: `bad-signature`) passes.
- **Other paths:**
  - The staff realm's discoverable-login branch still uses a server challenge, but the staff site never calls it.
  - The trader site is another origin, which the gate refuses (`expectedOrigin` is the staff origin only).
- **Holds only while** the staff site's code is the one built and deployed apart from the API host (`docs/dev-setup.md`).

## The tripwire (`webauthnTripwire.test.ts`): adequate, with small gaps (info)

- **What it pins:**
  - `startAuthentication` only in `screens/Login.tsx` (through `loginOptions(`) and `ui/KeyTapDialog.tsx`.
  - `startRegistration` only in `Invite.tsx` (`inviteOptions(`) and `OwnerSetup.tsx` (`setupOptions(`).
  - `tapStart(` only from `KeyTapDialog`.
  - `<KeyTapDialog` opened only by the files in `KEY_TAP_CALLERS`, which is empty today.
- **Gaps** (regex on source, so a deliberate dodge passes; under the trust model the staff-site code is honest, so this only matters for mistakes):
  - An aliased import (`import { startAuthentication as sa }`).
  - Direct `navigator.credentials.get/create`.
  - `tapStart` passed by reference rather than called.
  - `React.createElement(KeyTapDialog…)`.
- **Suggested additions:**
  - Forbid `navigator.credentials` in `src/`.
  - Require that `@simplewebauthn/browser` is imported only by those five files, and only by name.

## init-gate O_EXCL: fixed (one info)

- **Fix:** `initGate` now writes `gate.bin` with `open(path, 'wx', 0600)` and syncs the file and the directory. `EEXIST` gives `exists`. The branch's race test (another gate written while it waits for `yes`) passes, and my P6 still passes.
- **Info:** it writes to the final path directly, not through a temp file and rename. A crash halfway leaves a partial `gate.bin` that fails to open (fail-closed; the operator deletes it and runs init-gate again).
- **Info:** `openGateStore(…, { init: true })` still exists, and only tests use it now. Consider removing it so no future caller can make an empty gate without the `yes`.

## X3 deferred as a merge requirement: acceptable

- **No caller yet:** nothing opens `KeyTapDialog` on this branch. So no owner registry tap or staff ruling tap can be made from the staff site at all; there is nothing for X3 to protect yet.
- **Enforced by the tripwire:** the first branch that adds `<KeyTapDialog` fails it until the file is added to `KEY_TAP_CALLERS`. The list's comment and `coordination.md` record what each caller must do: build its intent from what the person typed or sees, compute its hashes client-side, show names next to ids, and carry a test of its own.
- **Condition:** each branch that adds a caller gets a security review of that caller. The list edit itself is a one-liner, so the tripwire forces a touchpoint, not the review.
- **Note for the lead's plan:** until callers exist, the gate stays at its defaults (no staff, US$1,000 limit) after pinning, so it authorises no ruling in production. That fails safe.

## Tests run (round 4)

All runs used `flock ~/x2f-comms/check.lock timeout N npx vitest run …`, in a detached worktree on db2ba92f after a fresh `npm ci`. The worktree and node_modules were removed afterwards.
- **Moderation** (`gate.test.ts`, `buyerCancel.test.ts` and the PoC file, all PoCs expecting refusal; saved at `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/mod-gate-reverify-poc.test.ts`): **90 passed, 2 failed of 92**.
  - All 75 branch tests pass.
  - 15 of 17 PoCs pass: P1–P6, N1, N2, N3, N3b, N4, N6, N7, and the new X2a and X2b.
  - The 2 failures are the expected open items: the B1 residual (an owner question) and N5 (accepted by design).
- **NOT RUN:** the API (`staff/login.test.ts`, `staff/ownerSetup.test.ts`, `staff/keyTap.test.ts`), staff-web (`webauthnTripwire.test.ts`, `screens.test.tsx`, `shell.test.tsx`) and staff (`intent.test.ts`) files.
  - The runner sat about 2 h in the `check.lock` queue behind another helper's full `@x2f/escrow` run, and was stopped at the background time limit just after the moderation run finished. Per the instructions I did not restart it.
  - My verdict on those parts rests on reading the code and the tests. **The lead should run these seven files before merging.**
- `tsc` for `apps/moderation` and `apps/staff-web`: clean.

## Final verdict

**Ready to merge from the security-review side, on these conditions:**
1. The seven API, staff-web and staff test files above pass.
2. X3: every branch that adds a `KeyTapDialog` caller gets its own security review.
3. The owner answers B1 residual (confirm each staff key with an `add-staff-key` tap) and M-R2 (`remove-owner-key`) before the gate goes live with staff. Until then it fails safe: no caller, so no staff.

Everything blocking from rounds 1–3 is closed: B1 as far as the code can go without the owner, B2, X1, X2, and N1–N3b. Open info items:
- N5, the designed 2-minute skew window.
- The tripwire gaps: aliased imports, `navigator.credentials`.
- `openGateStore`'s leftover `init` option.
- init-gate writes in place, not through a temp file and rename.
- The I2 differences, which all fail closed.
