# Owner answers (session 2026-10-28 night, recorded by lead)

Q1 Retention (replaces options A/B/C):
- Undisputed trades self-destruct 30 days after they end. This 30-day auto-delete IS the advertised
  "self-destructing" feature. No user-chosen times (1h/1d) and no early/manual delete for anyone.
- Disputed trades kept 90 days, counted from the moment someone presses the dispute button
  (only disputes are kept: they're what admins train on).
- NEW RULE: disputes must be settled within 48 hours, goal 24 hours or less.
Q2: moot (no short self-delete times exist any more).
Q3: no per-trade bare record. Fees: system knows every COMPLETED trade paid 1% (disputed excluded);
  keep a separate internal revenue ledger (aggregate) for revenue/profit/growth/payroll/treasury.
  A 2nd fee tier for large trades comes later (threshold TBD). Future revenue ideas: featured trader,
  trader banners, recommended trader per payment method.
  PENDING confirmation: ratings/completed counts as running totals on the profile, no per-trade stub.
Q4: yes, our own F-Droid repo.
Q5 I2P: decide AFTER homework: research people's concerns on the web + in-house testing of I2P
  browsers (secure context: WebCrypto/WebAuthn/service worker). Not decided.

Ratings (Q1 follow-up): ALL feedback is permanent (survives the 30-day delete), like Amazon/Uber:
  custom comment, templated comments, badges that describe the trade, star rating (1-5 or 1-10, TBD).
  The person rated can dispute a review and have it moderated (retaliation, competitor, doxxing, etc.).
Q6 (asked as Nostr/email trade alerts): owner said no email system. Described instead an
  ANNOUNCEMENTS inbox shown at login: messages newest first, each dated, so users see new vs seen;
  maybe a "don't show again" checkbox (undecided: it may be our only channel to users).
  Clarification on off-app trade alerts pending.
Q7: yes, delete-my-account (blocked while a trade or dispute is open).
Q8 (asked as user-blocks-user): owner described STAFF BAN stages: (a) trade ban: no new trades;
  (b) site ban for a set time: on successful login show "Your account is temporarily banned and will
  be fully operational again on <exact date and time>", auto-reinstate at that time, plus "if you
  disagree or think it was a mistake contact our moderators" with a Telegram or Matrix link.
  Clarification on trader-to-trader blocking pending.

Q6 alerts: phone push is important, with an optional loud alarm. Default sound and volume, user can
  upload their own sound file and set volume. Asked what Nostr is, and whether OMEMO-encrypted Jabber
  (XMPP) over Tor is safe enough as an alert option -> explained, pending pick.
Q8 user-blocks-user: YES, strongly. "Right to do business with who you choose / safe from bullying".
  Blocked person can't see your offers, take them, message you, or even see that you're online.
Q9 tickets: yes. Early on, admins/moderators may not have enough dispute work, so the owner picks who
  gets ticket access (staff can answer site questions too). Tickets in categories plus a final
  "everything else" category.
Q10 offers: yes. A list of all my offers, each with an on/off toggle, plus "select all" to turn
  all on or all off.
Q6 final: phone push + loud alarm sound (default; custom sound file + volume) definitely. One extra
  only, to keep setup instructions short: OMEMO Jabber over Tor. No Nostr. (Owner: "not too many
  options, we must write detailed setup instructions for each.")
Q11 warrant canary: owner wants more information before answering.
Q12: yes, Titan v2 only (no U2F-only Titan).
Q13: yes, allow YubiKey Bio for staff.
Q14 caps: owner asked why anyone needs several offers on the same side/method/currency -> explaining.
Q15 emergency stop: yes, lists hidden, BUT show a message: unscheduled but necessary maintenance,
  back as soon as possible; check the News section (same as the login announcements inbox) or join
  our Matrix/Telegram, where the channel topic holds a pre-written latest-info message and users can ask.
Q16 lost disputes: NO. A settled dispute still COUNTS toward completed trades (money likely changed
  hands; disputes are common). No automatic stage drop. Instead the moderator can recommend account
  limits to a SENIOR moderator for habitual offenders or obvious hit-and-run cases.
  -> Changes the contract recorded for Tasks 27 and 4.
Q11 canary: owner deferred to the lawyer; added to ~/x2f-comms/lawyer-questions.md (open list).
Q14 caps -> REDESIGN (owner idea): FLEXIBLE OFFERS, built right after Tasks 4+5 land (~2 tasks):
  - Tiered pricing in one offer: "+" adds a tier (amount range + margin), per-tier rules (e.g. "buyer
    must have X completed trades"). Ranges can't overlap; gaps allowed.
  - Multiple payment methods in one offer: buyer picks one from a dropdown at take; locked into the
    signed trade terms; each method has its own instructions and optional price adjustment (e.g. +2%).
  - List shows each offer's final price for the buyer's amount + method.
  - New cap: 2 offers per side (buy/sell) per currency; 20 total backstop.
  - Limit popup: "Sorry, you're limited to 2 offers per side ..." + "If you feel this feature can be
    improved please leave feedback" (link -> feedback form: complaint/feedback/recommendation).
    On submit: "Thank you! Each and every comment is appreciated and reviewed to help make this
    community a better place for us all." Owner: users must know we hear everything.
Feedback: (1) the "leave feedback" link goes on EVERY popup that tells a user they can't do something.
  (2) Checkbox "Send anonymously": user chooses; named feedback lets staff reach out for details.
ALL 16 QUESTIONS ANSWERED except: Q5 I2P (research + in-house testing first), Q11 canary (lawyer list).

LEAD DECISIONS review: owner walked through the 2-of-3 trade flow; said "Ok" to decision 1 (trade waits
  until both addresses are in; locked after).
WARNING POPUPS before major actions (owner):
  - BUYER (sends fiat), before "I've paid"/proof: "We strongly recommend that you do not send payment
    until all confirmations are complete and you've received confirmation that the XMR is fully in
    escrow. The way our system is designed, we can help you get back the XMR you were trading for if
    anyone tries to scam you, but recovering a payment you've sent is much harder and sometimes
    impossible." System must know the escrow state (app already blocks paying until funded+confirmed).
  - SELLER (releases XMR), the opposite: don't release until the money is really in your account;
    check your own bank/app, not a screenshot; once released the XMR can't be taken back.
Battery (owner idea, raised on decision 3): let users opt in to Android "unrestricted battery" for the
  app so alerts are never delayed/missed. Optional, user's choice, explained in setup (native Android
  app; needed most on de-Googled phones and aggressive brands).
Decision 2 (migration 111): yes. Decision 4 (paidRecorded): yes.
Decision 5 (44px .x2f-method-name): owner leaves it to Claude Design; send it with the design-canvas copy fixes.
Decision 7 discussion (buyer's "refunded" screen): owner wants it to cover every refund reason, with the
  reason shown, incl. "payment time ran out, the seller cancelled; everything in escrow went back to the
  original owner".
APPEALS (new feature, owner): dispute outcome notice has a call to action "Don't agree with the
  moderator's decision? Request an appeal. You have 72 hours (until <exact date/time computed from the
  decision>)." A "File appeal" button on the completed-trades list and on that trade's page; it
  disappears when the 72 hours are up. OPEN: what an appeal can change once coins have moved (asked).
APPEALS outcome (owner): a won appeal (1) fixes the record (marks, ratings, limits) AND (2) puts a LIEN
  on the other account: it loses all trading privileges until it pays the decided amount to the
  person who won the appeal. Open sub-questions asked: amount basis (XMR of the trade?), how the
  repayment is made and proven (lead recommends through an X2F escrow), who decides appeals.
  -> Amount owed = the loss (the trade's XMR amount). Repayment through an X2F "repayment trade" with
  escrow; the system sees it and lifts the lien automatically. Appeals decided by a senior moderator
  (never the original moderator) or the owner.
  -> RULE: no moderator involved in the original dispute (decided, assisted, or commented) may take part in its appeal: conflict of interest. Enforce in code, not just policy.
Decision 3 (trade-closed -> idle): yes. Decision 6 (PHONE_VIEWPORTS): yes (lead's call). Decision 7 (Task 27 owns buyer refunded screen): yes. ALL 7 LEAD DECISIONS REVIEWED.

LEAD calls on docs-branch open points (2026-10-29 06:30, tell owner if asked):
- Plan 4 A1 (hold payout until appeal window closes) DROPPED: owner chose record fix + lien; coins move at the ruling.
- No eligible appeal reviewer (owner + all seniors involved): appeal waits, owner alerted; trader told it's waiting
  for an independent reviewer. Appeals aim for 48 h like disputes.
- Moderator contact link: setting takes Matrix or Telegram (Matrix preferred: no phone number).
- Release-time stat: keep the last 20 action durations per account, no trade codes.
- Task 4's built 3/20 caps stay until flexible offers (Plan 3 Task 34) land, then 2 per side per currency.
ASKED OWNER: dispute-after-refund window vs 30 days; 6-month training copies; review disputes after 30 days;
  1% fee on dispute payouts.
LEAD call 2026-10-29 08:00 (R38 detail): "completed trades" counts released trades AND refunded trades that had a dispute (a settled dispute counts whoever won). Tell the owner.
Owner copy items from Task 27: footer "It appears on your profile as a lost dispute"; the 90-day "Open a dispute" window (question A).

OWNER 2026-10-29 07:55 on Claude Design's update:
- Cancel: buyer side as discussed (options A/B; lead recommended B: buyer taps cancel -> XMR goes back at once via buyer + mod auto-sign; "Cancelled" only once the return has all confirmations; seller tap not needed). Owner: the SELLER can't cancel after tapping "Fund escrow".
- "I've paid" (buyer) is two steps, to avoid accidental taps: "Are you sure you want to tell the seller you've sent their payment in the requested format?" (owner's idea, final words to Claude Design / the brief's tick wording).
- Backup-login wait (replaces Claude Design's point 4): any login with at least two factors gets in with no wait; a single weak way of logging in causes a 24-hour cooling-off period.
- Still to confirm: devices (3, approval), team members, the small items.
- OWNER 07:59 devices: if you're already logged in and a NEW device tries to log in, you must approve or block it from the logged-in device (likely you switching or using both). (3-device cap and "one device at a time" option from the design: not contested.)
- LEAD: Task 36 turning offers OFF works with stale Terms; turning ON needs current Terms.
- OWNER 08:03 small items:
  a) bans show a simple, very general reason (not descriptive) + end date.
  b) blocking is silent: the blocked person is never notified.
  c) REVIEWS: when the reviewed account owner disputes a review it IMMEDIATELY shows "Under review" (benefit of the doubt to the owner) until a moderator decides: remove some comments, let it stand, or remove the review entirely. Reviews are very public but ANONYMOUS: nothing like an account number or order/trade number on a review that could link it to who left it.
  d) News: even with the login popup turned off ("don't show again"), a bell icon shows when there's new news; tapping it ("X2F news"/"Site news") shows the latest announcements.
  e) My offers: select one by one or Select all (then turn on/off).
  f) Deleted usernames are burned forever (no resurrection planned).
  Still open: buyer cancel A or B; team members.
