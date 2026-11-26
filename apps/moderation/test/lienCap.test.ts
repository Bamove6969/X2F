// Re-review 17 Nov (b) info: the SQL checks on recovery rates (API migration 820, moderation
// migration 023) are literals; they must stay equal to the one constant, LIEN_RECOVERY_MAX_BPS, so a
// change to the cap (owner question OQ1) cannot leave the database allowing more than the code.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIEN_RECOVERY_MAX_BPS } from '@x2f/trade';

const file = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('lien recovery cap: SQL checks match LIEN_RECOVERY_MAX_BPS', () => {
  for (const rel of ['../../api/migrations/820_lien_recovery.sql', '../migrations/023_lien_recoveries.sql']) {
    it(rel, () => {
      const caps = [...file(rel).matchAll(/_bps[^,\n]*between 1 and (\d+)/g)].map((m) => Number(m[1]));
      expect(caps.length).toBeGreaterThan(0);
      expect(new Set(caps)).toEqual(new Set([LIEN_RECOVERY_MAX_BPS]));
    });
  }
});
