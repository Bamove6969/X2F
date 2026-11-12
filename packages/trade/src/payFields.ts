/**
 * The payee's payment details per payment method (J-08, row S-090; owner p7-3: "those boxes can
 * appear in the chat window on the person's side who is sending that payment type ... they just
 * have to click send, and it sends it all nicely packaged over to the other person").
 *
 * This module is the data and the pure rules, shared by the trader app's chat (which seals the
 * package inside the end-to-end encrypted envelope, apps/web chatCrypto) and anything that later
 * opens one. The API never sees these values: they only ever travel as ciphertext.
 *
 * SOURCE of the table (owner order, 10 Nov 2026: every catalogue method gets its researched
 * mandatory payee fields, so he is not asked method by method): the payee-field research of
 * 2026-11-10 (one row per id in data/payment-methods.json, 127, each with its confidence and
 * sources), with the lead's decisions of the same day applied on top (they override the research
 * where they differ: card numbers allowed only as a receiving identifier, never an expiry date or
 * CVV; personal tax and ID numbers never a box; per-row calls such as SPEI CLABE only, IMPS and
 * DuitNow combined boxes, CUSTOM's multi-line box). Each row's `source` names the confidence, the
 * first source URL and any lead decision. Where a method needs "A or B" the fields share a `oneOf`
 * group: at least one of the group must be filled; a field the payer can do without is optional
 * (`need: 'no'`). Gift cards and face-to-face cash are `payeeGivesNothing`: the buyer sends the card
 * or cash details in the chat, and the seller is shown no boxes (ATM cash was too until the 12 Nov
 * recheck gave it an optional phone box).
 * docs/payment-fields-2026-11-10.md lists every row for the owner's wording page. The 12 Nov recheck
 * (comms research-payee-fields-confirm-2026-11-12, lead 12 Nov) raised confidence on 62 rows, appended
 * to each row's `source`, and applied its corrections; CASH_AT_ATM now has one optional box.
 *
 * Open owner questions on what is required vs optional are listed in the helper's report, not
 * decided here.
 */

export type PayFieldKind = 'text' | 'email' | 'phone' | 'iban' | 'account' | 'postal';

/**
 * Whether a box must be filled: 'yes'; 'no'; or `{ oneOf }`, when at least one box of that group
 * must be (Interac: email or phone, "you just have to have one or the other", owner p7-3).
 */
export type PayFieldNeed = 'yes' | 'no' | { oneOf: string };

export interface PayFieldSpec {
  /** Stable key inside the sealed message (never shown). */
  key: string;
  /** The box's label, on both sides. COPY-UNSIGNED. */
  label: string;
  kind: PayFieldKind;
  need: PayFieldNeed;
  /** The most characters this box takes, when not its kind's PAY_FIELD_MAX_CHARS (review F2: a QRIS string). */
  maxLength?: number;
}

export interface PayFieldsSpec {
  /** The boxes, in order. Empty only when `payeeGivesNothing`. */
  fields: readonly PayFieldSpec[];
  /**
   * The payee has nothing to send (gift cards, face-to-face cash): the buyer sends the card
   * or cash details in the chat. The seller is shown a line in place of the boxes.
   */
  payeeGivesNothing?: true;
  /**
   * A line for the payee shown with the boxes (12 Nov recheck): something the method's own rules mean
   * they should know, e.g. a reference to ask for. COPY-UNSIGNED.
   */
  note?: string;
  /** The research row this was built from: its confidence, first source URL, and any lead decision. */
  source: string;
}

/**
 * The version inside the sealed `pay` payload. 2 since the 10 Nov table (review F3): the keys of
 * almost every method changed, and the text check stopped depending on labels. J-08 never ran live,
 * so a version 1 package has no reader and is refused like any bad shape.
 */
export const PAY_DETAILS_V = 2;

/** The most characters one box takes: a one-line box, and the mailing address. */
export const PAY_FIELD_MAX_CHARS = { line: 120, postal: 400 } as const;
/** The most lines a mailing address takes. */
export const PAY_POSTAL_MAX_LINES = 8;

const spec = (key: string, label: string, kind: PayFieldKind, need: PayFieldNeed, maxLength?: number): PayFieldSpec => (maxLength === undefined ? { key, label, kind, need } : { key, label, kind, need, maxLength });
const yes = (key: string, label: string, kind: PayFieldKind = 'text', maxLength?: number): PayFieldSpec => spec(key, label, kind, 'yes', maxLength);
const no = (key: string, label: string, kind: PayFieldKind = 'text', maxLength?: number): PayFieldSpec => spec(key, label, kind, 'no', maxLength);
const one = (group: string, key: string, label: string, kind: PayFieldKind = 'text', maxLength?: number): PayFieldSpec => spec(key, label, kind, { oneOf: group }, maxLength);

