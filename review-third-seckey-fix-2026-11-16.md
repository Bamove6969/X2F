# Review: wip/third-seckey-fix @ fe6765c7 (16 Nov 2026)

**Verdict: CHANGES NEEDED.** One blocking issue: B1, the copy-lint gate fails on the new keyErrors.ts, and the fix is small. Three minors: M1 (proved by a test), M2 and M3. The security design itself is sound and the demo-only code stays out of `apps/*`.

Reviewer: claude2 (independent, read-only). Worktree /home/user/wt/rv-seckey, detached at fe6765c7. Nothing committed.

## Scope
- `git log origin/main..fe6765c7` has 83 commits. Only the top 4 are new. The other 79 are the wip/lead-demo-r2 base (3190919d, which wip/third-signup-r3, third-demo-r3 and others also contain), so this review does not re-review them. I read every file the 4 commits change (`git diff 3190919d fe6765c7`, 16 files, +426/-41):
  - **8acc3388** fix(api): a trader's security key of any model now registers, even when the browser passes on an attestation outside the FIDO snapshot. Files: `apps/api/src/auth/attestation.ts` (`withoutAttestation`), `webauthn.ts` (`verifyRegistration` retry) and a test.
  - **b444794c** demo: under a preview pane's https host, the gateway adopts that host as the RP ID and restarts the API. Files: `tools/demo/rp-adopt.ts`, `gateway.ts`, `gateway-core.ts` (`beforeApi` hook), `procs.ts` (`restartTs`), `demo.ts` (API env file, 0600), `docs/demo.md` and a test.
  - **2913010c** fix(web): a key that is not added now says why. Files: `apps/web/src/screens/auth/keyErrors.ts`, used in setup `KeyStep`, `Backup` `SecurityKeyBackup`, setup `Login` and Settings `Methods`, plus a test.
  - **fe6765c7** feat(api): security-key registration options carry `hints: ['security-key']` (via `preferredAuthenticatorType: 'securityKey'`).
- Owner note daae4036, 13 Nov 00:24Z, screen setup-security-key, viewport 865x740: "Unable to add security key. I've tried both USB and nfc".

## What the fix does, and whether it addresses the owner's failure
The note does not record the host, browser or key model, so the cause cannot be proven from the data. The branch fixes the two plausible causes:
1. **The RP ID did not match the page's host** (b444794c). The demo API ran with `X2F_RP_ID=localhost`. If the page was opened from a preview pane's https host, `navigator.credentials.create` threw SecurityError before any key was asked. USB and NFC fail the same way, which matches "tried both". This is the most likely cause, since the 13 Nov demo ran behind the cloud preview pane (LEAD-HANDOFF-2026-11-07 line 153).
2. **The browser forwarded the key's `packed` attestation although the server asked for `none`, and the AAGUID was outside the snapshot** (8acc3388). Strict MetadataService then threw and the trader got 401. This fits a key the owner named that is not in the 58-statement snapshot (Nitrokey, Feitian).

There are also two cases the branch does not fix, and the docs say so:
- A framed preview pane without `publickey-credentials-create` still refuses keys. The web now says "Open this page in its own browser tab".
- An https tailnet IP can never be an RP ID. The web now says "wrong address".

So whether the fix works for the owner depends on how he opens the demo (Q1). The hints commit (fe6765c7) changes only the browser's chooser. It would not have fixed a failure.

## Findings

### B1: copy-lint fails on the new `apps/web/src/screens/auth/keyErrors.ts` (`npm run check` is red)
- `tools/check.sh:16` runs `npm run copy-lint`, and `apps/web/test/copy-lint.test.ts › passes on apps/web/src as committed` now fails with 5 `refusal` violations, all in keyErrors.ts:
  - lines 22, 24, 28 and 32: the `framed`, `wrongAddress`, `noAlgorithm` and `unsupported` sentences, which contain "can't";
  - line 57: the bare API code literal `'method-not-allowed'`.
- This is new on this branch. On the base 3190919d, copy-lint.test.ts passes (I ran it, see Tests).
- Rule (tools/copy-lint.ts:18-29): refusal wording and API refusal codes must go through `CantDoThat` / `ui/cantDoCodes.ts`, or carry a `not-a-refusal: <why>` or `cant-do-that-todo: <why>` pragma.
- Failure scenario: the branch cannot pass the lead's full check, so it cannot land as it is.
- Fix:
  - For the four sentences, mark each one `// not-a-refusal: a browser/device fault, not a rule that stops the user`. They explain a fault; they are not refusals. Or reword them without the refusal words, for example "Security keys and passkeys don't work inside this window…".
  - For the code, take `method-not-allowed`'s text from `cantDoCodes.ts`/`refusalText` instead of comparing the literal, or mark it.
  - Note: `cantDoThat-lint.test.ts` already fails on the base (70 > 67 pragmas). Adding pragmas raises that count, so the lead has to update that bound in the same change.

