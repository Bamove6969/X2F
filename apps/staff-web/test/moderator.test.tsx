// @vitest-environment happy-dom
// Plan 4 Task 18: the moderator pages, ModQueue and ModCase (boards ModQueue and ModCase), over a
// fake staff API. What each role sees follows the staff route matrix (apps/api/test/staff/routes.ts):
// disputes.handle for owner, senior and mod; rulings.approve for owner and senior only.
import { createHash } from 'node:crypto';
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { hhmm } from '../src/screens/modModel.js';
import { button, click, fakeApi, field, refused, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const H = 3_600_000;
const ends = () => new Date(Date.now() + 3600_000).toISOString();
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: NAV.mod, sessionEndsAt: ends() };
const SENIOR = { displayName: 'sarah.v', role: 'senior', nav: NAV.senior, sessionEndsAt: ends() };
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: ends() };
const HELPER = { displayName: 'help.desk', role: 'helper', nav: NAV.helper, sessionEndsAt: ends() };

const CODE = '7RWD3MXEKQ84HN2T';
const REASON = 'The bank statement shows the Zelle payment arrived on time and in full.';

const row = (o: Record<string, unknown> = {}) => ({
  code: CODE, incidentId: 'D-7RWD', status: 'open', round: 1, xmr: '4000000000000', usd: '1320.00', method: 'zelle', openedBy: 'buyer',
  waitingMs: 2 * H, replyDueAt: new Date(Date.now() + 2 * H).toISOString(), rulingDueAt: new Date(Date.now() + 46 * H).toISOString(),
  deadlineTone: 'due', approval: 'needs-second', assignee: null, mine: false, ...o,
});

const QUEUE = {
  settings: { firstResponseH: 4, largeTradeLimitUsd: 1000 },
  counts: { open: 4, overdue: 1, unassigned: 2, needApproval: 1 },
  rows: [
    row({ code: 'M3TB9HQZ6WCR1FXA', usd: '693.00', approval: 'not-needed', deadlineTone: 'overdue', waitingMs: 5 * H, assignee: 'dmitri_k', mine: true }),
    row(),
    row({ code: 'K7M29QXA4FTR8WPN', usd: '412.50', approval: 'not-needed', deadlineTone: 'replied', assignee: 'sarah.v' }),
    row({ code: 'B8NE4YJW2PVK7DSG', status: 'awaiting-approval', usd: '2145.00', approval: { waitingFor: 'second-approval', proposedBy: 'sarah.v' }, assignee: 'sarah.v', deadlineTone: 'replied' }),
    row({ code: 'A9PE4YJW2PVK7DSZ', status: 'appealed', round: 2, usd: '50.00', approval: 'not-needed' }),
  ],
};

const trader = (name: string, trades: number, pct: number | null) => ({
  displayName: name, completedTrades: trades, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: pct, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [],
});

const kase = (o: Record<string, unknown> = {}, ruling: Record<string, unknown> = {}) => ({
  code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: 'Paid by Zelle at 08:51.',
  afterRefund: false, openedAt: new Date(Date.now() - 2 * H).toISOString(), replyDueAt: new Date(Date.now() + 2 * H).toISOString(),
  rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '1320.00', overLimit: true,
  assignee: 'dmitri_k', assignedToYou: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: trader('harbor_lin', 31, 100), seller: trader('quietfox', 145, 97) },
  escrow: { state: 'escrow-secured', amountAtomic: '4000000000000', methodId: 'zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '132000', confirmations: 10, takenAt: new Date(Date.now() - 3 * H).toISOString() },
  ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null, ...ruling },
  freezes: { buyer: false, seller: false },
  ...o,
});

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen');
const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
const text = (p: string) => part(p)?.textContent ?? '';
const rows = () => [...document.querySelectorAll('table[aria-label="Disputes"] tbody tr')];
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

