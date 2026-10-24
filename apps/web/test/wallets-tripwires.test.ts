// Tripwires for Task 29 (Your wallets). The screen is built against two pieces that live on other
// branches; each test here fails once that piece reaches this line, so whoever merges wires it in
// and deletes the test (the auth-client Tasks 11/12 tripwire pattern).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

describe('Task 29 tripwires', () => {
  it('FU-B: getWalletRule / addWallets are not in @x2f/auth-client yet', () => {
    // Wallets.tsx calls GET /v1/wallets/rule and POST /v1/wallets { wallets } through api() with
    // the FU-B shapes copied into wallets-model.ts (WalletRule, WalletDraft). Once the lead's FU-B
    // (wip/lead-p2-fub) is on the main line: use `getWalletRule`, `addWallets`, `withConfirm` and
    // `walletsAction` from @x2f/auth-client, drop the copied types, then delete this test.
    const api = readFileSync(at('../../../packages/auth-client/src/api.ts'), 'utf8');
    expect(api, 'FU-B has landed: wire Wallets.tsx to @x2f/auth-client and delete this tripwire').not.toMatch(
      /getWalletRule|addWallets/,
    );
  });

  it('Task 30: the local ConfirmSheet stub is gone once the real ConfirmSheet lands', () => {
    if (!existsSync(at('../src/screens/auth/ConfirmSheet.tsx'))) return;
    expect(
      existsSync(at('../src/screens/ConfirmSheet.stub.tsx')),
      'Task 30 has landed: use auth/ConfirmSheet in Wallets.tsx and delete ConfirmSheet.stub.tsx',
    ).toBe(false);
  });
});
