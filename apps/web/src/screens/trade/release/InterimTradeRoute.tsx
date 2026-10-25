import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { api, serverClock } from '../../../api/client.js';
import { useReleaseEscrow } from './seams.js';
import { ReleaseRoomScreen, releaseScreenOf } from './slots.js';
import type { ReleaseTrade } from './view.js';

/**
 * INTERIM `/trade/:code` (Task 24), standing in for Task 22's TradeRoom until it merges, so the
 * release screens run in the real build. It does what the room does for Task 24's slots (reads
 * the trade, keeps it fresh, holds the one escrow handle, passes the room's props to
 * ReleaseRoomScreen) and shows the empty placeholder for every other state. Tripwire:
 * apps/web/test/release-tripwires.test.ts fails once TradeRoom.tsx exists; then register
 * RELEASE_SLOTS (slots.tsx), route `/trade/:code` to TradeRoom and delete this file.
 *
 * SEAM (Task 19, wip/lead-p3-task19): the trade is read again every TRADE_POLL_MS; the room also
 * follows Task 19's live `trade` events.
 */
export const TRADE_POLL_MS = 5_000;

export function InterimTradeRoute() {
  const { code = '' } = useParams();
  const [trade, setTrade] = useState<ReleaseTrade | null>(null);
  const escrow = useReleaseEscrow(code);

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
