// @vitest-environment happy-dom
// The one date format (design conventions 2 Nov 2026: "6 Nov 2026, 15:00 UTC", in mono) and the
// mono-digit durations ("1 h 52 min": digits mono, units in the body face, a space before each
// unit; design review 1 Nov X5, X7 and shot 39's "in2 h").
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatUtcTime, isMoment } from '../src/ui/dates.js';
import { Countdown, Duration, durationParts, formatRemaining } from '../src/ui/Countdown.js';
import { When } from '../src/ui/When.js';
import { render } from './render.js';

describe('dates.ts: one format, always UTC', () => {
  it('writes "6 Nov 2026, 15:00 UTC"', () => {
    expect(formatDateTime('2026-11-06T15:00:00.000Z')).toBe('6 Nov 2026, 15:00 UTC');
    expect(formatDateTime(new Date(Date.UTC(2026, 0, 1, 0, 5)))).toBe('1 Jan 2026, 00:05 UTC');
    expect(formatDateTime(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe('31 Dec 2026, 23:59 UTC');
  });

  it('is UTC, not the viewer\'s zone: an offset time is converted', () => {
    expect(formatDateTime('2026-11-06T23:30:00-05:00')).toBe('7 Nov 2026, 04:30 UTC');
    expect(formatDateTime('2026-11-06T01:30:00+09:00')).toBe('5 Nov 2026, 16:30 UTC');
  });

  it('a 24-hour clock with two-digit hours and minutes, the day without a leading zero', () => {
    expect(formatUtcTime('2026-11-02T03:07:00Z')).toBe('03:07 UTC');
    expect(formatDate('2026-11-02T03:07:00Z')).toBe('2 Nov 2026');
    expect(formatDate('2026-02-28T12:00:00Z')).toBe('28 Feb 2026');
  });

  it('every month is its three-letter English name', () => {
    const months = Array.from({ length: 12 }, (_, m) => formatDate(Date.UTC(2026, m, 15)).split(' ')[1]);
    expect(months).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  });

  it('an unreadable value gives "" (never NaN or Invalid Date)', () => {
    for (const bad of ['', 'soon', Number.NaN, new Date('x')]) {
      expect(formatDateTime(bad)).toBe('');
      expect(formatDate(bad)).toBe('');
      expect(formatUtcTime(bad)).toBe('');
      expect(isMoment(bad)).toBe(false);
    }
    expect(isMoment(null)).toBe(false);
    expect(isMoment(undefined)).toBe(false);
    expect(isMoment('2026-11-06T15:00:00Z')).toBe(true);
  });
});

describe('When', () => {
  it('a mono <time> with the ISO value', () => {
    const { host } = render(<When at="2026-11-06T15:00:00.000Z" />);
    const t = host.querySelector('time')!;
    expect(t.className).toBe('x2f-when');
    expect(t.getAttribute('datetime')).toBe('2026-11-06T15:00:00.000Z');
    expect(t.textContent).toBe('6 Nov 2026, 15:00 UTC');
  });

  it('the date or the time alone, and nothing for an unreadable value', () => {
    expect(render(<When at="2026-11-06T15:00:00Z" form="date" />).host.textContent).toBe('6 Nov 2026');
    expect(render(<When at="2026-11-06T15:00:00Z" form="time" />).host.textContent).toBe('15:00 UTC');
    expect(render(<When at="nope" />).host.innerHTML).toBe('');
    expect(render(<When at={null} />).host.innerHTML).toBe('');
  });
});

describe('durations: digits mono, units in the body face', () => {
  it('durationParts rounds up to the minute and drops a zero part', () => {
    expect(durationParts(0)).toEqual([{ n: '0', unit: 'min' }]);
    expect(durationParts(1)).toEqual([{ n: '1', unit: 'min' }]);
    expect(durationParts(25 * 60_000)).toEqual([{ n: '25', unit: 'min' }]);
    expect(durationParts(120 * 60_000)).toEqual([{ n: '2', unit: 'h' }]);
    expect(durationParts(112 * 60_000)).toEqual([{ n: '1', unit: 'h' }, { n: '52', unit: 'min' }]);
    expect(durationParts(-5)).toEqual([{ n: '0', unit: 'min' }]);
  });

  it('durationParts over two days: days and hours, the same as formatRemaining (owner F9 waits up to 4 days)', () => {
    expect(durationParts(4 * 86_400_000 - 60_000)).toEqual([{ n: '3', unit: 'd' }, { n: '23', unit: 'h' }]);
    expect(durationParts(3 * 86_400_000)).toEqual([{ n: '3', unit: 'd' }]);
    expect(durationParts(48 * 3_600_000)).toEqual([{ n: '48', unit: 'h' }]);
    expect(render(<Duration ms={3 * 86_400_000} />).host.textContent).toBe(formatRemaining(3 * 86_400_000, 'minutes'));
  });

  it('Duration takes a rule\'s own units ("90 min", not "1 h 30 min")', () => {
    const host = render(<Duration ms={90 * 60_000} parts={[{ n: '90', unit: 'min' }]} />).host;
    expect(host.textContent).toBe('90 min');
    expect(host.querySelector('.x2f-duration__n')?.textContent).toBe('90');
  });

  it("formatRemaining('minutes') is still the plain text", () => {
    expect(formatRemaining(112 * 60_000, 'minutes')).toBe('1 h 52 min');
    expect(formatRemaining(120 * 60_000, 'minutes')).toBe('2 h');
  });

  it('Duration: each number in its mono span, each unit in its own span, one space between', () => {
    const { host } = render(<Duration ms={112 * 60_000} />);
    expect(host.textContent).toBe('1 h 52 min');
    expect([...host.querySelectorAll('.x2f-duration__n')].map((e) => e.textContent)).toEqual(['1', '52']);
    expect([...host.querySelectorAll('.x2f-duration__unit')].map((e) => e.textContent)).toEqual(['h', 'min']);
  });

  it('a minutes Countdown renders a Duration; a sentence around it keeps its space ("in 2 h", never "in2 h")', () => {
    const now = Date.UTC(2026, 10, 1, 14, 5);
    const { host } = render(
      <p>
        Available in <Countdown deadline={new Date(now + 120 * 60_000)} serverClock={() => new Date(now)} format="minutes" />.
      </p>,
    );
    expect(host.textContent).toBe('Available in 2 h.');
    expect(host.querySelector('[role="timer"]')?.getAttribute('data-format')).toBe('minutes');
    expect(host.querySelector('[role="timer"] .x2f-duration')).not.toBeNull();
  });

  // Main's kit 1.5 timer parts (2af5a10b; lead 8 Nov: the kit wins) write a clock as "28 min 42 s".
  it('a clock Countdown reads "28 min 42 s" (the kit\'s timer parts), not a Duration', () => {
    const now = Date.UTC(2026, 10, 1, 14, 5);
    const { host } = render(<Countdown deadline={new Date(now + 1722_000)} serverClock={() => new Date(now)} />);
    expect(host.textContent).toBe('28 min 42 s');
    expect(host.querySelector('.x2f-duration')).toBeNull();
  });
});
