// @vitest-environment happy-dom
// The buyer's screen while the seller's cancel refund settles (owner 8 Nov, p6-1, p9-2): no final
// alert and no "I've paid" any more; a buyer who paid late can open a dispute at once.
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BOARD, SERVER_NOW, buyerCancelledView } from '../e2e/refundViews.js';
import { SellerCancelled } from '../src/screens/trade/SellerCancelled.js';
import type { RefundEscrow, RefundView } from '../src/screens/trade/refundSlot.js';
import { PENDING_ESCROW } from '../src/screens/trade/seams.js';
import { render } from './render.js';

const escrow: RefundEscrow = { ...PENDING_ESCROW, signal: vi.fn(async () => undefined), buildRefund: vi.fn(async () => undefined), amountAtomic: null };

function mount(view: RefundView) {
  return render(
    <MemoryRouter>
      <SellerCancelled code={view.code} view={view} escrow={escrow} refresh={async () => undefined} serverClock={() => new Date(SERVER_NOW)} wide={false} />
    </MemoryRouter>,
  );
}

describe("SellerCancelled: the buyer's view of the seller's cancel", () => {
  it('says the seller cancelled and the XMR is going back; no I\'ve paid, no countdown, no final alert', () => {
    const { host } = mount(buyerCancelledView());
    const text = host.textContent ?? '';
    for (const s of [
      'Buying from satoshi_ghost',
      'Cancelled by the seller',
      'satoshi_ghost cancelled the trade',
      "The time to pay ended before you tapped I've paid, so the XMR is going back to satoshi_ghost. Please don't send a payment now.",
      'Did you pay already?',
    ]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain('final alert');
    expect(host.querySelector('[role="timer"]')).toBeNull();
    expect([...host.querySelectorAll('button, a')].map((b) => b.textContent)).not.toContain("I've paid");
    for (const u of host.querySelectorAll<HTMLElement>('[data-username]')) expect(u.textContent).toBe('satoshi_ghost');
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Back to my trades');
  });

  it('offers Open dispute at once (p9-2), to the dispute form of this trade', () => {
    const { host } = mount(buyerCancelledView());
    const card = host.querySelector('[data-seller-cancelled-dispute]')!;
    const link = [...card.querySelectorAll('a')].find((a) => a.textContent === 'Open dispute');
    expect(link?.getAttribute('href')).toBe(`/trade/${encodeURIComponent(BOARD.code)}/dispute`);
  });

  it('no dispute entry for a release or a buyer cancel still settling (not this screen\'s case)', () => {
    const { host } = mount(buyerCancelledView({ settling: 'release' }));
    const card = host.querySelector('[data-seller-cancelled-dispute]')!;
    expect([...card.querySelectorAll('a')].map((a) => a.textContent)).not.toContain('Open dispute');
  });
});
