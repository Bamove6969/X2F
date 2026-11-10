// Plan 5 Task 21: copy-lint's `refusal` rule (every refusal goes through CantDoThat), the owner-wording
// exemption, the ratchet on refusals still shown inline, and the Claude Design tripwire.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TODO_PRAGMA, countPragmas, lintSource } from '../../../tools/copy-lint.js';
import { CANT_DO_CODES, NOT_REFUSAL_CODES } from '../src/ui/cantDoCodes.js';
import { FEEDBACK_THANKS } from '../src/screens/Feedback.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const lint = (src: string, file = 'a.tsx') => lintSource(src, file).filter((f) => f.rule === 'refusal').map((f) => f.text);
const IMPORT = "import { CantDoThat } from '../ui/CantDoThat.js';\nimport { isCantDoCode } from '../ui/cantDoCodes.js';\n";

describe('copy-lint: every refusal goes through CantDoThat, judged piece by piece', () => {
  it('flags refusal wording and refusal code literals', () => {
    expect(lint('export const a = "You can\'t post offers.";\n', 'a.ts')).toEqual(["You can't post offers."]);
    expect(lint('export const A = () => <p>Sorry, you are limited to 2 offers.</p>;\n')).toEqual(['Sorry, you are limited to 2 offers.']);
    expect(lint("export const f = (c: string) => c === 'trading-hold';\n", 'a.ts')).toEqual(['trading-hold']);
  });

  it('review I2: importing CantDoThat or cantDoCodes exempts nothing, a type-only or bare import least of all', () => {
    const refusal = "export const A = () => <p>Sorry, you're limited to 2 offers per side.</p>;\n";
    expect(lint(IMPORT + refusal)).toEqual(["Sorry, you're limited to 2 offers per side."]);
    expect(lint("import type { CantDoCode } from '../ui/cantDoCodes.js';\n" + refusal)).toHaveLength(1);
    expect(lint("import '../ui/CantDoThat.js';\n" + refusal)).toHaveLength(1);
  });

  it('review I2: takeErrors.ts\'s old already-waiting line is caught; the real file now takes it from the text map', () => {
    const old = `${IMPORT}export function t(code: string) {\n  switch (code) {\n    case 'already-waiting':\n      return 'You already have a trade on this offer waiting to be funded.';\n  }\n}\n`;
    expect(lint(old, 'takeErrors.ts')).toEqual(['already-waiting', 'You already have a trade on this offer waiting to be funded.']);
    const real = readFileSync(join(SRC, 'screens/quote/takeErrors.ts'), 'utf8');
    expect(real).not.toContain('You already have a trade');
    expect(lintSource(real, 'apps/web/src/screens/quote/takeErrors.ts')).toEqual([]);
  });

  it('passes text written straight into <CantDoThat title= body=>, and the text map itself', () => {
    expect(lint(`${IMPORT}export const A = () => <CantDoThat title="You can't do that" body={"Sorry, you're limited to 2."} from="too-many-offers" onClose={() => {}} />;\n`)).toEqual([]);
    // ...but not text beside it.
    expect(lint(`${IMPORT}export const A = () => <><CantDoThat title="x" body="y" from="lien" onClose={() => {}} /><p>You can't trade.</p></>;\n`)).toEqual(["You can't trade."]);
    expect(lint('export const a = "You can\'t post offers.";\n', 'apps/web/src/ui/cantDoCodes.ts')).toEqual([]);
  });

  it('review I3: the wider refusal wording is caught', () => {
    for (const s of [
      'You are unable to post.',
      'You are not able to post.',
      "You couldn't post that offer.",
      'You can nudge once every 10 minutes.',
      'You already have 5 security keys.',
      'A maximum of 20 offers.',
      'That is not permitted.',
      'Too many offers.',
      "This method isn't available for you.",
      'This offer needs at least 5 completed trades.',
      'You have at most 2 offers.',
      'Only 2 offers per side.',
      'Your account is blocked.',
    ]) {
      expect(lint(`export const a = ${JSON.stringify(s)};\n`, 'a.ts'), s).toEqual([s]);
    }
    // A piece that starts like a fault report and holds no strong rule word is not judged.
    for (const fault of [
      'Could not save that. Try again.',
      'Offers could not be loaded right now. Try again in a moment.',
      "X2F could not use that key. Check that you pasted the whole public key.",
      "Your device can't settle this trade as the server shows it. Don't send any money.",
      'Too many tries. Try again in 5 minutes.',
    ]) {
      expect(lint(`export const a = ${JSON.stringify(fault)};\n`, 'a.ts'), fault).toEqual([]);
    }
  });

  it('round-2 N-M1: a refusal that merely ends with "Try again" or mentions a device is still judged', () => {
    for (const s of [
      'You can only nudge once every 10 minutes. Try again later.',
      "You can't post more than 2 offers per side. Try again once one ends.",
      "Your account is on a trading hold, so you can't trade. Try again after the dispute.",
      "You can't add another security key to your device list: the limit is 5.",
      "Sorry, you're limited to 2 offers per side. Reload the page after removing one.",
      // A fault opener with a strong rule word in it is judged too.
      "Could not post: you're limited to 2 offers per side.",
    ]) {
      expect(lint(`export const a = ${JSON.stringify(s)};\n`, 'a.ts'), s).toEqual([s]);
    }
    // A literal type is never shown.
    expect(lint("export type R = { result: 'too-soon' };\n", 'a.ts')).toEqual([]);
  });

  it('review M8: a pragma counts only in a real comment, and covers its own line and the next', () => {
    expect(lint('// not-a-refusal: explains storage\nexport const a = "It can\'t be undone.";\n', 'a.ts')).toEqual([]);
    expect(lint(`export const a = "You can't post offers."; // ${TODO_PRAGMA} later\n`, 'a.ts')).toEqual([]);
    expect(lint('export const A = () => <p>{/* not-a-refusal: explains */}It can\'t be undone.</p>;\n')).toEqual([]);
    // Inside a string it is just text.
    expect(lint('export const p = "not-a-refusal: sneaky";\nexport const a = "You can\'t post offers.";\n', 'a.ts')).toEqual(["You can't post offers."]);
    expect(lint('export const A = () => <p>not-a-refusal: sneaky</p>;\nexport const a = "You can\'t.";\n')).toEqual(["You can't."]);
    // Two lines down is out of reach.
    expect(lint('// not-a-refusal: x\nconst b = 1;\nexport const a = "You can\'t.";\n', 'a.ts')).toEqual(["You can't."]);
    expect(countPragmas('// not-a-refusal: x\nconst s = "not-a-refusal: y";\n// cant-do-that-todo: z\n', 'a.ts')).toEqual({ notARefusal: 1, todo: 1 });
  });

  it('lets the owner\'s exact thank-you keep its "!", and nothing else', () => {
    expect(lintSource(`export const t = ${JSON.stringify(FEEDBACK_THANKS)};\n`, 'a.ts')).toEqual([]);
    expect(lintSource('export const t = "Thank you!";\n', 'a.ts').map((f) => f.rule)).toEqual(['exclamation']);
  });

  it('counts both pragmas, so neither can grow unnoticed (review M8)', () => {
    let notARefusal = 0;
    let todo = 0;
    for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(tsx?|jsx?)$/.test(e.name) || /^(cantDoCodes\.ts|CantDoThat\.tsx)$/.test(e.name)) continue;
      const c = countPragmas(readFileSync(join(e.parentPath, e.name), 'utf8'), e.name);
      notARefusal += c.notARefusal;
      todo += c.todo;
    }
    // 2026-10-29. `cant-do-that-todo`: auth/refusals.ts (recovery-hold, security-key-limit and its
    // sentence, login-name-set), listed with their owner in docs/coordination.md. Lower these as
    // refusals move into CantDoThat; raise one only with a reviewed reason. `not-a-refusal` 40 -> 43
    // (Task 37 landing, 2026-10-29): settings/blockCopy.ts's three lines saying what a block stops
    // the OTHER trader doing ("<name> can't: ...", the done note, "What blocking does"). 43 -> 45
    // (Tasks 38-39 landing, 2026-10-29): two warnings that explain, not refuse: PaidConfirmSheet's
    // "After this you can't cancel the trade" and ReleaseWarning's "... and can't be taken back."
    expect(todo).toBeLessThanOrEqual(4);
    // 45 -> 50 (C2-D1, 1 Nov 2026): the LoginApprove and Devices boards' explanations, not rules:
    // what blocking a login did, the advice after a block, why no place is shown, the blocked new
    // device's note, and how approval works. 50 -> 51 (C11, design review fix 2): the DisputeRuling
    // board's "If an appeal overturns the ruling, you get a lien. You can't trade until you pay the
    // XMR back." explains a consequence before any appeal (dispute/rules.ts overturnLien). 51 -> 52
    // (Plan 4 Task 15, 6 Nov 2026): owner Q38's hourglass says the time left ("... at most",
    // DisputeRoom.tsx), not a rule. 52 -> 53 (batch 3 landing, 5b3b38c5): the front door's Landing
    // board promise that X2F "can't move them alone" (Landing.tsx) reassures about escrow, not a rule.
    expect(notARefusal).toBeLessThanOrEqual(53);
    // Parses every file under apps/web/src: give it room on a loaded machine.
  }, 60_000);
});

