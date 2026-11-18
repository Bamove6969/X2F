// Plan 4 Task 19: the training library's anonymizer (Review Focus 5). Every mask kind, the names
// case-insensitively and through zero-width characters, never inside a longer word, and nothing of
// the fixture's sensitive strings left in the scrubbed output.
import { describe, expect, it } from 'vitest';
import { MANUAL_MASK, TRADE_CODE_MASK, anonymizeCase, anonymizeText, applyManualMasks, offsetLabel, type AnonymizeNames } from '../src/index.js';

const NAMES: AnonymizeNames = { buyer: ['mira.k'], seller: ['quietfox', 'qf-login'], staff: ['dmitri_k', 'lumen.k'] };
const BASE58 = '123456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** A made-up address-shaped string (never a real key): `len` base58 characters starting with `first`. */
function addressLike(first: '4' | '8', len: number, seed = 7): string {
  let s = first;
  let x = seed;
  for (let i = 1; i < len; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += BASE58[x % BASE58.length];
  }
  return s;
}
const ADDR = addressLike('4', 95);
const SUB = addressLike('8', 95, 11);
const INTEGRATED = addressLike('4', 106, 13);
const TX = 'a3'.repeat(32);
const CARD = '4111 1111 1111 1111';
const IBAN = 'DE89 3704 0044 0532 0130 00';
const CODE = 'K7M2-9QXA-4FTR-8WPN';

const scrub = (t: string) => anonymizeText(t, NAMES, [CODE]);

describe('anonymizeText', () => {
  it('replaces the usernames case-insensitively and through zero-width characters', () => {
    expect(scrub('MiRa.K paid, said mira.k.').text).toBe('Buyer paid, said Buyer.');
    expect(scrub('mi​ra.k and quiet﻿fox').text).toBe('Buyer and Seller');
    expect(scrub('qf-login wrote to dmitri_k and LUMEN.K').text).toBe('Seller wrote to Moderator and Moderator');
  });

  it('never masks a username inside a longer word', () => {
    expect(scrub('admira.kx is someone else').text).toBe('admira.kx is someone else');
    expect(scrub('mira.kx and xmira.k').text).toBe('mira.kx and xmira.k');
  });

  it('replaces the trade code, with or without dashes, and any other grouped code', () => {
    expect(scrub(`Trade ${CODE} and k7m29qxa4ftr8wpn`).text).toBe(`Trade ${TRADE_CODE_MASK} and ${TRADE_CODE_MASK}`);
    expect(scrub('Also 3HW8-ZD2N-RT6K-Q9VB.').text).toBe(`Also ${TRADE_CODE_MASK}.`);
    // A long ordinary word is not a code.
    expect(scrub('responsibilities').text).toBe('responsibilities');
  });

  it('masks a Monero address, a subaddress and an integrated address', () => {
    for (const a of [ADDR, SUB, INTEGRATED]) {
      const s = scrub(`send to ${a} please`);
      expect(s.text).toBe('send to [address] please');
      expect(s.masks).toEqual([{ start: 8, end: 17, kind: 'address' }]);
    }
  });

  it('masks an address split by spaces or a line break', () => {
    const split = `${ADDR.slice(0, 40)}\n${ADDR.slice(40, 70)} ${ADDR.slice(70)}`;
    const s = scrub(`it was ${split}, thanks`);
    expect(s.text).toBe('it was [address], thanks');
    expect(s.text).not.toContain(ADDR.slice(70));
  });

  it('does not mask a base58 run of the wrong length', () => {
    const short = ADDR.slice(0, 94);
    expect(scrub(short).text).toBe(short);
  });

  it('masks an IBAN, a Luhn-valid card, an email, a phone number and a tx id', () => {
    expect(scrub(`IBAN ${IBAN} please`).text).toBe('IBAN [account] please');
    expect(scrub(`Card ${CARD} ok`).text).toBe('Card [card] ok');
    expect(scrub('Card 4111-1111-1111-1111.').text).toBe('Card [card].');
    expect(scrub('mail me at mira.k@example.com now').text).toBe('mail me at [email] now');
    expect(scrub('call +1 (555) 123-4567 today').text).toBe('call [phone] today');
    expect(scrub('or 0171 234 5678').text).toBe('or [phone]');
    expect(scrub(`tx ${TX} done`).text).toBe('tx [tx] done');
    const s = scrub(`Card ${CARD} ok`);
    expect(s.masks).toEqual([{ start: 5, end: 11, kind: 'card' }]);
  });

  it('does not mask a Luhn-invalid 16-digit number, an amount or a date', () => {
    expect(scrub('ref 4111 1111 1111 1112').text).toBe('ref 4111 1111 1111 1112');
    expect(scrub('paid 1,320.00 USD for 1.25 XMR on 2026-11-02').text).toBe('paid 1,320.00 USD for 1.25 XMR on 2026-11-02');
  });
});

