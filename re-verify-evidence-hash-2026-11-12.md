# Re-verify (security): `evidenceSha256` on the ruling tap, `wip/lead-rulings` 7e36d13e..601bcc8f (closes mod-screens review M1), 12 Nov 2026

Reviewer: independent reviewer (cloud helper). Read-only on code.

Setup:
- Detached worktree `rv-evh` at beb759a8, which contains 601bcc8f unchanged. Fresh `npm ci`.
- The worktree was removed afterwards, along with its node_modules and my scratch test file.
- dockerd was up and was not restarted. Every run went through `flock ~/x2f-comms/check.lock`.

Commits: d9ac8d9d (red tests), a70a3bbf (the change), 601bcc8f (READY). 7 files, +76/-10.

## Verdict: PASS for the API. M1 is closed on the server.

There are two merge must-dos, both outside this diff:
- **E1:** the staff web on `wip/lead-mod-screens` does not send the new field yet.
- **E2:** the gate on `wip/lead-mod-gate` does not check it yet.

There is also one minor item (E3: a lone surrogate gives a 500 instead of a 400) and one info item (E4).

## The five checks

### 1. The serialisation is canonical and unambiguous: holds
`evidenceSha256(lines)` (`packages/staff/src/intent.ts`) works as follows:
- It hashes with SHA-256 and returns lower-case hex.
- It hashes `utf8(canonicalJson([...lines]))`, using @x2f/staff's `canonicalJson`. For an array that is `[` + `JSON.stringify` of each element joined by `,` + `]`, with no whitespace.
- It throws on anything that is not an array of strings.

Each line becomes a single JSON string token, with `"`, `\` and control characters escaped. So:

| Property | Why it holds |
|---|---|
| **Separators** | A comma or bracket inside a line can never be mistaken for the separator. `["a,b"]`, `["a","b"]`, `["a\",\"b"]` and `[]` are all different byte strings. The JSON-string encoding is injective. |
| **Line order** | Order is significant, so a reversed list hashes differently. |
| **Empty list** | The empty list is `[]`. It differs from `[""]` and `[" "]`, which the route refuses anyway: every line must be non-blank. |
| **Unicode, no normalisation** | NFC `é` and NFD `é` give different hashes. That is correct: the hash is over the exact code points that are stored and shown. |
| **Lone surrogates** | They hash without colliding: well-formed `JSON.stringify` writes `\ud800` as six ASCII characters, so it never meets TextEncoder's U+FFFD replacement. |

The hash feeds the ruling intent, and the intent goes into `tapChallenge` via `canonicalJson(intent)`. So the signed challenge covers `evidenceSha256`. The pure test confirms that changing only `evidenceSha256` changes the challenge.

### 2. Propose and approve both bind it: holds
- `parseKeyTapIntent` now requires the key: `exactKeys` includes `evidenceSha256`, and `match(HEX64)` accepts lower-case 64-hex only.
- A ruling tap with no evidence hash, or with a malformed one, is refused 400 at `taps/start`. Tested in `keyTap.test.ts`.
- `rulingIntent('propose' | 'approve', …)` always sets the hash. Both routes pass `evidence`.

### 3. The server rebuilds it from what it stores: holds
- **Propose.** The hash is built from `parseEvidence(b.evidence)`. That is the same array that is then stored with `JSON.stringify` in `ruling_drafts.evidence`, and in `dispute_rulings.evidence` when the ruling publishes at once.
  - The jsonb round trip is exact for every string the route accepts. My scratch test stored the tricky lines below and read them back from both tables: they were deep-equal, and they hashed the same.
  - The tricky lines: a comma, `"`, `\`, `]`, NFD and NFC `é`, U+2028, an emoji, leading and trailing spaces, U+202E.
- **Approve.** The hash is built from the draft row, read back from the database (`waiting(...)`, `for update`). It is never taken from the request body.
- I found no other code path that writes the evidence column of either table. A grep over `apps/api/src` finds only these inserts; `store.ts` updates only `appeal_until`.

### 4. A mismatch gets 403 `tap-invalid` and writes nothing: holds
- `consumeKeyTap` runs first in the `withDispute` transaction. It is a single `update … where intent = $canonical`. Any mismatch updates no row, so it throws 403 `tap-invalid`, and the whole transaction rolls back.
- The branch's own tests cover: an extra line, a reversed order, and an empty list at propose; other lines at approve.
- My scratch test added more cases:
  - At propose, each of these was refused 403 `tap-invalid` with the tap left unused (`used_at` null): the NFC form of the same lines, the lines joined into one, one line dropped, and the lines reversed. After them there was no draft, no `ruling.*` log, no `dispute_rulings` row, and the dispute was still `open` with no ruling.
  - With an empty list in the body, a tap for `[" "]` or for the default lines was refused.
  - At approve, above the limit, a tap for the NFC form, for other lines, or for `[]` was each refused, with the tap unused. The draft stayed `proposed` with its lines unchanged, and the only log entry was `ruling.proposed`.

