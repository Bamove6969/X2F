# Owner demo comments: triage (12 Nov 2026)

The owner left 48 comments on his phone (viewport 443x794) in the cloud demo. Source: `owner-demo-notes-2026-11-12.jsonl` (this branch).

- **Loaded** into the running demo's notes store (`~/x2f-comms/demo-notes.jsonl`). They were appended after the 2 lines already there, by id, with nothing overwritten, so his pins show in the preview.
- **Not answered:** none of his pins has a reply yet.
- **Screenshots:** one per comment, 443x794 at deviceScaleFactor 1, with a numbered magenta pin at the tapped spot, in `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/owner-notes/<n>-<id8>.png`.
- **How the screens were shot:** a fresh sign-up was walked through for the `/setup*` screens (PGP login, recovery code, a throwaway wallet address). The `/login` screens were shot logged out, then a PGP login was done for `/session-length`, `/sell` and `/buy`.
- **On-screen text:** read from the page at the CSS path recorded with each comment. All 48 paths were found on today's build.

Buckets: TERMS 15, SIGNUP 6, COPY 13, LAYOUT 7, FEATURE 4, QUESTION 3.

Bucket key:
- TERMS: the Terms text, with the owner's own proposed wording.
- SIGNUP: a change to the sign-up flow.
- COPY: other wording.
- LAYOUT: spacing, fonts, sizes, logo.
- FEATURE: new work (tour, wallet connection, welcome checklist).
- QUESTION: needs an answer.

## Table