### M1: the trader fallback covers only one of several attestation-statement failures. A trader with a key whose statement is in the snapshot still gets 401 (proved)
`apps/api/src/auth/webauthn.ts:291-298`. The retry without the attestation statement runs only when `isUnknownAuthenticator(e)` matches, i.e. the message is "No metadata statement found". If the statement is in the snapshot, other errors from the attestation check still give a trader 401 `webauthn-failed`. SimpleWebAuthn 14.0.3 `verifyAttestationPacked` throws these:
- the chain does not lead to the statement's roots, e.g. a Yubico root rotation the snapshot has not caught up with;
- an expired attestation leaf ("Certificate not good after");
- "Metadata does not indicate support for full attestations";
- an alg mismatch with the statement.

Traders are asked for `none`, and the policy (`assertCredentialAllowed`, the 28 Oct fido-refresh review) gives a trader's `attested` no weight. So rejecting the key adds no security; it only reproduces the owner's failure for a different model.

Proof (probe test added to `webauthn.test.ts` in my worktree only, then reverted):
```ts
it('REVIEW PROBE: trader key with a statement in the snapshot but a chain from another root', async () => {
  const traderId = await seedAccount(deps, { loginName: uniqueName('trd'), kind: 'trader' });
  const b = await loggedIn(traderId, true);
  const other = createTestCa();
  const key = createSoftAuthenticator({ backedUp: false, userVerified: false, attestation: { aaguid: UNLISTED, ca: other } });
  const r = await staffAdd(b, key, 'security-key');
  expect(r.res.statusCode).toBe(201);   // on fe6765c7: received 401
});
```
On fe6765c7 the probe fails with `expected 401 to be 201`.

Fix: for traders, retry with the statement removed on **any** verification error:
```ts
const plain = a.accountKind === 'trader' ? withoutAttestation(a.response as RegistrationResponseJSON) : null;
```
The retry still checks challenge, origin, RP ID, type, UP/UV, the algorithm and the credential key, so a bad response still gets 401. With this one-line change, webauthn.test.ts + attestation.test.ts give 53/53 passed, the probe included. A simpler alternative is to verify a trader's response without its statement from the start.

Keep the probe as a regression test. A second probe for an expired leaf would need a `notAfter` option on `createTestCa().issue`.

### M2: the demo's RP ID adoption trusts the first Host / X-Forwarded-Host it sees, and it is final
`tools/demo/rp-adopt.ts:58-68`, `gateway-core.ts:240`, `self-origin.ts:selfOriginOf`.
- Any page GET with `Accept: text/html` and a DNS-name host that is not in DEMO_ORIGINS triggers adoption, as long as it looks https. `selfOriginOf` treats a non-loopback Host with no X-Forwarded-Proto as https.
- Where the gateway listens:
  - plain http on the phone VM's private address (`DEMO_PHONE_IP`, gateway.ts:101);
  - TLS on the tailnet IP (gateway.ts:106).
- Failure scenario: a LAN or tailnet client, or a DNS-rebinding page on the phone's network, sends `GET /` with `Host: x.attacker.example` first. The API restarts with `X2F_RP_ID=x.attacker.example` and adds `https://x.attacker.example` to X2F_ORIGINS. After that, the owner's real preview host can never be adopted ("the first host stays"). Keys and passkeys fail for the rest of the demo, and the error reads "wrong address".
- Impact is limited: demo only, fake money. The victim's cookies stay on the gateway host, so no session theft.
- A smaller version of the same problem: two preview hosts (e.g. the owner reopens the pane and gets a new subdomain) and only the first works.
- If `restart` fails, `origin` stays set and no later host is retried.
- Fix, either of:
  - adopt only when the TCP peer is 127.0.0.1/::1 **and** `X-Forwarded-Proto: https` is present (the preview proxy and tunnels connect locally);
  - allow re-adoption, the latest host winning, logged with the old host. Keys made under the old RP ID then stop working, which is acceptable in a demo.

  Either way, clear `origin` when `restart` fails.

