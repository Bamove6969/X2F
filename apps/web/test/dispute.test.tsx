// @vitest-environment happy-dom
import { payoutsFor, escrowPlan } from '@x2f/trade';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDispute, type DisputeTrade, type DisputeView } from '../src/screens/dispute/api.js';
import { DisputeEntry } from '../src/screens/dispute/DisputeEntry.js';
import { disputeScreenFor } from '../src/screens/dispute/DisputeScreen.js';
import { DisputeOpen } from '../src/screens/dispute/DisputeOpen.js';
import { DisputeRoom } from '../src/screens/dispute/DisputeRoom.js';
import { DisputeRuling } from '../src/screens/dispute/DisputeRuling.js';
import { ModeratorTag } from '../src/screens/dispute/ModeratorTag.js';
import {
  dayTime,
  disputeEntry,
  inTime,
  rulingAllowsCosign,
  rulingCopy,
  rulingFinal,
  xmrInText,
  type SettleOutcome,
} from '../src/screens/dispute/rules.js';
import { fire, render } from './render.js';

const T0 = Date.parse('2026-10-15T10:00:00Z');
const MIN = 60_000;
const iso = (m: number) => new Date(T0 + m * MIN).toISOString();

function trade(over: Partial<DisputeTrade> = {}): DisputeTrade {
  return {
    code: 'K7M2-9QXA-4FTR-8WPN',
    role: 'buyer',
    state: 'paid',
    counterparty: 'satoshi_ghost',
    methodId: 'ZELLE',
    whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
    amountAtomic: '1250000000000',
    currency: 'USD',
    paidAt: iso(0),
    confirmBy: iso(120),
    settleBy: null,
    closedAt: null,
    dispute: null,
    serverNow: iso(10),
    ...over,
  };
}

function dispute(over: Partial<DisputeView> = {}): DisputeView {
  return {
    openedBy: 'buyer',
    reason: 'paid',
    openedAt: iso(130),
    afterRefund: false,
    dueAt: iso(130 + 24 * 60),
    status: 'open',
    moderator: null,
    ruling: null,
    appeal: null,
    serverNow: iso(200),
    ...over,
  };
}

const ruled = (over: Partial<NonNullable<DisputeView['ruling']>> = {}, d: Partial<DisputeView> = {}): DisputeView =>
  dispute({
    status: 'ruled',
    moderator: { name: 'sarah.v', joinedAt: iso(168) },
    ruling: {
      round: 1,
      outcome: 'release-to-buyer',
      reason: 'The payment is in the seller\'s activity.',
      evidence: ['The trade chat, 09:40 to 13:55'],
      moderatorName: 'sarah.v',
      ruledAt: iso(400),
      appealUntil: iso(400 + 48 * 60),
      destination: { walletApp: 'cake', addressEnd: 'a9k3Fz' },
      ...over,
    },
    ...d,
  });

const at = (m: number) => () => new Date(T0 + m * MIN);
const inRouter = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

describe('disputeEntry (mirrors the state machine; the server clock decides)', () => {
  it('makes the buyer wait for the end of the confirm window, with the board explanation', () => {
    const e = disputeEntry(trade(), new Date(T0 + 119 * MIN));
    expect(e).toEqual({
      kind: 'wait',
      until: new Date(T0 + 120 * MIN),
      text: "You can open a dispute if the seller hasn't confirmed within 2 h of your payment.",
    });
    expect(disputeEntry(trade(), new Date(T0 + 120 * MIN))).toEqual({ kind: 'open' });
    expect(disputeEntry(trade({ role: 'seller' }), new Date(T0))).toEqual({ kind: 'open' });
  });

  it('opens for either side while securing or secured, and not in funding or after release', () => {
    for (const state of ['securing', 'secured']) expect(disputeEntry(trade({ state }), new Date(T0)).kind).toBe('open');
    for (const state of ['setup', 'funding', 'released', 'cancelled', 'lapsed']) expect(disputeEntry(trade({ state }), new Date(T0)).kind).toBe('none');
    expect(disputeEntry(trade({ state: 'disputed' }), new Date(T0)).kind).toBe('opened');
  });

  it('lets the buyer dispute a refund for 48 hours (owner 2026-10-29), and never the seller', () => {
    const r = trade({ state: 'refunded', closedAt: iso(0) });
    const day = 24 * 60 * MIN;
    expect(disputeEntry(r, new Date(T0 + 2 * day)).kind).toBe('open');
    expect(disputeEntry(r, new Date(T0 + 2 * day + 1)).kind).toBe('none');
    expect(disputeEntry({ ...r, role: 'seller' }, new Date(T0 + day)).kind).toBe('none');
  });

  it('never offers a second dispute on a refunded trade that already had one (fix round, Minor 4)', () => {
    const r = trade({ state: 'refunded', closedAt: iso(0), dispute: { by: 'buyer', at: iso(-10) } });
    expect(disputeEntry(r, new Date(T0 + 60 * MIN))).toEqual({ kind: 'opened' });
    const { host } = render(inRouter(<DisputeEntry trade={r} now={new Date(T0 + 60 * MIN)} />));
    expect(host.textContent).not.toContain('Open a dispute');
  });

  it('opens a stuck signing only after its window', () => {
    const s = trade({ state: 'settling', settleBy: iso(15) });
    expect(disputeEntry(s, new Date(T0 + 15 * MIN)).kind).toBe('none');
    expect(disputeEntry(s, new Date(T0 + 15 * MIN + 1)).kind).toBe('open');
  });
});

