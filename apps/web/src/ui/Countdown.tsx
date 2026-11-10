import { Fragment, useEffect, useRef, useState } from 'react';
import './ui.css';

export type CountdownFormat = 'clock' | 'minutes';

/** One number and its unit in a duration ("1 h", "52 min"). */
export interface DurationPart {
  n: string;
  unit: 'd' | 'h' | 'min';
}

/**
 * The parts of `formatRemaining(ms, 'minutes')`: [{n:'1',unit:'h'},{n:'52',unit:'min'}] for
 * "1 h 52 min" (rounded up to the minute, so never 0 min while time is left). Over two days (waits of
 * up to 4 days, owner F9): days and hours, never "95 h 59 min"; up to 48 h stays in hours (the
 * appeal countdown's board reads "47 h 58 min").
 */
export function durationParts(ms: number): DurationPart[] {
  const min = Math.ceil(Math.max(0, ms) / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return [{ n: String(m), unit: 'min' }];
  if (h > 48 || (h === 48 && m > 0)) {
    const d = Math.floor(h / 24);
    return h % 24 === 0 ? [{ n: String(d), unit: 'd' }] : [{ n: String(d), unit: 'd' }, { n: String(h % 24), unit: 'h' }];
  }
  return m === 0 ? [{ n: String(h), unit: 'h' }] : [{ n: String(h), unit: 'h' }, { n: String(m), unit: 'min' }];
}

/** One number and its unit: the number is set in mono, the unit in body type (kit handoff 1.5). */
export interface TimePart {
  n: string;
  u: 'd' | 'h' | 'min' | 's';
}

/**
 * Time left as parts (design kit handoff 1.5, the timer rule): mono digits with body units, no
 * colon and no zero-padding. 'clock' counts seconds ("28 min 42 s", TradeFund; "4 min 59 s",
 * LoginApprove; under a minute "59 s"; with hours "1 h 52 min"). 'minutes' is the longer windows
 * ("1 h 52 min", SellerConfirm), rounded up so it never reads 0 min while time is left; over two
 * days, days and hours ("3 d 23 h", `durationParts`).
 */
export function remainingParts(ms: number, format: CountdownFormat): TimePart[] {
  const left = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const hm = (min: number): TimePart[] => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return [{ n: String(m), u: 'min' }];
    return m === 0 ? [{ n: String(h), u: 'h' }] : [{ n: String(h), u: 'h' }, { n: String(m), u: 'min' }];
  };
  if (format === 'minutes') return durationParts(left).map((p) => ({ n: p.n, u: p.unit }));
  const s = Math.ceil(left / 1000);
  // With an hour or more left the seconds are dropped (the boards' "1 h 52 min").
  if (s >= 3600) return hm(Math.floor(s / 60));
  const m = Math.floor(s / 60);
  const sec: TimePart = { n: String(s % 60), u: 's' };
  return m === 0 ? [sec] : [{ n: String(m), u: 'min' }, sec];
}

/** The parts as plain text, e.g. "28 min 42 s" or "1 h 52 min". */
export function formatRemaining(ms: number, format: CountdownFormat): string {
  return remainingParts(ms, format)
    .map((p) => `${p.n} ${p.u}`)
    .join(' ');
}

const WORD: Record<TimePart['u'], [string, string]> = { d: ['day', 'days'], h: ['hour', 'hours'], min: ['minute', 'minutes'], s: ['second', 'seconds'] };

/** The parts in words for a screen reader, e.g. "28 minutes 42 seconds" or "1 minute 1 second". */
export function remainingWords(parts: readonly TimePart[]): string {
  return parts.map((p) => `${p.n} ${WORD[p.u][p.n === '1' ? 0 : 1]}`).join(' ');
}

/** Mono digits with body units, as the kit draws a timer: `<mono>28</mono> min <mono>42</mono> s`. */
export function TimeParts({ parts }: { parts: readonly TimePart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={p.u}>
          {i > 0 ? ' ' : null}
          <span className="x2f-countdown__n">{p.n}</span> <span className="x2f-countdown__u">{p.u}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * A length of time as the conventions write it (2 Nov 2026): digits in mono, unit words in the body
 * face, one space before each unit ("1 h 52 min", never "1h52min" or wide mono gaps). The text
 * content is exactly `formatRemaining(ms, 'minutes')`, unless `parts` gives the units (a rule's own
 * length, such as the dispute wait's "90 min").
 */
export function Duration({ ms, parts }: { ms: number; parts?: DurationPart[] }) {
  return (
    <span className="x2f-duration">
      {(parts ?? durationParts(ms)).map((p, i) => (
        <Fragment key={p.unit}>
          {i > 0 ? ' ' : null}
          <span className="x2f-duration__n">{p.n}</span> <span className="x2f-duration__unit">{p.unit}</span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Time left until a server deadline, read from the server clock (`useServerClock`), never the
 * device clock (Review Focus 3). `data-mask=clock` hides it from pixel parity (Task 15). The
 * timer's accessible name is the time in words ("28 minutes 42 seconds").
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

  // An unreadable deadline shows nothing rather than "NaN".
  if (!Number.isFinite(ms)) return null;

  const parts = remainingParts(ms, format);
  return (
    <span className="x2f-countdown" role="timer" data-mask="clock" data-format={format} aria-label={remainingWords(parts)}>
      {format === 'minutes' ? <Duration ms={ms} /> : <TimeParts parts={parts} />}
    </span>
  );
}
