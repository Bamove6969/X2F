# Owner Demo Notes Audit — Status (16 Nov 2026, Job 15 `wip/agy-notes-finish`)

Audit of all **91 owner demo notes** (`owner-demo-notes-2026-11-12.jsonl`: 48 notes; `owner-demo-notes-2026-11-13.jsonl`: 43 notes) against `origin/wip/third-demo-r3` (`94337781`). Work that exists only on an unmerged branch is marked COVERED, PENDING with that branch and its review state.

## Summary Counts (against `wip/third-demo-r3` 94337781)

| Source file | Total | DONE | COVERED, PENDING | PARTLY | NOT DONE | OWNER-QUESTION | ANSWERED / STANDING RULE |
|---|---:|---:|---:|---:|---:|---:|---:|
| `owner-demo-notes-2026-11-12.jsonl` | 48 | 41 | 4 | 0 | 1 | 0 | 2 |
| `owner-demo-notes-2026-11-13.jsonl` | 43 | 38 | 1 | 1 | 0 | 3 | 0 |
| **Total** | **91** | **79** | **5** | **1** | **1** | **3** | **2** |

- **COVERED, PENDING** (work exists only on an unmerged agy branch): 12 Nov #26, #37, #48 and 13 Nov #32 on `wip/agy-layout`@110ec56e (review CHANGES NEEDED); 12 Nov #47 on `wip/agy-landing`@a1015461 (APPROVE WITH MINORS; merge needs a lead/owner yes on R1-R3).
- **PARTLY**: 13 Nov #34 (placeholder key art on claude2's screen; artwork is design's).
- **NOT DONE**: 12 Nov #32 (wallet list; Job 27, not built yet).
- **OWNER-QUESTION**: 13 Nov #21 (capital "Terms", Q11 in review-third-demo-r3-and-terms-r3b); 13 Nov #24 and #29 (authenticator app without a password, Q1 in review-third-signup-r3; the owner ruled 16 Nov 17:38, being built on `wip/second-signup-r3-fixes`).
- **ANSWERED / STANDING RULE**: 12 Nov #31 (answered by the owner 16 Nov #7; Job 27); 12 Nov #17 (the owner's standing rule, no question).

---

## Which notes had no UI-only work left for agy (Job 15)

Job 15 built no app code; the remaining notes are held elsewhere:
- **12 Nov #43** (bigger fonts): claude2's fonts work (`wip/second-fonts`), already on the base.
- **13 Nov #24, #29** (authenticator app without a password): login security, not agy's.
- **13 Nov #34** (security key art): claude2's screen, design's artwork.
- **12 Nov #31, #32** (wallet list): Job 27.
- **12 Nov #26, #37, #48, 13 Nov #32**: Job 3 (`wip/agy-layout`), pending its review fixes.
- **12 Nov #47**: Job 2 (`wip/agy-landing`), pending a lead/owner yes on R1-R3.

---

## Part 1: `owner-demo-notes-2026-11-12.jsonl` (48 Notes)

1. **`9fe3fa43`** (`/setup`, `setup-terms`, `section:nth-of-type(2) > p:nth-of-type(2)`) — *"Public display name"*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:76` names both `"a private username, which you type to log in and only you see, and a public display name, which is how other traders see you"`.

2. **`4e04a245`** (`/setup`, `setup-terms`, `section:nth-of-type(2) > p:nth-of-type(3)`) — *"I don't want them to think they can't have team members so maybe some wording except if you choose to setup additional team members."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:78` adds `"If you want others to help you trade, set them up as team members of your account: each team member gets their own login."`

3. **`e79231ba`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(1)`) — *"Are these different methods or are they features: Key Characteristics & Implementations • Non-Custodial Design... • Peer-to-Peer Trading... • Privacy Preserved..."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:85` adds `"Escrow payments are ordinary Monero transactions, so amounts and addresses stay hidden on the blockchain."` (explained in `origin/comms:terms-draft-2026-11-12.md:69-80`).

