/**
 * Actions that need a confirm-it's-you token, shared by browser and server:
 * the hash a token is bound to, and the words shown to the person.
 */
export type MethodType = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-codes';

export type ConfirmAction =
  | { kind: 'add-wallet'; addressHash: string; addressEnd: string }
  | { kind: 'payout-wait-off' }
  | { kind: 'add-method'; method: MethodType }
  | { kind: 'remove-method'; method: MethodType; id: string }
  | { kind: 'set-password' }
  | { kind: 'new-recovery-codes' }
  | { kind: 'add-device-key'; signPublicHash: string };

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
    case 'payout-wait-off':
      return 'turn off the 24-hour wait for new payout wallets';
    case 'add-method':
      return `add a login method (${a.method})`;
    case 'remove-method':
      return `remove a login method (${a.method})`;
    case 'set-password':
      return 'set a new password';
    case 'new-recovery-codes':
      return 'make new recovery codes';
    case 'add-device-key':
      return 'add a trade signing key';
  }
}

/** SHA-256 hex (WebCrypto) of the trimmed address. */
export function addressHash(address: string): Promise<string> {
  return sha256Hex(address.trim());
}

/** Last 6 characters of the trimmed address. */
export function addressEnd(address: string): string {
  return address.trim().slice(-6);
}
