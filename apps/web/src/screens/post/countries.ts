// The country a gift-card offer names (Revision 2026-10-21; plan Task 4 Revision 2026-10-27): every
// ISO 3166-1 alpha-2 code but RU, IR, KP and CU (owner 12 Nov: Russia, Iran; US sanction laws:
// BANNED_GIFT_CARD_COUNTRIES in @x2f/trade), named in English by the browser's own region names (the code itself
// where a browser has none), sorted by name for the picker.

import { BANNED_GIFT_CARD_COUNTRIES } from '@x2f/trade';

/** The 249 officially assigned ISO 3166-1 alpha-2 codes. */
export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

export interface Country {
  code: string;
  name: string;
}

function regionName(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code);
    return name ?? code;
  } catch {
    return code;
  }
}

/** The countries by English name, for the Country select of a gift-card offer. */
export const COUNTRIES: readonly Country[] = COUNTRY_CODES.filter((code) => !BANNED_GIFT_CARD_COUNTRIES.has(code)).map((code) => ({ code, name: regionName(code) })).sort((a, b) =>
  a.name.localeCompare(b.name, 'en'),
);

export const isCountryCode = (v: unknown): v is string =>
  typeof v === 'string' && COUNTRY_CODES.includes(v) && !BANNED_GIFT_CARD_COUNTRIES.has(v);
