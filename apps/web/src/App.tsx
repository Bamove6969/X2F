import { useEffect, useSyncExternalStore } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router';
import { setNavigator } from './api/client.js';
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
          <Route path="/sell" element={<Screen name="sell" />} />
          <Route path="/buy" element={<Screen name="buy" />} />
        </Route>
        <Route element={<Layout nav={false} />}>
          <Route path="/sell/:methodId" element={<Screen name="sell-offers" />} />
          <Route path="/buy/:methodId" element={<Screen name="buy-offers" />} />
          <Route path="/post" element={<Screen name="post" />} />
          <Route path="/trade/:code" element={<Screen name="trade" />} />
          <Route path="/trade/:code/dispute" element={<Screen name="dispute" />} />
          <Route path="/wallets" element={<Screen name="wallets" />} />
          <Route path="/setup/*" element={<Screen name="setup" />} />
          <Route path="/terms" element={<Screen name="terms" />} />
          <Route path="/login" element={<Screen name="login" />} />
          <Route path="/settings/security" element={<Screen name="security" />} />
        </Route>
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Routes>
    </>
  );
}
