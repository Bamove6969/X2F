// Owner change, 26 Nov 2026 5:53 PM (docs/lien-recovery.md Security): a senior moderator (or the
// owner) approves a lower lien rate without a key tap. This service takes the API's approved request,
// checking what it still can against its own owner-rooted registry.
import { describe, expect, it } from 'vitest';
import { emptyGate, type GateState } from '../src/gate/store.js';
import { lienRateRequestApprovals } from '../src/lienRecovery.js';

const LIEN = '0d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e5f';
const OWNER = '11111111-1111-4111-8111-111111111111';
const SENIOR = '22222222-2222-4222-8222-222222222222';
const MOD = '33333333-3333-4333-8333-333333333333';
const REQ = '44444444-4444-4444-8444-444444444444';

function gate(): GateState {
  const g = emptyGate();
  g.ownerAccountId = OWNER;
  const entry = (role: 'senior' | 'mod') => ({ role, creds: [], revoked: false, removed: false, joined: true }) as unknown as GateState['staff'][string];
  g.staff[SENIOR] = entry('senior');
  g.staff[MOD] = entry('mod');
  return g;
}
const logs: string[] = [];
const ctx = { log: (e: { reason: string }) => logs.push(e.reason) } as unknown as Parameters<typeof lienRateRequestApprovals>[3];
const req = (o: Partial<{ id: string; rateBps: number; proposedBy: string; decidedBy: string | null }> = {}) => ({ id: REQ, rateBps: 2500, proposedBy: MOD, decidedBy: SENIOR, ...o });

describe('lienRateRequestApprovals', () => {
  it('a senior\'s or the owner\'s approval of another person\'s request counts once, by its request id', () => {
    expect(lienRateRequestApprovals(gate(), [req()], LIEN, ctx)).toEqual([{ rateBps: 2500, nonce: `req:${LIEN}:${REQ}` }]);
    expect(lienRateRequestApprovals(gate(), [req({ decidedBy: OWNER })], LIEN, ctx)).toHaveLength(1);
    expect(lienRateRequestApprovals(gate(), [req({ rateBps: 10_000 })], LIEN, ctx)).toHaveLength(1);
  });

  it('refused: the proposer, a moderator, an unknown, switched-off or removed person, a rate outside 1..100%, a stopped gate', () => {
    expect(lienRateRequestApprovals(gate(), [req({ decidedBy: MOD, proposedBy: SENIOR })], LIEN, ctx)).toEqual([]);
    expect(lienRateRequestApprovals(gate(), [req({ proposedBy: SENIOR })], LIEN, ctx)).toEqual([]);
    expect(lienRateRequestApprovals(gate(), [req({ decidedBy: null })], LIEN, ctx)).toEqual([]);
    expect(lienRateRequestApprovals(gate(), [req({ decidedBy: '55555555-5555-4555-8555-555555555555' })], LIEN, ctx)).toEqual([]);
    for (const rateBps of [0, 10_001, 2.5]) expect(lienRateRequestApprovals(gate(), [req({ rateBps })], LIEN, ctx)).toEqual([]);
    expect(lienRateRequestApprovals(gate(), [req({ id: 'x' })], LIEN, ctx)).toEqual([]);
    const off = gate();
    off.staff[SENIOR]!.revoked = true;
    expect(lienRateRequestApprovals(off, [req()], LIEN, ctx)).toEqual([]);
    const gone = gate();
    gone.staff[SENIOR]!.removed = true;
    expect(lienRateRequestApprovals(gone, [req()], LIEN, ctx)).toEqual([]);
    const stopped = gate();
    stopped.stopped = true;
    expect(lienRateRequestApprovals(stopped, [req()], LIEN, ctx)).toEqual([]);
    const noOwner = gate();
    noOwner.ownerAccountId = null;
    expect(lienRateRequestApprovals(noOwner, [req()], LIEN, ctx)).toEqual([]);
    expect(logs).toContain('gate.refused.lien-rate-role');
    expect(logs).toContain('gate.refused.lien-rate-self');
  });
});