### M3: trial merge with wip/third-signup-r3 conflicts in Backup.tsx (resolution is simple)
- `git merge --no-commit origin/wip/third-signup-r3` (90972d6e) onto fe6765c7 conflicts only in `apps/web/src/screens/setup/Backup.tsx` (HEAD lines ~231-367). signup-r3 deletes the backup step's `SecurityKeyBackup` / second-PGP extras, and this branch changes that component's catch to `keyErrorText`.
- Resolution: take signup-r3's side, then drop the now-unused `import { keyErrorText } from '../auth/keyErrors.js'` (Backup.tsx:28 in the merged file), or TS `noUnusedLocals` / lint fails.
- `webauthn.ts` merges cleanly. signup-r3 adds the `window` payload and `recheckWindowInTx` to `addKeyStart`/`addKeyFinish` and does not touch `verifyRegistration`/`registrationOptionsFor`.
- `MoreMethods.tsx` (signup-r3 adds `SecurityKeyArt`) and `Methods.tsx` merge cleanly.
- wip/lead-signup-v2 (2364324b) is now based on main, not on demo-r2. Its trial merge conflicts in members.ts, schema.test.ts, App.tsx, chat/engine.ts, task28-units.test.tsx and Backup.tsx. All of those except Backup.tsx come from the demo-r2 base, not from this fix; Backup.tsx is the same conflict as above. signup-r3 already contains signup-v2 (d88f8792), so merge signup-r3 rather than signup-v2 when landing.

### I1: hints / preferredAuthenticatorType: correct, nothing loosened
In @simplewebauthn/server 14.0.3, `preferredAuthenticatorType: 'securityKey'` pushes `hints: ['security-key']` and sets `authenticatorAttachment = 'cross-platform'`, which was already set (generateRegistrationOptions.js:115-119).
- These settings are unchanged for security keys: `residentKey: 'discouraged'`, `userVerification: 'preferred'`, attestation `direct` (staff/owner) or `none` (trader), algorithms [-8, -7, -257], timeout and excludeCredentials. The test asserts them.
- Passkeys are untouched.
- Hints are advisory. Chrome still lets the user reach "use a phone" (hybrid), and Android NFC/USB keys stay reachable.
- Transports are still filtered through `KNOWN_TRANSPORTS` when stored.

### I2: security of the `withoutAttestation` retry: sound
- The rebuilt object is `{fmt:'none', attStmt:{}, authData}`, with authData byte-identical, so `rpIdHash`, flags, counter, AAGUID, credential ID and public key are unchanged. clientDataJSON is untouched, so challenge, origin and type are still checked.
- Removing the statement only discards evidence. An attacker could send `fmt:none` directly with the same effect, so this opens nothing new.
- Scope: only `accountKind === 'trader'`, at sign-up (`registerFinish` hard-codes trader) and account add-key (`req.auth.kind` from the DB session).
  - Staff, owner and member keep 403 `method-not-allowed`, and the existing test still asserts it.
  - Owner/staff `attested` still needs packed + x5c + the allowlist.
- A trader row is stored `attested=false`, which the test asserts. The challenge is consumed once before the verification, so the retry cannot reuse it.
- Login assertions (counter check, allowCredentials) are unchanged.
- Credential IDs are still unique through `insertCredential`.

### I3: the demo workaround stays out of production code paths
- rp-adopt, restartTs and the `beforeApi` hook are only in `tools/demo/*`. `apps/*` gets no runtime RP ID or origin change, and the production API still reads a fixed `X2F_RP_ID`/`X2F_ORIGINS` (config.ts:202-206).
- `beforeApi` is optional in `createGateway` and only the demo gateway sets it.
- `separation.test.ts` and `demo-guard.test.ts` pass.
- The API env file holds DATABASE_URL and other secrets, so writing it 0600 under `.demo/secrets` is right. `rp-origin.json` holds no secret.

### I4: keyErrors copy and mapping
- The mapping matches @simplewebauthn/browser 14's `identifyRegistrationError` (SecurityError / ERROR_INVALID_RP_ID / ERROR_INVALID_DOMAIN, InvalidStateError, NotAllowedError passthrough with the message, etc.).
- The server's codes are checked first. One thing for the copy reviewer: `noAnswer` for a security key says "hold it to the back of your phone" even on a desktop. All the sentences are marked COPY-UNSIGNED and need the owner's sign-off (Q2).
- `blockedByFrame` relies on Chrome's message text or `document.featurePolicy`. Elsewhere it falls back to the general "didn't respond" sentence, which is acceptable.
- In setup `Login.tsx`, `keyErrorText` is used only when `errorCode(e) === null`, so server refusals keep `setupError`. The existing e2e "a cancelled passkey prompt…" still expects "pick another way to log in", and it passes.

