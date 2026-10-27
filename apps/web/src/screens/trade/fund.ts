/** Pure helpers for TradeFund (Task 22): wallet names, the phone check, the funding guard's memory. */
import { ATOMIC_PER_XMR } from '@x2f/trade';
import type { TradeView } from '../../api/trade.js';

/** Task 29's wallet apps (apps/api/src/wallets/routes.ts WALLET_APPS) as the boards name them. */
const WALLET_NAMES: Record<string, string> = {
  cake: 'Cake Wallet',
  edge: 'Edge',
  feather: 'Feather',
  monerujo: 'Monerujo',
  stack: 'Stack Wallet',
  'monero-gui-cli': 'Monero GUI',
  'ledger-trezor': 'your hardware wallet',
};

/** "Cake Wallet", or "your wallet" for Other or an unknown app. */
export function walletName(app: string | null): string {
  return (app !== null && WALLET_NAMES[app]) || 'your wallet';
}

/**
 * Android or iOS (spec 2.2 step 5: "Open in <wallet>" only there; a desktop gets the QR code and
 * copy as its main content). iPadOS reports a Mac user agent, so a touch Mac counts as iOS.
 */
export function isPhoneDevice(ua: string, maxTouchPoints: number): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** Atomic units as decimal XMR, trailing zeros trimmed: what the `monero:` link and the copy button carry. */
export function exactXmr(atomic: bigint): string {
  const whole = atomic / ATOMIC_PER_XMR;
  const frac = (atomic % ATOMIC_PER_XMR).toString().padStart(12, '0').replace(/0+$/, '');
  return frac === '' ? whole.toString() : `${whole}.${frac}`;
}

/** The API says the escrow is funded: the full amount is seen (any confirmations), or the trade is past funding. */
export function isFunded(view: Pick<TradeView, 'state' | 'receivedAtomic' | 'funding' | 'amountAtomic'>): boolean {
  if (view.state !== 'setup' && view.state !== 'funding') return true;
  const target = view.funding ? BigInt(view.funding.sellerFundsAtomic) : null;
  return target !== null && BigInt(view.receivedAtomic) >= target;
}

/**
 * Whether the `funded` mark may be set for good (review 2026-10-27, Minor 2): only from this
 * device's own escrow reading covering the funding, or from the API with at least one
 * confirmation (or a state past funding). An API 0-conf reading shows "Escrow funded" for now but
 * sets no mark, so when that tx disappears and the API goes back to `funding`, the screen follows.
 */
export function fundedForGood(
  view: Pick<TradeView, 'state' | 'receivedAtomic' | 'funding' | 'amountAtomic' | 'confirmations'>,
  device: { receivedAtomic: bigint | null; fundsAtomic: bigint | null },
): boolean {
  if (device.receivedAtomic !== null && device.fundsAtomic !== null && device.fundsAtomic > 0n && device.receivedAtomic >= device.fundsAtomic) return true;
  if (!isFunded(view)) return false;
  return view.confirmations >= 1 || (view.state !== 'setup' && view.state !== 'funding');
}

/**
 * The funding guard's memory on this device (spec 2.2 step 5, owner 2026-10-21): the hold opens
 * the wallet once per trade, and once funded the address is never shown again, across reloads.
 * Kept in localStorage under the trade code only; a store that throws (private mode) falls back
 * to memory for this page.
 */
export type FundMark = 'opened' | 'funded';

const memory = new Map<string, Set<FundMark>>();
const keyFor = (code: string, mark: FundMark) => `x2f.fund.${mark}.${code}`;

export function hasFundMark(code: string, mark: FundMark): boolean {
  if (memory.get(code)?.has(mark)) return true;
  try {
    return window.localStorage.getItem(keyFor(code, mark)) === '1';
  } catch {
    return false;
  }
}

export function setFundMark(code: string, mark: FundMark): void {
  let set = memory.get(code);
  if (!set) memory.set(code, (set = new Set()));
  set.add(mark);
  try {
    window.localStorage.setItem(keyFor(code, mark), '1');
  } catch {
    // Memory above still guards this page.
  }
}

/** For tests: forget the in-memory marks. */
export function resetFundMarks(): void {
  memory.clear();
}
