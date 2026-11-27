// @vitest-environment happy-dom
// Owner decision (Jess, 26 Nov 2026), "Pool first, auto-assign if untaken": the queue says how long a
// free case has until the timer assigns it, a case the timer gave this person says "Assigned to you
// automatically", and the owner sets the pool time (and the switch) in Settings, with no tap.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { autoAssignMinOf } from '../src/screens/settings/AutoAssignSection.js';
import { assigneeText } from '../src/screens/modModel.js';
import { button, click, fakeApi, field, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const H = 3_600_000;
const MIN = 60_000;
const ends = () => new Date(Date.now() + H).toISOString();
const MOD = { tradeTag: 'dmitri_k', role: 'mod', nav: NAV.mod, sessionEndsAt: ends() };
const OWNER = { tradeTag: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: ends() };

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

describe('assigneeText', () => {
  const now = new Date('2026-11-27T12:00:00.000Z');
  it('a free case: the time left, or the next moderator on shift once it has passed; none when auto-assign is off', () => {
    expect(assigneeText({ assignee: null, mine: false, autoAssignAt: '2026-11-27T12:12:00.000Z' }, now)).toBe('Unassigned · assigned automatically in 12 min');
    expect(assigneeText({ assignee: null, mine: false, autoAssignAt: '2026-11-27T11:50:00.000Z' }, now)).toBe('Unassigned · assigned to the next moderator on shift');
    expect(assigneeText({ assignee: null, mine: false, autoAssignAt: null }, now)).toBe('Unassigned');
    expect(assigneeText({ assignee: null, mine: false }, now)).toBe('Unassigned');
  });
  it('a taken case: "Assigned to you automatically" for the timer\'s, else You or the name', () => {
    expect(assigneeText({ assignee: 'dmitri_k', mine: true, autoAssigned: true }, now)).toBe('Assigned to you automatically');
    expect(assigneeText({ assignee: 'dmitri_k', mine: true, autoAssigned: false }, now)).toBe('You');
    expect(assigneeText({ assignee: 'sarah.v', mine: false, autoAssigned: true }, now)).toBe('sarah.v (assigned automatically)');
    expect(assigneeText({ assignee: 'sarah.v', mine: false }, now)).toBe('sarah.v');
  });
});

describe('the queue and the case', () => {
  const row = (o: Record<string, unknown>) => ({
    code: '7RWD3MXEKQ84HN2T', incidentId: 'D-7RWD', status: 'open', round: 1, xmr: '4000000000000', usd: '1320.00', method: 'ZELLE', methodName: 'Zelle', openedBy: 'buyer',
    waitingMs: 5 * MIN, replyDueAt: new Date(Date.now() + 3 * H).toISOString(), rulingDueAt: new Date(Date.now() + 46 * H).toISOString(),
    deadlineTone: 'due', approval: 'not-needed', assignee: null, mine: false, ...o,
  });
  it('shows the pool time in the lead and on each row', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes': {
        body: {
          settings: { firstResponseH: 4, largeTradeLimitUsd: 1000, autoAssign: { on: true, minutes: 15 } },
          counts: { open: 2, overdue: 0, unassigned: 1, needApproval: 0 },
          rows: [
            row({ autoAssignAt: new Date(Date.now() + 10 * MIN + 30_000).toISOString() }),
            row({ code: 'M3TB9HQZ6WCR1FXA', assignee: 'dmitri_k', mine: true, autoAssigned: true, autoAssignAt: null }),
          ],
        },
      },
    });
    await open('/disputes');
    expect(document.querySelector('[data-part="queue-lead"]')?.textContent).toContain('A case nobody takes within 15 minutes goes to the moderator on shift with the fewest open cases.');
    const cells = [...document.querySelectorAll('[data-part="queue-assignee"]')].map((c) => c.textContent);
    expect(cells).toEqual(['Unassigned · assigned automatically in 10 min', 'Assigned to you automatically']);
  });
  it('the case chip says "Assigned to you automatically"', async () => {
    const kase = {
      code: '7RWD3MXEKQ84HN2T', incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
      afterRefund: false, openedAt: new Date(Date.now() - H).toISOString(), replyDueAt: new Date(Date.now() + 3 * H).toISOString(),
      rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '1320.00', overLimit: false, limitUsd: 1000,
      assignee: 'dmitri_k', assignedToYou: true, autoAssigned: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
      traders: { buyer: null, seller: null },
      escrow: { state: 'escrow-secured', amountAtomic: '4000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '132000', confirmations: 10, takenAt: new Date(Date.now() - 3 * H).toISOString() },
      ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
      freezes: { buyer: false, seller: false },
    };
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/disputes/:code': { body: kase } });
    await open('/disputes/7RWD3MXEKQ84HN2T');
    expect(document.querySelector('[data-part="case-chips"]')?.textContent).toContain('Assigned to you automatically');
  });
});

