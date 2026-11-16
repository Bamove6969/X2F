import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGateway, injectNotesTag, NOTES_TAG } from '../demo/gateway-core.js';
import {
  appendReply,
  createNotesHandler,
  gatewayNotesEnv,
  loadSeed,
  notesFiles,
  notesStartupLine,
  parseNote,
  ReplyError,
  type GitRun,
  type NotesFiles,
  type NotesSeed,
} from '../demo/notes-server.js';

const PAGE = '<!doctype html><html><head><title>X</title></head><body></body></html>';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'";

let dir: string;
let files: NotesFiles;
/** The earlier notes the handler numbers after; none (no git) unless a test says otherwise. */
let seed: NotesSeed;
let servers: Server[];
let apiHits: { method: string; url: string; headers: http.IncomingHttpHeaders }[];
let apiAnswer: (req: IncomingMessage, res: ServerResponse) => void;
let upgrades: string[];
let base: string;
let host: string;
let nodeBase: string;

function listen(s: Server): Promise<number> {
  servers.push(s);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
}

let passwordSteps: string[];

async function start(rateMax = 1000): Promise<void> {
  const api = http.createServer((req, res) => {
    apiHits.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
    apiAnswer(req, res);
  });
  api.on('upgrade', (req, socket) => {
    upgrades.push(req.url ?? '');
    socket.destroy();
  });
  const apiPort = await listen(api);
  const placeholder = http.createServer();
  const webPort = await listen(placeholder);
  await new Promise((r) => placeholder.close(r));
  host = `127.0.0.1:${webPort}`;
  base = `http://${host}`;
  const origins = new Set([base, 'https://demo.example']);
  const demo = createNotesHandler({ files, origins, clientJs: Buffer.from('// notes'), rateMax, seed });
  const passwordStep = async (id: string): Promise<void> => {
    await new Promise((r) => setTimeout(r, 20));
    passwordSteps.push(id);
  };
  const gw = createGateway({ api: apiPort, relay: apiPort, node: apiPort, primary: base, origins, demo, passwordStep });
  const web = http.createServer(gw.handle(gw.web));
  web.on('upgrade', gw.upgrade(gw.web));
  servers.push(web);
  await new Promise<void>((r) => web.listen(webPort, '127.0.0.1', () => r()));
  const nodeSrv = http.createServer(gw.handle(gw.node));
  nodeBase = `http://127.0.0.1:${await listen(nodeSrv)}`;
}

const NOTE = {
  pathname: '/trade/AB12',
  hash: '#chat',
  dataScreen: 'trade',
  viewport: { width: 390, height: 844 },
  x: 100,
  y: 200,
  xPercent: 25.64,
  yPercent: 23.7,
  element: { css: 'main > button', text: 'Pay now', offsetXPercent: 50, offsetYPercent: 50 },
  screenName: 'demo_ana',
  text: 'This button is confusing',
};

const post = (body: unknown, headers: Record<string, string> = {}, path = '/__demo/notes') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const lines = async (f: string) => (await readFile(f, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'x2f-notes-'));
  files = notesFiles({ DEMO_NOTES_FILE: join(dir, 'sub', 'demo-notes.jsonl') });
  seed = loadSeed({
    git: () => {
      throw new Error('no git in these tests');
    },
  });
  servers = [];
  passwordSteps = [];
  apiHits = [];
  upgrades = [];
  apiAnswer = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(PAGE), etag: 'W/"abc"', 'last-modified': 'Mon, 09 Nov 2026 00:17:18 GMT', 'accept-ranges': 'bytes', 'content-security-policy': CSP });
    res.end(PAGE);
  };
});

afterEach(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
  await rm(dir, { recursive: true, force: true });
});

