# Sanctioned countries: what was removed (12 Nov 2026)

Owner rulings, 12 Nov 2026, relayed by the lead:

- "Russian anything is banned." Russia only. Ukrainian, Kazakh and other Cyrillic-script countries' currencies and methods stay, and so does Cyrillic OCR.
- "Anything Iranian unfortunately is banned too" (owner-decisions-2026-11-06.md).
- "I'm sticking to the US sanction laws." The removal follows US OFAC sanctions, not a list picked by hand.

This is engineering, not legal advice. The borderline list below is for the owner and the lawyer.

## Removed

| What | Where | Why |
|---|---|---|
| RUB | `apps/api/src/price/currencies.ts` (price list 45 to 44) | Owner: Russia banned |
| SBP, MIR, YOOMONEY | `data/payment-methods.json` (127 to 124), `packages/trade/src/payFields.ts` | Owner: Russia banned |
| Existing offers in RUB or with SBP, MIR or YOOMONEY | migration `770_no_russia.sql`: status `removed`, payment details blanked | Nothing usable is left. An offer's parts are written once (J-16), so an offer that is only partly Russian is removed whole. Lead default, owner question: the ruling does not say; no notice is sent and no audit row is written (review m-3). |

Guards, so these cannot come back by accident:

- `BANNED_CURRENCIES` (RUB, IRR, KPW, CUP, CUC). The price module refuses to load if any of them is on the list.
- `BANNED_METHOD_IDS` (SBP, MIR, YOOMONEY). The catalog refuses to load if any of them is in `data/payment-methods.json`.

The API refuses all of them with 400, the same as an unknown currency or method.

Iran (IRR), North Korea (KPW) and Cuba (CUP, CUC) were never on the price list. No catalog method is specific to them; there is no Shetab or other Iranian card method. The guards keep them off.

## Comprehensive OFAC programmes (checked 12 Nov 2026)

OFAC FAQ 10 (updated 26 Oct 2026) lists these jurisdictions as under broad (comprehensive) sanctions: Cuba, Iran, North Korea, the Crimea region of Ukraine, and the so-called DNR and LNR regions of Ukraine. https://ofac.treasury.gov/faqs/10

- **Iran:** comprehensive. IRR is banned (never listed). https://ofac.treasury.gov/sanctions-programs-and-country-information (Iran Sanctions)
- **North Korea:** comprehensive. KPW is banned (never listed).
- **Cuba:** comprehensive (CACR, 31 CFR 515, plus EO 14404, May 2026). CUP and CUC are banned (never listed). https://ofac.treasury.gov/sanctions-programs-and-country-information/cuba-sanctions
- **Crimea, so-called DNR and LNR:** comprehensive, but they have no currency of their own (in practice they use RUB, now removed). UAH stays. X2F collects no location. Whether the Terms should name these regions is lawyer question L3 (research-o041).
- **Syria: not removed.** The comprehensive programme ended on 1 July 2025 (EO 14312), and the Syrian Sanctions Regulations were taken out of the CFR in Aug 2025. What remains is the list-based PAARSS programme. SYP was never on the price list. https://ofac.treasury.gov/sanctions-programs-and-country-information/syria-sanctions-inactive-and-archived , https://ofac.treasury.gov/recent-actions/20250825 , https://home.treasury.gov/news/press-releases/sb0183 , https://ofac.treasury.gov/sanctions-programs-and-country-information/paarss
- **Russia:** under US law this is a broad list-based and sectoral programme, not a comprehensive embargo. It covers EO 14024, EO 14071's new-investment and services bans, and Directive 4 (Central Bank). NSPK, the Mir operator, was designated in Feb 2024. Russia is removed because the owner ruled it, not because of OFAC FAQ 10. https://ofac.treasury.gov/sanctions-programs-and-country-information/russian-harmful-foreign-activities-sanctions , https://home.treasury.gov/news/press-releases/jy2117

## Borderline: kept, for the owner and the lawyer

