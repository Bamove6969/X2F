# X2F research pack, 2026-11-09

Scope: three parts (listing conditions, payee fields per payment method, nudge sound licence). Read-only on the repo; this file is the only write. All fetched content treated as data.

**How to read the confidence marks.**
- **READ** means I fetched the page and read the text (via a fetch tool that summarises the page).
- **SNIPPET** means I only saw a search-result description of an official page; the page itself was blocked (403) or not fetched. Treat as a lead to confirm.
- **UNVERIFIED** means I could not confirm it from a source.

Tooling limits: web.archive.org was blocked in this environment (the fetch tool refused it and the proxy reset the connection; the Wayback availability API returned no snapshots for localmonero.co/guide). Paxful's help centre returns 403 to automated fetches. I did not try to work around either block.

---

## Part 1. Listing conditions an ad poster can require of a taker

| Platform | Min completed trades | Account age | Verification level | Country | Trade limits per ad | Payment window | Terms text | Fits X2F values (no identity checks, privacy) |
|---|---|---|---|---|---|---|---|---|
| **LocalMonero** (archived, shut down; reportedly May 2024) | UNVERIFIED. Could not read any archived LocalMonero page. | UNVERIFIED | UNVERIFIED. No source found for an "identified people only" style setting. | UNVERIFIED | Advertiser-set min and max per ad (secondary sources only, not official). | UNVERIFIED (no official figure found). | Advertiser's terms are shown to the counterparty before the trade request (secondary sources only). | Cannot score from evidence. Secondary sources describe it as no-KYC, which would fit, but not confirmed from LocalMonero's own pages. Needs a human to open the Wayback copy. |
| **LocalCoinSwap** (READ: official how-to and Terms of Service) | No count field listed. Closest control is a minimum rating of the taker (e.g. 90%); lower-rated traders "will not be able to see your offer". | Not listed. | Per-ad toggles: "Photo ID Required" (only sell to users with verified photo ID); "Phone verification required" (page text cut off mid-sentence, so exact meaning unclear). Custodial / non-custodial choice for BTC. | Not listed as a restriction. Location is set only for cash-in-person ads. | Min and max in the ad's local currency; optional allowed fixed trade sizes; "liquidity tracking" auto-adjusts limits. | "Automatic cancel time" in minutes for an unaccepted trade; Terms say payment window, rate, amount and method are fixed once a trade request is sent. No duration range stated. | Free-text "Trading terms", "any conditions you require for the user to complete the trade". Terms of Service: advertiser terms bind the buyer unless illegal, unreasonable or in conflict with the Terms. | **Partly.** Ad posters can ask for photo ID and phone verification, which X2F should not offer. Platform itself can demand KYC "for dispute resolution, suspicious activity" and regulator requests, and sellers' payment details must match the account holder's name. The rating filter and free-text terms are reusable ideas. |
| **Paxful** (SNIPPET only; official support pages 403) | "Minimum trades required" field exists for sellers. | Account-age rules apply to Power/Expert trader tiers; a "fiat limit for new accounts" can be set on an offer. | Posting an offer requires the poster to be ID-verified; some offers require a bond, wallet balance or KYC. | Not confirmed per ad. | Per-trade min and max set by poster; platform minimums reported as 10 USD to buy, 0.001 BTC to sell (may be outdated). | Poster-set time in minutes; trade auto-cancels if the buyer does not click "Paid" in time. Valid range not confirmed. | Free-text offer terms, which must be consistent with Paxful's Terms of Service. | **No.** ID verification is mandatory to post. Incompatible with no identity checks. Only the minimum-trades and new-account-limit ideas are usable. |

