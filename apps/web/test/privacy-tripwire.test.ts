// TRIPWIRES for Plan 7 Tasks 3 and 4 (the self-destruct line and Settings → Privacy). Claude
// Design owns every look (owner 2026-10-29) and there is no board yet for either, so both are
// built from existing UI-kit classes only, with no stylesheet, no inline styles and no
// expectParity. Each check reads this checkout only and fails once what it waits for lands.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BOARDS = `${ROOT}design/x2f-app/`;
const boards = (re: RegExp): boolean => {
  const canvas = JSON.parse(readFileSync(`${BOARDS}canvas.json`, 'utf8')) as { boards: Record<string, unknown> };
  return Object.keys(canvas.boards).some((b) => re.test(b));
};
const src = (p: string) => readFileSync(`${ROOT}apps/web/src/${p}`, 'utf8');

describe('Plan 7 Tasks 3-4 stand-ins', () => {
  it('NEEDS_DESIGN_PRIVACY: no Privacy board yet, so Privacy.tsx carries no styling of its own', () => {
    // When the board lands: style Privacy.tsx to it (its copy wins over the COPY-UNSIGNED lines, but
    // the numbers stay the shared constants), add the menu entry where the board puts it, add
    // `expectParity(page, 'Privacy')` at PHONE_VIEWPORTS to e2e/privacy.spec.ts, delete this check.
    expect(boards(/privacy/i), 'Claude Design delivered a Privacy board: build to it (see this test)').toBe(false);
    expect(existsSync(`${ROOT}apps/web/src/screens/settings/privacy.css`)).toBe(false);
    expect(src('screens/settings/Privacy.tsx')).not.toMatch(/style=\{/);
  });

  it('NEEDS_DESIGN_SELFDESTRUCT: no board for the trade room\'s self-destruct line yet', () => {
    // When a board shows the line (a trade-room or completed-trade board naming "self-destructs"):
    // restyle SelfDestruct.tsx to it and add it to the parity fixtures of the closed-trade screens.
    const named = boards(/self.?destruct/i) || /self-?destructs/i.test(readFileSync(`${BOARDS}canvas.json`, 'utf8'));
    expect(named, 'a board shows the self-destruct line: build to it (see this test)').toBe(false);
    expect(src('screens/trade/SelfDestruct.tsx')).not.toMatch(/style=\{/);
  });

  it('NEEDS_TASK_12_AND_18_LINKS: Privacy links the lawful-requests page and Delete my account once they exist', () => {
    const app = src('App.tsx');
    const privacy = src('screens/settings/Privacy.tsx');
    if (/path="\/legal\/requests"/.test(app)) expect(privacy).toMatch(/\/legal\/requests/);
    const del = /path="(\/settings\/[a-z-]*delete[a-z-]*)"/.exec(app);
    if (del) expect(privacy).toContain(del[1]);
  });
});
