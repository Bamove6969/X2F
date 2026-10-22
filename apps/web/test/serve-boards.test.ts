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
    expect(sizes.size).toBe(34);
  });
});