4. **`ca2b6a83`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(3)`) — *"Exactly with the method that was requested, posts proof, and marks it paid upon completion. The seller confirms receipt of chosen payment method and releases XMR which are immediately transferred to buyers external wallet. A release cannot be undone but can be disrupted."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:91` applies this wording in Section 3 paragraph 3 (and merges 13 Nov #7 `a4288e0b`).

5. **`aaf06c2f`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(4)`) — *"A screenshot is considered proof but not a guarantee, anything can be photoshopped these days. Always check to make sure payment has arrived before you release the escrow."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:93` (`"A screenshot counts as proof, but it is not a guarantee: anything can be edited these days. Always check that the payment has arrived in your own account before you release the escrow."`).

6. **`7a830826`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(5)`) — *"and these timers are based on the individual payment method chosen. So if a payment method selected is typically instant but can take up to 2 hours to complete..."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:99-107` applies the 2-hour payment-method timer example and cancellation wording (further updated by 13 Nov #8–#10).

7. **`10475770`** (`/setup`, `setup-terms`, `section:nth-of-type(4) > p:nth-of-type(1)`) — *"X2F collects a 1% fee of the total amount traded in XMR. If you are a seller posting an ad you pay a 1% fee of the total amount of the XMR you sell in the trade. Vice versa, if you are a buyer posting an ad to buy XMR you will pay a 1% fee off the total amount traded. Very simple."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:115` applies the 1% seller/buyer ad-poster fee wording and `"Very simple."` (further updated by 13 Nov #11–#12).

8. **`d1c8cb70`** (`/setup`, `setup-terms`, `section:nth-of-type(5) > p:nth-of-type(1)`) — *"If something doesn't go as planned or during a disagreement between parties that cannot be resolved on your own a dispute may be started both during the trade and for a short period even after the trade completes."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:123` applies this wording in Section 5 paragraph 1.

9. **`9cdeeb48`** (`/setup`, `setup-terms`, `section:nth-of-type(5) > p:nth-of-type(2)`) — *"The moderator that the chat is assigned to can decrypt the chat and have full access to all conversations and logs of what has transpired. We also log all actions of our moderators..."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:126` applies the moderator decryption, action logging/auditing, and trade-completion/full-reversal goal (further updated by 13 Nov #13–#15).

10. **`358d1d75`** (`/setup`, `setup-terms`, `section:nth-of-type(5) > p:nth-of-type(3)`) — *"If you are not satisfied with the outcome of our moderator you can speak the decision within the timeframe stated and then a senior moderator will intervene and review all information and make a final, binding decision."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:126,129` applies the senior-moderator final binding appeal wording (updated per 13 Nov #13 `7db61414` and #16 `433a045c`).

11. **`d1a46566`** (`/setup`, `setup-terms`, `section:nth-of-type(6) > p:nth-of-type(1)`) — *"X2F keeps trades available for review for 30 days and then all data is purged. Disputes trades are kept for 90 days, scrubbed of personal and confidential information with our internal privacy tool, and then used for training moderators. At the 90 day mark they are completely purged. Keep the part after this about \"X2F does not track.....\""*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:137` applies the 30/90-day retention and moderator-training scrubbing copy and keeps the `"X2F does not track you..."` sentence (refined by 13 Nov #17–#19).

12. **`9a1b5c46`** (`/setup`, `setup-terms`, `section:nth-of-type(6) > p:nth-of-type(3)`) — *"I didn't see this before I wrote my previous comment so just make sure it includes a variation of what I was saying and I'm happy."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:135-139` consolidates the retention wording into Section 6 paragraph 1 per 13 Nov #17–#19.

13. **`32b26d90`** (`/setup`, `setup-terms`, `section:nth-of-type(8) > p:nth-of-type(1)`) — *"Or to violate AML/CFT laws. That's not what the site was designed for."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:152` adds `"to break anti-money-laundering or counter-terrorist-financing (AML/CFT) laws, or to break the law where you live. That’s not what X2F was built for."`

14. **`f9de831e`** (`/setup`, `setup-terms`, `section:nth-of-type(8) > p:nth-of-type(2)`) — *"And never ask them to trade or chat outside of X2F - doing so loses you all protections the site offers."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:154` (`"Do not cheat, threaten or mislead other traders, and never ask them to trade or chat outside X2F. Doing so loses you all the protections X2F offers."`).

15. **`e5caa606`** (`/setup`, `setup-terms`, `section:nth-of-type(8) > p:nth-of-type(4)`) — *"...any account at our own discretion without warning and without reason. If we feel and account is a threat to the site or to our users we will take actions to protect them and ourselves. We do not take the security of our users lightly."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:158` applies this in Section 8 paragraph 4 (with lead interim wording `"without warning and without always giving a reason"`, `termsText.ts:156-157`).

16. **`4f01cb96`** (`/setup`, `setup-terms`, `section:nth-of-type(9) > p:nth-of-type(2)`) — *"Remember, this is a new platform so we are evolving based on feedback and no rule is permanent and without consideration for change for the betterment of the site and our users. We strongly recommend and ask that you leave feedback and help shape this platform."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:167` applies this in Section 9 paragraph 2.

17. **`26d861d0`** (`/setup`, `setup-terms`, `#terms-sign-help`) — *"All comments I leave are recommendations to be discussed amongst lead and designer and if needed to come to me with questions"*
    - **STANDING RULE (no question)** — The owner's standing rule, recorded in `origin/comms:terms-draft-2026-11-12.md:14-17`: notes are recommendations for the lead and design; reversals of recorded rulings are asked, not built (17:38 RULE). See `docs/agy-owner-questions-notes-finish.md` §1; no code change requested on `#terms-sign-help` (`apps/web/src/screens/setup/Terms.tsx:227-231`).

18. **`ef3d2b83`** (`/setup/name`, `setup-name`, `section.x2f-start__intro > p.x2f-start__lead`) — *"I don't understand the part about nothing else to give us now or never since we are going to be asking for more information on the following screens so I think that needs to be rethought."*
    - **DONE** — `apps/web/src/screens/setup/Username.tsx:51-54` removed `"Nothing else to give us, now or ever."` and replaced it with `"X2F never asks for your email address or phone number."`

19. **`d4492e9e`** (`/setup/name`, `setup-name`, `section.x2f-start__intro > h1.x2f-start__h1`) — *"Pick a unique username"*
    - **DONE** — `apps/web/src/screens/setup/Username.tsx:51` sets `<SetupIntro title="Pick a unique username">`.

20. **`0e70d266`** (`/setup/login`, `setup-login`, `button.x2f-start__choice:nth-of-type(3) > ... > span.x2f-start__choice-name`) — *"Also put recommended on security key and the words strong in green letters beside recommended for both"*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:58-72,203-210` and `apps/web/src/screens/setup/setup.css:425-427` show `Recommended` and green `Strong` (`var(--x2f-good)`) on both `PGP key` and `Security key`.

21. **`252326c4`** (`/setup/login`, `setup-login`, `button.x2f-start__choice:nth-of-type(2)`) — *"Medium"*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:76-81` sets `strength: 'medium'` (`Medium`) on `Passkey`.

22. **`3750df65`** (`/setup/login`, `setup-login`, `button.x2f-start__choice:nth-of-type(3)`) — *"Where is OTP and it's explanation - medium"*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:83-98` adds `Authenticator app (OTP)` with `strength: 'medium'` and its explanation.

23. **`1e8913ad`** (`/setup/login`, `setup-login`, `button.x2f-start__choice:nth-of-type(4)`) — *"Weak"*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:100-102` sets `strength: 'weak'` (`Weak`) on `Password`.

24. **`35638b4c`** (`/setup/login`, `setup-login`, `button.x2f-start__choice:nth-of-type(4) > span.x2f-start__choice-desc:nth-of-type(2)`) — *"It is strongly recommended you do not choose this as the only security method you use."*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:107,214` renders this exact sentence inside `.x2f-start__choice-warn` on the `Password` option.

25. **`8dfc84cb`** (`/setup/login`, `setup-login`, `main.x2f-start__main > p.x2f-start__help`) — *"Recommend PGPonly as well for Android"*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:242-243` and `apps/web/src/screens/setup/PgpChallenge.tsx:155` recommend `PGPony (we recommend it; on F-Droid: com.pgpony.android) or OpenKeychain` for Android.

26. **`1f9f4557`** (`/setup/pgp-key`, `setup-pgp-key`, `#pub`) — *"There is lots of screen real estate here so make the box MUCH wider so they can see their key fit."*
    - **COVERED, PENDING (wip/agy-layout@110ec56e, review CHANGES NEEDED)** — On `wip/agy-layout` only (not on the base): `apps/web/src/screens/setup/setup.css:155-162` (`.x2f-start[data-screen='setup-pgp-key'] { max-width: 680px; }`), widening the column past 480px so 64-character armored PGP lines fit across on desktop and tablet screens without wrapping, and keeping `.x2f-textarea--key` at `rows={18}; min-height: max(320px, 48dvh)`.

27. **`a8b080ad`** (`/setup/backup`, `setup-backup`, `section.x2f-start__intro > p.x2f-start__lead`) — *"There either needs to be check boxes in the security methods that they want to setup or after setting up the pgp key (or whatever method they chose to setup first) it should go back to the different choices so they can select others until they decide to move on"*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:186-227` and `apps/web/src/screens/setup/kit.tsx:23,90-104` provide checkboxes for all 5 security methods on `/setup/login` and walk through each selected method in `SIGNUP_ORDER`.

28. **`9459c095`** (`/setup/backup`, `setup-backup`, `div.x2f-field > p.x2f-note`) — *"It should say recovery code not codes because it only gives them one so speak of it in the singular perspective and it should be much longer, like the times that length... Dashes will be typed in automatically which goes for both typing and pasting."*
    - **DONE** — `apps/web/src/screens/setup/Backup.tsx:51-54,124-135` (singular wording), `packages/accounts/src/loginCode.ts:23,73-95` (64-symbol code, 4× the old 16-symbol code, with `formatRecoveryInput` auto-inserting dashes on type/paste), and `apps/api/src/auth/recovery.ts:59,66-70` (single code, account-bound keyed HMAC-SHA-256).

29. **`6b15edc1`** (`/setup/backup`, `setup-backup`, `div.x2f-field > label.x2f-check`) — *"They check the box to say they've written it down. Then they click next and on the next screen or tests them on whether they actually wrote down the code... turn read until it's typed in correctly and then it will turn green... back button where they can go back to this screen... their code will be the same..."*
    - **DONE** — `apps/web/src/screens/setup/Backup.tsx:131-220` and `apps/web/src/screens/setup/setup.css:170-195` implement screen A (`I've written it down` + `Next`) and screen B (unseen `#recovery-typeback` with `data-match="no"|"yes"` red/green styling and `Back to my code` preserving `state.recoveryCode` in memory).

30. **`4a8a6e47`** (`/setup/backup`, `setup-backup`, `main.x2f-start__main`) — *"I prefer what I said about checking all the security options they want to setup and it will take them to the next one of their selected security options to setup after they setup the first one and the recovery code screen will be after they setup all the ones they chose"*
    - **DONE** — `apps/web/src/screens/setup/kit.tsx:23,90-104` and `apps/web/src/screens/setup/SetupFlow.tsx:83-101` step through all ticked methods in `SIGNUP_ORDER` and route to `/setup/backup` only after all ticked methods are completed.

31. **`9859d59b`** (`/setup/wallet`, `setup-wallet`, `div.x2f-start__chips`) — *"What are the methods of connecting wallets like edge has and meta mask and some of the others use. Can we not use that technology too?"*
    - **ANSWERED (owner 16 Nov #7 `7fd0d91a`; built in Job 27)** — Job 4 (`wip/agy-wallet-research`, `docs/research-monero-wallet-connect-agy-2026-11-16.md`) researched browser-injected providers and WalletConnect for Monero. The owner answered on 16 Nov #7 (a list of well-known wallets, one address field); the build is Job 27 (`wip/agy-wallet-list`).

32. **`6f7af3e7`** (`/setup/wallet`, `setup-wallet`, `main.x2f-start__main`) — *"It really make no sense asking for these wallets by name of they are not offering a specific connection system so we need to offer the connection system for the monero wallets that have it and I suggest that we also have a list of suggested monero wallets like we have on the screen now but they shouldn't be buttons like they do something"*
    - **NOT DONE (Job 27)** — Answered by the owner on 16 Nov #7 (`7fd0d91a`: non-interactive recommendation list of well-known Monero wallets + "and many more", and a single address input field); assigned to Job 27 (`wip/agy-wallet-list`), not built yet.

33. **`8b8e86f8`** (`/setup/welcome`, `setup-welcome`, `section.x2f-start__intro > p.x2f-start__lead`) — *"Your account is ready. Trade Monero for cash, bank transfers, gift cards, or whatever payment method of your choice, with every trade protected by escrow. If you find out site is lacking of a particular payment method please leave feedback so we can have it added as quickly as possible. Try to leave what detail you can or a link to a site with information on it."*
    - **DONE** — `apps/web/src/screens/setup/Welcome.tsx:34,177` renders this text in `WELCOME_COPY.lead`.

34. **`751aed2a`** (`/setup/welcome`, `setup-welcome`, `ul.x2f-welcome__rows > li.x2f-welcome__row:nth-of-type(2)`) — *"I want this screen to be more of a list of items that need to be completed and they will have a green checkmark beside each one that has been completed... 1). Configured your secure methods of logging into X2F (it will then display what methods they chose in order of best to worst but with a big green check mark to the right of them. A single green checkmark, not one on each method chosen. 2) Emergency login method - recovery code documented big green check mark 3) Connected your wallet - or will show the method of connection they chose with a big green check mark beside it"*
    - **DONE** — `apps/web/src/screens/setup/Welcome.tsx:35-99,180-215` and `apps/web/src/screens/setup/setup.css:967-1025` implement the 3-item checklist (`check-login` ordered best-to-worst via `loginMethodsBestFirst`, `check-recovery`, `check-wallet`) with one 36×36 green checkmark (`Tick`) on the right of each item.

35. **`293213a0`** (`/setup/welcome`, `setup-welcome`, `p.x2f-start__help:nth-of-type(1)`) — *"Bigger font here. Any information provided above can be changed later in settings. Next, you will login for the first time and test out your security methods you've setup which will allow us to welcome you to the X2F experience."*
    - **DONE** — `apps/web/src/screens/setup/Welcome.tsx:39-41,216-223` and `apps/web/src/screens/setup/setup.css:1028-1032` render `WELCOME_COPY.changeLater` and `WELCOME_COPY.nextLogin` in `.x2f-welcome__next` at `font-size: 18px; line-height: 26px`.

36. **`ce960f4d`** (`/setup/welcome`, `setup-welcome`, `p.x2f-start__help:nth-of-type(3)`) — *"Remember you only pay a fee if you post an ad. Clicking on an ad and initiating a trade is always free."*
    - **DONE** — `apps/web/src/screens/setup/Welcome.tsx:42,224-226` renders `WELCOME_COPY.fee` (`"Remember, you only pay a fee if you post an ad. Clicking on an ad and starting a trade is always free."`).

37. **`286f056f`** (`/setup/welcome`, `setup-welcome`, `main.x2f-welcome__main`) — *"This screen needs better estethics and remember how I want the logo in the top left of every screen with the screen name beside it"*
    - **COVERED, PENDING (wip/agy-layout@110ec56e, review CHANGES NEEDED)** — On `wip/agy-layout` only (not on the base): `apps/web/src/screens/setup/setup.css:967-1025` (card styling with `--x2f-space-4` padding, surface background, and design token `var(--x2f-good)` for tick badges), `apps/web/src/ui/ScreenHeader.tsx:21` (maps `/setup/welcome` to `'Welcome'`), and `apps/web/src/App.tsx:110` (duplicate small logo on `/welcome` resolved).

38. **`aea147fe`** (`/login`, `login`, `div.x2f-stack > button.x2f-button:nth-of-type(3)`) — *"Move everything down so the screen doesn't look so empty and so the logo fits at the top. Put them at the very first when the land on X2Fapp.com or whatever it is. Where I think the options were setup account or login. I can't remember but that screen now."*
    - **DONE** — `apps/web/src/screens/auth/Login.tsx:67,110` uses `.x2f-screen--roomy` (`padding-top: calc(var(--x2f-space-8) * 2)` in `apps/web/src/screens/screens.css:17-19`) below `ScreenHeader` (`apps/web/src/ui/ScreenHeader.tsx:19`), and `/` renders the front-door `Landing` screen with `Create account` and `Log in` (`apps/web/src/screens/auth/Landing.tsx:79-115`).

39. **`3a85aecc`** (`/login`, `login`, `#pgp-key`) — *"Make this much wider for pgp. The length from left to right is good but from top to bottom make it much bigger to use more screen real estate"*
    - **DONE** — `apps/web/src/screens/auth/Login.tsx:280-288` sets `rows={18}` and `className="x2f-input x2f-textarea x2f-textarea--tall"`, with `min-height: max(320px, 45dvh)` in `apps/web/src/screens/screens.css:133-135`.

40. **`d3396b73`** (`/setup/pgp-code`, `setup-pgp-code`, `ol.x2f-start__steps > li:nth-of-type(2)`) — *"When it's decrypt it days unknown signer. We obviously need official pgp keys for the site for certain things and whichever key we choose for this should definitely sign it for when they decrypt the secret message and get the code"*
    - **DONE** — `apps/web/src/screens/setup/PgpChallenge.tsx:18-51,172` displays X2F's official signing key fingerprint and download link (`/.well-known/x2f-signing-key.asc`), and `apps/api/src/auth/pgp.ts:44-100` signs every challenge with X2F's signing-only PGP key.

41. **`d2aa6e5e`** (`/setup/pgp-code`, `setup-pgp-code`, `#phrase`) — *"This could should be a lot longer. 4 times as long"*
    - **DONE** — `packages/accounts/src/loginCode.ts:20,59-61` increased `LOGIN_CODE_LENGTH` from 12 to 48 Crockford base32 symbols (12 groups of 4, 240 bits).

42. **`92778756`** (`/session-length`, `session-length`, `div.x2f-field > p.x2f-fine:nth-of-type(2)`) — *"Again this should be moved down so there is not so much blank space and maybe we can full some of the space with links to faq, getting started, support, settings etc..."*
    - **DONE (front-door links; signed-in link targets are a question)** — On the base: `apps/web/src/screens/auth/SessionLength.tsx:142,177` (`.x2f-screen--roomy` moves the content down; `<HelpLinks />` ends the screen with the front-door help links). Whether signed-in traders should get in-app targets is asked in `docs/agy-owner-questions-layout.md` §3 (`wip/agy-layout`).

43. **`fb9462a7`** (`/session-length`, `session-length`, `div.x2f-field`) — *"Fonts should be bigger, too small for our users but not much bigger but noticably"*
    - **DONE (`origin/wip/second-fonts`, merged into `wip/third-demo-r3`)** — Done across the entire app by owner 16 Nov Option D decision implemented on `origin/wip/second-fonts` and merged into `wip/third-demo-r3` via commit `7314ab50`. Increased `--x2f-body-size` to `18px/28px`, `.x2f-fine` to `15px/20px` (`apps/web/src/ui/ui.css:1500-1501`), and tokens up one step across all screens.

44. **`baf53108`** (`/session-length`, `session-length`, `div.x2f-field > p.x2f-fine:nth-of-type(1)`) — *"Turn on alert sounds (\"Nudges\") so a new trade wakes you."*
    - **DONE** — `apps/web/src/screens/auth/sessionCopy.ts:19` and `apps/web/src/screens/auth/SessionLength.tsx:78` (`sleepHint`).

45. **`8fd13919`** (`/session-length`, `session-length`, `div.x2f-field > p.x2f-fine:nth-of-type(2)`) — *"If you are unable to confirm your identify at that time your account will be logged out for your security."*
    - **DONE** — `apps/web/src/screens/auth/sessionCopy.ts:21` and `apps/web/src/screens/auth/SessionLength.tsx:79` (`askHint`).

46. **`59241ed3`** (`/session-length`, `session-length`, `p.x2f-fine:nth-of-type(2) > a`) — *"You can change this any time in Settings under Devices and Sessions."*
    - **DONE** — `apps/web/src/screens/auth/sessionCopy.ts:22-24` and `apps/web/src/screens/auth/SessionLength.tsx:146-150`.

47. **`75bfbd3c`** (`/sell`, `null`, `section.x2f-browse__section:nth-of-type(1) > div.x2f-method-pick > button.x2f-method`) — *"First off, this screen is ugly and not the first screen I want them to land on. The first screen is going to welcome them to X2F, and they can select \"tour\" or \"skip and get started.\" The logo will be large and in the middle of the screen, and \"Welcome to\" will be displayed diagonally from the top left moving down right diagonally to the big logo in the middle of the screen the buttons across the bottom of screen will be there as though they have dove right in and same with links I discussed in the previous screen... once the important features are explained the next button will change to next screen. I want this to be a high quality tour with a quality looking arrow that points to the area that's been explained and the area highlights..."*
    - **COVERED, PENDING (wip/agy-landing@a1015461, needs lead/owner yes on R1-R3)** — On `wip/agy-landing` only (not on the base): `apps/web/src/screens/welcome/WelcomeScreen.tsx:31-90` (adds diagonal `"Welcome to"` lead-in toward hero mark), `apps/web/src/tour/engine.ts:126-132` (changes next label to `'Next screen'` at end-of-page stops 5, 10, 12, 14, 16), and `apps/web/src/screens/welcome/welcome.css:104-114` (keeps links visible on short screens). Reversals asked in `docs/agy-owner-questions-landing.md` R1-R3.

48. **`f6a9646e`** (`/buy`, `null`, `section.x2f-browse__section:nth-of-type(1) > div.x2f-method-pick > a.x2f-method`) — *"This page is a little cramped so just a little bit more space between things and I like what you've done with the drop down of all payment methods. Good job."*
    - **COVERED, PENDING (wip/agy-layout@110ec56e, review CHANGES NEEDED)** — On `wip/agy-layout` only (not on the base): `apps/web/src/screens/browse/browse.css:20,325` (increased `.x2f-browse__header` gap to `16px` and method picker card text gap to `4px`).

---

## Part 2: `owner-demo-notes-2026-11-13.jsonl` (43 Notes)

1. **`d1156603`** (`/setup`, `setup-terms`, `section:nth-of-type(1) > p`) — *"X2F is a place where like-minded, privacy focused individuals or groups come together to exchange hard earned XMR currency for the payment method that suits them. Vice versa, it is also equally for those that wish to purchase XMR and pay for it in way that is easiest or most convenient to them. X2F just brings those people together and let's them interact safely & securely with a built in escrow system and moderators to resolve disputes if ever such one should happen."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:65` applies this opening in Section 1 paragraph 1, married with the facilitator sentences per #2.

2. **`5cde3ea7`** (`undefined`, `setup-terms`, Section 1) — *"I like what you have as well \"X2F is a place where people trade Monero (XMR) for cash, bank transfers and payment apps with each other. X2F is a facilitator. It is not a party to your trades, it is not a bank or an exchange, and it never holds your coins\". Find a way to marry them without overlap."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:65` marries both texts without overlap in Section 1 paragraph 1.

3. **`2b956e27`** (`/setup`, `setup-terms`, `section:nth-of-type(2) > p:nth-of-type(1)`) — *"You need an account to trade or post an ad but with X2F being completely privacy focused you are never asked for an email address or a phone number."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:72` applies this in Section 2 paragraph 1.

4. **`ce105e5c`** (`/setup`, `setup-terms`, `section:nth-of-type(2) > p:nth-of-type(2)`) — *"Keep your login details and recovery codes safe and private. While your wallet and funds may be secure, your account age and reputation are irreplaceable"*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:76` applies this in Section 2 paragraph 2.

5. **`fa68e7c5`** (`/setup`, `setup-terms`, `section:nth-of-type(2) > p:nth-of-type(2)`) — *"X2F has no way to reset them for you, so if you lose them you may lose the account without a way to recover it but we provide you with ample highly secure methods to protect sanctity of your account. Your coins stay safe in your own wallet either way. One person"*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:76,78` applies this in Section 2 paragraph 2 (with `"One person, one account."` beginning paragraph 3).

6. **`ee588531`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(2)`) — *"Read the vendors terms before you take an offer. Buyer & seller beware. Educating yourself on how everything works will help keep you from ever being disadvantaged or hopefully from being take advantage of but regardless our moderators are here to see that fair endings = happy endings."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:87` applies this in Section 3 paragraph 2.

7. **`a4288e0b`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(3)`) — *"...instantly undone, but it can be disputed and funds recovered, to the best of our abilities for the slighted party. Hopefully the moderator will end the trade amicably and it will end as a normal trade but in the event things aren't so straight forward our team is here to help."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:91` applies this in Section 3 paragraph 3.

8. **`e76c0661`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(5)`) — *"....to mark the trade paid using the payment method requested."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:100` (`"...the buyer gets 2 hours to mark the trade paid using the payment method requested."`).

9. **`e32651c6`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(5)`) — *"If the allotted time has run out then whoever started the trade can immediately cancel and receive the funds from escrow deposited back into their account. If the clock has nearly run out always make sure to: • Send the payment... • Communicate with the other trader... • Stay in contact with them..."*
   - **DONE** — `apps/web/src/screens/setup/termsText.ts:99-107` and `apps/web/src/screens/setup/TermsParagraphs.tsx:10-24` apply this paragraph and its bulleted list (also flagged as accuracy question Q3 in `origin/comms:review-third-demo-r3-and-terms-r3b-2026-11-16.md:146` since only the seller funds escrow).

