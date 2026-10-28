import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { api, serverClock } from '../../../api/client.js';
import type { ConfirmedTrade } from '../../../escrow/runtime.js';
import { useEscrow } from '../../../escrow/useEscrow.js';
import { readConfirmed } from '../../quote/confirmed.js';
import { ReleaseRoomScreen, releaseScreenOf } from './slots.js';
import type { ReleaseTrade } from './view.js';

/**
 * INTERIM `/trade/:code` (Task 24), standing in for Task 22's TradeRoom until it merges, so the
 * release screens run in the real build. It does what the room does for Task 24's slots (reads
 * the trade, keeps it fresh, holds the one escrow handle, passes the room's props to
 * ReleaseRoomScreen) and shows the empty placeholder for every other state. The escrow is Task
 * 12's `useEscrow(code, confirmed)`, started as Task 22's room starts it (wip/lead-p3-task22-land
 * 76aea46): the navigation's `confirmed`, else the copy the quote or accept sheet stored. Tripwire:
 * apps/web/test/release-tripwires.test.ts fails once TradeRoom.tsx exists; then register
 * RELEASE_SLOTS (slots.tsx), route `/trade/:code` to TradeRoom and delete this file.
 *
 * The trade is read again every TRADE_POLL_MS. Task 19's live events are on the main line, but
 * the one `/v1/events` connection belongs to App.tsx's LiveAccepted; Task 22's room fans it out
 * (`setLiveSource`), so this stand-in only polls rather than open a second connection.
 */
export const TRADE_POLL_MS = 5_000;

export function InterimTradeRoute() {
  const { code = '' } = useParams();
  const location = useLocation();
  const [trade, setTrade] = useState<ReleaseTrade | null>(null);
  const fromState = (location.state as { confirmed?: ConfirmedTrade } | null)?.confirmed;
  const stored = useMemo(() => (fromState ? null : readConfirmed(code)), [fromState, code]);
  const escrow = useEscrow(code, fromState ?? stored ?? undefined);

  const refresh = useCallback(async () => {
    try {
      setTrade(await api<ReleaseTrade>(`/v1/trades/${encodeURIComponent(code)}`));
    } catch {
      // Not signed in, not a participant or offline: the last view (or the placeholder) stays.
    }
  }, [code]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), TRADE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const serverNow = trade?.serverNow;
  const clock = useMemo(() => (serverNow ? serverClock(serverNow) : () => new Date()), [serverNow]);

  if (trade === null || releaseScreenOf(trade) === null) return <main data-screen="trade" />;
  return (
    <main data-screen="trade" data-trade-state={trade.state} data-role={trade.role}>
      <ReleaseRoomScreen view={trade} escrow={escrow} refresh={refresh} serverClock={clock} wide={false} />
    </main>
  );
}
