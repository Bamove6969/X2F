# Review: Plan 5 Task 10, past reputation claims and PGP proof (apps/api)

Reviewer: security-minded first review, 2026-11-01
Branch: `origin/wip/third-p5-past-rep` @ **8c4ee21** (red tests 19a03c5, impl 96f2cf3 + 86e250f, follow-up 8c4ee21 adds the hold check and the start throttle). Base: main 9b26423.
Worktree: `~/x2f-worktrees/review-p5-task10` (detached, clean; nothing committed or pushed).

## Verdict: APPROVED WITH MINOR

The core crypto is sound. I found no way to get a claim without a real signature by the claimed key over the exact issued text, made inside the window. The minors below are mostly test gaps. Mutation runs show that a few important checks could regress without any test failing (M1, M2). There is also one hold race that does not follow the pattern Task 18 just set (M3).

## What I ran

All of these were run at 86e250f and again at 8c4ee21:
- `vitest run` on the api tests (pastrep, pgp, schema, coolingOff) plus `packages/accounts/test/pgp.test.ts`: 5 files, 276 tests pass at 8c4ee21 (274 at 86e250f).
- `npm run typecheck`: 0. `npm run separation-check`: ok. `npm run semgrep`, which now includes `--config tools/semgrep`: 0 findings.
- **Semgrep rule fires.** I planted `import http from 'node:http'`, `fetch('x')`, `import('node:dns')` and `require('https')` in `apps/api/src/pastrep/challenge.ts`. The rule gave 4 findings, then I reverted the file.
- **Real GnuPG 2.x.** I used an Ed25519 sign-only key in a scratch GNUPGHOME and called `verifyPastRepSignature` directly:
  - `gpg --clearsign` → ok.
  - `gpg -a --detach-sign`, a binary signature over an LF file ending in a newline → ok.
  - `gpg -u old@mail.example -a --detach-sign` → `bad-signature`. With `-u <email>`, GnuPG adds a Signer's User ID subpacket on its own. This is evidence for claude3's existing owner question, not a new one.
- **openpgp.js probes:**
  - Binary detached signatures with CRLF and a trailing newline → ok.
  - A signing subkey that is RSA 1024 under an Ed25519 primary → `wrong-key`, which is correct.
  - A standalone (0x02) or timestamp (0x40) signature does not verify against the text. openpgp refuses it ("Message is not signed"), so nothing is needed.
  - A signature dated 3 min ahead of the server → `bad-signature` (see N1).
  - A key that expires between start and finish → `wrong-key` (see N2).
  - A `Comment:` armor header in the paste is accepted and stored as-is (see M4).
- **Mutation runs** (each reverted afterwards). These mutations made tests fail, as they should:
  - removing the one-signature rule;
  - removing `byClaimedKey`;
  - removing the window, or only its lower bound;
  - removing the shape checks (the edges and the block counts);
  - removing the Signer's User ID refusal;
  - removing the `data` comparison;
  - using the login AAD label;
  - calling `storableKey` without options;
  - removing the challenge-owner check;
  - removing the expiry check;
  - not marking the challenge used;
  - loosening the inspection options;
  - flipping either `inspectPublicKey` default.

  These mutations **survived**, meaning no test failed:
  - `verify.ts` final `return refuse('wrong-text')` changed to `return { ok: true }` (M1).
  - `PAST_REP_VERIFY_CONFIG` in `verify.ts` replaced by `{ ...openpgp.config, minRSABits: 1024 }` (M2).
  - `byClaimedKey` checking at `null` instead of `now` (M2).
  - `allVerified` replaced by `true`. This is acceptable: `expectSigned: true` already throws, so it is defence in depth.
  - Either `used_at` check removed on its own. The other check, or the transaction, still covers it, so this is acceptable. N4 covers the missing concurrency test.
  - The `fingerprint-claimed` pre-check removed. The partial unique index still maps it to the same 409, so this is acceptable.

## Findings

### Important
None.

### Minor

**M1. The detached path has no negative test, and a regression to "accept anything" goes unnoticed.** `apps/api/src/pastrep/verify.ts:136-149`.
Failure scenario: someone edits the candidate loop, for example by catching too widely or by returning ok after the loop. Then any detached signature by the claimed key over *any* text (an old signature the victim posted publicly, a signed release file, and so on), or even a broken one, is accepted. The suite stays green; I tested exactly this mutation. Every "wrong text" test uses cleartext. `detach(` is only used for positive cases (`pastrep.test.ts:144`, `:375`).
Fix: add detached cases. A detached signature over the text with a different nonce → `wrong-text`. A detached signature over the text plus an extra line → `wrong-text`. A detached signature by another key → `wrong-key`. A detached signature dated 2 h before `issuedAt` → `wrong-text`.

