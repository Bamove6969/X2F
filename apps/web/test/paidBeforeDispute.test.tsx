// @vitest-environment happy-dom
// Paid on the server, not recorded on the buyer's device (the tab closed between the API's
// mark-paid and the device's markPaid): the device has no fixed amount, so it could never co-sign a
// ruling (runtime I1/I7 fail closed). The buyer gets "Finish marking as paid" before any dispute, at
// every web entry point: the paid room (buyerPay.test.tsx) and the /trade/:code/dispute route (here).
// UI only: the API still takes the dispute, and the seller's side is unchanged.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EscrowStatus } from '../src/escrow/runtime.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { DisputeScreen } from '../src/screens/dispute/DisputeScreen.js';
import { disputeNeedsFinish } from '../src/screens/trade/payModel.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const MIN = 60_000;
const at = (ms: number) => new Date(Date.parse(SERVER_NOW) + ms).toISOString();
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The buyer's paid trade, its confirm window over (so the machine would take a dispute now). */
const view = sellerView({ role: 'buyer', poster: 'seller', state: 'paid', paidAt: at(-120 * MIN), confirmBy: at(-30 * MIN), nextDeadline: null });

/** This device's escrow for the trade: the buyer's, the amount the trade shows. */
const device = (over: Partial<EscrowStatus> = {}): EscrowStatus => ({
  phase: 'ready',
  error: null,
  retryable: false,
  refusal: null,
  checkWords: null,
  keepOpen: false,
  role: 'buyer',
  amountAtomic: 1_250_000_000_000n,
  fiatCents: 41_250n,
  escrowAddress: null,
  deal: null,
  methodId: null,
  paymentInstructions: null,
  instructionsMismatch: false,
  receivedAtomic: null,
  confirmedAtomic: null,
  paidRecorded: false,
  intentKind: null,
  handedOff: false,
  ...over,
});

describe('disputeNeedsFinish: no dispute while Finish can fix the device', () => {
  const paid = { role: 'buyer', state: 'paid', amountAtomic: '1250000000000', fiatCents: '41250' };

  it('paid on the server, not on this device, Finish can run: Finish first', () => {
    expect(disputeNeedsFinish(paid, device({ refusal: 'amount-unknown' }))).toBe(true);
    // Still recording the tap, or the escrow not loaded yet: no dispute in that gap either.
    expect(disputeNeedsFinish(paid, device({ refusal: null }))).toBe(true);
  });

  it('recorded on this device (the normal paid trade, or after Finish): the dispute as before', () => {
    expect(disputeNeedsFinish(paid, device({ paidRecorded: true }))).toBe(false);
    expect(disputeNeedsFinish(paid, device({ paidRecorded: true, refusal: 'amount-unknown' }))).toBe(false);
  });

  it('Finish cannot run on this device: the dispute stays (the lines there say to open one if it does not clear)', () => {
    expect(disputeNeedsFinish(paid, device({ refusal: 'view-mismatch' }))).toBe(false);
    expect(disputeNeedsFinish(paid, device({ phase: 'error', error: 'escrow-failed' }))).toBe(false);
    // A total the device can't confirm (finishBlock's no-amount / amount-differs / total-wrong).
    expect(disputeNeedsFinish(paid, device({ refusal: 'amount-unknown', fiatCents: null }))).toBe(false);
    expect(disputeNeedsFinish({ ...paid, fiatCents: '43313' }, device({ refusal: 'amount-unknown' }))).toBe(false);
  });

  it('only the buyer, only in paid, only on a buyer record: the seller and other states are unchanged', () => {
    expect(disputeNeedsFinish({ ...paid, role: 'seller' }, device({ refusal: 'amount-unknown' }))).toBe(false);
    expect(disputeNeedsFinish(paid, device({ refusal: 'amount-unknown', role: 'seller' }))).toBe(false);
    for (const state of ['secured', 'disputed', 'refunded', 'settling']) expect(disputeNeedsFinish({ ...paid, state }, device({ refusal: 'amount-unknown' }))).toBe(false);
  });
});

let fetchMock: ReturnType<typeof vi.fn>;
let started: string[];
let status: EscrowStatus | null;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/dispute') && init?.method === 'POST') return jsonResponse({ error: 'unexpected' }, 500);
    if (u.endsWith('/dispute')) return jsonResponse({ error: 'not-found' }, 404);
    if (u.endsWith(`/v1/trades/${view.code}`)) return jsonResponse(view);
    return jsonResponse({ error: 'not-found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  started = [];
  status = null;
  const client: EscrowClient = {
    start: (code) => void started.push(code),
    act: async () => undefined,
    retry: () => undefined,
    subscribe: (_code, cb) => {
      if (status) cb(status);
      return () => undefined;
    },
  };
  setEscrowClient(client);
});
afterEach(() => {
  setEscrowClient(null);
  vi.unstubAllGlobals();
});

async function screen(): Promise<HTMLElement> {
  const { host } = render(
    <MemoryRouter initialEntries={[`/trade/${view.code}/dispute`]}>
      <Routes>
        <Route path="/trade/:code/dispute" element={<DisputeScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  return host;
}

const openButton = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('footer button')].find((b) => b.textContent === 'Open dispute')!;

describe('/trade/:code/dispute: the buyer finishes marking as paid before opening a dispute', () => {
  it('paid on the server, not recorded on this device: the form is locked, Finish leads back to the trade room, nothing is posted', async () => {
    status = device({ refusal: 'amount-unknown' });
    const host = await screen();
    const finish = host.querySelector('[data-part="dispute-finish-first"]');
    expect(finish, host.textContent ?? '').not.toBeNull();
    expect(finish!.textContent).toContain("Your device hasn't recorded your payment. Finish marking as paid first, then you can open a dispute.");
    const link = [...finish!.querySelectorAll('a')].find((a) => a.textContent === 'Finish marking as paid')!;
    expect(link.getAttribute('href')).toBe(`/trade/${view.code}`);
    expect(openButton(host).disabled).toBe(true);
    expect(host.querySelector<HTMLFieldSetElement>('fieldset.dispute-reasons')!.disabled).toBe(true);
    await act(async () => openButton(host).click());
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
    // Subscribe only: the route never starts the escrow (a second handle).
    expect(started).toEqual([]);
  });

  it('after Finish (the device recorded it), and on a normal paid trade: the dispute form as before', async () => {
    status = device({ paidRecorded: true });
    const host = await screen();
    expect(host.querySelector('[data-part="dispute-finish-first"]')).toBeNull();
    expect(openButton(host).disabled).toBe(false);
  });

  it('no record of the trade on this device (another device, a team member): the form as before, this device cannot tell', async () => {
    status = null;
    const host = await screen();
    expect(host.querySelector('[data-part="dispute-finish-first"]')).toBeNull();
    expect(openButton(host).disabled).toBe(false);
  });

  it('the seller of the same paid trade: unchanged', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/dispute')) return jsonResponse({ error: 'not-found' }, 404);
      return jsonResponse({ ...view, role: 'seller', poster: 'buyer' });
    });
    status = device({ role: 'seller', refusal: 'amount-unknown' });
    const host = await screen();
    expect(host.querySelector('[data-part="dispute-finish-first"]')).toBeNull();
    expect(openButton(host).disabled).toBe(false);
  });
});
