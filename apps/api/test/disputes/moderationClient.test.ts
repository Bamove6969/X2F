// Plan 4 Task 11: the API's client of the moderation process's internal API, against a stand-in
// server on a Unix socket. The MAC format is spelled out here on purpose (apps/moderation's
// internal.test.ts spells out the same), so the two sides cannot drift apart unnoticed.
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModerationError, NO_MODERATION, socketModerationClient } from '../../src/disputes/moderationClient.js';
import { moderationFromEnv } from '../../src/staff/main.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const SECRET = new Uint8Array(randomBytes(32));
const CODE = 'K7M2-9QXA-4FTR-8WPN';

interface Seen {
  method: string;
  path: string;
  body: string;
  mac: string | undefined;
  ts: string | undefined;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function serve(answer: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ socket: string; seen: Seen[] }> {
  const socket = join(tmpdir(), `x2f-modc-${randomBytes(6).toString('hex')}.sock`);
  const seen: Seen[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? '', path: req.url ?? '', body, mac: req.headers['x-x2f-internal'] as string | undefined, ts: req.headers['x-x2f-internal-ts'] as string | undefined });
      answer(req, res, body);
    });
  });
  await new Promise<void>((r) => srv.listen(socket, () => r()));
  closers.push(() => new Promise<void>((r) => srv.close(() => r())));
  return { socket, seen };
}

const json = (res: ServerResponse, status: number, v: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(v));
};

const client = (socket: string, timeoutMs?: number) => socketModerationClient({ socketPath: socket, secret: SECRET, clock: () => NOW, ...(timeoutMs ? { timeoutMs } : {}) });

describe('socketModerationClient', () => {
  it('signs method, path, exact body and time with the shared secret', async () => {
    const { socket, seen } = await serve((_q, res) => json(res, 200, { envelope: { v: 1 } }));
    expect(await client(socket).chatSend({ code: CODE, logEntryId: '42', text: 'Hi' })).toEqual({ envelope: { v: 1 } });
    const s = seen[0]!;
    expect([s.method, s.path, s.body, s.ts]).toEqual(['POST', '/internal/chat/send', JSON.stringify({ code: CODE, logEntryId: '42', text: 'Hi' }), String(NOW.getTime())]);
    const want = createHmac('sha256', SECRET).update(`x2f/mod-internal/v1\0POST\0/internal/chat/send\0${s.body}\0${s.ts}`, 'utf8').digest('hex');
    expect(s.mac).toBe(want);
  });

  it('NEEDS_P4_CHAT_MEMBERSHIP: has no chat read (the key-membership design replaces it)', () => {
    const c = client('/tmp/x2f-unused.sock') as unknown as Record<string, unknown>;
    expect(c.chatRead).toBeUndefined();
    expect((NO_MODERATION as unknown as Record<string, unknown>).chatRead).toBeUndefined();
  });

  it('sends a message and reads a proof, with their own paths and bodies', async () => {
    const { socket, seen } = await serve((req, res) => {
      if (req.url === '/internal/chat/send') return json(res, 200, { envelope: { v: 1 } });
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([1, 2, 3]));
    });
    const c = client(socket);
    expect(await c.chatSend({ code: CODE, logEntryId: '7', text: 'Hello' })).toEqual({ envelope: { v: 1 } });
    expect(await c.proofRead({ code: CODE, logEntryId: '8' })).toEqual({ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    expect(seen.map((s) => [s.path, JSON.parse(s.body)])).toEqual([
      ['/internal/chat/send', { code: CODE, logEntryId: '7', text: 'Hello' }],
      ['/internal/proof/read', { code: CODE, logEntryId: '8' }],
    ]);
  });

  it('passes the process\'s refusal on with its status and code; anything else is moderation-unavailable', async () => {
    let answer: (res: ServerResponse) => void = (res) => json(res, 403, { error: 'log-entry-invalid' });
    const { socket } = await serve((_q, res) => answer(res));
    const c = client(socket);
    await expect(c.chatSend({ code: CODE, logEntryId: '1', text: 'Hi' })).rejects.toMatchObject({ status: 403, code: 'log-entry-invalid' });
    answer = (res) => json(res, 404, { error: 'no-proof' });
    await expect(c.proofRead({ code: CODE, logEntryId: '1' })).rejects.toMatchObject({ status: 404, code: 'no-proof' });
    // A proof that is not an image type, an answer with no envelope, a code that is not one: refused.
    answer = (res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<b>x</b>');
    };
    await expect(c.proofRead({ code: CODE, logEntryId: '1' })).rejects.toMatchObject({ status: 502, code: 'moderation-unavailable' });
    answer = (res) => json(res, 200, { messages: [] });
    await expect(c.chatSend({ code: CODE, logEntryId: '1', text: 'Hi' })).rejects.toMatchObject({ status: 502, code: 'moderation-unavailable' });
    answer = (res) => json(res, 500, { error: 'Something <b>long</b> and odd' });
    await expect(c.chatSend({ code: CODE, logEntryId: '1', text: 'Hi' })).rejects.toMatchObject({ status: 500, code: 'moderation-unavailable' });
  });

  it('a missing socket, or one that never answers, is moderation-unavailable (503)', async () => {
    const missing = client(join(tmpdir(), `x2f-none-${randomBytes(6).toString('hex')}.sock`));
    await expect(missing.proofRead({ code: CODE, logEntryId: '1' })).rejects.toMatchObject({ status: 503, code: 'moderation-unavailable' });
    const { socket } = await serve(() => undefined);
    await expect(client(socket, 200).proofRead({ code: CODE, logEntryId: '1' })).rejects.toBeInstanceOf(ModerationError);
  });

  it('needs a 32-byte secret', () => {
    expect(() => socketModerationClient({ socketPath: '/tmp/x.sock', secret: new Uint8Array(31), clock: () => NOW })).toThrow(/32 bytes/);
  });
});

describe('moderationFromEnv', () => {
  const b64 = Buffer.from(SECRET).toString('base64');
  it('is no moderation process when both are unset', async () => {
    const c = moderationFromEnv({}, () => NOW);
    expect(c).toBe(NO_MODERATION);
    await expect(c.chatSend({ code: CODE, logEntryId: '1', text: 'Hi' })).rejects.toMatchObject({ status: 503, code: 'moderation-unavailable' });
  });

  it('refuses one without the other or a malformed value, naming the variable and never the value', () => {
    for (const [env, name] of [
      [{ MOD_INTERNAL_SOCKET: '/run/x2f/mod.sock' }, 'MOD_INTERNAL_SECRET'],
      [{ MOD_INTERNAL_SECRET: b64 }, 'MOD_INTERNAL_SOCKET'],
      [{ MOD_INTERNAL_SOCKET: 'relative.sock', MOD_INTERNAL_SECRET: b64 }, 'MOD_INTERNAL_SOCKET'],
      [{ MOD_INTERNAL_SOCKET: '/run/x2f/mod.sock', MOD_INTERNAL_SECRET: 'c2hvcnQ=' }, 'MOD_INTERNAL_SECRET'],
    ] as const) {
      let msg = '';
      try {
        moderationFromEnv(env, () => NOW);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain(name);
      expect(msg).not.toContain(b64);
    }
    expect(moderationFromEnv({ MOD_INTERNAL_SOCKET: '/run/x2f/mod.sock', MOD_INTERNAL_SECRET: b64 }, () => NOW)).not.toBe(NO_MODERATION);
  });
});
