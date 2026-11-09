# Review: staff-web file route path containment (`wip/lead-land-3` @ 6edd4db1), 9 Nov 2026

Reviewer: independent security reviewer, read-only. I changed no code. Worktree `/home/user/X2F/.claude/worktrees/lead-land-3`. One commit reviewed: 6edd4db1 "fix(staff): the staff-web file route proves the path sits under the root before sendFile", touching `apps/api/src/staff/web.ts` (new `fileUnderRoot`) and `apps/api/test/staff/web.test.ts`.

## Verdict: CHANGES REQUIRED (one line; the containment itself is sound)

**The question asked: can any GET to the staff origin's catch-all `/*` make `reply.sendFile` read a file outside `X2F_STAFF_WEB_ROOT`, or crash the process / answer 500?** No. I could not find a request that does either, by reading the three layers (`fileUnderRoot`, `@fastify/static` 10.1.10 `pumpSendToReply`, `@fastify/send` 4.2.1 `normalizePath`) or by sending some sixty hostile paths at a live listener over a raw socket (not `inject`, see F3). Every escape attempt ends in 400 (router) or 404 (route or `send`), and the one remaining 500 path (F4) is not reachable from a request.

**What blocks landing as-is (F1):** the route still serves a dot file when the leading dot is percent-encoded. `GET /assets/%2Eenv.js` returns `assets/.env.js`; `GET /%2Evite/manifest.json` returns `.vite/manifest.json`. That is inside the root, so it is not the escape the question is about, and it predates this commit (the old `decodeURIComponent(path.slice(1))` had it too). But the test file's own comment says "A dot file is never sent", the plugin is registered with `serveDotFiles: false` for that reason, and the commit message says the function refuses dot segments. The fix is one line in the function this commit adds, so I am asking for it now rather than as a follow-up. If the lead prefers to land first, the exposure is limited to dot files an operator places in the built `apps/staff-web/dist` (the Vite config does not emit any: no `build.manifest`, no source maps).

## Tests run

| Run | Result |
|---|---|
| `apps/api/test/staff/web.test.ts` (serialised runner, `@x2f/api`) | 5/5 pass (1 file, 5.97 s; log `scratchpad/logs/review-staff-web-222922.log`) |
| Live-listener probe, ~60 raw paths (scratchpad script, not committed) | no 500, no file outside the root; two dot-file bypasses (F1) |

The probe script and its output are in `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/probe/` (`probe.mts` via `inject`, `probe2.mts` via a real `listen` and `http.request` with un-normalised paths).

## Findings

### F1 (required): percent-encoded leading dot bypasses the dot-file refusal

The route refuses dot files by looking at the **raw** segments (`segments.some((s) => s.startsWith('.'))` on `path` before decoding). `fileUnderRoot` then decodes once and refuses only `.` and `..`, not `.anything`. Nothing downstream catches it either:

- `@fastify/static`'s `serveDotFiles: false` only feeds the `glob` `dot:` option for the routes it generates when `serve` is on (index.js line 195). With `serve: false` it governs nothing; `reply.sendFile` never consults it.
- `@fastify/static` defaults `dotfiles` to `'allow'` (`opts.dotfiles ??= 'allow'`, line 60), so `@fastify/send`'s `containsDotFile` guard is switched off.

Observed on a live listener with a fixture `assets/.env.js` and `.vite/manifest.json` under the root:

```
404  /assets/.env.js
200  /assets/%2Eenv.js          -> "DOTFILE-SECRET"
404  /.vite/manifest.json
200  /%2Evite/manifest.json     -> "{"dot":"dir"}"
```

(`/%2Eenv` with no extension is still the app page, because `isApiOrFilePath` does not call it a file.)

Fix, either or both:

1. In `fileUnderRoot`, change `s === '.' || s === '..'` to `s.startsWith('.')` (that subsumes both), and add `expect(fileUnderRoot(root, '/assets/%2Eenv.js')).toBeNull()` plus an inject of `/assets/%2Eenv.js` expecting 404 (the inject reaches the server untouched: `%2E` followed by letters is not a dot segment to the URL parser).
2. Register the plugin with `dotfiles: 'ignore'` (or `'deny'`) so `@fastify/send` refuses dot parts itself, as a second layer. `serveDotFiles: false` can stay; it is harmless but inert here.

### F2 (informational): symlinks inside the root are followed

