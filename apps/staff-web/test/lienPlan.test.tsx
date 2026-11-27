// @vitest-environment happy-dom
// Owner decision 26 Nov 2026 (5:43, 5:51 and 5:53 PM): the ruling form's "how the lien is paid" and
// the case's lien panel (grace, deadline, lapse, switch to collecting, a lower share for a senior).
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { CaseLien, DisputeCase } from '../src/api.js';
import { EMPTY_PLAN, LienPanel, graceLine, planOf, planWords, shareBps } from '../src/screens/LienPlan.js';
import { button, click, fakeApi, render, settle } from './helpers.js';

const LIEN = '3a1f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';
const grace = (o: Partial<NonNullable<CaseLien['grace']>> = {}) => ({
  mode: 'grace' as const, method: 'New PayPal payment of $120', graceUntil: '2026-12-03T12:00:00.000Z', lapsedAt: null, escalatedAt: null, collectStartedAt: null, repaidOffPlatformAt: null, ...o,
});
const lien = (o: Partial<CaseLien> = {}): CaseLien => ({
  id: LIEN, status: 'active', debtor: 'seller', amountAtomic: '1000000000000', recoveredAtomic: '0', remainingAtomic: '1000000000000', rateBps: 10_000,
  createdAt: '2026-11-26T12:00:00.000Z', ruledByYou: true, grace: grace(), pendingRate: null, ...o,
});

describe('the plan on the ruling form', () => {
  it('collect at 100% by default; a lower share carries its reason; grace needs the agreed way', () => {
    expect(planOf(EMPTY_PLAN)).toEqual({ mode: 'collect', rateBps: 10_000, rateReason: null });
    expect(planOf({ ...EMPTY_PLAN, sharePct: '25' })).toMatchObject({ mode: 'collect', rateBps: 2500 });
    expect(planOf({ ...EMPTY_PLAN, sharePct: '25', shareReason: ' ' })).toBeNull();
    for (const bad of ['0', '101', '2.5', '', 'x']) expect(shareBps(bad)).toBeNull();
    expect(planOf({ ...EMPTY_PLAN, mode: 'grace' })).toBeNull();
    expect(planOf({ ...EMPTY_PLAN, mode: 'grace', method: 'PayPal again' })).toEqual({ mode: 'grace', method: 'PayPal again' });
    expect(planWords({ mode: 'grace', method: 'PayPal again' })).toBe('Give them 7 days to pay the agreed way: PayPal again');
    expect(planWords(undefined)).toContain('100%');
  });

  it('says where the grace stands', () => {
    const before = Date.parse('2026-11-30T00:00:00Z');
    expect(graceLine(lien(), before)).toContain('Nothing is collected meanwhile');
    expect(graceLine(lien({ grace: grace({ lapsedAt: '2026-12-03T12:00:30.000Z' }) }), before)).toContain('Nothing is collected until you decide');
    expect(graceLine(lien({ grace: grace({ repaidOffPlatformAt: '2026-11-28T12:00:00.000Z' }) }))).toContain('confirmed they were paid');
    expect(graceLine(lien({ grace: null }))).toBeNull();
  });
});

describe('LienPanel', () => {
  it('a lapsed grace lien: the moderator who ruled can send it to a senior, or switch it with a tap', async () => {
    const api = fakeApi({ 'POST /staff/v1/liens/:id/escalate': { body: {} } });
    const reload = vi.fn(async () => undefined);
    const setTap = vi.fn();
    const c = { liens: [lien({ grace: grace({ lapsedAt: '2026-12-03T12:00:30.000Z' }) })] } as unknown as DisputeCase;
    render(
      <MemoryRouter>
        <LienPanel c={c} role="mod" setTap={setTap} reload={reload} />
      </MemoryRouter>,
    );
    await settle();
    expect(document.querySelector('[data-part="lien-method-shown"]')?.textContent).toContain('New PayPal payment of $120');
    await click(button('Send to a senior moderator'));
    expect(api.calls.some((x) => x.method === 'POST' && x.path === `/staff/v1/liens/${LIEN}/escalate`)).toBe(true);
    expect(reload).toHaveBeenCalled();
    await click(button('Start collecting now'));
    expect(setTap.mock.calls[0]![0].intent).toEqual({ kind: 'lien-collect', lienId: LIEN, rateBps: 10_000 });
  });

  it('a pending lower share: a senior reviews it (opening it), then approves without a tap', async () => {
    const api = fakeApi({
      'GET /staff/v1/liens/:id': { body: { chat: { code: 'AAAA1111BBBB2222', disputeOpen: true } } },
      'POST /staff/v1/liens/:id/rate/:req/approve': { body: {} },
    });
    const c = { liens: [lien({ grace: null, ruledByYou: false, pendingRate: { id: '5c2f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f', rateBps: 2500, reason: 'Can pay a quarter', proposedByYou: false } })] } as unknown as DisputeCase;
    render(
      <MemoryRouter>
        <LienPanel c={c} role="senior" setTap={vi.fn()} reload={vi.fn(async () => undefined)} />
      </MemoryRouter>,
    );
    await settle();
    expect(button('Approve the lower share')).toBeUndefined();
    await click(button('Review the request'));
    await click(button('Approve the lower share'));
    expect(api.calls.filter((x) => x.method === 'POST').map((x) => [x.path, x.body])).toEqual([[`/staff/v1/liens/${LIEN}/rate/5c2f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f/approve`, {}]]);
  });
});
