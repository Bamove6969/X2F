import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../../api/client.js';
import { ReleaseSlot, releaseScreenOf } from './slots.js';
import type { MethodInfo, ReleaseTrade } from './view.js';

/**
 * INTERIM `/trade/:code` (Task 24), standing in for Task 22's TradeRoom until it merges, so the
 * release screens run in the real build. It renders ReleaseSlot for the states releaseScreenOf
 * names and the empty placeholder for everything else. Tripwire:
 * apps/web/test/release-tripwires.test.ts fails once TradeRoom.tsx exists; then route `/trade/:code`
 * to TradeRoom, have TradeRoom render `ReleaseSlot` where `releaseScreenOf(view)` is not null, and
 * delete this file.
 *
 * SEAM (Task 19, wip/lead-p3-task19): the trade is read again every TRADE_POLL_MS. Task 19's live
 * `{ type: 'trade', code, state }` event (apps/web/src/api/events.ts) replaces the polling in
 * TradeRoom.
 */
export const TRADE_POLL_MS = 5_000;

export function InterimTradeRoute() {
  const { code = '' } = useParams();
  const [trade, setTrade] = useState<ReleaseTrade | null>(null);
  const [method, setMethod] = useState<MethodInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setTrade(await api<ReleaseTrade>(`/v1/trades/${encodeURIComponent(code)}`));
    } catch {
      // Not signed in, not a participant or offline: the placeholder stays.
    }
  }, [code]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), TRADE_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const methodId = trade?.methodId;
  useEffect(() => {
    if (methodId === undefined) return;
    let gone = false;
    const whatItIs = (p: unknown) =>
      p !== null && typeof p === 'object' && typeof (p as { whatItIs?: unknown }).whatItIs === 'string' ? (p as { whatItIs: string }).whatItIs : '';
    void (async () => {
      let name = methodId;
      try {
        // Task 3's catalog (no session needed): the method's display name.
        const list = await api<{ all: { id: string; name: string }[] }>('/v1/methods');
        name = list.all.find((m) => m.id === methodId)?.name ?? methodId;
      } catch {
        // The id stands in for the name.
      }
      if (!gone) setMethod({ name, whatItIs: whatItIs(trade?.profile) });
    })();
    return () => {
      gone = true;
    };
    // The profile only changes with the method.
  }, [methodId]);

  if (trade === null || method === null || releaseScreenOf(trade) === null) return <main data-screen="trade" />;
  // The board's Chat link; Task 20's ChatPanel lives in TradeRoom (Tasks 22, 23).
  const chat = (
    <Link className="x2f-release__chat" to={`/trade/${trade.code}#chat`}>
      Chat
    </Link>
  );
  return <ReleaseSlot trade={trade} method={method} onTrade={setTrade} headerAction={chat} />;
}
