/**
 * The chat-key half of the escrow worker's message protocol (J-23, S-075 phase 1 groundwork): the
 * page asks the ACK keeper (chat/ack.ts) for this device's public key, its key status, a sealed box
 * for another device, or to open a box the API served. The page gets back hex public keys,
 * base64url ciphertext and words; no key, in any form, crosses postMessage. No screen sends these
 * yet (the handover gesture waits for owner p12-5): the page side is wired when the boards exist.
 *
 * J-23 review F2 (lead 10 Nov): `chat-key-make` and `chat-key-seal` are answered `refused` and do
 * nothing. Sealing the key to a key the page names would let any script in the page get the key
 * sealed to itself, and making one would fork the account's key. They come back only when the
 * worker checks the recipient itself (the commit and code of the design note, section 3.3); the
 * keeper's `makeKey` and `sealFor` stay, called directly by tests.
 */
import type { AckKeeper, AckOpenResult } from './ack.js';

export type ToChatKeysWorker =
  | { t: 'chat-key-device'; id: number }
  | { t: 'chat-key-status'; id: number }
  /** Refused (review F2): kept in the union so the page's old shape type-checks and is answered. */
  | { t: 'chat-key-make'; id: number; epoch: number }
  | { t: 'chat-key-seal'; id: number; recipientPublic: string }
  | { t: 'chat-key-open'; id: number; sealed: string; epoch: number }
  | { t: 'chat-key-forget'; id: number };

export type ChatKeysFailure = 'bad-request' | 'unavailable' | 'refused';

/** Messages the worker refuses outright (review F2), until it checks the recipient itself. */
const REFUSED = new Set(['chat-key-make', 'chat-key-seal']);

export type FromChatKeysWorker =
  | { t: 'chat-key'; id: number; ok: true; devicePublic: string }
  | { t: 'chat-key'; id: number; ok: true; hasKey: boolean; epoch: number | null }
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
    if (REFUSED.has(m.t)) return fail('refused');
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
