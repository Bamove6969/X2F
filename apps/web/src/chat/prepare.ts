/**
 * Regtest e2e gap 5 (Plan 5 Tasks 15 and 20): registers a trade chat's identity when the device runs
 * the trade, not when the chat is opened.
 *
 * The moderation service attests a chat only once BOTH traders registered a chat identity for it
 * (apps/api internal `chat-work`), and a device used to register one only on its first chat sync,
 * that is, when its trader opened the chat panel. So the buyer could not send a payment proof (nor
 * the seller a payment package) until the other side had opened the chat. The escrow runtime now
 * calls this once its trade identity is registered (RuntimeDeps.prepareChat), in the same worker:
 * it opens the trade's chat (`POST /v1/trades/:code/chat`, as the panel does) and runs the chat
 * engine's `prepare`, the identity step of a sync and nothing else. No new key or format: the chat
 * identity, its proof and its registration are exactly the first sync's.
 *
 * Resolves when it is done or has nothing left to do: registered, another device holds the role, or
 * a final refusal (a 4xx other than 401, 408 and 429: no such chat, a block, a purge, a chat the
 * trade cannot have). Opening the chat later still runs the same step. Throws for anything that may
 * pass (no answer, 5xx, 401, 408, 429, an engine that would not start), so the runtime tries again.
 */
import type { ChatEngine } from './engine.js';

const PASSING = new Set([401, 408, 429]);

function isFinal(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && !PASSING.has(status);
}

export function tradeChatPreparer(o: { openTradeChat: (code: string) => Promise<string>; engine: () => Promise<Pick<ChatEngine, 'prepare'>> }): (code: string) => Promise<void> {
  return async (code) => {
    try {
      const chat = await o.openTradeChat(code);
      await (await o.engine()).prepare(chat);
    } catch (e) {
      if (isFinal(e)) return;
      throw e;
    }
  };
}
