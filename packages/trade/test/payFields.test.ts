import { describe, expect, it } from 'vitest';
import {
  PAY_DETAILS_V,
  PAY_FIELD_MAX_CHARS,
  PAY_FIELDS,
  PayDetailsError,
  checkPayDetails,
  parsePayDetails,
  payFieldsFor,
  payNoteFor,
  payeeGivesNothing,
  payTextMatches,
  renderPayDetailsText,
  type PayDetailsPayload,
} from '../src/index.js';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof PayDetailsError ? `${e.code}:${e.key ?? ''}` : String(e);
  }
};

describe('the payee fields table', () => {
  it('every row with boxes has unique keys, labels and a source, and asks for something (coverage: payFieldsCoverage.test.ts)', () => {
    for (const [id, spec] of Object.entries(PAY_FIELDS)) {
      expect(spec.source.length, id).toBeGreaterThan(0);
      if (spec.payeeGivesNothing === true) continue;
      const keys = spec.fields.map((f) => f.key);
      expect(new Set(keys).size, id).toBe(keys.length);
      for (const f of spec.fields) {
        expect(/^[a-z][a-zA-Z0-9]*$/.test(f.key), `${id}.${f.key}`).toBe(true);
        expect(f.label.trim().length, `${id}.${f.key}`).toBeGreaterThan(0);
      }
      // Something must be filled: a required field or a one-of group (Amazon: one optional email box, lead 10 Nov;
      // ATM cash: one optional phone box, only for banks that text the code, lead 12 Nov).
      if (id !== 'AMAZON_GIFT_CARD' && id !== 'CASH_AT_ATM') expect(spec.fields.some((f) => f.need !== 'no'), id).toBe(true);
    }
  });

  it("Interac (the owner's example, p7-3): full name, plus email or phone, one or the other", () => {
    const f = payFieldsFor('INTERAC_E_TRANSFER');
    expect(f.map((x) => [x.key, x.need])).toEqual([
      ['name', 'yes'],
      ['email', { oneOf: 'contact' }],
      ['phone', { oneOf: 'contact' }],
    ]);
    expect(f.find((x) => x.key === 'email')?.kind).toBe('email');
    expect(f.find((x) => x.key === 'phone')?.kind).toBe('phone');
  });

  it('an id outside the table (one the catalogue no longer has) gets the one free-text box; CUSTOM has one multi-line box (lead, 10 Nov)', () => {
    expect(payFieldsFor('NOT_A_METHOD')).toEqual([{ key: 'details', label: 'Payment details', kind: 'text', need: 'yes' }]);
    expect(payFieldsFor('CUSTOM')).toEqual([{ key: 'details', label: 'Payment details', kind: 'postal', need: 'yes' }]);
  });

  it('a gift card, ATM or face-to-face cash method has no boxes: the payee gives nothing', () => {
    for (const id of ['STEAM_GIFT_CARD', 'F2F']) {
      expect(payFieldsFor(id), id).toEqual([]);
      expect(payeeGivesNothing(id), id).toBe(true);
    }
    expect(payeeGivesNothing('NOT_A_METHOD')).toBe(false);
    expect(payeeGivesNothing('AMAZON_GIFT_CARD')).toBe(false);
    expect(payFieldsFor('AMAZON_GIFT_CARD')).toEqual([{ key: 'email', label: 'Email to deliver the eGift card to', kind: 'email', need: 'no' }]);
    expect(codeOf(() => checkPayDetails('STEAM_GIFT_CARD', { details: 'x' }))).toBe('unknown-field:details');
    expect(() => parsePayDetails({ v: PAY_DETAILS_V, method: 'STEAM_GIFT_CARD', fields: [] })).toThrow(PayDetailsError);
  });

  it('lead decisions (10 Nov): IMPS carries IFSC with the account, PayNow and Postepay take no personal ID', () => {
    expect(payFieldsFor('IMPS').some((f) => f.key === 'ifsc')).toBe(false);
    expect(payFieldsFor('IMPS').find((f) => f.key === 'accountIfsc')?.need).toEqual({ oneOf: 'reach' });
    expect(payFieldsFor('PAYNOW').some((f) => f.key === 'nric')).toBe(false);
    expect(payFieldsFor('POSTEPAY').some((f) => f.key === 'taxCode')).toBe(false);
    expect(payFieldsFor('UKRAINE_CARD').map((f) => f.key)).toEqual(['cardNumber', 'iban', 'phone', 'name']);
  });

  it('cash by mail takes a multi-line mailing address', () => {
    expect(payFieldsFor('PAY_BY_MAIL').find((f) => f.key === 'address')?.kind).toBe('postal');
  });
});

