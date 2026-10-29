import { useEffect, useState, useSyncExternalStore } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { setNavigator } from './api/client.js';
import { useLiveEvents, type LiveEvent } from './api/events.js';
import { AcceptedSheet, acceptedNavigation } from './screens/AcceptedSheet.js';
import { PostOffer } from './screens/PostOffer.js';
import { Wallets } from './screens/Wallets.js';
import { BUY_COPY } from './screens/browse/BuyCopy.js';
import { MethodList } from './screens/browse/MethodList.js';
import { OfferList } from './screens/browse/OfferList.js';
import { SELL_COPY } from './screens/browse/SellCopy.js';
import { adSide, currencyFrom, type Side } from './screens/browse/api.js';
import type { BrowseCopy } from './screens/browse/SellCopy.js';
import { BackupLogin } from './screens/auth/BackupLogin.js';
import { Login } from './screens/auth/Login.js';
import { BuyQuote } from './screens/quote/BuyQuote.js';
import { quotePath } from './screens/quote/quoteModel.js';
import { SellQuote } from './screens/quote/SellQuote.js';
import { Blocked } from './screens/settings/Blocked.js';
import { Security } from './screens/settings/Security.js';
import { SetupFlow } from './screens/setup/SetupFlow.js';
import { Terms } from './screens/setup/Terms.js';
import { useSession } from './session/useSession.js';
import { BottomNav } from './ui/BottomNav.js';
import { DesktopShell } from './ui/DesktopShell.js';
import { TradeRoom } from './screens/trade/TradeRoom.js';
import { liveFanOut, setLiveSource } from './screens/trade/seams.js';
import './screens/trade/screens.js';

const WIDE = '(min-width: 1024px)';

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(WIDE);
      q.addEventListener('change', onChange);
      return () => q.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

/** Phones get the bottom nav (on the screens whose boards have it); 1024 px and wider get the desktop shell. */
function Layout({ nav }: { nav: boolean }) {
  if (useWide()) {
    return (
      <DesktopShell>
        <Outlet />
      </DesktopShell>
    );
  }
  return (
    <div data-shell="phone">
      <Outlet />
      {nav ? <BottomNav /> : null}
    </div>
  );
}

/** Each screen's task replaces its placeholder (Tasks 16-30). */
function Screen({ name }: { name: string }) {
  return <main data-screen={name} />;
}

/**
 * The offer list (Tasks 16/17) with its Trade button opening the quote (Task 18): a sell ad opens
 * BuyQuote at `/buy/<method>/<offer>`, a buy ad SellQuote at `/sell/<method>/<offer>`, in the
 * currency being browsed.
 */
function BrowseOffers({ side, copy }: { side: Side; copy: BrowseCopy }) {
  const { methodId = '' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  return <OfferList side={side} copy={copy} onTrade={(o) => void navigate(quotePath(adSide(side), methodId, o.id, currencyFrom(search)))} />;
}

/** Hands the router's navigate to the API client, so terms-required and no-wallet redirects stay in the app. */
function RouterBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigator(
      (to) => void navigate(to),
      () => ({ pathname: window.location.pathname, search: window.location.search }),
    );
    return () => setNavigator(null);
  }, [navigate]);
  return null;
}

/**
 * Task 19: while a trader is signed in, listens to live events; an `accepted` event opens the
 * "<name> accepted your offer" sheet over whatever screen is showing, then goes to the trade, and
 * each `trade` event goes on to the trade room (Task 22, seams.ts liveFanOut).
 * Nothing here is a seen-receipt: a `refund_requested` event reaching a tab (hidden, minimised, on
 * another device) is not the buyer seeing the final alert. Task 25's `FinalAlert` posts that.
 */
function LiveAccepted() {
  const navigate = useNavigate();
  const [accepted, setAccepted] = useState<Extract<LiveEvent, { type: 'accepted' }> | null>(null);
  // The trade room listens on this same connection (seams.ts liveFanOut); without a trader
  // session there is no live source and the room only polls.
  useEffect(() => {
    setLiveSource(liveFanOut.source);
    return () => setLiveSource(null);
  }, []);
  useLiveEvents((e) => {
    if (e.type === 'accepted') setAccepted(e);
    else if (e.type === 'trade') liveFanOut.emit(e);
  });
  if (!accepted) return null;
  return (
    <AcceptedSheet
      key={accepted.code}
      event={accepted}
      onDone={(code, confirmed) => {
        setAccepted(null);
        // The room gets the poster's ConfirmedTrade as router state (also stored by the sheet).
        void navigate(...acceptedNavigation(code, confirmed));
      }}
      onClose={() => setAccepted(null)}
    />
  );
}

/** Only full trader sessions have live events (`GET /v1/events` is `requireTrader`). */
function isTrader(session: ReturnType<typeof useSession>): boolean {
  if (session.status !== 'signed-in') return false;
  const me = session.me;
  if (me === null || typeof me !== 'object') return false;
  const m = me as { kind?: unknown; level?: unknown; termsCurrent?: unknown };
  return m.kind === 'trader' && m.level === 'full' && m.termsCurrent !== false;
}

export function App() {
  const session = useSession();
  return (
    <>
      <RouterBridge />
      {isTrader(session) ? <LiveAccepted /> : null}
      <Routes>
        <Route element={<Layout nav />}>
          <Route path="/sell" element={<MethodList side="sell" copy={SELL_COPY} />} />
          <Route path="/buy" element={<MethodList side="buy" copy={BUY_COPY} />} />
        </Route>
        <Route element={<Layout nav={false} />}>
          <Route path="/post" element={<PostOffer />} />
          <Route path="/sell/:methodId" element={<BrowseOffers side="sell" copy={SELL_COPY} />} />
          <Route path="/buy/:methodId" element={<BrowseOffers side="buy" copy={BUY_COPY} />} />
          <Route path="/sell/:methodId/:offerId" element={<SellQuote />} />
          <Route path="/buy/:methodId/:offerId" element={<BuyQuote />} />
          <Route path="/trade/:code" element={<TradeRoom />} />
          <Route path="/trade/:code/dispute" element={<Screen name="dispute" />} />
          <Route path="/wallets" element={<Wallets />} />
          <Route path="/setup/*" element={<SetupFlow />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/backup" element={<BackupLogin />} />
          <Route path="/settings/security" element={<Security />} />
          <Route path="/settings/blocked" element={<Blocked />} />
        </Route>
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Routes>
    </>
  );
}
