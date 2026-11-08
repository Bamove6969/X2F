// @vitest-environment happy-dom
// The trade room with TradeFund (Task 22), rendered against a stubbed API and a fake escrow: the
// escrow check, the security-check danger state, the buyer's waiting room and the funding guard.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moneroUri } from '@x2f/trade';
import type { TradeView } from '../src/api/trade.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasFundMark, resetFundMarks } from '../src/screens/trade/fund.js';
import { qrPath } from '../src/screens/trade/FundFallback.js';
import { liveFanOut, PENDING_ESCROW, setLiveSource, setTradeEscrowHook, type TradeEscrow, type TradeLiveEvent } from '../src/screens/trade/seams.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import '../src/screens/trade/screens.js';
import { advance, pointer, render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const ADDRESS = '4' + 'A'.repeat(94);
const URI = `monero:${ADDRESS}?tx_amount=1.25`;
const ATTACKER = '4' + 'B'.repeat(94);
const WORDS = ['amber', 'canal', 'violin', 'oxygen'];
const DEAL_TERMS = { currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n };
const TAKER_DEAL = { poster: 'buyer' as const, takeAmountAtomic: 1_250_000_000_000n, ...DEAL_TERMS };
const POSTER_DEAL = { poster: 'seller' as const, takeAmountAtomic: 1_250_000_000_000n, ...DEAL_TERMS };
const verified = (over: Partial<TradeEscrow> = {}) => escrow({ phase: 'ready', checkWords: WORDS, escrowAddress: ADDRESS, deal: TAKER_DEAL, ...over });

const base: TradeView = {
  code: CODE,
  role: 'seller',
  poster: 'buyer',
  state: 'funding',
  counterparty: { displayName: 'mira.k', completedTrades: 3, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [], stage: 'graduated' },
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
  fundStartedAt: null,
  securedAt: null,
  payBy: null,
  paidAt: null,
  confirmBy: null,
  disputeOpensAt: null,
  disputeWaitMin: 90,
  finalAlertAt: null,
  finalAlertSeenAt: null,
  settleBy: null,
  pausedAt: null,
  closedAt: null,
  cancelConfirmedAt: null,
  cancelConfirmableAt: null,
  sellerNudgedAt: null,
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
  // This device derived ADDRESS and has its check words (the verified state funding needs).
  setTradeEscrowHook(() => verified());
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
    current = { ...base, counterparty: { ...base.counterparty, displayName: 'Mira.K_', ...{ username: 'secret_login_1' } } };
    const host = await room();
    expect(host.textContent).toContain('Selling to Mira.K_');
    expect(host.textContent).not.toContain('secret_login_1');
  });

  it('the taker seller sees no X2F fee; the poster seller sees it', async () => {
    let host = await room();
    expect(host.textContent).not.toContain('X2F fee');
    current = { ...base, poster: 'seller', fee: { atomic: '12500000000' }, funding: { ...base.funding!, sellerFundsAtomic: '1262500000000' } };
    setTradeEscrowHook(() => verified({ deal: POSTER_DEAL }));
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

  it('once the full amount is seen (1+ confirmations) it shows "Escrow funded" and no address, and keeps it so on a stale view', async () => {
    current = { ...base, receivedAtomic: '1250000000000', confirmations: 1 };
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
    setTradeEscrowHook(() => verified());
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

describe('funding shows only the address this device verified', () => {
  const footer = () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Use another wallet'));

  it('the wallet link and QR are built on this device from the verified address and the exact amount', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 });
    const host = await room();
    expect(host.querySelector('[data-wallet-link]')?.getAttribute('href')).toBe(moneroUri(ADDRESS, 1_250_000_000_000n));
    await act(async () => footer()!.click());
    expect(host.querySelector('[data-escrow-address]')?.textContent).toBe(ADDRESS);
    expect(host.querySelector('[data-qr]')).not.toBeNull();
  });

  it("a tampered server uri is never used or shown", async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 });
    current = { ...base, funding: { ...base.funding!, uri: `monero:${ATTACKER}?tx_amount=99` } };
    const host = await room();
    await act(async () => footer()!.click());
    expect(host.innerHTML).not.toContain(ATTACKER);
    expect(host.innerHTML).not.toContain('tx_amount=99');
    expect(host.querySelector('[data-wallet-link]')?.getAttribute('href')).toBe(moneroUri(ADDRESS, 1_250_000_000_000n));
  });

  it('an API address that differs from the device-derived one: the danger state, and NO address, link or QR (either one)', async () => {
    current = { ...base, funding: { ...base.funding!, escrowAddress: ATTACKER, uri: `monero:${ATTACKER}?tx_amount=1.25` } };
    const host = await room();
    expect(host.textContent).toContain("Security check failed. Don't fund this trade.");
    noFundingTraces(host);
    expect(host.innerHTML).not.toContain(ATTACKER);
  });

  it('an inflated server amount: the danger state and no address, link, QR or copy text', async () => {
    current = { ...base, funding: { ...base.funding!, sellerFundsAtomic: '12500000000000', uri: `monero:${ADDRESS}?tx_amount=12.5` } };
    const host = await room();
    expect(host.textContent).toContain("Security check failed. Don't fund this trade.");
    noFundingTraces(host);
    expect(host.textContent).not.toContain('12.5');
  });

  it('an API that says the seller posted (fee added) when this device took the ad: the danger state', async () => {
    current = { ...base, poster: 'seller', fee: { atomic: '12500000000' }, funding: { ...base.funding!, sellerFundsAtomic: '1262500000000' } };
    const host = await room();
    expect(host.textContent).toContain("Security check failed. Don't fund this trade.");
    noFundingTraces(host);
  });

  it('the seller-poster funds amount + 1% worked out on the device: link and copy carry 1.2625', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 });
    current = { ...base, poster: 'seller', fee: { atomic: '12500000000' }, funding: { ...base.funding!, sellerFundsAtomic: '1262500000000' } };
    setTradeEscrowHook(() => verified({ deal: POSTER_DEAL }));
    const host = await room();
    expect(host.querySelector('[data-wallet-link]')?.getAttribute('href')).toBe(moneroUri(ADDRESS, 1_262_500_000_000n));
    expect(host.textContent).toContain('1.2625 XMR filled in');
    const copied: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => void copied.push(t) } });
    await act(async () => footer()!.click());
    const copyAmount = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Copy amount')!;
    await act(async () => copyAmount.click());
    await flush();
    expect(copied).toEqual(['1.2625']);
  });

  for (const [name, e] of [
    ['idle (runtime not wired)', {}],
    ['registering', { phase: 'registering', keepOpen: true }],
    ['verifying', { phase: 'verifying', keepOpen: true }],
    ['setting up', { phase: 'setting-up', keepOpen: true }],
    ['ready without check words', { phase: 'ready', escrowAddress: ADDRESS }],
    ['ready without a derived address', { phase: 'ready', checkWords: WORDS, deal: TAKER_DEAL }],
    ['ready without the device deal', { phase: 'ready', checkWords: WORDS, escrowAddress: ADDRESS }],
    ['a retryable error', { phase: 'error', error: 'escrow-failed', retryable: true, escrowAddress: ADDRESS, checkWords: WORDS }],
    ['an unsupported browser', { phase: 'error', error: 'unsupported-browser' }],
    ['not confirmed on this device', { phase: 'error', error: 'not-confirmed' }],
    ['a non-retryable escrow failure', { phase: 'error', error: 'escrow-failed', retryable: false }],
  ] as [string, Partial<TradeEscrow>][]) {
    it(`${name}: no address, link or QR, only setup status`, async () => {
      setTradeEscrowHook(() => escrow(e));
      const host = await room();
      noFundingTraces(host);
      expect(host.innerHTML).not.toContain(ATTACKER);
      expect(host.querySelector('[data-setup-status]')).not.toBeNull();
      expect(host.textContent).not.toContain('Open in');
    });
  }
});

