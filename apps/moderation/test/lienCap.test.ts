// Re-review 17 Nov (b) info: the SQL checks on recovery rates are literals; they must stay equal to
// the one constant, LIEN_RECOVERY_MAX_BPS, so a change to the cap (owner question OQ1) cannot leave
// the database allowing more (or less) than the code. Owner 26 Nov 2026 answered OQ1 with 100%:
// migrations 890 (API and moderation) replace every rate check of API 820 and moderation 023.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIEN_DEFAULT_RATE_BPS, LIEN_RECOVERY_MAX_BPS } from '@x2f/trade';

const file = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Each `<column> between 1 and N` rate check in `sql`, as [column, N]. */
const checks = (sql: string): Array<[string, number]> => [...sql.matchAll(/(\w+_bps)\s+between 1 and (\d+)/g)].map((m) => [m[1]!, Number(m[2])]);

describe('lien recovery cap: SQL checks match LIEN_RECOVERY_MAX_BPS', () => {
  it('owner 26 Nov 2026: the cap and the default are both 100%', () => {
    expect(LIEN_RECOVERY_MAX_BPS).toBe(10_000);
    expect(LIEN_DEFAULT_RATE_BPS).toBe(10_000);
  });
  for (const [first, latest] of [
    ['../../api/migrations/820_lien_recovery.sql', '../../api/migrations/890_lien_rate_full.sql'],
    ['../migrations/023_lien_recoveries.sql', '../migrations/890_lien_rate_full.sql'],
  ] as const) {
    it(`${latest} re-checks every rate column of ${first} at the cap`, () => {
      const before = checks(file(first));
      const after = checks(file(latest));
      expect(before.length).toBeGreaterThan(0);
      expect(new Set(after.map(([, n]) => n))).toEqual(new Set([LIEN_RECOVERY_MAX_BPS]));
      expect(new Set(after.map(([col]) => col))).toEqual(new Set(before.map(([col]) => col)));
    });
  }
  it('API 890: a new lien defaults to LIEN_DEFAULT_RATE_BPS', () => {
    expect(file('../../api/migrations/890_lien_rate_full.sql')).toContain(`alter column recovery_rate_bps set default ${LIEN_DEFAULT_RATE_BPS};`);
  });
});
