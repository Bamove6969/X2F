import { useState } from 'react';
import './staff.css';

/**
 * Board StaffPerformance's charts (Plan 4 Task 20): the SVG geometry of the board (a 440 x 200
 * view box, the plot from x 36 to 432 and y 12 to 172, 8 equal week slots). Plain SVG, no chart
 * library; every colour is a theme token through staff.css classes (the staff CSP allows no
 * inline styles). Each chart is one series, so its caption names it and there is no legend; the
 * figures are also in the panel's "Show as table" view, the chart's accessible equivalent, and in
 * the SVG's own label.
 */
export const VIEW = { w: 440, h: 200, left: 36, right: 432, top: 12, bottom: 172 } as const;
export const SLOT = (VIEW.right - VIEW.left) / 8;
export const yOf = (v: number, max: number) => VIEW.bottom - (v / max) * (VIEW.bottom - VIEW.top);

export interface Week {
  weekOf: string;
  cases: number;
  firstReplyMin: number | null;
}

/** The week's day for the x axis: "Aug 24" -> "24" (the board's tick labels). */
export const dayOf = (weekOf: string) => weekOf.split(' ')[1] ?? weekOf;

/** A bar from the baseline with a 4 px rounded top (the board's path). */
function barPath(x: number, w: number, y: number): string {
  const r = Math.min(4, (VIEW.bottom - y) / 2);
  return `M${x},${VIEW.bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${VIEW.bottom} Z`;
}

export function GridLines({ lines }: { lines: { v: number; label: string }[] }) {
  return (
    <>
      {lines.map((g) => (
        <g key={g.v}>
          <line className="x2f-perf-chart__grid" x1={VIEW.left} x2={VIEW.right} y1={g.v} y2={g.v} />
          <text className="x2f-perf-chart__tick" x={VIEW.left - 8} y={g.v + 4} textAnchor="end">
            {g.label}
          </text>
        </g>
      ))}
    </>
  );
}

/** Cases handled per week: bars, with "Week of Aug 24: 3 cases" under the chart on hover. */
export function WeekBars({ who, weeks }: { who: string; weeks: readonly Week[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...weeks.map((w) => w.cases), 0);
  const max = Math.max(4, Math.ceil(top / 2) * 2);
  const grid = [0, max / 2, max].map((v) => ({ v: yOf(v, max), label: String(v) }));
  const h = hover === null ? null : weeks[hover];
  return (
    <figure className="x2f-perf-chart" data-part="cases-chart">
      <figcaption className="x2f-perf-chart__caption">Cases handled per week</figcaption>
      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="img" aria-label={`${who} cases per week for 8 weeks: ${weeks.map((w) => w.cases).join(', ')}`}>
        <GridLines lines={grid} />
        {weeks.map((w, i) => {
          const bw = SLOT - 14;
          const x = VIEW.left + i * SLOT + 7;
          const y = yOf(w.cases, max);
          return (
            <g key={w.weekOf} data-part="week-bar" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect className="x2f-perf-chart__hit" x={VIEW.left + i * SLOT} y={VIEW.top} width={SLOT} height={VIEW.bottom - VIEW.top} />
              {w.cases > 0 ? <path className="x2f-perf-chart__bar" data-on={hover === i ? 'true' : undefined} d={barPath(x, bw, y)} /> : null}
              <text className="x2f-perf-chart__tick" x={x + bw / 2} y={190} textAnchor="middle">
                {dayOf(w.weekOf)}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="x2f-perf-chart__readout" data-part="cases-readout">
        {h ? `Week of ${h.weekOf}: ${h.cases} ${h.cases === 1 ? 'case' : 'cases'}` : 'Point at a bar to see that week.'}
      </span>
    </figure>
  );
}
