VERDICT: CHANGES NEEDED

# Review: wip/agy-unsigned-copy 16f2fdef (agy Job 7, owner p5-1)

Reviewer: claude3, 16 Nov 2026.

Scope: one commit on origin/wip/third-demo-r3 1fa6bed1, +3357 lines:
- tools/copy-inventory.ts (615 lines)
- tools/test/copy-inventory.test.ts
- the generated docs/copy-unsigned-by-screen.md: 1780 strings, 129 files, 28 screen groups in journey order

There are no wording changes, as the job says.

The approach is sound. It uses an AST through `rolldown/parseAst`, which is already a devDependency, so it adds no new dependency. It scopes each COPY-UNSIGNED marker to the construct that follows it and maps files to routes. Of the 134 source files that carry the marker, the 5 not in the doc mention it only in prose that points to the copy's real home (e.g. SessionLength.tsx:13). That is fine.

## Findings

**B1. The test breaks the whole suite whenever any marked copy changes** (tools/test/copy-inventory.test.ts:47-73,80-82). The test pins exact line numbers (WelcomeScreen.tsx:32, Backup.tsx:51, termsText.ts:48, sessionCopy.ts:13) and requires the doc on disk to be byte-equal to a fresh render. Root `npm test` (`vitest run`) runs tools/test. So any edit to any COPY-UNSIGNED string, or any line added above one, turns the suite red for whoever made it, even in unrelated work. agy's own branches would trip it:
- wip/agy-landing moves the WelcomeScreen heading from line 32 to 36.
- wip/agy-recovery-copy changes five marked strings.

Fix:
- Find the known lines by file and text, not by line number. The job asks only that the script "finds a known line".
- Take the byte-equality check out of the default suite. Offer it instead as an opt-in check, e.g. `tsx tools/copy-inventory.ts --check`.
- Add an npm script `copy-inventory` (there is none today).

**M1. Sentences are split into fragments.** JSX text around `{expressions}` is listed piece by piece. 133 of the 1780 entries start mid-sentence. Examples:
- SellerRefund.tsx:188 "If" and :198 "'s {method} payment did arrive…"
- CancelFinalSheet.tsx:59 "The"
- Landing.tsx:23 "to believe it."

The owner cannot sign a fragment. Join each JSX element's text children into one line with `{placeholders}`, e.g. "If {name} paid after all".

**M2. Owner-signed and non-copy strings are listed as unsigned.**
- Landing.tsx:20 says "COPY-UNSIGNED except the slogan (the owner's) and his two button labels", but the doc lists all 9 strings, his slogan and labels included.
- keyErrors.ts:60-61 are WebAuthn error codes (ERROR_INVALID_RP_ID, ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED), not copy.
- Some entries are example numbers, e.g. "≈ 0.148588 – 2.971768 XMR".

`item.note` is collected but never printed. Print the marker's note in a third column; it often says "the owner's words". Also honour "except", or at least flag those markers for a human.

**M3. No READY line.** agy posted only a CLAIM in to-lead.log; post the READY line when back.

## Checks (claude3, detached worktree at 16f2fdef)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- vitest apps/web: 2216 passed, 1 failed. The failure is serve-boards.test.ts capture-refs (stale BuyMain/Main reference shots), the same on every branch cut from third-demo-r3, so it is not agy's.
- vitest tools/test: 83/83

## How agy compares

The tooling is ambitious and mostly well built: it uses the AST rather than regex, the grouping is sensible and the output is readable. It falls below our standard on test design, because a golden file with pinned line numbers turns every teammate's copy edit red. Its polish is also short of what the owner needs: fragments, and his own words listed as unsigned. These are fixable in an hour or two.
