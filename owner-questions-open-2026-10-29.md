# Open questions for the owner (consolidated 2026-10-29 afternoon) — the ONLY list
(lead recommendation in brackets)
1. (ANSWERED: yes) No-show refund: buyer can open a dispute within 48 h to prove they paid? [yes]
2. (ANSWERED: from when it lights up) Seller "Confirm cancel" auto-close: 48 h from when the button lights up (coins fully back), or from the buyer's cancel tap? [from when it lights up]
3. (ANSWERED: PGP alone waits; 2 factors required) PGP login on its own = strong (no wait)? [yes]
4. (ANSWERED: yes) 24 h hold details: whole account; the triggering change only takes effect after 24 h; only a strong login with a method held BEFORE the hold ends it early? [yes]
5. [ANSWERED 10-30 07:25, see owner-answers-2026-10-29-lead-calls.md] Staff forgot to clock out: pay up to last activity? [yes]
6. [ANSWERED 10-30 07:35: per dispute only for now; brainstorm other work later] Ordinary moderators: per-dispute pay too, or senior moderators only? [owner's call]
7. [ANSWERED 10-30: hot fee wallet + auto-sweep to cold, payroll float, notify] Separate small payroll wallet, topped up from the offline fee wallet? [yes]
8. [ANSWERED 10-30: fee in lien only if they owed it] Repayment trades (paying back a lien): no fee? [no fee]
9. (before launch) Team-member fee: flat 1.15% or tiered 1.1/1.2/1.3%? [flat]
10. Show "Disputes: N won, M lost" on every profile? [yes]
Lawyer items: ~/x2f-comms/lawyer-questions.md. Pay numbers and the large-trade threshold: later.
11. (2026-10-30, lead decided, please confirm) The 48 h "buyer may dispute a refund" window applies to EVERY refund the buyer can dispute (no-show, a lapsed trade, a cancel refund that lands after "I've paid"), not only no-show refunds. One rule; replaces the old open 90-day idea. [lead: yes, all]
12. (2026-10-30, lead set provisionally) Minimum number of reviews before the "Trusted" badge can show: 5? (Otherwise one 5-star review among 99 neutral ones could earn it.) [lead: 5]
13. (2026-10-30, Task 18 team members, lead defaults, please confirm) (a) Members always log in with TWO factors (no password + code or recovery codes). (b) Owner-only: wallets, the team itself, login methods, Settings > Security, sessions, alerts, logout timer. (c) A member with the Trades role can SEE the account's payout-wallet list (to pick one when taking an offer), but not add or remove wallets. (d) Until Plan 3 Task 42 (member signing keys), members CANNOT take offers (a taken trade can only be funded from the owner's device, so it would just time out); they can mark paid, cancel, dispute and chat on trades the owner took. [updated 2026-10-30 after the Task 18 review] [lead: yes to all]
14. (2026-10-30, revised 06:45, Plan 3 Task 42: how team members trade while the owner is offline; design doc docs/superpowers/specs/2026-10-30-task42-member-escrow-keys.md on wip/lead-docs-task42-design @827c03c). Recommended: every account gets a signing key on the owner's devices. Your device uses it to sign a one-time "approval" per member device (its key, which sides it may trade, limits, allowed payout wallets, expiry). X2F's moderation service (not the API) checks it, and also checks that every trade in your name was signed by your key or a member you approved. So a hacked X2F server can't trade as you or add a "member", and X2F still never holds two keys. Questions, lead defaults in brackets:
   a. Approve each member DEVICE once: you compare a 6-digit code with the member (in person or by a call), then tap Approve. A member who changes phones waits for you again? [yes]
   b. May a member SELL for your account, or only buy? A member who sells holds the seller's key, so they can release your coins to the buyer. X2F can enforce "buy only" or "sell only", but not "sell but never release". [both sides, with limits]
   c. How long does a member approval last without you opening the app? [30 days, renewed silently whenever any of your devices opens X2F]
   d. Default limits per member? [2 XMR per trade, 5 XMR per 24 h, 3 open trades] And may a member ask you for a one-off approval above the limit? [yes, but that may come after launch; until then, trades above the limit are refused]
   e. When your account SELLS through a member, who funds the escrow? [member sees the QR as today + a "Send to owner" button]
   f. OK that X2F's server keeps an encrypted copy of each member trade's keys, which only your devices can open (X2F can't), deleted when the trade ends, so you can take over if the member's phone is lost or they're removed? [yes]
   g. OK that a removed member's phone keeps its copy of the keys for trades still open until they finish (confirm-sheet wording)? [yes]
   h. Log your own key actions (account key set up, member approved/renewed, trades taken over) in the activity log? [yes]
   i. Members get push notifications for the trades they run? [yes]
   j. Your account's signing key: setting it up, or replacing it after losing every device, takes effect only after 72 h, during which any of your devices that opens X2F can block it. A new device of yours gets the key when you approve it from a device you already have, comparing a 6-digit code. If you lose every device, you can't trade for up to 72 h and members need re-approval. Is 72 h right? [yes, 72 h]
   Until a-f and j are answered, members stay unable to take offers (Task 18).
15. (2026-10-30, Plan 7 privacy) Server backups are kept 14 days, then destroyed (the Privacy page will say so)? [lead: yes, 14 days]
