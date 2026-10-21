import { spawn } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const WEB = 'https://x2f.example';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

/** A stand-in node whose get_info reports `restricted` as given (or answers `status`). */
async function fakeNode(o: { restricted?: unknown; status?: number }): Promise<string> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(o.status ?? 200, { 'content-type': 'application/json' });
      const body = Buffer.concat(chunks).toString();
      const isInfo = req.url === '/json_rpc' && body.includes('"get_info"');
      const result = isInfo ? { status: 'OK', height: 1, ...('restricted' in o ? { restricted: o.restricted } : {}) } : { status: 'OK' };
      res.end(JSON.stringify({ id: '0', jsonrpc: '2.0', result }));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      srv.close(() => resolve(typeof a === 'object' && a ? a.port : 0));
    });
  });
}

interface Run {
  listened: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs main.ts as its own process and captures what it really writes to fd 1 and fd 2. */
async function runMain(upstream: string, during: (port: number) => Promise<void> = async () => undefined): Promise<Run> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', MAIN], {
    cwd: APP_DIR,
    env: { PATH: process.env.PATH ?? '', NODE_PROXY_UPSTREAM: upstream, NODE_PROXY_WEB_ORIGIN: WEB, NODE_PROXY_PORT: String(port), NODE_PROXY_TIMEOUT_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
  const exit = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  let exited = false;
  void exit.then(() => (exited = true));
  while (!exited && !stdout.includes('listening')) await new Promise((r) => setTimeout(r, 20));
  const listened = stdout.includes('listening');
  if (listened) {
    try {
      await during(port);
    } finally {
      child.kill('SIGTERM');
    }
  }
  const code = await exit;
  return { listened, code, stdout, stderr };
}

function post(port: number, path: string, body: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('node proxy main', () => {
  it('writes only its listening line to stdout and nothing to stderr, whatever callers send', async () => {
    const node = await fakeNode({ restricted: true });
    const statuses: number[] = [];
    const run = await runMain(node, async (port) => {
      const h = { 'x-forwarded-for': '203.0.113.9', origin: WEB };
      statuses.push(await post(port, '/json_rpc', '{"jsonrpc":"2.0","id":"0","method":"get_info"}', h));
      statuses.push(await post(port, '/json_rpc', '{"jsonrpc":"2.0","id":"0","method":"stop_daemon"}', h));
      statuses.push(await post(port, '/nope', '{}', h));
      statuses.push(await post(port, '/json_rpc', '{bad', h));
      statuses.push(await post(port, '/get_height', '{}', { origin: 'https://evil.example' }));
    });
    expect(statuses).toEqual([200, 403, 404, 400, 403]);
    expect(run.listened).toBe(true);
    expect(run.stdout).toBe('{"reason":"listening"}\n');
    expect(run.stderr).toBe('');
  }, 30_000);
});
