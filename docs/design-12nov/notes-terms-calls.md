# Owner demo notes, Terms review and small calls (12 Nov 2026)

Design (worker T5, "notes"). Wording and calls only, no boards. Every new or changed string is **COPY-UNSIGNED** for the owner. Design's answers count as signed (owner ruling 10 Nov). Code refs are `origin/main` 8246e64b unless a branch is named.

Other workers own these topics, and this file points to them instead of redesigning:
- **front**: landing, welcome, logo, spacing and type.
- **tour-stops**: the tours.
- **wallet**: the wallet step and connection.
- **backlog**: the backlog boards.

Rules used throughout:
- Labels have no colon.
- No email anywhere. Contact is Matrix or Telegram, and alerts go by Jabber.
- Dates are UTC.
- Results say "the buyer" or "the seller", never a name.

## Top table

| item | final answer | owner? |
|---|---|---|
| 48 demo comments | Every comment has an answer in §1. 42 are settled here or pointed to a worker. 3 Terms comments (11, 12, 15) wait on owner questions OQ1 to OQ3. 3 have no copy to write: 17 (his standing instruction), 31 (answered by the wallet research) and 40 (an engineering task). | 3 (via OQ1-3) |
| Terms §2-§9 (16 paragraphs) | Settled wording below (§2). Q-1 to Q-11, Q-14, Q-16 and Q-K are settled by design. | 3 |
| OQ1 Terms: closing "without reason" | Recommend: "without warning. We always show a general reason, but we may not give the details." | **yes** |
| OQ2 Terms: is the training copy deleted at day 90? | Recommend: yes, everything is gone at day 90. | **yes** |
| OQ3 Terms: "all data is purged" | Recommend: say "the trade, chat included", and say plainly that reviews and totals stay. | **yes** |
| PC3 blur-check hint | Label `What was wrong?` · hint `Please help us improve. Say what was missed, like a name still showing. Don't type the hidden details themselves.` | no |
| N1 automated proof check | Attribute it to the sender's app: `The buyer's app found that the trade code is covered in this proof.` | no |
| O-040 Notifications link | An owner-only nav item in the staff rail, second after Overview, with an unread badge. Plus an "N new notifications" row on Overview. | no |
| O-040 per-kind titles | 16 titles (§3.3), plus a fallback. | no |
| S-026 contact line | `Please be patient. If you need us, message us on Matrix or Telegram and we'll reply there. While the hold is on, we won't contact you any other way, except on the secure Jabber account you set up before the hold.` | no |
| M2 uncertain proof send | `We're not sure your proof was sent. Check the chat before you send it again.` · button `Check the chat` | no |
| D-005 tab bar on My trades | Yes. `/trades` shows the tab bar with My trades current. A single trade (`/trade/:code`) does not. | no |
| Teams strings | §3.7 | no |
| Appeals strings | §3.8 | no |
| Sync banner | `Updating…` · `Couldn't get the latest just now. This page may be out of date.` · `Try again` | no |
| Bans: 4 reasons and the trade-ban popup | The reasons stay as settled in w11-102. The popup is reworded (§3.10). | no |

---

## 1. The owner's 48 comments: design's answer for each

The numbers follow `owner-notes-triage-2026-11-12.md`. **READY** means the copy or instruction below is final. **→ worker** means that worker draws or owns it. The copy given here still applies there.

### 1.1 /setup Terms (1-16)

| # | His comment (short) | Design's answer |
|---|---|---|
| 1 | Public display name | READY. Terms §2 ¶2 (T1 below). Private *username* and public *display name*, matching the built screens. |
| 2 | Leave room for team members | READY. T2. |
| 3 | Are these multisig "methods or features"? | Answer for him: these are **features of the one method we already use**, 2-of-3 Monero multisig escrow. X2F has all three: non-custodial (X2F holds 1 key of 3, and the wallets run in his browser), peer to peer, and Monero's on-chain privacy. The named products are other sites and never appear in our Terms. Terms gain one sentence (T3). READY. |
| 4 | Buyer pays with the requested method, posts proof … "disrupted" | READY. T4 ("disputed"). |
| 5 | A screenshot is proof, not a guarantee | READY. T5. |
| 6 | Timers per payment method; the seller may cancel | READY. T6. |
| 7 | 1% fee, paid by whoever posts the ad | READY. T7. |
| 8 | Disputes during the trade and for a short time after | READY. T8. |
| 9 | The moderator decrypts the chat; staff actions are logged | READY. T9. |
| 10 | Appeal to a senior moderator, final | READY. T10. |
| 11 | 30 days, then all data purged; disputes 90 days, scrubbed, training | T11 and T12 are READY except two points: **OQ2** and **OQ3**. |
| 12 | Make sure the existing retention line carries his comment 11 | Same as 11: T12, pending **OQ2** and **OQ3**. |
| 13 | Add AML/CFT | READY. T13. |
| 14 | Never trade or chat outside X2F | READY. T14. |
| 15 | Close any account "without warning and without reason" | **OQ1**. T15 is READY apart from that clause. |
| 16 | A new platform; rules evolve; leave feedback | READY. T16. |