describe('the script tag', () => {
  it('goes before </head> with the right content-length, keeps the CSP and drops the validators', async () => {
    await start();
    const r = await fetch(`${base}/sell`, { headers: { accept: 'text/html' } });
    const text = await r.text();
    const expected = PAGE.replace('</head>', `${NOTES_TAG}</head>`);
    expect(text).toBe(expected);
    expect(r.headers.get('content-length')).toBe(String(Buffer.byteLength(expected)));
    expect(r.headers.get('content-security-policy')).toBe(CSP);
    expect(r.headers.get('etag')).toBeNull();
    expect(r.headers.get('last-modified')).toBeNull();
    expect(r.headers.get('accept-ranges')).toBeNull();
  });

  it('asks the API for the whole, uncompressed page even from a browser with a cached copy', async () => {
    await start();
    await fetch(`${base}/`, { headers: { accept: 'text/html', 'if-none-match': 'W/"abc"', 'if-modified-since': 'x', range: 'bytes=0-1', 'accept-encoding': 'gzip, br' } });
    const h = apiHits[0]!.headers;
    expect(h['if-none-match']).toBeUndefined();
    expect(h['if-modified-since']).toBeUndefined();
    expect(h.range).toBeUndefined();
    expect(h['accept-encoding']).toBe('identity');
  });

  it('decompresses a gzip page, and sends it unencoded with the new length', async () => {
    const gz = gzipSync(PAGE);
    apiAnswer = (_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': gz.length });
      res.end(gz);
    };
    await start();
    const r = await new Promise<IncomingMessage>((resolve) => http.get(`${base}/`, { headers: { accept: 'text/html' } }, resolve));
    const chunks: Buffer[] = [];
    for await (const c of r) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(Number(r.headers['content-length'])).toBe(body.length);
    expect(body.toString()).toContain(NOTES_TAG);
  });

  it('leaves everything that is not HTML, bytes and headers, alone', async () => {
    apiAnswer = (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json', etag: '"v"' });
      res.end('{"head":"</head>"}');
    };
    await start();
    const r = await fetch(`${base}/v1/site`, { headers: { 'if-none-match': '"v"' } });
    expect(await r.text()).toBe('{"head":"</head>"}');
    expect(r.headers.get('etag')).toBe('"v"');
    expect(apiHits[0]!.headers['if-none-match']).toBe('"v"');
  });

  it('does not touch HTML with no </head>, and never adds the tag twice', () => {
    expect(injectNotesTag(Buffer.from('<p>hi</p>'))).toBeNull();
    expect(injectNotesTag(injectNotesTag(Buffer.from(PAGE))!)).toBeNull();
  });

  it('answers HEAD with no stale length', async () => {
    await start();
    const r = await fetch(`${base}/`, { method: 'HEAD', headers: { accept: 'text/html' } });
    expect(r.headers.get('content-length')).toBeNull();
    expect(r.headers.get('etag')).toBeNull();
  });
});

