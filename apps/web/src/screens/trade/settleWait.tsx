/**
 * What a settling trade waits for (Task 9 I/O, open edge 2; lead decision b). Once the API says a
 * trader's side of the settlement was claimed done (`releaseClaimedAt`), the trade waits for the
 * network to show the sweep: the settle window no longer reverts it, so the screen shows no
 * countdown and no time's-up look, even past `settleBy`. Before the claim, the signing window
 * counts down to `settleBy` on the server clock. `settleBy` itself is unchanged, so dispute access
 * after it is whatever the dispute screens already allow.
 *
 * Screens that own `settling` (Task 24's release screens) can embed `SettleWait`; the room's plain
 * status card shows it for every settling kind no screen owns yet.
 */
import type { TradeView } from '../../api/trade.js';
import { Countdown } from '../../ui/Countdown.js';

export type SettleWaitKind = 'claimed' | 'window';

/** 'claimed' while settling with a claim, 'window' while settling before one, else null. */
export function settleWaitOf(v: Pick<TradeView, 'state' | 'settleBy' | 'releaseClaimedAt'>): SettleWaitKind | null {
  if (v.state !== 'settling') return null;
  if (v.releaseClaimedAt !== null && v.releaseClaimedAt !== undefined) return 'claimed';
  return v.settleBy !== null ? 'window' : null;
}

export function SettleWait({
  view,
  serverClock,
}: {
  view: Pick<TradeView, 'state' | 'settling' | 'settleBy' | 'releaseClaimedAt'>;
  serverClock: () => Date;
}) {
  const kind = settleWaitOf(view);
  if (kind === 'claimed') {
    return (
      <p className="x2f-settle-wait" data-settle-wait="claimed">
        {view.settling === 'release' ? 'Release sent' : 'Refund sent'}, waiting for the network
      </p>
    );
  }
  if (kind === 'window' && view.settleBy !== null) {
    return (
      <p className="x2f-settle-wait" data-settle-wait="window">
        <Countdown deadline={view.settleBy} serverClock={serverClock} format="minutes" /> left to sign
      </p>
    );
  }
  return null;
}
