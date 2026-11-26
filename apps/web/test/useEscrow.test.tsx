// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EscrowStatus } from '../src/escrow/runtime.js';
import { setEscrowClient, useEscrow, workerClient, type EscrowClient, type UseEscrow } from '../src/escrow/useEscrow.js';
import { RUNTIME_FAILED, serveEscrow, workerConfig, type FromWorker, type Port } from '../src/escrow/worker.js';
import { confirmedFor } from './escrow-helpers.js';
import { render } from './render.js';

const CODE = 'K7Q2-M9XA-3PRT-W8DN';

afterEach(() => setEscrowClient(null));

function stubClient() {
  const subs = new Map<string, (s: EscrowStatus) => void>();
  const c: EscrowClient & { push(s: Partial<EscrowStatus>): void } = {
    start: vi.fn(),
    act: vi.fn(async () => {}),
    retry: vi.fn(),
    subscribe: (code, cb) => {
      subs.set(code, cb);
      return () => subs.delete(code);
    },
    push: (s) => act(() => subs.get(CODE)?.({ phase: 'idle', error: null, retryable: false, refusal: null, checkWords: null, keepOpen: false, role: 'buyer', amountAtomic: null, fiatCents: null, escrowAddress: null, deal: null, methodId: null, paymentInstructions: null, instructionsMismatch: false, receivedAtomic: null, confirmedAtomic: null, paidRecorded: false, intentKind: null, handedOff: false, ...s })),
  };
  return c;
}

function Probe({ out, confirmed }: { out: { v?: UseEscrow }; confirmed?: Parameters<typeof useEscrow>[1] }) {
  out.v = useEscrow(CODE, confirmed);
  return null;
}

describe('useEscrow', () => {
  it('starts the trade with the confirmed deal, follows the worker status and forwards actions', async () => {
    const c = stubClient();
    setEscrowClient(c);
    const out: { v?: UseEscrow } = {};
    const conf = confirmedFor('buyer');
    render(<Probe out={out} confirmed={conf} />);
    expect(c.start).toHaveBeenCalledWith(CODE, conf);
    expect(out.v).toMatchObject({ phase: 'idle', error: null, checkWords: null, keepOpen: false, amountAtomic: null, fiatCents: null });
    c.push({ phase: 'error', error: 'participants-mismatch' });
    expect(out.v).toMatchObject({ phase: 'error', error: 'participants-mismatch' });
    c.push({ phase: 'ready', checkWords: ['A1B2', 'C3D4', 'E5F6', '0789'] });
    expect(out.v?.checkWords).toEqual(['A1B2', 'C3D4', 'E5F6', '0789']);
    // The amount the device accepts (and its fiat total) reach the screens through the hook (review 2026-10-26 I3).
    c.push({ phase: 'ready', amountAtomic: 1_250_000_000_000n, fiatCents: 41_250n });
    expect(out.v).toMatchObject({ amountAtomic: 1_250_000_000_000n, fiatCents: 41_250n });
    // The funding screen's facts (Task 22): the device's own address, deal and funds() readings.
    expect(out.v).toMatchObject({ escrowAddress: null, deal: null, methodId: null, paymentInstructions: null, instructionsMismatch: false, receivedAtomic: null, confirmedAtomic: null, paidRecorded: false, intentKind: null, handedOff: false });
    c.push({ phase: 'ready', escrowAddress: '4escrow', deal: conf.deal, receivedAtomic: 7n, confirmedAtomic: 5n });
    expect(out.v).toMatchObject({ escrowAddress: '4escrow', deal: conf.deal, receivedAtomic: 7n, confirmedAtomic: 5n });
    await out.v!.buyerCancel();
    await out.v!.markPaid(41_250n);
    await out.v!.signal('trade.extend');
    await out.v!.release();
    await out.v!.buildRefund();
    await out.v!.proposeCancelSign();
    expect(vi.mocked(c.act).mock.calls.map((x) => x[1])).toEqual([
      { type: 'buyer-cancel' },
      { type: 'paid', fiatCents: 41_250n },
      { type: 'signal', signal: 'trade.extend' },
      { type: 'release' },
      { type: 'build-refund' },
      { type: 'propose-cancel-sign' },
    ]);
  });
});

