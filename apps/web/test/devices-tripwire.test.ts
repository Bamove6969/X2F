// TRIPWIRE for Plan 2 Task 16 (new-device approval). C2-D1 (1 Nov 2026) rebuilt ApproveOnDevice.tsx,
// LoginApprove.tsx and Devices.tsx to the LoginApprove and "Devices and sessions" boards, which so far
// live on the design branch (wip/design-brief, docs/design-boards/), not in this checkout's
// design/x2f-app/. Their look stays in the UI kit (apps/web/src/ui), so the three screens still
// carry no stylesheet of their own and no inline styles. This looks at this checkout only and fails
// once either board lands in design/x2f-app/: then capture its parity reference, add
// `expectParity(page, 'LoginApprove')` / `'Devices'` at PHONE_VIEWPORTS to an e2e spec, and delete
// this test. Still OPEN (Plan 2 Revision 2026-10-29b; C2-D1 report): the passkey / security key /
// PGP way in without an approval that the new-device board's "No other device with you?" card
// describes; until decided the card links to the existing backup login.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BOARDS = `${ROOT}design/x2f-app/`;
const SCREENS = ['auth/ApproveOnDevice.tsx', 'auth/LoginApprove.tsx', 'settings/Devices.tsx'];

describe('Task 16 stand-ins', () => {
  it('NEEDS_PARITY_DEVICES: the LoginApprove and Devices boards are not in design/x2f-app yet, and the screens carry no styling of their own', () => {
    const canvas = JSON.parse(readFileSync(`${BOARDS}canvas.json`, 'utf8')) as { boards: Record<string, unknown> };
    const board = Object.keys(canvas.boards).some((b) => /^(LoginApprove|Devices)/i.test(b)) ||
      existsSync(`${BOARDS}LoginApprove.dc.html`) || existsSync(`${BOARDS}Devices.dc.html`);
    expect(board, 'The LoginApprove or Devices board reached design/x2f-app: add its parity reference and expectParity (see this test)').toBe(false);
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
