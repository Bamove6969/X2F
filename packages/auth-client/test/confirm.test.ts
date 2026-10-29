import { addressEnd, addressHash, addressesHash, type ConfirmAction } from '@x2f/accounts';
import { describe, expect, it, vi } from 'vitest';
import { AuthApiError, MAX_WALLET_BATCH, defaultDeviceLabel, describeAction, walletAction, walletsAction, withConfirm } from '../src/index.js';

const ACTION: ConfirmAction = { kind: 'new-recovery-codes' };
const required = () => new AuthApiError(403, 'confirm-required', { action: 'new-recovery-codes' });

describe('withConfirm', () => {
  it('runs once without a token and never asks for proof when none is needed', async () => {
    const run = vi.fn(async (_t?: string) => 'done');
    const prove = vi.fn(async () => 'token');
    await expect(withConfirm(ACTION, run, prove)).resolves.toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
  });

  it('on confirm-required proves the same action once and retries once with the token', async () => {
    const run = vi.fn(async (t?: string) => {
      if (t === undefined) throw required();
      return `done with ${t}`;
    });
    const prove = vi.fn(async (_a: ConfirmAction) => 'tok-1');
    await expect(withConfirm(ACTION, run, prove)).resolves.toBe('done with tok-1');
    expect(prove).toHaveBeenCalledTimes(1);
    expect(prove).toHaveBeenCalledWith(ACTION);
    expect(run.mock.calls).toEqual([[], ['tok-1']]);
  });

  it('does not loop: a second confirm-required propagates after one proof', async () => {
    const run = vi.fn(async (_t?: string): Promise<string> => {
      throw required();
    });
    const prove = vi.fn(async () => 'tok');
    const e = await withConfirm(ACTION, run, prove).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AuthApiError);
    expect((e as AuthApiError).code).toBe('confirm-required');
    expect(prove).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('propagates any other API error without asking for proof', async () => {
    const run = vi.fn(async (): Promise<string> => {
      throw new AuthApiError(403, 'confirm-invalid');
    });
    const prove = vi.fn(async () => 'tok');
    await expect(withConfirm(ACTION, run, prove)).rejects.toMatchObject({ code: 'confirm-invalid' });
    expect(prove).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('propagates errors that are not API errors', async () => {
    const boom = new TypeError('network down');
    const prove = vi.fn(async () => 'tok');
    await expect(withConfirm(ACTION, async () => Promise.reject(boom), prove)).rejects.toBe(boom);
    expect(prove).not.toHaveBeenCalled();
  });

  it('refuses before any proof when the API asks to confirm a different action', async () => {
    const other = new AuthApiError(403, 'confirm-required', { action: 'set-password' });
    const run = vi.fn(async (_t?: string): Promise<string> => {
      throw other;
    });
    const prove = vi.fn(async () => 'tok');
    const e = await withConfirm(ACTION, run, prove).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toMatch(/set-password.*new-recovery-codes|new-recovery-codes.*set-password/);
    expect((e as Error).cause).toBe(other);
    expect(prove).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses before any proof when the API does not name the action', async () => {
    const run = vi.fn(async (_t?: string): Promise<string> => {
      throw new AuthApiError(403, 'confirm-required');
    });
    const prove = vi.fn(async () => 'tok');
    await expect(withConfirm(ACTION, run, prove)).rejects.toThrow(/new-recovery-codes/);
    expect(prove).not.toHaveBeenCalled();
  });

  it('propagates a failed proof (the person cancelled) without retrying', async () => {
    const run = vi.fn(async (_t?: string): Promise<string> => {
      throw required();
    });
    const cancelled = new Error('cancelled');
    await expect(withConfirm(ACTION, run, async () => Promise.reject(cancelled))).rejects.toBe(cancelled);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('walletAction', () => {
  const ADDRESS = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';

  it('builds the add-wallet action from the trimmed address', async () => {
    const a = await walletAction(`  ${ADDRESS}\n`);
    expect(a).toEqual({ kind: 'add-wallet', addressHash: await addressHash(ADDRESS), addressEnd: addressEnd(ADDRESS) });
    expect(a.addressEnd).toBe('684Rge');
    expect(a.addressHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different addresses', async () => {
    const other = `${ADDRESS.slice(0, -1)}f`;
    expect((await walletAction(other)).addressHash).not.toBe((await walletAction(ADDRESS)).addressHash);
  });
});

describe('walletsAction', () => {
  const A = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';
  const B = `4${'B'.repeat(94)}`;
  const C = `4${'C'.repeat(94)}`;

  it('builds the add-wallets action from the trimmed list, in order', async () => {
    const a = await walletsAction([`  ${A}\n`, ` ${B}`]);
    expect(a).toEqual({ kind: 'add-wallets', addressesHash: await addressesHash([A, B]), addressEnds: '684Rge,BBBBBB' });
    expect(a.addressesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(describeAction(a)).toBe('add 2 payout wallets ending …684Rge, …BBBBBB');
  });

  it('binds the exact list: another order, another member or one more differs', async () => {
    const base = (await walletsAction([A, B])).addressesHash;
    expect((await walletsAction([B, A])).addressesHash).not.toBe(base);
    expect((await walletsAction([A, C])).addressesHash).not.toBe(base);
    expect((await walletsAction([A, B, C])).addressesHash).not.toBe(base);
    expect((await walletsAction([A])).addressesHash).not.toBe(base);
  });

  it('never equals the single-wallet action for the same address', async () => {
    const one = await walletsAction([A]);
    expect(one).toEqual({ kind: 'add-wallets', addressesHash: (await walletAction(A)).addressHash, addressEnds: '684Rge' });
    expect(one.kind).not.toBe((await walletAction(A)).kind);
  });

  it('covers a full batch of MAX_WALLET_BATCH (10)', async () => {
    expect(MAX_WALLET_BATCH).toBe(10);
    const list = Array.from({ length: MAX_WALLET_BATCH }, (_, i) => `4${'123456789A'[i]!.repeat(94)}`);
    const a = await walletsAction(list);
    expect(a.addressEnds.split(',')).toHaveLength(10);
    expect(a.addressEnds.split(',')).toEqual(list.map(addressEnd));
  });
});

describe('defaultDeviceLabel', () => {
  it('names the platform coarsely', () => {
    expect(defaultDeviceLabel({ userAgentData: { platform: 'Linux' } })).toBe('Browser on Linux');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'Windows' } })).toBe('Browser on Windows');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'macOS' } })).toBe('Browser on macOS');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'Android' } })).toBe('Browser on Android');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'iOS' } })).toBe('Browser on iOS');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'Chrome OS' } })).toBe('Browser on ChromeOS');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'chromeos' } })).toBe('Browser on ChromeOS');
  });

  it('says only "Browser" when the platform is missing or not a known one (never echoes it)', () => {
    expect(defaultDeviceLabel({})).toBe('Browser');
    expect(defaultDeviceLabel({ userAgentData: {} })).toBe('Browser');
    expect(defaultDeviceLabel({ userAgentData: { platform: '' } })).toBe('Browser');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'Linux x86_64; build 6.18.54-microsoft' } })).toBe('Browser');
    expect(defaultDeviceLabel({ userAgentData: { platform: 'Linux‮' } })).toBe('Browser');
    expect(defaultDeviceLabel({ userAgentData: { platform: 7 as unknown as string } })).toBe('Browser');
  });
});
