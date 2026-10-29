# Payment-method verification — europe-north-east

Checked: **2026-10-21**. Research only; `data/payment-methods.json` not edited.
Some provider sites (revolut.com, twint.ch) refused automated fetches (HTTP 403); for those, facts come from the
search engine's index of the official page and are marked **(indexed excerpt)** — worth a manual re-read before launch.
Anything inferred is marked **(inferred)**.

## Summary

| id | name | verdict | reversal risk | crypto clause | note |
|---|---|---|---|---|---|
| REVOLUT | Revolut | verified-with-flags | medium | yes | Operating; Revolut restricts accounts tied to P2P crypto platforms; UK APP-scam reimbursement can trigger claw-back/freeze |
| SWISH | Swish | verified | low | no | Sweden/SEK only; real-time, sender cannot cancel; limits set by each bank |
| PAYSERA | Paysera | verified-with-flags | low | yes | Paysera terms forbid using the account for crypto trading; account closure on repeat |
| MONESE | Monese | verified-with-flags | medium | no | Still operating (UK + EEA); acquired by Pockit Oct 2024 after going-concern warning; UK APP reimbursement applies |
| BLIK | BLIK | verified | low | no | Poland (PLN) phone transfers; instant; limits per bank; Slovakia only for e-commerce so far |
| VIPPS_MOBILEPAY | Vipps MobilePay | verified-with-flags | medium | no | Private terms ban commercial use; card-funded payments carry chargeback risk; MobilePay renamed Vipps on 12 Jan 2027 |
| TWINT | TWINT | verified-with-flags | low | no | Switzerland/CHF; terms ban receiving P2P money from commercial sales; transfers cannot be reversed |
| SBP | SBP (Russia) | verified-with-flags | medium | yes | **Sanctions**: EU operators barred from SBP since 19th package; operator = Bank of Russia (OFAC Directive 4); NSPK designated by US and UK |
| MIR | Mir card | verified-with-flags | high | yes | **Sanctions**: NSPK (Mir operator) designated by OFAC 23 Feb 2024 and UK 15 Oct 2025; EU operators barred from Mir |
| YOOMONEY | YooMoney | verified-with-flags | low | yes | **Sanctions**: YooMoney LLC on OFAC SDN list since 6 Apr 2022 (Sberbank subsidiary); wallet terms forbid crypto buy/sell |
| UKRAINE_CARD | Ukrainian bank card transfer | verified-with-flags | medium | unknown | Generic — no provider to verify; NBU anti-"drop" limits per bank; virtual-asset law still not final |
| KASPI | Kaspi | verified-with-flags | low | yes | Kaspi Gold P2P, KZT, 2M KZT/day; Kaspi says it may end the relationship on signs of crypto buy/sell (statement to press) |

Verdict counts: verified 2 · verified-with-flags 10 · outdated 0 · discontinued 0 · unclear 0.

---

## REVOLUT — Revolut

1. **Status**: operating (help centre and current personal terms live, 2026). Source: https://help.revolut.com/help/profile-and-plan/profile-plan/verifying-identity/what-countries-are-supported/
2. **Official site**: https://www.revolut.com
3. **Where it works**: personal accounts for residents of the EEA, UK, Switzerland, US, Australia, Brazil, Japan, New Zealand, Singapore (Mexico waiting list) — same help page **(indexed excerpt)**. Multi-currency.
4. **Transfer characteristics**: Revolut-to-Revolut transfers are normally instant; a pending transfer can be cancelled in-app, a completed one generally cannot, and for transfers to another Revolut user Revolut says it can't help reverse — the sender must ask the recipient (https://help.revolut.com/en-US/help/transfers/internal-transfers/my-transfer-to-another-revolut-customer-is-pending/, https://help.revolut.com/en-US/help/transfers/outbound-transfers/having-an-issue-with-sending-money/i-want-to-cancel-a-transfer/ — indexed excerpts). Reversal risk in practice comes from (a) fraud recalls — Revolut says it may be required to **confiscate** funds a P2P seller received from fraud victims (https://www.revolut.com/blog/post/p-2-p-crypto-scams/, indexed excerpt), (b) for UK Faster Payments, mandatory APP-scam reimbursement up to £85,000, claimable up to 13 months after payment (PSR: https://www.psr.org.uk/publications/policy-statements/ps247-faster-payments-app-scams-reimbursement-requirement-confirming-the-maximum-level-of-reimbursement/, https://www.psr.org.uk/media/rhelv4op/ps25-5-app-scams-reimbursement-consolidated-policy-statement-may-2025.pdf), (c) card chargebacks if the buyer topped up with a card **(inferred)**. Rating: medium.
5. **Crypto stance**: yes (restriction). Revolut's crypto terms: "Any transaction made directly with third parties is prohibited" (applies to in-app crypto service) — https://www.revolut.com/en-DE/legal/cryptocurrency-terms/ (indexed excerpt). Its account-restriction blog names P2P crypto trading platforms as a reason for restrictions — https://www.revolut.com/blog/post/why-does-revolut-restrict-accounts/ (indexed excerpt). No explicit ban on receiving fiat for crypto sold elsewhere found.
6. **Legal flags**: none sanctions-related. Account-freeze risk for sellers is the main issue.
7. **Name check**: "Revolut" is correct.
8. **Verdict**: verified-with-flags (P2P-crypto restriction practice; APP reimbursement exposure).

