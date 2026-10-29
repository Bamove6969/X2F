// @vitest-environment happy-dom
// The trade room runs Task 12's real useEscrow (no hook installed) and hands it what the user
// confirmed: the navigation's history state, else the copy the quote or the accept sheet stored
// (quote/confirmed.ts), else nothing (Task 12 then refuses a first start with not-confirmed). The
// escrow starts only once the API has shown the trade (landing review Minor 1), and the tab's copy
// is dropped once the escrow has stored the deal (Minor 6).
import { act, useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import type { EscrowStatus } from '../src/escrow/runtime.js';
import { readConfirmed, storeConfirmed, type ConfirmedTrade } from '../src/screens/quote/confirmed.js';
import { sellerView } from '../e2e/refundViews.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const deal = { poster: 'buyer' as const, takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n };
const FROM_STATE: ConfirmedTrade = { role: 'seller', ownAddress: '4' + 'A'.repeat(94), deal };
const STORED: ConfirmedTrade = { role: 'seller', ownAddress: '4' + 'C'.repeat(94), deal };

let client: EscrowClient & { start: ReturnType<typeof vi.fn<EscrowClient["start"]>> };
/** Pushes a status to the room's subscription. */
let push: (s: EscrowStatus) => void = () => undefined;

const IDLE: EscrowStatus = { phase: 'idle', error: null, retryable: false, refusal: null, checkWords: null, keepOpen: false, role: null, amountAtomic: null, fiatCents: null, escrowAddress: null, deal: null, receivedAtomic: null, confirmedAtomic: null };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sessionStorage.clear();
  push = () => undefined;
  client = {
    start: vi.fn<EscrowClient["start"]>(),
    act: vi.fn(async () => {}),
    retry: vi.fn(),
    subscribe: (_code, cb) => {
      push = cb;
      return () => undefined;
    },
  };
  setEscrowClient(client);
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...sellerView(), code: CODE })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setEscrowClient(null);
});

/** Navigates to the room the way the take and the accept sheet do (memory history cannot take bigints in initialEntries). */
function Go({ state }: { state: unknown }) {
  const navigate = useNavigate();
  useEffect(() => void navigate(`/trade/${CODE}`, state === undefined ? {} : { state }), [navigate, state]);
  return null;
}

async function open(state?: unknown): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/go']}>
      <Routes>
        <Route path="/go" element={<Go state={state} />} />
        <Route path="/trade/:code" element={<TradeRoom />} />
      </Routes>
    </MemoryRouter>,
  );
  for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve());
}

describe('the room starts Task 12’s escrow with what the user confirmed', () => {
  it('the navigation’s state wins over a stored copy', async () => {
    storeConfirmed(CODE, STORED);
    await open({ confirmed: FROM_STATE });
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledWith(CODE, FROM_STATE);
  });

  it('with no history state (a reload), the copy stored for this code', async () => {
    storeConfirmed(CODE, STORED);
    storeConfirmed('OTHER-CODE', FROM_STATE);
    await open();
    expect(client.start).toHaveBeenCalledWith(CODE, STORED);
  });

  it('with neither, nothing (the runtime resumes a stored trade or refuses not-confirmed)', async () => {
    await open();
    expect(client.start).toHaveBeenCalledWith(CODE, undefined);
  });

  it('a trade the API does not show this account (404) starts no escrow at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'not-found' }, 404)));
    storeConfirmed(CODE, STORED);
    await open({ confirmed: FROM_STATE });
    expect(client.start).not.toHaveBeenCalled();
  });

  it('a refused read (401) starts no escrow either', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)));
    await open({ confirmed: FROM_STATE });
    expect(client.start).not.toHaveBeenCalled();
  });

  it("drops the tab's stored copy once the escrow has stored the deal, not before", async () => {
    storeConfirmed(CODE, STORED);
    await open();
    await act(async () => push({ ...IDLE, phase: 'setting-up' }));
    expect(readConfirmed(CODE)).toEqual(STORED);
    await act(async () => push({ ...IDLE, phase: 'setting-up', deal }));
    expect(readConfirmed(CODE)).toBeNull();
  });
});
