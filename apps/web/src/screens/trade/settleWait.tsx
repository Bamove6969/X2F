/**
 * What a settling trade waits for (Task 9 I/O, open edge 2; lead decision b). Once the API says a
 * trader's side of the settlement was claimed done (`releaseClaimedAt`), the trade waits for the
 * network to show the sweep: the settle window no longer reverts it, so the screen shows no
 * countdown and no time's-up look, even past `settleBy`. Before the claim, the signing window
 * counts down to `settleBy` on the server clock. `settleBy` itself is unchanged, so dispute access
 * after it is whatever the dispute screens already allow.
 *
 * Who reaches it on the main line (Tasks 23 and 24 merged): release settling is Task 24's (the
 * buyer's `Released`, the seller's `SellerConfirm` in its releasing look) and the buyer's own
 * cancel is Task 23's `BuyerCancelling`; none of those shows a deadline. The room's plain status
 * card, and so `SettleWait`, is left with the seller in `buyer-cancel`/`mutual-cancel` and both
 * sides in `auto-refund`/`lapse-refund`. The release branch is kept for a future embed but is not
 * reachable in the room. The time line names signing only for a trader who builds or co-signs this
 * kind (escrow/policy.ts ROUTE); everyone else gets a neutral line. Past `settleBy` (before the
 * server's tick reverts the trade) or with an unreadable `settleBy`, no time line is shown.
 */
import type { TradeView } from '../../api/trade.js';
import { signsIn } from '../../escrow/policy.js';
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
  view: Pick<TradeView, 'state' | 'settling' | 'settleBy' | 'releaseClaimedAt' | 'role'>;
  serverClock: () => Date;
}) {
  const kind = settleWaitOf(view);
  if (kind === 'claimed') {
    // COPY-UNSIGNED: no copy board covers the settling wait lines yet.
    return (
      <p className="x2f-settle-wait" data-settle-wait="claimed">
        {view.settling === 'release' ? 'Release sent' : 'Refund sent'}, waiting for the network
      </p>
    );
  }
  if (kind === 'window' && view.settleBy !== null) {
    const ends = Date.parse(view.settleBy);
    // Unreadable, or already past on the server clock: no "0 min" line.
    if (!Number.isFinite(ends) || ends <= serverClock().getTime()) return null;
    const signer = view.settling !== null && signsIn(view.settling, view.role);
    const timer = <Countdown deadline={view.settleBy} serverClock={serverClock} format="minutes" />;
    // COPY-UNSIGNED: no copy board covers the settling wait lines yet.
    return (
      <p className="x2f-settle-wait" data-settle-wait="window">
        {signer ? <>{timer} left to sign</> : <>Being signed, {timer} left</>}
      </p>
    );
  }
  return null;
}
