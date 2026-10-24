import { MAX_WALLET_BATCH as API_MAX } from '@x2f/accounts';
import { describe, expect, it } from 'vitest';
import { MAX_WALLET_BATCH, nameSuggestions, ruleNote, takeableWallets, type WalletView } from '../src/screens/wallets-model.js';

const wallet = (id: string, usable: boolean): WalletView => ({
  id, app: 'cake', label: id, address: `4${id}`, addressEnd: id.slice(-6), usableFrom: '2026-10-24T00:00:00.000Z', usable,
});

describe('wallets model', () => {
  it('the batch limit matches the API', () => {
    expect(MAX_WALLET_BATCH).toBe(API_MAX);
  });

  it('the take picker never offers a waiting wallet', () => {
    expect(takeableWallets([wallet('a', true), wallet('b', false)]).map((w) => w.id)).toEqual(['a']);
  });

  it('suggested names are neutral and the next number comes first', () => {
    expect(nameSuggestions(1)).toEqual(['Wallet 2', 'Savings', 'Spending']);
  });

  it('the note under the form follows the rule', () => {
    expect(ruleNote({ firstWallet: true, strongMethods: [], password: 'immediate', waitHours: 24 })).toBe(
      'Your first wallet works at once.',
    );
    expect(ruleNote({ firstWallet: false, strongMethods: [], password: 'waits', waitHours: 24 })).toBe(
      'They will work 24 hours after you add them.',
    );
  });
});
