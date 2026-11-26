import { describe, expect, it } from 'vitest';
import { PARTLY_MARK, collectUnsignedCopy, renderUnsignedMarkdown, scanUnsignedSource, screenForFile } from '../copy-inventory.js';

describe('copy-inventory (owner p5-1)', () => {
  it('extracts COPY-UNSIGNED strings from declarations, JSX, same-line comments, and across intermediate pragmas', () => {
    const src = [
      'export const OTHER = "Signed line";',
      '// COPY-UNSIGNED: setup welcome copy',
      'export const COPY = {',
      '  heading: "Welcome to X2F",',
      '  // COPY-UNSIGNED: owner note',
      '  // not-a-refusal: explanation only',
      '  hint: "You cannot undo a release.",',
      '};',
      'export function View() {',
      '  return (',
      '    <div>',
      '      {/* COPY-UNSIGNED */}',
      '      <button title="Start tour">Take the tour</button>',
      '      <span>{" Inline unsigned "}</span> {/* COPY-UNSIGNED */}',
      '    </div>',
      '  );',
      '}',
    ].join('\n');

    const items = scanUnsignedSource(src, 'apps/web/src/screens/welcome/WelcomeScreen.tsx');
    expect(items.map((i) => ({ line: i.line, text: i.text }))).toEqual([
      { line: 4, text: 'Welcome to X2F' },
      { line: 7, text: 'You cannot undo a release.' },
      { line: 13, text: 'Start tour' },
      { line: 13, text: 'Take the tour' },
      { line: 14, text: 'Inline unsigned' },
    ]);
    expect(items.every((i) => i.screen.id === 'welcome')).toBe(true);
  });

  it('maps files to their screen/route group', () => {
    expect(screenForFile('apps/web/src/screens/welcome/WelcomeScreen.tsx').route).toContain('/welcome');
    expect(screenForFile('apps/web/src/screens/setup/Backup.tsx').route).toContain('/setup/backup');
    expect(screenForFile('apps/web/src/screens/trade/BuyerPay.tsx').route).toContain('/trade/:id');
    expect(screenForFile('apps/staff-web/src/screens/Login.tsx').id).toBe('staff-web');
  });

  it('finds known COPY-UNSIGNED lines in the repository across different screens', () => {
    const items = collectUnsignedCopy();
    expect(items.length).toBeGreaterThan(200);

    // Known lines across different screens (matched by file and text, without pinning line numbers):
    expect(
      items.some(
        (i) => i.file === 'apps/web/src/screens/welcome/WelcomeScreen.tsx' && i.text === 'Welcome to X2F',
      ),
    ).toBe(true);
    expect(
      items.some(
        (i) => i.file === 'apps/web/src/screens/setup/Backup.tsx' && i.text === 'Save your recovery code',
      ),
    ).toBe(true);
    expect(
      items.some(
        (i) =>
          i.file === 'apps/web/src/screens/setup/Terms.tsx' &&
          i.text === 'Full Terms of Service',
      ),
    ).toBe(true);
    expect(
      items.some(
        (i) =>
          i.file === 'apps/web/src/screens/auth/sessionCopy.ts' &&
          i.text === 'How long should this session stay logged in?',
      ),
    ).toBe(true);
  });

  it('lists each branch of conditional JSX on its own and never prints code or JSX comments', () => {
    const src = [
      'export function View({ ok }: { ok: boolean }) {',
      '  return (',
      '    // COPY-UNSIGNED: conditional sentence',
      '    <p>',
      "      {/* The board's step 3 note */}",
      '      Your trade {ok ? <>is open</> : <>is closed</>} now.',
      '    </p>',
      '  );',
      '}',
      '// COPY-UNSIGNED: date',
      "export const when = (d: Date) => d.toLocaleString('en-US', { month: 'short' });",
      "export const count = (n: number) => `${n.toLocaleString('en-US')} payment methods`;",
      '// COPY-UNSIGNED: notes',
      'export const NOTE = { a: "research 2026-11-10 (medium): see the docs", b: "See https://example.com" };',
    ].join('\n');
    const items = scanUnsignedSource(src, 'apps/web/src/screens/trade/View.tsx');
    const texts = items.map((i) => i.text);
    expect(texts).toEqual(expect.arrayContaining(['is open', 'is closed', '${n} payment methods']));
    for (const t of texts) {
      expect(t).not.toContain('<');
      expect(t).not.toContain('?(');
      expect(t).not.toContain('/*');
      expect(t).not.toContain('en-US');
      expect(t).not.toMatch(/https?:|^research /);
    }
  });

  it('prints each marker note once and flags notes that sign only part of their scope', () => {
    const note = `COPY-UNSIGNED: all of this is unsigned except the slogan; ${'long note '.repeat(30).trim()}`;
    const src = [`// ${note}`, 'export const COPY = {', '  a: "First line",', '  b: "Second line",', '  c: "Third line",', '};'].join('\n');
    const items = scanUnsignedSource(src, 'apps/web/src/screens/auth/Landing.tsx');
    expect(items).toHaveLength(3);
    const md = renderUnsignedMarkdown(items);
    expect(md.split(note).length - 1).toBe(1);
    expect(md.split(PARTLY_MARK).length - 1).toBe(4);
  });
});
