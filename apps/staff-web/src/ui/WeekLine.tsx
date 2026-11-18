import { useState } from 'react';
import { GridLines, SLOT, VIEW, dayOf, yOf, type Week } from './WeekBars.js';
import './staff.css';

/** Minutes as the board writes them: "38 min", "1 h 52 min", "3 h 05 min"; null as a dash. */
export function fmtMinutes(m: number | null): string {
  if (m === null) return '—';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** The runs of consecutive weeks with a first reply: the line breaks at a week with none, never drops to 0. */
export function lineRuns(points: readonly ([number, number] | null)[]): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  for (const p of points) {
    if (p === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Typical first reply per week (board StaffPerformance): a line against a dashed reference at the
 * current first-response setting ("4 h deadline"), with a hover readout under the chart. A week
 * with no first reply has no dot and splits the line.
 */
export function WeekLine({ who, weeks, deadlineH }: { who: string; weeks: readonly Week[]; deadlineH: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const deadline = deadlineH * 60;
  const top = Math.max(deadline, ...weeks.map((w) => w.firstReplyMin ?? 0));
  // Whole hours on the axis, with room above the deadline line for its label (the board: 5 h for a 4 h deadline).
  const max = Math.max(60, Math.ceil((top * 1.25) / 60) * 60);
  const stepH = Math.max(1, Math.ceil(max / 60 / 5));
  const grid: { v: number; label: string }[] = [];
  for (let h = 0; h * 60 <= max; h += stepH) grid.push({ v: yOf(h * 60, max), label: h === 0 ? '0' : `${h} h` });
  const points = weeks.map((w, i): [number, number] | null => (w.firstReplyMin === null ? null : [VIEW.left + i * SLOT + SLOT / 2, yOf(w.firstReplyMin, max)]));
  const deadY = yOf(deadline, max);
  const h = hover === null ? null : weeks[hover];
  const read = h
    ? h.firstReplyMin === null
      ? `Week of ${h.weekOf}: no replies` // COPY-UNSIGNED
      : `Week of ${h.weekOf}: typical first reply ${fmtMinutes(h.firstReplyMin)}`
    : 'Point at a dot to see that week.';
  return (
    <figure className="x2f-perf-chart" data-part="reply-chart">
      <figcaption className="x2f-perf-chart__caption">Typical first reply per week</figcaption>
      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        role="img"
        aria-label={`${who} typical first reply per week in minutes: ${weeks.map((w) => (w.firstReplyMin === null ? 'none' : String(w.firstReplyMin))).join(', ')}. Deadline ${deadline} minutes.`}
      >
        <GridLines lines={grid} />
        <line className="x2f-perf-chart__deadline" x1={VIEW.left} x2={VIEW.right} y1={deadY} y2={deadY} />
        <text className="x2f-perf-chart__tick" x={430} y={deadY - 6} textAnchor="end">
          {`${deadlineH} h deadline`}
        </text>
        {lineRuns(points).map((run) => (
          <polyline key={run[0]!.join(',')} className="x2f-perf-chart__line" data-part="reply-line" points={run.map((p) => p.join(',')).join(' ')} />
        ))}
        {weeks.map((w, i) => {
          const p = points[i];
          return (
            <g key={w.weekOf} data-part="week-dot" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect className="x2f-perf-chart__hit" x={VIEW.left + i * SLOT} y={VIEW.top} width={SLOT} height={VIEW.bottom - VIEW.top} />
              {p ? <circle className="x2f-perf-chart__dot" cx={p[0]} cy={p[1]} r={hover === i ? 6 : 4} /> : null}
              <text className="x2f-perf-chart__tick" x={VIEW.left + i * SLOT + SLOT / 2} y={190} textAnchor="middle">
                {dayOf(w.weekOf)}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="x2f-perf-chart__readout" data-part="reply-readout">
        {read}
      </span>
    </figure>
  );
}
