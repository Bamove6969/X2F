import { createHmac, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { normalizeTradeCode } from '@x2f/core';
import type { Participants } from '@x2f/protocol';
import { channelFor, MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_MAX_SKEW_MS, MOD_INTERNAL_TS_HEADER, modInternalMacInput } from '@x2f/trade';
import { loadChatIdentity, type Queryable } from '../keystore.js';
import type { ApiView } from './apiView.js';
import { ChatTextError, checkModText, sealModMessage } from './chat.js';

export type { ApiView } from './apiView.js';

/**
 * The moderation process's internal API (Plan 4 Task 11). It listens ONLY on a Unix socket
 * (`MOD_INTERNAL_SOCKET`, mode 0600); there is no TCP listener. The API calls it to send the
 * moderator's message and to read the unblurred proof:
 *
 * - NEEDS_P4_CHAT_MEMBERSHIP: there is NO chat read (the plan's `POST /internal/chat/read`, which
 *   opened the chat here and handed plaintext to the API). The moderator's read waits for the
 *   per-trade key-membership design (owner p11-2; design-chat-membership-keys-2026-11-08, build task 9:
 *   `/internal/chat/grant` replaces it, no plaintext to the API), and the
 *   API reader role cannot read envelopes until then (migration 208).
 * - `POST /internal/chat/send {code, logEntryId, text}` → `{ envelope }`: sealed by the chat's
 *   moderator identity to buyer, seller and the moderator; the API stores it.
 * - `POST /internal/proof/read {code, logEntryId}` → the unblurred image bytes.
 *
 * Every request carries `X-X2F-Internal` (hex HMAC-SHA-256 under MOD_INTERNAL_SECRET of
 * `modInternalMacInput`) and `X-X2F-Internal-Ts` within 30 s of this process's clock; else 401.
 * Then each call is refused (403 `log-entry-invalid`) unless the API activity-log entry it names,
 * read from the API's database (never taken from the request), has this path's action and this
 * trade, was written within the last 60 s, has never been used, and the trade's current dispute
 * exists and is not closed. The entry is marked used only once all of that holds, so a message is
 * sealed, or the proof read, only for an act the log already holds.
 */
export interface ProofSource {
  /** The trade's unblurred proof image, or null when there is none. */
  unblurred(code: string): Promise<{ mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } | null>;
}

export interface InternalDeps {
  /** MOD_INTERNAL_SECRET: 32 bytes, shared with the API only. */
  secret: Uint8Array;
  /** The API's database, read-only (`x2f_mod_reader`). */
  api: ApiView;
  /** The moderation database (keystore, signed chats, used entries, the moderator's seq). */
  db: Queryable;
  keystoreKey: Uint8Array;
  now?: () => Date;
  /**
   * NEEDS_P5_PROOF_ENVELOPE: the unblurred proof's reader. Plan 5's proof package (`proof.unblurred`
   * sealed to the mod only) is not on this branch; without a source every proof read is `no-proof`.
   */
  proofs?: ProofSource;
}

/** How old the named log entry may be. */
export const LOG_ENTRY_MAX_AGE_MS = 60_000;
const BODY_MAX = 64 * 1024;
const LOG_ID = /^[1-9][0-9]{0,18}$/;
const TS = /^[0-9]{1,16}$/;
const MAC = /^[0-9a-f]{64}$/;

const ROUTES = {
  '/internal/chat/send': { action: 'chat.message-sent', keys: ['code', 'logEntryId', 'text'] },
  '/internal/proof/read': { action: 'proof.unblurred-opened', keys: ['code', 'logEntryId'] },
} as const;
type RoutePath = keyof typeof ROUTES;

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function answer(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_MAX) {
        reject(new Refusal(413, 'too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
}

function authentic(d: InternalDeps, req: IncomingMessage, path: string, body: string, now: Date): boolean {
  const ts = header(req, MOD_INTERNAL_TS_HEADER);
  const mac = header(req, MOD_INTERNAL_MAC_HEADER);
  if (ts === null || mac === null || !TS.test(ts) || !MAC.test(mac)) return false;
  if (Math.abs(now.getTime() - Number(ts)) > MOD_INTERNAL_MAX_SKEW_MS) return false;
  const want = createHmac('sha256', d.secret).update(modInternalMacInput({ method: req.method ?? '', path, body, ts }), 'utf8').digest();
  return timingSafeEqual(want, Buffer.from(mac, 'hex'));
}

function parse(path: RoutePath, body: string): { code: string; logEntryId: string; text?: string } {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    throw new Refusal(400, 'bad-request');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Refusal(400, 'bad-request');
  const o = v as Record<string, unknown>;
  const keys = ROUTES[path].keys as readonly string[];
  if (Object.keys(o).length !== keys.length || !keys.every((k) => Object.hasOwn(o, k))) throw new Refusal(400, 'bad-request');
  const code = typeof o.code === 'string' ? normalizeTradeCode(o.code) : null;
  if (code === null || typeof o.logEntryId !== 'string' || !LOG_ID.test(o.logEntryId)) throw new Refusal(400, 'bad-request');
  if (path !== '/internal/chat/send') return { code, logEntryId: o.logEntryId };
  try {
    return { code, logEntryId: o.logEntryId, text: checkModText(o.text) };
  } catch {
    throw new Refusal(400, 'bad-request');
  }
}

/** Checks the named log entry and the trade's dispute, then marks the entry used (once only). */
async function useEntry(d: InternalDeps, path: RoutePath, code: string, id: string, now: Date): Promise<void> {
  const invalid = new Refusal(403, 'log-entry-invalid');
  const e = await d.api.logEntry(id);
  if (e === null || e.action !== ROUTES[path].action || e.tradeCode === null || normalizeTradeCode(e.tradeCode) !== code) throw invalid;
  const age = now.getTime() - e.at.getTime();
  if (age > LOG_ENTRY_MAX_AGE_MS || age < -MOD_INTERNAL_MAX_SKEW_MS) throw invalid;
  const status = await d.api.disputeStatus(code);
  if (status === null || status === 'closed') throw invalid;
  const { rowCount } = await d.db.query(
    'insert into used_log_entries (id, action, trade) values ($1, $2, $3) on conflict (id) do nothing',
    [id, e.action, code],
  );
  if (rowCount !== 1) throw invalid;
}

/** The trade's chat as this process attested it: its channel, the moderator identity and the participants it signed. */
async function attestedChat(d: InternalDeps, code: string) {
  const chat = await d.api.chatOf(code);
  if (chat === null) throw new Refusal(404, 'no-chat');
  const { rows } = await d.db.query<{ attestation: { participants?: Participants; channels?: { chat?: string } } }>(
    'select attestation from signed_chats where chat = $1',
    [chat],
  );
  const mod = await loadChatIdentity(d.db, d.keystoreKey, chat);
  const att = rows[0]?.attestation;
  const channel = await channelFor(chat, 'chat');
  if (!att?.participants || att.channels?.chat !== channel || mod === null) throw new Refusal(404, 'no-chat');
  return { chat, channel, mod, participants: att.participants };
}

async function handle(d: InternalDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '') as RoutePath;
  if (req.method !== 'POST' || !Object.hasOwn(ROUTES, path)) {
    // Drain and refuse without reading anything else.
    req.resume();
    answer(res, 404, { error: 'not-found' });
    return;
  }
  const body = await readBody(req);
  const now = (d.now ?? (() => new Date()))();
  if (!authentic(d, req, path, body, now)) throw new Refusal(401, 'unauthorized');
  const b = parse(path, body);
  await useEntry(d, path, b.code, b.logEntryId, now);

  if (path === '/internal/proof/read') {
    const proof = d.proofs ? await d.proofs.unblurred(b.code) : null;
    if (proof === null) throw new Refusal(404, 'no-proof');
    res.writeHead(200, { 'content-type': proof.mime, 'content-length': proof.bytes.length, 'cache-control': 'no-store' });
    res.end(Buffer.from(proof.bytes));
    return;
  }
  const c = await attestedChat(d, b.code);
  // A seq is taken before sealing and never reused (a message the API failed to store is a gap).
  const { rows } = await d.db.query<{ seq: string }>(
    `insert into mod_chat_seq (chat, next_seq) values ($1, 1)
     on conflict (chat) do update set next_seq = mod_chat_seq.next_seq + 1 returning (next_seq - 1)::text as seq`,
    [c.chat],
  );
  try {
    const envelope = await sealModMessage({ channel: c.channel, seq: Number(rows[0]!.seq), mod: c.mod, participants: c.participants, text: b.text! });
    answer(res, 200, { envelope });
  } catch (e) {
    if (e instanceof ChatTextError) throw new Refusal(400, 'too-large');
    throw e;
  }
}

/** The request handler (exported for tests); errors answer with a code only, never a detail. */
export function internalHandler(d: InternalDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(d, req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof Refusal) answer(res, e.status, { error: e.code });
      else answer(res, 500, { error: 'internal' });
    });
  };
}

/**
 * Listens on `socketPath` only (a stale socket file from an earlier run is removed first; any other
 * file there is refused). The socket is created under umask 0177 and then set to 0600, so only this
 * process's user (and the API, run as the same user or given the socket by the deployment) can connect.
 */
export async function startInternalServer(socketPath: string, d: InternalDeps): Promise<{ address: string; close(): Promise<void> }> {
  if (!(d.secret instanceof Uint8Array) || d.secret.length !== 32) throw new TypeError('moderation: MOD_INTERNAL_SECRET must be 32 bytes');
  try {
    const st = await lstat(socketPath);
    if (!st.isSocket()) throw new Error('moderation: MOD_INTERNAL_SOCKET names a file that is not a socket');
    await unlink(socketPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const server: Server = createServer(internalHandler(d));
  const old = process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
  } finally {
    process.umask(old);
  }
  await chmod(socketPath, 0o600);
  return {
    address: socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
