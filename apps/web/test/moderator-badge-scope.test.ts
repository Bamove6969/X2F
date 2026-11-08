// The violet moderator look appears only inside a disputed trade's screens (spec 6.6, an
// anti-impersonation rule) and the trade chat that a dispute opens (review 3, 8 Nov). Every way a
// screen can draw it is checked: the mod role tag (fixed or a variable role), the moderator tile, an
// identity row drawn as a moderator, the mod tone on a status chip or hero, the --x2f-mod token, and
// the tag's words. The kit's own files define these pieces and are not users of them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The kit and the token file: they define the moderator pieces. */
const KIT = new Set(['ui/Avatar.tsx', 'ui/Identity.tsx', 'ui/Hero.tsx', 'ui/StatusChip.tsx', 'ui/kit.css', 'ui/hero.css', 'ui/ui.css', 'theme/tokens.css']);

/** Where the moderator look may appear: the dispute screens and the trade chat. */
const ALLOWED = (p: string) => p.startsWith('screens/dispute/') || p === 'chat/chat.css' || p === 'chat/ChatPanel.tsx';

/** Every way to draw the moderator look (JSX props may span lines). */
const MOD_LOOK: [string, RegExp][] = [
  ['mod role tag', /\brole=["']mod["']|data-role=["']mod/],
  ['role tag with a variable role', /<RoleTag\b[^>]*\brole=\{/],
  ['moderator tile', /<ModTile\b/],
  ['identity row as a moderator', /<IdentityRow\b[^>]*\smod(?:=\{true\})?(?=[\s/>])/],
  ['mod tone', /\btone=(?:["']mod["']|\{\s*["']mod["']\s*\})|data-tone=["']mod/],
  ['mod colour token', /--x2f-mod\b/],
  ["the tag's words", /X2F Moderator|x2f-moderator-badge/i],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(n) ? [p] : [];
  });
}

const sources = files(SRC).map((p) => ({ file: relative(SRC, p).replaceAll('\\', '/'), text: readFileSync(p, 'utf8') }));

describe('moderator look scope', () => {
  it('each pattern catches its way of drawing the look', () => {
    const samples = [
      '<RoleTag role="mod" />',
      '<RoleTag\n  role={who}\n/>',
      '<ModTile size={32} />',
      '<IdentityRow person={p} mod />',
      '<IdentityRow person={p}\n  mod={true}\n/>',
      '<StatusChip tone="mod">Moderator decided</StatusChip>',
      "<Hero tone={'mod'}>",
      '.x { color: var(--x2f-mod); }',
      'X2F Moderator',
    ];
    for (const s of samples) expect(MOD_LOOK.some(([, re]) => re.test(s)), s).toBe(true);
    // Not the look: a data attribute named role, a dialog role, a modal.
    for (const s of ['<main data-role={view.role}>', "role={x ? 'dialog' : 'alertdialog'}", 'aria-modal="true"', '<IdentityRow person={p} modal />']) {
      expect(MOD_LOOK.some(([, re]) => re.test(s)), s).toBe(false);
    }
  });

  for (const [what, re] of MOD_LOOK) {
    it(`${what}: only the dispute screens and the trade chat`, () => {
      const outside = sources.filter((f) => !KIT.has(f.file) && !ALLOWED(f.file) && re.test(f.text)).map((f) => f.file);
      expect(outside).toEqual([]);
    });
  }

  it('the X2F Moderator tag is drawn by ModeratorTag alone', () => {
    const users = sources.filter((f) => !KIT.has(f.file) && /\brole=["']mod["']|X2F Moderator/i.test(f.text)).map((f) => f.file);
    expect(users).toEqual(['screens/dispute/ModeratorTag.tsx']);
  });
});
