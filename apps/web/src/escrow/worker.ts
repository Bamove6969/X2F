/**
 * The escrow Web Worker: runs the escrow runtime (identities, wallet passwords, monero-ts,
 * runParty) off the page. The page only ever gets status objects (phase, error, check words,
 * keepOpen, role) and sends start/act/stop requests; no secret crosses postMessage.
 *
 * `serveEscrow` is the message handler, kept apart from the worker's own start-up so it can be
 * tested without a Worker.
 */
import { MoneroMultisigEngine, runParty, wsTransport, type EscrowNetwork } from '@x2f/escrow';
import { generateIdentity } from '@x2f/protocol';
import { httpEscrowApi } from './adapters.js';
import { createEscrowRuntime, type ConfirmedTrade, type EscrowAction, type EscrowRuntime, type EscrowStatus, type RuntimeDeps } from './runtime.js';
import { openEscrowStore } from './store.js';

export type ToWorker =
  | { t: 'start'; code: string; confirmed?: ConfirmedTrade }
  | { t: 'resume-all' }
  | { t: 'act'; id: number; code: string; action: EscrowAction }
  | { t: 'retry'; code: string }
  | { t: 'stop'; code: string };

export type FromWorker = { t: 'status'; code: string; status: EscrowStatus } | { t: 'acted'; id: number; ok: boolean };

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
  receivedAtomic: null,
  confirmedAtomic: null,
  paidRecorded: false,
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
    relayUrl: need('VITE_RELAY_URL'),
    daemonUri: need('VITE_NODE_PROXY_URL'),
    network,
  };
}

// Started only inside a dedicated worker (never when a test imports this module).
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: unknown };
if (typeof scope.WorkerGlobalScope !== 'undefined' && typeof scope.postMessage === 'function') {
  serveEscrow(globalThis as unknown as Port, async (onStatus) => {
    // Each key is named, so the build inlines only these five and never the whole env object
    // (which would carry VITE_FIXTURES and any other VITE_ variable into the production worker).
    const { network, ...config } = workerConfig({
      VITE_MONERO_NETWORK: import.meta.env.VITE_MONERO_NETWORK as string | undefined,
      VITE_MOD_SIGNING_PUBLIC: import.meta.env.VITE_MOD_SIGNING_PUBLIC as string | undefined,
      VITE_FEE_WALLET: import.meta.env.VITE_FEE_WALLET as string | undefined,
      VITE_RELAY_URL: import.meta.env.VITE_RELAY_URL as string | undefined,
      VITE_NODE_PROXY_URL: import.meta.env.VITE_NODE_PROXY_URL as string | undefined,
    });
    return createEscrowRuntime({
      api: httpEscrowApi(),
      store: await openEscrowStore(),
      config,
      engine: new MoneroMultisigEngine({ network }),
      newIdentity: generateIdentity,
      runParty,
      transport: wsTransport,
      onStatus,
    });
  });
}
