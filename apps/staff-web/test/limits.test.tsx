// @vitest-environment happy-dom
// Plan 4 Task 26: recommended account limits on the staff site. ModCase's "Recommend limits" card
// (whoever may work the case), and the Recommended limits page at /disputes/limits, where a senior
// moderator or the owner approves or declines with a security-key tap; never the recommender.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { button, cleanup, click, fakeApi, field, honestTapStart, refused, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const H = 3_600_000;
const ends = () => new Date(Date.now() + H).toISOString();
const MOD = { tradeTag: 'dmitri_k', role: 'mod', nav: NAV.mod, sessionEndsAt: ends() };
const SENIOR = { tradeTag: 'sarah.v', role: 'senior', nav: NAV.senior, sessionEndsAt: ends() };
const CODE = '7RWD3MXEKQ84HN2T';
const REASON = 'Third dispute this month as a buyer who marks paid and never pays.';
const REC = '0d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d';
const ACCT = '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';

const trader = (name: string) => ({
  tradeTag: name, completedTrades: 30, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: 100, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [],
});
const kase = (o: Record<string, unknown> = {}) => ({
  code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
  afterRefund: false, openedAt: new Date(Date.now() - 2 * H).toISOString(), replyDueAt: new Date(Date.now() + 2 * H).toISOString(),
  rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '330.00', overLimit: false, limitUsd: 1000,
  assignee: 'dmitri_k', assignedToYou: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: trader('harbor_lin'), seller: trader('quietfox') },
  escrow: { state: 'escrow-secured', amountAtomic: '1000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '33000', confirmations: 10, takenAt: new Date(Date.now() - 3 * H).toISOString() },
  ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
  freezes: { buyer: false, seller: false },
  ...o,
});
const rec = (o: Record<string, unknown> = {}) => ({
  id: REC, accountId: ACCT, tradeTag: 'harbor_lin', capUsd: 300, stage: null, reason: REASON, code: CODE, recommendedBy: 'dmitri_k',
  mine: false, createdAt: new Date(Date.now() - H).toISOString(), currentStage: 'graduated', currentCapUsdCents: null, ...o,
});

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}
const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
const text = (p: string) => part(p)?.textContent ?? '';

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

describe('ModCase: Recommend limits (Task 26)', () => {
  it('names a side, a cap or a stage and a reason of at least 40 characters; says who decides', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase() },
      'POST /staff/v1/disputes/:code/limit-recommendations': { status: 201, body: { id: REC } },
    });
    await open(`/disputes/${CODE}`);
    const card = part('limits')!;
    expect(card.textContent).toContain('A senior moderator or the owner decides');
    const send = button('Recommend limits', card)!;
    expect(send.disabled).toBe(true);
    await click(card.querySelector('input[value="buyer"]'));
    await click(card.querySelector('input[value="cap"]'));
    typeInto(field('Largest trade (USD)', card), '300');
    typeInto(field('Reason (staff only', card), 'Too short.');
    await settle();
    expect(send.disabled).toBe(true);
    typeInto(field('Reason (staff only', card), REASON);
    await settle();
    expect(send.disabled).toBe(false);
    await click(send);
    expect(api.calls.find((c) => c.method === 'POST' && c.path === `/staff/v1/disputes/${CODE}/limit-recommendations`)!.body).toEqual({ side: 'buyer', capUsd: 300, reason: REASON });
    expect(text('limits')).toContain('Sent to a senior moderator or the owner');
  });

  it('a stage limit sends the stage; one already waiting is said', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase() },
      'POST /staff/v1/disputes/:code/limit-recommendations': refused(409, 'wrong-state'),
    });
    await open(`/disputes/${CODE}`);
    const card = part('limits')!;
    await click(card.querySelector('input[value="seller"]'));
    await click(card.querySelector('input[value="stage"]'));
    await click(card.querySelector('input[value="starter"]'));
    typeInto(field('Reason (staff only', card), REASON);
    await settle();
    await click(button('Recommend limits', card));
    expect(api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/limit-recommendations'))!.body).toEqual({ side: 'seller', stage: 'starter', reason: REASON });
    expect(text('limits')).toContain('already waits');
  });

  it("not on someone else's case", async () => {
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/disputes/:code': { body: kase({ assignedToYou: false, mayWork: false }) } });
    await open(`/disputes/${CODE}`);
    expect(part('limits')).toBeNull();
  });
});

