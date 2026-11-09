import './ui.css';

// Logo D (docs/brand/svg on wip/design-brief: x2f-color-24-*.svg and x2f-color-32-*.svg). The
// letters take the context's ink (currentColor), the dot is the one Monero orange; no style
// attributes, as the CSP has no 'unsafe-inline' for styles.
const MARKS = {
  24: {
    width: 60,
    letters:
      'M0 24L0 23.82L7.08 11.26L1.02 0.18L1.02 0L6.52 0L10.86 8.03L11.6 8.03L15.82 0L21.11 0L21.11 0.18L15.08 11.26L22.09 23.82L22.09 24L16.37 24L11.32 14.49L10.58 14.49L5.48 24ZM24 24L24 20.01Q26.61 18.11 28.56 16.58Q30.51 15.05 31.9 13.78Q33.98 11.91 35.03 10.4Q36.08 8.89 36.08 7.22Q36.08 5.71 35.19 4.76Q34.29 3.81 32.59 3.81Q30.67 3.81 29.7 5Q28.72 6.2 28.72 8.16L24 8.16Q24 5.71 24.98 3.87Q25.95 2.03 27.89 1.01Q29.82 0 32.69 0Q36.74 0 38.96 1.98Q41.18 3.96 41.18 7.19Q41.18 9.52 39.92 11.47Q38.66 13.42 36.18 15.57Q35.11 16.5 33.8 17.49Q32.5 18.47 31.21 19.28L31.21 20.01L42 20.01L42 24ZM44 0H60V4H49V9H52V13H49V24H44Z',
    dot: { cx: 56, cy: 11, r: 3 },
  },
  32: {
    width: 78,
    letters:
      'M0 32L0 31.75L9.44 15.02L1.35 0.25L1.35 0L8.7 0L14.48 10.71L15.47 10.71L21.09 0L28.14 0L28.14 0.25L20.1 15.02L29.46 31.75L29.46 32L21.83 32L15.1 19.32L14.11 19.32L7.3 32ZM31 32L31 26.68Q34.34 24.14 36.83 22.11Q39.32 20.07 41.09 18.38Q43.75 15.88 45.09 13.86Q46.44 11.85 46.44 9.63Q46.44 7.62 45.29 6.35Q44.15 5.08 41.98 5.08Q39.52 5.08 38.28 6.67Q37.03 8.26 37.03 10.88L31 10.88Q31 7.62 32.25 5.16Q33.49 2.7 35.97 1.35Q38.44 0 42.1 0Q47.28 0 50.12 2.64Q52.95 5.28 52.95 9.59Q52.95 12.7 51.35 15.29Q49.74 17.89 46.56 20.76Q45.19 22.01 43.53 23.31Q41.86 24.62 40.21 25.71L40.21 26.68L54 26.68L54 32ZM57 0H78V5H64V13H68V18H64V32H57Z',
    dot: { cx: 73, cy: 15.5, r: 4 },
  },
} as const;

/**
 * The X2F mark. `decorative` hides it from readers where a link already names it ("X2F home");
 * otherwise it is one image named "X2F".
 */
export function Logo({ size = 24, decorative = false }: { size?: 24 | 32; decorative?: boolean }) {
  const m = MARKS[size];
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': 'X2F' };
  return (
    <svg className="x2f-logo" width={m.width} height={size} viewBox={`0 0 ${m.width} ${size}`} {...a11y}>
      <path fill="currentColor" d={m.letters} />
      <circle className="x2f-logo__dot" cx={m.dot.cx} cy={m.dot.cy} r={m.dot.r} />
    </svg>
  );
}
