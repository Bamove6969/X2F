# Review: wip/lead-proof-tripwire-3 at ff051b73 (on ef27cf31)

Reviewer: independent helper. Worktree: detached at ff051b73, fresh `npm ci`, removed after.
Every run was under `flock ~/x2f-comms/check.lock`, with the timeout inside the flock. dockerd was not touched.

## Verdict

**APPROVED for the commit itself.** It does what review-proof-tripwire-2 asked, it weakens no test, and
every requested suite and spec is green.

**The stack is not ready to land as it stands.** The full `npm run check` (rule of 13 Nov) is red, with
1 failure. The failure is in `packages/auth-client/test/flows.test.ts`, and it does not come from this
commit:
- ff051b73 touches only `apps/web`.
- The failing routes come from the proof stack's API (084dd79f, 88b5ca63).

See R0 below. Everything else here is minor or info.

## R0. The full check is red, and the cause is in the stack, not this commit (blocks landing)

`npm run check` stopped at `npm test`: 372 of 373 files passed, with 6913 tests passed, 1 failed and
1 todo.

Before `npm test`, these passed: typecheck (all workspaces), copy-lint and separation-check. Because of
`set -e`, semgrep and audit did not run.

The failure is `flows.test.ts` "every route of the API has its client method". These five proof routes
are neither in the client nor in `NOT_AUTH_CLIENT`:
- `GET /v1/trades/:code/blur-checks`
- `GET /v1/trades/:code/proofs/:id|:proofId`
- `POST /v1/trades/:code/blur-checks/:proofId`
- `POST /v1/trades/:code/proofs/:id|:proofId/blur-check`
- `PUT /v1/trades/:code/proofs/:id|:proofId`

origin/main (4f0afa14, batch 9) already lists three of them in `NOT_AUTH_CLIENT`, but under the param
name `:proofId` only. The stack's routes register both `:id` and `:proofId`, and the PUT is new.
origin/main is not an ancestor of ff051b73. Fix this at the stack's rebase onto main, or as one
follow-up commit: add the five to `NOT_AUTH_CLIENT` with their web callers named, as the file's comment
asks. This needs only the lead's mechanical judgement.

## 1. The import pin (T-M1)

What it covers:
- `CHATPROOF_IMPORTS` matches ChatProof.tsx's five imports exactly. The `importsOf` self-test covers
  the named, namespace, side-effect and default forms.
- Multi-line `{ … }` imports, `import type`, aliased names (`useState as send`), `default + { named }`
  and `with { type: 'json' }` are all read. Each would change the pinned list, so each would fail.
- Dynamic `import(` and `require(` are banned on the comment-stripped code, so `import /*x*/ (` is
  caught too.

What it misses:
- **P-M1 (minor): an import that does not start its line is missed.** The regex is anchored with
  `^\s*import`. I probed it with `import { a } from 'react'; import { send } from './helper.js';` and
  with `const x = 1; import { send } from './helper.js';`. In both, the helper import is invisible to
  the pin. Nothing in `npm run check` formats the code (there is no prettier step), so this is easy to
  write.
- The test already parses the file with oxc (`parseSync` in `code()`). Its `module.staticImports`,
  `staticExports` and `dynamicImports` list every import exactly. I checked: they catch the two
  same-line cases, `export … from` and a dynamic import. Reading the pin from the parser instead of a
  regex closes this class of misses.
- **P-I1 (info):** `import.meta.glob('./x.js', { eager: true })` (Vite) loads modules and is not
  banned. `globalThis['req'+'uire']` and `eval('import(…)')` are deliberate exfiltration, which is
  outside what a regex can stop. Banning `\bimport\s*\.\s*meta\b` in ChatProof costs nothing, because
  ChatProof does not use it today.
- `export … from` is not read by the pin. That is fine: a re-export moves no data.

## 2. The new regexes (T-M2)

What it catches:
- Every listed snippet: `Reflect.set(…, 'body', …)`, `defineProperty`, `fromEntries([['body', …]])`,
  `init. body =`, `init .body=`.