describe('non-retryable escrow errors are said, never endless setup (review 2026-10-27, I3)', () => {
  it('unsupported-browser: its own sentence, no "Setting up escrow", no keep-open bar', async () => {
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'unsupported-browser' }));
    const host = await room();
    expect(host.textContent).toContain("This browser can't run the escrow. Open the trade in an up-to-date browser.");
    expect(host.textContent).not.toContain('Setting up escrow');
    expect(host.querySelector('[data-keep-open]')).toBeNull();
    expect(host.textContent).not.toContain('Try again');
  });

  it('not-confirmed: "Open this trade from the device you started it on."', async () => {
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'not-confirmed' }));
    const host = await room();
    expect(host.textContent).toContain('Open this trade from the device you started it on.');
    expect(host.textContent).not.toContain('Setting up escrow');
    expect(host.querySelector('[data-keep-open]')).toBeNull();
  });

  it('a non-retryable escrow-failed before "Fund escrow": the seller walks away alone (walk-away, Revision 2026-10-29b)', async () => {
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'escrow-failed', retryable: false }));
    const host = await room();
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Propose cancel')).toBeUndefined();
    const cancel = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    await act(async () => cancel.click());
    await flush();
    expect(posted).toEqual([{ path: `/v1/trades/${CODE}/events`, body: { type: 'walk-away' } }]);
  });

  it('copying the escrow address records "Fund escrow" (fund-started)', async () => {
    const copied: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => void copied.push(t) } });
    const host = await room();
    const copy = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Copy address')!;
    await act(async () => copy.click());
    await flush();
    expect(copied).toEqual([ADDRESS]);
    expect(posted).toEqual([{ path: `/v1/trades/${CODE}/events`, body: { type: 'fund-started' } }]);
  });

  it('a non-retryable escrow-failed after "Fund escrow": the cancel path (the seller proposes a cancel)', async () => {
    current = { ...base, fundStartedAt: '2026-10-25T11:59:00.000Z' };
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'escrow-failed', retryable: false }));
    const host = await room();
    expect(host.textContent).toContain("The escrow can't be set up on this device.");
    expect(host.querySelector('[data-keep-open]')).toBeNull();
    expect(host.textContent).not.toContain('Try again');
    const cancel = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Propose cancel')!;
    await act(async () => cancel.click());
    await flush();
    expect(posted).toEqual([{ path: `/v1/trades/${CODE}/events`, body: { type: 'propose-cancel' } }]);
  });

  it('a non-retryable escrow-failed for the buyer: the cancel path with buyer-cancel', async () => {
    current = { ...base, role: 'buyer', funding: null };
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'escrow-failed', retryable: false }));
    const host = await room();
    const cancel = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    await act(async () => cancel.click());
    await flush();
    expect(posted).toEqual([{ path: `/v1/trades/${CODE}/events`, body: { type: 'buyer-cancel' } }]);
  });

  it('a retryable error keeps "Try again" and drops the keep-open bar (error !== null)', async () => {
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'escrow-failed', retryable: true, keepOpen: true }));
    const host = await room();
    expect(host.textContent).toContain('Try again');
    expect(host.querySelector('[data-keep-open]')).toBeNull();
  });
});

