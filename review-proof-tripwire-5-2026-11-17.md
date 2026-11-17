# Review: proof tripwire 5 (wip/lead-proof-tripwire-5 @37d1b701)

Date: 17 Nov 2026. Reviewer: independent reviewer (Claude), worktree `.claude/worktrees/review-ptw5`.
Scope: one commit on tripwire-4 (432290f4). It answers review-proof-tripwire-4-2026-11-17.md: PTW4-M1, M2, M3, I4 and I3.
Files: `apps/web/test/proof-render-tripwire.test.ts`, `apps/web/src/chat/payDetailsFeed.ts`, `apps/web/test/sessionForget.test.tsx`.

## Verdict

**APPROVE WITH MINORS.** 0 blocking, 2 minor, 3 info.

- PTW4-M1, M2, M3, I4 and I3 are all done, and done properly. Every syntactic form from rows 1 to 13 is
  now caught by the tree rules, and each row has its own test.
- No earlier rule lost catching power, and no test was weakened.
- The tree rules close the *syntactic* class (operators, line breaks, nested indexes, static aliases,
  static brackets, Unicode escapes). They do not close the *dynamic* class: code built at run time
  (`eval`, `Function`), a key that comes from data (`JSON.parse`, `Proxy`), or a global reached by a
  split-string bracket. Every one of these still passes (section 2). The tripwire is still a guard against
  mistakes, not a boundary, as accepted in V-M2. So these are minors, but two cheap rules would close most of them.
- The lead's call to keep the old regexes as a redundant layer is respected. Nothing in this review asks to remove them.

## 1. What the commit does

`treeOut` walks the oxc `program` from the same `parseSync` that already strips comments and gives the module record.

- `body`, as an Identifier, PrivateIdentifier or JSXIdentifier, is allowed in one place only: the non-computed
  property of a member that is itself only read. Only read means it is the object of another member, or one side
  of `===`, `!==`, `==` or `!=`. Anything else fails: a key, a binding, a getter, a field, `#body`, a label,
  `const b = res.body`.
- `"body"` as a static string or a no-expression template fails anywhere, after `trim()`.
- A computed key on a Property, PropertyDefinition, MethodDefinition, AccessorProperty or TS signature fails
  unless the key is a static literal other than `body`.
- A computed member that is written fails unless its key is a static literal other than `body`. "Written" means
  `isWritten`: any assignment operator, `++`/`--`, `delete`, a for-in/of left side, or a destructuring target,
  climbed through patterns, `AssignmentPattern.left`, ObjectPattern values and TS wrappers.
- `Reflect` and `Object` fail as a name or as a static string.
- `sendsOut(c, program)` = `textOut(c)` (OUT_RULES, unchanged) + `treeOut(program)`. The real gate passes
  each decrypting file's own parse (`programOf(f)`). A snippet is parsed on its own, or inside an async
  function when it has a bare `return`/`await`.

I read the walker. It is sound for what it claims:
- `Object.entries` visits every child node. Numbers such as `start` and `end` are skipped by `isNode`.
- The wrapper list covers parentheses, the optional chain, `as`, `satisfies`, `!`, `<T>` and instantiation.
- `isOnlyRead` stops at the first non-wrapper parent, so `fn(res.body)` and `x = res.body` fail, as they should.

## 2. Bypass attempts against the committed rules

Method: I copied the committed test into a scratch file, `apps/web/test/zz-ptw5-probe.test.ts`, and appended a
REVIEWER block. For each snippet it records both `textOut` and `treeOut`. I deleted the file before the project
runs.

I also checked separately that each bypass really works: a Node script builds the init and reads it back with
`new Request(u, init).text()`. Each one carried the plaintext as the body: JSON.parse, the JSON-escaped
JSON.parse, structuredClone, Proxy, `__defineGetter__`, `({}).constructor.defineProperty`,
`globalThis['Ref'+'lect'].set`, `Function(…)`, `(() => 0).constructor(…)`, indirect eval, and Map + JSON.
Browsers convert the init the same way, through WebIDL dictionary [[Get]].

