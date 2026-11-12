# O-041: sanctions check of the 45 launch currencies (research, 12 Nov 2026)

Owner rule (F12, owner-decisions-2026-11-06.md:40): "never sanctioned currencies, and check the 45 as well, including RUB". Register O-041 and B-009.
This is research only. It is not legal advice. Nothing here was changed in code. Every recommendation below is an owner or lawyer call.

The list checked is `apps/api/src/price/currencies.ts` on main 6ebed537 (`CURRENCY_EXPONENTS`, 45 codes):
USD EUR GBP CAD AUD NZD CHF SEK NOK DKK PLN CZK HUF UAH TRY RUB GEL ILS AED SAR BHD KWD ZAR NGN BRL ARS CLP MXN BMD CNY HKD TWD JPY KRW SGD MYR THB IDR PHP VND INR PKR BDT LKR MMK.

How to read it: no regime (OFAC, EU, UK or UN) sanctions a currency as such. Sanctions attach to countries or regions, to listed persons (banks, payment operators, individuals), and to kinds of service. So the real question is whether trading in a currency mostly means dealing with sanctioned jurisdictions, banks or rails. Iran, North Korea, Cuba and Syria are NOT in the 45 (IRR, KPW, CUP and SYP are absent). The US comprehensive Syria programme ended on 1 July 2025 (EO 14312). Targeted measures remain.

## Summary

| Code | Country | OFAC | EU | UK | UN | FATF (30 Oct 2026) | What it means for X2F |
|---|---|---|---|---|---|---|---|
| **RUB** | Russia | Broad list-based programme (EO 14024 and others): most big banks are SDN (e.g. Sberbank). Transaction ban with the Central Bank. The Mir operator NSPK is designated (Feb 2024). EO 14114 secondary-sanctions risk for foreign banks. | Very broad, under Reg. 833/2014. **Art. 5b: no crypto-asset services of any kind to Russian nationals, residents or entities.** Art. 5bb: no transactions with Russia-based crypto platforms. Art. 5ba: A7A5/RUBx ruble stablecoins banned. SWIFT bans on most large banks (incl. Sberbank). | Broad (Russia regs): most big banks designated. Crypto services to Russia-connected persons are restricted (exact current scope needs lawyer confirmation). | None | Not listed (membership suspended) | **Highest risk. Recommend removing RUB before launch (owner call).** Almost every RUB payment runs through a designated bank, the CBR-run SBP or the NSPK-run Mir. The EU ban is on services to Russian persons themselves, not just to banks. A non-custodial escrow that holds a moderator key may still count as a "crypto-asset service" (lawyer question L1). The SBP, MIR and YOOMONEY methods are already flagged `legalReview` in data/payment-methods.json. They should be blocked together with RUB. |
| **MMK** | Myanmar (Burma) | List-based (EO 14014): the regime's banks Myanma Foreign Trade Bank and Myanma Investment and Commercial Bank are designated (2023). MOGE is also designated (scope differs between sources). | Targeted plus an arms embargo, renewed to 30 Apr 2027 (Decision (CFSP) 2026/927). | Targeted (Myanmar regime) | None (no UN regime) | **Black list** ("call for action", enhanced due diligence) | **High risk. Recommend removing, or holding MMK until a lawyer signs off (owner call).** It is not under a country embargo, but the FATF black list means banks expect enhanced due diligence, and FX conversion runs through designated state banks. P2P is common (KBZPay, WavePay). |
| **UAH** | Ukraine | Ukraine is not sanctioned. **Crimea, the so-called DNR and LNR are under comprehensive OFAC embargoes** (EO 13685, EO 14065). | Crimea/Sevastopol and the non-government-controlled areas of Donetsk, Luhansk, Kherson and Zaporizhzhia are embargoed. | The same regions | None | Not listed | **Keep.** The risk is about where traders are, not the currency (those regions mostly use RUB). X2F does not collect location. The Terms could say no use from embargoed regions (lawyer question L3). |
| **CNY**, **HKD** | China, Hong Kong | No country programme. Targeted lists (military-industrial companies, etc.). The Hong Kong EO 13936 was not renewed and has expired (reported July 2026; one source). | Targeted (Russia-evasion listings, incl. some Chinese crypto providers in Annex XLV) | Targeted | None | Not listed | **Keep.** Watch that payment details never name a listed firm. Hong Kong and China are evasion routes for Russia, so expect enhanced due diligence from partners. |
| **AED**, **TRY**, **GEL** | UAE, Türkiye, Georgia | No country programme. Many entities listed for helping Russia evade sanctions. | Same. Art. 5bc lets the EU list whole third countries for crypto (none listed yet). | Same | None | Not listed | **Keep.** Known transit routes for RUB money. If the EU ever lists one of them under Art. 5bc, crypto transactions with that country become banned. Re-check at each EU package. |
| **KWD**, **VND** | Kuwait, Vietnam | None | None | None | None | **Grey list** (increased monitoring) | **Keep.** The grey list is not a sanction. It may bring extra checks from banks and price sources only. |
| All others (USD EUR GBP CAD AUD NZD CHF SEK NOK DKK PLN CZK HUF ILS SAR BHD ZAR NGN BRL ARS CLP MXN BMD TWD JPY KRW SGD MYR THB IDR PHP INR PKR BDT LKR) | - | No country programme (individual SDNs only) | Same | Same | None | Not listed (Nigeria and South Africa are no longer on the grey list) | Keep. |

