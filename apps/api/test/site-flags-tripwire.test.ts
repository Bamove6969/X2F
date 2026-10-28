// TRIPWIRE NEEDS_SITE_FLAGS (Plan 3 Task 9): the API timer loop (src/trades/timers.ts) pauses and
// resumes every open trade from `site_flags.maintenance_since`, but that table is Plan 4 Task 8's.
// Until it lands main.ts starts `startTimers` without `maintenanceSince`, so maintenance is never on.
// When a migration creates `site_flags`, this fails: pass `maintenanceSince` (read the column) to
// `startTimers` in src/main.ts, then delete this tripwire. Checks the local tree only.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

describe('site_flags does not exist yet', () => {
  it('NEEDS_SITE_FLAGS: no migration creates site_flags, and main.ts starts the timers without maintenanceSince', () => {
    const msg = 'site_flags landed: wire maintenanceSince into startTimers (src/main.ts), then delete this tripwire';
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql'))) {
      expect(readFileSync(`${DIR}${f}`, 'utf8'), `${msg} (${f})`).not.toMatch(/create\s+table\s+(if\s+not\s+exists\s+)?site_flags\b/i);
    }
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main, 'the API main starts the timer loop').toMatch(/startTimers\(/);
    expect(main, msg).not.toMatch(/maintenanceSince/);
  });
});
