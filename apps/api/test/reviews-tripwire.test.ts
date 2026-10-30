// TRIPWIRE (Plan 5 Task 3 / Task 7): review notes are checked for personal details with
// `detectSensitiveText` from `@x2f/proof` (Task 7, built in parallel on another branch). Until it is
// on this tree, apps/api/src/reviews/sensitive.ts holds a small local stand-in. Checks the local
// tree only: it fails once `@x2f/proof` exports `detectSensitiveText` here while the stand-in is
// still in place; then make `hasPersonalDetails` call `detectSensitiveText(s).length > 0` (add
// `@x2f/proof` to apps/api/package.json), keep the note cases in reviews.test.ts passing, and
// delete this file.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : '');

function proofExportsDetector(): boolean {
  const dir = join(ROOT, 'packages/proof/src');
  if (!existsSync(dir)) return false;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .some((f) => /export\s+(?:async\s+)?function\s+detectSensitiveText\b/.test(readFileSync(join(dir, f), 'utf8')));
}

describe('review notes use Task 7 once it lands', () => {
  it('NEEDS_TASK_7_SENSITIVE_TEXT: the local stand-in goes once @x2f/proof exports detectSensitiveText', () => {
    const sensitive = read('apps/api/src/reviews/sensitive.ts');
    const usesProof = /from '@x2f\/proof'/.test(sensitive) && /detectSensitiveText\(/.test(sensitive);
    expect(!proofExportsDetector() || usesProof, 'Task 7 landed: call detectSensitiveText from @x2f/proof in reviews/sensitive.ts').toBe(true);
  });
});
