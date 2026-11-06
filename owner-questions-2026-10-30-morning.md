# Owner questions — 30 Oct 2026 (morning), compiled by the lead
Answer any time; "default OK" is fine for any item. Lead default in [brackets].

## A. Decide next
1. Land the four approved branches that do NOT depend on the watcher? Task 20 encrypted chat, Task 18 team members, staff tools (Plan 4 Tasks 1-3), "How's X2F doing?" feedback (Plan 5 Task 4). Each runs every test first. [yes]
2. The watcher (Tasks 9, 9-view, 10): on hold. Explainer with 4 options: ~/x2f-comms/watcher-explainer-2026-10-30.md. Pick A/B/C/D. [B]
3. Payout network fee: A) receiver gets the amount minus a tiny payout fee, or B) seller adds a fraction of a cent when funding so the buyer gets exactly the agreed amount. [B]

## B. Calls the lead made today without you — confirm or reverse
4. A login with only a PGP key can't add a payout wallet straight away; it waits like any other security change during a hold. [keep]
5. When you log in with a passkey/security key to end a 24 h hold, X2F forgets all your trusted devices (your other devices need one approval next time), so a thief's copied device cookie stops working. [keep]
6. If a change that was waiting on a hold fails when it applies, it's dropped (old setting stays, you get an alert) instead of blocking every login. [keep]
7. A password-only ("weak") session can log out only itself, never your other devices. [keep]
8. Owners with no passkey/security key can still cancel an intruder's backup session, but only from a session older than the backup one. [keep]
9. Feedback ("How's X2F doing?"): overall cap of 5,000 per day across everyone; extra ones are silently not stored. [keep]
10. Feedback privacy: store the week instead of the day, so on a quiet day nobody can guess who sent it? [your call; lead leans yes]
11. Flexible offers (Task 34): payment details are always the seller's (the one receiving fiat). Until the "check from the writer's own phone" is built (before mainnet), a hacked X2F server could swap payment details at trade start. Accept for testing? [yes, test network only]
12. 30-day self-destruct (Plan 7): while the real purge is off, the app shows no self-destruct date at all, and the Privacy page only states what is true today. [keep]
13. Earlier lead calls still waiting on you (from the open list): q11 48 h dispute window for every refund; q12 Trusted badge needs 5+ reviews; q13 team-member defaults; q14 a-j member escrow keys (reworded 06:45); q15 backups kept 14 days.

## C. Later topics (no rush)
14. Staff work: brainstorm everything that counts as paid work (disputes now; answering users' questions?) and how each is paid.
15. Cold wallet for fees: hardware wallet or offline laptop; whether X2F should watch the cold wallet's balance (needs its view key; costs privacy) [no].
16. Surplus in escrow: built after the watcher decision (rule already recorded).

## D. Calls claude3 made on its Plan 5 branches (built, not landed; each easy to flip)
17. Reviews: someone tries to take an offer whose POSTER still owes a review. Show A) a generic "offer busy" (the taker learns nothing about the poster) or B) "review pending" as the plan wrote. [A]
18. Reviews: a dispute a moderator has ruled on but not finalised (until Plan 4) can't be reviewed yet and blocks nothing. A) as built, or B) reviewable at "ruled". [A]
19. Review notes privacy filter refuses emails, phone numbers, card numbers, IBAN/account numbers and XMR addresses. Names, street addresses and @handles are NOT refused. A) as built (name/address rules would refuse ordinary notes), B) also refuse @handles, C) also names and addresses. [A]

