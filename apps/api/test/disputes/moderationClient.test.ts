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

/** A countersigned message as staff-web sends it (the shapes only: this client never checks them). */
const SEND = {
  code: CODE, logEntryId: '42', staffAccountId: '00000000-0000-4000-8000-0000000000aa', deviceKeyId: 'd'.repeat(32),
  seq: 0, nonce: 'bm9uY2U=', ct: 'Y3Q=', ctSha256: 'e'.repeat(64), requestId: 'f'.repeat(32), issuedAt: '2026-11-02T12:00:00.000Z', sig: 'a'.repeat(128),
};
const GRANT = { code: CODE, logEntryId: '43', staffAccountId: SEND.staffAccountId, deviceKeyId: SEND.deviceKeyId };

const client = (socket: string, timeoutMs?: number) => socketModerationClient({ socketPath: socket, secret: SECRET, clock: () => NOW, ...(timeoutMs ? { timeoutMs } : {}) });

describe('socketModerationClient', () => {
  it('signs method, path, exact body and time with the shared secret', async () => {
    const { socket, seen } = await serve((_q, res) => json(res, 200, { envelope: { v: 1 } }));
    expect(await client(socket).chatSend(SEND)).toEqual({ envelope: { v: 1 } });
    const s = seen[0]!;
    expect([s.method, s.path, s.body, s.ts]).toEqual(['POST', '/internal/chat/send', JSON.stringify(SEND), String(NOW.getTime())]);
    const want = createHmac('sha256', SECRET).update(`x2f/mod-internal/v1\0POST\0/internal/chat/send\0${s.body}\0${s.ts}`, 'utf8').digest('hex');
    expect(s.mac).toBe(want);
  });

  it('landed (was NEEDS_P4_CHAT_MEMBERSHIP): the read is a grant (a wrap and its fingerprint), never text', async () => {
    const { socket, seen } = await serve((_q, res) => json(res, 200, { wrap: 'd3JhcA==', tkh: 'b'.repeat(64), boxPublic: 'c'.repeat(64), nextSeq: 3 }));
    expect(await client(socket).chatGrant(GRANT)).toEqual({ wrap: 'd3JhcA==', tkh: 'b'.repeat(64), boxPublic: 'c'.repeat(64), nextSeq: 3 });
    expect([seen[0]!.path, seen[0]!.body]).toEqual(['/internal/chat/grant', JSON.stringify(GRANT)]);
    const { socket: bad } = await serve((_q, res) => json(res, 200, { text: 'plaintext' }));
    await expect(client(bad).chatGrant(GRANT)).rejects.toMatchObject({ status: 502, code: 'moderation-unavailable' });
    const src = await (await import('node:fs/promises')).readFile(new URL('../../src/disputes/moderationClient.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/NEEDS_P4_CHAT_MEMBERSHIP|NEEDS_P4_MOD_COUNTERSIGN|X2F_DEV_MOD_CHAT|text: a\.text/);
  });

  it('NEEDS_P5_PROOF_ENVELOPE: has no chat read and no proof read returning plaintext', async () => {
    // Review 8 Nov I-1: the unblurred proof is not relayed through the API either.
    const c = client('/tmp/x2f-unused.sock') as unknown as Record<string, unknown>;
    for (const m of ['chatRead', 'proofRead']) {
      expect(c[m], m).toBeUndefined();
      expect((NO_MODERATION as unknown as Record<string, unknown>)[m], m).toBeUndefined();
    }
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/disputes/moderationClient.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/'\/internal\/proof\/read'/);
  });

  it('passes the process\'s refusal on with its status and code; anything else is moderation-unavailable', async () => {
    let answer: (res: ServerResponse) => void = (res) => json(res, 403, { error: 'log-entry-invalid' });
    const { socket } = await serve((_q, res) => answer(res));
    const c = client(socket);
    await expect(c.chatSend(SEND)).rejects.toMatchObject({ status: 403, code: 'log-entry-invalid' });
    answer = (res) => json(res, 404, { error: 'no-chat' });
    await expect(c.chatSend(SEND)).rejects.toMatchObject({ status: 404, code: 'no-chat' });
    // A stale seq carries the next one.
    answer = (res) => json(res, 409, { error: 'stale-seq', nextSeq: 7 });
    await expect(c.chatSend(SEND)).rejects.toMatchObject({ status: 409, code: 'stale-seq', nextSeq: 7 });
    // An answer with no envelope, a code that is not one: refused.
    answer = (res) => json(res, 200, { messages: [] });
    await expect(c.chatSend(SEND)).rejects.toMatchObject({ status: 502, code: 'moderation-unavailable' });
    answer = (res) => json(res, 500, { error: 'Something <b>long</b> and odd' });
    await expect(c.chatSend(SEND)).rejects.toMatchObject({ status: 500, code: 'moderation-unavailable' });
  });

  it('a missing socket, or one that never answers, is moderation-unavailable (503)', async () => {
    const missing = client(join(tmpdir(), `x2f-none-${randomBytes(6).toString('hex')}.sock`));
    await expect(missing.chatSend(SEND)).rejects.toMatchObject({ status: 503, code: 'moderation-unavailable' });
    const { socket } = await serve(() => undefined);
    await expect(client(socket, 200).chatSend(SEND)).rejects.toBeInstanceOf(ModerationError);
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
    await expect(c.chatSend(SEND)).rejects.toMatchObject({ status: 503, code: 'moderation-unavailable' });
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
