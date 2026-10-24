/**
 * Live events (Task 19). The only event shapes `GET /v1/events` ever sends. Names in them (`by`,
 * `from`) are public display names (see publicName.ts), never login names.
 */
export type LiveEvent =
  | { type: 'trade'; code: string; state: string }
  | { type: 'accepted'; code: string; by: string }
  | { type: 'chat'; chat: string }
  | { type: 'nudge'; from: string; context: string };

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
  private count = 0;

  constructor(o: EventBusOptions = {}) {
    this.perAccount = o.perAccount ?? DEFAULT_STREAMS_PER_ACCOUNT;
    this.global = o.global ?? DEFAULT_STREAMS_GLOBAL;
  }

  /** Open streams in the process. */
  get size(): number {
    return this.count;
  }

  /** Adds a stream; returns its detach function, or null when a cap is reached. */
  attach(accountId: string, sink: StreamSink): (() => void) | null {
    const own = this.streams.get(accountId);
    if (this.count >= this.global || (own?.size ?? 0) >= this.perAccount) return null;
    const set = own ?? new Set<StreamSink>();
    if (!own) this.streams.set(accountId, set);
    set.add(sink);
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
    this.count--;
    if (set.size === 0) this.streams.delete(accountId);
  }

  /** Sends `ev` to every open stream of `accountId` and no one else; returns how many were written. */
  publish(accountId: string, ev: LiveEvent): number {
    const set = this.streams.get(accountId);
    if (!set) return 0;
    const data = frame(ev);
    let written = 0;
    for (const sink of [...set]) {
      try {
        sink.send(data);
        written++;
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

  /** True while `accountId` has at least one open stream (the final-alert proof, P3-I13). */
  delivered(accountId: string): boolean {
    return (this.streams.get(accountId)?.size ?? 0) > 0;
  }

  /** Ends every stream (app shutdown). */
  closeAll(): void {
    for (const [accountId, set] of [...this.streams]) {
      for (const sink of [...set]) {
        this.remove(accountId, sink);
        try {
          sink.close();
        } catch {
          // already gone
        }
      }
    }
  }
}
