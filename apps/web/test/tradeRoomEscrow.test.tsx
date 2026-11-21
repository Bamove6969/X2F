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
import { registerTradeScreen, TradeRoom, type TradeScreenProps } from '../src/screens/trade/TradeRoom.js';
import { methodOf } from '../src/api/trade.js';
import { MEMBER_TRADE_COPY } from '../src/screens/settings/teamCopy.js';
import { refreshSession } from '../src/session/useSession.js';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const deal = { poster: 'buyer' as const, takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n };
const FROM_STATE: ConfirmedTrade = { role: 'seller', ownAddress: '4' + 'A'.repeat(94), deal };
const STORED: ConfirmedTrade = { role: 'seller', ownAddress: '4' + 'C'.repeat(94), deal };

let client: EscrowClient & { start: ReturnType<typeof vi.fn<EscrowClient["start"]>> };
/** Pushes a status to the room's subscription. */
let push: (s: EscrowStatus) => void = () => undefined;

const IDLE: EscrowStatus = { phase: 'idle', error: null, retryable: false, refusal: null, checkWords: null, keepOpen: false, role: null, amountAtomic: null, fiatCents: null, escrowAddress: null, deal: null, methodId: null, paymentInstructions: null, instructionsMismatch: false, receivedAtomic: null, confirmedAtomic: null, paidRecorded: false, intentKind: null, handedOff: false };
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

async function open(state?: unknown): Promise<ReturnType<typeof render>> {
  const r = render(
    <MemoryRouter initialEntries={['/go']}>
      <Routes>
        <Route path="/go" element={<Go state={state} />} />
        <Route path="/trade/:code" element={<TradeRoom />} />
      </Routes>
    </MemoryRouter>,
  );
  for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve());
  return r;
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

describe('a view whose code is another trade’s (Task 24 round-3 review, Important 1)', () => {
  const OTHER = 'Z3H8-6RNB-2DWC-5JTE';
  const STATES = ['setup', 'funding', 'securing', 'secured', 'paid', 'settling', 'released', 'disputed'] as const;

  it('fails closed in every state and role: no slot, no escrow start, a refusal', async () => {
    const shown: string[] = [];
    const Spy = ({ view }: TradeScreenProps) => {
      shown.push(view.state);
      return <p data-spy="">slot</p>;
    };
    const off = STATES.map((s) => registerTradeScreen({ owner: 'test', role: 'any', states: [s], when: () => true, screen: Spy }));
    try {
      for (const role of ['seller', 'buyer'] as const) {
        for (const state of STATES) {
          vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...sellerView(), role, state, code: OTHER })));
          const r = await open({ confirmed: FROM_STATE });
          expect(r.host.querySelector('[data-spy]')).toBeNull();
          expect(r.host.querySelector('[role=alert]')!.textContent).toContain('X2F answered with a different trade');
          r.unmount();
        }
      }
      expect(shown).toEqual([]);
      expect(client.start).not.toHaveBeenCalled();
    } finally {
      off.forEach((f) => f());
    }
  });

  it('the same code written differently (lower case, no dashes) is the same trade', async () => {
    const off = registerTradeScreen({ owner: 'test', role: 'any', states: ['funding'], when: () => true, screen: () => <p data-spy="">slot</p> });
    try {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...sellerView(), state: 'funding', code: CODE.toLowerCase().replace(/-/g, '') })));
      const r = await open();
      expect(r.host.querySelector('[data-spy]')).not.toBeNull();
    } finally {
      off();
    }
  });
});

describe('a team member’s device (Plan 2 Task 18, review I1/I2)', () => {
  it('never starts the escrow, even with a stored copy, and says the owner’s device does it', async () => {
    storeConfirmed(CODE, STORED);
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url === '/v1/account/me'
        ? jsonResponse({ kind: 'trader', level: 'full', displayName: 'Calcium', member: { name: 'Aurora', roles: ['trades'] } })
        : jsonResponse({ ...sellerView(), code: CODE })));
    refreshSession();
    try {
      const r = await open({ confirmed: FROM_STATE });
      for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve());
      expect(r.host.querySelector('[data-member]')).not.toBeNull();
      expect(r.host.textContent).toContain(MEMBER_TRADE_COPY.roomWaiting);
      expect(client.start).not.toHaveBeenCalled();
    } finally {
      refreshSession();
    }
  });
});

// Review M2 (instr-hash, lead's call): the trade screens show the method of the attested id, named
// from the bundled catalog, never the API's own method id or profile name.
describe('the method the screens show is the attested one', () => {
  it('the API view says PayPal (id and profile name); the escrow attested Zelle: the screen gets Zelle', async () => {
    const seen: Array<{ id: string; name: string; profile: unknown }> = [];
    const Spy = ({ view }: TradeScreenProps) => {
      seen.push({ id: view.methodId, name: methodOf(view).name, profile: view.profile });
      return <p data-spy="">{methodOf(view).name}</p>;
    };
    const off = registerTradeScreen({ owner: 'test', role: 'any', states: ['secured'], when: () => true, screen: Spy });
    try {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...sellerView(), code: CODE, methodId: 'PAYPAL', profile: { name: 'PayPal', whatItIs: 'PayPal: x', giftCard: false } })));
      const r = await open({ confirmed: FROM_STATE });
      await act(async () => push({ ...IDLE, phase: 'ready', methodId: 'ZELLE' }));
      expect(r.host.querySelector('[data-spy]')!.textContent).toBe('Zelle');
      expect(seen.at(-1)).toMatchObject({ id: 'ZELLE', name: 'Zelle', profile: null });
    } finally {
      off();
    }
  });

  it('the name comes from the catalog by id, not from the profile the API sends', () => {
    expect(methodOf({ methodId: 'ZELLE', profile: { name: 'PayPal' } }).name).toBe('Zelle');
    expect(methodOf({ methodId: 'AMAZON_GIFT_CARD', profile: null }).name).toBe('Amazon gift card');
    // An id the catalog does not know is shown as the id itself (as before).
    expect(methodOf({ methodId: 'NOT_A_METHOD', profile: { name: 'PayPal' } }).name).toBe('NOT_A_METHOD');
  });
});