| Country | Code on our list? | OFAC programme | Recommendation |
|---|---|---|---|
| Myanmar (Burma) | **MMK, yes** | Burma-Related Sanctions, EO 14014 (list-based; state banks MFTB and MICB designated). https://ofac.treasury.gov/sanctions-programs-and-country-information/burma | Keep until the lawyer rules. Research-o041 suggests holding MMK because of the FATF black list and the designated state banks. |
| Venezuela | VES, no | Venezuela-Related Sanctions: government blocking (EO 13884), list-based otherwise. Named in FAQ 10 as a blocked government, not as a comprehensive jurisdiction. https://ofac.treasury.gov/faqs/10 | Nothing to remove. Do not add VES without lawyer sign-off. |
| Belarus | BYN, no | Belarus Sanctions, EO 14038 (list-based). https://ofac.treasury.gov/sanctions-programs-and-country-information | Nothing to remove. Do not add BYN without lawyer sign-off. |
| Syria | SYP, no | PAARSS (list-based since 1 Jul 2025), sources above | Nothing to remove. |
| Nicaragua, Sudan, South Sudan, Libya, Somalia, Yemen, Mali, CAR, DRC, Iraq, Lebanon, Afghanistan, Balkans | none on our list | List-based country programmes. https://ofac.treasury.gov/sanctions-programs-and-country-information | Nothing to remove. Re-check before adding any of their currencies. |
| Ukraine | UAH, yes | Not sanctioned. Only the occupied regions above are. | Keep (owner). |

## Left alone on purpose

- **OCR and text:** `packages/proof` keeps the `₽` symbol, RUB, IRR, KPW and CUP in its ISO 4217 detection tables. Owner: Cyrillic OCR stays. Reading a figure on a proof is not offering a currency.
- **Gift-card countries** (lead, 12 Nov, following the owner's rule): no gift card from RU, IR, KP or CU. `BANNED_GIFT_CARD_COUNTRIES` in `packages/trade/src/giftCards.ts` makes `giftCardCurrencyOk` false for them, so the API refuses such an offer with 400. The web picker (`apps/web/src/screens/post/countries.ts`) lists 245 countries instead of 249. The ISO table itself still maps those four to their currencies, as an ISO record.
- **Research and history** (`research/`, past plans and reviews): left as written records.
- **Trades already running** in RUB or on SBP, MIR or YOOMONEY when this deploys finish normally (lead, 12 Nov, review m-2; lead default, owner question: the ruling does not say). A funded escrow can only be stopped by a moderator, so only new offers and new takes are refused. A dispute on such a trade fails closed: with no RUB price, the trade's USD value is set to the limit and the two-person rule applies (`disputeUsdCents`). Release and refund need no price. Test: `events-route.test.ts`, "a trade taken before the ban ... finishes normally". Payment details on such a trade: the payee's chat card falls back to the one free-text box, since the method has no row in `payFields.ts` any more; a package an older bundle sealed with SBP's old boxes is refused for its contents and the payer sees "Their payment details couldn't be shown. Ask them to send again." (payee-fields-2 m-4). The offer's instructions locked on the trade (`trades.method_instructions`) stay until the trade's own retention purge. Tests: `packages/trade/test/payFields.test.ts`, "a trade taken before the 12 Nov ban".
- **Reviews and the revenue ledger:** past rows keep their method and currency. Nothing there can be posted or taken.

## Owner questions (lead defaults until he answers)

- **Existing offers** in RUB or with SBP, MIR or YOOMONEY: removed whole by migration 770 and their payment details blanked, with no notice to the poster (review m-3). Alternative: a one-line notice to affected accounts.
- **Trades already running**: they finish (review m-2). This includes a trade taken but not yet funded at deploy time, which the seller can still fund afterwards. Alternative: a moderator refunds funded ones, and unfunded ones are cancelled.
- **Gift cards from RU, IR, KP or CU** are refused: the lead's reading of "block their currencies and payment methods that are unique to areas on sanction lists" (a gift card for one of those countries is unique to it).
- **Myanmar (MMK)** stays, as a borderline list-based programme, until the owner or the lawyer rules.
