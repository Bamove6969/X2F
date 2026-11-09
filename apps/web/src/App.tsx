import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router';
import { setNavigator } from './api/client.js';
import { useLiveEvents, type LiveEvent } from './api/events.js';
import { useSite, type SiteBannerInfo } from './api/site.js';
import { TradeChatPanel } from './chat/ChatPanel.js';
import { emitChatLive } from './chat/live.js';
import { AcceptedSheet, acceptedNavigation } from './screens/AcceptedSheet.js';
import { Button } from './ui/Button.js';
import { Sheet } from './ui/Sheet.js';
import { Maintenance } from './screens/Maintenance.js';
import { MyOffers } from './screens/MyOffers.js';
import { News } from './screens/News.js';
import { Feedback } from './screens/Feedback.js';
import { PostOffer } from './screens/PostOffer.js';
import { Wallets } from './screens/Wallets.js';
import { BUY_COPY } from './screens/browse/BuyCopy.js';
import { MethodList } from './screens/browse/MethodList.js';
import { OffersRoute } from './screens/browse/OffersRoute.js';
import { SELL_COPY } from './screens/browse/SellCopy.js';
import { BackupLogin } from './screens/auth/BackupLogin.js';
import { Login } from './screens/auth/Login.js';
import { LoginApprove, useLoginApprovals } from './screens/auth/LoginApprove.js';
import { MemberInvite } from './screens/auth/MemberInvite.js';
import { SESSION_LENGTH_PATH, SessionLengthScreen } from './screens/auth/SessionLength.js';
import { SessionPrompt } from './screens/auth/SessionPrompt.js';
import { publishSessionWatch } from './session/sessionWatch.js';
import { IdleReminder } from './session/IdleReminder.js';
import { publishIdleReminder } from './session/idleReminderWatch.js';
import { IDLE_REMINDER_PATH } from './screens/auth/sessionCopy.js';
import { IdleReminderScreen } from './screens/settings/IdleReminderSettings.js';
import { DisputeScreen } from './screens/dispute/DisputeScreen.js';
import { Blocked } from './screens/settings/Blocked.js';
import { DevicesRoute } from './screens/settings/Devices.js';
import { Security } from './screens/settings/Security.js';
import { Team } from './screens/settings/Team.js';
import { AccountType } from './screens/settings/AccountType.js';
import { MEMBER_TRADE_COPY } from './screens/settings/teamCopy.js';
import { SetupFlow } from './screens/setup/SetupFlow.js';
import { Terms } from './screens/setup/Terms.js';
import { mayPostOffers, memberOf } from './session/member.js';
import { useSession } from './session/useSession.js';
import { BottomNav } from './ui/BottomNav.js';
import { SiteBanner } from './ui/SiteBanner.js';
import { DesktopHeader } from './ui/DesktopShell.js';
import { useFoldAttribute, useFoldLayout } from './ui/fold.js';
import './styles/fold.css';
import { TradeRoom } from './screens/trade/TradeRoom.js';
import { setTradeChat } from './screens/trade/paySeams.js';
import { liveFanOut, setLiveSource } from './screens/trade/seams.js';
import './screens/trade/screens.js';

// Task 20's trade chat in Task 23's seam (BuyerPay's Chat sheet, the wide room's aside). A fixtures
// build replaces it with the board's stand-in (fixtures/payChat.ts, installed after this module loads).
setTradeChat(TradeChatPanel);

/**
 * The app shell. Phones, foldables' panes and the flip cover screen get the phone frame (the bottom
 * nav on the screens whose boards have it); the wide layout (1000 px and wider, no hinge) gets the
 * desktop header (Task 40, src/ui/fold.ts). The frame keeps one tree in every layout, so folding or
 * unfolding never remounts the screen: its route, scroll position and typed text stay.
 */