Both `fileUnderRoot` and `@fastify/send` check the path lexically (`path.resolve`, `normalize(join(root, path))`); `fs.stat` then follows symlinks. A symlink `link.txt -> /etc/hostname` placed under the root served `/etc/hostname`. This needs write access to the dist directory, so it is operator-side, not request-side, and it is how every mainstream static server behaves (express.static, nginx without `disable_symlinks`). Nothing to change unless the owner wants a `realpath` check; the commit does not claim symlink protection.

### F3 (informational, affects the tests' meaning): `inject` normalises dot segments before the server sees them

`light-my-request` builds the request from `new URL(url, base)` (lib/parse-url.js line 20). The WHATWG parser collapses `.`, `..`, `%2e` and `%2e%2e` segments. So the test's `GET /assets/%2e%2e/%2e%2e/package.json` arrives at the route as `/package.json`, and the 404 it asserts comes from `stat` ENOENT in the temp root, not from `fileUnderRoot`'s dot-segment branch. I confirmed this: through `inject`, `/assets/./app-1a2b.js` returned the file (200), while the same bytes over a raw socket returned 404 from the route's raw-segment check.

Consequences:

- The dot-segment branch of `fileUnderRoot` is exercised only by the new unit tests (`describe('fileUnderRoot')`), which do cover it correctly (`/assets/../../etc/passwd`, `/assets/%2e%2e/x`, `/assets/./x`).
- The inject tests that do reach the server untouched, and so are real end-to-end checks, are `..%2F..%2F`, `..%5C..%5C`, `a%00.js` and the malformed `%E0%A4%A`. The `%2e%2e/%2e%2e` inject is not wrong, it just tests less than its comment suggests. Optional: a one-line comment on it, or move it next to the unit tests.

On a live listener, the dot-segment forms all 404 as intended: `/assets/../package.json`, `/assets/%2e%2e/package.json`, `/assets/../../../../etc/passwd.txt`, `/../../etc/hostname.txt`, `/./package.json`, `/%2e/package.json`, `/assets/%2e%2e%2fpackage.json` (with `package.json` present in the fixture root, so a successful traversal would have shown).

### F4: how each class of trick ends (none in 500, none outside the root)

