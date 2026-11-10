import { LibraryUtils } from 'monero-ts';
import { DAEMON_TIMEOUT_MS } from './engine.js';

/**
 * The HTTP client monero-ts's WebAssembly wallet uses when it runs in-process (not in monero-ts's
 * worker): its glue (`js_send_json_request` / `js_send_binary_request` in monero-ts/dist/monero.js)
 * calls `HttpClient.createCancelToken()` and `HttpClient.request({...})` on the global object.
 *
 * Only a resumed REGTEST wallet runs in-process (monero-ts 0.11.16 drops the regtest flag when its
 * worker reopens wallet data; see MoneroMultisigEngine.resume). In the web app's bundle monero-ts
 * never sets that global (`typeof require` is undefined there) and its own client cannot send
 * anyway (its Node `http`/`https` imports are an empty module), so a regtest page reloaded
 * mid-trade could never sync its escrow wallet (demo, 10 Nov). This client is a plain `fetch`, the
 * same in Node and in the browser. No digest auth and no SOCKS proxy (the node proxy needs
 * neither; asking for them fails the request). Every request gives up after DAEMON_TIMEOUT_MS.
 */
export interface WasmHttpRequest {
  method: string;
  uri: string;
  username?: string;
  password?: string;
  /** JSON-RPC text, or the bytes of a binary (`.bin`) request. */
  body?: string | Uint8Array;
  proxyUri?: string;
  cancelToken?: AbortSignal;
}

export interface WasmHttpResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  /** Text for a text request, bytes for a binary one (the glue reads them from the heap). */
  body: string | Uint8Array;
}

/** The origins of the configured daemon URIs: the only places an in-process wallet may ask (re-verify R1). */
const allowed = new Set<string>();

function originOf(uri: string): string | null {
  try {
    const o = new URL(uri).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

/** Allow requests to this configured daemon URI's origin (scheme, host and port). */
export function allowDaemonOrigin(daemonUri: string): void {
  const o = originOf(daemonUri);
  if (o === null) throw new Error('in-process wallet: the daemon URI has no origin');
  allowed.add(o);
}

export const inProcessHttp = {
  createCancelToken(): { token: AbortSignal; cancel: (reason?: string) => void } {
    const c = new AbortController();
    return { token: c.signal, cancel: (reason?: string) => c.abort(new Error(reason ?? 'cancelled')) };
  },

  async request(r: WasmHttpRequest): Promise<WasmHttpResponse> {
    if (r.proxyUri) throw new Error('in-process wallet: proxied requests are not supported');
    if (r.username || r.password) throw new Error('in-process wallet: daemon authentication is not supported');
    const origin = originOf(r.uri);
    if (origin === null || !allowed.has(origin)) throw new Error('in-process wallet: not the configured daemon');
    const binary = r.body instanceof Uint8Array;
    const signals = [AbortSignal.timeout(DAEMON_TIMEOUT_MS), ...(r.cancelToken ? [r.cancelToken] : [])];
    const res = await fetch(r.uri, {
      method: r.method,
      // As monero-ts's own client sends every request (the node proxy's CORS allows exactly this).
      headers: { 'content-type': 'application/json' },
      ...(r.body === undefined ? {} : { body: r.body as BodyInit }),
      signal: AbortSignal.any(signals),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return {
      statusCode: res.status,
      statusText: res.statusText,
      headers,
      body: binary ? new Uint8Array(await res.arrayBuffer()) : await res.text(),
    };
  },
};

/**
 * Point in-process wallets at `inProcessHttp`, allowed to ask only `daemonUri`'s origin (and those
 * of earlier calls: one process may resume several sessions on the same node). monero-ts sets the
 * global itself once, when its WebAssembly module first loads (in Node only), so the module is
 * loaded first and the global set after it. It is read on every request, so wallets opened earlier
 * use it too.
 */
export async function useFetchForInProcessWallets(daemonUri: string): Promise<void> {
  allowDaemonOrigin(daemonUri);
  await LibraryUtils.loadWasmModule();
  (globalThis as { HttpClient?: unknown }).HttpClient = inProcessHttp;
}
