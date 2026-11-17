# Landing plan, 17 Nov 2026 (read-only investigation; not committed)

Written 2026-11-17 ~03:05 UTC after `git fetch origin`. Main = `origin/main` = **4f0afa14** (batch 9, 12 Nov 20:37 UTC).
Nothing was pushed, no tests were run, the check lock was not touched.

**Sources.** `origin/comms` = **06f8ccad** (read from a scratch export). Note: this `comms` worktree is at 8c4934e6,
**67 commits behind origin/comms**, so do not trust its local copies of the logs and reviews. Read: `to-lead.log` from
12 Nov, `WHO-DOES-WHAT.md`, `LEAD-HANDOFF-2026-11-07.md` (running log, last entry 12 Nov 20:37), `LEAD-START-HERE.md`,
`agy-wake/LEAD-START-HERE-17NOV.md`, every `review-*`/`re-verify-*` dated 12-17 Nov (none is dated 14 or 15 Nov), plus
the lead's two **untracked** notes in this worktree (`batch10a-2026-11-12.md`, `terms-v3-2026-11-13.md`), which are not on
origin/comms. `to-lead.log` has a gap from 12 Nov 14:08 to 15 Nov 23:35 (claude2 was down 4 days).

**Method.** "Base" = `git merge-base <head> origin/main`, with commits ahead/behind main. "Contains" = other wip/* heads
that are ancestors of the head (`git branch -r --contains`). "Partial" = an older commit of that branch is inside.

**Local state the lead should know about (not on origin):**
- `wip/lead-batch10a` local **46780469** (02:59 UTC today, "read the site ban in the session query (lead call 3)") is 1
  ahead of origin 846d83ba, and worktree `batch10a` has 7 uncommitted files (sessions.ts, banState.ts, trades/list.ts,
  bans.test.ts, banned.spec.ts, ...). Batch 10a is mid-fix right now.
- `wip/lead-late-funds` local **8f6655e2** has diverged from origin 86b7a86c (13 ahead / 8 behind, same work re-hashed),
  and worktree `late-funds` has uncommitted N1/N2 work in packages/escrow. **claude2 already did N1/N2** on
  `wip/second-late-funds-fixes` 7e339feb. Pick one; don't land both.
- `wip/lead-signup-v2` local **6ce3edc9** (an unpushed R1 fix, 12 Nov 23:19) has diverged from origin 2364324b, which
  carries a different R1 fix (fee8c0b9, 14 Nov). Pick one.
- `wip/lead-terms-v3` exists only locally (= a467c7e7, terms-v2). The v3 text is only in the untracked note. Terms
  v2026-11-14 on `wip/third-terms-r3b` has overtaken it.

---

## 1. Every wip/* branch updated since 2026-11-12 (87 branches)

### 1a. Already on main (22): nothing to do

Batch 8 (8246e64b): lead-recovery 5115ec1d, lead-team e000ebfc, lead-freeze ac3ab777, lead-mod-rules 5c19ddbe,
lead-jabber-settings 23fe5783, lead-reputation 4df9bc54, lead-land-8 8246e64b.
Batch 9 (4f0afa14): lead-appeals 1bdaa226, lead-j20 e6f1e0dd, lead-sync-first f0424819, lead-staff-pay 3b2eaa2c,
lead-proof-code b3d64bf1, lead-g67 c4789af4, lead-o028-s093 555ca88a, lead-owner-alerts d825ee6e, lead-proof-check
0de4e081, lead-j21 2638262d, lead-e2e-batch8 5e4c9515, lead-s026-d056 a70ce780, lead-proof-labels 34b21163,
lead-instr-hash 678cbd19, lead-land-9 4f0afa14.

### 1b. lead-* branches not on main (33)

| Branch | Head | Base (+ahead/−behind main) | Contains | Latest review → verdict | Review of current head? | Superseded by / where it is |
|---|---|---|---|---|---|---|
| lead-demo | 2030af9a | 6ebed537 (+35/−136) | — | none on record (demo tooling, tools/demo) | — | Carried by lead-demo-r2 and everything built on it |
| lead-liens | 91e784a2 | 6ebed537 (+6/−136) | — | re-verify-liens-2026-11-12 → R1/R2 FIXED at f3f238c2 (MONEY); also review-disputes-stack-2026-11-16 | Yes in effect (2 test-only commits after; DS review covers 91e784a2) | **lead-disputes-stack → second-disputes-fixes** |
| lead-mod-screens | 0e2d2957 | 1bdaa226 (+27/−133) | — | review-mod-screens-2026-11-12 → APPROVE (at 5c2497e7, pre-rebase); review-disputes-stack-2026-11-16 | Via DS review | **disputes-stack** |
| lead-j14 | 65339bd6 | 6ebed537 (+31/−136) | second-support-tickets e9fecce2 | re-verify-j14-2026-11-12 → PASS (08588fba) | Yes in effect (+1 docs commit, R1) | Not in any batch; **held on owner** (§3) |
| lead-rulings | 41f0021a | 1bdaa226 (+23/−133) | liens 91e784a2 | re-verify-evidence-hash-2026-11-12 → PASS (601bcc8f); review-disputes-stack-2026-11-16 | Via DS review (E3 fixes after 601bcc8f) | **disputes-stack** |
| lead-proof-upload | ce6057b7 | 6ebed537 (+13/−136) | — | re-verify-proof-upload → APPROVE (8c56ca41); Z1/Z2 at ce6057b7 checked in re-verify-proof-chat-receive | Yes | **proof-stack** (in batch10a) |
| lead-terms-v2 | a467c7e7 | 8246e64b (+1/−85) | — | review-owner-ui-2026-11-12 → APPROVE | Yes | **third-terms-r3b** (v2026-11-14) |
| lead-proof-store | 1e2599dd | 6ebed537 (+7/−136) | — | re-verify-proof-store → ready to land | Yes | **proof-stack** |
| lead-proof-ocr | 622e0751 | 6ebed537 (+7/−136) | — | review-proof-ocr → land with minors (aa0993e1); review-proof-stack covers 622e0751 | Via proof-stack review | **proof-stack** |
| lead-owner-copy-1 | 7348962c | 8246e64b (+2/−85) | — | review-owner-ui → APPROVE WITH MINORS | Yes | Carried by demo-r2 line |
| lead-payee-fields-2 | ec53ea9b | 8246e64b (+4/−85) | — | review-payee-fields-2 → land it (20de07e8); ec53ea9b = its m-1..m-4 fixes, lead marked approved | Not independently re-read (minors only) | In batch10a and the demo-r2 line |
| lead-bans | 0ef4b7a7 | 5c19ddbe (+12/−124) | — | re-verify-bans + re-verify-bans-mf1-s1 → PASS at 2ac92021, 1 must-fix (frontDoor row) | 0ef4b7a7 is that 1-line fix, lead-checked only | In batch10a |
| lead-trades-list | 2c323dc7 | 6ebed537 (+13/−136) | — | re-verify-trades-list addendum → APPROVE to land | Yes | In batch10a and the demo-r2 line |
| lead-intro-poc | 940a4f80 | 8246e64b (+2/−85) | — | none | — | **Owner rejected the style.** Merged into demo-r2 and reverted (93a67e9d). Do not land |
| lead-proof-chat-receive | fdc5d83d | 6ebed537 (+20/−136) | proof-upload ce6057b7 | re-verify-proof-chat-receive → fixed, minors R1-R4 | Yes | **proof-stack** |
| lead-dispute-spec-flake | c369cd4c | 8246e64b (+1/−85) | — | none (test-only) | — | In batch10a |
| lead-no-russia | 39b82082 | 8246e64b (+3/−85) | — | review-no-russia → land it (at 80e87322) | No: +1 commit 39b82082 ("trades in flight finish"), unreviewed | In batch10a. demo-r2 line has only 5faed49e (1 of 3) |
| lead-tours-staff-team | e4b20baf | 8246e64b (+1/−85) | — | review-owner-ui → APPROVE WITH MINORS (StaffShell.tsx conflict, mechanical) | Yes | **In neither integration branch** |
| lead-device-bound | ba7ea9fe | 6ebed537 (+6/−136) | — | re-verify-device-bound (3 rounds) → engineering READY at 9196a5f5; safe to merge with both flags off | +1 tidy-up commit after (ba7ea9fe) | In batch10a; flag-on held on owner |
| lead-mod-gate | d2330b2a | 1bdaa226 (+37/−133) | liens, rulings | re-verify-mod-gate round 4 → ready with conditions (db2ba92f); review-disputes-stack covers d2330b2a | Via DS review | **disputes-stack** |
| lead-demo-r2 | 3190919d | 8246e64b (+79/−85) | lead-demo, intro-poc (reverted), owner-copy-1, payee-fields-2, terms-v2, trades-list. Partial: signup-v2@020c5cb2, no-russia@5faed49e, **owner-layout-1@9cd77a12, landing-tour@9456548f (both the CHANGES-NEEDED heads)** | no review of the demo-r2 merges themselves | — | Base of third-seckey-fix, third-terms-r3b, third-signup-r3 → **third-demo-r3** |
| lead-ruling-payout | a42dad1b | 1bdaa226 (+46/−133) | liens, rulings | review-ruling-payout final M3 re-verify → APPROVE at a42dad1b | Yes | **disputes-stack** |
| lead-proof-stack | 77787c46 | 0de4e081 (+52/−81) | proof-chat-receive, -ocr, -store, -upload | re-verify-proof-stack-r123 → APPROVED at 77787c46 | Yes | In batch10a; continued by proof-tripwire-2/3 |
| lead-late-funds | 86b7a86c | 1bdaa226 (+50/−133) | liens, rulings | re-verify-late-funds-2026-11-12 → **NOT READY** (N1 blocking, N2 major) | Yes | **second-late-funds-fixes** 7e339feb (and the lead's local, diverged 8f6655e2) |
| lead-owner-layout-1 | 1eef8f90 | 8246e64b (+6/−85) | — | review-owner-ui → **CHANGES NEEDED** (L1) at 9cd77a12 | **No**: fixes 4a4614f0, 1eef8f90 unreviewed | demo-r2 line carries only 9cd77a12 |
| lead-proof-tripwire-2 | ef27cf31 | 0de4e081 (+53/−81) | proof-stack + its four | review-proof-tripwire-2 → APPROVED | Yes | Continued by tripwire-3. **Not in batch10a** |
| lead-escrow-harden | b1a364ce | 4f0afa14 (+2/−0) | — | review-lead-escrow-harden-2026-11-16 → APPROVE WITH MINORS | Yes | Fixes continue on **second-escrow-harden-fixes** 9c7e7a78 |
| lead-disputes-stack | 1cff3d66 | 4f0afa14 (+75/−0) | liens, mod-gate, mod-screens, ruling-payout, rulings | review-disputes-stack-2026-11-16 → APPROVE WITH MINORS, 4 merge conditions | Yes | Fixes continue on **second-disputes-fixes** c084f2b6; base of third-lien-recovery |
| lead-proof-tripwire-3 | ff051b73 | 0de4e081 (+54/−81) | tripwire-2 and below | none (follow-ups T-M1, T-M2, T-I2..I4 from the tripwire-2 review) | No | Latest proof head |
| lead-landing-tour | 62b71ef8 | 8246e64b (+6/−85) | — | review-owner-ui → **CHANGES NEEDED** (B1-B5) at 9456548f | **No**: fixes 88e964f9..62b71ef8 unreviewed | demo-r2 line carries only 9456548f |
| lead-batch10a | 846d83ba | 4f0afa14 (+101/−0) | bans, device-bound, dispute-spec-flake, no-russia, payee-fields-2, proof-chat-receive, -ocr, -stack, -store, -upload, trades-list | Lead's own assembly report (untracked here): **NOT GREEN, do not land**. Trial merge vs disputes-stack in review-disputes-stack-2026-11-16 | Integration branch | Local 46780469 + uncommitted edits in progress |
| lead-signup-v2 | 2364324b | 4f0afa14 (+6/−0) | — | re-verify-signup-v2-2026-11-12 → **NOT READY** (R1 bypass) at 74814e0e | **No**: R1 fix fee8c0b9 (14 Nov) never re-verified; third-signup-r3's review scoped it out | Contained by third-signup-r3 and everything after |

(wip/design-brief 3f52da2b, 12 Nov 22:25, is the design session's branch, base 7c43bf09: not one of the four teams, not in this plan.)

### 1c. third-* (claude3) (9)

| Branch | Head | Base (+ahead) | Contains | Latest review → verdict | Current head? | Superseded by / where |
|---|---|---|---|---|---|---|
| third-terms-r3 | 478a3d00 | 8246e64b (+4; on signup-v2 74814e0e) | — | none | — | **third-terms-r3b** (different text, same version 2026-11-14) |
| third-seckey-fix | fe6765c7 | 8246e64b (+83; on demo-r2) | demo-r2 line | review-third-seckey-fix-2026-11-16 → **CHANGES NEEDED** (B1) | Yes | **second-seckey-fixes** 64ea5c1f |
| third-terms-r3b | 0866f8b7 | 8246e64b (+80; on demo-r2) | demo-r2 line | review-third-demo-r3-and-terms-r3b-2026-11-16 → APPROVE WITH MINORS (code); 11 owner copy Qs | Yes | In demo-r3 |
| third-signup-r3 | 90972d6e | 4f0afa14 (+89) | demo-r2 line + signup-v2 2364324b | review-third-signup-r3-2026-11-16 → **CHANGES NEEDED** (B1) | Yes | **second-signup-r3-fixes** |
| third-demo-r3-fix | 1ccbb0b9 | 4f0afa14 (+110) | above + seckey-fix, terms-r3b | = demo-r3 as reviewed: **CHANGES NEEDED** (B1 stale board refs) | Yes | **third-demo-r3** |
| third-netfee-split | 7070acbf | 4f0afa14 (+11) | second-netfee-fixes 6790d98d | review-third-netfee-split-2026-11-16 → **CHANGES NEEDED** at e6f718c4 | No (merge of the fixes + 2 commits) | Fixes on **second-netfee-fixes**; books columns now claude2's (WHO-DOES-WHAT) |
| third-demo-r3-minors | ed931794 | 4f0afa14 (+123) | demo-r3-fix line | none | — | Merged into demo-r3 (1fa6bed1) |
| third-lien-recovery | 377c9e3e | 4f0afa14 (+84) | disputes-stack + liens, mod-gate, mod-screens, ruling-payout, rulings | **none yet**: claude2's money review in progress (review-third-lien-recovery-2026-11-16.md not posted) | — | Migration **560_lien_recovery clashes with batch10a's 560_account_bans** |
| third-demo-r3 | 94337781 | 4f0afa14 (+143) | see §2 | last code review at 1ccbb0b9 (CHANGES NEEDED B1); claude3 reports full check 7,304 vitest / 574 PW green with known reds (serve-boards, semgrep offline) | **No** | Owner's demo branch |

### 1d. second-* (claude2) (9)

| Branch | Head | Base (+ahead) | Contains | Latest review → verdict | Current head? | Notes |
|---|---|---|---|---|---|---|
| second-escrow-harden-fixes | 9c7e7a78 | 4f0afa14 (+6) | lead-escrow-harden b1a364ce | none (READY 16 Nov 13:43) | — | MONEY/KEYS: needs re-verify |
| second-netfee-fixes | 6790d98d | 4f0afa14 (+8) | third-netfee-split's e6f718c4 commits | none (READY 13:46) | — | MONEY: needs re-verify; migration 550→600 |
| second-trial-batch-16nov | 277e969b | 4f0afa14 (+111) | see §2 | none; no check counts posted | — | claude2's trial for the lead's landing |
| second-disputes-fixes | c084f2b6 | 4f0afa14 (+83) | disputes-stack, liens, mod-gate, mod-screens, ruling-payout, rulings | none (READY 22:46) | — | DISPUTES/KEYS: needs re-verify |
| second-signup-r3-fixes | 498bb185 | 4f0afa14 (+100) | demo-r2 line, signup-v2, third-signup-r3 | none. READY was at **d584545d** (13:45); 6 later commits (owner TOTP + login-method rules, 33b45333..498bb185) have **no READY line** | — | LOGINS: needs re-verify |
| second-seckey-fixes | 64ea5c1f | 8246e64b (+91) | demo-r2 line, third-seckey-fix | none (READY 22:47) | — | KEYS: needs re-verify; in demo-r3 |
| second-late-funds-fixes | 7e339feb | 4f0afa14 (+53) | lead-late-funds, liens, rulings | none; **no READY line** | — | MONEY: N1/N2 fixes need re-verify |
| second-fonts | 7314ab50 | 4f0afa14 (+127; on demo-r3 1fa6bed1) | demo-r3 line | none; no READY line | — | In demo-r3 |
| second-notes-continuity | c65b9d58 | 4f0afa14 (+130; on demo-r3 1fa6bed1) | agy-notes-continuity 7192a7b8 | none; no READY line | — | In demo-r3 |

### 1e. agy-* (14): see §5.

---

## 2. The integration branches

### wip/second-trial-batch-16nov @ 277e969b (base main 4f0afa14, +111)
Three merges: 36ba072e second-escrow-harden-fixes 9c7e7a78 · 5eaa15c3 second-netfee-fixes 6790d98d ·
277e969b second-signup-r3-fixes **d584545d** (stale: 6 commits behind its head 498bb185).

Full heads it contains: lead-escrow-harden b1a364ce, second-escrow-harden-fixes 9c7e7a78, second-netfee-fixes 6790d98d,
third-signup-r3 90972d6e, lead-signup-v2 2364324b, lead-demo-r2 3190919d, lead-demo 2030af9a, lead-intro-poc 940a4f80
(net reverted), lead-owner-copy-1 7348962c, lead-payee-fields-2 ec53ea9b, lead-terms-v2 a467c7e7, lead-trades-list 2c323dc7.
Partial (through demo-r2): lead-no-russia@5faed49e, lead-owner-layout-1@9cd77a12, lead-landing-tour@9456548f.

**Hazard:** the third merge drags the whole demo-r2 line in, including two CHANGES-NEEDED heads, the demo tool and the
un-re-verified sign-up-v2 R1 fix. Only merges 1 and 2 are a self-contained money batch.

### wip/third-demo-r3 @ 94337781 (base main 4f0afa14, +143)
Full heads: lead-demo 2030af9a, lead-demo-r2 3190919d, lead-intro-poc 940a4f80 (net reverted), lead-owner-copy-1 7348962c,
lead-payee-fields-2 ec53ea9b, lead-terms-v2 a467c7e7, lead-trades-list 2c323dc7, lead-signup-v2 2364324b, third-signup-r3
90972d6e, third-seckey-fix fe6765c7, third-terms-r3b 0866f8b7, third-demo-r3-fix 1ccbb0b9, third-demo-r3-minors ed931794,
second-seckey-fixes 64ea5c1f, second-fonts 7314ab50, second-notes-continuity c65b9d58, agy-notes-continuity 7192a7b8.
Partial: second-signup-r3-fixes@d584545d (missing the 6 owner-rule commits), lead-no-russia@5faed49e,
lead-owner-layout-1@9cd77a12, lead-landing-tour@9456548f, third-terms-r3 (only via signup-v2).
**Contains no agy branch** apart from notes-continuity. Not in it: escrow-harden, netfee, disputes, late-funds, liens line, batch10a.

### Approved branches that neither contains (at their approved head)
- Disputes line: lead-disputes-stack 1cff3d66 (and liens 91e784a2, rulings 41f0021a, mod-screens 0e2d2957, mod-gate
  d2330b2a, ruling-payout a42dad1b inside it).
- Proof line: lead-proof-stack 77787c46 (+ upload ce6057b7, store 1e2599dd, ocr 622e0751, chat-receive fdc5d83d),
  lead-proof-tripwire-2 ef27cf31.
- lead-bans 0ef4b7a7, lead-device-bound ba7ea9fe (flags off), lead-no-russia at 39b82082 (both have 5faed49e only).
  *(bans, device-bound, no-russia and the proof stack are in batch10a; tripwire-2 is not.)*
- lead-tours-staff-team e4b20baf.
- lead-j14 65339bd6 (held on owner).
- third-terms-r3b 0866f8b7 is in demo-r3 but not the trial batch; lead-escrow-harden b1a364ce is in the trial batch but not demo-r3.
- agy (all built on demo-r3, none merged): setup-flow 0013cf31, recovery-copy 95d2bfd6, landing a1015461 (needs an owner
  yes), giftcards 3dbdb630, flakes b51ec5b1, demo-docs 2c774764, terms-questions 692f1272.

---

## 3. Blockers

**A. Approved but with open blocking findings, or the fix is unreviewed**

| Branch (head) | What blocks it |
|---|---|
| lead-batch10a 846d83ba | Lead's report: NOT GREEN. (1) bans site-ban gate vs main's FrozenWatch: `banned.spec.ts:37` red; lead/owner call **(a) add GET /v1/account/freeze to the gate's ACCOUNT list (recommended) or (b) FrozenWatch ignores 403 banned**, plus the other trade-room routes the gate doesn't list (blur-checks, proofs/:id, session/proof, GET /v1/trades). (2) Reds already on the heads: auth-client `flows.test` (4 routes lack a client method: bans, trades-list, device-bound, proof-stack), api `news.test` (bans), web `serve-boards` (no-russia changed boards without recapturing refs). Full suite not rerun after 7650ebdf/846d83ba. Being fixed now (local 46780469 + uncommitted). |
| lead-disputes-stack 1cff3d66 | Conditions 1 (staff.css brace) and 2 (X3-1 a, b) are fixed on second-disputes-fixes c084f2b6, **unreviewed**. Condition 4: land netfee only as the 600 file; the disputes × netfee merge (**NF-1**, `settled` route: keep `RulingKind` and `networkFeeAtomic`) needs its own review. With batch10a: 7 conflicts; keep both lien and ban guards and `issuedAt?` on reset-staff-security. |
| lead-escrow-harden b1a364ce | Approved as is, but reviewer M1: fix before any key gets `notAfter`. The fixes (second-escrow-harden-fixes 9c7e7a78) are unreviewed. |
| lead-late-funds 86b7a86c | NOT READY (N1 blocking, N2 major). Fix on second-late-funds-fixes 7e339feb has no READY and no re-verify; the lead has a duplicate local fix. |
| third-netfee-split / second-netfee-fixes 6790d98d | CHANGES NEEDED B1-B3; fixes unreviewed; books columns + wording (no "half") not yet built (claude2). |
| third-signup-r3 / second-signup-r3-fixes 498bb185 | CHANGES NEEDED B1; fixes (d584545d) and the 6 owner-rule commits unreviewed. |
| lead-signup-v2 2364324b | Re-verify NOT READY (R1); fix fee8c0b9 never re-verified; a second, local R1 fix exists. |
| third-seckey-fix / second-seckey-fixes 64ea5c1f | CHANGES NEEDED B1; fixes unreviewed; the success card needs a design drawing. |
| third-demo-r3 94337781 | Not reviewed at this head; B1 (stale BuyMain/Main refs, needs design's support.js) still open. |
| lead-landing-tour 62b71ef8, lead-owner-layout-1 1eef8f90 | CHANGES NEEDED; fix commits unreviewed; the demo-r2 line carries the unfixed heads. |
| lead-proof-tripwire-3 ff051b73 | No review (tripwire-2 ef27cf31 is the last approved proof head). |
| third-lien-recovery 377c9e3e | No review yet; migration 560 clash with batch10a. |
| lead-no-russia 39b82082 | One commit after the review (in-flight trades finish); small, unreviewed. |

**B. Waiting on owner answers**

| Branch | Owner question(s) |
|---|---|
| lead-j14 65339bd6 | **J1-J3, p11-78..80** (support tickets, D-054/D-055/D-057/D-059 in owner-answers-register); S5 Jabber notice at lock time. J-14 lands only after these. |
| lead-device-bound ba7ea9fe | Merge with flags off is fine. Flag-on waits on **S3** (revoke or keep unbound sessions at flag-on: not yet written in the spec) and spec §8's four questions (unbound sessions at mainnet, re-login after clearing site data, 10-min BOUND_TTL, the staff app). |
| disputes line (c084f2b6) | Before the gate goes live with staff: **D-1 / B1 residual** (owner confirms each staff key with an add-staff-key tap), **M-R2** remove-owner-key, Haveno F2 point 4 (signed case assignment), F1 key split, F3/F4. For the merge: **NF-1** (does a dispute-buyer payout book X2F's network-fee share? recommended yes). D-2/D-3 were proposed as lead calls and are now built. |
| second-escrow-harden-fixes 9c7e7a78 | **FEE_BOUND_FLOOR value** (0.0002 XMR, marked OWNER), relative cap, `bad-time` copy, the revocation list. |
| netfee | **Q1** copy (COPY-UNSIGNED), **Q2 minimum trade** (a fee output below its fee share can never release: stuck escrows), **Q3** seller-surplus exemption + 0.005 griefing cap, **Q4** senior pay on the gross 1%. |
| lead-bans (batch10a) | OQ1-OQ5 (who may lift a lifetime ban, offence counting, identifiers for lifetime trade bans, fresh accounts during a timed ban, what a lift undoes). Policy only; not merge blockers. |
| third-terms-r3b / demo line | Terms are COPY-UNSIGNED: answer **Q1** (owner access on appeal dropped), **Q3** (the cancel sentence contradicts the product), **Q9** (what is purged on day 30) before signing. Deploys must set `X2F_TERMS_VERSION=2026-11-14`. Plus agy-terms-questions' six Terms questions. |
| second-signup-r3-fixes | Q2 near-identical names (Q1 TOTP is answered: TOTP only with a password, 16 Nov). |
| second-seckey-fixes | Q1 where/which key on 13 Nov, Q2 KEY_ERROR wording, Q3 team members limited to the staff key list; success-state wording/icon; security-key art (4 outlines or real-key pictures). |
| lead-landing-tour / tours-staff-team / owner-layout-1 | owner-ui Qs: T4 (members and /welcome), S1 ("Log out when you step away" vs clock-out pay), L3 (which help page), help links on /session-length. |
| agy-landing a1015461 | Owner/lead yes on reversals **R1-R3** (diagonal "Welcome to", "Next screen" in the story tour, links under 760px). |

---

## 4. Proposed landing sequence onto main 4f0afa14

Rule for every batch marked **SEC**: it touches money, keys/logins or disputes, so the exact head being landed needs a
security re-verify after the final merge (rule 4 of LEAD-START-HERE: "Never skip the re-verify"). Every batch: full
check + Playwright, read the counts.

| # | Batch | Branches (head) | Ready? | SEC |
|---|---|---|---|---|
| 10a | Bans, device-bound (dark), proof stack, trades list, payee fields, no-russia | wip/lead-batch10a (846d83ba + the lead's 46780469 and uncommitted fix) = bans 0ef4b7a7, device-bound ba7ea9fe, trades-list 2c323dc7, payee-fields-2 ec53ea9b, no-russia 39b82082, dispute-spec-flake c369cd4c, proof-stack 77787c46. **Add** proof-tripwire-2 ef27cf31 (approved, 1 commit); tripwire-3 ff051b73 only after its review | After the freeze/ban call, the head reds and a green full check | **Yes**: KEYS (device-bound session keys, flags off), LOGINS (session query), DISPUTES (evidence proofs, the ban gate in trade rooms) |
| 10b | Escrow payouts (money) | second-escrow-harden-fixes 9c7e7a78 (contains lead-escrow-harden b1a364ce), then second-netfee-fixes 6790d98d (600 migration) + claude2's books columns. Use trial merges 36ba072e/5eaa15c3, **not** 277e969b. Never land third-netfee-split's old 550 file. Fallback if fixes slip: b1a364ce alone (approved). | After re-verifies + owner FEE_BOUND_FLOOR and netfee Q2 | **Yes: MONEY, KEYS** |
| 11 | Disputes | second-disputes-fixes c084f2b6 (= disputes-stack 1cff3d66 + D-2/D-3/X3-1/brace), then second-late-funds-fixes 7e339feb (or the lead's local fix: pick one), then third-lien-recovery 377c9e3e after its review, **renumber 560** (batch10a owns 560-590, netfee 600, signup-r3 610). Merge rules: keep lien and ban guards; keep `issuedAt?`; NF-1 review if 10b is in. Gate goes live only after D-1/M-R2. | After re-verifies, the NF-1 review and the lien-recovery review | **Yes: MONEY, KEYS, DISPUTES** |
| 12 | Sign-up, Terms, security keys, demo round 2/3 UI | Vehicle: third-demo-r3 94337781, merged with second-signup-r3-fixes **498bb185** (owner TOTP/login rules), lead-landing-tour 62b71ef8 and lead-owner-layout-1 1eef8f90 (their fix commits), lead-tours-staff-team e4b20baf. Brings in demo-r2 (owner-copy-1, terms-v2→r3b, payee-fields-2, trades-list: already in by 10a), signup-v2, signup-r3, seckey, fonts, notes-continuity, the demo tool (tools/demo). Decide whether tools/demo belongs on main; intro-poc is net-zero (reverted). | After re-reviews (landing-tour, layout-1, demo-r3 head), security re-verify of signup-v2 R1, signup-r3 fixes, seckey fixes; Terms Q1/Q3/Q9; serve-boards recapture | **Yes: LOGINS, KEYS** (TOTP/password rules, security-key attestation, demo RP-ID adoption) |
| 13 | agy UI/docs | On top of 12: agy-setup-flow 0013cf31, agy-recovery-copy 95d2bfd6, agy-giftcards 3dbdb630, agy-flakes b51ec5b1, agy-demo-docs 2c774764, agy-terms-questions 692f1272 (docs), agy-landing a1015461 (after owner yes R1-R3); wallet-research a014d5b0 and notes-audit d61d24a8 (docs) once they have a review file | Approved now except landing (owner) | No |
| held | J-14 support tickets | lead-j14 65339bd6 (base 6ebed537: merge main first; migration 450) | Owner p11-78..80 | **Yes: KEYS** (sealed ticket text), account lock |

Why this order: 10a is nearly assembled and is the lead's current work. 10b is small (+6/+8 on main) and independent
(3 import/doc conflicts with each other, no logic). 11 must follow 10a (lien vs ban guards; migrations 560+) and needs the
NF-1 review once 10b is in. 12 is the widest and has the most unreviewed heads, and 10a already lands four of its parts.
13 is built on demo-r3, so it follows 12.

---

## 5. agy branches

All 14 are cut from wip/third-demo-r3 (1fa6bed1, b1172d63 or 94337781). claude3 reviews them (WHO-DOES-WHAT).

| Branch | Head | Posted | Review file → verdict | Covers current head? |
|---|---|---|---|---|
| agy-wallet-research | a014d5b0 | READY | **no review file**; claude3 to-lead.log 16 Nov 17:35: "good, evidence-cited" | Informal only. **Flag: READY, no review file** |
| agy-notes-audit | d61d24a8 | READY | **no review file**; same 17:35 line | Informal only. **Flag: READY, no review file** |
| agy-notes-continuity | 7192a7b8 | (claimed; claude2 took the job over) | none | **Flag: no review.** Superseded by second-notes-continuity c65b9d58 (also unreviewed), in demo-r3 |
| agy-setup-flow | 0013cf31 | FIXED | review-agy-setup-flow-2026-11-17 → APPROVE | Yes |
| agy-recovery-copy | 95d2bfd6 | FIXED | review-agy-recovery-copy-2026-11-17 → APPROVE WITH MINORS (two API plural strings are the lead's) | Yes |
| agy-landing | a1015461 | FIXED | review-agy-landing-2026-11-17 → APPROVE WITH MINORS; owner yes needed on R1-R3 | Yes |
| agy-unsigned-copy | 7485f123 | FIXED | review-agy-unsigned-copy-2026-11-17 → CHANGES NEEDED (777 KB doc, raw JSX in 10 rows) | Yes |
| agy-layout | 110ec56e | READY | review-agy-layout-2026-11-17 → CHANGES NEEDED | Yes |
| agy-terms-questions | 692f1272 | FIXED | review-agy-terms-questions-2026-11-17b → APPROVE WITH MINORS | Yes |
| agy-demo-docs | 2c774764 | FIXED | review-agy-demo-docs-2026-11-17b → APPROVE WITH MINORS | Yes |
| agy-giftcards | 3dbdb630 | READY | review-agy-giftcards-2026-11-17 → APPROVE WITH MINORS | Yes |
| agy-flakes | b51ec5b1 | READY | review-agy-flakes-2026-11-17 → APPROVE WITH MINORS | Yes |
| agy-notes-finish | f12b2d00 | READY | review-agy-notes-finish-2026-11-17 → CHANGES NEEDED | Yes |
| agy-a11y | 2053477c | READY | review-agy-a11y-2026-11-17 → CHANGES NEEDED | Yes |

Claimed but not pushed (no branch on origin): Job 13 screens-check, Job 16 help-pages, Job 17 error-copy, Job 18 web-tests.
agy is out of tokens (LEAD-START-HERE-17NOV).

## Lead calls, 17 Nov (batch 10a round 2)
- OQ-1: move `POST /v1/account/session/proof` and `/challenge` to the ban gate's always-allowed list (they renew only the caller's own cookie), with a test. Do it as a follow-up on batch 10a before bound sessions are turned on. It isn't needed for this landing, because the flag is off.
- M-1: accepted. While banned, the freeze read may still show the account's own finished dispute.
- Batch 10a lands when: the cloud full check is green apart from serve-boards (whose refs need design's board export), the probe file has run green, and the serve-boards refs are updated.

## Lead calls, 17 Nov (owner-UI integration f06301cf)
- The selection-ink ORANGE_ALLOWED additions (+3) are accepted.
- H1: the signed-in rail must not show members links they can't open (Settings, Wallets). Fix as a follow-up; it was already on main.
- After this lands: revert third-demo-r3's 884a5548 satoshi_ghost exemption, and deploy with X2F_TERMS_VERSION=2026-11-12.
- Lands when cloud runner F's full check and Playwright are green.
