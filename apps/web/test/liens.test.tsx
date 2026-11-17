// @vitest-environment happy-dom
// Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): the debtor's notice and the creditor's
// recoveries (Settings → What you owe), from GET /v1/account/liens.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiensShapeError, parseLiens } from '../src/screens/liens/liensApi.js';
import { LIENS_COPY, pctOf } from '../src/screens/liens/liensCopy.js';
import { render } from './render.js';

const XMR = 1_000_000_000_000n;
const OWES = {
  id: 'l1', status: 'active', amountAtomic: (2n * XMR).toString(), feeAtomic: '0', recoveredAtomic: (XMR / 2n).toString(),
  remainingAtomic: ((3n * XMR) / 2n).toString(), rateBps: 5000, defaultRateBps: 5000, fromCode: 'AB12-CD34-EF56-GH78', createdAt: '2026-11-16T12:00:00.000Z',
};

const OWED_TO = {
  id: 'l2', status: 'active', amountAtomic: (2n * XMR).toString(), recoveredAtomic: (XMR / 2n).toString(), remainingAtomic: ((3n * XMR) / 2n).toString(),
  fromCode: 'AB12-CD34-EF56-GH78', recoveryAddressSet: false,
};

describe('parseLiens', () => {
  it('reads what is owed both ways; owed to me is totals only (review M4) and whether a recovery address is set (Q2)', () => {
    const r = parseLiens({ owes: [OWES], owedTo: [OWED_TO] });
    expect(r.owes[0]).toMatchObject({ amountAtomic: 2n * XMR, recoveredAtomic: XMR / 2n, remainingAtomic: (3n * XMR) / 2n, rateBps: 5000 });
    expect(r.owedTo[0]).toEqual({ id: 'l2', status: 'active', amountAtomic: 2n * XMR, recoveredAtomic: XMR / 2n, remainingAtomic: (3n * XMR) / 2n, fromCode: 'AB12-CD34-EF56-GH78', recoveryAddressSet: false });
    expect(() => parseLiens({ owes: [], owedTo: [{ ...OWED_TO, recoveryAddressSet: 'no' }] })).toThrow(LiensShapeError);
  });
  it('refuses figures that do not add up (recovered + remaining must equal owed) and malformed replies', () => {
    expect(() => parseLiens({ owes: [{ ...OWES, remainingAtomic: (2n * XMR).toString() }], owedTo: [] })).toThrow(LiensShapeError);
    expect(() => parseLiens({ owes: [{ ...OWES, rateBps: 0 }], owedTo: [] })).toThrow(LiensShapeError);
    expect(() => parseLiens({ owes: {}, owedTo: [] })).toThrow(LiensShapeError);
  });
  it('shows the rate as a percentage', () => {
    expect(pctOf(5000)).toBe('50%');
    expect(pctOf(2550)).toBe('25.5%');
  });
});

