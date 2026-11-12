import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { setNavigator } from './api/client.js';
import { useLiveEvents, type LiveEvent } from './api/events.js';
import { SiteContext, useSite, type PlannedMaintenanceInfo, type SiteBannerInfo } from './api/site.js';
import { TradeChatPanel } from './chat/ChatPanel.js';
import { chatPaymentDetailsSource } from './chat/payDetailsFeed.js';
import { emitChatLive } from './chat/live.js';
import { AcceptedSheet, acceptedNavigation } from './screens/AcceptedSheet.js';
import { Button } from './ui/Button.js';
import { Sheet } from './ui/Sheet.js';
import { SyncGate } from './ui/SyncGate.js';
import { useResumeSync, watchResume } from './session/syncFirst.js';
import { Maintenance } from './screens/Maintenance.js';
import { MyOffers } from './screens/MyOffers.js';
import { BadgeSettings } from './screens/profile/BadgeSettings.js';
import { MyProfile, TraderProfileRoute } from './screens/profile/Profile.js';
import { DisputeReview } from './screens/review/DisputeReview.js';
import { PublicRecord, RecordExport } from './screens/profile/Record.js';
import { Trades } from './screens/Trades.js';
import { News } from './screens/News.js';
import { Feedback } from './screens/Feedback.js';
import { AccountFrozenRoute, FROZEN_PATH, FrozenWatch } from './screens/account/AccountFrozen.js';
import { PostOffer } from './screens/PostOffer.js';
import { Wallets } from './screens/Wallets.js';
import { BUY_COPY } from './screens/browse/BuyCopy.js';
import { MethodList } from './screens/browse/MethodList.js';
import { OffersRoute } from './screens/browse/OffersRoute.js';
import { SELL_COPY } from './screens/browse/SellCopy.js';
import { BackupLogin } from './screens/auth/BackupLogin.js';
import { Landing } from './screens/auth/Landing.js';
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
import { JabberSetup } from './screens/settings/JabberSetup.js';
import { JabberEventsScreen } from './screens/settings/JabberEvents.js';
import { AlarmListener } from './alerts/alarm.js';
import { DevicesRoute } from './screens/settings/Devices.js';
import { AccountChangesScreen, ChangesBanner, ChangesCapPopup } from './screens/settings/HoldChanges.js';
import { Security } from './screens/settings/Security.js';
import { Team } from './screens/settings/Team.js';
import { AccountType } from './screens/settings/AccountType.js';
import { MEMBER_TRADE_COPY } from './screens/settings/teamCopy.js';
import { SetupFlow } from './screens/setup/SetupFlow.js';
import { Terms } from './screens/setup/Terms.js';
import { BehindTheDoor, isInside } from './session/frontDoor.js';
import { mayOpenLiveEvents, mayPostOffers, mayReadTrades, mayViewWallets, memberOf } from './session/member.js';
import { useSession } from './session/useSession.js';
import { BottomNav } from './ui/BottomNav.js';
import { ScreenHeader, screenName } from './ui/ScreenHeader.js';
import { HelpTopic } from './screens/HelpTopic.js';
import { PlannedMaintenanceBanner } from './ui/PlannedMaintenanceBanner.js';
import { SiteBanner } from './ui/SiteBanner.js';
import { DesktopRail, WideTop, wideFrameOf } from './ui/DesktopShell.js';
import { useFoldAttribute, useFoldLayout } from './ui/fold.js';
import './styles/fold.css';
import { TradeRoom } from './screens/trade/TradeRoom.js';
import { WelcomeGate } from './screens/welcome/WelcomeGate.js';
import { WelcomeScreen } from './screens/welcome/WelcomeScreen.js';
import { TourProvider } from './tour/TourProvider.js';
import { WELCOME_PATH } from './tour/welcomeSeen.js';
import { setPaymentDetailsSource, setProofSource, setTradeChat } from './screens/trade/paySeams.js';
import { chatProofState } from './proof/chatProof.js';
import { liveFanOut, setLiveSource } from './screens/trade/seams.js';
import './screens/trade/screens.js';

// Task 20's trade chat in Task 23's seam (BuyerPay's Chat sheet, the wide room's aside). A fixtures
// build replaces it with the board's stand-in (fixtures/payChat.ts, installed after this module loads).
setTradeChat(TradeChatPanel);
// J-08 (S-090): the buyer's "Send exactly" card reads the seller's details from the newest package
// in the trade's encrypted chat. A fixtures build replaces this too (fixtures/payChat.tsx).
setPaymentDetailsSource(chatPaymentDetailsSource);
// "Mark paid without proof?" reads the buyer's chat and a proof just sent here (attached, none or unavailable).
setProofSource(chatProofState);

/**
 * The app shell. Phones, foldables' panes and the flip cover screen get the phone frame (the bottom
 * nav on the screens whose boards have it); the wide layout (1000 px and wider, no hinge) gets the
 * left rail, or the centred logo before login (Job 3, src/ui/DesktopShell.tsx; Task 40, src/ui/fold.ts). The frame keeps one tree in every layout, so folding or
 * unfolding never remounts the screen: its route, scroll position and typed text stay.
 */