Sources (Part 1):
- LocalCoinSwap how-to: https://localcoinswap.com/how-to-create-a-trade-offer (READ)
- LocalCoinSwap Terms of Service: https://localcoinswap.com/terms-of-service (READ; sections are unnumbered, I cited headings)
- Paxful offer-creation and rules pages (SNIPPET only): https://support.paxful.com/support/solutions/articles/150000104312-creating-an-offer-to-sell-cryptocurrency , https://support.paxful.com/support/solutions/articles/150000104309-writing-good-offer-terms , https://support.paxful.com/support/solutions/articles/150000104290-limits-and-verification , https://support.paxful.com/support/solutions/articles/150000104269-my-offer-is-not-publicly-visible
- LocalMonero: only secondary sources surfaced (e.g. https://coinbureau.com/explore/buying-monero-with-localmonero-step-by-step-guide); not used for table values because they are not official.

Table size: 3 platforms x 8 condition columns (24 cells) plus fit column. Fully verified: 1 of 3 platforms (LocalCoinSwap). Paxful partly. LocalMonero not verified.

---

## Part 2. Required payee fields per payment method

Receipt column note: official help pages rarely describe the payer's receipt screen. Where I could not find it, I say so rather than guess. For a proof screenshot X2F should treat any receipt contents as something to confirm against a real test payment.

| # | Method | Fields a payer needs | Optional fields | Memo / reference rules | Receipt a payer gets (proof screenshot) | Confidence |
|---|---|---|---|---|---|---|
| 1 | **Zelle** (US) | Recipient's email address or U.S. mobile number. Both parties need an eligible U.S. checking or savings account. | Memo not described on the page. | Not stated. Payments to enrolled recipients go straight to the bank account and cannot be cancelled or reversed. | Not described. Page says the bank or credit union app shows it. Receipt is the sending bank's, so layout varies by bank. | READ (zelle.com FAQ), receipt UNVERIFIED |
| 2 | **Interac e-Transfer** (Canada) | Recipient's email and/or mobile number; on first send, add recipient with name plus email and/or mobile. Both need a Canadian account at a participating institution. | Message in memo field is optional. | Do not put the security answer in the memo. If the recipient lacks Autodeposit, the sender sets a security question. Autodeposit shows the recipient's full legal name before confirming. Per-transaction limits set by the bank (search summary said roughly CAD 2,000 to 3,000; not on the page I read). | Interac says each transfer gets a unique reference number starting with "CA" (SNIPPET, from an Interac security page); the send page does not say what the payer sees. | READ (send page), reference number SNIPPET |
| 3 | **SEPA bank transfer** (EU/EEA) | Beneficiary IBAN and name. Beneficiary BIC is no longer needed for IBAN-only SEPA payments in practice (rulebook list reported it, so confirm in the current rulebook). | Remittance information. | Remittance data up to 140 characters, structured or unstructured; beneficiary bank must pass it on unaltered. Names capped at 70 characters in SEPA usage rules. | Not covered by EPC; receipt is the sending bank's. UNVERIFIED. | SNIPPET (EPC rulebook titles; page 403 on direct fetch), mandatory list not verified |
| 4 | **SEPA Instant** | Same as SEPA: beneficiary IBAN and name, amount in euro. | Remittance information. | Same 140-character limit (SCT Inst rulebook 2025 v1.0). | As above, UNVERIFIED. | SNIPPET |
| 5 | **Wise** | Depends on currency: IBAN for EUR and several others (BGN, CHF, DKK, GEL, GBP, NOK, PKR, PLN, RON, SEK); sort code plus account number for GBP; account holder name (individuals: first and last name). The form shows the exact fields. | Reference. | Recipient details cannot be edited after saving; a wrong detail means deleting and re-adding the recipient. | Wise blog says the recipient sees sender name, amount, date, reference and a transaction number, not the sender's bank details. A payer-side proof document was not found. | SNIPPET (Wise help and API docs), payer receipt UNVERIFIED |
| 6 | **Revolut** | For another Revolut user: search by Revtag, phone number or email. For bank transfers: IBAN or sort code plus account number and name (standard bank-transfer fields, not confirmed on a Revolut page I read). | Not confirmed. | Not confirmed. Revolut says Revtags let people pay without sharing personal details; some people only appear as Revolut customers after a first payment. | Not found. UNVERIFIED. | SNIPPET (help.revolut.com was 403) |
| 7 | **Cash App** (US/UK) | $cashtag, phone number or email. Without ID verification, sending is capped (search summary: USD 250 per 7 days; confirm). | Note (steps list "add a note", mandatory status not stated). | Not stated. Payments between Cash App accounts are instant and normally cannot be cancelled. $cashtag is public. | Receipts are in the app's activity section and at cash.app (SNIPPET). The learn page I read does not describe receipt contents or name display. | READ (learn page), receipt SNIPPET |
| 8 | **PayPal** | Recipient's name, PayPal username, email or mobile number, or a PayPal.Me link. | Note is optional. | Choice of friends-and-family vs goods-and-services affects fees and buyer protection; recipient gets an email notification. | Not described on the help page; the sender's receipt is in Activity. UNVERIFIED. | READ (help293) |
| 9 | **Venmo** (US) | Recipient's name, Venmo username, phone number or email. | Note: listed as a step; whether blank is allowed is not stated. | Venmo warns to confirm the recipient's number or email is verified on their account and to check username and photo before paying. Payments generally cannot be cancelled once delivered. | Not described. UNVERIFIED. | READ (vhel171) |
| 10 | **UK Faster Payments** | Sort code and account number plus payee name (standard fields; name is used for Confirmation of Payee, but I did not confirm that on a page). | Reference. | Pay.UK guide: reference information up to 18 characters; longer end-to-end reference (31) and remittance (140) are optional competitive extras that banks may or may not offer. | Receipt is the sending bank's. UNVERIFIED. | SNIPPET (Pay.UK FPS Principles v11, Jan 2026), sort code/CoP not verified |
| 11 | **PIX** (Brazil) | A Pix key (mobile number in E.164, email, CPF/CNPJ, or a random key), or a QR code, or Pix Copia e Cola, or manual bank details. | Amount is asked for if the QR is static; description not confirmed. | Up to 5 keys per account; random key is a 32-character string. | BCB minimum requirements: payer and recipient must both be able to get a receipt with at least name, CPF (masked or not) or CNPJ, and PSP name of each party. That is the best-documented receipt of the lot. | SNIPPET (BCB requirements PDFs v7.3/7.4; v7.4 is in a "future versions" folder), check the version in force |
| 12 | **UPI** (India) | UPI ID (VPA), mobile number registered with UPI, QR code, or account number plus IFSC. The app shows a registered name before confirming. | Remarks: not confirmed. | Not confirmed. NPCI: no beneficiary registration needed. | Transaction ID/UTR contents not found. UNVERIFIED. | SNIPPET (NPCI product pages and BHIM guidelines) |
| 13 | **Cash by mail** (USPS used as the example; X2F catalog id PAY_BY_MAIL) | Mailing address and recipient name; no bank fields. | Return address, delivery confirmation. | Currency is mailable in any class unless otherwise prohibited, but Priority Mail Express covers only USD 15 for cash; Registered Mail can insure cash up to USD 50,000 (not available with Priority Mail Express). Commercial senders must use Registered Mail for cash over USD 500 and cannot use USPS-provided packaging. International Priority Mail Express prohibits currency. | A mailing receipt shows tracking number, service, date, postage; it does not prove the contents. This is general knowledge, not read on a page. | SNIPPET (USPS DMM 601 / FAQ), receipt content from general knowledge |

Sources (Part 2):
- Zelle: https://www.zelle.com/faq (READ)
- Interac: https://www.interac.ca/en/how-to-use/interac-e-transfer/how-to-send-money-with-interac-e-transfer/ (READ); https://www.interac.ca/en/interac-e-transfer-help/ (SNIPPET)
- EPC SCT Inst rulebook 2025: https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2024-11/EPC004-16%202025%20SCT%20Instant%20Rulebook%20v1.0.pdf (SNIPPET); SCT scheme page https://www.europeanpaymentscouncil.eu/what-we-do/sepa-credit-transfer (403)
- Wise: https://wise.com/help/articles/2491526/how-do-i-add-or-delete-recipients , https://docs.wise.com/api-reference/recipient , https://wise.com/us/blog/recipient-see-account-details-wise (SNIPPET)
- Revolut: https://help.revolut.com/help/transfers/internal-transfers/send-or-request-money-from-other-revolut-customers/ (403), https://help.revolut.com/help/transfers/internal-transfers/username-payments/revtags/ (SNIPPET)
- Cash App: https://cash.app/learn/getting-started/how-to-send-and-receive-money (READ); https://cash.app/help/3123-what-is-a-cashtag (SNIPPET)
- PayPal: https://www.paypal.com/us/cshelp/article/how-do-i-send-money-help293 (READ)
- Venmo: https://help.venmo.com/cs/articles/sending-requesting-money-vhel171 (READ)
- Pay.UK: https://www.wearepay.uk/wp-content/uploads/2026/02/Pay.UK-Faster-Payments-System-Principles-v-11-Jan-2026.pdf (SNIPPET)
- BCB Pix: https://bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/IV_RequisitosMinimosparaExperienciadoUsuario.pdf (SNIPPET)
- NPCI: https://www.npci.org.in/product/upi , https://www.npci.org.in/uploads/BHIM_UPI_Guidelines_2026_012a0b1bce.pdf (SNIPPET)
- USPS: https://pe.usps.com/text/dmm300/601.htm , https://faq.usps.com/s/article/Registered-Mail-The-Basics (SNIPPET)

Table size: 13 rows (12 requested methods, with SEPA and SEPA Instant split, plus cash by mail) x 6 data columns. Only 109 methods exist in /home/user/X2F/data/payment-methods.json; none of the remaining 96 were researched (time went on the first 12 and on access problems). Official-page reads (full text): 6 of 13 rows (Zelle, Interac, Cash App, PayPal, Venmo, with Interac partly). The rest rest on search-result descriptions.

---

## Part 3. Licence check for the nudge sound

**Freesound 480002 (READ the page).**
- Title: "R18-31-Old Car Ahooga Horn.wav", uploader craigsmith. Description: "Old-fashioned automotive Ahooga horn. Two blasts." Tags: Horns, Optical, Vintage. Uploader notes it comes from 1930s to 1960s Hollywood optical and mag effects, transferred at USC Cinema and digitised for preservation; not all restored, may contain noise.
- **Licence: Creative Commons 0 (CC0 1.0)**, http://creativecommons.org/publicdomain/zero/1.0/. The page says you can copy, modify, distribute and perform the sound, even for commercial purposes.
- **Attribution: not required.** The page states no attribution requirement. It offers a "Get attribution text..." link, which is a convenience, not an obligation. A courtesy credit is allowed but optional.
- Freesound FAQ (https://freesound.org/help/faq/, READ): under CC0 "you can do pretty much what you want with the sound", but you cannot claim to be its author. Caveats from the FAQ: uploaders may add non-binding preferences such as "No generative AI" (the 480002 page did not show one, but check before using it to train or generate anything); even CC0 sounds can trigger YouTube-style Content ID claims if used unchanged in music; voice recordings can raise personality rights (not relevant to a horn).
- **Conclusion: an original edit of this clip (trim, pitch, layering, normalising, a shorter single blast) is fine to ship, with no credit needed.** Note that the clip is labelled "Ahooga horn", a generic 1930s-era klaxon sound, not specifically a recorded Model T. The task's "Model T horn" wording is a style description, not what the page claims.
- Related: a de-noised remix, Freesound 483639 by Timbre, derives from 480002. I did not read its page, so its licence is UNVERIFIED. Use 480002 directly, or confirm the remix licence first.

**Original ICQ "uh-oh" sound: treat as proprietary and do not use it.** ICQ's word mark is shown as owned by AOL LLC on a third-party trademark aggregator (not USPTO; confirm on TSDR). ICQ itself was sold to DST in 2010 and shut down on 26 June 2024. Heise reports the sound's real origin is unclear and may be a stock sample-CD effect also heard in games like Worms and Lemmings, so ownership of the sound itself is murky. I found no licence that grants reuse. Murky ownership is not permission: for a product, assume the recording is copyrighted and the name and brand are trademarked. Neither the recording nor a close imitation should ship. X2F's nudge should evoke the idea (a two-note falling "uh-oh") with a clearly different sound, which the CC0 horn covers.

**Model T horn recordings.** Ford did not fit a klaxon at the factory; owners added klaxon-style horns, and the factory horn was a weaker electric or bulb unit (forum and Allstate pages, low authority). I found no clearly licensed "Model T" recording beyond the craigsmith clip. No separate brief needed because the Freesound clip is CC0.

Since the clip is CC0, the 5-line original-sound brief is not required. Not produced.

Sources (Part 3): https://freesound.org/people/craigsmith/sounds/480002/ (READ); https://freesound.org/help/faq/ (READ); https://freesound.org/people/Timbre/sounds/483639 (SNIPPET only); https://heise.de/-9732162 (SNIPPET); https://markinton.com/trademark/icq-75381414 (SNIPPET, third party).

---

## Summary of sizes and gaps

- Table 1: 3 platforms, 1 fully verified, 1 partial (Paxful, snippets only), 1 unverified (LocalMonero).
- Table 2: 13 rows. 6 backed by a page I read; 7 by search snippets. Receipt contents are mostly unverified; PIX is the exception.
- Table 3: 1 sound confirmed CC0, no attribution needed; ICQ sound stated as proprietary.

Could not verify:
1. LocalMonero ad conditions: Wayback Machine blocked here. Someone with Wayback access should check localmonero.co/guide pages.
2. Paxful's actual field names and ranges: support site returns 403 to automated fetch; only search snippets seen.
3. Payer-side receipt contents for almost every method (Zelle, Interac, Wise, Revolut, Cash App, PayPal, Venmo, UK FPS, UPI, SEPA). Best done by a real small test payment and screenshot.
4. Revolut, EPC, Pay.UK, BCB and NPCI details rest on search-result descriptions, not full reads.
5. Methods 14 to 109 in data/payment-methods.json.
6. Licence of Freesound remix 483639; USPTO status of the ICQ mark.
