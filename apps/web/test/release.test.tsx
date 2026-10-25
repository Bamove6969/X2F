// @vitest-environment happy-dom
// SellerConfirm and Released (Task 24): behaviour with a stubbed API and a stubbed escrow. Board
// parity, phone sizes and the real build are in e2e/release.spec.ts.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Released } from '../src/screens/trade/Released.js';
import { SellerConfirm } from '../src/screens/trade/SellerConfirm.js';
import { releaseScreenOf } from '../src/screens/trade/release/slots.js';
import type { ReleaseEscrow, ReleaseTrade } from '../src/screens/trade/release/view.js';
import { advance, pointer, render } from './render.js';

const ZELLE = { name: 'Zelle', whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.' };
const PROFILE = {
  id: 'ZELLE',
  whatItIs: ZELLE.whatItIs,
  landsIn: "your bank account, checked in your bank's app",
  checkPrompt: "Open your bank's app and check that the payment arrived in your account.",
  arrival: 'instant',
  confirmWindowMin: 120,
  fields: [],
};
const NOW = '2026-10-25T12:00:00.000Z';
const TX = 'ab'.repeat(32);

/** The board trade (K7M2-9QXA-4FTR-8WPN): satoshi_ghost sells 1.25 XMR to mira.k for $412.50 via Zelle. */
function trade(over: Partial<ReleaseTrade> = {}): ReleaseTrade {
  return {
    code: 'K7M2-9QXA-4FTR-8WPN',
    role: 'seller',
    poster: 'seller',
    state: 'paid',
    counterparty: { username: 'mira.k' },
    methodId: 'ZELLE',
    profile: PROFILE,
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    releasable: true,
    releasableEtaMin: 0,
    fee: { atomic: '12500000000' },
    settling: null,
    txHash: null,
    confirmBy: '2026-10-25T13:52:00.000Z',
    serverNow: NOW,
    ...over,
  };
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let answer: (c: Call) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  answer = () => ({ status: 200, body: {} });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const c = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const a = answer(c);
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};

function escrowStub(order: string[] = []): ReleaseEscrow & { release: ReturnType<typeof vi.fn> } {
  return { release: vi.fn(async () => void order.push('release()')) };
}

function sellerConfirm(t: ReleaseTrade, escrow = escrowStub(), onTrade = vi.fn()) {
  const r = render(
    <MemoryRouter>
      <SellerConfirm trade={t} method={ZELLE} escrow={escrow} onTrade={onTrade} />
    </MemoryRouter>,
  );
  const hold = () => r.host.querySelector<HTMLButtonElement>('button[data-primary]')!;
  const box = () => r.host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const text = () => (r.host.textContent ?? '').replace(/\s+/g, ' ');
  return { ...r, hold, box, text, escrow, onTrade };
}

describe('SellerConfirm', () => {
  it('shows the board copy from the profile, the method and the buyer, the name exactly as set', () => {
    const s = sellerConfirm(trade());
    expect(s.text()).toContain('Selling to mira.k');
    expect(s.text()).toContain('Trade K7M2-9QXA-4FTR-8WPN · Zelle');
    expect(s.text()).toContain('mira.k: Payment sent');
    expect(s.text()).toContain('1 h 52 min to confirm');
    expect(s.host.querySelector('h1')!.textContent).toBe('Check your bank account for $412.50 sent via Zelle');
    expect(s.text()).toContain("Open your bank's app and check that the payment arrived in your account.");
    expect(s.text()).toContain('Screenshots can be faked');
    expect(s.text()).toContain('I checked my bank account myself and the $412.50 from Zelle is there.');
    for (const el of s.host.querySelectorAll('[data-username]')) expect(el.textContent).toBe('mira.k');
    expect(s.host.querySelectorAll('[data-username]').length).toBeGreaterThanOrEqual(2);
    expect(s.host.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('keeps the release locked until the box is ticked', () => {
    const s = sellerConfirm(trade());
    expect(s.hold().disabled).toBe(true);
    expect(s.text()).toContain('Tick the box above to unlock this release button.');
    act(() => s.box().click());
    expect(s.hold().disabled).toBe(false);
    expect(s.text()).toContain('Press and hold for 1.5 seconds. Once released, the XMR can’t be taken back.');
    expect(s.hold().getAttribute('aria-label')).toBe('Press and hold for 1.5 seconds to release 1.250000 XMR to mira.k');
    expect(s.hold().textContent).toContain('Payment received');
    expect(s.hold().textContent).toContain('Hold to release 1.250000 XMR to mira.k');
  });

  it('keeps it locked with "Releasable in N min" while the escrow is not releasable, even when ticked', () => {
    const s = sellerConfirm(trade({ releasable: false, releasableEtaMin: 12 }));
    act(() => s.box().click());
    expect(s.hold().disabled).toBe(true);
    expect(s.hold().textContent).toContain('Releasable in 12 min');
  });

  it('on a full hold posts release-started, then calls release(), once', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    answer = (c) => {
      order.push(`${c.method} ${c.url} ${JSON.stringify(c.body)}`);
      return { status: 200, body: trade({ state: 'settling', settling: 'release' }) };
    };
    const s = sellerConfirm(trade(), escrowStub(order));
    act(() => s.box().click());
    pointer(s.hold(), 'pointerdown');
    advance(1499, vi);
    expect(calls).toHaveLength(0);
    advance(1, vi);
    await flush();
    expect(order).toEqual(['POST /v1/trades/K7M2-9QXA-4FTR-8WPN/events {"type":"release-started"}', 'release()']);
    expect(s.escrow.release).toHaveBeenCalledTimes(1);
    expect(s.onTrade).toHaveBeenCalledWith(expect.objectContaining({ state: 'settling' }));
  });

  it('an early let-go releases nothing', () => {
    vi.useFakeTimers();
    const s = sellerConfirm(trade());
    act(() => s.box().click());
    pointer(s.hold(), 'pointerdown');
    advance(1000, vi);
    pointer(s.hold(), 'pointerup');
    advance(2000, vi);
    expect(calls).toHaveLength(0);
    expect(s.escrow.release).not.toHaveBeenCalled();
  });

  it('when the API refuses release-started, does not sign, says so, and can be held again', async () => {
    vi.useFakeTimers();
    answer = () => ({ status: 409, body: { error: 'not-releasable' } });
    const s = sellerConfirm(trade());
    act(() => s.box().click());
    pointer(s.hold(), 'pointerdown');
    advance(1500, vi);
    await flush();
    expect(s.escrow.release).not.toHaveBeenCalled();
    expect(s.host.querySelector('[role=alert]')!.textContent).toBe('The release didn’t start. Try again.');
    expect(s.hold().disabled).toBe(false);
    pointer(s.hold(), 'pointerdown');
    advance(1500, vi);
    await flush();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('shows the released look while the release is being signed', () => {
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }));
    expect(s.hold().disabled).toBe(true);
    expect(s.hold().dataset.done).toBe('true');
    expect(s.hold().textContent).toContain('Released');
    expect(s.hold().textContent).toContain('1.250000 XMR is on its way to mira.k');
    expect(s.text()).toContain('Both signatures sent. mira.k will be asked to rate the trade.');
    expect(s.text()).not.toContain('Payment not received');
  });

  it('sends "Payment not received" and "Open dispute" to the dispute screen', () => {
    const s = sellerConfirm(trade());
    const links = [...s.host.querySelectorAll('a')].filter((a) => /Payment not received|Open dispute/.test(a.textContent ?? ''));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/trade/K7M2-9QXA-4FTR-8WPN/dispute', '/trade/K7M2-9QXA-4FTR-8WPN/dispute']);
  });

  it('falls back to plain wording when the method has no profile yet', () => {
    const s = sellerConfirm(trade({ profile: null }));
    expect(s.host.querySelector('h1')!.textContent).toBe('Check your account for $412.50 sent via Zelle');
    expect(s.text()).toContain('I checked my account myself and the $412.50 from Zelle is there.');
  });
});

function released(t: ReleaseTrade) {
  const r = render(
    <MemoryRouter>
      <Released trade={t} />
    </MemoryRouter>,
  );
  return { ...r, text: () => (r.host.textContent ?? '').replace(/\s+/g, ' ') };
}

const RELEASED = { state: 'released' as const, settling: null, txHash: TX };

describe('Released', () => {
  it('poster buyer: the board copy, the fee row above You receive, and the payout ending', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10, payoutEnd: 'Qwk3Fz' } });
    const r = released(trade({ ...RELEASED, role: 'buyer', poster: 'buyer', counterparty: { username: 'satoshi_ghost' } }));
    await flush();
    expect(r.host.querySelector('h1')!.textContent).toBe('1.237500 XMR is yours');
    expect(r.text()).toContain("Released by you and satoshi_ghost. It's on its way to your external wallet ending …Qwk3Fz.");
    const rows = [...r.host.querySelectorAll('dl > div')].map((d) => (d.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    expect(rows).toEqual(['Trade amount1.250000 XMR', 'X2F fee (1%, your ad)−0.012500 XMR', 'You receive1.237500 XMR']);
    expect(r.text()).toContain('1 of 10');
    expect(r.host.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('1');
    expect(calls.map((c) => c.url)).toEqual(['/v1/trades/K7M2-9QXA-4FTR-8WPN/confirmations']);
  });

  it('taker buyer: the whole amount and no fee anywhere', async () => {
    answer = () => ({ status: 200, body: { confirmations: 0, target: 10, payoutEnd: 'Qwk3Fz' } });
    const r = released(trade({ ...RELEASED, role: 'buyer', poster: 'seller', fee: undefined, counterparty: { username: 'satoshi_ghost' } }));
    await flush();
    expect(r.host.querySelector('h1')!.textContent).toBe('1.250000 XMR is yours');
    expect(r.host.querySelector('dl')).toBeNull();
    expect(r.text()).not.toMatch(/fee/i);
    expect(r.text()).toContain('0 of 10');
  });

  it('seller: the release is on its way to the buyer; a poster seller sees the fee they paid, a taker none', async () => {
    answer = () => ({ status: 200, body: { confirmations: 2, target: 10 } });
    const p = released(trade({ ...RELEASED }));
    await flush();
    expect(p.host.querySelector('h1')!.textContent).toBe('1.250000 XMR is on its way to mira.k');
    expect(p.text()).toContain('Both signatures sent. mira.k will be asked to rate the trade.');
    const rows = [...p.host.querySelectorAll('dl > div')].map((d) => (d.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    expect(rows).toEqual(['Trade amount1.250000 XMR', 'X2F fee (1%, your ad)0.012500 XMR', 'You sent1.262500 XMR']);
    p.unmount();
    const t = released(trade({ ...RELEASED, poster: 'buyer', fee: undefined }));
    await flush();
    expect(t.host.querySelector('dl')).toBeNull();
    expect(t.text()).not.toMatch(/fee/i);
  });

  it('links the tx on a public explorer with no referrer or opener, and the explorer note', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10 } });
    const r = released(trade({ ...RELEASED }));
    await flush();
    const a = [...r.host.querySelectorAll('a')].find((x) => (x.textContent ?? '').includes('View on the Monero blockchain'))!;
    expect(a.getAttribute('href')).toBe(`https://xmrchain.net/tx/${TX}`);
    expect(a.getAttribute('rel')).toBe('noreferrer noopener');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(r.text()).toContain('Opens a public block explorer. It shows the transaction and its confirmations, never the amount or who received it.');
  });

  it('polls the confirmations until 10, then stops', async () => {
    vi.useFakeTimers();
    let n = 8;
    answer = () => ({ status: 200, body: { confirmations: n++, target: 10 } });
    const r = released(trade({ ...RELEASED }));
    await flush();
    expect(r.text()).toContain('8 of 10');
    advance(15_000, vi);
    await flush();
    expect(r.text()).toContain('9 of 10');
    advance(15_000, vi);
    await flush();
    expect(r.text()).toContain('10 of 10');
    advance(60_000, vi);
    await flush();
    expect(calls).toHaveLength(3);
  });

  it('says it is still checking when the node has no count, and never shows more than 10 of 10', async () => {
    answer = () => ({ status: 200, body: { confirmations: null, target: 10 } });
    const r = released(trade({ ...RELEASED }));
    await flush();
    expect(r.text()).toContain('Confirmations');
    expect(r.text()).toContain('Checking…');
    r.unmount();
    answer = () => ({ status: 200, body: { confirmations: 25, target: 10 } });
    const s = released(trade({ ...RELEASED }));
    await flush();
    expect(s.text()).toContain('10 of 10');
  });
});

describe('releaseScreenOf (the slot Task 22 registers in TradeRoom)', () => {
  it('maps role and state to the screen', () => {
    expect(releaseScreenOf(trade({ state: 'paid' }))).toBe('seller-confirm');
    expect(releaseScreenOf(trade({ state: 'settling', settling: 'release' }))).toBe('seller-confirm');
    expect(releaseScreenOf(trade({ state: 'settling', settling: 'buyer-cancel' }))).toBeNull();
    expect(releaseScreenOf(trade({ state: 'paid', role: 'buyer' }))).toBeNull();
    expect(releaseScreenOf(trade({ state: 'released', role: 'buyer' }))).toBe('released');
    expect(releaseScreenOf(trade({ state: 'released' }))).toBe('released');
    expect(releaseScreenOf(trade({ state: 'secured' }))).toBeNull();
    expect(releaseScreenOf(trade({ state: 'refunded' }))).toBeNull();
  });
});
