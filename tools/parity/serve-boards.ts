// Serves the X2F App boards (design/x2f-app/*.dc.html) on 127.0.0.1 for capture-refs.ts, with no
// request leaving the machine: each board's Google Fonts <link> is swapped for the app's own
// self-hosted @fontsource faces (the same files the app ships), so a reference renders with the
// fonts the app uses. The canvas runtime is design/x2f-app/support.js, fetched by the controller
// (Task 15 controller step); without it the boards' templates do not render.
//
// Run by hand: `npx tsx tools/parity/serve-boards.ts [port]`, then open http://127.0.0.1:<port>/Main.dc.html.
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BOARDS_DIR = fileURLToPath(new URL('../../design/x2f-app/', import.meta.url));
const FONTSOURCE = fileURLToPath(new URL('../../node_modules/@fontsource/', import.meta.url));

/** The faces and weights the boards load from Google Fonts (and apps/web/src/theme/fonts.css self-hosts). */
const FACES: [pkg: string, weight: number][] = [
  ['familjen-grotesk', 600],
  ['familjen-grotesk', 700],
  ['atkinson-hyperlegible-next', 400],
  ['atkinson-hyperlegible-next', 600],
  ['atkinson-hyperlegible-mono', 400],
  ['atkinson-hyperlegible-mono', 500],
];
const FONT_PKGS = new Set(FACES.map(([pkg]) => pkg));
const GOOGLE_FONTS = /<link\b[^>]*\bhref="https:\/\/fonts\.googleapis\.com\/[^"]*"[^>]*>/g;
const FONTS_LINK = '<link rel="stylesheet" href="/__fonts/fonts.css">';

/** One stylesheet with every face, its url()s pointing at this server. */
function fontsCss(): string {
  return FACES.map(([pkg, weight]) =>
    readFileSync(join(FONTSOURCE, pkg, `${weight}.css`), 'utf8').replace(/url\(\.\/files\//g, `url(/__fonts/${pkg}/files/`),
  ).join('\n');
}

/** A board's HTML as served: the Google Fonts link replaced by the local faces. */
export function boardHtml(html: string): string {
  return html.replace(GOOGLE_FONTS, FONTS_LINK);
}

type Reply = { status: number; type: string; body: string | Buffer };

function route(boardsDir: string, path: string): Reply {
  const notFound: Reply = { status: 404, type: 'text/plain; charset=utf-8', body: 'not found' };
  // Only flat, known-shaped names: a board, the runtime, the fonts. Nothing else is reachable.
  const board = /^\/([A-Za-z0-9]+\.dc\.html)$/.exec(path);
  if (board) {
    const file = join(boardsDir, board[1]!);
    if (!existsSync(file)) return notFound;
    return { status: 200, type: 'text/html; charset=utf-8', body: boardHtml(readFileSync(file, 'utf8')) };
  }
  if (path === '/support.js') {
    const file = join(boardsDir, 'support.js');
    if (!existsSync(file)) return notFound;
    return { status: 200, type: 'text/javascript; charset=utf-8', body: readFileSync(file) };
  }
  if (path === '/__fonts/fonts.css') return { status: 200, type: 'text/css; charset=utf-8', body: fontsCss() };
  const font = /^\/__fonts\/([a-z-]+)\/files\/([a-z0-9-]+\.woff2?)$/.exec(path);
  if (font && FONT_PKGS.has(font[1]!)) {
    const file = join(FONTSOURCE, font[1]!, 'files', font[2]!);
    if (!existsSync(file)) return notFound;
    return { status: 200, type: font[2]!.endsWith('.woff2') ? 'font/woff2' : 'font/woff', body: readFileSync(file) };
  }
  return notFound;
}

export interface BoardServer {
  origin: string;
  close(): Promise<void>;
}

/** Starts the board server on 127.0.0.1 (`port` 0 picks a free one). */
export async function serveBoards(o: { boardsDir?: string; port?: number } = {}): Promise<BoardServer> {
  const boardsDir = o.boardsDir ?? BOARDS_DIR;
  const server: Server = createServer((req, res) => {
    const r = req.method === 'GET' ? route(boardsDir, new URL(req.url ?? '/', 'http://local').pathname) : { status: 405, type: 'text/plain', body: '' };
    res.writeHead(r.status, { 'content-type': r.type, 'cache-control': 'no-store' });
    res.end(r.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void serveBoards({ port: Number(process.argv[2] ?? 4320) }).then((s) => console.log(`serve-boards: ${s.origin}/<Board>.dc.html (Ctrl+C to stop)`));
}
