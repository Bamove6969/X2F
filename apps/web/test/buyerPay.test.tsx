// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuyerPay, SellerWaiting, TASK23_SLOTS } from '../src/screens/trade/BuyerPay.js';
import { GIFT_CARD_WARNING, setPaidAckSource, setTradeChat, setPaymentDetailsSource } from '../src/screens/trade/paySeams.js';
import type { TradeEscrow, TradeScreenProps, TradeView } from '../src/screens/trade/payTypes.js';
import { render } from './render.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const CODE = 'K7M2-9QXA-4FTR-8WPN';

const ZELLE = {
  id: 'ZELLE',
  name: 'Zelle',
  whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
  fields: [{ key: 'recipient', label: 'Email or US phone number', kind: 'email-or-phone' }],
};

function tradeView(over: Partial<TradeView> = {}): TradeView {
  return {
    code: CODE,
    role: 'buyer',
    poster: 'seller',
    state: 'securing',
    counterparty: { displayName: 'satoshi_ghost', completedTrades: 412, online: true, lastSeenAt: null, typicalMinutes: 6, positivePct: 99, badges: ['Trusted', 'Fast'] },
    methodId: 'ZELLE',
    profile: ZELLE,
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    maxFiatCents: '100000',
    grown: null,
    receivedAtomic: '1250000000000',
    confirmations: 3,
    releasable: false,
    releasableEtaMin: 14,
    funding: null,
    extensions: 0,
    cancelProposedBy: null,
    settling: null,
    dispute: null,
    txHash: null,
    takenAt: at(-40),
    setupBy: null,
    fundBy: null,
    fundingSeenAt: at(-6),
    securedAt: null,
    payBy: null,
    paidAt: null,
    confirmBy: null,
    finalAlertAt: null,
    settleBy: null,
    pausedAt: null,
    closedAt: null,
    nextDeadline: null,
    serverNow: at(0),
    ...over,
  };
}

const SECURED: Partial<TradeView> = { state: 'secured', confirmations: 12, releasable: true, releasableEtaMin: 0, securedAt: at(-28), payBy: at(62) };

/** Calls in the order they happened: API posts and escrow actions together. */
let calls: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let answer: (body: Record<string, unknown>) => { status: number; json: unknown };

