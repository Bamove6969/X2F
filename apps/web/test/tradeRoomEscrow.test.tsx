// @vitest-environment happy-dom
// The trade room runs Task 12's real useEscrow (no hook installed) and hands it what the user
// confirmed: the navigation's history state, else the copy the quote or the accept sheet stored
// (quote/confirmed.ts), else nothing (Task 12 then refuses a first start with not-confirmed).
import { act, useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { storeConfirmed, type ConfirmedTrade } from '../src/screens/quote/confirmed.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const deal = { poster: 'buyer' as const, takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n };
const FROM_STATE: ConfirmedTrade = { role: 'seller', ownAddress: '4' + 'A'.repeat(94), deal };
const STORED: ConfirmedTrade = { role: 'seller', ownAddress: '4' + 'C'.repeat(94), deal };

let client: EscrowClient & { start: ReturnType<typeof vi.fn<EscrowClient["start"]>> };

beforeEach(() => {
  sessionStorage.clear();
  client = { start: vi.fn<EscrowClient["start"]>(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined };
  setEscrowClient(client);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404, headers: { 'content-type': 'application/json' } })));
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
});
