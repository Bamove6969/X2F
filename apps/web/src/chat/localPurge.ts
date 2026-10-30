/**
 * localPurge (Plan 7 Task 3): what this device keeps about a trade goes when the trade
 * self-destructs on the server (`TradeView.deleteAt`), also if the app was closed at that moment
 * (`runConfirmedLocalPurge` at start-up).
 *
 * - The trade room remembers each trade's `deleteAt` here (`rememberDeleteAt`), in one
 *   localStorage entry, so a trade the server has already deleted (it then answers 404) is still
 *   cleaned up. The entry for a trade goes with the trade.
 * - Built in: every `x2f.*` localStorage and sessionStorage key naming the trade code (the funding
 *   marks, the release marker, the confirmed deal of the take).
 * - Stores owned elsewhere register their own deleter with `registerLocalPurge`. SEAM (Plan 3 Task
 *   20, `wip/second-p3-task20-rest`): the chat store (IndexedDB `x2f-chat`, opened only by the
 *   escrow worker) registers one that asks the worker to delete the trade's chat record. Plan 5
 *   Task 14's proof cache does the same.
 * - The escrow store (IndexedDB `x2f-escrow`) is NOT deleted here: it holds the escrow keys and
 *   follows the escrow runtime's own rule (KEEP_AFTER_CLOSE_MS, 30 days after this device saw the
 *   close, and never before it saw the escrow settled and empty), so no key is lost while coins
 *   could still be in the escrow. That rule is never later than the server's for a settled trade.
 *
 * Times are the server's (`serverClock()`), never this device's own clock alone. At start-up
 * (`runConfirmedLocalPurge`, review M1) a stored date is compared with the SERVER's time, and a
 * trade goes only once the server confirms it: the trade is gone (404), or its view still carries
 * a self-destruct date that has passed. A trade whose view now has no date (escalated by late
 * funds, or the purge is off: review I1) is forgotten here and kept. No answer (offline, logged
 * out, any other error) keeps everything until the next start or the trade room.
 */

export const DELETE_AT_KEY = 'x2f.deleteAt';

type Deleter = (code: string) => Promise<void> | void;
const deleters = new Map<string, Deleter>();

/** Adds a store's deleter (by name, so a second registration replaces the first). Returns an unregister function. */
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

/** Trade code → ISO self-destruct time, as last seen in the trade's view. */
function readMap(): Record<string, string> {
  try {
    const raw = local()?.getItem(DELETE_AT_KEY) ?? null;
    if (raw === null) return {};
    const v = JSON.parse(raw) as unknown;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, d] of Object.entries(v as Record<string, unknown>)) if (typeof d === 'string' && Number.isFinite(Date.parse(d))) out[k] = d;
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
    // Nothing to keep then: the next view remembers it again.
  }
}

/** Remembers (or, with null, forgets) when `code` self-destructs. */
export function rememberDeleteAt(code: string, deleteAt: string | null): void {
  const m = readMap();
  if (deleteAt === null || !Number.isFinite(Date.parse(deleteAt))) {
    if (!(code in m)) return;
    delete m[code];
  } else {
    if (m[code] === deleteAt) return;
    m[code] = deleteAt;
  }
  writeMap(m);
}

/** The trades this device knows of whose self-destruct time has come at `nowMs` (server time). */
export function localPurgeDue(nowMs: number): string[] {
  return Object.entries(readMap())
    .filter(([, d]) => Date.parse(d) <= nowMs)
    .map(([c]) => c);
}

/** Removes every `x2f.*` key in `s` that names `code`, except the deleteAt map itself. */
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

/** Deletes everything this device keeps about `code` now (each registered store, then the keys). */
export async function purgeTradeLocally(code: string): Promise<void> {
  for (const del of [...deleters.values()]) {
    try {
      await del(code);
    } catch {
      // One store failing never keeps the others; the code stays listed only if a key remains.
    }
  }
  dropKeys(local(), code);
  dropKeys(session(), code);
  rememberDeleteAt(code, null);
}

/** Deletes every trade whose time has come at `nowMs` (server time). Returns their codes. */
export async function runLocalPurge(nowMs: number): Promise<string[]> {
  const due = localPurgeDue(nowMs);
  for (const code of due) await purgeTradeLocally(code);
  return due;
}

/** What the server says about a trade at start-up (`runConfirmedLocalPurge`). */
export type ServerTradeAnswer =
  | { kind: 'gone' }
  | { kind: 'view'; deleteAt: string | null; serverNow: string }
  | { kind: 'unknown' };

export interface ConfirmDeps {
  /** The server's current time in ms (`GET /v1/news` `serverNow`), or null when it cannot be read. */
  serverNow(): Promise<number | null>;
  /** The trade as the server answers this session now. */
  trade(code: string): Promise<ServerTradeAnswer>;
}

const isoMs = (v: unknown): number | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

/**
 * The real server, by plain fetch (never `api()`: a background check must never redirect to Terms
 * or Add a wallet). Only a 404 counts as gone; anything else unreadable is `unknown`.
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
      const now = typeof v?.serverNow === 'string' && isoMs(v.serverNow) !== null ? v.serverNow : null;
      if (now === null) return { kind: 'unknown' };
      const at = v?.deleteAt ?? null;
      if (at !== null && isoMs(at) === null) return { kind: 'unknown' };
      return { kind: 'view', deleteAt: at as string | null, serverNow: now };
    } catch {
      return { kind: 'unknown' };
    }
  },
};

/**
 * Start-up purge (review M1): the trades whose stored date has passed by the SERVER's clock, each
 * deleted from this device only once the server confirms it (see the header). Returns the codes
 * deleted. Never reads this device's clock.
 */
export async function runConfirmedLocalPurge(deps: ConfirmDeps = serverConfirm): Promise<string[]> {
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
        // No date any more (late funds, purge off) or a later one: keep, and remember what the server says now.
        rememberDeleteAt(code, a.deleteAt);
      }
    }
  }
  return done;
}