describe('the Liens screen', () => {
  afterEach(() => vi.restoreAllMocks());
  it('the debtor sees owed, paid back so far, still to pay and the rate', async () => {
    vi.doMock('../src/session/useSession.js', () => ({ useSession: () => ({ status: 'signed-in' }) }));
    vi.doMock('../src/screens/liens/liensApi.js', async (orig) => ({
      ...(await orig<typeof import('../src/screens/liens/liensApi.js')>()),
      fetchLiens: async () => parseLiens({ owes: [OWES], owedTo: [] }),
    }));
    const { Liens } = await import('../src/screens/liens/Liens.js');
    const { host } = render(<Liens />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const text = host.textContent ?? '';
    expect(text).toContain(LIENS_COPY.owesIntro('50%'));
    expect(text).toContain('2.000000 XMR');
    expect(text).toContain('0.500000 XMR');
    expect(text).toContain('1.500000 XMR');
  });
});

describe('Q2: the creditor chooses the wallet recoveries go to, signed by this device', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });
  const WALLET = { id: 'w1', app: 'feather', label: 'Main', address: '4'.padEnd(95, 'W'), addressEnd: 'WWWWWW', usable: true };
  async function screen(signed: { statement: unknown; sig: string } | null) {
    vi.resetModules();
    const posted: unknown[] = [];
    const sign = vi.fn(async () => signed);
    vi.doMock('../src/session/useSession.js', () => ({ useSession: () => ({ status: 'signed-in' }) }));
    vi.doMock('../src/escrow/useEscrow.js', () => ({ escrowClient: () => ({ signRecoveryAddress: sign }) }));
    vi.doMock('../src/screens/quote/api.js', async (orig) => ({ ...(await orig<typeof import('../src/screens/quote/api.js')>()), fetchWallets: async () => [WALLET] }));
    vi.doMock('../src/screens/liens/liensApi.js', async (orig) => ({
      ...(await orig<typeof import('../src/screens/liens/liensApi.js')>()),
      fetchLiens: async () => parseLiens({ owes: [], owedTo: [OWED_TO] }),
      setRecoveryAddress: async (id: string, body: unknown) => void posted.push([id, body]),
    }));
    const { Liens } = await import('../src/screens/liens/Liens.js');
    const { host } = render(<Liens />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return { host, posted, sign };
  }
  const pickAndUse = async (host: HTMLElement) => {
    await act(async () => {
      (host.querySelector('input[type=radio]') as HTMLInputElement).click();
    });
    await act(async () => {
      [...host.querySelectorAll('button')].find((b) => b.textContent === LIENS_COPY.addressUse)!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  it('shows totals only and asks for a wallet; the device signs it for the disputed trade and the statement is posted', async () => {
    const signed = { statement: { v: 1 }, sig: 'ab'.repeat(64) };
    const { host, posted, sign } = await screen(signed);
    expect(host.textContent).toContain(LIENS_COPY.addressNeeded);
    expect(host.textContent).not.toContain('2026-11-16T13');
    await pickAndUse(host);
    expect(sign).toHaveBeenCalledWith('AB12-CD34-EF56-GH78', WALLET.address, expect.any(String));
    expect(posted).toEqual([['l2', signed]]);
  });

  it('a device without the disputed trade\'s record says which device can; nothing is posted', async () => {
    const { host, posted } = await screen(null);
    await pickAndUse(host);
    expect(host.textContent).toContain(LIENS_COPY.addressNoRecord('AB12-CD34-EF56-GH78'));
    expect(posted).toEqual([]);
  });
});

describe("the buyer's confirmed recovery travels to the escrow (ConfirmedTrade.lienRecoveryAtomic)", () => {
  const base = { role: 'buyer' as const, ownAddress: '4Buyer', deal: { poster: 'seller' as const, takeAmountAtomic: XMR, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 100_000n } };
  it('is kept through the tab store; a seller record carrying one is dropped', async () => {
    const { readConfirmed, storeConfirmed } = await import('../src/screens/quote/confirmed.js');
    storeConfirmed('AB12-CD34-EF56-GH78', { ...base, lienRecoveryAtomic: XMR / 2n });
    expect(readConfirmed('AB12-CD34-EF56-GH78')).toEqual({ ...base, lienRecoveryAtomic: XMR / 2n });
    storeConfirmed('AB12-CD34-EF56-GH79', { ...base, role: 'seller', lienRecoveryAtomic: XMR / 2n });
    expect(readConfirmed('AB12-CD34-EF56-GH79')).toBeNull();
  });
  it("the poster-buyer's sheet reads it from their own view; malformed is refused", async () => {
    const { posterRecovery } = await import('../src/screens/AcceptedSheet.js');
    const v = { role: 'buyer' as const, poster: 'buyer' as const, amountAtomic: '1', grown: null, lockedRate: { currency: 'USD', centsPerXmr: '1' }, maxFiatCents: '1' };
    expect(posterRecovery(v)).toBeUndefined();
    expect(posterRecovery({ ...v, lienRecoveryAtomic: '500' })).toBe(500n);
    expect(posterRecovery({ ...v, lienRecoveryAtomic: '0' })).toBeNull();
  });
});
