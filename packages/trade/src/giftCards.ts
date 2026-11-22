/**
 * Gift-card rules (J-17; owner G50-G52 of 7 Nov, F13 and its decision T-081). Shared by the API (the
 * post and take checks) and the web (the post form, the quote's tick-box terms and the trade room's
 * evidence checklist). Only keys live here: every sentence a person reads is in the web's
 * `giftCardCopy.ts`, COPY-UNSIGNED until design (J-31, T-058) writes the rules text.
 *
 * - G51: the card was bought within the last 30 days.
 * - G52: the card carries its full written value. Only a range card (a Visa 200 to 500) may be
 *   partial, and then the sender must give video proof.
 * - G50: the person holding the escrow has 45 minutes to check a card once its details are handed
 *   over (the gift-card method profile's confirm window, apps/api methods/profiles.ts). Video proof:
 *   the sender logs in to the card and shows it right before sending.
 * - T-081: the card's currency follows its country; a short window; an evidence checklist;
 *   tick-box terms.
 */
import type { Party } from './machine.js';

/** G51: how old a card may be, in days from its purchase. */
export const GIFT_CARD_MAX_AGE_DAYS = 30;

/** G50: minutes the escrow holder has to check a card once its details are handed over. */
export const GIFT_CARD_CHECK_MIN = 45;

/**
 * The terms both sides tick, by version. The API refuses a post or take of a gift-card offer that
 * names any other version, so a page showing old words cannot agree to new ones. Bump it whenever a
 * key below or its sentence changes (design's signed words included).
 */
export const GIFT_CARD_TERMS_VERSION = 'gift-card-terms-unsigned-1';

/** Who does what with the card: the XMR buyer sends it (it is their payment); the seller, who holds the escrow, checks it. */
export type GiftCardRole = 'sender' | 'checker';

export function giftCardRole(party: Party): GiftCardRole {
  return party === 'buyer' ? 'sender' : 'checker';
}

export type GiftCardTermKey = 'bought-within-30-days' | 'full-written-value' | 'country-currency' | 'check-window' | 'check-before-release';

/** The tick boxes each side sees, in order (each side sees only its own; per-reader terms). */
export const GIFT_CARD_TERMS: Readonly<Record<GiftCardRole, readonly GiftCardTermKey[]>> = Object.freeze({
  // G51, G52, T-081, G50 (the sender knows the other side has 45 minutes).
  sender: Object.freeze(['bought-within-30-days', 'full-written-value', 'country-currency', 'check-window'] as const),
  // G50 (check within 45 minutes), G52 (the receiver's due diligence), T-081.
  checker: Object.freeze(['check-window', 'check-before-release', 'country-currency'] as const),
});

export function giftCardTermsComplete(role: GiftCardRole, ticked: ReadonlySet<string>): boolean {
  return GIFT_CARD_TERMS[role].every((k) => ticked.has(k));
}

/** G52: what a card's value allows. */
export function giftCardValueRule(rangeCard: boolean): { partialAllowed: boolean; videoProof: boolean } {
  return { partialAllowed: rangeCard, videoProof: rangeCard };
}

export type GiftCardEvidenceKey = 'receipt' | 'card-photo' | 'login-video' | 'check-result';

/**
 * An evidence item. `always`: kept on every gift-card trade; `range-card`: required only for a range
 * card (optional otherwise, G50 "we should allow for video proof"). `seam`: the upload is built
 * elsewhere (video proof is the lead's, T-054).
 */
export interface GiftCardEvidenceSpec {
  key: GiftCardEvidenceKey;
  needed: 'always' | 'range-card';
  seam?: 'video-proof';
}

export const GIFT_CARD_EVIDENCE: Readonly<Record<GiftCardRole, readonly GiftCardEvidenceSpec[]>> = Object.freeze({
  sender: Object.freeze([
    // G51: the receipt shows the purchase date.
    { key: 'receipt', needed: 'always' },
    // G52: the card's written value (or its range).
    { key: 'card-photo', needed: 'always' },
    // G50, G52: logging in to the card right before sending. NEEDS(lead, T-054): the video upload.
    { key: 'login-video', needed: 'range-card', seam: 'video-proof' },
  ] as const),
  // G50, G52: what the check showed, inside the 45 minutes.
  checker: Object.freeze([{ key: 'check-result', needed: 'always' }] as const),
});

export interface GiftCardEvidenceItem {
  key: GiftCardEvidenceKey;
  required: boolean;
  seam?: 'video-proof';
}

/** The checklist for one side of one trade. */
export function giftCardEvidence(role: GiftCardRole, card: { rangeCard: boolean }): GiftCardEvidenceItem[] {
  const video = giftCardValueRule(card.rangeCard).videoProof;
  return GIFT_CARD_EVIDENCE[role].map((e) => ({
    key: e.key,
    required: e.needed === 'always' || video,
    ...(e.seam ? { seam: e.seam } : {}),
  }));
}