K = `'bo' + 'dy'` where it is used.

| # | Snippet | text | tree | Result |
|---|---|---|---|---|
| 1 | `fetch(u, { method: 'POST', ...JSON.parse('{"bo' + 'dy":' + JSON.stringify(plain) + '}') })` | – | – | **passes** |
| 2 | `fetch(u, JSON.parse('{"method":"POST","bo' + 'dy":…}'))` | – | – | **passes** |
| 3 | `...JSON.parse('{"b\\u006fdy":…}')` (a JSON escape: the JS string never spells body) | – | – | **passes** |
| 4 | `structuredClone(JSON.parse(…))` | – | – | **passes** (nothing new beyond row 1) |
| 5 | `fetch(u, new Proxy({ method: 'POST' }, { get: (t, k) => (k === K ? plain : t[k]) }))` | – | – | **passes** |
| 6 | the same Proxy inside `new Request(u, …)`, and `new Request(u, { ...JSON.parse(…) })` | – | – | **passes** |
| 7 | `new Proxy(…, { get: (t, k) => k === atob('Ym9keQ==') ? plain : t[k] })` | – | – | **passes** |
| 8 | `init.__defineGetter__(K, () => plain)` | – | – | **passes** |
| 9 | `({}).constructor.defineProperty(init, K, …)`, `const O = ({}).constructor; O.assign(…)`, `({}).__proto__.constructor.assign(…)` | – | – | **passes** (Object without naming it) |
| 10 | `globalThis['Ref' + 'lect'].set(init, K, plain)` | – | – | **passes** (the test comment says "by any reference … a bracket", but only a static bracket is caught) |
| 11 | `Function('a', 'b', 'a.bo' + 'dy = b')(init, plain)`, `new Function(…)`, `(() => 0).constructor(…)` | – | – | **passes** |
| 12 | `eval('init.bo' + 'dy = plain')`, `(0, eval)(…)` | – | – | **passes** |
| 13 | `navigator['send' + 'Beacon'](u, plain)` | – | – | **passes** (a body out, no body key needed) |
| 14 | `new BroadcastChannel('x')['post' + 'Message'](plain)`, `worker[pm](plain)` | – | – | **passes** |
| 15 | `new globalThis['Web' + 'Socket'](u).send(plain)`, `new globalThis['XMLHttp' + 'Request']()` | – | – | **passes** |
| 16 | `globalThis['local' + 'Storage'].setItem('k', plain)` | – | – | **passes** |
| 17 | `arguments[0][K] = plain`, and `const a = arguments; a[0][K] = plain` | caught | caught | caught |
| 18 | ``{ [`bo${'dy'}`]: plain }``, ``init[`bo${'dy'}`] = plain`` (template keys) | caught | caught | caught |
| 19 | ``String.raw`body` `` | caught | caught | caught |
| 20 | `body: { … }` (a label named body) | caught | caught | caught |
| 21 | `out: { fetch(u, JSON.parse(…)) }` (a label does not matter) | – | – | passes, as row 2 |
| 22 | `with (init) { body = plain; }` | caught | caught | caught: the `body` name trips. oxc parses `with` even in a module, so the tripwire's parse check does not stop it. But `tsc` rejects `with` in a module (strict), and so do browsers. `with` cannot make a key it does not name. |
| 23 | `fetch(u, { method: 'POST', ...res })` (spread aliasing of an existing object) | – | – | passes, but harmless: a Request or Response keeps `body` as a prototype getter, which spread does not copy |
| 24 | URL, `new Image().src`, `window.open`, a form submit, `setAttribute('href', …)` | – | – | out of scope since V-M2 (PTW4 row 14) |

### The minors

**PTW5-M1 (minor): code and keys built at run time pass (rows 1 to 12).**
- None of the following are named by any rule:
  - JSON, `Proxy`, `eval`, `Function`;
  - `.constructor`, `__proto__`, `__defineGetter__` and `__defineSetter__` (and `__lookup*`);
  - `atob`.
