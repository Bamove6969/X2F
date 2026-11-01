/**
 * Live events (Task 19). The only event shapes `GET /v1/events` ever sends. Names in them (`by`,
 * `from`) are public display names (see publicName.ts), never login names.
 */
export type LiveEvent =
  | { type: 'trade'; code: string; state: string }
  | { type: 'accepted'; code: string; by: string }
  | { type: 'chat'; chat: string }
  | { type: 'nudge'; from: string; context: string }
  /** Plan 2 Task 16: a new device waits for approval; the approval itself is fetched over the session. */
  | { type: 'login-approval'; id: string };

/** One open stream: `send` writes a whole SSE frame; `close` ends the response. */
export interface StreamSink {
  send(frame: string): void;
  close(): void;
}

export interface EventBusOptions {
  /** Streams one account may hold open at once (tabs and devices). */
  perAccount?: number;
  /** Streams the whole process may hold open at once. */
  global?: number;
}

export const DEFAULT_STREAMS_PER_ACCOUNT = 5;
export const DEFAULT_STREAMS_GLOBAL = 2000;

/** One SSE frame. JSON.stringify escapes newlines, so a value can never start a new field or event. */
export function frame(ev: LiveEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

/**
 * In-process fan-out from an account id to that account's open streams. Holds nothing but the
 * open sinks: no history, no replay, nothing logged. A client that was offline reloads state
 * from the REST routes; events are only a hint to do so.
 */
export class EventBus {
  readonly perAccount: number;
  readonly global: number;
  private readonly streams = new Map<string, Set<StreamSink>>();
  /** The session each stream was opened by (for closeSession and closeAccount's `keep`). */
  private readonly sessionOf = new Map<StreamSink, string>();
  /**
   * Plan 2 Task 18 (review I1): the streams a team member opened. They receive the account's
   * events, but never count as the account being reached: only the account owner's device runs
   * the escrow, so a push still goes to the owner whenever no stream of the owner's own is open.
   */
  private readonly memberSinks = new Set<StreamSink>();
  private count = 0;

  constructor(o: EventBusOptions = {}) {
    this.perAccount = o.perAccount ?? DEFAULT_STREAMS_PER_ACCOUNT;
    this.global = o.global ?? DEFAULT_STREAMS_GLOBAL;
  }

  /** Open streams in the process. */
  get size(): number {
    return this.count;
  }

  /**
   * Adds a stream; returns its detach function, or null when a cap is reached. `o.member`: a team
   * member's stream (Plan 2 Task 18). Members' streams together may take at most `perAccount - 1`
   * slots, so one is always left for the account owner (review I1).
   */
  attach(accountId: string, sink: StreamSink, sessionId?: string, o: { member?: boolean } = {}): (() => void) | null {
    const own = this.streams.get(accountId);
    if (this.count >= this.global || (own?.size ?? 0) >= this.perAccount) return null;
    if (o.member === true && this.memberCount(own) >= this.perAccount - 1) return null;
    const set = own ?? new Set<StreamSink>();
    if (!own) this.streams.set(accountId, set);
    set.add(sink);
    if (sessionId !== undefined) this.sessionOf.set(sink, sessionId);
    if (o.member === true) this.memberSinks.add(sink);
    this.count++;
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.remove(accountId, sink);
    };
  }

  private remove(accountId: string, sink: StreamSink): void {
    const set = this.streams.get(accountId);
    if (!set?.delete(sink)) return;
    this.sessionOf.delete(sink);
    this.memberSinks.delete(sink);
    this.count--;
    if (set.size === 0) this.streams.delete(accountId);
  }

  private memberCount(set: Set<StreamSink> | undefined): number {
    let n = 0;
    for (const sink of set ?? []) if (this.memberSinks.has(sink)) n++;
    return n;
  }

  /**
   * Sends `ev` to every open stream of `accountId` (the owner's and its team members') and no one
   * else. Returns how many of the account OWNER's own streams were written: every caller uses it to
   * decide whether the owner still needs a push, and a member's tab never stands in for the
   * owner's device (Plan 2 Task 18, review I1).
   */
  publish(accountId: string, ev: LiveEvent): number {
    const set = this.streams.get(accountId);
    if (!set) return 0;
    const data = frame(ev);
    let written = 0;
    for (const sink of [...set]) {
      try {
        sink.send(data);
        if (!this.memberSinks.has(sink)) written++;
      } catch {
        // A dead socket: drop it. Nothing is logged (the account id would be a link to activity).
        this.remove(accountId, sink);
        try {
          sink.close();
        } catch {
          // already gone
        }
      }
    }
    return written;
  }

  /**
   * True while the account owner has at least one stream of their own open (the final-alert proof,
   * P3-I13; the nudge push rule). Team members' streams do not count (Plan 2 Task 18, review I1).
   */
  delivered(accountId: string): boolean {
    const set = this.streams.get(accountId);
    return (set?.size ?? 0) > this.memberCount(set);
  }

  private end(accountId: string, sink: StreamSink): void {
    this.remove(accountId, sink);
    try {
      sink.close();
    } catch {
      // already gone
    }
  }

  /**
   * Ends the account's streams at once when its sessions end (log out everywhere, disable, revoke
   * after a password change or a method removal), instead of at the stream's lifetime. `keepSessionId`
   * spares the streams of the session that made the change. Returns how many were ended.
   */
  closeAccount(accountId: string, keepSessionId?: string): number {
    const set = this.streams.get(accountId);
    if (!set) return 0;
    let n = 0;
    for (const sink of [...set]) {
      if (keepSessionId !== undefined && this.sessionOf.get(sink) === keepSessionId) continue;
      this.end(accountId, sink);
      n++;
    }
    return n;
  }

  /** Ends the streams one session opened (logout, a single revoked session). Returns how many. */
  closeSession(accountId: string, sessionId: string): number {
    const set = this.streams.get(accountId);
    if (!set) return 0;
    let n = 0;
    for (const sink of [...set]) {
      if (this.sessionOf.get(sink) !== sessionId) continue;
      this.end(accountId, sink);
      n++;
    }
    return n;
  }

  /** Ends every stream (app shutdown). */
  closeAll(): void {
    for (const [accountId, set] of [...this.streams]) {
      for (const sink of [...set]) this.end(accountId, sink);
    }
  }
}
