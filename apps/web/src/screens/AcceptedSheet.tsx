import { useEffect, useRef, useState } from 'react';
import { formatFiat, formatXmr } from '@x2f/trade';
import { api } from '../api/client.js';
import type { LiveEvent } from '../api/events.js';
import { addressEnd, confirmableAddress } from '../ui/addressEnd.js';
import { storeConfirmed, type ConfirmedTrade } from './quote/confirmed.js';
import { Button } from '../ui/Button.js';
import { Sheet } from '../ui/Sheet.js';
import { StatusChip } from '../ui/StatusChip.js';
import './accepted.css';

/**
 * The fields of a `GET /v1/wallets` entry (Plan 2) this sheet uses. The full `address` is kept only
 * for the ConfirmedTrade handed to the trade room (the escrow pays out to it); it is never rendered.
 */
export interface AcceptedWallet {
  id: string;
  app: string;
  label: string;
  address: string;
  addressEnd: string;
  usable: boolean;
}

/** The fields of the poster's `GET /v1/trades/:code` view (Task 6) the sheet shows and confirms. */
export interface AcceptedTradeView {
  role: 'buyer' | 'seller';
  poster: 'buyer' | 'seller';
  amountAtomic: string;
  grown: { fromAtomic: string } & Record<string, unknown> | null;
  lockedRate: { currency: string; centsPerXmr: string };
  maxFiatCents: string;
}

export async function loadAcceptedTrade(code: string): Promise<AcceptedTradeView> {
  return api<AcceptedTradeView>(`/v1/trades/${encodeURIComponent(code)}`);
}

const POSITIVE = /^[1-9]\d{0,29}$/;

/**
 * The deal the poster is shown and confirms (Task 12's `Deal`), from their own trade view; null
 * when the view is not the poster's or is not whole. The XMR amount is the amount at take (before
 * any growth), as Task 18 records it for the taker.
 */
export function posterDeal(v: AcceptedTradeView): ConfirmedTrade['deal'] | null {
  if ((v.role !== 'buyer' && v.role !== 'seller') || v.role !== v.poster) return null;
  const take = v.grown ? v.grown.fromAtomic : v.amountAtomic;
  const { currency, centsPerXmr } = v.lockedRate ?? ({} as AcceptedTradeView['lockedRate']);
  if (typeof take !== 'string' || !POSITIVE.test(take)) return null;
  if (typeof centsPerXmr !== 'string' || !POSITIVE.test(centsPerXmr)) return null;
  if (typeof v.maxFiatCents !== 'string' || !POSITIVE.test(v.maxFiatCents)) return null;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  return { poster: v.poster, takeAmountAtomic: BigInt(take), currency, centsPerXmr: BigInt(centsPerXmr), maxFiatCents: BigInt(v.maxFiatCents) };
}

/** Where the sheet sends the poster: the trade room, carrying the ConfirmedTrade as router state (Task 22's seam). */
export function acceptedNavigation(code: string, confirmed: ConfirmedTrade): [string, { state: { confirmed: ConfirmedTrade } }] {
  return [`/trade/${encodeURIComponent(code)}`, { state: { confirmed } }];
}

/** The poster's wallets, as `GET /v1/wallets` lists them. */
export async function loadPosterWallets(): Promise<AcceptedWallet[]> {
  return api<AcceptedWallet[]>('/v1/wallets');
}

/**
 * SEAM(Task 5): `POST /v1/trades/:code/wallet { walletId }` (poster only, in `setup`, once) is
 * built by Task 5, not yet merged. This is the only call site; Task 5's tests own the route, and
 * Task 23 (trade room) checks the room moves to "Setting up escrow" end to end
 * (apps/web/e2e/accepted.spec.ts lands with it).
 */
export async function postTradeWallet(code: string, walletId: string): Promise<void> {
  await api(`/v1/trades/${encodeURIComponent(code)}/wallet`, { method: 'POST', body: { walletId } });
}

type Phase = 'loading' | 'pick' | 'sending' | 'done';

/**
 * Shown to an offer's poster on a live `accepted` event: "<display name> accepted your offer".
 * The sheet shows the deal from the poster's own trade view and the poster picks which of their
 * usable wallets this trade uses (spec 2.2 step 4; no default wallet, OD-11); escrow setup starts
 * after that, and the trade waits in `setup` until `setupBy`. A poster with no usable wallet gets
 * Add a wallet, which comes back to this trade.
 *
 * On success the poster's `ConfirmedTrade` (role, the picked wallet's full address, the deal shown
 * here) is stored for this tab under `x2f.confirmed:<code>` (Task 18's helper) BEFORE `onDone`
 * hands it on for the navigation, exactly as Task 18 does for the taker. Without a whole deal
 * (view missing, not the poster's, malformed) nothing is posted, stored or navigated.
 */