10. **`77b566e9`** (`/setup`, `setup-terms`, `section:nth-of-type(3) > p:nth-of-type(5)`) — *"Add this in bullet form to my previous comment - If you paid late and the seller cancels, open a dispute and we will help you get your money back. The trade screen always shows the time left."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:105` adds this as the 4th bullet of Section 3 paragraph 5.

11. **`a3926f51`** (`/setup`, `setup-terms`, `section:nth-of-type(4) > p:nth-of-type(1)`) — *"Whoever posts the ad pays is responsible for the bill which will be automatically deducted, pending the completion of the trade. We don't get paid unless you both do."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:115` (`"Whoever posts the ad is responsible for the bill, which will be automatically deducted, pending the completion of the trade. We don’t get paid unless you both do."`).

12. **`1c176a20`** (`/setup`, `setup-terms`, `section:nth-of-type(4) > p:nth-of-type(1)`) — *"Responding to someone else’s ad is always free. You are a trader or a vendor."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:115` (`"Responding to someone else’s ad is always free, whether you are a trader or a vendor."`).

13. **`7db61414`** (`/setup`, `setup-terms`, `section:nth-of-type(5) > p:nth-of-type(2)`) — *"If either party is not satisfied with the outcome of the dispute, an appeal can be requested in which a senior moderator will decide the final binding decision."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:126` (`"If either party is not satisfied with the outcome of the dispute, an appeal can be requested, in which a senior moderator will make the final, binding decision, with the same access."`).

