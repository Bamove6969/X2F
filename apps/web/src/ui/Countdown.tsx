import { useEffect, useRef, useState } from 'react';
import './ui.css';

export type CountdownFormat = 'clock' | 'minutes';

/**
 * 'clock' is the funding timer style ("28:42", TradeFund board); 'minutes' the longer windows
 * ("1 h 52 min", SellerConfirm board), rounded up so it never reads 0 min while time is left; over
 * two days, days and hours ("3 d 23 h").
 */
export function formatRemaining(ms: number, format: CountdownFormat): string {
  const left = Math.max(0, ms);
  if (format === 'minutes') {
    const min = Math.ceil(left / 60_000);
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m} min`;
    // Over two days (waits of up to 4 days, owner F9): days and hours, never "95 h 59 min". Up to
    // 48 h stays in hours: the appeal countdown's board reads "47 h 58 min".
    if (h > 48 || (h === 48 && m > 0)) return h % 24 === 0 ? `${h / 24} d` : `${Math.floor(h / 24)} d ${h % 24} h`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const s = Math.ceil(left / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Time left until a server deadline, read from the server clock (`useServerClock`), never the
 * device clock (Review Focus 3). `data-mask=clock` hides it from pixel parity (Task 15).
 */
export function Countdown({
  deadline,
  serverClock,
  format = 'clock',
}: {
  deadline: Date | string;
  serverClock: () => Date;
  format?: CountdownFormat;
}) {
  const end = (deadline instanceof Date ? deadline : new Date(deadline)).getTime();
  const [ms, setMs] = useState(() => end - serverClock().getTime());
  // The clock is read through a ref so a new function identity on re-render does not restart the
  // interval.
  const clock = useRef(serverClock);
  clock.current = serverClock;

  useEffect(() => {
    if (!Number.isFinite(end)) return;
    const tick = () => setMs(end - clock.current().getTime());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end]);

  // An unreadable deadline shows nothing rather than "NaN:NaN".
  if (!Number.isFinite(ms)) return null;

  return (
    <span className="x2f-countdown" role="timer" data-mask="clock">
      {formatRemaining(ms, format)}
    </span>
  );
}