describe('ModQueue (board ModQueue)', () => {
  it('shows the reply-time header, Take next case, the four tiles, the filter chips with counts, the rows and the limit footer', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/disputes': { body: QUEUE } });
    await open('/disputes');
    expect(screen()).toBe('mod-queue');
    expect(text('queue-lead')).toContain('A moderator must reply within 4 hours of a dispute opening.');
    expect(button('Take next case')).toBeDefined();
    const tiles = [...document.querySelectorAll('[data-part="queue-counts"] li')].map((li) => li.textContent);
    expect(tiles).toEqual(['4Open', '1Overdue', '2Unassigned', '1Need a second approval']);
    const chips = [...document.querySelectorAll('[data-part="queue-filters"] button')].map((b) => b.textContent);
    expect(chips).toEqual(['All open (5)', 'Assigned to you (1)', 'Unassigned (2)', 'Needs approval (1)']);
    expect(rows()).toHaveLength(5);
    const bar = rows()[1]!.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-label')).toBe('Time used of the 4-hour reply deadline');
    expect(bar?.getAttribute('aria-valuenow')).toBe('50');
    expect(rows()[0]!.textContent).toContain('Overdue by');
    expect(rows()[0]!.textContent).toContain('You');
    expect(rows()[1]!.textContent).toContain('Needs second approval');
    expect(rows()[1]!.textContent).toContain('Unassigned');
    expect(rows()[1]!.textContent).toContain('$1,320.00');
    expect(rows()[1]!.textContent).toContain('4.00 XMR');
    expect(rows()[2]!.textContent).toContain('Not needed');
    expect(rows()[2]!.textContent).toContain('sarah.v');
    expect(rows()[3]!.textContent).toContain('Ruling waiting for a second approval');
    expect(text('queue-foot')).toContain('1,000 USD large-trade limit');
  });

  it('filters by chip; Take and Open case; a moderator is never offered an appeal to take', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes': { body: QUEUE },
      [`POST /staff/v1/disputes/:code/take`]: { body: { code: CODE } },
    });
    await open('/disputes');
    await click(button('Unassigned (2)'));
    expect(rows().map((r) => r.querySelector('[data-part="queue-code"]')?.textContent)).toEqual(['7RWD-3MXE-KQ84-HN2T', 'A9PE-4YJW-2PVK-7DSZ']);
    // The appeal (round 2) row has no Take for a moderator (only a senior or the owner takes an appeal).
    expect(button('Take', rows()[1]!)).toBeUndefined();
    expect(rows()[1]!.querySelector('a')?.textContent).toBe('Open case');
    await click(button('Take', rows()[0]!));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === `/staff/v1/disputes/${CODE}/take`)).toBe(true);
    await click(button('Needs approval (1)'));
    expect(rows()).toHaveLength(1);
  });

  it('a senior is offered the appeal to take', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: SENIOR }, 'GET /staff/v1/disputes': { body: QUEUE } });
    await open('/disputes');
    expect(button('Take', rows()[4]!)).toBeDefined();
  });

  it('Take next case opens the case it took, or says there is none', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes': { body: QUEUE },
      'POST /staff/v1/disputes/next': { body: { code: CODE } },
      'GET /staff/v1/disputes/:code': { body: kase() },
    });
    await open('/disputes');
    await click(button('Take next case'));
    expect(screen()).toBe('mod-case');
    api.set('POST /staff/v1/disputes/next', { body: { code: null } });
    await open('/disputes');
    await click(button('Take next case', document.querySelectorAll('[data-screen="mod-queue"]')[0]!));
    expect(text('queue-fault')).toContain('No case is free to take right now.');
  });

  it('a helper has no Disputes page', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: HELPER } });
    await open('/disputes');
    expect(screen()).toBeUndefined();
    expect(part('nothing-for-role')).not.toBeNull();
    expect(api.calls.some((c) => c.path.startsWith('/staff/v1/disputes'))).toBe(false);
  });
});