14. **`10359141`** (`/setup`, `setup-terms`, `section:nth-of-type(5) > p:nth-of-type(2)`) — *"A moderator’s goal is ultimately to see a trade through to completion."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:126` applies this sentence word-for-word in Section 5 paragraph 2.

15. **`3cee4166`** (`/setup`, `setup-terms`, `section:nth-of-type(5) > p:nth-of-type(2)`) — *".....the same as though the trade never happened to begin with."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:126` applies this phrase at the end of Section 5 paragraph 2.

16. **`433a045c`** (`/setup`, `setup-terms`, `section:nth-of-type(5) > p:nth-of-type(3)`) — *"Because of the changes above we really only need to say here \"An appeal can be requested only once per dispute and as mentioned decisions are final and binding. Our moderators are incredibly fair and we are confident that we will find the outcome that is best for everyone."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:129` replaces Section 5 paragraph 3 with this wording.

17. **`32f73419`** (`/setup`, `setup-terms`, `section:nth-of-type(6) > p:nth-of-type(1)`) — *"X2F only provides access to completed trades for 30 days, after which the entirety of the trade is purged. The only exception to this is if there is a dispute, in which case the dispute is kept for 90 days after completion after being scrubbed with our internal privacy tool and used for training moderators. At the 90 day mark it is all purged, no exceptions."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:137` applies this in Section 6 paragraph 1 (also noted under Q9 in `origin/comms:review-third-demo-r3-and-terms-r3b-2026-11-16.md:152`).

