# Re-verify: wip/lead-proof-stack at 77787c46 against 80a21e95 (chat-receive re-verify R1, R2, R3)

Reviewer: independent security re-verify, 12 Nov 2026. I used a detached worktree at 77787c46 with a
fresh `npm ci`. Every run was under the single lock `flock ~/x2f-comms/check.lock`, with the timeout
inside the flock. This file is not committed.

The change is 4 files, +78/-7:
- `apps/web/src/proof/chatProof.ts`: `noteProofSent` and a per-trade `sent` map;
- `apps/web/src/screens/proof/AddProof.tsx`: `postProofToChat` notes the proof and publishes only a snapshot that contains it;
- `apps/web/test/chatProof.test.tsx`: one assertion changed and two tests added;
- `apps/web/test/proof-render-tripwire.test.ts`: three new regex checks.

## Verdict

**APPROVED.**
- R1 and R2 are correct. They stay a buyer-side UI hint and cannot be spoofed.
- R3 is closed for the direct forms the builder lists. A few gaps remain, all minor. See V-M1 and V-M2.
- The changed old test is a justified change of intent.
- All requested suites pass.
- One process point for the lead (V-M3): the stack still has 3 textual conflicts with main 4f0afa14. All are in test files and all are mechanical. 80a21e95 had the same 3, so this commit did not cause them.

## 1. R1 and R2

**Where it is called.** `postProofToChat` calls `noteProofSent(code, payload.proofId)` only after
`chatClient().sendProof(await open(code), payload)` resolves. Every other outcome throws before that
line, and that covers every failure:
- `open` fails;
- the worker's `parseProofPayload` refuses the payload;
- the engine's `post` refuses with `not-ready` (not ready, or not secured), `bad-proof`, `too-large` (413), `slow-down` (429), `refused` (another 4xx, or a second stale seq) or `uncertain` (no answer, or a 5xx).

**`uncertain` never marks attached.** I probed this with a temporary test, now removed. For each of
`uncertain`, `refused`, `not-ready`, `bad-proof`, `slow-down`, `too-large`, `unavailable`, and for a
failing `open`, the result is:
- `proofCheckOf(id)` is still undefined;
- `chatProofState` stays `'none'`.

All 9 probe cases passed.

**The R2 read-back case.** The engine returns the pre-post `s.snap` only after `postEnvelope` succeeded, which is a 2xx stored post. So "attached" in that case reflects a proof the API accepted. The snapshot is not published (`snap.lines.some(l => l.proof?.proofId === payload.proofId)`), so the pay feed keeps its older snapshot until its next sync. The new R2 test covers this.

**Per trade, per page.**
- `sent` is a module-level `Map<normalisedCode, Set<proofId>>`. It holds ids only: no key and no bytes.
- `chatProofState(code)` reads only its own trade's entry. In my probe, a proof sent on trade A left trade B at `'none'`. Lower-case and dash-less spellings of A still read `'attached'`.
- The only producer is `postProofToChat`, and `sendProof` (upload.ts) always builds `kind: 'proof'`. So evidence never feeds the map. Nothing outside the page can write to it: chat lines, the snapshot and other tabs cannot.

**Across accounts.** Logout (`logOut` / `forgetLocalSession`) does not reload the page, and it does not clear `sent` or `checks`. So the previous account's trade codes and proof ids stay in memory in that tab. This has no effect on behaviour, because only the trade's buyer ever reads BuyerPay for that code. See V-I1.

**No effect on the server or the seller.**
- `proofStateOf` has exactly one consumer, `PaidFlowSheet`, and it only decides whether to ask "Mark paid without proof?" (`=== 'none'`).
- The mark-paid POST carries only `{ type: 'mark-paid', fiatCents }`. Nothing about the proof reaches the API.
- The seller's view of a proof comes from the seller's own ChatProof fetch, decrypt and check.

