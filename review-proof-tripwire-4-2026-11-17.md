# Review: proof tripwire 4 (wip/lead-proof-tripwire-4 @432290f4)

Date: 17 Nov 2026. Reviewer: independent security reviewer (Claude), worktree `.claude/worktrees/review-ptw4`.
Scope: one commit on ff051b73. It answers review-proof-tripwire-3-2026-11-13.md: P-I4, P-M1, P-M2, P-I1.
Files: `apps/web/src/chat/payDetailsFeed.ts`, `apps/web/test/proof-render-tripwire.test.ts`,
`apps/web/test/sessionForget.test.tsx`.

## Verdict

**APPROVE WITH MINORS.** 0 blocking, 3 minor, 4 info.

- P-I4, P-M1 and P-I1 are done properly.
- P-M2 closes every snippet it lists, but the same bypasses still work in other shapes.
  - `.body +=` was in the last review's suggested regex and was left out.
  - Several split-key forms still pass, although the new tests claim that class (`'bo' + 'dy'`) is covered.
- The tripwire is still a guard against mistakes, not a boundary. That was accepted in V-M2 and
  tripwire-3, so none of this blocks.

## 1. P-I4: clearing `latest` (the seller's payment-detail rows)

What the commit does:
- `forgetChatSnapshots()` now clears `latest` as well as `snapshots`.
- The last panel's release deletes `latest[key]` under the same `!listeners.has(key)` condition as the snapshot.
- The card's own cleanup already deleted `latest` when its last listener went.

Every way a session ends, checked against the code:

| How the session ends | Path | Rows cleared? |
|---|---|---|
| Log out button, or "Stay logged in?" time-up (SessionPrompt) | `logOut` → `finally forgetLocalSession()` | yes, even when `/v1/logout` throws (tested) |
| 401 `not-authenticated` from any `api()` call but `me` | client.ts:160 → session-gone listener → `forgetLocalSession()` | yes (tested) |
| This device logged out by its own approval (LoginApprove, one device) | `forgetLocalSession()` + `refreshSession()` | yes (same function) |
| Last ChatPanel for the trade closes, no pay card listening | panel release | yes (tested) |
| Last pay card for the trade unmounts | card cleanup (unchanged) | yes |
| Tab closed or reloaded | memory only | yes |

The gaps that remain are all pre-existing:
- **PTW4-I1 (info):** a `me` 401 in the middle of a page (P-I2) does not clear. Neither does a
  session ended elsewhere while this tab only polls the chat. The chat engine's fetch runs in the
  escrow worker (chat/http.ts) and never reaches the session-gone listener.
  - In practice the trade room also polls `api()`, so the next poll 401s and clears.
  - Recommendation: none needed now. If P-I2 is ever closed, close this with it.
- **PTW4-I2 (info):** the sign-up "Start trading" step in Welcome.tsx ends the session with
  `authApi.logout()` and skips `forgetLocalSession()`.
  - A just-made account has no trades, so it has no rows, snapshots or proof ids to forget. Nothing leaks.
  - It is the one log-out that bypasses `logOut(env)`. Routing it through `forgetLocalSession()` costs one line.
- **PTW4-I3 (info, the old P-I5 now also covers rows):** a publish can repopulate `latest` after it was cleared:
  - a `postProofToChat` publish that resolves after both the card and the panel are gone;
  - or a sync still in flight at log-out.
  - Either leaves the rows in memory with no owner. A later unmount or log-out clears them.
  - A one-line guard closes it: `publishPaySnapshot` stores only while `panels.has(key) || listeners.has(key)`.
  - The commit's own comment says this honestly: "A card still mounted keeps what it shows until its next sync".

### The `latestPayRows` export

- It is imported only by `test/sessionForget.test.tsx`. No file under `apps/web/src` or
  `apps/staff-web/src` imports it.
- In a production build, Rollup drops an unused export. Even if it stayed, it is a module-scoped
  function, not attached to `window`.
- It returns exactly what `latestChatSnapshot` (already exported, and used by chatProof.ts) already
  exposes: the full snapshot, including the `pay` line these rows come from.
- **It exposes nothing new.**

### The tests

- The four new `sessionForget` cases each check the positive state first, so a fixture that never
  stored rows would fail: `toEqual` on the labelled rows, `not.toBeNull` after the first of two panels.
- They then assert `toBeNull` after:
  - `logOut` with a throwing `/v1/logout`;
  - an `api()` 401;
  - the last panel's release.

## 2. P-M1: the import pin is read from the parser's module record

- `importsOf` now walks `module.staticImports`, from the same oxc parse that strips comments.
- `otherModuleReach` lists re-exports (`staticExports` entries with a `moduleRequest`), `import()`
  calls (`dynamicImports`) and every `import.meta` that is not `.env.NAME`.
- The self-test adds a multi-line import, `type` inside the braces, `c as e`, a second import on the
  same line, and `default + { named }`. Those are exactly the misses P-M1 reported.
