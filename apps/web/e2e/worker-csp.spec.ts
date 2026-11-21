// Lead call 20 Nov: every worker script carries its own CSP, exactly as narrow as that worker needs
// (a dedicated worker takes its CSP from its own response, never from the page). On the production
// build served by the API's serveWeb (playwright.config.ts), from inside each worker: a request to an
// origin its policy does not list is refused by the CSP (a securitypolicyviolation event in that
// worker), and a listed one is not. The regtest e2e proves the escrow still runs end to end under them.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Worker } from '@playwright/test';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
/** serve.ts's stand-in connect origins (never reachable: only the CSP verdict matters here). */
const RELAY = 'wss://relay.x2f.invalid';
const NODE = 'https://node.x2f.invalid';
const UNLISTED = 'https://unlisted.x2f.invalid';

function escrowWorkerFile(): string {
  const files = readdirSync(`${DIST}/assets`).filter((f) => /^escrow-worker-[A-Za-z0-9_-]{8}\.js$/.test(f));
  expect(files).toHaveLength(1);
  return `/assets/${files[0]!}`;
}

/** The page's entry script (review M-1 started it as a worker to get round the page's connect-src). */
function pageEntryFile(): string {
  const files = readdirSync(`${DIST}/assets`).filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f));
  expect(files).toHaveLength(1);
  return `/assets/${files[0]!}`;
}

interface Verdict {
  /** The CSP refused it (the worker saw a securitypolicyviolation for it). */
  refused: boolean;
  directive: string | null;
}

/**
 * Runs one request inside `w` and reports whether the CSP refused it. `kind` is fetch, a WebSocket,
 * a nested Worker or a dynamic import(). The listener is attached first; a refused request fires its event before or as
 * the request fails, and an allowed one to an unreachable stand-in fails without any event.
 */
async function tryIn(w: Worker, kind: 'fetch' | 'ws' | 'worker' | 'import', url: string): Promise<Verdict> {
  return w.evaluate(
    async ([k, u]) => {
      const seen: string[] = [];
      const onViolation = (e: Event) => {
        // blockedURI (the spec's name; Chromium has no blockedURL here): the URL, or only its origin.
        const v = e as SecurityPolicyViolationEvent;
        const b = v.blockedURI;
        if (b !== '' && (b.startsWith(u.replace(/\/$/, '')) || u.startsWith(b))) seen.push(v.effectiveDirective);
      };
      self.addEventListener('securitypolicyviolation', onViolation);
      try {
        if (k === 'fetch') await fetch(u).catch(() => undefined);
        else if (k === 'import') await import(u).catch(() => undefined);
        else if (k === 'ws') {
          try {
            const s = new WebSocket(u);
            await new Promise((r) => {
              s.onerror = r;
              s.onclose = r;
              setTimeout(r, 3000);
            });
          } catch {
            // a synchronous refusal
          }
        } else {
          try {
            const n = new Worker(u);
            await new Promise((r) => {
              n.onerror = r;
              setTimeout(r, 1500);
            });
            n.terminate();
          } catch {
            // a synchronous refusal
          }
        }
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        self.removeEventListener('securitypolicyviolation', onViolation);
      }
      return { refused: seen.length > 0, directive: seen[0] ?? null };
    },
    [kind, url] as const,
  );
}

async function workerAt(page: Page, path: string, start: () => Promise<unknown>): Promise<Worker> {
  const url = `${new URL(page.url()).origin}${path}`;
  const found = page.workers().find((w) => w.url() === url);
  if (found) return found;
  const next = page.waitForEvent('worker', { predicate: (w) => w.url() === url, timeout: 15_000 });
  await start();
  return next;
}

