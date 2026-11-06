// Plan 4 Task 16: the staff API serves the built staff app on the staff origin (X2F_STAFF_WEB_ROOT),
// with the staff CSP on every page, and never the app page for an API path.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_CSP } from '../../src/staff/app.js';
import { staffListenFromEnv } from '../../src/staff/main.js';
import { staffApps } from '../helpers/staffApp.js';

let app: FastifyInstance;
let close: () => Promise<void>;
const root = mkdtempSync(join(tmpdir(), 'x2f-staff-web-'));

beforeAll(async () => {
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>X2F Staff</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app-1a2b.js'), 'console.log(1)');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  ({ app, close } = await staffApps({}, { webRoot: root }));
});
afterAll(async () => {
  await close();
  rmSync(root, { recursive: true, force: true });
});

describe('the staff web app on the staff origin', () => {
  it('serves index.html for app paths, with the staff CSP (no wasm, no relay or node proxy)', async () => {
    for (const url of ['/', '/login', '/invite/abc_DEF-123', '/setup', '/overview/news']) {
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