describe('Recommended limits page (Task 26)', () => {
  it('a senior moderator reads the reason and approves with a tap bound to exactly this decision', async () => {
    let decided = false;
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/limit-recommendations': () => ({ body: { recommendations: decided ? [] : [rec()] } }),
      'POST /staff/v1/taps/start': honestTapStart('tap-9'),
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-9' } },
      'POST /staff/v1/accounts/:id/limit-recommendations/:recId/decide': () => {
        decided = true;
        return { body: { status: 'approved' } };
      },
    });
    await open('/disputes/limits');
    expect(document.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('limit-recommendations');
    const item = part('limit-rec')!;
    expect(item.textContent).toContain('harbor_lin');
    expect(item.textContent).toContain('$300 per trade');
    expect(item.textContent).toContain(REASON);
    expect(item.textContent).toContain('dmitri_k');
    await click(button('Approve', item));
    await click(button('Tap security key'));
    await settle();
    expect(api.calls.find((c) => c.path === '/staff/v1/taps/start')!.body).toEqual({ kind: 'account-limit', recId: REC, accountId: ACCT, approve: true, capUsd: 300, stage: null });
    expect(api.calls.find((c) => c.path.endsWith('/decide'))!).toMatchObject({ path: `/staff/v1/accounts/${ACCT}/limit-recommendations/${REC}/decide`, body: { approve: true, tapId: 'tap-9' } });
    expect(part('limit-rec')).toBeNull();
    expect(text('limits-empty')).toContain('No recommended limits are waiting.');
  });

  it('a decline is tapped too; their own recommendation offers no decision', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/limit-recommendations': { body: { recommendations: [rec({ stage: 'building', capUsd: null }), rec({ id: 'r-own', mine: true })] } },
      'POST /staff/v1/taps/start': honestTapStart('tap-8'),
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-8' } },
      'POST /staff/v1/accounts/:id/limit-recommendations/:recId/decide': { body: { status: 'declined' } },
    });
    await open('/disputes/limits');
    const [first, own] = [...document.querySelectorAll('[data-part="limit-rec"]')];
    expect(first!.textContent).toContain('Hold to Building limits');
    expect(button('Approve', own!)).toBeUndefined();
    expect(button('Decline', own!)).toBeUndefined();
    expect(own!.textContent).toContain('You recommended this');
    await click(button('Decline', first!));
    await click(button('Tap security key'));
    await settle();
    expect(api.calls.find((c) => c.path === '/staff/v1/taps/start')!.body).toEqual({ kind: 'account-limit', recId: REC, accountId: ACCT, approve: false, capUsd: null, stage: 'building' });
  });

  it('the queue links the page for a senior moderator, never for a moderator', async () => {
    const queue = { settings: { firstResponseH: 4, largeTradeLimitUsd: 1000 }, counts: { open: 0, overdue: 0, unassigned: 0, needApproval: 0 }, rows: [] };
    fakeApi({ 'GET /staff/v1/me': { body: SENIOR }, 'GET /staff/v1/disputes': { body: queue } });
    await open('/disputes');
    expect([...document.querySelectorAll('a')].some((a) => a.textContent === 'Recommended limits' && a.getAttribute('href') === '/disputes/limits')).toBe(true);
    cleanup();
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/disputes': { body: queue } });
    await open('/disputes');
    expect([...document.querySelectorAll('a')].some((a) => a.textContent === 'Recommended limits')).toBe(false);
  });
});