**M2. Nothing tests that verification uses the past-rep config, or that a subkey is judged at `now`.** `verify.ts:28` (`const config = PAST_REP_VERIFY_CONFIG`) and `verify.ts:61`.
The test at `pastrep.test.ts:247` checks the *constant*: RSA 2048 passes under PAST_REP_VERIFY_CONFIG and fails under STRICT. It does not check that `verify.ts` uses it.
Failure scenario 1: `verify.ts` falls back to openpgp's default config. Then a weak signing subkey under a strong primary is accepted. `inspectPublicKey` with `requireEncryption: false` looks only at the primary key, so this verify config is the only thing that refuses an RSA-1024 or otherwise weak signing subkey.
Failure scenario 2: `getSigningKey(..., now)` changes to `null` or to the signature date. Then a signing subkey revoked or expired at `now` still passes.
Fix: add two finish tests.
- An Ed25519 primary with an RSA-1024 signing subkey (make it with `config: { minRSABits: 1024 }`): start succeeds, a signature by the subkey → `wrong-key`. I checked by probe that today's code gives `wrong-key`.
- A signing subkey whose binding expires, or that is revoked, between the signature and `now` → `wrong-key`.

Optionally, `start` could refuse a key that has no signing key usable at `now` under PAST_REP_VERIFY_CONFIG (see N3).

**M3. Finish re-checks neither the hold nor the live session inside its transaction. This is not the pattern Task 18 just landed.** `apps/api/src/pastrep/routes.ts:114` and `:140-163`; `hold.ts:539` (finish is still in `LIVE_SESSION_EXEMPT`) and `:582`.
`requireNotHeld` runs only in the preHandler. Finish then spends time on `openKey` and up to 4 RSA verifies before `withTx`, and the transaction locks only the challenge row.
Failure scenario 1: a thief's session posts finish. The owner's weak login starts a hold, or the owner's proof revokes the thief's session, while verification is still running. The claim is inserted anyway, during a hold that the owner (1 Nov) said makes the account "offline to everyone", or by a session that is already dead.
Task 18 handled exactly this race with `ownerWriteGate`: `requireLiveSessionInTx` plus `holdInTx` under the account lock, with a "hold racing the preHandler" test, and the team routes are in `LIVE_SESSION_ROUTES`.
Impact is limited. The row is only `signed`, waiting for a moderator, and the owner can remove it. It is still a gap against an owner rule.
Fix: inside finish's `withTx`, lock the account, then call `requireLiveSessionInTx`, then `holdInTx`, refusing with `holdRefusal`. Do this before the challenge `for update`, to keep the account-lock order. Move `POST /v1/account/past-rep/finish` from `LIVE_SESSION_EXEMPT` to `LIVE_SESSION_ROUTES` and add a coolingOff test row. Add a race test like Task 18's: the hold starts after the preHandler → 403 `recovery-hold`, no row, challenge not used. Start only writes a challenge, so its preHandler check is enough. Leaving start exempt is fine.

**M4. The stored `signature` keeps free-text armor headers. A `Comment:` (or other) header with an email is stored readable.** `routes.ts:138` (`const signature = signed.replace(...).trim()`); column `past_reputation.signature` (migration 304).
The plan's R16 test only checks the *key's* user ID (`pastrep.test.ts:397`). Armor headers are not signed and are free text the trader controls. Some tools add `Comment:` lines with an address or a URL, and older Enigmail/GPGTools set-ups do this. My probe: a cleartext paste with `Comment: alice@mail.example` verifies ok and would be stored as typed. The plan's privacy line (spec section 718: "no user ID or email inside a key is stored readable") concerns key user IDs, so this is next to the plan rather than against it. But storing the paste readable undercuts the effort spent stripping user IDs.
Fix: store a canonical form. Either re-armor the one verified signature packet (`new openpgp.Signature(packets).armor(ARMOR_CONFIG)`, which has no headers) and rely on `challenge_text` for the text, or rebuild the cleartext block from `challenge_text` plus the re-armored signature. Task 11 can re-verify either form. Add a test: a paste with `Comment: a@b.c` → the row contains no `a@b.c`.
(Notation subpackets inside the signed packet stay. openpgp.js itself adds a salt notation, so refusing notations would break real signers. Mention this in the Task 11 notes.)

### Nits