| # | Screen | Bucket | His comment (short) | Text on screen now, at that spot | Notes |
|---|---|---|---|---|---|
| 1 | `/setup` `1-9fe3fa43.png` | TERMS | Public display name | You pick a public username and a private login name. Keep your login method and any backup safe. X2F has no way to reset them for you, so if you lose them you … | Says "public display name" where the Terms say "public username". Exact wording below. |
| 2 | `/setup` `2-4e04a245.png` | TERMS | I don't want them to think they can't have team members so maybe some wording except if you choose to setup a… | One person, one account. Do not sell, share or lend your account. | Wants "one person, one account" to leave room for team members. |
| 3 | `/setup` `3-e79231ba.png` | QUESTION | Are these different methods or are they features: Key Characteristics & Implementations • Non-Custodial Desig… | Your coins stay in your own wallet, except while they are locked in a trade’s 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on… | Pasted text about other platforms' multisig escrow; asks whether those are different methods or features. |
| 4 | `/setup` `4-ca2b6a83.png` | TERMS | Exactly with the method that was requested, posts proof, and marks it paid upon completion. The seller confir… | Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays the fiat exactly as the trade says and marks it paid. The seller … | His wording for the buyer-pays and seller-releases sentence (adds proof, transfer to the buyer's external wallet, "can be disrupted"). Exact wording below. |
| 5 | `/setup` `5-aaf06c2f.png` | TERMS | A screenshot is considered proof but not a guarantee, anything can be photoshopped these days. Always check t… | Never release coins before you have checked that the money has arrived in your own account. A screenshot is not a payment. |  Exact wording below. |
| 6 | `/setup` `6-7a830826.png` | TERMS | and these timers are based on the individual payment method chosen. So if a payment method selected is typica… | Each trade has timers. When a timer runs out, the trade moves on as the trade screen explains, for example a refund to the seller when the buyer does not pay i… | Timers per payment method; seller may cancel and get the escrow back once the buyer's time is up. Exact wording below. |
| 7 | `/setup` `7-10475770.png` | TERMS | X2F collects a 1% fee of the total amount traded in XMR. If you are a seller posting an ad you pay a 1% fee o… | You pay X2F 1% of each completed trade from your own ads. Taking an offer is free. | Fee: 1% of the XMR traded, paid by whoever posted the ad (seller or buyer). Exact wording below. |
| 8 | `/setup` `8-d1c8cb70.png` | TERMS | If something doesn't go as planned or during a disagreement between parties that cannot be resolved on your o… | If something goes wrong, either side can open a dispute within the times the trade screen shows. A moderator then reads the trade and its chat, asks for eviden… | Disputes during the trade and for a short time after it completes. Exact wording below. |
| 9 | `/setup` `9-9cdeeb48.png` | TERMS | The moderator that the chat is assigned to can decrypt the chat and have full access to all conversations and… | Chats are encrypted. If a dispute is opened, a moderator can read that trade’s conversation, and every read is logged. | Moderator access, moderator actions logged and audited, goal: complete the trade, else full reversal. Exact wording below. |
| 10 | `/setup` `10-358d1d75.png` | TERMS | If you are not satisfied with the outcome of our moderator you can speak the decision within the timeframe st… | You can appeal a decision once, within the window shown with the decision. | Appeal to a senior moderator, final and binding ("speak the decision" is probably "appeal the decision"). Exact wording below. |
| 11 | `/setup` `11-d1a46566.png` | TERMS | X2F keeps trades available for review for 30 days and then all data is purged. Disputes trades are kept for 9… | X2F keeps only what a trade needs, and deletes it after a set time. X2F does not track you, does not use analytics and removes location and device details from… | Retention: 30 days, disputes 90 days scrubbed then purged. Keep the "X2F does not track..." sentence. Exact wording below. |
| 12 | `/setup` `12-9a1b5c46.png` | TERMS | I didn't see this before I wrote my previous comment so just make sure it includes a variation of what I was … | Completed trades, chat included, are erased for good on day 30 after they end. Disputed trades are kept for up to 90 days after the dispute closes, with privat… | Approves the existing retention sentence if it carries a variation of his comment 11. |
| 13 | `/setup` `13-32b26d90.png` | TERMS | Or to violate AML/CFT laws. That's not what the site was designed for. | Do not use X2F for money from crime, to hide where money came from, or to break the law where you live. | Add AML/CFT. Exact wording below. |
| 14 | `/setup` `14-f9de831e.png` | TERMS | And never ask them to trade or chat outside of X2F - doing so loses you all protections the site offers. | Do not cheat, threaten or mislead other traders, and do not ask them to trade outside X2F. |  Exact wording below. |
| 15 | `/setup` `15-e5caa606.png` | TERMS | ...any account at our own discretion without warning and without reason. If we feel and account is a threat t… | X2F may pause or close an account that breaks these rules. Coins in escrow are then settled by a moderator under the dispute rules. | Closing any account "without warning and without reason": a legal and policy point for the lawyer and the lead. Exact wording below. |
| 16 | `/setup` `16-4f01cb96.png` | TERMS | Remember, this is a new platform so we are evolving based on feedback and no rule is permanent and without co… | When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version. | New platform, rules evolve, asks for feedback. Exact wording below. |
| 17 | `/setup` `17-26d861d0.png` | QUESTION | All comments I leave are recommendations to be discussed amongst lead and designer and if needed to come to m… | Then sign in the white box with your finger, a pen or the mouse. A scribble or an X is fine. Start creating my account needs both the tick and your signature. | Standing instruction for all his comments: they are recommendations for the lead and designer; come to him with questions. |
| 18 | `/setup/name` `18-ef3d2b83.png` | COPY | I don't understand the part about nothing else to give us now or never since we are going to be asking for mo… | You type this to log in. Only you see it. Nobody can work it out from your display name. Nothing else to give us, now or ever. | "Nothing else to give us, now or ever" reads wrong since later screens ask for more. Rethink it. |
| 19 | `/setup/name` `19-d4492e9e.png` | COPY | Pick a unique username | Pick a username | Heading. Exact wording below. |
| 20 | `/setup/login` `20-0e70d266.png` | COPY | Also put recommended on security key and the words strong in green letters beside recommended for both | Security key | Badges: "Recommended" on Security key too, and "Strong" in green beside "Recommended" on both PGP key and Security key. |
| 21 | `/setup/login` `21-252326c4.png` | COPY | Medium | Passkey Log in with your face, fingerprint or phone PIN. Apple or Google keep it synced across your devices. | Strength label for Passkey. Exact wording below. |
| 22 | `/setup/login` `22-3750df65.png` | SIGNUP | Where is OTP and it's explanation - medium | Security key Log in by tapping a YubiKey or similar key plugged into your phone or computer. | Add an OTP (authenticator) login option with its explanation, labelled Medium. |
| 23 | `/setup/login` `23-1e8913ad.png` | COPY | Weak | Password Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol. | Strength label for Password. Exact wording below. |
| 24 | `/setup/login` `24-35638b4c.png` | COPY | It is strongly recommended you do not choose this as the only security method you use. | Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol. | Warning on the Password option. Exact wording below. |
| 25 | `/setup/login` `25-8dfc84cb.png` | COPY | Recommend PGPonly as well for Android | PGP is free software that locks and unlocks messages with a pair of keys: a public key you can share and a private key only you keep. You need a PGP app each t… | On the PGP explainer: recommend PGP-only for Android as well. |
| 26 | `/setup/pgp-key` `26-1f9f4557.png` | LAYOUT | There is lots of screen real estate here so make the box MUCH wider so they can see their key fit. | (an input field: empty) | Public key box much wider and taller so the key fits. |
| 27 | `/setup/backup` `27-a8b080ad.png` | SIGNUP | There either needs to be check boxes in the security methods that they want to setup or after setting up the … | X2F has no email address or phone number for you, so if you lose your key or forget your password, a recovery code is your emergency way back in. | Checkboxes to pick several login or security methods, or loop back to the method list after each one until they move on. |
| 28 | `/setup/backup` `28-9459c095.png` | SIGNUP | It should say recovery code not codes because it only gives them one so speak of it in the singular perspecti… | Save these now. Each works once, and you will not see them again. | Recovery code singular (one code), about three times longer, kept encrypted and matched only on use, dashes inserted automatically when typed or pasted. Security and storage design question for the lead. |
| 29 | `/setup/backup` `29-6b15edc1.png` | SIGNUP | They check the box to say they've written it down. Then they click next and on the next screen or tests them … | I've written it down | Tick "written down", Next, then type the code on the NEXT screen (hidden): red until right, then green; Back returns to the same code, which only changes when used or renewed in Settings. |
| 30 | `/setup/backup` `30-4a8a6e47.png` | SIGNUP | I prefer what I said about checking all the security options they want to setup and it will take them to the … | Save your recovery codes X2F has no email address or phone number for you, so if you lose your key or forget your password, a recovery code is your emergency w… | Repeats comment 27: the recovery code screen comes after all chosen methods are set up. |
| 31 | `/setup/wallet` `31-9859d59b.png` | FEATURE | What are the methods of connecting wallets like edge has and meta mask and some of the others use. Can we not… | Cake Wallet Edge Feather Monerujo Stack Monero GUI Ledger or Trezor Other | Wallet connection like Edge or MetaMask: can X2F use that? |
| 32 | `/setup/wallet` `32-6f7af3e7.png` | FEATURE | It really make no sense asking for these wallets by name of they are not offering a specific connection syste… | Where should we send your XMR? Choose the wallet you want to be paid to. X2F never holds your coins. Cake Wallet Edge Feather Monerujo Stack Monero GUI Ledger … | Offer a connection system for Monero wallets that have one; keep a list of suggested wallets, but not as buttons. |
| 33 | `/setup/welcome` `33-8b8e86f8.png` | COPY | Your account is ready. Trade Monero for cash, bank transfers, gift cards, or whatever payment method of your … | Your account is ready. Trade Monero for cash, bank transfers and payment apps, with every trade protected by escrow. | Welcome lead, adding gift cards and an invitation to request missing payment methods. Exact wording below. |
| 34 | `/setup/welcome` `34-751aed2a.png` | FEATURE | I want this screen to be more of a list of items that need to be completed and they will have a green checkma… | Backup login Recovery codes | Welcome screen as a completed checklist with big green ticks: 1) login methods (best to worst, one tick), 2) recovery code documented, 3) wallet connected. |
| 35 | `/setup/welcome` `35-293213a0.png` | COPY | Bigger font here. Any information provided above can be changed later in settings. Next, you will login for t… | You can change any of these later in Settings. | Also LAYOUT: bigger font. Exact wording below. |
| 36 | `/setup/welcome` `36-ce960f4d.png` | COPY | Remember you only pay a fee if you post an ad. Clicking on an ad and initiating a trade is always free. | You pay X2F 1% of each completed trade from your own ads. Taking an offer is free. |  Exact wording below. |
| 37 | `/setup/welcome` `37-286f056f.png` | LAYOUT | This screen needs better estethics and remember how I want the logo in the top left of every screen with the … | Welcome to X2F, Shots38fd Your account is ready. Trade Monero for cash, bank transfers and payment apps, with every trade protected by escrow. You log in with … | Better looks; the logo top left of every screen with the screen name beside it. |
| 38 | `/login` `38-aea147fe.png` | LAYOUT | Move everything down so the screen doesn't look so empty and so the logo fits at the top. Put them at the ver… | Log in with a security key | Move content down, logo at the top; also wants this to be the first screen on X2Fapp.com (set up account or log in). |
| 39 | `/login` `39-3a85aecc.png` | LAYOUT | Make this much wider for pgp. The length from left to right is good but from top to bottom make it much bigge… | (an input field: empty) | PGP key box on the login screen much taller. |
| 40 | `/setup/pgp-code` `40-d3396b73.png` | QUESTION | When it's decrypt it days unknown signer. We obviously need official pgp keys for the site for certain things… | Open your PGP app (Kleopatra, GPG Suite or OpenKeychain) and decrypt it. | His PGP app says "unknown signer" on the decrypted code. Needs official site PGP keys and the login message signed with one. To check: whether the message is already signed with the demo's throwaway signing key, which his app does not know. |
| 41 | `/setup/pgp-code` `41-d2aa6e5e.png` | SIGNUP | This could should be a lot longer. 4 times as long | (an input field: empty) | Login code about 4 times longer (a security and usability trade-off: needs a lead answer). |
| 42 | `/session-length` `42-92778756.png` | LAYOUT | Again this should be moved down so there is not so much blank space and maybe we can full some of the space w… | When this time is up, we'll ask you to confirm it's you to stay logged in. If you don't, you're logged out. | Less empty space; maybe fill it with links to FAQ, getting started, support and settings (that part is FEATURE). |
| 43 | `/session-length` `43-fb9462a7.png` | LAYOUT | Fonts should be bigger, too small for our users but not much bigger but noticably | Stay logged in for Choose a time 2 hours 4 hours 8 hours 12 hours Longer sessions so you don't miss a trade while you sleep. Turn on alert sounds so a new trad… | Fonts noticeably (not much) bigger. |
| 44 | `/session-length` `44-baf53108.png` | COPY | Turn on alert sounds ("Nudges") so a new trade wakes you. | Longer sessions so you don't miss a trade while you sleep. Turn on alert sounds so a new trade wakes you. | Name the alert sounds "Nudges". Exact wording below. |
| 45 | `/session-length` `45-8fd13919.png` | COPY | If you are unable to confirm your identify at that time your account will be logged out for your security. | When this time is up, we'll ask you to confirm it's you to stay logged in. If you don't, you're logged out. |  Exact wording below. |
| 46 | `/session-length` `46-59241ed3.png` | COPY | You can change this any time in Settings under Devices and Sessions. | Devices and sessions |  Exact wording below. |
| 47 | `/sell` `47-75bfbd3c.png` | FEATURE | First off, this screen is ugly and not the first screen I want them to land on. The first screen is going to … | Payment method: PayPal | New first screen after signup: "Welcome to" diagonal to a big centred logo, "tour" or "skip and get started", and a full guided site tour (arrow, highlight, explanation per feature, Next, then Next screen). Also says /sell is ugly. |
| 48 | `/buy` `48-f6a9646e.png` | LAYOUT | This page is a little cramped so just a little bit more space between things and I like what you've done with… | 1 seller taking USD · from $589.25 This payment method can take up to 45 minutes. | A little more space between things; likes the all-payment-methods drop-down ("Good job"). |

