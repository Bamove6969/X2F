import { useEffect, useRef, useState } from 'react';
import { formatFiat, formatXmr, formatXmrExact } from '@x2f/trade';
import { ApiCallError, api } from '../api/client.js';
import { DEFAULT_TAG } from './walletsCopy.js';
import { matchesRecord } from './walletRecord.js';
import { NEW_ADDRESS } from './quote/addressCopy.js';
import type { LiveEvent } from '../api/events.js';
import { addressEnd, confirmableAddress } from '../ui/addressEnd.js';
import { LIEN_QUOTE_COPY, SELLER_LIEN_COPY } from './liens/liensCopy.js';
import { storeConfirmed, type ConfirmedTrade } from './quote/confirmed.js';
import { Button } from '../ui/Button.js';
import { Sheet } from '../ui/Sheet.js';
import { StatusChip } from '../ui/StatusChip.js';
import { RATE_FIRST, REVIEW_PENDING_CODE } from '../ui/cantDoCodes.js';
import { RateFirst, type RateFirstLoaders } from './review/RateFirstSheet.js';
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
  /** Owner 17 Nov 2026 (note #6 Q9): the API's default, picked first. Absent from older API builds. */
  isDefault?: boolean;
}

/** The fields of the poster's `GET /v1/trades/:code` view (Task 6) the sheet shows and confirms. */
export interface AcceptedTradeView {
  role: 'buyer' | 'seller';
  poster: 'buyer' | 'seller';
  amountAtomic: string;
  grown: { fromAtomic: string } & Record<string, unknown> | null;
  lockedRate: { currency: string; centsPerXmr: string };
  maxFiatCents: string;
  /** Lien recovery (owner 16 Nov 2026): the buyer's own view only; absent = none. */
  lienRecoveryAtomic?: string;
  /** Seller lien recovery (owner 27 Nov 2026): the seller's own view only, the extra this trade's escrow holds for the person they owe; absent = none. */
  sellerLienRecoveryAtomic?: string;
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

/**
 * Lien recovery the poster-buyer's own view carries (docs/lien-recovery.md): undefined when none,
 * null when malformed (the sheet then confirms nothing).
 */
export function posterRecovery(v: AcceptedTradeView): bigint | undefined | null {
  if (v.lienRecoveryAtomic === undefined) return undefined;
  return typeof v.lienRecoveryAtomic === 'string' && POSITIVE.test(v.lienRecoveryAtomic) ? BigInt(v.lienRecoveryAtomic) : null;
}

/**
 * The extra the poster-seller's own view carries for their own lien (owner 27 Nov 2026,
 * docs/lien-recovery.md "Debtor is the seller"): undefined when none, null when malformed.
 */
export function posterSellerRecovery(v: AcceptedTradeView): bigint | undefined | null {
  if (v.sellerLienRecoveryAtomic === undefined) return undefined;
  return typeof v.sellerLienRecoveryAtomic === 'string' && POSITIVE.test(v.sellerLienRecoveryAtomic) ? BigInt(v.sellerLienRecoveryAtomic) : null;
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
 * `POST /v1/trades/:code/wallet { walletId, sellerLienRecoveryAtomic? }` → 204 (Task 5,
 * apps/api/src/trades/take.ts: poster only, in `setup`, once; 409 `no-wallet`, `wallet-not-ready`,
 * `wrong-party`, `wrong-state`; a poster who sells sends the extra they were shown for their own
 * lien, and any other figure is 409 `lien-recovery-changed`, owner 27 Nov 2026). This
 * is the only call site; Task 5's tests own the route, and Task 23 (trade room) checks the room
 * moves to "Setting up escrow" end to end (apps/web/e2e/accepted.spec.ts lands with it).
 */
export async function postTradeWallet(code: string, walletId: string, sellerLienRecoveryAtomic?: bigint): Promise<void> {
  const body = sellerLienRecoveryAtomic === undefined ? { walletId } : { walletId, sellerLienRecoveryAtomic: sellerLienRecoveryAtomic.toString() };
  await api(`/v1/trades/${encodeURIComponent(code)}/wallet`, { method: 'POST', body });
}

type Phase = 'loading' | 'pick' | 'sending' | 'rate' | 'done';

/**
 * Shown to an offer's poster on a live `accepted` event: "<Trade Tag> accepted your offer".
 * The sheet shows the deal from the poster's own trade view and the poster picks which of their
 * usable wallets this trade uses (spec 2.2 step 4; the default is picked first, owner 17 Nov Q9); escrow setup starts
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
  rateFirst,
}: {
  event: Extract<LiveEvent, { type: 'accepted' }>;
  onDone: (code: string, confirmed: ConfirmedTrade) => void;
  onClose: () => void;
  loadWallets?: () => Promise<AcceptedWallet[]>;
  loadTrade?: (code: string) => Promise<AcceptedTradeView>;
  submit?: (code: string, walletId: string, sellerLienRecoveryAtomic?: bigint) => Promise<void>;
  /** The rate-first content's loaders (tests). */
  rateFirst?: RateFirstLoaders;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [wallets, setWallets] = useState<AcceptedWallet[]>([]);
  const [deal, setDeal] = useState<ConfirmedTrade['deal'] | null>(null);
  const [recovery, setRecovery] = useState<bigint | undefined | null>(undefined);
  const [sellerRecovery, setSellerRecovery] = useState<bigint | undefined | null>(undefined);
  const [role, setRole] = useState<ConfirmedTrade['role'] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [swapped, setSwapped] = useState(false);
  // Loaded once per sheet (a caller's inline loader must not reload, and reset the pick, on every render).
  const load = useRef({ loadWallets, loadTrade });

  useEffect(() => {
    let live = true;
    Promise.all([load.current.loadWallets(), load.current.loadTrade(event.code)]).then(
      ([all, view]) => {
        if (!live) return;
        // Owner 17 Nov 2026 (note #6 Q9, overriding OD-11): the default wallet (the API's
        // `isDefault`) is picked first; the poster can pick another. With no usable default nothing
        // is picked and the button stays disabled until the poster picks one.
        // A wallet whose address cannot be confirmed (empty, or over 256 characters, the rule
        // readConfirmed applies) is never offered: it could not become `ownAddress` (gap 3).
        // Review 17 Nov M4: nor is a wallet listed with another address than this device recorded
        // for it when the person typed it here (walletRecord.ts); the sheet says so.
        const offered = all.filter((w) => w.usable && confirmableAddress(w.address) && matchesRecord(w));
        setSwapped(all.some((w) => !matchesRecord(w)));
        setWallets(offered);
        setPicked((p) => p ?? offered.find((w) => w.isDefault === true)?.id ?? null);
        const d = posterDeal(view);
        setDeal(d);
        setRecovery(view.role === 'buyer' ? posterRecovery(view) : undefined);
        setSellerRecovery(view.role === 'seller' ? posterSellerRecovery(view) : undefined);
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
    if (recovery === null || sellerRecovery === null) return;
    const confirmed: ConfirmedTrade = {
      role, ownAddress: wallet.address, deal,
      ...(recovery !== undefined ? { lienRecoveryAtomic: recovery } : {}),
      ...(sellerRecovery !== undefined ? { sellerLienRecoveryAtomic: sellerRecovery } : {}),
    };
    setFailed(false);
    setPhase('sending');
    try {
      // Owner 27 Nov 2026: a poster who sells sends the extra shown here, accepted with the wallet.
      if (sellerRecovery !== undefined) await submit(event.code, wallet.id, sellerRecovery);
      else await submit(event.code, wallet.id);
    } catch (e) {
      // Plan 5 Task 6, the rate-first gate (409 review-pending on the poster's wallet pick): rate
      // or skip the trades it counts here, then the same wallet pick goes again.
      if (e instanceof ApiCallError && e.code === REVIEW_PENDING_CODE) {
        setPhase('rate');
        return;
      }
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
      {/* Review m6: about which wallets are offered, so not stacked on the rating (the pick is fixed then). */}
      {swapped && phase !== 'done' && phase !== 'loading' && phase !== 'rate' ? (
        <p role="alert" className="x2f-sheet__body" data-part="accepted-address-swapped">
          {NEW_ADDRESS.mismatch}
        </p>
      ) : null}
      {phase === 'done' ? (
        <StatusChip tone="escrow" icon="shield" label="Setting up escrow" />
      ) : phase === 'rate' ? (
        <>
          <h3 className="x2f-sheet__heading" data-part="rate-first-title">
            {RATE_FIRST.title}
          </h3>
          <RateFirst
            {...rateFirst}
            onCleared={(how) => {
              setPhase('pick');
              // The same wallet pick goes again once a trade was rated or skipped here; the deal
              // shown is the locked one, so nothing on it can have moved meanwhile.
              if (how !== 'empty') void use();
            }}
          />
        </>
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
          {role === 'buyer' && typeof recovery === 'bigint' && recovery > 0n ? (
            // Review B1: the poster who buys sees what this purchase pays to the person they owe, and
            // accepts it with the wallet; the device then takes only that figure.
            <p className="x2f-sheet__body" data-part="lien-recovery">
              {LIEN_QUOTE_COPY.sheet(`${formatXmrExact(recovery)} XMR`)}
            </p>
          ) : null}
          {role === 'seller' && typeof sellerRecovery === 'bigint' && sellerRecovery > 0n ? (
            // Owner 27 Nov 2026: the poster who sells sees the extra they send for what they owe,
            // and accepts it with the wallet; the device then funds and signs only that figure.
            <p className="x2f-sheet__body" data-part="seller-lien-recovery">
              {SELLER_LIEN_COPY.sheet(`${formatXmrExact(sellerRecovery)} XMR`)}
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
                {/* Security review of wip/lead-note-226 (Medium 1): the name in its own isolated element, apart from the real address end. */}
                <bdi className="x2f-accepted__label" data-part="wallet-name">{w.label}</bdi>
                <span className="x2f-accepted__end">…{addressEnd(w.address)}</span>
                {w.isDefault === true ? <span className="x2f-accepted__end">{DEFAULT_TAG}</span> : null}
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
