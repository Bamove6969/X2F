/**
 * The escrow Web Worker: runs the escrow runtime (identities, wallet passwords, monero-ts,
 * runParty) off the page, and the chat engine (Task 20: chat identities and seal/open; see
 * ../chat/serve.ts for its messages). The page only ever gets status objects (phase, error, check words,
 * keepOpen, role) and sends start/act/stop requests; no secret crosses postMessage.
 *
 * `serveEscrow` is the message handler, kept apart from the worker's own start-up so it can be
 * tested without a Worker.
 */
import { MoneroMultisigEngine, runParty, wsTransport, type EscrowNetwork } from '@x2f/escrow';
import { generateBoxKeyPair, generateIdentity } from '@x2f/protocol';
import { httpEscrowApi } from './adapters.js';
import { installMoneroWorker } from './moneroWorker.js';
import { createEscrowRuntime, type ConfirmedTrade, type EscrowAction, type EscrowRuntime, type EscrowStatus, type RuntimeDeps } from './runtime.js';
import { httpKeySyncApi, withKeySync } from './keySync.js';
import { openEscrowStore } from './store.js';
import type { RecoveryAddressStatement } from '@x2f/trade';
import { createAckKeeper } from '../chat/ack.js';
import { createChatEngine, type ChatEngine } from '../chat/engine.js';
import { httpChatApi, httpOpenTradeChat } from '../chat/http.js';
import { tradeChatPreparer } from '../chat/prepare.js';
import { chatConfig, serveChat, type ChatPort } from '../chat/serve.js';
import { serveChatKeys, type ChatKeysPort } from '../chat/serveKeys.js';
import { openChatStore, type ChatStore } from '../chat/store.js';

export type ToWorker =
  | { t: 'start'; code: string; confirmed?: ConfirmedTrade }
  | { t: 'resume-all' }
  | { t: 'act'; id: number; code: string; action: EscrowAction }
  | { t: 'retry'; code: string }
  | { t: 'stop'; code: string }
  // Lien recovery (Q2): the creditor's signed recovery address, with this device's identity in `code`.
  | { t: 'sign-recovery-address'; id: number; code: string; address: string; issuedAt: string };

export type FromWorker =
  | { t: 'status'; code: string; status: EscrowStatus }
  | { t: 'acted'; id: number; ok: boolean }
  | { t: 'signed-recovery-address'; id: number; signed: { statement: RecoveryAddressStatement; sig: string } | null };

export interface Port {
  postMessage(m: FromWorker): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
}

const ACTIONS = new Set(['release', 'build-refund', 'buyer-cancel', 'propose-cancel-sign', 'paid', 'signal']);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * The status every trade gets when the runtime could not be made (a build without its config, a
 * store that will not open): a stopped escrow, not endless "Setting up escrow" (landing review
 * Minor 3). Not retryable: the same worker would fail the same way.
 */
export const RUNTIME_FAILED: EscrowStatus = {
  phase: 'error',
  error: 'escrow-failed',
  retryable: false,
  refusal: null,
  checkWords: null,
  keepOpen: false,
  role: null,
  amountAtomic: null,
  fiatCents: null,
  escrowAddress: null,
  deal: null,
  methodId: null,
  paymentInstructions: null,
  instructionsMismatch: false,
  receivedAtomic: null,
  confirmedAtomic: null,
  paidRecorded: false,
  intentKind: null,
  handedOff: false,
};

/** Answers the page's messages with `runtime` (made once `makeRuntime` resolves). */
export function serveEscrow(port: Port, makeRuntime: (onStatus: (code: string, s: EscrowStatus) => void) => Promise<EscrowRuntime>): void {
  const runtime = (async () => makeRuntime((code, status) => port.postMessage({ t: 'status', code, status })))();
  runtime.catch(() => undefined);
  port.addEventListener('message', (e) => {
    const m = e.data;
    if (!isRecord(m) || typeof m.t !== 'string') return;
    void (async () => {
      let rt: EscrowRuntime;
      try {
        rt = await runtime;
      } catch {
        // No runtime: every trade the page starts is told so, and every action is refused.
        if ((m.t === 'start' || m.t === 'retry') && typeof m.code === 'string') port.postMessage({ t: 'status', code: m.code, status: RUNTIME_FAILED });
        if (m.t === 'act' && typeof m.id === 'number') port.postMessage({ t: 'acted', id: m.id, ok: false });
        if (m.t === 'sign-recovery-address' && typeof m.id === 'number') port.postMessage({ t: 'signed-recovery-address', id: m.id, signed: null });
        return;
      }
      switch (m.t) {
        case 'start':
          if (typeof m.code === 'string') await rt.start(m.code, (m.confirmed ?? undefined) as ConfirmedTrade | undefined).catch(() => undefined);
          return;
        case 'resume-all':
          await rt.resumeAll().catch(() => undefined);
          return;
        case 'stop':
          if (typeof m.code === 'string') await rt.stop(m.code);
          return;
        case 'retry':
          if (typeof m.code === 'string') await rt.retry(m.code).catch(() => undefined);
          return;
        case 'sign-recovery-address': {
          if (typeof m.id !== 'number') return;
          const ok = typeof m.code === 'string' && typeof m.address === 'string' && typeof m.issuedAt === 'string';
          const signed = ok && rt.signRecoveryAddress ? await rt.signRecoveryAddress(m.code as string, m.address as string, m.issuedAt as string).catch(() => null) : null;
          port.postMessage({ t: 'signed-recovery-address', id: m.id, signed });
          return;
        }
        case 'act': {
          if (typeof m.id !== 'number') return;
          const a = m.action;
          const ok = typeof m.code === 'string' && isRecord(a) && typeof a.type === 'string' && ACTIONS.has(a.type);
          if (!ok) return port.postMessage({ t: 'acted', id: m.id, ok: false });
          try {
            await rt.act(m.code as string, a as EscrowAction);
            port.postMessage({ t: 'acted', id: m.id, ok: true });
          } catch {
            port.postMessage({ t: 'acted', id: m.id, ok: false });
          }
        }
      }
    })().catch(() => undefined);
  });
}