describe('/__demo/* stays in the gateway', () => {
  it('never reaches the API, whatever the path or method', async () => {
    await start();
    for (const [method, path] of [['GET', '/__demo/notes.js'], ['GET', '/__demo/notes?path=/x'], ['GET', '/__demo/other'], ['GET', '/__demo'], ['GET', '/__demo/../v1/site'], ['PUT', '/__demo/notes'], ['POST', '/__demo/replies'], ['DELETE', '/__demo/notes']] as const) {
      await new Promise<void>((resolve, reject) => {
        // By host and path: a URL string would have Node collapse the "..".
        const [hostname, port] = host.split(':') as [string, string];
        const q = http.request({ hostname, port, path, method, headers: { origin: base } }, (r) => {
          r.resume();
          r.on('end', resolve);
        });
        q.on('error', reject);
        q.end();
      });
    }
    await post(NOTE);
    expect(apiHits).toEqual([]);
  });

  it('serves the script as JavaScript', async () => {
    await start();
    const r = await fetch(`${base}/__demo/notes.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/javascript');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await r.text()).toBe('// notes');
  });

  it('refuses a WebSocket upgrade under /__demo/', async () => {
    await start();
    await new Promise<void>((resolve, reject) => {
      const q = http.request(`${base}/__demo/notes`, { headers: { connection: 'upgrade', upgrade: 'websocket' } });
      q.on('response', (r) => {
        expect(r.statusCode).toBe(404);
        r.resume();
        resolve();
      });
      q.on('upgrade', () => reject(new Error('upgraded')));
      q.on('error', reject);
      q.end();
    });
    expect(upgrades).toEqual([]);
  });

  it('is not served on the node origin', async () => {
    await start();
    const r = await fetch(`${nodeBase}/__demo/notes.js`);
    expect(r.status).toBe(404);
    expect(apiHits).toEqual([]);
  });

  it('has no HTTP route that writes a reply', async () => {
    await start();
    expect((await post({ noteId: 'x', text: 'y' }, {}, '/__demo/replies')).status).toBe(404);
    expect((await post({ noteId: 'x', text: 'y' }, {}, '/__demo/notes/reply')).status).toBe(404);
  });
});

describe('POST /__demo/notes refusals', () => {
  beforeEach(() => start());

  it('needs an Origin that is the demo\'s and matches the Host', async () => {
    expect((await post(NOTE, { origin: 'https://evil.example' })).status).toBe(403);
    // An allowed origin, sent to another of the demo's hosts.
    expect((await post(NOTE, { origin: 'https://demo.example' })).status).toBe(403);
    const none = await new Promise<number>((resolve, reject) => {
      const q = http.request(`${base}/__demo/notes`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      q.on('error', reject);
      q.end(JSON.stringify(NOTE));
    });
    expect(none).toBe(403);
  });

  it('refuses a Host that is not the demo\'s (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const q = http.request(`${base}/__demo/notes?path=/x`, { headers: { host: 'evil.example' } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      q.on('error', reject);
      q.end();
    });
    expect(status).toBe(403);
  });

  it('is JSON only', async () => {
    expect((await post(NOTE, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(NOTE, { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await post('{not json')).status).toBe(400);
  });

  it('caps the body at 4 KB', async () => {
    const r = await post({ ...NOTE, padding: 'x'.repeat(5000) });
    expect(r.status).toBe(413);
  });

  it('takes 1 to 2000 characters of text', async () => {
    expect((await post({ ...NOTE, text: '' })).status).toBe(400);
    expect((await post({ ...NOTE, text: '   ' })).status).toBe(400);
    expect((await post({ ...NOTE, text: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post({ ...NOTE, text: 'x'.repeat(2000) })).status).toBe(201);
    expect((await post({ ...NOTE, text: 5 })).status).toBe(400);
  });
});

describe('the rate limit', () => {
  it('turns writes away past the limit', async () => {
    await start(2);
    expect((await post(NOTE)).status).toBe(201);
    expect((await post(NOTE)).status).toBe(201);
    expect((await post(NOTE)).status).toBe(429);
  });
});

describe('the JSON line', () => {
  beforeEach(() => start());

  it('has exactly the agreed shape, one line each', async () => {
    await post(NOTE);
    await post({ ...NOTE, text: 'line one\nline two' });
    const all = await lines(files.notes);
    expect(all).toHaveLength(2);
    expect(Object.keys(all[0]!).sort()).toEqual(['dataScreen', 'element', 'hash', 'id', 'number', 'pathname', 'screenName', 'text', 'time', 'viewport', 'x', 'xPercent', 'y', 'yPercent']);
    expect(all[0]).toMatchObject({ text: NOTE.text, pathname: '/trade/AB12', hash: '#chat', dataScreen: 'trade', viewport: { width: 390, height: 844 }, x: 100, y: 200, xPercent: 25.64, yPercent: 23.7, screenName: 'demo_ana', element: { css: 'main > button', text: 'Pay now' } });
    expect(all[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(all[0]!.time as string).toISOString()).toBe(all[0]!.time);
    expect(all[1]!.text).toBe('line one\nline two');
  });

  it('keeps no field it was not told to keep, and hides tokens in the tapped text', () => {
    const p = parseNote({ ...NOTE, password: 'hunter2', cookie: 'a=b', value: 'seed', element: { ...NOTE.element, value: 'x', text: `Send to 4${'A'.repeat(94)} now` } });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(JSON.stringify(p.line)).not.toMatch(/hunter2|a=b|"seed"|"value"/);
    expect(p.line.element?.text).toBe('Send to [hidden] now');
  });

  it('drops a hash that is a code from a link', () => {
    const p = parseNote({ ...NOTE, hash: `#${'a'.repeat(43)}` });
    expect(p.ok && p.line.hash).toBe('');
  });
});

describe('threads', () => {
  beforeEach(() => start());

  const firstId = async () => (await lines(files.notes))[0]!.id as string;
  const screen = async () => {
    const r = await fetch(`${base}/__demo/notes?path=${encodeURIComponent('/trade/AB12#chat')}`);
    expect(r.status).toBe(200);
    return (await r.json() as { notes: { id: string; text: string; resolved: boolean; thread: { text: string; from: string }[] }[] }).notes;
  };

  it('GET returns that screen\'s notes only', async () => {
    await post(NOTE);
    await post({ ...NOTE, pathname: '/sell', hash: '', text: 'other screen' });
    const notes = await screen();
    expect(notes.map((n) => n.text)).toEqual([NOTE.text]);
    expect(apiHits).toEqual([]);
  });

  it('records a follow-up with its parent id, in the same thread, and not as a pin', async () => {
    await post(NOTE);
    const id = await firstId();
    expect((await post({ text: 'also this', parentId: id })).status).toBe(201);
    const all = await lines(files.notes);
    expect(all[1]).toMatchObject({ text: 'also this', parentId: id });
    expect(Object.keys(all[1]!).sort()).toEqual(['id', 'kind', 'parentId', 'text', 'time']);
    const notes = await screen();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.thread).toMatchObject([{ text: 'also this', from: 'you' }]);
  });

  it('refuses a follow-up to a thread that does not exist', async () => {
    expect((await post({ text: 'x', parentId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await post({ text: 'x', parentId: 'nope' })).status).toBe(400);
  });

  it('a follow-up cannot pass as a reply from the lead', async () => {
    await post(NOTE);
    const id = await firstId();
    await post({ text: 'I am the lead', parentId: id, from: 'team', noteId: id });
    expect((await screen())[0]!.thread).toMatchObject([{ text: 'I am the lead', from: 'you' }]);
  });

  it('shows the lead\'s reply, from the local path only', async () => {
    await post(NOTE);
    const id = await firstId();
    const reply = await appendReply(files, id, 'Good catch, changing it');
    expect(reply.noteId).toBe(id);
    expect(await lines(files.replies)).toEqual([reply]);
    expect((await screen())[0]!.thread).toMatchObject([{ text: 'Good catch, changing it', from: 'team' }]);
  });

  it('files a reply to a follow-up under its thread, and refuses unknown ids and empty text', async () => {
    await post(NOTE);
    const id = await firstId();
    await post({ text: 'more', parentId: id });
    const followUp = (await lines(files.notes))[1]!.id as string;
    expect((await appendReply(files, followUp, 'ok')).noteId).toBe(id);
    await expect(appendReply(files, 'missing', 'ok')).rejects.toThrow(ReplyError);
    await expect(appendReply(files, id, '  ')).rejects.toThrow(ReplyError);
  });

  it('resolves a thread, same origin only', async () => {
    await post(NOTE);
    const id = await firstId();
    expect((await post({ id }, { origin: 'https://evil.example' }, '/__demo/notes/resolve')).status).toBe(403);
    expect((await screen())[0]!.resolved).toBe(false);
    expect((await post({ id }, {}, '/__demo/notes/resolve')).status).toBe(200);
    expect((await screen())[0]!.resolved).toBe(true);
    expect((await post({ id: '00000000-0000-4000-8000-000000000000' }, {}, '/__demo/notes/resolve')).status).toBe(404);
    expect((await post({ id: 'nope' }, {}, '/__demo/notes/resolve')).status).toBe(400);
  });

  it('survives a bad line in the file', async () => {
    await post(NOTE);
    await writeFile(files.notes, `${await readFile(files.notes, 'utf8')}not json\n`);
    expect(await screen()).toHaveLength(1);
  });
});

describe('demo gateway: the door for the seeded accounts (door.ts)', () => {
  const PENDING = '128e5942-d223-45be-aa77-055a7ffdd0d8';
  const login = () => fetch(`${base}/v1/login/password`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' });

  it('hands a second-factor pendingId to the hook before the browser gets the answer, unchanged', async () => {
    const answer = JSON.stringify({ status: 'second-factor', pendingId: PENDING, needs: ['totp'] });
    apiAnswer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'set-cookie': 'a=b' });
      res.end(gzipSync(answer));
    };
    await start();
    const r = await login();
    expect(passwordSteps).toEqual([PENDING]);
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toBe('a=b');
    expect(await r.text()).toBe(answer);
  });

  it('calls nothing for any other answer or route', async () => {
    apiAnswer = (req, res) => {
      res.writeHead(req.url === '/v1/login/password' ? 403 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'second-factor', pendingId: PENDING }));
    };
    await start();
    expect((await login()).status).toBe(403);
    await fetch(`${base}/v1/login/second-factor`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' });
    apiAnswer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    };
    expect(await (await login()).json()).toEqual({ status: 'ok' });
    expect(passwordSteps).toEqual([]);
  });
});


