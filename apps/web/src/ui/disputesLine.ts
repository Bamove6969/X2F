/**
 * D-049 (owner 28 Oct, leaning yes; lead default until he confirms, J-21): a profile shows
 * "Disputes: N won, M lost" from the API's `TraderSummary.disputes` (apps/api/src/traders/summary.ts:
 * each dispute by its latest ruling). Null when the answer has no counts. The Profile screen (Plan 5
 * Task 12) is not built yet; it shows this line. COPY-UNSIGNED // DESIGN: wording
 */
export function disputesLine(d: { won: number; lost: number } | undefined): string | null {
  if (d === undefined) return null;
  return `Disputes: ${d.won.toLocaleString('en-US')} won, ${d.lost.toLocaleString('en-US')} lost`;
}
