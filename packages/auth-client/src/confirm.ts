import { addressEnd, addressEnds, addressHash, addressesHash, type ConfirmAction } from '@x2f/accounts';
import { AuthApiError } from './api.js';

/**
 * Runs a change that may need confirm-it's-you (P2-C2): calls `run()`; when the API answers
 * `confirm-required`, calls `prove(action)` once (Plan 3's confirm sheet: PGP, passkey, security
 * key or password) and retries `run(token)` once. Any other error, a failed proof, or a second
 * refusal propagates; it never loops. A `confirm-required` for an action other than `action.kind`
 * throws before any proof.
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
    // Never prove one action for a change the API says is another.
    if (e.action !== action.kind) {
      throw new Error(`withConfirm: the API asks to confirm ${e.action ?? 'an unnamed action'}, not ${action.kind}`, { cause: e });
    }
  }
  const token = await prove(action);
  return run(token);
}

/** The action a new payout wallet is confirmed for: the hash and the last 6 characters of the trimmed address. */
export async function walletAction(address: string): Promise<Extract<ConfirmAction, { kind: 'add-wallet' }>> {
  return { kind: 'add-wallet', addressHash: await addressHash(address), addressEnd: addressEnd(address) };
}

/** The action a batch of payout wallets is confirmed for: the exact list in order, and their ends. */
export async function walletsAction(addresses: readonly string[]): Promise<Extract<ConfirmAction, { kind: 'add-wallets' }>> {
  return { kind: 'add-wallets', addressesHash: await addressesHash(addresses), addressEnds: addressEnds(addresses) };
}

type Role = 'offers' | 'trades' | 'hold-see' | 'hold-cancel' | 'hold-end';
/** Plan 2 Task 18: the roles in the API's fixed order (offers, trades, then owner p4-8's hold rights), comma-separated, as the confirm action binds them. */
function rolesText(roles: readonly Role[]): string {
  return (['offers', 'trades', 'hold-see', 'hold-cancel', 'hold-end'] as const).filter((r) => roles.includes(r)).join(',');
}

/** The action an invite is confirmed for: the member's name exactly as sent, and the roles. */
export function teamInviteAction(name: string, roles: readonly Role[]): Extract<ConfirmAction, { kind: 'team-invite' }> {
  return { kind: 'team-invite', name, roles: rolesText(roles) };
}

/** The action a roles change is confirmed for: the member and exactly the new roles. */
export function teamRolesAction(memberId: string, roles: readonly Role[]): Extract<ConfirmAction, { kind: 'team-roles' }> {
  return { kind: 'team-roles', memberId, roles: rolesText(roles) };
}

/** The action removing a member (or cancelling an invite) is confirmed for. */
export function teamRemoveAction(memberId: string): Extract<ConfirmAction, { kind: 'team-remove' }> {
  return { kind: 'team-remove', memberId };
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
