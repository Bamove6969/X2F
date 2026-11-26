import { createHash, randomBytes } from 'node:crypto';

/**
 * Owner, 26 Nov 2026: X2F's hot payroll wallet (wallet 2). Every completed trade pays half of its
 * 1% here (the other half goes to the watch-only fee wallet, wallet 1, whose spend key stays
 * offline). This wallet pays staff automatically at clock-out (`pay.ts`, `runPayrollPayouts`), and
 * any balance over the owner's cap is swept to the fee wallet (`feeSweep.ts`).
 *
 * The wallet is a `monero-wallet-rpc` the API reaches over HTTP (`X2F_PAYROLL_WALLET_RPC_URL`, a
 * loopback or private address), with HTTP digest login (`X2F_PAYROLL_WALLET_RPC_USER`,
 * `X2F_PAYROLL_WALLET_RPC_PASSWORD`: the wallet-rpc's `--rpc-login`). Only two calls ever spend,
 * both through `transfer` here, and each takes exactly one destination. The API checks at start that
 * the wallet's primary address is `X2F_PAYROLL_WALLET`, the address every app pays (`checkAddress`).
 */
export interface PayrollWallet {
  /** The wallet's spendable (unlocked) balance in account 0, atomic units. */
  unlockedAtomic(): Promise<bigint>;
  /**
   * Sends `amountAtomic` to `address` from account 0. `feeFromAmount` takes the network fee off
   * the amount sent (the sweep: the wallet keeps exactly what was planned); otherwise the wallet
   * pays it on top (a staff payout: the member gets exactly the recorded amount). Throws
   * `PayrollWalletRefused` when the wallet answered with an error (nothing was sent), any other
   * error when the outcome is unknown (a timeout, a dropped connection).
   */
  transfer(a: { address: string; amountAtomic: bigint; feeFromAmount: boolean }): Promise<{ txHash: string; feeAtomic: bigint | null }>;
  /** The wallet's primary address (account 0, address 0). */
  primaryAddress(): Promise<string>;
}

/** The wallet answered with an error: it built and sent nothing (low balance, locked coins, a bad address). */
export class PayrollWalletRefused extends Error {
  constructor(readonly rpcCode: number, detail: string) {
    super(`payroll wallet refused: ${detail}`);
    this.name = 'PayrollWalletRefused';
  }
}

export interface PayrollWalletConfig {
  url: string;
  user: string | null;
  password: string | null;
  /** `X2F_PAYROLL_WALLET`: the address the wallet must have. */
  address: string;
}

const MONERO_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{95,106}$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** Each wallet call gives up after this long; a transfer that does is an unknown outcome. */
export const PAYROLL_RPC_TIMEOUT_MS = 60_000;

/**
 * `X2F_PAYROLL_WALLET_RPC_URL` unset: no payroll wallet (payouts wait as `waiting-send`, a due sweep
 * says it is not wired). Set: it needs `X2F_PAYROLL_WALLET` and both login variables. wallet-rpc
 * speaks plain HTTP, so run it on the same host or a private network. Errors name the variable,
 * never its value.
 */
export function payrollWalletFromEnv(env: Record<string, string | undefined>): PayrollWalletConfig | null {
  const url = env.X2F_PAYROLL_WALLET_RPC_URL?.trim() ?? '';
  if (url === '') return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('config: X2F_PAYROLL_WALLET_RPC_URL is malformed (http(s)://host:port)');
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') {
    throw new Error('config: X2F_PAYROLL_WALLET_RPC_URL is malformed (http(s)://host:port, no login in the URL)');
  }
  const address = env.X2F_PAYROLL_WALLET?.trim() ?? '';
  if (!MONERO_ADDRESS.test(address)) throw new Error('config: X2F_PAYROLL_WALLET is missing or malformed (a Monero address)');
  const user = env.X2F_PAYROLL_WALLET_RPC_USER ?? '';
  const password = env.X2F_PAYROLL_WALLET_RPC_PASSWORD ?? '';
  // A hot wallet that anyone on the host can spend from is refused: the login is required.
  if (user === '' || password === '') throw new Error('config: X2F_PAYROLL_WALLET_RPC_USER and X2F_PAYROLL_WALLET_RPC_PASSWORD are required with X2F_PAYROLL_WALLET_RPC_URL');
  return { url: `${u.origin}/json_rpc`, user, password, address };
}

/** Big integers in the wallet's JSON are kept as strings before parsing (amounts can pass 2^53). */
function parseBig(text: string): unknown {
  return JSON.parse(text.replace(/"(balance|unlocked_balance|amount|fee)"\s*:\s*(\d+)/g, '"$1":"$2"'));
}

const md5 = (s: string): string => createHash('md5').update(s).digest('hex');

