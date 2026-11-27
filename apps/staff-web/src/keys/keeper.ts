import { cryptoReady } from '@x2f/protocol';
import type { AttestationKey } from '@x2f/trade';
import { CHAT_KEY_ERROR_CODES, type CaseChatAnswer, type ChatKeyErrorCode, type Lane, type ChatView, type DevicePublic, type SealedModMessage } from '../chat/types.js';
import { DeviceKeyError, staffDeviceKey, type DeviceKeyBackend, type StaffDeviceKey } from './deviceKey.js';
import { CaseChatError, forget, nextSeqByLane, openCaseChat, sealModeMessage, sealModMessage, type OpenedChat } from './reader.js';

/**
 * Design build task 10 (design section 2.4 M4; review lead-mod-chat N10): the staff-web chat key
 * worker's state. It uses this browser's device key (non-extractable WebCrypto keys, re-review B1:
 * no secret byte of it exists anywhere) and holds the key of every chat it opened (raw bytes, zeroed
 * on `forget`; copies in libsodium's WebAssembly heap are not).
 * What goes back to the page: the device's public halves, an opened chat's lines (plaintext to
 * show) under an opaque handle, and a sealed, countersigned message (ciphertext to post). Never a
 * chat key, a wrap opened, a device secret or anything they could be rebuilt from.
 *
 * The pinned moderation keys are the worker's own (its build's VITE_MOD_SIGNING_PUBLIC), never the
 * page's word. What the page asks is checked here as if it came from anyone: a page script (an XSS,
 * an extension) can still ask this worker to open a chat it is given or to seal a text, as the
 * moderator could, but it can never take the keys away with it.
 */

/**
 * How far the page's clock (the server-corrected time it seals at) may be from this worker's own.
 * Builder's call (review N10): a countersign is good for 5 minutes from its issuedAt, so a page
 * script that could pick any issuedAt could make one now for use much later; this bounds that.
 */
export const SEAL_CLOCK_SKEW_MS = 10 * 60_000;

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HANDLE = /^[0-9a-f]{32}$/;

export class ChatKeeper {
  readonly #backend: DeviceKeyBackend;
  readonly #modKeys: readonly AttestationKey[];
  readonly #now: () => number;
  readonly #ready: () => Promise<void>;
  readonly #chats = new Map<string, OpenedChat>();
  #device: Promise<StaffDeviceKey> | null = null;

  constructor(o: { backend: DeviceKeyBackend; modKeys: readonly AttestationKey[]; now?: () => number; ready?: () => Promise<void> }) {
    this.#backend = o.backend;
    this.#modKeys = o.modKeys;
    this.#now = o.now ?? Date.now;
    this.#ready = o.ready ?? cryptoReady;
  }

  async #load(): Promise<StaffDeviceKey> {
    // The crypto library first: where it cannot load (its WebAssembly refused), say so, distinctly.
    try {
      await this.#ready();
    } catch {
      throw new KeeperError('crypto-unavailable');
    }
    return staffDeviceKey(this.#backend);
  }

