# Review: wip/agy-help-pages @ 5b15fd80 (Job 16, help content for /help/:topic)

Reviewer: the lead's dedicated agy reviewer, 18 Nov 2026.
Base: wip/third-demo-r3 94337781 (the branch holds one agy commit on top of it).
Scope: `apps/web/src/screens/HelpTopic.tsx`, the new `help.css`, the new `helpContent.ts` (463 lines of copy) and the new `apps/web/test/helpPages.test.tsx`.
Lane: UI and copy only. No money, escrow, keys, login, dispute, lien or payout code is touched.

## Verdict: CHANGES NEEDED

The structure is good. The 12 topics render, aliases work, the topic nav is a labelled `<nav>`, the CSS uses theme tokens, and there is no "half" anywhere. But Job 16 says "facts must match the code; list any doubt in the READY line". Several statements in the copy contradict the code at this base or the owner's rulings, and others state things nothing in the code supports. A trader reading these pages would be misinformed about fees, team permissions and privacy. Facts were checked against 94337781 and owner-decisions-2026-11-06.md.

## Findings

### Blocking: copy that contradicts the code or the owner's rulings
- **B1. Network fee (topic `fees`).** The copy says "Monero network fees are paid by each receiver for its own payout" and "In a dispute ruling dividing funds, each receiving destination covers the network fee for its respective payout share."
  - The code at this base (`packages/trade/src/payouts.ts:6-7`, and still on main b6f9cf0e) says: "Index 0 is always the party receiving the trade's XMR and bears the network fee". On release, the buyer output pays the whole network fee, including the fee and surplus outputs.
  - The per-output rule is the owner's newer decision. It lives on wip/second-netfee-fixes and wip/second-netfee-books, neither of which is on main.
  - There is no "ruling dividing funds": a ruling is `dispute-buyer` (a release) or `dispute-seller` (everything to the seller).

  Either describe what is built, or mark the paragraph as depending on the netfee branch landing. List it as a doubt in the READY line.
- **B2. Team permissions (topic `team-accounts`).** The copy says the Trades role lets members "chat with counterparties, mark payments as sent, agree to cancellations, and submit disputes". `apps/api/src/team/abilities.ts:14-18,36-39` says:
  - only trade parties open disputes (D-066, p7-7); the disputes box only lets a member see the dispute and answer the moderator;
  - every chat route stays owner-only until a member chat key exists (C-019);
  - trade-signing boxes are refused to members until per-member keys exist (`waits-member-keys`).

  Rewrite the section from the `ABILITIES` catalogue (`grantable` only), or keep it generic.
- **B3. Statements nothing in the code supports.** Remove each one, or list it as an owner question:
  - (`privacy`) "Personal information is automatically scrubbed by our internal privacy tool". claude3's terms-questions review (M) already found no such tool in the code.
  - (`privacy`) "No IP address logging: IP addresses are not recorded in web server logs, application databases, or dispute files." The API turns off request logging (`app.ts:188`), but nobody has verified the "databases" and "dispute files" parts. This is a privacy promise to users, so it needs the owner or lead, not agy.
  - (`gift-cards`) "Retain receipts and packaging throughout the 45-day claim window". There is no 45-day window in the code or in G50-G56.
  - (`gift-cards`) "Currency matching: the gift card currency must match the official currency of the card country of issuance", and "Sellers are forbidden from demanding gift card codes or receipt photos upfront". Neither appears in G50-G56 or p5-6 as a ruling.
  - (`support`) "Technical contact: Connect with X2F staff via secure Jabber (XMPP) messaging". There is no staff Jabber contact. The owner's support headline is "Ask an X2F staff member" (p5-4).
  - (`how-a-trade-works`) "Paying from an account in your legal name helps prevent banking holds". This is advice that would need an owner ruling.
- **B4. Timers presented as settled.** "such as 90 minutes for instant payment services" (`disputes`) and "respond within 60 minutes" are stated as fact. The owner said the 90 min, 3 h and 24 h pay windows are placeholders until the per-payment-type research is in (p11-29). Say "the time shown in the trade" instead of a number, or mark it as a doubt.