describe('review I3: every error code the web knows is classified', () => {
  const API = readFileSync(join(ROOT, 'apps/api/src/errors.ts'), 'utf8');
  const KEYS = readFileSync(join(ROOT, 'packages/accounts/src/pgp.ts'), 'utf8');
  const union = (src: string, name: string) => {
    const at = src.indexOf(`export type ${name} =`);
    expect(at, name).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf(';', at));
    return [...body.matchAll(/\| '([a-z0-9-]+)'/g)].map((m) => m[1]!);
  };

  /** Codes the web compares against: `.code === 'x'`, `.code !== 'x'`, and `case 'x':` in a `switch (….code)`. */
  function webCodes(): Set<string> {
    const out = new Set<string>();
    for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(tsx?|jsx?)$/.test(e.name)) continue;
      const src = readFileSync(join(e.parentPath, e.name), 'utf8');
      // `typeof x.code === 'string'` is a type check, not a code.
      for (const m of src.matchAll(/\.code\s*[!=]==\s*'([a-z0-9-]+)'/g)) if (!['string', 'number', 'undefined', 'object'].includes(m[1]!)) out.add(m[1]!);
      for (const sw of src.matchAll(/switch \((?:[\w.]+\.)?code\) \{/g)) {
        let depth = 0;
        let i = sw.index + sw[0].length - 1;
        for (; i < src.length; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}' && --depth === 0) break;
        }
        for (const c of src.slice(sw.index, i).matchAll(/case '([a-z0-9-]+)':/g)) out.add(c[1]!);
      }
    }
    return out;
  }

  it('in CANT_DO_CODES or NOT_REFUSAL_CODES, never both', () => {
    const cant = new Set<string>(CANT_DO_CODES);
    for (const c of Object.keys(NOT_REFUSAL_CODES)) expect(cant.has(c), c).toBe(false);
    const known = new Set([...union(API, 'ApiErrorCode'), ...union(KEYS, 'KeyRefusal'), ...webCodes()]);
    expect(known.size).toBeGreaterThan(60);
    const unclassified = [...known].filter((c) => !cant.has(c) && !Object.hasOwn(NOT_REFUSAL_CODES, c));
    expect(unclassified, 'classify each new code in apps/web/src/ui/cantDoCodes.ts').toEqual([]);
  });

  it('the review I1 code is the API\'s own', () => {
    expect(union(API, 'ApiErrorCode')).toContain('last-login-method');
    expect(CANT_DO_CODES).toContain('last-login-method');
    expect(CANT_DO_CODES).not.toContain('only-login' as never);
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

// Review M1: on a real touch screen the browser takes a drag on the scrolling sheet as a pan and
// sends pointercancel. The grab handle opts out (touch-action: none) and is at least 44 px tall.
describe('the sheet grab handle takes the touch gesture', () => {
  it('touch-action: none and a 44 px hit area', () => {
    const css = readFileSync(join(SRC, 'ui/ui.css'), 'utf8');
    const rule = /\.x2f-sheet__handle \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/touch-action:\s*none;/);
    expect(rule).toMatch(/height:\s*44px;/);
  });
});
