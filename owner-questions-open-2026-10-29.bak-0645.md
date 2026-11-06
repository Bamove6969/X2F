# Open questions for the owner (consolidated 2026-10-29 afternoon) — the ONLY list
(lead recommendation in brackets)
1. (ANSWERED: yes) No-show refund: buyer can open a dispute within 48 h to prove they paid? [yes]
2. (ANSWERED: from when it lights up) Seller "Confirm cancel" auto-close: 48 h from when the button lights up (coins fully back), or from the buyer's cancel tap? [from when it lights up]
3. (ANSWERED: PGP alone waits; 2 factors required) PGP login on its own = strong (no wait)? [yes]
4. (ANSWERED: yes) 24 h hold details: whole account; the triggering change only takes effect after 24 h; only a strong login with a method held BEFORE the hold ends it early? [yes]
5. Staff forgot to clock out: pay up to last activity? [yes]
6. Ordinary moderators: per-dispute pay too, or senior moderators only? [owner's call]
7. Separate small payroll wallet, topped up from the offline fee wallet? [yes]
8. Repayment trades (paying back a lien): no fee? [no fee]
9. (before launch) Team-member fee: flat 1.15% or tiered 1.1/1.2/1.3%? [flat]
10. Show "Disputes: N won, M lost" on every profile? [yes]
Lawyer items: ~/x2f-comms/lawyer-questions.md. Pay numbers and the large-trade threshold: later.
11. (2026-10-30, lead decided, please confirm) The 48 h "buyer may dispute a refund" window applies to EVERY refund the buyer can dispute (no-show, a lapsed trade, a cancel refund that lands after "I've paid"), not only no-show refunds. One rule; replaces the old open 90-day idea. [lead: yes, all]
12. (2026-10-30, lead set provisionally) Minimum number of reviews before the "Trusted" badge can show: 5? (Otherwise one 5-star review among 99 neutral ones could earn it.) [lead: 5]
13. (2026-10-30, Task 18 team members, lead defaults, please confirm) (a) Members always log in with TWO factors (no password + code or recovery codes). (b) Owner-only: wallets, the team itself, login methods, Settings > Security, sessions, alerts, logout timer. (c) A member with the Trades role can SEE the account's payout-wallet list (to pick one when taking an offer), but not add or remove wallets. (d) Until Plan 3 Task 42 (member signing keys), members CANNOT take offers (a taken trade can only be funded from the owner's device, so it would just time out); they can mark paid, cancel, dispute and chat on trades the owner took. [updated 2026-10-30 after the Task 18 review] [lead: yes to all]
14. (2026-10-30, Plan 3 Task 42: how team members trade while the owner is offline; design doc docs/superpowers/specs/2026-10-30-task42-member-escrow-keys.md on wip/lead-docs-task42-design @d5484d3). Recommended: your phone signs a one-time "delegation" per member device (its key, side, limits, allowed payout wallets, expiry); X2F's moderation service (not the API) checks it, so X2F still can never hold two keys. Questions, lead defaults in brackets:
   a. Approve each member DEVICE once (a member who changes phones waits for you again)? [yes]
   b. May a member RELEASE coins as seller by default, or only if you switch it on? [on]
   c. How long does a member approval last without you opening the app? [30 days, renewed silently whenever you open X2F]
   d. Default limits per member? [2 XMR per trade, 5 XMR per 24 h, 3 open trades] And may a member ask you for a one-off approval above the limit? [yes]
   e. When your account SELLS through a member, who funds the escrow? [member sees the QR as today + a "Send to owner" button]
   f. OK that your phone keeps an encrypted copy of each member trade's keys so you can take over if the member's phone is lost or they're removed? [yes]
   g. OK that a removed member's phone keeps its copy of the keys for trades still open until they finish (confirm-sheet wording)? [yes]
   h. Log your own key actions (team signing set up, member approved/renewed, trades taken over) in the activity log? [yes]
   i. Members get push notifications for the trades they run? [yes]
   Until a-f are answered, members stay unable to take offers (Task 18).
15. (2026-10-30, Plan 7 privacy) Server backups are kept 14 days, then destroyed (the Privacy page will say so)? [lead: yes, 14 days]
