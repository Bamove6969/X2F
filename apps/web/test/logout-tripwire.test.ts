import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * TRIPWIRE (L2, Task 19): every UI log-out path goes through `logOut(env)` (src/push/usePush.ts),
 * which unsubscribes this browser from pushes while the session can still say so, then calls
 * `POST /v1/logout`. A screen calling /v1/logout itself (directly, or through the auth client's
 * `logout()`) would leave the browser subscribed. When Task 28 or 30 adds a Log out button, it
 * must call `logOut(env)`; this test fails otherwise.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
/** The one place allowed to call /v1/logout. */
const OWNER = 'push/usePush.ts';
/**
 * Screens whose "Log out" control ends ANOTHER device's session (`authApi.endSession(id)`, Task 30's
 * Devices list). That browser's push rows go with its session (migration 105's trigger), and this
 * browser's subscription is untouched, so `logOut(env)` is not the right call there. They may still
 * never call /v1/logout or the auth client's logout() themselves.
 */
const REMOTE_SESSION_END = new Set(['screens/settings/Devices.tsx']);
const SHOWS_LOG_OUT = 'shows "Log out" without calling logOut(env)';

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && /\.(ts|tsx)$/.test(f.name))
    .map((f) => join(f.parentPath, f.name));
}

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** What makes a file a log-out path that bypasses `logOut(env)`; empty when it is fine. */
function bypasses(code: string): string[] {
  const c = strip(code);
  const out: string[] = [];
  if (/\/v1\/logout\b/.test(c)) out.push('calls /v1/logout itself');
  // The auth client's `logout()` (packages/auth-client) posts /v1/logout without the push step.
  if (/\.logout\s*\(/.test(c) || /\{\s*[^}]*\blogout\b[^}]*\}\s*=/.test(c)) out.push("calls the auth client's logout()");
  // A visible "Log out" control must be wired to logOut(env).
  if (/>\s*Log out\b|['"`]Log out\b/i.test(c) && !/\blogOut\s*\(/.test(c)) out.push('shows "Log out" without calling logOut(env)');
  return out;
}

describe('TRIPWIRE (L2): every UI log-out path calls logOut(env)', () => {
  it('the detector catches each way round it', () => {
    expect(bypasses("await api('/v1/logout', { method: 'POST' });")).not.toEqual([]);
    expect(bypasses('fetch(`/v1/logout`, { method: "POST" })')).not.toEqual([]);
    expect(bypasses('await client.logout();')).not.toEqual([]);
    expect(bypasses('const { logout } = client;')).not.toEqual([]);
    expect(bypasses('<Button onClick={() => void signOut()}>Log out</Button>')).not.toEqual([]);
    expect(bypasses('<Button onClick={() => void logOut(env)}>Log out</Button>')).toEqual([]);
    expect(bypasses('// see /v1/logout in usePush')).toEqual([]);
  });

  it(`no file under apps/web/src but ${OWNER} calls /v1/logout, and every "Log out" calls logOut(env)`, () => {
    const found: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (rel === OWNER) continue;
      for (const why of bypasses(readFileSync(file, 'utf8'))) {
        if (why === SHOWS_LOG_OUT && REMOTE_SESSION_END.has(rel)) continue;
        found.push(`${rel}: ${why}`);
      }
    }
    expect(found, 'use logOut(env) from src/push/usePush.ts for every log-out').toEqual([]);
  });

  it('each exempt screen exists, ends another session with endSession(id), and bypasses nothing else', () => {
    for (const rel of REMOTE_SESSION_END) {
      const code = strip(readFileSync(join(SRC, rel), 'utf8'));
      expect(code, rel).toMatch(/\bendSession\s*\(/);
      expect(bypasses(code), rel).toEqual([SHOWS_LOG_OUT]);
    }
  });

  it(`${OWNER}'s logOut unsubscribes before it calls /v1/logout`, () => {
    const code = strip(readFileSync(join(SRC, OWNER), 'utf8'));
    const body = code.slice(code.indexOf('export async function logOut'));
    expect(body.indexOf('disablePush(env)')).toBeGreaterThan(-1);
    expect(body.indexOf('disablePush(env)')).toBeLessThan(body.indexOf("'/v1/logout'"));
  });
});
