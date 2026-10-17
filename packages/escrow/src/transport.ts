import type { Role } from '@x2f/core';
import { joinMessage, type Envelope, type Identity } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';

/** Moves sealed envelopes to and from the relay. Delivery is at most once. */
export interface Transport {
  send(e: Envelope): void;
  /** The next frame from a peer, as untrusted data for open(). */
  next(): Promise<unknown>;
  /**
   * Called when frames may have been lost (after a reconnect, or when the relay reports a
   * full queue), so the caller can resend.
   */
  onReconnect(cb: () => void): void;
  close(): void;
}

export class TransportClosedError extends Error {
  constructor(readonly closeCode: number) {
    super(`transport closed (${closeCode})`);
    this.name = 'TransportClosedError';
  }
}

/** Relay close codes after which reconnecting cannot help. */
const FATAL = new Set([4401, 4404, 4409]);
const BACKOFF_MS = [200, 500, 1000, 2000, 5000] as const;
/** A connection must stay up this long before the backoff resets. */
const STABLE_MS = 10_000;
/** Frames held in memory either way; beyond this the oldest are dropped (resends recover). */
const MAX_BUFFERED = 1000;
/** Canonical standard base64 of exactly 32 bytes (the relay's join challenge). */
const CHALLENGE_B64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

/**
 * A relay connection for one role in one trade, using the platform WebSocket (browsers,
 * Node 22). Answers the signed join challenge, reconnects with backoff, and holds
 * outgoing envelopes until joined.
 */
export function wsTransport(a: { url: string; code: string; role: Role; me: Identity }): Transport {
  const inbox: unknown[] = [];
  const waiters: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const outbox: string[] = [];
  let lossCbs: (() => void)[] = [];
  let ws: WebSocket | undefined;
  let joined = false;
  let closed: TransportClosedError | undefined;
  let attempts = 0;
  let everJoined = false;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;

  const finish = (err: TransportClosedError): void => {
    closed = err;
    clearTimeout(stableTimer);
    for (const w of waiters.splice(0)) w.reject(err);
  };
  const lost = (): void => {
    for (const cb of lossCbs) cb();
  };
  const bounded = (q: unknown[], item: never): void => {
    if (q.length >= MAX_BUFFERED) q.shift();
    q.push(item);
  };

  const scheduleReconnect = (): void => {
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;
    attempts += 1;
    setTimeout(() => {
      if (!closed) connect();
    }, delay);
  };

  const connect = (): void => {
    joined = false;
    let sock: WebSocket;
    try {
      sock = new WebSocket(`${a.url}/v1/trade/${encodeURIComponent(a.code)}`);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onmessage = (ev: MessageEvent) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null) return;
      const m = msg as Record<string, unknown>;
      if (!joined) {
        if (m.type === 'challenge' && typeof m.challenge === 'string' && CHALLENGE_B64.test(m.challenge)) {
          const sig = sodium.crypto_sign_detached(joinMessage(a.code, a.role, m.challenge), a.me.signSecret);
          sock.send(JSON.stringify({ role: a.role, sig: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL) }));
        } else if (m.type === 'joined') {
          joined = true;
          stableTimer = setTimeout(() => {
            attempts = 0;
          }, STABLE_MS);
          for (const f of outbox.splice(0)) sock.send(f);
          if (everJoined) lost();
          everJoined = true;
        } else {
          sock.close(1000); // anything else before joining is not our relay speaking
        }
        return;
      }
      if (m.type === 'queue-full') {
        lost();
        return;
      }
      if ('type' in m) return; // other control frames; envelopes have no type key
      const w = waiters.shift();
      if (w) w.resolve(msg);
      else bounded(inbox, msg as never);
    };
    sock.onclose = (ev: CloseEvent) => {
      if (ws !== sock || closed) return;
      clearTimeout(stableTimer);
      if (FATAL.has(ev.code)) {
        finish(new TransportClosedError(ev.code));
        return;
      }
      scheduleReconnect();
    };
  };

  connect();
  return {
    send(e) {
      const frame = JSON.stringify(e);
      if (joined && ws?.readyState === WebSocket.OPEN) ws.send(frame);
      else bounded(outbox, frame as never);
    },
    next() {
      if (inbox.length > 0) return Promise.resolve(inbox.shift());
      if (closed) return Promise.reject(closed);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    onReconnect(cb) {
      lossCbs = [...lossCbs, cb];
    },
    close() {
      if (closed) return;
      finish(new TransportClosedError(1000));
      ws?.close(1000);
    },
  };
}