describe('Settings: Case assignment', () => {
  const SETTINGS = { largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48, moderatorContactUrl: null, communityMatrixUrl: null, communityTelegramUrl: null, autoAssignMin: 15, autoAssignOn: true };
  const api = (put: (b: unknown) => { body: unknown }) => fakeApi({
    'GET /staff/v1/me': { body: OWNER },
    'GET /staff/v1/settings': { body: SETTINGS },
    'GET /staff/v1/pay/settings': { body: { modDisputeUsdCents: null, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null, modFeeBp: null, seniorFeeBp: null, modFlatUsdCents: null, seniorFlatUsdCents: null } },
    'GET /staff/v1/starter-limits': { body: { starterCapUsd: 200, buildingCapUsd: 1000, buildingMinTrades: 5, buildingMinDays: 7, graduatedMinTrades: 20, graduatedMinDays: 30, starterMaxOpenTrades: 3, updatedAt: null } },
    'GET /staff/v1/fee-sweep': { body: { thresholdAtomic: null, floatAtomic: null, coldAddress: null, on: false, walletWired: false, lastSweep: null } },
    'GET /staff/v1/pay/staff': { body: { members: [] } },
    'PUT /staff/v1/settings': put,
  });

  it('reads the minutes as the API does (1 to 1,440 whole minutes)', () => {
    expect(autoAssignMinOf('15')).toBe(15);
    expect(autoAssignMinOf('1,440')).toBe(1440);
    for (const bad of ['0', '1441', '2.5', '', 'ten', '-3']) expect(autoAssignMinOf(bad), bad).toBeNull();
  });

  it('shows the saved values; a change is sent alone with no tap; a bad number is named and keeps Save disabled', async () => {
    const c = api((b) => ({ body: { ...SETTINGS, ...(b as object) } }));
    await open('/settings');
    const s = document.querySelector('section[aria-label="Case assignment"]')!;
    expect(s).not.toBeNull();
    expect((field('Assign after', s) as HTMLInputElement).value).toBe('15');
    const on = s.querySelector('[data-part="auto-assign-on"]') as HTMLInputElement;
    expect(on.checked).toBe(true);
    expect(button('Save case assignment')!.disabled).toBe(true);
    typeInto(field('Assign after', s), '1441');
    await settle();
    expect(button('Save case assignment')!.disabled).toBe(true);
    expect(s.querySelector('[data-part="auto-assign-invalid"]')?.textContent).toContain('Assign after (1 to 1,440 minutes)');
    typeInto(field('Assign after', s), '30');
    await settle();
    await click(button('Save case assignment'));
    const puts = c.calls.filter((x) => x.method === 'PUT' && x.path === '/staff/v1/settings').map((x) => x.body);
    expect(puts).toEqual([{ autoAssignMin: 30 }]);
    expect(c.calls.some((x) => x.path === '/staff/v1/taps/start')).toBe(false);
    expect(s.querySelector('[data-part="auto-assign-saved"]')).not.toBeNull();
    await click(on);
    await click(button('Save case assignment'));
    expect(c.calls.filter((x) => x.method === 'PUT' && x.path === '/staff/v1/settings').map((x) => x.body).at(-1)).toEqual({ autoAssignOn: false });
  });
});