- These are not new holes made by this commit. They passed on 432290f4 too.
- But the commit closes `Reflect` and `Object` "by any reference", and rows 8 to 10 reach the same
  functions without naming them.
- ChatProof uses none of these names, so banning them in a decrypting file is free:
  - as a name: `eval`, `Function`, `Proxy`, `JSON`, `atob`, `structuredClone`;
  - as a member property, or as a static string: `constructor`, `__proto__`, and `__define`/`__lookup` followed by `Getter`/`Setter`.
  - ChatProof's class `constructor() {}` is a MethodDefinition key, not a member, so it is unaffected.
- This is engineering, and the lead's call.

**PTW5-M2 (minor): the channel and storage rules are still text-only, so a split-string bracket passes (rows 13 to 16).**
- `postMessage`, `sendBeacon`, `WebSocket`, `EventSource`, `XMLHttpRequest`, `localStorage` and the rest are
  matched only as words in the text.
- A computed member *read* with a non-static key is not looked at by the tree, so
  `navigator['send' + 'Beacon']` reaches any of them. Row 10 reaches `Reflect` the same way.
- The one rule that closes rows 10 and 13 to 16 together: in a decrypting file, a computed member whose key
  is not a static literal fails unless its object is on a short allowlist.
  - ChatProof has exactly one such member, `CHAT_PROOF_TITLE[proof.kind]`, so the allowlist is
    `['CHAT_PROOF_TITLE']`.
  - Its "must not trip" case already exists.
- Optionally, also move the channel and storage names into the tree as names and static strings, as was
  done for `Reflect` and `Object`.

With M1 and M2 done, the only way left for a decrypting file to send the plaintext out is a URL. That was
accepted as out of scope in V-M2.

## 3. No earlier rule lost catching power, and no test was weakened

- `OUT_RULES` is byte-identical to 432290f4. `textOut` runs it on the same comment-stripped text.
  `sendsOut` = text ∪ tree, a strict superset of the old result.
- The gate's call changed from `sendsOut(c)` to `sendsOut(c, programOf(f))`. The program comes from the same
  parse that produced `c`, and `expect(gated).toBe(DECRYPT_ALLOWED.length)` is unchanged.
- The removed lines in the diff are three call sites and one signature, each replaced by a superset form.
  No `expect` was removed or loosened.
- Every earlier `not.toEqual([])` list still runs through `sendsOut`, now with the tree rules added.
- New: the 13 PTW4 rows (16 tests) each assert both `sendsOut` and `treeOut` alone. Another test asserts that
  the tree alone catches all 25 older body, key and call snippets. A further one adds 44 more write, key and
  Reflect/Object forms.
- `init?.body ??= plain` was dropped from the tree-alone list, with a comment. It is not a valid assignment
  target and does not parse, so nothing is lost.
- Nothing is skipped or quarantined.

## 4. The "must not trip" list is honest

- Every snippet in the `sendsOut(...).toEqual([])` list is either ChatProof's own code or a near form of it:
  - ChatProof's own: `res.body?.cancel()`, `res.body === null`, `res.body.getReader()`, `useState`
    destructuring, `const parts: Uint8Array[] = []`, `CHAT_PROOF_TITLE[proof.kind]`;
  - near forms: `res?.body !== null`, `res.body!`, `== null`, a swap destructure, `parts[0] === undefined`.
- Each is checked against text and tree together.
- The real file is checked last with its own program, and passes.
- The three snippets that are checked against the tree only are labelled as such: `{ ['method']: 'POST', [0]: 1 }`,
  `out[0] = 1` and `init['method'] = 'POST'`.
  - The text rule's indexed assignment still flags the two writes, so `sendsOut` would not let them through.
  - The comment ("not the tree rules' business") is accurate. It does not claim an array write is allowed in a decrypting file.
- **PTW5-I2 (info, nit):** one more clause would make that explicit: "the text rule still flags the two writes".

## 5. I3: `latest` is kept only while a panel or a pay card is there

- `publishPaySnapshot` now does `if (panels.has(key) || listeners.has(key)) latest.set(key, rows)`.
  `snapshots.set` and the listener callbacks are unchanged.