describe('checkPayDetails', () => {
  it('keeps the filled fields in table order, trimmed, and drops empty optional ones', () => {
    const got = checkPayDetails('INTERAC_E_TRANSFER', { phone: ' +1 416 555 0100 ', name: 'Jane Doe', email: '' });
    expect(got).toEqual([
      { key: 'name', value: 'Jane Doe' },
      { key: 'phone', value: '+1 416 555 0100' },
    ]);
  });

  it('refuses a missing required field, an empty one-of group, an unknown key, a newline in a one-line box and an overlong value', () => {
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { email: 'j@x.ca' }))).toBe('missing:name');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', email: '  ', phone: '' }))).toBe('one-of:contact');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', email: 'j@x.ca', iban: 'x' }))).toBe('unknown-field:iban');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane\nDoe', email: 'j@x.ca' }))).toBe('bad-value:name');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'J'.repeat(PAY_FIELD_MAX_CHARS.line + 1), email: 'j@x.ca' }))).toBe('too-long:name');
    expect(codeOf(() => checkPayDetails('PAY_BY_MAIL', { name: 'Jane', address: 'x'.repeat(PAY_FIELD_MAX_CHARS.postal + 1) }))).toBe('too-long:address');
    // Not strings at all.
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 1 as unknown as string, email: 'j@x.ca' }))).toBe('bad-value:name');
  });

  it('review M6 (pay details): a one-line account box (email, phone, IBAN, account) takes letters, digits, punctuation, symbols and plain spaces, and nothing hidden', () => {
    // What people type into these boxes, in any script: fine.
    expect(checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', email: "josé.o'brien+x2f@exämple.ca", phone: '+1 (416) 555-0100' })).toEqual([
      { key: 'name', value: 'Jane' },
      { key: 'email', value: "josé.o'brien+x2f@exämple.ca" },
      { key: 'phone', value: '+1 (416) 555-0100' },
    ]);
    expect(checkPayDetails('SEPA', { name: 'Jane', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX' }).map((f) => f.value)).toEqual(['Jane', 'DE89 3704 0044 0532 0130 00', 'COBADEFFXXX']);
    expect(checkPayDetails('CASH_APP', { cashtag: '$Jane_Doe' })).toEqual([{ key: 'cashtag', value: '$Jane_Doe' }]);
    expect(checkPayDetails('UPI', { upiId: 'जेन@upi' })).toEqual([{ key: 'upiId', value: 'जेन@upi' }]);
    expect(checkPayDetails('PAYPAL', { link: 'https://paypal.me/JaneDoe?country.x=CA&locale.x=en_CA' })).toEqual([{ key: 'link', value: 'https://paypal.me/JaneDoe?country.x=CA&locale.x=en_CA' }]);
    // Refused, one code point at a time, inside an otherwise fine value: tab, the other C0/C1 whitespace,
    // the no-break and ideographic spaces, the soft hyphen, ALM, ZWSP, ZWNJ, ZWJ, LRM, RLM, the line and
    // paragraph separators, a bidi embedding and override and isolate, the word joiner, a variation
    // selector (a mark, but one that renders as nothing), the BOM, a tag.
    const hidden = ['\t', '\u000b', '\u000c', '\u0085', '\u00a0', '\u00ad', '\u061c', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2028', '\u2029', '\u202a', '\u202e', '\u2060', '\u2066', '\u3000', '\ufe0f', '\ufeff', '\u{e0041}'];
    for (const c of hidden) {
      const at = `U+${c.codePointAt(0)!.toString(16)}`;
      expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', email: `jane${c}@example.ca` })), at).toBe('bad-chars:email');
      expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', phone: `+1 416${c}555 0100` })), at).toBe('bad-chars:phone');
      expect(codeOf(() => checkPayDetails('SEPA', { name: 'Jane', iban: `DE89 3704${c}0044 0532 0130 00` })), at).toBe('bad-chars:iban');
      expect(codeOf(() => checkPayDetails('FASTER_PAYMENTS', { name: 'Jane', sortCode: `12${c}34 56`, account: '12345678' })), at).toBe('bad-chars:sortCode');
    }
    // A name (text) and a mailing address (postal) keep the chat text's rule: a tab is whitespace there, a line break is still the one-line box's refusal.
    expect(checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane\tDoe', email: 'jane@example.ca' })[0]).toEqual({ key: 'name', value: 'Jane\tDoe' });
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', email: 'jane@\nexample.ca' }))).toBe('bad-value:email');
  });

  it('review F2: the QRIS box takes a whole EMVCo string (up to 512 characters), as an account box (no hidden characters)', () => {
    const qr = `000201010211${'26'.padEnd(230, '0123456789ABCDEFGHIJ')}6304ABCD`.slice(0, 250);
    expect(qr.length).toBe(250);
    expect(checkPayDetails('QRIS', { qris: qr })).toEqual([{ key: 'qris', value: qr }]);
    expect(checkPayDetails('QRIS', { qris: 'x'.repeat(512) })[0]!.value.length).toBe(512);
    expect(codeOf(() => checkPayDetails('QRIS', { qris: 'x'.repeat(513) }))).toBe('too-long:qris');
    expect(codeOf(() => checkPayDetails('QRIS', { qris: `${qr.slice(0, 100)}\u200b${qr.slice(100)}` }))).toBe('bad-chars:qris');
    expect(codeOf(() => checkPayDetails('QRIS', { qris: `0002\t01` }))).toBe('bad-chars:qris');
    // Every other box keeps the one-line limit.
    expect(codeOf(() => checkPayDetails('SEPA', { name: 'Jane', iban: 'D'.repeat(PAY_FIELD_MAX_CHARS.line + 1) }))).toBe('too-long:iban');
  });

  it('review F5: identifiers the payer copies exactly are account boxes (hidden characters refused)', () => {
    for (const [id, key] of [['PAYTM', 'upiId'], ['STRIKE', 'lightningAddress'], ['TIKKIE', 'paymentLink'], ['QRIS', 'qris'], ['PAGO_MOVIL', 'idNumber']] as const) {
      expect(payFieldsFor(id).find((f) => f.key === key)?.kind, `${id}.${key}`).toBe('account');
    }
  });

  it('lead decision (10 Nov, review): Pago Movil takes its own payee identifier, the cedula or RIF, required', () => {
    expect(payFieldsFor('PAGO_MOVIL').map((f) => [f.key, f.need])).toEqual([['phone', 'yes'], ['idNumber', 'yes'], ['bank', 'yes'], ['name', 'no']]);
    expect(PAY_FIELDS.PAGO_MOVIL!.source).toMatch(/lead/);
  });

  it('a mailing address may span lines, but never more than its box allows', () => {
    const ok = checkPayDetails('PAY_BY_MAIL', { name: 'Jane Doe', address: '12 Main St\nApt 4\nToronto ON  M5V 1A1' });
    expect(ok).toEqual([
      { key: 'name', value: 'Jane Doe' },
      { key: 'address', value: '12 Main St\nApt 4\nToronto ON  M5V 1A1' },
    ]);
    expect(codeOf(() => checkPayDetails('PAY_BY_MAIL', { name: 'Jane', address: Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n') }))).toBe('bad-value:address');
  });

  it('the free-text box is required for CUSTOM and a method outside the table; CUSTOM\'s may span lines', () => {
    expect(codeOf(() => checkPayDetails('CUSTOM', {}))).toBe('missing:details');
    expect(codeOf(() => checkPayDetails('NOT_A_METHOD', {}))).toBe('missing:details');
    expect(checkPayDetails('CUSTOM', { details: 'Meet at the station,\ncash in hand' })).toEqual([{ key: 'details', value: 'Meet at the station,\ncash in hand' }]);
    expect(codeOf(() => checkPayDetails('NOT_A_METHOD', { details: 'a\nb' }))).toBe('bad-value:details');
  });
});

describe('the packaged message', () => {
  const pay: PayDetailsPayload = { v: PAY_DETAILS_V, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }] };

  it('renders the same plain text on both sides (the old-client fallback): a title and one "Label: value" line per field', () => {
    expect(renderPayDetailsText(pay)).toBe('Payment details\nFull name: Jane Doe\nEmail: jane@example.ca');
    expect(renderPayDetailsText({ ...pay, fields: [...pay.fields] })).toBe(renderPayDetailsText(pay));
  });

  it('review F3: the package is version 2; a version 1 package is refused', () => {
    expect(PAY_DETAILS_V).toBe(2);
    expect(() => parsePayDetails({ ...pay, v: 1 })).toThrow(PayDetailsError);
  });

  it('review F3: labels are not part of the wire format: a text sealed under other labels still matches its values, a changed value never does', () => {
    const text = renderPayDetailsText(pay);
    expect(payTextMatches(pay, text)).toBe(true);
    // The owner re-words the labels (J-26): a package sealed under the old wording still opens.
    expect(payTextMatches(pay, 'Payment details\nYour full legal name: Jane Doe\nEmail address: jane@example.ca')).toBe(true);
    // Review R1: a label is 1 to 120 characters with no colon and no line break.
    expect(payTextMatches(pay, 'Payment details\nName: with a colon: Jane Doe\nEmail: jane@example.ca')).toBe(false);
    expect(payTextMatches(pay, `Payment details\n${'N'.repeat(121)}: Jane Doe\nEmail: jane@example.ca`)).toBe(false);
    expect(payTextMatches(pay, `Payment details\n${'N'.repeat(120)}: Jane Doe\nEmail: jane@example.ca`)).toBe(true);
    // Values, their order, their count and the title are the wire format.
    for (const bad of [
      'Payment details\nFull name: Jane Doe\nEmail: other@example.ca',
      'Payment details\nEmail: jane@example.ca\nFull name: Jane Doe',
      'Payment details\nFull name: Jane Doe',
      'Payment details\nFull name: Jane Doe\nEmail: jane@example.ca\nPhone: 1',
      'Details\nFull name: Jane Doe\nEmail: jane@example.ca',
      'Payment details\nFull name: Jane Doe\n: jane@example.ca',
      'Payment details\nFull name: Jane DoeEmail: jane@example.ca',
      'Payment details\n\nFull name: Jane Doe\nEmail: jane@example.ca',
      `${text}\n`,
    ]) expect(payTextMatches(pay, bad), JSON.stringify(bad)).toBe(false);
    // A multi-line value (a mailing address) still reads back exactly.
    const mail: PayDetailsPayload = { v: PAY_DETAILS_V, method: 'PAY_BY_MAIL', fields: [{ key: 'name', value: 'Jane' }, { key: 'address', value: '12 Main St\nToronto' }] };
    expect(payTextMatches(mail, 'Payment details\nName to write: Jane\nPost to: 12 Main St\nToronto')).toBe(true);
    expect(payTextMatches(mail, 'Payment details\nName to write: Jane\nPost to: 12 Main St\nOttawa')).toBe(false);
  });

  it('parsePayDetails takes exactly the sealed shape and re-checks the fields', () => {
    expect(parsePayDetails(JSON.parse(JSON.stringify(pay)))).toEqual(pay);
    const bad: unknown[] = [
      null,
      'x',
      { ...pay, v: 3 },
      { ...pay, v: 1 },
      { ...pay, extra: 1 },
      { v: 1, method: 'INTERAC_E_TRANSFER' },
      { ...pay, method: 7 },
      { ...pay, fields: [] },
      { ...pay, fields: [{ key: 'email', value: 'jane@example.ca' }] }, // no name
      { ...pay, fields: [{ key: 'name', value: 'Jane' }] }, // neither email nor phone
      { ...pay, fields: [{ key: 'name', value: 'Jane' }, { key: 'email', value: 'a@b', extra: 1 }] },
      { ...pay, fields: [{ key: 'email', value: 'a@b' }, { key: 'name', value: 'Jane' }] }, // out of table order
      { ...pay, fields: [{ key: 'name', value: ' Jane' }, { key: 'email', value: 'a@b' }] }, // not trimmed
      { ...pay, fields: [{ key: 'name', value: 'Jane' }, { key: 'name', value: 'Jane' }, { key: 'email', value: 'a@b' }] },
    ];
    for (const b of bad) expect(() => parsePayDetails(b), JSON.stringify(b)).toThrow(PayDetailsError);
  });

  it('a method outside the table packages its one box', () => {
    const custom: PayDetailsPayload = { v: PAY_DETAILS_V, method: 'NOT_A_METHOD', fields: [{ key: 'details', value: '070-123 45 67' }] };
    expect(parsePayDetails(custom)).toEqual(custom);
    expect(renderPayDetailsText(custom)).toBe('Payment details\nPayment details: 070-123 45 67');
  });
});

describe('the 12 Nov recheck (research-payee-fields-confirm-2026-11-12; lead 12 Nov)', () => {
  it('SPEI: the CLABE, plus optional 16-digit debit card and 10-digit mobile (Banxico Circular 10/2026, Art. 17 Ter IV)', () => {
    expect(payFieldsFor('SPEI').map((f) => [f.key, f.kind, f.need])).toEqual([
      ['name', 'text', 'yes'], ['clabe', 'account', 'yes'], ['bankName', 'text', 'no'], ['cardNumber', 'account', 'no'], ['phone', 'phone', 'no'],
    ]);
    expect(checkPayDetails('SPEI', { name: 'Ana', clabe: '002010077777777771', cardNumber: '4152313800000000', phone: '5512345678' }).map((f) => f.key)).toEqual(['name', 'clabe', 'cardNumber', 'phone']);
  });

  it('ATM cash: one optional box for a phone that receives the cash code; no longer nothing-to-send', () => {
    expect(payeeGivesNothing('CASH_AT_ATM')).toBe(false);
    expect(payFieldsFor('CASH_AT_ATM').map((f) => [f.key, f.kind, f.need])).toEqual([['phone', 'phone', 'no']]);
  });

  it('Nequi: the Bre-B key label names what a key may be, never the personal ID', () => {
    expect(payFieldsFor('NEQUI').find((f) => f.key === 'breBKey')?.label).toBe('Bre-B key (phone, email or the key your bank gave you)');
  });

  it('WorldRemit takes an optional address; Lydia a username in its reach group; Postepay P2P a mobile number or alias', () => {
    expect(payFieldsFor('WORLDREMIT').find((f) => f.key === 'address')).toEqual({ key: 'address', label: 'Address', kind: 'postal', need: 'no' });
    expect(payFieldsFor('LYDIA').find((f) => f.key === 'username')).toEqual({ key: 'username', label: 'Lydia username', kind: 'account', need: { oneOf: 'reach' } });
    const p2p = payFieldsFor('POSTEPAY').find((f) => f.key === 'phone');
    expect(p2p).toEqual({ key: 'phone', label: 'Mobile number or Postepay alias (P2P)', kind: 'account', need: { oneOf: 'reach' } });
    expect(checkPayDetails('POSTEPAY', { name: 'Mario Rossi', phone: 'mario.rossi' })).toEqual([{ key: 'name', value: 'Mario Rossi' }, { key: 'phone', value: 'mario.rossi' }]);
  });

  it('Alipay and Weixin Pay: the name is the registered one, in pinyin', () => {
    expect(payFieldsFor('ALI_PAY').find((f) => f.key === 'name')?.label).toBe('Full name as registered on Alipay (in pinyin or Latin letters)');
    expect(payFieldsFor('WECHAT_PAY').find((f) => f.key === 'name')).toEqual({ key: 'name', label: 'Real name as verified in Weixin Pay (pinyin)', kind: 'text', need: 'no' });
  });

  it('a method may carry a note for the payee: Monese and cash deposit do; others do not', () => {
    expect(payNoteFor('MONESE')).toMatch(/Monese ID/);
    expect(payNoteFor('CASH_DEPOSIT')).toMatch(/cash deposits/);
    expect(payNoteFor('ZELLE')).toBeUndefined();
    expect(payNoteFor('NOT_A_METHOD')).toBeUndefined();
  });

  it('every rechecked row records the recheck and its new confidence', () => {
    const rechecked = Object.entries(PAY_FIELDS).filter(([, r]) => r.source.includes('recheck 2026-11-12'));
    expect(rechecked).toHaveLength(60);
    for (const [id, r] of rechecked) expect(/recheck 2026-11-12 \((high|medium|low)[^)]*\)/.test(r.source), id).toBe(true);
  });
});

describe('a trade taken before the 12 Nov ban (owner: Russian anything is banned; lead default, owner question)', () => {
  it('SBP, MIR and YOOMONEY have no row: the payee of a trade still running gets the one free-text box', () => {
    for (const id of ['SBP', 'MIR', 'YOOMONEY']) {
      expect(Object.prototype.hasOwnProperty.call(PAY_FIELDS, id), id).toBe(false);
      expect(payFieldsFor(id).map((f) => f.key), id).toEqual(['details']);
      expect(payeeGivesNothing(id), id).toBe(false);
      expect(checkPayDetails(id, { details: '+7 900 000 00 00, any bank' }), id).toEqual([{ key: 'details', value: '+7 900 000 00 00, any bank' }]);
    }
  });

  it("a package sealed with SBP's old boxes (an older bundle) is refused for its contents (unknown-field), never shown", () => {
    const old = { v: PAY_DETAILS_V, method: 'SBP', fields: [{ key: 'phone', value: '+79000000000' }, { key: 'bankName', value: 'Bank' }] };
    expect(codeOf(() => parsePayDetails(old))).toBe('unknown-field:phone');
  });
});