/** The table, by catalog id (data/payment-methods.json), in the catalogue's order and groups. */
export const PAY_FIELDS: Readonly<Record<string, PayFieldsSpec>> = Object.freeze({
  // Payment apps. COPY-UNSIGNED (payee-fields research 2026-11-10): every label in this block.
  UPHOLD: {
    fields: [one('reach', 'email', 'Email on the Uphold account', 'email'), one('reach', 'username', 'Uphold username', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://support.uphold.com/hc/en-us/articles/360038596552; recheck 2026-11-12 (medium): https://gts.ai/defi/how-to-send-crypto-on-uphold',
  },
  MONEY_BEAM: {
    fields: [yes('name', 'Name'), one('reach', 'phone', 'Phone number', 'phone'), one('reach', 'email', 'Email', 'email')],
    source: 'research 2026-11-10 (high): https://support.n26.com/en-de/app-and-features/moneybeam/how-to-use-moneybeam',
  },
  REVOLUT: {
    fields: [one('reach', 'revtag', 'Revtag', 'account'), one('reach', 'phone', 'Phone number', 'phone'), one('reach', 'email', 'Email', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://help.revolut.com/help/transfers/internal-transfers/send-or-request-money-from-other-revolut-customers/',
  },
  GCASH: {
    fields: [yes('phone', 'GCash mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://help.gcash.com/hc/articles/360017566614; recheck 2026-11-12 (high): https://help.gcash.com/hc/en-us/articles/47623669730073-What-is-Express-Send',
  },
  SWISH: {
    fields: [yes('phone', 'Swish mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://www.swedbank.se/privat/digitala-tjanster/swish/fragor-och-svar-om-swish',
  },
  ALI_PAY: {
    fields: [yes('alipayId', 'Alipay ID (phone number or email)', 'account'), yes('name', 'Full name as registered on Alipay (in pinyin or Latin letters)')],
    source: 'research 2026-11-10 (medium): https://wise.com/help/articles/2kTApouGnjRj6JM1yduMIL/sending-cny-via-alipay; recheck 2026-11-12 (medium): https://support.orbitremit.com/hc/en-us/articles/360012806657-Paying-to-an-Alipay-ID',
  },
  WECHAT_PAY: {
    fields: [one('reach', 'weChatId', 'WeChat ID', 'account'), one('reach', 'phone', 'Phone number linked to WeChat', 'phone'), no('name', 'Real name as verified in Weixin Pay (pinyin)')],
    source: 'research 2026-11-10 (low): https://www.expatden.com/china/wechat-pay/; recheck 2026-11-12 (medium): https://www.westernunion.com/sg/en/send-to-wechat.html',
  },
  ZELLE: {
    fields: [one('contact', 'email', 'Email', 'email'), one('contact', 'phone', 'US phone number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://www.zelle.com/blog/how-use-zelle-simple-guide-getting-started',
  },
  MERCADO_PAGO: {
    fields: [one('reach', 'cvu', 'CVU / CBU', 'account'), one('reach', 'alias', 'Alias', 'account'), one('reach', 'email', 'Email', 'email'), one('reach', 'phone', 'Mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.iproup.com/finanzas/31784-como-transferir-y-pedir-plata-por-mercado-pago; lead: Argentina flow (CVU, alias, email or phone); Brazil pays by Pix and Mexico by CLABE, a later per-country refinement; recheck 2026-11-12 (medium): https://www.global66.com/blog/enviar-dinero-por-mercado-pago/',
  },
  MOMO: {
    fields: [yes('phone', 'MoMo phone number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://momo.vn/chuyen-tien',
  },
  ADVANCED_CASH: {
    fields: [one('reach', 'walletId', 'Volet wallet number', 'account'), one('reach', 'email', 'Email registered with Volet', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://profinvestment.com/volet/; recheck 2026-11-12 (medium): https://volet.gitbook.io/volet',
  },
  TRANSFERWISE: {
    fields: [yes('name', 'Name on the account'), one('reach', 'wisetag', 'Wisetag', 'account'), one('reach', 'email', 'Email registered with Wise', 'email'), one('reach', 'phone', 'Phone number registered with Wise', 'phone'), one('reach', 'iban', 'IBAN (EUR and other IBAN currencies)', 'iban'), one('reach', 'ukAccount', 'Sort code and account number (GBP)', 'account'), one('reach', 'otherBank', 'Other bank details for the currency')],
    source: 'research 2026-11-10 (high): https://wise.com/help/articles/2977959/how-do-i-send-money-with-wise',
  },
  TRANSFERWISE_USD: {
    fields: [yes('name', 'Name on the account'), one('reach', 'wisetag', 'Wisetag', 'account'), one('reach', 'email', 'Email registered with Wise', 'email'), one('reach', 'usAccount', 'ACH routing number and account number', 'account'), no('address', 'Full address', 'postal')],
    source: 'research 2026-11-10 (high): https://wise.com/help/articles/2932150/usd-transfers; lead: address optional',
  },
  PAYSERA: {
    fields: [yes('name', 'Name on the account'), one('reach', 'email', 'Email on the Paysera account', 'email'), one('reach', 'phone', 'Phone number on the Paysera account', 'phone'), one('reach', 'iban', 'Paysera account number (IBAN)', 'iban')],
    source: 'research 2026-11-10 (high): https://www.paysera.lt/v2/en/legal/app-terms',
  },
  PAXUM: {
    fields: [yes('email', 'Paxum email', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://home-internal.paxum.com/faq/how-paxum-works; recheck 2026-11-12 (medium): https://api.paxum.com',
  },
  PAYTM: {
    fields: [one('reach', 'upiId', 'UPI ID', 'account'), one('reach', 'phone', 'Mobile number (UPI-linked)', 'phone'), one('reach', 'bankAccount', 'Bank account number and IFSC', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://paytm.com/support/money-transfers/how-to-send-money-on-paytm-4-quick-methods-explained',
  },
  NEQUI: {
    fields: [yes('phone', 'Nequi mobile number', 'phone'), no('breBKey', 'Bre-B key (phone, email or the key your bank gave you)', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.bbva.com.co/personas/blog/educacion-financiera/cuentas/transferencia-nequi.html; recheck 2026-11-12 (medium): https://www.bbva.com.co/personas/servicios-digitales/bre-b.html',
  },
  BIZUM: {
    fields: [yes('phone', 'Spanish mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.bbva.es/finanzas-vistazo/ef/banca-digital/enviar-dinero-bizum.html; recheck 2026-11-12 (high): https://www.bbva.es/finanzas-vistazo/ef/banca-digital/enviar-dinero-bizum.html',
  },
  CAPITUAL: {
    fields: [yes('accountNr', 'Capitual account number', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (low, status unclear): https://boldsuck.codeberg.page/haveno-docs/the-project/payment_methods/Capitual/; lead: kept, low confidence; owner question p11-145 on keeping the method; recheck 2026-11-12 (low, status flag: site live but B2B only): https://capitual.com',
  },
  MONESE: {
    fields: [yes('name', 'Name on the account'), one('reach', 'phone', 'Phone number (Monese to Monese)', 'phone'), one('reach', 'ukAccount', 'Sort code and account number (GBP)', 'account'), one('reach', 'iban', 'IBAN (EUR/RON)', 'iban')],
    note: 'If the buyer pays from abroad, ask them to put your Monese ID in the payment reference.',
    source: 'research 2026-11-10 (medium): https://support.monese.com/en/articles/99-what-s-considered-a-domestic-payment; recheck 2026-11-12 (high): https://support.monese.com/en/articles/91-can-i-use-my-multi-currency-iban-for-local-payments',
  },
  MPESA: {
    fields: [yes('phone', 'M-PESA phone number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://safaricom.co.ke/main-mpesa/m-pesa-services/lipa-na-m-pesa/pay-online; lead: person-to-person phone only for now',
  },
  SATISPAY: {
    fields: [yes('phone', 'Mobile number on Satispay', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://support.satispay.com/en/articles/sending-money-to-a-new-contact',
  },
  TIKKIE: {
    fields: [yes('paymentLink', 'Tikkie payment link', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.tikkie.me/faq; recheck 2026-11-12 (high): https://www.abnamro.nl/nl/prive/internet-en-mobiel/slim-bankieren/tikkie.html',
  },
  STRIKE: {
    fields: [one('reach', 'username', 'Strike username', 'account'), one('reach', 'lightningAddress', 'Lightning address', 'account')],
    source: 'research 2026-11-10 (high): https://strike.me/faq/how-do-i-send-cash-wr',
  },
  CASH_APP: {
    fields: [one('reach', 'cashtag', '$cashtag', 'account'), one('reach', 'phone', 'Phone number', 'phone'), one('reach', 'email', 'Email', 'email')],
    source: 'research 2026-11-10 (high): https://cash.app/learn/getting-started/how-to-send-and-receive-money',
  },
  VENMO: {
    fields: [one('reach', 'username', 'Venmo username', 'account'), one('reach', 'phone', 'Phone number', 'phone'), one('reach', 'email', 'Email', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://help.venmo.com/hc/en-us/articles/210413477-Sending-Requesting-Money',
  },
  PAYPAL: {
    fields: [one('reach', 'email', 'Email', 'email'), one('reach', 'phone', 'Phone number', 'phone'), one('reach', 'username', 'PayPal username', 'account'), one('reach', 'link', 'PayPal.Me link', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://www.paypal.com/us/cshelp/article/how-do-i-send-money-help293',
  },
  BLIK: {
    fields: [yes('phone', 'Polish mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.mbank.pl/komunikaty/klienci-indywidualni/6977-przelewy-na-numer-telefonu-blik-wszystko-co-musisz-wiedziec/; recheck 2026-11-12 (high): https://www.mbank.pl/indywidualny/aplikacja-i-serwis/platnosci/przelewy-na-numer-telefonu/',
  },
  VIPPS_MOBILEPAY: {
    fields: [yes('phone', 'Vipps / MobilePay mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://help.vippsmobilepay.com/en-DK/articles/how-do-i-send-money',
  },
  TWINT: {
    fields: [yes('phone', 'TWINT mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://www.twint.ch/en/faq/how-do-i-send-and-receive-money-to-and-from-other-twint-users/',
  },
  PAPARA: {
    fields: [yes('name', 'Name on the account'), one('reach', 'paparaNo', 'Papara number', 'account'), one('reach', 'phone', 'Turkish mobile number', 'phone'), one('reach', 'email', 'Email', 'email'), one('reach', 'iban', 'IBAN', 'iban')],
    source: 'research 2026-11-10 (medium): https://shiftdelete.net/ziraat-hesabindan-papara-hesabina-para-gonderme-rehberi?amp=1; lead: kept; TCMB revoked the e-money licence 31 Oct 2025, a court stayed it 9 Dec 2025, operations reported resumed 22 Jan 2026; recheck 2026-11-12 (medium, status flag: under state trusteeship since 2025): https://thepaypers.com/fraud-and-fincrime/news/turkiye-reinstates-paparas-license-amid-money-laundering-probe',
  },
  WERO: {
    fields: [one('reach', 'phone', 'Mobile number registered for Wero', 'phone'), one('reach', 'email', 'Email registered for Wero', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://support.n26.com/en-de/payments-transfers-and-withdrawals/cards-and-online-payments/what-is-wero-and-how-do-i-use-it; recheck 2026-11-12 (high): https://support.wero-wallet.eu/hc/en-us/articles/46163263600017-How-do-I-send-money-to-friends-and-family',
  },
  MB_WAY: {
    fields: [yes('phone', 'Portuguese mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.cgd.pt/Site/Saldo-Positivo/o-banco-e-eu/Pages/mb-way-como-aderir-como-funciona.aspx; recheck 2026-11-12 (high): https://www.cgd.pt/Particulares/Cartoes/Pages/App-MBWay.aspx',
  },
  PAYPAY: {
    fields: [one('reach', 'phone', 'Japanese mobile number', 'phone'), one('reach', 'paypayId', 'PayPay ID', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://paypay.ne.jp/guide/send/',
  },
  YOOMONEY: {
    fields: [one('reach', 'walletNumber', 'YooMoney wallet number', 'account'), one('reach', 'phone', 'Phone number linked to the wallet', 'phone'), one('reach', 'email', 'Email linked to the wallet', 'email')],
    source: 'research 2026-11-10 (high): https://yoomoney.ru/page?id=536228; owner question p11-144 (Russian methods, sanctions)',
  },
  KASPI: {
    fields: [yes('phone', 'Kaspi phone number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://guide.kaspi.kz/client/ru/app/transfers/client/q12373; lead: phone only, no card box',
  },
  SKRILL: {
    fields: [one('reach', 'email', 'Email on the Skrill account', 'email'), one('reach', 'phone', 'Phone number on the Skrill account', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://www.skrill.com/en/support/question/104/',
  },
  NETELLER: {
    fields: [yes('email', 'Neteller email', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://www.neteller.com/en/support/question/68/',
  },
  APPLE_CASH: {
    fields: [one('reach', 'phone', 'US phone number', 'phone'), one('reach', 'email', 'Apple Account email', 'email'), no('name', 'Name')],
    source: 'research 2026-11-10 (medium): https://support.apple.com/105013; recheck 2026-11-12 (high): https://support.apple.com/105013',
  },
  CHIME: {
    fields: [one('reach', 'chimesign', '$ChimeSign', 'account'), one('reach', 'phone', 'US phone number', 'phone'), one('reach', 'email', 'Email', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://help.chime.com/explore-products-ad7f967f/pay-anyone-65aba19b/what-is-pay-anyone-7c0fd8c8',
  },
  PAYSEND: {
    fields: [yes('name', 'Full name (Latin letters)'), one('reach', 'cardNumber', 'Card number', 'account'), one('reach', 'iban', 'IBAN or account number', 'iban'), no('bic', 'SWIFT/BIC', 'account'), one('reach', 'wallet', 'Mobile wallet number', 'phone')],
    source: 'research 2026-11-10 (medium): https://paysend.com/en/blog/how-to-make-first-paysend-transfer; lead: card number allowed as one option; recheck 2026-11-12 (high): https://help.paysend.com/hc/en-us/articles/21058675269533-What-details-do-I-need-to-send-a-bank-transfer',
  },
  MTN_MOMO: {
    fields: [yes('phone', 'MTN MoMo number', 'phone'), yes('name', 'Registered name')],
    source: 'research 2026-11-10 (medium): https://mtn.co.ug/momo/customer; recheck 2026-11-12 (medium): https://www.mtn.com.af/?p=6995',
  },
  MIXX_BY_YAS: {
    fields: [yes('phone', 'Mixx by Yas mobile number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://yas.co.tz/?p=27235; recheck 2026-11-12 (medium): https://yas.co.tz/?p=27235',
  },
  CHIPPER_CASH: {
    fields: [yes('chipperTag', 'Chipper Tag', 'account'), no('phone', 'Phone number on the account', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://support.chippercash.com/en/articles/3383789-how-do-i-send-money-to-other-chipper-cash-users',
  },
  EASYPAISA: {
    fields: [yes('phone', 'Easypaisa mobile account number', 'phone'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://easypaisa.com.pk/?p=1881; recheck 2026-11-12 (high): https://www.westernunion.com/gb/en/providers/easypaisa.html',
  },
  AIRTM: {
    fields: [one('reach', 'email', 'Email registered with Airtm', 'email'), one('reach', 'username', 'Airtm username', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://help.airtm.com/en/support/solutions/articles/47001185353-how-to-sends-funds-in-airtm-internal-',
  },
  ASTROPAY: {
    fields: [one('reach', 'phone', 'Phone number on AstroPay', 'phone'), one('reach', 'astroTag', 'AstroTag', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://intercom.help/astropay-hc/en/articles/15084818-send-money-to-another-astropay-user',
  },
  LYDIA: {
    fields: [one('reach', 'phone', 'Mobile number', 'phone'), one('reach', 'email', 'Email', 'email'), one('reach', 'username', 'Lydia username', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.lydia.me/en; recheck 2026-11-12 (medium): https://www.presse-citron.net/applications/utilitaires/lydia-com/',
  },
  POSTEPAY: {
    fields: [yes('name', 'Name on the account'), one('reach', 'phone', 'Mobile number or Postepay alias (P2P)', 'account'), one('reach', 'iban', 'IBAN (Postepay Evolution)', 'iban'), one('reach', 'cardNumber', 'Postepay card number', 'account')],
    source: 'research 2026-11-10 (medium): https://www.poste.it/resources/bancoposta/pdf/trasparenza/FI_PE.pdf; lead: card number allowed as one option; codice fiscale never a box; recheck 2026-11-12 (medium): https://www.aranzulla.it/come-attivare-p2p-1536428.html',
  },
  PAYONEER: {
    fields: [yes('email', 'Payoneer email', 'email'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://payoneer.custhelp.com/app/answers/detail/a_id/20818/~/how-to-pay-a-payoneer-user',
  },
  ZEN: {
    fields: [one('reach', 'phone', 'Phone number on ZEN', 'phone'), one('reach', 'iban', 'ZEN account IBAN', 'iban'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://ask.zen.com/hc/en-gb/articles/5009527815580',
  },
  AFRIEX: {
    fields: [one('reach', 'username', 'Afriex $username', 'account'), one('reach', 'phone', 'Phone number on Afriex', 'phone'), no('name', 'Full name')],
    source: 'research 2026-11-10 (high): https://afriex.com/faq-pages/how-do-i-send-money-to-another-afriex-user',
  },
  REMITLY: {
    fields: [yes('name', 'Full legal name (as on ID / account)'), one('delivery', 'bankDetails', 'Bank details for your country'), one('delivery', 'mobileWallet', 'Mobile wallet number and provider'), one('delivery', 'cashPickup', 'Cash pickup city or agent'), no('phone', 'Phone number', 'phone'), no('address', 'Address', 'postal')],
    source: 'research 2026-11-10 (medium): https://www.remitly.com/financial-glossary/recipient; lead: as researched (legal name, one delivery route); recheck 2026-11-12 (medium): https://wise.com/ph/blog/receive-money-remitly',
  },
  WORLDREMIT: {
    fields: [yes('name', 'Full name (as on ID / account)'), yes('phone', 'Mobile number', 'phone'), one('delivery', 'bankDetails', 'Bank details for your country'), one('delivery', 'mobileWallet', 'Mobile money number and provider'), one('delivery', 'cashPickup', 'Cash pickup city'), no('email', 'Email', 'email'), no('address', 'Address', 'postal')],
    source: 'research 2026-11-10 (medium): https://www.worldremit.com/en/blog/product/use-worldremit; lead: as researched (legal name, one delivery route); recheck 2026-11-12 (high): https://www.worldremit.com/en/blog/product/use-worldremit',
  },
  XOOM: {
    fields: [yes('name', 'Full name (as on bank account / ID)'), one('delivery', 'bankDetails', 'Bank name and account number / IBAN'), one('delivery', 'mobileWallet', 'Mobile wallet number'), one('delivery', 'cashPickup', 'Cash pickup city'), no('phone', 'Phone number', 'phone'), no('address', 'Address', 'postal')],
    source: 'research 2026-11-10 (medium): https://help.xoom.com/s/article/what-are-the-bank-deposit-requirements-in-el-salvador; lead: bank, wallet or cash pickup only; no debit-card payout box; recheck 2026-11-12 (high): https://help.xoom.com/s/article/what-information-about-my-contact-is-needed-to-send-a-transaction',
  },
  // Bank transfers. COPY-UNSIGNED (payee-fields research 2026-11-10): every label in this block.
  SEPA: {
    fields: [yes('name', 'Name on the account'), yes('iban', 'IBAN', 'iban'), no('bic', 'BIC', 'account'), no('address', 'Payee address', 'postal')],
    source: 'research 2026-11-10 (high): https://www.europeanpaymentscouncil.eu/what-we-do/sepa-credit-transfer; lead: additions as researched',
  },
  SEPA_INSTANT: {
    fields: [yes('name', 'Name on the account'), yes('iban', 'IBAN', 'iban'), no('bic', 'BIC', 'account'), no('address', 'Payee address', 'postal')],
    source: 'research 2026-11-10 (high): https://www.europeanpaymentscouncil.eu/what-we-do/sepa-instant-credit-transfer; lead: additions as researched',
  },
  SPEI: {
    fields: [yes('name', 'Name on the account'), yes('clabe', 'CLABE (18 digits)', 'account'), no('bankName', 'Bank'), no('cardNumber', 'Debit card number (16 digits)', 'account'), no('phone', 'Mobile number linked to the account (10 digits)', 'phone')],
    source: 'research 2026-11-10 (medium): https://www.banxico.org.mx/servicios/sistema-pagos-electronicos-in.html; lead 12 Nov: debit card and mobile added as optional receiving identifiers, Banxico Circular 10/2026 Art. 17 Ter IV (in force by 14 Dec 2026), replacing the 10 Nov CLABE-only call; recheck 2026-11-12 (high): https://sidof.segob.gob.mx/notas/docFuente/5790863',
  },
  FASTER_PAYMENTS: {
    fields: [yes('name', 'Name on the account'), yes('sortCode', 'Sort code', 'account'), yes('account', 'Account number', 'account'), no('reference', 'Payment reference to use')],
    source: 'research 2026-11-10 (high): https://www.wearepay.uk/what-we-do/overlay-services/confirmation-of-payee/; lead: additions as researched',
  },
  NATIONAL_BANK: {
    fields: [yes('name', 'Name on the account'), yes('bankName', 'Bank name'), no('bankCode', 'Bank code / institution number', 'account'), no('branchCode', 'Branch code (sort code, routing, BSB, transit, agency)', 'account'), yes('account', 'Account number (or IBAN / CLABE)', 'account'), no('accountType', 'Account type')],
    source: 'research 2026-11-10 (medium): https://github.com/haveno-dex/haveno/tree/master/core/src/main/java/haveno/core/payment/payload/BankAccountPayload.java; lead: name and account required, country extras optional, no country logic; holder tax/ID never a box; recheck 2026-11-12 (medium): https://www.natwest.com/support-centre/banking-from-home/make-payments/what-payee-details-are-required-to-send-money-abroad.html',
  },
  JAPAN_BANK: {
    fields: [yes('bankName', 'Bank name'), no('bankCode', 'Bank code', 'account'), yes('branch', 'Branch name or number'), yes('accountType', 'Account type (futsu or toza)'), yes('account', 'Account number', 'account'), yes('name', 'Account holder name (katakana)')],
    source: 'research 2026-11-10 (medium): https://www.zengin-net.jp/en/zengin_net/outline/; recheck 2026-11-12 (medium): https://www.wise.com/help/articles/2932156/guide-to-jpy-transfers',
  },
  AUSTRALIA_PAYID: {
    fields: [yes('payId', 'PayID (phone, email, ABN or organisation ID)', 'account'), yes('name', 'Name shown for the PayID')],
    source: 'research 2026-11-10 (high): https://www.auspayplus.com.au/brands/payid',
  },
  SAME_BANK: {
    fields: [yes('name', 'Name on the account'), yes('bankName', 'Bank name'), yes('account', 'Account number', 'account'), no('branchCode', 'Branch code', 'account'), no('accountType', 'Account type')],
    source: 'research 2026-11-10 (medium): https://github.com/haveno-dex/haveno/tree/master/core/src/main/java/haveno/core/payment/payload/SameBankAccountPayload.java; lead: name and account required, country extras optional, no country logic; holder tax/ID never a box; recheck 2026-11-12 (medium): https://www.natwest.com/support-centre/banking-from-home/make-payments/what-payee-details-are-required-to-send-money-abroad.html',
  },
  SPECIFIC_BANKS: {
    fields: [yes('name', 'Name on the account'), yes('bankName', 'Bank name'), yes('account', 'Account number', 'account'), no('branchCode', 'Branch code (sort code, routing, BSB, transit, agency)', 'account'), no('bankCode', 'Bank code', 'account'), no('accountType', 'Account type')],
    source: 'research 2026-11-10 (medium): https://github.com/haveno-dex/haveno/tree/master/core/src/main/java/haveno/core/payment/payload/SpecificBanksAccountPayload.java; lead: name and account required, country extras optional, no country logic; holder tax/ID never a box; recheck 2026-11-12 (medium): https://www.natwest.com/support-centre/banking-from-home/make-payments/what-payee-details-are-required-to-send-money-abroad.html',
  },
  INTERAC_E_TRANSFER: {
    fields: [yes('name', 'Full name'), one('contact', 'email', 'Email', 'email'), one('contact', 'phone', 'Mobile number', 'phone')],
    source: 'research 2026-11-10 (high): https://www.interac.ca/en/consumers/support/faq-consumers/',
  },
  PROMPT_PAY: {
    fields: [yes('promptPayId', 'PromptPay ID (mobile number or e-wallet ID)', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.bangkokbank.com/en/personal/digital-banking/promptpay; personal-ID rule: citizen ID and tax ID options left out of the label; recheck 2026-11-12 (high): https://www.bangkokbank.com/en/personal/digital-banking/promptpay',
  },
  NEFT: {
    fields: [yes('name', 'Name on the account'), yes('account', 'Account number', 'account'), yes('ifsc', 'IFSC', 'account'), no('bankName', 'Bank and branch name')],
    source: 'research 2026-11-10 (high): https://www.rbi.org.in/commonperson/English/Scripts/FAQs.aspx?Id=2689',
  },
  RTGS: {
    fields: [yes('name', 'Name on the account'), yes('account', 'Account number', 'account'), yes('ifsc', 'IFSC', 'account'), no('bankName', 'Bank and branch name')],
    source: 'research 2026-11-10 (high): https://www.rbi.org.in/Scripts/FAQView.aspx?Id=65',
  },
  IMPS: {
    fields: [yes('name', 'Name on the account'), one('reach', 'accountIfsc', 'Account number and IFSC', 'account'), one('reach', 'phone', 'Mobile number linked to the account', 'phone'), no('mmid', 'MMID', 'account'), no('bankName', 'Bank name')],
    source: 'research 2026-11-10 (medium): https://www.npci.org.in/what-we-do/imps/product-overview; lead: account number and IFSC in one box, so IFSC always comes with the account; recheck 2026-11-12 (high): https://www.npci.org.in/PDF/npci/imps/Product-Booklet.pdf',
  },
  UPI: {
    fields: [one('reach', 'upiId', 'UPI ID', 'account'), one('reach', 'phone', 'Mobile number registered with UPI', 'phone'), one('reach', 'accountIfsc', 'Account number and IFSC', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://nationalbank.bank.in/english/upi-service.aspx; recheck 2026-11-12 (high): https://npci.org.in/what-we-do/upi/faqs',
  },
  PIX: {
    fields: [yes('pixKey', 'Pix key (phone, email, CPF/CNPJ or random key)', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://www.bcb.gov.br/estabilidadefinanceira/pix',
  },
  SWIFT: {
    fields: [yes('name', 'Name on the account'), yes('account', 'IBAN or account number', 'account'), yes('bic', 'BIC (SWIFT code)', 'account'), yes('address', 'Beneficiary address', 'postal'), no('bankName', 'Bank name'), no('localCode', 'Local bank code (if your country uses one)', 'account')],
    source: 'research 2026-11-10 (medium): https://www.rocklandtrust.com/assets/files/yPcUEuue/International%20Wire%20Transfer%20information%20required.pdf; lead: beneficiary address required; recheck 2026-11-12 (high): https://www.natwest.com/support-centre/banking-from-home/make-payments/what-payee-details-are-required-to-send-money-abroad.html',
  },
  ACH_TRANSFER: {
    fields: [yes('name', 'Name on the account'), yes('routing', 'Routing number (ABA)', 'account'), yes('account', 'Account number', 'account'), yes('accountType', 'Account type (checking or savings)'), no('bankName', 'Bank name')],
    source: 'research 2026-11-10 (high): https://www.nacha.org/content/ach-network; lead: additions as researched',
  },
  DOMESTIC_WIRE_TRANSFER: {
    fields: [yes('name', 'Name on the account'), yes('address', 'Beneficiary address', 'postal'), yes('bankName', 'Bank name'), yes('routing', 'Wire routing number (ABA)', 'account'), yes('account', 'Account number', 'account')],
    source: 'research 2026-11-10 (medium): https://www.frbservices.org/financial-services/wires; recheck 2026-11-12 (high): https://www.adviacu.org/resources/banking-tools/wire-transfers/outgoing-domestic-transfers',
  },
  NIP: {
    fields: [yes('bankName', 'Bank name'), yes('account', 'Account number (NUBAN)', 'account'), yes('name', 'Name on the account')],
    source: 'research 2026-11-10 (high): https://contactcentre.nibss-plc.com.ng/support/solutions/articles/47001265115-what-are-the-services-under-nip-that-customers-can-utilize-',
  },
  PAGO_MOVIL: {
    fields: [yes('phone', 'Mobile number affiliated to Pago Móvil', 'phone'), yes('idNumber', 'Cédula or RIF', 'account'), yes('bank', 'Bank (name or 4-digit code)'), no('name', 'Full name')],
    source: 'research 2026-11-10 (medium): https://finanzasdigital.com/como-hacer-un-pago-movil-pasos-y-comisiones/; lead (review, 10 Nov): cedula or RIF required, the method\'s own payee identifier (an exception to the personal-ID rule, like the card-number one); recheck 2026-11-12 (medium): https://finanzasdigital.com/como-hacer-un-pago-movil-pasos-y-comisiones/',
  },
  QRIS: {
    fields: [yes('qris', 'QR code text', 'account', 512), no('name', 'Name shown on the QRIS'), no('provider', 'Bank or e-wallet')],
    source: 'research 2026-11-10 (medium): https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/qris-tuntas/default.aspx; lead: interim text box for the string inside the QR; an image box is a later feature; recheck 2026-11-12 (high): https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/qris-tuntas/default.aspx',
  },
  RAAST: {
    fields: [one('reach', 'raastId', 'Raast ID (mobile number)', 'phone'), one('reach', 'iban', 'IBAN', 'iban'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.sbp.org.pk/circulars/disd-circular-no-1-of-2022; recheck 2026-11-12 (high): https://www.sbp.org.pk/circulars/disd-circular-no-1-of-2022',
  },
  PAYNOW: {
    fields: [one('reach', 'phone', 'Mobile number registered for PayNow', 'phone'), one('reach', 'uen', 'UEN (businesses)', 'account'), one('reach', 'vpa', 'PayNow VPA', 'account'), no('name', 'Name shown on PayNow')],
    source: 'research 2026-11-10 (high): https://www.abs.org.sg/consumer-banking/pay-now; lead: NRIC/FIN never a box',
  },
  FPS: {
    fields: [one('reach', 'phone', 'Mobile number registered for FPS', 'phone'), one('reach', 'email', 'Email registered for FPS', 'email'), one('reach', 'fpsId', 'FPS ID', 'account'), one('reach', 'account', 'Bank code and account number', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://www.hkma.gov.hk/eng/key-functions/international-financial-centre/financial-market-infrastructure/faster-payment-system-fps/; recheck 2026-11-12 (high): https://www.hkma.gov.hk/eng/smart-consumers/faster-payment-system/',
  },
  DUITNOW: {
    fields: [one('reach', 'duitnowId', 'DuitNow ID (mobile number or business registration number)', 'account'), one('reach', 'accountBank', 'Account number and bank', 'account'), no('name', 'Name on the account')],
    source: 'research 2026-11-10 (medium): https://knowledgebase.paynet.my/hc/en-us/articles/49480498637849-Overview; lead: account number and bank in one box; MyKad, passport, army and police numbers never a box; recheck 2026-11-12 (high): https://docs.developer.paynet.my/docs/duitnow-transfer/introduction/overview',
  },
  SBP: {
    fields: [yes('phone', 'Phone number linked to SBP', 'phone'), yes('bankName', 'Bank to receive in'), no('name', 'Name (as the bank shows it)')],
    source: 'research 2026-11-10 (medium): https://www.nspk.ru/en/; lead: phone and bank; owner question p11-144 (Russian methods, sanctions); recheck 2026-11-12 (high): https://www.cbr.ru/eng/PSystem/sfp',
  },
  MIR: {
    fields: [yes('cardNumber', 'Mir card number', 'account'), no('name', 'Cardholder name'), no('bankName', 'Issuing bank')],
    source: 'research 2026-11-10 (medium): https://mironline.ru/; lead: card number required (the only route); owner question p11-144 (Russian methods, sanctions); recheck 2026-11-12 (medium): https://finance.mail.ru/card/natsionalnaya-sistema-platezhnyih-kart-747/',
  },
  UKRAINE_CARD: {
    fields: [one('reach', 'cardNumber', 'Card number (16 digits)', 'account'), one('reach', 'iban', 'IBAN (UA..., 29 characters)', 'iban'), one('reach', 'phone', 'Phone number linked to the card', 'phone'), no('name', 'Name on the card or account')],
    source: 'research 2026-11-10 (medium): https://en.privatbank.ua/payments-and-transfers/transfer-to-a-card-in-another-bank; lead: card number allowed (one of card, IBAN, phone); tax ID never a box; recheck 2026-11-12 (high): https://en.privatbank.ua/transfers-to-card-by-phone-number',
  },
  // Cash & money orders. COPY-UNSIGNED (payee-fields research 2026-11-10): every label in this block.
  US_POSTAL_MONEY_ORDER: {
    fields: [yes('name', 'Full name (Pay to)'), yes('address', 'Mailing address', 'postal')],
    source: 'research 2026-11-10 (medium): https://www.usps.com/shop/money-orders.htm; recheck 2026-11-12 (medium): https://eco.com/support/en/articles/17345348-how-to-fill-out-a-money-order-step-by-step-with-examples',
  },
  CASH_DEPOSIT: {
    fields: [yes('name', 'Name on the account'), yes('bankName', 'Bank name'), yes('account', 'Account number', 'account'), no('branchCode', 'Branch / routing code (if your bank needs it)', 'account')],
    note: 'Some banks no longer take cash deposits into an account the depositor does not own. Check yours before the buyer goes.',
    source: 'research 2026-11-10 (low): no provider source; recheck 2026-11-12 (medium): https://www.bankrate.com/banking/checking/deposit-cash-into-someone-elses-account-these-are-your-options/',
  },
  MONEY_GRAM: {
    fields: [yes('fullName', 'Full name as on your ID'), yes('country', 'Country'), no('city', 'City and state/province'), no('phone', 'Phone number', 'phone')],
    source: 'research 2026-11-10 (medium): https://www.moneygram.com/us/en/receive-money-with-moneygram; lead: cash pickup only; recheck 2026-11-12 (high): https://www.moneygram.com/us/en/receive-money-with-moneygram',
  },
  WESTERN_UNION: {
    fields: [yes('fullName', 'Full name as on your ID'), yes('country', 'Country'), no('city', 'City and state/province'), no('phone', 'Phone number', 'phone')],
    source: 'research 2026-11-10 (high): https://www.westernunion.com/nz/en/frequently-asked-questions/faq-send-money.html; lead: cash pickup only',
  },
  HAL_CASH: {
    fields: [yes('phone', 'Mobile number to receive the HalCash SMS', 'phone')],
    source: 'research 2026-11-10 (high): https://www.halcash.com/es/faq',
  },
  F2F: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  PAY_BY_MAIL: {
    fields: [yes('name', 'Full name'), yes('address', 'Mailing address', 'postal')],
    source: 'research 2026-11-10 (high): https://www.usps.com',
  },
  CASH_AT_ATM: {
    fields: [no('phone', 'Mobile number to receive the cash code (if the bank texts it to you)', 'phone')],
    note: 'Some banks text the cash code to your phone, others give it to the buyer to send you here.',
    source: 'research 2026-11-10 (medium): https://clientebancario.bde.es/pcb/en/blog/sabias-que-puedes-sacar-dinero-en-un-cajero-sin-tarjeta--te-contamos-como%E2%80%A6.html; recheck 2026-11-12 (medium): https://www.pbebank.com/en/digital-banking/mobile-banking/cardless-withdrawal/',
  },
  RIA: {
    fields: [yes('fullName', 'Full name as on your ID'), yes('country', 'Country'), no('city', 'City and state/province'), no('phone', 'Phone number', 'phone')],
    source: 'research 2026-11-10 (high): https://www.riamoneytransfer.com/en/blog/how-to-receive-money-ria-money-transfer/; lead: cash pickup only',
  },
  // Gift cards & vouchers. COPY-UNSIGNED (payee-fields research 2026-11-10): every label in this block.
  AMAZON_GIFT_CARD: {
    fields: [no('email', 'Email to deliver the eGift card to', 'email')],
    source: 'research 2026-11-10 (medium): https://www.amazon.co.uk/gc-legal; lead: one optional email box for the eGift; otherwise the claim code goes in the chat; recheck 2026-11-12 (high): https://digprjsurvey.amazon.com/csad/help/node/G5D4TA7NBKQT7GW2',
  },
  APPLE_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): https://www.apple.com/legal/internet-services/itunes/giftcards/; recheck 2026-11-12 (medium): no provider page reachable' },
  GOOGLE_PLAY_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): https://play.google/intl/en_us/card-terms/; recheck 2026-11-12 (high): https://support.google.com/googleplay/answer/3422659' },
  UBER_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  UBER_EATS_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  DOORDASH_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (high): https://help.doordash.com/consumers/s/article/doordash-gift-cards' },
  WALMART_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  BEST_BUY_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (high): https://www.bestbuy.ca/en-ca/help/bltc6e4ac9d6a7f34c4/blt5f505a77ab8458ec' },
  HOME_DEPOT_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (high): https://www.homedepot.com/giftcard' },
  STEAM_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  PLAYSTATION_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  XBOX_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  IKEA_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (high): https://www.ikea.com/us/en/customer-service/knowledge/articles/c9058a6c-b980-449b-8855-63b5ef55152a.html' },
  SEPHORA_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  STARBUCKS_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  AIRBNB_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (medium): https://webcf.waybackmachine.org/web/20210421061637/https://www.airbnb.com/gift-cards' },
  ROBLOX_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  NINTENDO_ESHOP_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  VISA_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  MASTERCARD_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  INSTACART_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (medium): https://www.bitrefill.com/buy/instacart-usa/' },
  AIR_CANADA_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (high): https://www.aircanada.com/us/en/aco/home/book/air-canada-gift-cards.html' },
  PETRO_CANADA_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  ESSO_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (medium): https://www.bitrefill.com/buy/esso-and-mobil-canada' },
  SKIPTHEDISHES_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  SOBEYS_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  WINNERS_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  LULULEMON_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (medium): https://www.giftronaut.com/blog/lululemon-gift-cards' },
  TIM_HORTONS_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  TARGET_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  HOME_HARDWARE_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (high): https://homehardware.ca/en/home-egift-cards' },
  CANADIAN_TIRE_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (medium): no provider source; recheck 2026-11-12 (medium, owner question: online redemption unconfirmed): https://thesmallsuccess.pages.dev/canadian-tire-gift-card-gas-online-purchases' },
  OTHER_GIFT_CARD: { fields: [], payeeGivesNothing: true, source: 'research 2026-11-10 (high): no provider source' },
  // Other. COPY-UNSIGNED (payee-fields research 2026-11-10): every label in this block.
  CUSTOM: {
    fields: [yes('details', 'Payment details', 'postal')],
    source: 'research 2026-11-10 (high): data/payment-method-profiles.json CUSTOM; lead: one multi-line free-text box',
  },
});

/** Any method outside the table (an id the catalogue no longer has): one free-text box. COPY-UNSIGNED */
export const PAY_FIELDS_FALLBACK: readonly PayFieldSpec[] = Object.freeze([yes('details', 'Payment details')]);

const rowOf = (methodId: string): PayFieldsSpec | undefined => (Object.prototype.hasOwnProperty.call(PAY_FIELDS, methodId) ? PAY_FIELDS[methodId] : undefined);

/** The boxes for a method: its table row (none for a method the payee gives nothing for), or the one free-text box. */
export function payFieldsFor(methodId: string): readonly PayFieldSpec[] {
  return rowOf(methodId)?.fields ?? PAY_FIELDS_FALLBACK;
}

/** True when the payee has nothing to send for this method (the buyer sends the card or cash details in the chat). */
export function payeeGivesNothing(methodId: string): boolean {
  return rowOf(methodId)?.payeeGivesNothing === true;
}

/** The method's note for the payee, shown with the boxes (12 Nov recheck), if it has one. COPY-UNSIGNED */
export function payNoteFor(methodId: string): string | undefined {
  return rowOf(methodId)?.note;
}

export type PayDetailsErrorCode = 'missing' | 'one-of' | 'unknown-field' | 'bad-value' | 'bad-chars' | 'too-long' | 'bad-shape';

/**
 * What a one-line account box (kinds email, phone, iban, account) may hold (pay-details review M6):
 * letters with their combining marks (Indic, Thai, Arabic and decomposed Latin text need them),
 * digits, punctuation, symbols and the plain space. Nothing else: no tab or other whitespace, no
 * format character (the joiners ZWNJ/ZWJ, the direction marks LRM/RLM/ALM, the soft hyphen, word
 * joiner and BOM), no line or paragraph separator, no control, and no variation selector or
 * Mongolian free variation selector (marks that render as nothing). The chat's own text check
 * refuses most hidden characters already; this closes what it allows for a line of text (tab,
 * ZWNJ/ZWJ, LRM/RLM/ALM) and the separators and spaces (Zl, Zp, Zs) it never looks at. A hidden
 * character here only ever hurts the payee: the value copied at the payer's bank would not match.
 * Written as escapes: no literal invisible characters in source.
 */
const ACCOUNT_CHARS = /^(?:(?![\ufe00-\ufe0f\u180b-\u180f\u{e0100}-\u{e01ef}])[\p{L}\p{M}\p{N}\p{P}\p{S} ])*$/u;

/** A refused package. `key` names the box (or the one-of group); messages never carry a value. */
export class PayDetailsError extends Error {
  readonly code: PayDetailsErrorCode;
  readonly key: string | null;
  constructor(code: PayDetailsErrorCode, key: string | null = null) {
    super(key === null ? code : `${code}: ${key}`);
    this.name = 'PayDetailsError';
    this.code = code;
    this.key = key;
  }
}

/** One filled box, as sealed. */
export interface PayDetailField {
  key: string;
  value: string;
}

/** The `pay` payload inside a chat envelope (next to the plain `text` every reader shows). */
export interface PayDetailsPayload {
  v: typeof PAY_DETAILS_V;
  method: string;
  fields: PayDetailField[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Checks the boxes as typed: every table key, each value a string; trimmed; required boxes filled,
 * each one-of group with at least one; one-line boxes without a line break, an account box
 * (email, phone, iban, account) with only ACCOUNT_CHARS, a mailing address with at most
 * PAY_POSTAL_MAX_LINES; within the box's maxLength, else PAY_FIELD_MAX_CHARS. Returns the filled boxes in table order
 * (empty optional ones dropped). Throws PayDetailsError.
 */
export function checkPayDetails(methodId: string, values: Record<string, unknown>): PayDetailField[] {
  const spec = payFieldsFor(methodId);
  for (const k of Object.keys(values)) if (!spec.some((f) => f.key === k)) throw new PayDetailsError('unknown-field', k);
  const out: PayDetailField[] = [];
  const groups = new Map<string, boolean>();
  for (const f of spec) {
    const raw = values[f.key];
    if (raw !== undefined && typeof raw !== 'string') throw new PayDetailsError('bad-value', f.key);
    const value = (raw ?? '').trim();
    const filled = value !== '';
    if (typeof f.need === 'object') groups.set(f.need.oneOf, (groups.get(f.need.oneOf) ?? false) || filled);
    if (!filled) {
      if (f.need === 'yes') throw new PayDetailsError('missing', f.key);
      continue;
    }
    if (f.kind === 'postal') {
      if (value.includes('\r') || value.split('\n').length > PAY_POSTAL_MAX_LINES) throw new PayDetailsError('bad-value', f.key);
      if (value.length > (f.maxLength ?? PAY_FIELD_MAX_CHARS.postal)) throw new PayDetailsError('too-long', f.key);
    } else {
      if (/[\r\n]/.test(value)) throw new PayDetailsError('bad-value', f.key);
      if (f.kind !== 'text' && !ACCOUNT_CHARS.test(value)) throw new PayDetailsError('bad-chars', f.key);
      if (value.length > (f.maxLength ?? PAY_FIELD_MAX_CHARS.line)) throw new PayDetailsError('too-long', f.key);
    }
    out.push({ key: f.key, value });
  }
  for (const [group, any] of groups) if (!any) throw new PayDetailsError('one-of', group);
  return out;
}

/**
 * The sealed `pay` payload, checked: exactly `{ v, method, fields }`, fields exactly `{ key, value }`
 * each, in table order with no repeats, and the same boxes checkPayDetails would return for them
 * (trimmed, required ones present, groups met). Throws PayDetailsError('bad-shape') for the shape,
 * checkPayDetails' codes for the boxes.
 */
export function parsePayDetails(raw: unknown): PayDetailsPayload {
  const shape = (): PayDetailsError => new PayDetailsError('bad-shape');
  if (!isRecord(raw)) throw shape();
  const keys = Object.keys(raw).sort();
  if (keys.length !== 3 || keys[0] !== 'fields' || keys[1] !== 'method' || keys[2] !== 'v') throw shape();
  if (raw.v !== PAY_DETAILS_V || typeof raw.method !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(raw.method) || !Array.isArray(raw.fields) || raw.fields.length === 0) throw shape();
  const values: Record<string, string> = {};
  const fields: PayDetailField[] = raw.fields.map((f: unknown) => {
    if (!isRecord(f) || Object.keys(f).length !== 2 || typeof f.key !== 'string' || typeof f.value !== 'string') throw shape();
    if (Object.prototype.hasOwnProperty.call(values, f.key)) throw shape();
    values[f.key] = f.value;
    return { key: f.key, value: f.value };
  });
  const checked = checkPayDetails(raw.method, values);
  // The same boxes, in the same order, exactly as typed (no trimming left to do): one canonical form.
  if (checked.length !== fields.length || checked.some((c, i) => c.key !== fields[i]!.key || c.value !== fields[i]!.value)) throw shape();
  return { v: PAY_DETAILS_V, method: raw.method, fields };
}

/** The plain-text title of the package (the first line of the fallback text, and the card's heading). COPY-UNSIGNED */
export const PAY_DETAILS_TITLE = 'Payment details';

/**
 * The plain text every chat reader shows for a package, old ones included: the title, then one
 * "Label: value" line per filled box, in table order. Deterministic, so a reader can check the
 * text it was sent against the fields it was sent (the two can never disagree).
 */
export function renderPayDetailsText(pay: PayDetailsPayload): string {
  const spec = payFieldsFor(pay.method);
  const lines = pay.fields.map((f) => {
    const label = spec.find((s) => s.key === f.key)?.label;
    if (label === undefined) throw new PayDetailsError('unknown-field', f.key);
    return `${label}: ${f.value}`;
  });
  return [PAY_DETAILS_TITLE, ...lines].join('\n');
}

/** A label inside a package's text (review R1): 1 to 120 characters, no colon, no line break. */
const PAY_TEXT_LABEL = /^[^:\n]{1,120}$/;

/**
 * Whether `text` is a rendering of `pay`'s values (review F3): the title, then one "<label>: <value>"
 * line per filled box, in order, with each value exactly as sealed. The labels themselves are not
 * checked: they are the table's COPY-UNSIGNED wording, which the owner re-words (J-26), and a package
 * sealed under older labels must still open. A label is 1 to 120 characters with no colon and no line
 * break (review R1, belt and braces). Read from the end: a value may span lines (a mailing address), a
 * label never does, so each label is the rest of its line, and the split is unambiguous.
 *
 * A reader never shows the sender's label text: once this passes it replaces the text with its own
 * renderPayDetailsText (review R1: a label could otherwise name an account that is in no box).
 */
export function payTextMatches(pay: PayDetailsPayload, text: string): boolean {
  let rest = text;
  for (let i = pay.fields.length - 1; i >= 0; i--) {
    const tail = `: ${pay.fields[i]!.value}`;
    if (!rest.endsWith(tail)) return false;
    rest = rest.slice(0, rest.length - tail.length);
    const nl = rest.lastIndexOf('\n');
    if (nl < 0 || !PAY_TEXT_LABEL.test(rest.slice(nl + 1))) return false;
    rest = rest.slice(0, nl);
  }
  return rest === PAY_DETAILS_TITLE;
}