UN: none of the 45 belongs to a country under a UN sanctions regime. UN regimes cover DPRK, Iran (snapback in Sept 2025), Libya, Somalia, South Sudan, Sudan, Yemen, CAR, DRC, Haiti, Iraq/Lebanon-related, the Taliban and ISIL/Al-Qaida. None of their currencies is in the list.

## What I recommend (for the owner, with the lead)

1. **RUB: take it out of the launch list**, together with the SBP, MIR and YOOMONEY methods. That fits "never sanctioned currencies" most directly. If he wants to keep it, it must wait for lawyer sign-off on L1 and L2. Code impact is small: one line in `CURRENCY_EXPONENTS`. But live RUB offers and the proof/amount tables (packages/proof amounts.ts '₽') need a decision, and the currency dropdown hides a currency with no price.
2. **MMK: hold it until a lawyer signs off** (FATF black list, designated state banks). The owner may prefer simply to remove it.
3. **Keep the other 43.** Add a standing check: re-run this audit at every EU package or OFAC Russia action, and before O-052 adds currencies (the Coinbase and BitPay lists include IRR and other sanctioned codes).
4. **Sanctions screening is a separate question from currencies.** Any SDN/EU/UK list screening of user-entered payment details or names is a product and privacy decision for the owner (X2F stores little identity). I am not recommending it here, only noting the gap.

## Lawyer questions (add to lawyer-questions.md if the lead agrees)

- **L1.** Does X2F (non-custodial 2-of-3 multisig; X2F holds at most the moderator key; collects a 1% fee) provide a "crypto-asset service" or "custody service" under EU Reg. 833/2014 Art. 5b to a Russian national or resident? Does that depend on where the operator is established?
- **L2.** If the operator is a US person, or uses US infrastructure, does matching two people who settle RUB through an SDN bank (Sberbank, VTB), the CBR's SBP or NSPK's Mir count as facilitation under EO 14024?
- **L3.** Is a Terms clause ("not for use from Crimea, DNR, LNR or other embargoed regions") enough, given that X2F collects no location? Or is IP blocking expected?
- **L4.** Which home-jurisdiction sanctions law applies to the operator? If the operator is Canadian, for example, the Special Economic Measures (Russia) and (Burma) Regulations should be checked too. This note did not research Canada.

## Sources (checked 12 Nov 2026; several are secondary, so confirm against the official lists)

- OFAC Sanctions Programs Atlas: https://ofac.treasury.gov/sanctions-programs-atlas
- Syria programme ended (EO 14312): https://www.hklaw.com/en/insights/publications/2025/07/executive-order-terminates-syria-sanctions , https://www.arnoldporter.com/en/perspectives/advisories/2025/07/united-states-terminates-syria-sanctions-program
- Hong Kong EO 13936 expiry: https://www.hugheshubbard.com/news-insights/insights/sanctions-in-a-snap-developments-in-sanctions-july-2026
- Russia, US and EU status 2026: https://www.sanctionscanner.com/blog/russia-sanctions-2026-complete-guide-to-ofacs-eo-14024-framework-1361 , https://euromaidanpress.com/2026/03/19/us-ofac-russia-sanctions-removed-march-2026/ , https://www.mayerbrown.com/en/insights/publications/2026/10/russia-ukraine-sanctions-update-month-of-october-2026
- NSPK (Mir) designation, Feb 2024: https://home.treasury.gov/news/press-releases/jy2117 . YooMoney's SDN status is unclear (one mirror shows it removed in Oct 2025); check OFAC directly.
- EU crypto rules (Art. 5b, 5ba, 5bb, 5bc): https://www.bakermckenzie.com/en/insight/publications/2026/09/european-union-sanctions-compliance-for-crypto-assets , https://www.skadden.com/-/media/files/publications/2022/04/us-uk-and-eu-impose-new-sanctions-and-export-controls/faqssanctionsrussiacryptoassets_en.pdf
- Garantex/Grinex/A7A5 (ruble crypto routes): https://home.treasury.gov/news/press-releases/sb0225
- Myanmar: https://www.lovguiden.dk/en/det-offentlige/eur-lex-lovgivning/2026-04-28-eu-forlaenger-myanmar-sanktioner-til-2027-og-opdaterer-liste , https://home.treasury.gov/news/press-releases/jy1555 , https://www.gov.uk/guidance/myanmar-list-of-designations-and-sanctions-notices
- FATF, 30 Oct 2026 (the official page refused the fetch with a 403, so the list was read from a summary): https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-october-2026.html , https://amluae.com/?p=79294
