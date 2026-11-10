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
  HOURGLASS_LINE,
  utcDateTime,
  waitInWords,
  waitPart,
  disputeEntry,
  inTime,
  rulingAllowsCosign,
  rulingCopy,
  rulingFinal,
  paidOutAtomic,
  xmrInText,
  xmrInTextExact,
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
    poster: 'seller',
    currency: 'USD',
    paidAt: iso(0),
    confirmBy: iso(90),
    confirmWindowMin: 90,
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
  it("makes the buyer wait the method's confirm window from marking paid (owner 2026-11-07 F9: 90 minutes for an instant type; p9-4), with the board explanation", () => {
    // paidAt 0, confirmBy 90: 89:59 waits, 90:00 opens.
    const e = disputeEntry(trade(), new Date(T0 + 89 * MIN + 59_000));
    expect(e).toEqual({
      kind: 'wait',
      until: new Date(T0 + 90 * MIN),
      text: "You can open a dispute if the seller hasn't confirmed within 90 minutes of your payment.",
    });
    expect(disputeEntry(trade(), new Date(T0 + 90 * MIN))).toEqual({ kind: 'open' });
    expect(disputeEntry(trade({ paidAt: null, confirmBy: null }), new Date(T0 + 90 * MIN))).toEqual({ kind: 'none' });
  });

  it("makes the seller wait for the same confirmBy in paid (owner p9-4)", () => {
    expect(disputeEntry(trade({ role: 'seller' }), new Date(T0 + 89 * MIN))).toEqual({
      kind: 'wait',
      until: new Date(T0 + 90 * MIN),
      text: "You can open a dispute if the payment hasn't arrived within 90 minutes of the buyer marking it paid.",
    });
    expect(disputeEntry(trade({ role: 'seller' }), new Date(T0 + 90 * MIN))).toEqual({ kind: 'open' });
  });

  it('says each payment type\'s window in words (owner 2026-11-07 F9)', () => {
    const text = (min: number) => (disputeEntry(trade({ confirmWindowMin: min, confirmBy: iso(min) }), new Date(T0)) as { text: string }).text;
    expect(text(90)).toContain('within 90 minutes of');
    expect(text(180)).toContain('within 3 hours of');
    expect(text(1440)).toContain('within 24 hours of');
    expect(text(2880)).toContain('within 2 days of');
    expect(text(4320)).toContain('within 3 days of');
    expect(text(5760)).toContain('within 4 days of');
  });

  it("reads the server's confirmBy, which maintenance moved later (owner 2026-11-06 Q10), and words the window in working time", () => {
    // Marked paid at 0; maintenance 5 → 45 moved confirmBy from 90 to 130.
    const paused = trade({ confirmBy: iso(130) });
    expect(disputeEntry(paused, new Date(T0 + 90 * MIN))).toEqual({
      kind: 'wait',
      until: new Date(T0 + 130 * MIN),
      text: "You can open a dispute if the seller hasn't confirmed within 90 minutes of your payment.",
    });
    expect(disputeEntry(paused, new Date(T0 + 129 * MIN + 59_999)).kind).toBe('wait');
    expect(disputeEntry(paused, new Date(T0 + 130 * MIN))).toEqual({ kind: 'open' });
  });

  it("opens for the seller while securing or secured, never the buyer before I've paid (proto review P1), and not in funding or after release", () => {
    for (const state of ['securing', 'secured']) expect(disputeEntry(trade({ state, role: 'seller' }), new Date(T0)).kind).toBe('open');
    for (const state of ['securing', 'secured']) expect(disputeEntry(trade({ state, role: 'buyer' }), new Date(T0)).kind).toBe('none');
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

  it("the seller's cancel settling (auto-refund): the buyer at once (owner 8 Nov, p9-2), the seller only after the window", () => {
    const b = trade({ state: 'settling', settling: 'auto-refund', settleBy: iso(15), role: 'buyer' });
    expect(disputeEntry(b, new Date(T0)).kind).toBe('open');
    const s = trade({ state: 'settling', settling: 'auto-refund', settleBy: iso(15), role: 'seller' });
    expect(disputeEntry(s, new Date(T0)).kind).toBe('none');
    expect(disputeEntry(s, new Date(T0 + 15 * MIN + 1)).kind).toBe('open');
    for (const settling of ['release', 'buyer-cancel', 'mutual-cancel'] as const) {
      expect(disputeEntry(trade({ state: 'settling', settling, settleBy: iso(15), role: 'buyer' }), new Date(T0)).kind).toBe('none');
    }
  });
});

