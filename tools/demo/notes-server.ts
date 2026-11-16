/**
 * DEMO ONLY: the comments the owner leaves on the running demo (docs/demo.md).
 *
 * Three append-only JSON-lines files, kept outside .demo so a demo restart never wipes them:
 * demo-notes.jsonl (comments and follow-ups), demo-replies.jsonl (the lead's replies, written only
 * by the local `npm run demo:reply`, never over HTTP) and demo-resolved.jsonl (resolved threads).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardedHttps, isSelfOrigin } from './self-origin.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface NotesFiles {
  notes: string;
  replies: string;
  resolved: string;
  /** DEMO_NOTES_SEED: earlier notes files (or folders) to number after, read only, instead of origin/comms. */
  seed?: string;
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
  /** The earlier notes to number after (loadSeed); read from DEMO_NOTES_SEED or origin/comms when left out. */
  seed?: NotesSeed;
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
  /** The comment's number, one running count across screens and sessions; saved when it is written. */
  number?: number;
  /** 'follow-up' on a follow-up this version wrote, so it never takes a number. */
  kind?: 'follow-up';
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
  return {
    notes,
    replies: join(dirname(notes), 'demo-replies.jsonl'),
    resolved: join(dirname(notes), 'demo-resolved.jsonl'),
    ...(env.DEMO_NOTES_SEED !== undefined ? { seed: env.DEMO_NOTES_SEED } : {}),
  };
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

/** Appends one line and fsyncs it before returning: a comment is on disk before the page hears "Sent". */
async function appendLine(file: string, value: unknown): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const buf = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  // O_APPEND: never truncates, never writes over a line already there.
  const fd = openSync(file, 'a', 0o600);
  try {
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// ── one running comment number ────────────────────────────────────────────────────────────────
// The team counts the owner's notes by line: 12 Nov is 1-48, 13 Nov is 49-91 (its one follow-up
// included), so the next comment is 92. A line that already carries a number keeps it; an old
// line with none takes the next one, in file order; a line with a `kind` (a follow-up this
// version wrote, or a reply or resolved line in a downloaded file) or a `noteId` takes none.

export interface NotesSeed {
  /** Note id to number, for every earlier note. */
  numbers: ReadonlyMap<string, number>;
  /** The highest number taken (0 for none). */
  max: number;
  /** False when the earlier notes could not be read (no comms branch, no git): numbering then starts from the local file. */
  ok: boolean;
  /** Where they came from: 'origin/comms', 'comms', 'DEMO_NOTES_SEED' or 'none'. */
  source: string;
  /** Each file read, in order. */
  files: string[];
  /** What was skipped and why, for the start-up output. */
  problems: string[];
}

/** Runs git with these arguments and returns its stdout, or throws. */
export type GitRun = (args: string[]) => string;

const realGit: GitRun = (args) =>
  execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });

const SEED_NAME = /^owner-demo-notes-[A-Za-z0-9._-]+\.jsonl$/;
const MAX_SEED_BYTES = 16 * 1024 * 1024;

/** Numbers the lines of one file into `map`, after `max`; returns the new max. */
function numberLines(lines: unknown[], map: Map<string, number>, max: number, prefix: string): number {
  let i = 0;
  for (const raw of lines) {
    i += 1;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const l = raw as { id?: unknown; kind?: unknown; noteId?: unknown; number?: unknown };
    if (l.kind !== undefined || l.noteId !== undefined) continue;
    const id = typeof l.id === 'string' && l.id !== '' ? l.id : `${prefix}#${i}`;
    if (map.has(id)) continue;
    const n = typeof l.number === 'number' && Number.isInteger(l.number) && l.number > 0 ? l.number : max + 1;
    map.set(id, n);
    if (n > max) max = n;
  }
  return max;
}

function parseLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const l of text.split('\n')) {
    if (l.trim() === '') continue;
    try {
      out.push(JSON.parse(l) as unknown);
    } catch {
      // A line somebody edited badly must not take the whole list down.
    }
  }
  return out;
}

