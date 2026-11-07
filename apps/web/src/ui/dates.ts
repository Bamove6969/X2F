// Design X5 (build review 7 Nov): one date style everywhere, the same for every viewer:
// "6 Nov 2026, 15:00 UTC" (and "6 Nov 2026" for a day). Shown in mono where it stands alone.

const parts = (d: Date, o: Intl.DateTimeFormatOptions) => {
  const p = new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'UTC' }).formatToParts(d);
  return (t: string) => p.find((x) => x.type === t)?.value ?? '';
};

/** "6 Nov 2026". */
export function utcDate(d: Date): string {
  const get = parts(d, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${get('day')} ${get('month')} ${get('year')}`;
}

/** "6 Nov 2026, 15:00 UTC". */
export function utcDateTime(d: Date): string {
  const get = parts(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${utcDate(d)}, ${get('hour')}:${get('minute')} UTC`;
}