**N1. The documented "+5 min" skew does not exist.** `verify.ts:120-121` versus `openpgp.verify({ date: now })` at `:126` and `:141`. openpgp throws "Signature creation time is in the future" for any `created > now`. So a signer whose clock is 1-5 min fast gets `bad-signature`, not ok. The upper bound in `inWindow` is dead code. Fix: either drop the "+5 min" from the doc and comments, or verify with `date: new Date(now + PAST_REP_CLOCK_SKEW_MS)` and keep `byClaimedKey(..., now)` for key validity. Add a test with the signer 3 min fast.

**N2. A key that expires between start and finish gets `wrong-key`.** The trader is told it's the wrong key when it's actually expired. Consider returning `key-expired` when `byClaimedKey` fails because of expiry, or say so in the popup copy.

**N3. Start accepts keys that can never finish.** Examples: a certify-only primary with no signing subkey, or one whose only signing subkey is weak. `packages/accounts/src/pgp.ts:244` returns ok before any signing check when `requireEncryption` is false. Consider a `key-no-signing` refusal at start, using `key.getSigningKey(undefined, now, undefined, PAST_REP_VERIFY_CONFIG)`. That would need a new KeyRefusal code, so it's a plan-level choice.

**N4. There is no concurrency test for two finishes of one challenge, or for two challenges for one site.** The code is right: the `for update` plus the 23505 mapping to the constraint names. A `Promise.all` test would pin it.

**N5. Finish is not throttled.** Each finish opens the sealed key and runs up to 4 verifies on bodies up to `PGP_BODY_LIMIT`. The cost is small, and only a logged-in owner session can call it. A per-account bucket like `pastRepStart` would be cheap. Not blocking.

**N6. The semgrep rule covers direct imports in `pastrep/**` and `staff/pastrep.ts` only.** It would not catch `globalThis.fetch`, `node:child_process` (for example running curl), or a helper imported from another module that fetches. The runtime stub test (`pastrep.test.ts:487`) covers the flow today. Consider adding `child_process` and `globalThis.fetch` to the patterns.

**N7. The start throttle is in-memory per process (`KeyedBuckets`).** It resets on restart and isn't shared across instances. That's the same as the other budgets, so it's consistent. Noting it only.

## Checked and fine
- **openpgp config.** `PAST_REP_VERIFY_CONFIG` is BASE plus minRSABits 2048 plus login's rejected algorithms and curves. Login's defaults are unchanged; the mutations flipping them failed 4-5 tests each.
- **Signature binding.** The signature must be over the exact text: what is compared is the `data` that verify returns, there is exactly one block, and nothing may sit outside it. Normalization (CRLF, trailing whitespace) does not widen what is accepted beyond what the cleartext spec already ignores. The detached variants are limited to line-end style and one trailing newline.
- **Replay across accounts and sites.** The challenge row is bound to the account (another account gets `challenge-expired`, and no row is written). The text binds the checked `Origin` (`requestOrigin`, from the config allowlist only), the display name (`[A-Za-z0-9._-]`, so no line injection into `issuedAtOf`), the site, the URL (`href`, with control characters and backslash refused), the fingerprint, an 80-bit nonce and the time. The challenge is single use, marked inside the inserting transaction, and expires in 60 min.
- **Revoked and expired keys** at start; **subkeys** go through `getSigningKey`, which applies the config's algorithm requirements.
- **No fetch or DNS lookup.** The URL check is purely syntactic, and the typed-authority check stops `:443`, userinfo, trailing dots, `.evil` suffixes and `\@` tricks.
- **Storage.**
  - Keys are sealed under their own AAD, `x2f/pastrep-key/<fp>`, which cannot be confused with `x2f/pgp-key/`.
  - The v6 user ID is stripped by `storableKey` with the past-rep options.
  - The challenge payload holds only the sealed key.
  - Responses and logs carry no key material.
  - Refusal `detail` strings carry no user IDs.
- **Indexes and races.** The partial unique indexes plus the 23505 mapping by constraint name.
- **Routes and access.** Members get 403 `owner-only`; backup sessions are refused. The follow-up puts start and finish in `HOLD_BLOCKED_ROUTES`, while list and delete stay open, and its tests pass. The throttle is 10 an hour per account, taken after the cheap checks and before key inspection; a refused key counts; the answer is 429 `slow-down`.
- **Refusal codes** are classified in `cantDoCodes.ts`.

## OWNER QUESTIONS
I'm not repeating any of claude3's (owner-only routes, hold-blocking, email-in-signature refusal, same key for two sites, popup copy, rate limit, re-claiming a revoked key). Two additions:

