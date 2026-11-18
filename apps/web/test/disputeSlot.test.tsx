// @vitest-environment happy-dom
// Task 27's trade-room slots (Task 22's registerTradeScreen): both traders in `disputed` get
// DisputeSlot (room or ruling, from GET …/dispute only), the buyer in `refunded` gets RefundedSlot
// with the 48-hour "Open a dispute" (TIMERS.disputeAfterRefundHours, lead 2026-10-29). The slots never fetch the trade itself.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverClock } from '../src/api/client.js';
import { methodOf, type TradeView } from '../src/api/trade.js';
import { DisputeSlot } from '../src/screens/dispute/DisputeSlot.js';
import { RefundedSlot } from '../src/screens/trade/Refunded.js';
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

describe('DisputeSlot: the seller proves a seller-sends-xmr payment (Plan 4 Task 12, A6)', () => {
  const ruling = {
    round: 1,
    outcome: 'seller-sends-xmr',
    reason: "The buyer's payment reached the seller after the refund.",
    evidence: ['The trade chat'],
    moderatorName: 'sarah.v',
    ruledAt: at(-30 * MIN),
    appealUntil: at(47 * 60 * MIN),
    destination: null,
  };
  const ATTESTED = { address: '4AttestedBuyerAddressXyz', amountAtomic: 1_250_000_000_000n };

  it('the form shows only the address and amount the escrow verified in the attested terms, and posts the proof', async () => {
    disputeAnswer = () => jsonResponse(openDispute({ status: 'ruled', afterRefund: true, ruling, complyBy: at(23 * 60 * MIN) }));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/payment-proof')) return jsonResponse({ status: 'accepted', confirmations: 10 });
      return String(url).endsWith('/dispute') ? disputeAnswer() : jsonResponse({ error: 'not-found' }, 404);
    });
    const refresh = vi.fn(async () => undefined);
    const { host } = render(
      <MemoryRouter>
        <DisputeSlot {...{ ...props(disputedView(), refresh), escrow: { ...PENDING_ESCROW, restitution: ATTESTED } }} />
      </MemoryRouter>,
    );
    await settle();
    const form = host.querySelector('[aria-label="Transfer proof"]')!;
    expect(form).not.toBeNull();
    expect(form.querySelector('[data-part="pay-address"]')!.textContent).toBe(ATTESTED.address);
    expect(form.querySelector('[data-part="pay-amount"]')!.textContent).toBe('1.250000 XMR');
    const [hash, key] = [...form.querySelectorAll<HTMLInputElement>('input')];
    for (const [el, v] of [[hash!, 'c'.repeat(64)], [key!, 'd'.repeat(128)]] as const) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => {
      form.querySelector<HTMLButtonElement>('button')!.click();
    });
    await settle();
    const post = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/payment-proof'))!;
    expect(String(post[0])).toContain(`/v1/trades/${disputedView().code}/payment-proof`);
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ txHash: 'c'.repeat(64), txKey: 'd'.repeat(128) });
    expect(refresh).toHaveBeenCalled();
    expect(host.querySelector('[data-part="tx-proof-sent"]')!.textContent).toContain('Payment proven');
  });

  it('review B1: the attested amount differs from the trade amount the server checks against (a grown trade): no form, and the server amount is never shown as the sum to send', async () => {
    disputeAnswer = () => jsonResponse(openDispute({ status: 'ruled', afterRefund: true, ruling, complyBy: at(23 * 60 * MIN) }));
    for (const amountAtomic of [1_200_000_000_000n, 1_300_000_000_000n]) {
      const { host } = render(
        <MemoryRouter>
          <DisputeSlot {...{ ...props(disputedView()), escrow: { ...PENDING_ESCROW, restitution: { ...ATTESTED, amountAtomic } } }} />
        </MemoryRouter>,
      );
      await settle();
      expect(host.textContent).toContain('You must send');
      expect(host.querySelector('[aria-label="Transfer proof"]')).toBeNull();
      expect(host.querySelector('[data-part="pay-amount"]')).toBeNull();
      expect(host.querySelector('[data-part="pay-address"]')).toBeNull();
    }
    // The control: the same view with the matching attested amount does show the form.
    const ok = render(
      <MemoryRouter>
        <DisputeSlot {...{ ...props(disputedView()), escrow: { ...PENDING_ESCROW, restitution: ATTESTED } }} />
      </MemoryRouter>,
    );
    await settle();
    expect(ok.host.querySelector('[aria-label="Transfer proof"]')).not.toBeNull();
  });

  it('a refused proof says why; with no attested terms on this device there is no form at all', async () => {
    disputeAnswer = () => jsonResponse(openDispute({ status: 'ruled', afterRefund: true, ruling, complyBy: at(23 * 60 * MIN) }));
    const none = render(
      <MemoryRouter>
        <DisputeSlot {...props(disputedView())} />
      </MemoryRouter>,
    );
    await settle();
    expect(none.host.textContent).toContain('You must send');
    expect(none.host.querySelector('[aria-label="Transfer proof"]')).toBeNull();

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/payment-proof')) return jsonResponse({ error: 'proof-invalid' }, 409);
      return String(url).endsWith('/dispute') ? disputeAnswer() : jsonResponse({ error: 'not-found' }, 404);
    });
    const { host } = render(
      <MemoryRouter>
        <DisputeSlot {...{ ...props(disputedView()), escrow: { ...PENDING_ESCROW, restitution: ATTESTED } }} />
      </MemoryRouter>,
    );
    await settle();
    const form = host.querySelector('[aria-label="Transfer proof"]')!;
    const [hash, key] = [...form.querySelectorAll<HTMLInputElement>('input')];
    for (const [el, v] of [[hash!, 'c'.repeat(64)], [key!, 'd'.repeat(64)]] as const) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => {
      form.querySelector<HTMLButtonElement>('button')!.click();
    });
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('do not show this amount paid to this address');
  });
});