describe('ModCase (board ModCase)', () => {
  it('shows the header line, deadline chips, traders, proof and escrow cards; the full chat is never fetched', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/disputes/:code': { body: kase() } });
    await open(`/disputes/${CODE}`);
    expect(screen()).toBe('mod-case');
    expect(document.querySelector('h1')?.textContent).toBe('7RWD-3MXE-KQ84-HN2T');
    expect(text('case-line')).toContain('zelle · 4.00 XMR for $1,320.00 at $330.00 / XMR · opened by the buyer');
    expect(text('case-line')).toContain("paid, but the seller hasn't released");
    const chips = text('case-chips');
    expect(chips).toContain('First reply due in');
    expect(chips).toContain('Above the 1,000 USD limit');
    expect(chips).toContain('Assigned to you');
    expect(text('traders')).toContain('harbor_lin');
    expect(text('traders')).toContain('31 trades · 100% positive');
    expect(text('traders')).toContain('145 trades · 97% positive');
    expect(text('escrow')).toContain('4.000000 XMR locked');
    expect(text('escrow')).toContain('10 confirmations');
    expect(button('Request unblurred proof from harbor_lin')).toBeDefined();
    // The chat stays closed: its read is not built (NEEDS_P4_CHAT_MEMBERSHIP), and nothing asks for it.
    const chat = part('chat')!;
    expect(button('Open the full chat', chat)?.disabled).toBe(true);
    expect(api.calls.filter((c) => /\/chat\b/.test(c.path))).toEqual([]);
    expect(text('message')).toContain('Your messages show the X2F Moderator badge to both traders.');
  });

  it('the ruling: two outcomes, the 40-character hint, "Send ruling for approval" above the limit; the tap binds exactly this ruling', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase() },
      'POST /staff/v1/taps/start': { body: { tapId: 'tap-1', options: { challenge: 'c' } } },
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } },
      'POST /staff/v1/disputes/:code/rulings': { body: { code: CODE, ruling: { proposal: null, sentBack: null } } },
    });
    await open(`/disputes/${CODE}`);
    const panel = part('ruling')!;
    expect(panel.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(panel.textContent).toContain('Release to buyer');
    expect(panel.textContent).toContain('Refund to seller');
    const send = button('Send ruling for approval', panel)!;
    expect(send.disabled).toBe(true);
    typeInto(field('Reason (required, both traders see it)'), 'Too short.');
    await settle();
    expect(text('reason-hint')).toBe('At least 40 characters. 10 so far.');
    await click(panel.querySelector('input[value="release-to-buyer"]'));
    typeInto(field('Reason (required, both traders see it)'), REASON);
    typeInto(field('Evidence'), 'Bank statement line 08:51\n\nZelle confirmation');
    await settle();
    expect(send.disabled).toBe(false);
    await click(send);
    await click(button('Tap security key'));
    const start = api.calls.find((c) => c.path === '/staff/v1/taps/start')!;
    const post = api.calls.find((c) => c.method === 'POST' && c.path === `/staff/v1/disputes/${CODE}/rulings`)!;
    expect(start.body).toEqual({
      kind: 'ruling', step: 'propose', rulingId: (post.body as { rulingId: string }).rulingId, code: CODE, round: 1, outcome: 'release-to-buyer',
      accountAction: { kind: 'none' }, amountAtomic: '4000000000000', reasonSha256: sha(REASON),
    });
    expect(post.body).toEqual({
      rulingId: (start.body as { rulingId: string }).rulingId, outcome: 'release-to-buyer', accountAction: { kind: 'none' }, reason: REASON,
      evidence: ['Bank statement line 08:51', 'Zelle confirmation'], tapId: 'tap-1',
    });
  });

  it('"Send ruling" below the limit; three outcomes after a refund; the proposer then sees the case waiting', async () => {
    const proposedAt = new Date().toISOString();
    fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase({ overLimit: false, afterRefund: true }) },
    });
    await open(`/disputes/${CODE}`);
    expect(button('Send ruling', part('ruling')!)).toBeDefined();
    expect(part('ruling')!.querySelectorAll('input[type="radio"]')).toHaveLength(3);

    fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': {
        body: kase({ status: 'awaiting-approval', proposedByYou: true }, { proposal: { rulingId: 'r1', reason: REASON, evidence: [], proposer: 'me', proposedAt }, draft: { id: 'r1', outcome: 'refund-to-seller' } }),
      },
    });
    await open(`/disputes/${CODE}`);
    expect(text('ruling-waiting')).toContain(`Waiting for approval from a senior moderator or the owner. Proposed at ${hhmm(proposedAt)} and logged.`);
    expect(part('approve')).toBeNull();
  });

  it('an approver sees the waiting proposal with "Approve ruling" (tapped) and "Send back"; a moderator never does', async () => {
    const proposedAt = new Date().toISOString();
    const waiting = kase(
      { status: 'awaiting-approval', assignedToYou: false, assignee: 'dmitri_k' },
      { proposal: { rulingId: 'r1', reason: REASON, evidence: ['Bank statement'], proposer: 'p', proposedAt }, draft: { id: 'r1', outcome: 'refund-to-seller' } },
    );
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/disputes/:code': { body: waiting },
      'POST /staff/v1/taps/start': { body: { tapId: 'tap-2', options: { challenge: 'c' } } },
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-2' } },
      'POST /staff/v1/disputes/:code/rulings/:id/approve': { body: { code: CODE, ruling: { proposal: null, sentBack: null } } },
      'POST /staff/v1/disputes/:code/rulings/:id/send-back': { body: { code: CODE, ruling: { proposal: null, sentBack: null } } },
    });
    await open(`/disputes/${CODE}`);
    const approve = part('approve')!;
    expect(approve.textContent).toContain('Refund to seller');
    expect(approve.textContent).toContain(REASON);
    expect(approve.textContent).toContain('Bank statement');
    expect(part('ruling')).toBeNull();
    await click(button('Approve ruling', approve));
    await click(button('Tap security key'));
    expect(api.calls.find((c) => c.path === '/staff/v1/taps/start')!.body).toEqual({
      kind: 'ruling', step: 'approve', rulingId: 'r1', code: CODE, round: 1, outcome: 'refund-to-seller', accountAction: { kind: 'none' },
      amountAtomic: '4000000000000', reasonSha256: sha(REASON),
    });
    expect(api.calls.find((c) => c.path === `/staff/v1/disputes/${CODE}/rulings/r1/approve`)!.body).toEqual({ tapId: 'tap-2' });

    await click(button('Send back', part('approve')!));
    typeInto(field('Note for the moderator'), 'Look at the bank statement again.');
    await settle();
    await click(button('Send back to the moderator'));
    expect(api.calls.find((c) => c.path === `/staff/v1/disputes/${CODE}/rulings/r1/send-back`)!.body).toEqual({ note: 'Look at the bank statement again.' });

    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/disputes/:code': { body: { ...waiting, mayWork: false } } });
    await open(`/disputes/${CODE}`);
    expect(part('approve')).toBeNull();
    expect(text('ruling-waiting')).toContain('waiting for approval');
  });

  it('a sent-back proposal shows its note above the ruling form', async () => {
    const at = new Date().toISOString();
    fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase({}, { sentBack: { rulingId: 'r1', note: 'Check the bank statement.', at } }) },
    });
    await open(`/disputes/${CODE}`);
    expect(text('sent-back')).toContain(`Sent back at ${hhmm(at)}: Check the bank statement.`);
    expect(part('ruling')).not.toBeNull();
  });

  it('messages both traders, asks for unblurred proof and freezes or lifts a party', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase({}, {}) },
      'POST /staff/v1/disputes/:code/messages': { status: 201, body: { id: 'e1' } },
      'POST /staff/v1/disputes/:code/proof-request': { status: 204 },
      'POST /staff/v1/disputes/:code/freeze': (b) =>
        (b as { side: string }).side === 'buyer' ? refused(409, 'freeze-not-allowed') : { body: { freezes: { buyer: false, seller: true } } },
    });
    await open(`/disputes/${CODE}`);
    typeInto(field('Message both traders'), 'Hello both, I am looking at this now.');
    await settle();
    await click(button('Send', part('message')!));
    expect(api.calls.find((c) => c.path === `/staff/v1/disputes/${CODE}/messages`)!.body).toEqual({ text: 'Hello both, I am looking at this now.' });
    expect(text('message')).toContain('Sent and logged.');

    await click(button('Request unblurred proof from harbor_lin'));
    expect(api.calls.find((c) => c.path === `/staff/v1/disputes/${CODE}/proof-request`)!.body).toEqual({ side: 'buyer' });
    expect(text('proof')).toMatch(/Requested at \d\d:\d\d and logged\. Waiting for harbor_lin to send it\./);

    await click(button('Freeze harbor_lin'));
    expect(api.calls.find((c) => c.path === `/staff/v1/disputes/${CODE}/freeze`)!.body).toEqual({ side: 'buyer', on: true, reason: 'no-reply' });
    expect(text('freeze')).toContain('X2F does not allow this freeze yet');
    await click(button('Freeze quietfox'));
    expect(text('freeze')).toContain('quietfox is frozen');
    expect(button('Lift the freeze on quietfox')).toBeDefined();
  });

  it("someone else's case: no message, proof, freeze or ruling tools", async () => {
    fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase({ assignedToYou: false, assignee: 'sarah.v', mayWork: false }) },
    });
    await open(`/disputes/${CODE}`);
    expect(text('case-chips')).toContain('Assigned to sarah.v');
    for (const p of ['message', 'proof-actions', 'freeze', 'ruling', 'approve']) expect(part(p), p).toBeNull();
  });

  it('an unassigned case offers Take', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/disputes/:code': { body: kase({ assignedToYou: false, assignee: null, mayWork: false }) },
      'POST /staff/v1/disputes/:code/take': { body: { code: CODE } },
    });
    await open(`/disputes/${CODE}`);
    expect(text('case-chips')).toContain('Unassigned');
    await click(button('Take this case'));
    expect(api.calls.some((c) => c.path === `/staff/v1/disputes/${CODE}/take`)).toBe(true);
  });
});