- Also `` `body` `` in backticks and `init?.body =`.
- ChatProof's own `res.body` reads trip none of the rules. Neither do `res.body >= 1` or
  `a.body!==b`.

False positives, scanned over all of `apps/web/src` and `apps/staff-web/src`:
- The new quoted-body rule hits 0 files.
- `.\s*body\s*=` hits only the two API clients, which are not gated.
- `['head', 'body']` and `t('body', x)` would trip it in a decrypting file. That is acceptable for a
  file that must never build a body.

**P-M2 (minor): bypasses that are still easy.**

| Snippet | Result |
|---|---|
| `init.body ??= plain` and `init.body \|\|= plain` (logical assignment) | missed |
| `const k = 'body'; init[k] = plain` (the rule's terminators are `[:,\]]`, not `;`, `)` or the end of a line) | missed |
| `init['bo' + 'dy'] = plain` | missed (deliberate) |
| `fetch(\`${u}?p=${b64(plain)}\`)` | missed (as noted in V-M2: a regex is not the boundary) |

The first two are cheap to close:
- Use `\.\s*body\s*(?:[-+*/%&|^]|\?\?|&&|\|\||<<|>>>?|\*\*)?=(?!=)`.
- Use `['"`]body['"`]` followed by any non-identifier character, or simply any quoted `body` literal
  in a decrypting file.

## 3. Session clearing (T-I2)

- The 401 listener is `forgetLocalSession()` and then `sessionEnded()`. The client still excludes
  `/v1/account/me` from it (client.ts:160).
- **When `me` answers 401:**
  - On a page load, the in-memory maps are new, so nothing stale exists to clear.
  - The only kept item that persists is the feedback draft in sessionStorage. It is meant to survive
    the log-in round trip, and the owner check guards it. Clearing on a `me` 401 would break that
    round trip for a signed-out visitor, so the exclusion is right.
  - **P-I2 (info):** a mid-page `me` 401, after `refreshSession()`, leaves the in-memory sent ids, chat
    snapshots and kept text in place until the next log-out or session-gone. This needs the session to
    die between a successful call and the `me` right after it, and the next login (Login.tsx
    `afterLogin`) does not clear either.
  - If the lead wants that closed: in `load()`, clear only the in-memory parts
    (`forgetSentProofs` + `forgetChatSnapshots` + `forgetKeptText`) on a `me` 401, never the feedback
    draft. Low priority.
- **logOut's `finally`:**
  - Both SessionPrompt callers do `void logOut(…).catch(() => undefined)`. At time-up, the logout's
    401 already fired `sessionEnded`, which the old code did too. The new code forgets the local
    session even though `/v1/logout` throws, so a time-up after expiry is now covered as well.
  - LoginApprove calls `forgetLocalSession()` and `refreshSession()` directly, unchanged.
  - The Playwright login spec (25, including new-device approval and expired-session-returns) and the
    logout tripwire are green.
- **The feedback round trip after a 401:** I checked it with a temporary probe, a copy of
  CantDoThat.test with one extra assertion, deleted afterwards. A 401 on Send clears the draft through
  the listener. The mounted form's save effect then re-saves it on the `signed-out` state change, so
  "What you wrote is kept." stays true.
  - The existing test checks only the alert text, not storage. An assertion like the probe's would
    guard this.
- **P-Q1 (question for the lead):** the session-gone path now also drops the trade chat draft
  (`forgetKeptText`). The commit message records acceptance only for a failed log-out. Before this
  commit, a draft typed when the session expired survived the front door's /login → returnTo round
  trip in the same page load. Now it is gone, and the text box empties at the 401. This is safe, and
  consistent with a log-out. It is user-visible, though, so the lead should confirm it is intended.
  Recommendation: keep it.

## 4. payDetailsFeed (T-I3)

- **No premature delete while a pay card listens.** The panel release deletes the snapshot only when
  `!listeners.has(key)`. `listeners` loses a key only when its set is empty, so a listening card
  always keeps it.
- **No leak from an open panel.** Its publishes are guarded by `alive.current`, and its release runs
  on unmount.
- `forgetChatSnapshots` from `forgetLocalSession` clears the rest.
- **P-I3 (info, pre-existing): the reverse case.** When the last card unmounts while a panel is still
  open, the card's cleanup deletes the snapshot, because it does not check `panels`.
  `chatProofState` then reads `unavailable` until the panel's next poll. That is safe (never
  `attached`). A symmetric `if (!panels.has(key))` would avoid the flicker.
