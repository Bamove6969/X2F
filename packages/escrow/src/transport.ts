import type { Role } from '@x2f/core';
import { joinMessage, type Envelope, type Identity } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';

/** Moves sealed envelopes to and from the relay. Delivery is at most once. */
export interface Transport {
  send(e: Envelope): void;
  /** The next frame from a peer, as untrusted data for open(). */
  next(): Promise<unknown>;
  /** Called after each reconnect, so the caller can resend what may have been lost. */
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

/**
 * A relay connection for one role in one trade, using the platform WebSocket (browsers,
 * Node 22). Answers the signed join challenge, reconnects with backoff, and holds
 * outgoing envelopes until joined.
 */
export function wsTransport(a: { url: string; code: string; role: Role; me: Identity }): Transport {
  const inbox: unknown[] = [];
  const waiters: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const outbox: string[] = [];
  let reconnectCbs: (() => void)[] = [];
  let ws: WebSocket | undefined;
  let joined = false;
  let closed: TransportClosedError | undefined;
  let attempts = 0;
  let everJoined = false;

  const finish = (err: TransportClosedError): void => {
    closed = err;
    for (const w of waiters.splice(0)) w.reject(err);
  };

  const connect = (): void => {
    joined = false;
    const sock = new WebSocket(`${a.url}/v1/trade/${a.code}`);
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
        if (m.type === 'challenge' && typeof m.challenge === 'string') {
          const sig = sodium.crypto_sign_detached(joinMessage(a.code, a.role, m.challenge), a.me.signSecret);
          sock.send(JSON.stringify({ role: a.role, sig: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL) }));
        } else if (m.type === 'joined') {
          joined = true;
          attempts = 0;
          for (const f of outbox.splice(0)) sock.send(f);
          if (everJoined) for (const cb of reconnectCbs) cb();
          everJoined = true;
        }
        return;
      }
      if ('type' in m) return; // control frames (e.g. queue-full); envelopes have no type key
      const w = waiters.shift();
      if (w) w.resolve(msg);
      else inbox.push(msg);
    };
    sock.onclose = (ev: CloseEvent) => {
      if (ws !== sock || closed) return;
      if (FATAL.has(ev.code)) {
        finish(new TransportClosedError(ev.code));
        return;
      }
      const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;
      attempts += 1;
      setTimeout(() => {
        if (!closed) connect();
      }, delay);
    };
  };

  connect();
  return {
    send(e) {
      const frame = JSON.stringify(e);
      if (joined && ws?.readyState === WebSocket.OPEN) ws.send(frame);
      else outbox.push(frame);
    },
    next() {
      if (inbox.length > 0) return Promise.resolve(inbox.shift());
      if (closed) return Promise.reject(closed);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    onReconnect(cb) {
      reconnectCbs = [...reconnectCbs, cb];
    },
    close() {
      if (closed) return;
      finish(new TransportClosedError(1000));
      ws?.close(1000);
    },
  };
}
