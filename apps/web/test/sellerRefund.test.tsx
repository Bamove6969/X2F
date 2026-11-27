// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD, SERVER_NOW, sellerNudgedView, sellerRefundedView, sellerRequestedView, sellerView } from '../e2e/refundViews.js';
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

describe('SellerRefund: the board copy (owner 8 Nov: nudges optional, no final alert)', () => {
  it('with no nudge at all: Cancel is the one primary at once, then Give 30 more min and Nudge, and the note encourages a nudge', () => {
    const m = mount(sellerView());
    const text = m.host.textContent ?? '';
    expect(m.host.querySelector('[data-username]')?.textContent).toBe('mira.k');
    for (const s of [
      'Selling to mira.k',
      `Trade ${BOARD.code}`,
      'Payment window ended',
      "mira.k didn't mark the payment in time",
      "Your 1.250000 XMR is still safe in escrow. You can cancel now and get it back, or give mira.k more time. Until you cancel, mira.k can still pay and tap I've paid.",
      'If mira.k paid after all',
      "Even after your refund, mira.k can still open a dispute if they sent the money anyway. A moderator can pause your account from trading until it's resolved, then reviews it fairly. If their payment reached you, you'll be asked to send mira.k the 1.250000 XMR as agreed. Refusing leads to an account suspension and a possible lifetime ban.",
      "Check your bank account first. If mira.k's Zelle payment did arrive, release instead of cancelling.",
      'No word from mira.k? A nudge before you cancel often saves starting a new trade with someone else. You can nudge every 15 min, as often as you need. Cancelling starts your refund at once.',
    ]) {
      expect(text).toContain(s);
    }
    // No final alert, and no lock waiting for a nudge.
    expect(text).not.toContain('final alert');
    expect(text).not.toContain('at least one nudge');
    expect(text).not.toContain('No moderator needed');
    const primary = m.host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Cancel and get refund');
    expect((primary[0] as HTMLButtonElement).disabled).toBe(false);
    expect(m.button('Nudge mira.k')).not.toBeNull();
    expect(m.button('Give 30 more min')).not.toBeNull();
    expect(m.host.querySelector('[data-refund-cancel]')?.getAttribute('data-refund-cancel')).toBe('available');
    for (const u of m.host.querySelectorAll<HTMLElement>('[data-username]')) expect(u.textContent).toBe('mira.k');
  });

  it('a nudge changes nothing about Cancel (a record only)', () => {
    for (const v of [sellerNudgedView(), sellerView({ sellerNudgedAt: sellerView().takenAt })]) {
      const m = mount(v);
      expect(m.host.querySelector('[data-primary]')!.textContent).toBe('Cancel and get refund');
      expect(m.button('Nudge mira.k')).not.toBeNull();
    }
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
    const { host } = mount(sellerView({ counterparty: { ...sellerView().counterparty, tradeTag: 'Mira.K_' } }));
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

  it('the XMR owed is exact, never cut at 6 places (review kit round 1, finding 1)', () => {
    const { host } = mount(sellerView({ amountAtomic: '610529733574' }), { escrow: escrowFake(610_529_733_574n).escrow });
    expect(host.textContent).toContain("you'll be asked to send mira.k the 0.610529733574 XMR as agreed");
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

  it('a nudge needs no re-read: it unlocks nothing (owner 8 Nov)', async () => {
    answers['/v1/nudges'] = [{ status: 202, body: {} }];
    const m = mount(sellerView());
    fire(m.button('Nudge mira.k')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.host.querySelector('[data-primary]')!.textContent).toBe('Cancel and get refund');
  });

  it('a second nudge nudges the same way', async () => {
    answers['/v1/nudges'] = [{ status: 202, body: {} }, { status: 202, body: {} }];
    const m = mount(sellerNudgedView());
    fire(m.button('Nudge mira.k')!, new MouseEvent('click', { bubbles: true }));
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

describe('SellerRefund: a refund half done when the view flips to the refund in progress (review I1)', () => {
  it('the signal fails once: once the request is accepted and the view flips, the run resumes and builds exactly once', async () => {
    const e = flakyEscrow({ signal: 1 });
    const m = mount(sellerNudgedView(), { escrow: e.escrow });
    fire(m.button('Cancel and get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(requests).toEqual([{ path: EVENTS, body: { type: 'request-refund' } }]);
    expect(e.calls).toEqual(['signal:trade.refund-request']);
    expect(m.refresh).toHaveBeenCalled();
    // The API accepted request-refund, so the re-read view is settling as auto-refund.
    m.show(sellerRequestedView());
    await settle();
    expect(m.host.textContent).toContain('Refund in progress');
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

  it('the seller cancelled on another device: this screen was rendered but never tapped, so the flip posts no event; it sends the signal and builds once (review item 8)', async () => {
    const m = mount(sellerNudgedView());
    expect(m.button('Cancel and get refund')).not.toBeNull();
    m.show(sellerRequestedView());
    await settle();
    expect(requests).toEqual([]);
    expect(m.calls).toEqual(['signal:trade.refund-request', 'build']);
    expect(m.host.querySelector('[role="alert"]')).toBeNull();
    expect(m.button('Retry')).toBeNull();
  });

  it('a fresh refund view with no run on this device (a reload): the signal and the tx set are asked for again, once per page, never the event', async () => {
    const m = mount(sellerRequestedView());
    await settle();
    expect(requests).toEqual([]);
    expect(m.calls).toEqual(['signal:trade.refund-request', 'build']);
    // The room re-reads the trade: the same done run, nothing again.
    m.show(sellerRequestedView({ serverNow: SERVER_NOW }));
    await settle();
    expect(m.calls).toEqual(['signal:trade.refund-request', 'build']);
    expect(m.button('Retry')).toBeNull();
  });

  it('a Cancel run this page finished before the flip is not sent again', async () => {
    const m = mount(sellerNudgedView());
    fire(m.button('Cancel and get refund')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(m.calls).toEqual(['signal:trade.refund-request', 'build']);
    m.show(sellerRequestedView());
    await settle();
    expect(m.calls).toEqual(['signal:trade.refund-request', 'build']);
    expect(requests).toHaveLength(1);
  });
});

describe("SellerRefund after the cancel (owner 8 Nov: the refund starts at once)", () => {
  it('refund in progress: says the refund started and the trade is complete at 10 confirmations; no actions', async () => {
    const { host, button } = mount(sellerRequestedView());
    await settle();
    expect(host.textContent).toContain('Refund in progress');
    expect(host.textContent).toContain('Your XMR is on its way back');
    expect(host.textContent).toContain('You cancelled after the time to pay. The refund of your 1.250000 XMR to your wallet has started. The trade is complete once it has 10 confirmations.');
    expect(host.textContent).not.toContain('final alert');
    expect(host.querySelector('[role="timer"]')).toBeNull();
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(0);
    expect(button('Cancel and get refund')).toBeNull();
  });

  // Gap 4 (20 Nov, the regtest e2e): the refund is seller-built, so it waits for this device until
  // the moderator has submitted it. The view must say so, and say when the page may close.
  it('refund in progress, this device still signing: says to keep the page open, and that a closed page waits until the trade is opened again on this device', async () => {
    const { escrow } = escrowFake();
    const { host } = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'signing', handedOff: false } });
    await settle();
    const keep = host.querySelector('[data-keep-open]');
    expect(keep?.getAttribute('role')).toBe('status');
    expect(keep?.textContent?.trim()).toBe('Keep this page open while this device signs the refund. If you close it, the refund waits until you open this trade again on this device.');
    expect(host.querySelector('[data-refund-handed-off]')).toBeNull();
    expect(host.textContent).not.toContain('You can close this page');
  });

  // Review m6: idle means this device does not hold the trade's escrow (a second device): it is not
  // needed here, so no keep-open line and no leave warning (SellerConfirm's "not on this device").
  it('refund in progress on a device that does not run the escrow (idle): says to open it on the device it was set up on, never to keep this page open', async () => {
    const { host } = mount(sellerRequestedView());
    await settle();
    expect(host.querySelector('[data-refund-not-here]')?.textContent?.trim()).toBe('This device doesn’t hold this trade’s escrow yet. If you set the trade up on another device, open it there.');
    expect(host.querySelector('[data-keep-open]')).toBeNull();
    expect(host.querySelector('[data-refund-can-close]')).toBeNull();
  });

  // Review M1 a and m2: the moderator's DONE is its report, not a block; "can close" waits for this
  // device's own settle in a block (phase done), so a closed page never meets the after-close rule unproven.
  it("refund in progress, the moderator reported it sent (handedOff) but not yet in a block: keep the page open a few minutes; only phase done says the page may close", async () => {
    const { escrow } = escrowFake();
    const { host } = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'signing', handedOff: true } });
    await settle();
    expect(host.querySelector('[data-refund-handed-off]')?.textContent?.trim()).toBe('The moderator has sent the refund. Keep this page open a few minutes while it confirms.');
    expect(host.querySelector('[data-keep-open]')).toBeNull();
    expect(host.textContent).not.toContain('You can close this page');
    expect(host.textContent).not.toContain('sent to the network');
    const done = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'done', handedOff: true } });
    await settle();
    expect(done.host.querySelector('[data-refund-can-close]')?.textContent?.trim()).toBe('The refund is in a block. You can close this page now.');
    expect(done.host.querySelector('[data-refund-handed-off]')).toBeNull();
    expect(done.host.querySelector('[data-keep-open]')).toBeNull();
  });

  // Review m5: a stopped escrow says which: waiting for this device, no longer needing it, or stopped for good.
  it('refund in progress with the escrow stopped on this device: waiting (Try again), or stopped for good (an integrity error, no Try again)', async () => {
    const { escrow } = escrowFake();
    const retry = vi.fn();
    const m = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'error', error: 'escrow-failed', retryable: true, retry, handedOff: false } });
    await settle();
    expect(m.host.querySelector('[data-keep-open]')).toBeNull();
    expect(m.host.querySelector('[data-refund-can-close]')).toBeNull();
    expect(m.host.querySelector('[data-refund-escrow-stopped]')?.textContent).toBe('The escrow stopped on this device, so the refund is waiting for it.Try again');
    fire(m.button('Try again')!, new MouseEvent('click', { bubbles: true }));
    expect(retry).toHaveBeenCalledTimes(1);
    const stuck = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'error', error: 'escrow-failed', retryable: false, handedOff: false } });
    await settle();
    expect(stuck.host.querySelector('[data-refund-escrow-stopped]')?.hasAttribute('data-for-good')).toBe(true);
    expect(stuck.host.querySelector('[data-refund-escrow-stopped] p')?.textContent).toBe('The escrow on this device stopped for good, so it can’t finish this refund. If the refund doesn’t reach your wallet, open a dispute.');
    expect(stuck.host.textContent).not.toContain('waiting');
    expect(stuck.button('Try again')).toBeNull();
  });

  it("leaving the page asks first (beforeunload) between the tap and handedOff; not once the moderator submitted it, not on a stopped escrow, and not after the view is gone", async () => {
    const leave = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const { escrow } = escrowFake();
    const signing = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'signing', handedOff: false } });
    await settle();
    expect(leave()).toBe(true);
    signing.rerender(
      <MemoryRouter>
        <SellerRefund code={BOARD.code} view={sellerRequestedView()} escrow={{ ...escrow, phase: 'signing', handedOff: true }} refresh={vi.fn(async () => undefined)} serverClock={clockAt(SERVER_NOW)} wide={false} />
      </MemoryRouter>,
    );
    await settle();
    expect(leave()).toBe(false);
    signing.unmount();
    const stopped = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'error', error: 'escrow-failed', handedOff: false } });
    await settle();
    expect(leave()).toBe(false);
    stopped.unmount();
    const waiting = mount(sellerRequestedView(), { escrow: { ...escrow, phase: 'signing', handedOff: false } });
    await settle();
    expect(leave()).toBe(true);
    waiting.unmount();
    expect(leave()).toBe(false);
    // A device that does not run the escrow (idle, review m6) never asks.
    const notHere = mount(sellerRequestedView());
    await settle();
    expect(leave()).toBe(false);
    notHere.unmount();
    // The window-ended view (before the tap) never asks.
    const before = mount(sellerView());
    await settle();
    expect(leave()).toBe(false);
    before.unmount();
  });

  it('refunded: a device whose escrow stopped says so (review M1: it was silent there); a done device says nothing more', async () => {
    const { escrow } = escrowFake();
    const stuck = mount(sellerRefundedView(), { escrow: { ...escrow, phase: 'error', error: 'escrow-failed', retryable: false, handedOff: false } });
    await settle();
    expect(stuck.host.querySelector('[data-refund-escrow-stopped]')?.hasAttribute('data-for-good')).toBe(true);
    expect(stuck.host.querySelector('[data-screen-part="seller-refunded"]')?.getAttribute('data-escrow-phase')).toBe('error');
    const done = mount(sellerRefundedView(), { escrow: { ...escrow, phase: 'done', handedOff: true } });
    await settle();
    expect(done.host.querySelector('[data-refund-escrow-stopped]')).toBeNull();
    expect(done.host.querySelector('[data-keep-open], [data-refund-handed-off]')).toBeNull();
    expect(done.host.querySelector('[data-screen-part="seller-refunded"]')?.getAttribute('data-escrow-phase')).toBe('done');
  });

  it('refunded: counts the refund confirmations from the API, and the trade is complete at 10', async () => {
    const path = `/v1/trades/${encodeURIComponent(BOARD.code)}/confirmations`;
    answers[path] = [{ status: 200, body: { confirmations: 4, target: 10 } }];
    const m = mount(sellerRefundedView());
    await settle();
    expect(m.host.querySelector('[data-refund-confirmations]')?.textContent).toBe('4 of 10 confirmations. The trade is complete at 10.');
    expect(m.host.textContent).toContain('Refund sent');
    answers[path] = [{ status: 200, body: { confirmations: 12, target: 10 } }];
    const done = mount(sellerRefundedView());
    await settle();
    expect(done.host.querySelector('[data-refund-confirmations]')?.textContent).toBe('10 of 10 confirmations. The trade is complete.');
    expect(done.host.textContent).toContain('Trade complete');
  });
});
