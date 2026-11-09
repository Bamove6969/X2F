import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGateway, injectNotesTag, NOTES_TAG } from '../demo/gateway-core.js';
import { appendReply, createNotesHandler, notesFiles, parseNote, ReplyError, type NotesFiles } from '../demo/notes-server.js';

const PAGE = '<!doctype html><html><head><title>X</title></head><body></body></html>';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'";

let dir: string;
let files: NotesFiles;
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
  const demo = createNotesHandler({ files, origins, clientJs: Buffer.from('// notes'), rateMax });
  const gw = createGateway({ api: apiPort, relay: apiPort, node: apiPort, primary: base, origins, demo });
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
  servers = [];
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
    expect(Object.keys(all[0]!).sort()).toEqual(['dataScreen', 'element', 'hash', 'id', 'pathname', 'screenName', 'text', 'time', 'viewport', 'x', 'xPercent', 'y', 'yPercent']);
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
    expect(Object.keys(all[1]!).sort()).toEqual(['id', 'parentId', 'text', 'time']);
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
