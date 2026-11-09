import { createHmac, timingSafeEqual } from 'node:crypto';
import { chmod, chown, lstat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
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
 * (`MOD_INTERNAL_SOCKET`, mode 0660, group `MOD_INTERNAL_SOCKET_GID`, in a directory this process
 * owns); there is no TCP listener.
 *
 * - NEEDS_P4_CHAT_MEMBERSHIP: there is NO chat read (the plan's `POST /internal/chat/read`, which
 *   opened the chat here and handed plaintext to the API). The moderator's read waits for the
 *   per-trade key-membership design (owner p11-2; design-chat-membership-keys-2026-11-08, build task 9:
 *   `/internal/chat/grant` replaces it, no plaintext to the API), and the
 *   API reader role cannot read envelopes until then (migration 208).
 * - NEEDS_P4_CHAT_MEMBERSHIP: there is NO proof read either (review 8 Nov I-1: the plan's
 *   `POST /internal/proof/read` sent the unblurred image to the API). The design (2.4 step 5)
 *   re-wraps the proof key to the staff device key; Plan 5 must not add a proof source here.
 * - NEEDS_P4_MOD_COUNTERSIGN: `POST /internal/chat/send {code, logEntryId, text}` → `{ envelope }`,
 *   sealed by the chat's moderator identity to buyer, seller and the moderator; the API stores it.
 *   It seals whatever text the API names, so a compromised API could write as the moderator
 *   (review 8 Nov I-2). Lead: it is registered only when `devModChat` is on (X2F_DEV_MOD_CHAT=1,
 *   refused with NODE_ENV=production) until build task 9 makes it a countersign (text signed by a
 *   certified staff device key that this process's own records show on the case).
 *
 * Every request carries `X-X2F-Internal` (hex HMAC-SHA-256 under MOD_INTERNAL_SECRET of
 * `modInternalMacInput`) and `X-X2F-Internal-Ts` within 30 s of this process's clock; else 401.
 * Then each call is refused (403 `log-entry-invalid`) unless the API activity-log entry it names,
 * read from the API's database (never taken from the request), has this path's action
 * (`chat.message-requested`) and this trade, was written within the last 60 s, has never been used,
 * and the trade's current dispute exists and is not closed. The entry is marked used only once all
 * of that holds, so a message is sealed only for an act the log already holds.
 */
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
   * NEEDS_P4_MOD_COUNTERSIGN: registers `/internal/chat/send` (dev only, X2F_DEV_MOD_CHAT=1;
   * `internalFromEnv` refuses it with NODE_ENV=production). Off or omitted: every path is 404.
   */
  devModChat?: boolean;
}

/** How old the named log entry may be. */
export const LOG_ENTRY_MAX_AGE_MS = 60_000;
const BODY_MAX = 64 * 1024;
const LOG_ID = /^[1-9][0-9]{0,18}$/;
const TS = /^[0-9]{1,16}$/;
const MAC = /^[0-9a-f]{64}$/;

const ROUTES = {
  // The API commits `chat.message-requested` before asking, and `chat.message-sent {envelopeId}`
  // once it stored the envelope (review 8 Nov M-2); only the first authorises a seal.
  '/internal/chat/send': { action: 'chat.message-requested', keys: ['code', 'logEntryId', 'text'] },
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

function parse(path: RoutePath, body: string): { code: string; logEntryId: string; text: string } {
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
  if (req.method !== 'POST' || !Object.hasOwn(ROUTES, path) || d.devModChat !== true) {
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
  const c = await attestedChat(d, b.code);
  // A seq is taken before sealing and never reused (a message the API failed to store is a gap).
  const { rows } = await d.db.query<{ seq: string }>(
    `insert into mod_chat_seq (chat, next_seq) values ($1, 1)
     on conflict (chat) do update set next_seq = mod_chat_seq.next_seq + 1 returning (next_seq - 1)::text as seq`,
    [c.chat],
  );
  try {
    const envelope = await sealModMessage({ channel: c.channel, seq: Number(rows[0]!.seq), mod: c.mod, participants: c.participants, text: b.text });
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

/** Where the socket lives and which group may connect (review 8 Nov I-3). */
export interface InternalSocket {
  /** MOD_INTERNAL_SOCKET: an absolute path in a directory this process's user owns (e.g. /run/x2f-mod, 0750). */
  path: string;
  /** MOD_INTERNAL_SOCKET_GID: the dedicated group whose only other member is the API's user (never 0). */
  gid: number;
}

/**
 * Listens on `socket.path` only (a stale socket file from an earlier run is removed first; any other
 * file there is refused). Review 8 Nov I-3: the API runs as its OWN user (the same uid could read
 * this process's `/proc/<pid>/environ`, keystore key and signing secret included), so the socket is
 * created under umask 0177, given the dedicated group `socket.gid` and set to 0660: only this user
 * and that group's members (the API's user alone) can connect. Its directory must be owned by this
 * user and closed to others, with no group write (0750 or 0700), so nobody else can swap the socket.
 */
export async function startInternalServer(socket: InternalSocket, d: InternalDeps): Promise<{ address: string; close(): Promise<void> }> {
  if (!(d.secret instanceof Uint8Array) || d.secret.length !== 32) throw new TypeError('moderation: MOD_INTERNAL_SECRET must be 32 bytes');
  if (!Number.isSafeInteger(socket.gid) || socket.gid <= 0) throw new TypeError('moderation: MOD_INTERNAL_SOCKET_GID must be a dedicated group id (not 0)');
  const socketPath = socket.path;
  const dir = await lstat(dirname(socketPath));
  if (!dir.isDirectory() || dir.uid !== process.getuid!() || (dir.mode & 0o027) !== 0) {
    throw new Error('moderation: MOD_INTERNAL_SOCKET must be in a directory owned by this user, mode 0750 or 0700');
  }
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
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  try {
    // The group first, then the group bits: the socket is never open to a group other than this one.
    await chown(socketPath, -1, socket.gid);
    await chmod(socketPath, 0o660);
  } catch (e) {
    await close();
    throw e;
  }
  return { address: socketPath, close };
}
