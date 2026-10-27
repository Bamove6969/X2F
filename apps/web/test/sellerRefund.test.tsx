// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD, SERVER_NOW, sellerRequestedView, sellerView } from '../e2e/harness/refundViews.js';
import { forgetRefundRuns } from '../src/screens/trade/refundFlow.js';
import { SellerRefund } from '../src/screens/trade/SellerRefund.js';
import type { RefundEscrow, RefundView } from '../src/screens/trade/refundSlot.js';
import { fire, render } from './render.js';

const MIN = 60_000;
const clockAt = (iso: string, plusMin = 0) => () => new Date(Date.parse(iso) + plusMin * MIN);

type Answer = { status: number; body: unknown };
let answers: Record<string, Answer[]>;
let requests: { path: string; body: unknown }[];

beforeEach(() => {
  answers = {};
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      requests.push({ path, body: init.body === undefined ? undefined : JSON.parse(init.body as string) });
      const a = answers[path]?.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  forgetRefundRuns();
});

function escrowFake() {
  const calls: string[] = [];
  const escrow: RefundEscrow = {
    signal: vi.fn(async (s: string) => void calls.push(`signal:${s}`)),
    buildRefund: vi.fn(async () => void calls.push('build')),
  };
  return { calls, escrow };
}

function mount(view: RefundView, o: { clock?: () => Date; escrow?: RefundEscrow } = {}) {
  const e = o.escrow ? { calls: [] as string[], escrow: o.escrow } : escrowFake();
  const refresh = vi.fn(async () => undefined);
  const r = render(
    <MemoryRouter>
      <SellerRefund view={view} escrow={e.escrow} refresh={refresh} serverClock={o.clock ?? clockAt(SERVER_NOW)} wide={false} />
    </MemoryRouter>,
  );
  const button = (name: string) => [...r.host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) ?? null;
  /** The room re-read the trade: the same screen with the new view (same escrow, same refresh). */
  const show = (next: RefundView) =>
    r.rerender(
      <MemoryRouter>
        <SellerRefund view={next} escrow={e.escrow} refresh={refresh} serverClock={o.clock ?? clockAt(SERVER_NOW)} wide={false} />
      </MemoryRouter>,
    );
  return { ...r, ...e, refresh, button, show };
}

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};

const EVENTS = `/v1/trades/${encodeURIComponent(BOARD.code)}/events`;

