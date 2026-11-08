// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD, SERVER_NOW, sellerNudgedView, sellerRequestedView, sellerView } from '../e2e/refundViews.js';
import { forgetRefundRuns } from '../src/screens/trade/refundFlow.js';
import { SellerRefund } from '../src/screens/trade/SellerRefund.js';
import type { RefundEscrow, RefundView } from '../src/screens/trade/refundSlot.js';
import { PENDING_ESCROW } from '../src/screens/trade/seams.js';
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

/** The parts of Task 12's `useEscrow` these screens use, as a recorder; `amountAtomic` is the device's accepted amount (null: none). */
function escrowFake(amountAtomic: bigint | null = null) {
  const calls: string[] = [];
  const escrow: RefundEscrow = {
    ...PENDING_ESCROW,
    signal: vi.fn(async (s: string) => void calls.push(`signal:${s}`)),
    buildRefund: vi.fn(async () => void calls.push('build')),
    amountAtomic,
  };
  return { calls, escrow };
}

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
    ...PENDING_ESCROW,
    signal: vi.fn((s: string) => maybe('signal', `signal:${s}`)),
    buildRefund: vi.fn(() => maybe('build', 'build')),
    amountAtomic: null,
  };
  return { calls, escrow };
}

/**
 * `fresh`: the room hands the screen a NEW escrow object on every render, as Task 12's `useEscrow`
 * returns one (its status object is rebuilt per render), and `refresh()` re-renders the room.
 * `reread`: the view `refresh()` re-reads (the API's view after the tap), shown with a fresh escrow.
 */
function mount(view: RefundView, o: { clock?: () => Date; escrow?: RefundEscrow; fresh?: boolean; reread?: RefundView } = {}) {
  const e = o.escrow ? { calls: [] as string[], escrow: o.escrow } : escrowFake();
  let current = view;
  const tree = () => (
    <MemoryRouter>
      <SellerRefund code={current.code} view={current} escrow={o.fresh ? { ...e.escrow } : e.escrow} refresh={refresh} serverClock={o.clock ?? clockAt(SERVER_NOW)} wide={false} />
    </MemoryRouter>
  );
  const refresh = vi.fn(async () => {
    if (o.reread !== undefined) current = o.reread;
    if (o.fresh) r.rerender(tree());
  });
  const r = render(tree());
  const button = (name: string) => [...r.host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) ?? null;
  /** The room re-read the trade: the same screen with the new view (same escrow, same refresh). */
  const show = (next: RefundView) => {
    current = next;
    r.rerender(tree());
  };
  return { ...r, ...e, refresh, button, show };
}

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};

const EVENTS = `/v1/trades/${encodeURIComponent(BOARD.code)}/events`;

