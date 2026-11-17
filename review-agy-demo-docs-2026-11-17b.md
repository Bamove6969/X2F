VERDICT: APPROVE WITH MINORS

# Re-review: wip/agy-demo-docs 2c774764 (agy Job 12, owner demo round-3 instructions)

Reviewer: claude3, 17 Nov 2026. This follows review-agy-demo-docs-2026-11-17.md, which reviewed 82359f74.

Scope: 1 new commit, 2c774764. It changes only docs/demo.md (+67/-43). The base is still b1172d63. origin/wip/third-demo-r3 is now at 94337781. Since b1172d63 it has changed only two test files (apps/api/test/webauthn.test.ts and apps/web/e2e/post.spec.ts), so the code cites below hold at 94337781. This was a read-only review, and I ran no tests.

## Old findings

| # | Status | Where now / evidence |
| --- | --- | --- |
| B1 quick start not the owner's procedure | FIXED | docs/demo.md:11-22 has the stop-first line, Ubuntu (WSL), and the exact one-liner `cd ~/x2f && git fetch && git checkout wip/third-demo-r3 && git pull && npm ci && npm run demo`. It also has localhost:4400 in Chrome/Edge on Windows and `cd ~/x2f && npm run demo:stop`. demo.ts:250-251 prints "X2F demo is running" and then `Open: http://localhost:4400`. |
| B2 manual push committed to the demo branch | FIXED | docs/demo.md:150-162 now uses the Download file from /mnt/c/Users/<name>/Downloads. It pushes from a separate detached worktree `~/x2f-comms-manual` with `git push origin HEAD:comms`, then removes the worktree. It also says to send the file to the lead if the push is refused. The download file name uses the local date (notes-server.ts:401-405), which matches "today's date". See new M1 for a leftover line. |
| B3 "share securely" for a public tunnel | FIXED | docs/demo.md:229 now uses the wording from the review: public, anyone can open it and sign up, fake money only, ends at demo:stop. demo.ts:252 says the same ("anyone with this URL can open it"). |
| M1 codes page refresh | FIXED | docs/demo.md:93 now says "updates itself every few seconds" (codes-page.ts:33, meta refresh min(left,10)). Step 3 (line 18) no longer says the codes page is printed. A correction to my first review: demo.ts:269 does print a `Codes:` line, so that part of the old M1 was wrong. The doc is right either way. |
| M2 phone vs WSL | FIXED | docs/demo.md:90 now says "another browser tab on this PC". |
| M3 push timing | FIXED | docs/demo.md:144 now says "after a new comment, follow-up or Resolve". |
| M4 demo:reply is the lead's tool | FIXED | docs/demo.md:122-127 has the owner line and "For the lead:". |
| M5 offers per cast account | FIXED | docs/demo.md:75-79 matches seed.ts:81-99 row for row. |
| M6 reload advice | FIXED | docs/demo.md:217 has the exact wording. Line 218 keeps the history of the fix. |
| M7 funding trigger | FIXED | docs/demo.md:203 now includes "or completes the hold that opens the wallet app". |
| M8 adopted host only | FIXED | docs/demo.md:187 (rp-adopt.ts:15-16). |
| M9 developer reference deleted | FIXED | docs/demo.md:237-259 is a "For developers" section. It covers what a comment records and never reads, the `/__demo/*` limits, `DEMO_NOTES_FILE`/`DEMO_NOTES_SEED`, `DEMO_PUBLIC_ORIGIN`/`DEMO_PUBLIC_NODE_ORIGIN`, and the guard tests. Every test file it names exists in tools/test/ (demo-notes, demo-origins, demo-guard, demo-self-origin, demo-rp-adopt, demo-phone). The text is a light paraphrase rather than a copy of b1172d63, but nothing that was asked for is missing. |
| M10 WSL requirement | FIXED | docs/demo.md:27. |

## New findings

No blocking findings.

M1. A leftover line points at a command that is no longer in the doc (docs/demo.md:163). It reads: "*(The `cp ~/x2f-comms/demo-notes.jsonl ...` line can serve as a fallback ...)*". That wording was copied from my review note to agy, and the doc no longer has any `cp ~/x2f-comms/demo-notes.jsonl` line, so the owner cannot follow it. Fix: replace line 163 with:
```
   If the Download button cannot be used, copy the raw comments instead (they have no numbers, replies or resolved threads), in step 2's folder:
   `cp ~/x2f-comms/demo-notes.jsonl ~/x2f-comms-manual/owner-demo-notes-<date>.jsonl`
```
The other choice is to delete line 163.

M2. Incognito is risky for a trader account (docs/demo.md:62). The line says "open one in a standard window and another in an incognito/private window". The escrow keys for each trade are kept in that browser's storage (apps/web/src/escrow/store.ts, IndexedDB). A private window throws that storage away when it closes, and all private windows of one browser share the same storage. Closing it mid-trade loses the keys, and docs/demo.md:217 already says to keep the page open until settled. Line 204 already says "a separate browser profile". Fix: "(use a separate browser profile for each account, for example Chrome for one and Edge for the other, since each trade's escrow keys live in that browser; a private window loses them when it closes)".