function Layout({ nav, banner, door = false, planned }: { nav: boolean; banner: SiteBannerInfo | null; door?: boolean; planned: PlannedMaintenanceInfo | null }) {
  const layout = useFoldLayout();
  useFoldAttribute(layout);
  const wide = layout === 'wide';
  const session = useSession();
  const { pathname } = useLocation();
  // Job 3: the 240 px left rail after login, the centred logo before it. The first slot changes,
  // the body stays the second child, so moving between them never remounts the screen.
  // On the front door, someone not (yet) inside gets no links to the screens behind it: never the
  // rail; the centred logo (it links nowhere) only where the wide frame is the pre-login one.
  const outside = door && !isInside(session);
  // The help pages are on the front door but are read signed in too (review 12 Nov, L3): someone
  // inside keeps the rail there; someone outside gets the pre-login frame, as on /login.
  const helpInside = HELP.test(pathname) && isInside(session);
  const frame = outside ? 'centred' : helpInside ? 'rail' : wideFrameOf(pathname);
  let top: ReactNode = null;
  if (wide && frame === 'rail') top = <DesktopRail postOffers={mayPostOffers(session)} wallets={mayViewWallets(session)} trades={mayReadTrades(session)} />;
  else if (wide && wideFrameOf(pathname) === 'centred') top = <WideTop name={screenName(pathname)} />;
  return (
    <div data-shell={wide ? 'desktop' : 'phone'} data-wide-frame={wide ? frame : undefined} className={wide ? 'x2f-desktop' : undefined}>
      {top}
      <div data-shell-body="" className={wide ? 'x2f-desktop__body' : undefined}>
        {/* Plan 4 Task 8: the owner's banner at the top of every trader screen. */}
        {/* J-04 (owner G19): a planned maintenance announced ahead, in the big bright banner, on every layout, the front door's too (lead default, owner p11-120). */}
        {/* Owner demo notes 12 Nov #37 (DESIGNER-REVIEW): logo D and the screen name on every phone screen;
            the Landing board has its own large logo, and Buy/Sell draw this header in their own bar. The
            foldable layouts (cover, panes, tabletop) keep their hinge-placed frames without it for now. */}
        {layout === 'phone' && pathname !== '/' && !BROWSE.test(pathname) && !TRADE_ROOM.test(pathname) ? <ScreenHeader /> : null}
        <PlannedMaintenanceBanner plan={planned} />
        <SiteBanner banner={banner} />
        {/* Hold model v3: waiting changes and a new recovery code, on every screen (HoldChange board). */}
        <ChangesBanner />
        {/* C-021: on the screens whose actions change a trade or an offer, "Updating…" while the tab syncs after becoming active again. */}
        <SyncGate />
        <Outlet />
      </div>
      <ChangesCapPopup />
      {nav && !wide ? <BottomNav postOffers={mayPostOffers(session)} wallets={mayViewWallets(session)} trades={mayReadTrades(session)} /> : null}
    </div>
  );
}

/** The help placeholders (screens/HelpTopic.tsx). */
const HELP = /^\/help(\/|$)/;

/** Buy and Sell's own bar carries the shared header (MethodList). */
const BROWSE = /^\/(buy|sell)\/?$/;
/**
 * The trade room and its dispute draw the shared header inside TradeHeader (logo D, "Trade · K7M2"),
 * in the room's own tree: the room keeps one tree and its scroll across folding, which a header
 * appearing above it in the shell would move. DESIGNER-REVIEW.
 */
const TRADE_ROOM = /^\/trade\//;

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


