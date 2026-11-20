/**
 * Plan 3 Task 31: helpers for the end-to-end trades on regtest (trade.e2e.spec.ts): the stack's
 * addresses, traders signed up through the real API, browser contexts holding their sessions,
 * and the chain (mining, a funder wallet, what a wallet received).
 *
 * Traders are signed up with a password through `POST /v1/register/password` exactly as the
 * sign-up screen does; the browser then carries that session cookie. The one shortcut is the
 * vendor switch of an offer's poster, written straight into this run's throwaway database (the real
 * switch needs a passkey or PGP key and a strong confirm), as the demo seed does.
 */
import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull, type MoneroWalletFull as Wallet } from 'monero-ts';
import pg from 'pg';
import { TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
import { fundedWallet, mine as mineTo, newTestWallet } from '../../../tools/regtest/regtest.js';
import type { StackInfo } from './stack.js';

export function stack(): StackInfo {
  const raw = process.env.X2F_E2E_STACK;
  if (!raw) throw new Error('X2F_E2E_STACK is missing: run with -c apps/web/e2e/playwright.regtest.config.ts');
  return JSON.parse(raw) as StackInfo;
}

export const PASSWORD = 'E2e-Regtest-Monero-2026!';
export const PHONE = { width: 390, height: 844 } as const;
export const DESKTOP = { width: 1280, height: 800 } as const;
export type Size = typeof PHONE | typeof DESKTOP;

/** A browser-like client with its own cookie jar, on the stack's origin. */
export class ApiClient {
  readonly jar = new Map<string, string>();
  constructor(readonly origin: string) {}
  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.origin}${path}`, {
      method,
      headers: {
        origin: this.origin,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.jar.size > 0 ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: body === undefined ? null : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const at = pair!.indexOf('=');
      this.jar.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as T };
  }
  async ok<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export interface Trader {
  displayName: string;
  api: ApiClient;
  /** The trader's own payout wallet (a regtest wallet whose keys the spec holds). */
  wallet: Wallet;
  address: string;
}

const db = () => new pg.Client({ connectionString: stack().apiDatabaseUrl });

/** Runs one query on the API's database (test set-up and checks only). */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const c = db();
  await c.connect();
  try {
    return (await c.query<T>(text, values)).rows;
  } finally {
    await c.end();
  }
}

/** A new trader: signed up with a password, with a regtest payout wallet; a vendor when `vendor`. */
export async function signUp(prefix: string, o: { vendor?: boolean } = {}): Promise<Trader> {
  const s = stack();
  const tag = randomBytes(3).toString('hex');
  const displayName = `${prefix}_${tag}`;
  const api = new ApiClient(s.origin);
  await api.ok('GET', '/v1/site');
  await api.ok('POST', '/v1/register/password', {
    displayName,
    loginName: `${prefix}-login-${tag}`,
    password: PASSWORD,
    deviceLabel: 'e2e',
    acceptedTerms: TERMS_TEXT_VERSION,
    termsSignature: { kind: 'typed', name: displayName },
  });
  const wallet = await newTestWallet(s.monerod);
  const address = await wallet.getPrimaryAddress();
  await api.ok('POST', '/v1/wallets', { app: 'cake', label: 'Regtest wallet', address });
  if (o.vendor) {
    const rows = await sql("update accounts set account_type = 'vendor', vendor_since = now() where display_name = $1 and account_type = 'trader' returning id", [displayName]);
    if (rows.length !== 1) throw new Error(`could not make ${displayName} a vendor`);
  }
  return { displayName, api, wallet, address };
}

/** A browser context at `size` that is logged in as `t` (the sign-up's session cookie). */
export async function contextFor(browser: Browser, t: Trader, size: Size): Promise<{ context: BrowserContext; page: Page }> {
  const s = stack();
  const phone = size.width < 600;
  const context = await browser.newContext({
    baseURL: s.origin,
    viewport: size,
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
    storageState: { cookies: [], origins: [{ origin: s.origin, localStorage: [{ name: 'x2f.welcome.seen', value: '1' }] }] },
  });
  const url = new URL(s.origin);
  await context.addCookies([...t.api.jar].map(([name, value]) => ({ name, value, domain: url.hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Strict' as const })));
  const page = await context.newPage();
  // X2F_E2E_DIAG=1: every console line (the escrow workers' too) and every node-proxy call, for debugging a run.
  if (process.env.X2F_E2E_DIAG) {
    const who = t.displayName;
    page.on('console', (m) => console.log(`[${who} ${m.type()}] ${m.text().slice(0, 300)}`));
    page.on('pageerror', (e) => console.log(`[${who} pageerror] ${e.message.slice(0, 300)}`));
    context.on('request', (r) => {
      if (!r.url().startsWith(s.origin)) console.log(`[${who} req] ${r.method()} ${r.url().slice(0, 100)}`);
    });
    context.on('requestfailed', (r) => console.log(`[${who} reqfailed] ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  }
  return { context, page };
}