describe('copy helpers', () => {
  it('writes amounts in sentences as the boards do, and dates as "Fri 16 Oct, 10:14"', () => {
    expect(xmrInText('1250000000000')).toBe('1.25');
    expect(xmrInText('1000000000000')).toBe('1.00');
    expect(xmrInText('1234567000000')).toBe('1.234567');
    expect(dayTime(new Date('2026-10-16T10:14:00Z'), 'UTC')).toBe('Fri 16 Oct, 10:14');
    expect(inTime(23 * 60 * MIN + 59 * MIN)).toBe('in 23 h');
    expect(inTime(40 * MIN)).toBe('in 40 min');
  });

  it('names the destination only for the side the ruling pays, with the board line while the window is open', () => {
    const d = ruled();
    const mine = rulingCopy(d, 'buyer', 'satoshi_ghost', '1250000000000', new Date(T0 + 500 * MIN));
    expect(mine).toEqual({
      label: 'Ruling: release to the buyer',
      title: '1.25 XMR goes to you',
      destination: { app: 'Cake Wallet', end: 'k3Fz', tail: ', once the appeal window closes.' },
      footer: "This ruling and its evidence are kept with the trade. It appears on satoshi_ghost's profile as a lost dispute.",
    });
    const theirs = rulingCopy(d, 'seller', 'mira.k', '1250000000000', new Date(T0 + 500 * MIN));
    expect(theirs.title).toBe('1.25 XMR goes to mira.k');
    expect(theirs.destination).toBeNull();
    expect(theirs.footer).toBe('This ruling and its evidence are kept with the trade. It appears on your profile as a lost dispute.');
  });
});

describe('rulingAllowsCosign: a moderator-built transaction is co-signed only through the ruling and cosignPolicy', () => {
  // The facts a buyer's device holds (Task 12's cosignPolicy derives the exact payouts from them).
  const amountAtomic = 1_250_000_000_000n;
  const plan = escrowPlan({ amountAtomic, poster: 'seller' });
  const facts = {
    amountAtomic,
    feeAtomic: plan.feeAtomic,
    poster: 'seller' as const,
    sellerFundsAtomic: plan.sellerFundsAtomic,
    balanceAtomic: plan.sellerFundsAtomic,
    buyerPayout: '5buyer',
    sellerRefund: '5seller',
    feeWallet: '5fee',
  };
  const same = (a: SettleOutcome['to'], b: SettleOutcome['to']) => a.length === b.length && a.every((p, i) => p.address === b[i]!.address && p.amountAtomic === b[i]!.amountAtomic);
  // A stand-in with the rule Task 12's cosignPolicy applies to a mod-built set (exact payouts), so
  // the gate is exercised against it until the real one lands (NEEDS_TASK_12 tripwire).
  const exactPolicy = (role: 'buyer' | 'seller') => (o: SettleOutcome) =>
    same(o.to, payoutsFor({ ...facts, kind: role === 'buyer' ? 'release' : 'mutual-cancel' }));
  const buyerWin: SettleOutcome = { kind: 'release', to: payoutsFor({ ...facts, kind: 'release' }), builder: 'mod', cosigner: 'buyer' };
  const final = new Date(T0 + (400 + 48 * 60) * MIN);

  it('co-signs the buyer-win release once the appeal window has closed with no appeal', () => {
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: buyerWin, cosignPolicy: exactPolicy('buyer') })).toBe(true);
  });

  it('refuses a mod-built set paying the counterparty from this side\'s share', () => {
    const skim: SettleOutcome = {
      ...buyerWin,
      to: buyerWin.to.map((p) => (p.address === '5buyer' ? { ...p, amountAtomic: p.amountAtomic - 100_000_000n } : p)).concat({ address: '5seller', amountAtomic: 100_000_000n }),
    };
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: skim, cosignPolicy: exactPolicy('buyer') })).toBe(false);
    const fee: SettleOutcome = { ...buyerWin, to: buyerWin.to.map((p) => (p.address === '5fee' ? { ...p, amountAtomic: p.amountAtomic + 1n } : p)) };
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: fee, cosignPolicy: exactPolicy('buyer') })).toBe(false);
  });

  it('refuses whatever the policy says when the ruling is not final or pays the other side', () => {
    const yes = () => true;
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: new Date(final.getTime() - 1), outcome: buyerWin, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled({}, { appeal: { by: 'seller', at: iso(500) } }), now: final, outcome: buyerWin, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'seller', dispute: ruled(), now: final, outcome: { ...buyerWin, cosigner: 'seller' }, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled({ outcome: 'refund-to-seller' }), now: final, outcome: buyerWin, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: { ...buyerWin, builder: 'seller' }, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: dispute(), now: final, outcome: buyerWin, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: buyerWin, cosignPolicy: () => { throw new Error('x'); } })).toBe(false);
    // The appeal round is final at once.
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled({ round: 2, appealUntil: null }), now: new Date(T0), outcome: buyerWin, cosignPolicy: yes })).toBe(true);
    expect(rulingFinal(ruled({ round: 2, appealUntil: null }), new Date(T0))).toBe(true);
  });
});

