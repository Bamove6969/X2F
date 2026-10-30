// The violet "X2F Moderator" badge appears only inside a disputed trade's screens (spec 6.6): no
// file outside the UI kit's own and screens/dispute/ModeratorTag.tsx may import ModeratorBadge,
// nor draw a look-alike with its class or its words. (That ModeratorTag draws it only for a
// moderator inside a dispute is rendered in dispute.test.tsx.)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ALLOWED = new Set(['ui/ModeratorBadge.tsx', 'screens/dispute/ModeratorTag.tsx']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(n) ? [p] : [];
  });
}

describe('ModeratorBadge scope', () => {
  it('is imported only by ModeratorTag', () => {
    const users = files(SRC)
      .filter((p) => /ModeratorBadge/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).replaceAll('\\', '/'))
      .filter((p) => !ALLOWED.has(p));
    expect(users).toEqual([]);
  });

  it('has its class and its words only in the badge, its style and ModeratorTag', () => {
    const own = new Set([...ALLOWED, 'ui/ui.css']);
    const users = files(SRC)
      .filter((p) => /x2f-moderator-badge|X2F Moderator/i.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).replaceAll('\\', '/'))
      .filter((p) => !own.has(p));
    expect(users).toEqual([]);
  });
});
