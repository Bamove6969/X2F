# Review: wip/lead-proof-tripwire-2 at ef27cf31 (on 77787c46): V-M1, V-M2, V-I1, V-I3

Reviewer: independent review, 12 Nov 2026. I used a detached worktree at ef27cf31 with a fresh `npm ci`.
Every run was under the single lock `flock ~/x2f-comms/check.lock`, with the timeout inside the flock.
dockerd was not touched. This file is not committed.

The change is 4 files, +157/-8:
- `apps/web/test/proof-render-tripwire.test.ts`: the gate and the rules;
- `apps/web/src/proof/chatProof.ts`: `forgetSentProofs`, and the flag import;
- `apps/web/src/push/usePush.ts`: `forgetLocalSession` calls `forgetSentProofs`;
- `apps/web/test/chatProofSend.test.tsx`: new.

## Verdict

**APPROVED.** Each of V-M1, V-M2, V-I1 and V-I3 is addressed as described. No test was weakened, and every
requested suite and tsc pass. I have no blocking finding. What remains is minor or info (T-M1, T-M2,
T-I1 to T-I4), and each is a follow-up at the lead's discretion.

## 1. The gate (V-M1)

- The gate is now `/\bdecryptProof\b/` on the comment-stripped code. This catches an aliased import,
  `.call`, a re-export and `proof['decryptProof']`. Any file in `apps/web/src` or `apps/staff-web/src`
  that names it must be in `DECRYPT_ALLOWED` (ChatProof only).
- `expect(gated).toBe(DECRYPT_ALLOWED.length)` stops the gate from going silent. That is good.
- Whole-tree scan (1054 tracked ts/js files, all parsed): the name appears only in ChatProof inside the
  two scanned apps. The other hits are `packages/proof` (where it is defined), tests, and
  `apps/api/test`. All of those are outside the scanned set, so there is no false positive.
- **Not done from V-M1's suggestion:** the rules are not applied to helper modules. ChatProof could
  import a helper and pass it the plaintext (`await upload(plain)`), and that helper is never checked.
  See T-M1.

## 2. The rules (V-M2)

The old patterns all survive, as a superset:
- postMessage, sendBeacon, WebSocket, EventSource, `body:`, `{ body }`, XHR;
- `document.cookie`, now `document\s*(\.\s*cookie|\[)`.

The new patterns catch every snippet the builder lists. ChatProof's own `res.body` reads trip none of
them (tested on snippets and on the real file).

I probed what is still missed:

| Snippet | Result |
|---|---|
| `Reflect.set(init, 'body', plain)` | missed |
| `Object.defineProperty(init, 'body', …)` | missed |
| `Object.fromEntries([['method','POST'],['body', plain]])` | missed |
| `init. body = plain` (space after the dot) | missed |
| `crypto.subtle.decrypt(...)` with the line's key, hand-rolled instead of `decryptProof` | missed: the file is not gated at all |
| URL query, `location.hash =`, `window.name =`, `navigator.clipboard`, RTCPeerConnection | missed |

