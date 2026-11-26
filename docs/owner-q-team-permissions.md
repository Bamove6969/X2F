# Team permissions: 12 questions for you

Team permissions are the boxes you tick to say what each of your team members may do on your vendor account, such as replying in chats, editing offers or releasing XMR.
Each question below is one decision; your earlier answers (types with boxes, only you remove members, members can't log in more strongly than you, partners never learn which member replied) are already built in and not asked again.
For each question, design's recommendation is option A, marked "(recommended)".
You can answer with just the option letter (for example "TP1 A"), or in your own words.

---

## TP1. Can a member release XMR to a buyer?

Releasing XMR is the one step that can't be undone: once it's sent, it's gone. Today the box exists, starts off, and shows a warning you must confirm before it turns on. Without it, a member can handle a trade right up to the end, but you have to do the release yourself.

- **A (recommended).** A member can release XMR once you tick the box and confirm the warning. Every release is written in your team activity log with the member's name and the amount.
- **B.** A member can get a trade ready to release, but the XMR only moves when you tap Approve on your own device, every time.
- **C.** Only you can ever release XMR. The box is taken off the members' screen.

**Why we recommend A:** if every release waits for your tap, a member who sells for you can't finish a trade while you're asleep, and the box becomes pointless. The warning plus the log, together with the per-member limit in TP4, keeps the risk in your hands.

**Changes the boards:** MemberPermissions, Team.

---

## TP2. Which boxes should ask for your confirmation before they turn on?

Some boxes are risky enough that ticking them brings up a warning you must agree to, so you can't switch them on by accident. Today only "Release XMR" does this. "Confirm payment received" is the step just before release: if a member confirms cash that never arrived, the XMR goes out for nothing. An older Team screen also called accepting trades and posting or editing offers risky.

- **A (recommended).** Two boxes ask first: "Release XMR" and "Confirm payment received". Nothing else does.
- **B.** Only "Release XMR" asks first, as drawn today.
- **C.** A longer list asks first: "Release XMR", "Confirm payment received", "Accept a trade", "Post a new offer" and every "Edit" box under Offers.

**Why we recommend A:** these are the two steps that can lose you money with one tap. If too many boxes warn you, you stop reading the warnings.

**Changes the boards:** MemberPermissions, Team.

---

## TP3. Can a member send your payment details to a buyer?

When your account is selling, someone has to tell the buyer where to send the cash: your bank, Zelle, e-Transfer address and so on. If a member types in the wrong details, or their own, the buyer's money goes somewhere else and you still owe the XMR. Today this is one box, off for new members.

- **A (recommended).** The box stays, off for new members. When it's on, the member can only send the details you've saved for each payment type, chosen from a list; they can't type new ones. Every send is in the team log with their name. (This adds a "saved payment details" list to your settings, which has to be designed and built.)
- **B.** The box stays as it is: once ticked, a member can type and send any payment details.
- **C.** Only you ever send payment details. Members can tell the buyer "details coming" but can't send them.

**Why we recommend A:** switched payment details are the easiest way for a dishonest member to steal from you. A pick-list keeps the useful part and removes the danger.

**Changes the boards:** MemberPermissions, TeamChat, plus a new settings screen for saved payment details.

---

## TP4. Should each member have a trade-size limit?

Right now a box is all or nothing: a member who can accept or release can do it for a trade of any size. A limit would let you say "desk_ana may handle trades up to this size, nothing bigger." Above the limit, the trade waits for you.

- **A (recommended).** Each member can have an optional limit in XMR that you set, such as 0.5 XMR. Up to that size, they can accept the trade, confirm payment and release (if those boxes are ticked); above it, those steps wait for you. With no limit set, there's no cap.
- **B.** The same, but you set the limit in US dollars, such as $500, worked out at the price when the trade starts.
- **C.** A daily total per member instead, such as 2 XMR a day across all their trades; after that, everything waits for you until the next day (UTC).
- **D.** No limits; boxes stay all or nothing, as today.

**Why we recommend A:** it lets you trust a new member with small trades while keeping the big ones. XMR matches how the trade itself is counted, so the limit doesn't move when the price moves.

**Changes the boards:** MemberPermissions (a new limit field), Team (the limit shown on each member's row).

---

## TP5. Can a member post a new offer or delete one?

A new offer is a public promise in your name, and it takes one of your 3 buy + 3 sell places. Deleting an offer removes it for good, along with its history. Today both are separate boxes, off for new members.

- **A (recommended).** Both stay as separate boxes, off for new members. Anything a member posts or deletes shows "Posted by desk_ana" or "Deleted by desk_ana" in your offers list and in the team log.
- **B.** Members can be allowed to post, but deleting stays yours only. A member can at most pause an offer (with the "Turn offers on or off" box).
- **C.** Only you post or delete offers. Members can at most pause them and edit them, if ticked.

**Why we recommend A:** some vendors want a manager who runs the offers fully. With the name on every post and deletion, you can always see who did what.

**Changes the boards:** MemberPermissions, MyOffers.

---

## TP6. Can a member block a trader?

A block stops a trader from taking your offers or messaging you. It's quiet: if a member blocks a good customer, you may never notice that customer is gone. But members are often the first to meet a rude or abusive trader.

- **A (recommended).** It stays a box, off for new members. Every block a member makes appears in your team log with an Undo button you can tap once to reverse it.
- **B.** Only you can block. A member can mark a trader "Ask the lead to block", and you decide.
- **C.** Every member can block, on from the start, with no log entry.

**Why we recommend A:** the member can stop abuse at once, and you can see and undo any block you disagree with.

**Changes the boards:** MemberPermissions, Block, Team (team log).

---

## TP7. Can a member speak for you in a dispute?

When a trade goes to a dispute, a moderator reads both sides and decides who gets the money, so what is written in the dispute room matters. In the default set (TP12), a new member can open a dispute and answer the moderator. The partner and the moderator only see "Team member", never the member's name.

- **A (recommended).** A new member can open a dispute and answer the moderator. You can read every word in the dispute room and write there yourself at any time.
- **B.** A member can open a dispute, but only you answer the moderator.
- **C.** Only you open and answer disputes. Members can only tell you a trade needs one.

**Why we recommend A:** the member who handled the trade knows what happened. Making a dispute wait for you slows the ruling, and the clock keeps running.

**Changes the boards:** MemberPermissions, DisputeRoom, DisputeOpen.

---

## TP8. Can a member read your private notes on traders?

You can keep private notes on traders, such as "paid late twice" or "trusted, regular". They could help a member spot a known problem. But they are your own words about people.

- **A (recommended).** It stays a box, off for new members, renamed "See your notes on traders". Members with it can read your notes, but not change or add to them.
- **B.** Members with the box can read your notes and add their own, marked with their name.
- **C.** Never. Your notes are only ever yours, and the box is removed.

**Why we recommend A:** it lets you share a warning with someone you trust, without anyone else writing in your notes.

**Changes the boards:** MemberPermissions, Profile.

---

## TP9. What login does a member need to end a 24-hour hold early?

You decided members can be given "End a hold", which applies all waiting changes at once. The hold exists to give you 24 hours to notice a thief, so ending it removes that safety time. A member can never use a stronger login than yours.

- **A (recommended).** "End a hold" only works when the member confirms with a passkey or security key at that moment. If they're logged in with just a username and password, the button won't work. And if you only use a username and password yourself, no member can end a hold.
- **B.** It works from whatever login the member is using, including just a username and password.

**Why we recommend A:** if a thief has stolen a member's password, the thief could otherwise wipe out your 24 hours. Asking for a strong login at that moment closes the gap.

**Changes the boards:** HoldMember, MemberPermissions.

---

## TP10. When do you approve a member's login?

When a member first uses their invite link, you get a request and must approve them before they get in. This is the moment a stolen invite link gets caught. Today it happens only once, the very first time.

- **A (recommended).** You approve every member's first login, and also their first login on each new device.
- **B.** You approve only the very first login. New devices after that need no approval from you, as drawn today.
- **C.** You approve the first login. After that, new devices need your approval only for members who have "Release XMR" ticked.

**Why we recommend A:** one tap from you is a small cost. A member's login being used on an unknown device is exactly how an account gets emptied.

**Changes the boards:** MemberApproval, Team, Devices.

---

## TP11. Can you set working hours for a member?

Staff already have an on/off switch plus the days and hours they may work. Members have only the on/off switch. Working hours would mean a member can't log in or do anything outside the times you set.

- **A (recommended).** Each member gets the same days-and-hours setting as staff, such as Monday to Friday, 08:00 to 18:00 UTC. Outside those hours they can't log in. New members start with "any time".
- **B.** Keep only the on/off switch you already have; no schedule.

**Why we recommend A:** it's the same setting already designed for staff, so it costs little. And a member's login used at 3 a.m. outside their hours simply doesn't work.

**Changes the boards:** Team, MemberPermissions.

---

## TP12. What can a brand-new member do before you tick anything?

No starting set has been decided yet. Design suggests one rule: **a new member can talk and look, but can't move money or change anything public until you tick it.** That gives these 10 boxes on, and the other 24 off:

1. Read trade chats
2. Reply in trade chats
3. Nudge the other trader
4. See all offers
5. Decline a trade
6. Open a dispute
7. Reply in a dispute
8. See trade history
9. See the team activity log
10. See reviews

Off at the start: sending payment details, uploading proof, your notes on traders, blocking, every offer change (pausing, prices, amounts, payment types, currencies, posting, deleting), accepting, marking paid, confirming payment received, releasing, cancelling, leaving feedback, exporting history, payout amounts, replying to reviews and support tickets. The three hold boxes stay off, as you already decided.

- **A (recommended).** Use the 10 above as the starting set for every new member.
- **B.** A stricter start, with 5 on: read chats, reply in chats, nudge, see all offers, see reviews.
- **C.** Nothing on. You tick every box yourself for each new member.
- **D.** The 10 above plus "Accept a trade", so a new member can take trade requests but still can't confirm payment or release.

You can also answer with your own list, such as "A, but leave Open a dispute off".

**Why we recommend A:** a new member can do the everyday job of answering customers from day one. Nothing they can do on day one costs you money or changes what the public sees.

**Changes the boards:** MemberPermissions, Team, MemberApproval.

---

## Design will fix (no question)

- Team, TeamRefusal, MemberApproval and HoldMember still name the old four starting sets (Chat only, Offers manager, Trade handler, Everything allowed) or "Custom"; design replaces them with the member's count, such as "In 2 of 4 types · 9 of 34 allowed" (your Q16).
- MemberApproval's approved screen says "You start as Trade handler (9 of 34 allowed)"; it will show what you actually ticked.
- MemberPermissions keeps its five types (head designer, 8 Nov): Holds and waiting changes is its own type because you made those rights grantable on their own (p4-8); folding them into Records would hide them. Total stays 34.
- MemberPermissions' own design note still says "four types" before adding a fifth; it will be cleaned up to match.
- HoldChange still says team members can never see your waiting changes (G31); it will say they see them only with the "See waiting changes" box (p4-8).
- HoldChange still says anyone logged in can cancel waiting changes (6 Nov); it will say only you, and members you've given the box (p4-8).
- Any remaining wording that a removal from a username-and-password login "takes effect at once" (G57) will say it waits 24 hours like every other change (p5-7); Team and HoldChange already do.
- TeamRefusal locks adding members and changing their boxes from a username-and-password login; your decisions (G57, p5-7) say those changes wait 24 hours instead, so the board becomes a "this waits 24 h" screen.
- The MemberPermissions footer gets "starting a hold" added to its list of things members can never do, matching Team and MemberApproval.
- HoldMember already draws the plain "A hold is on" view for members without hold boxes (p4-8); no new screen is needed.
- The hold warning says "or message a moderator" until you supply the Matrix and Telegram addresses (G49).
- "See support tickets" will explain that tickets are shared across the team, including the team's shared 10-a-day limit (Q67, Q69).
- The Team board's "risky" wording on the old starting sets goes away and will follow your answer to TP2.
