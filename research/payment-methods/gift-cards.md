# Gift cards as payment methods: research shortlist

Date: 2026-10-21. Research only. Nothing in `data/payment-methods.json` was changed.

## How to read this report

Two owner decisions frame this report:

1. **Gift cards are allowed** (HANDOFF.md item 6; spec §8).
2. **The trader who receives the gift card takes all the risk.** This is the trader who gives up XMR for the card, and the site will say so prominently. X2F does not guarantee, check or police gift-card trades.

So each per-card section below is **input for two texts**:
- the site's warning text for that card (the copy itself is not written here); and
- the ad poster's own trade terms. These are suggestions the poster can copy into their ad, not X2F rules.

Each card section has the same parts: where the card works, how the receiver checks the balance, what the code looks like, **key risk facts the warning should cover**, and suggested ad terms.

**Scope change during research.** The owner said issuer terms about resale, transfer "for value" or crypto use are out of scope, so they are not covered here. Issuer clauses are cited only where they show **practical risk to the receiver**: freezing, voiding or deactivating a card, closing an account, region or currency locks, or refunds to the purchaser.

Marks used:
- **(unconfirmed)**: I could not check the claim against the issuer's own page; the source is secondary.
- **(inferred)**: my reasoning from the cited facts, not a sourced statement.

## Why these cards

P2P platforms publish no ranked volume data. The shortlist combines four kinds of evidence:

