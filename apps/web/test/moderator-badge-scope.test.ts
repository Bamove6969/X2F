// The violet "X2F Moderator" tag appears only inside a disputed trade's screens (spec 6.6): only
// screens/dispute/ModeratorTag.tsx draws RoleTag role="mod", and no other file draws a look-alike
// with the tag's words or its mod tone. (That ModeratorTag draws it only for a moderator inside a
// dispute is rendered in dispute.test.tsx.) The kit's own files (Avatar.tsx holds the words,
// Identity.tsx's moderator row, kit.css the tone) are the tag itself.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const KIT = new Set(['ui/Avatar.tsx', 'ui/Identity.tsx', 'ui/kit.css']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(n) ? [p] : [];
  });
}

const using = (re: RegExp) =>
  files(SRC)
    .filter((p) => re.test(readFileSync(p, 'utf8')))
    .map((p) => relative(SRC, p).replaceAll('\\', '/'))
    .filter((p) => !KIT.has(p));

describe('moderator tag scope', () => {
  it('only ModeratorTag draws the mod role tag', () => {
    expect(using(/role=["']mod["']|data-role=['"]mod/)).toEqual(['screens/dispute/ModeratorTag.tsx']);
  });

  it('has its words only in the kit and ModeratorTag', () => {
    expect(using(/X2F Moderator|x2f-moderator-badge/i)).toEqual(['screens/dispute/ModeratorTag.tsx']);
  });
});
