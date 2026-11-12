// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuyerCancelling, BuyerPay, SellerWaiting, TASK23_SLOTS } from '../src/screens/trade/BuyerPay.js';
import { confirmWindow, disputeOpensAt, NUDGE_AGAIN_MS } from '../src/screens/trade/PaidWaiting.js';
import { GIFT_CARD_WARNING, setProofSource, setTradeChat, setPaymentDetailsSource } from '../src/screens/trade/paySeams.js';
import type { TradeEscrow, TradeScreenProps, TradeView } from '../src/screens/trade/payTypes.js';
import { render } from './render.js';
import { resetWarned } from '../src/screens/trade/warned.js';
import { resetConfirmSkips, setConfirmUser } from '../src/screens/trade/confirmSkip.js';

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
    confirmWindowMin: 120,
    settleBy: null,
    releaseClaimedAt: null,
    pausedAt: null,
    closedAt: null,
    cancelConfirmedAt: null,
    cancelConfirmableAt: null,
    sellerNudgedAt: null,
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
    paymentInstructions: null,
    instructionsMismatch: false,
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
  it('securing: the amber chip, "3 of 10 · about 14 min", the unstarted 90 min, the payment details locked and I\'ve paid closed (owner Q12)', async () => {
    const asked = vi.fn((_code: string, on: (d: { label: string; value: string }[] | null) => void) => {
      on([{ label: 'Zelle to', value: '[SELLER ZELLE ID]' }]);
      return () => undefined;
    });
    setPaymentDetailsSource(asked);
    mount(props());
    const t = text();
    expect(t).toContain('Buying from satoshi_ghost');
    expect(t).toContain(`Trade ${CODE} · Zelle`);
    expect(t).toContain('Securing escrow');
    expect(t).toContain('3 of 10 · about 14 min');
    expect(t).toContain('90 min');
    expect(t).toContain('Clock starts when escrow settles, in 14 min');
    // No seller details, no sum to send, until the escrow is secured: they are not even asked for.
    expect(asked).not.toHaveBeenCalled();
    expect(t).not.toContain('[SELLER ZELLE ID]');
    expect(t).not.toContain('Send exactly');
    expect(t).not.toContain('$412.50');
    expect(t).toContain('Payment details');
    expect(t).toContain('They appear when the escrow is secured, in about 14 min.');
    // The board's padlock tile beside the title.
    expect(document.querySelector('[data-locked] [data-lock-tile] svg')).not.toBeNull();
    // The board's locked card keeps the own-name warning (not a payment detail).
    expect(document.querySelector('[data-locked]')!.textContent).toContain('Pay from an account in your own name.');
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
    const paid = byText("I've paid", 'button') as HTMLButtonElement;
    expect(paid.hasAttribute('data-primary')).toBe(true);
    expect(paid.disabled).toBe(true);
    // The reason is the button's muted caption (board: aria-describedby="pay-when"), not a red notice.
    const why = document.querySelector<HTMLElement>('[data-pay-block="not-secured"]')!;
    expect(why.textContent).toBe('Opens once the escrow is secured.');
    expect(why.classList.contains('x2f-room__error')).toBe(false);
    expect(why.classList.contains('x2f-pay__caption')).toBe(true);
    expect(paid.getAttribute('aria-describedby')).toBe(why.id);
    expect(document.querySelectorAll('[data-pay-block]')).toHaveLength(1);
    await click(paid);
    expect(dialog()).toBeNull();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3');
  });

  it('shows "Releasable in N min" at 10 confirmations before the coins unlock (P3-I4), and still no details or I\'ve paid', () => {
    mount(props({ view: tradeView({ confirmations: 10, releasableEtaMin: 2 }) }));
    expect(text()).toContain('Releasable in 2 min');
    expect(text()).not.toContain('Securing escrow');
    expect(text()).not.toContain('[SELLER ZELLE ID]');
    expect(text()).toContain('They appear when the escrow is secured, in about 2 min.');
    expect((byText("I've paid", 'button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('secured: the teal chip, the countdown to payBy from the server clock, the payment details and I\'ve paid open', () => {
    mount(props({ view: tradeView(SECURED) }));
    const t = text();
    expect(t).toContain('Escrow secured');
    expect(document.querySelector('[role="timer"]')?.textContent).toBe('1 h 2 min');
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
    expect(t).toContain('$412.50 USD');
    expect(t).toContain('[SELLER ZELLE ID]');
    expect(t).toContain("Pay from an account in your own name. Payments from someone else's account may be rejected or frozen. Use at your own risk.");
    expect(t).not.toContain('They appear when the escrow is secured');
    expect((byText("I've paid", 'button') as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('[data-pay-block]')).toBeNull();
  });

  it("paid: the payment details the buyer paid stay on the page, never the locked card (review 2026-11-07, 1)", async () => {
    for (const wide of [false, true]) {
      const r = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }), wide }));
      // The BuyerPaidWaiting board folds them under "Your payment" (design review P2-16): one tap shows them.
      await click(document.querySelector<HTMLElement>('[data-part="paid-payment-toggle"]')!);
      const t = text();
      expect(t).toContain('[SELLER ZELLE ID]');
      expect(t).not.toContain('They appear when the escrow is secured');
      expect(document.querySelector('[data-locked]')).toBeNull();
      r.unmount();
    }
  });

  it('the counterparty is shown by its public display name, in data-username', () => {
    mount(props({ view: tradeView({ counterparty: { ...tradeView().counterparty, displayName: 'Satoshi.Ghost' } }) }));
    const names = [...document.querySelectorAll('[data-username]')].map((e) => e.textContent);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(['Satoshi.Ghost']));
  });

  it('a gift-card method shows the one bold warning', () => {
    mount(props({ view: tradeView({ ...SECURED, profile: { ...ZELLE, name: 'Amazon gift card', giftCard: true } }) }));
    expect([...document.querySelectorAll('strong')].map((s) => s.textContent)).toContain(GIFT_CARD_WARNING);
    // J-17 (G50, G52): the buyer sends the card; the evidence they keep, the video a range card's.
    expect([...document.querySelectorAll('[data-part="gift-card-evidence"] [data-evidence]')].map((e) => e.getAttribute('data-evidence'))).toEqual([
      'receipt',
      'card-photo',
      'login-video',
    ]);
  });

  it('no gift-card evidence on any other method', () => {
    mount(props({ view: tradeView(SECURED) }));
    expect(document.querySelector('[data-part="gift-card-evidence"]')).toBeNull();
  });
});