/** The build config the worker needs; missing values fail closed (the runtime never starts). */
export function workerConfig(env: Record<string, string | undefined>): RuntimeDeps['config'] & { network: EscrowNetwork } {
  const need = (k: string): string => {
    const v = env[k];
    if (typeof v !== 'string' || v === '') throw new Error(`escrow worker: ${k} is not set`);
    return v;
  };
  const network = need('VITE_MONERO_NETWORK');
  if (network !== 'mainnet' && network !== 'stagenet' && network !== 'regtest') throw new Error('escrow worker: bad VITE_MONERO_NETWORK');
  return {
    modSigningPublic: need('VITE_MOD_SIGNING_PUBLIC'),
    feeWallet: need('VITE_FEE_WALLET'),
    payrollWallet: need('VITE_PAYROLL_WALLET'),
    relayUrl: need('VITE_RELAY_URL'),
    daemonUri: need('VITE_NODE_PROXY_URL'),
    network,
  };
}

// Started only inside a dedicated worker (never when a test imports this module).
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: unknown };
if (typeof scope.WorkerGlobalScope !== 'undefined' && typeof scope.postMessage === 'function') {
  // The chat runs whether or not the escrow config is complete; it needs only the moderation key.
  // One chat store for the engine and the chat-key keeper (J-23): both live in this worker. A store
  // that fails to open is tried again by the next message of either half (as before).
  let chatStore: Promise<ChatStore> | null = null;
  const sharedChatStore = (): Promise<ChatStore> => {
    chatStore ??= openChatStore();
    chatStore.catch(() => (chatStore = null));
    return chatStore;
  };
  // One chat engine for the page's chat messages and the escrow runtime's gap-5 step (prepareChat),
  // so both go through its one per-chat queue: two engines over one store could each make an
  // identity for the same chat. One that fails to start is made again on the next use.
  let chatEngine: Promise<ChatEngine> | null = null;
  const sharedChatEngine = (): Promise<ChatEngine> => {
    chatEngine ??= (async () =>
      createChatEngine({
        api: httpChatApi(),
        store: await sharedChatStore(),
        newIdentity: generateIdentity,
        // Named, never the whole env object (see below): only this one key is inlined.
        ...chatConfig({ VITE_MOD_SIGNING_PUBLIC: import.meta.env.VITE_MOD_SIGNING_PUBLIC as string | undefined }),
      }))();
    chatEngine.catch(() => (chatEngine = null));
    return chatEngine;
  };
  serveChat(globalThis as unknown as ChatPort, sharedChatEngine);
  // J-23 groundwork: the account chat key keeper (chat/ack.ts); keys never leave this worker.
  serveChatKeys(globalThis as unknown as ChatKeysPort, async () => createAckKeeper({ store: await sharedChatStore(), newBoxKeyPair: generateBoxKeyPair }));
  // Before any wallet exists: monero-ts's own wallet worker, served by this origin (moneroWorker.ts).
  installMoneroWorker();
  serveEscrow(globalThis as unknown as Port, async (onStatus) => {
    // Each key is named, so the build inlines only these five and never the whole env object
    // (which would carry VITE_FIXTURES and any other VITE_ variable into the production worker).
    const { network, ...config } = workerConfig({
      VITE_MONERO_NETWORK: import.meta.env.VITE_MONERO_NETWORK as string | undefined,
      VITE_MOD_SIGNING_PUBLIC: import.meta.env.VITE_MOD_SIGNING_PUBLIC as string | undefined,
      VITE_FEE_WALLET: import.meta.env.VITE_FEE_WALLET as string | undefined,
      VITE_PAYROLL_WALLET: import.meta.env.VITE_PAYROLL_WALLET as string | undefined,
      VITE_RELAY_URL: import.meta.env.VITE_RELAY_URL as string | undefined,
      VITE_NODE_PROXY_URL: import.meta.env.VITE_NODE_PROXY_URL as string | undefined,
    });
    return createEscrowRuntime({
      api: httpEscrowApi(),
      // Escrow-key sync (migration 860): each write also refreshes the end-to-end encrypted server copy.
      store: withKeySync(await openEscrowStore(), httpKeySyncApi()),
      config,
      engine: new MoneroMultisigEngine({ network }),
      newIdentity: generateIdentity,
      runParty,
      transport: wsTransport,
      // Gap 5: the trade chat's identity is registered when this device runs the trade.
      prepareChat: tradeChatPreparer({ openTradeChat: httpOpenTradeChat(), engine: sharedChatEngine }),
      onStatus,
    });
  });
}