function fakeEscrow(over: Partial<TradeEscrow> = {}): TradeEscrow {
  const act = (name: string) => vi.fn(async (...a: unknown[]) => void calls.push(a.length ? `escrow:${name}(${String(a[0])})` : `escrow:${name}`));
  return {
    phase: 'ready',
    error: null,
    retryable: false,
    refusal: null,
    checkWords: null,
    keepOpen: false,
    release: act('release'),
    buildRefund: act('buildRefund'),
    buyerCancel: act('buyerCancel'),
    proposeCancelSign: act('proposeCancelSign'),
    markPaid: act('markPaid'),
    retry: vi.fn(),
    signal: act('signal'),
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  answer = () => ({ status: 200, json: tradeView() });
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    calls.push(`POST ${url} ${JSON.stringify(body)}`);
    const a = answer(body);
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  setPaymentDetailsSource((_code, on) => {
    on([{ label: 'Zelle to', value: '[SELLER ZELLE ID]' }]);
    return () => undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPaidAckSource(null);
  setTradeChat(null);
  setPaymentDetailsSource(null);
});

function props(over: Partial<TradeScreenProps> = {}): TradeScreenProps {
  return {
    view: tradeView(),
    escrow: fakeEscrow(),
    refresh: vi.fn(async () => void calls.push('refresh')),
    serverClock: () => new Date(T0),
    wide: false,
    ...over,
  };
}

function mount(p: TradeScreenProps, Screen = BuyerPay) {
  const r = render(
    <MemoryRouter>
      <Screen {...p} />
    </MemoryRouter>,
  );
  return {
    ...r,
    rerender: (next: TradeScreenProps) =>
      r.rerender(
        <MemoryRouter>
          <Screen {...next} />
        </MemoryRouter>,
      ),
  };
}

const text = () => document.body.textContent ?? '';
const byText = (label: string, sel = 'button, a, label'): HTMLElement => {
  const el = [...document.body.querySelectorAll<HTMLElement>(sel)].find((e) => (e.textContent ?? '').trim() === label);
  if (!el) throw new Error(`no ${sel} "${label}" in: ${text()}`);
  return el;
};
const maybe = (label: string, sel = 'button, a') => [...document.body.querySelectorAll<HTMLElement>(sel)].find((e) => (e.textContent ?? '').trim() === label);
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe('BuyerPay (BuyerPay board), phone', () => {
  it('securing: the amber chip, "3 of 10 · about 14 min", the unstarted 90 min and the payment card', () => {
    mount(props());
    const t = text();
    expect(t).toContain('Buying from satoshi_ghost');
    expect(t).toContain(`Trade ${CODE} · Zelle`);
    expect(t).toContain('Securing escrow');
    expect(t).toContain('3 of 10 · about 14 min');
    expect(t).toContain('90 min');
    expect(t).toContain('Clock starts when escrow settles, in 14 min');
    expect(t).toContain('$412.50 USD');
    expect(t).toContain('[SELLER ZELLE ID]');
    expect(t).toContain("Pay from an account in your own name. Payments from someone else's account may be rejected or frozen. Use at your own risk.");
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
    expect(byText("I've paid", 'button').hasAttribute('data-primary')).toBe(true);
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3');
  });

  it('shows "Releasable in N min" at 10 confirmations before the coins unlock (P3-I4)', () => {
    mount(props({ view: tradeView({ confirmations: 10, releasableEtaMin: 2 }) }));
    expect(text()).toContain('Releasable in 2 min');
    expect(text()).not.toContain('Securing escrow');
  });

  it('secured: the teal chip and the countdown to payBy from the server clock', () => {
    mount(props({ view: tradeView(SECURED) }));
    expect(text()).toContain('Escrow secured');
    expect(document.querySelector('[role="timer"]')?.textContent).toBe('1 h 2 min');
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('the counterparty is shown by its public display name, in data-username', () => {
    mount(props({ view: tradeView({ counterparty: { ...tradeView().counterparty, displayName: 'Satoshi.Ghost', username: 'old_column' } }) }));
    const names = [...document.querySelectorAll('[data-username]')].map((e) => e.textContent);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(['Satoshi.Ghost']));
    expect(text()).not.toContain('old_column');
  });

  it('a gift-card method shows the one bold warning', () => {
    mount(props({ view: tradeView({ profile: { ...ZELLE, name: 'Amazon gift card', giftCard: true } }) }));
    expect([...document.querySelectorAll('strong')].map((s) => s.textContent)).toContain(GIFT_CARD_WARNING);
  });
});

describe("I've paid and PaidConfirmSheet", () => {
  it('opens the sheet with the exact sentence; unticked, Yes does nothing', async () => {
    const p = props({ view: tradeView(SECURED) });
    mount(p);
    await click(byText("I've paid", 'button'));
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain(`I sent exactly $412.50 via Zelle with ${CODE} in the memo`);
    expect(dialog()!.textContent).toContain('Sending without proof makes disputes harder.');
    const yes = byText("Yes, I've paid", 'button') as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    await click(yes);
    expect(calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Not yet closes the sheet and sends nothing', async () => {
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await click(byText('Not yet', 'button'));
    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('Yes posts mark-paid with the total shown, then sends trade.paid, then re-reads', async () => {
    answer = () => ({ status: 200, json: tradeView({ ...SECURED, state: 'paid', paidAt: at(0) }) });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 via Zelle with ${CODE} in the memo`, 'label'));
    await click(byText("Yes, I've paid", 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'escrow:markPaid(41250)', 'refresh']);
    expect(dialog()).toBeNull();
  });

  it('409 total-changed: no trade.paid, the trade is re-read and the sheet asks again with the new total', async () => {
    answer = () => ({ status: 409, json: { error: 'total-changed' } });
    const p = props({ view: tradeView(SECURED) });
    const r = mount(p);
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 via Zelle with ${CODE} in the memo`, 'label'));
    await click(byText("Yes, I've paid", 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'refresh']);
    // The room re-read the trade: it grew to 1.312500 XMR, $433.13.
    r.rerender({ ...p, view: tradeView({ ...SECURED, amountAtomic: '1312500000000', fiatCents: '43313', grown: { at: at(-1), fromAtomic: '1250000000000', fromFiatCents: '41250' } }) });
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('Trade grew to 1.312500 XMR, you now pay $433.13');
    const box = dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    expect(byText(`I sent exactly $433.13 via Zelle with ${CODE} in the memo`, 'label')).toBeTruthy();
    answer = () => ({ status: 200, json: tradeView({ state: 'paid' }) });
    await click(byText(`I sent exactly $433.13 via Zelle with ${CODE} in the memo`, 'label'));
    await click(byText("Yes, I've paid", 'button'));
    await flush();
    expect(calls.slice(2)).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"43313"}`, 'escrow:markPaid(43313)', 'refresh']);
  });

  it('a total that changes while the sheet is open unticks the box', async () => {
    const p = props({ view: tradeView(SECURED) });
    const r = mount(p);
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 via Zelle with ${CODE} in the memo`, 'label'));
    r.rerender({ ...p, view: tradeView({ ...SECURED, fiatCents: '43313', amountAtomic: '1312500000000' }) });
    expect(dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect((byText("Yes, I've paid", 'button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('another refusal is shown as text and nothing is signalled', async () => {
    answer = () => ({ status: 409, json: { error: 'too-late' } });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 via Zelle with ${CODE} in the memo`, 'label'));
    await click(byText("Yes, I've paid", 'button'));
    await flush();
    expect(calls.filter((c) => c.startsWith('escrow:'))).toEqual([]);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('paid: "Marked as paid" only after the moderator\'s trade.ack', async () => {
    let ack: (() => void) | null = null;
    setPaidAckSource((code, on) => {
      expect(code).toBe(CODE);
      ack = on;
      return () => undefined;
    });
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }) }));
    expect(text()).not.toContain('Marked as paid');
    await act(async () => ack!());
    expect(text()).toContain('Marked as paid');
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('paid but the signal never left (the device refused it): Try again sends only trade.paid', async () => {
    const escrow = fakeEscrow({ markPaid: vi.fn(async () => Promise.reject(new Error('no signals yet'))) });
    answer = () => ({ status: 200, json: tradeView({ ...SECURED, state: 'paid' }) });
    const p = props({ view: tradeView(SECURED), escrow });
    const r = mount(p);
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 via Zelle with ${CODE} in the memo`, 'label'));
    await click(byText("Yes, I've paid", 'button'));
    await flush();
    r.rerender({ ...p, view: tradeView({ ...SECURED, state: 'paid', paidAt: at(0) }) });
    expect(text()).toContain("Couldn't tell the escrow you paid. Try again.");
    (escrow.markPaid as ReturnType<typeof vi.fn>).mockImplementation(async (c: bigint) => void calls.push(`escrow:markPaid(${c})`));
    calls = [];
    await click(byText('Try again', 'button'));
    await flush();
    expect(calls).toEqual(['escrow:markPaid(41250)']);
  });
});

describe('buyer cancel (spec 2.3)', () => {
  it('before "I\'ve paid", one tap posts buyer-cancel and then starts the refund (trade.cancel)', async () => {
    answer = () => ({ status: 200, json: tradeView({ state: 'settling', settling: 'buyer-cancel' }) });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText('Cancel trade', 'button'));
    await flush();
    expect(dialog()).toBeNull();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"buyer-cancel"}`, 'escrow:buyerCancel', 'refresh']);
  });

  it('after "I\'ve paid", the warning comes first and nothing happens until it is confirmed', async () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-5) }) }));
    await click(byText('Cancel trade', 'button'));
    expect(dialog()!.textContent).toContain(
      "Only cancel if your payment was never sent or was returned. Scammers try to talk buyers into cancelling after they've paid.",
    );
    expect(calls).toEqual([]);
    await click(byText('Keep the trade', 'button'));
    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
    await click(byText('Cancel trade', 'button'));
    answer = () => ({ status: 200, json: tradeView({ state: 'settling', settling: 'buyer-cancel' }) });
    await click([...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel trade')!);
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"buyer-cancel"}`, 'escrow:buyerCancel', 'refresh']);
  });

  it("the seller's proposal shows an accept/decline card; Accept posts accept-cancel then signs the mutual cancel", async () => {
    mount(props({ view: tradeView({ ...SECURED, cancelProposedBy: 'seller' }) }));
    expect(text()).toContain('satoshi_ghost proposed cancelling this trade.');
    await click(byText('Accept', 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"accept-cancel"}`, 'escrow:proposeCancelSign', 'refresh']);
  });

  it('Decline hides the card and sends nothing (the API has no decline; paying clears it)', async () => {
    mount(props({ view: tradeView({ ...SECURED, cancelProposedBy: 'seller' }) }));
    await click(byText('Decline', 'button'));
    expect(text()).not.toContain('proposed cancelling this trade.');
    expect(calls).toEqual([]);
  });
});

describe("the seller's funded room (SellerWaiting)", () => {
  const seller = (over: Partial<TradeView> = {}) =>
    tradeView({ ...SECURED, role: 'seller', counterparty: { ...tradeView().counterparty, displayName: 'mira.k' }, ...over });

  it('offers no cancel-alone control in any funded state, only Propose cancel', async () => {
    for (const state of ['secured', 'securing', 'paid'] as const) {
      const r = mount(props({ view: seller({ state }) }), SellerWaiting);
      expect(maybe('Cancel trade')).toBeUndefined();
      expect(maybe('Cancel & get refund')).toBeUndefined();
      expect(maybe('Propose cancel')).toBeDefined();
      expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
      r.unmount();
    }
  });

  it('Propose cancel posts propose-cancel and never touches the escrow; Withdraw takes it back', async () => {
    const p = props({ view: seller() });
    const r = mount(p, SellerWaiting);
    expect(text()).toContain('Waiting for mira.k to pay');
    await click(byText('Propose cancel', 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"propose-cancel"}`, 'refresh']);
    r.rerender({ ...p, view: seller({ cancelProposedBy: 'seller' }) });
    expect(text()).toContain('You proposed cancelling. Waiting for mira.k.');
    calls = [];
    await click(byText('Withdraw', 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"withdraw-cancel"}`, 'refresh']);
  });
});

describe('desktop room (Desktop board)', () => {
  it('wide: the timeline, the counterparty card and the chat slot beside the payment', () => {
    setTradeChat(({ name }) => <p data-test-chat>chat with {name}</p>);
    mount(props({ view: tradeView(SECURED), wide: true }));
    const steps = [...document.querySelectorAll('[aria-label="Trade progress"] li')].map((li) => li.textContent);
    expect(steps).toEqual(['Escrow funded', 'You pay · 1 h 2 min left', 'Seller confirms', 'XMR released']);
    const aside = document.querySelector('aside[aria-label="Chat with satoshi_ghost"]')!;
    expect(aside.textContent).toContain('412 trades · 99% positive · releases in ~6 min');
    expect(aside.textContent).toContain('Trusted');
    expect(aside.querySelector('[data-test-chat]')?.textContent).toBe('chat with satoshi_ghost');
    expect(text()).toContain('$330.00 / XMR');
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
  });
});

describe('slots for the trade room (Task 22)', () => {
  it('buyer in securing, secured and paid; seller in secured', () => {
    expect(TASK23_SLOTS.map((s) => [s.role, [...s.states]])).toEqual([
      ['buyer', ['securing', 'secured', 'paid']],
      ['seller', ['secured']],
    ]);
    expect(TASK23_SLOTS.every((s) => s.owner === 'Task 23' && s.when === undefined)).toBe(true);
  });
});