- **Platform evidence.** Paxful's gift-card FAQ says it narrowed its list to "the most traded cards". The FAQ names Steam, Apple, Razer Gold and Walmart, with Amazon and iTunes dominant historically (secondary summaries of https://support.paxful.com/support/solutions/articles/150000190238-frequently-asked-questions-about-gift-cards, which returned 403 to me, and https://www.crowdfundinsider.com/?p=142806, also 403). Noones (Paxful's successor team) names Amazon, iTunes, Google Play and Steam as globally popular (https://forklog.com/en/simple-convenient-and-bank-free-why-gift-cards-are-popular-in-crypto-noones-explains/, 2025-06-02). Bisq has a dedicated "Amazon eGift card" method (https://bisq.wiki/Amazon_eGift_card; the page would not load for me, so its content is from search snippets). Haveno, the source of our catalog, also lists Amazon eGift and Paysafecard (`data/payment-methods.json`).
- **Gift-card-for-cash markets.** Nigerian and Ghanaian rate guides, a big source of P2P gift-card supply, rank Razer Gold, Steam, Apple/iTunes, Amazon, Sephora and Google Play highest (https://nairametrics.com/2022/05/21/top-7-best-gift-cards-to-sell-in-nigeria-and-ghana-2022/, https://techcabal.com/2022/09/21/which-gift-card-has-the-highest-rate/; commercial sources, **(unconfirmed)** as volume data).
- **Scam-report data.** These are the brands most often bought with scam money, so they flow into P2P markets. The FTC named Target, Google Play, Apple, eBay and Walmart for 2021 (https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2021/12/scammers-prefer-gift-cards-not-just-any-card-will-do). For 2020 it named eBay, Google Play, Target, iTunes and Amazon (https://ftc.gov/news-events/blogs/data-spotlight/2020/12/gift-cards-top-scammers-wish-lists).
- **Owner must-haves.** Amazon, Uber, Visa prepaid and Mastercard prepaid.

**Considered and dropped:**
- **eBay:** eBay says its gift cards "are being phased out", and they need a US eBay account (https://pages.ebay.com/giftcard/faqs.html, updated 2026-08-04). Profiled below for completeness only.
- **Starbucks:** no evidence of P2P crypto use found.
- **Vanilla/OneVanilla:** these are Visa/Mastercard prepaid brands, so they are covered under those two entries.

## Summary table

Risk is risk **to the receiver** (Low / Med / High). Card format details marked "(unconfirmed)" in the sections apply here too.

| # | Card | Regions / currencies | Balance check by receiver | Code format | Risk |
|---|------|----------------------|---------------------------|-------------|------|
| 1 | Amazon gift card | Per marketplace (amazon.com USD, .co.uk GBP, .de EUR, …); not usable across marketplaces | No public check found. Receiver normally checks by redeeming into own account | Claim code, 14–15 letters/digits; e-code or physical card | **High** |
| 2 | Uber gift card | Per country (US card: US only) | Only by adding to an Uber account (Wallet → Uber Cash) | Gift code / PIN (length unconfirmed); e-code or physical | Med |
| 3 | Visa prepaid gift card (Vanilla, Giftcards.com, …) | Mostly US-issued, USD; US cards ban foreign transactions | Issuer site with card number, expiry, CVV; anyone holding these can check | 16-digit card number + expiry + CVV; physical or virtual | **High** |
| 4 | Mastercard prepaid gift card | As Visa (US, USD; foreign transactions banned) | As Visa | As Visa | **High** |
| 5 | Apple Gift Card (iTunes) | Per country; US card US-only | Official check needs sign-in or may redeem; third-party "checkers" are scams | 16-char code (unconfirmed); e-code or physical | **High** |
| 6 | Google Play | Per country (US card: US residents) | Only by redeeming to own Play account | Usually 16 letters/digits; digital codes may differ | **High** |
| 7 | Steam Wallet / gift card | Global, but codes reportedly locked to account currency | Only by redeeming (signed in to Steam) | Wallet code (≈15 chars, unconfirmed); e-code or physical | Med–High |
| 8 | Razer Gold | Region wallets (Global, US, others); PIN must match wallet region | Only by reloading into own wallet (unconfirmed) | PIN plus serial (format unconfirmed); mostly e-PIN | Med |
| 9 | Xbox / Microsoft gift card | Per currency/country of Microsoft account | Only by redeeming | 25-character code | Med |
| 10 | PlayStation Store card | Per country of PSN account; account country cannot change | Only by redeeming | 12-character code (unconfirmed) | Med |
| 11 | Walmart gift card | US only, USD | Walmart site/app/phone with card number + PIN (anyone holding them can check) | 16-digit number + 4-digit PIN (unconfirmed) | **High** |
| 12 | Target GiftCard | US only, USD | target.com balance page: 15-digit number + access number/PIN | 15-digit number + access number | **High** |
| 13 | Sephora gift card | US (and a separate Canadian card) | sephora.com with card number + PIN | 16-digit number + PIN (8 digits, unconfirmed) | Med |
| 14 | PaysafeCard | Country-specific PIN currency (EU, UK, others) | Official balance check with 16-digit PIN, no redemption needed; shows transactions | 16-digit PIN; printed receipt or e-PIN | Med |
| 15 | eBay gift card (not recommended) | US eBay accounts only; being phased out | ebay.com balance page with 13-digit code, or add to account | 13-digit redemption code | Med (and fading) |

## Risks common to all gift cards

Use these facts in the general gift-card warning:

1. **Codes are bearer value until redeemed.** Whoever has the code (or card number + PIN/CVV) can spend it. Apple says scammers can spend the funds "before you're able to contact law enforcement or Apple Support" (https://support.apple.com/en-us/120933). The sender can keep a copy and race the receiver.
2. **Issuers can void, deactivate or freeze value after the fact**, typically when they link a card to fraud. Examples:
   - Apple: may "void or deactivate Gift Cards … without a refund" (https://www.apple.com/legal/internet-services/itunes/giftcards/).
   - Google: may "close customer accounts and bill alternative forms of payment" (https://play.google/intl/en_us/card-terms/).
   - Amazon: same wording (https://www.amazon.co.uk/gc-legal).
   - Target: may "reject or deactivate any gift card" over suspected fraud (search snippet of https://www.target.com/help/article/000130374, **(unconfirmed)** wording).
   - Uber: may "suspend or void" Uber Cash (https://www.uber.com/legal/en/document/?name=uber-gift-cards-terms-of-use&country=united-states&lang=en).
   - Microsoft: may suspend the account or balance (https://support.microsoft.com/en-us/accounts-billing/microsoft-gift-cards-terms-and-conditions).
3. **Most cards in P2P markets were bought with someone else's money.** The FTC says scammers prefer gift cards because payments are fast, largely irreversible and anonymous (https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2021/12/scammers-prefer-gift-cards-not-just-any-card-will-do). UK police say fraudsters "sell the codes on" (Action Fraud guidance as quoted by https://nbcc.police.uk/news/retailers-get-tuned-in-to-the-itunes-scammers). A card from a scam victim or a stolen credit card is the main way the receiver loses value later through a void or account action **(inferred from items 2–3)**.
4. **Tampered and drained cards.** Thieves copy numbers from cards on store racks, or swap barcodes, and spend the value once the card is activated (FTC tampering advice summarised at https://consumer.ftc.gov/node/86851; barcode swaps per news reports such as https://abc7.com/post/gift-card-draining-scam-supervisor-janice-hahn-fraud/14213159/). A buyer acting in good faith can still send a dead card.
5. **"Not activated" cards.** Physical cards carry no value until the cashier activates them, and eBay notes activation can take up to 4 hours (https://pages.ebay.com/giftcard/faqs.html). Google says a code that "didn't work" may never have been activated (search snippet of https://support.google.com/googleplay/answer/11564359). A photo of an unactivated card, or of a card later refunded at the till, looks the same as a real one **(inferred)**.
6. **Fake balance-check sites** steal codes; use only the issuer's own page or app (Sephora: "Do not attempt to check your balance through any third-party sites", https://www.sephora.com/faqs-gift-cards, via search snippet; Apple Community warning, https://discussions.apple.com/thread/256316137).
7. **Region and currency locks.** Most closed-loop cards only work on an account registered in the issuing country and currency (details per card below). A card for the wrong region is worthless to the receiver unless they can resell it.
8. **No platform recourse.** Under the owner's decision, X2F will not recover a voided or drained card. Issuers' own remedies are usually limited to replacing a faulty card (Amazon: sole remedy is "replacement of such Gift Card", https://www.amazon.co.uk/gc-legal). They usually do not cover cards received from third parties.

## Per-card sections

### 1. Amazon gift card

- **Why chosen:** Owner must-have. Already in the catalog (Haveno). Bisq has a dedicated method. Historically one of the two biggest Paxful gift cards (sources above).
- **Regions and currencies:** Each card works only on its own marketplace. A UK card "may not be redeemed" on .com, .de, .fr and the other Amazon sites (https://www.amazon.co.uk/gc-legal). Issuers differ: UK cards come from Amazon EU S.à r.l. (same page).
- **Balance check:**
  - I found no official way to check a balance without redeeming. Amazon's redeem help covers only redeeming to an account (https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=G5D4TA7NBKQT7GW2).
  - Secondary guides say the public checker was removed **(unconfirmed)**.
  - In practice the receiver checks by redeeming into their own account. Redemption ties the balance to that account, and an Amazon account balance cannot be moved to another account (https://www.amazon.co.uk/gc-legal).
- **Code format:** The claim code is "14 or 15 characters long" and mixes letters and digits. Easily confused characters: 0/O, 1/I/l, 8/B, 5/S. Codes come as an e-mailed e-gift or under a scratch panel on a physical card (https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=G5D4TA7NBKQT7GW2).
- **Key risk facts for the warning:**
  - Amazon's restrictions page lists as prohibited giving or receiving a card "as payment for goods or services off of Amazon". It also prohibits buying from an "unauthorised third party". If you do these things, Amazon "may prevent you from claiming or redeeming gift cards, or may take further action on your account without a refund" (https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=G7KXB4EYEHXZRUMA). **The receiver's whole Amazon account, and its existing balance, is at risk, not just the one card.**
  - If a fraudulently obtained card is redeemed, Amazon may close accounts and charge other payment methods (https://www.amazon.co.uk/gc-legal).
  - Users report accounts locked with large gift-card balances (e.g. https://www.sikayetvar.com/en/amazon-us/amazon-locked-account-with-6000-gift-card-balance; anecdotal).
  - Amazon tells shoppers that requests for gift-card payment are "very likely to be a scam" (https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=GGKDN3QZSKBFGNBF).
  - It is a top FTC scam brand (2020 list, URL above).
- **Suggested ad terms:**
  - E-codes only, bought from Amazon itself or a named major retailer. Buyer sends the purchase receipt and order e-mail (no personal data needed beyond that).
  - Marketplace stated in the ad (e.g. "amazon.com USD only").
  - Receiver redeems immediately while the buyer stays online. No partial balances or multiple small cards.
  - Receiver advised to use a separate Amazon account with no other balance **(inferred mitigation)**.

### 2. Uber gift card

- **Why chosen:** Owner must-have. Also sold for crypto by gift-card shops (Coincards and CakePay, per https://arnoldnakamura.codeberg.page/spend-monero/; secondary). I found no evidence of high P2P volume.
- **Regions and currencies:**
  - US: "Uber Cash may not be redeemed outside of the United States". The US card issuer is TBBK Card Services, Inc. (https://www.uber.com/legal/en/document/?name=uber-gift-cards-terms-of-use&country=united-states&lang=en).
  - Other countries have their own terms pages, e.g. Australia (https://uber.com/legal/gift-cards/en-au).
- **Balance check:** The code is redeemed in the app: Wallet → Uber Cash → Add funds → Gift card (Uber's regional page https://www.uber.com/mx/en/gift-cards/info/, via search snippet). I found no official standalone balance check **(unconfirmed)**.
- **Code format:** Entered as a "PIN/gift code" with no spaces (same page). Length unconfirmed. Comes as e-gift or physical card.
- **Key risk facts for the warning:**
  - Uber and the issuer may "suspend or void" Uber Cash if they suspect fraud (US terms above).
  - Once added to an account, the value can't be moved to another Uber account (Australian terms above; US: "No portion of Uber Cash are transferrable").
  - Mexico caps an account at $2,000 total gift-card value (https://www.uber.com/mx/en/gift-cards/info/, snippet, **(unconfirmed)** for other countries).
  - The value is usable only for rides and Eats, and only in the issuing country.
  - Low resale liquidity (inferred).
- **Suggested ad terms:** Card country stated. E-code with receipt from Uber or a named retailer. Receiver redeems to their own account during the trade. Keep amounts small.

### 3. Visa prepaid gift card (Vanilla Visa, Giftcards.com Visa, etc.)

- **Why chosen:** Owner must-have. Listed among popular P2P cards ("Vanilla Visa", https://financefeeds.com/can-you-use-a-gift-card-to-buy-crypto-full-guide/; secondary). Open-loop, so it spends anywhere Visa debit works in its country.
- **Regions and currencies:**
  - Practically all P2P supply is US-issued, in USD. Vanilla Visa issuers are Pathward, N.A. (and earlier Sutton Bank, TBBK, MetaBank), per retail listings via search snippets of https://www.samsclub.com/ip/Vanilla-Visa-100-Gift-Card/13589400931 **(unconfirmed)**.
  - The Giftcards.com Visa gift card agreement (Pathward) says the card cannot be "used to make foreign transactions" (https://www.giftcards.com/us/en/trust/site-policies/visa-gift-cardholder-agreement). **A receiver outside the US may not be able to spend it at all.**
  - Prepaid Visa products issued in other countries (EU, UK) exist, with their own terms; not researched card-by-card.
- **Balance check:**
  - Vanilla: balance.vanillagift.com with card number, expiry and CVV (several secondary guides; the official site returned 403 to me, **(unconfirmed)**).
  - Giftcards.com: balance and a 60-day history via customer service or the website (agreement above).
  - Checking does not lock or claim the card. **Anyone who still has the numbers can check and spend** (inferred).
- **Code format:** 16-digit card number, expiry and 3-digit CVV, as a physical card or a virtual e-card (secondary guide https://techpoint.africa/guide/vanilla-gift-card-check-balance/, **(unconfirmed)**). Online use often needs the card registered with a name/ZIP **(unconfirmed)**.
- **Key risk facts for the warning:**
  - **The original purchaser can get the money back.** The agreement tells a holder who rejects the terms to "SAVE YOUR RECEIPT, AND CANCEL THE CARD" and ask for a refund. Lost-card replacement is also available through customer service (https://www.giftcards.com/us/en/trust/site-policies/mastercard-gift-cardholder-agreement; the Visa version is identical in structure). So a buyer who keeps the receipt can cancel or replace the card after the XMR is released **(inferred from these clauses)**. This is the main clawback route for open-loop cards.
  - The card cannot be redeemed for cash and has no ATM access (same agreement; Walmart listing via snippet). The receiver can only spend it, and only in the US.
  - Monthly maintenance fees can apply after 12 months of inactivity ($4.95 on the Giftcards.com Mastercard card, same agreement).
  - Card-rack tampering and draining affects these cards especially (FTC, above).
  - A photo of the card exposes the full spendable credentials **(inferred)**.
- **Suggested ad terms:**
  - Receiver should spend or move the full value immediately. Since cash-out is barred, that means spending it on something they need **(inferred)**. Realistically suitable only for US-based receivers.
  - Photo of card front/back plus original receipt, but the receipt does not prevent the purchaser from cancelling.
  - Card must be registered to no one, or the buyer must show the registration is removable **(unconfirmed whether possible)**.
  - No partial balances.

### 4. Mastercard prepaid gift card (Vanilla Mastercard, Giftcards.com Mastercard, etc.)

- **Why chosen:** Owner must-have. Same market as Visa prepaid.
- **Regions and currencies:**
  - US: the Giftcards.com Mastercard gift card is issued by Pathward, N.A. Its agreement bars "foreign transactions", cash and quasi-cash, and recurring payments (https://www.giftcards.com/us/en/trust/site-policies/mastercard-gift-cardholder-agreement).
  - Vanilla Mastercard: "No cash or ATM access" (Walmart listing https://www.walmart.com/ip/MasterCard-200-Gift-Card/46518456, via snippet).
- **Balance check:** Customer service or the issuer website, with a 60-day transaction history. The agreement warns "MERCHANTS MAY NOT HAVE ACCESS TO DETERMINE YOUR CARD BALANCE" (same agreement).
- **Code format:** Same as Visa: 16 digits, expiry and CVV; physical or virtual (inferred from card networks).
- **Key risk facts for the warning:**
  - The same receipt-holder cancel/refund and replacement route as Visa. The holder "may not assign or transfer your Card" (same agreement), so a receiver who is not the purchaser has no standing with the issuer (inferred).
  - US-only spending. Inactivity fee $4.95/month after 12 months (same agreement).
  - Tampering and draining as above.
- **Suggested ad terms:** As Visa prepaid. Consider "US receivers only" in the ad.

### 5. Apple Gift Card (formerly iTunes)

- **Why chosen:** iTunes was the largest Paxful gift card by volume historically. It is top-ranked in Nigerian rate guides and among the FTC's top scam brands (sources above).
- **Regions and currencies:**
  - US cards "can only be used for purchases in the United States"; US content codes need a US account. The issuer is Apple Value Services, LLC (https://www.apple.com/legal/internet-services/itunes/giftcards/).
  - Other countries have their own terms, e.g. Canada (https://apple.com/ca/go/legal/gc).
- **Balance check:**
  - Per an Apple Community thread, checking on Apple's site in some regions requires sign-in or may redeem the card (https://discussions.apple.com/thread/256316137, **(unconfirmed)** on Apple's own pages).
  - Third-party checkers are phishing (same thread; https://helpnetsecurity.com/?p=29645).
- **Code format:** 16-character code under a scratch label, physical or e-mail (https://techpoint.africa/guide/how-to-check-apple-gift-card-balance/, **(unconfirmed)**).
- **Key risk facts for the warning:**
  - Apple may "void or deactivate" cards without refund if it suspects fraud (Apple terms above).
  - Apple tells victims to contact Apple Support quickly (https://support.apple.com/en-us/120933). The victim's report is what can lead to a void after the trade (inferred).
  - The unused balance is "not transferable" (Apple terms).
  - It is the classic HMRC/IRS phone-scam card (UK police: https://nbcc.police.uk/news/retailers-get-tuned-in-to-the-itunes-scammers; Action Fraud: https://actionfraud.police.uk/giftcardfraud).
- **Suggested ad terms:** Country stated (e.g. "US Apple card"). E-code from Apple or a named retailer with receipt. Redeem during the trade. No cards bought "in the last hour" from an unknown buyer **(inferred mitigation; scam purchases are usually fresh)**. No partial balances.

### 6. Google Play gift card

- **Why chosen:** Second most-reported FTC scam brand in 2021. Named by Noones as globally popular (sources above).
- **Regions and currencies:** Each country has its own terms. US cards are valid only for "residents of the USA" aged 13+. The issuer is Google Arizona LLC (https://play.google/intl/en_us/card-terms/). The Canadian version limits use to residents of Canada (https://play.google/card-terms/).
- **Balance check:** No standalone check found. Value shows only after redemption (play.google.com/store/account per the US terms above).
- **Code format:** Usually 16 letters and digits; digital codes may differ. Enter without spaces or dashes (Google Play Help via snippets: https://support.google.com/googleplay/answer/3422659, https://support.google.com/googleplay/answer/11564359).
- **Key risk facts for the warning:**
  - Google may close accounts and bill alternative payment methods when a "fraudulently obtained Gift Card" is redeemed (US terms).
  - Google won't replace lost or stolen cards and runs a scam report form for victims (https://support.google.com/googleplay/answer/9361829).
  - A "code didn't work" error can mean the card was never activated (snippet of https://support.google.com/googleplay/answer/11564359).
- **Suggested ad terms:** As Apple: country stated, e-code with receipt, redeem during the trade.

### 7. Steam Wallet / gift card

- **Why chosen:** On Paxful's list and top in Nigerian rate guides (sources above). Also bought by scammers (Steam's own "Gift Card Scams" page: https://help.steampowered.com/en/faqs/view/09A1-E754-1D86-DDC9, contents loaded only as a title for me).
- **Regions and currencies:**
  - Steam's redeem page says codes convert to the wallet's currency "regardless of where they were purchased" (https://store.steampowered.com/account/redeemwalletcode, via snippet).
  - Community reports say that since about 2020 codes in a different currency are rejected to reduce scams (https://steamcommunity.com/discussions/forum/1/601899704908797227; **(unconfirmed)**). Treat cards as locked to the receiver's wallet currency.
  - Wallet funds have "no cash value" and are "non-transferable" (https://store.steampowered.com/subscriber_agreement/ §3.C).
- **Balance check:** Only by redeeming while signed in (redeem page above).
- **Code format:** Wallet code, about 15 characters **(unconfirmed)**; physical card or digital. Steam also has account-to-account "digital gift cards", which are a different product (https://store.steampowered.com/digitalgiftcards/redeem/code).
- **Key risk facts for the warning:**
  - Currency/region mismatch can leave the code unredeemable.
  - Steam funds can only be spent on Steam.
  - The receiver's account can be affected by a fraud dispute; Valve's terms let it terminate accounts for violations (subscriber agreement; specific gift-card reversal clause not found **(unconfirmed)**).
  - Phishing "redeem here" links are common (community reports, e.g. https://steamcommunity.com/discussions/forum/1/3790379982489592800).
- **Suggested ad terms:** Currency stated (e.g. "USD Steam codes only"). E-code with receipt. Redeem during the trade. Receiver redeems only at store.steampowered.com.

### 8. Razer Gold

- **Why chosen:** Ranked first in recent Nigerian rate guides and named on Paxful's supported list (sources above; commercial sources).
- **Regions and currencies:**
  - Wallets are regional (Global, US and others). A US PIN on a Global wallet fails with "Wallet region is not accepted", and changing the region needs Razer support (Razer Insider thread https://insider.razer.com/razer-gold-silver-20/upon-checking-the-pin-is-under-us-region-however-your-account-is-under-global-therefore-you-will-12826).
  - Whether Global PINs work everywhere is disputed between resellers (https://coingate.com/gift-cards/articles/article/how-to-redeem-a-razer-gold-gift-card vs https://gocdkeys.com/buy-razer-gold-gift-card-global-pc-cd-key; **(unconfirmed)**).
- **Balance check:** Value is seen only after reloading into the wallet **(unconfirmed)**; the official site returned an empty page to me (https://gold.razer.com/gold/terms).
- **Code format:** PIN plus serial, mostly sold as e-PINs **(unconfirmed)**.
- **Key risk facts for the warning:**
  - Region mismatch.
  - Razer says returns and refunds don't apply to PINs and disclaims lost or stolen PINs, per reseller copies of its terms (https://ar-pay.com/en/product/razer-gold-global-50, **(unconfirmed)**).
  - Users report PINs "already redeemed" on arrival (https://insider.razer.com/razer-support-45/help-with-razer-gold-pin-10920).
- **Suggested ad terms:** Wallet region stated (Global/US). PIN with receipt from Razer or an authorised reseller. Reload during the trade.

### 9. Xbox / Microsoft gift card

- **Why chosen:** Listed by the coordinator's candidates and commonly sold; moderate P2P presence (I found no P2P volume data **(unconfirmed)**).
- **Regions and currencies:**
  - A card in a given currency can only be added to an account "registered in the jurisdiction" using that currency, and the balance "cannot be converted to another currency" (https://support.microsoft.com/en-us/accounts-billing/microsoft-gift-cards-terms-and-conditions).
  - A CAD card can't go onto a US account (error XBOS3004, https://support.xbox.com/en-US/help/errors/error-code-xbos3004).
- **Balance check:** Only by redeeming at xbox.com/redeem or in the Microsoft Store (https://support.microsoft.com/en-us/accounts-billing/redeem-a-gift-card-or-code-to-your-microsoft-account).
- **Code format:** 25-character code (retailer/secondary sources such as https://coingate.com/gift-cards/articles/article/how-to-redeem-an-xbox-gift-card; **(unconfirmed)** on Microsoft's pages). Physical or digital.
- **Key risk facts for the warning:**
  - Microsoft may suspend or terminate the account or balance after a terms violation. It may withhold refunds if it suspects "fraud or misuse" (Microsoft gift card terms above).
  - The balance is non-transferable to another account (same page).
  - Xbox support "cannot transfer" codes once redeemed (search snippet of the Microsoft redeem page).
- **Suggested ad terms:** Currency/country stated. Code with receipt. Redeem during the trade.

### 10. PlayStation Store gift card

- **Why chosen:** Common gaming card; sold for crypto by gift-card shops (https://coingate.com/en/gift-cards/articles/article/ps5-gift-card). P2P volume unconfirmed.
- **Regions and currencies:**
  - The wallet accepts only prepaid cards "from the same country" as the account (§9.1).
  - The account's country "cannot" be changed after creation (§3.2) (https://www.playstation.com/en-us/legal/terms-of-service/).
- **Balance check:** Only by redeeming.
- **Code format:** 12-character voucher code (retailer source https://dundle.com/playstation/25-usd-us via snippet, **(unconfirmed)**).
- **Key risk facts for the warning:**
  - Wallet funds are "NON-REFUNDABLE AND NON-TRANSFERABLE".
  - Sony may suspend or terminate accounts on "reasonable suspicion of fraud" (same terms, §7.3 and account-suspension section).
  - Region mismatch makes the code useless to the receiver.
- **Suggested ad terms:** Country stated. Code with receipt. Redeem during the trade.

### 11. Walmart gift card

- **Why chosen:** On Paxful's list and an FTC top-5 scam brand in 2021 (sources above).
- **Regions and currencies:** US, USD. Official terms at walmart.com/giftcardterms were bot-blocked for me.
- **Balance check:** Walmart site/app/phone with card number and PIN; anyone holding them can check (secondary guides, **(unconfirmed)**).
- **Code format:** 16-digit number and 4-digit PIN (secondary, conflicting sources; **(unconfirmed)**).
- **Key risk facts for the warning:**
  - Per reseller reproductions of Walmart's fine print, Walmart may refuse a card over fraud or abuse and take action "including the forfeiture of any remaining card balance" (https://www.giftcardpartners.com/order-gift-cards/walmart, **(unconfirmed)** against walmart.com).
  - Store-rack tampering: Walmart is one of the retailers the FTC says scammers send victims to (FTC 2021 spotlight).
  - The value cannot be moved off the card except by spending at Walmart (inferred). A sender who kept the numbers can spend it in store before the receiver does (inferred).
- **Suggested ad terms:** Card photo plus receipt. Receiver checks the balance only on walmart.com and spends or adds it to their Walmart account during the trade. US receivers only.

### 12. Target GiftCard

- **Why chosen:** The FTC's top brand by reported losses in 2021, with more than twice any other (https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2021/12/scammers-prefer-gift-cards-not-just-any-card-will-do). That makes it heavily present in resale markets **(inferred)**.
- **Regions and currencies:** US, USD.
- **Balance check:** The official page is target.com/guest/gift-card-balance (https://www.target.com/guest/gift-card-balance). It takes the 15-digit card number and the access number/PIN. A phone line shows the last five transactions (snippets of https://www.target.com/help/article/000062295).
- **Code format:** 15-digit card number and an access number under the silver strip (same).
- **Key risk facts for the warning:**
  - Target "reserves the right to reject or deactivate any gift card" to prevent fraud (snippet of https://www.target.com/help/article/000130374).
  - Highest scam-loss brand.
  - Anyone with the number and access code can spend the card in store.
- **Suggested ad terms:** Card photo plus receipt. Receiver checks only on target.com and moves the value to their Target account wallet during the trade. Whether that blocks in-store use of the physical card is **(unconfirmed)**. US receivers only.

### 13. Sephora gift card

- **Why chosen:** Recurring in Nigerian/Ghanaian rate guides (sources above).
- **Regions and currencies:** US cards are redeemable only at US Sephora stores, US sephora.com orders, the US app and Sephora at Kohl's. The issuer is LGCS Inc. Canada has a separate card (reseller copies of Sephora's terms, e.g. https://www.egifter.com/giftcards/business/sephora-gift-card; **(unconfirmed)**; sephora.com returned 403).
- **Balance check:** sephora.com with card number and PIN. Sephora warns against third-party checkers (https://www.sephora.com/faqs-gift-cards, via snippet).
- **Code format:** 16-digit number and PIN, possibly 8 digits (secondary, conflicting; **(unconfirmed)**).
- **Key risk facts for the warning:**
  - Not replaced if "lost, stolen … or used without authorization" (reseller copy of terms, **(unconfirmed)**).
  - Spending limited to Sephora (US or Canada).
- **Suggested ad terms:** Country stated. Card photo plus receipt. Spend or add to the receiver's account during the trade.

### 14. PaysafeCard

- **Why chosen:** Already in the catalog (Haveno). The main voucher in Europe.
- **Regions and currencies:** PINs are sold in many countries in a country-specific currency. The UK issuer is Prepaid Services Company Limited (see `global.md` → https://www.paysafecard.com/en-gb/terms-and-conditions/).
- **Balance check:** The official balance check takes the 16-digit PIN without redeeming it. It may show a CAPTCHA, and a "Details" view lists the PIN's transactions; a spent PIN shows 0.00 (https://www.paysafecard.com/en-us/support/question/6/how-much-is-the-pin-balance-on-paysafecard/). The transaction list lets the receiver see whether someone else already spent part of it.
- **Code format:** 16-digit PIN on a till receipt, or an e-PIN bought online (https://www.paysafecard.com/en-gb/support/question/189/how-can-i-buy-paysafecard-pins-online/).
- **Key risk facts for the warning:**
  - The issuer "may block or terminate a PaysafeCard" on suspected fraud or misuse (UK T&C §6.3 per `global.md`).
  - The sender keeps the PIN and can spend it before the receiver does.
  - Spending abroad or in other currencies may be limited or carry fees **(unconfirmed)**.
  - The issuer bans selling PINs on "exchange platforms" (§4.7, per `global.md`). Kept here only because a block can follow **(inferred)**.
- **Suggested ad terms:** Currency stated. Receiver checks the PIN on paysafecard.com during the trade and spends it immediately (e.g. into their own my paysafecard account, if they have one **(unconfirmed)** whether that is allowed). No partial-balance PINs.

### 15. eBay gift card (profiled, not recommended)

- **Status:** eBay says its gift cards "are being phased out", and physical cards won't be restocked. Existing cards still redeem (https://pages.ebay.com/giftcard/faqs.html, updated 2026-08-04).
- **Regions:** You need an eBay account registered in the US and a US shipping address (same page).
- **Balance check:** Add the card to an account; the balance shows at checkout and in My eBay → Payments (same page). A balance checker takes the 13-digit code (search snippet; **(unconfirmed)**).
- **Code format:** 13-digit redemption code. Activation can take up to 4 hours (same page).
- **Risks:** An FTC top scam brand in 2020–2021. eBay says never to send the code "to anyone outside of eBay.com checkout" (same page).
- **Recommendation:** Do not add. Supply is ending.

## Suggested default ad terms (menu for ad posters)

These are not X2F rules. The poster picks what they want; the receiver carries the risk either way.

- Card brand **and country/currency** must match the ad (e.g. "Amazon.com USD", "Steam EUR").
- **E-codes from the issuer or a named major retailer only**, with the purchase receipt or order e-mail.
- For physical cards: photo of the front and back with the scratch panel removed, plus the receipt. Know that a photo proves nothing about activation or later refunds.
- **Buyer stays online until the receiver has redeemed or spent the full value.**
- **No partial balances**, no previously used cards, and a cap on the number of cards per trade.
- Minimum or maximum card value.
- Receiver checks balances only on the issuer's own site or app.
- For Visa/Mastercard prepaid: US receivers only, and the receiver spends the value right away.
- New-trader limits (e.g. small first trade) **(inferred common practice)**.

## Proposals for the catalog (text only; JSON not edited)

The existing schema is `id`, `name`, `group`, `source`, `verified`, plus an optional `legalReview` string used today only for sanctions. Given the owner's decisions, I propose **no `legalReview`** on gift cards. All entries go in group `"Gift cards & vouchers"` with `"verified": false` until checked.

**Keep / rename**
- `AMAZON_GIFT_CARD`: rename "Amazon eGift card" → **"Amazon gift card"**. P2P trades use both e-codes and physical cards; the ad states the marketplace. Source stays Haveno.
- `PAYSAFE`: optional rename → **"PaysafeCard"** (issuer's spelling, as `global.md` already suggested).

**Add** (`source: "research/payment-methods/gift-cards.md"`)

| id | name |
|----|------|
| `UBER_GIFT_CARD` | Uber gift card |
| `VISA_GIFT_CARD` | Visa prepaid gift card |
| `MASTERCARD_GIFT_CARD` | Mastercard prepaid gift card |
| `APPLE_GIFT_CARD` | Apple Gift Card (iTunes) |
| `GOOGLE_PLAY_GIFT_CARD` | Google Play gift card |
| `STEAM_GIFT_CARD` | Steam gift card / Wallet code |
| `RAZER_GOLD` | Razer Gold |
| `XBOX_GIFT_CARD` | Xbox / Microsoft gift card |
| `PLAYSTATION_GIFT_CARD` | PlayStation Store gift card |
| `WALMART_GIFT_CARD` | Walmart gift card |
| `TARGET_GIFT_CARD` | Target GiftCard |
| `SEPHORA_GIFT_CARD` | Sephora gift card |
| `OTHER_GIFT_CARD` | Other gift card (name it in the ad) |

Example entry shape:
```
{ "id": "STEAM_GIFT_CARD", "name": "Steam gift card / Wallet code", "group": "Gift cards & vouchers",
  "source": "research/payment-methods/gift-cards.md", "verified": false }
```

**Merge or naming notes**
- Do not add separate "Vanilla" or "OneVanilla" entries. They are Visa/Mastercard prepaid brands; the ad can name the brand.
- "iTunes" is the old name. Use "Apple Gift Card (iTunes)" so search finds both.
- Do not add eBay (being phased out) or Starbucks (no P2P evidence).

**Possible schema additions (for the owner/spec, not done)**
- A per-card **region/currency hint** the ad form asks for, e.g. "card country". This is needed for every closed-loop card above.
- A **`giftCard: true`** flag (or reuse the group) so the UI can show the receiver-takes-all-risk warning on every gift-card ad. `global.md`'s "high reversal-risk warning" list would then cover all of them.
- An optional per-entry **risk note key** pointing at the per-card warning facts above.

## Questions for the lawyer

The owner removed the issuer-terms questions, and none are asked here. Two receiver-risk questions remain that only a lawyer can answer:

1. Is a prominent "receiver takes all risk" statement enough to keep X2F out of disputes when a card turns out to be stolen or scam proceeds? In particular, can a victim or issuer pursue the platform that hosted the ad?
2. Do any target jurisdictions treat P2P gift-card trades as a regulated activity (e.g. the US FinCEN "prepaid access" rules, or EU e-money rules for PaysafeCard and prepaid Visa/Mastercard) in a way that reaches X2F rather than the traders? **(Not researched here.)**
