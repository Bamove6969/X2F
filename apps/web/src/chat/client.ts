/**
 * The page's handle on the chat engine in the escrow worker (Task 20), and the two plain API calls
 * the page makes itself: opening a chat on an offer, and finding a trade's chat.
 */
import type { ProofAttachedPayload, ProofUnblurredPayload } from '@x2f/proof';
import type { PayDetailsPayload } from '@x2f/trade';
import { api } from '../api/client.js';
import { escrowWorker } from '../escrow/useEscrow.js';
import type { ChatSnapshot } from './engine.js';
import type { ChatNoticeId } from './notices.js';
import type { ChatFailure, FromChatWorker, ToChatWorker } from './serve.js';

export type { ChatLine, ChatSnapshot } from './engine.js';
export type { ChatFailure } from './serve.js';

export class ChatFailed extends Error {
  constructor(readonly code: ChatFailure) {
    super(code);
    this.name = 'ChatFailed';
  }
}

export interface ChatClient {
  sync(chat: string): Promise<ChatSnapshot>;
  send(chat: string, text: string): Promise<ChatSnapshot>;
  /** The payee's packaged payment details (J-08): sealed in the worker like any line. */
  sendPay(chat: string, pay: PayDetailsPayload): Promise<ChatSnapshot>;
  /** Plan 5 Task 15: the proof's `proof.attached` (its key), sealed in the worker. */
  sendProof(chat: string, proof: ProofAttachedPayload): Promise<ChatSnapshot>;
  /** Plan 5 Task 15: the moderator's unblurred copy's `proof.unblurred` (its key), sealed in the worker to the moderator only. */
  sendUnblurred(chat: string, proof: ProofUnblurredPayload): Promise<ChatSnapshot>;
  /** A fixed notice (P-020), sealed in the worker. NEEDS_PLAN_5_TASK_15: the BlurEditor calls it. */
  sendNotice(chat: string, notice: ChatNoticeId): Promise<ChatSnapshot>;
  /** Build task 6: the trader's signed dispute grant (made in the worker), for the dispute request. */
  grant?(chat: string, disputeAt: string): Promise<unknown>;
}

/** A ChatClient over a worker speaking serve.ts's protocol. */
export function workerChatClient(w: Pick<Worker, 'postMessage' | 'addEventListener'>): ChatClient {
  const waiting = new Map<number, { resolve: (s: never) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  w.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as FromChatWorker | null;
    if (m?.t !== 'chat') return;
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    if (m.ok) p.resolve(('grant' in m ? m.grant : m.snapshot) as never);
    else p.reject(new ChatFailed(m.error));
  });
  const ask = <T = ChatSnapshot>(m: Omit<ToChatWorker, 'id'>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve: resolve as (s: never) => void, reject });
      w.postMessage({ ...m, id } as ToChatWorker);
    });
  return {
    sync: (chat) => ask({ t: 'chat-sync', chat }),
    send: (chat, text) => ask({ t: 'chat-send', chat, text } as Omit<ToChatWorker, 'id'>),
    sendPay: (chat, pay) => ask({ t: 'chat-send-pay', chat, pay } as Omit<ToChatWorker, 'id'>),
    sendProof: (chat, proof) => ask({ t: 'chat-send-proof', chat, proof } as Omit<ToChatWorker, 'id'>),
    sendUnblurred: (chat, proof) => ask({ t: 'chat-send-unblurred', chat, proof } as Omit<ToChatWorker, 'id'>),
    sendNotice: (chat, notice) => ask({ t: 'chat-send-notice', chat, notice } as Omit<ToChatWorker, 'id'>),
    grant: (chat, disputeAt) => ask<unknown>({ t: 'chat-grant', chat, disputeAt } as Omit<ToChatWorker, 'id'>),
  };
}

let client: ChatClient | null = null;

/** Sets the client (a test); `null` drops it. */
export function setChatClient(c: ChatClient | null): void {
  client = c;
}

export function chatClient(): ChatClient {
  client ??= workerChatClient(escrowWorker());
  return client;
}

/** `POST /v1/chats { offerId }`: the caller's open chat on this offer (made on first use). */
export async function openOfferChat(offerId: string): Promise<string> {
  const r = await api<{ chat?: unknown }>('/v1/chats', { method: 'POST', body: { offerId } });
  if (typeof r?.chat !== 'string') throw new ChatFailed('unavailable');
  return r.chat;
}

/** `POST /v1/trades/:code/chat`: the trade's chat (the one the take linked, or made on first use). */
export async function openTradeChat(code: string): Promise<string> {
  const r = await api<{ chat?: unknown }>(`/v1/trades/${encodeURIComponent(code)}/chat`, { method: 'POST', body: {} });
  if (typeof r?.chat !== 'string') throw new ChatFailed('unavailable');
  return r.chat;
}
