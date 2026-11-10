/**
 * Static separation check (Plan 3 Task 8, P3-C1). X2F runs the moderation service as a SEPARATE
 * process holding the moderator keystore and signing secrets; the API and the web app must never be
 * able to reach those secrets or mint trade identities, and the moderation process must never open
 * a listening socket. This check fails (exit 1) when:
 *
 * - any file in apps/api or apps/web (sources, tests, configs, package.json; not node_modules or
 *   build output) mentions MOD_KEYSTORE_KEY, MOD_SIGNING_SECRET, @x2f/moderation or
 *   generateIdentity (except `apps/web/src/escrow/worker.ts`, the one place a trader's own trade
 *   identity is made on the trader's device; lead answer 2026-10-24, guarded by
 *   apps/web/test/identity-separation.test.ts);
 * - any file in apps/moderation imports fastify (or @fastify/*), a Node server module (http,
 *   https, http2, net, with or without `node:`), calls createServer, or imports @x2f/api or
 *   @x2f/relay (both load fastify); or its package.json depends on any of them.
 *
 * Plan 4 Task 11 (the moderation internal API) makes two exceptions, and no other: the one file
 * `apps/moderation/src/internal/server.ts` may import `node:http` and call createServer, because it
 * listens on a Unix socket (`MOD_INTERNAL_SOCKET`, mode 0600) and nothing else: it may not name a
 * TCP `port` or `host`, nor call `listen` with a number; and the moderation tests (`apps/moderation/
 * test/`) may import `node:http` to talk to that socket (they still may not create a server).
 *
 * `npm run separation-check` runs it over the repo; `npm run check` runs that.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export interface Violation {
  file: string;
  rule: string;
  line: number;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.vite', 'coverage']);
const SCANNED = /\.(?:[cm]?[jt]sx?|json|html)$/;

const FORBIDDEN_IN_API_AND_WEB: Array<[string, RegExp]> = [
  ['MOD_KEYSTORE_KEY', /\bMOD_KEYSTORE_KEY\b/],
  ['MOD_SIGNING_SECRET', /\bMOD_SIGNING_SECRET\b/],
  ['@x2f/moderation', /@x2f\/moderation\b/],
  ['generateIdentity', /\bgenerateIdentity\b/],
];

/** Plan 4 Task 11: the moderation process's one listener, on a Unix socket only. */
const MOD_INTERNAL_SERVER = 'apps/moderation/src/internal/server.ts';
/** A TCP listen in that file: `listen(<number>`, or a `port` / `host` option. */
const TCP_LISTEN = /\blisten\s*\(\s*\d|\bport\s*:|\bhost\s*:/;

/** The one apps/web file allowed to name generateIdentity: the trader's escrow worker. */
const IDENTITY_MAKER = 'apps/web/src/escrow/worker.ts';

/** A module specifier the moderation process may not load. */
const SERVER_MODULE = /^(?:fastify(?:\/.*)?|@fastify\/.+|(?:node:)?(?:http|https|http2|net)|@x2f\/(?:api|relay)(?:\/.*)?)$/;
/** `from '<m>'`, `import '<m>'`, `import('<m>')`, `require('<m>')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

async function* files(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* files(p);
    } else if (e.isFile() && SCANNED.test(e.name)) {
      yield p;
    }
  }
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export async function scanSeparation(root: string): Promise<Violation[]> {
  const out: Violation[] = [];
  for (const app of ['apps/api', 'apps/web']) {
    for await (const f of files(join(root, app))) {
      const text = await readFile(f, 'utf8');
      const rel = relative(root, f).split('\\').join('/');
      for (const [rule, re] of FORBIDDEN_IN_API_AND_WEB) {
        if (rule === 'generateIdentity' && rel === IDENTITY_MAKER) continue;
        const m = re.exec(text);
        if (m) out.push({ file: relative(root, f), rule: `${app} must not reference ${rule}`, line: lineOf(text, m.index) });
      }
    }
  }
  for await (const f of files(join(root, 'apps/moderation'))) {
    const text = await readFile(f, 'utf8');
    const rel = relative(root, f).split('\\').join('/');
    const server = rel === MOD_INTERNAL_SERVER;
    const test = rel.startsWith('apps/moderation/test/');
    if (f.endsWith('package.json')) {
      let pkg: Record<string, unknown> = {};
      try {
        pkg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        out.push({ file: relative(root, f), rule: 'unreadable package.json', line: 1 });
        continue;
      }
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = pkg[field];
        if (typeof deps !== 'object' || deps === null) continue;
        for (const name of Object.keys(deps)) {
          if (SERVER_MODULE.test(name)) out.push({ file: relative(root, f), rule: `apps/moderation must not depend on ${name}`, line: lineOf(text, text.indexOf(`"${name}"`)) });
        }
      }
      continue;
    }
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[2] ?? '';
      // The Unix-socket server may load node:http; a test may load it as a client.
      if ((server || test) && /^(?:node:)?http$/.test(spec)) continue;
      if (SERVER_MODULE.test(spec)) out.push({ file: relative(root, f), rule: `apps/moderation must not import ${spec}`, line: lineOf(text, m.index ?? 0) });
    }
    if (server) {
      const tcp = TCP_LISTEN.exec(text);
      if (tcp) out.push({ file: relative(root, f), rule: 'apps/moderation may listen on a Unix socket only', line: lineOf(text, tcp.index) });
      continue;
    }
    const cs = /\bcreateServer\s*\(/.exec(text);
    if (cs) out.push({ file: relative(root, f), rule: 'apps/moderation must not create a server', line: lineOf(text, cs.index) });
  }
  return out;
}

async function main(script: string): Promise<void> {
  const root = resolve(dirname(script), '..');
  const found = await scanSeparation(root);
  if (found.length > 0) {
    for (const v of found) process.stderr.write(`separation-check: ${v.file}:${v.line}: ${v.rule}\n`);
    process.exit(1);
  }
  process.stdout.write('separation-check: ok\n');
}

// Run as a script (`npm run separation-check`). Written without top-level await or import.meta,
// because tsx loads tools/*.ts as CommonJS (the root package is not "type": "module").
const script = process.argv[1];
if (script !== undefined && /separation-check\.[cm]?[jt]s$/.test(script)) {
  main(script).catch(() => {
    process.stderr.write('separation-check: failed to run\n');
    process.exit(1);
  });
}
