/**
 * TradeRoom: the shared trade-room shell at `/trade/:code` (Plan 3 Task 22). It loads the trade,
 * keeps it fresh, owns the trade's one escrow handle and picks the screen for the viewer's role
 * and the trade's state from the slot registry below. Tasks 22-25 (and 27) plug their screens in
 * with `registerTradeScreen`; they never fetch the trade or start the escrow themselves.
 *
 * ## The slot interface (stable; change it only through the lead)
 *
 * ```ts
 * registerTradeScreen({
 *   owner: 'Task 23',                 // who registered it (shown in conflict errors)
 *   role: 'buyer',                    // 'buyer' | 'seller' | 'any'
 *   states: ['secured'],              // one or more TradeState values
 *   when: (view, nowMs) => true,      // optional guard; see "Choosing a screen"
 *   screen: BuyerPay,                 // ComponentType<TradeScreenProps>
 * });
 * ```
 *
 * Register at module top level in your screen's file, then add ONE import line for that file to
 * `./screens.ts` (each task has its own reserved line there, so merges do not conflict).
 *
 * ### What a screen gets (`TradeScreenProps`)
 * - `code`: the trade code the room's escrow was started with (the route's, normalized). Key
 *   anything that is about THIS device's escrow by it, never by `view.code` (API data). The room
 *   shows nothing but a refusal when the view's code is another trade's (Task 24 round-3 review,
 *   Important 1), so the two agree whenever a screen renders.
 * - `view`: the latest `TradeView` (GET /v1/trades/:code). Never cache parts of it: it is
 *   re-read on every live `trade` event for this code, every `POLL_MS`, and after `refresh()`.
 * - `escrow`: the trade's one `TradeEscrow` (Task 12's `useEscrow`, behind `seams.ts`). Call its
 *   actions; never call `useEscrow` yourself (two handles would start the escrow twice).
 * - `refresh()`: re-read the view now (after posting an event, for example).
 * - `serverClock()`: the server's clock, from `view.serverNow` (Review Focus 3). Use it for every
 *   countdown and deadline test, never `Date.now()`.
 * - `wide`: true in the wide layout, 1000 px and wider with no hinge (the Desktop board's room,
 *   Task 23). Everywhere else, a foldable's panes included, the screen draws its phone layout: the
 *   room puts it in the first pane and the chat in the next (Task 40, "Foldables" below).
 *
 * ### Choosing a screen
 * 1. If the escrow reports an integrity failure (`participants-mismatch`, `deal-mismatch`, or an
 *    API escrow address that differs from the one this device derived), the room shows
 *    SetupStatus's danger state whatever the slot: nobody funds or settles that trade.
 * 2. Otherwise, among the slots whose `role` (or 'any') and `states` match: the first one whose
 *    `when` returns true (in registration order), else the one without `when`.
 * 3. No match: a plain status card naming the state (until its task lands).
 * Two slots without `when` for the same role and state throw at registration: guard one of them
 * with `when`, or agree with the lead who owns it.
 *
 * ### Who owns which slot (lead's plan; register only your own)
 * - Task 22: buyer and seller in `setup`, `funding`; seller in `securing` (TradeFund, SetupStatus).
 * - Task 23: buyer in `securing`, `secured`, `paid` (BuyerPay: "Marked as paid", Finish; no cancel
 *   after "I've paid", Task 39); seller in `secured` (SellerWaiting); buyer in `settling` with `when` buyer-cancel /
 *   mutual-cancel (BuyerCancelling: the buyer's device builds the refund to the seller).
 * - Task 24: seller in `paid`; both in `settling` (release) and `released` (SellerConfirm, Released).
 *   Task 23's guarded buyer × `settling` wins over Task 24's unguarded one for the cancel kinds.
 * - Task 25: seller in `secured` with `when` past `payBy` (SellerRefund); seller in `settling` and
 *   `refunded`, and buyer in `settling`, with `when` the seller's cancel (`auto-refund`; SellerRefund's
 *   refund views, SellerCancelled). Owner 8 Nov: no final alert, the refund starts at once.
 * - Task 27: both in `disputed` (DisputeRoom, DisputeRuling); buyer in `refunded` (the refund with the
 *   48-hour "Open a dispute", owner 2026-10-29; was 90 days).
 * - Task 39: seller in `settling` and `refunded` with `when` buyer-cancel (SellerCancelConfirm: the
 *   seller's Confirm cancel once the returned XMR has all its confirmations; owner 2026-10-29).
 *
 * ### Rules for every screen
 * - Show the other trader only as `publicName(view.counterparty)` inside `data-username`; never a
 *   login name (FU-A), and no text-transform on it.
 * - Exactly one `[data-primary]` per screen (parity, Task 15); every phone size in Task 15's
 *   `PHONE_VIEWPORTS` (e2e/phone.ts, the one standard: 390x844 and 360x800) must fit with no
 *   horizontal scroll.
 * - Mark the header's Chat link or button with `data-chat-link`: it is hidden while the chat has a
 *   pane of its own (`useChatPane`), and a Chat sheet it opened closes. A Chat button that is the
 *   screen's one `[data-primary]` (SellerWaiting) is never marked: it stays visible and moves the
 *   focus to the chat pane (`focusChatPane`), so every layout keeps exactly one primary.
 *
 * ### Foldables (Task 40, src/ui/fold.ts, src/ui/Panes.tsx)
 * The room, not the screen, lays out the panes, and the screen stays mounted in every layout:
 * - two panes (600-999 px, or a book fold's two segments) and a tri-fold's three: the screen's
 *   phone layout in the first pane, the counterparty and the chat (Task 20's panel through
 *   `setTradeChat`) in the next. Not for `disputed`: the dispute room has its own chat.
 * - tabletop: `TradeGlance` (information only) in the top half; the screen and the chat, with
 *   every control, in the bottom half. Mark what the glance already shows (the header, a timer
 *   card, the "Send exactly" card) with `data-fold-glance`: it is left out of the bottom half
 *   there, and the screen's `.x2f-pay__footer` stays pinned to the bottom of it (styles/fold.css).
 * - the flip cover screen: `TradeGlance` (Fold-Cover's card) fills the screen; the screen's phone
 *   layout is under it, a scroll away, never hidden.
 * - `#chat` (the Chat links of Tasks 24-25): on a phone, on the cover screen and in the wide layout
 *   it opens the chat in a sheet; with a chat pane (or a screen's own wide chat aside, BuyerPay) it
 *   moves the focus to its composer once the chat is ready.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { normalizeTradeCode } from '@x2f/core';
import { ApiCallError, serverClock as makeServerClock } from '../../api/client.js';
import { getTrade, publicName, TRADE_STATES, type Party, type TradeState, type TradeView } from '../../api/trade.js';
import { memberOf } from '../../session/member.js';
import { displayNameOf, useSession } from '../../session/useSession.js';
import { setConfirmUser } from './confirmSkip.js';
import { forgetConfirmed, readConfirmed } from '../quote/confirmed.js';
import { tradeFromView } from '../dispute/api.js';
import { DisputeEntry } from '../dispute/DisputeEntry.js';
import { MEMBER_TRADE_COPY } from '../settings/teamCopy.js';
import { hasPanes, useFoldLayout, type FoldLayout } from '../../ui/fold.js';
import { Panes } from '../../ui/Panes.js';
import { Sheet } from '../../ui/Sheet.js';
import { useTradeChat } from './paySeams.js';
import { SettleWait } from './settleWait.js';
import { integrityFailed, POLL_MS, useTradeEscrow, useTradeLive, type ConfirmedTrade, type TradeEscrow } from './seams.js';
import { TradeGlance } from './TradeGlance.js';
import { CounterpartyCard } from './TradeTimeline.js';

export interface TradeScreenProps {
  /** The trade code the room's escrow runs for (the route's, normalized): never API data. */
  code: string;
  view: TradeView;
  escrow: TradeEscrow;
  refresh(): Promise<void>;
  serverClock(): Date;
  wide: boolean;
}

