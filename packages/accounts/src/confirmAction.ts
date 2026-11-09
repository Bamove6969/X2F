/**
 * Actions that need a confirm-it's-you token, shared by browser and server:
 * the hash a token is bound to, and the words shown to the person.
 */
export type MethodType = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-codes';

export type ConfirmAction =
  | { kind: 'add-wallet'; addressHash: string; addressEnd: string }
  /**
   * Several payout wallets under one confirm (owner, 2026-10-24): `addressesHash` binds the exact
   * list in order, `addressEnds` is their ends joined by commas, for display.
   */
  | { kind: 'add-wallets'; addressesHash: string; addressEnds: string }
  | { kind: 'add-method'; method: MethodType }
  | { kind: 'remove-method'; method: MethodType; id: string }
  | { kind: 'set-password' }
  /** A pre-009 account sets its private login name (FU-A re-review 2). */
  | { kind: 'set-login-name' }
  | { kind: 'new-recovery-codes' }
  /** Plan 2 Task 16: turn "One device at a time" on or off. */
  | { kind: 'set-one-device'; on: 'on' | 'off' }
  | { kind: 'add-device-key'; signPublicHash: string }
  /**
   * Plan 2 Task 18: the account owner invites a team member: `name`, their name in trade chats,
   * exactly as typed (review M9(a): one confirm invites one named member), and `roles`, the roles
   * comma-separated in a fixed order.
   */
  | { kind: 'team-invite'; name: string; roles: string }
  /** Changes one member's roles to exactly `roles`. */
  | { kind: 'team-roles'; memberId: string; roles: string }
  /** Removes one member (or cancels an invite). */
  | { kind: 'team-remove'; memberId: string };

/** Canonical JSON of a flat object of strings: keys sorted, no whitespace. */
function canonical(a: ConfirmAction): string {
  const rec = a as unknown as Record<string, string>;
  const parts = Object.keys(rec)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(rec[k])}`);
  return `{${parts.join(',')}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex (WebCrypto) of the action's canonical JSON. */
export function actionHash(a: ConfirmAction): Promise<string> {
  return sha256Hex(canonical(a));
}

export function describeAction(a: ConfirmAction): string {
  switch (a.kind) {
    case 'add-wallet':
      return `add payout wallet ending …${a.addressEnd}`;
    case 'add-wallets': {
      const ends = a.addressEnds.split(',');
      return `add ${ends.length} payout wallets ending ${ends.map((e) => `…${e}`).join(', ')}`;
    }
    case 'add-method':
      return `add a login method (${a.method})`;
    case 'remove-method':
      return `remove a login method (${a.method})`;
    case 'set-password':
      return 'set a new password';
    case 'set-login-name':
      return 'set your login name';
    case 'new-recovery-codes':
      return 'make new recovery codes';
    case 'set-one-device':
      return a.on === 'on' ? 'turn on One device at a time' : 'turn off One device at a time';
    case 'add-device-key':
      return 'add a trade signing key';
    case 'team-invite':
      return `invite ${a.name} as a team member (${teamRoleWords(a.roles)})`;
    case 'team-roles':
      return `change a team member's roles to ${teamRoleWords(a.roles)}`;
    case 'team-remove':
      return 'remove a team member';
  }
}

/** Owner p4-8 adds the hold rights (MemberPermissions board wording, COPY-UNSIGNED). */
const ROLE_WORDS: Readonly<Record<string, string>> = {
  offers: 'Offers',
  trades: 'Trades',
  'hold-see': 'See waiting changes',
  'hold-cancel': 'Untick or cancel waiting changes',
  'hold-end': 'End a hold',
};

/** "Offers", "Trades", "Offers and Trades" or a longer list ("Offers, Trades and End a hold") from a comma-separated roles list. */
function teamRoleWords(roles: string): string {
  const words = roles.split(',').map((r) => ROLE_WORDS[r] ?? r);
  return words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** SHA-256 hex (WebCrypto) of the trimmed address. */
export function addressHash(address: string): Promise<string> {
  return sha256Hex(address.trim());
}

/** The most wallets one batch may add (owner, 2026-10-24: several at once under one confirm). */
export const MAX_WALLET_BATCH = 10;

/** SHA-256 hex (WebCrypto) of the trimmed addresses joined by newlines, in the order given. */
export function addressesHash(addresses: readonly string[]): Promise<string> {
  return sha256Hex(addresses.map((a) => a.trim()).join('\n'));
}

/** The ends of the trimmed addresses, in order, joined by commas. */
export function addressEnds(addresses: readonly string[]): string {
  return addresses.map(addressEnd).join(',');
}

/** Last 6 characters of the trimmed address. */
export function addressEnd(address: string): string {
  return address.trim().slice(-6);
}