## SWISH — Swish

1. **Status**: operating. Source: https://www.swish.nu/private
2. **Official site**: https://www.swish.nu (owned by Swedish banks via Getswish AB **(inferred from site footer/branding)**)
3. **Where it works**: Sweden only, SEK; requires a Swedish bank connected to Swish and Mobile BankID (https://www.swish.nu/faq/private/how-do-i-make-a-payment-with-swish, indexed excerpt).
4. **Transfer characteristics**: real-time, 24/7, usually within seconds (https://www.swish.nu/faq/private/how-fast-does-a-swish-payment-reach-the-payee-s-account). No sender cancel once paid — for a mistaken payment Swish advises asking the recipient, then the bank, then police (https://www.swish.nu/faq/private/i-accidentally-swished-the-wrong-number-how-do-i-get-my-money-back). Limits set by each bank (https://www.swish.nu/faq/private/what-is-the-maximum-amount-i-can-swish). Risk: low (fraud-report recalls via the bank remain possible **(inferred)**).
5. **Crypto stance**: no clause found in Swish's own pages. Note: Swedish banks have cut Swish access for crypto firms (e.g. SEB/BTCX, Handelsbanken/Safello) and some banks warn retail customers — press reports, not Swish terms: https://www.realtid.se/goobit-group-slutar-med-swish-betalningar/
6. **Legal flags**: none found. Bank-level account restrictions possible.
7. **Name check**: "Swish" correct.
8. **Verdict**: verified.

## PAYSERA — Paysera

1. **Status**: operating. Source: https://www.paysera.com/v2/en/index
2. **Official site**: https://www.paysera.com (Paysera LT, Lithuania)
3. **Where it works**: payments to/from many countries (country list incl. sanctioned-country exclusions: Russia, Iran, Cuba, Syria, DPRK, occupied Ukrainian regions) — https://www.paysera.com/v2/en/faq/where-paysera-works. EUR plus other currencies; SEPA Instant within EEA.
4. **Transfer characteristics**: Paysera-to-Paysera transfers in seconds (https://www.paysera.com/v2/en/paysera-account). Payment order cancellable only before execution starts (https://www.paysera.com/v2/en/legal/general-payment-service-agreement-for-private). SEPA Instant cannot be cancelled once sent; fee table lists a paid recall/return request. Risk: low.
5. **Crypto stance**: yes. Paysera's blog on restricted accounts: terms require "not to use our services for cryptocurrency trading"; repeat use → restriction/closure — https://www.paysera.com/v2/en/blog/why-is-account-restricted-blocked (2020). Business agreement also bars virtual-currency buying/exchanging — https://www.paysera.com/v2/en/legal/general-payment-service-agreement-for-business
6. **Legal flags**: crypto-ban clause; Paysera halted transfers to/from Russia and closed Russian clients' accounts (https://www.paysera.com/v2/en/blog/solidarity-with-ukraine).
7. **Name check**: "Paysera" correct.
8. **Verdict**: verified-with-flags (crypto-trading ban).

## MONESE — Monese

1. **Status**: operating. Acquired by Pockit (announced Oct 2024, subject to FCA change-in-control); brands run separately (https://www.fintechfutures.com/challenger-banks/uk-challenger-monese-to-be-acquired-by-fellow-fintech-pockit — trade press). Current UK personal terms dated 11-02-2026 and EU terms 09-10-2025 are live on monese.com.
2. **Official site**: https://www.monese.com
3. **Where it works**: UK (Monese Ltd, FCA EMI FRN 900960; e-money via PPS UK) and EEA (Monese EU SA, Belgium, agent of PPS EU, NBB-authorised) — https://www.monese.com/terms/uk-personal-terms-and-conditions-11-02-2026, https://www.monese.com/terms/eu-other-personal-terms-and-conditions-09-10-2025. GBP, EUR, RON accounts.
4. **Transfer characteristics**: UK Faster Payments / SEPA. UK terms incorporate the PSR APP-scam reimbursement rules (claims, up to 35 days to reimburse) — same UK terms URL. Mastercard chargeback for card spend. Risk: medium (UK APP claims; card top-ups) **(inferred for P2P context)**.
5. **Crypto stance**: no clause found in the current UK (2026) or EU (2025) personal terms (searched full text for "crypto"). Older 2019 terms barred card use with crypto-trading industries (https://static.monese.com/terms-september-2019/en/terms.pdf); business accounts exclude crypto trading firms.
6. **Legal flags**: 2024 going-concern warning before Pockit takeover (trade press, above) — stability risk; status page shows partner outages in 2026 (third-party monitor). Flag for business, not legal.
7. **Name check**: "Monese" correct.
8. **Verdict**: verified-with-flags (ownership change/stability; UK APP reversal exposure).

## BLIK — BLIK

1. **Status**: operating. Source: https://www.blik.com/en/faq
2. **Official site**: https://www.blik.com (Polski Standard Płatności sp. z o.o.)
3. **Where it works**: Poland, PLN, via participating Polish banks. Slovakia launched Sept 2024 (Tatra banka, later mBank SK) for e-commerce only; BLIK Romania authorised Oct 2024 — https://www.blik.com/en/history-of-changes, https://blik.com/en/a-new-era-of-online-payments-blik-now-available-to-first-slovak-users. P2P "przelew na telefon" is a Polish-bank feature.
4. **Transfer characteristics**: phone-number transfers are instant and authorised in the sender's banking app; BLIK's rulebook allows a PSP/settlement agent to cancel or correct a transaction for technical error within 13 months (https://www.blik.com/download/pobierz/regulamin-1). For a mistaken transfer BLIK says to contact your bank (https://www.blik.com/omylkowy-przelew-co-zrobic-gdy-pieniadze-niespodziewanie-trafia-na-twoje-konto-praktyczny-poradnik-dla-uzytkownikow-1). Limits per bank. Risk: low.
5. **Crypto stance**: no clause found in the BLIK rulebook/FAQ. Individual Polish banks may restrict **(inferred)**.
6. **Legal flags**: none found.
7. **Name check**: "BLIK" correct; could say "BLIK phone transfer (Poland)".
8. **Verdict**: verified.

## VIPPS_MOBILEPAY — Vipps MobilePay

1. **Status**: operating; **renaming**. Company Vipps MobilePay AS becomes **Vipps AS** and the MobilePay app becomes **Vipps** in Denmark and Finland on **12 January 2027** (new icon since 6 Oct 2026). Source: Vipps private terms v1.5 of 20 Oct 2026 — https://vippsmobilepay.com/terms-and-conditions/no/private-user ; trade press https://thepaypers.com/payments/news/mobilepay-to-be-rebranded-as-vipps-across-the-nordics
2. **Official site**: https://www.vippsmobilepay.com (Norway: https://vipps.no, Denmark: https://mobilepay.dk, Finland: https://mobilepay.fi)
3. **Where it works**: Norway (Vipps, NOK), Denmark and Finland (MobilePay, DKK/EUR), plus Sweden for merchants; cross-border P2P between these markets (terms §21.5).
4. **Transfer characteristics**: account-to-account payments are immediate; card-to-account up to transaction day + 3 bank days (terms §19.2). "After you have approved a payment, you cannot revoke it" (§19.3). But payments funded from a **card** can be disputed with the card issuer (chargeback) **(inferred from terms' card-funding rules)**. Limits set by Vipps (§3.2, vipps.no). Risk: medium.
5. **Crypto stance**: no crypto-specific clause found. However terms §4.4 forbid using Vipps "to send and/or receive payments for commercial or business purposes" — relevant to habitual P2P sellers.
6. **Legal flags**: commercial-use ban (above). Terms checked are the Norwegian ones; Danish/Finnish MobilePay terms not separately checked.
7. **Name check**: current name OK until 12 Jan 2027; afterwards the app is "Vipps" everywhere. Suggest display name "Vipps / MobilePay" now, "Vipps" from 2027.
8. **Verdict**: verified-with-flags (commercial-use ban; card-chargeback route; rename pending).

## TWINT — TWINT

1. **Status**: operating. Source: https://www.twint.ch/en/private-customers/payment/send-and-request-money/
2. **Official site**: https://www.twint.ch (TWINT AG)
3. **Where it works**: Switzerland (and Liechtenstein **(inferred)**), CHF; bank TWINT apps linked to Swiss accounts, plus TWINT Prepaid.
4. **Transfer characteristics**: instant P2P. TWINT FAQ: sending money "can generally not be cancelled" (exceptions for unregistered recipients, auto-cancel after 4 days) — https://www.twint.ch/en/faq/possible-cancel-transfer/ (indexed excerpt). Limits differ per bank app; prepaid app CHF 500–1,000/month — https://www.twint.ch/en/faq/what-are-the-top-up-and-purchase-limits-for-twint/. Risk: low.
5. **Crypto stance**: no explicit crypto clause confirmed. TWINT terms §1.8: app "may not be used for commercial purposes"; receiving P2P payments from commercial sales is not permitted — https://www.twint.ch/en/app-conditions-use/ (indexed excerpt; v8.0 July 2024). One search summary claimed the German terms mention cryptocurrencies; I could not confirm it (PDF blocked).
6. **Legal flags**: commercial-use ban.
7. **Name check**: "TWINT" correct.
8. **Verdict**: verified-with-flags (commercial-use ban).

## SBP — SBP (Russia)

catalog legalReview: "sanctions: needs lawyer sign-off before launch" — facts below only; no recommendation.

1. **Status**: operating. Source: https://sbp.nspk.ru/faq
2. **Official site**: https://sbp.nspk.ru ; operator Bank of Russia, operational & clearing centre NSPK (https://www.cbr.ru/press/event/?id=1793)
3. **Where it works**: Russia, RUB, between participating Russian banks.
4. **Transfer characteristics**: instant, 24/7. One transfer must be under RUB 1 million by law; banks set lower limits; free up to RUB 100k/month between people (https://sbp.nspk.ru/blog/limity-perevodov-po-sbp). Since 25 Jul 2024 banks must hold transfers to accounts in the Bank of Russia fraud database for 2 days, and must **refund the sender within 30 days** if they failed to do so (https://cbr.ru/press/event/?id=18865, https://cbr.ru/press/event/?id=16898) — a seller's incoming SBP money can be clawed back/frozen. Risk: medium.
5. **Crypto stance**: yes. Bank of Russia recommendations 16-MR (2021) tell banks to detect/limit P2P transfers linked to buying/selling digital currency via "drops" (https://www.cbr.ru/press/event/?id=18468). Federal Law 282-FZ of 4 Aug 2026 "On digital currencies and digital rights" (in force 1 Sep 2026) lets only licensed intermediaries organise crypto circulation; crypto payments inside Russia stay banned (http://publication.pravo.gov.ru/document/0001202608040007, https://www.cbr.ru/press/event/?id=32719).
6. **Legal / sanctions flags**:
   - **EU**: 19th package (23 Oct 2025) prohibits EU operators from engaging with Mir and SBP (Council press release https://www.consilium.europa.eu/en/press/press-releases/2025/10/23/19th-package-of-sanctions-against-russia-eu-targets-russian-energy-third-country-banks-and-crypto-providers/ ; Commission https://finance.ec.europa.eu/news/eu-adopts-19th-package-sanctions-against-russia-2025-10-23_en). Secondary sources say the ban applies from 25 Jan 2026 via Reg. (EU) 2025/2033 (Art. 5ac Reg. 833/2014) — confirm on EUR-Lex.
   - **US**: SBP operator is the Central Bank of Russia — OFAC Directive 4 under E.O. 14024 (28 Feb 2022) prohibits US persons' transactions involving the CBR (https://ofac.treasury.gov/recent-actions/20220228). NSPK (SBP's operational centre) is an SDN since 23 Feb 2024 (https://home.treasury.gov/news/press-releases/jy2117).
   - **UK**: NSPK designated 15 Oct 2025 (asset freeze + trust services; UK ref RUS3076) — https://assets.publishing.service.gov.uk/media/68efa9412adc28a81b4ad10b/Notice_Russia_151025.pdf. SBP itself not separately listed.
7. **Name check**: official English name is "Faster Payments System (SBP)" / "Система быстрых платежей". Suggest "SBP — Faster Payments System (Russia)".
8. **Verdict**: verified-with-flags (sanctions — lawyer).

## MIR — Mir card

catalog legalReview: "sanctions: needs lawyer sign-off before launch" — facts below only; no recommendation.

1. **Status**: operating in Russia. Source: https://www.nspk.ru (operator AO NSPK); NSPK said sanctions do not affect domestic operations (https://interfax.com/newsroom/top-stories/99819/ — press).
2. **Official site**: https://mironline.ru / https://www.nspk.ru
3. **Where it works**: Russia, RUB. Foreign acceptance shrank sharply after US designation (Armenia, Kyrgyzstan dropped 2024; mainly Belarus and a few others) — press only; NSPK no longer publishes the list (https://www.dailysabah.com/business/economy/russia-hides-details-but-says-mir-bank-cards-still-work-in-turkiye/amp).
4. **Transfer characteristics**: card-to-card P2P via issuing banks; same Russian anti-fraud hold/refund rules as SBP (cbr.ru links above). Card transfers additionally carry issuer dispute/fraud-reversal paths **(inferred)**. Risk: high.
5. **Crypto stance**: yes — same Russian framework as SBP (16-MR; 282-FZ).
6. **Legal / sanctions flags**:
   - **US**: National Payment Card System JSC (Mir operator) designated under E.O. 14024 on **23 Feb 2024** — https://home.treasury.gov/news/press-releases/jy2117
   - **UK**: JSC National Card Payment System (NSPK) designated **15 Oct 2025**, asset freeze + trust services, ref RUS3076 — https://assets.publishing.service.gov.uk/media/68efa9412adc28a81b4ad10b/Notice_Russia_151025.pdf ; https://www.gov.uk/government/publications/list-of-russia-sanctions-targets-15-october-2025/list-of-russia-sanctions-targets-15-october-2025
   - **EU**: 19th package bars EU operators from engaging with Mir (Council link under SBP).
7. **Name check**: "Mir card" fine; official "Mir" (Платёжная система «Мир»).
8. **Verdict**: verified-with-flags (sanctions — lawyer).

## YOOMONEY — YooMoney

catalog legalReview: "sanctions: needs lawyer sign-off before launch" — facts below only; no recommendation.

1. **Status**: operating. Source: https://yoomoney.ru
2. **Official site**: https://yoomoney.ru (YooMoney LLC; formerly Yandex.Money; Sberbank subsidiary per OFAC release below)
3. **Where it works**: Russia, RUB wallets; terms distinguish residents/non-residents (https://yoomoney.ru/document/soglashenie-ob-osushestvlenii-perevodov-denejnix-sredstv-bez-otkritiya-bankovskogo-scheta-s-ispolzovaniem-servisa-yoomoney-534545).
4. **Transfer characteristics**: wallet-to-wallet instant, no fee; named/identified wallet needed; YooMoney says a credited transfer cannot be recalled by the system (https://yoomoney.ru/prodengi/kak-vernut-dengi-otpravlennie-po-oshibke). Risk: low (Russian anti-fraud freezes still apply **(inferred)**).
5. **Crypto stance**: yes — "Кошелёк ЮMoney запрещено использовать для операций… купли-продажи или обмена… криптовалют" — https://yoomoney.ru/prodengi/kakie-perevodi-banki-i-yoomoney-schitayut-podozritelnimi-i-blokiruyut
6. **Legal / sanctions flags**:
   - **US**: "Limited Liability Company Yoomoney" listed as Sberbank subsidiary, fully blocked **6 Apr 2022** under E.O. 14024 — https://home.treasury.gov/news/press-releases/jy0705 (earlier CAPTA listing 24 Feb 2022, per aggregators).
   - **UK / EU**: no separate YooMoney listing found. Parent Sberbank is designated in the UK and under EU measures; ownership/control rules may extend restrictions to subsidiaries — for the lawyer (not verified against current consolidated lists).
7. **Name check**: "YooMoney" correct (ЮMoney).
8. **Verdict**: verified-with-flags (SDN; crypto clause).

## UKRAINE_CARD — Ukrainian bank card transfer

Generic — no provider to verify (any Ukrainian bank card, Visa/Mastercard/ПРОСТІР).

1. **Status**: card-to-card (P2P) transfers operate normally inside Ukraine.
2. **Official site**: regulator — National Bank of Ukraine, https://bank.gov.ua
3. **Where it works**: Ukraine, UAH. Cross-border P2P from UAH cards restricted under martial-law Resolution No. 18 (https://bank.gov.ua/admin_uploads/law/Resolution_24022022_18_kp.pdf); crypto purchases classed as "quasi-cash" (amendment No. 58, https://bank.gov.ua/admin_uploads/law/21032022_58.pdf).
4. **Transfer characteristics**: typically seconds. Temporary NBU cap of UAH 150k/month (Oct 2024–Mar 2025) was not extended; banks under a memorandum now set risk-based limits for clients without confirmed income — https://bank.gov.ua/en/news/all/natsionalniy-bank-ukrayini-ne-prodovjiv-regulyatorne-obmejennya-v-rozmiri-150-000-grn-na-misyats-dlya-perekaziv-fizichnih-osib-z-karti-na-kartu . Card-funded P2P can be reversed on fraud/stolen-card claims, and anti-"drop" bank blocking is common **(inferred)**. Risk: medium.
5. **Crypto stance**: unknown at provider level (generic). Bank-specific.
6. **Legal flags**: virtual-asset bill 10225-d passed first reading 3 Sep 2025; no second reading found as of this check (https://www.ukrinform.net/rubric-economy/4032431-ukrainian-parliament-backs-bill-to-legalize-cryptocurrency.html — press). Martial-law FX rules change often.
7. **Name check**: fine as a generic label.
8. **Verdict**: verified-with-flags (generic; anti-drop regime; unsettled crypto law).

## KASPI — Kaspi

1. **Status**: operating. Source: https://guide.kaspi.kz/client/ru/gold/transfers/client (© 2012–2026, Kaspi Bank JSC licence renewed 13.07.2026).
2. **Official site**: https://kaspi.kz
3. **Where it works**: Kazakhstan, KZT (Kaspi Gold card / Kaspi.kz app); transfers by phone or card number.
4. **Transfer characteristics**: Kaspi-to-Kaspi transfers instant; max **2 million KZT per day** to other people, no count limit (same guide page). No sender cancel documented. Risk: low.
5. **Crypto stance**: yes (stated policy, secondary source). Kaspi told press that on signs of buying or selling crypto-assets it may terminate the relationship, as crypto is not a permitted means of payment in Kazakhstan — https://digitalbusiness.kz/2025-03-17/p2p-perevodi-sprovotsirovali-blokirovki-schetov-v-kaspi-v-dele-zameshani-kripta-i-narkotiki/ (no clause found in Kaspi's own terms).
6. **Legal flags**: Kazakhstan restricts resident crypto trading to licensed (AIFC/AFSA) venues; March 2025 prosecutors froze Kaspi card accounts in a case linked to P2P crypto (same source). Kazakh banks have been hit by EU secondary sanctions (19th package) — Kaspi not among them as far as found.
7. **Name check**: suggest "Kaspi.kz (Kaspi Gold transfer)".
8. **Verdict**: verified-with-flags (crypto restriction; account-freeze risk).

---

## Proposed catalog changes (proposals only)

- **VIPPS_MOBILEPAY**: plan rename to "Vipps" effective 12 Jan 2027 (Vipps MobilePay AS → Vipps AS); add a note that private-user terms ban commercial use.
- **SBP**: rename to "SBP — Faster Payments System (Russia)". Keep existing legalReview; add detail "EU 19th package bars EU operators from SBP; operator Bank of Russia (OFAC Directive 4); NSPK SDN (US) and UK-designated".
- **MIR**: keep legalReview; add detail "NSPK: OFAC SDN 23 Feb 2024; UK designated 15 Oct 2025; EU operators barred".
- **YOOMONEY**: keep legalReview; add detail "OFAC SDN 6 Apr 2022 (Sberbank subsidiary)".
- **KASPI**: rename to "Kaspi.kz (Kaspi Gold)"; new legalReview "crypto: provider may close accounts; KZ restricts off-exchange crypto".
- **PAYSERA**: new flag "crypto: provider terms forbid crypto trading".
- **TWINT**: new flag "terms ban receiving P2P payments for commercial sales".
- **REVOLUT**, **MONESE**: new flag "UK APP-scam reimbursement — incoming payments can be clawed back up to 13 months".
- **UKRAINE_CARD**: new legalReview "martial-law FX/P2P rules and pending virtual-asset law — check before launch".
- No removals proposed (sanctions entries are the lawyer's call).
