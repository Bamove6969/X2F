// TRIPWIRES for Plan 4 Task 28 (News): the reader side, `GET /v1/news`, the operator CLI and the
// staff API's write routes (staff/news.ts, Plan 4 Task 4) are built; the owner's editor screen needs
// Plan 4's staff web app, which is not on the main line yet. Each
// tripwire looks at this checkout only and fails once its piece lands: then do what it says and
// delete it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 28 stand-ins', () => {
  it('NEEDS_PLAN4_STAFF_WEB: the owner writes News in apps/staff-web NewsEditor', () => {
    // When Plan 4 Task 16 lands (`apps/staff-web`): build src/screens/NewsEditor.tsx (write, edit,
    // delete, with a preview as the News page shows it) on the routes above, and its e2e.
    expect(has('apps/staff-web/package.json'), 'apps/staff-web landed: build NewsEditor.tsx (see this test)').toBe(false);
  });
});