describe('ModeratorTag: the violet badge only inside a disputed trade', () => {
  it('draws the badge for a moderator message in a dispute with a recorded moderator', () => {
    const { host } = render(<ModeratorTag from="mod" inDispute moderator="sarah.v" />);
    expect(host.querySelector('.x2f-moderator-badge')?.textContent).toBe('X2F Moderator');
  });

  it('draws nothing for a trader, outside a dispute, or with no moderator on record', () => {
    for (const p of [
      { from: 'buyer' as const, inDispute: true, moderator: 'sarah.v' },
      { from: 'mod' as const, inDispute: false, moderator: 'sarah.v' },
      { from: 'mod' as const, inDispute: true, moderator: null },
    ]) {
      const { host } = render(<ModeratorTag {...p} />);
      expect(host.querySelector('.x2f-moderator-badge')).toBeNull();
    }
  });
});

describe('DisputeOpen', () => {
  it('explains when the buyer can open a dispute and sends nothing before then', () => {
    const onOpen = vi.fn(async () => undefined);
    const { host } = render(inRouter(<DisputeOpen trade={trade()} methodName="Zelle" now={at(30)} onOpen={onOpen} />));
    expect(host.textContent).toContain("You can open a dispute if the seller hasn't confirmed within 2 h of your payment.");
    const primary = host.querySelector<HTMLButtonElement>('[data-primary]')!;
    expect(primary.textContent).toBe('Open dispute');
    expect(primary.disabled).toBe(true);
    fire(primary, new MouseEvent('click', { bubbles: true }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector('input[type=file]')).toBeNull();
  });

  it('sends the picked reason and the note once the window has ended', async () => {
    const onOpen = vi.fn(async () => undefined);
    const { host } = render(inRouter(<DisputeOpen trade={trade()} methodName="Zelle" now={at(121)} onOpen={onOpen} />));
    expect(host.textContent).toContain("Seller's time to confirm ran out");
    const silent = [...host.querySelectorAll<HTMLInputElement>('input[type=radio]')][1]!;
    fire(silent, new MouseEvent('click', { bubbles: true }));
    const note = host.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(note, 'They stopped answering.');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('23 / 1000');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-primary]')!.click();
    });
    expect(onOpen).toHaveBeenCalledWith('silent', 'They stopped answering.');
  });
});