describe('copy helpers', () => {
  it('writes amounts in sentences with the kit\'s 6 places (review 5), and dates as "16 Oct 2026, 10:14 UTC"', () => {
    expect(xmrInText('1250000000000')).toBe('1.250000');
    expect(xmrInText('1000000000000')).toBe('1.000000');
    expect(xmrInText('1234567000000')).toBe('1.234567');
    expect(xmrInText('1250000999999')).toBe('1.250000'); // cut, never rounded up
    expect(xmrInText(12_500_000_000n)).toBe('0.012500');
    expect(dayTime(new Date('2026-10-16T10:14:00Z'))).toBe('16 Oct 2026, 10:14 UTC');
    expect(inTime(23 * 60 * MIN + 59 * MIN)).toBe('in 23 h');
    expect(inTime(40 * MIN)).toBe('in 40 min');
  });

  it('names the destination only for the side the ruling pays; the coins move at the ruling (A1 dropped), so there is no wait for the window', () => {
    const d = ruled();
    const mine = rulingCopy(d, 'buyer', 'satoshi_ghost', '1250000000000', new Date(T0 + 500 * MIN), 'seller');
    expect(mine).toEqual({
      label: 'Ruling: release to the buyer',
      title: '1.250000 XMR goes to you',
      destination: { app: 'Cake Wallet', end: 'k3Fz' },
      footer: "This ruling and its evidence are kept with the trade. It appears on satoshi_ghost's profile as a lost dispute.",
    });
    const theirs = rulingCopy(d, 'seller', 'mira.k', '1250000000000', new Date(T0 + 500 * MIN), 'seller');
    expect(theirs.title).toBe('1.250000 XMR goes to mira.k');
    expect(theirs.destination).toBeNull();
    expect(theirs.footer).toBe('This ruling and its evidence are kept with the trade. It appears on your profile as a lost dispute.');
  });

  it('lead review 7 Nov: on a buyer\'s ad the buyer pays the 1% fee, so the release pays the amount less the fee', () => {
    const plan = escrowPlan({ amountAtomic: 1_250_000_000_000n, poster: 'buyer' });
    expect(paidOutAtomic('release-to-buyer', '1250000000000', 'buyer')).toBe(1_250_000_000_000n - plan.feeAtomic);
    expect(paidOutAtomic('release-to-buyer', '1250000000000', 'seller')).toBe(1_250_000_000_000n);
    expect(paidOutAtomic('refund-to-seller', '1250000000000', 'buyer')).toBe(1_250_000_000_000n);
    // Owner g63: a full reversal takes no fee, so on a seller's ad the seller gets the fee it funded back too.
    expect(paidOutAtomic('refund-to-seller', '1250000000000', 'seller')).toBe(escrowPlan({ amountAtomic: 1_250_000_000_000n, poster: 'seller' }).sellerFundsAtomic);
    const buyerAd = rulingCopy(ruled(), 'buyer', 'satoshi_ghost', '1250000000000', new Date(T0 + 500 * MIN), 'buyer');
    expect(buyerAd.title).toBe(`${xmrInText(1_250_000_000_000n - plan.feeAtomic)} XMR goes to you`);
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
    same(o.to, payoutsFor({ ...facts, kind: role === 'buyer' ? 'dispute-buyer' : 'dispute-seller' }));
  const buyerWin: SettleOutcome = { kind: 'release', to: payoutsFor({ ...facts, kind: 'release' }), builder: 'mod', cosigner: 'buyer' };
  const final = new Date(T0 + (400 + 48 * 60) * MIN);

  it('co-signs the buyer-win release once the appeal window has closed with no appeal', () => {
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: buyerWin, cosignPolicy: exactPolicy('buyer') })).toBe(true);
  });

  it('co-signs at the ruling, inside the appeal window and during an appeal (owner Q37: a lien covers a reversal)', () => {
    const atRuling = new Date(T0 + 401 * MIN);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: atRuling, outcome: buyerWin, cosignPolicy: exactPolicy('buyer') })).toBe(true);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled({}, { appeal: { by: 'seller', at: iso(500) } }), now: final, outcome: buyerWin, cosignPolicy: exactPolicy('buyer') })).toBe(true);
    // Still only the exact set: the policy decides inside the window as well.
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: atRuling, outcome: buyerWin, cosignPolicy: () => false })).toBe(false);
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

  it('refuses whatever the policy says when there is no ruling or it pays the other side', () => {
    const yes = () => true;
    expect(rulingAllowsCosign({ role: 'seller', dispute: ruled(), now: final, outcome: { ...buyerWin, cosigner: 'seller' }, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled({ outcome: 'refund-to-seller' }), now: final, outcome: buyerWin, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: { ...buyerWin, builder: 'seller' }, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: dispute(), now: final, outcome: buyerWin, cosignPolicy: yes })).toBe(false);
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled(), now: final, outcome: buyerWin, cosignPolicy: () => { throw new Error('x'); } })).toBe(false);
    // An after-refund ruling moves nothing from the escrow.
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled({}, { afterRefund: true }), now: final, outcome: buyerWin, cosignPolicy: yes })).toBe(false);
    // The appeal round is final at once.
    expect(rulingAllowsCosign({ role: 'buyer', dispute: ruled({ round: 2, appealUntil: null }), now: new Date(T0), outcome: buyerWin, cosignPolicy: yes })).toBe(true);
    expect(rulingFinal(ruled({ round: 2, appealUntil: null }), new Date(T0))).toBe(true);
  });
});

