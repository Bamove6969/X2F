/**
 * The chat-key half of the escrow worker's message protocol (J-23, S-075 phase 1 groundwork): the
 * page asks the ACK keeper (chat/ack.ts) for this device's public key, its key status, a sealed box
 * for another device, or to open a box the API served. The page gets back hex public keys,
 * base64url ciphertext and words; no key, in any form, crosses postMessage. No screen sends these
 * yet (the handover gesture waits for owner p12-5): the page side is wired when the boards exist.
 */
import type { AckKeeper, AckOpenResult } from './ack.js';

export type ToChatKeysWorker =
  | { t: 'chat-key-device'; id: number }
  | { t: 'chat-key-status'; id: number }
  | { t: 'chat-key-make'; id: number; epoch: number }
  | { t: 'chat-key-seal'; id: number; recipientPublic: string }
  | { t: 'chat-key-open'; id: number; sealed: string; epoch: number }
  | { t: 'chat-key-forget'; id: number };

export type ChatKeysFailure = 'no-key' | 'bad-request' | 'unavailable';

export type FromChatKeysWorker =
  | { t: 'chat-key'; id: number; ok: true; devicePublic: string }
  | { t: 'chat-key'; id: number; ok: true; hasKey: boolean; epoch: number | null }
  | { t: 'chat-key'; id: number; ok: true; epoch: number }
  | { t: 'chat-key'; id: number; ok: true; sealed: string; epoch: number }
  | { t: 'chat-key'; id: number; ok: true; result: AckOpenResult }
  | { t: 'chat-key'; id: number; ok: true }
  | { t: 'chat-key'; id: number; ok: false; error: ChatKeysFailure };

export interface ChatKeysPort {
  postMessage(m: FromChatKeysWorker): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
}

const KINDS = new Set(['chat-key-device', 'chat-key-status', 'chat-key-make', 'chat-key-seal', 'chat-key-open', 'chat-key-forget']);
const HEX_KEY = /^[0-9a-f]{64}$/;

/** Answers the page's chat-key messages with `keeper` (made once `makeKeeper` resolves; a failed start is retried on the next message). */
export function serveChatKeys(port: ChatKeysPort, makeKeeper: () => Promise<AckKeeper>): void {
  let keeper: Promise<AckKeeper> | null = null;
  const get = (): Promise<AckKeeper> => {
    keeper ??= makeKeeper();
    keeper.catch(() => (keeper = null));
    return keeper;
  };
  port.addEventListener('message', (e) => {
    const m = e.data as Partial<ToChatKeysWorker> | null;
    if (typeof m !== 'object' || m === null || typeof m.t !== 'string' || !KINDS.has(m.t) || typeof m.id !== 'number') return;
    const id = m.id;
    const fail = (error: ChatKeysFailure) => port.postMessage({ t: 'chat-key', id, ok: false, error });
    void (async () => {
      let k: AckKeeper;
      try {
        k = await get();
      } catch {
        return fail('unavailable');
      }
      try {
        switch (m.t) {
          case 'chat-key-device':
            return port.postMessage({ t: 'chat-key', id, ok: true, devicePublic: await k.devicePublic() });
          case 'chat-key-status': {
            const s = await k.status();
            return port.postMessage({ t: 'chat-key', id, ok: true, hasKey: s.hasKey, epoch: s.epoch });
          }
          case 'chat-key-make': {
            if (typeof m.epoch !== 'number' || !Number.isInteger(m.epoch) || m.epoch < 0) return fail('bad-request');
            return port.postMessage({ t: 'chat-key', id, ok: true, epoch: (await k.makeKey(m.epoch)).epoch });
          }
          case 'chat-key-seal': {
            if (typeof m.recipientPublic !== 'string' || !HEX_KEY.test(m.recipientPublic)) return fail('bad-request');
            const out = await k.sealFor(m.recipientPublic);
            if (out === null) return fail('no-key');
            return port.postMessage({ t: 'chat-key', id, ok: true, sealed: out.sealed, epoch: out.epoch });
          }
          case 'chat-key-open': {
            if (typeof m.sealed !== 'string' || typeof m.epoch !== 'number') return fail('bad-request');
            return port.postMessage({ t: 'chat-key', id, ok: true, result: await k.open({ sealed: m.sealed, epoch: m.epoch }) });
          }
          case 'chat-key-forget':
            await k.forget();
            return port.postMessage({ t: 'chat-key', id, ok: true });
          default:
            return fail('bad-request');
        }
      } catch {
        return fail('unavailable');
      }
    })();
  });
}
