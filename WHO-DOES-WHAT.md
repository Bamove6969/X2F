# Who does what (claude3, claude2, agy) — written 2026-11-16 23:35:50 UTC by claude3; claude2 please confirm or correct in to-lead.log

The lead is away until Wednesday. The owner is the only one who decides product questions.
Change this file only by agreement (post the change in to-lead.log first).

## claude3 (cloud session)
- **agy's only manager and reviewer.** Only claude3 gives agy orders (AGY-ORDERS*.md, to-agy.log). A scheduled check
  every 2 h reviews each new wip/agy-* head (review-agy-<job>-<date>.md) and answers agy from recorded owner decisions.
  Anyone who wants agy to do something: post it in to-lead.log addressed to claude3.
- **The owner's demo branch wip/third-demo-r3**: claude3 merges finished work into it (claude2's READY branches, approved
  agy branches) and runs its full check before telling the owner it's ready.
- **Lien recovery** (wip/third-lien-recovery; owner option b: 50% default, % change needs a reason + senior approval).
- **Owner demo note 16 Nov #6**: per-trade wallet address and the 24 h wait for non-secure accounts (wallets/hold rules).
- Terms wording with the owner's legal skill (16 Nov #2).

## claude2 (second session)
- Its fix branches: second-escrow-harden-fixes, second-disputes-fixes, second-late-funds-fixes, second-seckey-fixes,
  second-signup-r3-fixes (incl. the TOTP-needs-password owner decision), second-notes-continuity, second-fonts.
- **Network fee split (owner: each receiver pays the network fee for its own payout output) — HANDED TO claude2**:
  claude2 already holds second-netfee-fixes; it also takes the remaining parts paused on wip/third-netfee-split
  (staff books columns "network fees paid to date" and net total; wording without "half"). claude3 stops touching it.
- Owner notes 16 Nov #1 (fonts) and #5 (security-key success + test).
- Reviews of lead branches as before. Post READY lines; claude3 merges them into the demo branch.

## agy (Antigravity CLI on the owner's PC)
- UI, copy, docs and research only (AGY-ORDERS.md Jobs 1-4, AGY-ORDERS-2.md 5-14, AGY-ORDERS-3.md 15-25,
  to-agy.log Jobs 26-32). Never money, escrow, keys, login security, fees, liens, disputes or payouts.
- Works only in the fresh clone described in AGY-WORKSPACE.md; never resets a branch that has its commits.
- Claims each job in to-lead.log, posts READY/FIXED/BLOCKED there, reads to-agy.log and review-agy-*.md every 30 min.
- No product calls: questions go in docs/agy-owner-questions-<job>.md. Note: agy's timestamps run ~1 h ahead (PC
  time-zone setting; the owner keeps it), so read its times with that in mind.

## Shared rules
- Before starting anything, claim it in to-lead.log; check this file and to-lead.log so nobody duplicates work.
- One branch per job; never force-push; never push to someone else's branch; READY lines with check counts.

## 17 Nov update (owner): claude2 and claude3 are out of tokens
- The lead (this session) now owns everything claude2 and claude3 held:
  - claude2: the second-* fix branches, netfee, fonts, notes-continuity.
  - claude3: the demo (wip/third-demo-r3), lien recovery, per-trade address + 24 h wait, Terms, and all agy review.
- Their branches stay as they are; the lead's helpers continue them on new wip/lead-* branches.
- agy's rules are unchanged: UI, copy, docs and research only; every agy head gets an independent review before it lands.

## 18 Nov update (owner): agy is on scene
- **agy:** UI, copy, docs, research and test code only. Its queue is in the Team Room (lead, 18 Nov 02:59 BC): seckey-art, rail-members, copy-list, error-copy (Job 17), passkey-copy, orange-settings, demo-docs-2, fold-flake.
- **agy's reviewer:** a dedicated lead helper reviews every wip/agy-* head as it appears. It runs the full check and writes review-agy-*.md to comms, with the ledger in the lead's scratchpad. claude2 and claude3 no longer review agy.
- **claude2 and claude3 are back:**
  - claude3: liens (third-lien-recovery d3e63fdf, kept) and merging its trade-wallet fixes into lead-trade-wallet.
  - claude2: disputes (ac55055d), netfee-books plus C1, owner-ui-17nov.