/** RFC 7616 digest (MD5, qop=auth), what monero-wallet-rpc's --rpc-login asks for. */
function digestHeader(challenge: string, user: string, password: string, method: string, uri: string): string | null {
  const field = (name: string): string | undefined => new RegExp(`${name}="?([^",]*)"?`, 'i').exec(challenge)?.[1];
  const realm = field('realm');
  const nonce = field('nonce');
  if (realm === undefined || nonce === undefined) return null;
  const qop = field('qop');
  const opaque = field('opaque');
  const algorithm = field('algorithm') ?? 'MD5';
  if (algorithm.toUpperCase() !== 'MD5') return null;
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const ha1 = md5(`${user}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const useQop = qop !== undefined && qop.split(/\s*,\s*/).includes('auth');
  const response = useQop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [`username="${user}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${uri}"`, `algorithm=MD5`, `response="${response}"`];
  if (useQop) parts.push('qop=auth', `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque !== undefined) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

export interface RpcIO {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** A `PayrollWallet` over monero-wallet-rpc's JSON-RPC (`config.url`). */
export function moneroPayrollWallet(config: PayrollWalletConfig, io: RpcIO = {}): PayrollWallet {
  const doFetch = io.fetch ?? fetch;
  const uri = new URL(config.url).pathname;
  const call = async (method: string, params: string): Promise<Record<string, unknown>> => {
    const body = `{"jsonrpc":"2.0","id":"0","method":"${method}","params":${params}}`;
    const send = (auth?: string) =>
      doFetch(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body,
        signal: AbortSignal.timeout(io.timeoutMs ?? PAYROLL_RPC_TIMEOUT_MS),
        redirect: 'error',
      });
    let res = await send();
    if (res.status === 401 && config.user !== null && config.password !== null) {
      const challenge = res.headers.get('www-authenticate') ?? '';
      await res.body?.cancel();
      const auth = digestHeader(challenge, config.user, config.password, 'POST', uri);
      if (auth === null) throw new PayrollWalletRefused(-401, 'unsupported login challenge');
      res = await send(auth);
    }
    // A refused login, or any other HTTP error before the JSON-RPC answer: nothing was sent.
    if (res.status === 401 || res.status === 403) throw new PayrollWalletRefused(-res.status, 'login refused');
    if (!res.ok) throw new Error(`payroll wallet: HTTP ${res.status}`);
    const json = parseBig(await res.text()) as { result?: Record<string, unknown>; error?: { code?: unknown; message?: unknown } };
    if (json.error !== undefined) {
      throw new PayrollWalletRefused(typeof json.error.code === 'number' ? json.error.code : -1, typeof json.error.message === 'string' ? json.error.message.slice(0, 200) : 'error');
    }
    if (json.result === undefined || json.result === null || typeof json.result !== 'object') throw new Error('payroll wallet: no result');
    return json.result;
  };
  const amountOf = (v: unknown): bigint | null => (typeof v === 'string' && /^\d{1,30}$/.test(v) ? BigInt(v) : null);
  return {
    async unlockedAtomic() {
      const r = await call('get_balance', '{"account_index":0}');
      const v = amountOf(r.unlocked_balance);
      if (v === null) throw new Error('payroll wallet: bad balance');
      return v;
    },
    async primaryAddress() {
      const r = await call('get_address', '{"account_index":0,"address_index":[0]}');
      if (typeof r.address !== 'string') throw new Error('payroll wallet: bad address');
      return r.address;
    },
    async transfer(a) {
      if (!MONERO_ADDRESS.test(a.address)) throw new PayrollWalletRefused(-2, 'bad destination');
      if (typeof a.amountAtomic !== 'bigint' || a.amountAtomic <= 0n) throw new PayrollWalletRefused(-3, 'bad amount');
      // One destination only, written by hand so the amount is an exact integer (never a double).
      const params = `{"destinations":[{"amount":${a.amountAtomic.toString()},"address":"${a.address}"}],"account_index":0,"priority":0,"get_tx_key":false${a.feeFromAmount ? ',"subtract_fee_from_outputs":[0]' : ''}}`;
      const r = await call('transfer', params);
      if (typeof r.tx_hash !== 'string' || !HEX64.test(r.tx_hash)) throw new Error('payroll wallet: no tx hash');
      return { txHash: r.tx_hash, feeAtomic: amountOf(r.fee) };
    },
  };
}

/**
 * At start: the wallet behind the RPC is the payroll wallet every app pays (`X2F_PAYROLL_WALLET`),
 * so a misconfigured RPC never pays staff or sweeps from some other wallet.
 */
export async function checkPayrollWallet(w: PayrollWallet, address: string): Promise<void> {
  const got = await w.primaryAddress();
  if (got !== address) throw new Error('config: the wallet at X2F_PAYROLL_WALLET_RPC_URL is not X2F_PAYROLL_WALLET');
}