### 5. The published evidence is exactly the bound evidence: holds
- **Propose.** Publishing at once uses the same `evidence` array that was hashed.
- **Approve.** `publishDecided(…, draft, …)` publishes `draft.evidence`, the same row that was hashed.
- Scratch tests confirm it for both paths, with the tricky lines and with `[]`.
- The trader view (`routes.ts:193`) shows the stored strings unchanged; it only drops non-strings, and there are none.

## Findings

- **E1 (must-do at merge, not in this diff): the staff web builds the ruling intent without `evidenceSha256`.**
  - `wip/lead-mod-screens` (`apps/staff-web/src/screens/modModel.ts` `rulingIntent`) still sends only `reasonSha256`.
  - That branch is not merged into rulings: their merge base is c9a5ad75.
  - Once they are combined, every ruling tap started from the staff web will be refused 400 at `taps/start`, because the key is now required. So moderators cannot rule.
  - Fix when merging: add `evidenceSha256: evidenceSha256(a.evidence)` from @x2f/staff, hashing the exact lines that are then sent in the body. Add a test that the page's intent equals the server's for the same lines.
- **E2 (must-do at merge, not in this diff): the moderation gate does not compare `evidenceSha256`.**
  - On `wip/lead-mod-gate` (e418dd85), `apps/moderation/src/gate/verify.ts` builds its `agrees` check from `rulingId`, `code`, `round`, `outcome`, `accountAction`, `reasonSha256`, `round1Id` and `amountAtomic`. Its registry carries only `reasonSha256`.
  - Until the gate gets the evidence lines, or their hash, from its own record and checks it, the binding is enforced by the API only. A compromised API could publish other evidence, and the gate would not notice.
  - 601bcc8f's message already flags this for mod-gate. I list it so it is not lost.
  - Note also that the gate's intent has a `round1Id` field that the API's intent does not. Whoever merges the two must reconcile the intent shape on both sides.
- **E3 (Minor): an evidence line with a lone surrogate gives 500 `internal`, not 400.**
  - `isText` accepts a lone surrogate such as `"\ud800"`, because JSON bodies can carry one. Postgres jsonb then refuses it, so the draft insert fails after the tap check.
  - Observed in a scratch test: 500 `{"error":"internal"}`. Safe: the tap was unused, nothing was written and nothing was published. But it is a server error the client can trigger at will, and it is logged as one.
  - Fix: in `parseEvidence`, refuse a line that is not well-formed UTF-16 (`!x.isWellFormed()`, Node 20+) with 400 `bad-request`. Consider the same for the reason and the send-back note. Those go to `text` columns, where node-pg replaces the surrogate with U+FFFD. The hashes still agree there, because Node's and @x2f/staff's UTF-8 encoders replace it the same way. But refusing it is cleaner.
- **E4 (Info): the evidence is bound by the tap, not frozen in the database.**
  - `ruling_drafts.evidence` and `dispute_rulings.evidence` have no trigger that refuses changes. No API code updates them, so this is only reachable with direct database write access.
  - At approve, the server rebuilds the hash from the stored draft. It does not re-check the stored draft against the proposer's tap.
  - The reason has the same property. This matches the codebase's stated caveat that the API role owns its tables. The moderation gate (E2) is the place that would catch this.
- **Tests.** The branch's tests cover what was asked, except the following, which my scratch tests covered without finding a problem:
  - no assertion that the published evidence equals the bound evidence on the approve path;
  - no case with the NFC/NFD forms;
  - no case for one line versus several;
  - no check that a refused tap is left unused.

  Adding the "published = bound" assertion to the two-person test, and a `tapUsed === false` check to the mismatch test, would pin these cases.

## Tests run (`flock ~/x2f-comms/check.lock`)
- At beb759a8:
  - `packages/staff/test/intent.test.ts`: 17/17 passed
  - `apps/api/test/disputes/rulings.test.ts` + `apps/api/test/staff/keyTap.test.ts`: 46/46 passed
- Scratch API test (`zz-rv-evidence.test.ts`, deleted): 4/4 passed. It covers checks 3, 4 and 5 above and records the E3 result.

Not run: staff-web, moderation, Playwright, `npm run check`. The staff-web and moderation changes E1 and E2 need are not on this branch.

## Also done in this pass (liens, at the lead's request)
- `wip/lead-liens` 91e784a2 renames the three remaining test names that cited D-062 so they cite g63 and owner question O3:
  - `packages/staff/test/lien.test.ts:143`
  - `apps/api/test/disputes/lien.test.ts:155` and `:202`
- Merged into `wip/lead-rulings` as 5770f6e5, on beb759a8, after a fetch. It was a fast-forward and nothing was forced.
- Tests:
  - at 91e784a2: staff `lien.test.ts` 42/42, API `disputes/lien.test.ts` 28/28
  - at 5770f6e5: staff `lien.test.ts` 42/42, API `lien` + `rulings` 46/46
