VERDICT: CHANGES NEEDED (one blocking item: the generated doc is now too big to read; a small renderer fix)

# Re-review: wip/agy-unsigned-copy 7485f123 (agy Job 7, owner p5-1)

Reviewer: claude3, 17 Nov 2026. Old review: review-agy-unsigned-copy-2026-11-16.md (head 16f2fdef).

New since 16f2fdef: one commit, 7485f123 "tools(copy): join JSX sentence fragments, filter non-copy/owner words, match by file/text, add --check (review B1, M1, M2)". It changes tools/copy-inventory.ts (+140), tools/test/copy-inventory.test.ts, root package.json (adds the `copy-inventory` script) and regenerates docs/copy-unsigned-by-screen.md (1780 to 1691 strings).

Forbidden areas: the full branch diff against its merge-base (third-demo-r3 1fa6bed1) is tools/copy-inventory.ts, its test, the doc and one package.json script. No app source, no apps/api, packages/escrow or packages/auth-client.

## Old findings

- **B1 (test pins line numbers and the byte-equal doc): FIXED.** The test matches by file and text (copy-inventory.test.ts:48-76); the byte-equality check is gone from the suite and is now `npm run copy-inventory -- --check` (copy-inventory.ts:733-746), which I ran: "up to date (1691 strings)", exit 0. The npm script exists.
- **M1 (sentence fragments): MOSTLY FIXED.** JSX text is joined with `{placeholders}`, e.g. SellerRefund.tsx:188 is now "If {name} paid after all" and :197 is a whole sentence. Entries starting lower-case dropped from 133 to 58, and most of those are real lower-case labels ("no rate", "follows the market"). But see N2: JSX that holds a conditional now dumps raw code.
- **M2 (owner-signed and non-copy strings): MOSTLY FIXED.** The note is printed in a third column; WebAuthn codes and bare numbers are filtered; Landing.tsx now lists 5 strings without the owner's slogan and button labels. See N1 (the note column) and N3 (how Landing is excluded).
- **M3 (no READY line): FIXED.** FIXED line in to-lead.log 01:34:40.

## New findings

**B1 (N1). The note column repeats the whole marker comment on every row, so the doc grew from 188 KB to 777 KB** (copy-inventory.ts:723). 506 rows carry a note longer than 300 characters; the longest line is 2096 characters. SellerRefund.tsx alone repeats a ~1900-character block on every one of its rows. The owner cannot read or sign from this. Fix: print the note once per marker, not per row. Either:
- group rows by marker scope and print the note once as a line above that group's table, or
- in the column print only the first sentence, cut at 120 characters with "…", and put the full note once under the file heading.
Then regenerate the doc and check its size is near the old 188 KB.

**M1 (N2). JSX holding a conditional or a comment is printed as raw code** (copy-inventory.ts:288-296, `getInlineJsxText`, the JSXExpressionContainer branch). It copies the expression's source text, so 10 rows contain code, e.g.:
- CancelFinalSheet.tsx:55 `{nothingHeld(view)? ( <>Nothing is in escrow yet, ... </> ): ( <> The <span className="x2f-mono">…`
- the trade "You marked this trade as paid {view.paidAt!== null? ( <> {' at'} <When …" row
- rows that start with `{/* The board's step 3 … */}`

Fix:
- Return '' for a `JSXEmptyExpression` (JSX comments).
- In `isInlineChild`, treat a JSXExpressionContainer whose expression contains JSX (ConditionalExpression or LogicalExpression with a JSXElement/JSXFragment branch) as not inline, so the element falls back to per-child collection and each branch's text is listed as its own sentence; or emit `{…}` for it and list the branches separately.
- Add a test case with `{cond ? <>A</> : <>B</>}` and a `{/* comment */}` that asserts no row contains "<", "?(" or "/*".

**M2 (N3). The Landing exclusion is hard-coded** (copy-inventory.ts:592-596). The tool skips four exact strings when a note contains "except the slogan". If the owner's slogan is reworded it will silently appear as unsigned, and no other "except" marker is honoured. Fix (either one; moving markers in Landing.tsx is not agy's call):
- drop the hard-coded set and mark every row under a note containing "except" with "(partly signed; check)" in the doc, or
- keep the set but add a test that fails if those four strings are no longer in LANDING_COPY.

**M3 (N4). Leftover non-copy rows.** Research notes with URLs ("research 2026-11-10 (medium): https://…"), "en-US" and demo names like "satoshi_ghost Vendor" are still listed. Fix: skip strings that contain "http" or start with "research "; skip `toLocaleString` arguments.

**M4 (N5). Unused imports in the test** (tools/test/copy-inventory.test.ts:1, 4, 6): `readFileSync`, `renderUnsignedMarkdown` and `DOC_PATH` are no longer used. Remove them.

## Checks (claude3, fresh detached worktree at 7485f123, npm ci, Node 24.22.1)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- `npm run copy-inventory -- --check`: up to date (1691 strings), exit 0
- vitest (touched): tools/test/copy-inventory.test.ts: 3/3; all of tools/test: 83/83 (10 files)
- Playwright: no e2e spec touched; not run.

## Summary

The old blocker is properly fixed: the suite no longer goes red on copy edits, and the doc check is opt-in. The fragment joining is a real improvement. But printing the full marker note on every row made the owner's doc four times bigger and unreadable, and conditional JSX now leaks code into it. Both are renderer fixes of an hour or so; regenerate the doc afterwards.