/**
 * T-081: the currencies a card from each country is in: ISO 3166-1 alpha-2 to the ISO 4217 codes of
 * that entity's legal tender (ISO 4217 table A.1, fund and precious-metal codes left out), as of
 * November 2026 (Croatia and Bulgaria on the euro; Sierra Leone SLE; Zimbabwe ZWG; Curaçao and Sint
 * Maarten XCG). Empty where ISO gives "no universal currency". A currency the price feed does not
 * quote cannot be offered anyway (the offer's own currency check).
 */
const C = (codes: string): readonly string[] => Object.freeze(codes === '' ? [] : codes.split(' '));
const byCurrency = (currency: string, countries: string): [string, readonly string[]][] =>
  countries.split(' ').map((k) => [k, C(currency)]);

export const GIFT_CARD_CURRENCIES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries<readonly string[]>([
    ...byCurrency('EUR', 'AD AT AX BE BG BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA YT'),
    ...byCurrency('USD', 'AS BQ EC FM GU IO MH MP PR PW TC TL UM US VG VI'),
    ...byCurrency('GBP', 'GB GG IM JE'),
    ...byCurrency('AUD', 'AU CC CX HM KI NF NR TV'),
    ...byCurrency('NZD', 'CK NU NZ PN TK'),
    ...byCurrency('CHF', 'CH LI'),
    ...byCurrency('NOK', 'BV NO SJ'),
    ...byCurrency('DKK', 'DK FO GL'),
    ...byCurrency('XCD', 'AG AI DM GD KN LC MS VC'),
    ...byCurrency('XOF', 'BF BJ CI GW ML NE SN TG'),
    ...byCurrency('XAF', 'CF CG CM GA GQ TD'),
    ...byCurrency('XPF', 'NC PF WF'),
    ...byCurrency('XCG', 'CW SX'),
    ...byCurrency('MAD', 'EH MA'),
    ['PA', C('PAB USD')], ['SV', C('SVC USD')], ['HT', C('HTG USD')], ['BT', C('BTN INR')],
    ['LS', C('LSL ZAR')], ['NA', C('NAD ZAR')], ['ZA', C('ZAR')], ['IN', C('INR')],
    ['AQ', C('')], ['GS', C('')], ['PS', C('')],
    ...(
      'AE:AED AF:AFN AL:ALL AM:AMD AO:AOA AR:ARS AW:AWG AZ:AZN BA:BAM BB:BBD BD:BDT BH:BHD BI:BIF BM:BMD BN:BND ' +
      'BO:BOB BR:BRL BS:BSD BW:BWP BY:BYN BZ:BZD CA:CAD CD:CDF CL:CLP CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CZ:CZK ' +
      'DJ:DJF DO:DOP DZ:DZD EG:EGP ER:ERN ET:ETB FJ:FJD FK:FKP GE:GEL GH:GHS GI:GIP GM:GMD GN:GNF GT:GTQ GY:GYD ' +
      'HK:HKD HN:HNL HU:HUF ID:IDR IL:ILS IQ:IQD IR:IRR IS:ISK JM:JMD JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KM:KMF ' +
      'KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LK:LKR LR:LRD LY:LYD MD:MDL MG:MGA MK:MKD MM:MMK MN:MNT ' +
      'MO:MOP MR:MRU MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN NG:NGN NI:NIO NP:NPR OM:OMR PE:PEN PG:PGK PH:PHP ' +
      'PK:PKR PL:PLN PY:PYG QA:QAR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP ' +
      'SL:SLE SO:SOS SR:SRD SS:SSP ST:STN SY:SYP SZ:SZL TH:THB TJ:TJS TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TW:TWD ' +
      'TZ:TZS UA:UAH UG:UGX UY:UYU UZ:UZS VE:VES VN:VND VU:VUV WS:WST YE:YER ZM:ZMW ZW:ZWG'
    )
      .split(' ')
      .map((pair): [string, readonly string[]] => {
        const [k, v] = pair.split(':') as [string, string];
        return [k, C(v)];
      }),
  ]),
);

/**
 * Countries a gift card may not come from (owner 12 Nov: Russian anything is banned; anything
 * Iranian too; "I'm sticking to the US sanction laws": Cuba, Iran and North Korea are under
 * comprehensive OFAC sanctions, OFAC FAQ 10). The table above keeps their ISO currencies as fact;
 * no offer may name them (docs/sanctioned-countries-2026-11-12.md).
 */
export const BANNED_GIFT_CARD_COUNTRIES: ReadonlySet<string> = Object.freeze(new Set(['RU', 'IR', 'KP', 'CU']));

/** A known ISO country a gift-card offer may name: not one of BANNED_GIFT_CARD_COUNTRIES. */
export function giftCardCountryAllowed(country: string): boolean {
  return Object.hasOwn(GIFT_CARD_CURRENCIES, country) && !BANNED_GIFT_CARD_COUNTRIES.has(country);
}

/** The currencies a card from `country` is in; empty for an unknown code. */
export function giftCardCurrencies(country: string): readonly string[] {
  return Object.hasOwn(GIFT_CARD_CURRENCIES, country) ? GIFT_CARD_CURRENCIES[country]! : [];
}

/** T-081: a gift-card offer's currency must be one its card's country uses. */
export function giftCardCurrencyOk(country: string, currency: string): boolean {
  return giftCardCountryAllowed(country) && giftCardCurrencies(country).includes(currency);
}