- Probed with oxc directly (scratch script, not committed):

| Input | Result |
|---|---|
| `export * as ns from`, `export { default } from` | caught as re-export |
| `import { x } …; export { x }` | caught (oxc treats it as an indirect export; stricter, harmless) |
| `import(/* c */ './x.js')` | caught |
| `import type { T }`, `import { type T, u }`, `with { type: 'json' }` | read into the pin, so any of them changes the list |
| `import x = require('./x.js')` (TS import-equals) | not in `staticImports`, but ChatProof's text rule `\brequire\s*\(` catches it |

- `\brequire\s*\(` is checked only in the ChatProof pin test, not in the decrypting-file gate.
  That is fine, because the gate allows ChatProof alone (DECRYPT_ALLOWED).
- The namespace label changed from `(namespace * as h)` to `(namespace h)`. That is a rename of the
  label, not a weakening: a namespace import still changes the pinned list.

## 3. P-I1: `import.meta` in a decrypting file

| Input | Result |
|---|---|
| `import.meta.glob(…)`, `.globEager`, `import.meta['glob']`, `const m = import.meta; m.glob` | caught (the commit's own tests) |
| `import . meta . glob` | caught (the commit's own tests) |
| `import.meta.url` (e.g. `new Worker(new URL(…, import.meta.url))`), `import.meta.hot` | caught (my probes) |
| `import.meta.env['X']`, `const e = import.meta.env` | caught (my probes) |
| `import.meta.env.VITE_X` | allowed, as intended |
| `import.meta.env.VITE_X.constructor` | allowed, harmless |

- Vite rewrites `import.meta.glob` only in its literal call form, so an alias would not even load modules.
- **The rule is sound.**

## 4. P-M2: the new body rules

The commit's snippets all fail the gate as claimed:
- `??=`, `||=`, `&&=` on `.body`;
- a `'body'` const;
- `init[K] =` and `??=`;
- `Reflect.set`, `Object.defineProperty` and `Object.fromEntries` with a split key.

My own snippets, run against the committed `OUT_RULES`, in a scratch copy of the test and a node
regex harness:

| # | Snippet (K = `'bo' + 'dy'` where used) | Result |
|---|---|---|
| 1 | `init.body += plain;` | **missed** |
| 2 | `init[K] += plain;` | **missed** |
| 3 | `({ x: init.body } = { x: plain });` | **missed** |
| 4 | `[init.body] = [plain];` | **missed** |
| 5 | `for (init.body of [plain]);` | **missed** |
| 6 | `Object.assign(init, { get [K]() { return plain; } })` | **missed** |
| 7 | `fetch(u, { method: 'POST', get [K]() { return plain; } })` | **missed** |
| 8 | `class I { method = 'POST'; [K] = plain; }` then `fetch(u, new I())` | **missed** |
| 9 | `init[\n  K\n] = plain;` (a line break in the index) | **missed** |
| 10 | `init[k[0]] = plain;` (a nested index) | **missed** |
| 11 | `const R = Reflect; R.set(init, K, plain)` and `const O = Object; O.defineProperty(…)` | **missed** |
| 12 | `Reflect['set'](init, K, plain)`, `Object['fromEntries'](…)` | **missed** |
| 13 | `{ body: plain }`, `init.body = plain` (a Unicode escape in the identifier) | **missed** |
| 14 | ``fetch(`${u}?d=${plain}`)``, `headers: { 'x-d': plain }` | missed; out of scope since V-M2 ("a regex is not the boundary") |
| – | `Object.assign(init, { [K]: plain })`, `{ [K]\n: plain }`, `init?.body ??= plain`, `init[K]\n??= plain`, `{ ...{ [K]: plain } }` | caught |

The minors:
- **PTW4-M1 (minor): `.body` with a compound assignment, or as a destructuring or for-of target, still passes (rows 1 to 5).**
  - Tripwire-3 suggested `\.\s*body\s*(?:[-+*/%&|^]|\?\?|&&|\|\||<<|>>>?|\*\*)?=(?!=)`. The commit took only `??`, `||` and `&&`.
  - `init.body += plain` needs no key splitting at all. It sends `"undefined"` followed by the plaintext.
  - Fix: ChatProof's only `.body` uses are reads, `res.body?.`, `res.body.`, `=== null` and `!== null`.
    Turn the rule into an allowlist: flag every `\.\s*body\b` not followed by `\s*(?:\?\.|\.|[!=]==)`.
  - That closes rows 1 and 3 to 5 in one rule, and needs no list of operators. Row 2 belongs to M3.
- **PTW4-M2 (minor): a computed key outside a plain `{ [k]: v }` passes (rows 6 to 8).**
  - Missed forms: a computed getter or setter (`get [K]()`) in an object literal, and a computed class field.
  - fetch and `Object.assign` both read the getter's value, and fetch reads a class instance's own fields.
  - The commit's own tests use `'bo' + 'dy'`, so the split-key class is claimed as covered, but these shapes are not.
  - Fix: also flag `\b(?:get|set|static|async)\s*\[` and a `[` that starts a class member. Better:
    flag any `computed: true` Property, PropertyDefinition or MethodDefinition in the AST, which the
    test already parses (`parseSync(...).program`).
- **PTW4-M3 (minor): the indexed-assignment and property-call rules are text-shaped (rows 2 and 9 to 12).**
  - The indexed-assignment rule fails on:
    - `+=` and the other compound operators (row 2);
    - a line break inside the brackets;
    - a nested `]`.
  - The property-call rule fails on an alias or a bracket access of `Reflect` or `Object`.
  - ChatProof uses neither `Reflect` nor `Object` today. Banning `\bReflect\b` and `\bObject\b`
    outright in a decrypting file costs nothing and closes row 11 and row 12.
  - For the index rule, the AST check is the clean fix: flag an AssignmentExpression, of any
    operator, whose left side is a computed MemberExpression. Also flag a computed member as a
    destructuring or for-in/for-of target.
- **PTW4-I4 (info): a Unicode escape (row 13).** oxc reads `body` as `body`, but the regexes see the raw text.
  - ChatProof has no `\u` or `\x` escapes, so a blanket ban on `\\[ux]` in a decrypting file is free.
  - Moving the rules to the AST, which reads names after unescaping, closes it too.

On false positives:
- The new indexed-assignment rule also flags an ordinary array write (`parts[0] = x`, probed: caught).
- ChatProof writes no index today (it uses `push`), so that is tolerable for the one decrypting
  file. But the false-positive guard list should not suggest array writes are allowed.

Overall: M1 to M3 and I4 all point the same way. The test already parses each file with oxc, so
moving the body, key and call rules from regexes to an AST walk would close this whole class at once.
That is pure engineering and the lead's call. None of it is a product decision.

## 5. Weakened tests

None:
- The `.body =` rule is a superset of ff051b73's.
- The quoted rule changed from `\[\s*['"`]body['"`]\s*\]|['"`]body['"`]\s*[:,\]]` to `(['"`])\s*body\s*\1`.
  It now matches any quoted `body`, which is a superset.
- The text checks for `import(` and `require(` in ChatProof became `dynamicImports`, which is
  parser-exact, plus the same `require(` regex.
- `importsOf`'s old expectations are kept, apart from the namespace label (section 2), and new forms are added.
- The "does not trip" list gained four guard snippets. Adding negative cases does not loosen anything.
- `expect(gated).toBe(DECRYPT_ALLOWED.length)` is unchanged.
- The decrypting-file gate gained `otherModuleReach`.
- Nothing is skipped, quarantined or loosened.

## Runs

All test runs were under `~/x2f-comms/check.lock`, with the timeout inside the flock. The head is 432290f4.

| Run | Result |
|---|---|
| Targeted web files: proof-render-tripwire, sessionForget, chatProof, chatProofReceive, chatProofSend, logout-tripwire | 6 files, 65 passed |
| `vitest --project @x2f/web` (scratch probe removed first) | 142 files, 2188 passed |
| `vitest --project @x2f/proof` | 14 files, 373 passed |
| `vitest --project @x2f/staff-web` | 5 files, 52 passed |
| `vitest --project tools` | 3 files, 13 passed |
| `tsc --noEmit` for apps/web, apps/staff-web, packages/proof | 0 errors |
| Scratch probe (a copy of the tripwire test plus a REVIEWER block; deleted before the web run) | ran green, but vitest silenced its console output |
| Probe results | from a node harness that evals the committed `OUT_RULES`, and from a direct oxc `parseSync` script (sections 2 to 4) |

The web count is 2182 from tripwire-3's run plus 6 new tests: 4 in sessionForget and 2 in the tripwire.

Not run:
- the full `npm run check`. The lead's brief named these projects, and the lock queue was over two hours deep;
- Playwright, since nothing changed that the browser sees.

Before landing, the lead's own `npm run check` on the stack covers the rest.

## Summary

- **APPROVE WITH MINORS (432290f4).** 0 blocking, 3 minor, 4 info.
- **Minor:**
  - PTW4-M1: `.body +=`, and `.body` as a destructuring or for-of target, pass. Use a read-only allowlist for `.body`.
  - PTW4-M2: a computed getter, setter or class field with a split key passes.
  - PTW4-M3: the index and Reflect/Object rules fail on a line break, a nested index, `+=`, an
    alias or a bracket access. Ban `Reflect` and `Object` outright, and move the index check to the AST.
- **Info:**
  - PTW4-I1: a `me` 401 mid-page, or a session ended while only the worker polls, does not clear (pre-existing).
  - PTW4-I2: the Welcome sign-up log-out skips `forgetLocalSession` (nothing to leak).
  - PTW4-I3: a late publish can leave an orphan entry in `latest`, as P-I5 already does for snapshots.
  - PTW4-I4: a Unicode-escaped `body` passes.
- **No owner questions.** Every item is engineering.