- OWNER 12:30 BUYER CANCEL = B with a seller confirm: buyer taps cancel -> the XMR starts going back to the seller at once (buyer + mod auto-sign, to the seller's locked refund address). The seller's "Confirm cancel" button is GREYED OUT until the return has all its confirmations (the funds have definitely arrived back). Once it's clickable, the seller's tap officially cancels the trade. (Asked: what if the seller never taps.)
- OWNER 12:52 (question 4): a CANCEL itself can't be disputed. A refund CAN be disputed if the amount refunded was wrong (rare, but allowed).
- OWNER 12:54 LIENS (settles question 5 / the design conflict): losing a dispute that requires restitution puts an IMMEDIATE lien on the loser's account; they must pay it back to restore trading. If they APPEAL, the lien is lifted while the appeal is pending, and the appeal's outcome decides it. A won appeal that overturns a ruling puts the lien on whoever received the coins (design wording, consistent). Owner: disputes and appeals must flow smoothly, steadily and quickly.
- OWNER 13:07 STAFF PAY (question 7: yes, the design's staff-pay notes were the owner's decisions), details:
  * Staff are paid right at the end of their shift WHEN THEY CLOCK OUT CORRECTLY; pay for the time worked is calculated and transferred to their wallet then. Just closing the app does not clock out (no pay calculated).
  * Exact numbers TBD; Claude Design made a mock setup screen.
  * Senior moderators: owner sets a pay amount per dispute successfully completed, and a second setting: a % of the revenue generated by large trades (large-trade threshold TBD).
  * First login: explain their position, pay structure, and that an unhappy trader can appeal.
  * Appeal upheld (another senior mod or the owner agrees) -> the decision and pay stay. Overruled -> CLAWBACK of both the per-dispute pay and the large-trade bonus.
  * No arbitrator involved in a dispute can take part in its appeal (conflict of interest; existing rule).
  * Maybe "Appellate judge" positions later (owner deciding soon).
  * OPEN (asked): clawback after the pay was already sent: hold dispute pay until the appeal window closes, or take it from the next pay?
- OWNER 13:12 FEE ON DISPUTES: the 1% is NOT refunded on disputed trades: a settled dispute means X2F's service was used. (Replaces the earlier "revenue ledger leaves disputed trades out".) Asked: who pays it when the coins go back to the seller.
- Profile: owner leans to showing "Disputes: N won, M lost" on profiles (asked lead; lead recommends showing it and keeping the footer line).
- OWNER 13:14 SELLER NEVER TAPS "Confirm cancel": the trade stays in the seller's Active trades with a notification like "Your input is needed to cancel this trade." If ignored, it drops off (auto-closes as cancelled) within 48 hours. -> SELLER_CONFIRM_CANCEL_TIMEOUT_H = 48.
- OWNER 13:23 LOGIN WAIT (question 6): anyone who logs in with good security (2 factors, or a passkey/security key) and secures the account: NO wait, never punished. A login with only ONE weak way (password alone, authenticator code alone, recovery code alone) that changes the password/security: 24-hour cooling-off. A new phone with nothing logged in to approve it, one weak way: 24 h. Real owner learns of a thief via the new-device approval prompt (block), push/Jabber new-login alerts, and the Devices list.
- OWNER 13:23: agrees with the lead's 24-hour-hold proposals: strong = passkey / security key / 2 factors (incl. PGP + passkey/key); weak = password alone, authenticator code alone, recovery code alone -> 24 h; new phone with nothing to approve it + one weak way -> 24 h. Plan 2 Task 17 is now fully decided.
- OWNER 13:24 CLAWBACK = option A: pay goes out normally at clock-out; an overruled decision reduces FUTURE payments (recorded as owed if they leave).
- OWNER 13:26 FEE: a trade CANCELLED outright (buyer cancel, walk-away, lapse/no-show refund) pays NO 1% fee: nothing was facilitated. Disputed trades (settled by a moderator) pay the 1% (earlier answer). Asked: a dispute that ends with the coins going back to the seller.
- OWNER 13:32 WHO PAYS THE 1%: always the person whose AD was taken (the poster/advertiser), whether their ad is to buy or to sell. Accepting a reply to your ad = accepting the 1% market fee.
- OWNER 13:34 APPEAL WINDOW = 48 HOURS (settles the 48 vs 72 conflict; matches Claude Design's DisputeRuling/StaffSettings boards). Update every 72 h in spec/plans/code (Task 27 appeal_until, Plan 4 appealEndsAt / appeal_window_h default).
- OWNER 13:41 TEAM MEMBERS = YES (after launch): up to 3 members for now. Two roles, either or both per person:
  * Offers: create, delete, adjust, maintain offers.
  * Trades: accept trades, upload proof, mark money sent, complete transactions.
  Later (from feedback) a granular per-action permission list. Account owner gets an AUDIT LOG of everything a member does that has an effect. Chat messages are labelled "Message from Team <account display name> member: <member name>" (e.g. "Team Calcium member: Aurora") — replaces the design's "replied by a team member, never which member". Lead defaults: payout wallets, members, account deletion stay owner-only; each member has their own two-factor login. Tech note: releasing coins needs the trade's escrow key on the member's device (to be designed).
- OWNER 13:42: wants TEAM MEMBERS AT LAUNCH if possible (not after launch).
- OWNER 13:45 FEE OWED: when a dispute ends against the party who has no money on X2F (e.g. a buy-ad poster whose trade ends with the coins back to the seller), they still OWE the 1% of the trade total. The decision screen says plainly: "This also means you still owe the 1% fee for this trade, equal to <amount>, which will be deducted automatically from your future trades." Deducted automatically from future trades.
- OWNER 13:48 REFUND DISPUTES: cancelled trades carry no wrong-amount risk (the escrow returns everything), so no dispute on a cancel. In a DISPUTED trade a party may be ordered to pay back / complete payment through the payment method (fiat); if they send too little or nothing, the person owed files an APPEAL. Appeals: 48 hours from when the dispute is finalized. (The earlier 'a refund can be disputed if the amount was wrong' = this appeal case.) Still asked: the no-show refund (buyer paid but never tapped I've paid).
- OWNER 13:58 IDEA (decide before launch, not now): a fee for using team members: either tiered (1.1% / 1.2% / 1.3% for 1 / 2 / 3 members) or a flat 1.15% with any number of members (up to 3). Lead's view given: flat, applied only while the account has at least one member.
- OWNER 14:05 Q1: YES, a buyer can open a dispute within 48 h of a no-show refund to prove they paid (with proof they will likely win).
- OWNER 14:06 Q2: the seller's 48 h Confirm-cancel auto-close counts from when the coins are fully back and the button lights up (confirms the lead reading).
- OWNER 14:08 Q3/Q4: 'the minimum should be 2-factor authentication, and just certain combos (the ones the lead listed) qualify for no 24 h wait.' Lead reading (asked to confirm): every account must set up at least two factors; PGP alone is not a qualifying combo (waits); passkey/security key count as built-in two-factor (device + PIN/biometric).
- OWNER 14:12 CONFIRMED: every account must have at least TWO FACTORS (sign-up requires the second). A thief would need both factors, which they likely can't provide; the real owner can, and can then change security with no wait. Qualifying no-wait combos: password + authenticator; password + passkey/security key; PGP + passkey/security key; passkey or security key alone (built-in two-factor). Everything else (incl. PGP alone, any single weak factor) -> 24 h. Q4 hold details accepted.