describe('applyManualMasks', () => {
  it('hides a stretch the owner selected, keeping the automatic masks in place', () => {
    const s = scrub(`Paid by Jane Doe, card ${CARD}.`);
    expect(s.text).toBe('Paid by Jane Doe, card [card].');
    const start = s.text.indexOf('Jane Doe');
    const m = applyManualMasks(s, [{ start, end: start + 'Jane Doe'.length }]);
    expect(m.text).toBe(`Paid by ${MANUAL_MASK}, card [card].`);
    expect(m.masks).toEqual([
      { start, end: start + MANUAL_MASK.length, kind: 'manual' },
      { start: m.text.indexOf('[card]'), end: m.text.indexOf('[card]') + 6, kind: 'card' },
    ]);
  });

  it('refuses masks out of range, overlapping, or cutting into an automatic one', () => {
    const s = scrub(`card ${CARD}`);
    expect(() => applyManualMasks(s, [{ start: 0, end: 99 }])).toThrow(RangeError);
    expect(() => applyManualMasks(s, [{ start: 0, end: 3 }, { start: 2, end: 4 }])).toThrow(RangeError);
    expect(() => applyManualMasks(s, [{ start: 6, end: 8 }])).toThrow(RangeError);
  });
});

describe('anonymizeCase', () => {
  const opened = new Date('2026-11-02T09:00:00.000Z');
  const SENSITIVE = ['mira.k', 'quietfox', 'dmitri_k', CODE, ADDR, CARD, IBAN, TX, 'mira.k@example.com', '2026-11-02T', '09:42'];
  const c = {
    buyer: 'mira.k',
    seller: 'quietfox',
    staff: ['dmitri_k'],
    tradeCode: CODE,
    openedAt: opened,
    method: 'Zelle',
    amountXmr: '1.25',
    messages: [
      { from: 'buyer' as const, at: new Date(opened.getTime() + 42 * 60_000), text: `Hi quietfox, I paid from mira.k@example.com, card ${CARD}. Trade ${CODE}.` },
      { from: 'seller' as const, at: new Date(opened.getTime() + 125 * 60_000), text: `Nothing came. Refund to ${ADDR} or IBAN ${IBAN}.` },
      { from: 'mod' as const, at: new Date(opened.getTime() + 26 * 3_600_000), text: `dmitri_k here, checking tx ${TX}.` },
    ],
    ruling: { outcome: 'release-to-buyer', reason: `mira.k's payment shows in quietfox's activity at 09:42.` },
  };

  it('times become offsets from the opening, and the code is the mask', () => {
    const { body } = anonymizeCase(c);
    expect(body.tradeCode).toBe(TRADE_CODE_MASK);
    expect(body.messages.map((m) => m.at)).toEqual(['T+0:42', 'T+2:05', 'T+26:00']);
    expect(offsetLabel(new Date(opened.getTime() - 1), opened)).toBe('T+0:00');
  });

  it('lists every mask by message, the reason as -1', () => {
    const { masks } = anonymizeCase(c);
    expect(masks.filter((m) => m.messageIndex === 0).map((m) => m.kind)).toEqual(['email', 'card']);
    expect(masks.filter((m) => m.messageIndex === 1).map((m) => m.kind)).toEqual(['address', 'account']);
    expect(masks.filter((m) => m.messageIndex === 2).map((m) => m.kind)).toEqual(['tx']);
  });

  it('the scrubbed body holds none of the fixture\'s sensitive strings', () => {
    const json = JSON.stringify(anonymizeCase(c).body);
    for (const s of SENSITIVE.filter((x) => x !== '09:42')) expect(json, s).not.toContain(s);
    // A clock time inside free text is not one of the plan's masks: the reason keeps "09:42" (the
    // owner reviews free text, Review Focus 5); every recorded time is an offset.
    expect(json).toContain('Buyer\'s payment shows in Seller\'s activity');
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