describe("the seller's cancel on the danger screen is a proposal (review 2026-10-27, Minor 4)", () => {
  it('after "Fund escrow" it is labelled "Propose cancel", and afterwards says the buyer must accept', async () => {
    // Before the tap the seller may still walk away alone (walk-away, Revision 2026-10-29b; tested above).
    current = { ...base, fundStartedAt: '2026-10-25T11:59:00.000Z' };
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'participants-mismatch' }));
    let host = await room();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Propose cancel')).toBe(true);
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Cancel')).toBe(false);
    current = { ...base, fundStartedAt: '2026-10-25T11:59:00.000Z', cancelProposedBy: 'seller' };
    host = await room();
    expect(host.textContent).toContain('Cancel proposed, waiting for the buyer');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Propose cancel')).toBe(false);
  });

  it("the buyer's button stays \"Cancel\"", async () => {
    current = { ...base, role: 'buyer', funding: null };
    setTradeEscrowHook(() => escrow({ phase: 'error', error: 'participants-mismatch' }));
    const host = await room();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Cancel')).toBe(true);
  });
});

describe('the hold opens the wallet on the release, inside the pointerup (review 2026-10-27, I2)', () => {
  afterEach(() => vi.useRealTimers());

  it('touch-style: pointerdown, 1.5 s pass (nothing opens, "Release to open"), pointerup clicks the link once', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 });
    const host = await room();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const link = host.querySelector<HTMLAnchorElement>('[data-wallet-link]')!;
    const clicks: string[] = [];
    link.addEventListener('click', (e) => {
      e.preventDefault();
      clicks.push(e.type);
    });
    const button = host.querySelector<HTMLButtonElement>('button.x2f-hold')!;
    expect(button.textContent).toContain('Open in Cake Wallet');
    pointer(button, 'pointerdown');
    advance(1500, vi);
    expect(clicks).toEqual([]);
    expect(button.textContent).toContain('Release to open');
    expect(button.textContent).toContain('Open in Cake Wallet');
    advance(10_000, vi);
    expect(clicks).toEqual([]);
    let clickedWithinPointerup = false;
    const probe = () => {
      clickedWithinPointerup = clicks.length === 1;
    };
    document.addEventListener('pointerup', probe);
    pointer(button, 'pointerup');
    document.removeEventListener('pointerup', probe);
    expect(clicks).toEqual(['click']);
    expect(clickedWithinPointerup).toBe(true);
    expect(button.textContent).toContain('Waiting for your payment…');
    expect(hasFundMark(CODE, 'opened')).toBe(true);
    // Once per trade: a second hold and release does nothing more.
    pointer(button, 'pointerdown');
    advance(1500, vi);
    pointer(button, 'pointerup');
    expect(clicks).toEqual(['click']);
  });

  it('a release before 1.5 s opens nothing and leaves the hold available', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 });
    const host = await room();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const link = host.querySelector<HTMLAnchorElement>('[data-wallet-link]')!;
    let clicks = 0;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      clicks++;
    });
    const button = host.querySelector<HTMLButtonElement>('button.x2f-hold')!;
    pointer(button, 'pointerdown');
    advance(1000, vi);
    pointer(button, 'pointerup');
    expect(clicks).toBe(0);
    expect(hasFundMark(CODE, 'opened')).toBe(false);
    expect(button.textContent).toContain('Open in Cake Wallet');
    expect(button.textContent).toContain('Press and hold');
  });
});