test.describe('worker CSPs (lead call 20 Nov)', () => {
  test('every worker script response carries its exact policy', async ({ request, baseURL }) => {
    const origins = [baseURL!, baseURL!.replace('127.0.0.1', 'localhost')];
    const escrow = await request.get(escrowWorkerFile());
    expect(escrow.headers()['content-type']).toMatch(/^application\/javascript/);
    expect(escrow.headers()['content-security-policy']).toBe(
      "default-src 'none'; script-src 'wasm-unsafe-eval'; " +
        `worker-src ${origins.map((o) => `${o}/monero/monero.worker.js`).join(' ')}; ` +
        `connect-src ${origins.map((o) => `${o}/v1/`).join(' ')} ${RELAY} ${NODE}`,
    );
    const monero = await request.get('/monero/monero.worker.js');
    expect(monero.headers()['content-type']).toMatch(/^application\/javascript/);
    expect(monero.headers()['content-security-policy']).toBe(`default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src ${NODE}`);
    // main's narrowed OCR worker policy (proof card): scripts and fetches only under <site>/ocr/.
    const ocr = origins.map((o) => `${o}/ocr/`).join(' ');
    expect((await request.get('/ocr/worker.min.js')).headers()['content-security-policy']).toBe(
      `default-src 'none'; script-src ${ocr} 'wasm-unsafe-eval'; connect-src ${ocr}; worker-src 'none'`,
    );
    expect((await request.get('/sw.js')).headers()['content-security-policy']).toBe("default-src 'none'");
    // Review M-1: every other built script is deny-all, so started as a worker it may reach nothing.
    const others = readdirSync(`${DIST}/assets`).filter((f) => /\.m?js$/.test(f) && !/^escrow-worker-/.test(f));
    expect(others.length).toBeGreaterThan(0);
    for (const f of others) {
      expect((await request.get(`/assets/${f}`)).headers()['content-security-policy'], f).toBe("default-src 'none'");
    }
  });

  test("review M-1: a page script started as a worker cannot fetch an unlisted host (the page's own connect-src cannot be got round)", async ({ page }) => {
    await page.goto('/');
    const entry = pageEntryFile();
    const w = await workerAt(page, entry, () =>
      page.evaluate((p) => {
        (globalThis as { __p?: unknown }).__p = new Worker(p, { type: 'module' });
      }, entry),
    );
    expect(await tryIn(w, 'fetch', `${UNLISTED}/x`)).toEqual({ refused: true, directive: 'connect-src' });
    expect(await tryIn(w, 'fetch', `${new URL(page.url()).origin}/v1/news`)).toEqual({ refused: true, directive: 'connect-src' });
  });

  test('inside the escrow worker, and the monero-ts worker it starts, an unlisted origin is refused', async ({ page }) => {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    const escrowPath = escrowWorkerFile();
    const escrow = await workerAt(page, escrowPath, () =>
      page.evaluate((p) => {
        (globalThis as { __w?: unknown }).__w = new Worker(p, { type: 'module', name: 'x2f-escrow' });
      }, escrowPath),
    );

    // The escrow worker: the API (under /v1/ only, review m-2), the relay and the node proxy only.
    expect(await tryIn(escrow, 'fetch', `${UNLISTED}/x`)).toEqual({ refused: true, directive: 'connect-src' });
    expect(await tryIn(escrow, 'fetch', `${origin}/ocr/eng.traineddata.gz`)).toEqual({ refused: true, directive: 'connect-src' });
    expect(await tryIn(escrow, 'fetch', `${origin}${escrowPath}`)).toEqual({ refused: true, directive: 'connect-src' });
    // Review m-2: no script of this origin can be pulled into it (no 'self' in script-src).
    const imported = await tryIn(escrow, 'import', `${origin}${pageEntryFile()}`);
    expect(imported.refused).toBe(true);
    expect(imported.directive).toMatch(/^script-src/);
    expect(await tryIn(escrow, 'ws', 'wss://unlisted.x2f.invalid/v1/trade/x')).toEqual({ refused: true, directive: 'connect-src' });
    expect((await tryIn(escrow, 'fetch', `${origin}/v1/news`)).refused).toBe(false);
    expect((await tryIn(escrow, 'fetch', `${NODE}/json_rpc`)).refused).toBe(false);
    expect((await tryIn(escrow, 'ws', `${RELAY}/v1/trade/x`)).refused).toBe(false);
    // It may start monero-ts's wallet worker and no other worker (not even another file of this origin).
    expect(await tryIn(escrow, 'worker', `${origin}/ocr/worker.min.js`)).toEqual({ refused: true, directive: 'worker-src' });

    const monero = await workerAt(page, '/monero/monero.worker.js', () =>
      escrow.evaluate(() => {
        (globalThis as { __m?: unknown }).__m = new Worker('/monero/monero.worker.js');
      }),
    );
    // monero-ts's worker: the node proxy only, not even this origin.
    expect(await tryIn(monero, 'fetch', `${UNLISTED}/x`)).toEqual({ refused: true, directive: 'connect-src' });
    expect(await tryIn(monero, 'fetch', `${origin}/v1/news`)).toEqual({ refused: true, directive: 'connect-src' });
    expect((await tryIn(monero, 'fetch', `${NODE}/json_rpc`)).refused).toBe(false);
  });

  test('inside the OCR worker, an unlisted origin is refused and this origin is not', async ({ page }) => {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    const ocr = await workerAt(page, '/ocr/worker.min.js', () =>
      page.evaluate(() => {
        (globalThis as { __o?: unknown }).__o = new Worker('/ocr/worker.min.js');
      }),
    );
    expect(await tryIn(ocr, 'fetch', `${UNLISTED}/x`)).toEqual({ refused: true, directive: 'connect-src' });
    expect(await tryIn(ocr, 'fetch', NODE)).toEqual({ refused: true, directive: 'connect-src' });
    expect((await tryIn(ocr, 'fetch', `${origin}/ocr/eng.traineddata.gz`)).refused).toBe(false);
  });
});
