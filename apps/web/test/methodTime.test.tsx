// @vitest-environment happy-dom
// Owner p9-4 (8 Nov): "When they are selecting the payment method ... it should say right on there
// ... FYI this payment method can take up to 12 hours." The minutes come from GET /v1/methods.
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { parseMethodLists, type MethodRow } from '../src/screens/browse/api.js';
import { MethodPicker } from '../src/screens/browse/MethodPicker.js';
import { methodUpToLine, minutesText } from '../src/screens/browse/methodTime.js';
import { parseMethods } from '../src/screens/post/api.js';
import { parseMyOffers } from '../src/screens/myoffers/api.js';
import { render } from './render.js';

const ROW = { id: 'SWIFT', name: 'International wire (SWIFT)', group: 'Bank transfers', giftCard: false, offers: 2, bestRate: '33000' };

describe('minutesText and the up-front line', () => {
  it('says each method time in plain words', () => {
    expect(minutesText(90)).toBe('90 minutes');
    expect(minutesText(180)).toBe('3 hours');
    expect(minutesText(1440)).toBe('24 hours');
    expect(minutesText(2880)).toBe('2 days');
    expect(minutesText(4320)).toBe('3 days');
    expect(minutesText(5760)).toBe('4 days');
    expect(minutesText(150)).toBe('2 hours 30 minutes');
    expect(minutesText(60)).toBe('60 minutes');
    expect(minutesText(0)).toBe('');
  });

  it("uses the owner's words as the draft (COPY-UNSIGNED)", () => {
    expect(methodUpToLine(720)).toBe('This payment method can take up to 12 hours.');
  });
});

describe('the API answers carry the times', () => {
  it('GET /v1/methods rows: upToMin when sent, null from an older API; a bad one fails loudly', () => {
    const lists = parseMethodLists({ live: [{ ...ROW, upToMin: 4320, payWindowMin: 180 }], all: [ROW] });
    expect(lists.live[0]!.upToMin).toBe(4320);
    expect(lists.all[0]!.upToMin).toBeNull();
    expect(() => parseMethodLists({ live: [{ ...ROW, upToMin: '4320' }], all: [] })).toThrow();
  });

  it('the post form reads upToMin from the methods list', () => {
    expect(parseMethods({ all: [{ ...ROW, upToMin: 90 }] })[0]!.upToMin).toBe(90);
    expect(parseMethods({ all: [ROW] })[0]!.upToMin).toBeNull();
    expect(() => parseMethods({ all: [{ ...ROW, upToMin: -1 }] })).toThrow();
  });

  it("My offers reads each offer's time to pay", () => {
    const offer = {
      id: 'a', side: 'sell', methodId: 'PAY_BY_MAIL', methodName: 'Cash by mail', currency: 'USD', rate: null,
      pricing: { mode: 'market', marginBps: 0 }, minFiatCents: '1000', maxFiatCents: '50000', minTrades: 0, status: 'live',
    };
    expect(parseMyOffers([{ ...offer, payWindowMin: 1440 }])[0]!.payWindowMin).toBe(1440);
    expect(parseMyOffers([offer])[0]!.payWindowMin).toBeUndefined();
    expect(() => parseMyOffers([{ ...offer, payWindowMin: 0 }])).toThrow();
  });
});

describe('the picker shows it where the method is picked', () => {
  it('under the shown method, and in each choice of the sheet', () => {
    const rows: MethodRow[] = parseMethodLists({ live: [{ ...ROW, upToMin: 4320 }], all: [] }).live;
    const { host } = render(
      <MemoryRouter>
        <MethodPicker
          live={rows}
          value={rows[0]!}
          onChange={() => {}}
          title="Buyers paying in USD"
          sub={() => '2 buyers paying in USD'}
          href={() => '/sell/SWIFT'}
          upTo={(m) => (m.upToMin === null ? null : methodUpToLine(m.upToMin))}
        />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-part="up-to"]')?.textContent).toBe('This payment method can take up to 3 days.');
  });
});