## E. Calls claude2 made (built, not landed)
20. Privacy page: a new public "privacy facts" address the page reads, and rewritten wording that only states what's true today (wording not yet signed off by Claude Design). [keep]
21. The 30-day purge pauses while the site is in maintenance (no deletions while users can't act). [keep]
22. On start-up the app deletes its local copy of a trade the server says no longer exists. [keep]
23. Flexible offers: when an offer has several price tiers, the price shown is the best tier the viewer qualifies for (signed-out visitors see the tier for 0 trades). [keep]
24. Flexible offers: the wording shown when multi-tier offers are refused for now (wording not yet signed off). [keep]
25. (On hold with the watcher) If a buyer starts a cancel and never finishes it, the seller's auto-refund takes over (same payout). [keep]

## F. From the first review of the reviews API (Plan 5 Task 3, claude3) — privacy
26. Each review stores a "weight" so bigger trades count more. As built, that weight is the trade's exact dollar value (for $10–$1,000 trades), kept FOREVER, even after the trade itself self-destructs. Options: A) store coarse steps instead (e.g. small / medium / large; already built, one switch), B) store a rough bucket, C) keep exact and say so on the Privacy page. [A]
27. Reviews also keep the exact time of the trade forever. Coarsen it when the trade self-destructs to: A) the month, B) the day. [A: month]
28. When a poster who owed a review submits it, their offers reappear at once, which tells the other trader "they just rated" (not what they wrote). A) accept (it comes with "no offers while you owe a review"), B) delay reappearance randomly. [A]

## G. From the first review of the proof package (Plan 5 Task 7, claude3)
29. Review notes: numbers next to a currency (like "250000 COP") are refused today as "personal details". A) keep refusing, B) allow a number next to a currency or XMR, C) allow any number with thousands separators. [B]
30. Blurring payment screenshots: the "this is a name" labels are English only ("Name", "Payee"…). A) English only for now (record the gap), B) add labels for the app's other languages now (Para, Empfänger, Bénéficiaire…). [B]
31. Reviews: trades that finished BEFORE the reviews feature goes live won't show up in the "please rate" list (people can still rate them from the trade page). A) accept, B) prompt for those too. [A]

## H. From the round-5 security review of Tasks 16-17 (device approval + 24 h hold) — now APPROVED
32. An owner with NO passkey/security key/authenticator (password + recovery codes only) whose recovery code is stolen has no way to stop the thief unless they were already logged in before the thief. After 24 h the thief's password change goes through. Options: A) keep it, and tell such owners in Settings that adding a passkey or security key is their only protection; B) during that hold, let the owner's waiting login open a session that can ONLY cancel the thief's backup login; C) require a passkey/security key/authenticator before recovery codes can be made at all. [lead leans C or B; your call]
33. (Found in older trade code, on hold with the watcher) Any session, even a password-only one, can mark a buyer's "refund alert" as seen, which could hide it and start the buyer's 15-minute clock. Fix it the same way as account warnings (only a strong session may)? [yes]
34. Payment-proof blurring: should Indian UPI payment IDs (like jane@okaxis) be blurred too? Only matters if India is a target market. [yes, blur them]
35. Payment-proof blurring keeps finding new number tricks each review round (invisible characters, Japanese dashes, circled digits...). Automatic detection can never be perfect, so it is a safety net: before any proof is uploaded, the sender always sees the blurred picture and can blur more by hand (Plan 5 Task 15's blur editor). OK to treat it that way and land the detector once a review finds no Important leak, rather than chasing every exotic format? [yes]
36. (Item 34 side effect) With UPI blurring on, review notes like "meet@noon" or "rate xmr@kraken" are refused as account details. Accept? [yes]
37. Should numbers split by "_ • · , :" between digit groups (e.g. 4111_1111_1111_1111) also be treated as card/phone numbers? Catches more, refuses a few more ordinary notes. [yes]

## I. Team members (Task 18): what a member can do in a trade the owner took
Members can't run the escrow until Task 42, so these are unclear:
38. "I've paid": the safe rule is that the amount to pay comes from the escrow on a device, never from X2F's server. A member has no escrow. Let a member mark paid using the server's amount? A) no, only the owner marks paid until Task 42, B) yes. [A]
39. Buyer's cancel / accepting the seller's cancel proposal from a member's phone: the refund then waits for the owner's device to sign. A) not allowed until Task 42, B) allowed. [A]
40. Seller-side "request refund", "extend time" and "walk away": allowed for members? [no, until Task 42]
41. Chat for members: your earlier answer (q13 d) says members chat; the code puts member chat with Task 42 (member keys). A) members chat now, B) after Task 42. [B]
42. (Plan 7) Shared phones: a trade's leftovers on a phone (marks, chat copy) are deleted when the trade self-destructs, but only once the account that saw it signs in on that phone again; another person's leftovers could stay on a shared phone forever. Options: A) keep that rule, B) also delete them some days after the self-destruct date even without that account signing in. Either way the phone would store a scrambled (one-way) tag instead of the account's raw id. [B, with 7 days]
43. (Plan 7) During site maintenance the self-destruct countdown pauses. Should the trade room say anything about it then (e.g. "Self-destruct paused during maintenance"), or show nothing? Wording would go to Claude Design. [show the paused line]