// ── the chain ──

export async function mine(blocks: number, address?: string): Promise<void> {
  const s = stack();
  await mineTo(s.monerod, blocks, address ?? (await funder()).address);
}

let funding: Promise<{ wallet: Wallet; address: string }> | null = null;
/** One funded regtest wallet per worker: it pays the escrows and takes the mined coins. */
export function funder(): Promise<{ wallet: Wallet; address: string }> {
  funding ??= (async () => {
    const wallet = await fundedWallet(stack().monerod);
    // Enough unlocked outputs for every trade of the run.
    const address = await wallet.getPrimaryAddress();
    await mineTo(stack().monerod, 60, address);
    await wallet.sync();
    return { wallet, address };
  })();
  return funding;
}

/** Pays `atomic` to `address` from the funder and mines nothing (the spec mines). */
export async function pay(address: string, atomic: bigint): Promise<string> {
  const f = await funder();
  await f.wallet.sync();
  const tx = await f.wallet.createTx({ accountIndex: 0, address, amount: atomic, relay: true });
  return tx.getHash()!;
}

/** What `w` has received in total (confirmed and in the pool), in atomic units. */
export async function received(w: Wallet): Promise<bigint> {
  await w.sync();
  const transfers = await w.getIncomingTransfers({});
  return transfers.reduce((sum, t) => sum + t.getAmount(), 0n);
}

/** The fee wallet, restored from its seed as a view-and-spend wallet on the stack's node. */
export async function feeWallet(): Promise<Wallet> {
  const s = stack();
  return MoneroWalletFull.createWallet(new MoneroWalletConfig({
    networkType: MoneroNetworkType.MAINNET,
    regtest: true,
    server: { uri: s.monerod },
    seed: s.feeWallet.seed,
    restoreHeight: 0,
  }));
}

/** The network fee a transaction paid, from the node itself (atomic). */
export async function txFee(txHash: string): Promise<bigint> {
  const res = await fetch(`${stack().monerod}/get_transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txs_hashes: [txHash], decode_as_json: true }),
  });
  const body = (await res.json()) as { txs?: Array<{ as_json: string }> };
  const tx = body.txs?.[0];
  if (!tx) throw new Error(`the node does not have tx ${txHash}`);
  return BigInt((JSON.parse(tx.as_json) as { rct_signatures: { txnFee: number } }).rct_signatures.txnFee);
}

/** The trade's current view as `t` sees it. */
export async function tradeView<T = Record<string, unknown>>(t: Trader, code: string): Promise<T> {
  return t.api.ok<T>('GET', `/v1/trades/${encodeURIComponent(code)}`);
}

/** The trade code in a /trade/<code> URL. */
export function codeOf(page: Page): string {
  const m = /\/trade\/([^/?#]+)/.exec(page.url());
  if (!m) throw new Error(`not on a trade page: ${page.url()}`);
  return decodeURIComponent(m[1]!);
}