export type TradeScreen = ComponentType<TradeScreenProps>;

/** What a team member's version of a screen gets: everything but the escrow (a member's device runs none). */
export type MemberScreenProps = Omit<TradeScreenProps, 'escrow'>;

export interface TradeSlot {
  owner: string;
  role: Party | 'any';
  states: readonly TradeState[];
  when?: (view: TradeView, nowMs: number) => boolean;
  screen: TradeScreen;
  /**
   * What a team member's device shows for this slot (Plan 2 Task 18 review round 2, n3): only the
   * steps a Trades member may take that need no escrow on this device. Left out, a member gets the
   * plain status card. It can be `screen` itself when that screen never touches the escrow.
   */
  forMembers?: ComponentType<MemberScreenProps>;
}

const slots: TradeSlot[] = [];

/** Adds a screen for a role × state; returns a function that removes it (for tests). */
export function registerTradeScreen(slot: TradeSlot): () => void {
  // not-a-refusal: a developer error, never shown
  if (slot.states.length === 0) throw new Error(`${slot.owner}: a trade screen needs at least one state`);
  for (const s of slot.states) {
    if (!TRADE_STATES.includes(s)) throw new Error(`${slot.owner}: unknown trade state ${String(s)}`);
  }
  if (!slot.when) {
    for (const other of slots) {
      if (other.when) continue;
      const rolesMeet = other.role === slot.role || other.role === 'any' || slot.role === 'any';
      const shared = other.states.find((s) => slot.states.includes(s));
      if (rolesMeet && shared) {
        throw new Error(`${slot.owner}: ${slot.role} × ${shared} is already ${other.owner}'s screen (guard one with \`when\`)`);
      }
    }
  }
  const entry = { ...slot };
  slots.push(entry);
  return () => {
    const i = slots.indexOf(entry);
    if (i >= 0) slots.splice(i, 1);
  };
}

