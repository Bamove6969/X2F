# claude2 handover (17 Nov, written in case claude2's usage runs out)

Everything is pushed. Owner decisions are logged in to-lead.log; reviews are review-*-2026-11-16.md on comms.

## READY (lead re-verifies, then lands)
| Branch | Head | What |
| --- | --- | --- |
| wip/second-escrow-harden-fixes | 9c7e7a78 | lead-escrow-harden + M1-M3 (batch 10b) |
| wip/second-netfee-fixes | 6790d98d | netfee-split review B1-B3, M1 (migration 600), M2 (batch 10b) |
| wip/second-disputes-fixes | c084f2b6 | lead-disputes-stack + D-3, D-2, X3-1, staff.css (batch 11) |
| wip/second-late-funds-fixes | edb028c2 | N1, N2, gap (b); main merged; gap (a) open (batch 11) |
| wip/second-seckey-fixes | 64ea5c1f | seckey review + security-key success screen (demo) |
| wip/second-signup-r3-fixes | 05d7c7ab | owner 16 Nov login rules (TOTP only with password, password never alone, UV required); batch 12 |
| wip/second-fonts | a3ded295 | owner fonts option D + sizing (claude3 to re-merge into third-demo-r3) |
| wip/second-notes-continuity | 7ebb1d34 | demo pins carry over, global numbers, download, auto-push to comms |

## Not finished
- **wip/second-owner-ui-17nov** (40527149+): owner 17 Nov: floating orange button (done, tests pushed); IN PROGRESS: remove the gray edge under/above the button, labels much bigger (fill the button, never touch top/sides, buttons same size), then the black+orange audit of every screen (owner-review/orange-audit on branch claude/cloud-session-queue-yrg242) and an orange accent on every screen without one + a test. Owner wants to see the two Post offer shots (1366, 390) after each change.
- **wip/second-batch-10b** (3ba4a775): main 4f0afa14 + escrow-harden-fixes 9c7e7a78 + netfee-fixes 6790d98d merged; FULL CHECK NOT RUN yet.
- **wip/second-netfee-books** (a0144634): wording without "half" done; staff books columns ("network fees paid to date", net) not done.

## Open owner questions (collected, not answered)
Fee floor 0.0002 XMR + payout-relative cap; minimum trade size; seller surplus fee exemption; senior pay on gross 1%; staff key confirmation tap before go-live; signed moderator assignment; password removal while TOTP on; legacy password-only accounts; staff/owner keys now need a PIN; "any FIDO2 key" for traders only; passkey success screen; staff-web uses the DM fonts; replies don't take pin numbers; notes on comms readable by anyone with repo access.

## Session infra
Jetpost: claude2 = Claude on bnkxfers; wake https://x2f-claude2.tail8d8abc.ts.net/jetpost (listener in claude2's scratchpad; restart after each wake). Cloud environment: personal "X2F" (Tailscale + Let's Encrypt + getmonero hosts).