  #key(): Promise<StaffDeviceKey> {
    // Made or loaded once; a failure is tried again on the next call.
    this.#device ??= this.#load().catch((e: unknown) => {
      this.#device = null;
      throw e;
    });
    return this.#device;
  }

  /** How many opened chats this worker holds a key for. */
  get size(): number {
    return this.#chats.size;
  }

  async device(): Promise<DevicePublic> {
    const k = await this.#key();
    return { deviceKeyId: k.deviceKeyId, signPublic: k.signPublic, boxPublic: k.boxPublic };
  }

  async open(answer: CaseChatAnswer): Promise<ChatView> {
    const k = await this.#key();
    const c = await openCaseChat(answer, k, this.#modKeys);
    const h = new Uint8Array(16);
    globalThis.crypto.getRandomValues(h);
    const handle = Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
    this.#chats.set(handle, c);
    return { handle, nextSeq: c.nextSeq, nextSeqByLane: nextSeqByLane(c), lines: c.lines, unreadable: c.unreadable, missing: c.missing, olderNotShown: c.olderNotShown };
  }

  /** Seals `text` at `seq`: to both traders, or with `to` privately to that trader (its lane's key and seq). */
  async seal(handle: string, text: string, issuedAt: string, seq: number, to?: Lane | null): Promise<SealedModMessage> {
    const c = this.#opened(handle);
    const at = this.#at(issuedAt, seq);
    if (to !== undefined && to !== null && to !== 'buyer' && to !== 'seller') throw new KeeperError('unreadable');
    const lane = to ?? undefined;
    const sealed = await sealModMessage(c, text, await this.#key(), new Date(at), seq, lane);
    const l = lane === undefined ? c : c.lanes[lane]!;
    if (seq >= l.nextSeq) l.nextSeq = seq + 1;
    return sealed;
  }

  /**
   * Owner 27 Nov (follow-up): seals the lane control message `{type: 'chat.mode', payload: {on}}`
   * in lane `to` at that lane's `seq` (v3, the lane countersign), as `seal` does a lane message.
   */
  async sealMode(handle: string, to: Lane, on: boolean, issuedAt: string, seq: number): Promise<SealedModMessage> {
    const c = this.#opened(handle);
    const at = this.#at(issuedAt, seq);
    if ((to !== 'buyer' && to !== 'seller') || typeof on !== 'boolean') throw new KeeperError('unreadable');
    const sealed = await sealModeMessage(c, to, on, await this.#key(), new Date(at), seq);
    const l = c.lanes[to]!;
    if (seq >= l.nextSeq) l.nextSeq = seq + 1;
    return sealed;
  }

  #opened(handle: string): OpenedChat {
    const c = typeof handle === 'string' && HANDLE.test(handle) ? this.#chats.get(handle) : undefined;
    if (c === undefined) throw new KeeperError('gone');
    return c;
  }

  /** The page's issuedAt, within SEAL_CLOCK_SKEW_MS of this worker's clock, and a seq. */
  #at(issuedAt: string, seq: number): number {
    const at = typeof issuedAt === 'string' && ISO_MS.test(issuedAt) ? Date.parse(issuedAt) : Number.NaN;
    if (!Number.isFinite(at) || Math.abs(at - this.#now()) > SEAL_CLOCK_SKEW_MS || !Number.isSafeInteger(seq) || seq < 0) throw new KeeperError('unreadable');
    return at;
  }

  /** Wipes and drops an opened chat's keys (the chat key and every lane key). */
  forget(handle: string): void {
    const c = typeof handle === 'string' ? this.#chats.get(handle) : undefined;
    if (c === undefined) return;
    forget(c);
    this.#chats.delete(handle);
  }

  /** Wipes and drops every key it holds for a chat. */
  forgetAll(): void {
    for (const h of [...this.#chats.keys()]) this.forget(h);
  }
}

class KeeperError extends Error {
  constructor(readonly code: ChatKeyErrorCode) {
    super(code);
  }
}

/** One message endpoint: a Worker, the worker's own scope, or a test's pair. */
export interface Endpoint {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

/** A request from the page: `{ id, op, args }`. */
export type KeeperOp = 'device' | 'open' | 'seal' | 'seal-mode' | 'forget' | 'forget-all';
export type KeeperReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; code: ChatKeyErrorCode };

function codeOf(e: unknown): ChatKeyErrorCode {
  if (e instanceof KeeperError) return e.code;
  if (e instanceof CaseChatError) return e.code;
  if (e instanceof DeviceKeyError) return e.code;
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && (CHAT_KEY_ERROR_CODES as readonly string[]).includes(c) ? (c as ChatKeyErrorCode) : 'fault';
}

/** Answers the page's requests on `ep` from `keeper`; an error answers with a code only. */
export function serveChatKeeper(keeper: ChatKeeper, ep: Endpoint): void {
  ep.addEventListener('message', (e) => {
    const m = e.data as { id?: unknown; op?: unknown; args?: unknown } | null;
    if (typeof m !== 'object' || m === null || typeof m.id !== 'number' || !Array.isArray(m.args)) return;
    const id = m.id;
    const a = m.args as unknown[];
    const run = async (): Promise<unknown> => {
      switch (m.op as KeeperOp) {
        case 'device':
          return keeper.device();
        case 'open':
          return keeper.open(a[0] as CaseChatAnswer);
        case 'seal':
          return keeper.seal(a[0] as string, a[1] as string, a[2] as string, a[3] as number, a[4] as Lane | null | undefined);
        case 'seal-mode':
          return keeper.sealMode(a[0] as string, a[1] as Lane, a[2] as boolean, a[3] as string, a[4] as number);
        case 'forget':
          keeper.forget(a[0] as string);
          return null;
        case 'forget-all':
          keeper.forgetAll();
          return null;
        default:
          throw new KeeperError('fault');
      }
    };
    run().then(
      (value) => ep.postMessage({ id, ok: true, value } satisfies KeeperReply),
      (err: unknown) => ep.postMessage({ id, ok: false, code: codeOf(err) } satisfies KeeperReply),
    );
  });
}
