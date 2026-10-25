import { Link } from 'react-router';
import { Released } from '../Released.js';
import { SellerConfirm } from '../SellerConfirm.js';
import { methodInfo, type ReleaseEscrow, type ReleaseTrade } from './view.js';

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
 * What the trade room hands a screen: structurally Task 22's `TradeScreenProps`
 * (wip/lead-p3-task22 apps/web/src/screens/trade/TradeRoom.tsx), so `ReleaseRoomScreen` registers
 * as is. `escrow` is the room's one handle (Task 12's `useEscrow`); a screen never starts its own.
 */
export interface ReleaseRoomProps {
  view: ReleaseTrade;
  escrow: ReleaseEscrow;
  refresh(): Promise<void>;
  serverClock(): Date;
  wide: boolean;
}

/** The trade header's Chat link (the board's); the chat itself is Task 20's ChatPanel in the room. */
function ChatLink({ code }: { code: string }) {
  return (
    <Link className="x2f-release__chat" to={`/trade/${code}#chat`}>
      Chat
    </Link>
  );
}

/** SellerConfirm or Released for the room's view; nothing for a state that is not Task 24's. */
export function ReleaseRoomScreen({ view, escrow, refresh, serverClock }: ReleaseRoomProps) {
  const screen = releaseScreenOf(view);
  if (screen === 'released') return <Released trade={view} />;
  if (screen === 'seller-confirm') {
    return (
      <SellerConfirm
        trade={view}
        method={methodInfo(view)}
        escrow={escrow}
        onTrade={() => void refresh()}
        serverClock={serverClock}
        headerAction={<ChatLink code={view.code} />}
      />
    );
  }
  return null;
}

/**
 * The registrations for Task 22's `registerTradeScreen`, one per slot the lead gave Task 24. When
 * TradeRoom is on the line (release-tripwires.test.ts), SellerConfirm.tsx adds at top level
 * `for (const s of RELEASE_SLOTS) registerTradeScreen(s);` and screens.ts gets its Task 24 line.
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
