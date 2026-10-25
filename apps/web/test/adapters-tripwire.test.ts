// TRIPWIRES for the guesses in src/escrow/adapters.ts and src/escrow/signals.ts (Task 12 was built
// before Tasks 6, 8 and 10; Task 6's TradeView is now checked). Each fails once the real module is on the line: then replace the guess
// with the real import, adjust the runtime to the real shapes, and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as trade from '@x2f/trade';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 12 guesses still stand in for missing modules', () => {
  it('NEEDS_TASK_8: verifyAttestation / attestationBytes / Attestation come from adapters.ts, not @x2f/trade', () => {
    expect(has('packages/trade/src/attestation.ts'), 'Task 8 attestation landed: use @x2f/trade verifyAttestation').toBe(false);
    expect('verifyAttestation' in trade, 'Task 8 attestation landed').toBe(false);
  });

  it('NEEDS_TASK_8: escrowCheckWords is a placeholder (hex groups, not the 2048-word list)', () => {
    expect(has('packages/trade/src/checkWords.ts'), 'Task 8 check words landed: use @x2f/trade escrowCheckWords').toBe(false);
    expect('escrowCheckWords' in trade).toBe(false);
  });

  it('NEEDS_TASK_8: identity proof bytes and the identity/attestation route answers are guessed', () => {
    expect(has('apps/api/src/trades/identity.ts'), 'Task 8 identity route landed: check identityProofBytes and httpEscrowApi').toBe(false);
  });

  it('NEEDS_TASK_10: the trade.ack payload and the trade.terms deal field are guessed', () => {
    expect(has('apps/moderation/src/signals.ts'), 'Task 10 signals landed: check the signal payloads in signals.ts').toBe(false);
  });

  it('NEEDS_TASKS_18_19: the take and accept screens must pass the user-confirmed deal to useEscrow', () => {
    // The first useEscrow(code, confirmed) call for a trade needs what the user saw and confirmed;
    // once those screens exist they must pass it (and this tripwire goes).
    expect(has('apps/web/src/screens/quote/useTake.tsx'), 'Task 18 landed: pass ConfirmedTrade from the take').toBe(false);
    expect(has('apps/web/src/screens/AcceptedSheet.tsx'), 'Task 19 landed: pass ConfirmedTrade from the accepted sheet').toBe(false);
  });
});
