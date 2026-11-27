import { readFileSync } from 'node:fs';
import { MAX_WALLET_BATCH as API_MAX } from '@x2f/auth-client';
import { describe, expect, it } from 'vitest';
import { MAX_WALLET_BATCH, nameSuggestions, ruleNote, takeableWallets, type WalletView } from '../src/screens/wallets-model.js';

const wallet = (id: string, usable: boolean): WalletView => ({
  id, app: 'cake', label: id, address: `4${id}`, addressEnd: id.slice(-6), usableFrom: '2026-10-24T00:00:00.000Z', usable,
});

describe('wallets model', () => {
  it('the batch limit matches the API', () => {
    expect(MAX_WALLET_BATCH).toBe(API_MAX);
  });

  it('the web app takes the limit from @x2f/auth-client, not a direct @x2f/accounts dependency', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain('@x2f/accounts');
  });

  it('the take picker never offers a waiting wallet', () => {
    expect(takeableWallets([wallet('a', true), wallet('b', false)]).map((w) => w.id)).toEqual(['a']);
  });

  it('suggested names are neutral and the next number comes first', () => {
    expect(nameSuggestions(1)).toEqual(['Wallet 2', 'Savings', 'Spending']);
  });

  it('the note under the form follows the rule', () => {
    expect(ruleNote({ firstWallet: true, strongMethods: [] })).toBe('Your first wallet works at once.');
    expect(ruleNote({ firstWallet: false, strongMethods: [] })).toBe("Saving asks you to confirm it's you.");
    expect(ruleNote(null)).toBe("Saving asks you to confirm it's you. New wallets work at once.");
  });
});
