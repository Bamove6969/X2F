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
//
// Known canvas-runtime artifact: refs/SetupBackup.png shows "Addauthenticator app" on the primary
// button. The board's text is "Add {{choice}}", and the canvas runtime drops the space before the
// filled-in placeholder when it renders. The app shows "Add authenticator app". This is cosmetic:
// it only adds a little pixel noise to the reported (non-blocking) diff. Do not hand-edit the PNG.
// References come only from this script. Each capture also records the board in refs/manifest.json
// ({ <Board>: { sha256 of the .dc.html, w, h } }), so a test can tell when a board changed after its
// reference was shot (apps/web/test/serve-boards.test.ts).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** One refs/manifest.json entry: the board file the reference was shot from, and its size. */
export interface RefEntry {
  sha256: string;
  w: number;
  h: number;
}

/** The sha256 (hex) of a board's .dc.html, as recorded in refs/manifest.json. */
export function boardHash(boardsDir: string, name: string): string {
  return createHash('sha256').update(readFileSync(join(boardsDir, `${name}.dc.html`))).digest('hex');
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

  // Capture into a temp folder and move the images into place only when every board succeeds, so a
  // failed run never leaves a half-written or stale set of references behind.
  const staging = mkdtempSync(join(tmpdir(), 'x2f-refs-'));
  try {
    return await captureInto(staging, boardsDir, outDir, names, sizes, o.executablePath);
  } finally {
    // Removed on success and on failure alike.
    rmSync(staging, { recursive: true, force: true });
  }
}

async function captureInto(
  staging: string,
  boardsDir: string,
  outDir: string,
  names: string[],
  sizes: Map<string, { width: number; height: number }>,
  executablePathOption: string | undefined,
): Promise<string[]> {
  const server = await serveBoards({ boardsDir });
  const executablePath = executablePathOption ?? process.env.X2F_CHROMIUM_PATH;
  let browser;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (e) {
    await server.close();
    throw e;
  }
  const staged: { name: string; file: string }[] = [];
  try {
    for (const name of names) {
      const size = sizes.get(name)!;
      const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
      const problems: string[] = [];
      // The board must be self-contained from the local server: any request that leaves it is
      // aborted, and an abort (or any other failed request) is a failure, not a silently blank image.
      await context.route('**/*', (r) => (r.request().url().startsWith(`${server.origin}/`) ? r.continue() : r.abort()));
      const page = await context.newPage();
      page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
      page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'aborted'})`));
      const response = await page.goto(`${server.origin}/${name}.dc.html`, { waitUntil: 'networkidle' });
      const status = response?.status() ?? 0;
      if (status < 200 || status >= 300) problems.push(`${name}.dc.html returned HTTP ${status}`);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      if (await page.evaluate(() => document.body.innerHTML.includes('{{'))) {
        problems.push('{{…}} is still in the rendered body — the canvas runtime did not fill the template');
      }
      if (problems.length > 0) {
        await context.close();
        throw new Error(`capture-refs: board "${name}" did not render cleanly:\n  - ${problems.join('\n  - ')}`);
      }
      const file = join(staging, `${name}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, ...size }, animations: 'disabled', caret: 'hide' });
      staged.push({ name, file });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, 'manifest.json');
  const manifest = (existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}) as Record<string, RefEntry>;
  const written: string[] = [];
  for (const { name, file } of staged) {
    const dest = join(outDir, `${name}.png`);
    copyFileSync(file, dest); // copy (not rename): the staging temp may be on another filesystem
    const size = sizes.get(name)!;
    manifest[name] = { sha256: boardHash(boardsDir, name), w: size.width, h: size.height };
    written.push(dest);
  }
  // Sorted by board, so a recapture of one board changes one line.
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en')));
  writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
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