/** The slot chosen for this view at `nowMs` (server time), or null. */
function slotFor(view: TradeView, nowMs: number): TradeSlot | null {
  const fits = slots.filter((s) => (s.role === 'any' || s.role === view.role) && s.states.includes(view.state));
  return fits.find((s) => s.when?.(view, nowMs) === true) ?? fits.find((s) => !s.when) ?? null;
}

/** The registered screen for this view at `nowMs` (server time), or null; integrity failures are handled by the room. */
export function screenFor(view: TradeView, nowMs: number): TradeScreen | null {
  return slotFor(view, nowMs)?.screen ?? null;
}

/** A team member's screen for this view: the chosen slot's `forMembers`, or null (the plain status card). */
export function memberScreenFor(view: TradeView, nowMs: number): ComponentType<MemberScreenProps> | null {
  return slotFor(view, nowMs)?.forMembers ?? null;
}

/** The screen shown on an integrity failure (SetupStatus's danger state; set by Task 22's SetupStatus). */
let integrityScreen: TradeScreen | null = null;
export function setIntegrityScreen(s: TradeScreen | null): void {
  integrityScreen = s;
}

/** How long after a deadline the room re-reads the trade (the server's timers run on the minute). */
const DEADLINE_SLACK_MS = 1_000;

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | { kind: 'ready'; view: TradeView };

/** Reads the trade, and re-reads it on live events, every POLL_MS and on refresh(). */
function useTradeView(code: string): { load: Load; refresh: () => Promise<void> } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const view = await getTrade(code);
      if (mine === seq.current) setLoad({ kind: 'ready', view });
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof ApiCallError && e.status === 404) setLoad({ kind: 'missing' });
      // A failed re-read keeps the last good view on screen.
      else setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'failed' }));
    }
  }, [code]);
  useEffect(() => {
    setLoad({ kind: 'loading' });
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearInterval(id);
      seq.current++;
    };
  }, [refresh]);
  useTradeLive(code, () => void refresh());
  return { load, refresh };
}

/** Shown for a state whose screen has not landed yet; while settling, also what the trade waits for. */
export function StatusCard({ view, serverClock, member = false }: { view: TradeView; serverClock: () => Date; member?: boolean }) {
  return (
    <section className="x2f-trade-status" data-trade-state={view.state}>
      <p>Trade {view.code}</p>
      <p>State: {view.state.replace('_', ' ')}</p>
      <SettleWait view={view} serverClock={serverClock} member={member} />
    </section>
  );
}