/** DEMO_NOTES_SEED entries: .jsonl files, or folders whose owner-demo-notes-*.jsonl are read (not their subfolders). No globs. */
function seedFiles(seedPath: string, problems: string[]): string[] {
  const out: string[] = [];
  for (const entry of seedPath.split(new RegExp(`[,${delimiter === ':' ? ':' : ';'}]`)).map((x) => x.trim()).filter((x) => x !== '')) {
    const p = resolve(entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      problems.push(`${entry}: not found`);
      continue;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p).filter((n) => SEED_NAME.test(n)).sort()) {
        const f = join(p, name);
        if (statSync(f).isFile()) out.push(f);
      }
    } else if (!st.isFile() || !p.endsWith('.jsonl')) {
      problems.push(`${entry}: not a .jsonl file, skipped`);
    } else if (st.size > MAX_SEED_BYTES) {
      problems.push(`${entry}: over 16 MB, skipped`);
    } else out.push(p);
  }
  return out;
}

/**
 * The owner's earlier notes, to number after (read only: nothing here writes). From the files
 * DEMO_NOTES_SEED names when it is set; otherwise every owner-demo-notes-*.jsonl on origin/comms
 * (or a local comms branch), read with `git show` from this checkout with no network. Never throws:
 * when neither can be read, `ok` is false and numbering continues after the local file's highest.
 */
export function loadSeed(opts: { seedPath?: string | undefined; git?: GitRun } = {}): NotesSeed {
  const map = new Map<string, number>();
  const problems: string[] = [];
  let max = 0;
  if (opts.seedPath !== undefined && opts.seedPath.trim() !== '') {
    const files: string[] = [];
    for (const f of seedFiles(opts.seedPath, problems)) {
      try {
        max = numberLines(parseLines(readFileSync(f, 'utf8')), map, max, f);
        files.push(f);
      } catch (e) {
        problems.push(`${f}: ${(e as Error).message}`);
      }
    }
    return { numbers: map, max, ok: files.length > 0, source: 'DEMO_NOTES_SEED', files, problems };
  }
  const git = opts.git ?? realGit;
  for (const ref of ['origin/comms', 'comms']) {
    let names: string[];
    try {
      names = git(['ls-tree', '--name-only', ref]).split('\n').map((x) => x.trim()).filter((x) => SEED_NAME.test(x)).sort();
    } catch {
      problems.push(`${ref}: not in this checkout`);
      continue;
    }
    if (names.length === 0) {
      problems.push(`${ref}: no owner-demo-notes-*.jsonl`);
      continue;
    }
    const files: string[] = [];
    try {
      for (const name of names) {
        max = numberLines(parseLines(git(['show', `${ref}:${name}`])), map, max, `${ref}:${name}`);
        files.push(`${ref}:${name}`);
      }
    } catch (e) {
      problems.push(`${ref}: ${(e as Error).message}`);
      map.clear();
      max = 0;
      continue;
    }
    return { numbers: map, max, ok: true, source: ref, files, problems };
  }
  return { numbers: map, max: 0, ok: false, source: 'none', files: [], problems };
}

/** The earlier notes and the local file, numbered together: every comment's number, and the highest. */
function numberAll(notes: NoteLine[], seed: NotesSeed): { numbers: Map<string, number>; max: number } {
  const numbers = new Map(seed.numbers);
  const max = numberLines(notes, numbers, seed.max, 'local');
  return { numbers, max };
}

/** One line for the demo's start-up output: where the numbers continue from. */
export async function notesStartupLine(files: NotesFiles, seed: NotesSeed): Promise<string> {
  const { max } = numberAll(await readLines<NoteLine>(files.notes), seed);
  const skipped = seed.problems.length > 0 && seed.source === 'DEMO_NOTES_SEED' ? ` (skipped: ${seed.problems.join('; ')})` : '';
  // DESIGN: wording (the demo's terminal output; the owner reads it)
  if (seed.ok) {
    const n = seed.files.length;
    return `Comments: new ones start at ${max + 1}, after the ${seed.max} earlier notes ${seed.source === 'DEMO_NOTES_SEED' ? 'in DEMO_NOTES_SEED' : `on ${seed.source}`} (${n} file${n === 1 ? '' : 's'})${skipped}; saved to ${files.notes}`;
  }
  if (seed.source === 'DEMO_NOTES_SEED') {
    return `Comments: could not read DEMO_NOTES_SEED${skipped}; new ones continue after ${max} (the highest in ${files.notes})`;
  }
  return `Comments: could not read the earlier notes on origin/comms (no comms branch here; "git fetch origin comms" adds it); new ones continue after ${max} (the highest in ${files.notes})`;
}