18. **`32cc5284`** (`/setup`, `setup-terms`, `section:nth-of-type(6) > p:nth-of-type(1)`) — *"Keep all of this - X2F does not track you, does not use analytics and removes location and device details from uploads."*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:137` keeps this sentence word-for-word in Section 6 paragraph 1.

19. **`ada78b2b`** (`/setup`, `setup-terms`, `section:nth-of-type(6) > p:nth-of-type(3)`) — *"This part is now redundant"*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:133-140` removes the redundant third paragraph of Section 6.

20. **`952db275`** (`/setup`, `setup-terms`, `section:nth-of-type(7) > p`) — *"...government agency"*
    - **DONE** — `apps/web/src/screens/setup/termsText.ts:145` (`"If police or a government agency sends us a lawful request for data backed by a warrant..."`).

21. **`0b68b013`** (`/setup`, `setup-terms`, `section:nth-of-type(9) > p:nth-of-type(2)`) — *"Should the word terms be capitalized?"*
    - **OWNER-QUESTION** — `apps/web/src/screens/setup/Terms.tsx:247`, `apps/staff-web/src/ui/TermsStep.tsx:102`, and `apps/web/src/screens/setup/termsText.ts:167` capitalise `"Terms"` (`COPY-UNSIGNED`). Asked as Q11 in `review-third-demo-r3-and-terms-r3b-2026-11-16.md` (comms); pointer in `docs/agy-owner-questions-notes-finish.md` §6.

