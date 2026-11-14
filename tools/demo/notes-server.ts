/**
 * DEMO ONLY: the comments the owner leaves on the running demo (docs/demo.md).
 *
 * Three append-only JSON-lines files, kept outside .demo so a demo restart never wipes them:
 * demo-notes.jsonl (comments and follow-ups), demo-replies.jsonl (the lead's replies, written only
 * by the local `npm run demo:reply`, never over HTTP) and demo-resolved.jsonl (resolved threads).
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { forwardedHttps, isSelfOrigin } from './self-origin.js';

export interface NotesFiles {
  notes: string;
  replies: string;
  resolved: string;
}

export interface NotesConfig {
  files: NotesFiles;
  /** Every origin the demo is opened from (DEMO_ORIGINS). */
  origins: Set<string>;
  /** The contents of notes.js. */
  clientJs: Buffer;
  /** Writes allowed per window, for all clients together (default 30 a minute). */
  rateMax?: number;
  rateWindowMs?: number;
  now?: () => number;
}

/** A top-level comment, or (with parentId) a follow-up in its thread. */
export interface NoteLine {
  id: string;
  time: string;
  text: string;
  parentId?: string;
  pathname?: string;
  hash?: string;
  dataScreen?: string | null;
  viewport?: { width: number; height: number };
  x?: number;
  y?: number;
  xPercent?: number;
  yPercent?: number;
  element?: { css: string; text: string; offsetXPercent: number; offsetYPercent: number };
  screenName?: string | null;
}

export interface ReplyLine {
  id: string;
  time: string;
  noteId: string;
  text: string;
}

export const MAX_BODY_BYTES = 4096;
export const MAX_TEXT_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT_HASH = /^#[A-Za-z0-9_-]{1,31}$/;

export function notesFiles(env: Record<string, string | undefined>): NotesFiles {
  const notes = env.DEMO_NOTES_FILE || join(homedir(), 'x2f-comms', 'demo-notes.jsonl');
  return { notes, replies: join(dirname(notes), 'demo-replies.jsonl'), resolved: join(dirname(notes), 'demo-resolved.jsonl') };
}

/** Anything that looks like an address, key or code does not belong in a description of a tap. */
export function redactText(s: string): string {
  return s.replace(/[A-Za-z0-9+/=_-]{24,}/g, '[hidden]').slice(0, 120);
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6 ? Math.round(v * 100) / 100 : null);

function validText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  const n = [...t].length;
  return n >= 1 && n <= MAX_TEXT_CHARS ? t : null;
}

type Parsed = { ok: true; line: Omit<NoteLine, 'id' | 'time'> } | { ok: false; reason: string };

/** Only the listed fields are kept, whatever else a request sends. */
export function parseNote(body: unknown): Parsed {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'bad-body' };
  const b = body as Record<string, unknown>;
  const text = validText(b.text);
  if (text === null) return { ok: false, reason: 'bad-text' };
  if (b.parentId !== undefined) {
    if (typeof b.parentId !== 'string' || !UUID.test(b.parentId)) return { ok: false, reason: 'bad-parent' };
    return { ok: true, line: { text, parentId: b.parentId } };
  }
  const pathname = str(b.pathname, 512);
  if (pathname === null || !pathname.startsWith('/')) return { ok: false, reason: 'bad-pathname' };
  const hashRaw = typeof b.hash === 'string' ? b.hash : '';
  const hash = SHORT_HASH.test(hashRaw) ? hashRaw : '';
  const vp = (b.viewport ?? {}) as Record<string, unknown>;
  const width = num(vp.width);
  const height = num(vp.height);
  const x = num(b.x);
  const y = num(b.y);
  const xPercent = num(b.xPercent);
  const yPercent = num(b.yPercent);
  if (width === null || height === null || x === null || y === null || xPercent === null || yPercent === null) return { ok: false, reason: 'bad-position' };
  const e = (b.element ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    line: {
      text,
      pathname,
      hash,
      dataScreen: str(b.dataScreen, 64),
      viewport: { width, height },
      x,
      y,
      xPercent,
      yPercent,
      element: {
        css: str(e.css, 800) ?? '',
        text: redactText(str(e.text, 400) ?? ''),
        offsetXPercent: num(e.offsetXPercent) ?? 50,
        offsetYPercent: num(e.offsetYPercent) ?? 50,
      },
      screenName: str(b.screenName, 64),
    },
  };
}

