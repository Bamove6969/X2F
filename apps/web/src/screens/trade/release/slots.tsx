import { Link } from 'react-router';
import { Released } from '../Released.js';
import { SellerConfirm } from '../SellerConfirm.js';
import { TradeReview } from '../../review/TradeReview.js';
import { methodOf, publicName, type ReleaseEscrow, type ReleaseTrade } from './view.js';

/**
 * Task 24's screens in the trade room (TradeRoom routes role × state; lead's plan: "Task 24:
 * seller in `paid`; both in `settling` (release) and `released`"):
 *   - the seller in `paid`, and in `settling` for a release (its done look) → SellerConfirm;
 *   - the buyer in `settling` for a release, and either side in `released` → Released (the board
 *     shows the buyer the released screen as soon as the seller has released).
 * Everything else belongs to another task's screen (null).
 */
export type ReleaseScreen = 'seller-confirm' | 'released';

export function releaseScreenOf(t: Pick<ReleaseTrade, 'role' | 'state' | 'settling'>): ReleaseScreen | null {
  if (t.state === 'released') return 'released';
  const releasing = t.state === 'settling' && t.settling === 'release';
  if (t.role === 'seller' && (t.state === 'paid' || releasing)) return 'seller-confirm';
  if (t.role === 'buyer' && releasing) return 'released';
  return null;
}

/**
 * What the trade room hands a screen: Task 22's `TradeScreenProps` (TradeRoom.tsx), narrowed to
 * what these screens read, so `ReleaseRoomScreen` registers as is. `escrow` is the room's one
 * handle (Task 12's `useEscrow`); a screen never starts its own.
 */
export interface ReleaseRoomProps {
  /** The trade code the room's escrow runs for (the route's): the release marker's key, never `view.code`. */
  code: string;
  view: ReleaseTrade;
  escrow: ReleaseEscrow;
  refresh(): Promise<void>;
  serverClock(): Date;
  wide: boolean;
}

/** The trade header's Chat link (the board's); the chat itself is Task 20's ChatPanel in the room. */
function ChatLink({ code }: { code: string }) {
  return (
    <Link className="x2f-release__chat" to={`/trade/${code}#chat`} data-chat-link="">
      Chat
    </Link>
  );
}

/** SellerConfirm or Released for the room's view; nothing for a state that is not Task 24's. */
export function ReleaseRoomScreen({ code, view, escrow, refresh, serverClock }: ReleaseRoomProps) {
  const screen = releaseScreenOf(view);
  if (screen === 'released') {
    // Plan 5 Task 6: the rating card under Released once the trade is released (not while the
    // buyer's device still co-signs in `settling`); TradeReview asks the API whether this side may rate.
    const review =
      view.state === 'released' ? <TradeReview code={code} counterparty={publicName(view.counterparty)} rated={view.role === 'buyer' ? 'seller' : 'buyer'} /> : undefined;
    return <Released trade={view} escrow={escrow} reviewSlot={review} />;
  }
  if (screen === 'seller-confirm') {
    return (
      <SellerConfirm
        escrowCode={code}
        trade={view}
        method={methodOf(view)}
        escrow={escrow}
        onTrade={() => void refresh()}
        serverClock={serverClock}
        headerAction={<ChatLink code={code} />}
      />
    );
  }
  return null;
}

/**
 * Task 24's slots in Task 22's room (TradeRoom.tsx's ownership list), registered by
 * releaseScreens.ts (screens.ts imports it).
 */
export const RELEASE_SLOTS = [
  { owner: 'Task 24', role: 'seller', states: ['paid'], screen: ReleaseRoomScreen },
  {
    owner: 'Task 24',
    role: 'any',
    states: ['settling'],
    when: (view: Pick<ReleaseTrade, 'settling'>) => view.settling === 'release',
    screen: ReleaseRoomScreen,
  },
  { owner: 'Task 24', role: 'any', states: ['released'], screen: ReleaseRoomScreen },
] as const;
