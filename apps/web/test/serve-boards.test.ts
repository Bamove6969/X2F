import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boardSizes } from '../../../tools/parity/capture-refs.js';
import { BOARDS_DIR, boardHtml, serveBoards, type BoardServer } from '../../../tools/parity/serve-boards.js';

let server: BoardServer;
beforeAll(async () => {
  server = await serveBoards();
});
afterAll(async () => {
  await server.close();
});

describe('serve-boards', () => {
  it('serves a board with the Google Fonts link swapped for the self-hosted faces', async () => {
    const res = await fetch(`${server.origin}/Main.dc.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain('<link rel="stylesheet" href="/__fonts/fonts.css">');
    expect(html).toContain('How do you want to get paid?');
  });

  it('serves every face the boards load from this origin', async () => {
    const css = await (await fetch(`${server.origin}/__fonts/fonts.css`)).text();
    for (const [family, weight] of [
      ['Familjen Grotesk', 600],
      ['Familjen Grotesk', 700],
      ['Atkinson Hyperlegible Next', 400],
      ['Atkinson Hyperlegible Next', 600],
      ['Atkinson Hyperlegible Mono', 400],
      ['Atkinson Hyperlegible Mono', 500],
    ] as const) {
      expect(css).toMatch(new RegExp(`font-family: '${family}';[^}]*font-weight: ${weight};`));
    }
    expect(css).not.toMatch(/url\((?!\/__fonts\/)/);
    const first = /url\((\/__fonts\/[^)]+\.woff2)\)/.exec(css)![1]!;
    const font = await fetch(`${server.origin}${first}`);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
  });

  it('serves nothing outside the boards, the runtime and the fonts', async () => {
    for (const path of ['/canvas.json', '/../package.json', '/%2e%2e/package.json', '/__fonts/x/files/a.woff2', '/__fonts/familjen-grotesk/600.css', '/Nope.dc.html']) {
      expect((await fetch(`${server.origin}${path}`)).status, path).toBe(404);
    }
  });

  it('boardHtml leaves a board without a Google Fonts link alone', () => {
    expect(boardHtml('<p>Hi</p>')).toBe('<p>Hi</p>');
  });
});

describe('capture-refs', () => {
  it('reads every board size from canvas.json', () => {
    const sizes = boardSizes(BOARDS_DIR);
    expect(sizes.get('Main')).toEqual({ width: 390, height: 844 });
    expect(sizes.get('Desktop')).toEqual({ width: 1280, height: 800 });
    // One size per board file on disk and per board in canvas.json (not a hard-coded count).
    const onDisk = readdirSync(BOARDS_DIR).filter((f) => f.endsWith('.dc.html')).length;
    const inCanvas = Object.keys(
      (JSON.parse(readFileSync(join(BOARDS_DIR, 'canvas.json'), 'utf8')) as { boards: Record<string, unknown> }).boards,
    ).filter((f) => f.endsWith('.dc.html')).length;
    expect(onDisk).toBeGreaterThan(0);
    expect(sizes.size).toBe(onDisk);
    expect(sizes.size).toBe(inCanvas);
  });

  it('every board has a reference shot from its current .dc.html (refs/manifest.json: hash and PNG size)', () => {
    const manifest = JSON.parse(readFileSync(join(BOARDS_DIR, 'refs', 'manifest.json'), 'utf8')) as Record<string, { sha256: string; w: number; h: number }>;
    const stale: string[] = [];
    for (const [name, size] of boardSizes(BOARDS_DIR)) {
      const entry = manifest[name];
      const hash = createHash('sha256').update(readFileSync(join(BOARDS_DIR, `${name}.dc.html`))).digest('hex');
      if (!entry) {
        stale.push(`${name}: not in refs/manifest.json`);
        continue;
      }
      if (entry.sha256 !== hash) stale.push(`${name}: board changed since refs/${name}.png was captured`);
      const png = readFileSync(join(BOARDS_DIR, 'refs', `${name}.png`));
      // PNG IHDR: width and height are big-endian at bytes 16 and 20.
      const shot = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
      if (shot.w !== size.width || shot.h !== size.height || entry.w !== size.width || entry.h !== size.height) {
        stale.push(`${name}: reference is ${shot.w}x${shot.h}, board is ${size.width}x${size.height}`);
      }
    }
    // Recapture with tools/parity/capture-refs.ts (see apps/web/src/ui/README.md).
    expect(stale).toEqual([]);
  });
});
