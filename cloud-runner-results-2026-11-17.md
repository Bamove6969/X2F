# Cloud runner results (17 Nov)

| Runner | Head | Result |
|---|---|---|
| A | second-escrow-harden-fixes 9c7e7a78 | All green: vitest 6946, escrow 135, PW web 529. **Landed on main.** |
| A | second-netfee-fixes 6790d98d | All green: vitest 6915, escrow 114, PW web 529. Held on owner Q2 (minimum trade size). |
| B | second-disputes-fixes c084f2b6 | Red, from this branch (all pass on main): auth-client flows.test (`GET /v1/trades/:code/ruling-statement` has no client method and no exemption); staff-web moderator.spec ModQueue and ModCase parity, "exactly one [data-primary], found 2". claude2 is fixing them. |
| B | second-late-funds-fixes edb028c2 | All green: vitest 7075, semgrep 0, audit 0, escrow 120, PW web 529, staff 2. |
| B | lead-land-11a b6f9cf0e (late-funds on main 9c7e7a78) | Running. |
| C | second-seckey-fixes 64ea5c1f / second-signup-r3-fixes 05d7c7ab | Red from the demo-r2 base: 10 vitest failures (bundle satoshi_ghost ×2, cantDoThat 70>67, kit-tokens glow, loginApproveV2 title, proof-render-tripwire TourProvider url(), selection-ink 24>21, serve-boards, flows GET /v1/trades, payFields 62≠60); PW team.spec /welcome vs /sell; tour.spec folded Duo 657>617. Own: seckey signup-v2.spec terms-tick disabled; signup-r3 parity SetupBackup "Add {{choice}}"; xmpp prekey flake. → Port onto main (seckey: wip/lead-seckey-main in progress; signup-r3: next). |
| D | lead-batch10a ea5fc7bd | vitest 7216/1: only serve-boards (Main and BuyMain refs stale; passes on main). Probe 5/5 at b48b769b. Security cleared. Waits on the board refs. |
| E | lead-agy-a11y-fix 8f01c256, lead-agy-notes-finish-fix 6af719cd, lead-agy-unsigned-copy-fix 4474a139, agy-orange-audit 735d4784, agy-layout 950834b2 | Only serve-boards fails (it also fails on third-demo-r3; passes on main). Semgrep and audit 0. PW web green, except a dispute.spec parity flake at 735d4784 (passed alone). orange-audit is dropped (claude2's accffc9b is kept). |
| F | lead-owner-ui f06301cf | All green: vitest 6987, semgrep 0, audit 0, PW web 548, staff 2. Review APPROVE WITH MINORS. → Merge onto main and land. |

Environment notes: the bare root `npx playwright test` crashes (no root config); run each app's own config. Docker Hub rate-limits the postgres pull; the mirror.gcr.io pull-through works.
