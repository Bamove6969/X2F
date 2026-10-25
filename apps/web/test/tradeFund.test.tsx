// @vitest-environment happy-dom
// The trade room with TradeFund (Task 22), rendered against a stubbed API and a fake escrow: the
// escrow check, the security-check danger state, the buyer's waiting room and the funding guard.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { resetFundMarks } from '../src/screens/trade/fund.js';
import { PENDING_ESCROW, setLiveSource, setTradeEscrowHook, type TradeEscrow, type TradeLiveEvent } from '../src/screens/trade/seams.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import '../src/screens/trade/screens.js';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const ADDRESS = '4' + 'A'.repeat(94);
const URI = `monero:${ADDRESS}?tx_amount=1.25`;

const base: TradeView = {
  code: CODE,
  role: 'seller',
  poster: 'buyer',
  state: 'funding',
  counterparty: { displayName: 'mira.k', completedTrades: 3, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [] },
  methodId: 'ZELLE',
  profile: { name: 'Zelle', whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.' },
  amountAtomic: '1250000000000',
  fiatCents: '41250',
  lockedRate: { currency: 'USD', centsPerXmr: '33000' },
  maxFiatCents: '50000',
  grown: null,
  receivedAtomic: '0',
  confirmations: 0,
  releasable: false,
  releasableEtaMin: null,
  funding: { sellerFundsAtomic: '1250000000000', escrowAddress: ADDRESS, uri: URI, walletApp: 'cake' },
  extensions: 0,
  cancelProposedBy: null,
  settling: null,
  dispute: null,
  txHash: null,
  takenAt: '2026-10-25T11:00:00.000Z',
  setupBy: '2026-10-25T11:15:00.000Z',
  fundBy: '2026-10-25T11:40:00.000Z',
  fundingSeenAt: null,
  securedAt: null,
  payBy: null,
  paidAt: null,
  confirmBy: null,
  finalAlertAt: null,
  settleBy: null,
  pausedAt: null,
  closedAt: null,
  nextDeadline: '2026-10-25T11:40:00.000Z',
  serverNow: '2026-10-25T11:11:18.000Z',
};

let current: TradeView | { status: number; error: string } = base;
const posted: unknown[] = [];

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  resetFundMarks();
  localStorage.clear();
  posted.length = 0;
  current = base;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push({ path, body: JSON.parse(String(init.body)) });
        return respond({ ...base, state: 'cancelled' });
      }
      if ('error' in current) return respond({ error: current.error }, current.status);
      return respond(current);
    }),
  );
  setTradeEscrowHook(null);
  setLiveSource(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTradeEscrowHook(null);
  setLiveSource(null);
});

const escrow = (over: Partial<TradeEscrow> = {}): TradeEscrow => ({ ...PENDING_ESCROW, ...over });

async function room(): Promise<HTMLElement> {
  const { host } = render(
    <MemoryRouter initialEntries={[`/trade/${CODE}`]}>
      <Routes>
        <Route path="/trade/:code" element={<TradeRoom />} />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
  return host;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve());
}

const noFundingTraces = (host: HTMLElement) => {
  expect(host.innerHTML).not.toContain(ADDRESS);
  expect(host.innerHTML).not.toContain('monero:');
  expect(host.querySelector('[data-qr]')).toBeNull();
  expect(host.querySelector('[data-wallet-link]')).toBeNull();
};

describe('TradeFund (seller)', () => {
  it('shows the board copy, the counterparty by public name, and the exact amount', async () => {
    const host = await room();
    expect(host.textContent).toContain('Selling to mira.k');
    expect(host.textContent).toContain('mira.k is in. Fund the escrow to lock the trade.');
    expect(host.textContent).toContain('You send to escrow');
    expect(host.textContent).toContain('1.250000 XMR');
    expect(host.textContent).toContain('$412.50 USD');
    expect(host.textContent).toContain('Network fee · set in your wallet');
    expect(host.querySelector('[data-username]')?.textContent).toBe('mira.k');
  });

  it('never shows anything but the display name, even if an older field is also present', async () => {
    current = { ...base, counterparty: { ...base.counterparty, displayName: 'Mira.K_', username: 'secret_login_1' } };
    const host = await room();
    expect(host.textContent).toContain('Selling to Mira.K_');
    expect(host.textContent).not.toContain('secret_login_1');
  });

  it('the taker seller sees no X2F fee; the poster seller sees it', async () => {
    let host = await room();
    expect(host.textContent).not.toContain('X2F fee');
    current = { ...base, poster: 'seller', fee: { atomic: '12500000000' }, funding: { ...base.funding!, sellerFundsAtomic: '1262500000000' } };
    host = await room();
    expect(host.textContent).toContain('Includes X2F fee (1%, your ad)');
    expect(host.textContent).toContain('0.012500 XMR');
    expect(host.textContent).toContain('1.262500 XMR');
  });

  it('when short: "Received 1.000000 of 1.250000 XMR, send the rest"', async () => {
    current = { ...base, receivedAtomic: '1000000000000' };
    const host = await room();
    expect(host.textContent).toContain('Received 1.000000 of 1.250000 XMR, send the rest');
  });

  it('shows the Edge Full Sync tip for an Edge wallet', async () => {
    current = { ...base, funding: { ...base.funding!, walletApp: 'edge' } };
    const host = await room();
    expect(host.textContent).toContain("For best privacy, turn on Full Sync in Edge's Monero settings.");
  });

  it('shows the gift-card warning for a gift-card method', async () => {
    current = { ...base, profile: { ...(base.profile as object), giftCard: true } };
    const host = await room();
    expect(host.textContent).toContain(
      'When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware.',
    );
  });

  it('once the full amount is seen it shows "Escrow funded" and no address, and keeps it so on a stale view', async () => {
    current = { ...base, receivedAtomic: '1250000000000' };
    let host = await room();
    expect(host.textContent).toContain('Escrow funded');
    noFundingTraces(host);
    // A later view that (wrongly) shows the funding details again changes nothing on this device.
    current = base;
    host = await room();
    expect(host.textContent).toContain('Escrow funded');
    noFundingTraces(host);
  });

  it('in securing (funded, funding no longer returned) shows "Escrow funded" with the confirmations', async () => {
    current = { ...base, state: 'securing', funding: null, receivedAtomic: '1250000000000', confirmations: 3 };
    const host = await room();
    expect(host.textContent).toContain('Escrow funded');
    expect(host.textContent).toContain('confirmations 3 of 10');
    noFundingTraces(host);
  });

  it('during setup: "Setting up escrow" and the keep-open bar, no address', async () => {
    current = { ...base, state: 'setup', funding: { ...base.funding!, escrowAddress: null, uri: null }, fundBy: null };
    setTradeEscrowHook(() => escrow({ phase: 'setting-up', keepOpen: true }));
    const host = await room();
    expect(host.textContent).toContain('Setting up escrow');
    expect(host.querySelector('[data-keep-open]')).not.toBeNull();
    noFundingTraces(host);
  });
});

