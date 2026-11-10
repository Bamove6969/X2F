import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { scanSeparation } from '../separation-check.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const temps: string[] = [];

/** A throwaway tree shaped like the repo, with the given files. */
async function tree(filesByPath: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'x2f-sep-'));
  temps.push(root);
  for (const [p, text] of Object.entries(filesByPath)) {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), text);
  }
  return root;
}

afterEach(async () => {
  for (const t of temps.splice(0)) await rm(t, { recursive: true, force: true });
});

describe('separation-check', () => {
  it('passes on the real repository', async () => {
    expect(await scanSeparation(REPO)).toEqual([]);
    // Walks the whole repository: slow when the machine is under load.
  }, 60_000);

  it('flags a planted process.env.MOD_KEYSTORE_KEY in apps/api', async () => {
    const root = await tree({ 'apps/api/src/evil.ts': 'export const k = process.env.MOD_KEYSTORE_KEY;\n' });
    expect(await scanSeparation(root)).toEqual([
      { file: 'apps/api/src/evil.ts', rule: 'apps/api must not reference MOD_KEYSTORE_KEY', line: 1 },
    ]);
  });

  it('flags MOD_SIGNING_SECRET, @x2f/moderation and generateIdentity in apps/api and apps/web', async () => {
    const root = await tree({
      'apps/api/src/a.ts': "\nconst s = process.env['MOD_SIGNING_SECRET'];\n",
      'apps/web/src/b.tsx': "import { startModeration } from '@x2f/moderation';\n",
      'apps/web/src/c.ts': "import { generateIdentity } from '@x2f/protocol';\n",
      'apps/api/package.json': '{ "dependencies": { "@x2f/moderation": "0.0.0" } }',
      'apps/api/test/d.test.ts': 'await generateIdentity();\n',
    });
    const rules = (await scanSeparation(root)).map((v) => `${v.file}: ${v.rule}`).sort();
    expect(rules).toEqual([
      'apps/api/package.json: apps/api must not reference @x2f/moderation',
      'apps/api/src/a.ts: apps/api must not reference MOD_SIGNING_SECRET',
      'apps/api/test/d.test.ts: apps/api must not reference generateIdentity',
      'apps/web/src/b.tsx: apps/web must not reference @x2f/moderation',
      'apps/web/src/c.ts: apps/web must not reference generateIdentity',
    ]);
  });

  it('lets only the escrow worker in apps/web name generateIdentity (lead answer 2026-10-24)', async () => {
    const root = await tree({
      'apps/web/src/escrow/worker.ts': "import { generateIdentity } from '@x2f/protocol';\n",
      'apps/web/src/escrow/other.ts': "import { generateIdentity } from '@x2f/protocol';\n",
      'apps/api/src/escrow/worker.ts': "import { generateIdentity } from '@x2f/protocol';\n",
    });
    const rules = (await scanSeparation(root)).map((v) => `${v.file}: ${v.rule}`).sort();
    expect(rules).toEqual([
      'apps/api/src/escrow/worker.ts: apps/api must not reference generateIdentity',
      'apps/web/src/escrow/other.ts: apps/web must not reference generateIdentity',
    ]);
  });

  it('flags fastify, Node server modules, createServer and @x2f/api in apps/moderation', async () => {
    const root = await tree({
      'apps/moderation/src/a.ts': "import Fastify from 'fastify';\n",
      'apps/moderation/src/b.ts': "import { createServer } from 'node:http';\ncreateServer(() => {});\n",
      'apps/moderation/src/c.ts': "const net = await import('net');\n",
      'apps/moderation/src/d.ts': "import { buildApi } from '@x2f/api';\n",
      'apps/moderation/package.json': '{ "dependencies": { "fastify": "5.12.5" } }',
      // A comment that mentions fastify is not an import.
      'apps/moderation/src/ok.ts': '// depends on neither fastify nor node:http\nexport {};\n',
    });
    const rules = (await scanSeparation(root)).map((v) => `${v.file}: ${v.rule}`).sort();
    expect(rules).toEqual([
      'apps/moderation/package.json: apps/moderation must not depend on fastify',
      'apps/moderation/src/a.ts: apps/moderation must not import fastify',
      'apps/moderation/src/b.ts: apps/moderation must not create a server',
      'apps/moderation/src/b.ts: apps/moderation must not import node:http',
      'apps/moderation/src/c.ts: apps/moderation must not import net',
      'apps/moderation/src/d.ts: apps/moderation must not import @x2f/api',
    ]);
  });

  it('flags any import of the demo stack from apps/* or packages/* (docs/demo.md)', async () => {
    const root = await tree({
      'apps/api/src/a.ts': "import { assertDemo } from '../../../tools/demo/guard.js';\n",
      'apps/web/src/b.ts': "\nconst m = await import('@x2f/demo/moderator.js');\n",
      'packages/escrow/src/c.ts': "import '@x2f/demo';\n",
      'packages/trade/package.json': '{\n  "dependencies": { "@x2f/demo": "0.0.0" }\n}\n',
      'apps/relay/src/ok.ts': "import { x } from './tools/demolition.js';\nconst s = 'tools/demo is only named in a string';\n",
    });
    const found = (await scanSeparation(root)).sort((a, b) => a.file.localeCompare(b.file));
    expect(found).toEqual([
      { file: 'apps/api/src/a.ts', rule: 'apps/* must not import the demo stack (../../../tools/demo/guard.js)', line: 1 },
      { file: 'apps/web/src/b.ts', rule: 'apps/* must not import the demo stack (@x2f/demo/moderator.js)', line: 2 },
      { file: 'packages/escrow/src/c.ts', rule: 'packages/* must not import the demo stack (@x2f/demo)', line: 1 },
      { file: 'packages/trade/package.json', rule: 'packages/* must not depend on @x2f/demo', line: 2 },
    ]);
  });

  it('Plan 4 Task 11: only internal/server.ts may serve, on a Unix socket; tests may use node:http as a client', async () => {
    const root = await tree({
      'apps/moderation/src/internal/server.ts': "import { createServer } from 'node:http';\nconst s = createServer(() => {});\ns.listen(socketPath);\n",
      'apps/moderation/test/client.test.ts': "import { request } from 'node:http';\n",
      'apps/moderation/test/serve.test.ts': "import { createServer } from 'node:http';\ncreateServer(() => {});\n",
      'apps/moderation/src/internal/other.ts': "import { createServer } from 'node:http';\n",
    });
    const rules = (await scanSeparation(root)).map((v) => `${v.file}: ${v.rule}`).sort();
    expect(rules).toEqual([
      'apps/moderation/src/internal/other.ts: apps/moderation must not import node:http',
      'apps/moderation/test/serve.test.ts: apps/moderation must not create a server',
    ]);
    for (const tcp of ['s.listen(8080);', 's.listen({ port: 8080 });', "s.listen({ host: '0.0.0.0', path: p });"]) {
      const bad = await tree({ 'apps/moderation/src/internal/server.ts': `import { createServer } from 'node:http';\nconst s = createServer(() => {});\n${tcp}\n` });
      expect((await scanSeparation(bad)).map((v) => v.rule), tcp).toEqual(['apps/moderation may listen on a Unix socket only']);
    }
    // Any other server module stays refused there too.
    const net = await tree({ 'apps/moderation/src/internal/server.ts': "import net from 'node:net';\n" });
    expect((await scanSeparation(net)).map((v) => v.rule)).toEqual(['apps/moderation must not import node:net']);
  });
});
