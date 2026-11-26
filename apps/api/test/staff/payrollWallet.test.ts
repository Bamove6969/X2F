// Owner 26 Nov 2026: the hot payroll wallet behind monero-wallet-rpc (digest login). No database.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkPayrollWallet, moneroPayrollWallet, payrollWalletFromEnv, PayrollWalletRefused } from '../../src/staff/payrollWallet.js';
import { fakeAddress } from '../helpers/trades.js';

const ADDR = fakeAddress();
const DEST = fakeAddress();
const env = (over: Record<string, string | undefined> = {}) => ({
  X2F_PAYROLL_WALLET_RPC_URL: 'http://127.0.0.1:18083',
  X2F_PAYROLL_WALLET: ADDR,
  X2F_PAYROLL_WALLET_RPC_USER: 'x2f',
  X2F_PAYROLL_WALLET_RPC_PASSWORD: 'secret-pw',
  ...over,
});

describe('payrollWalletFromEnv', () => {
  it('unset: no wallet; set: the JSON-RPC endpoint, the address and the login', () => {
    expect(payrollWalletFromEnv({})).toBeNull();
    expect(payrollWalletFromEnv(env())).toEqual({ url: 'http://127.0.0.1:18083/json_rpc', user: 'x2f', password: 'secret-pw', address: ADDR });
  });

  it('refuses a malformed URL, a login in the URL, a bad address and a missing login, never echoing values', () => {
    const cases = [
      env({ X2F_PAYROLL_WALLET_RPC_URL: 'not a url' }),
      env({ X2F_PAYROLL_WALLET_RPC_URL: 'ftp://127.0.0.1:18083' }),
      env({ X2F_PAYROLL_WALLET_RPC_URL: 'http://u:secret-pw@127.0.0.1:18083' }),
      env({ X2F_PAYROLL_WALLET: 'nope' }),
      env({ X2F_PAYROLL_WALLET_RPC_USER: '' }),
      env({ X2F_PAYROLL_WALLET_RPC_PASSWORD: undefined }),
    ];
    for (const c of cases) {
      let msg = '';
      try {
        payrollWalletFromEnv(c);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, JSON.stringify(c)).toMatch(/^config: X2F_PAYROLL_WALLET/);
      expect(msg).not.toContain('secret-pw');
    }
  });
});