| Trick | Where it stops | Answer |
|---|---|---|
| `..` / `.` segments, raw or `%2e`-encoded | `fileUnderRoot` segment check (and the route's raw `startsWith('.')`) | 404 |
| `%2F` inside a segment (`..%2F..%2Fpackage.json`) | one `decodeURIComponent` turns it into `/`, then the segment split sees `..` | 404 |
| `%5C` / backslash | `s.includes('\\')` refuses; on Linux `\` would be a literal file name anyway | 404 (fails closed even for an existing `back\slash.js`) |
| Double encoding (`%252e%252e`) | decoded once to the literal segment `%2e%2e`; `@fastify/static` `encodeURI`s it to `%252e%252e` and `@fastify/send` decodes once back to `%2e%2e`, so it stays a literal name | 404 (ENOENT); a real file named `%2e%2e.js` is served as itself, which is correct |
| Overlong UTF-8 (`%C0%AE`), truncated escape (`%E0%A4%A`), `%ZZ`, trailing `%`, encoded lone surrogate (`%ED%A0%80`) | `find-my-way` 9.10 `safeDecodeURI` throws before routing; `frameworkErrors` answers | 400 `bad-request`, the handler never runs (`onRequest` hook did not fire). If one ever got through, `fileUnderRoot`'s try/catch gives 404 |
| NUL (`%00`) | `decoded.includes('\0')` | 404 |
| Case folding (`/ASSETS/APP-1A2B.JS`, `/STAFF/v1/x`) | ext4 is case-sensitive; `/STAFF` is caught by the route's `toLowerCase() === 'staff'` | 404. On a case-insensitive FS the file inside the root would be served; no escape either way |
| Trailing dot or space on the last segment (`app-1a2b.js.`, `app-1a2b.js%20`) | `isApiOrFilePath` trims trailing dots/spaces on the **first** segment only, so the last segment's extension becomes `js.`/`js ` and the path is judged an app route | 200 index.html, never `sendFile`. Harmless; see F5 |
| Trailing slash on a file (`/assets/app-1a2b.js/`) | empty segment filtered | serves the file; fine |
| Existing file used as a directory (`/assets/app-1a2b.js/x.js`) | `stat` ENOTDIR -> `sendStatError` | 404 |
| Directory with a file-like name (`/dir.js`, `/dir.js/`, with or without an `index.html` inside) | `index: false`; `findIndexFile(…, false)` returns false, no throw | 404 |
| 300-char segment, 6000-char path | `stat` ENAMETOOLONG -> `sendStatError` | 404 |
| `%3F`, `%23` in a name | literal `?`/`#` in the file name; `encodeURI` leaves them and `send` decodes nothing | served if such a file exists, else 404 |
| Absolute-form request target (`GET http://host/assets/x.js`) | router does not match `/*` | 404 |
| Query carrying `../` (`/assets/app-1a2b.js?x=../../etc/passwd`) | the route splits on `?` first | 200 the real file |
| Raw `#` in the request target (browsers never send one; tested over a raw socket) | the route keeps everything after `#` as part of the path: `/assets/app-1a2b.js#../../etc/passwd` ends in `passwd`, so it is the app page; `/assets/x.js#/../../package.json` splits into a `..` segment and `fileUnderRoot` refuses it; `/assets/app-1a2b.js#x.js` is a literal name | 200 index.html / 404 / 404 |

The only 500 I can construct is `@fastify/send`'s `sendStatError` default branch: `fs.stat` failing with something other than ENOENT/ENOTDIR/ENAMETOOLONG (EACCES, ELOOP, EIO) on an entry that exists inside the root. That needs an unreadable file or a symlink loop in the dist directory, which a request cannot create. Even then it is an answered 500 (`installErrorAnswers` -> `{"error":"internal"}`, logged), not a crash: `sendFile`'s `pumpSendToReply(...).catch((error) => this.send(error))` keeps the rejection on the reply. The old `decodeURIComponent` throw that was a request-triggerable 500 is gone (and in practice the router already 400s those).

`@fastify/send`'s own root check does what the commit says: with `root` set, `normalizePath` decodes once, refuses NUL (400) and any `..` part (`UP_PATH_REGEXP`, 403), then `normalize(join(root, path))`. `@fastify/static` adds `FST_STATIC_FORBIDDEN_PATH` (403) for non-leading `..`, backslashes and any non-canonical form. All of these are unreachable from the route because `fileUnderRoot` already hands them a canonical relative path, and if one were reached the app's error handler maps 4xx `statusCode`s to that status (`bad-request`), not 500.

### F5 (nit, pre-existing, `apps/api/src/static/serve.ts`): `isApiOrFilePath`'s comment overstates its trimming

The comment says "trailing dots or spaces on a segment drop", but `trimTrailingDotsAndSpaces` is applied to the first segment only; the last segment is tested untrimmed. Effect: `/assets/app.js.` is the app page rather than a 404 or the file. Not a security matter (it never reaches `sendFile`), and the trader origin behaves the same. Comment fix at most.

### F6: the two `nosemgrep` justifications are accurate

- Line 18, `reply.sendFile('index.html')`: "literal file name under `root`, no request input". Correct; `page` ignores the request.
- Line 29, `reply.sendFile(file)`: "`file` is canonicalised by fileUnderRoot and proven to sit under `root`; @fastify/send roots it again". Correct on both counts: the function decodes once, splits, refuses `.`/`..`/`\`/NUL/empty, `path.resolve`s and checks `startsWith(rootAbs + sep)`, and `@fastify/send` joins against its own `root` after refusing `..`. The one thing the justification does not say, and the function does not do, is refuse dot files (F1); that is a property the surrounding code promises, not a root-containment property, so the semgrep reason itself stands.

Placement: both comments sit on the line directly above a single-line match, which semgrep honours. I could not run semgrep here (container has no network for the registry), so I have not confirmed that the Express rule fires on `reply.sendFile`; the commit says it did.

### F7 (minor): the `isApiOrFilePath` / `fileUnderRoot` disagreement is benign

`isApiOrFilePath` lower-cases and trims; `fileUnderRoot` does neither. So `/staff%20/x.js` and `/staff./x.js` are judged "API path" by the former, pass the route's `segments[0].toLowerCase() === 'staff'` check (the raw segment is `staff%20`/`staff.`), and reach `sendFile('staff /x.js')`, which 404s on ENOENT through `callNotFound`. Same status, same `{"error":"not-found"}` body from the app's not-found handler. No change needed.

## For the lead

- Land after the F1 one-liner (`s.startsWith('.')` in `fileUnderRoot`) and its two test lines; optionally also `dotfiles: 'ignore'` on the plugin registration.
- No owner question: nothing here changes what users see or can do; dot files were never meant to be served.

## Lead response, 22:45 UTC
F1 applied on wip/lead-land-3 (fileUnderRoot refuses any dot-leading segment after decoding; `dotfiles: 'ignore'` on the plugin; e2e and unit tests for `%2Eenv.js` and `%2Evite/manifest.json`). F2 accepted as operator-side. F3 noted; the unit tests carry the dot-segment branch. Full check #5 (batch3e) started on the new head.