describe('SellerRefund: the board copy', () => {
  it('locked (no nudge yet, owner G2): the board text, Nudge as the one primary, the lock note, no Cancel', () => {
    const m = mount(sellerView());
    const text = m.host.textContent ?? '';
    expect(m.host.querySelector('[data-username]')?.textContent).toBe('mira.k');
    for (const s of [
      'Selling to mira.k',
      `Trade ${BOARD.code}`,
      'Payment window ended',
      "mira.k didn't mark the payment in time",
      'Your 1.250000 XMR is still safe in escrow. Nudge mira.k, or give them more time.',
      'If mira.k paid after all',
      "Even after your refund, mira.k can still open a dispute if they sent the money anyway. A moderator can pause your account from trading until it's resolved, then reviews it fairly. If their payment reached you, you'll be asked to send mira.k the 1.250000 XMR as agreed. Refusing leads to an account suspension and a possible lifetime ban.",
      "Check your bank account first. If mira.k's Zelle payment did arrive, release instead of cancelling.",
      'No word from mira.k? After 90 min and at least one nudge, you can cancel and get your 1.250000 XMR back.',
    ]) {
      expect(text).toContain(s);
    }
    // G2 dropped the final-alert steps from this screen.
    expect(text).not.toContain('final alert');
    expect(text).not.toContain('No moderator needed');
    const primary = m.host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Nudge mira.k');
    expect(m.button('Cancel and get refund')).toBeNull();
    expect(m.button('Give 30 more min')).not.toBeNull();
    expect(m.host.querySelector('[data-refund-cancel]')?.getAttribute('data-refund-cancel')).toBe('locked');
    for (const u of m.host.querySelectorAll<HTMLElement>('[data-username]')) expect(u.textContent).toBe('mira.k');
  });

  it('available (90 min and one nudge): Cancel is the one primary, then Give 30 more min and Nudge again', () => {
    const m = mount(sellerNudgedView());
    const text = m.host.textContent ?? '';
    expect(text).toContain('Your 1.250000 XMR is still safe in escrow. You can take it back, or give mira.k more time.');
    expect(text).toContain('You can nudge again every 15 min, as often as you need. You can cancel now and get your 1.250000 XMR back.');
    expect(text).not.toContain('No word from mira.k?');
    const primary = m.host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Cancel and get refund');
    expect((primary[0] as HTMLButtonElement).disabled).toBe(false);
    expect(m.button('Nudge again')).not.toBeNull();
    expect(m.button('Give 30 more min')).not.toBeNull();
    expect(m.host.querySelector('[data-refund-cancel]')?.getAttribute('data-refund-cancel')).toBe('available');
  });

  it('a nudge from before the escrow was secured does not unlock it', () => {
    const m = mount(sellerView({ sellerNudgedAt: sellerView().takenAt }));
    expect(m.host.querySelector('[data-primary]')!.textContent).toBe('Nudge mira.k');
  });

  it('the dispute-after-refund warning is on screen before the tap, above the one primary', () => {
    const { host } = mount(sellerNudgedView());
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Cancel and get refund');
    const warning = host.querySelector('[data-late-dispute]')!;
    expect(warning.textContent).toMatch(/^Even after your refund/);
    expect(warning.compareDocumentPosition(primary[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never shows a login name: only the public name the view carries', () => {
    const { host } = mount(sellerView({ counterparty: { ...sellerView().counterparty, displayName: 'Mira.K_' } }));
    expect(host.textContent).toContain('Selling to Mira.K_');
  });

  it("the escrow amount is what the escrow holds (a seller's own ad funds amount + 1%)", () => {
    const { host } = mount(sellerView({ poster: 'seller', receivedAtomic: '1262500000000' }));
    expect(host.textContent).toContain('Your 1.262500 XMR is still safe in escrow.');
    // The XMR owed after a lost dispute is the trade amount, not the escrow balance.
    expect(host.textContent).toContain("you'll be asked to send mira.k the 1.250000 XMR as agreed");
  });

  it("the XMR owed is the amount this device accepts (Task 12's status), not the API's, when the device has one", () => {
    // The API says 9.99 XMR; the device fixed 1.25 (Task 12 review I3: never the API's amount when the device has its own).
    const lying = sellerView({ amountAtomic: '9990000000000' });
    const device = mount(lying, { escrow: escrowFake(1_250_000_000_000n).escrow });
    expect(device.host.textContent).toContain("you'll be asked to send mira.k the 1.250000 XMR as agreed");
    expect(device.host.textContent).not.toContain('9.99');
    // No device amount yet (null): the view's amount is shown.
    const none = mount(lying, { escrow: escrowFake(null).escrow });
    expect(none.host.textContent).toContain("you'll be asked to send mira.k the 9.990000 XMR as agreed");
  });
});

describe('SellerRefund: Cancel & get refund', () => {
  it('posts request-refund, then sends one signal and one tx set, then re-reads the trade', async () => {
    const m = mount(sellerNudgedView());
    fire(m.button('Cancel and get refund')!, new MouseEvent('click', { bubbles: true }));
    fire(m.button('Cancel and get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: EVENTS, body: { type: 'request-refund' } }]);
    expect(m.calls).toEqual(['signal:trade.refund-request', 'build']);
    expect(m.escrow.buildRefund).toHaveBeenCalledTimes(1);
    expect(m.escrow.signal).toHaveBeenCalledTimes(1);
    expect(m.refresh).toHaveBeenCalled();
  });

  it('a refusal from the API sends no signal and no tx set, says so, and re-reads the trade', async () => {
    answers[EVENTS] = [{ status: 409, body: { error: 'wrong-state' } }];
    const m = mount(sellerNudgedView());
    fire(m.button('Cancel and get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(m.calls).toEqual([]);
    expect(m.host.querySelector('[role="alert"]')?.textContent).toBe('That did not work. Try again.');
    expect(m.refresh).toHaveBeenCalled();
  });

  it('before payBy by the server clock it is disabled, even with the device clock 10 min ahead', async () => {
    vi.useFakeTimers({ now: Date.parse(SERVER_NOW) + 10 * MIN, toFake: ['Date'] });
    try {
      const m = mount(sellerNudgedView({ payBy: new Date(Date.parse(SERVER_NOW) + 2 * MIN).toISOString() }));
      const b = m.button('Cancel and get refund')!;
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
    const m = mount(sellerNudgedView());
    fire(m.button('Give 30 more min')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: EVENTS, body: { type: 'extend' } }]);
    expect(m.calls).toEqual(['signal:trade.extend']);
    expect(m.refresh).toHaveBeenCalled();
  });

  it("a failed extend signal is retried without a second extend, although the re-read view already counts the extension and the room hands a new escrow object each render (Task 12's useEscrow does)", async () => {
    const e = flakyEscrow({ signal: 1 });
    // The API committed the extend before the signal failed, so the re-read view carries extensions + 1.
    const m = mount(sellerNudgedView(), { escrow: e.escrow, fresh: true, reread: sellerNudgedView({ extensions: 1 }) });
    fire(m.button('Give 30 more min')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: EVENTS, body: { type: 'extend' } }]);
    expect(m.host.querySelector('[role="alert"]')?.textContent).toBe('That did not work. Try again.');
    expect(m.refresh).toHaveBeenCalledTimes(1);
    fire(m.button('Give 30 more min')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toHaveLength(1);
    expect(e.calls).toEqual(['signal:trade.extend', 'signal:trade.extend']);
    expect(m.host.querySelector('[role="alert"]')).toBeNull();
  });

  it('a 409 no-extensions-left (a second tab, a stale view) opens CantDoThat, not "try again" (Plan 5 Task 21, round-2 N-M4)', async () => {
    answers[EVENTS] = [{ status: 409, body: { error: 'no-extensions-left' } }];
    const m = mount(sellerNudgedView({ extensions: 1 }));
    fire(m.button('Give 30 more min')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(document.querySelector('[role="dialog"] [data-part="cant-do-message"]')?.textContent).toMatch(/all the extra time it can get/);
    expect(document.querySelector('[data-part="feedback-line"] a')?.getAttribute('href')).toBe('/feedback?from=no-extensions-left');
    expect(m.host.querySelector('[role="alert"]')).toBeNull();
    expect(m.calls).toEqual([]);
  });

  it('is offered after the first extension and hidden after the second', () => {
    expect(mount(sellerNudgedView({ extensions: 1 })).button('Give 30 more min')).not.toBeNull();
    const m = mount(sellerNudgedView({ extensions: 2 }));
    expect(m.button('Give 30 more min')).toBeNull();
    // Cancel & get refund and Nudge stay.
    expect(m.button('Cancel and get refund')?.disabled).toBe(false);
    expect(m.button('Nudge again')).not.toBeNull();
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

  it('an accepted nudge re-reads the trade; the re-read view (sellerNudgedAt set) unlocks Cancel', async () => {
    answers['/v1/nudges'] = [{ status: 202, body: {} }];
    const m = mount(sellerView(), { fresh: true, reread: sellerNudgedView() });
    fire(m.button('Nudge mira.k')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(m.host.querySelector('[data-primary]')!.textContent).toBe('Cancel and get refund');
    expect(m.button('Nudge again')).not.toBeNull();
  });

  it('a refused nudge (too soon) does not re-read the trade', async () => {
    answers['/v1/nudges'] = [{ status: 429, body: { error: 'too-soon' } }];
    const m = mount(sellerView());
    fire(m.button('Nudge mira.k')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('Nudge again (unlocked) nudges the same way', async () => {
    answers['/v1/nudges'] = [{ status: 202, body: {} }];
    const m = mount(sellerNudgedView());
    fire(m.button('Nudge again')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: '/v1/nudges', body: { to: 'mira.k', context: BOARD.code } }]);
  });

  it('too soon says so', async () => {
    answers['/v1/nudges'] = [{ status: 429, body: { error: 'too-soon' } }];
    const m = mount(sellerView());
    fire(m.button('Nudge mira.k')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    // Plan 5 Task 21: the nudge limit opens CantDoThat (a portal on the body) with its feedback link.
    expect(document.querySelector('[role="dialog"] [data-part="cant-do-message"]')?.textContent).toBe('You can nudge once every 15 minutes.');
    expect(document.querySelector('[data-part="feedback-line"] a')?.getAttribute('href')).toBe('/feedback?from=too-soon');
  });
});

describe('SellerRefund: a refund half done when the view flips to refund_requested (review I1)', () => {
  it('the signal fails once: once the request is accepted and the view flips, the run resumes and builds exactly once', async () => {
    const e = flakyEscrow({ signal: 1 });
    const m = mount(sellerNudgedView(), { escrow: e.escrow });
    fire(m.button('Cancel and get refund')!, new MouseEvent('click', { bubbles: true }));
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
    const m = mount(sellerNudgedView(), { escrow: e.escrow });
    fire(m.button('Cancel and get refund')!, new MouseEvent('click', { bubbles: true }));
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
    const m = mount(sellerNudgedView());
    expect(m.button('Cancel and get refund')).not.toBeNull();
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
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Cancel and get refund');
  });
});