describe('DisputeRoom', () => {
  // The room's chat is Task 20's TradeChatPanel: here its POST /v1/trades/:code/chat answers 404 (no network).
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404, headers: { 'content-type': 'application/json' } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the chat (Task 20) under the system cards, with the spec 6.6 notice once', async () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={dispute()} serverClock={at(200)} />));
    expect(host.querySelector('[role="log"][aria-label="Dispute events"]')).not.toBeNull();
    expect(host.querySelector('section.x2f-chat')).not.toBeNull();
    expect(host.textContent!.split('Chats are encrypted.').length - 1).toBe(1);
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledWith(`/v1/trades/${t.code}/chat`, expect.objectContaining({ method: 'POST' }));
  });

  it('tells both sides, before a moderator joins, that the whole chat is readable now (fix round, Minor 11)', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const line = 'A dispute is open. A moderator can read this whole chat, including messages from before the trade.';
    const before = render(inRouter(<DisputeRoom trade={{ ...t, role: 'seller' }} methodName="Zelle" dispute={dispute()} serverClock={at(200)} />));
    expect(before.host.textContent).toContain(line);
    const after = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={dispute({ moderator: { name: 'sarah.v', joinedAt: iso(168) } })} serverClock={at(200)} />));
    expect(after.host.textContent).not.toContain(line);
  });

  it('goes back to the trade, a route that exists (fix round, Minor 9)', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={dispute()} serverClock={at(200)} />));
    expect(host.querySelector('header a')?.getAttribute('href')).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
  });

  it('shows the dispute the system opened (fix round I1)', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'system', at: iso(130) } });
    const d = dispute({ openedBy: 'system', reason: 'escalated' });
    const { host } = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={d} serverClock={at(200)} />));
    expect(host.textContent).toContain('In dispute');
    expect(host.textContent).toContain('This trade went to a moderator automatically.');
    expect(host.textContent).not.toContain('Open dispute');
  });

  it('shows the join banner from server records only, and the locked amount', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const before = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={dispute()} serverClock={at(200)} />));
    expect(before.host.querySelector('[aria-label="Moderator joined"]')).toBeNull();
    expect(before.host.textContent).toContain('1.25 XMR locked in escrow');
    const after = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={dispute({ moderator: { name: 'sarah.v', joinedAt: iso(168) } })} serverClock={at(200)} />));
    expect(after.host.querySelector('[aria-label="Moderator joined"]')?.textContent).toContain('Moderator sarah.v joined this dispute');
    expect(after.host.textContent).toContain('Replied in 38 min');
  });
});

describe('which dispute screen a trade gets (fix round I1)', () => {
  it('a disputed trade is never sent to the open form, even before its dispute record arrives', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'system', at: iso(130) } });
    const room = disputeScreenFor(t, null, false);
    expect(room.kind).toBe('room');
    expect(room.kind === 'room' && room.dispute).toMatchObject({ openedBy: 'system', reason: 'escalated', status: 'open', moderator: null, ruling: null, openedAt: iso(130) });
    expect(disputeScreenFor(trade(), null, false)).toEqual({ kind: 'open' });
    expect(disputeScreenFor(t, ruled(), false)).toMatchObject({ kind: 'ruling' });
    expect(disputeScreenFor(t, ruled(), true)).toMatchObject({ kind: 'room' });
  });

  it('reads a system-opened dispute from the API', () => {
    const d = parseDispute({ ...dispute({ openedBy: 'system', reason: 'escalated' }) });
    expect(d).toMatchObject({ openedBy: 'system', reason: 'escalated' });
    expect(() => parseDispute({ ...dispute(), openedBy: 'mod' })).toThrow();
  });
});

describe('DisputeRuling appeal form', () => {
  it('offers the appeal only on a ruled dispute (fix round, Minor 3)', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    for (const status of ['open', 'final', 'closed'] as const) {
      const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={ruled({}, { status })} serverClock={at(500)} onAppeal={async () => undefined} />));
      expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Appeal this ruling'), status).toBe(false);
      expect(host.textContent, status).toContain('This ruling is final.');
    }
  });

  it('keeps Send appeal disabled at 9 characters and enables it at 10', async () => {
    const t = trade({ role: 'seller', counterparty: 'mira.k', state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const onAppeal = vi.fn(async () => undefined);
    const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={ruled()} serverClock={at(500)} onAppeal={onAppeal} />));
    const open = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Appeal this ruling')!;
    fire(open, new MouseEvent('click', { bubbles: true }));
    const why = host.querySelector<HTMLTextAreaElement>('textarea')!;
    const type = (v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(why, v);
        why.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const send = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Send appeal')!;
    type('123456789');
    expect(send().disabled).toBe(true);
    type('1234567890');
    expect(send().disabled).toBe(false);
    await act(async () => {
      send().click();
    });
    expect(onAppeal).toHaveBeenCalledWith('1234567890');
  });

  it('shows the ruling card with the moderator badge, and no appeal button once final', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={ruled({ round: 2, appealUntil: null })} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(host.querySelector('[aria-label="Ruling"] .x2f-moderator-badge')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Appeal this ruling')).toBe(false);
  });
});