export function TradeRoom() {
  const session = useSession();
  const { code = '' } = useParams();
  const location = useLocation();
  const { load, refresh } = useTradeView(code);
  // Owner p7-2: "Do not show me this warning again" belongs to the signed-in user (confirmSkip.ts).
  const confirmUser = session.status === 'signed-in' ? displayNameOf(session.me) : null;
  useEffect(() => setConfirmUser(confirmUser), [confirmUser]);

  if (load.kind === 'loading') return <main data-screen="trade" aria-busy="true" />;
  if (load.kind === 'missing') {
    return (
      <main data-screen="trade">
        <p role="alert">Trade not found.</p>
      </main>
    );
  }
  if (load.kind === 'failed') {
    return (
      <main data-screen="trade">
        <p role="alert">Couldn't load this trade. Check your connection and try again.</p>
      </main>
    );
  }
  // The API answered with another trade's view (a compromised or buggy API): fail closed before
  // any slot renders or the escrow starts, since a screen would act on THIS route's escrow under
  // the other trade's facts (Task 24 round-3 review, Important 1).
  const own = normalizeTradeCode(code);
  if (own === null || normalizeTradeCode(load.view.code) !== own) {
    return (
      <main data-screen="trade" data-trade-mismatch="">
        <p role="alert">Security check failed: X2F answered with a different trade. Nothing is signed or sent from this page. Don't fund or release this trade until it shows correctly.</p>
      </main>
    );
  }
  // Plan 2 Task 18 (review I1, I2): a team member's device never runs the escrow (only the
  // account owner's device can, until Plan 3 Task 42's member keys): wait for the session first, so
  // the escrow worker never boots on a member's device, then show the member's room.
  if (session.status === 'loading') return <main data-screen="trade" aria-busy="true" />;
  if (memberOf(session) !== null) return <MemberRoom code={own} view={load.view} refresh={refresh} />;
  // The escrow starts only once the API has shown this trade to this account (review of the
  // landing, Minor 1): a visitor, a staff account or a wrong code never boots the escrow worker or
  // leaves a run polling GET /v1/trades/:code.
  return <ReadyRoom key={code} code={code} ownCode={own} view={load.view} refresh={refresh} navState={location.state} hash={location.hash} />;
}

/**
 * A team member's trade room until Plan 3 Task 42 (NEEDS_PLAN3_TASK42_MEMBER_KEY): no escrow on
 * this device, so no funding, check words or release here. Kit parts only (NEEDS_DESIGN_TEAM).
 *
 * What a Trades member may still do on the trades the owner's device set up (owner question 13(d),
 * team/perms.ts; review round 2, n3), as far as it needs no escrow here:
 * - the slot's `forMembers` screen, if it has one: the seller's Withdraw of a standing proposal while
 *   the buyer pays (no Propose cancel, design proto review P2) (Task 23's SellerWaiting; a mutual cancel only records a choice, and the signing
 *   it leads to is the owner's device's), and the seller's Confirm cancel after a buyer's cancel
 *   (Task 39's SellerCancelConfirm, which never touches the escrow);
 * - otherwise the trade's state and a notice that the account owner's device does the rest;
 * - Open dispute (or Go to the dispute) whenever the state machine allows one: the dispute screen
 *   at /trade/:code/dispute runs no escrow (Task 27's DisputeEntry).
 * Not offered (open for the owner, see coordination.md): I've paid (the sum to pay must be the
 * escrow device's own, never the API's), the buyer's cancel and accepting a cancel (the buyer's
 * device builds the refund at that moment), and the chat (perms.ts places it with Task 42).
 */