### Minor
- **M1. Security wording may be outdated.**
  - "Username and password" is offered as a standalone login method, and the 24-hour hold is described as covering "changing passwords, modifying payout wallets ... team member permissions".
  - The owner's 16 Nov login rules (password never alone; TOTP only with a password) are on wip/second-signup-r3-fixes, not landed. p11-26 narrowed what a weak-login hold holds.
  - "Account deletion and payout wallet removals wait for the full hold duration" conflicts with G5 ("removal ... takes effect at once ... permanent after 24 h"). p5-7 later says removals are held too, so this is an owner question. Mention it, don't pick.
- **M2. Hard-to-read or odd lines.**
  - "Fee collection happens upon completion: if both traders do not get paid, X2F does not collect a fee." is confusing.
  - "a lien is applied to recover the funds" is correct per `rulingFee`, but "lien" is jargon in user copy. Design should word it.
  - The tone is often formal ("functions as a facilitator", "bilateral protection", "possesses no power"). Job 16 asks for plain language.
- **M3. The "factual verification" tests do not verify facts.** `helpPages.test.tsx` checks that the rendered text contains the sentences `helpContent.ts` itself holds. Nothing ties them to code constants, so a code change would not turn them red. Either rename the describe block ("copy covers these topics"), or import the real constants where they exist (`CHAT_AFTER_CLOSE_DAYS`, `CHAT_AFTER_DISPUTE_DAYS`, `CHAT_PRETRADE_IDLE_DAYS`, `appealWindowH`, the gift-card list in `fixtures/boards.ts`) and build the text from them.
- **M4.** `data-screen` uses the raw `topic` while the lookup uses the lower-cased `normalized`. `/help/FAQ` renders the FAQ but tags it `help-FAQ`. Use `normalized`.
- **M5. Conflict with agy's own Job 18 branch.** `wip/agy-web-tests` adds `helpTopicScreen.test.tsx`, which asserts the old placeholder bodies ("Answers to common questions are coming here soon." and the others). This branch deletes those bodies, so whichever lands second turns red. Fix one branch to match the other, and say so in both READY lines.
- **M5b. Conflict with wip/lead-owner-ui (lead).** That branch rewrote `HelpTopic.tsx` to 87 lines. It gives each topic a signed-out line, an owner line and a member line, adds links behind the door, and adds the rule that a team member gets no Settings link. This branch rewrote the 34-line demo-r3 version. Main has no `HelpTopic.tsx` yet. Whichever lands second must merge by hand, and the content must keep lead-owner-ui's out/in/member split. Rebase onto the base the lead names for help content before the next READY.
- **M6. COPY-UNSIGNED markers.** There is one marker on `HELP_TOPICS_LIST` and a file-header comment, and copy-lint accepts that. The owner's p5-1 wants every unsigned line listed by screen, so add the 12 topics to agy's copy-list job (wip/agy-copy-list).

### Correct and verified at this base
- Poster pays 1%, takers free, poster-seller funds amount + 1%, poster-buyer receives amount − 1% (`payouts.ts:66-73`). A full reversal charges no fee (g63, `dispute-seller`). The fee waits during an appeal, and a changed appeal after coins moved is a lien (`rulingFee`, `packages/staff/src/dispute.ts:315-328`).
- Chat retention: 30 days after close, 90 days after a dispute, 7 days idle for a pre-trade chat (`packages/trade/src/chat.ts:20-24`).
- Appeal window 48 h (R40). Moderator within 24 h (Q38). Nudge every 15 min. Gift-card list = p5-6 (32 + Other, Razer Gold dropped). G50, G51, G52 and G56 are summarised correctly.
- The recovery code is replaced after use (`apps/api/src/auth/recovery.ts:10,58`). Proof photos are re-encoded so EXIF/GPS is dropped (`apps/web/src/proof/reencode.ts`).
- Links: /login and /session-length already link FAQ, Getting started, Support and Settings (`ui/HelpLinks.tsx`). The new topics are reachable through the in-page nav.

## Checks run at 5b15fd80 (under the shared lock)
Queued behind other helpers on the shared lock when this was written: typecheck, copy-lint, separation-check, the full vitest suite (Docker up), semgrep, audit and full Playwright web. The verdict does not depend on them, because B1-B4 are content findings. The results will be added to this file as an addendum, and agy should not wait for them.

Counts: 4 blocking, 7 minor.