1. **Supporting data for the email-in-signature question.** GnuPG adds the Signer's User ID automatically whenever the signer picks the key with `-u <email>`, which is common. Plain `gpg --clearsign` and `--detach-sign` don't add it. Whatever the owner decides, the Task 12 instructions should tell traders to sign with `-u <fingerprint>`, or with no `-u`.
2. **(New) Should the stored signature keep the paste's armor headers (M4)?** Recommendation: no. Store the signature canonicalized, with no headers. This is a privacy behaviour the plan didn't settle, so it needs the owner's yes before the fix, or the lead can treat it as covered by R16's intent.

---

## Round 2 (2026-11-01): `8c4ee21..8ddbd4d` (red tests 3fa75d8, fix 8ddbd4d)

### Verdict: APPROVED

Every finding asked for (M1-M4; N1, N3-N6) is fixed. Each fix has a test that fails when I revert the fix, with the two caveats noted for N1 and N6 below. Nothing on the security side is newly decided. The three small choices the fix makes are listed under "For the lead".

### Runs at 8ddbd4d
- api pastrep, pgp, schema and coolingOff, plus accounts pgp: 5 files, **290 tests pass**. `npm run typecheck`: 0. `separation-check`: ok. `npm run semgrep`: 0 findings.
- I planted `import cp from 'node:child_process'`, `globalThis.fetch` and `globalThis['fetch']` in `pastrep/challenge.ts`. The rule gave 3 findings, then I reverted the file.
- Worktree is clean at 8ddbd4d. Nothing committed or pushed.

### Revert-and-run, one mutation at a time, each reverted afterwards

| Finding | Fix | Mutation | Result |
|---|---|---|---|
| M1 | detached negatives (wrong text, other key, too early) | final `refuse('wrong-text')` → ok | **fails** (1) |
| M2 | weak subkey and subkey judged at `now` | verify config → openpgp default with minRSABits 1024 | **fails** (1) |
| M2 | | `getSigningKey(..., now)` → `null` | **fails** (1) |
| M3 | `requireLiveSessionInTx` (which takes the account lock) + `holdInTx` inside finish's transaction, before the challenge `for update`; finish moved to `LIVE_SESSION_ROUTES` | live-session re-check removed | **fails** (2, incl. coolingOff) |
| M3 | | hold re-check removed | **fails** (1) |
| M4 | stores only the one verified packet re-armored (`verdict.signature`), so no armor headers | store the raw paste again | **fails** (1) |
| N1 | doc now says `[issuedAt − 5 min, now]`; test with a fast signer clock | upper bound widened to `now + 5 min` | passes (expected: openpgp's `date: now` refuses future signatures anyway, so the bound in `inWindow` is only belt-and-braces; the test still pins the behaviour) |
| N3 | `canSign` at start → 400 `key-no-signing` | check removed | **fails** (1) |
| N4 | concurrent finishes (same challenge; same site) | in-transaction `used_at` check removed | **fails** (1) |
| N5 | `PAST_REP_FINISHES_PER_HOUR` bucket | `take` removed | **fails** (1) |
| N6 | rule adds `child_process` and `globalThis` | `child_process` dropped from the regex | passes. The test only greps the YAML text, which still contains the word in a comment. The rule itself works (checked by the plant above). |

### Notes (non-blocking)
- **n1.** The N6 test is a string check on the YAML. It would be stronger if it ran semgrep on a fixture, but that matches the existing semgrep test style. Fine as it is.
- **n2.** M4: for a cleartext paste, the stored detached form verifies over the issued text only because `data` matched it after normalization. If a signer's cleartext ended with extra blank lines, the stored text-mode signature covers those lines, so a Task 11 re-verify may need the same variants `verify.ts` tries. Worth a line in the Task 11 notes.

### For the lead (small choices made in the fix, all flagged by claude3 too)
1. **The finish throttle is 10 an hour per account**, the same as start, "until decided". A trader who mistypes their paste a few times spends attempts. Owner or lead to confirm the number.
2. **New refusal code `key-no-signing`** (KeyRefusal union; `cantDoCodes` lists it as an input check, not a refusal). I suggested it at N3. It's an input check and needs popup or field copy in Task 12.
3. **No forward clock allowance.** The plan's "+5 min" is not delivered, because openpgp refuses signatures dated after `now`. This is documented, and claude3 left it as an open question. A trader whose clock is fast gets `bad-signature`. The Task 12 copy could say "check your computer's clock". To allow the skew, verify with `date: now + 5 min`.