## The owner's exact wording, verbatim

Where he gave the words he wants (marked "Exact wording below" in the table), here they are as he typed them, typos included.

**1** (TERMS, `/setup`, replacing or adding to: "You pick a public username and a private login name. Keep your login method and any backup safe. X2F has no way to reset them for you, so if you lose them you may lose the account and its reputation.…")

> Public display name

**4** (TERMS, `/setup`, replacing or adding to: "Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays the fiat exactly as the trade says and marks it paid. The seller confirms the payment and releases the XM…")

> Exactly with the method that was requested, posts proof, and marks it paid upon completion. The seller confirms receipt of chosen payment method and releases XMR which are immediately transferred to buyers external wallet. A release cannot be undone but can be disrupted.

**5** (TERMS, `/setup`, replacing or adding to: "Never release coins before you have checked that the money has arrived in your own account. A screenshot is not a payment.")

> A screenshot is considered proof but not a guarantee, anything can be photoshopped these days. Always check to make sure payment has arrived before you release the escrow.

**6** (TERMS, `/setup`, replacing or adding to: "Each trade has timers. When a timer runs out, the trade moves on as the trade screen explains, for example a refund to the seller when the buyer does not pay in time.")

> and these timers are based on the individual payment method chosen. So if a payment method selected is typically instant but can take up to 2 hours to complete then we will give the buyer 2 hours to at least indicate they have sent the funds via the chosen payment method. Once the time granted to buyer is up and if the buyer has not marked the trade paid the seller will have the option of cancelling the trade and immediately having all escrowed funds returned to their wallet.

