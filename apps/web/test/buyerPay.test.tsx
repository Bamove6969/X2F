// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuyerCancelling, BuyerPay, SellerWaiting, TASK23_SLOTS } from '../src/screens/trade/BuyerPay.js';
import { disputeOpensAt } from '../src/screens/trade/PaidWaiting.js';
import { GIFT_CARD_WARNING, setTradeChat, setPaymentDetailsSource } from '../src/screens/trade/paySeams.js';
import type { TradeEscrow, TradeScreenProps, TradeView } from '../src/screens/trade/payTypes.js';
import { render } from './render.js';
import { resetWarned, setWarned } from '../src/screens/trade/warned.js';
import { PAY_WARNING_LEAD, PAY_WARNING_WHY } from '../src/screens/trade/PayWarning.js';
import { FinalAlert } from '../src/screens/trade/FinalAlert.js';
import { buyerAlertView, SERVER_NOW } from '../e2e/refundViews.js';

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
    counterparty: { displayName: 'satoshi_ghost', completedTrades: 412, online: true, lastSeenAt: null, typicalMinutes: 6, positivePct: 99, badges: ['Trusted', 'Fast'], stage: 'graduated' },
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
    fundStartedAt: null,
    securedAt: null,
    payBy: null,
    paidAt: null,
    confirmBy: null,
    finalAlertAt: null,
    finalAlertSeenAt: null,
    settleBy: null,
    pausedAt: null,
    closedAt: null,
    cancelConfirmedAt: null,
    cancelConfirmableAt: null,
    nextDeadline: null,
    serverNow: at(0),
    ...over,
  };
}

const DEAL = { poster: 'seller' as const, takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 100_000n };

const SECURED: Partial<TradeView> = { state: 'secured', confirmations: 12, releasable: true, releasableEtaMin: 0, securedAt: at(-28), payBy: at(62) };

/** Calls in the order they happened: API posts and escrow actions together. */
let calls: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let answer: (body: Record<string, unknown>) => { status: number; json: unknown };

function fakeEscrow(over: Partial<TradeEscrow> = {}): TradeEscrow {
  const act = (name: string) => vi.fn(async (...a: unknown[]) => void calls.push(a.length ? `escrow:${name}(${String(a[0])})` : `escrow:${name}`));
  return {
    phase: 'ready',
    escrowAddress: null,
    // The device's own figures for the board trade (1.25 XMR at $330.00, $412.50).
    deal: DEAL,
    amountAtomic: 1_250_000_000_000n,
    fiatCents: 41_250n,
    receivedAtomic: null,
    confirmedAtomic: null,
    paidRecorded: false,
    intentKind: null,
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
  // Task 38's pay warning is tested on its own (below); elsewhere the buyer went past it already.
  setWarned('pay', CODE);
  calls = [];
  answer = () => ({ status: 200, json: tradeView() });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push(init?.method === 'POST' ? `POST ${url} ${JSON.stringify(body)}` : `GET ${url}`);
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
  resetWarned();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  setTradeChat(null);
  setPaymentDetailsSource(null);
});