describe('one running comment number, continued from the earlier notes (Job 14)', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  /** A note line the way the 12 and 13 Nov files on comms hold them (no number, no kind). */
  const oldNote = (n: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ id: uuid(n), time: `2026-11-12T09:${String(n % 60).padStart(2, '0')}:00.000Z`, text: `old ${n}`, pathname: '/setup', dataScreen: 'setup', element: { css: 'main' }, ...extra });
  /** 12 Nov: 48 comments. 13 Nov: 42 comments and one follow-up. 91 lines, as the team counts them. */
  const nov12 = Array.from({ length: 48 }, (_, i) => oldNote(i + 1)).join('\n') + '\n';
  const nov13 = [...Array.from({ length: 20 }, (_, i) => oldNote(49 + i)), JSON.stringify({ id: uuid(69), time: '2026-11-13T10:00:00.000Z', text: 'also', parentId: uuid(50) }), ...Array.from({ length: 22 }, (_, i) => oldNote(70 + i))].join('\n') + '\n';
  const comms: Record<string, string> = { 'owner-demo-notes-2026-11-12.jsonl': nov12, 'owner-demo-notes-2026-11-13.jsonl': nov13 };
  /** A stand-in for `git ls-tree` / `git show` on a checkout whose comms branch holds `tree`. */
  const fakeGit = (tree: Record<string, string>, ref = 'origin/comms'): GitRun => (args) => {
    if (args[0] === 'ls-tree' && args.at(-1) === ref) return `AGY-ORDERS.md\n${Object.keys(tree).join('\n')}\nto-agy.log\n`;
    if (args[0] === 'show' && args[1]?.startsWith(`${ref}:`)) {
      const f = tree[args[1].slice(ref.length + 1)];
      if (f !== undefined) return f;
    }
    throw new Error(`fatal: not a valid object name ${args.at(-1)}`);
  };
  const noGit: GitRun = () => {
    throw new Error('git: not found');
  };
  const number = async (r: Response) => ((await r.json()) as { number?: number }).number;
  const screen = async (path: string) =>
    ((await (await fetch(`${base}/__demo/notes?path=${encodeURIComponent(path)}`)).json()) as { notes: { id: string; number: number; text: string }[] }).notes;

  it('reads every owner-demo-notes-*.jsonl on origin/comms, read-only: 91 earlier lines, so the next comment is 92', () => {
    const s = loadSeed({ git: fakeGit(comms) });
    expect(s.ok).toBe(true);
    expect(s.max).toBe(91);
    expect(s.files).toEqual(['origin/comms:owner-demo-notes-2026-11-12.jsonl', 'origin/comms:owner-demo-notes-2026-11-13.jsonl']);
    expect(s.numbers.get(uuid(1))).toBe(1);
    expect(s.numbers.get(uuid(91))).toBe(91);
  });

  it('uses the local comms branch when there is no origin/comms, and counts a note in two files once', () => {
    const s = loadSeed({ git: fakeGit({ ...comms, 'owner-demo-notes-2026-11-16.jsonl': nov12 + nov13 }, 'comms') });
    expect(s.ok).toBe(true);
    expect(s.max).toBe(91);
  });

  it('numbers one running count across screens, and a follow-up takes no number', async () => {
    seed = loadSeed({ git: fakeGit(comms) });
    await start();
    const first = await post(NOTE);
    expect(first.status).toBe(201);
    const { id } = (await first.clone().json()) as { id: string };
    expect(await number(first)).toBe(92);
    expect(await number(await post({ text: 'follow-up', parentId: id }))).toBeUndefined();
    expect(await number(await post({ ...NOTE, pathname: '/sell', hash: '', text: 'second screen' }))).toBe(93);
    expect(await number(await post({ ...NOTE, text: 'same screen again' }))).toBe(94);
    expect((await screen('/trade/AB12#chat')).map((n) => n.number)).toEqual([92, 94]);
    expect((await screen('/sell')).map((n) => n.number)).toEqual([93]);
  });

  it('writes the number into the note at once, so it never changes later', async () => {
    seed = loadSeed({ git: fakeGit(comms) });
    await start();
    await post(NOTE);
    await post({ text: 'more', parentId: ((await lines(files.notes))[0]!.id as string) });
    const saved = await lines(files.notes);
    expect(saved[0]).toMatchObject({ number: 92, text: NOTE.text });
    expect(saved[1]).toMatchObject({ kind: 'follow-up', text: 'more' });
    expect(saved[1]!.number).toBeUndefined();
    // Restarted without comms: the saved note keeps 92 and the next one is 93.
    for (const s of servers) s.close();
    servers = [];
    seed = loadSeed({ git: noGit });
    await start();
    expect((await screen('/trade/AB12#chat')).map((n) => n.number)).toEqual([92]);
    expect(await number(await post(NOTE))).toBe(93);
  });

  it('gives comments sent at the same moment different numbers', async () => {
    seed = loadSeed({ git: fakeGit(comms) });
    await start();
    const got = await Promise.all(Array.from({ length: 6 }, (_, i) => post({ ...NOTE, text: `n${i}` }).then(number)));
    expect([...got].sort((a, b) => a! - b!)).toEqual([92, 93, 94, 95, 96, 97]);
    expect((await lines(files.notes)).map((l) => l.number).sort()).toEqual([92, 93, 94, 95, 96, 97]);
  });

  it('fails soft with no origin/comms: says so, and continues after the highest number in the local file', async () => {
    const s = loadSeed({ git: noGit });
    expect(s.ok).toBe(false);
    expect(s.max).toBe(0);
    // The owner's own file: the 91 old lines (unnumbered), then a comment this version numbered 120.
    await writeFile(join(dir, 'local.jsonl'), '');
    files = notesFiles({ DEMO_NOTES_FILE: join(dir, 'sub', 'demo-notes.jsonl') });
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(files.notes, nov12 + nov13);
    expect(await notesStartupLine(files, s)).toMatch(/^Comments: could not read the earlier notes on origin\/comms.*continue after 91 \(the highest in .*demo-notes\.jsonl\)/);
    seed = s;
    await start();
    expect(await number(await post(NOTE))).toBe(92);
    await writeFile(files.notes, `${await readFile(files.notes, 'utf8')}${JSON.stringify({ id: uuid(500), time: '2026-11-16T10:00:00.000Z', text: 'x', pathname: '/x', number: 120 })}\n`);
    expect(await number(await post(NOTE))).toBe(121);
  });

  it('numbers the same old notes the same, with or without comms, when the local file holds them too', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(files.notes, nov12 + nov13 + oldNote(92) + '\n');
    seed = loadSeed({ git: fakeGit(comms) });
    await start();
    const withComms = (await screen('/setup')).map((n) => n.number);
    for (const s of servers) s.close();
    servers = [];
    seed = loadSeed({ git: noGit });
    await start();
    expect((await screen('/setup')).map((n) => n.number)).toEqual(withComms);
    expect(withComms.at(-1)).toBe(92);
  });

  it('says where the numbers come from at start', async () => {
    const line = await notesStartupLine(files, loadSeed({ git: fakeGit(comms) }));
    expect(line).toMatch(/^Comments: new ones start at 92, after the 91 earlier notes on origin\/comms \(2 files\); saved to .*demo-notes\.jsonl$/);
  });

  describe('DEMO_NOTES_SEED', () => {
    it('reads the listed .jsonl files instead of comms, never writes to them, and skips anything else', async () => {
      const a = join(dir, 'owner-demo-notes-a.jsonl');
      const b = join(dir, 'b.jsonl');
      await writeFile(a, nov12);
      await writeFile(b, nov12 + nov13);
      await writeFile(join(dir, 'secret.txt'), oldNote(900) + '\n');
      const s = loadSeed({ seedPath: `${a},${b},${join(dir, 'secret.txt')},${join(dir, 'missing.jsonl')},${join(dir, '*.jsonl')}`, git: () => { throw new Error('git must not run when DEMO_NOTES_SEED is set'); } });
      expect(s.ok).toBe(true);
      expect(s.max).toBe(91);
      expect(s.files).toEqual([a, b]);
      expect(s.problems.join('\n')).toMatch(/secret\.txt.*not a \.jsonl/);
      expect(s.problems.join('\n')).toMatch(/missing\.jsonl/);
      expect(s.problems.join('\n')).toMatch(/\*\.jsonl/);
      seed = s;
      await start();
      expect(await number(await post(NOTE))).toBe(92);
      expect(await readFile(a, 'utf8')).toBe(nov12);
      expect(await readFile(b, 'utf8')).toBe(nov12 + nov13);
    });

    it('reads only owner-demo-notes-*.jsonl from a folder, not its subfolders', async () => {
      const d = join(dir, 'comms');
      await mkdir(join(d, 'deeper'), { recursive: true });
      await writeFile(join(d, 'owner-demo-notes-2026-11-12.jsonl'), nov12);
      await writeFile(join(d, 'demo-notes.jsonl'), nov13);
      await writeFile(join(d, 'deeper', 'owner-demo-notes-2026-11-13.jsonl'), nov13);
      const s = loadSeed({ seedPath: d, git: noGit });
      expect(s.max).toBe(48);
      expect(s.files).toEqual([join(d, 'owner-demo-notes-2026-11-12.jsonl')]);
    });

    it('gets to the gateway, which starts with a clean environment', () => {
      expect(gatewayNotesEnv({ DEMO_NOTES_FILE: '/n/demo-notes.jsonl', DEMO_NOTES_SEED: '/c/x.jsonl', HOME: '/h', SECRET: 's' })).toEqual({ DEMO_NOTES_FILE: '/n/demo-notes.jsonl', DEMO_NOTES_SEED: '/c/x.jsonl' });
      expect(gatewayNotesEnv({ HOME: '/h' })).toEqual({});
    });
  });

  describe('Download my notes', () => {
    const download = (headers: Record<string, string> = {}, path = '/__demo/notes/download') => fetch(`${base}${path}`, { headers });

    it('is one file with every comment (with its number), follow-up, reply and resolved thread', async () => {
      seed = loadSeed({ git: fakeGit(comms) });
      await start();
      await post(NOTE);
      const id = (await lines(files.notes))[0]!.id as string;
      await post({ text: 'more', parentId: id });
      await post({ ...NOTE, pathname: '/sell', hash: '', text: 'second' });
      const reply = await appendReply(files, id, 'Changing it');
      await post({ id }, {}, '/__demo/notes/resolve');
      const r = await download({ 'sec-fetch-site': 'same-origin' });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-disposition')).toBe(`attachment; filename="owner-demo-notes-${new Date().toISOString().slice(0, 10)}.jsonl"`);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('cache-control')).toBe('no-store');
      const got = (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(got.map((l) => [l.kind ?? 'comment', l.number ?? null, l.text ?? null])).toEqual([
        ['comment', 92, NOTE.text],
        ['follow-up', null, 'more'],
        ['comment', 93, 'second'],
        ['reply', null, 'Changing it'],
        ['resolved', null, null],
      ]);
      expect(got[3]).toMatchObject({ id: reply.id, noteId: id });
      expect(got[4]).toMatchObject({ noteId: id });
    });

    it('puts the number on old unnumbered comments too, so the file seeds the same numbers again', async () => {
      await mkdir(join(dir, 'sub'), { recursive: true });
      await writeFile(files.notes, nov12 + nov13);
      seed = loadSeed({ git: noGit });
      await start();
      await post(NOTE);
      const text = await (await download()).text();
      const dl = join(dir, 'owner-demo-notes-2026-11-16.jsonl');
      await writeFile(dl, text);
      const again = loadSeed({ seedPath: dl, git: noGit });
      expect(again.max).toBe(92);
      expect(again.numbers.get(uuid(91))).toBe(91);
      // The reply and resolved lines in a downloaded file are not comments.
      await appendReply(files, uuid(1), 'ok');
      await writeFile(dl, await (await download()).text());
      expect(loadSeed({ seedPath: dl, git: noGit }).max).toBe(92);
    });

    it('is an empty file before the first comment', async () => {
      await start();
      const r = await download();
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('');
    });

    it('is same-origin only, like the writes', async () => {
      await start();
      await post(NOTE);
      expect((await download({ origin: 'https://evil.example' })).status).toBe(403);
      expect((await download({ origin: 'https://demo.example' })).status).toBe(403);
      expect((await download({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
      // Another port on this machine (127.0.0.1:4401, any local page) is same-site, not same-origin.
      expect((await download({ 'sec-fetch-site': 'same-site' })).status).toBe(403);
      expect((await download({ 'sec-fetch-site': 'same-origin' })).status).toBe(200);
      expect((await download({ 'sec-fetch-site': 'none' })).status).toBe(200);
      expect((await download({ origin: base })).status).toBe(200);
      const rebind = await new Promise<number>((resolve, reject) => {
        const q = http.request(`${base}/__demo/notes/download`, { headers: { host: 'evil.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        q.on('error', reject);
        q.end();
      });
      expect(rebind).toBe(403);
      expect((await fetch(`${base}/__demo/notes/download`, { method: 'POST', headers: { origin: base } })).status).toBe(405);
      // Only the one route: GET /__demo/notes stays the screen's threads.
      expect((await download({}, '/__demo/notes?download=1')).status).toBe(400);
      expect(apiHits).toEqual([]);
    });

    it('is a button in notes.js that fetches that route, and the pins show the server number', async () => {
      const js = await readFile(new URL('../demo/notes.js', import.meta.url), 'utf8');
      expect(js).toContain("'Download my notes'");
      expect(js).toContain("API + '/download'");
      expect(js).toMatch(/var number = n\.number;/);
    });
  });
});