**7** (TERMS, `/setup`, replacing or adding to: "You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.")

> X2F collects a 1% fee of the total amount traded in XMR. If you are a seller posting an ad you pay a 1% fee of the total amount of the XMR you sell in the trade. Vice versa, if you are a buyer posting an ad to buy XMR you will pay a 1% fee off the total amount traded. Very simple.

**8** (TERMS, `/setup`, replacing or adding to: "If something goes wrong, either side can open a dispute within the times the trade screen shows. A moderator then reads the trade and its chat, asks for evidence and decides where the escrow goes.")

> If something doesn't go as planned or during a disagreement between parties that cannot be resolved on your own a dispute may be started both during the trade and for a short period even after the trade completes.

**9** (TERMS, `/setup`, replacing or adding to: "Chats are encrypted. If a dispute is opened, a moderator can read that trade’s conversation, and every read is logged.")

> The moderator that the chat is assigned to can decrypt the chat and have full access to all conversations and logs of what has transpired. We also log all actions of our moderators so we can audit our own staff to make sure the best outcome for all parties. The goal of the moderator is to see the trade completed unless that outcome is not possible and then the next best outcome would bea full reversal of the trade, like it never happened.

**10** (TERMS, `/setup`, replacing or adding to: "You can appeal a decision once, within the window shown with the decision.")