**The behaviour change is narrow.** The prompt is asked only on `'none'`, and `'attached'` and `'unavailable'` both suppress it. So R1 relabels cases that were already suppressed (unchecked becomes attached). The only case that actually changes is R2's: a confirmed, stored send whose snapshot had no line yet used to read `'none'` and now reads `'attached'`. A real missing proof (no send, or a failed or uncertain send) still reads `'none'`.

**Info, related.** `sent` takes precedence over a later `noteProofChecked(id, false)` from ChatProof on the buyer's own proof. An example: the buyer's own receive check refuses the cleaned copy. Either way the prompt is suppressed (`'unavailable'` would suppress it too), so nothing changes today. See V-I2.

## 2. R3 tripwire coverage

The new checks apply only to files whose code (comments stripped) matches `/\bdecryptProof\s*\(/`. Today that is only `screens/proof/ChatProof.tsx`. I copied the regexes exactly and ran them against bypass snippets (`scratchpad/r3probe.mjs`):

| Variant | Result |
|---|---|
| `window['localStorage']`, `globalThis.localStorage`, `window.sessionStorage`, `window.indexedDB` | caught (the `\b` matches inside the string too) |
| shorthand `{ body }`, `{ method,\n body\n }` | caught |
| `{ ...{ body: b } }`, `new Request(url, { body: b })` | caught |
| `XMLHttpRequest`, `BroadcastChannel#postMessage` | caught |
| **`const init = {...}; init.body = b; fetch(url, init)`** | **missed** |
| `init['body'] = b`, `{ 'body': b }`, `{ [k]: b }`, `Object.fromEntries([['body', b]])` | missed |
| `globalThis['local' + 'Storage']`, `document['cookie']`, `cookieStore`, OPFS `navigator.storage` | missed |
| data in a URL: `fetch('/x?d=' + b)`, `window.open`, `location.href`, `history.pushState`, `import(url)` | missed |
| `navigator.clipboard`, `new Worker` / `SharedWorker` | missed |
| **gate: `import { decryptProof as dp }` then `dp(`** | **file skipped entirely** |
| gate: `const f = decryptProof; f(...)`, `decryptProof.call(`, `decryptProof?.(`, a re-export helper | file skipped entirely |
| gate: `import * as P; P.decryptProof(` | checked |

