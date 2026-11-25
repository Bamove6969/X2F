// Owner demo note #226 and the security review of wip/lead-note-226 (Medium 1): a wallet's name can
// never pass for the details shown beside it.
import { describe, expect, test } from 'vitest';
import { WALLET_LABEL_MAX, addressFold, cleanWalletLabel, labelSpoofsAddress, walletLabelProblem } from '@x2f/accounts';

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

  test('verification review: look-alikes of the end of one of the account\'s addresses (labelSpoofsAddress)', () => {
    const mine = [`4${'9'.repeat(88)}Rk3Fz1`, `4${'9'.repeat(88)}kfzxqm`, `4${'9'.repeat(88)}kImPq9`];
    for (const bad of [
      '\uFF32\uFF4B\uFF13\uFF26\uFF5A\uFF11', '\u{1D411}\u{1D424}\u{1D7D1}\u{1D405}\u{1D433}\u{1D7CF}', 'kImPq9', 'klmpq', 'Rk3Fz0', 'Rk3Fz', 'k3Fz1',
      'Rk3-Fz1', 'Rk3 Fz1', 'Savings kfzxqm', 'KFZXQ', 'k.f.z.x.q',
    ]) {
      expect(walletLabelProblem(bad, mine), bad).not.toBeNull();
      expect(labelSpoofsAddress(bad, mine) || walletLabelProblem(bad) !== null, bad).toBe(true);
    }
    // Without the account's addresses, an all-lower-case end is only caught when the API checks it.
    expect(walletLabelProblem('Savings kfzxqm')).toBeNull();
    expect(addressFold('Ｒｋ３-Ｆｚ１ 0I')).toBe('rk3fzlol');
    for (const ok of ['Savings', 'Cake Wallet savings', 'Monero main', 'Spending 2', 'Wallet-2', 'Wallet 1', 'Rent money']) {
      expect(walletLabelProblem(ok, mine), ok).toBeNull();
    }
  });

  test('verification review: the backstop after NFKC, and more separators and check marks', () => {
    for (const bad of ['\uFF32\uFF4B\uFF13\uFF26\uFF5A\uFF11', 'Rk3Fz0', 'kImPq9', 'Rk3-Fz1']) expect(walletLabelProblem(bad), bad).toBe('address');
    for (const bad of ['Main \u22EF x', 'a \u2024 b', 'a \u2027 b', 'Done \u2713', 'Done \u2714', 'Savings \u2611']) expect(walletLabelProblem(bad), bad).toBe('separator');
  });
});