- **P-I4 (info): `latest` is not cleared.** `latest` holds the seller's payment-detail rows, the
  account details shown on "Send exactly". `forgetChatSnapshots` does not clear it, and neither does
  the panel release. A panel that published with no card listening leaves the rows in memory past a
  log-out. They are less sensitive than the proof keys, but they are still a person's payment
  details. Clearing `latest` in `forgetChatSnapshots` and in the panel release (same condition) is a
  one-line change each.
- **P-I5 (info): a late publish can leave an orphan.** If `postProofToChat`'s publish resolves after
  both the card and the panel are gone, it leaves an orphan snapshot until log-out. This is rare and
  bounded by log-out.

## 5. The V-I1 expectation change (none → unavailable)

Justified:
- With T-I3 the snapshot is gone, and `proofStateOfSnapshot(null, …)` is `'unavailable'` by its own
  definition.
- The test still proves the sent ids are cleared. `chatProofState` returns `'attached'` first whenever
  the `sent` map has the trade, so a `forgetSentProofs` that skipped `sent` would still fail it.
  `proofCheckOf` being undefined proves `checks` is cleared.
- It is still an exact `toBe`.

## 6. Weakened tests

None:
- The tripwire's rules are a superset of ef27cf31's: the `.body =` rule widened, and the quoted rule
  gained `,` and `]`.
- The T-I4 change removes a cast, which makes the test stricter.
- `sessionForget.test.tsx` is new: 5 cases, each asserting the cleared state.
- Nothing is skipped and nothing was loosened.
- The nit (JSDoc above `noteProofSent`) is fixed.

## Runs

| Run | Result |
|---|---|
| web: proof-render-tripwire, chatProofSend, sessionForget, chatProof, logout-tripwire, CantDoThat + temporary probe | 7 files, 75 passed |
| `vitest --project @x2f/web` (probe removed) | 142 files, 2182 passed |
| `vitest --project @x2f/proof` | 14 files, 373 passed |
| `vitest --project @x2f/staff-web` | 5 files, 52 passed |
| `vitest --project tools` | 3 files, 13 passed |
| `tsc --noEmit` for apps/web, apps/staff-web, packages/proof | 0 errors |
| Playwright chat, login, proof-ocr (`--trace off --workers=1`) | 35 passed |
| `npm run check` (full) | typecheck, copy-lint and separation-check ok; `npm test` 372/373 files, 6913 passed, **1 failed** (R0), 1 todo; semgrep and audit not reached |
| Probes (regex and import forms, scratch scripts) | see sections 1 and 2 |

The web + proof + staff-web + tools counts (164 files, 2620 tests) match the builder's.

## Summary

- **APPROVED (ff051b73).**
- **Before landing:** R0. The stack's flows.test is red on five proof routes. This predates the commit
  and is fixed at the rebase or with one commit.
- **Minor:**
  - P-M1: the import pin misses an import that does not start its line. Read it from oxc's module
    record instead.
  - P-M2: `.body ??=` / `||=` and `const k = 'body'` still pass the rules.
- **Info:** P-I1 (`import.meta.glob`), P-I2 (mid-page `me` 401), P-I3 (card cleanup ignores open
  panels), P-I4 (`latest` payment rows survive a log-out), P-I5 (late publish orphan).
- **Lead question:** P-Q1. The 401 path now drops the trade chat draft. Recommendation: keep it.
