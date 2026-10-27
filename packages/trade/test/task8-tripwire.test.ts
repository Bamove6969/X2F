// TRIPWIRE for the Task 8 seam in src/modParty.ts. Task 9's pure parts were built before Task 8
// (wip/t3-p3-task8) was merged. `ModPartyArgs` in src/modParty.ts is a COPY of the type Task 8
// exports from apps/moderation/src/main.ts. Once Task 8 lands this test fails: then delete the copy,
// type `modPartyArgs` with Task 8's `ModPartyArgs` (or move it into apps/moderation), wire the
// watcher, timer loop and mod party I/O (Task 9 remainder), and delete this tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as trade from '@x2f/trade';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('Task 9 seam still stands in for Task 8', () => {
  it('NEEDS_TASK_8: apps/moderation does not exist yet', () => {
    expect(existsSync(`${ROOT}apps/moderation/src/main.ts`), 'Task 8 landed: replace the ModPartyArgs copy in packages/trade/src/modParty.ts and wire Task 9 I/O').toBe(false);
  });

  it('NEEDS_TASK_8: @x2f/trade has no attestation yet', () => {
    expect('verifyAttestation' in trade, 'Task 8 landed: replace the ModPartyArgs copy in packages/trade/src/modParty.ts').toBe(false);
  });
});