/** What the gateway needs from the shell to find the notes: it starts with a clean environment (procs.ts). */
export function gatewayNotesEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['DEMO_NOTES_FILE', 'DEMO_NOTES_SEED'] as const) {
    const v = env[k];
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
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
  number: number;
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
export async function threadsFor(
  files: NotesFiles,
  path: string,
  seed: NotesSeed = loadSeed({ seedPath: files.seed }),
): Promise<ThreadView[]> {
  const [notes, replies, resolved] = await Promise.all([
    readLines<NoteLine>(files.notes),
    readLines<ReplyLine>(files.replies),
    readLines<{ noteId: string }>(files.resolved),
  ]);
  const { numbers } = numberAll(notes, seed);
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
        number: numbers.get(n.id) ?? 0,
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
  const seed = cfg.seed ?? loadSeed({ seedPath: cfg.files.seed });
  let writes: number[] = [];
  /** Comment writes one at a time, so two sent together never take the same number. */
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

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
    const line = parsed.line;
    const result = await serial(async () => {
      const existing = await readLines<NoteLine>(cfg.files.notes);
      if (line.parentId !== undefined) {
        const parent = rootOf(existing, line.parentId);
        if (parent === null) return null;
        const followUp: NoteLine = { id: newId(), time: stamp(now), kind: 'follow-up', text: line.text, parentId: parent.id };
        await appendLine(cfg.files.notes, followUp);
        return { id: followUp.id };
      }
      const comment: NoteLine = { id: newId(), time: stamp(now), ...line, number: numberAll(existing, seed).max + 1 };
      await appendLine(cfg.files.notes, comment);
      return { id: comment.id, number: comment.number };
    });
    if (result === null) return send(res, 404, { error: 'demo-notes-no-such-thread' });
    send(res, 201, { ok: true, ...result });
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
    send(res, 200, { notes: await threadsFor(cfg.files, path, seed) });
  }

  /**
   * Download my notes: the whole record in one JSON-lines file, in the shape of comms'
   * owner-demo-notes-*.jsonl. Every comment as saved, with its number (old ones too); follow-ups
   * with kind 'follow-up'; then the replies (kind 'reply') and resolved threads (kind 'resolved').
   * Same-origin only: a page on another port of this machine is same-site, and is refused too.
   */
  async function downloadNotes(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.origin !== undefined && !originAllowed(req)) return send(res, 403, { error: 'demo-notes-origin' });
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'demo-notes-origin' });
    const [notes, replies, resolved] = await Promise.all([
      readLines<NoteLine>(cfg.files.notes),
      readLines<ReplyLine>(cfg.files.replies),
      readLines<Record<string, unknown>>(cfg.files.resolved),
    ]);
    const { numbers } = numberAll(notes, seed);
    const out = [
      ...notes.map((n) =>
        n.parentId !== undefined ? { ...n, kind: 'follow-up' } : n.kind === undefined && numbers.has(n.id) ? { ...n, number: numbers.get(n.id) } : n,
      ),
      ...replies.map((r) => ({ kind: 'reply', ...r })),
      ...resolved.map((r) => ({ kind: 'resolved', ...r })),
    ];
    const body = Buffer.from(out.map((l) => `${JSON.stringify(l)}\n`).join(''), 'utf8');
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-length': body.length,
      'content-disposition': `attachment; filename="owner-demo-notes-${stamp(now).slice(0, 10)}.jsonl"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
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
    if (url.pathname === '/__demo/notes/download') {
      if (req.method === 'GET' || req.method === 'HEAD') return done(downloadNotes(req, res));
      return send(res, 405, { error: 'demo-notes-method' });
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