interface Seen { auth: string | null; body: string }
function rpc(answer: (body: Record<string, unknown>) => { status?: number; json?: unknown; text?: string }, o: { realm?: string } = {}) {
  const seen: Seen[] = [];
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const fetchStub = (async (_url: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).authorization ?? null;
    seen.push({ auth, body: init.body as string });
    if (auth === null) {
      return new Response('', { status: 401, headers: { 'www-authenticate': `Digest qop="auth",algorithm=MD5,realm="${o.realm ?? 'monero-rpc'}",nonce="abc123",stale=false` } });
    }
    // Check the digest as wallet-rpc would.
    const f = (n: string) => new RegExp(`${n}="?([^",]*)"?`).exec(auth)?.[1] ?? '';
    const ha1 = md5(`x2f:${o.realm ?? 'monero-rpc'}:secret-pw`);
    const ha2 = md5(`POST:${f('uri')}`);
    if (f('response') !== md5(`${ha1}:${f('nonce')}:${f('nc')}:${f('cnonce')}:auth:${ha2}`)) return new Response('', { status: 401 });
    const a = answer(JSON.parse(init.body as string) as Record<string, unknown>);
    return new Response(a.text ?? JSON.stringify(a.json), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { seen, fetchStub };
}
const config = { url: 'http://127.0.0.1:18083/json_rpc', user: 'x2f', password: 'secret-pw', address: ADDR };

describe('moneroPayrollWallet', () => {
  it('logs in with digest auth and reads big balances exactly', async () => {
    const { fetchStub, seen } = rpc(() => ({ text: '{"jsonrpc":"2.0","id":"0","result":{"balance":123456789012345678901,"unlocked_balance":98765432109876543210}}' }));
    const w = moneroPayrollWallet(config, { fetch: fetchStub });
    expect(await w.unlockedAtomic()).toBe(98765432109876543210n);
    expect(seen[1]!.auth).toMatch(/^Digest username="x2f"/);
    expect(seen[1]!.auth).not.toContain('secret-pw');
  });

  it('a transfer has exactly one destination and an exact integer amount; the fee comes off only when asked', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const { fetchStub } = rpc((b) => (bodies.push(b), { text: `{"result":{"tx_hash":"${'ab'.repeat(32)}","fee":30000000}}` }));
    const w = moneroPayrollWallet(config, { fetch: fetchStub });
    expect(await w.transfer({ address: DEST, amountAtomic: 9_007_199_254_740_993n, feeFromAmount: false })).toEqual({ txHash: 'ab'.repeat(32), feeAtomic: 30_000_000n });
    await w.transfer({ address: DEST, amountAtomic: 5n, feeFromAmount: true });
    expect(bodies[0]).toMatchObject({ method: 'transfer', params: { destinations: [{ address: DEST }], account_index: 0 } });
    expect(bodies[0]!.params).not.toHaveProperty('subtract_fee_from_outputs');
    expect(bodies[1]!.params).toMatchObject({ subtract_fee_from_outputs: [0] });
  });

  it('the amount is sent as the exact integer text', async () => {
    let raw = '';
    const { fetchStub } = rpc(() => ({ text: `{"result":{"tx_hash":"${'cd'.repeat(32)}"}}` }));
    const spy = (async (u: string, init: RequestInit) => ((raw = init.body as string), fetchStub(u, init))) as unknown as typeof fetch;
    await moneroPayrollWallet(config, { fetch: spy }).transfer({ address: DEST, amountAtomic: 9_007_199_254_740_993n, feeFromAmount: false });
    expect(raw).toContain('"amount":9007199254740993,');
  });

  it('a wallet error is a refusal (nothing sent); a bad answer or HTTP error is not', async () => {
    const refused = rpc(() => ({ json: { error: { code: -38, message: 'not enough money' } } }));
    await expect(moneroPayrollWallet(config, { fetch: refused.fetchStub }).transfer({ address: DEST, amountAtomic: 1n, feeFromAmount: false })).rejects.toBeInstanceOf(PayrollWalletRefused);
    const noHash = rpc(() => ({ json: { result: {} } }));
    const e1 = await moneroPayrollWallet(config, { fetch: noHash.fetchStub }).transfer({ address: DEST, amountAtomic: 1n, feeFromAmount: false }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(Error);
    expect(e1).not.toBeInstanceOf(PayrollWalletRefused);
    const http = rpc(() => ({ status: 502, text: '' }));
    const e2 = await moneroPayrollWallet(config, { fetch: http.fetchStub }).transfer({ address: DEST, amountAtomic: 1n, feeFromAmount: false }).catch((e: unknown) => e);
    expect(e2).not.toBeInstanceOf(PayrollWalletRefused);
  });

  it('refuses a bad destination or amount before calling, and a wrong login', async () => {
    const { fetchStub, seen } = rpc(() => ({ json: { result: {} } }));
    const w = moneroPayrollWallet(config, { fetch: fetchStub });
    await expect(w.transfer({ address: 'nope', amountAtomic: 1n, feeFromAmount: false })).rejects.toBeInstanceOf(PayrollWalletRefused);
    await expect(w.transfer({ address: DEST, amountAtomic: 0n, feeFromAmount: false })).rejects.toBeInstanceOf(PayrollWalletRefused);
    expect(seen).toEqual([]);
    const wrong = moneroPayrollWallet({ ...config, password: 'other' }, { fetch: fetchStub });
    await expect(wrong.unlockedAtomic()).rejects.toBeInstanceOf(PayrollWalletRefused);
  });

  it('checkPayrollWallet refuses a wallet whose address is not X2F_PAYROLL_WALLET', async () => {
    const { fetchStub } = rpc(() => ({ json: { result: { address: DEST } } }));
    const w = moneroPayrollWallet(config, { fetch: fetchStub });
    await expect(checkPayrollWallet(w, ADDR)).rejects.toThrow(/not X2F_PAYROLL_WALLET/);
    await expect(checkPayrollWallet(w, DEST)).resolves.toBeUndefined();
  });
});
