// TRIPWIRES for the guesses in src/escrow/adapters.ts and src/escrow/signals.ts (Task 12 was built
// before Tasks 6, 8 and 10; Task 6's TradeView is now checked; Task 8 is on the line without terms). Each fails once the real module is on the line: then replace the guess
// with the real import, adjust the runtime to the real shapes, and delete that tripwire.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 12 guesses still stand in for missing modules', () => {
  it("NEEDS_TASK_8_TERMS: Task 8 is on the line but its Attestation has no terms (lead answer 4), so adapters.ts keeps its guesses", () => {
    // Task 8 (packages/trade/src/{attestation,checkWords}.ts, apps/api/src/trades/identity.ts) merged
    // into this line without the attested `terms` (docs/coordination.md, "Task 8, attestation terms").
    // Once it signs `terms`: import Attestation, attestationBytes, verifyAttestation (with the
    // `wrong-terms` check), AttestationError, escrowCheckWords (the BIP-39 words, not hex groups) and
    // identityProofBytes from @x2f/trade; treat 409 `identity-conflict` as a refusal in
    // httpEscrowApi; then delete the guesses in adapters.ts and this check.
    const real = readFileSync(`${ROOT}packages/trade/src/attestation.ts`, 'utf8');
    expect(real, 'Task 8 attests terms now: swap the adapters.ts guesses for @x2f/trade').not.toMatch(/\bterms\??\s*:/);
    expect(has('apps/web/src/escrow/adapters.ts')).toBe(true);
  });

  it('NEEDS_TASK_10: the trade.ack payload and the trade.terms deal field are guessed', () => {
    expect(has('apps/moderation/src/signals.ts'), 'Task 10 signals landed: check the signal payloads in signals.ts').toBe(false);
  });
  // NEEDS_TASK_19 retired 2026-10-27: AcceptedSheet stores the poster's ConfirmedTrade and App.tsx
  // navigates with { state: { confirmed } } (test/AcceptedSheet.test.tsx).
});