## J. Team members (from the Task 18 landing prep)
44. Outside a hold, a password-only owner session can still invite/change/remove team members. Should a team change from a weak (one-factor) session START a 24 h hold instead, like other security changes? [yes]
45. A team member logging in doesn't check the account's device limit (their sessions are counted later, when the owner logs in). Should a member's login be refused when the account is already at its device limit? [yes]
46. The 24 h hold message lists "new trades, wallet changes and login changes" — add "team changes"? [yes]

## K. Task 18 landing review (blocks Task 18, then staff tools + feedback)
47. SECURITY HOLE: a thief with only your password + a copied browser cookie could invite themselves as a team member and keep access after you prove you're the owner. Fix: A) invites and adding roles need a strong (2-factor) login; password-only gets "not allowed" [recommended], B) a weak session's invite starts a 24 h hold and alerts you.
48. Removing a team member during a 24 h account hold (the hold that starts when someone logs into YOUR account with only one factor, e.g. password alone or a recovery code): allow it (it only cuts access) [recommended], or keep removals blocked as you chose earlier?

## L. Recovery-code rules (built on wip/lead-p2-recovery-rules; screens not built yet)
49. During a hold that SOMEONE ELSE started, can a recovery-code login end or overrule it? Today: no (it extends it). [keep no]
50. When one of your strong devices BLOCKS a change made during a recovery-code hold, should that also log out the recovery-code session and end the hold? Built: no, blocking only removes that change; logging that session out is a separate button. [yes, block = also log it out]
51. You said a recovery-code hold always lasts 24 h. Should YOUR strong login (passkey/2 factors you had BEFORE the hold) still be able to end it early? Today: yes. [yes]
52. Is a PGP key a "two-factor method" someone may add during the recovery-code hold? Built: no (refused). [no]
53. Two-factor methods added during the hold only start working when the 24 h ends (your devices can block them until then). Confirm? [yes]
54. Your OWN strong device adding a method during that hold: also wait 24 h, or work at once? Built: waits. [work at once]
55. "Hold on everything": should chatting, blocking, nudges, feedback and logging out sessions also stop during the hold (trades in motion still finish)? Built: they still work. [keep working]
56. Hide the trader's offers during the OTHER 24 h holds too (password-only security change, new device with nothing to approve)? Built: recovery-code holds only. [yes, all holds]
57. Now that "weak" = username + password: what about a PGP-key-alone login and the authenticator-code-alone backup login? A) keep both, still waiting 24 h, B) remove the authenticator-code-alone backup login (recovery codes only), C) treat it exactly like a recovery code. [C]
58. During a recovery-code hold, someone adds an authenticator app when the account ALREADY has one: today the new one would REPLACE yours when the hold ends (your password + authenticator login would stop working). A) refuse adding a second authenticator while one exists (they can add a passkey instead) [recommended], B) allow it but show "this REPLACES your authenticator" in the alert your devices get.
59. Limit how many changes can be queued during one recovery-code hold, so a thief can't flood your alerts to hide the real one? [yes, max 3]
60. Side effect of the recovery fix: a security method YOU add during a recovery-code hold is dropped if your session that added it logs out or idles out before the 24 h ends (password-only sessions idle out after 2-12 h). A) accept (you'd add it again) [recommended for now], B) keep the owner's own additions (needs a way to tell owner from thief).
61. When a queued change is dropped because its session ended, your devices get a "change dropped" alert. Keep that alert? [yes]

## M. Smart proof check (Plan 5 Task 9, claude3; review 1 Nov)
62. The payment card goes green ("right amount") if ANY amount on the screenshot equals the trade amount, so "Requested $412.50 / Sent $400.00" also shows green and a partial payment slips through. A) keep "any", B) every amount must match (flags receipts that show a fee), C) new caution line "Shows $412.50 and $400.00 — check which one was sent". [C]
63. The check can tell when a screenshot is dated outside the trade (e.g. an old reused screenshot), but the card has no line for it, so the seller never sees it. Add a caution line? [yes]
64. When no amount can be read, the card says nothing, and a seller may take silence as "fine". Add "Couldn't find the amount"? [yes]
65. A screenshot of X2F's own "send $412.50, put K7M2-… in the note" screen passes every check. Are the closing line and "Screenshots can be faked" warning enough? [yes, plus moderators taught to spot it]