export function AcceptedSheet({
  event,
  onDone,
  onClose,
  loadWallets = loadPosterWallets,
  loadTrade = loadAcceptedTrade,
  submit = postTradeWallet,
}: {
  event: Extract<LiveEvent, { type: 'accepted' }>;
  onDone: (code: string, confirmed: ConfirmedTrade) => void;
  onClose: () => void;
  loadWallets?: () => Promise<AcceptedWallet[]>;
  loadTrade?: (code: string) => Promise<AcceptedTradeView>;
  submit?: (code: string, walletId: string) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [wallets, setWallets] = useState<AcceptedWallet[]>([]);
  const [deal, setDeal] = useState<ConfirmedTrade['deal'] | null>(null);
  const [role, setRole] = useState<ConfirmedTrade['role'] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Loaded once per sheet (a caller's inline loader must not reload, and reset the pick, on every render).
  const load = useRef({ loadWallets, loadTrade });

  useEffect(() => {
    let live = true;
    Promise.all([load.current.loadWallets(), load.current.loadTrade(event.code)]).then(
      ([all, view]) => {
        if (!live) return;
        // No wallet is pre-selected (OD-11, X-2: no default payout wallet; always ask). The
        // button stays disabled until the poster picks one.
        // A wallet whose address cannot be confirmed (empty, or over 256 characters, the rule
        // readConfirmed applies) is never offered: it could not become `ownAddress` (gap 3).
        setWallets(all.filter((w) => w.usable && confirmableAddress(w.address)));
        const d = posterDeal(view);
        setDeal(d);
        setRole(d ? view.role : null);
        if (!d) setFailed(true);
        setPhase('pick');
      },
      () => {
        if (!live) return;
        setFailed(true);
        setPhase('pick');
      },
    );
    return () => {
      live = false;
    };
  }, [event.code]);

  const use = async () => {
    const wallet = wallets.find((w) => w.id === picked);
    if (!wallet || !deal || !role || !confirmableAddress(wallet.address)) return;
    const confirmed: ConfirmedTrade = { role, ownAddress: wallet.address, deal };
    setFailed(false);
    setPhase('sending');
    try {
      await submit(event.code, wallet.id);
    } catch {
      setFailed(true);
      setPhase('pick');
      return;
    }
    // Written before the navigation: history state is gone when the trade opens in a new tab or from a push.
    storeConfirmed(event.code, confirmed);
    setPhase('done');
    onDone(event.code, confirmed);
  };

  const returnTo = encodeURIComponent(`/trade/${event.code}`);

  return (
    <Sheet open title={`${event.by} accepted your offer`} onClose={onClose}>
      {phase === 'done' ? (
        <StatusChip tone="escrow" icon="shield" label="Setting up escrow" />
      ) : phase === 'loading' ? null : wallets.length === 0 && !failed ? (
        <>
          <p className="x2f-sheet__body">You have no wallet ready for this trade. Add one to start.</p>
          <Button variant="primary" href={`/wallets?add=1&returnTo=${returnTo}`}>
            Add a wallet
          </Button>
        </>
      ) : (
        <>
          {deal ? (
            <p className="x2f-sheet__body" data-part="deal">
              {role === 'seller' ? 'You sell' : 'You buy'} {formatXmr(deal.takeAmountAtomic)} XMR at {formatFiat(deal.centsPerXmr, deal.currency)} per XMR, up to{' '}
              {formatFiat(deal.maxFiatCents, deal.currency)}
            </p>
          ) : null}
          <p className="x2f-sheet__body">Pick the wallet for this trade. Escrow setup starts after that.</p>
          <fieldset className="x2f-accepted__wallets">
            <legend className="x2f-accepted__legend">Your wallets</legend>
            {wallets.map((w) => (
              <label key={w.id} className="x2f-accepted__wallet">
                <input
                  type="radio"
                  name="accepted-wallet"
                  value={w.id}
                  checked={picked === w.id}
                  onChange={() => setPicked(w.id)}
                />
                <span className="x2f-accepted__label">{w.label}</span>
                <span className="x2f-accepted__end">…{addressEnd(w.address)}</span>
              </label>
            ))}
          </fieldset>
          {failed ? (
            <p role="alert" className="x2f-accepted__error">
              That did not work. Try again.
            </p>
          ) : null}
          <Button variant="primary" disabled={!picked || !deal || phase === 'sending'} onClick={() => void use()}>
            Use this wallet
          </Button>
        </>
      )}
    </Sheet>
  );
}
