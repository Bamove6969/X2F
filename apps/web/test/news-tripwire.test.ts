// TRIPWIRE for Plan 4 Task 28 (News): the owner's rule of 2026-10-29 is that Claude Design owns all
// aesthetics, and there is no News board yet (design brief 2026-10-29, item 13). So News.tsx is
// built from existing UI-kit classes and components only, has no stylesheet of its own, no
// expectParity entry, and the menu shows no count of new messages yet (`useNewsUnseen` in
// news-model.ts is ready for it). This looks at this checkout only and fails once a News board
// appears: then restyle News.tsx to the board (copy from the board wins over the // COPY-UNSIGNED
// text), add the menu count where the board puts it, add `expectParity(page, 'News')` at
// PHONE_VIEWPORTS to e2e/news.spec.ts, and delete this test. If the board shows the optional
// "Don't show me this again" variant, it still stays off until the owner decides
// (NEWS_DISMISS_ENABLED).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BOARDS = `${ROOT}design/x2f-app/`;

describe('Task 28 stand-ins', () => {
  it('NEEDS_DESIGN_NEWS: no News board yet, so News.tsx carries no styling of its own', () => {
    const canvas = JSON.parse(readFileSync(`${BOARDS}canvas.json`, 'utf8')) as { boards: Record<string, unknown> };
    const board = Object.keys(canvas.boards).some((b) => /^News/i.test(b)) || existsSync(`${BOARDS}News.dc.html`);
    expect(board, 'Claude Design delivered a News board: style News.tsx to it (see this test)').toBe(false);
    // Until then: no News stylesheet and no inline styles.
    expect(existsSync(`${ROOT}apps/web/src/screens/news.css`) || existsSync(`${ROOT}apps/web/src/screens/News.css`)).toBe(false);
    expect(readFileSync(`${ROOT}apps/web/src/screens/News.tsx`, 'utf8')).not.toMatch(/style=\{/);
    // The post itself lives in NewsPost.tsx (shared with the staff NewsEditor's preview, design 10 Nov 2026).
    expect(readFileSync(`${ROOT}apps/web/src/screens/NewsPost.tsx`, 'utf8')).not.toMatch(/style=\{/);
  });
});
