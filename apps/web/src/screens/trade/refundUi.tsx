// Small pieces shared by SellerRefund and FinalAlert.
import { formatXmr } from '@x2f/trade';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';

/** "1.25" for 1.25 XMR: the boards' prose amounts (the view's strings or the escrow status's bigints), exact to the atomic unit with trailing zeros dropped. */
export function xmrText(atomic: string | bigint): string {
  const full = formatXmr(BigInt(atomic), 12);
  return full.replace(/\.?0+$/, '');
}

/** The server's time now, re-read every second (Review Focus 3: never the device clock alone). */
export function useServerNow(serverClock: () => Date): Date {
  const clock = useRef(serverClock);
  clock.current = serverClock;
  const [now, setNow] = useState(() => serverClock());
  useEffect(() => {
    const id = setInterval(() => setNow(clock.current()), 1000);
    return () => clearInterval(id);
  }, []);
  // A new clock (a fresh view) is read at once, not on the next tick.
  useEffect(() => setNow(serverClock()), [serverClock]);
  return now;
}

/** POST /v1/trades/:code/events (Task 6); the answer is the new view, which the room re-reads anyway. */
export function postTradeEvent(code: string, e: { type: 'extend' } | { type: 'request-refund' }): Promise<unknown> {
  return api(`/v1/trades/${encodeURIComponent(code)}/events`, { method: 'POST', body: e });
}

/** The generic failure line (the trade-room boards have none of their own). */
export const TRY_AGAIN = 'That did not work. Try again.';