describe('RefundedSlot (the buyer, spec 2.3 dispute after refund)', () => {
  const refunded = (over: Partial<TradeView> = {}) => sellerView({ role: 'buyer', state: 'refunded', closedAt: at(-10 * 60 * MIN), ...over }) as TradeView;
  // "the seller", never the name, on refund and cancel results (owner 2026-10-29; lead 8 Nov).
  const S = 'the seller';

  it('offers "Open dispute" within 48 hours of the refund (owner 2026-10-29), linking to the dispute page', () => {
    const { host } = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded())} />
      </MemoryRouter>,
    );
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Open dispute');
    expect(link?.getAttribute('href')).toBe(`/trade/${encodeURIComponent(refunded().code)}/dispute`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers nothing after 48 hours, and the way to the dispute once one was opened', () => {
    const late = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded({ closedAt: at(-48 * 60 * MIN - 1) }))} />
      </MemoryRouter>,
    );
    expect(late.host.textContent).not.toContain('Open dispute');
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
      [{ settling: 'buyer-cancel' }, `Cancelling: returning the XMR to ${S}`, `The trade is cancelled once ${S} confirms`],
      // The Refunded board's time-ran-out variant (design review 48), naming the seller.
      // The owner's Decision 7 wording (review M2), naming the seller, with the design session's ending (2 Nov).
      [{ settling: 'auto-refund' }, 'Payment time ran out', `Payment time ran out, ${S} cancelled; everything in escrow went back to the original owner. X2F took nothing from you. If you already sent the payment, open a dispute below.`],
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
      expect(host.querySelector('[data-dispute-window]') !== null).toBe(over.dispute === undefined && !cancel);
    }
  });

  it('the Refunded board (design review 48): the chip, What happened with UTC times, the amount, Charged to you, the outlined dispute, Find another offer', () => {
    const v = refunded({ settling: 'auto-refund' });
    const { host } = render(
      <MemoryRouter>
        <RefundedSlot {...props(v)} />
      </MemoryRouter>,
    );
    expect(host.querySelector('.x2f-chip')?.textContent).toBe('Payment time ran out');
    // The board's hero, now the kit Hero (design review P1-7; kit 4, lead 8 Nov "the kit wins"): the
    // neutral (ink-muted) tone, the chip and key mark, the h1 and lead, then Trade amount and X2F fee
    // in its raised box (no longer in What happened).
    const hero = host.querySelector('[data-part="refunded-hero"]')!;
    expect([hero.className, hero.getAttribute('data-tone'), hero.getAttribute('data-kind')]).toEqual(['x2f-hero', 'neutral', 'result']);
    expect(hero.querySelector('.x2f-chip')?.getAttribute('data-look')).toBe('tint');
    expect(hero.querySelector('[data-part="key-mark"]')).not.toBeNull();
    expect(hero.querySelector('h1.x2f-hero__headline')?.textContent).toBe('Payment time ran out');
    expect(hero.querySelector('.x2f-hero__lead')).not.toBeNull();
    const amount = [...hero.querySelectorAll('[data-part="refunded-amount"] > div')].map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent]);
    expect(amount).toEqual([
      ['Trade amount', '1.250000 XMR $412.50'],
      ['X2F fee', 'None'],
    ]);
    // Standard 7 (design review P1-6): mono digits in ink, the unit apart; the dispute card's number too.
    expect(hero.querySelector('.x2f-hero__amount .x2f-num[data-ink="true"]')?.textContent).toBe('1.250000');
    expect(hero.querySelector('.x2f-hero__amount .x2f-xmr__unit')?.textContent).toBe('XMR');
    expect(host.querySelector('[data-part="refunded-dispute"] .x2f-xmr .x2f-num[data-ink="true"]')?.textContent).toBe('1.250000');
    const facts = [...host.querySelectorAll('[data-part="refunded-facts"] > li')].map((r) => [r.querySelector('.x2f-steps-line__text > span')!.textContent, r.querySelector('time')!.textContent]);
    const keys = facts.map(([k]) => k);
    expect(keys).not.toContain('Trade amount');
    expect(keys).not.toContain('X2F fee');
    expect(keys).toContain(`Refund sent to ${S}`);
    // The board's timeline (design review P2-20): the day on the right of the heading, a dot per row.
    expect(host.querySelector('#refunded-what')?.textContent).toBe('What happened');
    expect(host.querySelector('[data-part="refunded-day"]')?.textContent).toMatch(/^\d+ \w{3} \d{4}$/);
    const what = host.querySelector('[data-part="refunded-what"]')!;
    expect(what.className).toBe('x2f-outcome-card');
    expect(what.querySelector('ol')?.className).toBe('x2f-steps-line');
    expect(what.querySelector('ol')?.getAttribute('data-tone')).toBe('muted');
    expect(what.querySelectorAll('li .x2f-steps-line__mark[aria-hidden="true"]')).toHaveLength(facts.length);
    expect(keys.at(-1)).toBe(`Refund sent to ${S}`);
    // The result never names them (the trade header's "Buying from …" is the room's title, not the result).
    for (const part of ['refunded-hero', 'refunded-what', 'refunded-dispute']) {
      expect(host.querySelector(`[data-part="${part}"]`)?.textContent, part).not.toContain(sellerView().counterparty.displayName);
    }
    // Every time is the one format: "HH:MM UTC" under a dated head, or the full "D Mon YYYY, HH:MM UTC".
    for (const [k, val] of facts) expect(val, k!).toMatch(/^(\d+ \w{3} \d{4}, )?\d\d:\d\d UTC$/);
    const dispute = host.querySelector('[data-part="refunded-dispute"]')!;
    expect(dispute.querySelector('h2')?.textContent).toBe('Did you send the money anyway?');
    // Lead review 2026-11-06 m3: a moderator rules, the screen does not promise the outcome.
    expect(dispute.textContent).toContain('a moderator can rule that they owe you the 1.250000 XMR. Until they pay it back, they can\'t trade.');
    expect(dispute.textContent).not.toContain('makes them');
    // A danger text button with a chevron (design session 2 Nov); Find another offer stays the primary.
    expect(dispute.querySelector('a.x2f-button--danger')?.textContent).toBe('Open dispute');
    expect(dispute.querySelector('a.x2f-button--danger svg')).not.toBeNull();
    expect(host.querySelector('footer a[data-primary]')?.textContent).toBe('Find another offer');
    // Design review P2-18, P2-19: back goes to the trades, and "Back to my trades" sits under the primary.
    expect(host.querySelector('a[aria-label="Back to trades"]')?.getAttribute('href')).toBe('/trades');
    const trades = host.querySelector('footer [data-part="refunded-trades"]')!;
    expect([trades.textContent, trades.getAttribute('href'), trades.className]).toEqual(['Back to my trades', '/trades', 'x2f-button x2f-button--tertiary']);
  });

  it('the hero takes the moderator tone after a dispute decided the refund, and caution while a cancel is returned', () => {
    const cases: [Partial<TradeView>, string][] = [
      [{ settling: 'mutual-cancel', dispute: { by: 'buyer', at: at(-20 * DAY) } }, 'mod'],
      [{ settling: 'buyer-cancel' }, 'caution'],
      [{ settling: 'buyer-cancel', cancelConfirmedAt: at(-9 * DAY) }, 'neutral'],
    ];
    for (const [over, tone] of cases) {
      const { host, unmount } = render(
        <MemoryRouter>
          <RefundedSlot {...props(refunded(over))} />
        </MemoryRouter>,
      );
      expect(host.querySelector('[data-part="refunded-hero"]')?.getAttribute('data-tone'), JSON.stringify(over)).toBe(tone);
      unmount();
    }
  });

  it('"X2F fee: None" on every refund, paid first or not (design session 2 Nov; was "Charged to you: Nothing")', () => {
    for (const over of [{ settling: 'auto-refund' as const }, { settling: 'mutual-cancel' as const, paidAt: at(-11 * 60 * MIN) }]) {
      const { host } = render(
        <MemoryRouter>
          <RefundedSlot {...props(refunded(over))} />
        </MemoryRouter>,
      );
      expect(host.textContent).toContain('X2F fee');
      expect(host.textContent).not.toContain('Charged to you');
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
    expect(host.querySelector('.x2f-hero__lead')?.textContent).toBe('All 1.250000 XMR (about $412.50) went back to the seller. X2F took nothing from you.');
    expect(host.querySelector('[data-part="refunded-hero"]')?.textContent).not.toContain('satoshi_ghost');
    expect(host.textContent).not.toContain('Refunded');
  });

  it("review I1: a cancel's refund that landed after I've paid keeps the dispute and is not called a cancel", () => {
    for (const settling of ['buyer-cancel', 'mutual-cancel'] as const) {
      const { host } = render(
        <MemoryRouter>
          <RefundedSlot {...props(refunded({ settling, paidAt: at(-11 * 60 * MIN) }))} />
        </MemoryRouter>,
      );
      expect(host.querySelector('h1')?.textContent).toBe(`The XMR went back to ${S} after you paid`);
      expect([...host.querySelectorAll('a')].filter((a) => a.textContent === 'Open dispute'), settling).toHaveLength(1);
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
      expect([...host.querySelectorAll('a')].filter((a) => a.textContent === 'Open dispute'), settling).toHaveLength(0);
      expect(host.textContent).not.toContain('Did you pay before you cancelled?');
    }
    const noShow = render(
      <MemoryRouter>
        <RefundedSlot {...props(refunded({ settling: 'auto-refund' }))} />
      </MemoryRouter>,
    );
    expect([...noShow.host.querySelectorAll('a')].filter((a) => a.textContent === 'Open dispute')).toHaveLength(1);
  });
});