22. **`c8377ac8`** (`/setup/display-name`, `setup-display-name`, `div.x2f-field`) — *"There shouldn't be limitations on usernames or display names on characters. I tried to use a $ in my display name and it refused me and I don't want that. Allow the majority of major characters, just not weird ones that might trip up the system."*
    - **DONE** — `packages/accounts/src/username.ts:138-162` and `apps/web/src/screens/setup/DisplayName.tsx:71-74` allow Unicode letters, digits, spaces, and `$ & ! ? . , ' - _ @ # % * + ( ) :` in display names while blocking invisible/control/RTL/mixed-script characters (login usernames keep ASCII `[A-Za-z0-9._-]` per `origin/comms:signup-r3-spec-2026-11-13.md:13`).

23. **`8e3c5a37`** (`/setup/login`, `setup-login`, `#_r_1_-totp`) — *"Why is this not setup yet?"*
    - **DONE** — Retracted in #24 (`8a11bb3d`); `totp` is now enabled by default on `/setup/login` because `pgp` is ticked (`apps/web/src/screens/setup/Login.tsx:92`).

24. **`8a11bb3d`** (`/setup/login`, `setup-login`, `#_r_1_-totp`) — *"Actually I take that back, why did it only become available after selecting password. Is there a reason why having an OTP requires a password?"*
    - **OWNER-QUESTION (review-third-signup-r3 Q1)** — `apps/web/src/screens/setup/Login.tsx:48,92-97` lets `totp` be ticked with any method, displaying `TOTP_NO_PASSWORD` explaining that the server currently prompts for the code only on password login (`apps/api/src/auth/password.ts:274-277`). Asked as Q1 in `review-third-signup-r3-2026-11-16.md`; the owner ruled on 16 Nov (to-lead.log 17:38:00: OTP needs a password), being built on `wip/second-signup-r3-fixes` (not agy's). Pointer in `docs/agy-owner-questions-notes-finish.md` §7.

25. **`c90d3b4b`** (`/setup/login`, `setup-login`, `section.x2f-start__intro > p.x2f-start__lead`) — *"Anything you do not setup now can be added later. The more options you choose the more secure your account becomes."*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:183-185` (`"Anything you don't set up now can be added later. The more options you choose, the more secure your account becomes."`).

26. **`addd322c`** (`/setup/login`, `setup-login`, `section.x2f-start__intro > h1.x2f-start__h1`) — *"There is likely going to have to be more scrolling on this page because the fonts are much too small. It must be readable for our users but please do not make it too much bigger but noticable."*
    - **DONE** — `apps/web/src/screens/setup/setup.css:1090-1109` bumps `.x2f-start:not([data-screen='setup-terms'])` body/lead/choice-desc/help font sizes one step (`lead` 16px → 18px, `choice-desc`/`help`/`label` 14px → 16px).

27. **`f2cb4feb`** (`/setup/login`, `setup-login`, `label.x2f-start__choice:nth-of-type(1) > span.x2f-start__choice-later:nth-of-type(3)`) — *"Only you can unlock it, so you decrypt the enclosed message using your preferred PGP software/app and it will decrypt a unique one-time login code which you will use to prove you are in control of the paired private key. Only the person in full control of the private key can view that code, and each one works only once."*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:63-64` applies this text in `METHODS[0].later`.

28. **`f0bc5a90`** (`/setup/login`, `setup-login`, `label.x2f-start__choice:nth-of-type(2)`) — *".... by tapping/inserting your Yubikey, Google Titan v2, Nitrokey, Feitian security key or any FIDO2 certified key into your phone or computer."*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:74` (`"Log in by tapping or inserting your YubiKey, Google Titan, Nitrokey, Feitian or any FIDO2-certified security key into your phone or computer."`).

29. **`99e62425`** (`/setup/login`, `setup-login`, `#_r_1_-totp`) — *"you should be allowed to have otp without a password but it wouldn't let me select it without letting me choose a password first... if over of the others is selected then totp should be allowed to be the only accompany one because remember the have their login name still too"*
    - **OWNER-QUESTION (review-third-signup-r3 Q1)** — The base (`apps/web/src/screens/setup/Login.tsx:48,92-97`) lets OTP be ticked with any method, but the server asks for the code only on password login. The owner ruled on 16 Nov (to-lead.log 17:38:00) that OTP needs a password; that is login security, being built on `wip/second-signup-r3-fixes` (not on the base, not agy's). Pointer in `docs/agy-owner-questions-notes-finish.md` §7.

30. **`e6d8122c`** (`/setup/login`, `setup-login`, `main.x2f-start__main > p.x2f-start__help`) — *"I said to recommend PGPony as the recommended Android app. You can recommend openkeychain as well but please definitely the other one first"*
    - **DONE** — `apps/web/src/screens/setup/Login.tsx:242-243` (`"...on Android PGPony (we recommend it; on F-Droid: com.pgpony.android) or OpenKeychain."`) and `apps/web/src/screens/setup/PgpChallenge.tsx:155` (`"Kleopatra, GPG Suite, PGPony or OpenKeychain"`).

31. **`1a80265e`** (`/setup/pgp-key`, `setup-pgp-key`, `main.x2f-start__main`) — *"Bigger fonts needed here"*
    - **DONE** — `apps/web/src/screens/setup/setup.css:1090-1113` increases `/setup/pgp-key` lead (`18px`), label/facts/help (`16px`), mono (`15px`), and key textarea (`14px`).

32. **`2708e47a`** (`/setup/pgp-key`, `setup-pgp-key`, `header.x2f-start__head > div.x2f-start__bar:nth-of-type(1) > span.x2f-start__title:nth-of-type(1)`) — *"Instead of create account - Adding your public PGP key"*
    - **COVERED, PENDING (wip/agy-layout@110ec56e, review CHANGES NEEDED)** — On `wip/agy-layout` only (not on the base): `apps/web/src/ui/ScreenHeader.tsx:21` (maps `/setup/pgp-key` to `'Adding your public PGP key'` beside top-left logo, matching `SetupFrame`'s title).

33. **`c0f1f047`** (`/setup/pgp-key`, `setup-pgp-key`, `section.x2f-start__facts:nth-of-type(2) > div.x2f-start__fact:nth-of-type(1)`) — *"Great screen. Is there any other data that can be displayed that's captured like the name on the account (obviously not email addy)"*
    - **DONE** — `apps/web/src/screens/setup/PgpKey.tsx:44-60` and `packages/accounts/src/pgp.ts:256,282-299` show `Name on the key` (with email `<...>` and comments stripped, never stored) and `Created` date in `KeyFacts`.

34. **`b851dfbf`** (`/setup/security-key`, `setup-security-key`, `main.x2f-start__main`) — *"Too much empty screen real estate maybe a picture of a big security key here or like 4 or 5 different ones side by side all by different companies as examples of what they can look like"*
    - **PARTLY (placeholder art; claude2/design)** — `apps/web/src/screens/setup/SecurityKeyArt.tsx:10-65` draws 4 generic key outlines (`USB-A`, `USB-C`, `NFC card`, `Lightning`) marked `data-placeholder="design-to-draw"`; the screen is claude2's and the art is design's. Artwork question in `docs/agy-owner-questions-notes-finish.md` §8.

35. **`daae4036`** (`/setup/security-key`, `setup-security-key`, `main.x2f-start__main`) — *"Unable to add security key. I've tried both USB and nfc"*
    - **DONE** — `tools/demo/rp-adopt.ts:24-82` adopts the preview pane's HTTPS host as `X2F_RP_ID`, `apps/api/src/auth/webauthn.ts:127,484-510` passes `preferredAuthenticatorType: 'securityKey'` and accepts any trader FIDO2 key model regardless of attestation snapshot, and `apps/web/src/screens/auth/keyErrors.ts:14-67` surfaces specific failure causes.

36. **`043bde0e`** (`/setup/authenticator`, `setup-authenticator`, `main.x2f-start__main`) — *"Way to plain and way too much empty real estate. A graphic representing otp or something needs to go here or the QR code needs to appear large after I click ready to enroll"*
    - **DONE** — Retracted by the owner in #37 (`93cd6c90`) once he tapped `Start enrolment` and saw the QR code (`apps/web/src/screens/settings/Totp.tsx:118`, `apps/web/src/screens/screens.css:316-320`).

37. **`93cd6c90`** (`/setup/authenticator`, `setup-authenticator`, `div.x2f-field`) — *"Nevermind. You guys didn't let me down. It looks good now let's me test it"*
    - **DONE** — `apps/web/src/screens/settings/Totp.tsx:116-141` (owner retracted #36).

38. **`48b27cc4`** (`/setup/authenticator`, `setup-authenticator`, `div.x2f-field`) — *"Is there anything that we can make pay or the code that triggers my 1password and maybe other people's password manager apps to trigger and pop-up to save that code because they can't scan the bar code when they highlight and select the big code"*
    - **DONE** — `apps/web/src/screens/settings/Totp.tsx:120-133` adds `<a ... href={enrol.otpauthUri} data-part="totp-link">Add to your authenticator or password manager</a>`, 4-character grouped secret display, and a `Copy code` button.

39. **`71512112`** (`/setup/backup`, `setup-backup`, `main.x2f-start__main`) — *"On the screen previous where it was the otp and I payed the big code and received the 6 digit code and entered it in it should turn green and say you have successfully setup your One-time password. It shouldn't just disappear like that"*
    - **DONE** — `apps/web/src/screens/settings/Totp.tsx:67,85-97` and `apps/web/src/screens/screens.css:218-226` display the green `.x2f-success` banner `"You have successfully set up your one-time password."` with a `Continue` button before leaving the screen.

40. **`9004b097`** (`/setup/backup`, `setup-backup`, `section.x2f-start__intro > p.x2f-start__lead`) — *"....so if you somehow lose access to your secure login method your emergency recovery code is the only way to recover your account and let you back in to setup up new security."*
    - **DONE** — `apps/web/src/screens/setup/Backup.tsx:51-54` (`"X2F has no email address or phone number for you, so if you ever lose access to your login methods, your emergency recovery code is the only way back into your account to set up new security."`).

41. **`8dc6cb4b`** (`/setup/backup`, `setup-backup`, `main.x2f-start__main > p.x2f-start__panel`) — *"Bigger font"*
    - **DONE** — `apps/web/src/screens/setup/setup.css:1095-1103` increases `.x2f-start:not([data-screen='setup-terms']) .x2f-start__panel` from `14px/20px` to `16px/24px`.

42. **`05d57e25`** (`/welcome`, `welcome`, `figure.x2f-hello__hero`) — *"I was at the recovery code screen and I was trying to leave a comment to say that the words on the orange button should expand and take up much more of the button bigger wider font so button doesn't look so bare. Problem is I accidentally clicked on the button itself which displayed the code so I tried to get the button back and I swiped back and few times and it took me straight to this screen. It skipped the security of confirming I had written down my code..."*
    - **DONE** — `apps/web/src/screens/setup/Backup.tsx:124` and `apps/web/src/screens/setup/setup.css:1116-1122` enlarge `.x2f-start__reveal` (`min-height: 60px; font-size: 21px; font-weight: 700`), and `apps/web/src/screens/setup/signupPending.ts:11-60`, `apps/web/src/screens/setup/SetupFlow.tsx:56-71,81-85`, and `apps/web/src/App.tsx:226-230` (`SignupBackupGate`) redirect any navigation outside `/setup` back to `/setup/backup` until the recovery code is verified.

43. **`e0a6895b`** (`/setup/password`, `setup-password`, `main.x2f-start__main`) — *"There is no eyeball button for user to display password so they can see where they went won't when trying to match them. Please add option but Star them by default"*
    - **DONE** — `apps/web/src/ui/PasswordInput.tsx:10-39`, `apps/web/src/screens/screens.css:83-113`, and `apps/web/src/screens/setup/Password.tsx:184-196` add `PasswordInput` masked by default (`type="password"`) with a 44×44 px `.x2f-password__eye` show/hide toggle button.
