import { describe, expect, it } from 'vitest';
import { traderStatus, type DisputeStatus } from '../src/index.js';

// The ONE mapping from the machine's seven statuses to what traders see (lead decision 2026-10-30,
// docs/coordination.md "Plan 4 Tasks 1–3", item 1). A proposal awaiting a second approval is not a
// ruling yet; `complying` is final (the seller still owes the XMR).
describe('traderStatus', () => {
  it('maps each machine status', () => {
    const all: Record<DisputeStatus, string> = {
      open: 'open',
      'awaiting-approval': 'open',
      published: 'ruled',
      appealed: 'appealed',
      final: 'final',
      complying: 'final',
      closed: 'closed',
    };
    for (const [s, want] of Object.entries(all)) expect(traderStatus(s as DisputeStatus), s).toBe(want);
  });
});