function props(over: Partial<TradeScreenProps> = {}): TradeScreenProps {
  const view = over.view ?? tradeView();
  return {
    code: view.code,
    view,
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
    mount(props({ view: tradeView({ counterparty: { ...tradeView().counterparty, displayName: 'Satoshi.Ghost' } }) }));
    const names = [...document.querySelectorAll('[data-username]')].map((e) => e.textContent);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(['Satoshi.Ghost']));
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
    expect(dialog()!.textContent).toContain(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`);
    expect(dialog()!.textContent).toContain('After this you can\'t cancel the trade. If something goes wrong, open a dispute.');
    const yes = byText("Yes, mark as paid", 'button') as HTMLButtonElement;
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
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText("Yes, mark as paid", 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'escrow:markPaid(41250)', 'refresh']);
    expect(dialog()).toBeNull();
  });

  it('409 total-changed: no trade.paid, the trade is re-read and the sheet asks again with the new total', async () => {
    answer = () => ({ status: 409, json: { error: 'total-changed' } });
    const p = props({ view: tradeView(SECURED) });
    const r = mount(p);
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText("Yes, mark as paid", 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'refresh']);
    // The room re-read the trade: it grew to 1.312500 XMR, $433.13.
    r.rerender({
      ...p,
      view: tradeView({ ...SECURED, amountAtomic: '1312500000000', fiatCents: '43313', grown: { at: at(-1), fromAtomic: '1250000000000', fromFiatCents: '41250' } }),
      escrow: { ...p.escrow, amountAtomic: 1_312_500_000_000n, fiatCents: 43_313n },
    });
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('Trade grew to 1.312500 XMR, you now pay $433.13');
    const box = dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    expect(byText(`I sent exactly $433.13 by Zelle with the memo ${CODE}.`, 'label')).toBeTruthy();
    answer = () => ({ status: 200, json: tradeView({ state: 'paid' }) });
    await click(byText(`I sent exactly $433.13 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText("Yes, mark as paid", 'button'));
    await flush();
    expect(calls.slice(2)).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"43313"}`, 'escrow:markPaid(43313)', 'refresh']);
  });

  it('a total that changes while the sheet is open unticks the box', async () => {
    const p = props({ view: tradeView(SECURED) });
    const r = mount(p);
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    r.rerender({ ...p, view: tradeView({ ...SECURED, fiatCents: '43313', amountAtomic: '1312500000000' }), escrow: { ...p.escrow, amountAtomic: 1_312_500_000_000n, fiatCents: 43_313n } });
    expect(dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect((byText("Yes, mark as paid", 'button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('another refusal is shown as text and nothing is signalled', async () => {
    answer = () => ({ status: 409, json: { error: 'too-late' } });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText("Yes, mark as paid", 'button'));
    await flush();
    expect(calls.filter((c) => c.startsWith('escrow:'))).toEqual([]);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('paid: "Marking as paid…" until this device recorded the tap, then the BuyerPaidWaiting status with no disabled button (design review 39)', () => {
    const paidView = tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) });
    const r = mount(props({ view: paidView, escrow: fakeEscrow({ paidRecorded: false }) }));
    expect(text()).toContain('Marking as paid…');
    r.unmount();
    mount(props({ view: paidView, escrow: fakeEscrow({ paidRecorded: true }) }));
    const status = document.querySelector('[data-part="paid-status"]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.querySelector('h1')?.textContent).toBe('Paid · waiting for satoshi_ghost to confirm');
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(0);
    // Your payment folds away in the kit's Disclosure, closed at first.
    expect(document.querySelector('[data-part="paid-payment-toggle"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-part="confirm-timer"] [role="timer"]')?.textContent).toBe('1 h 59 min');
  });

  it('paid, but this device never recorded it (a reload, another tab, a lost response): Finish sends only trade.paid, with the device total', async () => {
    const escrow = fakeEscrow({ refusal: 'amount-unknown' });
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1) }), escrow }));
    expect(text()).toContain("Your device hasn't recorded your payment. Tap to finish.");
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
    await click(byText('Finish marking as paid', 'button'));
    await flush();
    expect(calls).toEqual(['escrow:markPaid(41250)']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Finish is refused, and says why, when the device's total is not the trade's", async () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), fiatCents: '43313' }), escrow: fakeEscrow({ refusal: 'amount-unknown' }) }));
    const finish = byText('Finish marking as paid', 'button') as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(text()).toContain("Your device can't confirm the total the trade shows.");
    await click(finish);
    expect(calls).toEqual([]);
  });

  it('a lost mark-paid response: the retry gets 409 wrong-state, the sheet closes and the trade is re-read', async () => {
    answer = () => ({ status: 409, json: { error: 'wrong-state' } });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText("Yes, mark as paid", 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'refresh']);
    expect(dialog()).toBeNull();
  });

  it('a stopped escrow says why in words, with Try again when it can run again', async () => {
    const escrow = fakeEscrow({ phase: 'error', error: 'escrow-failed', retryable: true });
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1) }), escrow }));
    expect(text()).toContain('Check your connection and try again.');
    await click(byText('Try again', 'button'));
    expect(escrow.retry).toHaveBeenCalledOnce();
  });
});

describe("every sum comes from this device, never the API (review 2026-10-27, I1)", () => {
  const paidButton = () => byText("I've paid", 'button') as HTMLButtonElement;

  it('an API amount outside the device range: no total, I\'ve paid disabled with the reason', async () => {
    // The API says $999.99; this device accepts no amount (escrow.fiatCents null).
    mount(props({ view: tradeView({ ...SECURED, amountAtomic: '3030272727272', fiatCents: '99999' }), escrow: fakeEscrow({ amountAtomic: null, fiatCents: null, refusal: 'amount-out-of-range' }) }));
    expect(text()).not.toContain('$999.99');
    expect(text()).not.toContain('$412.50');
    expect(paidButton().disabled).toBe(true);
    expect(document.querySelector('[data-pay-block]')?.textContent).toContain("Don't send any money yet");
    await click(paidButton());
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the device's total and rate, not the API's", () => {
    mount(props({ view: tradeView({ ...SECURED, lockedRate: { currency: 'USD', centsPerXmr: '99999' } }), wide: true }));
    expect(text()).toContain('$412.50');
    expect(text()).toContain('$330.00 / XMR');
    expect(text()).not.toContain('$999.99');
  });

  it("the API's total differs from the device's: the device's is shown and I've paid waits", () => {
    mount(props({ view: tradeView({ ...SECURED, fiatCents: '43313', amountAtomic: '1312500000000' }) }));
    expect(text()).toContain('$412.50');
    expect(text()).not.toContain('$433.13');
    expect(paidButton().disabled).toBe(true);
  });

  it("an escrow that is not ready, or stopped, leaves I've paid disabled and says why", () => {
    const r = mount(props({ view: tradeView(SECURED), escrow: fakeEscrow({ phase: 'verifying' }) }));
    expect(paidButton().disabled).toBe(true);
    expect(document.querySelector('[data-pay-block]')?.textContent).toContain('Keep this page open');
    r.unmount();
    mount(props({ view: tradeView(SECURED), escrow: fakeEscrow({ phase: 'error', error: 'escrow-failed', retryable: true }) }));
    expect(paidButton().disabled).toBe(true);
    expect(document.querySelector('[data-pay-block]')?.textContent).toContain('Check your connection and try again.');
  });

  it('Yes confirms and posts the device total, and the sheet says it', async () => {
    answer = () => ({ status: 200, json: tradeView({ ...SECURED, state: 'paid', paidAt: at(0) }) });
    mount(props({ view: tradeView(SECURED) }));
    await click(paidButton());
    expect(dialog()!.textContent).toContain('I sent exactly $412.50 by Zelle');
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText("Yes, mark as paid", 'button'));
    await flush();
    expect(calls[0]).toBe(`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`);
    expect(calls[1]).toBe('escrow:markPaid(41250)');
  });

  it("the seller's waiting room shows the device total, or none", () => {
    const seller = tradeView({ ...SECURED, role: 'seller', fiatCents: '99999' });
    const r = mount(props({ view: seller }), SellerWaiting);
    expect(text()).toContain('$412.50');
    expect(text()).not.toContain('$999.99');
    r.unmount();
    mount(props({ view: seller, escrow: fakeEscrow({ amountAtomic: null, fiatCents: null }) }), SellerWaiting);
    expect(text()).not.toContain('$999.99');
    expect(text()).not.toContain('$412.50');
  });
});

describe('the pay warning (Task 38; board Warn-IvePaid)', () => {
  const fresh = () => {
    resetWarned();
    window.localStorage.clear();
  };
  const alert = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');

  it("opens with the screen while the escrow still confirms, with the owner's words and the confirmations bar; I'll wait closes it", async () => {
    fresh();
    mount(props());
    expect(alert()).not.toBeNull();
    const t = alert()!.textContent ?? '';
    expect(t).toContain('Before you pay');
    expect(t).toContain('Wait until the XMR is fully in escrow');
    expect(t).toContain(PAY_WARNING_LEAD);
    expect(t).toContain(PAY_WARNING_WHY);
    expect(PAY_WARNING_LEAD + ' ' + PAY_WARNING_WHY).toBe(
      "We strongly recommend that you do not send payment until all confirmations are complete and you've received confirmation that the XMR is fully in escrow. The way our system is designed, we can help you get back the XMR you were trading for if anyone tries to scam you, but recovering a payment you've sent is much harder and sometimes impossible.",
    );
    expect(t).toContain('Escrow confirmations');
    expect(t).toContain('3 of 10 · about 14 min');
    // Review M5: "I'll wait" (the safe action) has focus; the owner's words describe the dialog.
    expect(document.activeElement?.textContent).toBe("I'll wait");
    expect(document.getElementById(alert()!.getAttribute('aria-describedby')!)?.textContent).toContain(PAY_WARNING_LEAD);
    await click(byText("I'll wait", 'button'));
    expect(alert()).toBeNull();
    expect(calls).toEqual([]);
  });

  it("I've paid shows it before the sheet; I've already paid goes on to the confirm sheet, and never shows it again for the trade (after a reload too)", async () => {
    fresh();
    const r = mount(props({ view: tradeView(SECURED) }));
    // Secured and unlocked: nothing opens by itself.
    expect(alert()).toBeNull();
    await click(byText("I've paid", 'button'));
    expect(alert()).not.toBeNull();
    expect(dialog()).toBeNull();
    // Secured: no bar.
    expect(alert()!.textContent).not.toContain('Escrow confirmations');
    await click(byText("I'll wait", 'button'));
    await click(byText("I've paid", 'button'));
    await click(byText("I've already paid", 'button'));
    expect(alert()).toBeNull();
    expect(dialog()!.textContent).toContain('Mark this trade as paid?');
    await click(byText('Not yet', 'button'));
    await click(byText("I've paid", 'button'));
    expect(alert()).toBeNull();
    expect(dialog()).not.toBeNull();
    r.unmount();
    // A reload: the in-memory mark is gone, the stored one stays.
    resetWarned();
    mount(props({ view: tradeView() }));
    expect(alert()).toBeNull();
  });

  it('not shown once the trade is paid', () => {
    fresh();
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), releasable: false }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(alert()).toBeNull();
  });

  it('Yes, mark as paid is disabled until the tick (the two steps)', async () => {
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    const yes = byText('Yes, mark as paid', 'button') as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    expect(yes.disabled).toBe(false);
  });
});

describe('buyer cancel (spec 2.3)', () => {
  it('before "I\'ve paid", one tap re-reads the trade, posts buyer-cancel and then starts the refund (trade.cancel)', async () => {
    answer = (b) => ({ status: 200, json: b.type ? tradeView({ state: 'settling', settling: 'buyer-cancel' }) : tradeView(SECURED) });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText('Cancel trade', 'button'));
    await flush();
    expect(dialog()).toBeNull();
    expect(calls).toEqual([`GET /v1/trades/${CODE}`, `POST /v1/trades/${CODE}/events {"type":"buyer-cancel"}`, 'escrow:buyerCancel', 'refresh']);
  });

  it("a one-tap cancel on a stale view: the fresh trade is paid (another tab), so nothing is cancelled and the room re-reads (review Minor 4; Revision 2026-10-29b)", async () => {
    answer = () => ({ status: 200, json: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1) }) });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText('Cancel trade', 'button'));
    await flush();
    expect(calls).toEqual([`GET /v1/trades/${CODE}`, 'refresh']);
    expect(dialog()).toBeNull();
  });

  it("after \"I've paid\" there is no cancel at all: no link, no sheet (Revision 2026-10-29b)", async () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-5) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(maybe('Cancel trade')).toBeUndefined();
    expect(text()).not.toContain('Only cancel if your payment was never sent');
    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
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

  it("offers no cancel-alone control in any funded state, only Propose cancel, and nothing after I've paid", async () => {
    for (const state of ['secured', 'securing', 'paid'] as const) {
      const r = mount(props({ view: seller({ state }) }), SellerWaiting);
      expect(maybe('Cancel trade')).toBeUndefined();
      expect(maybe('Cancel & get refund')).toBeUndefined();
      if (state === 'paid') expect(maybe('Propose cancel')).toBeUndefined();
      else expect(maybe('Propose cancel')).toBeDefined();
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
  it('buyer in securing, secured and paid; seller in secured; buyer in settling only after a cancel', () => {
    expect(TASK23_SLOTS.map((s) => [s.role, [...s.states], s.when ? 'guarded' : 'open'])).toEqual([
      ['buyer', ['securing', 'secured', 'paid'], 'open'],
      ['seller', ['secured'], 'open'],
      ['buyer', ['settling'], 'guarded'],
    ]);
    expect(TASK23_SLOTS.every((s) => s.owner === 'Task 23')).toBe(true);
  });
});

describe("Task 25's FinalAlert: I've paid opens Task 23's paid step", () => {
  it('Yes posts mark-paid with the device total, then sends trade.paid', async () => {
    answer = (b) => (String(b.type) === 'mark-paid' ? { status: 200, json: tradeView({ ...SECURED, state: 'paid' }) } : { status: 204, json: {} });
    const view = buyerAlertView();
    render(
      <MemoryRouter>
        <FinalAlert code={view.code} view={view} escrow={fakeEscrow()} refresh={async () => void calls.push('refresh')} serverClock={() => new Date(SERVER_NOW)} wide={false} />
      </MemoryRouter>,
    );
    await flush();
    calls = calls.filter((c) => !c.includes('final-alert-seen'));
    await click(byText("I've paid", 'button'));
    expect(dialog()!.textContent).toContain(`I sent exactly $412.50 by Zelle with the memo ${view.code}.`);
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${view.code}.`, 'label'));
    await click(byText("Yes, mark as paid", 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${encodeURIComponent(view.code)}/events {"type":"mark-paid","fiatCents":"41250"}`, 'escrow:markPaid(41250)', 'refresh']);
  });
});

describe('after the cancel: the buyer builds the refund (review I4)', () => {
  const settling = (kind: 'buyer-cancel' | 'mutual-cancel') => tradeView({ ...SECURED, state: 'settling', settling: kind });

  it('says the XMR goes back to the seller and to keep the page open', () => {
    mount(props({ view: settling('buyer-cancel'), escrow: fakeEscrow({ phase: 'signing', keepOpen: true }) }), BuyerCancelling);
    expect(text()).toContain('Returning the XMR to satoshi_ghost. Keep this page open.');
    expect(maybe('Try again')).toBeUndefined();
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('the escrow step rejects once; Try again calls only the escrow and posts nothing', async () => {
    let fail = true;
    const buyerCancel = vi.fn(async () => {
      calls.push('escrow:buyerCancel');
      if (fail) throw new Error('no signals yet');
    });
    mount(props({ view: settling('buyer-cancel'), escrow: fakeEscrow({ buyerCancel }) }), BuyerCancelling);
    await click(byText('Try again', 'button'));
    await flush();
    expect(text()).toContain("Couldn't start the refund. Try again.");
    fail = false;
    await click(byText('Try again', 'button'));
    await flush();
    expect(calls).toEqual(['escrow:buyerCancel', 'escrow:buyerCancel']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).not.toContain("Couldn't start the refund.");
  });

  it('a mutual cancel retries with proposeCancelSign; a stopped escrow retries with retry()', async () => {
    const r = mount(props({ view: settling('mutual-cancel') }), BuyerCancelling);
    await click(byText('Try again', 'button'));
    await flush();
    expect(calls).toEqual(['escrow:proposeCancelSign']);
    r.unmount();
    const escrow = fakeEscrow({ phase: 'error', error: 'escrow-failed', retryable: true });
    mount(props({ view: settling('buyer-cancel'), escrow }), BuyerCancelling);
    await click(byText('Try again', 'button'));
    expect(escrow.retry).toHaveBeenCalledOnce();
    expect(calls).toEqual(['escrow:proposeCancelSign']);
  });

  // Task 23 round-3 review, Minor 1: a refusal while the refund waits was never shown, so the
  // card said "Keep this page open" forever. The refusal sentence (with its next step) shows once.
  it.each([
    ['buyer-cancel', 'attempts-exhausted', "Your device couldn't settle this trade. Open a dispute."],
    ['buyer-cancel', 'view-mismatch', "The trade's details on the server don't match what you agreed to."],
    ['mutual-cancel', 'attempts-exhausted', "Your device couldn't settle this trade. Open a dispute."],
  ] as const)('round-3 Minor 1: %s with refusal %s shows the refusal and the next step, phone and wide', (kind, refusal, sentence) => {
    for (const wide of [false, true]) {
      const r = mount(props({ view: settling(kind), escrow: fakeEscrow({ phase: 'ready', intentKind: kind, refusal }), wide }), BuyerCancelling);
      expect(text().split(sentence).length - 1).toBe(1);
      expect(document.querySelector(`[data-escrow-refusal="${refusal}"]`)).not.toBeNull();
      expect(text()).toContain('Open a dispute');
      expect(maybe('Try again')).toBeUndefined();
      expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
      r.unmount();
    }
  });

  it('round-3 Minor 1: no refusal sentence once done, or while a stopped escrow already says why', () => {
    const r = mount(props({ view: settling('buyer-cancel'), escrow: fakeEscrow({ phase: 'done', refusal: 'attempts-exhausted' }) }), BuyerCancelling);
    expect(document.querySelector('[data-escrow-refusal]')).toBeNull();
    r.unmount();
    mount(props({ view: settling('buyer-cancel'), escrow: fakeEscrow({ phase: 'error', error: 'escrow-failed', retryable: true, refusal: 'attempts-exhausted' }) }), BuyerCancelling);
    expect(document.querySelector('[data-escrow-refusal]')).toBeNull();
  });

  it('done: the refund is settled from this device', () => {
    mount(props({ view: settling('buyer-cancel'), escrow: fakeEscrow({ phase: 'done' }) }), BuyerCancelling);
    expect(text()).toContain('The XMR is on its way back to satoshi_ghost.');
    expect(maybe('Try again')).toBeUndefined();
  });
});

describe('help tips (review Minor 2)', () => {
  const trigger = () => document.querySelector<HTMLElement>('[aria-describedby="tip-pay"]')!;
  const tip = () => document.getElementById('tip-pay');
  const pointer = (el: Element, type: string, pointerType: string) =>
    act(() => {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType }));
    });

  it('a tap opens the tip and leaves it open (the emulated hover does not toggle it shut)', async () => {
    mount(props());
    pointer(trigger(), 'pointerover', 'touch');
    await click(trigger());
    expect(tip()?.textContent).toContain('You get 90 minutes');
    await click(trigger());
    expect(tip()).not.toBeNull();
  });

  it('a tap outside closes it; the mouse opens it on hover and closes it on leave', async () => {
    mount(props());
    await click(trigger());
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    });
    expect(tip()).toBeNull();
    pointer(trigger(), 'pointerover', 'mouse');
    expect(tip()).not.toBeNull();
    pointer(trigger(), 'pointerout', 'mouse');
    expect(tip()).toBeNull();
  });
});

describe('review minors 1, 5 and 7', () => {
  const grown = { ...SECURED, amountAtomic: '1312500000000', fiatCents: '43313', grown: { at: at(-1), fromAtomic: '1250000000000', fromFiatCents: '41250' } };
  const grownEscrow = () => fakeEscrow({ amountAtomic: 1_312_500_000_000n, fiatCents: 43_313n });

  it('a trade that grew says so on the payment screen, with the device figures, and Cancel is right there', () => {
    mount(props({ view: tradeView(grown), escrow: grownEscrow() }));
    const note = document.querySelector('[data-grown]')!;
    expect(note.textContent).toBe('Trade grew to 1.312500 XMR, you now pay $433.13');
    expect(maybe('Cancel trade')).toBeDefined();
  });

  it("the seller's waiting room says so too", () => {
    mount(props({ view: tradeView({ ...grown, role: 'seller', counterparty: { ...tradeView().counterparty, displayName: 'mira.k' } }), escrow: grownEscrow() }), SellerWaiting);
    expect(document.querySelector('[data-grown]')!.textContent).toBe('Trade grew to 1.312500 XMR, mira.k now pays $433.13');
  });

  it('no growth note without the device amount', () => {
    mount(props({ view: tradeView(grown), escrow: fakeEscrow({ amountAtomic: null, fiatCents: null }) }));
    expect(document.querySelector('[data-grown]')).toBeNull();
  });

  it("in paid, Open a dispute waits for the later of I've paid + 30 min (owner 2 Nov) and the server's confirmBy, then opens", () => {
    const r = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const waiting = document.querySelector<HTMLButtonElement>('[data-part="paid-dispute"]')!;
    expect(waiting.tagName).toBe('BUTTON');
    // aria-disabled, so it keeps focus and its "Available from" (review N4).
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
    // The server's rule is later here (confirmBy, machine.ts too-early), so that is the time; "in 1 h 59 min" keeps its space (review 39 "in2 h").
    expect(document.getElementById(waiting.getAttribute('aria-describedby')!)?.textContent).toMatch(/^Available from \d+ \w{3} \d{4}, \d\d:\d\d UTC, in 1 h 59 min\.$/);
    r.unmount();
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-121), confirmBy: at(-1) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const open = document.querySelector('[data-part="paid-dispute"]')!;
    expect(open.tagName).toBe('A');
    expect(open.textContent).toBe('Open a dispute');
    expect(document.querySelector('[data-part="paid-status"] h1')?.textContent).toBe("satoshi_ghost hasn't confirmed in time");
  });

  it('disputeOpensAt: 30 min after I\'ve paid, never before the server allows it, and not at all without confirmBy (review M5)', () => {
    const t = (min: number) => new Date(Date.UTC(2026, 10, 6, 15, 0) + min * 60_000).toISOString();
    // The server's confirmBy is later: it wins.
    expect(disputeOpensAt({ paidAt: t(0), confirmBy: t(120) })).toBe(Date.parse(t(120)));
    // A server window shorter than 30 min: paid + 30 min.
    expect(disputeOpensAt({ paidAt: t(0), confirmBy: t(10) })).toBe(Date.parse(t(30)));
    // No confirmBy: the server refuses (too-early), so nothing is offered.
    expect(disputeOpensAt({ paidAt: t(0), confirmBy: null })).toBeNull();
    expect(disputeOpensAt({ paidAt: null, confirmBy: null })).toBeNull();
    expect(disputeOpensAt({ paidAt: null, confirmBy: t(5) })).toBe(Date.parse(t(5)));
  });

  it("the wide seller room's Chat goes to the chat beside it, never a second chat panel", async () => {
    setTradeChat(() => <input aria-label="Message" data-test-chat />);
    mount(props({ view: tradeView({ ...SECURED, role: 'seller' }), wide: true }), SellerWaiting);
    expect(document.querySelectorAll('[data-test-chat]')).toHaveLength(1);
    await click(byText('Chat', 'button'));
    expect(dialog()).toBeNull();
    expect(document.querySelectorAll('[data-test-chat]')).toHaveLength(1);
    expect(document.activeElement?.hasAttribute('data-test-chat')).toBe(true);
  });
});

describe('review round 2 (2026-10-28): fix round 3', () => {
  const paidButton = () => byText("I've paid", 'button') as HTMLButtonElement;
  const MISMATCH = "The trade's details on the server don't match what you agreed to.";
  const count = (s: string) => text().split(s).length - 1;

  it.each([
    ['view-mismatch', MISMATCH],
    ['amount-changed', "The trade's amount changed on the server after you paid."],
    ['attempts-exhausted', "Your device couldn't settle this trade."],
  ] as const)("I1: refusal %s with the totals agreeing leaves I've paid disabled, says why once, and posts nothing", async (refusal, sentence) => {
    mount(props({ view: tradeView(SECURED), escrow: fakeEscrow({ refusal }) }));
    expect(paidButton().disabled).toBe(true);
    expect(count(sentence)).toBe(1);
    await click(paidButton());
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('I1: wide too (only the maximum or the poster drifted, so the totals agree)', () => {
    mount(props({ view: tradeView(SECURED), escrow: fakeEscrow({ refusal: 'view-mismatch' }), wide: true }));
    expect(paidButton().disabled).toBe(true);
    expect(text()).toContain('$412.50');
    expect(count(MISMATCH)).toBe(1);
  });

  it('I1: the paid step itself (FinalAlert opens it) refuses on a refusal: no Yes, the reason instead', async () => {
    const view = buyerAlertView();
    render(
      <MemoryRouter>
        <FinalAlert code={view.code} view={view} escrow={fakeEscrow({ refusal: 'view-mismatch' })} refresh={async () => void calls.push('refresh')} serverClock={() => new Date(SERVER_NOW)} wide={false} />
      </MemoryRouter>,
    );
    await flush();
    calls = calls.filter((c) => !c.includes('final-alert-seen'));
    await click(byText("I've paid", 'button'));
    expect(dialog()!.textContent).toContain(MISMATCH);
    expect(maybe("Yes, mark as paid")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('I1: Finish is offered but refused while the view does not match, and says not to pay again', async () => {
    const escrow = fakeEscrow({ refusal: 'view-mismatch' });
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1) }), escrow }));
    const finish = byText('Finish marking as paid', 'button') as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(text()).toContain("Don't pay again.");
    expect(text()).not.toContain("Don't send any money");
    await click(finish);
    await flush();
    expect(calls).toEqual([]);
    expect(escrow.markPaid).not.toHaveBeenCalled();
  });

  it('I1: once recorded, a later view mismatch keeps "Marked as paid" (nothing to finish)', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1) }), escrow: fakeEscrow({ refusal: 'view-mismatch', paidRecorded: true }) }));
    expect(maybe('Finish marking as paid')).toBeUndefined();
    expect(document.querySelector('[data-part="paid-status"]')).not.toBeNull();
  });

  it('Minor 2: the same amount with another total will not clear: a final sentence, not "checking"', () => {
    const r = mount(props({ view: tradeView({ ...SECURED, fiatCents: '43313' }) }));
    expect(paidButton().disabled).toBe(true);
    const block = document.querySelector('[data-pay-block]')!;
    expect(block.getAttribute('data-pay-block')).toBe('total-wrong');
    expect(block.textContent).toBe("The trade's total on the server doesn't match your trade. Don't send any money. Ask in the chat, or open a dispute if it doesn't clear.");
    r.unmount();
    // Another amount: the device may still catch up, so "checking" stays.
    mount(props({ view: tradeView({ ...SECURED, fiatCents: '43313', amountAtomic: '1312500000000' }) }));
    expect(document.querySelector('[data-pay-block]')!.textContent).toContain('Your device is checking the new total.');
  });

  it('Minor 1: the refund intent is saved and waits for the coins to unlock: no Try again', () => {
    const settling = (kind: 'buyer-cancel' | 'mutual-cancel') => tradeView({ ...SECURED, state: 'settling', settling: kind });
    const r = mount(props({ view: settling('buyer-cancel'), escrow: fakeEscrow({ phase: 'ready', intentKind: 'buyer-cancel' }) }), BuyerCancelling);
    expect(maybe('Try again')).toBeUndefined();
    expect(maybe('Returning the XMR…')).toBeDefined();
    r.unmount();
    // A saved intent of another kind is not this refund: Try again is offered.
    mount(props({ view: settling('mutual-cancel'), escrow: fakeEscrow({ phase: 'ready', intentKind: 'buyer-cancel' }) }), BuyerCancelling);
    expect(maybe('Try again')).toBeDefined();
  });

  it('Minor 3: with no chat installed, the wide seller room disables Chat and says why', async () => {
    mount(props({ view: tradeView({ ...SECURED, role: 'seller' }), wide: true }), SellerWaiting);
    const chat = byText('Chat', 'button') as HTMLButtonElement;
    expect(chat.disabled).toBe(true);
    expect(document.getElementById(chat.getAttribute('aria-describedby')!)?.textContent).toBe("Chat isn't available here yet.");
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
  });
});