describe('SellerRefund: the board copy', () => {
  it('shows the SellerRefund board text, with the buyer as a public name', () => {
    const { host } = mount(sellerView());
    const text = host.textContent ?? '';
    expect(host.querySelector('[data-username]')?.textContent).toBe('mira.k');
    for (const s of [
      'Selling to mira.k',
      `Trade ${BOARD.code}`,
      'Payment window ended',
      "mira.k didn't mark the payment in time",
      'Your 1.25 XMR is still safe in escrow. You can take it back, or give mira.k more time.',
      'If you cancel',
      'mira.k gets a final alert and 15 minutes to say they already paid.',
      'If they stay silent, your 1.25 XMR comes back to your wallet automatically. No moderator needed.',
      'If they say they paid, a moderator checks both sides before anything moves.',
      "Even after your refund, mira.k can still open a dispute if they sent the money anyway. A moderator can pause your account from trading until it's resolved, then reviews it fairly. If their payment reached you, you'll be asked to send mira.k the 1.25 XMR as agreed. Refusing leads to an account suspension and a possible lifetime ban.",
      "Check your bank account first. If mira.k's Zelle payment did arrive, release instead of cancelling.",
      'Nudge mira.k',
    ]) {
      expect(text).toContain(s);
    }
    for (const u of host.querySelectorAll<HTMLElement>('[data-username]')) expect(u.textContent).toBe('mira.k');
  });

  it('the dispute-after-refund warning is on screen before the tap, above the one primary', () => {
    const { host } = mount(sellerView());
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Cancel & get refund');
    const warning = [...host.querySelectorAll('li')].find((li) => li.textContent?.startsWith('Even after your refund'))!;
    expect(warning.compareDocumentPosition(primary[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never shows a login name: only the public name the view carries', () => {
    const { host } = mount(sellerView({ counterparty: { displayName: 'Mira.K_', username: 'old-public' } }));
    expect(host.textContent).toContain('Selling to Mira.K_');
    expect(host.textContent).not.toContain('old-public');
  });

  it("the escrow amount is what the escrow holds (a seller's own ad funds amount + 1%)", () => {
    const { host } = mount(sellerView({ poster: 'seller', receivedAtomic: '1262500000000' }));
    expect(host.textContent).toContain('Your 1.2625 XMR is still safe in escrow.');
    // The XMR owed after a lost dispute is the trade amount, not the escrow balance.
    expect(host.textContent).toContain("you'll be asked to send mira.k the 1.25 XMR as agreed");
  });
});

describe('SellerRefund: Cancel & get refund', () => {
  it('posts request-refund, then sends one signal and one tx set, then re-reads the trade', async () => {
    const m = mount(sellerView());
    fire(m.button('Cancel & get refund')!, new MouseEvent('click', { bubbles: true }));
    fire(m.button('Cancel & get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: EVENTS, body: { type: 'request-refund' } }]);
    expect(m.calls).toEqual(['signal:trade.refund-request', 'build']);
    expect(m.escrow.buildRefund).toHaveBeenCalledTimes(1);
    expect(m.escrow.signal).toHaveBeenCalledTimes(1);
    expect(m.refresh).toHaveBeenCalled();
  });

  it('a refusal from the API sends no signal and no tx set, says so, and re-reads the trade', async () => {
    answers[EVENTS] = [{ status: 409, body: { error: 'wrong-state' } }];
    const m = mount(sellerView());
    fire(m.button('Cancel & get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(m.calls).toEqual([]);
    expect(m.host.querySelector('[role="alert"]')?.textContent).toBe('That did not work. Try again.');
    expect(m.refresh).toHaveBeenCalled();
  });

  it('before payBy by the server clock it is disabled, even with the device clock 10 min ahead', async () => {
    vi.useFakeTimers({ now: Date.parse(SERVER_NOW) + 10 * MIN, toFake: ['Date'] });
    try {
      const m = mount(sellerView({ payBy: new Date(Date.parse(SERVER_NOW) + 2 * MIN).toISOString() }));
      const b = m.button('Cancel & get refund')!;
      expect(b.disabled).toBe(true);
      fire(b, new MouseEvent('click', { bubbles: true }));
      await settle();
      expect(requests).toEqual([]);
      expect(m.button('Give 30 more min')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SellerRefund: Give 30 more min', () => {
  it('posts extend, then the trade.extend signal, then re-reads the trade', async () => {
    const m = mount(sellerView());
    fire(m.button('Give 30 more min')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: EVENTS, body: { type: 'extend' } }]);
    expect(m.calls).toEqual(['signal:trade.extend']);
    expect(m.refresh).toHaveBeenCalled();
  });

  it('is offered after the first extension and hidden after the second', () => {
    expect(mount(sellerView({ extensions: 1 })).button('Give 30 more min')).not.toBeNull();
    const m = mount(sellerView({ extensions: 2 }));
    expect(m.button('Give 30 more min')).toBeNull();
    // Cancel & get refund and Nudge stay.
    expect(m.button('Cancel & get refund')?.disabled).toBe(false);
    expect(m.button('Nudge mira.k')).not.toBeNull();
  });
});

describe('SellerRefund: Nudge', () => {
  it('nudges the buyer by public name with the trade as the shared context', async () => {
    answers['/v1/nudges'] = [{ status: 202, body: {} }];
    const m = mount(sellerView());
    fire(m.button('Nudge mira.k')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: '/v1/nudges', body: { to: 'mira.k', context: BOARD.code } }]);
    expect(m.host.querySelector('[role="status"]')?.textContent).toBe('Nudge sent.');
  });

  it('too soon says so', async () => {
    answers['/v1/nudges'] = [{ status: 429, body: { error: 'too-soon' } }];
    const m = mount(sellerView());
    fire(m.button('Nudge mira.k')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(m.host.querySelector('[role="status"]')?.textContent).toBe('You can nudge once every 10 minutes.');
  });
});

describe('SellerRefund: a refund half done when the view flips to refund_requested (review I1)', () => {
  /** An escrow whose named calls fail the first `times` they are made. */
  function flakyEscrow(fail: Partial<Record<'signal' | 'build', number>>) {
    const calls: string[] = [];
    const left = { signal: fail.signal ?? 0, build: fail.build ?? 0 };
    const maybe = async (k: keyof typeof left, name: string) => {
      calls.push(name);
      if (left[k] > 0) {
        left[k] -= 1;
        throw new Error(`${k} failed`);
      }
    };
    const escrow: RefundEscrow = {
      signal: vi.fn((s: string) => maybe('signal', `signal:${s}`)),
      buildRefund: vi.fn(() => maybe('build', 'build')),
    };
    return { calls, escrow };
  }

  it('the signal fails once: once the request is accepted and the view flips, the run resumes and builds exactly once', async () => {
    const e = flakyEscrow({ signal: 1 });
    const m = mount(sellerView(), { escrow: e.escrow });
    fire(m.button('Cancel & get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: EVENTS, body: { type: 'request-refund' } }]);
    expect(e.calls).toEqual(['signal:trade.refund-request']);
    expect(m.refresh).toHaveBeenCalled();
    // The API accepted request-refund, so the re-read view is refund_requested.
    m.show(sellerRequestedView());
    await settle();
    expect(m.host.textContent).toContain('Final alert sent');
    expect(e.calls).toEqual(['signal:trade.refund-request', 'signal:trade.refund-request', 'build']);
    expect(e.escrow.buildRefund).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(m.host.querySelector('[role="alert"]')).toBeNull();
    expect(m.button('Retry')).toBeNull();
  });

  it('the build fails on the resume too: it says so with Retry, and Retry builds once more without a second event or signal', async () => {
    const e = flakyEscrow({ signal: 1, build: 1 });
    const m = mount(sellerView(), { escrow: e.escrow });
    fire(m.button('Cancel & get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    m.show(sellerRequestedView());
    await settle();
    expect(e.calls).toEqual(['signal:trade.refund-request', 'signal:trade.refund-request', 'build']);
    expect(m.host.querySelector('[role="alert"]')?.textContent).toBe('That did not work. Try again.');
    const retry = m.button('Retry')!;
    expect(retry).not.toBeNull();
    fire(retry, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(e.escrow.buildRefund).toHaveBeenCalledTimes(2);
    expect(e.escrow.signal).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(1);
    expect(m.host.querySelector('[role="alert"]')).toBeNull();
    expect(m.button('Retry')).toBeNull();
  });

  it('the seller cancelled on another device: this screen was rendered but never tapped, so the flip to refund_requested posts nothing (review item 8)', async () => {
    const m = mount(sellerView());
    expect(m.button('Cancel & get refund')).not.toBeNull();
    m.show(sellerRequestedView());
    await settle();
    expect(requests).toEqual([]);
    expect(m.calls).toEqual([]);
    expect(m.host.querySelector('[role="alert"]')).toBeNull();
    expect(m.button('Retry')).toBeNull();
  });

  it('a fresh refund_requested view with no run on this device (a reload) resumes nothing', async () => {
    const m = mount(sellerRequestedView());
    await settle();
    expect(m.calls).toEqual([]);
    expect(m.button('Retry')).toBeNull();
  });
});

describe('SellerRefund after the request (seller, refund_requested)', () => {
  it('shows the final alert running for the buyer, with its server-clock countdown and no actions', () => {
    const { host } = mount(sellerRequestedView(), { clock: clockAt(SERVER_NOW, 1) });
    expect(host.textContent).toContain('Final alert sent');
    expect(host.textContent).toContain('mira.k gets a final alert and 15 minutes to say they already paid.');
    expect(host.querySelector('[role="timer"]')?.textContent).toBe('14:00');
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(0);
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Cancel & get refund');
  });
});