describe('escrow check and the security check', () => {
  it('shows the four check words naming the other trader, on both sides', async () => {
    setTradeEscrowHook(() => escrow({ phase: 'ready', checkWords: ['amber', 'canal', 'violin', 'oxygen'] }));
    let host = await room();
    expect(host.textContent).toContain("Escrow check: four words. They match on mira.k's screen.");
    expect([...host.querySelectorAll('[data-escrow-check] li')].map((l) => l.textContent)).toEqual(['amber', 'canal', 'violin', 'oxygen']);
    current = { ...base, role: 'buyer', funding: null, counterparty: { ...base.counterparty, displayName: 'satoshi_ghost' } };
    host = await room();
    expect(host.textContent).toContain("Escrow check: four words. They match on satoshi_ghost's screen.");
  });

  for (const error of ['participants-mismatch', 'deal-mismatch'] as const) {
    it(`${error}: the danger state, no address, QR or wallet link anywhere`, async () => {
      setTradeEscrowHook(() => escrow({ phase: 'error', error }));
      const host = await room();
      expect(host.textContent).toContain("Security check failed. Don't fund this trade.");
      noFundingTraces(host);
      expect(host.textContent).not.toContain('Fund the escrow');
    });
  }

  it('the buyer cancels from the danger state with buyer-cancel', async () => {
    current = { ...base, role: 'buyer', funding: null };
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'participants-mismatch' }));
    const host = await room();
    const cancel = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    await act(async () => cancel.click());
    await flush();
    expect(posted).toEqual([{ path: `/v1/trades/${CODE}/events`, body: { type: 'buyer-cancel' } }]);
  });
});

describe('the buyer before funding', () => {
  it('shows "Waiting for <seller> to fund" and no address, QR or wallet link', async () => {
    current = { ...base, role: 'buyer', funding: null, counterparty: { ...base.counterparty, displayName: 'satoshi_ghost' } };
    const host = await room();
    expect(host.textContent).toContain('Waiting for satoshi_ghost to fund');
    expect(host.textContent).toContain('$412.50 USD');
    noFundingTraces(host);
  });
});

describe('the room shell', () => {
  it('a 404 shows "Trade not found."', async () => {
    current = { status: 404, error: 'not-found' };
    const host = await room();
    expect(host.textContent).toContain('Trade not found.');
  });

  it('a live trade event for this code re-reads the trade (any spelling of the code); another code does not', async () => {
    let emit: (e: TradeLiveEvent) => void = () => undefined;
    setLiveSource((on) => {
      emit = on;
      return () => undefined;
    });
    const host = await room();
    const calls = () => vi.mocked(fetch).mock.calls.length;
    const before = calls();
    current = { ...base, state: 'securing', funding: null, receivedAtomic: '1250000000000' };
    await act(async () => emit({ type: 'trade', code: 'OTHER-CODE', state: 'securing' }));
    await flush();
    expect(calls()).toBe(before);
    await act(async () => emit({ type: 'trade', code: CODE.replace(/-/g, '').toLowerCase(), state: 'securing' }));
    await flush();
    expect(calls()).toBe(before + 1);
    expect(host.textContent).toContain('Escrow funded');
  });

  it('a state with no screen yet shows a plain status card', async () => {
    current = { ...base, state: 'paid', funding: null };
    const host = await room();
    expect(host.querySelector('[data-trade-state="paid"]')).not.toBeNull();
  });
});
