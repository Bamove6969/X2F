// TRIPWIRES for Plan 4 Task 28 (News): the reader side, `GET /v1/news` and an operator CLI are built,
// but the owner's editor needs Plan 4's staff pieces, which are not on the main line yet. Each
// tripwire looks at this checkout only and fails once its piece lands: then do what it says and
// delete it.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);
const read = (p: string): string => (has(p) ? readFileSync(ROOT + p, 'utf8') : '');

describe('Task 28 stand-ins', () => {
  it('NEEDS_PLAN4_STAFF_API: News writing moves to the staff API under site.control', () => {
    // When Plan 4 Tasks 1, 3 and 4 land (`@x2f/staff` perms, the activity log, `buildStaffApi`):
    // add staff routes POST /v1/staff/news, PUT and DELETE /v1/staff/news/:id with perm
    // `site.control` (the privilege-matrix test then shows a moderator is refused), each change
    // appended to the activity log (no message text in the entry, just the id and the action).
    // Keep tools/news.ts only if the lead wants an offline path; otherwise delete it with news/cli.ts.
    // Fires on Task 4 (the staff API) only: `packages/staff` (Tasks 1-3) has no routes to add News to.
    const staffLanded = /buildStaffApi/.test(read('apps/api/src/app.ts')) || has('apps/api/src/staff/app.ts');
    expect(staffLanded, 'Plan 4 staff API landed: add the site.control News routes (see this test)').toBe(false);
  });

  it('NEEDS_PLAN4_STAFF_WEB: the owner writes News in apps/staff-web NewsEditor', () => {
    // When Plan 4 Task 16 lands (`apps/staff-web`): build src/screens/NewsEditor.tsx (write, edit,
    // delete, with a preview as the News page shows it) on the routes above, and its e2e.
    expect(has('apps/staff-web/package.json'), 'apps/staff-web landed: build NewsEditor.tsx (see this test)').toBe(false);
  });
});
