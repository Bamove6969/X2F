// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD, SERVER_NOW, buyerAlertView } from '../e2e/refundViews.js';
import { FinalAlert, setFinalAlertPaidSheet, type PaidSheetProps } from '../src/screens/trade/FinalAlert.js';
import type { RefundView } from '../src/screens/trade/refundSlot.js';
import { PENDING_ESCROW } from '../src/screens/trade/seams.js';
import { advance, fire, render } from './render.js';

const MIN = 60_000;

let requests: string[];
beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      requests.push(path);
      return new Response(null, { status: 204 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setFinalAlertPaidSheet(null);
});

const escrow = { ...PENDING_ESCROW, signal: vi.fn(async () => undefined), buildRefund: vi.fn(async () => undefined), amountAtomic: null };

function mount(view: RefundView, clock: () => Date) {
  const r = render(
    <MemoryRouter>
      <FinalAlert code={view.code} view={view} escrow={escrow} refresh={async () => undefined} serverClock={clock} wide={false} />
    </MemoryRouter>,
  );
  const paid = () => [...r.host.querySelectorAll('button')].find((b) => b.textContent === "I've paid")!;
  return { ...r, paid };
}

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
};

describe('FinalAlert (buyer, refund_requested)', () => {
  it('shows the danger alert, the seller by public name and I have paid as the one primary', () => {
    const { host, paid } = mount(buyerAlertView(), () => new Date(SERVER_NOW));
    expect(host.textContent).toContain(`Buying from ${BOARD.seller}`);
    expect(host.querySelector('[data-username]')?.textContent).toBe(BOARD.seller);
    const chip = host.querySelector('.x2f-final-alert__chip')!;
    expect(chip.textContent).toBe("The seller is cancelling. If you already paid, tap I've paid now.");
    expect(chip.querySelector('svg')).not.toBeNull();
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toBe(paid());
    expect(paid().disabled).toBe(false);
  });

  it('counts down 15 minutes on the server clock, with the device clock 10 min ahead', () => {
    vi.useFakeTimers({ now: Date.parse(SERVER_NOW) + 10 * MIN });
    const offset = -10 * MIN;
    const { host } = mount(buyerAlertView(), () => new Date(Date.now() + offset));
    expect(host.querySelector('[role="timer"]')?.textContent).toBe('15 min 0 s');
    advance(61_000, vi);
    expect(host.querySelector('[role="timer"]')?.textContent).toBe('13 min 59 s');
  });

  it("once the 15 minutes are over, I've paid is refused (too-late) and says why", () => {
    vi.useFakeTimers({ now: Date.parse(SERVER_NOW) + 15 * MIN - 2000 });
    const { host, paid } = mount(buyerAlertView(), () => new Date(Date.now()));
    expect(paid().disabled).toBe(false);
    advance(3000, vi);
    expect(paid().disabled).toBe(true);
    expect(host.textContent).toContain('The 15 minutes have passed.');
    expect(host.querySelector('[role="timer"]')?.textContent).toBe('0 s');
  });

  it("while maintenance pauses the trade the countdown stops, and I've paid still goes through", () => {
    const { host, paid } = mount(buyerAlertView({ pausedAt: SERVER_NOW, nextDeadline: null }), () => new Date(Date.parse(SERVER_NOW) + 20 * MIN));
    expect(host.querySelector('[role="timer"]')).toBeNull();
    expect(paid().disabled).toBe(false);
  });

  it("I've paid opens the paid sheet (Task 23's PaidConfirmSheet) with the trade", () => {
    const seen: PaidSheetProps[] = [];
    setFinalAlertPaidSheet((p: PaidSheetProps) => {
      seen.push(p);
      return p.open ? <div data-testid="paid-sheet" /> : null;
    });
    const { host, paid } = mount(buyerAlertView(), () => new Date(SERVER_NOW));
    expect(host.querySelector('[data-testid="paid-sheet"]')).toBeNull();
    fire(paid(), new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('[data-testid="paid-sheet"]')).not.toBeNull();
    expect(seen.at(-1)?.view.code).toBe(BOARD.code);
    act(() => seen.at(-1)!.onClose());
    expect(host.querySelector('[data-testid="paid-sheet"]')).toBeNull();
  });

  it('tells the API the alert was seen, once, only while the page is visible', async () => {
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { rerender } = mount(buyerAlertView(), () => new Date(SERVER_NOW));
    await settle();
    expect(requests).toEqual([]);
    vis.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    const seen = `/v1/trades/${encodeURIComponent(BOARD.code)}/final-alert-seen`;
    expect(requests).toEqual([seen]);
    rerender(
      <MemoryRouter>
        <FinalAlert code={buyerAlertView().code} view={buyerAlertView()} escrow={escrow} refresh={async () => undefined} serverClock={() => new Date(SERVER_NOW)} wide={false} />
      </MemoryRouter>,
    );
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(requests).toEqual([seen]);
    vis.mockRestore();
  });
});
