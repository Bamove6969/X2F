// TRIPWIRE for Plan 2 Task 16 (new-device approval): Claude Design owns all aesthetics (owner,
// 2026-10-29), and the LoginApprove and Devices boards are still in progress on the design branch
// (design update 2026-10-29, section 5), not in this checkout. So ApproveOnDevice.tsx and
// LoginApprove.tsx (both sides of LoginApprove) and Devices.tsx are built from existing UI-kit
// classes and components only, with no stylesheet of their own, no inline styles and no
// expectParity entry. This looks at this checkout only and fails once either board lands in
// design/x2f-app/: then restyle the three to the boards (the board's copy wins), add
// `expectParity(page, 'LoginApprove')` / `'Devices'` at PHONE_VIEWPORTS to an e2e spec, and delete
// this test. Still OPEN when the boards land (Plan 2 Revision 2026-10-29b): the "no logged-in
// device" rule and the backup-login waits (Task 17) the new-device board's "I don't have my other
// device" note describes; until decided the screen links to the backup login without them.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BOARDS = `${ROOT}design/x2f-app/`;
const SCREENS = ['auth/ApproveOnDevice.tsx', 'auth/LoginApprove.tsx', 'settings/Devices.tsx'];

describe('Task 16 stand-ins', () => {
  it('NEEDS_DESIGN_DEVICES: no LoginApprove or Devices board yet, so their screens carry no styling of their own', () => {
    const canvas = JSON.parse(readFileSync(`${BOARDS}canvas.json`, 'utf8')) as { boards: Record<string, unknown> };
    const board = Object.keys(canvas.boards).some((b) => /^(LoginApprove|Devices)/i.test(b)) ||
      existsSync(`${BOARDS}LoginApprove.dc.html`) || existsSync(`${BOARDS}Devices.dc.html`);
    expect(board, 'Claude Design delivered the LoginApprove or Devices board: style the Task 16 screens to it (see this test)').toBe(false);
    for (const f of SCREENS) {
      const src = readFileSync(`${ROOT}apps/web/src/screens/${f}`, 'utf8');
      expect(src, f).not.toMatch(/style=\{/);
      expect(src, f).not.toMatch(/import '\.\/[^']+\.css'/);
    }
    for (const css of ['auth/approve.css', 'auth/LoginApprove.css', 'settings/Devices.css', 'settings/devices.css']) {
      expect(existsSync(`${ROOT}apps/web/src/screens/${css}`), css).toBe(false);
    }
  });
});