> If you are not satisfied with the outcome of our moderator you can speak the decision within the timeframe stated and then a senior moderator will intervene and review all information and make a final, binding decision.

**11** (TERMS, `/setup`, replacing or adding to: "X2F keeps only what a trade needs, and deletes it after a set time. X2F does not track you, does not use analytics and removes location and device details from uploads.")

> X2F keeps trades available for review for 30 days and then all data is purged. Disputes trades are kept for 90 days, scrubbed of personal and confidential information with our internal privacy tool, and then used for training moderators. At the 90 day mark they are completely purged. Keep the part after this about "X2F does not track....."

**13** (TERMS, `/setup`, replacing or adding to: "Do not use X2F for money from crime, to hide where money came from, or to break the law where you live.")

> Or to violate AML/CFT laws. That's not what the site was designed for.

**14** (TERMS, `/setup`, replacing or adding to: "Do not cheat, threaten or mislead other traders, and do not ask them to trade outside X2F.")

> And never ask them to trade or chat outside of X2F - doing so loses you all protections the site offers.

**15** (TERMS, `/setup`, replacing or adding to: "X2F may pause or close an account that breaks these rules. Coins in escrow are then settled by a moderator under the dispute rules.")

> ...any account at our own discretion without warning and without reason. If we feel and account is a threat to the site or to our users we will take actions to protect them and ourselves. We do not take the security of our users lightly.

**16** (TERMS, `/setup`, replacing or adding to: "When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version.")

> Remember, this is a new platform so we are evolving based on feedback and no rule is permanent and without consideration for change for the betterment of the site and our users. We strongly recommend and ask that you leave feedback and help shape this platform.

**19** (COPY, `/setup/name`, replacing or adding to: "Pick a username")

> Pick a unique username

**21** (COPY, `/setup/login`, replacing or adding to: "Passkey Log in with your face, fingerprint or phone PIN. Apple or Google keep it synced across your devices.")

> Medium

**23** (COPY, `/setup/login`, replacing or adding to: "Password Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol.")

> Weak

**24** (COPY, `/setup/login`, replacing or adding to: "Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol.")

> It is strongly recommended you do not choose this as the only security method you use.

**33** (COPY, `/setup/welcome`, replacing or adding to: "Your account is ready. Trade Monero for cash, bank transfers and payment apps, with every trade protected by escrow.")

> Your account is ready. Trade Monero for cash, bank transfers, gift cards,  or whatever payment method of your choice, with every trade protected by escrow. If you find out site is lacking of a particular payment method please leave feedback so we can have it added as quickly as possible. Try to leave what detail you can or a link to a site with information on it.

**35** (COPY, `/setup/welcome`, replacing or adding to: "You can change any of these later in Settings.")

> Bigger font here. Any information provided above can be changed later in settings. Next, you will login for the first time and test out your security methods you've setup which will allow us to welcome you to the X2F experience.

**36** (COPY, `/setup/welcome`, replacing or adding to: "You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.")

> Remember you only pay a fee if you post an ad. Clicking on an ad and initiating a trade is always free.

