// TRIPWIRES for the guesses in src/escrow/signals.ts (Task 12 was built before Tasks 6, 8 and 10;
// Task 6's TradeView is checked and Task 8's attestation is imported from @x2f/trade). Each fails
// once the real module is on the line: then replace the guess with the real import, adjust the
// runtime to the real shapes, and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 12 guesses still stand in for missing modules', () => {
  // NEEDS_TASK_8_TERMS retired 2026-10-28: the attestation, its terms check (wrong-terms), the
  // check words and the identity proof come from @x2f/trade; 409 identity-conflict and
  // attestation-refused are final (test/attestation-flow.test.ts).
  it('NEEDS_TASK_10: the trade.ack payload and the trade.terms deal field are guessed', () => {
    expect(has('apps/moderation/src/signals.ts'), 'Task 10 signals landed: check the signal payloads in signals.ts').toBe(false);
  });
  // NEEDS_TASK_19 retired 2026-10-27: AcceptedSheet stores the poster's ConfirmedTrade and App.tsx
  // navigates with { state: { confirmed } } (test/AcceptedSheet.test.tsx).
});
