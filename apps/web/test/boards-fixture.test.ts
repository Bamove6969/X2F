import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOARD_BUY_LIVE_USD, BOARD_SELL_LIVE_USD, BOARD_TRADE } from '../src/fixtures/boards.js';

const BOARDS = fileURLToPath(new URL('../../../design/x2f-app/', import.meta.url));
const CATALOG = fileURLToPath(new URL('../../../data/payment-methods.json', import.meta.url));
const board = (name: string) => readFileSync(`${BOARDS}${name}.dc.html`, 'utf8');

const xmr = (atomic: bigint) => `${atomic / 1_000_000_000_000n}.${String(atomic % 1_000_000_000_000n).padStart(12, '0').slice(0, 6)}`;
const usd = (cents: bigint) => `$${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

describe('board fixtures', () => {
  it('the example trade is the one the boards show', () => {
    const t = BOARD_TRADE;
    expect(board('TradeFund')).toContain(`Selling to ${t.buyer}`);
    expect(board('BuyerPay')).toContain(`Buying from ${t.seller}`);
    for (const name of ['TradeFund', 'BuyerPay', 'SellerConfirm', 'SellerRefund', 'DisputeOpen', 'DisputeRoom', 'DisputeRuling', 'Desktop']) {
      // The refreshed boards put the code in its own mono span: compare the text, not the markup.
      const text = board(name).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
      expect(text, name).toContain(`Trade ${t.code} · ${t.method.name}`);
    }
    for (const name of ['TradeFund', 'Review', 'Desktop']) expect(board(name), name).toContain(`${xmr(t.amountAtomic)}`);
    for (const name of ['TradeFund', 'BuyerPay', 'SellerConfirm', 'Desktop']) expect(board(name), name).toContain(usd(t.fiatCents));
    for (const name of ['TradeFund', 'BuyQuote', 'Desktop']) expect(board(name), name).toContain(`${usd(t.rateCentsPerXmr)} / XMR`);
    expect(board('TradeFund')).toContain(`${usd(t.fiatCents)} ${t.currency}`);
  });

  it('adds up: amount × rate = the fiat total', () => {
    expect((BOARD_TRADE.amountAtomic * BOARD_TRADE.rateCentsPerXmr) / 1_000_000_000_000n).toBe(BOARD_TRADE.fiatCents);
  });

  // review-agy-giftcards-2026-11-17 M2: a live board row says what /v1/methods would send, so its
  // giftCard flag is the catalogue's (Amazon gift card was once false here and true there).
  it('every live board row is a catalogue method, with the catalogue\'s giftCard flag', () => {
    const catalog = (JSON.parse(readFileSync(CATALOG, 'utf8')) as { methods: { id: string; giftCard?: boolean }[] }).methods;
    for (const row of [...BOARD_BUY_LIVE_USD, ...BOARD_SELL_LIVE_USD]) {
      const m = catalog.find((c) => c.id === row.id);
      expect(m, row.id).toBeDefined();
      expect([row.id, row.giftCard]).toEqual([row.id, m?.giftCard === true]);
    }
  });
});
