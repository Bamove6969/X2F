// @vitest-environment happy-dom
// SellerConfirm and Released (Task 24): behaviour with a stubbed API and a stubbed escrow. Board
// parity, phone sizes and the real build are in e2e/release.spec.ts.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Released } from '../src/screens/trade/Released.js';
import { SellerConfirm } from '../src/screens/trade/SellerConfirm.js';
import type { TradeView, TraderSummary } from '../src/api/trade.js';
import { RELEASE_ASKED_MAX_MS, markReleaseAsked, releaseAsked } from '../src/screens/trade/release/marker.js';
import { ReleaseRoomScreen, releaseScreenOf } from '../src/screens/trade/release/slots.js';
import type { ReleaseEscrow, ReleaseTrade } from '../src/screens/trade/release/view.js';
import '../src/screens/trade/screens.js';
import { screenFor, TradeRoom } from '../src/screens/trade/TradeRoom.js';
import { POLL_MS, setTradeEscrowHook, type TradeEscrow } from '../src/screens/trade/seams.js';
import { advance, pointer, render } from './render.js';
import { resetWarned, setWarned } from '../src/screens/trade/warned.js';

const ZELLE = { name: 'Zelle', giftCard: false, whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.' };
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

/** The other trader as the API sends them (FU-A: the public display name only). */
const who = (displayName: string): TraderSummary => ({ displayName, completedTrades: 3, online: true, lastSeenAt: NOW, typicalMinutes: null, positivePct: null, badges: [], stage: 'building' });

type Over = Omit<Partial<ReleaseTrade>, 'fee'> & { fee?: ReleaseTrade['fee'] | undefined };

/** The board trade (K7M2-9QXA-4FTR-8WPN): satoshi_ghost sells 1.25 XMR to mira.k for $412.50 via Zelle. `fee: undefined` drops the fee (a taker's view). */
function trade(over: Over = {}): ReleaseTrade {
  const { fee, ...rest } = over;
  const t: ReleaseTrade = {
    code: 'K7M2-9QXA-4FTR-8WPN',
    role: 'seller',
    poster: 'seller',
    state: 'paid',
    counterparty: who('mira.k'),
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
    ...rest,
  };
  if ('fee' in over) {
    if (fee === undefined) delete t.fee;
    else t.fee = fee;
  }
  return t;
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let answer: (c: Call) => { status: number; body: unknown };

beforeEach(() => {
  localStorage.clear();
  // Task 38's release warning is tested on its own (below); elsewhere the seller went past it already.
  resetWarned();
  setWarned('release', 'K7M2-9QXA-4FTR-8WPN');
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

type StubEscrow = ReleaseEscrow & { release: ReturnType<typeof vi.fn> };

/** Task 12's UseEscrow as the room hands it: a ready device that accepts the board's 1.25 XMR / $412.50. */
function escrowStub(order: string[] = [], over: Partial<ReleaseEscrow> = {}): StubEscrow {
  return {
    phase: 'ready',
    error: null,
    refusal: null,
    keepOpen: false,
    amountAtomic: 1_250_000_000_000n,
    fiatCents: 41_250n,
    ...over,
    release: vi.fn(async () => void order.push('release()')),
  };
}

function sellerConfirm(t: ReleaseTrade, escrow = escrowStub(), onTrade = vi.fn()) {
  const ui = (tr: ReleaseTrade, e: ReleaseEscrow) => (
    <MemoryRouter>
      <SellerConfirm escrowCode={tr.code} trade={tr} method={ZELLE} escrow={e} onTrade={onTrade} />
    </MemoryRouter>
  );
  const r = render(ui(t, escrow));
  const hold = () => r.host.querySelector<HTMLButtonElement>('button[data-primary]')!;
  const box = () => r.host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const text = () => (r.host.textContent ?? '').replace(/\s+/g, ' ');
  const button = (label: string) => [...r.host.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
  return { ...r, hold, box, text, button, escrow, onTrade, update: (tr: ReleaseTrade, e: ReleaseEscrow = escrow) => r.rerender(ui(tr, e)) };
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

  it('the release warning (Task 38, board Warn-Release) opens first and keeps the hold locked until "It\'s in my account", once per trade', () => {
    resetWarned();
    localStorage.clear();
    const alert = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');
    const btn = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent === label)!;
    const s = sellerConfirm(trade());
    expect(alert()).not.toBeNull();
    const t = (alert()!.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('Before you release');
    expect(t).toContain('Is the $412.50 really in your account?');
    expect(t).toContain('Only release once the money is really in your account.');
    expect(t).toContain('Check your own bank or Zelle app, not a screenshot. Screenshots can be faked.');
    expect(t).toContain("Once released, the 1.250000 XMR (about $412.50) goes to mira.k and can't be taken back.");
    act(() => btn("I'll check again").click());
    expect(alert()).toBeNull();
    act(() => s.box().click());
    // Ticking before going past the warning brings it back; the hold stays locked.
    expect(alert()).not.toBeNull();
    expect(s.hold().disabled).toBe(true);
    act(() => btn("I'll check again").click());
    // Review M6: the caption names the warning, and it can be shown again from there.
    expect(s.text()).toContain('Read the warning before you release');
    act(() => btn('Show the warning again').click());
    expect(alert()).not.toBeNull();
    // Review M5: the safe action has focus, and the warning text describes the dialog.
    expect(document.activeElement?.textContent).toBe("I'll check again");
    expect(document.getElementById(alert()!.getAttribute('aria-describedby')!)?.textContent).toContain('Only release once the money is really in your account.');
    act(() => btn("It's in my account").click());
    expect(alert()).toBeNull();
    expect(s.hold().disabled).toBe(false);
    s.unmount();
    // Once per trade: a reload (memory gone, store kept) shows it no more.
    resetWarned();
    const again = sellerConfirm(trade());
    expect(alert()).toBeNull();
    again.unmount();
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

  it('shows the released look once this device has signed (escrow phase done)', () => {
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrowStub([], { phase: 'done' }));
    expect(s.hold().disabled).toBe(true);
    expect(s.hold().dataset.done).toBe('true');
    expect(s.hold().textContent).toContain('Released');
    expect(s.hold().textContent).toContain('1.250000 XMR is on its way to mira.k');
    expect(s.text()).toContain('Both signatures sent. mira.k will be asked to rate the trade.');
    expect(s.text()).not.toContain('Payment not received');
    expect(s.escrow.release).not.toHaveBeenCalled();
  });

  it('while this device signs, says so and that the page must stay open, not "Both signatures sent" (I1)', () => {
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrowStub([], { phase: 'signing', keepOpen: true }));
    expect(s.hold().disabled).toBe(true);
    expect(s.hold().dataset.done).not.toBe('true');
    expect(s.hold().textContent).toContain('Signing…');
    expect(s.text()).not.toContain('Both signatures sent');
    expect(s.text()).toContain('Signing the release on this device. Keep this page open.');
    expect(s.escrow.release).not.toHaveBeenCalled();
  });

  it('a remount in settling with a ready device signs the release again, once, when THIS device asked (I1: reload after the POST)', async () => {
    markReleaseAsked('K7M2-9QXA-4FTR-8WPN');
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }));
    await flush();
    expect(s.escrow.release).toHaveBeenCalledTimes(1);
    expect(s.text()).not.toContain('Both signatures sent');
    s.update(trade({ state: 'settling', settling: 'release' }), { ...s.escrow });
    await flush();
    expect(s.escrow.release).toHaveBeenCalledTimes(1);
  });

  it('waits for the device to be ready before signing again in settling', async () => {
    markReleaseAsked('K7M2-9QXA-4FTR-8WPN');
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrowStub([], { phase: 'setting-up' }));
    await flush();
    expect(s.escrow.release).not.toHaveBeenCalled();
    expect(s.text()).not.toContain('Both signatures sent');
    s.update(trade({ state: 'settling', settling: 'release' }), { ...s.escrow, phase: 'ready' });
    await flush();
    expect(s.escrow.release).toHaveBeenCalledTimes(1);
  });

  it('a lost release-started response, then a settling view, still leads to release() (I1)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    const s = sellerConfirm(trade());
    act(() => s.box().click());
    pointer(s.hold(), 'pointerdown');
    advance(1500, vi);
    await flush();
    // No answer: the outcome is unknown, so the screen says the device may still finish it (round-3 Minor 2).
    expect(s.host.querySelector('[role=alert]')!.textContent).toBe('We couldn’t confirm the release started. If it did, this device will finish it.');
    expect(s.text()).not.toContain('didn’t start');
    expect(s.escrow.release).not.toHaveBeenCalled();
    // The POST was applied after all: the room's next read shows the release settling.
    s.update(trade({ state: 'settling', settling: 'release' }));
    await flush();
    expect(s.escrow.release).toHaveBeenCalledTimes(1);
    expect(s.host.querySelector('[role=alert]')).toBeNull();
  });

  it('the API alone says the release is settling (no ask on this device): signs nothing until the box and the hold (round 2 I1)', async () => {
    vi.useFakeTimers();
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }));
    await flush();
    expect(s.escrow.release).not.toHaveBeenCalled();
    expect(s.text()).toContain('X2F shows a release under way that wasn’t started on this device. Check your bank account first.');
    expect(s.text()).not.toContain('Both signatures sent');
    expect(s.box().checked).toBe(false);
    expect(s.hold().disabled).toBe(true);
    expect(s.hold().textContent).toContain('Hold to finish the release of 1.250000 XMR to mira.k');
    // The seller may still report the payment missing.
    expect(s.text()).toContain('Payment not received');
    act(() => s.box().click());
    expect(s.hold().disabled).toBe(false);
    pointer(s.hold(), 'pointerdown');
    advance(1499, vi);
    expect(s.escrow.release).not.toHaveBeenCalled();
    advance(1, vi);
    await flush();
    expect(s.escrow.release).toHaveBeenCalledTimes(1);
    // No second release-started: the API is already settling.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(releaseAsked('K7M2-9QXA-4FTR-8WPN')).toBe(true);
  });

  it('writes the marker before release-started; a refused POST clears it, so a later settling view signs nothing (round 2 I1)', async () => {
    vi.useFakeTimers();
    let markedAtPost: boolean | null = null;
    answer = () => {
      markedAtPost = releaseAsked('K7M2-9QXA-4FTR-8WPN');
      return { status: 409, body: { error: 'not-releasable' } };
    };
    const s = sellerConfirm(trade());
    act(() => s.box().click());
    pointer(s.hold(), 'pointerdown');
    advance(1500, vi);
    await flush();
    expect(markedAtPost).toBe(true);
    expect(releaseAsked('K7M2-9QXA-4FTR-8WPN')).toBe(false);
    s.update(trade({ state: 'settling', settling: 'release' }));
    await flush();
    expect(s.escrow.release).not.toHaveBeenCalled();
  });

  it('a marker older than the settle window is not used (round 2 I1)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    markReleaseAsked('K7M2-9QXA-4FTR-8WPN');
    vi.setSystemTime(new Date(Date.parse('2026-10-25T12:00:00Z') + RELEASE_ASKED_MAX_MS + 1));
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }));
    await flush();
    expect(s.escrow.release).not.toHaveBeenCalled();
    expect(releaseAsked('K7M2-9QXA-4FTR-8WPN')).toBe(false);
  });

  it('clears the marker once this device has signed', async () => {
    markReleaseAsked('K7M2-9QXA-4FTR-8WPN');
    sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrowStub([], { phase: 'done' }));
    await flush();
    expect(releaseAsked('K7M2-9QXA-4FTR-8WPN')).toBe(false);
  });

  it('settling on a device whose escrow is not set up: says to open the trade on the device it was set up on (round 2 Minor 2)', async () => {
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrowStub([], { phase: 'idle' }));
    await flush();
    expect(s.text()).toContain('This device doesn’t hold this trade’s escrow yet. If you set the trade up on another device, open it there.');
    expect(s.hold().disabled).toBe(true);
    expect(s.escrow.release).not.toHaveBeenCalled();
  });

  it('settling while the device escrow is still starting (a reload): no "open it on the other device" hint (round-3 Minor 3)', async () => {
    for (const phase of ['registering', 'verifying', 'setting-up'] as const) {
      const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrowStub([], { phase }));
      await flush();
      expect(s.text()).not.toContain('If you set the trade up on another device');
      expect(s.text()).not.toContain('doesn’t hold this trade’s escrow');
      s.unmount();
    }
    markReleaseAsked('K7M2-9QXA-4FTR-8WPN');
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrowStub([], { phase: 'verifying' }));
    await flush();
    expect(s.text()).toContain('Starting this device’s escrow…');
    expect(s.escrow.release).not.toHaveBeenCalled();
  });

  it('"Payment not received" and "Open dispute" clear the release marker, so a later settling view signs nothing (round-3 Minor 1)', async () => {
    for (const label of ['Payment not received', 'Open dispute']) {
      markReleaseAsked('K7M2-9QXA-4FTR-8WPN');
      const s = sellerConfirm(trade());
      const link = [...s.host.querySelectorAll('a')].find((a) => a.textContent === label)!;
      act(() => link.click());
      expect(releaseAsked('K7M2-9QXA-4FTR-8WPN')).toBe(false);
      s.unmount();
      const again = sellerConfirm(trade({ state: 'settling', settling: 'release' }));
      await flush();
      expect(again.escrow.release).not.toHaveBeenCalled();
      again.unmount();
    }
  });

  it('when release() throws, offers to finish the release on this device (I1)', async () => {
    markReleaseAsked('K7M2-9QXA-4FTR-8WPN');
    const escrow = escrowStub();
    escrow.release.mockRejectedValueOnce(new Error('escrow not running'));
    const s = sellerConfirm(trade({ state: 'settling', settling: 'release' }), escrow);
    await flush();
    expect(escrow.release).toHaveBeenCalledTimes(1);
    expect(s.host.querySelector('[role=alert]')!.textContent).toBe('The release didn’t finish on this device. Keep this page open.');
    expect(s.text()).not.toContain('Both signatures sent');
    act(() => s.button('Finish the release on this device')!.click());
    await flush();
    expect(escrow.release).toHaveBeenCalledTimes(2);
  });

  it('after release-started and before the room refreshes, the hold shows the release under way (Minor 11)', async () => {
    vi.useFakeTimers();
    answer = () => ({ status: 200, body: trade({ state: 'settling', settling: 'release' }) });
    const escrow = escrowStub();
    escrow.release.mockImplementation(() => new Promise<void>(() => undefined));
    const s = sellerConfirm(trade(), escrow);
    act(() => s.box().click());
    pointer(s.hold(), 'pointerdown');
    advance(1500, vi);
    await flush();
    expect(escrow.release).toHaveBeenCalledTimes(1);
    expect(s.hold().disabled).toBe(true);
    expect(s.hold().textContent).toContain('Signing…');
    expect(s.text()).not.toContain('Payment not received');
  });

  it('shows the amount and fiat total this device accepts, never the API view\'s (I3)', () => {
    // The API understates the trade to the seller; the device holds the buyer's signed amount.
    const s = sellerConfirm(
      trade({ amountAtomic: '1000000000000', fiatCents: '33000' }),
      escrowStub([], { amountAtomic: 1_250_000_000_000n, fiatCents: 41_250n }),
    );
    expect(s.host.querySelector('h1')!.textContent).toBe('Check your bank account for $412.50 sent via Zelle');
    expect(s.text()).toContain('I checked my bank account myself and the $412.50 from Zelle is there.');
    act(() => s.box().click());
    expect(s.hold().textContent).toContain('Hold to release 1.250000 XMR to mira.k');
    expect(s.text()).not.toContain('$330.00');
    expect(s.text()).not.toContain('1.000000 XMR');
  });

  it('keeps the hold locked, with words, while the device has no amount (I3)', () => {
    const s = sellerConfirm(trade(), escrowStub([], { amountAtomic: null, fiatCents: null }));
    act(() => s.box().click());
    expect(s.hold().disabled).toBe(true);
    expect(s.text()).toContain('Waiting for this device to confirm the trade amount.');
    expect(s.text()).not.toContain('Press and hold');
    expect(s.text()).not.toContain('$412.50');
    // No doubled article without an amount (demo walk, 8 Nov).
    expect(s.text()).toContain('I checked my bank account myself and the payment from Zelle is there.');
    expect(s.text()).not.toContain('the the');
  });

  it('keeps the hold locked and says why under a Task 12 refusal (I3)', () => {
    const s = sellerConfirm(trade(), escrowStub([], { refusal: 'paid-amount-refused' }));
    act(() => s.box().click());
    expect(s.hold().disabled).toBe(true);
    expect(s.host.querySelector('[role=alert]')!.textContent).toBe(
      'The amount mira.k marked as paid doesn’t fit this trade. This device won’t sign a release. Open a dispute.',
    );
    expect(s.text()).not.toContain('Press and hold');
  });

  it('keeps the hold locked while the device escrow has stopped (I3)', () => {
    const s = sellerConfirm(trade(), escrowStub([], { phase: 'error', error: 'escrow-failed' }));
    act(() => s.box().click());
    expect(s.hold().disabled).toBe(true);
    expect(s.host.querySelector('[role=alert]')!.textContent).toBe('The escrow stopped on this device, so it can’t sign a release. Reload the page; if it stays, open a dispute.');
  });

  it('ticked but not releasable with no estimate: waits for the escrow to unlock, no hold hint (Minor 10)', () => {
    const s = sellerConfirm(trade({ releasable: false, releasableEtaMin: null }));
    act(() => s.box().click());
    expect(s.hold().disabled).toBe(true);
    expect(s.hold().textContent).toContain('Waiting for the escrow to unlock');
    expect(s.text()).not.toContain('Payment received Hold');
    expect(s.text()).not.toContain('Press and hold');
    expect(s.text()).toContain('The XMR in escrow needs more confirmations before it can be released.');
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

function released(t: ReleaseTrade, escrow: ReleaseEscrow = escrowStub([], { phase: 'done' })) {
  const ui = (tr: ReleaseTrade, e: ReleaseEscrow) => (
    <MemoryRouter>
      <Released trade={tr} escrow={e} />
    </MemoryRouter>
  );
  const r = render(ui(t, escrow));
  return { ...r, text: () => (r.host.textContent ?? '').replace(/\s+/g, ' '), update: (tr: ReleaseTrade, e: ReleaseEscrow = escrow) => r.rerender(ui(tr, e)) };
}

const RELEASED = { state: 'released' as const, settling: null, txHash: TX };

describe('Released', () => {
  it('poster buyer: the board copy, the fee row above You receive, and the payout ending', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10, payoutEnd: 'Qwk3Fz' } });
    const r = released(trade({ ...RELEASED, role: 'buyer', poster: 'buyer', counterparty: who('satoshi_ghost') }));
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
    const r = released(trade({ ...RELEASED, role: 'buyer', poster: 'seller', fee: undefined, counterparty: who('satoshi_ghost') }));
    await flush();
    expect(r.host.querySelector('h1')!.textContent).toBe('1.250000 XMR is yours');
    expect(r.host.querySelector('dl')).toBeNull();
    // Only the poster sees the X2F fee; the network-fee note (Minor 4) is every buyer's.
    expect(r.text()).not.toMatch(/X2F fee|1%/i);
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

describe('Released for a buyer who opens the room while the release settles (I2)', () => {
  const BUYER = { role: 'buyer' as const, poster: 'seller' as const, fee: undefined, counterparty: who('satoshi_ghost') };

  it('asks nothing while settling, then starts counting when the trade reaches released, on the same mount', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10, payoutEnd: 'Qwk3Fz' } });
    const r = released(trade({ ...BUYER, state: 'settling', settling: 'release' }), escrowStub([], { phase: 'signing' }));
    await flush();
    expect(calls).toHaveLength(0);
    expect(r.text()).toContain('Checking…');
    r.update(trade({ ...BUYER, ...RELEASED }), escrowStub([], { phase: 'done' }));
    await flush();
    expect(calls.map((c) => c.url)).toEqual(['/v1/trades/K7M2-9QXA-4FTR-8WPN/confirmations']);
    expect(r.text()).toContain('1 of 10');
    expect(r.text()).toContain('ending …Qwk3Fz');
  });

  it('treats a 409 as "not yet" and asks again on the next tick', async () => {
    vi.useFakeTimers();
    let n = 0;
    answer = () => (n++ === 0 ? { status: 409, body: { error: 'wrong-state' } } : { status: 200, body: { confirmations: 0, target: 10 } });
    const r = released(trade({ ...BUYER, ...RELEASED }));
    await flush();
    expect(r.text()).toContain('Checking…');
    advance(15_000, vi);
    await flush();
    expect(r.text()).toContain('0 of 10');
    expect(calls).toHaveLength(2);
  });

  it('in settling, says the buyer\'s device is still co-signing, not "is yours"', () => {
    const r = released(trade({ ...BUYER, state: 'settling', settling: 'release' }), escrowStub([], { phase: 'signing', keepOpen: true }));
    expect(r.host.querySelector('h1')!.textContent).toBe('satoshi_ghost released 1.250000 XMR to you');
    expect(r.text()).toContain('Your device is adding its signature. Keep this page open.');
    expect(r.text()).not.toContain('is yours');
  });

  it('in settling with no device amount, names no amount: the API\'s is the fallback only once released (round 2 Minor 1)', () => {
    const r = released(trade({ ...BUYER, state: 'settling', settling: 'release', amountAtomic: '9990000000000' }), escrowStub([], { phase: 'setting-up', amountAtomic: null, fiatCents: null }));
    expect(r.host.querySelector('h1')!.textContent).toBe('satoshi_ghost released the XMR to you');
    expect(r.text()).not.toContain('9.990000');
  });

  it('a malformed or zero API amount never crashes the released screen (round 2 Minor 1)', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10 } });
    for (const bad of ['0', 'abc']) {
      const r = released(trade({ ...BUYER, ...RELEASED, amountAtomic: bad }), escrowStub([], { phase: 'done', amountAtomic: null, fiatCents: null }));
      await flush();
      expect(r.host.querySelector('h1')!.textContent).toBe('The XMR is yours');
      expect(r.host.querySelector('dl')).toBeNull();
      r.unmount();
    }
  });

  it('in settling, shows a Task 12 refusal instead of the released words', () => {
    const r = released(trade({ ...BUYER, state: 'settling', settling: 'release' }), escrowStub([], { refusal: 'amount-unknown', amountAtomic: null, fiatCents: null }));
    expect(r.host.querySelector('[role=alert]')!.textContent).toBe('This device doesn’t know the trade amount, so it won’t sign a release. Open a dispute.');
    expect(r.text()).not.toContain('is yours');
  });

  it('in settling, shows a stopped escrow', () => {
    const r = released(trade({ ...BUYER, state: 'settling', settling: 'release' }), escrowStub([], { phase: 'error', error: 'escrow-failed' }));
    expect(r.host.querySelector('[role=alert]')!.textContent).toContain('The escrow stopped on this device');
  });
});