describe('ModeratorTag: the violet badge only inside a disputed trade', () => {
  it('draws the badge for a moderator message in a dispute with a recorded moderator', () => {
    const { host } = render(<ModeratorTag from="mod" inDispute moderator="sarah.v" />);
    expect(host.querySelector('.x2f-tag[data-role="mod"]')?.textContent).toBe('X2F Moderator');
  });

  it('draws nothing for a trader, outside a dispute, or with no moderator on record', () => {
    for (const p of [
      { from: 'buyer' as const, inDispute: true, moderator: 'sarah.v' },
      { from: 'mod' as const, inDispute: false, moderator: 'sarah.v' },
      { from: 'mod' as const, inDispute: true, moderator: null },
    ]) {
      const { host } = render(<ModeratorTag {...p} />);
      expect(host.querySelector('.x2f-tag[data-role="mod"]')).toBeNull();
    }
  });
});

describe('DisputeOpen', () => {
  it('explains when the buyer can open a dispute and sends nothing before then', () => {
    const onOpen = vi.fn(async () => undefined);
    // 89 min after marking paid (owner 2026-11-07 F9: an instant type's buyer may dispute from 90 min).
    const { host } = render(inRouter(<DisputeOpen trade={trade()} methodName="Zelle" now={at(89)} onOpen={onOpen} />));
    expect(host.textContent).toContain("You can open a dispute if the seller hasn't confirmed within 90 minutes of your payment.");
    const primary = host.querySelector<HTMLButtonElement>('[data-primary]')!;
    expect(primary.textContent).toBe('Open dispute');
    expect(primary.disabled).toBe(true);
    fire(primary, new MouseEvent('click', { bubbles: true }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector('input[type=file]')).toBeNull();
  });

  it("from 90 minutes after marking paid (confirmBy, one window for both sides, owner p9-4, F9) the buyer may open one, with the seller's-time flag", () => {
    const open = render(inRouter(<DisputeOpen trade={trade()} methodName="Zelle" now={at(90)} onOpen={vi.fn(async () => undefined)} />));
    expect(open.host.querySelector<HTMLButtonElement>('[data-primary]')!.disabled).toBe(false);
    expect(open.host.textContent).toContain("Seller's time to confirm ran out");
    expect(open.host.querySelector('.dispute-wait')).toBeNull();
    open.unmount();
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
    // Board v119: the amount is the hero's inner block, six decimals.
    expect(before.host.querySelector('[data-part="escrow-amount"]')!.textContent?.trim()).toBe('Locked in escrow1.250000 XMR');
    const after = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={dispute({ moderator: { name: 'sarah.v', joinedAt: iso(168) } })} serverClock={at(200)} />));
    expect(after.host.querySelector('[aria-label="Moderator joined"]')?.textContent).toContain('Moderator sarah.v joined this dispute');
    expect(after.host.textContent).toContain('Replied in 38 min');
  });

  it("D-069: once a moderator joins, the card asks both sides to answer the moderator, in ink, under the read-access line", () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={dispute({ moderator: { name: 'sarah.v', joinedAt: iso(168) } })} serverClock={at(200)} />));
    const card = host.querySelector('[aria-label="Moderator joined"]')!;
    const line = card.querySelector('[data-part="cooperate"]')!;
    // The board's "She may ask ..." with "They", as the line above (the app can't know a moderator's gender).
    expect(line.textContent).toBe("They may ask either of you questions. Please answer them here: if someone doesn't help, the ruling can go against them.");
    expect(line.classList.contains('dispute-muted')).toBe(false);
    expect(line.previousElementSibling?.textContent).toContain('They can read this whole chat');
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

  // Design review fix 2 (shot 59; spec Revision 2026-10-29c "Liens"): an overturned ruling puts a
  // lien on whoever received the coins. C11 review I1 (NEEDS_PLAN_4_RULING_PAYOUT): nothing executes a
  // ruling's payout yet, and rulingAllowsCosign still holds it for the appeal window, so the page says
  // where the XMR goes, never that it was sent or has moved, until the API reports the payout executed.
  it('says where the XMR goes (not that it was sent), and that an overturned ruling puts a lien on whoever received it', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={ruled()} serverClock={at(500)} onAppeal={async () => undefined} />));
    const text = host.textContent ?? '';
    expect(text).toContain('Goes to Cake Wallet, address ending …k3Fz.');
    expect(text).not.toMatch(/Sent to|already moved/);
    expect(text).toContain('(48 h). An appeal goes to a senior moderator or the owner who hasn\'t seen this case. If an appeal overturns the ruling, you get a lien. You can\'t trade until you pay the XMR back.');
    expect(text).not.toMatch(/window closes/);
    // The losing side reads that the lien would fall on the other trader.
    const seller = trade({ role: 'seller', counterparty: 'mira.k', state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const r2 = render(inRouter(<DisputeRuling trade={seller} methodName="Zelle" dispute={ruled()} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(r2.host.textContent).toContain('If an appeal overturns the ruling, mira.k gets a lien until they pay the XMR back.');
    expect(r2.host.textContent).not.toMatch(/window closes|address ending/);
  });

  it('after an appeal: the lien line, and no claim that the XMR has moved (review I1)', () => {
    const seller = trade({ role: 'seller', counterparty: 'mira.k', state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const appealed = ruled({}, { status: 'appealed', appeal: { by: 'seller', at: iso(450) } });
    const { host } = render(inRouter(<DisputeRuling trade={seller} methodName="Zelle" dispute={appealed} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(host.textContent).toContain('Appeal sent. A second moderator will look at it. If they overturn the ruling, the other trader gets a lien until they pay the XMR back.');
    expect(host.textContent).not.toMatch(/stays locked|already moved/);
    const buyer = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const r2 = render(inRouter(<DisputeRuling trade={buyer} methodName="Zelle" dispute={appealed} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(r2.host.textContent).toContain('satoshi_ghost appealed. A second moderator will look at it. If they overturn the ruling, you get a lien until you pay the XMR back.');
    expect(r2.host.textContent).not.toMatch(/already moved/);
  });

  // Review N3: "(48 h)" is the rule's window length (APPEAL_WINDOW_H), not appealUntil − ruledAt (a
  // ruled_at set at proposal time under two-person approval would read "(49 h)").
  it('names the appeal window from the rule, whatever ruledAt says', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={ruled({ ruledAt: iso(340) })} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(host.textContent).toContain('(48 h).');
    expect(host.textContent).not.toContain('(49 h)');
  });

  it('shows the ruling card with the moderator badge, and no appeal button once final', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={ruled({ round: 2, appealUntil: null })} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(host.querySelector('[aria-label="Ruling"] .x2f-tag[data-role="mod"]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Appeal this ruling')).toBe(false);
  });
});

// Plan 4 Task 15 on Task 10's trader view (goalAt, replyDueAt, queuePosition, complyBy) and the
// owner's rules: the 24 h is a goal, not a deadline (owner 2026-11-03); talk to the other trader
// first (owner Q20, 2026-11-03); one appeal only, and it is final.
describe('Plan 4 Task 15: the dispute screens on the trader view', () => {
  const view = (over: Record<string, unknown> = {}) => ({
    ...dispute(),
    goalAt: iso(130 + 24 * 60),
    replyDueAt: iso(130 + 4 * 60),
    firstReplyAt: null,
    queuePosition: 3,
    round: 1,
    complyBy: null,
    ...over,
  });

  it('reads the goal, the first-reply time, the queue place, complyBy and an owed fee; absent ones read as null', () => {
    const d = parseDispute(view({ complyBy: iso(900), feeOwedAtomic: '12500000000' }));
    expect(d).toMatchObject({ goalAt: iso(130 + 24 * 60), replyDueAt: iso(130 + 4 * 60), queuePosition: 3, complyBy: iso(900), feeOwedAtomic: '12500000000' });
    const old = parseDispute(dispute());
    expect(old).toMatchObject({ goalAt: null, replyDueAt: null, queuePosition: null, complyBy: null, feeOwedAtomic: null });
    expect(() => parseDispute(view({ goalAt: 'soon' }))).toThrow();
    expect(() => parseDispute(view({ queuePosition: '3' }))).toThrow();
    expect(() => parseDispute(view({ feeOwedAtomic: '-1' }))).toThrow();
    expect(() => parseDispute(view({ feeOwedAtomic: 125 }))).toThrow();
  });

  it('Plan 4 Task 11: reads the incident ID and the proof request; absent ones read as null', () => {
    const d = parseDispute(view({ incidentId: 'K7QM4T2XB', proofRequest: { username: 'sarah.v', at: iso(300) } }));
    expect(d).toMatchObject({ incidentId: 'K7QM4T2XB', proofRequest: { username: 'sarah.v', at: iso(300) } });
    expect(parseDispute(dispute())).toMatchObject({ incidentId: null, proofRequest: null });
    expect(() => parseDispute(view({ incidentId: 'k7qm' }))).toThrow();
    expect(() => parseDispute(view({ proofRequest: { username: 'sarah.v' } }))).toThrow();
  });

  it("owner g63: reads the poster's fee rule after a ruling; absent (the taker's view) reads as null", () => {
    for (const fee of ['poster-pays', 'none', 'waits'] as const) expect(parseDispute(view({ fee })).fee).toBe(fee);
    expect(parseDispute(view({})).fee).toBeNull();
    expect(() => parseDispute(view({ fee: 'maybe' }))).toThrow();
  });

  it('before a moderator replies: the hourglass is the one deadline, with the place in the queue under it (design 7 Nov)', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const d = parseDispute(view());
    const { host } = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={d} serverClock={at(200)} />));
    expect(host.textContent).not.toContain('First reply due by');
    expect(host.querySelector('[data-part="hourglass"] .dispute-hero__meta')!.textContent).toBe("You're number 3 in the queue");
  });

  it('an hourglass counts down from 24 hours, the most before a moderator steps in; traders never see the 48-hour deadline (owner Q38)', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const d = parseDispute(view({ dueAt: iso(130 + 48 * 60), queuePosition: null, moderator: null }));
    const before = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={d} serverClock={at(200)} />));
    const glass = before.host.querySelector('[data-part="hourglass"]')!;
    expect(glass.getAttribute('data-state')).toBe('running');
    expect(glass.querySelector('[role="timer"]')?.textContent).toBe('22 h 50 min');
    expect(glass.querySelector('.dispute-hero__label')!.textContent).toBe('Until a moderator steps in');
    expect([...glass.querySelectorAll('.dispute-hero__num')].map((n) => n.textContent)).toEqual(['22', '50']);
    expect(glass.querySelector('.dispute-hero__line')!.textContent).toBe(HOURGLASS_LINE);
    const text = before.host.textContent ?? '';
    expect(text).not.toMatch(/due by|aiming|48 h|48 hours|Replied in/);
    // Past the 24 hours: an empty hourglass, still no 48-hour deadline.
    const after = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={d} serverClock={at(130 + 25 * 60)} />));
    const over = after.host.querySelector('[data-part="hourglass"]')!;
    expect(over.getAttribute('data-state')).toBe('over');
    expect(over.textContent).toContain('Taking longer than usual');
    expect(after.host.textContent).not.toMatch(/due by|48 h|48 hours/);
    // Gone once there is a ruling, and absent when the view has no goal.
    const ruledView = parseDispute(view({ status: 'ruled', ruling: ruled().ruling }));
    expect(render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={ruledView} serverClock={at(500)} />)).host.querySelector('[data-part="hourglass"]')).toBeNull();
    expect(render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={parseDispute(dispute())} serverClock={at(200)} />)).host.querySelector('[data-part="hourglass"]')).toBeNull();
    // Lead review 7 Nov: once a moderator joins, "Replied in …" replaces the hourglass (board v119).
    const joined = parseDispute(view({ dueAt: iso(130 + 48 * 60), queuePosition: null, firstReplyAt: iso(168), moderator: { name: 'sarah.v', joinedAt: iso(168) } }));
    const withMod = render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={joined} serverClock={at(200)} />));
    expect(withMod.host.querySelector('[data-part="hourglass"]')).toBeNull();
    expect(withMod.host.textContent).toContain('Replied in 38 min.');
  });

  it('no escrow amount block on a system escalation (lead review 7 Nov: nothing is locked after a release)', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const sys = parseDispute(view({ openedBy: 'system', moderator: null }));
    expect(render(inRouter(<DisputeRoom trade={t} methodName="Zelle" dispute={sys} serverClock={at(200)} />)).host.querySelector('[data-part="escrow-amount"]')).toBeNull();
  });

  it('DisputeOpen asks the trader to talk to the other side first, with a way back to the chat (owner Q20)', () => {
    const { host } = render(inRouter(<DisputeOpen trade={trade()} methodName="Zelle" now={at(121)} onOpen={async () => undefined} />));
    const notice = host.querySelector('[data-part="talk-first"]')!;
    expect(notice.textContent).toContain('Talk to satoshi_ghost first');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    // A nudge, never a block: the dispute can still be opened.
    expect(host.querySelector<HTMLButtonElement>('[data-primary]')!.disabled).toBe(false);
  });

  it('says there is one appeal only and its decision is final', () => {
    const t = trade({ state: 'disputed', dispute: { by: 'buyer', at: iso(130) } });
    const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={ruled()} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(host.textContent).toContain('There is one appeal per dispute, and its decision is final.');
  });

  it('tells the party the server says owes the fee, with the amount; nobody else (owner g63: a lien completes the trade)', () => {
    const t = trade({ state: 'refunded', dispute: { by: 'buyer', at: iso(130) } });
    const line = 'This also means you still owe the 1% fee for this trade, equal to 0.012500 XMR, which will be deducted automatically from your future trades.';
    const lien = { ...ruled({ outcome: 'seller-sends-xmr', destination: null }, { afterRefund: true, status: 'final' as const }), complyBy: iso(2000) };
    const owes = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={{ ...lien, feeOwedAtomic: '12500000000' }} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(owes.host.textContent).toContain(line);
    const not = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={lien} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(not.host.textContent).not.toContain('owe the 1% fee');
  });

  it('seller-sends-xmr: the seller reads the amount and the time to send it; the tx-proof form needs a 64-hex hash and key', async () => {
    const t = trade({ role: 'seller', counterparty: 'mira.k', state: 'refunded', dispute: { by: 'buyer', at: iso(130) } });
    const d = { ...ruled({ outcome: 'seller-sends-xmr', destination: null }, { afterRefund: true, status: 'final' as const }), complyBy: iso(2000) };
    const plain = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={d} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(plain.host.textContent).toContain('You must send mira.k 1.250000 XMR');
    // Design X5: "D Mon YYYY, HH:MM UTC" in mono.
    expect(plain.host.textContent).toContain(`Send it by ${utcDateTime(new Date(T0 + 2000 * MIN))}.`);
    expect(utcDateTime(new Date('2026-11-06T15:00:00Z'))).toBe('6 Nov 2026, 15:00 UTC');
    // No proof route yet (NEEDS_TASK_12_TX_PROOF): no form without a handler.
    expect(plain.host.querySelector('[aria-label="Transfer proof"]')).toBeNull();

    const onTxProof = vi.fn(async () => undefined);
    const { host } = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={d} serverClock={at(500)} onAppeal={async () => undefined} onTxProof={onTxProof} />));
    const form = host.querySelector('[aria-label="Transfer proof"]')!;
    const [hash, key] = [...form.querySelectorAll<HTMLInputElement>('input')];
    const type = (el: HTMLInputElement, v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const send = () => form.querySelector<HTMLButtonElement>('button')!;
    type(hash!, 'a'.repeat(64));
    type(key!, 'b'.repeat(63));
    expect(send().disabled).toBe(true);
    type(key!, 'g'.repeat(64));
    expect(send().disabled).toBe(true);
    type(key!, ` ${'B'.repeat(64)} `);
    expect(send().disabled).toBe(false);
    await act(async () => {
      send().click();
    });
    expect(onTxProof).toHaveBeenCalledWith('a'.repeat(64), 'b'.repeat(64));
    // The buyer only reads what the seller must do.
    const buyer = render(inRouter(<DisputeRuling trade={{ ...t, role: 'buyer', counterparty: 'satoshi_ghost' }} methodName="Zelle" dispute={d} serverClock={at(500)} onAppeal={async () => undefined} onTxProof={onTxProof} />));
    expect(buyer.host.textContent).toContain('satoshi_ghost must send you 1.250000 XMR');
    expect(buyer.host.querySelector('[aria-label="Transfer proof"]')).toBeNull();
  });

  it('seller-sends-xmr: the amount to send is exact, never cut at 6 places (review kit round 1, finding 1)', () => {
    const t = trade({ role: 'seller', counterparty: 'mira.k', state: 'refunded', amountAtomic: '610529733574', dispute: { by: 'buyer', at: iso(130) } });
    const d = { ...ruled({ outcome: 'seller-sends-xmr', destination: null }, { afterRefund: true, status: 'final' as const }), complyBy: iso(2000) };
    const seller = render(inRouter(<DisputeRuling trade={t} methodName="Zelle" dispute={d} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(seller.host.textContent).toContain('You must send mira.k 0.610529733574 XMR');
    const buyer = render(inRouter(<DisputeRuling trade={{ ...t, role: 'buyer', counterparty: 'satoshi_ghost' }} methodName="Zelle" dispute={d} serverClock={at(500)} onAppeal={async () => undefined} />));
    expect(buyer.host.textContent).toContain('satoshi_ghost must send you 0.610529733574 XMR');
    expect(xmrInTextExact(733_574n)).toBe('0.000000733574');
    // Kit handoff 1.5: an exact figure still reads as money, 6 places at least, more only when non-zero.
    expect(xmrInTextExact('1250000000000')).toBe('1.250000');
    expect(xmrInTextExact('1250000000100')).toBe('1.2500000001');
  });
});

describe('the buyer dispute wait, said two ways (owner F9)', () => {
  it('waitPart is the Duration of the wait in the same units as waitInWords', () => {
    const cases: [number, string, string][] = [
      [90, '90 min', '90 minutes'],
      [180, '3 h', '3 hours'],
      [1440, '24 h', '24 hours'],
      [2 * 1440, '2 d', '2 days'],
      [4 * 1440, '4 d', '4 days'],
      [1, '1 min', '1 minute'],
    ];
    for (const [min, part, words] of cases) {
      const p = waitPart(min);
      expect(`${p.n} ${p.unit}`).toBe(part);
      expect(waitInWords(min)).toBe(words);
    }
  });
});