function Layout({ nav, banner }: { nav: boolean; banner: SiteBannerInfo | null }) {
  const layout = useFoldLayout();
  useFoldAttribute(layout);
  const wide = layout === 'wide';
  const session = useSession();
  return (
    <div data-shell={wide ? 'desktop' : 'phone'} className={wide ? 'x2f-desktop' : undefined}>
      {wide ? <DesktopHeader /> : null}
      <div data-shell-body="" className={wide ? 'x2f-desktop__body' : undefined}>
        {/* Plan 4 Task 8: the owner's banner at the top of every trader screen. */}
        <SiteBanner banner={banner} />
        <Outlet />
      </div>
      {nav && !wide ? <BottomNav postOffers={mayPostOffers(session)} /> : null}
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

/**
 * Task 19: while a trader is signed in, listens to live events; an `accepted` event opens the
 * "<name> accepted your offer" sheet over whatever screen is showing, then goes to the trade, and
 * each `trade` event goes on to the trade room (Task 22, seams.ts liveFanOut) and each `chat`
 * event to the open chat panels (Task 20, chat/live.ts).
 * Nothing here is a seen-receipt: a `refund_requested` event reaching a tab (hidden, minimised, on
 * another device) is not the buyer seeing the final alert. Task 25's `FinalAlert` posts that.
 */
function LiveAccepted({ member }: { member: boolean }) {
  const navigate = useNavigate();
  const [accepted, setAccepted] = useState<Extract<LiveEvent, { type: 'accepted' }> | null>(null);
  // Plan 2 Task 16: a new device asking to log in ("Is this you?"), over whatever screen is showing.
  const approvals = useLoginApprovals();
  // The trade room listens on this same connection (seams.ts liveFanOut); without a trader
  // session there is no live source and the room only polls.
  useEffect(() => {
    setLiveSource(liveFanOut.source);
    return () => setLiveSource(null);
  }, []);
  useLiveEvents((e) => {
    if (e.type === 'accepted') setAccepted(e);
    else if (e.type === 'trade') liveFanOut.emit(e);
    else if (e.type === 'login-approval') approvals.refresh();
    else if (e.type === 'chat') emitChatLive(e.chat);
  });
  if (approvals.current !== null) {
    return <LoginApprove key={approvals.current.id} approval={approvals.current} onDone={approvals.dismiss} />;
  }
  if (!accepted) return null;
  // Plan 2 Task 18 (review I1): a team member's device never offers the accept sheet (it would
  // store a ConfirmedTrade on a device that can never run the escrow); the owner still gets the push.
  if (member) {
    return (
      <Sheet open title={MEMBER_TRADE_COPY.acceptedTitle} onClose={() => setAccepted(null)}>
        <div className="x2f-stack" data-part="member-accepted">
          <p>{MEMBER_TRADE_COPY.accepted(accepted.by)}</p>
          <Button variant="primary" onClick={() => setAccepted(null)}>{MEMBER_TRADE_COPY.ok}</Button>
        </div>
      </Sheet>
    );
  }
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
  const m = me as { kind?: unknown; level?: unknown; termsCurrent?: unknown; member?: { roles?: unknown } | null };
  // Plan 2 Task 18: a team member without Trades gets no trade stream (the API answers 403 forbidden).
  const member = m.member;
  if (member !== undefined && member !== null && !(Array.isArray(member.roles) && member.roles.includes('trades'))) return false;
  return m.kind === 'trader' && m.level === 'full' && m.termsCurrent !== false;
}

/**
 * Session length (owner, 2 Nov 2026): on page load the signed-in session's length and end are
 * handed to "Stay logged in?" (`SessionPrompt`). After a login, the length question does it.
 */
function useWatchSession(session: ReturnType<typeof useSession>): void {
  useEffect(() => {
    if (session.status === 'signed-out') publishIdleReminder(null);
    if (session.status !== 'signed-in') return;
    const me = session.me;
    if (me.session != null) publishSessionWatch({ info: me.session, methods: me.methods });
    // Owner Q75: the person's own idle reminder (off unless they turned it on).
    publishIdleReminder(me.idleReminderMinutes ?? null);
  }, [session]);
}

export function App() {
  const session = useSession();
  useWatchSession(session);
  // Plan 4 Task 8: the banner, and maintenance, which replaces the whole app with the owner's message.
  const { site, refresh } = useSite();
  if (site.maintenance !== null) return <Maintenance maintenance={site.maintenance} onRetry={refresh} />;
  return (
    <>
      <RouterBridge />
      <SessionPrompt />
      <IdleReminder />
      {isTrader(session) ? <LiveAccepted member={memberOf(session) !== null} /> : null}
      <Routes>
        <Route element={<Layout nav banner={site.banner} />}>
          <Route path="/sell" element={<MethodList side="sell" copy={SELL_COPY} />} />
          <Route path="/buy" element={<MethodList side="buy" copy={BUY_COPY} />} />
          <Route path="/profile/offers" element={<MyOffers />} />
        </Route>
        <Route element={<Layout nav={false} banner={site.banner} />}>
          <Route path="/post" element={<PostOffer />} />
          {/* The offers and their quote share one component (two panes on a fold, Fold-Offers). */}
          <Route path="/sell/:methodId" element={<OffersRoute side="sell" copy={SELL_COPY} />} />
          <Route path="/buy/:methodId" element={<OffersRoute side="buy" copy={BUY_COPY} />} />
          <Route path="/sell/:methodId/:offerId" element={<OffersRoute side="sell" copy={SELL_COPY} />} />
          <Route path="/buy/:methodId/:offerId" element={<OffersRoute side="buy" copy={BUY_COPY} />} />
          <Route path="/trade/:code" element={<TradeRoom />} />
          {/* Task 27: DisputeOpen and ?view=chat (a disputed trade's room shows the dispute through its slot). */}
          <Route path="/trade/:code/dispute" element={<DisputeScreen />} />
          <Route path="/wallets" element={<Wallets />} />
          <Route path="/setup/*" element={<SetupFlow />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/login" element={<Login />} />
          <Route path={SESSION_LENGTH_PATH} element={<SessionLengthScreen />} />
          <Route path="/login/backup" element={<BackupLogin />} />
          <Route path="/settings/security" element={<Security />} />
          <Route path="/settings/devices" element={<DevicesRoute />} />
          <Route path={IDLE_REMINDER_PATH} element={<IdleReminderScreen />} />
          <Route path="/settings/blocked" element={<Blocked />} />
          <Route path="/settings/team" element={<Team />} />
          <Route path="/settings/account-type" element={<AccountType />} />
          <Route path="/team/join" element={<MemberInvite />} />
          <Route path="/news" element={<News />} />
          <Route path="/feedback" element={<Feedback />} />
        </Route>
        <Route path="*" element={<Navigate to="/sell" replace />} />
      </Routes>
    </>
  );
}
