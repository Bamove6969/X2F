import { useEffect, useRef } from 'react';

/**
 * The events `GET /v1/events` sends (apps/api/src/events/bus.ts). Names are public display names.
 */
export type LiveEvent =
  | { type: 'trade'; code: string; state: string }
  | { type: 'accepted'; code: string; by: string }
  | { type: 'chat'; chat: string }
  | { type: 'nudge'; from: string; context: string }
  /** Plan 2 Task 16: a new device waits for approval; the approval is fetched over the session (no detail here). */
  | { type: 'login-approval'; id: string }
  /** Plan 4 Task 11, from the staff API only: a moderator joined the disputed trade's chat, or asks for the unblurred proof. */
  | { type: 'moderator-joined'; code: string; username: string }
  | { type: 'proof-requested'; code: string; username: string };

const FIELDS: Record<LiveEvent['type'], readonly string[]> = {
  trade: ['code', 'state'],
  accepted: ['code', 'by'],
  chat: ['chat'],
  nudge: ['from', 'context'],
  'login-approval': ['id'],
  'moderator-joined': ['code', 'username'],
  'proof-requested': ['code', 'username'],
};

/** One SSE `data` payload as a known event with only its own string fields, or null. */
export function parseLiveEvent(raw: string): LiveEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== 'string' || !Object.hasOwn(FIELDS, type)) return null;
  const out: Record<string, string> = { type };
  for (const f of FIELDS[type as LiveEvent['type']]) {
    const value = o[f];
    if (typeof value !== 'string') return null;
    out[f] = value;
  }
  return out as LiveEvent;
}

export interface ConnectOptions {
  /** The browser's EventSource (injected by tests; undefined where there is none). */
  EventSource?: typeof EventSource | undefined;
  /** For the reconnect jitter (tests pin it). */
  random?: () => number;
}

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

/**
 * Listens to `/v1/events` on this origin (the session cookie goes with it; connect-src 'self').
 * A dropped connection is retried by the browser itself. When the browser gives up (an HTTP
 * refusal such as 401, 403 or 429 closes the source), this reconnects after 1 s, 2 s, 4 s, ...
 * up to a minute, with ±20% jitter, and starts again at 1 s once a stream opens. Returns stop().
 */
export function connectEvents(onEvent: (e: LiveEvent) => void, o: ConnectOptions = {}): () => void {
  const Source = 'EventSource' in o ? o.EventSource : globalThis.EventSource;
  const random = o.random ?? Math.random;
  if (!Source) return () => undefined;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = FIRST_RETRY_MS;
  let stopped = false;

  const open = () => {
    const s = new Source('/v1/events');
    source = s;
    s.onopen = () => {
      delay = FIRST_RETRY_MS;
    };
    s.onmessage = (m: MessageEvent<string>) => {
      const ev = parseLiveEvent(m.data);
      if (ev) onEvent(ev);
    };
    s.onerror = () => {
      if (stopped || s.readyState !== Source.CLOSED) return;
      s.close();
      const wait = Math.round(delay * (0.8 + 0.4 * random()));
      delay = Math.min(delay * 2, MAX_RETRY_MS);
      timer = setTimeout(open, Math.min(wait, MAX_RETRY_MS));
    };
  };
  open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}

/** Calls `onEvent` for each live event while mounted and `enabled` (a signed-in trader). */
export function useLiveEvents(onEvent: (e: LiveEvent) => void, enabled = true): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!enabled) return;
    return connectEvents((e) => handler.current(e));
  }, [enabled]);
}