- **T-M2 (minor):** the first four rows are cheap to close. One option is `['"`]body['"`]\s*[,\]]` and
  `\.\s*body\s*=(?!=)`. The rest is deliberate exfiltration, as V-M2 already said. A regex is not the
  boundary there.

False positives across the tree:
- The computed-key rule `[{,]\s*\[[^\]\n]+\]\s*:` hits 42 files repo-wide, for legitimate reasons:
  - TS index signatures (`{ [key: string]: Json }`, apps/api/src/team/audit.ts);
  - object spreads with a computed key (ChatPanel, PostOffer, offerForm);
  - CSS selector strings (`'…, [tabindex]:not(…)'`, ui/Sheet.tsx).
- `.body =` hits the three API clients (`apps/web/src/api/client.ts`, `apps/staff-web/src/api.ts`,
  `packages/auth-client`).
- None of these is in a gated file, so nothing fails today. But a later index-signature type or a
  `{ ...s, [id]: x }` in ChatProof would fail with a "sends out" message that points the wrong way.
  See T-I1.

## 3. The log-out clear (V-I1)

- `forgetSentProofs()` clears both `sent` and `checks`. `forgetLocalSession()` calls it, and so do its
  two callers:
  - `logOut(env)`, used by both SessionPrompt paths (the session end and the Log out button);
  - LoginApprove's "this device is now logged out".
- The L2 logout tripwire routes every UI log-out through `logOut(env)`. Devices.tsx ends other devices'
  sessions, and Welcome.tsx ends the minutes-old sign-up session (no proofs possible).
- **T-I2 (info): it does not run on every way a session ends.** It is the same set that clears the
  feedback and chat drafts, so this is pre-existing and consistent. Two paths miss it:
  - `sessionEnded()`, the 401 `not-authenticated` front door: the session was revoked elsewhere or
    expired while SessionPrompt was not watching.
  - `logOut(env)` when `POST /v1/logout` throws (a network failure), because `forgetLocalSession()`
    comes after the await.

  On both paths, ids and trade codes stay in the tab. That has no behaviour effect, as V-I1 said. To be
  complete, call `forgetLocalSession()` from the session-gone listener as well, and put it in a
  `finally` in `logOut`. The `finally` is engineering, but it changes when drafts are dropped, so the
  lead decides.
- **T-I3 (info, pre-existing, outside this commit):** `payDetailsFeed`'s `snapshots` map holds chat
  snapshots, including proof-line keys (review I4). It is cleared only when a trade's last
  `chatPaymentDetailsSource` listener goes. A ChatPanel's `publishPaySnapshot` with no card listener
  leaves a snapshot that nothing deletes, and log-out does not clear it either. That is more sensitive
  than the ids V-I1 covered. It is worth a `forgetLocalSession` hook in a later round.

## 4. The proof/flag.ts split

- `flag.ts` already existed at 77787c46. `upload.ts` only re-exports `proofUploadOn` from it, so this is
  the same function: no behaviour change.
- No test mocks `upload.js` to drive chatProof's flag. All of them use
  `vi.stubEnv('VITE_X2F_PROOF_UPLOAD')`, so no test silently stopped controlling it.
- chatProof.test's "one flag function" assertion (no `VITE_X2F_PROOF_UPLOAD` literal in chatProof.ts)
  still holds.
- usePush now imports chatProof, which brings in chat/payDetailsFeed and chat/client. There is no
  cycle back to usePush, and tsc and the suites are clean.
- **Nit:** `forgetSentProofs` was inserted between `noteProofSent`'s JSDoc and `noteProofSent`. The
  R1/R2 comment now sits stacked above `forgetSentProofs`, and `noteProofSent` has none. Move it back.

## 5. Were any tests weakened?

No:
- The tripwire's old per-pattern expects were folded into `sendsOut(c)` and `.toEqual([])`, which is a
  strict superset.
- The old gate is a subset of the new one.
- The ProofThumb, Blob and `<img>` checks are unchanged.
- Nothing is skipped and nothing was loosened.

The new chatProofSend cases are meaningful. Calling `noteProofSent` before `sendProof` resolves would
fail them, through `proofCheckOf` being defined.
- **T-I4 (info):** the error codes are cast (`code as ConstructorParameters<…>[0]`), so tsc would not
  flag a code that `ChatFailed` stops accepting. That is harmless today.

## 6. Runs (worktree ef27cf31, fresh npm ci, one flock, timeout inside)

| Run | Result |
|---|---|
| web: proof-render-tripwire, chatProofSend, chatProof, logout-tripwire | 4 files, 45 passed |
| `vitest run --project @x2f/web` (full) | 141 files, 2174 passed |
| `vitest run --project @x2f/proof` (full) | 14 files, 373 passed |
| `vitest run --project @x2f/staff-web` (full) | 5 files, 52 passed |
| `vitest run --project tools` (full) | 3 files, 13 passed |
| `tsc --noEmit` for apps/web, apps/staff-web, packages/proof | clean |
| whole-tree regex scan (gate and rules, 1054 files) | see sections 1 and 2 |

In total that is 163 files and 2612 tests, which matches the builder's count.

## Process note

The author of ef27cf31 (and of 77787c46 and 80a21e95) is `Claude <noreply@anthropic.com>`. The helper
brief says author = the owner. If that rule also applies to the lead's own commits, fix the author when
landing.

## Summary

- **APPROVED.** No blocker.
- **Minor:**
  - T-M1: a helper module that ChatProof hands the plaintext to is not checked. Cheap guard: pin
    ChatProof's import list in the tripwire.
  - T-M2: `Reflect.set`, `defineProperty`, `fromEntries` with `'body'`, and `init. body =` are still
    missed. One regex closes them.
- **Info:**
  - T-I1: the computed-key and `.body =` rules match index signatures, spreads and CSS selectors
    elsewhere. Only a risk of confusing failures in ChatProof later.
  - T-I2: the clear does not run on the 401 session-gone path or on a failed `/v1/logout` (pre-existing,
    same as drafts).
  - T-I3: payDetailsFeed snapshots, which hold proof keys, can outlive a log-out (pre-existing).
  - T-I4: the cast error codes in chatProofSend.
  - Nit: misplaced JSDoc on `noteProofSent`.

Worktree and its node_modules removed after the runs.