## Questions for the owner (via the lead)
- **Q1.** Where did you add the key on 13 Nov: the preview pane inside the Claude app, a browser tab on the preview's address, the tailnet address, or Chrome on the phone (localhost)? And which key model? Recommendation: retest on the next demo build in its own browser tab, with USB and NFC. If it still fails, the new message says why. The `self-origin` / `rp-adopt` lines in the gateway log will also show the host.
- **Q2.** The new error sentences (KEY_ERROR, keyErrors.ts) are COPY-UNSIGNED. Recommendation: approve them, with the "back of your phone" part only on phones.
- **Q3 (security/product).** A team member's (`member`) security key must still be an attested model from the staff list (Yubico 5 / Security Key / Titan v2). A Nitrokey or Feitian key gets "This key model isn't accepted yet". The owner's 13 Nov copy says "any FIDO2 certified key". Is that meant for traders only? Recommendation: yes, traders only. Keep members on the staff rule (owner R1), and say on the member screens which models work.

## Tests
Node 24.22.1, `npm ci` in the worktree, all heavy runs under `flock /tmp/claude-0/heavy.lock`.

- **API project** (`vitest run --project @x2f/api`, own Postgres container): **110 files, 2598 passed, 0 failed, 1 todo**.
- **API probe for M1** (`webauthn.test.ts -t 'attestation for staff and owner'`): 1 failed (the probe: expected 201, got 401), 7 passed, 35 skipped.
  - With the one-line M1 fix, webauthn.test.ts + attestation.test.ts: **53/53 passed**.
  - The probe and the fix were then reverted.
- **Web vitest, touched file**: `apps/web/test/keyErrors.test.ts` 4/4 passed.
- **Web project** (`--project @x2f/web`): **9 failed, 2112 passed (2121)**.
  - New from this branch: `copy-lint.test.ts` (B1).
  - The other 8 fail the same way on the base 3190919d (I ran those 8 files there: 8 failed, 71 passed). They come from the demo-r2 base, not from this fix:
    - bundle.test.ts ×2
    - cantDoThat-lint (70 > 67)
    - kit-tokens
    - loginApproveV2 tokens
    - proof-render-tripwire
    - selection-ink
    - serve-boards
- **tools project**: 9 files, 78 passed. demo-rp-adopt, demo-self-origin, demo-guard and separation also ran on their own: 4 files, 33 passed.
- **Typecheck**: `tsc --noEmit` for @x2f/api and @x2f/web is clean.
- **Playwright** (chromium /opt/pw-browsers/chromium, `--workers=1`): setup.spec.ts + signup-v2.spec.ts gave **36 passed, 2 failed**.
  - The 2 failures are both signup-v2.spec.ts "PGP, password and authenticator app…" (443x794 and 390x844). The spec still has `TERMS_VERSION = '2026-11-09'`, but the app's Terms are 2026-11-12, so the Terms tick stays disabled ("terms-stale").
  - This branch does not touch the spec or termsText. signup-r3 has the same stale constant (pre-existing, for the signup-r3 / demo-r2 owners).
  - The shipped e2e specs exercise only a *passkey* through the virtual authenticator (setup.spec M5, internal transport). No committed spec covers `/setup/security-key`.
- **Playwright probe** (my spec, not committed, deleted afterwards): signup-v2's helpers with `TERMS_VERSION` fixed, PGP + security key ticked, through to `/setup/security-key`. It used server-shaped options (hints `security-key`, cross-platform, `residentKey` discouraged, UV preferred, attestation none, algs -8/-7/-257) and a CDP virtual ctap2 authenticator. **6/6 passed**:
  - USB, NFC and BLE keys are each added; the finish body carries `transports` `["usb"]` / `["nfc"]` / `["ble"]` and `authenticatorAttachment: cross-platform`;
  - an RP ID that is not the page's host shows the wrongAddress sentence;
  - no authenticator with a 1.5 s timeout shows "The key didn't respond";
  - a 403 `method-not-allowed` at finish shows "This key model isn't accepted yet".
- **Not run**: the Monero regtest, escrow and node-proxy projects (downloads.getmonero.org is blocked here; this change does not touch them). The real demo stack behind a preview pane (needs the lead's demo host), so the RP-ID-adoption fix is verified only by its unit tests and by reading the code. A physical key over USB/NFC (none here).
- **Trial merges** (in a separate throwaway worktree, aborted, nothing committed): see M3.
- **Recommended follow-up**: commit the USB/NFC/BLE `/setup/security-key` probe as a real e2e spec, since the security-key screen has none today.