### 1.2 Signup screens (17-37)

| # | Screen | Design's answer |
|---|---|---|
| 17 | /setup | His standing instruction: his comments are recommendations, and questions go to him only when needed. Noted. No change on screen. |
| 18 | /setup/name | READY. The body becomes `You type this to log in. Only you see it, and nobody can work it out from your display name. X2F never asks for your real name, email or phone number.` This replaces "Nothing else to give us, now or ever", which later screens contradict (a key, a wallet). The new line keeps the true promise: no identity details. |
| 19 | /setup/name | READY. Heading `Pick a unique username`. |
| 20 | /setup/login | READY. PGP key and Security key each carry two chips: `Recommended` (accent) and `Strong` (green, `--x2f-success` tokens). The chips sit on the row's title line, after the name, with an 8 px gap. Board: SetupLogin. |
| 21 | /setup/login | READY. Passkey carries the chip `Medium` (caution tone). This label rates how hard a login is to steal. It does not change the hold rules, where a passkey still counts as strong (w10-91). |
| 22 | /setup/login | READY. A new row, **Authenticator app**: chip `Medium` (caution). Description `Log in with a 6-digit code from an authenticator app on your phone, such as Aegis on Android or 2FAS on iPhone. The code changes every 30 seconds.` Button `Continue with authenticator app`. The row order is best to worst: PGP key, Security key, Passkey, Authenticator app, Password. Note for the lead: register note S-015 said the authenticator can't be a signup method today. The owner has now asked for it, so it is built as one. |
| 23 | /setup/login | READY. Password carries the chip `Weak` (danger tone). |
| 24 | /setup/login | READY. Password description: `Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol.`, then on a new line in caution tone: `It is strongly recommended you do not choose this as the only security method you use.` (his words, kept). |
| 25 | /setup/login | READY. Append to the "New to PGP?" explainer: `On Android, PGP alone is a strong choice: OpenKeychain is free and works well.` |
| 26 | /setup/pgp-key | READY (layout) → **front** draws it on SetupPgpKey. Instruction: the public-key box is full content width (screen minus the 16 px gutters), at least 14 rows tall (about 300 px on a 443x794 phone), mono 13 px, resizing vertically. It grows to fit a pasted key up to 24 rows, then scrolls. |
| 27 | /setup/backup | READY. The method list becomes multi-select checkboxes, as the brief says. Heading `Choose how you'll log in`. Sub `Pick one or more. We'll set up each one in turn, then make your recovery code.` Each method step shows `Method 2 of 3 · Security key` above its title. The primary button reads `Set up 3 methods` (or `Set up PGP key` for one) and is disabled at 0 picks. If only Password is ticked, the weak-login confirm sheet shows (SignupSecurity). Board: SetupLogin, updated by the builder. A board change, if needed, goes to **front**. |
| 28 | /setup/backup | READY (copy). Always singular. Title `Save your recovery code`. Body `X2F has no email address or phone number for you. If you lose your login methods, this code is your one emergency way back in.` Below the code: `Write it on paper and keep it away from your phone and your PGP key. It works once. After setup, you won't see it again.` The code shows in 4-character groups with dashes. When typed or pasted, dashes are added for you. Length and storage ("a fortress", matched only on use): **lead** (security design), not copy. |
| 29 | /setup/backup | READY (copy). Screen A: tick `I've written it down` (kept), then button `Next`, disabled until ticked. Screen B: title `Type your recovery code`, body `Type it from what you wrote down, not from memory. Dashes are added for you.`, label `Recovery code`. The box border is danger while the text doesn't match and turns success when it matches. Live line, red: `Not a match yet. Keep typing, or go back and check what you wrote.` Live line, green: `That's it. Your code is saved.` Then `Next`, enabled only when green. A text button `Back to my code` returns to screen A with **the same code**. |
| 30 | /setup/backup | Same as 27: the recovery code comes after every chosen method. READY. |
| 31 | /setup/wallet | Answer for him (wallet research): no Monero wallet offers a WalletConnect- or MetaMask-style connection. WalletConnect is for other chains, and its relay would see users' IPs and addresses. What works everywhere is the standard `monero:` link and QR. → **wallet**. |
| 32 | /setup/wallet | → **wallet**. It draws the "Scan your wallet's Receive QR or paste" step and the plain, non-button `Suggested wallets` line. |
| 33 | /setup/welcome | READY. `Your account is ready. Trade Monero for cash, bank transfers, gift cards or whatever payment method you choose, with every trade protected by escrow.` On a new line: `Missing a payment method? Leave feedback and we'll add it as quickly as we can. Include what detail you can, or a link with information about it.` The words `Leave feedback` link to `/feedback?from=welcome`. This is his wording, tightened. The brief's version is fine too, but this one is shorter. |
| 34 | /setup/welcome | → **front** (SetupWelcome checklist board). The copy: (1) `Configured your secure ways to log in to X2F`, with the chosen methods listed best to worst and **one** big tick for the group; (2) `Emergency login: recovery code written down`, tick; (3) `Connected your wallet`, with the method chosen (`Address scanned from QR` / `Address pasted`), tick. |
| 35 | /setup/welcome | → **front** (bigger type). The copy is READY: `You can change anything above later in Settings. Next, you'll log in for the first time and try the login methods you just set up. Then we'll welcome you to X2F.` |
| 36 | /setup/welcome | READY. `Remember, you only pay a fee if you post an ad. Taking an ad and starting a trade is always free.` ("Clicking on" becomes "Taking", the app's verb, w10-63.) |
| 37 | /setup/welcome | → **front** (looks, plus the logo top-left with the screen name). |

### 1.3 Login, session, browse (38-48)

| # | Screen | Design's answer |
|---|---|---|
| 38 | /login | → **front**: move the content down, the logo at top-left, and Landing as the first screen on x2fapp.com. |
| 39 | /login | READY (layout) → **front** (Login board). The PGP key box is as in #26: full width and at least 14 rows. |
| 40 | /setup/pgp-code | Engineering: sign the login message with an official X2F PGP key (lead/ops). Copy, READY: under the message, `This message is signed by X2F's login key. If your PGP app says "unknown signer", import our key once.`, a link `Get X2F's key`, and the fingerprint in mono in 4-character groups. The owner already said he wants this, so it is not a question for him. |
| 41 | /setup/pgp-code | The code length is for the **lead** to decide (security against usability). Copy, READY: label `Login code`, hint `Paste the whole code. Dashes are added for you.` It shows in 4-character groups. |
| 42 | /session-length | → **front** (move down; fill the space with FAQ, Getting started, Support and Settings links). |
| 43 | /session-length | → **front** (type scale). |
| 44 | /session-length | READY. `Longer sessions so you don't miss a trade while you sleep. Turn on the loud alarm so a new trade or a nudge wakes you.` Why it isn't his exact words: in the app, "Nudges" already means the other trader nudging you (Loud alarm, "Ring for · Nudges"). Calling the alarm itself "Nudges" would give two things one name. The line keeps his idea and names both. `the loud alarm` links to Settings, Alerts. |
| 45 | /session-length | READY. `When this time is up, we'll ask you to confirm it's you. If you can't confirm it then, you'll be logged out to keep your account safe.` |
| 46 | /session-length | READY. `You can change this any time in Settings, under Devices and sessions.` The words `Devices and sessions` are the link. This replaces the bare link. |
| 47 | /sell | → **front** (Landing: "Welcome to" on the diagonal, the big logo, `Take the tour` / `Skip and get started`) and → **tour-stops** (the guided tour). |
| 48 | /buy | → **front** (a little more space). His "Good job" on the payment-method drop-down: kept as is. |

---

## 2. Terms (`terms-draft-2026-11-12.md`)

Design accepts the draft's proposals with the plain-language edits below. Each T-item is final (READY) unless it says OQ. When this ships, `TERMS_TEXT_VERSION` and `X2F_TERMS_VERSION` change together, and everyone signs again at their next login.

**T1 · §2 ¶2:**
> You pick a private username, which you type to log in and only you see, and a public display name, which is how other traders see you. Keep your login methods and your recovery code safe. X2F has no way to reset them for you, so if you lose them you may lose the account and its reputation. Your coins stay safe in your own wallet either way.

("any backup" becomes "your recovery code", because there is exactly one.)

**T2 · §2 ¶3:**
> One person, one account. If you want others to help you trade, add them as team members: each one gets their own login. Do not sell, share or lend your account or your login.

**T3 · §3 ¶1 (Q-1, yes):**
> Your coins stay in your own wallet, except while they are locked in a trade's 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on its own. Escrow payments are ordinary Monero transactions, so outsiders can't see the amounts or addresses on the blockchain.

("stay hidden" becomes "outsiders can't see", which is narrower. Lawyer check.)

**T4 · §3 ¶3 (Q-2 optional proof; Q-3; Q-4):**
> Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays exactly as the trade says, with the payment method that was asked for, posts proof of payment where they can, and marks the trade paid once the payment is complete. The seller checks that the payment has arrived and releases the XMR, which goes straight to the buyer's own wallet. A release can't be undone on the blockchain, but it can still be disputed.

("can't be undone on the blockchain" settles Q-4: a dispute after release leads to a lien, not a reversal.)

**T5 · §3 ¶4:**
> A screenshot counts as proof, but it is not a guarantee: anything can be edited these days. Always check that the payment has arrived in your own account before you release the escrow.

**T6 · §3 ¶5 (Q-5 the example only; Q-6 "starts at once"; Q-7 yes):**
> Each trade has timers, set by the payment method. For example, if a payment method is usually instant but can take up to 2 hours, the buyer gets 2 hours to pay and mark the trade paid. If that time is up and the buyer hasn't marked it paid, the seller can cancel the trade, and the escrowed XMR starts going back to the seller's wallet at once. If you paid late and the seller cancels, open a dispute and a moderator will help. The trade screen always shows the time left.

**T7 · §4 ¶1:**
> X2F's fee is 1% of the XMR traded, taken when the trade completes. Whoever posts the ad pays it: if you post an ad to sell XMR, you pay 1% of the XMR you sell; if you post an ad to buy XMR, you pay 1% of the XMR you buy. Taking someone else's ad is free. If a moderator fully reverses a trade, there is no fee.

("Very simple." is dropped. The paragraph shows that on its own.)

**T8 · §5 ¶1 (Q-8: no length in the Terms; the length is already with the owner as p11-51):**
> If something doesn't go as planned, or you and the other trader disagree and can't sort it out yourselves, either of you can open a dispute, both during the trade and for a short time after it completes. The trade screen shows how long you have. A moderator then reads the trade and its chat, asks for evidence and decides the outcome.

**T9 · §5 ¶2 (Q-9 yes; Q-10 money-only):**
> Chats are encrypted. If a dispute is opened, the moderator assigned to it can decrypt the trade's chat and see the whole conversation and the record of the trade. If the decision is appealed, the senior moderator or X2F's owner who reviews it can see the same. We log every action our moderators take, so we can check our own staff and make sure of the best outcome for everyone. A moderator's goal is to see the trade completed. If that isn't possible, the next best outcome is a full reversal: the XMR and the payment go back as if the trade never happened.

(The added "the XMR and the payment" keeps "as if it never happened" about money, so it doesn't promise that records are erased. Lawyer check.)

**T10 · §5 ¶3 (Q-11: matches settled w11-86):**
> If you aren't happy with the moderator's decision, you can appeal it once, within the time shown with the decision. A senior moderator or X2F's owner who had no part in the first decision then reviews everything and makes a final, binding decision.

**T11 · §6 ¶1:** the draft is kept as is.
> X2F keeps only what a trade needs, and deletes it after a set time (below). X2F does not track you, does not use analytics and removes location and device details from uploads.

**T12 · §6 ¶3.** The wording depends on OQ2 and OQ3. With design's recommendations:
> X2F keeps a completed trade, chat included, for 30 days after it ends so it can be reviewed, then erases it for good. A disputed trade is kept for 90 days after the dispute closes. During that time our privacy tool removes personal and confidential details from it, and the cleaned copy is used to train our moderators. At day 90 the trade and the cleaned copy are erased for good. Your reviews and trade totals stay on your profile, because they are your reputation.

**T13 · §8 ¶1 (Q-14):**
> Do not use X2F for money from crime, to hide where money came from, to break anti-money-laundering or counter-terrorist-financing (AML/CFT) laws, or to break any other law where you live. That's not what X2F was built for. You are responsible for following the laws that apply to you.

(The last sentence makes it clear that X2F does not screen users. Lawyer check.)

**T14 · §8 ¶2:**
> Do not cheat, threaten or mislead other traders, and never ask them to trade or chat outside X2F. If you do, you lose all the protections X2F offers.

**T15 · §8 ¶4.** The middle clause is **OQ1**. With design's recommendation:
> X2F may pause or close any account at its own discretion, without warning. We always show a general reason, but we may not give the details. If we believe an account is a threat to the site or to our users, we will act to protect them and ourselves. We do not take our users' security lightly. Coins in escrow are then settled by a moderator under the dispute rules.

**T16 · §9 ¶2 (Q-16: the channel is the Feedback page):**
> X2F is a new platform, and we change it based on your feedback. Any rule can be reconsidered and changed for the good of the site and our users, so please tell us what you think on X2F's Feedback page and help shape it. When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version.

**Q-K, the key points above the box:**
- "Completed trades are erased on day 30" still holds.
- "Moderators can read your trade chat only if a dispute is opened" still holds.
- "1% fee when the trade completes" still holds.
- "Disputed trades are kept up to 90 days" still holds under design's OQ2 answer. If OQ2 goes the other way (B), add `A cleaned copy, with no personal details, is kept to train moderators.`

### Owner questions (only these three)

**OQ1 · Closing an account "without reason" (Terms §8, his comment 15).**
Your wording says X2F may close any account "without warning and without reason". But the ban screen you approved (G39) always shows a general reason, such as "Problems in trades", and invites the person to ask a moderator. Which should the Terms say?
- A. "without warning and without giving a reason" (your words).
- B. "without warning. We always show a general reason, but we may not give the details."
- C. "with a warning and a reason, except where safety needs us to act at once".

Design recommends **B**. It matches what the app already shows, it keeps your freedom to act at once, and the lawyer can defend it more easily.

**OQ2 · The moderator-training copy at day 90 (Terms §6, his comment 11).**
A disputed trade is cleaned of personal details and used to train moderators. At day 90, is that cleaned copy deleted too, or kept for training?
- A. Deleted at day 90 with everything else. The Training library holds a case for at most 90 days.
- B. Kept, cleaned, for training after day 90, and the Terms say so.

Design recommends **A**. It is what "At the 90 day mark they are completely purged" says, and it is the simpler promise.

**OQ3 · "All data is purged" at day 30 (Terms §6, his comment 11).**
At day 30 the trade and its chat are erased. Two things outlive that by your own rulings: your reviews and trade totals (your reputation), and the account itself, until 60 days without a login. Should the Terms say "all data", or name what is erased and what stays?
- A. "All data is purged" (your words).
- B. "the trade, chat included, is erased for good", plus `Your reviews and trade totals stay on your profile, because they are your reputation.`

Design recommends **B**. "All data" would promise more than X2F does.

---

## 3. Small calls

### 3.1 PC3, the blur-check comment box (`wip/lead-proof-check` `apps/web/src/screens/proof/BlurCheck.tsx`). READY

- Question, kept: `Did our privacy tool hide the right details on this proof?`
- The label loses its colon (labels have no colon). It becomes `What was wrong?`, and the plea moves into the hint.
- Hint under the box, muted, 14 px: `Please help us improve. Say what was missed, like a name still showing. Don't type the hidden details themselves.`
- Below that, right-aligned, mono: a counter `0 / 500`.
- Kept: `Yes`, `No`, `Send`, `Thanks, this helps us improve.`

Why this hint and not the brief's example: the real risk in this box is people retyping the very detail that wasn't blurred. "Don't include your trade code or payment details" covers only part of that.

### 3.2 N1, the automated proof-check notice (`wip/lead-proof-code` `apps/web/src/chat/notices.ts`). READY

The notice is sealed by the sender's own app, and any trader can send the fixed words. So it must never read as X2F speaking. Each reader shows its own copy, picked by who sent it.

- To the other side: `The buyer's app found that the trade code is covered in this proof.` (or `The seller's app …` when the seller sent it).
- To the sender: `Your app found that the trade code is covered in this proof.`

Layout: the notice sits in the sender's message group (their side and alignment), in muted text with no bubble fill and a 16 px `info` icon. There is no X2F or moderator tag. The wire text stays `proof-code-hidden`. The tests change from `^Automated proof check: ` to these three strings.

### 3.3 O-040, the owner's Notifications page (`wip/lead-owner-alerts` `apps/staff-web`). READY

**Where the link sits.** It moves out of the rail foot and becomes a nav item.
- Owner only. Other roles never see it.
- Placed second, after `Overview`, with label `Notifications`.
- An unread badge sits right-aligned in the row: a danger-tone pill, 20 px tall, mono count, showing `99+` past 99, with aria-label `3 unread`. There is no badge at 0.
- It gets the same `aria-current` selected style as the other items.
- Overview gets one row at the top when unread > 0: `3 new notifications` with a chevron, opening /notifications.
- The rail foot keeps only the user chip.

**Titles per kind.** The kinds are from `origin/main` `apps/api/src/alerts.ts`. The owner-only kinds come first, then the owner's own account kinds. Titles reuse the trader words from `Alerts.tsx` `KIND_WORDS` where the kind is shared. Each line under a title is the row's message. The server messages on main use a colon, so they are reworded here.

| kind | title | line under it (from detail) |
|---|---|---|
| `price-source-failing` | `A price source has a problem` | `Kraken's XMR price isn't working, so X2F is using the backup.` / `ECB's EUR, GBP rates are more than 5% off, so X2F is using the backup.` |
| `price-source-recovered` | `A price source is working again` | `Kraken's XMR price is working again.` |
| `market-prices-paused` | `Market prices are paused` | `No working price for EUR, GBP right now. Offers priced at market in them can't be taken until a price is back.` (all currencies: `No working price in any currency right now. …`) |
| `market-prices-resumed` | `Market prices are back` | `EUR, GBP prices are working again.` |
| `auto-close-capped` | `Closing inactive accounts stopped at its limit` | `200 inactive accounts were closed this run, the most allowed, so automatic closing is now off. Check nothing is wrong, then turn it back on.` |
| `dispute-refund-after-ruling` | `A refund arrived after a ruling` | `Trade K7M2-9QXA: the seller's cancel refund landed after the dispute was ruled. The case needs a new ruling.` |
| `fee-sweep-due` | `Moving fees to your cold wallet` | `The fee wallet reached your limit. 4.2 XMR above it is moving to your cold wallet.` |
| `fee-sweep-failed` | `Fee wallet sweep didn't go through` | `Nothing moved. Check the fee wallet settings, then try again.` |
| `staff-security-reset` | `A staff member's security was reset` | `elena.t's login methods were removed. They need the reset link to log in again.` |
| `staff-security-reset-finished` | `A staff member set up their login again` | `elena.t used their reset link.` |
| `new-login` | `New login` | (as on the trader side) |
| `login-method-added` | `A login method was added` | |
| `login-method-removed` | `A login method was removed` | |
| `sessions-ended` | `Other devices were logged out` | |
| `hold-started` / `hold-ended` | `A 24-hour hold started` / `The 24-hour hold ended` | (only if the owner account can be held; same words as traders) |
| any other or unknown | `Something needs your attention` | (the same words as the phone push) |

The branch's table is missing `staff-security-reset` and `staff-security-reset-finished`, which are on main. Add them. Other strings:
- Empty state: `No notifications yet` / `Price, fee wallet, staff and account notices appear here.`
- Buttons, kept: `Mark as read`, `Mark all as read`, `Show older`.
- Unread tag: `New` (a chip, not " · New").
- Load errors, kept.

### 3.4 S-026, the hold contact line (`wip/lead-s026-d056` `cantDoCodes.ts:498`). READY

The old line "X2F will contact you only on Matrix, Telegram…" reads as if X2F knows the user's handles. This also supersedes line 3 of S-025 in `settled-register-calls.md`, which has the same flaw.

> `Please be patient. If you need us, message us on Matrix or Telegram and we'll reply there. While the hold is on, we won't contact you any other way, except on the secure Jabber account you set up before the hold.`

The line says the user starts the contact and X2F replies. The second sentence keeps the anti-phishing point.

### 3.5 M2, a proof send with an unknown outcome (`AddProof.tsx` `PROOF_SEND_FAILED`). READY

- Unknown outcome (the connection dropped after the server may have stored it): `We're not sure your proof was sent. Check the chat before you send it again.` with the primary button `Check the chat`, which scrolls to the latest message. The editor keeps the same blurred image, so a resend sends the same copy.
- A certain failure (the server said no, or nothing left the device) keeps `Couldn't send your proof. Check your connection and try again.`

### 3.6 D-005, the tab bar on My trades. READY: yes

- `/trades` is a tab destination, so it shows the phone tab bar with `My trades` current, like Trade and Profile.
- A single trade (`/trade/:code`) keeps no tab bar. It has its own back arrow to `/trades`.
- The same rule applies to `/wallets`, which is also a tab destination: it shows the bar with `Wallets` current. That is **wallet**'s board to confirm.
- `/post` keeps no bar, because it is a form with Close.
- The MyTrades board already draws the bar, so the code just follows it.

### 3.7 Teams (`apps/web/src/screens/settings/teamCopy.ts`). READY

| key | final |
|---|---|
| `nameLabel` | `Their name on your team` (kept) |
| `nameHint` | `Only you and your team see it. Trade chats show their messages as "Circa55 Assistant 2".` The lead's live display name and the next free number are filled in. This extends w12-45. |
| `chatLabel` (member row) | `Shown in chats as Circa55 Assistant 1` (no colon) |
| `noBoxes` (member row chip) | `No roles yet`, plus the line under it: `Their roles start when your waiting changes apply.` |
| `JOIN_COPY.invited`, no roles | `You are invited to a team as desk_lee. The team lead hasn't set what you can do yet. It starts once their change applies, within 24 hours. You can join now.` |

The "within 24 hours" in the join line assumes an invite from a username-and-password login waits out the hold (S-104). If the lead cancels the change, the member sees `No roles yet` on their own Team view. No other copy is needed.

### 3.8 Appeals (`wip/lead-appeals`). READY

- Trade page, below the trade's own screen: `Don't agree with the moderator's decision? You can appeal until 8 Nov 2026, 14:05 UTC.` (kept). Button `File appeal` (kept), secondary, full width on phone. The completed-trades row (MyTrades) uses the same two lines.
- Waiting line, for the person who appealed: `Your appeal is waiting for a senior moderator who hasn't seen this case. You'll get an alert when it's decided.`
- Waiting line, for the other side: `The other trader appealed. It's waiting for a senior moderator who hasn't seen this case. You'll get an alert when it's decided.`

"Independent reviewer" becomes the plain description that w11-86 and Appeal-Notice already use. The owner may also decide an appeal (w11-86), but while it waits no one is assigned, so "a senior moderator" is enough.

### 3.9 Sync before acting (`wip/lead-sync-first` `SYNC_COPY`). READY

- `updating`: `Updating…` (kept). It shows in the top banner slot, info tone, with a 16 px spinner. Buttons that change a trade or offer are disabled while it shows.
- `stale`: `Couldn't get the latest just now. This page may be out of date.` (caution tone).
- `retry`: `Try again` (text button in the banner).

### 3.10 Bans (`wip/lead-bans` `cantDoCodes.ts`). READY

**The four general reasons.** These are already settled (w11-102, kept) and are the same words for staff and traders: `Breaking the Terms of Service` · `Problems in trades` · `Abuse of other traders` · `Account security`.

**The trade-ban popup** (CantDoThat, on take or post). The title matches D-020's headline: `You can't trade right now`. Body:
- With an end: `A moderator banned your account from trading until 14 Nov 2026, 14:05 UTC, for problems in trades. Trades you already started carry on.`
- Permanent: `A moderator banned your account from trading until they lift it, for problems in trades. Trades you already started carry on.`
- No data from the API: `A moderator banned your account from trading for now. Trades you already started carry on.`

Inside the sentence the reason is lower-cased ("for breaking the Terms of Service", "for abuse of other traders", "for account security"). This drops the "Reason:" colon.

Link `See what to do`, which goes to `/account/banned`, the same pattern as the freeze notice. `OK` stays the one button.

The D-020 ban notice itself is already settled (`settled-register-calls.md` D-020). The lead's build should swap its owner-draft `BAN_NOTICE_LEAD` and "fully working again" line for the D-020 words.
