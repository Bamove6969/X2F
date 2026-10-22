// Writes the board reference images for the reported pixel diff of expectParity (Task 15):
// serves design/x2f-app/ (serve-boards.ts) and screenshots each board at its canvas.json size,
// device scale 1, into design/x2f-app/refs/<Board>.png. Every request that is not to the local
// board server is aborted, animations are frozen and the caret hidden, so a run is repeatable.
//
// Needs the canvas runtime design/x2f-app/support.js (the controller step of Task 15 fetches it
// from the X2F App canvas with the Artifact tool). Without it this refuses to run.
//
//   X2F_CHROMIUM_PATH=/usr/bin/chromium npx tsx tools/parity/capture-refs.ts            # every board
//   X2F_CHROMIUM_PATH=/usr/bin/chromium npx tsx tools/parity/capture-refs.ts Main Desktop
//   (--boards-dir=<dir> and --out-dir=<dir> point it elsewhere; the tests use them.)
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { BOARDS_DIR, serveBoards } from './serve-boards.js';

interface Canvas {
  boards: Record<string, { w: number; h: number }>;
}

/** The boards in `canvas.json` with their sizes, named without `.dc.html`. */
export function boardSizes(boardsDir: string): Map<string, { width: number; height: number }> {
  const canvas = JSON.parse(readFileSync(join(boardsDir, 'canvas.json'), 'utf8')) as Canvas;
  const sizes = new Map<string, { width: number; height: number }>();
  for (const [file, b] of Object.entries(canvas.boards)) {
    if (file.endsWith('.dc.html')) sizes.set(file.slice(0, -'.dc.html'.length), { width: b.w, height: b.h });
  }
  return sizes;
}

/** Captures `boards` (default: every board in canvas.json) and returns the files written. */
export async function captureRefs(o: {
  boardsDir?: string;
  outDir?: string;
  boards?: string[];
  executablePath?: string;
}): Promise<string[]> {
  const boardsDir = o.boardsDir ?? BOARDS_DIR;
  const outDir = o.outDir ?? join(boardsDir, 'refs');
  if (!existsSync(join(boardsDir, 'support.js'))) {
    throw new Error(
      `capture-refs: ${join(boardsDir, 'support.js')} is missing. It is the canvas runtime the boards need; ` +
        'the Task 15 controller step fetches it from the X2F App canvas (Artifact tool, path support.js).',
    );
  }
  const sizes = boardSizes(boardsDir);
  const names = o.boards ?? [...sizes.keys()];
  for (const n of names) if (!sizes.has(n)) throw new Error(`capture-refs: no board "${n}" in canvas.json`);

  mkdirSync(outDir, { recursive: true });
  const server = await serveBoards({ boardsDir });
  const executablePath = o.executablePath ?? process.env.X2F_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const written: string[] = [];
  try {
    for (const name of names) {
      const size = sizes.get(name)!;
      const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
      await context.route('**/*', (r) => (r.request().url().startsWith(`${server.origin}/`) ? r.continue() : r.abort()));
      const page = await context.newPage();
      await page.goto(`${server.origin}/${name}.dc.html`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const file = join(outDir, `${name}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, ...size }, animations: 'disabled', caret: 'hide' });
      written.push(file);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const boards = args.filter((a) => !a.startsWith('--'));
  const boardsDir = flag('boards-dir');
  const outDir = flag('out-dir');
  captureRefs({
    ...(boardsDir ? { boardsDir } : {}),
    ...(outDir ? { outDir } : {}),
    ...(boards.length > 0 ? { boards } : {}),
  }).then(
    (written) => console.log(`capture-refs: wrote ${written.length} reference${written.length === 1 ? '' : 's'}`),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
