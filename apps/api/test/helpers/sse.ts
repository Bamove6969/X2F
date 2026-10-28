import { request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

/** One open `GET /v1/events` over a real socket (inject cannot hold a stream open). */
export interface SseStream {
  status: number;
  headers: IncomingHttpHeaders;
  /** Every `data:` payload received so far, parsed as JSON. */
  events: unknown[];
  /** Every raw chunk, comments (heartbeats) included. */
  raw: string[];
  /** The JSON body of a refused (non-200) answer. */
  body: unknown;
  ended: Promise<void>;
  /** Resolves when `pred` holds for a received event; rejects after `ms`. */
  waitFor(pred: (ev: unknown) => boolean, ms?: number): Promise<unknown>;
  waitForRaw(pred: (chunk: string) => boolean, ms?: number): Promise<void>;
  close(): void;
}

export function serverUrl(app: FastifyInstance): string {
  const a = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${a.port}`;
}

export function openEvents(app: FastifyInstance, cookies: Record<string, string>): Promise<SseStream> {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new Promise((resolve, reject) => {
    const req = request(`${serverUrl(app)}/v1/events`, { headers: cookie ? { cookie } : {} }, (res) => {
      const events: unknown[] = [];
      const raw: string[] = [];
      const listeners = new Set<() => void>();
      let buffer = '';
      let text = '';
      const ended = new Promise<void>((done) => {
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      });
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        raw.push(chunk);
        if (res.statusCode !== 200) {
          text += chunk;
          return;
        }
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
          }
        }
        for (const l of [...listeners]) l();
      });
      const s: SseStream = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        events,
        raw,
        body: null,
        ended,
        waitFor(pred, ms = 1000) {
          return new Promise((ok, fail) => {
            const check = () => {
              const hit = events.find(pred);
              if (hit !== undefined) {
                listeners.delete(check);
                clearTimeout(t);
                ok(hit);
              }
            };
            const t = setTimeout(() => {
              listeners.delete(check);
              fail(new Error('sse: no matching event in time'));
            }, ms);
            listeners.add(check);
            check();
          });
        },
        waitForRaw(pred, ms = 1000) {
          return new Promise((ok, fail) => {
            const check = () => {
              if (raw.some(pred)) {
                listeners.delete(check);
                clearTimeout(t);
                ok();
              }
            };
            const t = setTimeout(() => {
              listeners.delete(check);
              fail(new Error('sse: no matching chunk in time'));
            }, ms);
            listeners.add(check);
            check();
          });
        },
        close() {
          req.destroy();
        },
      };
      if (res.statusCode !== 200) {
        void ended.then(() => {
          s.body = text ? JSON.parse(text) : null;
          resolve(s);
        });
      } else {
        resolve(s);
      }
    });
    req.on('error', reject);
    req.end();
  });
}

/** Waits until `cond()` holds (polling every 5 ms), or fails after `ms`. */
export async function until(cond: () => boolean, ms = 1000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}