/**
 * A full trader session (`kind` trader, `level` full, current Terms), for the alarm listener and the
 * freeze watch; a member needs the Trades role. The live stream uses `mayOpenLiveEvents` instead.
 */
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
  const { site, refresh, sync } = useSite();
  // C-021 (owner p11-33): when this tab becomes active again it syncs first (session/syncFirst.ts);
  // the site's maintenance and trading-paused state is one of the pulls.
  useEffect(() => watchResume(), []);
  useResumeSync(sync);
  // GET /v1/site answers the banner only inside the door: read it again when someone logs in or out.
  const inside = isInside(session);
  useEffect(() => {
    refresh();
  }, [inside, refresh]);
  if (site.maintenance !== null) return <Maintenance maintenance={site.maintenance} onRetry={refresh} />;
  return (
    // The guided tour (owner, 12 Nov 2026) draws over whichever screen it is on.
    // Plan 4 Task 29: the site state reaches the offer lists, the quote and Post offer (the emergency stop).
    <SiteContext.Provider value={site}>
    <TourProvider>
      <RouterBridge />
      <SessionPrompt />
      <IdleReminder />
      {/* Live events: full trader sessions; a member's with either trades box (session/member.ts). */}
      {mayOpenLiveEvents(session) ? <LiveAccepted member={memberOf(session) !== null} /> : null}
      {/* W-006: the loud alarm rings in an open tab when a push arrives (off until turned on). */}
      {isTrader(session) ? <AlarmListener /> : null}
      {/* D-016: a frozen account owner gets the notice once per freeze after a login (GET /v1/account/freeze is the owner's alone). */}
      <FrozenWatch enabled={isTrader(session) && memberOf(session) === null} />
      <Routes>
        {/* Behind the front door (owner, 8 Nov 2026): a set-up trader's session, else the login (session/frontDoor.tsx). */}
        <Route element={<BehindTheDoor />}>
          <Route element={<Layout nav banner={site.banner} planned={site.plannedMaintenance} />}>
            {/* Owner, 12 Nov 2026 (demo note #47): a device's first visit sees the welcome screen before /sell. */}
            <Route path="/sell" element={<WelcomeGate><MethodList side="sell" copy={SELL_COPY} /></WelcomeGate>} />
            <Route path={WELCOME_PATH} element={<WelcomeScreen />} />
            <Route path="/buy" element={<MethodList side="buy" copy={BUY_COPY} />} />
            <Route path="/profile/offers" element={<MyOffers />} />
            {/* Plan 5 Task 12: my own profile (the Profile tab) and other traders' public profiles. */}
            <Route path="/profile" element={<MyProfile />} />
            <Route path="/u/:name" element={<TraderProfileRoute />} />
          </Route>
          <Route element={<Layout nav={false} banner={site.banner} planned={site.plannedMaintenance} />}>
            <Route path="/post" element={<PostOffer />} />
            {/* The offers and their quote share one component (two panes on a fold, Fold-Offers). */}
            <Route path="/sell/:methodId" element={<OffersRoute side="sell" copy={SELL_COPY} />} />
            <Route path="/buy/:methodId" element={<OffersRoute side="buy" copy={BUY_COPY} />} />
            <Route path="/sell/:methodId/:offerId" element={<OffersRoute side="sell" copy={SELL_COPY} />} />
            <Route path="/buy/:methodId/:offerId" element={<OffersRoute side="buy" copy={BUY_COPY} />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/trade/:code" element={<TradeRoom />} />
            {/* Task 27: DisputeOpen and ?view=chat (a disputed trade's room shows the dispute through its slot). */}
            <Route path="/trade/:code/dispute" element={<DisputeScreen />} />
            <Route path="/wallets" element={<Wallets />} />
            <Route path="/settings/security" element={<Security />} />
            <Route path="/settings/changes" element={<AccountChangesScreen />} />
            <Route path="/settings/devices" element={<DevicesRoute />} />
            <Route path="/settings/blocked" element={<Blocked />} />
            <Route path="/settings/jabber" element={<JabberSetup />} />
            {/* W-021: which events send a Jabber notice. */}
            <Route path="/settings/jabber/events" element={<JabberEventsScreen />} />
            <Route path="/settings/team" element={<Team />} />
            <Route path={IDLE_REMINDER_PATH} element={<IdleReminderScreen />} />
            <Route path="/settings/account-type" element={<AccountType />} />
            {/* Plan 5 Task 12: badge visibility and the signed reputation record. */}
            <Route path="/settings/badges" element={<BadgeSettings />} />
            {/* Plan 5 Task 19: dispute a review of me (from my own profile). */}
            <Route path="/profile/reviews/:id/dispute" element={<DisputeReview />} />
            <Route path="/settings/record" element={<RecordExport />} />
            <Route path="/u/:name/record" element={<PublicRecord />} />
            <Route path="/news" element={<News />} />
            <Route path="/feedback" element={<Feedback />} />
            {/* D-016: the frozen-account notice, from GET /v1/account/freeze (home while not frozen). */}
            <Route path={FROZEN_PATH} element={<AccountFrozenRoute />} />
          </Route>
        </Route>
        {/* The front door: open to anyone (FRONT_DOOR in session/frontDoor.tsx lists the same paths). */}
        <Route element={<Layout nav={false} door banner={site.banner} planned={site.plannedMaintenance} />}>
          {/* The Landing board (design review 2026-11-08 item 1): where every signed-out visitor lands. */}
          <Route path="/" element={<Landing />} />
          <Route path="/setup/*" element={<SetupFlow />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/login" element={<Login />} />
          <Route path={SESSION_LENGTH_PATH} element={<SessionLengthScreen />} />
          <Route path="/login/backup" element={<BackupLogin />} />
          <Route path="/team/join" element={<MemberInvite />} />
          {/* Owner demo notes 12 Nov #42: the help placeholders linked from /login and /session-length. */}
          {/* The help library (owner, 18 Nov 2026): every topic at /help, one at /help/:topic. */}
          <Route path="/help" element={<HelpTopic />} />
          <Route path="/help/:topic" element={<HelpTopic />} />
        </Route>
        {/* Anything else: the front door, which sends a set-up trader on to /sell. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TourProvider>
    </SiteContext.Provider>
  );
}