describe('after a short payment the seller funds only the remainder (review 2026-10-27, I1)', () => {
  const phone = () => vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 });
  const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')];
  const footer = (host: HTMLElement) => buttons(host).find((b) => b.textContent?.includes('Use another wallet'));

  it('this device saw 1.0 of 1.25: the link, QR and "Copy amount" carry 0.25, and tx_amount=1.25 appears nowhere', async () => {
    phone();
    current = { ...base, receivedAtomic: '1000000000000' };
    setTradeEscrowHook(() => verified({ receivedAtomic: 1_000_000_000_000n }));
    const host = await room();
    expect(host.textContent).toContain('Received 1.000000 of 1.250000 XMR, send the rest');
    expect(host.querySelector('[data-wallet-link]')?.getAttribute('href')).toBe(moneroUri(ADDRESS, 250_000_000_000n));
    expect(host.textContent).toContain('0.25 XMR filled in');
    expect(host.innerHTML).not.toContain('tx_amount=1.25');
    const copied: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => void copied.push(t) } });
    await act(async () => footer(host)!.click());
    expect(host.textContent).toContain('Send the rest: 0.250000 XMR');
    expect(host.textContent).not.toContain('Send exactly this amount');
    expect(host.querySelector('[data-qr]')).not.toBeNull();
    expect(host.innerHTML).not.toContain('tx_amount=1.25');
    await act(async () => buttons(host).find((b) => b.textContent === 'Copy amount')!.click());
    await flush();
    expect(copied).toEqual(['0.25']);
  });

  it('the API says 1.0 arrived but this device has no reading yet: the address and "Send the rest", no link, QR or amount to copy', async () => {
    phone();
    current = { ...base, receivedAtomic: '1000000000000' };
    setTradeEscrowHook(() => verified({ receivedAtomic: null }));
    const host = await room();
    expect(host.querySelector('[data-wallet-link]')).toBeNull();
    expect(host.querySelector('[data-qr]')).toBeNull();
    expect(host.innerHTML).not.toContain('tx_amount');
    expect(host.textContent).not.toContain('Open in');
    expect(host.querySelector('[data-escrow-address]')?.textContent).toBe(ADDRESS);
    expect(host.textContent).toContain('Send the rest: 0.250000 XMR');
    expect(buttons(host).find((b) => b.textContent === 'Copy amount')).toBeUndefined();
    expect(buttons(host).find((b) => b.textContent === 'Copy address')).toBeDefined();
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('this device saw nothing yet while the API says 1.0 arrived: the same, no full-amount link or QR', async () => {
    phone();
    current = { ...base, receivedAtomic: '1000000000000' };
    setTradeEscrowHook(() => verified({ receivedAtomic: 0n }));
    const host = await room();
    expect(host.querySelector('[data-wallet-link]')).toBeNull();
    expect(host.querySelector('[data-qr]')).toBeNull();
    expect(host.innerHTML).not.toContain('tx_amount');
    expect(host.querySelector('[data-escrow-address]')?.textContent).toBe(ADDRESS);
  });

  it('this device saw 1.0 while the API still says 0: the remainder rules (the device reading is the truth)', async () => {
    setTradeEscrowHook(() => verified({ receivedAtomic: 1_000_000_000_000n }));
    const host = await room();
    expect(host.textContent).toContain('Send the rest: 0.250000 XMR');
    expect(host.innerHTML).not.toContain('tx_amount=1.25');
    expect(host.querySelector('[data-qr]')).not.toBeNull();
  });
});

