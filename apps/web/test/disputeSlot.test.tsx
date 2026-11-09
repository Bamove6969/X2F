// @vitest-environment happy-dom
// Task 27's trade-room slots (Task 22's registerTradeScreen): both traders in `disputed` get
// DisputeSlot (room or ruling, from GET …/dispute only), the buyer in `refunded` gets RefundedSlot
// with the 48-hour "Open a dispute" (TIMERS.disputeAfterRefundHours, lead 2026-10-29). The slots never fetch the trade itself.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverClock } from '../src/api/client.js';
import { methodOf, type TradeView } from '../src/api/trade.js';
import { DisputeSlot, RefundedSlot } from '../src/screens/dispute/DisputeSlot.js';
import { DO_NOT_PAY, mustNotPay } from '../src/screens/dispute/DoNotPay.js';
import { PENDING_ESCROW } from '../src/screens/trade/seams.js';
import '../src/screens/trade/screens.js';
import { screenFor, type TradeScreenProps } from '../src/screens/trade/TradeRoom.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(Date.parse(SERVER_NOW) + ms).toISOString();
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const disputedView = (over: Partial<TradeView> = {}): TradeView =>
  sellerView({ state: 'disputed', dispute: { by: 'buyer', at: at(-60 * MIN) }, ...over }) as TradeView;

