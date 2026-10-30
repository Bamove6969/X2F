import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { setNavigator } from './api/client.js';
import { useLiveEvents, type LiveEvent } from './api/events.js';
import { AcceptedSheet, acceptedNavigation } from './screens/AcceptedSheet.js';
import { MyOffers } from './screens/MyOffers.js';
import { News } from './screens/News.js';
import { Feedback } from './screens/Feedback.js';
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
import { DisputeScreen } from './screens/dispute/DisputeScreen.js';
import { Blocked } from './screens/settings/Blocked.js';
import { Security } from './screens/settings/Security.js';
import { SetupFlow } from './screens/setup/SetupFlow.js';
import { Terms } from './screens/setup/Terms.js';
import { useSession } from './session/useSession.js';
import { BottomNav } from './ui/BottomNav.js';
import { DesktopHeader } from './ui/DesktopShell.js';
import { useFoldAttribute, useFoldLayout } from './ui/fold.js';
import './styles/fold.css';
import { TradeRoom } from './screens/trade/TradeRoom.js';
import { liveFanOut, setLiveSource } from './screens/trade/seams.js';
import './screens/trade/screens.js';

/**
 * The app shell. Phones, foldables' panes and the flip cover screen get the phone frame (the bottom
 * nav on the screens whose boards have it); the wide layout (1000 px and wider, no hinge) gets the
 * desktop header (Task 40, src/ui/fold.ts). The frame keeps one tree in every layout, so folding or
 * unfolding never remounts the screen: its route, scroll position and typed text stay.
 */
function Layout({ nav }: { nav: boolean }) {
  const layout = useFoldLayout();
  useFoldAttribute(layout);
  const wide = layout === 'wide';
  return (
    <div data-shell={wide ? 'desktop' : 'phone'} className={wide ? 'x2f-desktop' : undefined}>
      {wide ? <DesktopHeader /> : null}
      <div data-shell-body="" className={wide ? 'x2f-desktop__body' : undefined}>
        <Outlet />
      </div>
      {nav && !wide ? <BottomNav /> : null}
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
          <Route path="/profile/offers" element={<MyOffers />} />
        </Route>
        <Route element={<Layout nav={false} />}>
          <Route path="/post" element={<PostOffer />} />
          <Route path="/sell/:methodId" element={<BrowseOffers side="sell" copy={SELL_COPY} />} />
          <Route path="/buy/:methodId" element={<BrowseOffers side="buy" copy={BUY_COPY} />} />
          <Route path="/sell/:methodId/:offerId" element={<SellQuote />} />
          <Route path="/buy/:methodId/:offerId" element={<BuyQuote />} />
          <Route path="/trade/:code" element={<TradeRoom />} />
          {/* Task 27: DisputeOpen and ?view=chat (a disputed trade's room shows the dispute through its slot). */}
          <Route path="/trade/:code/dispute" element={<DisputeScreen />} />
          <Route path="/wallets" element={<Wallets />} />
          <Route path="/setup/*" element={<SetupFlow />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/backup" element={<BackupLogin />} />
          <Route path="/settings/security" element={<Security />} />
          <Route path="/settings/blocked" element={<Blocked />} />
          <Route path="/news" element={<News />} />
          <Route path="/feedback" element={<Feedback />} />
        </Route>
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Routes>
    </>
  );
}