- **V-M1 (minor): the gate is bypassed by an aliased import.** The same goes for a re-export or an indirect call. The file is then not checked at all, which defeats every rule in that test, the I3 ones included. Fix (test engineering only): gate on any occurrence of the identifier `decryptProof`, `/\bdecryptProof\b/`, instead of the call form. Better still, also fail any file outside the allowed list that imports `decryptProof` from `@x2f/proof`. Also apply the rules to any file that imports from `screens/proof/ChatProof` (a helper taking the plaintext).
- **V-M2 (minor): a body assigned after the object is built is not caught.** Examples are `init.body = ...` (the "object body built separately" case) and `init['body']`, `'body':`. A blanket `\bbody\b` would trip on ChatProof's own `res.body` (readCapped). Suggested additions:
  - `/\.body\s*=(?!=)|\[\s*['"`]body['"`]\s*\]|['"`]body['"`]\s*:/`;
  - `/\bcookieStore\b|\bdocument\s*\[/` for storage.

  The URL, `window.open` and computed-property cases are deliberate exfiltration, not likely accidents. A regex cannot stop those. The stronger guard is still a lint on the data flow: the decrypted value flows only into `<ProofThumb bytes>`.

Neither gap is blocking:
- ChatProof today does only a credentialed GET of the ciphertext and hands the plaintext to ProofThumb.
- The tripwire is a guard against accidental regressions, not a security boundary.
- The forms that are realistic by accident (`body:`, `{ body }`, XHR, direct storage names) are caught.

## 3. The changed old test

In "a sent proof's snapshot is published at once", the final assertion went from `'unavailable'` to `'attached'`.
- The old comment stated the intent: "A proof line is there (not checked on this page yet): never 'none'."
- `'unavailable'` was the side effect that R1 reported as wrong: the page's own sent proof was not counted. `'attached'` still satisfies "never 'none'".
- The test's other assertions are unchanged: the send arguments, and `latestChatSnapshot(code) === after`, which checks that a snapshot containing the proof is still published.
- The M3 rule ("attached only after a check") is still pinned unchanged by the pure `proofStateOfSnapshot` tests: unchecked, failed or refused reads `'unavailable'`. `noteProofSent` goes around it only for this page's own confirmed sends, which is what the lead's M3 note allowed ("or this page sent it").

**Justified change of intent, not a weakening.** Two new tests were added (R1 with the panel closed, and R2 with a stale read-back).

Small test gap: no committed test covers a failed or `uncertain` send leaving the state at `'none'`, or isolation between trades. My probe covered both, and both passed. It would be cheap to add them (V-I3).

## 4. Runs (worktree 77787c46, fresh npm ci, one flock, timeout inside)

| Run | Result |
|---|---|
| `vitest run --project @x2f/web` (full) | 141 files, 2170 passed, 0 failed. This includes my 9-test probe, so the branch alone is 140 files and 2161 tests. |
| `vitest run --project @x2f/proof` (full) | 14 files, 373 passed |
| `vitest run --project @x2f/staff-web` (full) | 5 files, 52 passed |
| `vitest run --project tools` (full) | 3 files, 13 passed |
| `vitest run --project @x2f/api apps/api/test/proofs.test.ts apps/api/test/proofUploadWire.test.ts` | 2 files, 31 passed |
| `playwright test -c apps/web/e2e/playwright.config.ts proof-ocr chat --trace off` (Chromium `/opt/pw-browsers/chromium`) | 10 passed (proof-ocr 6, chat 4) |
| reviewer probe (R1/R2 failure paths, isolation between trades) | 9 passed, then deleted |
| `npx tsc -p apps/web --noEmit` | see the note below |

**tsc note.** The first run failed only on my own probe file (a `ChatFailure` string literal type). After I deleted the probe, I re-ran tsc together with chatProof and the tripwire. tsc is clean (exit 0), and chatProof and the tripwire passed, 2 files and 27 tests.

**Merge onto main 4f0afa14** (`git merge-tree`):
- **V-M3 (lead, process): not clean. There are 3 conflicts, all in test files.** 80a21e95 has exactly the same 3, so they are not new:
  - `apps/api/test/disputes/staff.test.ts`: main's "no proof table except blur_check_" assertion against the stack's trade_proofs and isStoredProof block. Take the stack's side; it lands trade_proofs.
  - `apps/api/test/schema.test.ts`: the migration lists. Take the union: main adds 362, 380, 420 and 520, and the stack adds 580.
  - `apps/web/test/quoteScreen.test.tsx`: only the comment. The source auto-merges to the stack's flag gating of `BLUR_CHECK_LINE` (S-M2). Main ships the line ungated, so landing the stack hides it again on main while the flag is off. That is the lead's S-M2 call, already made. Say so in the merge message.
- Every source file auto-merges.

## Findings

- **Blocking:** none.
- **Minor:**
  - V-M1: the tripwire gate is bypassed by an aliased or indirect `decryptProof`.
  - V-M2: a body assigned after the object is built, and quoted or computed keys, are not caught; nor are `cookieStore` or `document[...]`.
  - V-M3: 3 mechanical test-file conflicts with main 4f0afa14. They were already there at 80a21e95.
- **Info:**
  - V-I1: `sent` and `checks` survive a logout in the same tab (ids and trade codes only, no effect on behaviour). Clear them in `forgetLocalSession` for hygiene.
  - V-I2: `sent` overrides a later `failed` check of the same id. That makes no difference to the prompt today, but a future "Proof sent" mark would show for a proof the buyer's own check refused.
  - V-I3: add the failed-send and two-trade cases as committed tests.

Worktree and its node_modules removed after the runs.