## N. Task 18 fix round (1 Nov)
66. "One device at a time" setting: a team member's session currently stops a password-only owner session from approving a new device. Letting it through would mean the owner's weak session logs out every other session, members included. A) keep (members block a weak one-device approval), B) let it through. [A]
67. New refusal wording (COPY-UNSIGNED, to Claude Design): "This device logged in with only one way of proving it's you, so it can't invite team members or change their roles. Do this from a device where you logged in with a passkey, a security key, or your password and authenticator code." OK as a draft? [yes, design to polish] (Will need updating once the 1 Nov strength table lands.)
68. Outside a hold, a password-only owner session can still REMOVE a team member (it only cuts access). OK? [yes]
69. (Task 18, landed 1 Nov) In the first 30 minutes after sign-up, weak sessions may still make security changes, but the new "strong only" rule for team invites has no such exception: an owner who signed up with only a password must log in again with a strong combination before inviting anyone (adding a method doesn't upgrade the current login). Keep strict? [yes]

## O. Past reputation claims (Plan 5 Task 10, claude3, 1 Nov) — bring your record from another site, proved with a PGP signature
70. Team members can't file or remove past-reputation claims (owner only). Keep? [yes]
71. (also: armor header lines like "Comment: alice@mail" are stripped before storing, built least-data) Some PGP tools put your EMAIL inside the signature. Built: such signatures are refused so no email is stored. A) refuse + help text "sign with your key's fingerprint, not your email", B) accept and store the signature encrypted, C) store as is. [B, else A]
72. The same PGP key used to claim two other sites for the SAME X2F account: refused today (one key = one claim). Allow it for the same account (still refused for other accounts)? [allow]
73. Wording of the "that site / that key is already claimed" popups (to Claude Design). [design]
74. A key whose claim a moderator revoked can be claimed again (it goes back to a moderator). OK? [yes]
75. (Past reputation) The plan allowed a signer's computer clock to run up to 5 minutes fast. The PGP library refuses any signature dated in the future, so today a fast clock gets "bad signature" (the help text could say "check your computer's clock"). A) keep strict + help text, B) allow 5 minutes. [A]
76. (Past reputation) The "finish claim" step is also limited to 10 per hour per account, like "start". Keep, or another number? [10]

## P. My offers screen rebuild (lead helper, 1 Nov evening)
77. Offer cap: the design board says "2 offers per side for each currency"; the app allows 3 per market and 20 in total. Which is right?
78. (design) A ticked offer card: ink ring only (board) or ink ring + raised background (conventions)? Built: both.
79. (design) During a trading hold, Off offers read "Hidden · trading hold" (built, per the review) or "Off · hidden from everyone"?
80. (design) The pop-up title "Some offers can't be turned on" is wrong during a hold (none can). New wording?