describe('review 2026-10-27 minors', () => {
  const phone = () => vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 });

  it("Minor 1: the fee line is this device's escrowPlan figure, whatever fee the API sends", async () => {
    current = { ...base, poster: 'seller', fee: { atomic: '1' }, funding: { ...base.funding!, sellerFundsAtomic: '1262500000000' } };
    setTradeEscrowHook(() => verified({ deal: POSTER_DEAL }));
    const host = await room();
    const row = [...host.querySelectorAll('.x2f-quote-row')].find((r) => r.textContent?.includes('X2F fee'))!;
    expect(row.textContent).toContain('0.012500 XMR');
    expect(row.textContent).not.toContain('0.000000000001');
    expect(row.getAttribute('data-fee-check')).toBe('differs');
  });

  it('Minor 1: with the API fee equal to the device figure the cross-check is ok', async () => {
    current = { ...base, poster: 'seller', fee: { atomic: '12500000000' }, funding: { ...base.funding!, sellerFundsAtomic: '1262500000000' } };
    setTradeEscrowHook(() => verified({ deal: POSTER_DEAL }));
    const host = await room();
    const row = [...host.querySelectorAll('.x2f-quote-row')].find((r) => r.textContent?.includes('X2F fee'))!;
    expect(row.getAttribute('data-fee-check')).toBe('ok');
  });

  it('Minor 2: an API 0-conf full payment shows "Escrow funded" but sets no mark; when the API goes back to funding, so does the screen', async () => {
    current = { ...base, receivedAtomic: '1250000000000', confirmations: 0 };
    let host = await room();
    expect(host.textContent).toContain('Escrow funded');
    noFundingTraces(host);
    current = { ...base, receivedAtomic: '0' };
    host = await room();
    expect(host.textContent).not.toContain('Escrow funded');
    expect(host.querySelector('[data-escrow-address]')?.textContent).toBe(ADDRESS);
  });

  it('Minor 2: with confirmations >= 1 the mark is set and survives a stale view', async () => {
    current = { ...base, receivedAtomic: '1250000000000', confirmations: 1 };
    let host = await room();
    expect(host.textContent).toContain('Escrow funded');
    current = base;
    host = await room();
    expect(host.textContent).toContain('Escrow funded');
    noFundingTraces(host);
  });

  it("Minor 2: this device's own 0-conf reading shows \"Escrow funded\" but sets no mark; when that reading goes, so does the screen", async () => {
    setTradeEscrowHook(() => verified({ receivedAtomic: 1_250_000_000_000n, confirmedAtomic: 0n }));
    let host = await room();
    expect(host.textContent).toContain('Escrow funded');
    noFundingTraces(host);
    expect(hasFundMark(CODE, 'funded')).toBe(false);
    setTradeEscrowHook(() => verified({ receivedAtomic: 0n, confirmedAtomic: 0n }));
    host = await room();
    expect(host.textContent).not.toContain('Escrow funded');
    expect(host.querySelector('[data-escrow-address]')?.textContent).toBe(ADDRESS);
  });

  it("Minor 2: this device's CONFIRMED balance covering the funding sets the mark, whatever the API says", async () => {
    setTradeEscrowHook(() => verified({ receivedAtomic: 1_250_000_000_000n, confirmedAtomic: 1_250_000_000_000n }));
    let host = await room();
    expect(host.textContent).toContain('Escrow funded');
    expect(hasFundMark(CODE, 'funded')).toBe(true);
    setTradeEscrowHook(() => verified());
    host = await room();
    expect(host.textContent).toContain('Escrow funded');
    noFundingTraces(host);
  });

  it('Minor 3: while the API is in funding but this device is still setting up, the fundBy countdown shows', async () => {
    setTradeEscrowHook(() => escrow({ phase: 'setting-up', keepOpen: true }));
    const host = await room();
    expect(host.textContent).toContain('Setting up escrow');
    expect(host.querySelector('[role="timer"]')).not.toBeNull();
  });

  it('Minor 3: in setup (no fundBy yet) there is no countdown', async () => {
    current = { ...base, state: 'setup', funding: { ...base.funding!, escrowAddress: null, uri: null }, fundBy: null };
    setTradeEscrowHook(() => escrow({ phase: 'setting-up', keepOpen: true }));
    const host = await room();
    expect(host.querySelector('[role="timer"]')).toBeNull();
  });

  for (const [name, bad] of [
    ['a non-digit receivedAtomic', { receivedAtomic: '12e3' }],
    ['an overlong amountAtomic', { amountAtomic: '9'.repeat(31) }],
    ['a negative fiatCents', { fiatCents: '-1' }],
    ['a malformed funding amount', { funding: { ...base.funding!, sellerFundsAtomic: '1.25' } }],
    ['a malformed fee', { poster: 'seller', fee: { atomic: 'x' } }],
    ['a malformed rate', { lockedRate: { currency: 'USD', centsPerXmr: '' } }],
  ] as [string, Partial<TradeView>][]) {
    it(`Minor 5: ${name} is refused before any BigInt(): the room says it could not load, nothing blank, nothing thrown`, async () => {
      current = { ...base, ...bad } as TradeView;
      const host = await room();
      expect(host.textContent).toContain("Couldn't load this trade.");
      noFundingTraces(host);
    });
  }

  it('Minor 6: the rendered QR code encodes exactly the wallet link (phone) and moneroUri(address, funds) (desktop)', async () => {
    phone();
    let host = await room();
    const href = host.querySelector('[data-wallet-link]')!.getAttribute('href')!;
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Use another wallet'))!.click());
    expect(host.querySelector('[data-qr] path')!.getAttribute('d')).toBe(qrPath(href).d);
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 });
    host = await room();
    expect(host.querySelector('[data-wallet-link]')).toBeNull();
    expect(host.querySelector('[data-qr] path')!.getAttribute('d')).toBe(qrPath(moneroUri(ADDRESS, 1_250_000_000_000n)).d);
  });

  it("Minor 8: Task 22 no longer restyles the global .x2f-label (Task 30's form labels keep their style); its labels are .x2f-trade-label", async () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/screens/trade/trade.css'), 'utf8');
    expect(css).not.toMatch(/(^|[^-\w])\.x2f-label\b/m);
    expect(css).toMatch(/\.x2f-trade-label\s*\{/);
    const host = await room();
    expect(host.querySelector('.x2f-trade-label')?.textContent).toBe('You send to escrow');
    expect(host.querySelector('.x2f-label')).toBeNull();
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

  it("through Task 19's fan-out (liveFanOut), a trade event re-reads the trade; after the source is removed it does not", async () => {
    setLiveSource(liveFanOut.source);
    await room();
    const calls = () => vi.mocked(fetch).mock.calls.length;
    const before = calls();
    await act(async () => liveFanOut.emit({ type: 'trade', code: CODE, state: 'funding' }));
    await flush();
    expect(calls()).toBe(before + 1);
    await act(async () => setLiveSource(null));
    await act(async () => liveFanOut.emit({ type: 'trade', code: CODE, state: 'funding' }));
    await flush();
    expect(calls()).toBe(before + 1);
  });

  it('a state with no screen yet shows a plain status card', async () => {
    current = { ...base, state: 'paid', funding: null };
    const host = await room();
    expect(host.querySelector('[data-trade-state="paid"]')).not.toBeNull();
  });
});
