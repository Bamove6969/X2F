// Tripwire for Task 29 (Your wallets): the confirm step is a local stub until Task 30's ConfirmSheet
// lands; this fails once it does and the stub is still here, so whoever merges wires it in and
// deletes the test (the auth-client Tasks 11/12 tripwire pattern). The FU-B tripwire went when FU-B
// reached the main line and the screen moved to its @x2f/auth-client types.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

describe('Task 29 tripwires', () => {
  it('Task 30: the local ConfirmSheet stub is gone once the real ConfirmSheet lands', () => {
    if (!existsSync(at('../src/screens/auth/ConfirmSheet.tsx'))) return;
    expect(
      existsSync(at('../src/screens/ConfirmSheet.stub.tsx')),
      'Task 30 has landed: use auth/ConfirmSheet in Wallets.tsx and delete ConfirmSheet.stub.tsx',
    ).toBe(false);
  });
});
