import { useEffect, useSyncExternalStore } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { setNavigator } from './api/client.js';
import { PostOffer } from './screens/PostOffer.js';
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
import { Security } from './screens/settings/Security.js';
import { useSession } from './session/useSession.js';
import { BottomNav } from './ui/BottomNav.js';
import { DesktopShell } from './ui/DesktopShell.js';

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

export function App() {
  useSession();
  return (
    <>
      <RouterBridge />
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
          <Route path="/trade/:code" element={<Screen name="trade" />} />
          <Route path="/trade/:code/dispute" element={<Screen name="dispute" />} />
          <Route path="/wallets" element={<Screen name="wallets" />} />
          <Route path="/setup/*" element={<Screen name="setup" />} />
          <Route path="/terms" element={<Screen name="terms" />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/backup" element={<BackupLogin />} />
          <Route path="/settings/security" element={<Security />} />
        </Route>
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Routes>
    </>
  );
}