async function readLines<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: T[] = [];
  for (const l of text.split('\n')) {
    if (l.trim() === '') continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      // A line somebody edited badly must not take the whole list down.
    }
  }
  return out;
}

async function appendLine(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

const newId = (): string => randomUUID();
const stamp = (now: () => number): string => new Date(now()).toISOString();

/** The note a follow-up or reply belongs to: the note itself, or its parent. */
function rootOf(notes: NoteLine[], id: string): NoteLine | null {
  const n = notes.find((x) => x.id === id);
  if (!n) return null;
  if (n.parentId === undefined) return n;
  return notes.find((x) => x.id === n.parentId && x.parentId === undefined) ?? null;
}

export class ReplyError extends Error {}

/** The lead's reply: called by the local CLI only (reply.ts). No HTTP route reaches this. */
export async function appendReply(files: NotesFiles, noteId: string, rawText: string, now: () => number = Date.now): Promise<ReplyLine> {
  const text = validText(rawText);
  if (text === null) throw new ReplyError(`a reply must be 1 to ${MAX_TEXT_CHARS} characters`);
  const root = rootOf(await readLines<NoteLine>(files.notes), noteId);
  if (root === null) throw new ReplyError(`no comment with id ${noteId}`);
  const line: ReplyLine = { id: newId(), time: stamp(now), noteId: root.id, text };
  await appendLine(files.replies, line);
  return line;
}

export interface ThreadEntry {
  id: string;
  time: string;
  text: string;
  from: 'you' | 'team';
}

export interface ThreadView {
  id: string;
  time: string;
  text: string;
  xPercent: number;
  yPercent: number;
  css: string;
  offsetXPercent: number;
  offsetYPercent: number;
  resolved: boolean;
  thread: ThreadEntry[];
}

/** The threads of one screen (pathname + hash), oldest first. */
export async function threadsFor(files: NotesFiles, path: string): Promise<ThreadView[]> {
  const [notes, replies, resolved] = await Promise.all([
    readLines<NoteLine>(files.notes),
    readLines<ReplyLine>(files.replies),
    readLines<{ noteId: string }>(files.resolved),
  ]);
  const done = new Set(resolved.map((r) => r.noteId));
  return notes
    .filter((n) => n.parentId === undefined && `${n.pathname ?? ''}${n.hash ?? ''}` === path)
    .slice(-200)
    .map((n) => {
      const thread: ThreadEntry[] = [
        ...notes.filter((f) => f.parentId === n.id).map((f) => ({ id: f.id, time: f.time, text: f.text, from: 'you' as const })),
        ...replies.filter((r) => r.noteId === n.id).map((r) => ({ id: r.id, time: r.time, text: r.text, from: 'team' as const })),
      ].sort((a, b) => a.time.localeCompare(b.time));
      return {
        id: n.id,
        time: n.time,
        text: n.text,
        xPercent: n.xPercent ?? 50,
        yPercent: n.yPercent ?? 50,
        css: n.element?.css ?? '',
        offsetXPercent: n.element?.offsetXPercent ?? 50,
        offsetYPercent: n.element?.offsetYPercent ?? 50,
        resolved: done.has(n.id),
        thread,
      };
    });
}

function send(res: ServerResponse, status: number, value: unknown, close = false): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    ...(close ? { connection: 'close' } : {}),
  });
  res.end(JSON.stringify(value));
}