/** A page/worker pair joined in memory. */
function pair() {
  const toWorker: ((e: { data: unknown }) => void)[] = [];
  const toPage: ((e: MessageEvent<FromWorker>) => void)[] = [];
  const port: Port = {
    postMessage: (m) => queueMicrotask(() => toPage.forEach((cb) => cb({ data: structuredClone(m) } as MessageEvent<FromWorker>))),
    addEventListener: (_t, cb) => toWorker.push(cb),
  };
  const worker = {
    postMessage: (m: unknown) => queueMicrotask(() => toWorker.forEach((cb) => cb({ data: structuredClone(m) }))),
    addEventListener: (_t: string, cb: (e: MessageEvent<FromWorker>) => void) => toPage.push(cb),
  } as unknown as Worker;
  return { port, worker };
}

describe('worker protocol', () => {
  it('resumes every stored trade on load, forwards status, and answers actions', async () => {
    const { port, worker } = pair();
    const calls: string[] = [];
    let emit!: (code: string, s: EscrowStatus) => void;
    serveEscrow(port, async (onStatus) => {
      emit = onStatus;
      return {
        start: async (code, confirmed) => void calls.push(`start ${code} ${confirmed?.role ?? '-'}`),
        resumeAll: async () => void calls.push('resume-all'),
        act: async (_code, a) => {
          calls.push(`act ${a.type}`);
          if (a.type === 'release') throw new Error('no');
        },
        retry: async (code) => void calls.push(`retry ${code}`),
        stop: async () => {},
        stopAll: async () => {},
      };
    });
    const client = workerClient(worker);
    await vi.waitFor(() => expect(calls).toEqual(['resume-all']));
    client.start(CODE, confirmedFor('seller'));
    await vi.waitFor(() => expect(calls).toContain(`start ${CODE} seller`));
    const seen: EscrowStatus[] = [];
    client.subscribe(CODE, (s) => seen.push(s));
    emit(CODE, { phase: 'ready', error: null, retryable: false, refusal: null, checkWords: ['1', '2', '3', '4'], keepOpen: false, role: 'seller', amountAtomic: null, fiatCents: null, escrowAddress: null, deal: null, methodId: null, paymentInstructions: null, instructionsMismatch: false, receivedAtomic: null, confirmedAtomic: null, paidRecorded: false, intentKind: null, handedOff: false });
    await vi.waitFor(() => expect(seen.at(-1)?.phase).toBe('ready'));
    await expect(client.act(CODE, { type: 'buyer-cancel' })).resolves.toBeUndefined();
    await expect(client.act(CODE, { type: 'release' })).rejects.toThrow();
    await expect(client.act(CODE, { type: 'steal' } as never)).rejects.toThrow();
    expect(calls).not.toContain('act steal');
    client.retry(CODE);
    await vi.waitFor(() => expect(calls).toContain(`retry ${CODE}`));
  });

  it('a runtime that cannot be made (missing config) stops every trade with escrow-failed and refuses every action', async () => {
    const { port, worker } = pair();
    serveEscrow(port, () => {
      throw new Error('escrow worker: VITE_MOD_SIGNING_PUBLIC is not set');
    });
    const client = workerClient(worker);
    const seen: EscrowStatus[] = [];
    client.subscribe(CODE, (s) => seen.push(s));
    client.start(CODE, confirmedFor('seller'));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(RUNTIME_FAILED));
    expect(seen.at(-1)).toMatchObject({ phase: 'error', error: 'escrow-failed', retryable: false, keepOpen: false });
    await expect(client.act(CODE, { type: 'release' })).rejects.toThrow();
  });

  it('the worker config fails closed when a value is missing', () => {
    const env = { VITE_MONERO_NETWORK: 'stagenet', VITE_MOD_SIGNING_PUBLIC: 'ab'.repeat(32), VITE_FEE_WALLET: '5Fee', VITE_PAYROLL_WALLET: '5Payroll', VITE_RELAY_URL: 'wss://r', VITE_NODE_PROXY_URL: 'https://n' };
    expect(workerConfig(env)).toMatchObject({ network: 'stagenet', feeWallet: '5Fee', payrollWallet: '5Payroll' });
    for (const k of Object.keys(env)) expect(() => workerConfig({ ...env, [k]: '' })).toThrow();
    expect(() => workerConfig({ ...env, VITE_MONERO_NETWORK: 'testnet' })).toThrow();
  });
});