describe('Released, more', () => {
  it('shows the amount this device accepted over the API view\'s (I3)', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10 } });
    const r = released(trade({ ...RELEASED, amountAtomic: '1000000000000' }), escrowStub([], { phase: 'done', amountAtomic: 1_250_000_000_000n }));
    await flush();
    expect(r.host.querySelector('h1')!.textContent).toBe('1.250000 XMR is on its way to mira.k');
  });

  it('labels the buyer\'s sum as before the network fee (Minor 4)', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10 } });
    const r = released(trade({ ...RELEASED, role: 'buyer', poster: 'buyer', counterparty: who('satoshi_ghost') }));
    await flush();
    expect(r.text()).toContain('Before the Monero network fee, which comes off your payout.');
  });

  it('links the explorer only for a well-formed tx hash (Minor 6)', async () => {
    answer = () => ({ status: 200, body: { confirmations: 1, target: 10 } });
    for (const bad of ['AB'.repeat(32), 'ab'.repeat(31), `${'ab'.repeat(32)}/../x`, '']) {
      const r = released(trade({ ...RELEASED, txHash: bad }));
      await flush();
      expect([...r.host.querySelectorAll('a')].some((a) => (a.getAttribute('href') ?? '').includes('xmrchain'))).toBe(false);
      r.unmount();
    }
  });

  it('backs off when the node has no count, instead of asking every 15 s for ever (Minor 3)', async () => {
    vi.useFakeTimers();
    answer = () => ({ status: 200, body: { confirmations: null, target: 10 } });
    released(trade({ ...RELEASED }));
    await flush();
    for (let i = 0; i < 40; i++) {
      advance(15_000, vi);
      await flush();
    }
    // 10 minutes at 15 s would be 41 asks; with the back-off it is far fewer.
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.length).toBeLessThan(12);
  });
});