describe('"Do not show me this warning again" on I\'ve paid (owner 8 Nov p7-2; per user, on this device)', () => {
  afterEach(() => resetConfirmSkips());
  const dontShow = 'Do not show me this warning again';

  it('the confirm offers the tick, unticked; ticked with Yes, the next I\'ve paid for this user marks paid at once', async () => {
    setConfirmUser('mira.k');
    answer = () => ({ status: 200, json: tradeView({ ...SECURED, state: 'paid', paidAt: at(0) }) });
    const r = mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    const box = byText(dontShow, 'label').querySelector('input')!;
    expect(box.checked).toBe(false);
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText(dontShow, 'label'));
    await click(byText('Yes, mark as paid', 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'escrow:markPaid(41250)', 'refresh']);
    r.unmount();
    expect(window.localStorage.getItem('x2f.noconfirm.paid.mira.k')).toBe('1');

    calls = [];
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await flush();
    expect(dialog()).toBeNull();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'escrow:markPaid(41250)', 'refresh']);
  });

  it('another user on the same device, or no known user, still gets the confirm; Yes without the tick remembers nothing', async () => {
    window.localStorage.setItem('x2f.noconfirm.paid.mira.k', '1');
    for (const who of ['kettle.moss', null]) {
      setConfirmUser(who);
      const r = mount(props({ view: tradeView(SECURED) }));
      await click(byText("I've paid", 'button'));
      expect(dialog()!.textContent).toContain('Mark this trade as paid?');
      expect(calls).toEqual([]);
      r.unmount();
    }
    setConfirmUser('kettle.moss');
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await click(byText(`I sent exactly $412.50 by Zelle with the memo ${CODE}.`, 'label'));
    await click(byText('Yes, mark as paid', 'button'));
    await flush();
    expect(window.localStorage.getItem('x2f.noconfirm.paid.kettle.moss')).toBeNull();
  });

  it('skipped, a trade that grew meanwhile (409 total-changed) still asks, with the new total', async () => {
    setConfirmUser('mira.k');
    window.localStorage.setItem('x2f.noconfirm.paid.mira.k', '1');
    answer = () => ({ status: 409, json: { error: 'total-changed' } });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await flush();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'refresh']);
    expect(dialog()!.textContent).toContain('Mark this trade as paid?');
  });
});