const openDispute = (over: Record<string, unknown> = {}) => ({
  openedBy: 'buyer',
  reason: 'paid',
  openedAt: at(-60 * MIN),
  afterRefund: false,
  dueAt: null,
  status: 'open',
  moderator: null,
  ruling: null,
  appeal: null,
  serverNow: SERVER_NOW,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
let disputeAnswer: () => Response;
beforeEach(() => {
  disputeAnswer = () => jsonResponse(openDispute());
  fetchMock = vi.fn(async (url: string) => (String(url).endsWith('/dispute') ? disputeAnswer() : jsonResponse({ error: 'not-found' }, 404)));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const props = (view: TradeView, refresh = vi.fn(async () => undefined)): TradeScreenProps => ({
  code: view.code,
  view,
  escrow: PENDING_ESCROW,
  refresh,
  serverClock: serverClock(view.serverNow),
  wide: false,
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('Task 27 registers its slots in the trade room', () => {
  it('both sides in disputed get DisputeSlot; the buyer in refunded gets RefundedSlot, the seller nothing', () => {
    const now = Date.parse(SERVER_NOW);
    expect(screenFor(disputedView(), now)).toBe(DisputeSlot);
    expect(screenFor(disputedView({ role: 'buyer' }), now)).toBe(DisputeSlot);
    expect(screenFor(sellerView({ role: 'buyer', state: 'refunded', closedAt: at(-DAY) }) as TradeView, now)).toBe(RefundedSlot);
    expect(screenFor(sellerView({ state: 'refunded', closedAt: at(-DAY) }) as TradeView, now)).toBeNull();
  });
});

describe('DisputeSlot', () => {
  it('shows the dispute room from GET …/dispute only, with the public display name, never fetching the trade', async () => {
    const { host } = render(
      <MemoryRouter>
        <DisputeSlot {...props(disputedView())} />
      </MemoryRouter>,
    );
    await settle();
    expect(host.textContent).toContain('In dispute');
    expect(host.querySelector('[data-username]')?.textContent).toBe(sellerView().counterparty.displayName);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    // The dispute record, and the room's chat (Task 20's POST /v1/trades/:code/chat); never the trade itself.
    for (const u of urls) expect(u).toMatch(/\/v1\/trades\/[^/]+\/(?:dispute|chat)$/);
    expect(urls.some((u) => /\/dispute$/.test(u))).toBe(true);
    // The room's back link goes to the trader's list, not back to the room itself.
    expect(host.querySelector('a[href="/sell"]')).not.toBeNull();
  });

  it("p11-16: the seller's dispute before \"I've paid\": the buyer's I've paid is greyed out and a pop-up says not to send money", async () => {
    disputeAnswer = () => jsonResponse(openDispute({ openedBy: 'seller' }));
    const v = disputedView({ role: 'buyer', paidAt: null, dispute: { by: 'seller', at: at(-1 * MIN) } });
    expect(mustNotPay(v)).toBe(true);
    const { host } = render(
      <MemoryRouter>
        <DisputeSlot {...props(v)} />
      </MemoryRouter>,
    );
    await settle();
    const name = v.counterparty.displayName;
    const paid = [...host.querySelectorAll('button')].find((b) => b.textContent === "I've paid");
    expect(paid?.disabled).toBe(true);
    // Design's words (ea2a9ca8), COPY-UNSIGNED.
    expect(host.textContent).toContain(`Paused: ${name} opened a dispute. Don't send any payment.`);
    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('DISPUTE OPENED');
    expect(dialog?.textContent).toContain("Don't send any payment");
    expect(dialog?.textContent).toContain(
      `${name} opened a dispute and a moderator has been called in. Don't send money to ${name} by ${methodOf(v).name} or any other way. "I've paid" is paused until the moderator tells you what happens next.`,
    );
    expect(dialog?.querySelector(`a[href="/trade/${v.code}/dispute"]`)?.textContent).toBe(DO_NOT_PAY.toDispute);
    const gotIt = [...dialog!.querySelectorAll('button')].find((b) => b.textContent === "Got it, I won't pay")!;
    act(() => gotIt.click());
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    // The greyed button and its line stay.
    expect(host.textContent).toContain('Paused:');
  });

  it('p11-16: the payer gets it whoever opened the dispute; never the seller, never after I\'ve paid', () => {
    const base = { paidAt: null, dispute: { by: 'seller' as const, at: at(-1 * MIN) } };
    expect(mustNotPay(disputedView({ ...base, role: 'seller' }))).toBe(false);
    expect(mustNotPay(disputedView({ ...base, role: 'buyer', paidAt: at(-30 * MIN) }))).toBe(false);
    expect(mustNotPay(disputedView({ ...base, role: 'buyer', dispute: { by: 'buyer', at: at(-1 * MIN) } }))).toBe(true);
    expect(mustNotPay(disputedView({ ...base, role: 'buyer', dispute: { by: 'system', at: at(-1 * MIN) } }))).toBe(true);
    expect(DO_NOT_PAY.paused('X2F')).toBe("Paused: X2F opened a dispute. Don't send any payment.");
  });

  it('a disputed trade with no dispute record yet still shows the room, never the open form', async () => {
    disputeAnswer = () => jsonResponse({ error: 'not-found' }, 404);
    const { host } = render(
      <MemoryRouter>
        <DisputeSlot {...props(disputedView({ dispute: { by: 'system', at: at(-5 * MIN) } }))} />
      </MemoryRouter>,
    );
    await settle();
    expect(host.textContent).toContain('In dispute');
    expect(host.textContent).not.toContain('Open a dispute');
  });

  it('re-reads the dispute each time the room hands it a fresh view (live event, poll, refresh)', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <DisputeSlot {...props(disputedView())} />
      </MemoryRouter>,
    );
    await settle();
    const before = fetchMock.mock.calls.length;
    rerender(
      <MemoryRouter>
        <DisputeSlot {...props(disputedView())} />
      </MemoryRouter>,
    );
    await settle();
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it('shows the ruling once there is one, with the appeal form while its window is open', async () => {
    const ruling = {
      round: 1,
      outcome: 'release-to-buyer',
      reason: 'The payment is in the seller\'s activity.',
      evidence: ['The trade chat'],
      moderatorName: 'sarah.v',
      ruledAt: at(-30 * MIN),
      appealUntil: at(47 * 60 * MIN),
      destination: null,
    };
    disputeAnswer = () => jsonResponse(openDispute({ status: 'ruled', ruling }));
    const refresh = vi.fn(async () => undefined);
    const { host } = render(
      <MemoryRouter>
        <DisputeSlot {...props(disputedView(), refresh)} />
      </MemoryRouter>,
    );
    await settle();
    expect(host.textContent).toContain('sarah.v');
    expect(host.textContent).toContain('Appeal this ruling');
  });
});

describe('RefundedSlot (the buyer, spec 2.3 dispute after refund)', () => {
  const refunded = (over: Partial<TradeView> = {}) => sellerView({ role: 'buyer', state: 'refunded', closedAt: at(-10 * 60 * MIN), ...over }) as TradeView;

  it('offers "Open a dispute" within 48 hours of the refund (owner 2026-10-29), linking to the dispute page', () => {
    const { host } = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded())} />
      </MemoryRouter>,
    );
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Open a dispute');
    expect(link?.getAttribute('href')).toBe(`/trade/${encodeURIComponent(refunded().code)}/dispute`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers nothing after 48 hours, and the way to the dispute once one was opened', () => {
    const late = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded({ closedAt: at(-48 * 60 * MIN - 1) }))} />
      </MemoryRouter>,
    );
    expect(late.host.textContent).not.toContain('Open a dispute');
    const had = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded({ dispute: { by: 'buyer', at: at(-20 * DAY) } }))} />
      </MemoryRouter>,
    );
    expect(had.host.textContent).toContain('Go to the dispute');
  });
  it('says why the XMR went back to the seller, for every kind of refund (owner 2026-10-29)', () => {
    const cases: [Partial<TradeView>, string, string][] = [
      [{ settling: 'buyer-cancel', cancelConfirmedAt: at(-9 * DAY) }, 'You cancelled this trade', 'You cancelled'],
      [{ settling: 'buyer-cancel' }, 'Cancelling: returning the XMR to the seller', 'The trade is cancelled once the seller confirms'],
      [{ settling: 'auto-refund' }, 'The payment time ran out', 'Payment time ran out, the seller cancelled; everything in escrow went back to the original owner.'],
      [{ settling: 'mutual-cancel' }, 'You both cancelled this trade', 'agreed to cancel'],
      [{ settling: 'lapse-refund' }, 'The funding time ran out', "wasn't fully funded in time"],
      // A moderator's refund to the seller is built as mutual-cancel: the dispute decides the reason.
      [{ settling: 'mutual-cancel', dispute: { by: 'buyer', at: at(-20 * DAY) } }, 'Refunded by the dispute decision', 'A moderator decided'],
      [{ settling: 'auto-refund', dispute: { by: 'system', at: at(-20 * DAY) } }, 'Refunded by the dispute decision', 'A moderator decided'],
    ];
    for (const [over, title, text] of cases) {
      const { host } = render(
        <MemoryRouter>
          <RefundedSlot {...props(refunded(over))} />
        </MemoryRouter>,
      );
      expect(host.querySelector('h1')?.textContent, JSON.stringify(over)).toBe(title);
      expect(host.textContent).toContain(text);
      // The 48-hour line only while a dispute can still be opened: never after a cancel (owner 2026-10-29, question 4).
      const cancel = over.dispute === undefined && (over.settling === 'buyer-cancel' || over.settling === 'mutual-cancel');
      expect(host.textContent.includes('you can still open a dispute')).toBe(over.dispute === undefined && !cancel);
    }
  });

  it('the buyer\'s own cancel, done: board Refunded variant=buyer-cancelled (a neutral CANCELLED chip, "You cancelled this trade"), never "Refunded"', () => {
    const counterparty = { ...sellerView().counterparty, displayName: 'satoshi_ghost' };
    const { host } = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded({ settling: 'buyer-cancel', cancelConfirmedAt: at(-9 * DAY), counterparty }))} />
      </MemoryRouter>,
    );
    const chip = host.querySelector('.x2f-chip')!;
    expect(chip.getAttribute('data-tone')).toBe('neutral');
    expect(chip.textContent).toBe('Cancelled');
    expect(host.querySelector('h1')?.textContent).toBe('You cancelled this trade');
    // "the seller", never the name (owner 2026-10-29; lead 8 Nov).
    expect(host.querySelector('.dispute-lead')?.textContent).toBe('All 1.250000 XMR (about $412.50) went back to the seller. X2F took nothing from you.');
    expect(host.querySelector('[aria-label="Trade status"]')?.textContent).not.toContain('satoshi_ghost');
    expect(host.textContent).not.toContain('Refunded');
  });

  it("review I1: a cancel's refund that landed after I've paid keeps the dispute and is not called a cancel", () => {
    for (const settling of ['buyer-cancel', 'mutual-cancel'] as const) {
      const { host } = render(
        <MemoryRouter>
          <RefundedSlot {...props(refunded({ settling, paidAt: at(-11 * 60 * MIN) }))} />
        </MemoryRouter>,
      );
      expect(host.querySelector('h1')?.textContent).toBe('The XMR went back to the seller after you paid');
      expect([...host.querySelectorAll('a')].filter((a) => a.textContent === 'Open a dispute'), settling).toHaveLength(1);
      expect(host.textContent).not.toContain('Cancelling');
    }
  });

  it('the dispute window line names its end (48 hours after the refund)', () => {
    const { host } = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded({ settling: 'auto-refund' }))} />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-dispute-window]')?.textContent).toContain('for 48 hours after the refund, until');
  });

  it("a cancel itself can't be disputed (owner 2026-10-29, question 4): no Open a dispute after a cancel's refund; a no-show refund keeps it", () => {
    for (const settling of ['buyer-cancel', 'mutual-cancel'] as const) {
      const { host } = render(
        <MemoryRouter>
          <RefundedSlot {...props(refunded({ settling, cancelConfirmedAt: at(-9 * DAY) }))} />
        </MemoryRouter>,
      );
      expect([...host.querySelectorAll('a')].filter((a) => a.textContent === 'Open a dispute'), settling).toHaveLength(0);
      expect(host.textContent).not.toContain('Did you pay before you cancelled?');
    }
    const noShow = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded({ settling: 'auto-refund' }))} />
      </MemoryRouter>,
    );
    expect([...noShow.host.querySelectorAll('a')].filter((a) => a.textContent === 'Open a dispute')).toHaveLength(1);
  });
});