/** The body, or null if it is over the cap. */
async function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  if (Number(req.headers['content-length'] ?? 0) > max) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > max) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** Serves everything under /__demo/: the script, and the comments API. */
export function createNotesHandler(cfg: NotesConfig): (req: IncomingMessage, res: ServerResponse) => void {
  const now = cfg.now ?? Date.now;
  const hosts = new Set([...cfg.origins].map((o) => new URL(o).host));
  const rateMax = cfg.rateMax ?? 30;
  const rateWindow = cfg.rateWindowMs ?? 60_000;
  let writes: number[] = [];

  /** One of the demo's hosts, or a request through an https front (self-origin.ts: a preview pane, a tunnel). */
  const hostAllowed = (req: IncomingMessage): boolean => hosts.has(req.headers.host ?? '') || forwardedHttps(req.headers);
  /** The Origin is one of the demo's own and is the host this request was sent to, or is the request's own https origin. */
  const originAllowed = (req: IncomingMessage): boolean => {
    const o = req.headers.origin;
    return typeof o === 'string' && ((cfg.origins.has(o) && new URL(o).host === req.headers.host) || isSelfOrigin(o, req.headers));
  };
  const rateOk = (): boolean => {
    const t = now();
    writes = writes.filter((w) => t - w < rateWindow);
    if (writes.length >= rateMax) return false;
    writes.push(t);
    return true;
  };

  /** Everything a write must pass before its body is believed. Returns the parsed JSON, or null once refused. */
  async function writeBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const refuse = (status: number, error: string): null => {
      res.once('finish', () => req.destroy());
      send(res, status, { error }, true);
      return null;
    };
    if (!originAllowed(req)) return refuse(403, 'demo-notes-origin');
    if (!/^application\/json(\s*;.*)?$/i.test(req.headers['content-type'] ?? '')) return refuse(415, 'demo-notes-json-only');
    if (!rateOk()) return refuse(429, 'demo-notes-rate');
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) return refuse(413, 'demo-notes-too-large');
    try {
      return JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      send(res, 400, { error: 'demo-notes-bad-json' });
      return null;
    }
  }

  async function postNote(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await writeBody(req, res);
    if (body === null) return;
    const parsed = parseNote(body);
    if (!parsed.ok) return send(res, 400, { error: `demo-notes-${parsed.reason}` });
    if (parsed.line.parentId !== undefined) {
      const parent = rootOf(await readLines<NoteLine>(cfg.files.notes), parsed.line.parentId);
      if (parent === null) return send(res, 404, { error: 'demo-notes-no-such-thread' });
      parsed.line.parentId = parent.id;
    }
    const line: NoteLine = { id: newId(), time: stamp(now), ...parsed.line };
    await appendLine(cfg.files.notes, line);
    send(res, 201, { ok: true, id: line.id });
  }

  async function postResolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await writeBody(req, res);
    if (body === null) return;
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !UUID.test(id)) return send(res, 400, { error: 'demo-notes-bad-id' });
    const root = rootOf(await readLines<NoteLine>(cfg.files.notes), id);
    if (root === null) return send(res, 404, { error: 'demo-notes-no-such-thread' });
    await appendLine(cfg.files.resolved, { noteId: root.id, time: stamp(now) });
    send(res, 200, { ok: true });
  }

  async function getNotes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.headers.origin !== undefined && !originAllowed(req)) return send(res, 403, { error: 'demo-notes-origin' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'demo-notes-origin' });
    const path = url.searchParams.get('path');
    if (path === null || path.length > 600) return send(res, 400, { error: 'demo-notes-bad-path' });
    send(res, 200, { notes: await threadsFor(cfg.files, path) });
  }

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://demo.invalid');
    const done = (p: Promise<void>): void => {
      p.catch(() => {
        if (!res.headersSent) send(res, 500, { error: 'demo-notes-failed' });
        else res.destroy();
      });
    };
    if (!hostAllowed(req)) return send(res, 403, { error: 'demo-notes-host' });
    if (url.pathname === '/__demo/notes.js') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'demo-notes-method' });
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': cfg.clientJs.length,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
      });
      res.end(req.method === 'HEAD' ? undefined : cfg.clientJs);
      return;
    }
    if (url.pathname === '/__demo/notes') {
      if (req.method === 'GET') return done(getNotes(req, res, url));
      if (req.method === 'POST') return done(postNote(req, res));
      return send(res, 405, { error: 'demo-notes-method' });
    }
    if (url.pathname === '/__demo/notes/resolve') {
      if (req.method === 'POST') return done(postResolve(req, res));
      return send(res, 405, { error: 'demo-notes-method' });
    }
    send(res, 404, { error: 'demo-notes-not-found' });
  };
}
