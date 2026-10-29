// Plan 5 Task 21: copy-lint's `refusal` rule (every refusal goes through CantDoThat), the owner-wording
// exemption, the ratchet on refusals still shown inline, and the Claude Design tripwire.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TODO_PRAGMA, lintSource } from '../../../tools/copy-lint.js';
import { FEEDBACK_THANKS } from '../src/screens/Feedback.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

describe('copy-lint: refusals go through CantDoThat', () => {
  it('flags refusal wording or a refusal code in a file that does not import CantDoThat', () => {
    expect(lintSource('export const a = "You can\'t post offers.";\n', 'a.ts').map((f) => f.rule)).toEqual(['refusal']);
    expect(lintSource('export const A = () => <p>Sorry, you are limited to 2 offers.</p>;\n', 'a.tsx').map((f) => f.rule)).toEqual(['refusal']);
    expect(lintSource("export const f = (c: string) => c === 'trading-hold';\n", 'a.ts').map((f) => f.rule)).toEqual(['refusal']);
  });

  it('passes the same file once it imports CantDoThat (or cantDoCodes), or a line is marked', () => {
    expect(lintSource("import { CantDoThat } from '../ui/CantDoThat.js';\nexport const a = \"You can't post offers.\";\n", 'a.ts')).toEqual([]);
    expect(lintSource("import { isCantDoCode } from '../../ui/cantDoCodes.js';\nexport const f = (c: string) => c === 'trading-hold';\n", 'a.ts')).toEqual([]);
    expect(lintSource('// not-a-refusal: explains storage\nexport const a = "It can\'t be undone.";\n', 'a.ts')).toEqual([]);
    expect(lintSource(`export const a = "You can't post offers."; // ${TODO_PRAGMA} later\n`, 'a.ts')).toEqual([]);
  });

  it('lets the owner\'s exact thank-you keep its "!", and nothing else', () => {
    expect(lintSource(`export const t = ${JSON.stringify(FEEDBACK_THANKS)};\n`, 'a.ts')).toEqual([]);
    expect(lintSource('export const t = "Thank you!";\n', 'a.ts').map((f) => f.rule)).toEqual(['exclamation']);
  });

  it(`keeps the refusals still shown inline (marked ${TODO_PRAGMA}) from growing`, () => {
    let count = 0;
    for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (e.isFile() && /\.(tsx?|jsx?)$/.test(e.name)) count += readFileSync(join(e.parentPath, e.name), 'utf8').split(TODO_PRAGMA).length - 1;
    }
    // 2026-10-29: auth/refusals.ts (recovery-hold, security-key-limit, login-name-set) and
    // SetupStatus's 409 on cancel. Lower this number as each moves into CantDoThat.
    expect(count).toBeLessThanOrEqual(4);
  });
});

// TRIPWIRE (local tree only): there are no Claude Design boards yet for the popup or the form (brief
// ~/x2f-comms/design-brief-2026-10-29.md, items 4 and 5; the owner wants Claude Design to decide all
// aesthetics). Both are built from the existing kit (Sheet, Button, screens.css classes) with no
// styling of their own and have no parity entry. When the boards land, match CantDoThat and
// Feedback to them, add expectParity entries for both, and delete this tripwire.
describe('Task 21 waits for its Claude Design boards', () => {
  it('NEEDS_DESIGN_CANTDOTHAT: no board for CantDoThat or the feedback form yet', () => {
    const boards = join(ROOT, 'design/x2f-app');
    const names = existsSync(boards) ? readdirSync(boards, { recursive: true }).map(String) : [];
    expect(names.filter((n) => /cant-?do|feedback/i.test(n)), 'a CantDoThat or Feedback board landed: match the screens to it').toEqual([]);
  });
});