- **chatProof with no panel: no regression.** `postProofToChat` publishes, and `chatProofState` reads
  `latestChatSnapshot`, which is the `snapshots` map, not `latest`. That map is still set on every publish.
  - chatProofSend.test lines 62 and 76 post with no panel and expect `'attached'`. Both pass in the web run.
  - So do chatProof.test lines 290 to 312, where the same snapshot object reaches `latestChatSnapshot`.
- The pay card itself:
  - while a card is mounted, the card is a listener, so its rows are stored and pushed as before;
  - when no card or panel is mounted, the only loss is that a later card mounts with null for one sync round
    trip. That is the same as any first mount ("Ask in the chat", then the rows).
  - Nothing visible changes in the normal flow: AddProof runs inside the buyer's pay screen, and BuyerPay's
    `usePaymentDetails` listens there.
- The new sessionForget test covers three cases: no panel, after the last panel, and with one open, which
  shows the guard is not "never". It checks the positive case.
- **PTW5-I1 (info, the old P-I5):** a late publish still repopulates `snapshots`, and those carry proof keys,
  with no owner until the next unmount or log-out.
  - The same guard cannot be used there: chatProofState needs the snapshot from a publish with no panel
    (the chatProofSend cases above).
  - So leaving `snapshots` alone is correct. This is pre-existing, and nothing is needed now.
- **PTW5-I3 (info):** the tree walk is the right foundation. If M1 and M2 are taken up, write them as more tree
  rules (names, member properties, and the computed-member allowlist), not as regexes, as the commit's own
  "Add no new regex for them" note asks.

## Runs

All runs were under `~/x2f-comms/check.lock`, with the timeout inside the flock
(`flock lock timeout N cmd`). The head is 37d1b701, with node_modules from `npm ci` in the review worktree.

| Run | Result |
|---|---|
| Scratch probe (the REVIEWER block in a copy of the tripwire test) | 1 passed; results in section 2. Deleted before the project runs |
| Node runtime check that the bypasses really carry a body (`new Request(...).text()`) | 11 of 11 shapes carry the plaintext |
| `vitest --project @x2f/web` | 142 files, **2207 passed** (2188 on 432290f4 + 16 PTW4 rows + 2 tree-rule tests + 1 sessionForget) |
| `vitest --project @x2f/proof` | 14 files, 373 passed |
| `vitest --project @x2f/staff-web` | 5 files, 52 passed |
| `vitest --project tools` | 3 files, 13 passed |
| `tsc --noEmit` for apps/web, apps/staff-web, packages/proof | 0 errors |

Not run:
- the full `npm run check` (api, moderation, copy-lint, separation-check). The brief named these projects, and
  the lock queue held a 90-minute full check from another helper. This commit touches only web test files and
  one web source file, so the lead's own `npm run check` on the stack before landing covers the rest;
- Playwright, since nothing the browser shows changed.

## Summary

- **APPROVE WITH MINORS (37d1b701).** 0 blocking, 2 minor, 3 info.
- **Minor:**
  - PTW5-M1: code and keys built at run time pass: `JSON.parse`, `Proxy`, `eval`/`Function`/`.constructor`,
    `__defineGetter__`, `__proto__`, `atob`. Ban these names and properties in a decrypting file. ChatProof uses none.
  - PTW5-M2: the channel and storage names (and Reflect via `globalThis['Ref'+'lect']`) can be reached by a
    split-string bracket. Fail any computed member with a non-static key unless its object is `CHAT_PROOF_TITLE`.
- **Info:**
  - PTW5-I1: `snapshots` can still get an orphan entry from a late publish. This is pre-existing, and correctly left alone.
  - PTW5-I2: the tree-only "must not trip" comment could say that the text rule still flags index writes.
  - PTW5-I3: write any follow-up rules on the tree.
- **The bypasses that are caught:** `arguments`, template-literal keys, `String.raw`, labels and `with`.
- **No owner questions.** Every item is engineering.