describe('the Refunded board styles (design review P1-7, P2-20)', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => {
    const at = css.indexOf(`${sel} {`);
    expect(at, sel).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('the result hero is the kit Hero (hero.css, kit 4.1/4.3): 24/20/20, gap 20, the wash to 160 px; the h1 is the result headline', () => {
    const kit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/hero.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const kitRule = (sel: string) => {
      const at = kit.indexOf(`${sel} {`);
      expect(at, sel).toBeGreaterThanOrEqual(0);
      return kit.slice(at, kit.indexOf('}', at));
    };
    const hero = kitRule(".x2f-hero[data-kind='result']");
    expect(hero).toContain('padding: var(--x2f-space-6) var(--x2f-space-5) var(--x2f-space-5)');
    expect(hero).toContain('gap: var(--x2f-space-5)');
    expect(hero).toContain('var(--x2f-surface) 160px');
    expect(kitRule('.x2f-hero__headline')).toContain('font-family: var(--x2f-result-headline-family)');
    expect(css).not.toContain('.x2f-hero');
  });

  it('the timeline: 12 px ringed dots joined by a 2 px line, the last dot filled in the tone and its row at 600', () => {
    const dot = rule('.x2f-steps-line__mark::before');
    expect(dot).toContain('width: 12px');
    expect(dot).toContain('border: 2px solid var(--x2f-line)');
    expect(rule('.x2f-steps-line__mark::after')).toContain('background: var(--x2f-surface-raised)');
    expect(rule('.x2f-steps-line > li:last-child .x2f-steps-line__mark::before')).toContain('background: var(--x2f-steps-tone)');
    expect(rule('.x2f-steps-line > li:last-child .x2f-steps-line__text')).toContain('font-weight: 600');
    expect(rule('.x2f-steps-line__text')).toContain('padding-bottom: var(--x2f-space-4)');
  });
});