function MemberRoom({ code, view, refresh }: { code: string; view: TradeView; refresh: () => Promise<void> }) {
  const serverNow = view.serverNow;
  const clock = useMemo(() => makeServerClock(serverNow), [serverNow]);
  const Screen = memberScreenFor(view, clock().getTime());
  return (
    <main data-screen="trade" data-trade-state={view.state} data-role={view.role} data-member="">
      {Screen ? (
        <Screen code={code} view={view} refresh={refresh} serverClock={clock} wide={false} />
      ) : (
        <>
          <StatusCard view={view} serverClock={clock} member />
          <section className="x2f-card x2f-stack" data-part="member-waiting">
            <p role="status">{MEMBER_TRADE_COPY.roomWaiting}</p>
          </section>
        </>
      )}
      <div className="x2f-stack" data-part="member-dispute">
        <DisputeEntry trade={tradeFromView(view)} now={clock()} />
      </div>
    </main>
  );
}

/** The room once the trade has loaded: owns the trade's one escrow handle and picks the screen. */
function ReadyRoom({ code, ownCode, view, refresh, navState, hash }: { code: string; ownCode: string; view: TradeView; refresh: () => Promise<void>; navState: unknown; hash: string }) {
  // What the user confirmed on the take or accept screen: the navigation's history state, else the
  // copy the quote or the accept sheet stored in this tab before navigating (history state is gone
  // in a new tab or when the trade is opened from a push notification). Task 12 needs it only for
  // the first start of the trade on this device.
  const fromState = (navState as { confirmed?: ConfirmedTrade } | null)?.confirmed;
  const stored = useMemo(() => (fromState ? null : readConfirmed(code)), [fromState, code]);
  const confirmed = fromState ?? stored ?? undefined;
  const escrow = useTradeEscrow(code, confirmed);
  // Once the escrow has stored the deal, the tab's copy (it holds the payout address) is not needed.
  const hasDeal = escrow.deal !== null;
  useEffect(() => {
    if (hasDeal) forgetConfirmed(code);
  }, [hasDeal, code]);
  const layout = useFoldLayout();
  const wide = layout === 'wide';
  const serverNow = view.serverNow;
  const clock = useMemo(() => makeServerClock(serverNow), [serverNow]);
  // Re-read just after the next deadline, so a screen chosen by time (`when`) switches on time.
  const deadline = view.nextDeadline;
  useEffect(() => {
    if (!deadline) return;
    const wait = Date.parse(deadline) - clock().getTime();
    if (!Number.isFinite(wait) || wait < 0 || wait > 2 ** 31 - 1) return;
    const id = setTimeout(() => void refresh(), wait + DEADLINE_SLACK_MS);
    return () => clearTimeout(id);
  }, [deadline, clock, refresh]);

  const props: TradeScreenProps = { code: ownCode, view, escrow, refresh, serverClock: clock, wide };
  const broken = integrityFailed(escrow, view);
  const Screen = broken ? integrityScreen : screenFor(view, clock().getTime());
  const Chat = useTradeChat();
  // The dispute room lays out its own chat (follow-up); a broken trade shows only its refusal.
  const chat = Chat !== null && view.state !== 'disputed' && !broken ? <Chat code={view.code} name={publicName(view.counterparty)} methodId={view.methodId} /> : null;
  const chatPane = chatPaneFor(layout, Chat !== null, view, broken);
  return (
    <main data-screen="trade" data-trade-state={view.state} data-role={view.role}>
      <Panes
        layout={layout}
        glance={broken ? null : <TradeGlance view={view} escrow={escrow} serverClock={clock} layout={layout === 'cover' ? 'cover' : 'tabletop'} />}
        glanceLabel="Trade at a glance"
        main={
          Screen ? (
            <Screen {...props} />
          ) : broken ? (
            // Fails closed even if no screen module registered the danger state.
            <p role="alert">Security check failed. Don't fund this trade.</p>
          ) : (
            <StatusCard view={view} serverClock={clock} />
          )
        }
        side={
          chatPane ? (
            <div className="x2f-room__aside">
              <CounterpartyCard view={view} />
              <div className="x2f-room__chat-panel">{chat}</div>
            </div>
          ) : null
        }
        sideLabel={`Chat with ${publicName(view.counterparty)}`}
      />
      <ChatHash hash={hash} layout={layout} chat={chat} chatPane={chatPane} name={publicName(view.counterparty)} screen={Screen} />
    </main>
  );
}

