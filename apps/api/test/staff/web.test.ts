// Plan 4 Task 16: the staff API serves the built staff app on the staff origin (X2F_STAFF_WEB_ROOT),
// with the staff CSP on every page, and never the app page for an API path.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_CSP } from '../../src/staff/app.js';
import { staffListenFromEnv } from '../../src/staff/main.js';
import { fileUnderRoot } from '../../src/staff/web.js';
import { staffApps } from '../helpers/staffApp.js';

let app: FastifyInstance;
let close: () => Promise<void>;
const root = mkdtempSync(join(tmpdir(), 'x2f-staff-web-'));

beforeAll(async () => {
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>X2F Staff</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app-1a2b.js'), 'console.log(1)');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(root, 'assets', '.env.js'), 'DOTFILE-SECRET');
  mkdirSync(join(root, '.vite'));
  writeFileSync(join(root, '.vite', 'manifest.json'), '{"dot":"dir"}');
  ({ app, close } = await staffApps({}, { webRoot: root }));
});
afterAll(async () => {
  await close();
  rmSync(root, { recursive: true, force: true });
});

describe('the staff web app on the staff origin', () => {
  it('serves index.html for app paths, with the staff CSP (no wasm, no relay or node proxy)', async () => {
    // Plan 4 Task 17: the owner's Staff page is /staff (NAV_PATHS.staff), so a reload of it is the app page too.
    for (const url of ['/', '/login', '/invite/abc_DEF-123', '/setup', '/overview/news', '/staff', '/staff?x=1', '/settings']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('X2F Staff');
      expect(res.headers['content-security-policy']).toBe(STAFF_CSP);
    }
    expect(STAFF_CSP).not.toContain('wasm-unsafe-eval');
    expect(STAFF_CSP).toContain("connect-src 'self';");
  });

  it('serves built files, and 404s missing files, dot files and unknown /staff paths', async () => {
    const js = await app.inject({ method: 'GET', url: '/assets/app-1a2b.js' });
    expect(js.statusCode).toBe(200);
    expect(js.body).toBe('console.log(1)');
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    // A dot file is never sent: /.env is not file-like (no extension), so it is the app page.
    expect((await app.inject({ method: 'GET', url: '/.env' })).body).not.toContain('SECRET');
    expect((await app.inject({ method: 'GET', url: '/assets/.env.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/assets/%2e%2e/%2e%2e/package.json' })).statusCode).toBe(404);
    // Traversal and malformed paths never reach sendFile: 404, never 500 or a file outside the root.
    expect((await app.inject({ method: 'GET', url: '/assets/..%2F..%2Fpackage.json' })).statusCode).toBe(404);
    // A malformed percent-escape is refused by the router (400) or by the route (404); never 500.
    expect([400, 404]).toContain((await app.inject({ method: 'GET', url: '/assets/%E0%A4%A' })).statusCode);
    expect((await app.inject({ method: 'GET', url: '/assets/a%00.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/assets/..%5C..%5Cpackage.json' })).statusCode).toBe(404);
    // A percent-encoded leading dot is still a dot file (the URL parser leaves %2E followed by letters alone).
    expect((await app.inject({ method: 'GET', url: '/assets/%2Eenv.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/%2Evite/manifest.json' })).statusCode).toBe(404);
    // Only the page itself: anything under /staff is still the API's 404.
    for (const url of ['/staff/', '/staff/v1', '/staff/anything', '/staff/v1/nothing-here', '/STAFF/v1/x']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
      expect(r.body, url).not.toContain('X2F Staff');
    }
    const api = await app.inject({ method: 'GET', url: '/staff/v1/nothing-here' });
    expect(api.statusCode).toBe(404);
    expect(api.body).not.toContain('X2F Staff');
    // The API's own routes still answer.
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
  });

  it('X2F_STAFF_WEB_ROOT is read with the staff origin', () => {
    expect(staffListenFromEnv({ X2F_STAFF_ORIGIN: 'https://staff.x2f.test', X2F_STAFF_WEB_ROOT: '/srv/staff' })).toMatchObject({ webRoot: '/srv/staff' });
    expect(staffListenFromEnv({ X2F_STAFF_ORIGIN: 'https://staff.x2f.test' })).not.toHaveProperty('webRoot');
  });
});

describe('fileUnderRoot', () => {
  const root = '/srv/staff-web';
  it('maps a plain path to a file under the root', () => {
    expect(fileUnderRoot(root, '/assets/app.js')).toBe(join('assets', 'app.js'));
    expect(fileUnderRoot(root, '//assets//app.js')).toBe(join('assets', 'app.js'));
  });
  it('refuses anything that is not a file strictly inside the root', () => {
    expect(fileUnderRoot(root, '/')).toBeNull();
    expect(fileUnderRoot(root, '/assets/../../etc/passwd')).toBeNull();
    expect(fileUnderRoot(root, '/assets/%2e%2e/x')).toBeNull();
    expect(fileUnderRoot(root, '/assets/./x')).toBeNull();
    expect(fileUnderRoot(root, '/assets/%E0%A4%A')).toBeNull();
    expect(fileUnderRoot(root, '/assets/a%00.js')).toBeNull();
    expect(fileUnderRoot(root, '/assets/..%5Cx')).toBeNull();
    expect(fileUnderRoot(root, '/assets/%2Eenv.js')).toBeNull();
    expect(fileUnderRoot(root, '/.vite/manifest.json')).toBeNull();
  });
});
