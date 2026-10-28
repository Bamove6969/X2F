// TRIPWIRE (Task 4 review M5): the starter-limit stage counts every released trade as completed,
// because the disputes table is not on the line yet. Spec 2.3: only completed trades with no
// dispute lost count, and each lost dispute drops the account back one stage. When Task 27's
// migration lands, change COMPLETED_TRADES_SQL and stageFor (apps/api/src/traders/stage.ts) to
// subtract lost disputes and drop a stage per lost dispute, add tests, and delete this file.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('starter-limit stage still ignores disputes', () => {
  it('NEEDS_TASK_27: COMPLETED_TRADES_SQL and stageFor do not count lost disputes yet', () => {
    expect(existsSync(ROOT + 'apps/api/migrations/108_disputes.sql'), 'Task 27 disputes landed: count lost disputes in traders/stage.ts').toBe(false);
  });
});
