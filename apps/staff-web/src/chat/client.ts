import { CHAT_KEY_ERROR_CODES, ChatKeyError, type CaseChatAnswer, type ChatKeyErrorCode, type ChatView, type DevicePublic, type Lane, type SealedModMessage } from './types.js';

/**
 * Design build task 10: the page's side of the chat key worker (keys/chatWorker.ts). The page asks
 * and is answered; it never holds a chat key or a device secret, and imports none of the code that
 * does (test/workerBoundary.test.ts). A refusal arrives as a `ChatKeyError` with its code.
 */
export interface ChatKeys {
  /** This browser's device key, its public halves (made and stored in the worker on first use). */
  device(): Promise<DevicePublic>;
  /** Verifies and decrypts the API's answer in the worker; the chat's key stays there under `handle`. */
  open(answer: CaseChatAnswer): Promise<ChatView>;
  /**
   * Seals `text` under the opened chat's key at `seq`, countersigned by this device, dated `now`.
   * With `to`: a private message to that trader only (its lane's key; `seq` is that lane's).
   */
  seal(handle: string, text: string, now: Date, seq: number, to?: Lane): Promise<SealedModMessage>;
  /**
   * Owner 27 Nov (follow-up): seals the lane control message `{type: 'chat.mode', payload: {on}}` to
   * trader `to` (its lane's key; `seq` is that lane's), countersigned by this device, dated `now`.
   */
  sealMode(handle: string, to: Lane, on: boolean, now: Date, seq: number): Promise<SealedModMessage>;
  /** Wipes the opened chat's key in the worker. */
  forget(handle: string): void;
}

/** A message endpoint (a Worker, or a test's pair). */
export interface Endpoint {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

/** Talks to a chat key worker on `ep`. `fail` refuses everything waiting and everything after (the worker died). */
export function connectChatKeys(ep: Endpoint): ChatKeys & { fail(code: ChatKeyErrorCode): void } {
  let dead: ChatKeyErrorCode | null = null;
  let next = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  ep.addEventListener('message', (e) => {
    const m = e.data as { id?: unknown; ok?: unknown; value?: unknown; code?: unknown } | null;
    if (typeof m !== 'object' || m === null || typeof m.id !== 'number') return;
    const w = waiting.get(m.id);
    if (w === undefined) return;
    waiting.delete(m.id);
    if (m.ok === true) w.resolve(m.value);
    else w.reject(new ChatKeyError(typeof m.code === 'string' && (CHAT_KEY_ERROR_CODES as readonly string[]).includes(m.code) ? (m.code as ChatKeyErrorCode) : 'fault'));
  });
  const ask = <T>(op: string, args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (dead !== null) {
        reject(new ChatKeyError(dead));
        return;
      }
      const id = next++;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        ep.postMessage({ id, op, args });
      } catch {
        waiting.delete(id);
        reject(new ChatKeyError('fault'));
      }
    });
  return {
    device: () => ask<DevicePublic>('device', []),
    open: (answer) => ask<ChatView>('open', [answer]),
    seal: (handle, text, now, seq, to) => ask<SealedModMessage>('seal', to === undefined ? [handle, text, now.toISOString(), seq] : [handle, text, now.toISOString(), seq, to]),
    sealMode: (handle, to, on, now, seq) => ask<SealedModMessage>('seal-mode', [handle, to, on, now.toISOString(), seq]),
    forget: (handle) => void ask('forget', [handle]).catch(() => undefined),
    fail(code) {
      dead = code;
      for (const w of waiting.values()) w.reject(new ChatKeyError(code));
      waiting.clear();
    },
  };
}

let browser: ChatKeys | null = null;

/** This page's one chat key worker, started on first use. No Worker (an old browser, a test): every call is `unavailable`. */
export function browserChatKeys(): ChatKeys {
  if (browser !== null) return browser;
  let worker: Worker;
  try {
    worker = new Worker(new URL('../keys/chatWorker.ts', import.meta.url), { type: 'module', name: 'x2f-chat-keys' });
  } catch {
    const no = () => Promise.reject(new ChatKeyError('unavailable'));
    return { device: no, open: no, seal: no, sealMode: no, forget: () => undefined };
  }
  const keys = connectChatKeys(worker as unknown as Endpoint);
  // A worker that cannot start or dies: every call waiting, and every call after, is refused.
  worker.addEventListener('error', () => keys.fail('unavailable'));
  // The page going away wipes every chat key the worker holds (the worker ends with it).
  globalThis.addEventListener?.('pagehide', () => worker.postMessage({ id: 0, op: 'forget-all', args: [] }));
  browser = keys;
  return keys;
}