/** Whether the room shows the chat in a pane of its own (so a screen's Chat sheet is not needed). */
export function chatPaneFor(layout: FoldLayout, chatInstalled: boolean, view: Pick<TradeView, 'state'>, broken = false): boolean {
  return chatInstalled && view.state !== 'disputed' && !broken && hasPanes(layout);
}

/** `chatPaneFor` for a screen: true while the room's chat pane is showing. */
export function useChatPane(view: Pick<TradeView, 'state'>): boolean {
  return chatPaneFor(useFoldLayout(), useTradeChat() !== null, view);
}

const COMPOSER = ":is(input, textarea, [contenteditable='true'])";
/** The payee's payment-detail boxes (ChatPanel PayBoxes, J-08): inputs in the chat pane above its composer. */
const PAY_BOXES = '[data-pay-boxes]';
/** The room's chat pane (two panes, three, tabletop). */
const PANE_CHAT = "[data-pane='side']";
/** A screen's own chat aside in the wide layout (BuyerPay's WideRoom, the Desktop board). */
const ASIDE_CHAT = "[data-pane='main'] .x2f-room__chat-panel";

/**
 * The chat's own composer inside `where`: the first input that is not one of the payee's
 * payment-detail boxes, which sit in the same pane above it (J-08).
 */
function composerIn(where: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`${where} ${COMPOSER}`)) {
    if (el.closest(PAY_BOXES) === null) return el;
  }
  return null;
}

/** Moves the focus to the composer of the room's chat pane. */
export function focusChatPane(): void {
  composerIn(PANE_CHAT)?.focus();
}

/**
 * Focuses the composer inside `where` now, or as soon as it appears: Task 20's panel renders its
 * composer only once the chat is ready (the resolve, the device identity and the attestation round
 * trips), so a `#chat` that arrives first waits for it (round-2 review m3). It never takes the
 * focus from something the user moved it to in the meantime. Returns the cleanup.
 */
export function focusComposerWhenReady(where: string): () => void {
  const find = () => composerIn(where);
  const now = find();
  if (now) {
    now.focus();
    return () => undefined;
  }
  const before = document.activeElement;
  const watch = new MutationObserver(() => {
    const el = find();
    if (!el) return;
    watch.disconnect();
    if (document.activeElement === before || document.activeElement === document.body || document.activeElement === null) el.focus();
  });
  watch.observe(document.body, { childList: true, subtree: true });
  return () => watch.disconnect();
}

/**
 * `#chat` (the Chat links of SellerRefund, SellerConfirm and Released): on a phone, the cover
 * screen and the wide layout the chat opens in a sheet over the room and closing it drops the hash
 * (round-2 review I2: the wide room has no chat pane, so its links open the sheet too); with a chat
 * pane, or a screen's own wide chat aside (BuyerPay), the composer gets the focus once the chat is
 * ready, never a second panel. Its draft is the same either way (useKeptText).
 */
function ChatHash({ hash, layout, chat, chatPane, name, screen }: { hash: string; layout: FoldLayout; chat: ReactNode; chatPane: boolean; name: string; screen: unknown }) {
  const navigate = useNavigate();
  const wanted = hash === '#chat' && chat !== null;
  const wide = layout === 'wide';
  // Whether the screen on show draws its own chat aside (read once it is laid out). Keyed on the
  // chosen screen component, not on state and role: a screen can change by time within one state
  // (seller × `secured`: SellerWaiting with its aside, then SellerRefund past `payBy` with none;
  // Task 20 round-3 review n1).
  const [aside, setAside] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    setAside(wanted && wide ? document.querySelector(ASIDE_CHAT) !== null : null);
  }, [wanted, wide, screen]);
  useEffect(() => {
    if (!wanted) return;
    if (chatPane) return focusComposerWhenReady(PANE_CHAT);
    if (wide && aside === true) return focusComposerWhenReady(ASIDE_CHAT);
    return undefined;
  }, [wanted, chatPane, wide, aside]);
  if (!wanted || chatPane || (wide && aside !== false)) return null;
  return (
    <Sheet open title={`Chat with ${name}`} onClose={() => void navigate({ hash: '' }, { replace: true })}>
      <div className="x2f-sheet__body">{chat}</div>
    </Sheet>
  );
}