describe('releaseScreenOf (the slot Task 22 registers in TradeRoom)', () => {
  it('maps role and state to the screen', () => {
    expect(releaseScreenOf(trade({ state: 'paid' }))).toBe('seller-confirm');
    expect(releaseScreenOf(trade({ state: 'settling', settling: 'release' }))).toBe('seller-confirm');
    expect(releaseScreenOf(trade({ state: 'settling', settling: 'buyer-cancel' }))).toBeNull();
    expect(releaseScreenOf(trade({ state: 'settling', settling: 'release', role: 'buyer' }))).toBe('released');
    expect(releaseScreenOf(trade({ state: 'settling', settling: 'auto-refund', role: 'buyer' }))).toBeNull();
    expect(releaseScreenOf(trade({ state: 'paid', role: 'buyer' }))).toBeNull();
    expect(releaseScreenOf(trade({ state: 'released', role: 'buyer' }))).toBe('released');
    expect(releaseScreenOf(trade({ state: 'released' }))).toBe('released');
    expect(releaseScreenOf(trade({ state: 'secured' }))).toBeNull();
    expect(releaseScreenOf(trade({ state: 'refunded' }))).toBeNull();
  });
});

describe('ReleaseRoomScreen (the trade room\'s props)', () => {
  it('the room picks ReleaseRoomScreen for each Task 24 slot, and nothing else of Task 24\'s', () => {
    const full = (over: Over) => trade(over) as TradeView;
    expect(screenFor(full({ role: 'seller', state: 'paid' }), 0)).toBe(ReleaseRoomScreen);
    expect(screenFor(full({ role: 'seller', state: 'settling', settling: 'release' }), 0)).toBe(ReleaseRoomScreen);
    expect(screenFor(full({ role: 'buyer', state: 'settling', settling: 'release' }), 0)).toBe(ReleaseRoomScreen);
    expect(screenFor(full({ role: 'seller', state: 'released' }), 0)).toBe(ReleaseRoomScreen);
    expect(screenFor(full({ role: 'buyer', state: 'released' }), 0)).toBe(ReleaseRoomScreen);
    expect(screenFor(full({ role: 'buyer', state: 'settling', settling: 'buyer-cancel' }), 0)).not.toBe(ReleaseRoomScreen);
    expect(screenFor(full({ role: 'buyer', state: 'paid' }), 0)).not.toBe(ReleaseRoomScreen);
  });

  it('uses the room\'s escrow, server clock and refresh, and shows the public display name', async () => {
    vi.useFakeTimers();
    answer = () => ({ status: 200, body: trade({ state: 'settling', settling: 'release' }) });
    const escrow = escrowStub();
    const refresh = vi.fn(async () => undefined);
    const view = trade({ counterparty: who('mira.k') });
    const r = render(
      <MemoryRouter>
        <ReleaseRoomScreen code={view.code} view={view} escrow={escrow} refresh={refresh} serverClock={() => new Date('2026-10-25T12:00:00Z')} wide={false} />
      </MemoryRouter>,
    );
    expect(r.host.textContent).toContain('Selling to mira.k');
    expect(r.host.textContent).toContain('1 h 52 min to confirm');
    expect(r.host.querySelector('a.x2f-release__chat')!.textContent).toBe('Chat');
    act(() => r.host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    pointer(r.host.querySelector('button[data-primary]')!, 'pointerdown');
    advance(1500, vi);
    await flush();
    expect(escrow.release).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it('says so when the device could not sign (Task 12 refuses the act)', async () => {
    vi.useFakeTimers();
    answer = () => ({ status: 200, body: trade({ state: 'settling', settling: 'release' }) });
    const escrow = escrowStub();
    escrow.release.mockRejectedValue(new Error('escrow action refused'));
    const s = sellerConfirm(trade(), escrow);
    act(() => s.box().click());
    pointer(s.hold(), 'pointerdown');
    advance(1500, vi);
    await flush();
    expect(s.host.querySelector('[role=alert]')!.textContent).toBe('The release didn’t finish on this device. Keep this page open.');
  });
});

/**
 * Round-3 review, Important 1: the marker must be the route's trade, not the API's `view.code`.
 * Seller S held on trade Y, Y's answer was lost (the marker for Y stays), then S opens trade X and
 * the API answers GET /v1/trades/X with Y's code in settling/release.
 */
describe('a view carrying another trade\'s code (round-3 Important 1)', () => {
  const X = 'K7M2-9QXA-4FTR-8WPN';
  const Y = 'Z3H8-6RNB-2DWC-5JTE';
  let started: string[];
  let roomEscrow: StubEscrow;

  beforeEach(() => {
    started = [];
    roomEscrow = escrowStub();
    setTradeEscrowHook((code) => {
      started.push(code);
      return roomEscrow as unknown as TradeEscrow;
    });
  });
  afterEach(() => setTradeEscrowHook(null));

  /** A whole GET /v1/trades/:code answer (the room parses every amount). */
  const full = (over: Over) => JSON.stringify({ ...trade(over), maxFiatCents: '50000', receivedAtomic: '1250000000000', funding: null, nextDeadline: null });

  /** S holds to release Y; the release-started answer never arrives (a connection reset). */
  async function holdOnYAndLoseTheAnswer(): Promise<void> {
    // S went past Y's release warning (Task 38) before holding.
    setWarned('release', Y);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    const y = sellerConfirm(trade({ code: Y }));
    act(() => y.box().click());
    pointer(y.hold(), 'pointerdown');
    advance(1500, vi);
    await flush();
    expect(releaseAsked(Y)).toBe(true);
    y.unmount();
    // Fake timers stay on: a fresh fake clock would start before the marker's time (and drop it).
  }

  it('the room shows a refusal for X, renders no slot and starts no escrow; nothing is signed', async () => {
    await holdOnYAndLoseTheAnswer();
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return new Response(full({ code: Y, state: 'settling', settling: 'release' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r = render(
      <MemoryRouter initialEntries={[`/trade/${X}`]}>
        <Routes>
          <Route path="/trade/:code" element={<TradeRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    expect(roomEscrow.release).not.toHaveBeenCalled();
    // Plan 2 Task 18: the room also reads who is signed in (a team member's device never starts an escrow).
    expect(seen.filter((u) => u !== '/v1/account/me')).toEqual([`/v1/trades/${X}`]);
    expect(r.host.querySelector('[data-screen=seller-confirm]')).toBeNull();
    expect(r.host.querySelector('[role=alert]')!.textContent).toContain('X2F answered with a different trade');
    expect(started).toEqual([]);
    expect(roomEscrow.release).not.toHaveBeenCalled();
  });

  it('a later re-read that carries Y\'s code takes the slot away and signs nothing', async () => {
    await holdOnYAndLoseTheAnswer();
    vi.stubGlobal('fetch', async () => new Response(full({ code: X, state: 'paid' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const r = render(
      <MemoryRouter initialEntries={[`/trade/${X}`]}>
        <Routes>
          <Route path="/trade/:code" element={<TradeRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    expect(r.host.querySelector('[data-screen=seller-confirm]')).not.toBeNull();
    expect(started).toContain(X);
    // The API now answers X with Y's code, settling/release; the room's poll reads it.
    vi.stubGlobal('fetch', async () => new Response(full({ code: Y, state: 'settling', settling: 'release' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    act(() => void vi.advanceTimersByTime(POLL_MS));
    await flush();
    expect(r.host.querySelector('[data-screen=seller-confirm]')).toBeNull();
    expect(r.host.querySelector('[role=alert]')!.textContent).toContain('X2F answered with a different trade');
    expect(roomEscrow.release).not.toHaveBeenCalled();
  });

  it('even handed Y\'s view directly, the release screen for X\'s escrow keys the marker by X: no signature without a hold', async () => {
    await holdOnYAndLoseTheAnswer();
    const r = render(
      <MemoryRouter>
        <ReleaseRoomScreen code={X} view={trade({ code: Y, state: 'settling', settling: 'release' })} escrow={roomEscrow} refresh={async () => undefined} serverClock={() => new Date(NOW)} wide={false} />
      </MemoryRouter>,
    );
    await flush();
    expect(roomEscrow.release).not.toHaveBeenCalled();
    expect(r.host.textContent).toContain('wasn’t started on this device');
    expect(releaseAsked(X)).toBe(false);
  });
});
