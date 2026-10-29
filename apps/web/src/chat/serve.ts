/**
 * The chat half of the escrow worker's message protocol (Task 20). The page asks for `chat-sync`
 * and `chat-send`; the worker answers with a ChatSnapshot of verified plain lines, or an error code.
 * No key, ciphertext or ChatState ever crosses postMessage.
 */
import { ChatSendFailed, type ChatEngine, type ChatSnapshot } from './engine.js';

export type ToChatWorker = { t: 'chat-sync'; id: number; chat: string } | { t: 'chat-send'; id: number; chat: string; text: string };

export type ChatFailure = 'not-ready' | 'bad-text' | 'too-large' | 'refused' | 'unavailable' | 'not-found';

export type FromChatWorker = { t: 'chat'; id: number; ok: true; snapshot: ChatSnapshot } | { t: 'chat'; id: number; ok: false; error: ChatFailure };

export interface ChatPort {
  postMessage(m: FromChatWorker): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
}

const CODE = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

function failure(e: unknown): ChatFailure {
  if (e instanceof ChatSendFailed) return e.code;
  const status = (e as { status?: unknown })?.status;
  if (status === 404) return 'not-found';
  return 'unavailable';
}

/** Answers the page's chat messages with `engine` (made once `makeEngine` resolves). */
export function serveChat(port: ChatPort, makeEngine: () => Promise<ChatEngine>): void {
  let engine: Promise<ChatEngine> | null = null;
  port.addEventListener('message', (e) => {
    const m = e.data as Partial<ToChatWorker> | null;
    if (typeof m !== 'object' || m === null || (m.t !== 'chat-sync' && m.t !== 'chat-send') || typeof m.id !== 'number') return;
    const id = m.id;
    void (async () => {
      try {
        if (typeof m.chat !== 'string' || !CODE.test(m.chat)) throw Object.assign(new Error('bad chat'), { status: 404 });
        engine ??= makeEngine();
        const eng = await engine;
        let snapshot: ChatSnapshot;
        if (m.t === 'chat-send') {
          if (typeof m.text !== 'string') throw new ChatSendFailed('bad-text');
          snapshot = await eng.send(m.chat, m.text);
        } else {
          snapshot = await eng.sync(m.chat);
        }
        port.postMessage({ t: 'chat', id, ok: true, snapshot });
      } catch (err) {
        // A failed start (no config, no IndexedDB) is retried on the next message.
        if (engine) await engine.catch(() => (engine = null));
        port.postMessage({ t: 'chat', id, ok: false, error: failure(err) });
      }
    })();
  });
}

/** The chat engine's build config; a missing key fails closed (no chat is opened or sealed). */
export function chatConfig(env: Record<string, string | undefined>): { modSigningPublic: string } {
  const v = env.VITE_MOD_SIGNING_PUBLIC;
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new Error('chat: VITE_MOD_SIGNING_PUBLIC is not set');
  return { modSigningPublic: v };
}
