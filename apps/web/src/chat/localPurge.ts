/**
 * localPurge (Plan 7 Task 3; owner p11-10, "the purge is system wide"): what this device keeps
 * about a trade goes when the trade self-destructs on the server (`TradeView.deleteAt`), also if
 * the app was closed at that moment (`runConfirmedLocalPurge` at start-up).
 *
 * - The trade room remembers each trade's `deleteAt` here (`rememberDeleteAt`), in one
 *   localStorage entry (`x2f.deleteAt`: trade code → ISO date, nothing else), so a trade the server
 *   has already deleted (it then answers 404) is still cleaned up. The entry goes with the trade.
 * - Built in: every `x2f.*` localStorage and sessionStorage key naming the trade code (the funding
 *   marks, the warnings seen, the courtesy sheet).
 * - A store owned elsewhere can register its own deleter (`registerLocalPurge`).
 * - The chat store (IndexedDB `x2f-chat`) is not touched here: the chat engine erases a chat the
 *   API answers 410 `chat-purged` for, and sweeps every stored chat once per worker start (C-014,
 *   chat shred). The chat purge comes no later than the trade's (@x2f/trade retention.ts).
 * - The escrow store (IndexedDB `x2f-escrow`) is NOT deleted here: it holds the escrow keys and
 *   follows the escrow runtime's own rule (KEEP_AFTER_CLOSE_MS, and never before this device saw
 *   the escrow settled and empty), so no key goes while coins could still be in the escrow.
 *
 * Times are the server's, never this device's clock alone: the room compares with its server clock;
 * at start-up a stored date is compared with the server's time (`GET /v1/news` `serverNow`), and a
 * trade goes only once the server confirms it: the trade is gone (404), or its view still carries
 * a self-destruct date that has passed. A trade whose view now has no date (escalated again by late
 * coins) is forgotten here and kept. No answer (offline, signed out, any other error) keeps
 * everything until the next start or the trade room.
 *
 * On a shared device a 404 can also mean "not your trade" for the account signed in now; with the
 * stored date already past by the server's clock the trade is due for deletion everywhere, so its
 * leftovers go whichever account is signed in.
 */

export const DELETE_AT_KEY = 'x2f.deleteAt';

type Deleter = (code: string) => Promise<void> | void;
const deleters = new Map<string, Deleter>();

/** Adds a store's deleter (by name: a second registration replaces the first). Returns an unregister function. */
export function registerLocalPurge(name: string, del: Deleter): () => void {
  deleters.set(name, del);
  return () => {
    if (deleters.get(name) === del) deleters.delete(name);
  };
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** Trade code → ISO self-destruct date, as last seen in the trade's view. Anything else stored there is dropped. */
function readMap(): Record<string, string> {
  try {
    const raw = local()?.getItem(DELETE_AT_KEY) ?? null;
    if (raw === null) return {};
    const v = JSON.parse(raw) as unknown;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, d] of Object.entries(v as Record<string, unknown>)) if (isIso(d)) out[k] = d;
    return out;
  } catch {
    return {};
  }
}

function writeMap(m: Record<string, string>): void {
  try {
    if (Object.keys(m).length === 0) local()?.removeItem(DELETE_AT_KEY);
    else local()?.setItem(DELETE_AT_KEY, JSON.stringify(m));
  } catch {
    // Nothing kept then: the next view remembers it again.
  }
}

/** Remembers (or, with null, forgets) when `code` self-destructs. A date that does not parse is ignored. */
export function rememberDeleteAt(code: string, deleteAt: string | null): void {
  const m = readMap();
  if (deleteAt === null) {
    if (!(code in m)) return;
    delete m[code];
  } else {
    if (!isIso(deleteAt) || m[code] === deleteAt) return;
    m[code] = deleteAt;
  }
  writeMap(m);
}

/** The trades this device knows of whose self-destruct time has come at `nowMs` (server time). */
export function localPurgeDue(nowMs: number): string[] {
  return Object.entries(readMap())
    .filter(([, at]) => Date.parse(at) <= nowMs)
    .map(([c]) => c);
}

/** Removes every `x2f.*` key in `s` that names `code`, except the date map itself. */
function dropKeys(s: Storage | null, code: string): void {
  if (s === null || code === '') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null && k !== DELETE_AT_KEY && k.startsWith('x2f.') && k.includes(code)) doomed.push(k);
    }
    for (const k of doomed) s.removeItem(k);
  } catch {
    // A store that throws holds nothing of ours.
  }
}

/** Deletes everything this device keeps about `code` now: each registered store, then the keys and the date. */
export async function purgeTradeLocally(code: string): Promise<void> {
  for (const del of [...deleters.values()]) {
    try {
      await del(code);
    } catch {
      // One store failing never keeps the others.
    }
  }
  dropKeys(local(), code);
  dropKeys(session(), code);
  rememberDeleteAt(code, null);
}

/** What the server says about a trade at start-up. */
export type ServerTradeAnswer = { kind: 'gone' } | { kind: 'view'; deleteAt: string | null; serverNow: string } | { kind: 'unknown' };

export interface ConfirmDeps {
  /** The server's current time in ms, or null when it cannot be read. */
  serverNow(): Promise<number | null>;
  /** The trade as the server answers this session now. */
  trade(code: string): Promise<ServerTradeAnswer>;
}

const isoMs = (v: unknown): number | null => (isIso(v) ? Date.parse(v) : null);

/**
 * The real server, by plain fetch (never `api()`: a background check must never redirect to Terms
 * or Add a wallet). Only a 404 counts as gone; anything unreadable is `unknown`.
 */
export const serverConfirm: ConfirmDeps = {
  async serverNow() {
    try {
      const res = await fetch('/v1/news', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      return isoMs(((await res.json()) as { serverNow?: unknown } | null)?.serverNow);
    } catch {
      return null;
    }
  },
  async trade(code) {
    try {
      const res = await fetch(`/v1/trades/${encodeURIComponent(code)}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (res.status === 404) return { kind: 'gone' };
      if (!res.ok) return { kind: 'unknown' };
      const v = (await res.json()) as { deleteAt?: unknown; serverNow?: unknown } | null;
      if (!isIso(v?.serverNow)) return { kind: 'unknown' };
      const at = v?.deleteAt ?? null;
      if (at !== null && !isIso(at)) return { kind: 'unknown' };
      return { kind: 'view', deleteAt: at, serverNow: v.serverNow };
    } catch {
      return { kind: 'unknown' };
    }
  },
};

/**
 * Start-up purge: the trades whose stored date has passed by the SERVER's clock, each deleted from
 * this device only once the server confirms it (see the header). Returns the codes deleted.
 */
export async function runConfirmedLocalPurge(deps: ConfirmDeps = serverConfirm): Promise<string[]> {
  // Nothing stored: no request at all.
  if (Object.keys(readMap()).length === 0) return [];
  const now = await deps.serverNow();
  if (now === null || !Number.isFinite(now)) return [];
  const done: string[] = [];
  for (const code of localPurgeDue(now)) {
    const a = await deps.trade(code);
    if (a.kind === 'gone') {
      await purgeTradeLocally(code);
      done.push(code);
    } else if (a.kind === 'view') {
      const at = a.deleteAt === null ? null : Date.parse(a.deleteAt);
      if (at !== null && at <= Date.parse(a.serverNow)) {
        await purgeTradeLocally(code);
        done.push(code);
      } else {
        // No date any more (late coins escalated it) or a later one: keep, and remember what the server says now.
        rememberDeleteAt(code, a.deleteAt);
      }
    }
  }
  return done;
}