**44** (COPY, `/session-length`, replacing or adding to: "Longer sessions so you don't miss a trade while you sleep. Turn on alert sounds so a new trade wakes you.")

> Turn on alert sounds ("Nudges") so a new trade wakes you.

**45** (COPY, `/session-length`, replacing or adding to: "When this time is up, we'll ask you to confirm it's you to stay logged in. If you don't, you're logged out.")

> If you are unable to confirm your identify at that time your account will be logged out for your security.

**46** (COPY, `/session-length`, replacing or adding to: "Devices and sessions")

> You can change this any time in Settings under Devices and Sessions.

## Long comments in full (no exact wording, but detailed wishes)

**3** (`/setup`)

> Are these different methods or are they features:
> 
> 
> Key Characteristics & Implementations
> 
> • Non-Custodial Design: Modern implementations—such as Onyx-Escrow, XmrBazaar Escrow, or decentralized platforms like Haveno—aim to be non-custodial or client-side (often executing via WebAssembly or browser-native scripts) so the escrow coordinator never actually holds or steals the raw funds.
> • Peer-to-Peer Trading: It is commonly used on P2P marketplaces (such as XMR Local) to prevent exit scams by either the buyer or the seller.
> • Privacy Preserved: While a 2-of-3 multisig structure coordinates who signs off on the spend, the underlying Monero transactions still leverage ring signatures and stealth addresses on-chain to keep transaction amounts and participants hidden from outside observers.
> Are you looking to use a specific platform for a trade, or do you need help understanding how to set up a manual CLI/GUI Monero multisig wallet?

**27** (`/setup/backup`)

> There either needs to be check boxes in the security methods that they want to setup or after setting up the pgp key (or whatever method they chose to setup first) it should go back to the different choices so they can select others until they decide to move on

**28** (`/setup/backup`)

> It should say recovery code not codes because it only gives them one so speak of it in the singular perspective and it should be much longer, like the times that length and our system needs to be a fortress that keeps those matched to an account an encrypted except when they are used even if it takes the system a few minutes to locate their encrypted code, decrypt it, and match it to what they typed in. Dashes will be typed in automatically which goes for both typing and pasting.

**29** (`/setup/backup`)

> They check the box to say they've written it down. Then they click next and on the next screen or tests them on whether they actually wrote down the code. There is no point in testing them when they can see the code, we want to strongly encourage writing it down. If they get it wrong on the next screen it will turn read until it's typed in correctly and then it will turn green and let them move onto the next screen. If they cannot get it right they will have a back button where they can go back to this screen and actually write down the code and this time hit next and get it right on the following screen. If they hit back their code will be the same, it's their unique code and it will not change unless they end up using it or they request a new one in security settings.

**30** (`/setup/backup`)

> I prefer what I said about checking all the security options they want to setup and it will take them to the next one of their selected security options to setup after they setup the first one and the recovery code screen will be after they setup all the ones they chose

**32** (`/setup/wallet`)

> It really make no sense asking for these wallets by name of they are not offering a specific connection system so we need to offer the connection system for the monero wallets that have it and I suggest that we also have a list of suggested monero wallets like we have on the screen now but they shouldn't be buttons like they do something

**34** (`/setup/welcome`)

> I want this screen to be more of a list of items that need to be completed and they will have a green checkmark beside each one that has been completed and they will have green checkmark because they wouldn't have reached this screen without completing everything. 1). Configured your secure methods of logging into X2F (it will then display what methods they chose in order of best to worst but with a big green check mark to the right of them. A single green checkmark, not one on each method chosen. 2) Emergency login method - recovery code documented big green check mark 3) Connected your wallet - or will show the method of connection they chose with a big green check mark beside it

**47** (`/sell`)

> First off, this screen is ugly and not the first screen I want them to land on. The first screen is going to welcome them to X2F, and they can select "tour" or "skip and get started." The logo will be large and in the middle of the screen, and "Welcome to" will be displayed diagonally from the top left moving down right diagonally to the big logo in the middle of the screen the buttons across the bottom of screen will be there as though they have dove right in and same with links I discussed in the previous screen. They will choose to get started or take the site tour. I want you this to device an actual tour of the site where it takes them through each page and highlights the important features of that page one by one so as they hit next it will point to another important feature and an explanation what it's for once the important features are explained the next button will change to next screen. I want this to be a high quality tour with a quality looking arrow that points to the area that's been explained and the area highlights so they know what's being covered and I want a well written explanation

