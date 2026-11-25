// Owner demo note #226 and the security review of wip/lead-note-226 (Medium 1): a wallet's name can
// never pass for the details shown beside it.
import { describe, expect, test } from 'vitest';
import { WALLET_LABEL_MAX, cleanWalletLabel, walletLabelProblem } from '@x2f/accounts';

/** The web's neutral name suggestions (apps/web/src/screens/wallets-model.ts `nameSuggestions`): they must all pass. */
const nameSuggestionsForTest = ['Wallet 1', 'Wallet 2', 'Wallet 3', 'Savings', 'Spending'];

describe('walletLabelProblem', () => {
  test('ordinary names, the neutral defaults and the suggestions pass', () => {
    for (const ok of ['Wallet 1', 'Wallet 12', 'Savings', 'Spending', 'Spending 2', 'Cake Wallet savings', 'Rent money', 'Monero GUI', 'Ledger or Trezor', 'Edge 2024', 'Already', 'Steady', 'Вася', '東京の財布', '🙂'.repeat(WALLET_LABEL_MAX), ...nameSuggestionsForTest]) {
      expect(walletLabelProblem(ok), ok).toBeNull();
    }
    expect(cleanWalletLabel('  Savings  ')).toBe('Savings');
  });

  test('length and characters', () => {
    expect(walletLabelProblem('')).toBe('length');
    expect(walletLabelProblem('   ')).toBe('length');
    expect(walletLabelProblem('x'.repeat(WALLET_LABEL_MAX + 1))).toBe('length');
    expect(walletLabelProblem(7)).toBe('characters');
    for (const bad of ['a‮b', 'a​b', 'a\nb', 'Sаvings', 'Мy savings', 'שלום']) expect(walletLabelProblem(bad), bad).toBe('characters');
  });

  test('separators the lists draw, and their look-alikes', () => {
    for (const bad of ['Savings …Rk3Fz1', 'Main · Cake', 'Main • x', 'a..b', 'Main | Ready', 'Wallet ꞏ 2', 'Main ∙ x', 'Main ・ x']) expect(walletLabelProblem(bad), bad).toBe('separator');
  });

  test('status words, any case, look-alikes and digits folded', () => {
    for (const bad of ['Default', 'default wallet', 'READY', 'Ready-ish', 'Usable', 'Waiting', 'Verified', 'In use', 'One trade only', 'D3fault', 'Défault']) expect(walletLabelProblem(bad), bad).toBe('status');
  });

  test('anything that reads like the end of an address', () => {
    for (const bad of ['Rk3Fz1', 'Wallet abc123x', 'MySavings', 'W7HcW2']) expect(walletLabelProblem(bad), bad).toBe('address');
  });
});
