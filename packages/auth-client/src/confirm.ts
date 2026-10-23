import { addressEnd, addressHash, type ConfirmAction } from '@x2f/accounts';
import { AuthApiError } from './api.js';

/**
 * Runs a change that may need confirm-it's-you (P2-C2): calls `run()`; when the API answers
 * `confirm-required`, calls `prove(action)` once (Plan 3's confirm sheet: PGP, passkey, security
 * key or password) and retries `run(token)` once. Any other error, a failed proof, or a second
 * refusal propagates; it never loops.
 */
export async function withConfirm<T>(
  action: ConfirmAction,
  run: (confirmToken?: string) => Promise<T>,
  prove: (action: ConfirmAction) => Promise<string>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof AuthApiError) || e.code !== 'confirm-required') throw e;
  }
  const token = await prove(action);
  return run(token);
}

/** The action a new payout wallet is confirmed for: the hash and the last 6 characters of the trimmed address. */
export async function walletAction(address: string): Promise<Extract<ConfirmAction, { kind: 'add-wallet' }>> {
  return { kind: 'add-wallet', addressHash: await addressHash(address), addressEnd: addressEnd(address) };
}

const PLATFORMS: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
  'chrome os': 'ChromeOS',
  chromeos: 'ChromeOS',
};

/**
 * A coarse label for this browser's session in the device list, e.g. "Browser on Linux". Only a
 * known platform name is ever used, never the raw string a browser reports.
 */
export function defaultDeviceLabel(nav: { userAgentData?: { platform?: string } }): string {
  const raw = nav.userAgentData?.platform;
  const key = typeof raw === 'string' ? raw.toLowerCase() : '';
  return Object.hasOwn(PLATFORMS, key) ? `Browser on ${PLATFORMS[key]}` : 'Browser';
}
