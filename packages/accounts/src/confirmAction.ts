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
   * Plan 2 Task 18: the account owner invites a team member: `name`, their name on the team (chats show "<lead> Assistant N", S-105),
   * exactly as typed (review M9(a): one confirm invites one named member), and `roles`, the roles
   * comma-separated in a fixed order.
   */
  | { kind: 'team-invite'; name: string; roles: string }
  /** Changes one member's roles to exactly `roles`. */
  | { kind: 'team-roles'; memberId: string; roles: string }
  /**
   * Job 1c (J-10): an invite with granular boxes: `abilities`, the ability ids comma-separated in
   * the catalogue's order (apps/api/src/team/abilities.ts).
   */
  | { kind: 'team-invite-abilities'; name: string; abilities: string }
  /** Sets one member's boxes to exactly `abilities` (comma-separated, catalogue order). */
  | { kind: 'team-abilities'; memberId: string; abilities: string }
  /** Removes one member (or cancels an invite). */
  | { kind: 'team-remove'; memberId: string }
  /** "Stay logged in?" (owner, 2 Nov 2026): extend this session by its length. Bound to the session by the token. */
  | { kind: 'extend-session' }
  /**
   * Owner 2 Nov 2026: the account holder switches the account from Trader to Vendor (it turns on
   * the 1% fee). Only a passkey, security key or PGP key may confirm it (`STRONG_ONLY_ACTIONS`).
   */
  | { kind: 'become-vendor' };

/**
 * Actions only a passkey, security key or PGP key may confirm: the confirm sheet offers no
 * password for them, and the server issues no password confirm token for them.
 */
export const STRONG_ONLY_ACTIONS: readonly ConfirmAction['kind'][] = ['become-vendor'];

export function needsStrongConfirm(a: ConfirmAction): boolean {
  return STRONG_ONLY_ACTIONS.includes(a.kind);
}

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
    case 'team-invite-abilities':
      // COPY-UNSIGNED
      return `invite ${a.name} as a team member (${boxCount(a.abilities)})`;
    case 'team-abilities':
      // COPY-UNSIGNED
      return `change a team member's abilities (${boxCount(a.abilities)})`;
    case 'team-remove':
      return 'remove a team member';
    case 'extend-session':
      return 'stay logged in';
    case 'become-vendor':
      return 'switch to a vendor account';
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

/** "1 ability" or "N abilities" from a comma-separated abilities list. COPY-UNSIGNED */
function boxCount(abilities: string): string {
  const n = abilities === '' ? 0 : abilities.split(',').length;
  return n === 1 ? '1 ability' : `${n} abilities`;
}

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