// Build spec j31a section 4 (T-079; owner's words kept, docs/to-lead.md 9 Nov): I've paid with no
// proof attached asks first, every time. The proof slot is Plan 5's: until it can hold a proof
// (setProofSource), there is nothing to warn about and I've paid goes straight to the confirm sheet.
describe("I've paid with no proof attached (T-079)", () => {
  afterEach(() => setProofSource(null));

  it('asks "Mark paid without proof?" first, in the owner\'s words; Add proof closes it and sends nothing', async () => {
    setProofSource(() => 'none');
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Mark paid without proof?');
    expect(dialog()!.textContent).toContain(
      "You haven't added a payment screenshot. If this trade ever goes to a dispute, proof is usually what decides which side wins. It's your choice.",
    );
    expect(dialog()!.textContent).not.toContain('Mark this trade as paid?');
    // No "don't show again": it shows whenever proof is missing.
    expect(dialog()!.querySelector('input[type="checkbox"]')).toBeNull();
    await click(byText('Add proof', 'button'));
    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
    await click(byText("I've paid", 'button'));
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Mark paid without proof?');
  });

  it('"Do not show me this warning again" never skips the no-proof ask: the sheet shows and nothing is sent; its answer then marks paid at once (lead, batch 4)', async () => {
    setConfirmUser('mira.k');
    window.localStorage.setItem('x2f.noconfirm.paid.mira.k', '1');
    setProofSource(() => 'none');
    answer = () => ({ status: 200, json: tradeView({ ...SECURED, state: 'paid', paidAt: at(0) }) });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await flush();
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Mark paid without proof?');
    expect(calls).toEqual([]);
    await click(byText('Mark paid without proof', 'button'));
    await flush();
    expect(dialog()).toBeNull();
    expect(calls).toEqual([`POST /v1/trades/${CODE}/events {"type":"mark-paid","fiatCents":"41250"}`, 'escrow:markPaid(41250)', 'refresh']);
    resetConfirmSkips();
  });

  it('"Mark paid without proof" goes on to the confirm sheet, which still asks', async () => {
    setProofSource(() => 'none');
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    await click(byText('Mark paid without proof', 'button'));
    expect(dialog()!.textContent).toContain('Mark this trade as paid?');
    expect(calls).toEqual([]);
  });

  it('with a proof attached, or no proof slot yet, I\'ve paid opens the confirm sheet straight away', async () => {
    setProofSource(() => 'attached');
    const a = mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    expect(dialog()!.textContent).toContain('Mark this trade as paid?');
    a.unmount();
    setProofSource(null);
    mount(props({ view: tradeView(SECURED) }));
    await click(byText("I've paid", 'button'));
    expect(dialog()!.textContent).toContain('Mark this trade as paid?');
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
    // The board's caution hero (design review P1-3): the tinted chip and the key mark, the lead with
    // no heading of its own (the page's h1 is the header's "Buying from …"), then the timer inside.
    expect(status.className).toBe('x2f-hero');
    expect(status.getAttribute('data-tone')).toBe('caution');
    expect(status.querySelector('h1, h2')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Buying from satoshi_ghost');
    const chip = status.querySelector('.x2f-chip')!;
    expect([chip.textContent, chip.getAttribute('data-tone'), chip.getAttribute('data-look')]).toEqual(['Paid', 'caution', 'tint']);
    expect(status.querySelector('[data-part="key-mark"]')?.querySelectorAll('circle')).toHaveLength(3);
    expect(status.querySelector('[data-part="confirm-timer"]')?.hasAttribute('data-inset')).toBe(true);
    expect(status.querySelector('.x2f-hero__rule')).not.toBeNull();
    // "2 h" as a Duration, never "2 hours" in words (design review P1-4).
    const lead = document.getElementById(status.getAttribute('aria-labelledby')!)!;
    expect(lead.textContent).toMatch(/^You marked this trade as paid at \d+ \w{3} \d{4}, \d\d:\d\d UTC\. satoshi_ghost has been told and has up to 2 h to check Zelle and release\.$/);
    expect(lead.querySelector('.x2f-duration__n')?.textContent).toBe('2');
    expect(status.textContent).not.toMatch(/hours?\b/);
    expect(status.querySelector('.x2f-timer__hint')?.textContent).toMatch(/^Zelle gets 2 h · ends /);
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

describe("the pay warning is superseded by owner Q12 (board Warn-IvePaid): it never opens", () => {
  const fresh = () => {
    resetWarned();
    window.localStorage.clear();
  };
  const alert = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');

  it('not with the screen while the escrow still confirms: I\'ve paid is closed instead', () => {
    fresh();
    mount(props());
    expect(alert()).toBeNull();
    expect(text()).not.toContain('Before you pay');
  });

  it("not in front of the sheet once secured, even never warned, even with new coins still confirming: I've paid goes straight to the confirm sheet", async () => {
    for (const releasable of [true, false]) {
      fresh();
      const r = mount(props({ view: tradeView({ ...SECURED, releasable }) }));
      expect(alert()).toBeNull();
      await click(byText("I've paid", 'button'));
      expect(alert()).toBeNull();
      expect(dialog()!.textContent).toContain('Mark this trade as paid?');
      r.unmount();
    }
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

describe('buyer cancel (spec 2.3; owner G56, g67)', () => {
  /** The "Cancelling is final" sheet's own buttons (the quiet Cancel trade on the screen is outside it). */
  const sheet = () => document.body.querySelector<HTMLElement>('[data-sheet="cancel-final"]');
  const inSheet = (label: string) => [...(sheet()?.querySelectorAll<HTMLElement>('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label)!;

  it('Cancel trade opens "Cancelling is likely final" first and sends nothing; Keep trading closes it (T-049)', async () => {
    mount(props({ view: tradeView(SECURED) }));
    expect(sheet()).toBeNull();
    await click(byText('Cancel trade', 'button'));
    expect(sheet()).not.toBeNull();
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Cancelling is likely final');
    expect(sheet()!.textContent).toContain(
      "The 1.250000 XMR in escrow is returned and this trade closes. Be sure before you cancel. Don't send any money after you cancel. Already paid? Don't cancel: tap I've paid instead.",
    );
    // T-049 (owner p5-2): the body never names the seller. Design final call 10 Nov: with the escrow
    // held this is the escrow-held version, never the unfunded line (TradeFund's, tradeFund.test.tsx).
    expect(sheet()!.textContent).not.toContain('satoshi_ghost');
    expect(sheet()!.textContent).not.toContain('Nothing is in escrow yet');
    expect(sheet()!.querySelector('[data-username]')).toBeNull();
    // The board's emphasis: the amount in mono, XMR and "I've paid" in 600.
    expect(sheet()!.querySelector('.x2f-mono')?.textContent).toBe('1.250000');
    expect([...sheet()!.querySelectorAll('strong')].map((b) => b.textContent)).toEqual(['XMR', "I've paid"]);
    // The safe action has focus; the warning describes the dialog.
    expect(document.activeElement?.textContent).toBe('Keep trading');
    expect(document.getElementById(dialog()!.getAttribute('aria-describedby')!)?.textContent).toContain("Don't send any money after you cancel.");
    expect(calls).toEqual([]);
    await click(inSheet('Keep trading'));
    expect(sheet()).toBeNull();
    expect(calls).toEqual([]);
  });

  it("names what the escrow holds, the poster's fee included (lead, batch 4: trade-copy's J-31 build spec, T-049, over the 8 Nov proto-review P2 reading; design confirming)", async () => {
    // The seller posted, so the escrow holds 1.25 + 0.0125 XMR: the sheet says 1.262500 is returned.
    mount(props({ view: tradeView({ ...SECURED, receivedAtomic: '1262500000000', fee: { atomic: '12500000000' } }) }));
    await click(byText('Cancel trade', 'button'));
    expect(sheet()!.textContent).toContain('The 1.262500 XMR in escrow is returned');
    expect(sheet()!.textContent).not.toContain('1.250000');
  });

  it('before "I\'ve paid", the sheet\'s Cancel trade re-reads the trade, posts buyer-cancel and then starts the refund (trade.cancel)', async () => {
    answer = (b) => ({ status: 200, json: b.type ? tradeView({ state: 'settling', settling: 'buyer-cancel' }) : tradeView(SECURED) });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText('Cancel trade', 'button'));
    await click(inSheet('Cancel trade'));
    await flush();
    expect(dialog()).toBeNull();
    expect(calls).toEqual([`GET /v1/trades/${CODE}`, `POST /v1/trades/${CODE}/events {"type":"buyer-cancel"}`, 'escrow:buyerCancel', 'refresh']);
  });

  it('while the escrow still confirms (securing) the buyer may cancel too, through the same sheet', async () => {
    mount(props());
    await click(byText('Cancel trade', 'button'));
    expect(sheet()).not.toBeNull();
  });

  it("a cancel on a stale view: the fresh trade is paid (another tab), so nothing is cancelled and the room re-reads (review Minor 4; Revision 2026-10-29b)", async () => {
    answer = () => ({ status: 200, json: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1) }) });
    mount(props({ view: tradeView(SECURED) }));
    await click(byText('Cancel trade', 'button'));
    await click(inSheet('Cancel trade'));
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

  it("offers no cancel of any kind while waiting: no cancel-alone control and no Propose cancel (design proto review P2, 8 Nov)", async () => {
    for (const wide of [false, true]) {
      for (const state of ['secured', 'securing', 'paid'] as const) {
        const r = mount(props({ view: seller({ state }), wide }), SellerWaiting);
        expect(text()).toContain('Waiting for mira.k to pay');
        expect(maybe('Cancel trade')).toBeUndefined();
        expect(maybe('Cancel & get refund')).toBeUndefined();
        expect(maybe('Propose cancel')).toBeUndefined();
        expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
        r.unmount();
      }
    }
  });

  it('a proposal that already stands (made before this change) can still be withdrawn', async () => {
    mount(props({ view: seller({ cancelProposedBy: 'seller' }) }), SellerWaiting);
    expect(text()).toContain('You proposed cancelling. Waiting for mira.k.');
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

describe("no dispute for the buyer before I've paid (design proto review P1, 8 Nov)", () => {
  it('securing and secured offer no Open dispute at all (the machine refuses it: too-early)', () => {
    for (const view of [tradeView(), tradeView(SECURED)]) {
      const r = mount(props({ view }));
      expect(maybe('Open dispute')).toBeUndefined();
      expect(document.querySelector('a[href$="/dispute"]')).toBeNull();
      expect(maybe('Cancel trade')).toBeDefined();
      r.unmount();
    }
  });

  it('a 24 h wait shows its UTC date', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(1439), confirmWindowMin: 1440 }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const locked = document.querySelector<HTMLElement>('[data-part="paid-dispute"]')!;
    expect(document.getElementById(locked.getAttribute('aria-describedby')!)!.textContent).toMatch(/^Available from 26 Oct 2026, 11:59 UTC · in /);
  });
});

describe('after the time to pay (design proto review P1; owner 8 Nov p6-1: not a hard end)', () => {
  const over = { ...SECURED, securedAt: at(-91), payBy: at(-1) };

  it("keeps I've paid and the payment details, and says the seller may now cancel at any moment", () => {
    for (const wide of [false, true]) {
      const r = mount(props({ view: tradeView(over), wide }));
      const paid = byText("I've paid", 'button') as HTMLButtonElement;
      expect(paid.disabled).toBe(false);
      expect(text()).toContain('Send exactly');
      expect(text()).toContain('[SELLER ZELLE ID]');
      const note = document.querySelector<HTMLElement>('[data-pay-over]');
      expect(note?.textContent).toBe("The time to pay is over. satoshi_ghost may now cancel this trade at any moment. If you've sent the money, tap I've paid now.");
      expect(note?.getAttribute('role')).toBe('status');
      if (!wide) expect(document.querySelector('[aria-label="Payment timer"]')?.textContent).toContain('Time to pay is over');
      r.unmount();
    }
  });

  it('says nothing of it before payBy, or while maintenance has the clock paused', () => {
    const r = mount(props({ view: tradeView(SECURED) }));
    expect(document.querySelector('[data-pay-over]')).toBeNull();
    r.unmount();
    mount(props({ view: tradeView({ ...over, pausedAt: at(-2) }) }));
    expect(document.querySelector('[data-pay-over]')).toBeNull();
  });

  it('appears by itself when payBy passes on screen', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let now = T0;
      mount(props({ view: tradeView({ ...SECURED, payBy: at(0.25) }), serverClock: () => new Date(now) }));
      expect(document.querySelector('[data-pay-over]')).toBeNull();
      now = T0 + 30_000;
      await act(async () => {
        vi.advanceTimersByTime(16_000);
      });
      expect(document.querySelector('[data-pay-over]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it("in paid, Open dispute waits for confirmBy, the method's window (owner p9-4, F9: 90 min for Zelle; design review P1-1)", () => {
    // 89 min after I've paid: locked, with the board's "Available from 15:35 UTC · in 1 min".
    const r = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-89), confirmBy: at(1), confirmWindowMin: 90 }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(document.querySelector('a[href$="/dispute"]')).toBeNull();
    const waiting = document.querySelector<HTMLButtonElement>('[data-part="paid-dispute"]')!;
    expect(waiting.tagName).toBe('BUTTON');
    // aria-disabled, so it keeps focus and its "Available from" (review N4).
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
    // The time alone on the same day and no full stop (design review P2-11); "in 1 min" keeps its space (review 39).
    expect(document.getElementById(waiting.getAttribute('aria-describedby')!)?.textContent).toMatch(/^Available from \d\d:\d\d UTC · in 1 min$/);
    expect(document.querySelector('[data-part="paid-status"] .x2f-chip')?.textContent).toBe('Paid');
    r.unmount();
    // The window ended: the outlined button, no soft link (one window for both sides, p9-4).
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-91), confirmBy: at(-1), confirmWindowMin: 90 }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const open = document.querySelector('[data-part="paid-dispute"]')!;
    expect(open.tagName).toBe('A');
    expect(open.className).toBe('x2f-button x2f-button--danger-outline');
    expect(open.textContent).toBe('Open dispute');
    expect(open.getAttribute('href')).toBe(`/trade/${CODE}/dispute`);
    expect(document.querySelector('.x2f-paid-soft-dispute')).toBeNull();
    expect(document.getElementById('paid-dispute-when')).toBeNull();
    // Ended: the same caution hero; the chip says so and the lead gives the window in its own unit.
    const ended = document.querySelector('[data-part="paid-status"]')!;
    expect(ended.getAttribute('data-tone')).toBe('caution');
    expect(ended.querySelector('.x2f-chip')?.textContent).toBe('Paid · not confirmed in time');
    expect(ended.querySelector('.x2f-hero__lead')?.textContent).toMatch(/^Their 90 min to check Zelle ended at .+ UTC\. The XMR is still safe in escrow\. You can open a dispute now/);
    // No arc once the time is up, only the track.
    expect(ended.querySelectorAll('.x2f-timer__ring circle')).toHaveLength(1);
  });

  it('maintenance after the window ended: no dispute is offered, the machine refuses it (owner G19; lead review 2026-11-08 R-m2)', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-100), confirmBy: at(-10), confirmWindowMin: 90, pausedAt: at(-5) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(document.querySelector('a[href$="/dispute"]')).toBeNull();
    const locked = document.querySelector<HTMLElement>('[data-part="paid-dispute"]')!;
    expect([locked.tagName, locked.getAttribute('aria-disabled')]).toEqual(['BUTTON', 'true']);
    expect(document.getElementById(locked.getAttribute('aria-describedby')!)?.textContent).toBe('Available after the maintenance');
    expect(document.querySelector('[data-part="paid-status"] .x2f-hero__lead')?.textContent).toContain('You can open a dispute once the maintenance is over');
    expect(text()).not.toContain('You can open a dispute now');
  });

  it('the wide room once the window ended: the outlined dispute on the right of the row, no "Available from" line', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-92), confirmBy: at(-2), confirmWindowMin: 90 }), escrow: fakeEscrow({ paidRecorded: true }), wide: true }));
    const row = document.querySelector('.x2f-paid-actions__row')!;
    expect([...row.children].map((c) => c.getAttribute('data-part') ?? c.className)).toEqual(['nudge', 'x2f-room__spacer', 'paid-dispute']);
    expect(row.querySelector('[data-part="paid-dispute"]')?.className).toBe('x2f-button x2f-button--danger-outline');
    expect(document.getElementById('paid-dispute-when')).toBeNull();
  });

  it("disputeOpensAt is the server's confirmBy (owner p9-4; maintenance moves it, Q10), and nothing without it", () => {
    const t = (min: number) => new Date(Date.UTC(2026, 10, 6, 15, 0) + min * 60_000).toISOString();
    expect(disputeOpensAt({ confirmBy: t(90) })).toBe(Date.parse(t(90)));
    expect(disputeOpensAt({ confirmBy: null })).toBeNull();
    expect(disputeOpensAt({ confirmBy: 'not a time' })).toBeNull();
  });

  it("the window's length is the trade's own, never confirmBy − paidAt stretched by a maintenance (lead review 2026-11-08 R-m1)", () => {
    // Paid 100 min ago, a 40-minute maintenance moved confirmBy from -10 to +30.
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-100), confirmBy: at(30), confirmWindowMin: 90 }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const status = document.querySelector('[data-part="paid-status"]')!;
    expect(status.querySelector('.x2f-timer__hint')?.textContent).toMatch(/^Zelle gets 90 min · ends /);
    expect(status.querySelector('.x2f-hero__lead')?.textContent).toContain('has up to 90 min to check Zelle');
    expect(confirmWindow({ confirmBy: at(30), confirmWindowMin: 90 }, T0)?.lengthMs).toBe(90 * 60_000);
  });

  it("What happens next's step 3 is the board's: the time the dispute opens and the trade's own wait (design review P1-2)", () => {
    const step = () => document.querySelector('[data-part="paid-next-dispute"]')!;
    // Zelle: 90 min, said as the board's "90 min" (never "1 h 30 min"), the number in mono.
    const r = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(89), confirmWindowMin: 90 }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(step().textContent).toMatch(/^If something goes wrong, you can open a dispute from \d\d:\d\d UTC, 90 min after you marked it as paid\. A moderator checks the chat and proof, then decides\.$/);
    expect(step().querySelector('time')?.getAttribute('dateTime')).toBe(at(89));
    expect(step().querySelector('.x2f-duration__n')?.textContent).toBe('90');
    expect(step().textContent).not.toContain('confirm by');
    r.unmount();
    // A bank transfer's 3-day wait: the date as well, and "3 d".
    const r2 = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmWindowMin: 3 * 1440, confirmBy: at(3 * 1440 - 1) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(step().textContent).toMatch(/you can open a dispute from \d{1,2} \w{3} \d{4}, \d\d:\d\d UTC, 3 d after you marked it as paid\./);
    r2.unmount();
    // A maintenance during the window moved the server's time later (owner Q10).
    const r3 = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-100), confirmBy: at(30), confirmWindowMin: 90 }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(step().textContent).toContain('90 min after you marked it as paid, plus the time trading was paused.');
    r3.unmount();
    // Paused now: no time, since it moves.
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-40), confirmBy: at(50), confirmWindowMin: 90, pausedAt: at(-30) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(step().textContent).toMatch(/^If something goes wrong, you can open a dispute 90 min after you marked it as paid, not counting the maintenance\./);
    expect(step().querySelector('time')).toBeNull();
  });

  // Lead review 2026-11-06 I1: the co-sign runs in the open page (Released.tsx), not by itself.
  it('What happens next says the XMR goes to the wallet once the app co-signs, and to keep the page open', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const next = document.querySelector('[data-part="paid-next"]')!.textContent ?? '';
    expect(next).toContain('When they release, 1.250000 XMR goes to your wallet once your app co-signs. Keep this page open until it arrives.');
    expect(next).not.toContain('by itself');
    // Standard 7 (design review P1-6): the digits in mono, the unit apart at 600 in monero-ink.
    const amount = document.querySelector('[data-part="paid-next"] .x2f-xmr')!;
    expect(amount.querySelector('.x2f-num')?.textContent).toBe('1.250000');
    expect(amount.querySelector('.x2f-xmr__unit')?.textContent).toBe('XMR');
    expect(amount.closest('.x2f-when')).toBeNull();
  });

  // Lead review 2026-11-08 R-I1: the amount this device accepted, less the fee for a poster buyer (p10-1).
  it("a poster buyer's payout is the device's amount less the 1% fee, never the API's amount", async () => {
    const view = tradeView({ ...SECURED, poster: 'buyer', fee: { atomic: '12500000000' }, amountAtomic: '9990000000000', state: 'paid', paidAt: at(-1), confirmBy: at(119) });
    const r = mount(props({ view, escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(document.querySelector('[data-part="paid-next"]')!.textContent).toContain('When they release, 1.237500 XMR goes to your wallet');
    expect(text()).not.toContain('9.990000');
    await click(document.querySelector<HTMLElement>('[data-part="paid-payment-toggle"]')!);
    const rows = [...document.querySelectorAll('[data-part="paid-payment"] dl > div')].map((d) => [d.querySelector('dt')!.textContent, d.querySelector('dd')!.textContent]);
    expect(rows).toContainEqual(['For', '1.237500 XMR']);
    r.unmount();
    // No device amount: no amount at all, and no For row.
    mount(props({ view, escrow: fakeEscrow({ paidRecorded: true, amountAtomic: null, fiatCents: null }) }));
    expect(document.querySelector('[data-part="paid-next"]')!.textContent).toContain('When they release, the XMR goes to your wallet');
    await click(document.querySelector<HTMLElement>('[data-part="paid-payment-toggle"]')!);
    expect([...document.querySelectorAll('[data-part="paid-payment"] dt')].map((d) => d.textContent)).not.toContain('For');
  });

  // Owner Q10 (6 Nov 2026): the clock pauses in maintenance. Lead review m2.
  it('paused for maintenance: the confirm timer and the dispute wait stop at the pause and say why', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-40), confirmBy: at(80), pausedAt: at(-30) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    // 110 min were left at the pause (80 now + the 30 paused), not 80.
    expect(document.querySelector('[data-part="confirm-timer"] [role="timer"]')?.textContent).toBe('1 h 50 min');
    expect(document.querySelector('[data-part="confirm-timer"]')!.textContent).toContain('Trading is paused for maintenance.');
    const waiting = document.querySelector<HTMLButtonElement>('[data-part="paid-dispute"]')!;
    expect(waiting.tagName).toBe('BUTTON');
    const when = document.getElementById(waiting.getAttribute('aria-describedby')!)!.textContent ?? '';
    // The dispute opens at confirmBy, which froze at the pause too: 110 min were left then.
    expect(when).toMatch(/^Available after the maintenance · in 1 h 50 min$/);
  });

  it('the phone footer (design review P2-11, P2-13): the dispute first at 56 px, then an ink Nudge with only its bell in caution', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const footer = document.querySelector('footer')!;
    const parts = [...footer.querySelectorAll('[data-part="paid-dispute"], [data-part="nudge"]')].map((e) => e.getAttribute('data-part'));
    expect(parts).toEqual(['paid-dispute', 'nudge']);
    expect(footer.querySelector('[data-part="paid-dispute"]')?.getAttribute('data-size')).toBe('large');
    const nudge = footer.querySelector('[data-part="nudge"]')!;
    expect(nudge.hasAttribute('data-tone')).toBe(false);
    expect(nudge.className).toBe('x2f-button x2f-button--secondary');
  });

  it('the open dispute on the phone is the 56 px danger outline, not the medium size', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-121), confirmBy: at(-1) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    const open = document.querySelector('[data-part="paid-dispute"]')!;
    expect(open.className).toBe('x2f-button x2f-button--danger-outline');
    expect(open.hasAttribute('data-size')).toBe(false);
  });

  it('Trade progress (design review P2-9): four bars, Seller checks current with the window share filled in caution', () => {
    for (const wide of [false, true]) {
      const r = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-30), confirmBy: at(90) }), escrow: fakeEscrow({ paidRecorded: true }), wide }));
      const steps = [...document.querySelectorAll('[data-part="paid-progress"] > li')];
      expect(document.querySelector('[data-part="paid-progress"]')?.getAttribute('aria-label')).toBe('Trade progress');
      expect(steps.map((li) => [li.textContent, li.getAttribute('data-status')])).toEqual([
        ['Escrow', 'done'],
        ['You pay', 'done'],
        ['Seller checks', 'current'],
        ['Released', 'todo'],
      ]);
      expect(steps[2]!.getAttribute('aria-current')).toBe('step');
      expect((steps[2]!.querySelector('.x2f-paid-progress__fill') as HTMLElement).style.getPropertyValue('--x2f-fill')).toBe('25%');
      r.unmount();
    }
  });

  it('the wide room in the Wide board\'s order (design review P2-10): hero, the actions row, What happens next, Your payment', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }), wide: true }));
    const order = [...document.querySelectorAll('[data-part="paid-progress"], [data-part="paid-status"], [data-part="paid-actions"], [data-part="paid-next"], [data-part="paid-payment"]')].map((e) => e.getAttribute('data-part'));
    expect(order).toEqual(['paid-progress', 'paid-status', 'paid-actions', 'paid-next', 'paid-payment']);
    expect(document.querySelector('.x2f-room__grid')).toBeNull();
    // Nudge left, the dispute right in one row; the hint right-aligned under it.
    const row = document.querySelector('.x2f-paid-actions__row')!;
    expect([...row.children].map((c) => c.getAttribute('data-part') ?? c.className)).toEqual(['nudge', 'x2f-room__spacer', 'paid-dispute']);
    expect(row.querySelector('[data-part="paid-dispute"]')?.hasAttribute('data-size')).toBe(false);
    expect(document.getElementById('paid-dispute-when')?.getAttribute('data-align')).toBe('end');
  });

  it('Your payment (design review P2-16, P2-17): on surface, the raised rows with Payment proof last, two columns on wide', async () => {
    for (const wide of [false, true]) {
      const r = mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }), wide }));
      const toggle = document.querySelector<HTMLElement>('[data-part="paid-payment-toggle"]')!;
      expect(toggle.closest('.x2f-disclosure')?.hasAttribute('data-outline')).toBe(false);
      await click(toggle);
      const dl = document.querySelector('[data-part="paid-payment"] dl')!;
      expect(dl.getAttribute('data-layout')).toBe('raised');
      expect(dl.getAttribute('data-columns')).toBe(wide ? '2' : null);
      const rows = [...dl.querySelectorAll(':scope > div')].map((d) => [d.querySelector('dt')!.textContent, d.querySelector('dd')!.textContent]);
      expect(rows.map(([k]) => k)).toEqual(['Sent to', 'Memo', 'For', 'Marked as paid', 'Payment proof']);
      expect(rows.at(-1)![1]).toBe('Add payment proof · optional');
      const memo = dl.querySelector(':scope > div dd')!;
      expect(memo.className).toBe('x2f-num');
      r.unmount();
    }
  });

  it('Nudge sent says when the next one can go: 15 min, the server\'s gap (owner F10, p6-1; lead review R-I2), the 15 in mono', async () => {
    answer = () => ({ status: 200, json: {} });
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    await click(document.querySelector<HTMLElement>('[data-part="nudge"]')!);
    await flush();
    const sent = document.querySelector('[data-part="nudge-sent"]')!;
    expect(sent.textContent).toBe('Nudge sent. You can send another in 15 min.');
    expect(sent.querySelector('.x2f-duration__n')?.textContent).toBe('15');
    expect(NUDGE_AGAIN_MS).toBe(15 * 60_000);
  });

  // Lead review m4: the tabletop glance shows the confirm timer, so the screen's copy hides there.
  it('the confirm timer is marked for the tabletop glance', () => {
    mount(props({ view: tradeView({ ...SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) }), escrow: fakeEscrow({ paidRecorded: true }) }));
    expect(document.querySelector('[data-part="confirm-timer"]')?.getAttribute('data-fold-glance')).toBe('timer');
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

describe("J-08 (S-090): the seller's packaged details fill the buyer's Send exactly card", () => {
  it('the rows are the labelled boxes of the newest package in the trade chat, in place of "Ask in the chat"', async () => {
    const { setChatClient } = await import('../src/chat/client.js');
    const { chatPaymentDetailsSource } = await import('../src/chat/payDetailsFeed.js');
    const CHAT = 'Q2W3-E4R5-T6Y7-U8I9';
    const pay = { v: 2 as const, method: 'ZELLE', fields: [{ key: 'email', value: 'jane@example.com' }, { key: 'name', value: 'Jane Doe' }] };
    const chatSnap = {
      phase: 'ready' as const,
      problem: null,
      role: 'buyer' as const,
      counterparty: 'satoshi_ghost',
      disputeOpen: false,
      paySecured: true,
      more: false,
      lines: [{ id: '3', from: 'seller' as const, text: 'Payment details\nEmail: jane@example.com\nName on the account: Jane Doe', pay, at: null, mine: false, gapBefore: false }],
    };
    const sync = vi.fn(async () => chatSnap);
    setChatClient({ sync, send: vi.fn(async () => chatSnap), sendPay: vi.fn(async () => chatSnap) });
    answer = () => ({ status: 200, json: { chat: CHAT } });
    setPaymentDetailsSource(chatPaymentDetailsSource);
    try {
      mount(props({ view: tradeView(SECURED) }));
      await flush();
      expect(calls).toContain(`POST /v1/trades/${CODE}/chat {}`);
      expect(sync).toHaveBeenCalledWith(CHAT);
      const card = document.querySelector('[aria-label="Send this payment"]')!;
      const rows = [...card.querySelectorAll('.x2f-pay-card__row')].map((r) => r.textContent);
      expect(rows.slice(0, 2)).toEqual(['Emailjane@example.com', 'Name on the accountJane Doe']);
      expect(card.textContent).not.toContain('Ask in the chat');
      // Nothing of the details went to the API: the only call was the chat lookup, with an empty body.
      expect(calls.filter((c) => c.startsWith('POST'))).toEqual([`POST /v1/trades/${CODE}/chat {}`]);
    } finally {
      setChatClient(null);
    }
  });
});
